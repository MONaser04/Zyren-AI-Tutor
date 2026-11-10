import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "agent"))
sys.path.insert(0, str(PROJECT_ROOT))

import config_store
from executive_model import (
    ExecutiveModelDispatcher,
    normalize_thinking_parameters,
)


def test_intermediate_model_config_defaults_and_toggle(tmp_path, monkeypatch):
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("ZYREN_APPDATA_DIR", str(appdata))

    # 1. Default should be disabled
    cfg = config_store.get_intermediate_model_config()
    assert cfg["enabled"] is False
    assert cfg["providerId"] == "nvidia_nim"
    assert "nemotron" in cfg["modelId"]

    # 2. Update config
    config_store.write_app_config_atomic(
        {
            "intermediateModel": {
                "enabled": True,
                "providerId": "openrouter",
                "modelId": "deepseek/deepseek-r1",
                "thinkingLevel": "high",
                "customBaseUrl": "https://custom.router/v1",
            }
        }
    )

    updated = config_store.get_intermediate_model_config()
    assert updated["enabled"] is True
    assert updated["providerId"] == "openrouter"
    assert updated["modelId"] == "deepseek/deepseek-r1"
    assert updated["thinkingLevel"] == "high"
    assert updated["customBaseUrl"] == "https://custom.router/v1"


def test_provider_credentials_resolution(tmp_path, monkeypatch):
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("ZYREN_APPDATA_DIR", str(appdata))
    monkeypatch.setenv("GROQ_API_KEY", "gsk_env_key_12345")

    # 1. Groq key from environment
    groq_creds = config_store.get_provider_credentials("groq")
    assert groq_creds["configured"] is True
    assert groq_creds["apiKey"] == "gsk_env_key_12345"
    assert "api.groq.com" in groq_creds["baseUrl"]

    # 2. NVIDIA NIM saved via UI in config.json
    config_store.write_app_config_atomic(
        {
            "providers": {
                "nvidia_nim": {
                    "id": "nvidia_nim",
                    "apiKey": "nvapi-ui-saved-secret-777",
                    "baseUrl": "https://integrate.api.nvidia.com/v1",
                    "selectedModel": "nvidia/nemotron-4-340b-instruct",
                    "cachedModels": [{"id": "nvidia/nemotron-4-340b-instruct"}],
                }
            }
        }
    )
    nim_creds = config_store.get_provider_credentials("nvidia_nim")
    assert nim_creds["configured"] is True
    assert nim_creds["apiKey"] == "nvapi-ui-saved-secret-777"
    assert nim_creds["selectedModel"] == "nvidia/nemotron-4-340b-instruct"
    assert len(nim_creds["cachedModels"]) == 1


def test_normalize_thinking_parameters():
    # OpenAI / Azure
    oai = normalize_thinking_parameters("openai", "o3-mini", "high")
    assert oai.get("reasoning_effort") == "high"

    # Anthropic budget
    anthropic = normalize_thinking_parameters("openrouter", "anthropic/claude-3.7-sonnet", "medium")
    assert anthropic.get("thinking", {}).get("type") == "enabled"
    assert anthropic.get("thinking", {}).get("budget_tokens") == 4096

    # Groq format
    groq = normalize_thinking_parameters("groq", "deepseek-r1-distill", "low")
    assert groq.get("reasoning_format") == "parsed"

    # Off mode
    off = normalize_thinking_parameters("openai", "o1", "off")
    assert off == {}


def test_json_action_extraction():
    dispatcher = ExecutiveModelDispatcher(tutor_agent=MagicMock())

    # Raw markdown block
    markdown_reply = """Here is the surgical update for your whiteboard:
```json
{
  "thought": "Update the root node label in-place without redrawing.",
  "action": "update_whiteboard_item",
  "parameters": {
    "target": "Machine Learning",
    "new_label": "Machine Learning Types"
  }
}
```
"""
    extracted = dispatcher._extract_json_action(markdown_reply)
    assert extracted is not None
    assert extracted["action"] == "update_whiteboard_item"
    assert extracted["parameters"]["new_label"] == "Machine Learning Types"


