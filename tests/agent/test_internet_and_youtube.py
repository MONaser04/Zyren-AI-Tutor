import json
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from livekit import rtc
try:
    from agent import TutorAgent
    from internet_service import (
        extract_youtube_video_id,
        is_youtube_url,
        search_web_text,
        search_web_images,
    )
except ImportError:
    from agent.agent import TutorAgent
    from agent.internet_service import (
        extract_youtube_video_id,
        is_youtube_url,
        search_web_text,
        search_web_images,
    )
try:
    from executive_model import ExecutiveModelDispatcher
except ImportError:
    from agent.executive_model import ExecutiveModelDispatcher


def test_extract_youtube_video_id():
    assert extract_youtube_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_video_id("https://example.com/not-youtube") is None
    assert is_youtube_url("https://youtu.be/dQw4w9WgXcQ") is True
    assert is_youtube_url("https://example.com") is False


@pytest.mark.asyncio
async def test_search_the_web_tool_respects_internet_toggle():
    mock_room = MagicMock(spec=rtc.Room)
    mock_participant = MagicMock()
    mock_participant.publish_data = AsyncMock()
    mock_room.local_participant = mock_participant

    agent = TutorAgent(room=mock_room)
    agent.internet_access_enabled = False

    res = await agent.search_the_web(query="Artificial Intelligence")
    assert "disabled" in res.lower()

    agent.internet_access_enabled = True
    with patch("agent.internet_service.search_web_text") as mock_search:
        mock_search.return_value = [
            {"title": "AI Overview", "snippet": "Artificial Intelligence is...", "url": "https://ai.example.com"}
        ]
        active_res = await agent.search_the_web(query="Artificial Intelligence")
        assert "AI Overview" in active_res
        assert "https://ai.example.com" in active_res


@pytest.mark.asyncio
async def test_search_and_display_web_image_publishes_shape():
    mock_room = MagicMock(spec=rtc.Room)
    mock_participant = MagicMock()
    mock_participant.publish_data = AsyncMock()
    mock_room.local_participant = mock_participant

    agent = TutorAgent(room=mock_room)
    agent.internet_access_enabled = True

    with patch("agent.internet_service.search_web_images") as mock_imgs:
        mock_imgs.return_value = [
            {
                "title": "Plant Cell Diagram",
                "image_url": "https://images.example.com/cell.jpg",
                "thumbnail": "https://images.example.com/cell_thumb.jpg",
                "width": 800,
                "height": 600,
            }
        ]
        res = await agent.search_and_display_web_image(query="Plant Cell", caption="Cell Anatomy")
        assert "Successfully displayed" in res
        mock_participant.publish_data.assert_called_once()
        sent_bytes = mock_participant.publish_data.call_args[0][0]
        sent_json = json.loads(sent_bytes.decode("utf-8"))
        assert sent_json["type"] == "shape"
        assert sent_json["payload"]["shapeType"] == "image"
        assert sent_json["payload"]["options"]["url"] == "https://images.example.com/cell.jpg"
        assert sent_json["payload"]["options"]["label"] == "Cell Anatomy"


@pytest.mark.asyncio
async def test_display_youtube_video_publishes_shape():
    mock_room = MagicMock(spec=rtc.Room)
    mock_participant = MagicMock()
    mock_participant.publish_data = AsyncMock()
    mock_room.local_participant = mock_participant

    agent = TutorAgent(room=mock_room)

    res = await agent.display_youtube_video(
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        title="Rick Astley Video"
    )
    assert "Successfully embedded" in res
    mock_participant.publish_data.assert_called_once()
    sent_bytes = mock_participant.publish_data.call_args[0][0]
    sent_json = json.loads(sent_bytes.decode("utf-8"))
    assert sent_json["type"] == "shape"
    assert sent_json["payload"]["shapeType"] == "video"
    assert sent_json["payload"]["options"]["media"]["mimeType"] == "video/youtube"
    assert "dQw4w9WgXcQ" in sent_json["payload"]["options"]["url"]


@pytest.mark.asyncio
async def test_executive_model_dispatches_internet_and_youtube_tools():
    mock_room = MagicMock(spec=rtc.Room)
    mock_participant = MagicMock()
    mock_participant.publish_data = AsyncMock()
    mock_room.local_participant = mock_participant

    agent = TutorAgent(room=mock_room)
    dispatcher = ExecutiveModelDispatcher(tutor_agent=agent)

    # 1. Test dispatch to search_and_display_web_image
    with patch.object(agent, "search_and_display_web_image", new_callable=AsyncMock) as mock_img:
        mock_img.return_value = "Image Placed"
        res = await dispatcher._dispatch_to_whiteboard_impl("search_and_display_web_image", {"query": "Brain", "caption": "Human Brain"})
        assert res == "Image Placed"
        mock_img.assert_called_once_with(query="Brain", caption="Human Brain", position="auto")

    # 2. Test dispatch to display_youtube_video
    with patch.object(agent, "display_youtube_video", new_callable=AsyncMock) as mock_yt:
        mock_yt.return_value = "YouTube Placed"
        res = await dispatcher._dispatch_to_whiteboard_impl("display_youtube_video", {"url": "https://youtu.be/test1234567", "title": "Test Video"})
        assert res == "YouTube Placed"
        mock_yt.assert_called_once_with(url="https://youtu.be/test1234567", title="Test Video", position="auto")

    # 3. Test dispatch to search_the_web
    with patch.object(agent, "search_the_web", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = "Web Results"
        res = await dispatcher._dispatch_to_whiteboard_impl("search_the_web", {"query": "Quantum Computing"})
        assert res == "Web Results"
        mock_search.assert_called_once_with(query="Quantum Computing")


@pytest.mark.asyncio
async def test_analyze_youtube_video_content_fast_and_factual():
    try:
        from internet_service import analyze_youtube_video_content
        meta_target = "internet_service.get_youtube_video_meta"
        trans_target = "internet_service.get_youtube_transcript_text"
    except ImportError:
        from agent.internet_service import analyze_youtube_video_content
        meta_target = "agent.internet_service.get_youtube_video_meta"
        trans_target = "agent.internet_service.get_youtube_transcript_text"

    with patch(meta_target) as mock_meta, \
         patch(trans_target) as mock_trans:
        mock_meta.return_value = {
            "title": "Claude Opus 5.5: How To Make Motion Graphics",
            "author": "Rourke",
        }
        mock_trans.return_value = {
            "success": True,
            "transcript": "[00:10] Claude can now make motion graphics videos with Spotify branding.",
        }

        res = await analyze_youtube_video_content("https://youtu.be/cDb-wPq0Iyk")
        assert "Claude Opus 5.5: How To Make Motion Graphics" in res
        assert "Rourke" in res
        assert "Spotify branding" in res
        assert "INSTRUCTION" in res
