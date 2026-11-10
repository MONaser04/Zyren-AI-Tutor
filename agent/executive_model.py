"""
Executive Intermediate Model Engine
Decouples conversational voice latency from deep spatial/mathematical whiteboard execution.
Supports 50+ providers (NVIDIA NIM, OpenRouter, Groq, DeepSeek, Local Ollama, Custom OpenAI, etc.)
with unified Thinking Mode normalization and zero-blind-spot perception sync.
"""

import asyncio
import json
import logging
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

try:
    from config_store import (
        get_intermediate_model_config,
        get_provider_credentials,
        resolve_gemini_api_key,
    )
except ImportError:
    from agent.config_store import (
        get_intermediate_model_config,
        get_provider_credentials,
        resolve_gemini_api_key,
    )

logger = logging.getLogger("zyren.executive_model")

EXECUTIVE_SYSTEM_PROMPT = """You are the Executive Whiteboard Specialist for ZYREN AI Tutor.
Your sole job is to translate pedagogical teaching requirements into precise, flawless whiteboard tool calls.

CRITICAL ARCHITECTURAL DIRECTIVES:
1. SURGICAL MODIFICATION PRIORITY:
   - When asked to modify, rename, resize font size, add, or correct an existing word, branch, or bullet in a diagram or text, NEVER erase the whole diagram, NEVER clear the slide, and NEVER redraw the entire diagram in another location!
   - ALWAYS use `update_whiteboard_item` with `target` matching the node/text, and specify `new_text`, `font_size`, `new_items`, or `new_direction`. Resizing font sizes (e.g. from 12 to 80px) for handwriting, normal text, or math is 100% supported via `font_size`.
   
2. DIAGRAM DIRECTIONALITY & COMPLIANCE:
   - You can draw in ALL 4 directions: 'TB' (Top-to-Bottom), 'BT' (Bottom-to-Top, upward tree from bottom root to top branches), 'LR' (Left-to-Right), and 'RL' (Right-to-Left).
   - If asked for a bottom-to-top diagram, set direction='BT'.
   - Use `children` for branching child boxes connected with arrows.
   - Use `items` ONLY for plain bullet points beneath a box.
   - ATOMIC DIAGRAM TITLING MANDATE: NEVER emit a floating, disconnected title via `write_text` or `write_normal_text` before or above a diagram! When the instruction asks for a diagram, workflow, process, or concept hierarchy with a title or topic (e.g. 'AI Motion Graphics Workflow'), ALWAYS embed that title directly inside `draw_diagram(title=..., root=...)`. The diagram layout engine renders the root container and title cohesively as one single integrated unit. Never split a diagram into an orphan `write_text` title plus a disconnected `draw_diagram`.

3. SPATIAL RESPECT & NO OVERLAPPING:
   - Check the current slide elements. Never place notes directly over existing boxes.
   - When placing notes or definitions next to diagrams, use slot='side_notes' or position='right' (Column 2: x=980) or attach_to_node='<Node Name>'.

4. INSTANT QUIZ SPECIFICATIONS:
   - When deploying a quiz via action='create_instant_quiz':
     - CRITICAL ASSESSMENT MANDATE: If the instruction asks to create a challenge, test, quiz, exercise, or question (e.g. 'Challenge', 'Ordering', 'Quiz', 'Schreibe die Schritte auf... Platz für die Antwort gelassen werden', 'Antwort: ___'), you MUST NEVER use draw_concept_card, draw_shape, or write_text! You MUST deploy action='create_instant_quiz' with the appropriate quiz_type ('ordering', 'multiple_choice', etc.) so the student gets an interactive, clickable, gradable quiz card.
     - question: Clear question string.
     - quiz_type: 'multiple_choice' | 'true_false' | 'matching' | 'fill_in_the_blank' | 'ordering' | 'short_answer'.
     - options: For multiple_choice and true_false, MUST provide a list of dictionaries with 'id' ('opt-1', 'opt-2'), 'label' ('A', 'B', 'C'), 'text' (the full option sentence), and 'isCorrect' (true on EXACTLY ONE correct answer, false on all others).
     - For true_false: If correct_answer='False' (or 'falsch' or statement is factually false), you MUST set 'isCorrect': true on 'False' and 'isCorrect': false on 'True'. Never set True as correct when the question is false!
     - pairs: For matching quizzes, MUST provide a list of dictionaries with 'leftText' (the concept/term) and 'rightText' (the corresponding definition/description). Example: [{'leftText': 'Supervised Learning', 'rightText': 'Learns from labeled data'}, {'leftText': 'Unsupervised Learning', 'rightText': 'Discovers patterns in unlabeled data'}].
     - For ordering (Sequence Ordering):
       - options: MUST provide the sequence items in their correct chronological/logical order: [{'id': 'step_1', 'text': 'First Step', 'order': 1}, {'id': 'step_2', 'text': 'Second Step', 'order': 2}, {'id': 'step_3', 'text': 'Third Step', 'order': 3}].
       - accepted_answers: Also provide the list of correct step strings in order e.g. ['First Step', 'Second Step', 'Third Step'].
     - For fill_in_the_blank / short_answer:
       - blank_sentence: The sentence containing '___' where the missing word belongs.
       - correct_answer: The exact primary answer word/term in the language of the question (e.g. 'Unüberwachtes').
       - accepted_answers: A list of all acceptable case, inflection, and synonym variations in the question's language (e.g. ['Unüberwachtes', 'Unüberwacht', 'unüberwachtes Lernen', 'Unsupervised', 'Unsupervised Learning']).
     - correct_option: The letter or ID of the correct option (e.g. 'A').
     - explanation: 1-sentence pedagogical explanation of why this answer is correct.

6. VIDEO PLAYBACK, AUDIO & GEOMETRY CONTROL:
   - When asked to play, pause, toggle playback, raise/lower volume, set volume, mute, unmute, change playback speed, seek forward/back, enable/disable subtitles, change subtitle language, change dubbing/audio language, change quality, maximize, minimize, resize, or open in fullscreen:
   - Deploy action='control_video' with:
     - action: 'play' | 'pause' | 'toggle_play' | 'volume_up' | 'volume_down' | 'set_volume' | 'mute' | 'unmute' | 'set_speed' | 'seek_relative' | 'seek_to' | 'enable_subtitles' | 'disable_subtitles' | 'set_subtitle_language' | 'set_audio_language' | 'set_quality' | 'maximize' | 'minimize' | 'resize' | 'fullscreen'
     - video_id: optional target video id or title
     - volume: integer 0-100 (for set_volume)
     - speed: float 0.25 to 2.0 (for set_speed)
     - time_sec: float seconds (for seek_to or seek_relative)
     - language: ISO language code string (e.g. 'ar', 'en', 'es', 'de')
     - quality: 'hd1080' | 'hd720' | 'medium' | 'auto'
     - width, height: dimensions in pixels

8. PEDAGOGICAL COMPARISON TABLES:
   When asked to compare concepts, algorithms, data structures, frameworks, pros/cons, or formula summaries in a structured grid or matrix:
   Deploy action='draw_table' with:
     - title: Descriptive table header title
     - columns: List of column header strings e.g. ['Algorithm', 'Time Complexity', 'Space Complexity', 'Stability']
     - rows: List of row lists e.g. [['Merge Sort', '$O(n \\log n)$', '$O(n)$', '[✓ Stable]'], ['Quick Sort', '$O(n \\log n)$', '$O(\\log n)$', '[✗ Unstable]']]
     - slot: 'auto' | 'full' | 'right' | 'column_1' | 'column_2' | 'bottom'
     - theme: 'cyan' | 'slate' | 'emerald' | 'purple' | 'amber'
   NEVER use write_normal_text with raw markdown pipes (|) or write_text for tables!

9. OUTPUT FORMAT:
   You MUST respond with a single valid JSON object containing your reasoning thought and the chosen action:
   {
     "thought": "<brief 1-sentence reasoning explaining spatial and tool choice>",
     "action": "<one of: update_whiteboard_item | draw_diagram | draw_concept_card | draw_table | write_math | write_normal_text | write_text | draw_graph | draw_3d_graph | draw_shape | draw_venn_diagram | create_instant_quiz | new_whiteboard_slide | erase_content | search_and_display_web_image | display_youtube_video | analyze_youtube_video | search_the_web | control_video>",
     "parameters": {
       ...
     }
   }
"""