@pytest.mark.asyncio
async def test_executive_model_dispatch_to_tutor_agent():
    mock_tutor = MagicMock()
    mock_tutor.update_whiteboard_item = AsyncMock(return_value="Updated item")
    mock_tutor._wait_for_board_sync_and_audit = AsyncMock(return_value="Synced")
    mock_tutor.board_state = {"currentSlide": {"elements": []}}

    dispatcher = ExecutiveModelDispatcher(tutor_agent=mock_tutor)

    res = await dispatcher._dispatch_to_whiteboard(
        action="update_whiteboard_item",
        params={"target": "Machine Learning", "new_label": "Machine Learning Types"},
    )
    assert mock_tutor.update_whiteboard_item.called
    kwargs = mock_tutor.update_whiteboard_item.call_args.kwargs
    assert kwargs["target"] == "Machine Learning"
    assert kwargs["new_label"] == "Machine Learning Types"

    # Test draw_diagram with root_text (Nemotron format)
    mock_tutor.draw_diagram = AsyncMock(return_value="Drawn diagram")
    await dispatcher._dispatch_to_whiteboard(
        action="draw_diagram",
        params={
            "root_text": "Summary: AI for Motion Graphics",
            "position": "right",
            "children": [{"text": "Levels"}, {"text": "Workflow"}],
        },
    )
    assert mock_tutor.draw_diagram.called
    diag_kwargs = mock_tutor.draw_diagram.call_args.kwargs
    assert diag_kwargs["title"] == "Summary: AI for Motion Graphics"
    assert diag_kwargs["root"] == "Summary: AI for Motion Graphics"
    assert diag_kwargs["nodes"] == [{"text": "Levels"}, {"text": "Workflow"}]


@pytest.mark.asyncio
async def test_tutor_agent_tool_auto_interception_when_executive_enabled(monkeypatch, tmp_path):
    import agent as tutor_agent_mod

    appdata = tmp_path / "appdata"
    monkeypatch.setenv("ZYREN_APPDATA_DIR", str(appdata))
    config_store.write_app_config_atomic(
        {
            "intermediateModel": {
                "enabled": True,
                "providerId": "nvidia_nim",
                "modelId": "nvidia/nemotron-3.5-super-vl-120b-a12b",
            }
        }
    )

    mock_room = MagicMock()
    mock_room.local_participant.publish_data = AsyncMock()

    agent = tutor_agent_mod.TutorAgent(room=mock_room)
    assert agent.executive_dispatcher.is_enabled() is True

    # Mock execute_instruction on the dispatcher
    agent.executive_dispatcher.execute_instruction = AsyncMock(
        return_value=(True, "Executed via Nemotron")
    )

    # 1. Calling draw_diagram directly should be intercepted and forwarded
    res_diagram = await agent.draw_diagram(
        title="Types of ML",
        root="Machine Learning",
        nodes=[],
    )
    assert res_diagram == "Executed via Nemotron"
    assert agent.executive_dispatcher.execute_instruction.called
    ins = agent.executive_dispatcher.execute_instruction.call_args[0][0]
    assert "Types of ML" in ins

    # 2. Calling write_math directly should be intercepted and forwarded
    agent.executive_dispatcher.execute_instruction.reset_mock()
    res_math = await agent.write_math(latex="E = mc^2")
    assert res_math == "Executed via Nemotron"
    assert agent.executive_dispatcher.execute_instruction.called
    assert "E = mc^2" in agent.executive_dispatcher.execute_instruction.call_args[0][0]

    # 3. Calling draw_concept_card directly should be intercepted and forwarded
    agent.executive_dispatcher.execute_instruction.reset_mock()
    res_card = await agent.draw_concept_card(
        title="Supervised Learning Example",
        items=["Input: Emails", "Output: Spam or Ham"],
        category="EXAMPLE",
    )
    assert res_card == "Executed via Nemotron"
    assert agent.executive_dispatcher.execute_instruction.called
    assert "Supervised Learning Example" in agent.executive_dispatcher.execute_instruction.call_args[0][0]

    # 4. Inside executive call (_inside_executive_call = True), no recursion should happen
    agent._inside_executive_call = True
    agent.executive_dispatcher.execute_instruction.reset_mock()
    await agent.draw_diagram(title="Direct from Nemotron", root="Root", nodes=[])
    # Should NOT call execute_instruction, should publish data directly to room
    assert not agent.executive_dispatcher.execute_instruction.called
    assert mock_room.local_participant.publish_data.called


