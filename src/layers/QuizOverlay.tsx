/**
 * QuizOverlay — Interactive Multimodal Instant Quiz Engine for Digital Whiteboard.
 *
 * Supports 6 core quiz paradigms with 4-way multimodal interactivity:
 * 1. Multiple Choice (Single & Multi-Select)
 * 2. True / False
 * 3. Matching / Pair Association (Click-to-match & Stroke drag)
 * 4. Fill in the Blank (Interactive inline input)
 * 5. Ordering / Step Sequencing
 * 6. Short Answer / Oral Socratic Response
 *
 * Interactivity:
 * - Touch / Click on canvas
 * - Voice recognition via Gemini Live / Agent speech
 * - Handwriting / Text input
 * - Freehand drawing & circling recognition (Encircle gesture)
 */
import React, { useState, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import type { QuizOptions, QuizOption, QuizPair, QuizType } from '../types';
import type { UserDrawingPath } from '../components/SlidePanel';
import { scoreMatchText, parseMatchingVoiceAnswer, parseOrderingVoiceAnswer } from '../engine/QuizSpeechParser';

export interface QuizOverlayHandle {
  addQuiz(quiz: QuizOptions & { id?: string }): string;
  updateQuiz(quizId: string, updates: Partial<QuizOptions>): void;
  removeQuiz(quizId: string): void;
  retryQuiz(quizId?: string): void;
  clear(): void;
  getQuizzes(): QuizOptions[];
  setQuizzes(quizzes: QuizOptions[]): void;
  submitAnswer(
    quizId: string,
    answerPayload: any,
    mode?: 'click' | 'voice' | 'drawing' | 'text'
  ): { isCorrect: boolean; feedback: string };
  evaluateDrawingInteraction(paths: UserDrawingPath[]): boolean;
  applyEvaluationResult?(quizId: string, isCorrect: boolean, feedback: string): void;
}

export interface QuizOverlayProps {
  onQuizAnswerSubmitted?: (
    quizId: string,
    answer: any,
    isCorrect: boolean,
    mode: 'click' | 'voice' | 'drawing' | 'text'
  ) => void;
  onRemoveQuiz?: (quizId: string) => void;
  onUpdatePosition?: (quizId: string, x: number, y: number) => void;
  zoom?: number;
}

interface ActiveQuizState extends QuizOptions {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selectedOptionId?: string | string[];
  userMatches?: Record<string, string>; // leftId -> rightId
  userTextAnswer?: string;
  userOrdering?: string[]; // optionIds in current order
  activeLeftMatch?: string | null;
  shuffledRightPairs?: QuizPair[];
  status: 'active' | 'evaluating' | 'correct' | 'incorrect' | 'revealed';
}

// ─── Subtle Web Audio Feedback (Zero External Dependencies) ──
function playChime(success: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (success) {
      // Pleasant rising major chord
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2); // G5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now);
      osc.stop(now + 0.45);
    } else {
      // Soft gentle low chord
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(329.63, now); // E4
      osc.frequency.linearRampToValueAtTime(293.66, now + 0.15); // D4
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch {
    // AudioContext blocked or unavailable
  }
}

export const QuizOverlay = forwardRef<QuizOverlayHandle, QuizOverlayProps>(
  ({ onQuizAnswerSubmitted, onRemoveQuiz, onUpdatePosition, zoom = 1.0 }, ref) => {
    const [quizzes, setQuizzes] = useState<ActiveQuizState[]>([]);
    const quizzesRef = useRef<ActiveQuizState[]>([]);
    quizzesRef.current = quizzes;

    // Dragging state
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const dragOffsetRef = useRef<{ offsetX: number; offsetY: number }>({ offsetX: 0, offsetY: 0 });

    const addQuiz = useCallback((quiz: QuizOptions & { id?: string }): string => {
      const id = quiz.quizId || quiz.id || `quiz-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const defaultWidth = quiz.width ?? (quiz.quizType === 'matching' ? 620 : (quiz.quizType === 'short_answer' || quiz.quizType === 'ordering') ? 580 : 540);
      const defaultHeight = quiz.height ?? (quiz.quizType === 'matching' ? 420 : (quiz.quizType === 'short_answer' || quiz.quizType === 'ordering') ? 420 : 380);

      // Normalize options to guarantee clean text, label, id, and correct answer flag
      let rawOptions: any[] = Array.isArray(quiz.options) ? [...quiz.options] : [];

      // Resilient ordering recovery if model placed steps in acceptedAnswers or in question
      if (quiz.quizType === 'ordering' && rawOptions.length === 0) {
        if (quiz.acceptedAnswers && quiz.acceptedAnswers.length > 0) {
          rawOptions = quiz.acceptedAnswers.map((ans, idx) => ({
            id: `step_${idx + 1}`,
            label: String(idx + 1),
            text: String(ans),
            order: idx + 1,
            isCorrect: true,
          }));
        } else if (quiz.question && (quiz.question.includes(':') || /\d+[.\-)]\s+\w+/.test(quiz.question))) {
          const afterColon = quiz.question.includes(':')
            ? quiz.question.slice(quiz.question.indexOf(':') + 1)
            : quiz.question;
          const colonParts = afterColon.split(/\s*(?:,|\n+|\b(?=\d+[.\-)]\s*))\s*/);
          const candidates = colonParts
            .map((c) => c.trim().replace(/\.$/, ''))
            .map((c) => c.replace(/^[0-9]+[.\-)]\s*/, '').trim())
            .filter((c) => c.length > 2);
          if (candidates.length >= 2) {
            rawOptions = candidates.map((cleanC, idx) => ({
              id: `step_${idx + 1}`,
              label: String(idx + 1),
              text: cleanC,
              order: idx + 1,
              isCorrect: true,
            }));
          }
        }
      }

      const normalizedOptions = rawOptions.map((rawOpt, idx) => {
        const opt = typeof rawOpt === 'string' ? { text: rawOpt } : (rawOpt || {});
        const oId = opt.id || `opt_${idx + 1}`;
        const rawLabel = opt.label?.trim() || '';
        const rawText = opt.text?.trim() || '';
        // If text is missing or empty, but label contains the full sentence/word (> 2 chars), swap them
        const text = rawText || (rawLabel.length > 2 ? rawLabel : oId);
        const label =
          rawLabel.length <= 2 && rawLabel.length > 0
            ? rawLabel
            : oId.length <= 2
            ? oId.toUpperCase()
            : String.fromCharCode(65 + idx);

        let isCorrect = Boolean(opt.isCorrect);
        const order = typeof opt.order === 'number' ? opt.order : idx + 1;
        return {
          ...opt,
          id: oId,
          label,
          text,
          isCorrect,
          order,
        };
      });

      // Explicit target enforcement (overrides any model misclassification)
      const targetAns = String(quiz.correctAnswer || quiz.correctOption || '').trim().toLowerCase();
      if (targetAns && normalizedOptions.length > 0) {
        let matched = false;
        for (const opt of normalizedOptions) {
          const oId = opt.id.toLowerCase();
          const oLabel = opt.label.toLowerCase();
          const oText = opt.text.toLowerCase();
          const isTarget =
            oId === targetAns ||
            oLabel === targetAns ||
            oText === targetAns ||
            (targetAns in { false: 1, falsch: 1, b: 1, no: 1, nein: 1, faux: 1 } &&
              (oId === 'false' || oLabel === 'b' || oText === 'false')) ||
            (targetAns in { true: 1, richtig: 1, a: 1, yes: 1, ja: 1, wahr: 1, vrai: 1 } &&
              (oId === 'true' || oLabel === 'a' || oText === 'true'));

          if (isTarget) {
            opt.isCorrect = true;
            matched = true;
          } else {
            opt.isCorrect = false;
          }
        }
      } else if (!normalizedOptions.some((o) => o.isCorrect)) {
        // Fallback auto-detection if none marked correct
        const expLower = String(quiz.explanation || '').trim().toLowerCase();
        let matchedExp = false;
        for (const opt of normalizedOptions) {
          if (expLower && opt.text.length > 2 && expLower.includes(opt.text.toLowerCase())) {
            opt.isCorrect = true;
            matchedExp = true;
            break;
          }
        }
        if (!matchedExp && normalizedOptions.length > 0) {
          normalizedOptions[0].isCorrect = true;
        }
      }

      // Normalize accepted answers for fill_in_the_blank / short_answer
      let acceptedAnswers = (quiz.acceptedAnswers || [])
        .map((a) => String(a || '').trim())
        .filter(Boolean);

      if (
        quiz.correctAnswer &&
        !acceptedAnswers.some((a) => a.toLowerCase() === quiz.correctAnswer!.trim().toLowerCase())
      ) {
        acceptedAnswers.unshift(quiz.correctAnswer.trim());
      }

      if (acceptedAnswers.length === 0 && quiz.explanation) {
        const firstWord = quiz.explanation
          .trim()
          .split(/\s+/)[0]
          ?.replace(/^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g, '');
        if (firstWord && firstWord.length >= 3) {
          acceptedAnswers.push(firstWord);
        }
      }

      // Normalize pairs for matching quizzes
      const rawPairs = quiz.pairs || [];
      const normalizedPairs: QuizPair[] = rawPairs.map((p: any, idx: number) => {
        const leftText = String(
          p.leftText || p.left || p.term || p.concept || p.key || p.left_text || ''
        ).trim();
        const rightText = String(
          p.rightText || p.right || p.definition || p.desc || p.value || p.right_text || ''
        ).trim();
        const leftId = String(p.leftId || p.left_id || `left_${idx + 1}`);
        const rightId = String(p.rightId || p.right_id || `right_${idx + 1}`);
        return {
          leftId,
          leftText,
          rightId,
          rightText,
        };
      });

      // Derive scrambled right column for matching so it provides a genuine interactive challenge
      const scrambledRight = [...normalizedPairs];
      if (scrambledRight.length > 1) {
        scrambledRight.sort((a, b) => b.rightText.localeCompare(a.rightText));
        if (scrambledRight.every((p, i) => p.rightId === normalizedPairs[i].rightId) && scrambledRight.length > 1) {
          scrambledRight.push(scrambledRight.shift()!);
        }
      }

      // Smart initial ordering for ordering quizzes
      let initialOrdering: string[] | undefined = undefined;
      if (quiz.quizType === 'ordering' && normalizedOptions.length > 0) {
        const correctIds = [...normalizedOptions]
          .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
          .map((o) => o.id);

        if (correctIds.length > 1) {
          // Scramble so the student has an actual challenge
          const scrambled = [...correctIds].reverse();
          if (scrambled.every((id, i) => id === correctIds[i])) {
            scrambled.push(scrambled.shift()!);
          }
          initialOrdering = scrambled;
        } else {
          initialOrdering = correctIds;
        }
      }

      const newQuiz: ActiveQuizState = {
        ...quiz,
        id,
        quizId: id,
        x: quiz.x ?? 1000,
        y: quiz.y ?? 180,
        width: defaultWidth,
        height: defaultHeight,
        options: normalizedOptions,
        pairs: normalizedPairs,
        acceptedAnswers,
        correctAnswer: quiz.correctAnswer || (acceptedAnswers.length > 0 ? acceptedAnswers[0] : undefined),
        shuffledRightPairs: scrambledRight,
        status: quiz.status ?? 'active',
        userOrdering: initialOrdering,
        userMatches: quiz.userMatches ?? {},
        userTextAnswer: quiz.userTextAnswer ?? '',
      };

      setQuizzes((prev) => {
        const filtered = prev.filter((q) => q.id !== id);
        return [...filtered, newQuiz];
      });

      return id;
    }, []);

    const updateQuiz = useCallback((quizId: string, updates: Partial<QuizOptions>) => {
      setQuizzes((prev) =>
        prev.map((q) => (q.id === quizId ? { ...q, ...updates } : q))
      );
    }, []);

    const removeQuiz = useCallback(
      (quizId: string) => {
        setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
        onRemoveQuiz?.(quizId);
      },
      [onRemoveQuiz]
    );

    const retryQuiz = useCallback((quizId?: string) => {
      setQuizzes((prev) =>
        prev.map((q) =>
          !quizId || q.id === quizId || quizId === 'active' || quizId === 'current'
            ? {
                ...q,
                status: 'active',
                selectedOptionId: undefined,
                userMatches: {},
                userTextAnswer: '',
                activeLeftMatch: null,
                aiFeedback: undefined,
              }
            : q
        )
      );
    }, []);

    const clear = useCallback(() => {
      setQuizzes([]);
    }, []);

    const getQuizzes = useCallback((): QuizOptions[] => {
      return quizzesRef.current;
    }, []);

    const setQuizzesState = useCallback((qs: QuizOptions[]) => {
      setQuizzes(
        qs.map((q) => ({
          ...q,
          id: q.quizId || `quiz-${Date.now()}`,
          x: q.x ?? 1000,
          y: q.y ?? 180,
          width: q.width ?? 520,
          height: q.height ?? 360,
          status: q.status ?? 'active',
        }))
      );
    }, []);

    // ─── Answer Evaluation Logic ──────────────────────────────
    const evaluateAndSubmit = useCallback(
      (
        quizId: string,
        answerPayload: any,
        mode: 'click' | 'voice' | 'drawing' | 'text' = 'click'
      ): { isCorrect: boolean; feedback: string } => {
        let current = quizzesRef.current.find((q) => q.id === quizId);
        if (!current && quizzesRef.current.length > 0) {
          current = quizzesRef.current[quizzesRef.current.length - 1];
        }
        if (!current) return { isCorrect: false, feedback: 'Quiz not found' };

        const targetQuizId = current.id;
        const strPayload = String(answerPayload || '').trim().toLowerCase();

        // 1. Explicit retry / reset command
        if (strPayload === 'retry' || strPayload === 'reset' || strPayload === 'try again') {
          retryQuiz(targetQuizId);
          return { isCorrect: false, feedback: 'Quiz reset for retry' };
        }

        // 2. Autonomous auto-retry: if quiz is currently in 'incorrect' status, automatically reset state first
        if (current.status === 'incorrect' || current.status === 'correct') {
          current = {
            ...current,
            status: 'active',
            selectedOptionId: undefined,
            aiFeedback: undefined,
          };
        }

        let isCorrect = false;
        let feedback = '';
        let targetOptionId: string | undefined = undefined;

        let finalOrdering: string[] | undefined = undefined;
        let finalMatches: Record<string, string> | undefined = undefined;

        if (current.quizType === 'multiple_choice' || current.quizType === 'true_false') {
          // Clean conversational spoken phrases (e.g. "i choose option b", "the answer is supervised learning")
          const cleanedStr = strPayload
            .replace(/^(i\s+choose|i\s+think\s+(it's|it\s+is)?|answer\s+is|the\s+answer\s+is|it's|my\s+answer\s+is|choice|option)\s+/i, '')
            .trim();

          const targetOpt = (current.options || []).find((o) => {
            const oId = o.id.toLowerCase();
            const oLabel = (o.label || '').toLowerCase();
            const oText = o.text.toLowerCase();

            const isFalseOpt = oId === 'false' || oText === 'false' || oLabel === 'b';
            const isTrueOpt = oId === 'true' || oText === 'true' || oLabel === 'a';

            const falseAliases = ['false', 'falsch', 'b', 'no', 'nein', 'faux', 'incorrect'];
            const trueAliases = ['true', 'richtig', 'a', 'yes', 'ja', 'vrai', 'wahr', 'correct'];

            if (isFalseOpt && (falseAliases.includes(strPayload) || falseAliases.includes(cleanedStr))) return true;
            if (isTrueOpt && (trueAliases.includes(strPayload) || trueAliases.includes(cleanedStr))) return true;

            return (
              oId === strPayload ||
              oId === cleanedStr ||
              oLabel === strPayload ||
              oLabel === cleanedStr ||
              strPayload === `option ${oLabel}` ||
              strPayload === `choice ${oLabel}` ||
              cleanedStr === oLabel ||
              (cleanedStr.length >= 2 && oText.includes(cleanedStr)) ||
              (cleanedStr.length >= 2 && cleanedStr.includes(oText)) ||
              (oText.length >= 3 && strPayload.includes(oText))
            );
          });

          if (targetOpt) {
            targetOptionId = targetOpt.id;
            isCorrect = Boolean(targetOpt.isCorrect);
            feedback = isCorrect
              ? `Correct! ${current.explanation || ''}`
              : `Incorrect. ${current.explanation || ''}`;
          } else {
            isCorrect = false;
            feedback = `Option '${answerPayload}' not recognized.`;
          }
        } else if (current.quizType === 'matching') {
          let matches: Record<string, string> = {};
          if (typeof answerPayload === 'object' && answerPayload !== null) {
            matches = { ...(answerPayload as Record<string, string>) };
          } else if (typeof answerPayload === 'string' && answerPayload.trim()) {
            matches = parseMatchingVoiceAnswer(
              answerPayload,
              current.pairs || [],
              current.shuffledRightPairs || current.pairs || [],
              current.userMatches
            );
          } else {
            matches = { ...(current.userMatches || {}) };
          }

          finalMatches = matches;

          const pairs = current.pairs || [];
          const matchedKeys = Object.keys(matches);
          let allMatched = pairs.length > 0 && matchedKeys.length === pairs.length;
          for (const p of pairs) {
            if (matches[p.leftId] !== p.rightId) {
              allMatched = false;
              break;
            }
          }
          isCorrect = allMatched;
          feedback = isCorrect
            ? `All pairs matched perfectly! ${current.explanation || ''}`
            : `Some pairs are not matched correctly.`;
        } else if (current.quizType === 'short_answer') {
          const rawAns = String(answerPayload || '').trim();
          if (!rawAns) {
            return { isCorrect: false, feedback: 'Please write an answer before submitting.' };
          }

          setQuizzes((prev) =>
            prev.map((q) => {
              if (q.id !== targetQuizId && q.quizId !== targetQuizId) return q;
              return {
                ...q,
                status: 'evaluating',
                aiFeedback: 'Evaluating your explanation with AI Tutor...',
                userTextAnswer: rawAns,
              };
            })
          );

          // Safety timeout: release evaluating state if backend takes > 25 seconds without falsely failing
          setTimeout(() => {
            setQuizzes((prev) =>
              prev.map((q) => {
                if ((q.id === targetQuizId || q.quizId === targetQuizId) && q.status === 'evaluating') {
                  return {
                    ...q,
                    status: 'active',
                    aiFeedback: 'Evaluation is taking longer than expected. Please click Submit Answer again.',
                  };
                }
                return q;
              })
            );
          }, 25000);

          onQuizAnswerSubmitted?.(targetQuizId, rawAns, false, mode);
          return { isCorrect: false, feedback: 'Evaluating answer with AI Tutor...' };
        } else if (current.quizType === 'fill_in_the_blank') {
          const rawAns = String(answerPayload || '').normalize('NFC').trim();
          let cleanAns = rawAns.toLowerCase().replace(/^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g, '');
          cleanAns = cleanAns
            .replace(/^(the\s+answer\s+is|i\s+think\s+(it's|it\s+is)?|it's|answer\s+is|die\s+antwort\s+ist|das\s+ist)\s+/i, '')
            .trim();

          // Gather all accepted candidate variants
          const candidates = new Set<string>();
          for (const a of current.acceptedAnswers || []) {
            if (a) {
              const cNorm = String(a).normalize('NFC').trim().toLowerCase().replace(/^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g, '');
              if (cNorm) candidates.add(cNorm);
            }
          }

          if (current.correctAnswer) {
            const caNorm = String(current.correctAnswer).normalize('NFC').trim().toLowerCase().replace(/^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g, '');
            if (caNorm) candidates.add(caNorm);
          }

          // Auto-infer from explanation if available
          if (current.explanation) {
            const firstExp = current.explanation
              .trim()
              .split(/\s+/)[0]
              ?.replace(/^[.,!?;:'"()[\]{}]+|[.,!?;:'"()[\]{}]+$/g, '')
              .normalize('NFC')
              .toLowerCase();
            if (firstExp && firstExp.length >= 3) {
              candidates.add(firstExp);
            }
          }

          const candidateList = Array.from(candidates).filter((c) => c.length > 0);

          // 1. Exact match against candidates
          let matchFound = candidateList.some((c) => c === cleanAns);

          // 2. Substring & inflected stem match (German declensions e.g. Unüberwachtes vs Unüberwacht)
          if (!matchFound && cleanAns.length >= 3) {
            matchFound = candidateList.some((c) => {
              if (c.length >= 3) {
                if (cleanAns.includes(c) || c.includes(cleanAns)) return true;
                const stemLen = Math.min(cleanAns.length, c.length) - 2;
                if (stemLen >= 3 && cleanAns.slice(0, stemLen) === c.slice(0, stemLen)) {
                  return true;
                }
              }
              return false;
            });
          }

          // 3. Explanation context match: If the user input appears at the start of explanation or as an isolated term
          if (!matchFound && cleanAns.length >= 4 && current.explanation) {
            const expNorm = current.explanation.normalize('NFC').toLowerCase();
            if (
              expNorm.startsWith(cleanAns) ||
              expNorm.includes(` ${cleanAns} `) ||
              expNorm.includes(` ${cleanAns}.`) ||
              expNorm.includes(` ${cleanAns},`)
            ) {
              matchFound = true;
            }
          }

          isCorrect = matchFound;
          const bestExpected = candidateList[0] || current.correctAnswer || '';
          feedback = isCorrect
            ? `Exact match! ${current.explanation || ''}`
            : `Not quite. Expected: ${bestExpected}`;
        } else if (current.quizType === 'ordering') {
          const opts = current.options || [];
          const orderIds = parseOrderingVoiceAnswer(answerPayload, opts, current.userOrdering);
          finalOrdering = orderIds;

          const correctOrder = [...opts]
            .sort((a, b) => Number((a as any).order ?? 0) - Number((b as any).order ?? 0))
            .map((o) => o.id);

          isCorrect =
            correctOrder.length > 0 &&
            orderIds.length === correctOrder.length &&
            orderIds.every((id, idx) => id === correctOrder[idx]);

          feedback = isCorrect
            ? `Steps sequenced correctly! ${current.explanation || ''}`
            : `Sequence order needs adjustment.`;
        }

        playChime(isCorrect);

        setQuizzes((prev) =>
          prev.map((q) => {
            if (q.id !== targetQuizId) return q;
            return {
              ...q,
              status: isCorrect ? 'correct' : 'incorrect',
              aiFeedback: feedback,
              userOrdering: finalOrdering !== undefined ? finalOrdering : q.userOrdering,
              userTextAnswer:
                current.quizType === 'fill_in_the_blank' || current.quizType === 'short_answer'
                  ? (String(answerPayload || '').trim() || q.userTextAnswer)
                  : q.userTextAnswer,
              selectedOptionId:
                current.quizType === 'multiple_choice' || current.quizType === 'true_false'
                  ? (targetOptionId || String(answerPayload))
                  : q.selectedOptionId,
              userMatches:
                finalMatches !== undefined
                  ? finalMatches
                  : (current.quizType === 'matching' && typeof answerPayload === 'object' && answerPayload !== null)
                  ? (answerPayload as Record<string, string>)
                  : q.userMatches,
            };
          })
        );

        onQuizAnswerSubmitted?.(targetQuizId, answerPayload, isCorrect, mode);
        return { isCorrect, feedback };
      },
      [onQuizAnswerSubmitted, retryQuiz]
    );

    // ─── Asynchronous AI Evaluation Result Handler ─────────────
    const applyEvaluationResult = useCallback(
      (quizId: string, isCorrect: boolean, feedback: string) => {
        let targetId = quizId;
        const exists = quizzesRef.current.some((q) => q.id === targetId || q.quizId === targetId);
        if (targetId === 'active' || !exists) {
          const evaluatingQuiz = quizzesRef.current.find((q) => q.status === 'evaluating');
          if (evaluatingQuiz) {
            targetId = evaluatingQuiz.id;
          } else if (quizzesRef.current.length > 0) {
            targetId = quizzesRef.current[quizzesRef.current.length - 1].id;
          }
        }
        playChime(isCorrect);
        setQuizzes((prev) =>
          prev.map((q) => {
            if (q.id !== targetId && q.quizId !== targetId) return q;
            return {
              ...q,
              status: isCorrect ? 'correct' : 'incorrect',
              aiFeedback: feedback || (isCorrect ? 'Correct! Well done.' : 'Incorrect. Try again or ask your tutor.'),
            };
          })
        );
      },
      []
    );

    // ─── Drawing / Stroke Recognition Hook ────────────────────
    const evaluateDrawingInteraction = useCallback(
      (paths: UserDrawingPath[]): boolean => {
        if (!paths || paths.length === 0) return false;
        const lastPath = paths[paths.length - 1];
        if (!lastPath || !lastPath.d) return false;

        // Parse path points
        const matches = [...lastPath.d.matchAll(/([ML])\s*([\d\.-]+)\s*[\s,]\s*([\d\.-]+)/gi)];
        if (matches.length < 3) return false;

        const pts = matches.map((m) => ({ x: parseFloat(m[2]), y: parseFloat(m[3]) }));
        const minX = Math.min(...pts.map((p) => p.x));
        const maxX = Math.max(...pts.map((p) => p.x));
        const minY = Math.min(...pts.map((p) => p.y));
        const maxY = Math.max(...pts.map((p) => p.y));
        const strokeW = maxX - minX;
        const strokeH = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        for (const quiz of quizzesRef.current) {
          if (quiz.status !== 'active') continue;

          // Check if stroke was inside this quiz card
          if (
            centerX >= quiz.x &&
            centerX <= quiz.x + quiz.width &&
            centerY >= quiz.y &&
            centerY <= quiz.y + quiz.height
          ) {
            // 1. Encircle Gesture: stroke is roughly elliptical/circular surrounding an option
            if (quiz.quizType === 'multiple_choice' || quiz.quizType === 'true_false') {
              const options = quiz.options || [];
              const optionH = 46;
              const startY = quiz.y + 110;

              for (let idx = 0; idx < options.length; idx++) {
                const opt = options[idx];
                const optTop = startY + idx * (optionH + 10);
                const optBottom = optTop + optionH;

                // Check if stroke center falls near this option row
                if (centerY >= optTop - 15 && centerY <= optBottom + 15) {
                  evaluateAndSubmit(quiz.id, opt.id, 'drawing');
                  return true;
                }
              }
            }

            // 2. Matching Connection: stroke starts near left column and ends near right column
            if (quiz.quizType === 'matching') {
              const startPt = pts[0];
              const endPt = pts[pts.length - 1];
              const pairs = quiz.pairs || [];

              const colW = quiz.width / 2 - 24;
              const leftColX = quiz.x + 16;
              const rightColX = quiz.x + quiz.width / 2 + 8;
              const startY = quiz.y + 90;
              const itemH = 42;

              let matchedLeftId: string | null = null;
              let matchedRightId: string | null = null;

              for (let i = 0; i < pairs.length; i++) {
                const itemY = startY + i * (itemH + 8);
                if (startPt.y >= itemY - 10 && startPt.y <= itemY + itemH + 10) {
                  matchedLeftId = pairs[i].leftId;
                  break;
                }
              }

              const displayedRights = quiz.shuffledRightPairs || pairs;
              for (let i = 0; i < displayedRights.length; i++) {
                const itemY = startY + i * (itemH + 8);
                if (endPt.y >= itemY - 10 && endPt.y <= itemY + itemH + 10) {
                  matchedRightId = displayedRights[i].rightId;
                  break;
                }
              }

              if (matchedLeftId && matchedRightId) {
                const nextMatches = { ...(quiz.userMatches || {}), [matchedLeftId]: matchedRightId };
                setQuizzes((prev) =>
                  prev.map((q) => (q.id === quiz.id ? { ...q, userMatches: nextMatches } : q))
                );
                // Check if all pairs matched
                if (Object.keys(nextMatches).length === pairs.length) {
                  evaluateAndSubmit(quiz.id, nextMatches, 'drawing');
                }
                return true;
              }
            }
          }
        }

        return false;
      },
      [evaluateAndSubmit]
    );

    useImperativeHandle(
      ref,
      () => ({
        addQuiz,
        updateQuiz,
        removeQuiz,
        retryQuiz,
        clear,
        getQuizzes,
        setQuizzes: setQuizzesState,
        submitAnswer: evaluateAndSubmit,
        evaluateDrawingInteraction,
        applyEvaluationResult,
      }),
      [
        addQuiz,
        updateQuiz,
        removeQuiz,
        retryQuiz,
        clear,
        getQuizzes,
        setQuizzesState,
        evaluateAndSubmit,
        evaluateDrawingInteraction,
        applyEvaluationResult,
      ]
    );

    // ─── Header Dragging Handlers ─────────────────────────────
    const handleHeaderPointerDown = (id: string, e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const targetQuiz = quizzes.find((q) => q.id === id);
      if (!targetQuiz) return;

      const cardX = targetQuiz.x;
      const cardY = targetQuiz.y;
      dragOffsetRef.current = {
        offsetX: e.clientX / zoom - cardX,
        offsetY: e.clientY / zoom - cardY,
      };
      setDraggingId(id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handleHeaderPointerMove = (id: string, e: React.PointerEvent) => {
      if (draggingId !== id) return;
      e.stopPropagation();
      e.preventDefault();

      const newX = Math.round(e.clientX / zoom - dragOffsetRef.current.offsetX);
      const newY = Math.round(e.clientY / zoom - dragOffsetRef.current.offsetY);

      setQuizzes((prev) =>
        prev.map((q) => (q.id === id ? { ...q, x: newX, y: newY } : q))
      );
      onUpdatePosition?.(id, newX, newY);
    };

    const handleHeaderPointerUp = (id: string, e: React.PointerEvent) => {
      if (draggingId === id) {
        setDraggingId(null);
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {}
      }
    };

    if (quizzes.length === 0) return null;

    return (
      <div
        className="quiz-overlay-container"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 45,
        }}
      >
        {quizzes.map((quiz) => {
          const isFinished = quiz.status === 'correct' || quiz.status === 'incorrect';

          return (
            <div
              key={quiz.id}
              data-quiz-id={quiz.id}
              style={{
                position: 'absolute',
                left: `${quiz.x}px`,
                top: `${quiz.y}px`,
                width: `${quiz.width}px`,
                minHeight: `${quiz.height}px`,
                pointerEvents: 'auto',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 14,
                background: 'rgba(15, 23, 42, 0.98)',
                border: `1px solid ${
                  quiz.status === 'correct'
                    ? '#10b981'
                    : quiz.status === 'incorrect'
                    ? '#ef4444'
                    : 'rgba(56, 189, 248, 0.4)'
                }`,
                boxShadow:
                  quiz.status === 'correct'
                    ? '0 16px 40px rgba(16, 185, 129, 0.25), 0 0 20px rgba(16, 185, 129, 0.2)'
                    : quiz.status === 'incorrect'
                    ? '0 16px 40px rgba(239, 68, 68, 0.25)'
                    : '0 16px 40px rgba(0, 0, 0, 0.65)',
                overflow: 'hidden',
                userSelect: 'none',
                WebkitFontSmoothing: 'subpixel-antialiased',
                textRendering: 'optimizeLegibility',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                transition: 'border 0.3s ease, box-shadow 0.3s ease',
              }}
            >
              {/* ── Drag Header ── */}
              <div
                onPointerDown={(e) => handleHeaderPointerDown(quiz.id, e)}
                onPointerMove={(e) => handleHeaderPointerMove(quiz.id, e)}
                onPointerUp={(e) => handleHeaderPointerUp(quiz.id, e)}
                onPointerCancel={(e) => handleHeaderPointerUp(quiz.id, e)}
                style={{
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 14px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  cursor: 'grab',
                  touchAction: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15 }}>⚡</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: '#38bdf8',
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    {quiz.quizType === 'multiple_choice'
                      ? 'Instant Quiz · Multiple Choice'
                      : quiz.quizType === 'true_false'
                      ? 'Instant Quiz · True / False'
                      : quiz.quizType === 'matching'
                      ? 'Instant Quiz · Concept Matching'
                      : quiz.quizType === 'fill_in_the_blank'
                      ? 'Instant Quiz · Fill in the Blank'
                      : quiz.quizType === 'short_answer'
                      ? 'Instant Quiz · Short Answer'
                      : quiz.quizType === 'ordering'
                      ? 'Instant Quiz · Sequence Ordering'
                      : 'Instant Quiz · Formative Assessment'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() => removeQuiz(quiz.id)}
                    title="Close Quiz"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: 14,
                      cursor: 'pointer',
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* ── Question Body ── */}
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    lineHeight: 1.45,
                    color: '#f8fafc',
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {quiz.question}
                </div>

                {/* ── Mode 1 & 2: Multiple Choice & True/False ── */}
                {(quiz.quizType === 'multiple_choice' || quiz.quizType === 'true_false') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(quiz.options || []).map((opt, idx) => {
                      const isSelected =
                        quiz.selectedOptionId === opt.id ||
                        quiz.selectedOptionId === opt.label ||
                        (typeof quiz.selectedOptionId === 'string' &&
                          opt.text &&
                          quiz.selectedOptionId.toLowerCase() === opt.text.toLowerCase());
                      const showGreen = isFinished && isSelected && opt.isCorrect;
                      const showRed = isFinished && isSelected && !opt.isCorrect;

                      const optionText =
                        opt.text || (opt.label && opt.label.length > 2 ? opt.label : opt.id || '');
                      const badgeLabel =
                        opt.label && opt.label.length <= 2
                          ? opt.label
                          : opt.id && opt.id.length <= 2
                          ? opt.id.toUpperCase()
                          : String.fromCharCode(65 + idx);

                      return (
                        <button
                          key={opt.id}
                          onClick={() => evaluateAndSubmit(quiz.id, opt.id, 'click')}
                          style={{
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 14,
                            padding: '12px 16px',
                            borderRadius: 10,
                            textAlign: 'left',
                            cursor: 'pointer',
                            width: '100%',
                            boxSizing: 'border-box',
                            background: showGreen
                              ? 'rgba(16, 185, 129, 0.22)'
                              : showRed
                              ? 'rgba(239, 68, 68, 0.22)'
                              : isSelected
                              ? 'rgba(56, 189, 248, 0.22)'
                              : 'rgba(30, 41, 59, 0.65)',
                            border: `1.5px solid ${
                              showGreen
                                ? '#10b981'
                                : showRed
                                ? '#ef4444'
                                : isSelected
                                ? '#38bdf8'
                                : 'rgba(71, 85, 105, 0.45)'
                            }`,
                            transition: 'background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.borderColor = '#38bdf8';
                              e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.borderColor = 'rgba(71, 85, 105, 0.45)';
                              e.currentTarget.style.background = 'rgba(30, 41, 59, 0.65)';
                            }
                          }}
                        >
                          <span
                            style={{
                              width: 32,
                              height: 32,
                              minWidth: 32,
                              borderRadius: 16,
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 14,
                              fontWeight: 700,
                              background: showGreen
                                ? '#10b981'
                                : showRed
                                ? '#ef4444'
                                : isSelected
                                ? '#38bdf8'
                                : 'rgba(255, 255, 255, 0.1)',
                              color: showGreen || showRed || isSelected ? '#0f172a' : '#cbd5e1',
                            }}
                          >
                            {showGreen ? '✓' : showRed ? '✗' : badgeLabel}
                          </span>

                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 500,
                              lineHeight: 1.45,
                              color: '#f8fafc',
                              fontFamily: "'Inter', sans-serif",
                              flex: 1,
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                            }}
                          >
                            {optionText}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── Mode 3: Matching Pairs ── */}
                {quiz.quizType === 'matching' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      {/* Left Column */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(quiz.pairs || []).map((p, idx) => {
                          const isMatched = Boolean(quiz.userMatches?.[p.leftId]);
                          const isSelecting = quiz.activeLeftMatch === p.leftId;
                          const userMatchedRightId = quiz.userMatches?.[p.leftId];
                          const isPairCorrect = isMatched && userMatchedRightId === p.rightId;
                          const isEvaluated = quiz.status === 'correct' || quiz.status === 'incorrect';

                          let bgColor = 'rgba(30, 41, 59, 0.75)';
                          let borderColor = 'rgba(71, 85, 105, 0.45)';
                          let badgeBg = '#38bdf8';
                          let badgeColor = '#0f172a';
                          let badgeText = `${idx + 1}`;

                          if (isSelecting) {
                            bgColor = 'rgba(56, 189, 248, 0.28)';
                            borderColor = '#38bdf8';
                          } else if (isMatched) {
                            if (isEvaluated) {
                              if (isPairCorrect) {
                                bgColor = 'rgba(16, 185, 129, 0.18)';
                                borderColor = '#10b981';
                                badgeBg = '#10b981';
                                badgeColor = '#0f172a';
                                badgeText = `✓ ${idx + 1}`;
                              } else {
                                bgColor = 'rgba(239, 68, 68, 0.18)';
                                borderColor = '#ef4444';
                                badgeBg = '#ef4444';
                                badgeColor = '#ffffff';
                                badgeText = `✕ ${idx + 1}`;
                              }
                            } else {
                              bgColor = 'rgba(56, 189, 248, 0.16)';
                              borderColor = 'rgba(56, 189, 248, 0.7)';
                              badgeBg = '#38bdf8';
                              badgeColor = '#0f172a';
                              badgeText = `# ${idx + 1}`;
                            }
                          }

                          const lText =
                            p.leftText || (p as any).left || (p as any).term || (p as any).concept || '';

                          return (
                            <button
                              key={p.leftId}
                              disabled={quiz.status === 'correct'}
                              onClick={() => {
                                setQuizzes((prev) =>
                                  prev.map((q) =>
                                    q.id === quiz.id
                                      ? {
                                          ...q,
                                          status: q.status === 'incorrect' ? 'active' : q.status,
                                          aiFeedback: q.status === 'incorrect' ? undefined : q.aiFeedback,
                                          activeLeftMatch: isSelecting ? null : p.leftId,
                                        }
                                      : q
                                  )
                                );
                              }}
                              style={{
                                minHeight: 46,
                                padding: '10px 14px',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 600,
                                textAlign: 'left',
                                cursor: quiz.status === 'correct' ? 'default' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                background: bgColor,
                                border: `1.5px solid ${borderColor}`,
                                color: '#f8fafc',
                                boxSizing: 'border-box',
                                transition: 'background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease',
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  whiteSpace: 'normal',
                                  wordBreak: 'break-word',
                                  lineHeight: 1.4,
                                }}
                              >
                                {lText}
                              </span>
                              {isMatched && (
                                <span
                                  style={{
                                    padding: '2px 7px',
                                    borderRadius: 4,
                                    background: badgeBg,
                                    color: badgeColor,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    flexShrink: 0,
                                    boxShadow: !isPairCorrect && isEvaluated ? '0 0 6px rgba(239, 68, 68, 0.4)' : undefined,
                                  }}
                                >
                                  {badgeText}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Right Column */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(quiz.shuffledRightPairs || quiz.pairs || []).map((p) => {
                          const matchedLeftId = Object.entries(quiz.userMatches || {}).find(
                            ([_, rId]) => rId === p.rightId
                          )?.[0];
                          const isMatched = Boolean(matchedLeftId);
                          const matchedPairIdx = matchedLeftId
                            ? (quiz.pairs || []).findIndex((orig) => orig.leftId === matchedLeftId)
                            : -1;
                          const isPairCorrect = matchedLeftId
                            ? (quiz.pairs || []).find((orig) => orig.leftId === matchedLeftId)?.rightId === p.rightId
                            : false;
                          const isEvaluated = quiz.status === 'correct' || quiz.status === 'incorrect';

                          let rBgColor = 'rgba(30, 41, 59, 0.75)';
                          let rBorderColor = 'rgba(71, 85, 105, 0.45)';
                          let rBadgeBg = '#38bdf8';
                          let rBadgeColor = '#0f172a';
                          let rBadgeText = `${matchedPairIdx + 1}`;

                          if (isMatched) {
                            if (isEvaluated) {
                              if (isPairCorrect) {
                                rBgColor = 'rgba(16, 185, 129, 0.18)';
                                rBorderColor = '#10b981';
                                rBadgeBg = '#10b981';
                                rBadgeColor = '#0f172a';
                                rBadgeText = `✓ ${matchedPairIdx + 1}`;
                              } else {
                                rBgColor = 'rgba(239, 68, 68, 0.18)';
                                rBorderColor = '#ef4444';
                                rBadgeBg = '#ef4444';
                                rBadgeColor = '#ffffff';
                                rBadgeText = `✕ ${matchedPairIdx + 1}`;
                              }
                            } else {
                              rBgColor = 'rgba(56, 189, 248, 0.16)';
                              rBorderColor = 'rgba(56, 189, 248, 0.7)';
                              rBadgeBg = '#38bdf8';
                              rBadgeColor = '#0f172a';
                              rBadgeText = `# ${matchedPairIdx + 1}`;
                            }
                          }

                          const rText =
                            p.rightText ||
                            (p as any).right ||
                            (p as any).definition ||
                            (p as any).desc ||
                            '';

                          return (
                            <button
                              key={p.rightId}
                              disabled={quiz.status === 'correct'}
                              onClick={() => {
                                if (quiz.activeLeftMatch) {
                                  const nextMatches: Record<string, string> = {};
                                  for (const [lId, rId] of Object.entries(quiz.userMatches || {})) {
                                    if (rId !== p.rightId && lId !== quiz.activeLeftMatch) {
                                      nextMatches[lId] = rId;
                                    }
                                  }
                                  nextMatches[quiz.activeLeftMatch] = p.rightId;

                                  setQuizzes((prev) =>
                                    prev.map((q) =>
                                      q.id === quiz.id
                                        ? {
                                            ...q,
                                            userMatches: nextMatches,
                                            activeLeftMatch: null,
                                            status: 'active',
                                            aiFeedback: undefined,
                                          }
                                        : q
                                    )
                                  );
                                  if (Object.keys(nextMatches).length === (quiz.pairs || []).length) {
                                    evaluateAndSubmit(quiz.id, nextMatches, 'click');
                                  }
                                }
                              }}
                              style={{
                                minHeight: 46,
                                padding: '10px 14px',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 500,
                                textAlign: 'left',
                                cursor: quiz.activeLeftMatch ? 'pointer' : 'default',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                background: rBgColor,
                                border: `1.5px solid ${rBorderColor}`,
                                color: '#f8fafc',
                                boxSizing: 'border-box',
                                transition: 'background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease',
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  whiteSpace: 'normal',
                                  wordBreak: 'break-word',
                                  lineHeight: 1.4,
                                }}
                              >
                                {rText}
                              </span>
                              {isMatched && matchedPairIdx >= 0 && (
                                <span
                                  style={{
                                    padding: '2px 7px',
                                    borderRadius: 4,
                                    background: rBadgeBg,
                                    color: rBadgeColor,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    flexShrink: 0,
                                    boxShadow: !isPairCorrect && isEvaluated ? '0 0 6px rgba(239, 68, 68, 0.4)' : undefined,
                                  }}
                                >
                                  {rBadgeText}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {quiz.status !== 'correct' && Object.keys(quiz.userMatches || {}).length > 0 && (
                      <button
                        onClick={() => {
                          setQuizzes((prev) =>
                            prev.map((q) =>
                              q.id === quiz.id
                                ? { ...q, userMatches: {}, activeLeftMatch: null, status: 'active', aiFeedback: undefined }
                                : q
                            )
                          );
                        }}
                        style={{
                          alignSelf: 'flex-start',
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          fontSize: 12,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Reset Matches
                      </button>
                    )}
                  </div>
                )}

                {/* ── Mode 4: Fill in the Blank ── */}
                {quiz.quizType === 'fill_in_the_blank' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 15, color: '#e2e8f0', lineHeight: 1.6 }}>
                      {quiz.blankSentence || quiz.question}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        disabled={quiz.status === 'correct'}
                        placeholder="Type answer or write on whiteboard..."
                        value={quiz.userTextAnswer || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setQuizzes((prev) =>
                            prev.map((q) =>
                              q.id === quiz.id ? { ...q, userTextAnswer: val } : q
                            )
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && quiz.userTextAnswer?.trim()) {
                            evaluateAndSubmit(quiz.id, quiz.userTextAnswer.trim(), 'text');
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: 'rgba(30, 41, 59, 0.8)',
                          border: '1.5px solid rgba(56, 189, 248, 0.4)',
                          color: '#FFFFFF',
                          fontSize: 14,
                          outline: 'none',
                        }}
                      />
                      <button
                        disabled={quiz.status === 'correct' || !quiz.userTextAnswer?.trim()}
                        onClick={() => evaluateAndSubmit(quiz.id, quiz.userTextAnswer?.trim(), 'text')}
                        style={{
                          padding: '0 16px',
                          borderRadius: 8,
                          background: '#38bdf8',
                          border: 'none',
                          color: '#0f172a',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        Check Answer
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Mode 4.5: Short Answer / Essay Question ── */}
                {quiz.quizType === 'short_answer' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {quiz.blankSentence && (
                      <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.5 }}>
                        {quiz.blankSentence}
                      </div>
                    )}

                    <textarea
                      rows={4}
                      disabled={quiz.status === 'correct' || quiz.status === 'evaluating'}
                      placeholder="Write your explanation here, or speak your answer aloud to your tutor..."
                      value={quiz.userTextAnswer || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQuizzes((prev) =>
                          prev.map((q) =>
                            q.id === quiz.id ? { ...q, userTextAnswer: val } : q
                          )
                        );
                      }}
                      onKeyDown={(e) => {
                        if (
                          (e.ctrlKey || e.metaKey) &&
                          e.key === 'Enter' &&
                          quiz.userTextAnswer?.trim() &&
                          quiz.status !== 'evaluating'
                        ) {
                          evaluateAndSubmit(quiz.id, quiz.userTextAnswer.trim(), 'text');
                        }
                      }}
                      style={{
                        width: '100%',
                        minHeight: 110,
                        maxHeight: 220,
                        padding: '12px 14px',
                        borderRadius: 10,
                        background: 'rgba(30, 41, 59, 0.85)',
                        border: '1.5px solid rgba(56, 189, 248, 0.45)',
                        color: '#FFFFFF',
                        fontSize: 14,
                        lineHeight: 1.5,
                        fontFamily: "'Inter', sans-serif",
                        outline: 'none',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span>🎙️</span>
                        <span>Or answer verbally by speaking aloud</span>
                      </span>

                      <button
                        disabled={
                          quiz.status === 'correct' ||
                          quiz.status === 'evaluating' ||
                          !quiz.userTextAnswer?.trim()
                        }
                        onClick={() => evaluateAndSubmit(quiz.id, quiz.userTextAnswer?.trim(), 'text')}
                        style={{
                          padding: '9px 20px',
                          borderRadius: 8,
                          background:
                            quiz.status === 'evaluating'
                              ? 'rgba(56, 189, 248, 0.4)'
                              : quiz.userTextAnswer?.trim()
                              ? '#38bdf8'
                              : 'rgba(56, 189, 248, 0.3)',
                          border: 'none',
                          color: '#0f172a',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor:
                            quiz.status === 'evaluating' || !quiz.userTextAnswer?.trim()
                              ? 'not-allowed'
                              : 'pointer',
                          transition: 'background-color 0.18s ease',
                        }}
                      >
                        {quiz.status === 'evaluating' ? 'Evaluating...' : 'Submit Answer'}
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Mode 5: Ordering / Step Sequencing ── */}
                {quiz.quizType === 'ordering' && (() => {
                  const displayOrdering = (quiz.userOrdering && quiz.userOrdering.length > 0)
                    ? quiz.userOrdering
                    : (quiz.options || []).map((o) => o.id);

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {displayOrdering.map((optId, idx) => {
                        const opt = (quiz.options || []).find((o) => o.id === optId);
                        if (!opt) return null;

                        const correctOrder = [...(quiz.options || [])]
                          .sort((a, b) => Number((a as any).order ?? 0) - Number((b as any).order ?? 0))
                          .map((o) => o.id);
                        const isEvaluated = quiz.status === 'correct' || quiz.status === 'incorrect';
                        const isStepCorrect = correctOrder.length > 0 && correctOrder[idx] === optId;

                        let stepBorder = '1px solid rgba(71, 85, 105, 0.45)';
                        let stepBg = 'rgba(30, 41, 59, 0.7)';
                        let circleBg = '#38bdf8';
                        let circleColor = '#0f172a';

                        if (isEvaluated) {
                          if (isStepCorrect) {
                            stepBorder = '1.5px solid #10b981';
                            stepBg = 'rgba(16, 185, 129, 0.14)';
                            circleBg = '#10b981';
                            circleColor = '#0f172a';
                          } else {
                            stepBorder = '1.5px solid #ef4444';
                            stepBg = 'rgba(239, 68, 68, 0.14)';
                            circleBg = '#ef4444';
                            circleColor = '#ffffff';
                          }
                        }

                        return (
                          <div
                            key={optId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 12px',
                              borderRadius: 8,
                              background: stepBg,
                              border: stepBorder,
                              transition: 'all 0.18s ease',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span
                                style={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: 11,
                                  background: circleBg,
                                  color: circleColor,
                                  fontWeight: 800,
                                  fontSize: 12,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                {idx + 1}
                              </span>
                              <span style={{ fontSize: 13, color: '#f1f5f9' }}>{opt.text}</span>
                            </div>

                            {quiz.status !== 'correct' && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  disabled={idx === 0}
                                  onClick={() => {
                                    const currentOrder = [...displayOrdering];
                                    const temp = currentOrder[idx - 1];
                                    currentOrder[idx - 1] = currentOrder[idx];
                                    currentOrder[idx] = temp;
                                    setQuizzes((prev) =>
                                      prev.map((q) =>
                                        q.id === quiz.id
                                          ? {
                                              ...q,
                                              userOrdering: currentOrder,
                                              status: q.status === 'incorrect' ? 'active' : q.status,
                                              aiFeedback: q.status === 'incorrect' ? undefined : q.aiFeedback,
                                            }
                                          : q
                                      )
                                    );
                                  }}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    border: 'none',
                                    color: '#cbd5e1',
                                    borderRadius: 4,
                                    cursor: idx === 0 ? 'default' : 'pointer',
                                    padding: '2px 6px',
                                  }}
                                >
                                  ▲
                                </button>
                                <button
                                  disabled={idx === displayOrdering.length - 1}
                                  onClick={() => {
                                    const currentOrder = [...displayOrdering];
                                    const temp = currentOrder[idx + 1];
                                    currentOrder[idx + 1] = currentOrder[idx];
                                    currentOrder[idx] = temp;
                                    setQuizzes((prev) =>
                                      prev.map((q) =>
                                        q.id === quiz.id
                                          ? {
                                              ...q,
                                              userOrdering: currentOrder,
                                              status: q.status === 'incorrect' ? 'active' : q.status,
                                              aiFeedback: q.status === 'incorrect' ? undefined : q.aiFeedback,
                                            }
                                          : q
                                      )
                                    );
                                  }}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    border: 'none',
                                    color: '#cbd5e1',
                                    borderRadius: 4,
                                    cursor:
                                      idx === displayOrdering.length - 1
                                        ? 'default'
                                        : 'pointer',
                                    padding: '2px 6px',
                                  }}
                                >
                                  ▼
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {quiz.status !== 'correct' && (
                        <button
                          onClick={() => evaluateAndSubmit(quiz.id, displayOrdering, 'click')}
                          style={{
                            marginTop: 6,
                            padding: '10px',
                            borderRadius: 8,
                            background: '#38bdf8',
                            border: 'none',
                            color: '#0f172a',
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                        >
                          Verify Sequence
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* ── Evaluating Indicator ── */}
                {quiz.status === 'evaluating' && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid #38bdf8',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      color: '#e0f2fe',
                    }}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        border: '2px solid rgba(56, 189, 248, 0.3)',
                        borderTopColor: '#38bdf8',
                        borderRadius: '50%',
                        animation: 'zyrenSpin 1s linear infinite',
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      Evaluating your explanation with AI Tutor...
                    </span>
                  </div>
                )}

                {/* ── Feedback & Pedagogical Explanation Panel ── */}
                {isFinished && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: '12px 14px',
                      borderRadius: 10,
                      background:
                        quiz.status === 'correct'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(239, 68, 68, 0.15)',
                      border: `1px solid ${
                        quiz.status === 'correct' ? '#10b981' : '#ef4444'
                      }`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 16 }}>
                        {quiz.status === 'correct' ? '🎉' : '💡'}
                      </span>
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: quiz.status === 'correct' ? '#34d399' : '#f87171',
                        }}
                      >
                        {quiz.status === 'correct'
                          ? 'Correct! Well done.'
                          : 'Incorrect. Try again or ask your tutor.'}
                      </span>
                    </div>

                    {(quiz.aiFeedback || quiz.explanation) && (
                      <div
                        style={{
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: '#e2e8f0',
                          fontFamily: "'Inter', sans-serif",
                        }}
                      >
                        {quiz.aiFeedback &&
                        quiz.aiFeedback !== 'Correct! Well done.' &&
                        quiz.aiFeedback !== 'Incorrect. Try again or ask your tutor.'
                          ? quiz.aiFeedback
                          : quiz.explanation}
                      </div>
                    )}

                    {quiz.status === 'incorrect' && (
                      <button
                        onClick={() => {
                          setQuizzes((prev) =>
                            prev.map((q) =>
                              q.id === quiz.id
                                ? {
                                    ...q,
                                    status: 'active',
                                    selectedOptionId: undefined,
                                    aiFeedback: undefined,
                                  }
                                : q
                            )
                          );
                        }}
                        style={{
                          alignSelf: 'flex-start',
                          marginTop: 4,
                          background: 'rgba(255, 255, 255, 0.12)',
                          border: 'none',
                          color: '#FFFFFF',
                          padding: '5px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Try Again
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);