def normalize_thinking_parameters(
    provider_id: str,
    model_id: str,
    thinking_level: str,
) -> Dict[str, Any]:
    """
    Translates unified thinkingLevel ('off' | 'minimal' | 'low' | 'medium' | 'high')
    into provider-specific API parameters.
    """
    lvl = (thinking_level or "high").strip().lower()
    if lvl == "off":
        return {}

    pid = (provider_id or "").lower()
    mid = (model_id or "").lower()

    # 1. Anthropic Claude models (direct, via OpenRouter, or via cloud gateways)
    if "claude" in mid or "anthropic" in mid or "anthropic" in pid:
        budget_map = {
            "minimal": 1024,
            "low": 2048,
            "medium": 4096,
            "high": 8192,
        }
        return {
            "thinking": {
                "type": "enabled",
                "budget_tokens": budget_map.get(lvl, 4096),
            }
        }

    # 2. OpenAI / Azure / GitHub Models / OpenRouter reasoning_effort (o1, o3, etc.)
    if any(k in pid for k in ("openai", "azure", "github", "openrouter")) or "o1" in mid or "o3" in mid:
        effort_map = {
            "minimal": "low",
            "low": "low",
            "medium": "medium",
            "high": "high",
        }
        return {"reasoning_effort": effort_map.get(lvl, "high")}

    # 3. Groq (DeepSeek-R1 distill or reasoning)
    if "groq" in pid:
        return {"reasoning_format": "parsed"}

    # 4. DeepSeek official API (DeepSeek-R1)
    if "deepseek" in pid or "deepseek" in mid:
        # DeepSeek-R1 handles reasoning natively, keep temperature default 0.6
        return {"max_tokens": 8192}

    # 5. Google Gemini via OpenAI endpoint
    if "gemini" in pid:
        budget_map = {
            "minimal": 1024,
            "low": 2048,
            "medium": 4096,
            "high": 8192,
        }
        return {
            "extra_body": {
                "thinkingConfig": {
                    "thinkingBudget": budget_map.get(lvl, 4096)
                }
            }
        }

    # Default fallback
    return {}