@pytest.mark.asyncio
async def test_evaluate_quiz_answer_empty_or_trivial():
    dispatcher = ExecutiveModelDispatcher(tutor_agent=MagicMock())
    res = await dispatcher.evaluate_quiz_answer(
        question="What is the difference between Classification and Regression?",
        expected_answer="Classification predicts discrete classes, regression predicts continuous numerical values.",
        student_answer="  ab ",
    )
    assert res["is_correct"] is False
    assert "Please write" in res["feedback"]


@pytest.mark.asyncio
async def test_evaluate_quiz_answer_catches_satirical_answer(monkeypatch, tmp_path):
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("ZYREN_APPDATA_DIR", str(appdata))
    config_store.write_app_config_atomic(
        {
            "intermediateModel": {
                "enabled": True,
                "providerId": "nvidia_nim",
                "modelId": "nvidia/nemotron-4-340b-instruct",
            },
            "providers": {
                "nvidia_nim": {
                    "apiKey": "nvapi-test-key",
                    "baseUrl": "https://integrate.api.nvidia.com/v1",
                }
            },
        }
    )

    dispatcher = ExecutiveModelDispatcher(tutor_agent=MagicMock())

    # Mock HTTP response from LLM grading
    satirical_llm_json = json.dumps({
        "is_correct": False,
        "feedback": "Kreativer Witz, aber inhaltlich falsch: Klassifikation ordnet Daten diskreten Kategorien zu, während Regression kontinuierliche Zahlenwerte vorhersagt."
    })
    mock_post_resp = MagicMock()
    mock_post_resp.status_code = 200
    mock_post_resp.json.return_value = {
        "choices": [{"message": {"content": satirical_llm_json}}]
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_post_resp)
    dispatcher._get_client = AsyncMock(return_value=mock_client)

    joke_answer = (
        "Bei der Klassifikation teilt die KI alle Datenpunkte in gesellschaftliche Kasten ein (Oberklasse, Mittelklasse). "
        "Bei der Regression erleidet die KI einen psychologischen Rückschritt bis man ihr warme Milch über das Mainboard schüttet."
    )

    res = await dispatcher.evaluate_quiz_answer(
        question="Was ist der Unterschied zwischen Klassifikation und Regression?",
        expected_answer="Klassifikation sagt Kategorien voraus, Regression kontinuierliche Zahlenwerte.",
        student_answer=joke_answer,
        explanation="Klassifikation ordnet Klassen zu, Regression sagt Zahlenwerte vorher.",
    )

    assert res["is_correct"] is False
    assert "Klassifikation" in res["feedback"]
    assert mock_client.post.called


@pytest.mark.asyncio
async def test_evaluate_quiz_answer_accepts_valid_answer(monkeypatch, tmp_path):
    appdata = tmp_path / "appdata"
    monkeypatch.setenv("ZYREN_APPDATA_DIR", str(appdata))
    config_store.write_app_config_atomic(
        {
            "intermediateModel": {
                "enabled": True,
                "providerId": "nvidia_nim",
                "modelId": "nvidia/nemotron-4-340b-instruct",
            },
            "providers": {
                "nvidia_nim": {
                    "apiKey": "nvapi-test-key",
                    "baseUrl": "https://integrate.api.nvidia.com/v1",
                }
            },
        }
    )

    dispatcher = ExecutiveModelDispatcher(tutor_agent=MagicMock())

    valid_llm_json = json.dumps({
        "is_correct": True,
        "feedback": "Hervorragend erklärt! Klassifikation prognostiziert diskrete Klassen und Regression kontinuierliche Werte."
    })
    mock_post_resp = MagicMock()
    mock_post_resp.status_code = 200
    mock_post_resp.json.return_value = {
        "choices": [{"message": {"content": valid_llm_json}}]
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_post_resp)
    dispatcher._get_client = AsyncMock(return_value=mock_client)

    good_answer = "Klassifikation bestimmt Kategorien wie Spam oder Kein-Spam, während Regression Zahlen wie Hauspreise schätzt."

    res = await dispatcher.evaluate_quiz_answer(
        question="Was ist der Unterschied zwischen Klassifikation und Regression?",
        expected_answer="Klassifikation sagt Kategorien voraus, Regression kontinuierliche Zahlenwerte.",
        student_answer=good_answer,
    )

    assert res["is_correct"] is True
    assert "Hervorragend" in res["feedback"]


