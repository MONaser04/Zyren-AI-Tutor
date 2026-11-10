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
async def test_visual_audit_missing_frame_fails():
    """Verifies that missing frames strictly fail instead of bypassing."""
    agent = _create_mock_agent()
    agent.latest_whiteboard_frame_bytes = None
    agent._latest_render_snapshot = None

    res = await agent._perform_visual_audit(expected_action="table", expected_title="Test Table")

    assert res["passed"] is False
    assert res["status"] == "FAILED"
    assert "missing_frame_timeout" in res["method"]


@pytest.mark.asyncio
async def test_visual_audit_severe_crowding_squished_diagram_fails():
    """Verifies that diagram nodes crowded into an extremely narrow strip (<140px) fail the spatial check."""
    agent = _create_mock_agent()

    # Create a wide 1280x720 canvas
    arr = np.full((720, 1280, 3), [19, 19, 36], dtype=np.uint8)
    # Cram all drawn elements into a tiny 80px strip on the far right (x from 1100 to 1180)
    arr[300:400, 1100:1180] = [78, 205, 196]

    img = Image.fromarray(arr, "RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")

    agent.latest_whiteboard_frame_bytes = buf.getvalue()
    res = await agent._perform_visual_audit(expected_action="diagram", expected_title="Post-Production Pipeline")

    assert res["passed"] is False
    assert res["status"] == "FAILED"
    assert res["method"] == "spatial_histogram"
    assert "crowding" in res["reason"]


@pytest.mark.asyncio
async def test_visual_audit_active_drawing_fallback():
    """Verifies that an image with substantive well-spaced drawn pixels passes validation."""
    agent = _create_mock_agent()

    # Create a canvas with active drawn white and cyan table cells well spaced across 600px width
    active_arr = np.full((720, 1280, 3), [19, 19, 36], dtype=np.uint8)
    active_arr[200:500, 200:800] = [78, 205, 196]  # Cyan header & cells
    active_arr[250:450, 220:780] = [255, 255, 255]  # White text

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
