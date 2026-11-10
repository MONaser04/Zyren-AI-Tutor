import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

try:
    from agent import TutorAgent
    from executive_model import ExecutiveModelDispatcher
except ImportError:
    from agent.agent import TutorAgent
    from agent.executive_model import ExecutiveModelDispatcher


@pytest.mark.asyncio
async def test_control_video_tool_publishes_event():
    mock_room = MagicMock()
    mock_room.local_participant = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)
    agent.board_state = {
        "currentSlide": {
            "mediaItems": [
                {
                    "id": "vid-1",
                    "mediaId": "vid-1",
                    "mediaType": "video",
                    "fileName": "Machine_Learning_Intro.mp4",
                }
            ]
        }
    }

    # 1. Test Play
    res_play = await agent.control_video(action="play", video_id="vid-1")
    assert "Started playing 'Machine_Learning_Intro.mp4'" in res_play

    # Verify data published over LiveKit channel
    assert mock_room.local_participant.publish_data.called
    last_call = mock_room.local_participant.publish_data.call_args[0][0]
    payload = json.loads(last_call.decode("utf-8"))
    assert payload["type"] == "control_video"
    assert payload["payload"]["action"] == "play"
    assert payload["payload"]["video_id"] == "vid-1"

    # 2. Test Volume Control
    res_vol = await agent.control_video(action="set_volume", volume=70)
    assert "Set volume to 70%" in res_vol
    last_call = mock_room.local_participant.publish_data.call_args[0][0]
    payload = json.loads(last_call.decode("utf-8"))
    assert payload["payload"]["action"] == "set_volume"
    assert payload["payload"]["volume"] == 70

    # 3. Test Speed Control
    res_speed = await agent.control_video(action="set_speed", speed=1.5)
    assert "Set playback speed to 1.5x" in res_speed
    last_call = mock_room.local_participant.publish_data.call_args[0][0]
    payload = json.loads(last_call.decode("utf-8"))
    assert payload["payload"]["speed"] == 1.5

    # 4. Test Subtitle Language
    res_sub = await agent.control_video(action="set_subtitle_language", language="ar")
    assert "Set subtitle language to 'ar'" in res_sub
    last_call = mock_room.local_participant.publish_data.call_args[0][0]
    payload = json.loads(last_call.decode("utf-8"))
    assert payload["payload"]["language"] == "ar"

    # 5. Test Dubbing / Audio Language
    res_audio = await agent.control_video(action="set_audio_language", language="de")
    assert "Set audio dubbing language to 'de'" in res_audio
    last_call = mock_room.local_participant.publish_data.call_args[0][0]
    payload = json.loads(last_call.decode("utf-8"))
    assert payload["payload"]["language"] == "de"

    # 6. Test Maximize & Fullscreen
    res_max = await agent.control_video(action="maximize")
    assert "Maximized video player" in res_max
    res_full = await agent.control_video(action="fullscreen")
    assert "fullscreen view" in res_full


@pytest.mark.asyncio
async def test_executive_model_dispatches_control_video():
    mock_agent = MagicMock()
    mock_agent.control_video = AsyncMock(return_value="Dispatched video control")

    dispatcher = ExecutiveModelDispatcher(tutor_agent=mock_agent)
    result = await dispatcher._dispatch_to_whiteboard(
        action="control_video",
        params={
            "action": "pause",
            "video_id": "yt-123",
            "volume": 80,
            "speed": 1.25,
            "language": "en",
        },
    )

    assert result == "Dispatched video control"
    mock_agent.control_video.assert_awaited_once_with(
        action="pause",
        video_id="yt-123",
        volume=80,
        speed=1.25,
        time_sec=None,
        language="en",
        quality=None,
        width=None,
        height=None,
    )
