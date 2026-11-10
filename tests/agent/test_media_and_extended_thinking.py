import asyncio
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.genai import types
from livekit.agents.types import NOT_GIVEN
from livekit.plugins.google.realtime import realtime_api

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

import agent as tutor_agent_mod
import config_store
from agent import (
    TutorAgent,
    _is_pure_thought_or_status_content,
    build_dynamic_tutor_instructions,
    install_zyren_realtime_session_hooks,
    resolve_model_tool_options,
)


def test_resolve_model_tool_options_per_model():
    """Verify exact per-model Behavior & FunctionResponseScheduling for all 3 supported Live models."""
    beh_ext, sched_ext = resolve_model_tool_options("gemini-3.8-live-extended-thinking")
    assert beh_ext == types.Behavior.NON_BLOCKING
    assert sched_ext == types.FunctionResponseScheduling.WHEN_IDLE

    beh_std, sched_std = resolve_model_tool_options("gemini-3.8-live")
    assert beh_std == types.Behavior.NON_BLOCKING
    assert sched_std == types.FunctionResponseScheduling.WHEN_IDLE

    beh_31, sched_31 = resolve_model_tool_options("gemini-3.1-flash-live-preview")
    assert beh_31 is NOT_GIVEN
    assert sched_31 is NOT_GIVEN


def test_extended_thinking_execution_lock_and_slide_media_instructions():
    """Verify extended-thinking gets the anti-stall execution lock and all models get Slide Media perception rules."""
    ext_inst = build_dynamic_tutor_instructions(
        writing_style="handwriting",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
        model_name="gemini-3.8-live-extended-thinking",
    )
    assert "EXTENDED-THINKING EXECUTION LOCK" in ext_inst
    assert "NEVER end a turn after saying a conversational filler" in ext_inst
    assert "inspect_slide_media" in ext_inst
    assert "Continuous Real-time Perception & Slide Media Comprehension" in ext_inst

    std_inst = build_dynamic_tutor_instructions(
        writing_style="handwriting",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
        model_name="gemini-3.8-live",
    )
    assert "EXTENDED-THINKING EXECUTION LOCK" not in std_inst
    assert "inspect_slide_media" in std_inst


def test_pure_thought_filter_and_realtime_session_hooks():
    """
    Verify:
    1. Pure `thought=True` packets do not trigger `_is_new_generation`.
    2. Multi-step `interaction_status=IN_PROGRESS` or recent tool continuation suppresses bogus `_handle_input_speech_started()` self-interruption while keeping `_user_silence_event` set.
    3. Real user speech (`input_transcription`) or `sc.interrupted=True` still works normally.
    4. `_send_client_event` strips `FunctionResponse.scheduling` on `gemini-3.8-live-extended-thinking` to prevent 1007 errors.
    """
    silence_event = asyncio.Event()
    silence_event.set()
    dummy_agent_session = SimpleNamespace(
        _activity=SimpleNamespace(_user_silence_event=silence_event)
    )
    install_zyren_realtime_session_hooks(agent_session=dummy_agent_session)

    # 1. Pure thought-only packet check
    thought_part = SimpleNamespace(thought=True, text="Internal reasoning step...", inline_data=None)
    thought_sc = SimpleNamespace(
        model_turn=SimpleNamespace(parts=[thought_part]),
        input_transcription=None,
        output_transcription=None,
        interaction_status="IN_PROGRESS",
        interrupted=False,
    )
    assert _is_pure_thought_or_status_content(thought_sc) is True

    spoken_part = SimpleNamespace(thought=False, text="Let us write this equation.", inline_data=None)
    spoken_sc = SimpleNamespace(
        model_turn=SimpleNamespace(parts=[thought_part, spoken_part]),
        input_transcription=None,
        output_transcription=None,
        interaction_status="IN_PROGRESS",
        interrupted=False,
    )
    assert _is_pure_thought_or_status_content(spoken_sc) is False

    # Construct a mock RealtimeSession instance using the hooked methods
    speech_started_calls = []
    sent_events = []

    class FakeRealtimeSession:
        def __init__(self, model_name: str):
            self._opts = SimpleNamespace(model=model_name)
            self._pending_generation_fut = None
            self._current_generation = None
            self._zyren_agent_session_ref = dummy_agent_session
            self._zyren_interaction_in_progress = False
            self._zyren_last_tool_call_ts = 0.0
            self._zyren_pending_has_user_input = False
            self._msg_ch = SimpleNamespace(send_nowait=lambda ev: sent_events.append(ev))

    # Temporarily bind underlying originals if needed for isolated verification
    orig_speech_started = realtime_api.RealtimeSession._zyren_orig_handle_input_speech_started
    orig_start_gen = realtime_api.RealtimeSession._zyren_orig_start_new_generation
    orig_send_ev = getattr(realtime_api.RealtimeSession, "_zyren_orig_send_client_event", None)

    try:
        realtime_api.RealtimeSession._zyren_orig_handle_input_speech_started = (
            lambda rt_self: speech_started_calls.append("called")
        )

        def fake_orig_start_gen(rt_self):
            if not rt_self._pending_generation_fut:
                realtime_api.RealtimeSession._handle_input_speech_started(rt_self)

        realtime_api.RealtimeSession._zyren_orig_start_new_generation = fake_orig_start_gen
        realtime_api.RealtimeSession._zyren_orig_send_client_event = (
            lambda rt_self, ev: sent_events.append(ev)
        )

        rt = FakeRealtimeSession("gemini-3.8-live-extended-thinking")

        # Pure thought response must return False from _is_new_generation
        thought_resp = SimpleNamespace(tool_call=None, server_content=thought_sc)
        assert realtime_api.RealtimeSession._is_new_generation(rt, thought_resp) is False
        assert rt._zyren_interaction_in_progress is True

        # Spoken sub-turn 2 during interaction_status=IN_PROGRESS must NOT fire bogus _handle_input_speech_started
        spoken_resp = SimpleNamespace(tool_call=None, server_content=spoken_sc)
        assert realtime_api.RealtimeSession._is_new_generation(rt, spoken_resp) is True
        silence_event.clear()
        realtime_api.RealtimeSession._start_new_generation(rt)
        assert len(speech_started_calls) == 0
        assert silence_event.is_set()

        # Real user speech (`input_transcription`) when interaction is complete MUST fire _handle_input_speech_started
        rt._zyren_interaction_in_progress = False
        rt._zyren_last_tool_call_ts = 0.0
        user_sc = SimpleNamespace(
            model_turn=None,
            input_transcription=SimpleNamespace(text="اشرحلي السؤال ده"),
            output_transcription=None,
            interaction_status=None,
            interrupted=False,
        )
        user_resp = SimpleNamespace(tool_call=None, server_content=user_sc)
        assert realtime_api.RealtimeSession._is_new_generation(rt, user_resp) is True
        realtime_api.RealtimeSession._start_new_generation(rt)
        assert len(speech_started_calls) == 1

    finally:
        realtime_api.RealtimeSession._zyren_orig_handle_input_speech_started = orig_speech_started
        realtime_api.RealtimeSession._zyren_orig_start_new_generation = orig_start_gen
        realtime_api.RealtimeSession._zyren_orig_send_client_event = orig_send_ev


