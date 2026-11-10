import inspect
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

import agent as tutor_agent_mod
from agent import TUTOR_SYSTEM_INSTRUCTIONS, TutorAgent
from executive_model import ExecutiveModelDispatcher


def test_quiz_system_instructions_present():
    """Verify create_instant_quiz and submit_quiz_answer are documented in TUTOR_SYSTEM_INSTRUCTIONS."""
    assert "create_instant_quiz: MANDATORY" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "submit_quiz_answer" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "multiple_choice" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "matching" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "fill_in_the_blank" in TUTOR_SYSTEM_INSTRUCTIONS


def test_quiz_tool_signatures():
    """Verify tool signatures for create_instant_quiz and submit_quiz_answer."""
    sig_create = inspect.signature(TutorAgent.create_instant_quiz)
    assert "question" in sig_create.parameters
    assert "quiz_type" in sig_create.parameters
    assert "options" in sig_create.parameters
    assert "pairs" in sig_create.parameters
    assert "explanation" in sig_create.parameters

    sig_submit = inspect.signature(TutorAgent.submit_quiz_answer)
    assert "quiz_id" in sig_submit.parameters
    assert "answer" in sig_submit.parameters


@pytest.mark.asyncio
async def test_create_instant_quiz_publishes_shape_payload():
    """Verify create_instant_quiz dispatches shapeType 'quiz' to room data channel."""
    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)
    agent.executive_dispatcher.is_enabled = MagicMock(return_value=False)
    agent._wait_for_board_sync_and_audit = AsyncMock(return_value="Quiz deployed")

    res = await agent.create_instant_quiz(
        question="What is Supervised Learning?",
        quiz_type="multiple_choice",
        options=[
            {"id": "opt-a", "label": "A", "text": "Uses labeled data", "isCorrect": True},
            {"id": "opt-b", "label": "B", "text": "Uses unlabeled data", "isCorrect": False},
        ],
        explanation="Supervised learning maps inputs to outputs using ground-truth labels.",
    )

    assert res == "Quiz deployed"
    assert mock_room.local_participant.publish_data.called

    sent_raw = mock_room.local_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_raw.decode("utf-8"))

    assert sent_json["type"] == "shape"
    payload = sent_json["payload"]
    assert payload["kind"] == "shape"
    assert payload["shapeType"] == "quiz"
    assert payload["options"]["question"] == "What is Supervised Learning?"
    assert payload["options"]["quizType"] == "multiple_choice"
    assert len(payload["options"]["options"]) == 2
    assert payload["options"]["options"][0]["isCorrect"] is True


@pytest.mark.asyncio
async def test_submit_quiz_answer_publishes_event():
    """Verify submit_quiz_answer dispatches quiz_answer to room data channel."""
    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)

    res = await agent.submit_quiz_answer(quiz_id="quiz-12345", answer="opt-a")
    assert "quiz-12345" in res
    assert mock_room.local_participant.publish_data.called

    sent_raw = mock_room.local_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_raw.decode("utf-8"))
    assert sent_json["type"] == "quiz_answer"
    assert sent_json["payload"]["quizId"] == "quiz-12345"
    assert sent_json["payload"]["answer"] == "opt-a"
    assert sent_json["payload"]["mode"] == "voice"


@pytest.mark.asyncio
async def test_executive_model_dispatches_create_instant_quiz():
    """Verify ExecutiveModelDispatcher forwards create_instant_quiz to TutorAgent."""
    mock_tutor = MagicMock()
    mock_tutor.create_instant_quiz = AsyncMock(return_value="Quiz created by executive")

    dispatcher = ExecutiveModelDispatcher(tutor_agent=mock_tutor)

    res = await dispatcher._dispatch_to_whiteboard(
        action="create_instant_quiz",
        params={
            "question": "Choose the correct loss function for binary classification:",
            "quiz_type": "multiple_choice",
            "options": [
                {"id": "a", "label": "A", "text": "Binary Cross Entropy", "isCorrect": True},
                {"id": "b", "label": "B", "text": "Mean Squared Error", "isCorrect": False},
            ],
            "explanation": "Binary Cross Entropy measures divergence between target and predicted probabilities.",
        },
    )

    assert res == "Quiz created by executive"
    assert mock_tutor.create_instant_quiz.called
    kwargs = mock_tutor.create_instant_quiz.call_args.kwargs
    assert "Binary Cross Entropy" in kwargs["options"][0]["text"]


@pytest.mark.asyncio
async def test_create_instant_quiz_auto_normalization_of_options():
    """Verify options with missing text or omitted isCorrect are normalized and repaired."""
    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)
    agent.executive_dispatcher.is_enabled = MagicMock(return_value=False)
    agent._wait_for_board_sync_and_audit = AsyncMock(return_value="Quiz deployed")

    # Options provided in ambiguous format by LLM (label contains text, no isCorrect)
    await agent.create_instant_quiz(
        question="Which type of machine learning uses labeled data to train algorithms?",
        quiz_type="multiple_choice",
        options=[
            {"label": "Supervised Learning", "id": "A"},
            {"id": "B", "label": "Unsupervised Learning"},
            {"label": "Reinforcement Learning", "id": "C"},
        ],
        explanation="Supervised learning uses labeled data where input-output pairs are provided.",
    )

    assert mock_room.local_participant.publish_data.called
    sent_raw = mock_room.local_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_raw.decode("utf-8"))
    opts = sent_json["payload"]["options"]["options"]

    # 1. Option text moved from label to text
    assert opts[0]["text"] == "Supervised Learning"
    assert opts[0]["label"] == "A"
    assert opts[1]["text"] == "Unsupervised Learning"
    assert opts[1]["label"] == "B"

    # 2. isCorrect auto-resolved from explanation
    assert opts[0]["isCorrect"] is True
    assert opts[1]["isCorrect"] is False
    assert opts[2]["isCorrect"] is False


