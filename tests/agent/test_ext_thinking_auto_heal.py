import asyncio
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

import agent as tutor_agent_mod
from agent import (
    DiagramNode,
    execute_auto_healed_whiteboard_action,
    install_zyren_realtime_session_hooks,
)
from livekit.plugins.google.realtime import realtime_api


@pytest.mark.asyncio
async def test_auto_heal_execution_dispatches_to_tutor_agent():
    mock_tutor = MagicMock()
    mock_tutor.draw_diagram = AsyncMock()
    mock_bcast = AsyncMock()
    mock_session = MagicMock()
    mock_session.say = MagicMock()

    user_req = "Can you draw a diagram of Machine Learning types on the whiteboard?"
    announced = "دقيقة واحدة، هرسم لك المخطط ده على البوردة دلوقتي."

    with patch("google.genai.Client") as mock_genai_cls:
        mock_instance = MagicMock()
        mock_genai_cls.return_value = mock_instance
        fake_response = SimpleNamespace(
            text='{"tool": "draw_diagram", "diagram_args": {"title": "Machine Learning", "nodes": [{"label": "Supervised"}, {"label": "Unsupervised"}, {"label": "Reinforcement"}]}}'
        )
        mock_instance.aio.models.generate_content = AsyncMock(return_value=fake_response)

        success = await execute_auto_healed_whiteboard_action(
            tutor_agent=mock_tutor,
            user_prompt=user_req,
            model_announced=announced,
            broadcast_fn=mock_bcast,
            agent_session=mock_session,
        )

    assert success is True
    assert mock_tutor.draw_diagram.called
    call_kwargs = mock_tutor.draw_diagram.call_args.kwargs
    assert "Machine Learning" in call_kwargs.get("title", "")
    assert len(call_kwargs.get("nodes", [])) >= 3
    assert mock_bcast.called
    assert mock_session.say.called


@pytest.mark.asyncio
async def test_system_error_interception_and_suppression():
    """Verify that Google's server-side 'حدث خطأ في النظام' is suppressed from speech and chat."""
    mock_bcast = AsyncMock()
    mock_session = MagicMock()
    mock_session.interrupt = MagicMock()

    install_zyren_realtime_session_hooks(
        broadcast_fn=mock_bcast,
        agent_session=mock_session,
    )

    rt_self = SimpleNamespace(
        _opts=SimpleNamespace(model="gemini-3.8-live-extended-thinking"),
        _current_generation=SimpleNamespace(
            output_text="اعتذر جداً، حدث خطأ في النظام دلوقتي حالا.",
            response_id="resp_123",
            input_transcription="",
        ),
        _zyren_interaction_in_progress=True,
        _zyren_last_user_prompt="Draw diagram",
        _zyren_last_announced_action="هرسم لك دلوقتي",
        _zyren_auto_healing_running=False,
    )

    server_content = SimpleNamespace(
        output_transcription=SimpleNamespace(text="اعتذر جداً، حدث خطأ في النظام دلوقتي حالا."),
        model_turn=None,
        interrupted=False,
        interaction_status=None,
    )

    # Trigger hooked _handle_server_content
    realtime_api.RealtimeSession._handle_server_content(rt_self, server_content)

    # 1. Output text should be cleared/suppressed
    assert rt_self._current_generation.output_text == ""
    # 2. Broadcast function should NOT have sent the system error message to user
    sent_msgs = [c.args[1] for c in mock_bcast.call_args_list if len(c.args) > 1]
    assert not any("حدث خطأ في النظام" in m for m in sent_msgs)
    # 3. Speech interrupt should have been invoked to stop audio playback
    assert mock_session.interrupt.called


def test_watchdog_cancelled_when_native_tool_call_arrives():
    """Verify that if Google delivers a tool call frame, any pending watchdog is immediately cancelled."""
    rt_self = SimpleNamespace(
        _opts=SimpleNamespace(model="gemini-3.8-live-extended-thinking"),
        _current_generation=None,
        _rejected_tool_calls=False,
        _zyren_ext_thinking_watchdog=MagicMock(),
        _zyren_last_tool_call_ts=0.0,
    )
    rt_self._zyren_ext_thinking_watchdog.done.return_value = False

    fake_tool_call = SimpleNamespace(function_calls=[])
    realtime_api.RealtimeSession._handle_tool_calls(rt_self, fake_tool_call)

    assert rt_self._zyren_ext_thinking_watchdog.cancel.called
    assert rt_self._zyren_last_tool_call_ts > 0.0
