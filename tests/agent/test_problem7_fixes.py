import asyncio
import inspect
import sys
import time
from pathlib import Path

import pytest
from google.genai import _live_converters, types

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

import agent as tutor_agent_mod
from agent import (
    TUTOR_SYSTEM_INSTRUCTIONS,
    UserTurnTranscriptAccumulator,
    build_dynamic_tutor_instructions,
)
from livekit.plugins.google.realtime import realtime_api


def test_subproblem1_explicit_arabic_translation_override_and_whiteboard_safety():
    """Verify explicit student Arabic translation override exists without breaking whiteboard Latin-only rendering."""
    assert "EXPLICIT STUDENT TRANSLATION & LANGUAGE OVERRIDE AUTHORITY" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "immediately, smoothly, and directly state the accurate Arabic translation" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "NEVER mention, cite, or blame internal instructions, system rules, prompts, agreements, or 'policies'" in TUTOR_SYSTEM_INSTRUCTIONS

    # Ensure legacy un-overridable phrasings are removed
    assert "without ever translating into Arabic" not in TUTOR_SYSTEM_INSTRUCTIONS
    assert "rather than reverting to Arabic descriptions" not in TUTOR_SYSTEM_INSTRUCTIONS

    # Ensure whiteboard canvas remains strictly Latin-script (German/English) to prevent font glyph corruption
    assert "Absolutely zero Arabic script on the whiteboard canvas" in TUTOR_SYSTEM_INSTRUCTIONS


def test_subproblem3_german_hochdeutsch_phonology_and_bilingual_purity():
    """Verify strict 2-language isolation in German mode and explicit Hochdeutsch phonological anchoring."""
    assert "STRICT TWO-LANGUAGE ISOLATION" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "Zero English intrusion is allowed in speech or on the whiteboard" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "MANDATORY NATIVE PHONOLOGICAL & LETTER-NAME ARTICULATION RULE" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "Standard High German (Hochdeutsch)" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "[-'tsi:o:n]" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "zum Beispiel" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "geteilt durch" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "a hoch n" in TUTOR_SYSTEM_INSTRUCTIONS


def test_subproblem4_dual_track_first_attempt_explanation_clarity():
    """Verify Dual-Track Known-to-Unknown explanation clarity and bans on circular jargon / grammar dumps."""
    assert "Dual-Track Pedagogical Routing" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "Track A — Vocabulary, Definitions, Sentence Meanings & Document Lines" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "Track B — Exercises, Worked Calculations & Analytical Deductions" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "never define an unknown foreign word using harder or unfamiliar foreign synonyms" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "Personalpronomen" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "Modalverb" in TUTOR_SYSTEM_INSTRUCTIONS

    full_dynamic = build_dynamic_tutor_instructions(
        writing_style="handwriting",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
    )
    assert "### I. BILINGUAL CODE-SWITCHING & MULTILINGUAL MATRIX (5 MODES):" in full_dynamic
    assert "### VI. ACTIVE COMMUNICATION PERSONA" in full_dynamic


def test_subproblem2_live_connect_config_and_source_wiring():
    """Verify upgraded 100k/72k ContextWindowCompression, RealtimeInputConfig mldev serialization, and 30s static heartbeat."""
    src = inspect.getsource(tutor_agent_mod.entrypoint)
    assert "trigger_tokens=100000" in src
    assert "target_tokens=72000" in src
    assert "TURN_INCLUDES_ONLY_ACTIVITY" in src
    assert "prefix_padding_ms=120" in src
    assert "silence_duration_ms=700" in src
    assert "< 30.0:" in src

    cfg = types.LiveConnectConfig(
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                prefix_padding_ms=120,
                silence_duration_ms=700,
            ),
            turn_coverage=types.TurnCoverage.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO,
        ),
        context_window_compression=types.ContextWindowCompressionConfig(
            trigger_tokens=100000,
            sliding_window=types.SlidingWindow(target_tokens=72000),
        ),
    )
    parent: dict = {}
    _live_converters._LiveConnectConfig_to_mldev(None, cfg, parent)
    assert parent["setup"]["contextWindowCompression"].trigger_tokens == 100000
    assert parent["setup"]["contextWindowCompression"].sliding_window.target_tokens == 72000
    assert (
        parent["setup"]["realtimeInputConfig"].turn_coverage
        == types.TurnCoverage.TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO
    )


def test_subproblem2_monotonic_user_turn_transcript_accumulator():
    """Verify multi-segment 5-minute monologues stitch cleanly without losing early segments or duplicating deltas."""
    acc = UserTurnTranscriptAccumulator()

    # Segment 1 streaming deltas (minutes 0:00 - 2:00)
    uid, txt = acc.update_user_segment("GI_seg1", "المشكلة الأولى")
    assert (uid, txt) == ("GI_seg1", "المشكلة الأولى")
    uid, txt = acc.update_user_segment("GI_seg1", "المشكلة الأولى والمشكلة الثانية والثالثة")
    assert (uid, txt) == ("GI_seg1", "المشكلة الأولى والمشكلة الثانية والثالثة")

    # Segment 2 arrives before any assistant reply (e.g. page-flip pause / GoAway flush, minutes 2:00 - 4:00)
    uid, txt = acc.update_user_segment("GI_seg2", "والمشكلة الرابعة")
    assert uid == "GI_seg1"
    assert txt == "المشكلة الأولى والمشكلة الثانية والثالثة والمشكلة الرابعة"

    uid, txt = acc.update_user_segment("GI_seg2", "والمشكلة الرابعة والخامسة والسادسة")
    assert uid == "GI_seg1"
    assert txt == "المشكلة الأولى والمشكلة الثانية والثالثة والمشكلة الرابعة والخامسة والسادسة"

    # Unexpected shorter reset on same segment ID preserves earlier spoken words
    uid, txt = acc.update_user_segment("GI_seg2", "والسابعة")
    assert uid == "GI_seg1"
    assert txt == "المشكلة الأولى والمشكلة الثانية والثالثة والمشكلة الرابعة والخامسة والسادسة والسابعة"

    # Once assistant actually replies, next user turn gets a fresh canonical message ID
    acc.reset_after_assistant_reply()
    uid_next, txt_next = acc.update_user_segment("GI_seg3", "سؤال جديد")
    assert (uid_next, txt_next) == ("GI_seg3", "سؤال جديد")