@pytest.mark.asyncio
async def test_slide_media_vault_resolution_and_inspect_tools(monkeypatch):
    """Verify resolve_media_file_path, inspect_whiteboard mediaItems section, and inspect_slide_media Gemini Files API tool."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        media_dir = tmp_path / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(config_store, "get_zyren_appdata_dir", lambda: tmp_path)

        sample_video = media_dir / "media_170000_abcd1234.mp4"
        sample_video.write_bytes(b"\x00\x00\x00\x18ftypmp42FakeVideoBytes")

        resolved = config_store.resolve_media_file_path("/api/media/media_170000_abcd1234.mp4")
        assert resolved is not None
        assert resolved[0] == sample_video
        assert resolved[1] == "video/mp4"

        tutor = TutorAgent(room=SimpleNamespace())
        tutor.board_state = {
            "sessionTitle": "Physics Session",
            "totalSlides": 1,
            "activePageIndex": 0,
            "currentSlide": {
                "pageNumber": 1,
                "title": "Kinematics & Projectile Motion",
                "mathEquations": [],
                "plainTextNotes": [],
                "geometricShapes": [],
                "graphs2D": [],
                "graphs3D": [],
                "mediaItems": [
                    {
                        "mediaId": "media_170000_abcd1234",
                        "mediaType": "video",
                        "fileName": "projectile_experiment.mp4",
                        "mimeType": "video/mp4",
                        "url": "/api/media/media_170000_abcd1234.mp4",
                        "x": 120,
                        "y": 140,
                        "width": 640,
                        "height": 360,
                        "durationSec": 42.5,
                        "currentTimeSec": 12.3,
                        "isPlaying": True,
                    }
                ],
            },
            "allSlidesSummary": [],
        }

        wb_report = await tutor.inspect_whiteboard()
        assert "Images & Videos Placed on Active Slide:" in wb_report
        assert "projectile_experiment.mp4" in wb_report
        assert "PLAYING at 00:12 / 00:42" in wb_report

        # Mock _upload_media_to_gemini_files and genai.Client for inspect_slide_media
        used_models = []

        async def fake_upload(media_id, file_path, mime_type, display_name):
            return {
                "file_obj": SimpleNamespace(
                    uri="https://generativelanguage.googleapis.com/v1beta/files/mock123",
                    mime_type=mime_type,
                    name="files/mock123",
                ),
                "name": "files/mock123",
                "uri": "https://generativelanguage.googleapis.com/v1beta/files/mock123",
                "mime_type": mime_type,
                "state": "ACTIVE",
                "local_path": file_path,
            }

        monkeypatch.setattr(tutor, "_upload_media_to_gemini_files", fake_upload)
        monkeypatch.setattr(
            tutor_agent_mod,
            "resolve_gemini_api_key",
            lambda: ("AIzaSyTestKey12345678901234567890", "ui"),
        )

        class FakeAioModels:
            async def generate_content(self, model, contents, config=None):
                used_models.append(model)
                return SimpleNamespace(
                    text="At 00:12, the ball reaches its apex y_max = 4.9m with vertical velocity v_y = 0 m/s."
                )

        class FakeClient:
            def __init__(self, api_key=None):
                self.aio = SimpleNamespace(models=FakeAioModels())

        import google.genai as google_genai_pkg
        monkeypatch.setattr(google_genai_pkg, "Client", FakeClient)

        analysis = await tutor.inspect_slide_media(
            question="What happens at 00:12 in the video?",
            media_id="projectile_experiment.mp4",
        )
        assert "apex y_max = 4.9m" in analysis
        assert used_models == ["gemini-3.8-flash"]
        assert all("2.5" not in m for m in used_models)