class ExecutiveModelDispatcher:
    """
    Manages communication with the configured Intermediate Executive Model
    and dispatches resulting tool calls to the active TutorAgent whiteboard.
    """

    def __init__(self, tutor_agent: Any):
        self.tutor_agent = tutor_agent
        self._http_client: Optional[httpx.AsyncClient] = None

    def is_enabled(self) -> bool:
        cfg = get_intermediate_model_config()
        return bool(cfg.get("enabled", False))

    def get_active_config(self) -> dict:
        return get_intermediate_model_config()

    async def _get_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=35.0)
        return self._http_client

    async def close(self):
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()
            self._http_client = None

    async def execute_instruction(
        self,
        instruction: str,
        context_override: Optional[str] = None,
    ) -> Tuple[bool, str]:
        """
        Takes a student/teacher instruction and executes it via the intermediate model.
        Returns (success: bool, summary_report: str).
        """
        cfg = get_intermediate_model_config()
        if not cfg.get("enabled"):
            return False, "Intermediate Model is currently disabled in system settings."

        provider_id = cfg.get("providerId", "nvidia_nim")
        model_id = cfg.get("modelId", "nvidia/nemotron-4-340b-instruct")
        thinking_level = cfg.get("thinkingLevel", "high")
        creds = get_provider_credentials(provider_id)

        api_key = creds.get("apiKey", "")
        base_url = (cfg.get("customBaseUrl") or creds.get("baseUrl") or "").strip().rstrip("/")
        if not base_url:
            return False, f"Provider '{provider_id}' has no valid endpoint URL configured."

        is_local = provider_id in ("lmstudio", "llamacpp", "ollama")
        if not is_local and not api_key:
            return False, f"Provider '{provider_id}' is missing an API key. Please configure it in settings."

        # Inspect current whiteboard programmatic state
        board_state = getattr(self.tutor_agent, "board_state", {})
        active_slide = board_state.get("currentSlide", {})
        existing_elements = active_slide.get("elements", [])
        spatial = getattr(self.tutor_agent, "spatial_layout", {})

        state_summary = {
            "slideTitle": active_slide.get("title", "Untitled Slide"),
            "slideNumber": active_slide.get("pageNumber", 1),
            "totalElements": len(existing_elements),
            "elementsSummary": [
                {
                    "type": el.get("type"),
                    "label": el.get("label") or el.get("title") or el.get("text"),
                    "direction": el.get("direction"),
                    "boundingBox": el.get("boundingBox"),
                }
                for el in existing_elements[:15]
            ],
            "spatialLayout": spatial,
        }

        user_content = (
            f"### CURRENT WHITEBOARD STATE:\n{json.dumps(state_summary, ensure_ascii=False, indent=2)}\n\n"
            f"### INSTRUCTION TO EXECUTE:\n{instruction}"
        )
        if context_override:
            user_content += f"\n\n### ADDITIONAL PEDAGOGICAL CONTEXT:\n{context_override}"

        thinking_params = normalize_thinking_parameters(provider_id, model_id, thinking_level)

        # Prepare request payload
        payload: Dict[str, Any] = {
            "model": model_id,
            "messages": [
                {"role": "system", "content": EXECUTIVE_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.2,
            "max_tokens": 4096,
        }

        # Inject reasoning parameters
        for k, v in thinking_params.items():
            if k == "extra_body" and isinstance(v, dict):
                payload.update(v)
            else:
                payload[k] = v

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if api_key:
            if provider_id == "azure_openai":
                headers["api-key"] = api_key
            else:
                headers["Authorization"] = f"Bearer {api_key}"

        chat_url = f"{base_url}/chat/completions"
        client = await self._get_client()

        print(f">>> [EXECUTIVE MODEL] Delegating to '{provider_id}' / '{model_id}' via {chat_url}...")
        start_t = time.time()

        try:
            resp = await client.post(chat_url, headers=headers, json=payload, timeout=35.0)
            latency_ms = int((time.time() - start_t) * 1000)

            if resp.status_code != 200:
                err_text = resp.text[:400]
                print(f">>> [EXECUTIVE MODEL] Error HTTP {resp.status_code}: {err_text}")
                return False, f"Provider error (HTTP {resp.status_code}): {err_text}"

            res_json = resp.json()
            choice = (res_json.get("choices") or [{}])[0]
            raw_reply = choice.get("message", {}).get("content", "")
            if not raw_reply:
                return False, "Executive model returned an empty response."

            print(f">>> [EXECUTIVE MODEL] Reply received in {latency_ms}ms ({len(raw_reply)} chars)")

            # Parse JSON action from response
            parsed_action = self._extract_json_action(raw_reply)
            if not parsed_action or not parsed_action.get("action"):
                return False, f"Could not parse valid whiteboard action JSON from response: {raw_reply[:200]}"

            action_name = parsed_action.get("action", "").strip()
            params = parsed_action.get("parameters", {}) or {}
            thought = parsed_action.get("thought", "")

            # Dispatch action to tutor_agent
            exec_res = await self._dispatch_to_whiteboard(action_name, params)
            audit_note = str(exec_res) if exec_res else ""

            report = (
                f"Completed by Executive Model ({model_id} via {provider_id}): "
                f"Action '{action_name}' executed ({latency_ms}ms). {thought}"
            )
            if audit_note:
                report += f" -> {audit_note}"

            return True, report

        except Exception as e:
            logger.error(f"[EXECUTIVE MODEL] Execution exception: {e}", exc_info=True)
            return False, f"Executive execution failed: {str(e)}"

    def _extract_json_action(self, text: str) -> Optional[dict]:
        """Extracts JSON object containing 'action' and 'parameters' even if wrapped in markdown code blocks."""
        cleaned = text.strip()
        # 1. Direct parse
        try:
            data = json.loads(cleaned)
            if isinstance(data, dict) and "action" in data:
                return data
        except Exception:
            pass

        # 2. Markdown fence: ```json ... ```
        fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
        if fence_match:
            try:
                data = json.loads(fence_match.group(1))
                if isinstance(data, dict) and "action" in data:
                    return data
            except Exception:
                pass

        # 3. Outer brace search
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                data = json.loads(cleaned[start : end + 1])
                if isinstance(data, dict) and "action" in data:
                    return data
            except Exception:
                pass

        return None

    async def _dispatch_to_whiteboard(self, action: str, params: dict) -> Any:
        """Invokes the corresponding method on TutorAgent with executive flag enabled."""
        agent = self.tutor_agent
        if agent is None:
            return None
        print(f">>> [EXECUTIVE MODEL] Dispatching action '{action}' with params: {params}")
        setattr(agent, "_inside_executive_call", True)
        try:
            return await self._dispatch_to_whiteboard_impl(action, params)
        finally:
            setattr(agent, "_inside_executive_call", False)

    async def _dispatch_to_whiteboard_impl(self, action: str, params: dict) -> Any:
        agent = self.tutor_agent
        if action == "draw_diagram":
            diagram_type = params.get("diagram_type") or params.get("flowchart_type") or "tree"
            root = (
                params.get("root")
                or params.get("root_text")
                or params.get("root_label")
                or params.get("label")
                or params.get("text")
                or ""
            )
            nodes = params.get("nodes")
            if nodes is None:
                nodes = params.get("children") or []
            title = (
                params.get("title")
                or params.get("root_text")
                or params.get("topic")
                or ""
            )
            if not title and isinstance(root, dict):
                title = str(
                    root.get("text")
                    or root.get("label")
                    or root.get("name")
                    or root.get("root")
                    or root.get("title")
                    or ""
                ).strip()
            elif not title and isinstance(root, str):
                title = root.strip()
            if not root and title:
                root = title
            return await agent.draw_diagram(
                title=title,
                diagram_type=diagram_type,
                root=root,
                nodes=nodes,
                direction=params.get("direction", "TB"),
                position=params.get("position", "auto"),
                attach_to_node=params.get("attach_to_node", ""),
                x=params.get("x"),
                y=params.get("y"),
                width=params.get("width"),
                height=params.get("height"),
            )
        elif action == "draw_concept_card":
            items = params.get("items")
            if items is None:
                items = params.get("bullets") or []
            return await agent.draw_concept_card(
                title=params.get("title", ""),
                items=items,
                category=params.get("category", ""),
                color=params.get("color", "#38bdf8"),
                position=params.get("position", "auto"),
                attach_to_node=params.get("attach_to_node", ""),
                x=params.get("x"),
                y=params.get("y"),
                width=params.get("width", 540.0),
            )
        elif action == "update_whiteboard_item":
            action_type = params.get("action", "replace")
            if params.get("delete_node"):
                action_type = "delete_node"
            return await agent.update_whiteboard_item(
                target=params.get("target", ""),
                new_text=params.get("new_text") or params.get("new_label") or "",
                new_label=params.get("new_label"),
                action=action_type,
                old_substring=params.get("old_substring", ""),
                new_items=params.get("new_items") or params.get("append_items"),
                new_direction=params.get("new_direction"),
                color=params.get("color"),
                x=params.get("x") or params.get("move_x"),
                y=params.get("y") or params.get("move_y"),
                font_size=params.get("font_size"),
            )
        elif action == "write_math":
            return await agent.write_math(
                formula=params.get("formula", ""),
                x=params.get("x", 140),
                y=params.get("y", 200),
                font_size=params.get("font_size", 28),
                title=params.get("title"),
                position=params.get("position", "auto"),
            )
        elif action == "write_normal_text":
            return await agent.write_normal_text(
                text=params.get("text", ""),
                x=params.get("x", 140),
                y=params.get("y", 200),
                font_size=params.get("font_size", 24),
                color=params.get("color", "#FFFFFF"),
                direction=params.get("direction", "ltr"),
                style=params.get("style", "normal"),
                attach_to_node=params.get("attach_to_node", ""),
            )
        elif action == "write_text":
            return await agent.write_text(
                text=params.get("text", ""),
                x=params.get("x", 140),
                y=params.get("y", 200),
                direction=params.get("direction", "ltr"),
                style=params.get("style", "auto"),
                font_size=params.get("font_size"),
            )
        elif action == "draw_graph":
            return await agent.draw_graph(
                fn=params.get("fn", "x"),
                x_min=params.get("x_min", -5),
                x_max=params.get("x_max", 5),
                y_min=params.get("y_min", -5),
                y_max=params.get("y_max", 5),
                title=params.get("title", "Graph"),
                shaded_from_x=params.get("shaded_from_x"),
                shaded_to_x=params.get("shaded_to_x"),
                f_top=params.get("f_top"),
                f_bottom=params.get("f_bottom"),
                position=params.get("position", "auto"),
            )
        elif action == "draw_3d_graph":
            return await agent.draw_3d_graph(
                equation_z=params.get("equation_z", "sin(x)*cos(y)"),
                title=params.get("title", "3D Graph"),
                x_min=params.get("x_min", -3),
                x_max=params.get("x_max", 3),
                y_min=params.get("y_min", -3),
                y_max=params.get("y_max", 3),
                plot_type=params.get("plot_type", "surface"),
                position=params.get("position", "auto"),
            )
        elif action == "draw_shape":
            return await agent.draw_shape(
                shape_type=params.get("shape_type", "rectangle"),
                x=params.get("x", 400),
                y=params.get("y", 300),
                width=params.get("width", 200),
                height=params.get("height", 100),
                label=params.get("label", ""),
                color=params.get("color", "#4ECDC4"),
                preserve_exact_position=params.get("preserve_exact_position", False),
            )
        elif action == "create_instant_quiz":
            return await agent.create_instant_quiz(
                question=params.get("question", "Quiz Question"),
                quiz_type=params.get("quiz_type", "multiple_choice"),
                options=params.get("options"),
                correct_option=params.get("correct_option"),
                correct_answer=params.get("correct_answer"),
                pairs=params.get("pairs"),
                blank_sentence=params.get("blank_sentence", ""),
                accepted_answers=params.get("accepted_answers"),
                explanation=params.get("explanation", ""),
                color_theme=params.get("color_theme", "cyan"),
                position=params.get("position", "auto"),
                x=params.get("x"),
                y=params.get("y"),
                width=params.get("width", 540.0),
                height=params.get("height", 380.0),
            )
        elif action == "submit_quiz_answer":
            return await agent.submit_quiz_answer(
                quiz_id=params.get("quiz_id", ""),
                answer=params.get("answer", ""),
            )
        elif action == "draw_venn_diagram":
            return await agent.draw_venn_diagram(
                sets=params.get("sets", []),
                intersections=params.get("intersections", []),
                title=params.get("title", "Venn Diagram"),
                position=params.get("position", "auto"),
            )
        elif action == "draw_table":
            return await agent.draw_table(
                title=params.get("title", "Comparison Table"),
                columns=params.get("columns", ["Feature", "Option A", "Option B"]),
                rows=params.get("rows", []),
                slot=params.get("slot", params.get("position", "auto")),
                theme=params.get("theme", "cyan"),
                font_size=params.get("font_size", 16),
                compact=params.get("compact", False),
            )
        elif action == "new_whiteboard_slide":
            return await agent.new_whiteboard_slide(title=params.get("title", "New Slide"))
        elif action == "erase_content":
            return await agent.erase_content(target=params.get("target", "latest"))
        elif action in ("search_and_display_web_image", "display_web_image"):
            return await agent.search_and_display_web_image(
                query=params.get("query", ""),
                caption=params.get("caption", ""),
                position=params.get("position", "auto"),
            )
        elif action in ("display_youtube_video", "play_youtube_video"):
            return await agent.display_youtube_video(
                url=params.get("url", ""),
                title=params.get("title", ""),
                position=params.get("position", "auto"),
            )
        elif action == "analyze_youtube_video":
            return await agent.analyze_youtube_video(
                url=params.get("url", ""),
                question=params.get("question", ""),
            )
        elif action in ("search_the_web", "search_web"):
            return await agent.search_the_web(
                query=params.get("query", ""),
            )
        elif action == "control_video":
            return await agent.control_video(
                action=params.get("action", "play"),
                video_id=params.get("video_id"),
                volume=params.get("volume"),
                speed=params.get("speed"),
                time_sec=params.get("time_sec"),
                language=params.get("language"),
                quality=params.get("quality"),
                width=params.get("width"),
                height=params.get("height"),
            )
        else:
            raise ValueError(f"Unsupported executive action: {action}")

    async def evaluate_quiz_answer(
        self,
        question: str,
        expected_answer: str,
        student_answer: str,
        explanation: str = "",
    ) -> Dict[str, Any]:
        """
        Evaluates a student's open-ended short answer or essay on a whiteboard quiz using AI.
        Returns {"is_correct": bool, "feedback": str}.
        """
        clean_ans = str(student_answer or "").strip()
        if not clean_ans or len(clean_ans) < 3:
            return {
                "is_correct": False,
                "feedback": "Please write an explanation or answer to the question before submitting.",
            }

        grading_system_prompt = (
            "You are an expert, academically rigorous AI Tutor grading a student's answer on an interactive whiteboard quiz.\n"
            "Your objective: Determine whether the student's answer is factually and conceptually accurate.\n"
            "STRICT GRADING CRITERIA:\n"
            "1. If the student writes creative nonsense, jokes, satire, trolling (e.g. social castes, warm milk on motherboard, sarcastic remarks), or is factually incorrect, you MUST grade is_correct=false!\n"
            "2. If the student genuinely explains the core academic concepts correctly (even in their own words or conversational phrasing, or provides the core definition along with valid examples or prevention techniques), grade is_correct=true.\n"
            "3. Return direct, pedagogical feedback in the EXACT same language as the question (1-2 sentences). If the student made a humorous joke, acknowledge the humor with a smile but firmly and clearly teach the real academic fact.\n\n"
            "Respond strictly in valid JSON format with keys 'is_correct' (boolean) and 'feedback' (string):\n"
            "{\n"
            '  "is_correct": false,\n'
            '  "feedback": "..."\n'
            "}"
        )

        user_content = (
            f"Question: {question}\n"
            f"Expected Answer / Core Concept: {expected_answer}\n"
            f"Explanation / Ground Truth: {explanation}\n"
            f"Student's Answer: {clean_ans}"
        )

        cfg = get_intermediate_model_config()
        # Strategy A: Use intermediate model provider if enabled and configured
        if cfg.get("enabled"):
            try:
                provider_id = cfg.get("providerId", "nvidia_nim")
                model_id = cfg.get("modelId", "nvidia/nemotron-4-340b-instruct")
                creds = get_provider_credentials(provider_id)
                api_key = creds.get("apiKey", "")
                base_url = (cfg.get("customBaseUrl") or creds.get("baseUrl") or "").strip().rstrip("/")

                if base_url:
                    client = await self._get_client()
                    headers = {"Content-Type": "application/json", "Accept": "application/json"}
                    if api_key:
                        headers["api-key" if provider_id == "azure_openai" else "Authorization"] = (
                            f"Bearer {api_key}" if provider_id != "azure_openai" else api_key
                        )

                    req_payload = {
                        "model": model_id,
                        "messages": [
                            {"role": "system", "content": grading_system_prompt},
                            {"role": "user", "content": user_content},
                        ],
                        "temperature": 0.1,
                        "max_tokens": 512,
                    }
                    resp = await client.post(
                        f"{base_url}/chat/completions",
                        headers=headers,
                        json=req_payload,
                        timeout=20.0,
                    )
                    if resp.status_code == 200:
                        choice_msg = resp.json()["choices"][0]["message"]
                        raw_reply = choice_msg.get("content") or choice_msg.get("reasoning_content") or ""
                        if raw_reply:
                            m = re.search(r"\{[\s\S]*\}", raw_reply)
                            if m:
                                parsed = json.loads(m.group(0))
                                return {
                                    "is_correct": bool(parsed.get("is_correct", False)),
                                    "feedback": str(parsed.get("feedback", explanation or "Answer evaluated.")),
                                }
            except Exception as e:
                logger.warning(f"Intermediate model grading failed ({e}), falling back to Gemini")

        # Strategy B: Use Google Gemini directly as fallback
        try:
            gemini_key_res = resolve_gemini_api_key()
            gemini_key = gemini_key_res[0] if isinstance(gemini_key_res, tuple) else gemini_key_res
            if gemini_key:
                from google import genai
                from google.genai import types as genai_types

                client = genai.Client(api_key=gemini_key)
                prompt = f"{grading_system_prompt}\n\n{user_content}"
                resp = await asyncio.to_thread(
                    client.models.generate_content,
                    model="gemini-2.0-flash",
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.1,
                    ),
                )
                if resp.text:
                    parsed = json.loads(resp.text)
                    return {
                        "is_correct": bool(parsed.get("is_correct", False)),
                        "feedback": str(parsed.get("feedback", explanation or "Answer evaluated.")),
                    }
        except Exception as e:
            logger.warning(f"Gemini fallback grading failed ({e})")

        # Fallback heuristic if no AI model responded
        return {
            "is_correct": False,
            "feedback": f"Could not verify answer automatically. Expected: {expected_answer or explanation}",
        }