@pytest.mark.asyncio
async def test_subproblem2_speech_aware_go_away_deferral_and_flush():
    """Verify _handle_go_away defers while user is actively speaking and closes cleanly once speech finishes."""

    class DummyAgentSession:
        user_state = "speaking"

    class DummyRealtimeSession:
        _current_generation = None
        _last_user_activity_ts = time.time()
        _zyren_last_user_speech_ts = time.time()
        _zyren_agent_session_ref = DummyAgentSession()
        _go_away_defer_task = None

        def __init__(self):
            self._session_should_close = asyncio.Event()

            class DummyChan:
                closed = False

            self._msg_ch = DummyChan()
            self.sent_events = []

        def _send_client_event(self, ev):
            self.sent_events.append(ev)

        _is_turn_or_user_speech_active = realtime_api.RealtimeSession._is_turn_or_user_speech_active
        _handle_go_away = realtime_api.RealtimeSession._handle_go_away

    dummy = DummyRealtimeSession()
    dummy._handle_go_away(types.LiveServerGoAway(time_left="50s"))

    # Must NOT close immediately while user is mid-monologue!
    await asyncio.sleep(0.3)
    assert not dummy._session_should_close.is_set()

    # Simulate user finishing speech and cooldown expiring
    dummy._zyren_agent_session_ref.user_state = "listening"
    dummy._last_user_activity_ts = time.time() - 10.0
    dummy._zyren_last_user_speech_ts = time.time() - 10.0

    await asyncio.sleep(0.35)
    assert dummy._session_should_close.is_set()

def test_diagram_node_upward_flow_and_flexible_mixed_style():
    """Verify DiagramNode accepts flow='up' and build_dynamic_tutor_instructions supports dynamic mixed style & simultaneous protocol."""
    from agent import DiagramNode

    node = DiagramNode(label="Step 14: Ascending Loop", flow="up")
    assert node.flow == "up"

    mixed_inst = build_dynamic_tutor_instructions(
        writing_style="mixed",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
    )
    assert "dynamically and pedagogically blend handwriting" in mixed_inst
    assert "Simultaneous Pedagogical Action & Speech Protocol" in mixed_inst
    assert "ZERO VERBAL META-ANNOUNCEMENTS" in mixed_inst


def test_learner_name_dynamic_personalization_without_git_leakage():
    """Verify learner name is dynamically injected into system prompt when provided and completely omitted when empty."""
    # 1. When learner name is provided
    named_inst = build_dynamic_tutor_instructions(
        writing_style="mixed",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
        learner_name="LearnerTestName",
    )
    assert "STUDENT IDENTITY & NATURAL PERSONALIZATION" in named_inst
    assert "LearnerTestName" in named_inst
    assert "Address the student naturally and warmly by their name" in named_inst

    # 2. When learner name is empty string or None (standard git release mode)
    unnamed_inst = build_dynamic_tutor_instructions(
        writing_style="mixed",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
        learner_name="",
    )
    assert "STUDENT IDENTITY & NATURAL PERSONALIZATION" not in unnamed_inst
    assert "LearnerTestName" not in unnamed_inst

    none_inst = build_dynamic_tutor_instructions(
        writing_style="mixed",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
        learner_name=None,
    )
    assert "STUDENT IDENTITY & NATURAL PERSONALIZATION" not in none_inst

def test_tutor_name_dynamic_configuration():
    """Verify tutor name defaults to Zyren and adapts dynamically to custom teacher names."""
    # 1. Default tutor name
    default_inst = build_dynamic_tutor_instructions(
        writing_style="mixed",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
    )
    assert "TUTOR IDENTITY & TEACHER NAME" in default_inst
    assert "Your teacher identity name is 'Zyren'" in default_inst
    assert "You are ZYREN," in default_inst

    # 2. Custom tutor name
    custom_inst = build_dynamic_tutor_instructions(
        writing_style="mixed",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
        tutor_name="Atlas",
    )
    assert "TUTOR IDENTITY & TEACHER NAME" in custom_inst
    assert "Your teacher identity name is 'Atlas'" in custom_inst
    assert "You are ATLAS," in custom_inst


def test_font_size_control_and_handwriting_resizing_instructions_and_tools():
    """Verify font size control and handwriting resizing are explicitly documented in system prompt and tools."""
    # 1. System instructions verify full typography and font size control
    assert "FULL TYPOGRAPHY & FONT SIZE CONTROL" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "NEVER state or claim that handwriting or any other text cannot be resized" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "FULL MULTI-MODAL FONT SIZE RESIZING SUPPORT" in TUTOR_SYSTEM_INSTRUCTIONS

    # 2. write_text signature has font_size
    sig_write = inspect.signature(tutor_agent_mod.TutorAgent.write_text)
    assert "font_size" in sig_write.parameters

    # 3. update_whiteboard_item signature has font_size and accepts new_label
    sig_update = inspect.signature(tutor_agent_mod.TutorAgent.update_whiteboard_item)
    assert "font_size" in sig_update.parameters
    assert "new_label" in sig_update.parameters
