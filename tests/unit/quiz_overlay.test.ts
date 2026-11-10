import { describe, it, expect } from 'vitest';
import * as CollisionDetector from '../../src/engine/CollisionDetector';
import type { QuizOptions, ShapePayload, QuizPair, QuizOption } from '../../src/types';
import { parseMatchingVoiceAnswer, parseOrderingVoiceAnswer, scoreMatchText } from '../../src/engine/QuizSpeechParser';

describe('Instant Quiz Engine — Collision & Shape Geometry', () => {
  it('calculates accurate bounding box for quiz shapeType', () => {
    const quizShape: ShapePayload = {
      kind: 'shape',
      shapeType: 'quiz',
      x: 1000,
      y: 180,
      width: 520,
      height: 380,
      options: {
        quizType: 'multiple_choice',
        question: 'What is Supervised Learning?',
        options: [
          { id: 'opt-a', label: 'A', text: 'Uses labeled training data', isCorrect: true },
          { id: 'opt-b', label: 'B', text: 'Uses unlabeled data', isCorrect: false },
        ],
      },
    };

    const bounds = CollisionDetector.getShapeBounds(quizShape);
    expect(bounds.x).toBe(1000);
    expect(bounds.y).toBe(180);
    expect(bounds.width).toBe(520);
    expect(bounds.height).toBe(380);
  });

  it('supports default fallback dimensions when width/height omitted', () => {
    const quizShape: ShapePayload = {
      kind: 'shape',
      shapeType: 'quiz',
      x: 800,
      y: 200,
    };

    const bounds = CollisionDetector.getShapeBounds(quizShape);
    expect(bounds.x).toBe(800);
    expect(bounds.y).toBe(200);
    expect(bounds.width).toBeGreaterThanOrEqual(480);
    expect(bounds.height).toBeGreaterThanOrEqual(360);
  });

  it('allocates wider bounds for matching quizType to accommodate two columns', () => {
    const matchingQuizShape: ShapePayload = {
      kind: 'shape',
      shapeType: 'quiz',
      x: 950,
      y: 180,
      width: 620,
      height: 420,
      options: {
        quizType: 'matching',
        question: 'Match terms to definitions:',
        pairs: [
          { leftId: 'l1', leftText: 'Supervised', rightId: 'r1', rightText: 'Labeled data' },
        ],
      },
    };

    const bounds = CollisionDetector.getShapeBounds(matchingQuizShape);
    expect(bounds.x).toBe(950);
    expect(bounds.y).toBe(180);
    expect(bounds.width).toBe(620);
    expect(bounds.height).toBe(420);
  });

  it('allocates proper bounds for fill_in_the_blank quizType', () => {
    const blankQuizShape: ShapePayload = {
      kind: 'shape',
      shapeType: 'quiz',
      x: 1000,
      y: 180,
      width: 540,
      height: 380,
      options: {
        quizType: 'fill_in_the_blank',
        question: 'Vervollständige die Definition!',
        blankSentence: '____ Lernen ist eine Art des maschinellen Lernens...',
        correctAnswer: 'Unüberwachtes',
        acceptedAnswers: ['Unüberwachtes', 'Unüberwacht'],
        explanation: 'Unüberwachtes Lernen findet Muster in Daten ohne Labels.',
      },
    };

    const bounds = CollisionDetector.getShapeBounds(blankQuizShape);
    expect(bounds.x).toBe(1000);
    expect(bounds.y).toBe(180);
    expect(bounds.width).toBe(540);
    expect(bounds.height).toBe(380);
  });

  it('allocates proper bounds for short_answer essay quizType', () => {
    const shortAnswerShape: ShapePayload = {
      kind: 'shape',
      shapeType: 'quiz',
      x: 980,
      y: 180,
      width: 580,
      height: 400,
      options: {
        quizType: 'short_answer',
        question: 'Beschreibe den Hauptunterschied zwischen überwachtem und unüberwachtem Lernen.',
        correctAnswer: 'Überwachtes Lernen nutzt gelabelte Daten, unüberwachtes Lernen findet Muster in ungelabelten Daten.',
        explanation: 'Überwachtes Lernen nutzt bekannte Labels, unüberwachtes lernt ohne Vorgaben.',
      },
    };

    const bounds = CollisionDetector.getShapeBounds(shortAnswerShape);
    expect(bounds.x).toBe(980);
    expect(bounds.y).toBe(180);
    expect(bounds.width).toBe(580);
    expect(bounds.height).toBe(400);
  });

  it('allocates proper bounds for ordering sequence quizType', () => {
    const orderingShape: ShapePayload = {
      kind: 'shape',
      shapeType: 'quiz',
      x: 980,
      y: 180,
      width: 580,
      height: 420,
      options: {
        quizType: 'ordering',
        question: 'Bringen Sie die Schritte in die richtige Reihenfolge:',
        acceptedAnswers: ['Schritt 1', 'Schritt 2', 'Schritt 3'],
      },
    };

    const bounds = CollisionDetector.getShapeBounds(orderingShape);
    expect(bounds.x).toBe(980);
    expect(bounds.y).toBe(180);
    expect(bounds.width).toBe(580);
    expect(bounds.height).toBe(420);
  });
});

