import os
import sys
from pathlib import Path

# Add project root and agent directory to sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

from agent import TUTOR_SYSTEM_INSTRUCTIONS, TutorAgent

def test_mlf_instructions():
    print("Testing TUTOR_SYSTEM_INSTRUCTIONS MLF Structure...")
    assert "BILINGUAL CODE-SWITCHING & MULTILINGUAL MATRIX (5 MODES)" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing 5 Modes Matrix"
    assert "Egyptian Arabic + German Context" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Mode 1"
    assert "Egyptian Arabic + English Context (Language School Standard)" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Mode 2"
    assert "English Only" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Mode 3"
    assert "German + English Context" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Mode 4"
    assert "German Only" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Mode 5"
    assert "General Rule for Casual Chat" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Casual Chat Rule"
    assert "Dynamic Academic Whiteboard Language Rule" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Dynamic Whiteboard rule"
    assert "Frustration Escape Hatch" in TUTOR_SYSTEM_INSTRUCTIONS, "Missing Frustration Escape Hatch"
    print("Pure Linguistic Principle Multilingual Matrix assertions PASSED successfully!")

if __name__ == "__main__":
    test_mlf_instructions()
