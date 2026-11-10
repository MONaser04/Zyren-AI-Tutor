import json
import pytest
from unittest.mock import MagicMock, AsyncMock
from livekit import rtc
try:
    from agent import TutorAgent
except ImportError:
    from agent.agent import TutorAgent

@pytest.mark.asyncio
async def test_switch_whiteboard_slide_publishes_event():
    mock_room = MagicMock(spec=rtc.Room)
    mock_participant = MagicMock()
    mock_participant.publish_data = AsyncMock()
    mock_room.local_participant = mock_participant

    agent = TutorAgent(room=mock_room)
    result = await agent.switch_whiteboard_slide(slide_number=2, target="")
    assert "Slide 2" in result
    mock_participant.publish_data.assert_called_once()
    sent_bytes = mock_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_bytes.decode("utf-8"))
    assert sent_json["type"] == "switch_slide"
    assert sent_json["payload"]["slideNumber"] == 2

@pytest.mark.asyncio
async def test_switch_whiteboard_slide_with_target():
    mock_room = MagicMock(spec=rtc.Room)
    mock_participant = MagicMock()
    mock_participant.publish_data = AsyncMock()
    mock_room.local_participant = mock_participant

    agent = TutorAgent(room=mock_room)
    result = await agent.switch_whiteboard_slide(target="prev")
    assert "prev" in result
    mock_participant.publish_data.assert_called_once()
    sent_bytes = mock_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_bytes.decode("utf-8"))
    assert sent_json["type"] == "switch_slide"
    assert sent_json["payload"]["target"] == "prev"

@pytest.mark.asyncio
async def test_recall_session_memory_vault_search():
    mock_room = MagicMock(spec=rtc.Room)
    agent = TutorAgent(room=mock_room)
    agent.session_context_vault = {
        "sessionTitle": "Machine Learning Fundamentals",
        "allSlides": [
            {
                "pageNumber": 1,
                "title": "Supervised Learning",
                "summary": "Covers linear regression, classification, and labeled training data."
            },
            {
                "pageNumber": 2,
                "title": "Unsupervised Learning",
                "summary": "Covers k-means clustering and dimensionality reduction."
            }
        ],
        "sessionHistoryVault": [
            {
                "sender": "Student",
                "text": "What is the gradient descent learning rate formula?"
            },
            {
                "sender": "Tutor",
                "text": "Gradient descent update rule is theta = theta - alpha * gradient."
            }
        ],
        "sessionOverview": "A comprehensive introductory session on Machine Learning."
    }

    # Search for slide content
    slide_res = await agent.recall_session_memory("clustering")
    assert "Unsupervised Learning" in slide_res
    assert "Slide 2" in slide_res

    # Search for conversational history
    chat_res = await agent.recall_session_memory("learning rate")
    assert "gradient descent" in chat_res.lower()

    # Search fallback
    fallback_res = await agent.recall_session_memory("quantum mechanics")
    assert "No specific mentions" in fallback_res or "Session overview" in fallback_res
