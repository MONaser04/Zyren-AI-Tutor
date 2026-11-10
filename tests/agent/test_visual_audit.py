import io
import sys
from pathlib import Path
import pytest
from PIL import Image
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

from unittest.mock import AsyncMock, MagicMock
from agent import TutorAgent


def _create_mock_agent():
    mock_room = MagicMock()
    mock_room.local_participant = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()
    mock_room.remote_participants = {}
    return TutorAgent(room=mock_room)


@pytest.mark.asyncio
async def test_visual_audit_blank_canvas():
    """Verifies that a completely blank/dark canvas is caught and failed by the visual audit."""
    agent = _create_mock_agent()
    
    # Create a blank dark canvas identical to #131324
    blank_arr = np.full((100, 100, 3), [19, 19, 36], dtype=np.uint8)
    img = Image.fromarray(blank_arr, "RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    blank_bytes = buf.getvalue()

    agent.latest_whiteboard_frame_bytes = blank_bytes
    res = await agent._perform_visual_audit(expected_action="table", expected_title="Core ML Types")

    assert res["passed"] is False
    assert res["status"] == "FAILED"
    assert "blank or dark" in res["reason"]


@pytest.mark.asyncio
async def test_visual_audit_active_drawing_fallback():
    """Verifies that an image with substantive drawn pixels passes pixel-variance validation."""
    agent = _create_mock_agent()

    # Create a canvas with active drawn white and cyan table cells
    active_arr = np.full((200, 200, 3), [19, 19, 36], dtype=np.uint8)
    # Draw bright content in the center
    active_arr[50:150, 50:180] = [78, 205, 196]  # Cyan header
    active_arr[100:140, 60:170] = [255, 255, 255]  # White text

    img = Image.fromarray(active_arr, "RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    active_bytes = buf.getvalue()

    agent.latest_whiteboard_frame_bytes = active_bytes
    res = await agent._perform_visual_audit(expected_action="", expected_title="")

    assert res["passed"] is True
    assert res["status"] == "PASSED"
    assert res["method"] == "pixel_variance"


@pytest.mark.asyncio
async def test_wait_for_board_sync_reports_audit_failure_on_blank():
    """Verifies that _wait_for_board_sync_and_audit flags visual failure on blank canvas."""
    agent = _create_mock_agent()

    blank_arr = np.full((100, 100, 3), [19, 19, 36], dtype=np.uint8)
    img = Image.fromarray(blank_arr, "RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    agent.latest_whiteboard_frame_bytes = buf.getvalue()

    feedback = await agent._wait_for_board_sync_and_audit(
        "Drawn comparison table on the whiteboard.",
        expected_action="table",
        expected_title="Test Table",
    )

    assert "Visual Self-Audit: FAILED" in feedback
    assert "DO NOT tell the student this element is visible" in feedback
