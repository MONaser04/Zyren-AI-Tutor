import inspect
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

from agent import TUTOR_SYSTEM_INSTRUCTIONS, TutorAgent
from executive_model import ExecutiveModelDispatcher


def test_draw_table_system_instructions_present():
    """Verify draw_table tool is documented in TUTOR_SYSTEM_INSTRUCTIONS."""
    assert "draw_table: MANDATORY" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "ABSOLUTE PROHIBITION ON RAW MARKDOWN PIPE TABLES" in TUTOR_SYSTEM_INSTRUCTIONS


def test_draw_table_signature():
    """Verify tool signature for draw_table."""
    sig = inspect.signature(TutorAgent.draw_table)
    params = sig.parameters
    assert "title" in params
    assert "columns" in params
    assert "rows" in params
    assert "slot" in params
    assert "theme" in params


@pytest.mark.asyncio
async def test_draw_table_publishes_valid_table_payload():
    mock_room = MagicMock()
    mock_room.local_participant = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = TutorAgent(room=mock_room)

    columns = ["Framework", "Language", "Performance"]
    rows = [
        ["Actix", "Rust", "[⚡ High]"],
        ["FastAPI", "Python", "[✓ Good]"],
    ]

    result = await agent.draw_table(
        title="Web Frameworks Benchmark",
        columns=columns,
        rows=rows,
        slot="full",
        theme="emerald",
    )

    assert "Web Frameworks Benchmark" in result
    agent._room.local_participant.publish_data.assert_called_once()
    published_bytes = agent._room.local_participant.publish_data.call_args[0][0]
    payload = json.loads(published_bytes.decode("utf-8"))

    assert payload.get("type") == "shape"
    shape_payload = payload.get("payload", {})
    assert shape_payload.get("kind") == "shape"
    assert shape_payload.get("shapeType") == "table"
    assert shape_payload.get("label") == "Web Frameworks Benchmark"

    opts = shape_payload.get("options", {})
    assert opts.get("title") == "Web Frameworks Benchmark"
    assert opts.get("columns") == columns
    assert opts.get("rows") == rows
    assert opts.get("theme") == "emerald"
    assert opts.get("position") == "full"


@pytest.mark.asyncio
async def test_executive_model_dispatches_draw_table():
    mock_agent = MagicMock()
    mock_agent.draw_table = AsyncMock(return_value="Drawn comparison table.")
    dispatcher = ExecutiveModelDispatcher(tutor_agent=mock_agent)

    params = {
        "title": "Search Algorithms",
        "columns": ["Algorithm", "Average Time"],
        "rows": [["Binary Search", "$O(\\log n)$"], ["Linear Search", "$O(n)$"]],
        "slot": "right",
        "theme": "cyan",
    }

    res = await dispatcher._dispatch_to_whiteboard(action="draw_table", params=params)
    assert res == "Drawn comparison table."
    mock_agent.draw_table.assert_called_once_with(
        title="Search Algorithms",
        columns=["Algorithm", "Average Time"],
        rows=[["Binary Search", "$O(\\log n)$"], ["Linear Search", "$O(n)$"]],
        slot="right",
        theme="cyan",
        font_size=16,
        compact=False,
    )
