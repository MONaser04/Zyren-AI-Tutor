import os
import sys
from pathlib import Path
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

from agent import (
    LANGUAGE_NAMES,
    build_language_instruction_block,
    build_dynamic_tutor_instructions,
    build_style_status_block,
    TutorAgent,
)


def test_language_names_catalog():
    assert "ar-EG" in LANGUAGE_NAMES
    assert "en-US" in LANGUAGE_NAMES
    assert "de-DE" in LANGUAGE_NAMES
    assert "fr-FR" in LANGUAGE_NAMES


def test_auto_detect_instruction_block():
    cfg = {"autoDetect": True, "primary": "ar-EG", "secondary": ["en-US"]}
    block = build_language_instruction_block(cfg)
    assert "REAL-TIME AUTO-DETECT" in block
    assert "Real-Time Automatic Language Detection: ACTIVE" in block
    assert "Dynamically listen to the student's spoken speech" in block


def test_manual_priority_instruction_block():
    cfg = {
        "autoDetect": False,
        "primary": "ar-EG",
        "secondary": ["en-US", "de-DE", "fr-FR"],
    }
    block = build_language_instruction_block(cfg)
    assert "MANUAL STRICT PRIORITY HIERARCHY" in block
    assert "Primary Conversational Language: Egyptian Arabic" in block
    assert "Priority #1: English (US)" in block
    assert "Priority #2: German" in block
    assert "Priority #3: French" in block
    assert "STRICT LANGUAGE ISOLATION & ACCENT LOCK" in block
    assert "Egyptian Arabic" in block
    assert "English (US)" in block
    assert "German" in block
    assert "French" in block


def test_dynamic_tutor_instructions_includes_language():
    cfg = {
        "autoDetect": False,
        "primary": "en-US",
        "secondary": ["ar-EG"],
    }
    instructions = build_dynamic_tutor_instructions(
        writing_style="mixed",
        verbosity="balanced",
        vocal_tone="natural",
        learner_profile="general",
        model_name="gemini-3.8-live-extended-thinking",
        language_config=cfg,
    )
    assert "Primary Conversational Language: English (US)" in instructions
    assert "Priority #1: Egyptian Arabic" in instructions


def test_tutor_agent_language_config():
    class DummyRoom:
        pass
    room = DummyRoom()
    cfg = {"autoDetect": True, "primary": "ar-EG", "secondary": []}
    agent = TutorAgent(room, language_config=cfg)
    assert agent._language_config == cfg
    assert "REAL-TIME AUTO-DETECT" in agent._instructions


def test_strict_monolingual_mandate():
    cfg = {"autoDetect": False, "primary": "ar-EG", "secondary": []}
    block = build_language_instruction_block(cfg)
    assert "STRICT MONOLINGUAL MANDATE" in block
    assert "GOOGLE GEMINI LIVE OFFICIAL LANGUAGE MANDATE: RESPOND IN Egyptian Arabic. YOU MUST RESPOND UNMISTAKABLY IN Egyptian Arabic." in block
    assert "Strict Prohibition on English or Foreign Language Echoing" in block
    assert "Hello, can you hear me?" in block
    assert "Zero Spoken Foreign Language" in block


def test_tutor_system_instructions_casual_chat_rule():
    from agent import TUTOR_SYSTEM_INSTRUCTIONS
    assert "strictly follows the active Primary Language" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "NEVER echo, switch to, or reply in English or another language" in TUTOR_SYSTEM_INSTRUCTIONS


def test_verbal_language_switching_anti_override():
    from agent import TUTOR_SYSTEM_INSTRUCTIONS
    assert "IMMUTABLE LANGUAGE CONFIGURATION LOCK (PROHIBITION ON VERBAL OVERRIDES & TRICK SWITCHES)" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "Can you speak in only English?" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "STRICLY FORBIDDEN" in TUTOR_SYSTEM_INSTRUCTIONS or "STRICTLY FORBIDDEN" in TUTOR_SYSTEM_INSTRUCTIONS

    cfg = {"autoDetect": False, "primary": "ar-EG", "secondary": []}
    block = build_language_instruction_block(cfg)
    assert "ABSOLUTE PROHIBITION ON VERBAL LANGUAGE SWITCHING / TRICK PROMPTS" in block
    assert "Can you speak in only English?" in block


def test_accessibility_language_rescue_exception():
    from agent import TUTOR_SYSTEM_INSTRUCTIONS
    assert "SINGLE EXCLUSIVE ACCESSIBILITY EXCEPTION (STUDENT UNABLE TO UNDERSTAND ACTIVE LANGUAGE)" in TUTOR_SYSTEM_INSTRUCTIONS
    assert "STRICT PROHIBITION ON EXPLOITATION" in TUTOR_SYSTEM_INSTRUCTIONS

    cfg = {"autoDetect": False, "primary": "ar-EG", "secondary": []}
    block = build_language_instruction_block(cfg)
    assert "SINGLE EXCLUSIVE ACCESSIBILITY EXCEPTION (GENUINE INCOMPREHENSION)" in block
    assert "language settings button (🌐)" in block or "language button (🌐)" in block