describe('Concept Matching — Voice & Spoken Speech Parsing', () => {
  const samplePairs: QuizPair[] = [
    { leftId: 'l1', leftText: 'Supervised Learning', rightId: 'r1', rightText: 'Nutzung gelabelter Daten' },
    { leftId: 'l2', leftText: 'Unsupervised Learning', rightId: 'r2', rightText: 'Muster in ungelabelten Daten' },
    { leftId: 'l3', leftText: 'Reinforcement Learning', rightId: 'r3', rightText: 'Lernen durch Belohnung' },
  ];

  // Scrambled display order on screen:
  // Row 1: Muster in ungelabelten Daten (r2)
  // Row 2: Lernen durch Belohnung (r3)
  // Row 3: Nutzung gelabelter Daten (r1)
  const displayedRight: QuizPair[] = [
    samplePairs[1],
    samplePairs[2],
    samplePairs[0],
  ];

  it('correctly parses full spoken German sentences into matching pairs', () => {
    const speech = 'Supervised Learning gehört zu Nutzung gelabelter Daten, Unsupervised Learning gehört zu Muster in ungelabelten Daten und Reinforcement Learning zu Lernen durch Belohnung';
    const matches = parseMatchingVoiceAnswer(speech, samplePairs, displayedRight);

    expect(matches['l1']).toBe('r1');
    expect(matches['l2']).toBe('r2');
    expect(matches['l3']).toBe('r3');
  });

  it('faithfully registers incorrect matching pairs spoken by the student without forcing correctness', () => {
    // Student incorrectly matched Supervised -> Muster in ungelabelten Daten, and Unsupervised -> Nutzung gelabelter Daten
    const speech = 'Supervised Learning gehört zu Muster in ungelabelten Daten, Unsupervised Learning gehört zu Nutzung gelabelter Daten und Reinforcement Learning zu Lernen durch Belohnung';
    const matches = parseMatchingVoiceAnswer(speech, samplePairs, displayedRight);

    expect(matches['l1']).toBe('r2'); // Incorrect match preserved!
    expect(matches['l2']).toBe('r1'); // Incorrect match preserved!
    expect(matches['l3']).toBe('r3');
  });

  it('differentiates correct vs incorrect pairs in evaluation state', () => {
    // Left items: l1, l2, l3
    // Right items: r1, r2, r3
    // Suppose user matched l1 -> r2 (wrong), l2 -> r1 (wrong), l3 -> r3 (correct)
    const userMatches = { l1: 'r2', l2: 'r1', l3: 'r3' };
    
    // Evaluate correctness per pair
    const left1Correct = userMatches['l1'] === samplePairs[0].rightId; // r2 === r1 -> false
    const left2Correct = userMatches['l2'] === samplePairs[1].rightId; // r1 === r2 -> false
    const left3Correct = userMatches['l3'] === samplePairs[2].rightId; // r3 === r3 -> true

    expect(left1Correct).toBe(false);
    expect(left2Correct).toBe(false);
    expect(left3Correct).toBe(true);
  });

  it('parses spoken numerical positions referencing the UI columns (e.g. 1 mit 3, 2 mit 1, 3 mit 2)', () => {
    // 1 (l1) matched to row 3 of right column (r1)
    // 2 (l2) matched to row 1 of right column (r2)
    // 3 (l3) matched to row 2 of right column (r3)
    const speech = '1 mit 3, 2 mit 1, 3 mit 2';
    const matches = parseMatchingVoiceAnswer(speech, samplePairs, displayedRight);

    expect(matches['l1']).toBe('r1');
    expect(matches['l2']).toBe('r2');
    expect(matches['l3']).toBe('r3');
  });

  it('parses spoken alphabetical positions (A zu C, B zu A, C zu B)', () => {
    const speech = 'A zu C, B zu A, C zu B';
    const matches = parseMatchingVoiceAnswer(speech, samplePairs, displayedRight);

    expect(matches['l1']).toBe('r1');
    expect(matches['l2']).toBe('r2');
    expect(matches['l3']).toBe('r3');
  });

  it('parses structured JSON strings passed by tutor tools', () => {
    const jsonStr = JSON.stringify({ l1: 'r1', l2: 'r2', l3: 'r3' });
    const matches = parseMatchingVoiceAnswer(jsonStr, samplePairs, displayedRight);

    expect(matches['l1']).toBe('r1');
    expect(matches['l2']).toBe('r2');
    expect(matches['l3']).toBe('r3');
  });

  it('parses conversational English voice matching statements', () => {
    const speech = 'Supervised Learning matches with labeled data, Unsupervised with unlabeled data, Reinforcement with rewards';
    const pairs: QuizPair[] = [
      { leftId: 'l1', leftText: 'Supervised Learning', rightId: 'r1', rightText: 'Labeled data' },
      { leftId: 'l2', leftText: 'Unsupervised Learning', rightId: 'r2', rightText: 'Unlabeled data' },
      { leftId: 'l3', leftText: 'Reinforcement Learning', rightId: 'r3', rightText: 'Rewards' },
    ];
    const matches = parseMatchingVoiceAnswer(speech, pairs, pairs);

    expect(matches['l1']).toBe('r1');
    expect(matches['l2']).toBe('r2');
    expect(matches['l3']).toBe('r3');
  });
});