@pytest.mark.asyncio
async def test_create_instant_quiz_matching_pairs_normalization():
    """Verify concept matching pairs in {left, right} format are normalized to {leftText, rightText}."""
    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)
    agent.executive_dispatcher.is_enabled = MagicMock(return_value=False)
    agent._wait_for_board_sync_and_audit = AsyncMock(return_value="Quiz deployed")

    await agent.create_instant_quiz(
        question="Match the following machine learning concepts with their definitions:",
        quiz_type="matching",
        pairs=[
            {"left": "Supervised Learning", "right": "Learns from labeled data."},
            {"term": "Unsupervised Learning", "definition": "Finds patterns in unlabeled data."},
            {"concept": "Overfitting", "desc": "Performs well on train, poorly on test."},
        ],
    )

    assert mock_room.local_participant.publish_data.called
    sent_raw = mock_room.local_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_raw.decode("utf-8"))
    payload = sent_json["payload"]

    assert payload["shapeType"] == "quiz"
    assert payload["width"] == 620.0
    assert payload["height"] == 420.0

    pairs = payload["options"]["pairs"]
    assert len(pairs) == 3
    assert pairs[0]["leftText"] == "Supervised Learning"
    assert pairs[0]["rightText"] == "Learns from labeled data."
    assert pairs[1]["leftText"] == "Unsupervised Learning"
    assert pairs[1]["rightText"] == "Finds patterns in unlabeled data."
    assert pairs[2]["leftText"] == "Overfitting"
    assert pairs[2]["rightText"] == "Performs well on train, poorly on test."


@pytest.mark.asyncio
async def test_retry_quiz_publishes_event():
    """Verify retry_quiz publishes quiz_retry event."""
    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)
    agent.active_quiz_id = "quiz-test-999"

    res = await agent.retry_quiz()
    assert "quiz-test-999" in res
    assert mock_room.local_participant.publish_data.called

    sent_raw = mock_room.local_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_raw.decode("utf-8"))
    assert sent_json["type"] == "quiz_retry"
    assert sent_json["payload"]["quizId"] == "quiz-test-999"


@pytest.mark.asyncio
async def test_create_instant_quiz_true_false_false_is_correct():
    """Verify true_false correctly marks False when correct_answer is 'False' or explanation says false."""
    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)
    agent.executive_dispatcher.is_enabled = MagicMock(return_value=False)
    agent._wait_for_board_sync_and_audit = AsyncMock(return_value="Quiz deployed")

    await agent.create_instant_quiz(
        question="Maschinelles Lernen benötigt immer einen Menschen, der dem System jede einzelne Entscheidung vorgibt.",
        quiz_type="true_false",
        correct_answer="False",
        explanation="Maschinelles Lernen ermöglicht es Systemen, Muster in Daten zu erkennen, ohne dass jede Entscheidung explizit programmiert werden muss.",
    )

    assert mock_room.local_participant.publish_data.called
    sent_raw = mock_room.local_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_raw.decode("utf-8"))
    options = sent_json["payload"]["options"]["options"]

    true_opt = next(o for o in options if o["id"] == "true")
    false_opt = next(o for o in options if o["id"] == "false")

    assert true_opt["isCorrect"] is False
    assert false_opt["isCorrect"] is True


@pytest.mark.asyncio
async def test_create_instant_quiz_fill_in_the_blank_accepted_answers_populated():
    """Verify fill_in_the_blank populates acceptedAnswers from correct_answer and explanation when omitted."""
    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)
    agent.executive_dispatcher.is_enabled = MagicMock(return_value=False)
    agent._wait_for_board_sync_and_audit = AsyncMock(return_value="Quiz deployed")

    await agent.create_instant_quiz(
        question="Vervollständige die Definition!",
        quiz_type="fill_in_the_blank",
        correct_answer="Unüberwachtes",
        blank_sentence="____ Lernen ist eine Art des maschinellen Lernens...",
        explanation="Unüberwachtes Lernen findet Muster in Daten ohne Labels.",
    )

    assert mock_room.local_participant.publish_data.called
    sent_raw = mock_room.local_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_raw.decode("utf-8"))
    payload = sent_json["payload"]["options"]

    assert payload["quizType"] == "fill_in_the_blank"
    assert payload["correctAnswer"] == "Unüberwachtes"
    assert "Unüberwachtes" in payload["acceptedAnswers"]
    assert "unüberwachtes" in payload["acceptedAnswers"]