describe('Sequence Ordering — Voice & Spoken Speech Parsing', () => {
  const samplePipelineOptions: QuizOption[] = [
    { id: 'opt_1', label: '1', text: 'Daten vorbereiten', order: 2 },
    { id: 'opt_2', label: '2', text: 'Modell evaluieren', order: 4 },
    { id: 'opt_3', label: '3', text: 'Daten sammeln', order: 1 },
    { id: 'opt_4', label: '4', text: 'Modell trainieren', order: 3 },
    { id: 'opt_5', label: '5', text: 'Modell bereitstellen', order: 5 },
  ];

  it('correctly distinguishes options sharing common generic prefixes like "Daten" and "Modell"', () => {
    const speech = 'Daten sammeln, Daten vorbereiten, Modell bereitstellen, Modell trainieren, Modell evaluieren';
    const order = parseOrderingVoiceAnswer(speech, samplePipelineOptions);

    expect(order).toEqual(['opt_3', 'opt_1', 'opt_5', 'opt_4', 'opt_2']);
  });

  it('faithfully preserves user custom sequence even when intentionally wrong or conversational', () => {
    const conversationalSpeech = 'Eh das ist nicht mein Antwort. Ich habe geantwortet äh Daten sammeln zuerst. Äh dann äh Daten äh dann äh Daten vorbereiten. Dann Modell bereitstellen. Dann Modell trainieren. Dann Modell evaluieren.';
    const order = parseOrderingVoiceAnswer(conversationalSpeech, samplePipelineOptions);

    expect(order).toEqual(['opt_3', 'opt_1', 'opt_5', 'opt_4', 'opt_2']);
  });

  it('correctly parses spoken shorthand keywords based on distinctive word extraction', () => {
    const shorthandSpeech = 'sammeln, vorbereiten, trainieren, evaluieren, bereitstellen';
    const order = parseOrderingVoiceAnswer(shorthandSpeech, samplePipelineOptions);

    expect(order).toEqual(['opt_3', 'opt_1', 'opt_4', 'opt_2', 'opt_5']);
  });

  it('handles fuzzy matching when user says "Daten bereitstellen" instead of "Modell bereitstellen"', () => {
    const speech = 'Daten sammeln, Daten vorbereiten, Daten bereitstellen, Modell trainieren, Modell evaluieren';
    const order = parseOrderingVoiceAnswer(speech, samplePipelineOptions);

    expect(order).toEqual(['opt_3', 'opt_1', 'opt_5', 'opt_4', 'opt_2']);
  });

  it('parses sequence numbers and letters (e.g. 3, 1, 4, 2, 5)', () => {
    const speech = '3, 1, 4, 2, 5';
    const order = parseOrderingVoiceAnswer(speech, samplePipelineOptions);

    expect(order).toEqual(['opt_3', 'opt_1', 'opt_4', 'opt_2', 'opt_5']);
  });

  it('handles partial positional conversational speech like "zuerst Datensammlung, zweiten Datenvorverarbeitung"', () => {
    const opts: QuizOption[] = [
      { id: 'opt_1', label: '1', text: '5. Datensammlung', order: 1 },
      { id: 'opt_2', label: '2', text: '1. Bereitstellung', order: 5 },
      { id: 'opt_3', label: '3', text: '4. Modelltraining', order: 3 },
      { id: 'opt_4', label: '4', text: '3. Modellevaluierung', order: 4 },
      { id: 'opt_5', label: '5', text: '2. Datenvorverarbeitung', order: 2 },
    ];
    const initialOrder = ['opt_1', 'opt_2', 'opt_3', 'opt_4', 'opt_5'];
    const speech = 'Also zuerst Datensammlung, zweiten Datenvorverarbeitung, richtig oder falsch? Also, warum hast du das im Vorbereitung am Ende sitzen?';
    const order = parseOrderingVoiceAnswer(speech, opts, initialOrder);

    // opt_1 (Datensammlung) must be 1st, opt_5 (Datenvorverarbeitung) must be 2nd!
    expect(order[0]).toBe('opt_1');
    expect(order[1]).toBe('opt_5');
  });

  it('parses JSON array strings passed by tutor tools', () => {
    const jsonStr = JSON.stringify(['opt_3', 'opt_1', 'opt_4', 'opt_2', 'opt_5']);
    const order = parseOrderingVoiceAnswer(jsonStr, samplePipelineOptions);

    expect(order).toEqual(['opt_3', 'opt_1', 'opt_4', 'opt_2', 'opt_5']);
  });
});
