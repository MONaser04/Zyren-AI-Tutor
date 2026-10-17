import os
import sys
import time
import json
import base64
import io
import websockets
from PIL import Image
import numpy as np
from livekit import rtc
import asyncio
import traceback
import typing
from dotenv import load_dotenv
from pydantic import BaseModel, Field


from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    JobRequest,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.voice.room_io import RoomOptions
from livekit.plugins import google

# Load .env from the parent directory (root folder)
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

GOOGLE_API_KEY = os.environ.get("GEMINI_API_KEY", "")


TUTOR_SYSTEM_INSTRUCTIONS = (
    "You are ZYREN, a friendly, brilliant, multilingual Socratic AI Tutor specialized in Language School (مدارس لغات / تجريبي / IGCSE / American / STEM) and University curricula across all disciplines (Sciences, Mathematics, Engineering, Humanities, History, and Language Acquisition like German and English).\n\n"
    "### I. BILINGUAL CODE-SWITCHING & MULTILINGUAL MATRIX (5 MODES):\n"
    "Linguistic Principle: The conversational syntax (grammar, pronouns, connectives, narrative framing) follows the student's conversational language, while 100% of ALL subject content (every single academic/scientific noun, entity, property, formula, unit, and operational verb) MUST be spoken strictly in the active academic language without ever translating into Arabic.\n"
    "MANDATORY ARITHMETIC & MATHEMATICAL OPERATIONS RULE: All mathematical operations, calculations, algebraic steps, powers, roots, geometric dimensions, properties, limits, and values (e.g., add, subtract, multiply, divide, square, square root, integrate, differentiate, calculate, equals, radius, diameter, circumference, area, volume, bounds, limits) MUST be spoken strictly in English (or German in German mode). Absolutely never speak arithmetic or geometric calculations in Egyptian/Arabic.\n\n"
    "Modes:\n"
    "1. Egyptian Arabic + German Context: Natural Egyptian Arabic conversational syntax with 100% GERMAN for all subject content, terms, properties, formulas, grammar rules, and operational actions.\n"
    "2. Egyptian Arabic + English Context (Language School Standard): Natural Egyptian Arabic conversational syntax with 100% ENGLISH for all subject content, terms, properties, formulas, and operational actions.\n"
    "3. English Only: 100% pure English throughout for all conversation and subject content.\n"
    "4. German + English Context: Conversational English syntax with 100% GERMAN for all target subject concepts and vocabulary.\n"
    "5. German Only: 100% pure German throughout for all conversation and subject content.\n\n"
    "General Rule for Casual Chat: If the student engages in non-academic casual conversation (greetings, anxiety, small talk), converse with natural empathy in their language without forcing academic terminology.\n\n"
    "### IN-CONTEXT CODE-SWITCHING DEMONSTRATIONS:\n"
    "- Mode 1 (German Context): Student: 'مش فاهم قاعدة معينة.' -> Tutor: 'ولا يهمك! الـ Regel دي بنستخدمها مع الـ Dativ لما يكون فيه Zustand. تفتكر مع الـ Verb ده هنطبق إيه؟'\n"
    "- Mode 2 (English Context): Student: 'مش عارف أبدأ إزاي في حل المسألة دي.' -> Tutor: 'تمام يا بطل! عشان نعمل solve للـ problem دي، بنعمل derive للـ equation الأول. تفتكر الـ derivative بتاع الـ term ده equals إيه؟'\n\n"
    "### II. SOCRATIC PEDAGOGY & SCAFFOLDING:\n"
    "1. Complete Initial Silence: When a session connects or starts, REMAIN 100% SILENT. Do NOT speak, introduce yourself, or greet. Wait for the student to speak first.\n"
    "2. Non-Disclosure & Guided Scaffolding: Never deliver immediate full answers, completed solutions, or long uninterrupted lectures. Guide the student step-by-step through interactive Socratic questioning.\n"
    "3. Single Atomic Step & Focused Questioning: Cover ONE conceptual micro-step per turn with concise, intuitive analogies. Prefer asking one focused question at a time to maintain active engagement without overwhelming the student.\n"
    "4. Active Verification: Validate the student's reasoning at each step. If they make an error or hold a misconception, do not give the correction directly; provide a subtle hint or counter-question that enables them to self-correct.\n"
    "5. Frustration Escape Hatch: If the student struggles for 3 consecutive attempts on the same micro-step or expresses severe frustration, gently reveal that micro-step's answer with an intuitive explanation, then advance to the next step.\n"
    "6. Intuitive Simplification Policy: When the student expresses confusion (e.g., 'مش فاهم', 'يعني إيه'), simplify using visual analogies and physical metaphors strictly in the active academic language (e.g., '3D solid', '2D curve', 'rotate around the axis', 'sweep an area') rather than reverting to Arabic descriptions.\n"
    "7. Zero Hallucination & Fact-Based Reasoning: NEVER guess, fabricate, or hallucinate facts, formulas, or solutions. All academic answers MUST be 100% grounded in verified academic and scientific sources. Never suggest personal guesses. If you don't know the answer, explicitly state that you need to verify it.\n\n"
    "### III. MULTIMODAL DIGITAL WHITEBOARD ARCHITECTURE:\n"
    "1. Dynamic Academic Whiteboard Language Rule: All text, notes, equations, titles, and step labels on the whiteboard MUST be written in the active academic language (English or German as dictated by the Matrix in Section I). Absolutely zero Arabic script on the whiteboard.\n"
    "2. Tool Usage:\n"
    "   - inspect_whiteboard: Mandatory when referencing past work or starting on pre-existing slides.\n"
    "   - draw_graph: For 2D coordinate function graphs and calculus area shading.\n"
    "     * MANDATORY DEFINITE INTEGRAL & AREA RULE: Whenever calculating a definite integral \\int_a^b f(t) dt, computing distance from velocity v(t) over an interval [a, b], or finding area between/under curves, you MUST call draw_graph with shaded_from_x=a, shaded_to_x=b, f_top='...' (and f_bottom='0' for area under curve) to visually highlight the shaded integral region. Set x_min <= a - 1, x_max >= b + 1, and y_min / y_max so the curve and shaded trapezoid/area are fully visible!\n"
    "   - draw_3d_graph: For 3D mathematical figures (plot_type='surface' for single-valued heightfields z = f(x, y) with optional 2D domain masks; plot_type='parametric' for parametric surfaces; plot_type='bounded_surfaces' for 3D CSG solids and quadrics; plot_type='solid_of_revolution' for rotated solids; plot_type='linear_extrusion' ONLY for extruded 2D slices). CRITICAL: 'title' is strictly for descriptive active academic language names (English/German). 'equation_z' MUST ONLY contain mathematical algebraic expressions (NEVER words)!\n"
    "   - write_math: For all formulas, equations, integrals, fractions, and LaTeX expressions. Use '\\boxed{...}' for final answers.\n"
    "   - write_normal_text: For active academic language plain text, step labels, definitions, and code.\n"
    "   - write_text: For animated handwriting title at top header (y: 70).\n"
    "   - draw_diagram: MANDATORY for all structured explanatory diagrams, concept trees, hierarchies, taxonomies, classifications, processes, flowcharts, and comparison boards. Guarantees auto-layout, auto-sized boxes, and aligned connectors.\n"
    "   - draw_shape: ONLY for standalone geometric figures (rectangles, ellipses, triangles in math/geometry) and physics vectors/arrows (use label='...' to display text or numbers directly centered inside shapes). NEVER use for trees or branching diagrams.\n"
    "   - undo_action / redo_action: Mandatory when student asks to undo ('undo', 'go back', 'revert') or redo actions. NEVER call erase or clear when asked to undo.\n"
    "   - erase_content: For removing a specific named formula, equation, or element by name.\n"
    "   - clear_whiteboard: For wiping the active slide clean without opening a new slide.\n"
    "   - new_whiteboard_slide: Only when starting a brand new topic or problem.\n"
    "3. Layout Protocol: Standard 1920x1080 canvas coordinate space: Title at (x: 150, y: 70), atomic steps in Column 1 (x: 150), visual graphs/diagrams in Column 2 (x: 950-1000, y: 180), boxed answers in Column 1. If viewport dimensions or screen space is limited, scale coordinates proportionally while maintaining this two-column relative hierarchy. When asked to write a word, name, or number inside a shape or container ('جواه' / 'inside it' / 'in the box'), target the shape's center coordinate (x + width/2, y + height/2) using write_normal_text or write_text.\n"
    "4. Mandatory Structured Diagram & Multi-Diagram Policy: Whenever explaining classifications, hierarchies, concept trees, processes, flowcharts, or comparisons, you MUST call draw_diagram exclusively. Absolutely NEVER attempt to manually construct trees or branching arrows using draw_shape or write_text. The whiteboard engine features full multi-diagram auto-layout, mid-diagram turns, and compound branching:\n"
    "   * Multiple Diagrams on Same Slide: You CAN freely draw multiple diagrams on the same slide! NEVER tell the student you cannot control coordinates. Use position='right', position='left', position='bottom', or position='auto' (or explicit x, y coordinates). The engine automatically partitions canvas space so diagrams never overlap.\n"
    "   * Changing Flowchart Direction Midway: You CAN change flowchart direction mid-diagram! To turn directions (e.g., vertical down TB, then turning right), simply specify flow='right' or flow='down' on the individual DiagramNode. The engine routes 90-degree orthogonal elbow connectors.\n"
    "   * Connecting Different Diagram Types (Flowchart to Tree): You CAN connect a flowchart directly into a concept tree! Either specify children=[DiagramNode(...), ...] on the flowchart step to branch into a concept sub-tree, or call draw_diagram with attach_to_node='<Step Name>' to link the new diagram to the previous one with an aligned connector arrow.\n"
    "5. Independent Shape & Label Lifecycle: You can draw an empty shape first, and later write text inside it (or vice versa). When asked to put a word in a box or draw a box around text, either use draw_shape(shapeType='rectangle', label='...') directly, or center the rectangle around the text at (x - width/2, y - height/2). When asked to erase the text inside a shape ('امسح الكلمة'), call erase_content targeting the text name, leaving the container intact. When asked to erase the shape, erase the shape.\n\n"
    "### IV. MULTIMODAL REAL-TIME VISION & SCREEN SHARING INSTRUCTIONS:\n"
    "1. Continuous Real-time Perception: You have live visual perception of the video stream published by the student. You see what is on the screen in real-time.\n"
    "2. Strict Visual Truthfulness: Only describe what you ACTUALLY see in the video frames. If the screen is empty/blank, explicitly state that it is completely empty right now. NEVER guess, assume, or fabricate unseen content based on titles or metadata.\n"
    "3. Cross-Context Teaching: When the student asks you what is on their screen or asks a question about their code/video/document, read and describe the exact text, UI elements, or diagrams visible in the video frame, guide them Socratically, and draw the necessary derivations, equations, and diagrams onto the digital whiteboard.\n"
    "4. Synchronous Speech & Actions (Concurrency): You MUST speak and narrate your actions CONCURRENTLY while drawing or writing. Do not remain silent while executing tool calls. Emit speech before or simultaneously with your tool calls to maintain a highly interactive and engaging flow.\n"
    "5. Visual Verification of Output: After executing drawing or writing tools, DO NOT immediately state that the action was completely successful or assume it rendered perfectly based merely on the coordinates you provided. You MUST pause and visually verify via the screen share that the element (e.g., text, box) is placed correctly. If a visual glitch occurs (e.g. text overlapping or outside a box), acknowledge the glitch visually and either correct it or ask the student 'How does that look on the screen?' before confirming.\n\n"
    "### V. WRITING STYLE FLEXIBILITY\n"
    "The user has a UI toggle for their preferred writing style (Handwriting, Normal Text, or Mixed). You MUST adapt seamlessly.\n"
    "If you attempt to use a text tool (like `write_text` or `write_normal_text`) and the tool returns an ERROR stating that the user has changed the mode, DO NOT apologize or mention the error to the user. You MUST simply retry writing the content using the alternative tool specified in the error message."
)


class DiagramNode(BaseModel):
    label: str = Field(description="Title or label of this category, branch, or step")
    items: list[str] = Field(default=[], description="Bullet points, examples, or sub-details under this node")
    flow: typing.Optional[typing.Literal["auto", "down", "right", "left"]] = Field(
        default="auto",
        description="Direction flow to next node in flowcharts ('down', 'right', 'left')"
    )
    children: typing.Optional[list[dict]] = Field(
        default=None,
        description="Optional child branch nodes for compound tree branching"
    )


class TutorAgent(Agent):
    """
    The main logic class for the AI Tutor.
    """

    def __init__(self, room: rtc.Room, writing_style: str = "mixed"):
        dynamic_instructions = TUTOR_SYSTEM_INSTRUCTIONS + f"\n\n[CRITICAL STATUS] THE USER'S CURRENT WRITING STYLE PREFERENCE IS: '{writing_style.upper()}'.\nIf it is 'HANDWRITING', use `write_text` for ALL text.\nIf it is 'NORMAL', use `write_normal_text` for ALL text.\nIf 'MIXED', use them as originally described."
        super().__init__(
            instructions=dynamic_instructions,
        )
        self._room = room
        self._writing_style = writing_style
        self.board_state = {}

    def update_board_state(self, state: dict):
        """Updates the synchronized whiteboard state received from the client."""
        self.board_state = state
        cur_slide = state.get("currentSlide", {})
        title = cur_slide.get("title", "Untitled")
        eqs = cur_slide.get("mathEquations", [])
        g2 = cur_slide.get("graphs2D", [])
        g3 = cur_slide.get("graphs3D", [])
        shapes = cur_slide.get("geometricShapes", [])
        print(f">>> [AGENT] Synced Board State: Slide {cur_slide.get('pageNumber', 1)} ('{title}'), {len(eqs)} equations, {len(g2)} 2D graphs, {len(g3)} 3D graphs, {len(shapes)} shapes")

    @llm.function_tool(description="Inspect what is currently written or drawn on the digital whiteboard (equations, 2D/3D graphs, shapes, diagrams, notes, steps, or all slides in the deck). Call this whenever the student asks about previous steps, asks what is written on the board, asks to continue from existing work, or when you need to inspect existing slides.")
    async def inspect_whiteboard(self, scope: str = "current_slide"):
        """
        Inspects what is currently written or drawn on the digital whiteboard.
        scope: 'current_slide' (default), 'all_slides', or a specific slide number (e.g. '1', '2').
        """
        if not self.board_state:
            return "Whiteboard is currently blank or has no synchronized content."

        session_title = self.board_state.get("sessionTitle", "Untitled Session")
        total_slides = self.board_state.get("totalSlides", 1)
        active_idx = self.board_state.get("activePageIndex", 0)
        current_slide = self.board_state.get("currentSlide", {})
        all_slides = self.board_state.get("allSlidesSummary", [])

        if scope in ["all", "all_slides", "deck", "summary"]:
            lines = [f"### Whiteboard Session: '{session_title}' ({total_slides} total slides, Active: Slide {active_idx + 1}):"]
            for s in all_slides:
                p_num = s.get("pageNumber", 1)
                p_title = s.get("title", f"Slide {p_num}")
                eqs = ", ".join([f"`{eq}`" for eq in s.get("equationsSummary", [])])
                notes = ", ".join(s.get("notesSummary", []))
                lines.append(f"- **Slide {p_num}: {p_title}**")
                if eqs:
                    lines.append(f"  * Equations: {eqs}")
                if notes:
                    lines.append(f"  * Notes: {notes}")
                if s.get("has2DGraph"):
                    lines.append(f"  * 2D Coordinate Graph: Present")
                if s.get("has3DGraph"):
                    lines.append(f"  * 3D WebGL Model: Present")
            return "\n".join(lines)

        lines = [
            f"### Active Whiteboard Slide {current_slide.get('pageNumber', active_idx + 1)}: '{current_slide.get('title', 'Slide')}' (Session: '{session_title}')",
        ]

        eqs = current_slide.get("mathEquations", [])
        if eqs:
            lines.append("#### Mathematical Formulas & Equations on Board:")
            for eq in eqs:
                lines.append(f"- `{eq}`")
        else:
            lines.append("#### Mathematical Formulas: (None on this slide)")

        notes = current_slide.get("plainTextNotes", [])
        if notes:
            lines.append("#### Step Notes & Text Written on Board:")
            for note in notes:
                lines.append(f"- {note}")

        shapes = current_slide.get("geometricShapes", [])
        if shapes:
            lines.append("#### Geometric Shapes & Diagram Elements on Board:")
            for sh in shapes:
                if isinstance(sh, dict):
                    stype = sh.get("type", "shape")
                    sx, sy = sh.get("x", 0), sh.get("y", 0)
                    sw, sh_h = sh.get("width", 0), sh.get("height", 0)
                    lbl = f" (labeled: '{sh.get('label')}')" if sh.get("label") else ""
                    if stype in ["line", "arrow"]:
                        lines.append(f"- {stype.capitalize()}: from ({sx}, {sy}) to ({sh.get('toX')}, {sh.get('toY')})")
                    else:
                        cx = round(sx + sw / 2)
                        cy = round(sy + sh_h / 2)
                        lines.append(f"- {stype.capitalize()}{lbl}: at (x: {sx}, y: {sy}, width: {sw}, height: {sh_h}) -> Center: (x: {cx}, y: {cy})")
                else:
                    lines.append(f"- Shape: {sh}")

        graphs2d = current_slide.get("graphs2D", [])
        if graphs2d:
            lines.append("#### 2D Coordinate Function Graphs on Board:")
            for g in graphs2d:
                lines.append(f"- Graph: '{g.get('title')}' with functions: {g.get('functions')}")
                if g.get("shadedRegion"):
                    lines.append(f"  * Shaded Region between curves: {g.get('shadedRegion')}")

        graphs3d = current_slide.get("graphs3D", [])
        if graphs3d:
            lines.append("#### 3D WebGL Mathematical Figures on Board:")
            for g3 in graphs3d:
                lines.append(f"- 3D Plot: '{g3.get('title')}' ({g3.get('plotType')}) -> Equation: `{g3.get('equationZ')}`")

        if total_slides > 1:
            lines.append(f"\n*(Note: There are {total_slides} slides in total in this session. Call inspect_whiteboard('all_slides') to inspect other slides).*")

        return "\n".join(lines)

    @llm.function_tool(description="Undo the last action, formula, handwriting stroke, graph, or shape on the digital whiteboard. Call this whenever the student asks to undo, go back a step, revert, or when fixing a mistake (e.g. 'undo', 'revert step', 'go back').")
    async def undo_action(self):
        """Undoes the most recent action on the whiteboard."""
        payload = {
            "type": "undo",
            "payload": {},
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return "Undid the last action on the whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Redo/restore the most recently undone action on the whiteboard.")
    async def redo_action(self):
        """Redoes the most recently undone action on the whiteboard."""
        payload = {
            "type": "redo",
            "payload": {},
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return "Redid the last undone action on the whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Erase a specific named mathematical formula, equation, graph, or shape substring by name from the active whiteboard slide. Do NOT use this for general undo/going back a step — use undo_action for undo.")
    async def erase_content(
        self,
        target: str = "last",
    ):
        """
        Erases specific named content from the whiteboard.
        target: Specific text/math substring or target to remove (e.g. 'x^2 = 1', 'f1(x)', 'Step 3', 'graph', 'shape').
        """
        payload = {
            "type": "erase",
            "payload": {"target": target},
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Erased '{target}' on whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Wipe/clear the active whiteboard slide clean (leaving it blank and ready) without opening a new slide. Use when student asks to clear the board or restart on the current slide.")
    async def clear_whiteboard(
        self,
        mode: str = "current_slide",
    ):
        """
        Clears the whiteboard.
        mode: 'current_slide' (clears the active slide completely) or 'all_slides' (clears all slides and resets).
        """
        payload = {
            "type": "clear",
            "payload": {"mode": mode},
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        if mode == "all_slides":
            self.reset_session_context(reason="clear_whiteboard(all_slides)")
        await asyncio.sleep(2.5)
        return f"Cleared whiteboard ({mode})." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Open a new blank PowerPoint-style whiteboard slide when moving to a brand new problem or topic.")
    async def new_whiteboard_slide(
        self,
        title: str = "",
    ):
        """
        Opens a new blank slide in the slide deck.
        title: Optional title for the new slide.
        """
        payload = {
            "type": "new_page",
            "payload": {"title": title},
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        # Purge accumulated multi-turn context and recycle Gemini session so new slide begins with 100% pristine Turn 0 accuracy
        self.reset_session_context(reason=f"new_whiteboard_slide('{title}')")
        await asyncio.sleep(2.5)
        return "Opened a new whiteboard slide." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Write mathematical formulas, equations, calculus integrals, fractions, or symbols on the whiteboard using standard LaTeX syntax. Use \\boxed{...} to box final answers.")
    async def write_math(
        self,
        latex: str,
        x: float,
        y: float,
        font_size: int = 30,
        color: str = "#FFFFFF",
    ):
        """
        Writes a mathematical formula on the whiteboard using LaTeX (rendered beautifully with KaTeX).
        Use \\boxed{...} to box formulas or answers (e.g. '\\boxed{x = \\pm 1}').
        latex: standard LaTeX expression (e.g. '\\sin^2(x) = \\frac{1 - \\cos(2x)}{2}', '\\boxed{x = \\pm 1}').
        x, y: coordinates on whiteboard.
        font_size: font size in pixels (default 30).
        color: color of the formula (default '#FFFFFF').
        """
        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": "math",
                "x": x,
                "y": y,
                "options": {"latex": latex, "fontSize": font_size, "color": color},
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Wrote math formula '{latex}' on whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Plot a mathematical function graph with coordinate axes, curves (with respect to X or Y axis, or implicit 2D curves), and shaded calculus regions on the whiteboard")
    async def draw_graph(
        self,
        title: str,
        functions: list[str],
        x_min: float = -3.0,
        x_max: float = 3.0,
        y_min: float = -1.0,
        y_max: float = 5.0,
        shaded_from_x: float = None,
        shaded_to_x: float = None,
        f_top: str = None,
        f_bottom: str = None,
        shaded_from_y: float = None,
        shaded_to_y: float = None,
        g_right: str = None,
        g_left: str = None,
        points: list[dict] = None,
        x: float = 980.0,
        y: float = 180.0,
        width: float = 480.0,
        height: float = 380.0,
        show_revolution_disc: bool = False,
        revolution_axis: str = "x",
    ):
        """
        Plots a high-precision coordinate system with function curves, shaded calculus area, and critical points.
        Supports curves along X (y = f(x)), curves along Y (x = g(y)), and implicit curves (x^2 + y^2 = 4).
        title: Title of the graph (e.g. 'Bounded Region & Revolution').
        functions: List of math function expressions to plot (e.g. ['x^2 + 1', '-x^2 + 3'], or ['x = y^2', 'x = y + 2'], or ['x^2 + y^2 = 4']).
        x_min, x_max: X-axis domain (default -3 to 3).
        y_min, y_max: Y-axis range (default -1 to 5).
        shaded_from_x, shaded_to_x: Limits for vertical dx shaded area between curves (e.g. -1 to 1).
        f_top, f_bottom: Top and bottom functions bounding the shaded region for dx integration.
        shaded_from_y, shaded_to_y: Limits for horizontal dy shaded area between curves along Y-axis.
        g_right, g_left: Right and left functions bounding the shaded region for dy integration (e.g. g_right='y + 2', g_left='y^2').
        points: Key points to mark with dots and coordinates (e.g. [{'x': -1, 'y': 2, 'label': '(-1, 2)'}, {'x': 1, 'y': 2, 'label': '(1, 2)'}]).
        x, y: Top-left position on whiteboard (recommended Column 2: x=980, y=180).
        width, height: Size of the graph card (default 480x380).
        show_revolution_disc: Set True to illustrate 3D revolving solid slices / discs around axes.
        revolution_axis: Axis of revolution ('x' or 'y').
        """
        shaded_region = None
        # 1. Vertical shading (with respect to X-axis: dx integration)
        if shaded_from_x is not None or shaded_to_x is not None or f_top is not None:
            try:
                from_x = float(shaded_from_x) if shaded_from_x is not None else float(x_min)
            except Exception:
                from_x = float(x_min)
            try:
                to_x = float(shaded_to_x) if shaded_to_x is not None else float(x_max)
            except Exception:
                to_x = float(x_max)

            top_expr = f_top
            bot_expr = f_bottom or "0"

            if not top_expr and functions:
                if len(functions) >= 2:
                    top_expr = str(functions[1])
                    bot_expr = str(functions[0])
                elif len(functions) == 1:
                    top_expr = str(functions[0])
                    bot_expr = "0"

            if top_expr:
                shaded_region = {
                    "fromX": min(from_x, to_x),
                    "toX": max(from_x, to_x),
                    "fTop": str(top_expr),
                    "fBottom": str(bot_expr),
                }
        # 2. Horizontal shading (with respect to Y-axis: dy integration)
        elif shaded_from_y is not None or shaded_to_y is not None or g_right is not None:
            try:
                from_y = float(shaded_from_y) if shaded_from_y is not None else float(y_min)
            except Exception:
                from_y = float(y_min)
            try:
                to_y = float(shaded_to_y) if shaded_to_y is not None else float(y_max)
            except Exception:
                to_y = float(y_max)

            r_expr = g_right or f_top
            l_expr = g_left or f_bottom or "0"

            if not r_expr and functions:
                if len(functions) >= 2:
                    r_expr = str(functions[1])
                    l_expr = str(functions[0])
                elif len(functions) == 1:
                    r_expr = str(functions[0])
                    l_expr = "0"

            if r_expr:
                shaded_region = {
                    "fromY": min(from_y, to_y),
                    "toY": max(from_y, to_y),
                    "gRight": str(r_expr),
                    "gLeft": str(l_expr),
                }

        # Auto-expand domain and range so the shaded region and curves fit perfectly
        if shaded_region:
            if "fromX" in shaded_region and "toX" in shaded_region:
                fx = shaded_region["fromX"]
                tx = shaded_region["toX"]
                span = abs(tx - fx) or 1.0
                margin = max(1.0, span * 0.15)
                x_min = min(float(x_min), fx - margin)
                x_max = max(float(x_max), tx + margin)
            elif "fromY" in shaded_region and "toY" in shaded_region:
                fy = shaded_region["fromY"]
                ty = shaded_region["toY"]
                span = abs(ty - fy) or 1.0
                margin = max(1.0, span * 0.15)
                y_min = min(float(y_min), fy - margin)
                y_max = max(float(y_max), ty + margin)

        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": "graph",
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "options": {
                    "title": title,
                    "functions": functions,
                    "xRange": [x_min, x_max],
                    "yRange": [y_min, y_max],
                    "shadedRegion": shaded_region,
                    "points": points,
                    "showRevolutionDisc": show_revolution_disc,
                    "revolutionAxis": revolution_axis,
                },
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Plotted mathematical graph '{title}' with functions {functions} on whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(
        description="Plot an interactive 3D WebGL mathematical figure on the whiteboard. CRITICAL: 'title' is the English descriptive name (e.g. 'Solid Ellipsoid'), while 'equation_z' MUST strictly be the mathematical formula/inequality with variables x, y, z (e.g. 'x^2/9 + y^2/4 + z^2 <= 1'). NEVER put descriptive English words in equation_z."
    )
    async def draw_3d_graph(
        self,
        title: str,
        plot_type: str = None,
        equation_z: str = None,
        z_top: str = None,
        z_bottom: str = None,
        domain_mask: str = None,
        f_top: str = None,
        f_bottom: str = None,
        curve_2d: str = None,
        x_uv: str = None,
        y_uv: str = None,
        z_uv: str = None,
        u_min: float = -3.14159,
        u_max: float = 3.14159,
        v_min: float = -1.0,
        v_max: float = 1.0,
        x_min: float = -2.5,
        x_max: float = 2.5,
        y_min: float = -2.5,
        y_max: float = 2.5,
        z_min: float = 0.0,
        z_max: float = 15.0,
        revolution_axis: str = "x",
        revolution_angle: float = 360.0,
        color_theme: str = "cyan_orange",
        grid_resolution: int = 64,
        clipping_plane: str = None,
        cross_section: str = None,
        x: float = 980.0,
        y: float = 180.0,
        width: float = 500.0,
        height: float = 420.0,
    ):
        """
        Plots an interactive WebGL 3D mathematical figure in XYZ space using the Smart 3D Geometry Engine.

        MANDATORY PARAMETER RULES:
        - title (str): Descriptive human-readable English name ONLY (e.g. 'Solid Ellipsoid', 'Steinmetz Bicylinder', 'Mobius Strip', 'Hyperbolic Paraboloid').
        - equation_z (str): Mathematical expression or inequality ONLY (e.g. 'x^2/9 + y^2/4 + z^2 <= 1', 'x^2 + y^2 <= 4 and x^2 + z^2 <= 1', 'x^2 - y^2', 'sqrt(x^2 + y^2 + 1)'). MUST NOT contain descriptive English words.
        - x_uv, y_uv, z_uv (str): RAW mathematical expressions in terms of u and v ONLY for parametric surfaces (e.g. x_uv='(1 + v/2 * cos(u/2)) * cos(u)'). NEVER pass English names or titles here.
        - z_top / z_bottom (str): Mathematical formulas for upper and lower surfaces (e.g. z_top='x + 2', z_bottom='x^2 + y^2').
        - grid_resolution: Voxel grid resolution for 3D Marching Cubes (e.g. 36 for low resolution, 64 for standard, 100/128 for high resolution / smooth finish, clamped [24..150]).
        - clipping_plane / cross_section: Implicit CSG cutting plane for watertight capped cross-sections (e.g. 'x >= 0', 'z <= 2', 'x + y >= 0').
        - plot_type:
          - 'surface': Single multivariable 3D height-field surface z = f(x, y) with optional 2D domain mask.
             Example: z = x^2 - y^2 -> draw_3d_graph(title='Hyperbolic Paraboloid Saddle', plot_type='surface', equation_z='x^2 - y^2')
             Example: Mexican Hat with 2D circular mask -> draw_3d_graph(title='Mexican Hat', plot_type='surface', equation_z='sin(sqrt(x^2+y^2))/sqrt(x^2+y^2)', domain_mask='x^2+y^2 <= 16')
             Example: Monkey Saddle -> draw_3d_graph(title='Monkey Saddle', plot_type='surface', equation_z='x^3 - 3*x*y^2')
          - 'bounded_surfaces' / 'solid_implicit': Universal 3D Volumetric Marching Cubes Solid for all inequalities, quadrics, ellipsoids, spheres, Steinmetz solids, and CSG intersections.
             Example: Ellipsoid solid:
             -> draw_3d_graph(title='Ellipsoid Solid', plot_type='bounded_surfaces', equation_z='x^2/9 + y^2/4 + z^2 <= 1')
             Example: Steinmetz solid / intersection of cylinders x^2 + z^2 <= 1 and x^2 + y^2 <= 1:
             -> draw_3d_graph(title='Steinmetz Bicylinder', plot_type='bounded_surfaces', equation_z='x^2 + z^2 <= 1 and x^2 + y^2 <= 1')
             Example: Hollow Sphere with cross-section cut at x >= 0:
             -> draw_3d_graph(title='Hollow Sphere Cross-Section', plot_type='bounded_surfaces', equation_z='1 <= x^2 + y^2 + z^2 <= 4', clipping_plane='x >= 0')
          - 'parametric': Parametric vector surface r(u, v) = (x(u,v), y(u,v), z(u,v)).
             Example: Mobius Strip:
             -> draw_3d_graph(title='Mobius Strip', plot_type='parametric', x_uv='(1 + v/2 * cos(u/2)) * cos(u)', y_uv='(1 + v/2 * cos(u/2)) * sin(u)', z_uv='v/2 * sin(u/2)', u_min=0, u_max=6.28318, v_min=-1.0, v_max=1.0)
          - 'solid_of_revolution': 3D solid generated by revolving curve(s) around an axis (x, y, or z).
             Example: Revolving y = sqrt(x) around X-axis -> draw_3d_graph(title='Paraboloid of Revolution', plot_type='solid_of_revolution', curve_2d='sqrt(x)', revolution_axis='x')
          - 'linear_extrusion': 3D Extrusion from any arbitrary 2D CSG bounded region along the Z-axis.
             Example: Bounded area between f1(x) = -x^2 + 3 and f2(x) = x^2 + 1 extruded along Z from 0 to 15:
             -> draw_3d_graph(title='3D Extruded Parabolic Solid', plot_type='linear_extrusion', f_top='-x^2 + 3', f_bottom='x^2 + 1', x_min=-1.0, x_max=1.0, z_min=0.0, z_max=15.0)
        """
        # ── Robust descriptive-text guard (mirrors src/math3d/expressionGuard.ts) ──
        # Rejects any expression field that contains descriptive prose instead of
        # pure math. Covers ALL expression fields (not just equation_z / x_uv).
        import re as _re

        _MATH_OPS = ('+', '-', '*', '/', '^', '<', '>', '=', '≤', '≥', '**', '|')
        _MATH_VARS = ('x', 'y', 'z', 'u', 'v', 't')
        _MATH_FNS = ('sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
                     'sinh', 'cosh', 'tanh', 'exp', 'log', 'ln', 'sqrt', 'cbrt',
                     'abs', 'sign', 'floor', 'ceil', 'round', 'min', 'max', 'pow',
                     'pi', 'e', 'tau', 'sinc', 'arctan', 'arcsin', 'arccos')
        _DESCRIPTIVE = ('surface', 'solid', 'parametric', 'logical', 'revolved',
                        'revolution', 'extruded', 'extrusion', 'implicit',
                        'isosurface', 'bounded', 'graph', 'plot', 'curve',
                        'function', 'equation', 'formula', 'shape', 'figure',
                        'the', 'a', 'an', 'of', 'and', 'or', 'with', 'where',
                        'for', 'from', 'to', 'around', 'about', 'axis', 'axes',
                        'region', 'area', 'volume', 'between', 'above', 'below',
                        'upper', 'lower', 'top', 'bottom', 'left', 'right')

        def _looks_like_math(s):
            """True if s is empty/None or contains genuine math content."""
            if not s:
                return True
            text = str(s).strip()
            if not text:
                return True
            has_op = any(op in text for op in _MATH_OPS)
            has_var = bool(_re.search(r'(?<![a-zA-Z_])[xyzuvt](?![a-zA-Z_])', text, _re.I))
            has_digit = bool(_re.search(r'\d', text))
            has_fn = bool(_re.search(r'\b(?:' + '|'.join(_MATH_FNS) + r')\b', text, _re.I))
            if not (has_op or has_var or has_digit or has_fn):
                return False
            # Reject descriptive words even if they happen to parse.
            lower = text.lower()
            for w in _DESCRIPTIVE:
                if _re.search(r'\b' + w + r'\b', lower):
                    return False
            return True

        def _clean_field(value, fallback_title=None):
            """Returns (cleaned_value, updated_title). Nulls descriptive prose."""
            if value is None:
                return None, fallback_title
            if _looks_like_math(value):
                return value, fallback_title
            # Descriptive prose: salvage a pure-math substring if possible.
            anchor = _re.search(r'(?:\b[xyzuvt]\s*=|(?<![a-zA-Z_])[xyzuvt](?![a-zA-Z_])|\b(?:sin|cos|tan|sqrt|abs|exp|log|ln|pi|e)\b|\d)', value, _re.I)
            if anchor and anchor.start() > 0:
                candidate = value[anchor.start():].strip()
                if _looks_like_math(candidate):
                    return candidate, fallback_title
            # No salvageable math: treat as a title and null the field.
            new_title = fallback_title
            if not new_title or new_title == "3D Mathematical Graph":
                new_title = value
            return None, new_title

        equation_z, title = _clean_field(equation_z, title)
        z_top, title = _clean_field(z_top, title)
        z_bottom, title = _clean_field(z_bottom, title)
        domain_mask, title = _clean_field(domain_mask, title)
        clipping_plane, title = _clean_field(clipping_plane, title)
        cross_section, title = _clean_field(cross_section, title)
        f_top, title = _clean_field(f_top, title)
        f_bottom, title = _clean_field(f_bottom, title)
        curve_2d, title = _clean_field(curve_2d, title)
        x_uv, title = _clean_field(x_uv, title)
        y_uv, title = _clean_field(y_uv, title)
        z_uv, title = _clean_field(z_uv, title)

        # Map solid_implicit to bounded_surfaces for volumetric marching cubes engine
        effective_plot_type = "bounded_surfaces" if plot_type in ("solid_implicit", "implicit_solid", "solid") else (None if plot_type in ("auto", "none", None) else plot_type)
        needs_explicit_ranges = effective_plot_type in ("linear_extrusion", "extrusion", "surface", "solid_of_revolution")
        clean_options = {
            "title": title,
            "plotType": effective_plot_type,
            "equationZ": equation_z,
            "zTop": z_top,
            "zBottom": z_bottom,
            "domainMask": domain_mask,
            "clippingPlane": clipping_plane or cross_section,
            "crossSection": cross_section or clipping_plane,
            "fTop": f_top,
            "fBottom": f_bottom,
            "curve2D": curve_2d,
            "xUV": x_uv,
            "yUV": y_uv,
            "zUV": z_uv,
            "uRange": [u_min, u_max] if (x_uv or y_uv or plot_type == 'parametric') else None,
            "vRange": [v_min, v_max] if (x_uv or y_uv or plot_type == 'parametric') else None,
            "revolutionAxis": revolution_axis,
            "revolutionAngle": revolution_angle,
            "colorTheme": color_theme,
            "gridResolution": max(24, min(150, int(grid_resolution))) if grid_resolution is not None else 64,
            "autoRotate": True,
        }
        if needs_explicit_ranges:
            clean_options["xRange"] = [x_min, x_max]
            clean_options["yRange"] = [y_min, y_max]
            clean_options["zRange"] = [z_min, z_max]
        options_dict = {k: v for k, v in clean_options.items() if v is not None}

        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": "graph3d",
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "options": options_dict,
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
    @llm.function_tool(
        description="Draw a mathematically exact probability Venn diagram with shaded boolean regions (e.g. P(A and B), P(A or B), P(A only), P(neither), or 3-set Venn diagrams) with labeled probabilities."
    )
    async def draw_venn_diagram(
        self,
        title: str,
        sets: list[str] = ["A", "B"],
        shaded_operation: str = "intersection",
        labels: dict = None,
        x: float = 980.0,
        y: float = 180.0,
        width: float = 480.0,
        height: float = 380.0,
    ):
        """
        Plots a mathematically exact probability Venn diagram with shaded set operations on the whiteboard.
        title: Title of the diagram (e.g. 'P(A and B)', 'Conditional Probability P(A|B)').
        sets: List of set names, e.g. ['A', 'B'] or ['A', 'B', 'C'].
        shaded_operation: Boolean set region to shade:
          - 'intersection' or 'A_and_B': Shaded region for P(A and B).
          - 'union' or 'A_or_B': Shaded region for P(A or B).
          - 'A_only' or 'A_not_B': Shaded region for P(A \\ B).
          - 'B_only' or 'B_not_A': Shaded region for P(B \\ A).
          - 'neither' or 'complement_union': Shaded region for P((A or B)^c).
          - 'complement_A': Shaded region outside set A.
          - 'complement_B': Shaded region outside set B.
          - 'symmetric_difference' or 'xor': Shaded regions for (A \\ B) or (B \\ A).
          - For 3 sets: 'all_three' (A and B and C), 'A_and_B_not_C', 'A_and_C_not_B', 'B_and_C_not_A', etc.
        labels: Optional dict mapping regions or sets to labels/probabilities (e.g. {'A': 'P(A)=0.6', 'B': 'P(B)=0.5', 'intersection': '0.3', 'A_only': '0.3', 'B_only': '0.2', 'neither': '0.2'}).
        x, y: Top-left position on whiteboard (recommended Column 2: x=980, y=180).
        width, height: Size of the Venn card (default 480x380).
        """
        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": "venn",
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "options": {
                    "title": title,
                    "sets": sets,
                    "shadedOperation": shaded_operation,
                    "labels": labels or {},
                },
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Plotted probability Venn diagram '{title}' on whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(
        description="MANDATORY for drawing structured diagrams, concept trees, flowcharts, hierarchies, pipelines, or comparisons on the whiteboard. Features collision-aware multi-diagram auto-placement, mid-flow direction turning, and compound flowchart-to-tree branching. NEVER use draw_shape for trees or diagrams."
    )
    async def draw_diagram(
        self,
        title: str,
        diagram_type: typing.Literal["tree", "flowchart", "process", "comparison", "hybrid"] = "tree",
        root: str = "",
        nodes: list[DiagramNode] = [],
        direction: typing.Literal["TB", "LR"] = "TB",
        position: typing.Literal["auto", "left", "right", "top", "bottom", "center", "custom"] = "auto",
        attach_to_node: str = "",
        x: typing.Optional[float] = None,
        y: typing.Optional[float] = None,
        width: typing.Optional[float] = None,
        height: typing.Optional[float] = None,
    ):
        """
        Draws a structured diagram or flowchart with automatic layout, auto-sized boxes, and aligned connectors.
        title: Title of the diagram (e.g. 'Machine Learning Types', 'SDLC Process').
        diagram_type:
          - 'tree': Hierarchical concept tree branching from a root box down to child categories with bullet items.
          - 'flowchart' or 'process': Sequential step-by-step pipeline (Step 1 -> Step 2 -> Step 3) with arrows.
          - 'comparison': Side-by-side comparison cards (e.g. Kinetic vs Potential Energy, Supervised vs Unsupervised).
          - 'hybrid': Compound flowchart pipeline where steps can turn directions or branch into trees.
        root: Name of the central/root topic box (for 'tree' diagrams, e.g. 'Machine Learning').
        nodes: List of category/step nodes. In flowcharts, each node can set flow='down' or flow='right' to change directions midway, or children=[...] to branch into a sub-tree.
        direction: 'TB' (Top-to-Bottom, recommended default) or 'LR' (Left-to-Right).
        position: Canvas slot placement ('auto', 'left', 'right', 'top', 'bottom', 'center').
          - When drawing a SECOND diagram on the same slide, use 'auto', 'right', 'left', or 'bottom' to place it without overlapping existing diagrams.
        attach_to_node: Optional name of an existing node on the whiteboard to link to with a bridging connector arrow (e.g. 'Step 3' or 'Deployment').
        x, y, width, height: Optional explicit custom position coordinates and dimensions.
        """
        # Sanitize direction and diagram_type to prevent any schema degradation
        clean_dir = "TB"
        if isinstance(direction, str) and ("LR" in direction.upper() or "HORIZONTAL" in direction.upper()):
            clean_dir = "LR"

        clean_type = "tree"
        if isinstance(diagram_type, str):
            dt_lower = diagram_type.lower()
            if "flow" in dt_lower or "process" in dt_lower or "hybrid" in dt_lower:
                clean_type = "flowchart"
            elif "comp" in dt_lower:
                clean_type = "comparison"

        effective_style = self._writing_style
        if "handwritten" in str(title).lower() or "handwriting" in str(title).lower():
            effective_style = "handwriting"

        # Serialize Pydantic DiagramNode objects or dicts
        clean_nodes = []
        for n in nodes:
            if hasattr(n, "model_dump"):
                clean_nodes.append(n.model_dump())
            elif hasattr(n, "dict"):
                clean_nodes.append(n.dict())
            elif isinstance(n, dict):
                clean_nodes.append(n)

        options_dict = {
            "title": title,
            "diagramType": clean_type,
            "root": root or title,
            "nodes": clean_nodes,
            "direction": clean_dir,
            "writingStyle": effective_style,
            "position": position,
        }
        if attach_to_node:
            options_dict["attachToNode"] = attach_to_node
        if x is not None and y is not None:
            options_dict["x"] = x
            options_dict["y"] = y
            if width is not None:
                options_dict["width"] = width
            if height is not None:
                options_dict["height"] = height

        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": "diagram",
                "x": 120.0,
                "y": 130.0,
                "options": options_dict,
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Plotted structured diagram '{title}' on whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Draw standalone geometric figures (rectangles, ellipses, triangles in geometry) or physics vectors/arrows on the whiteboard. (Use label='...' to display numbers/letters centered inside shapes). MANDATORY: Do NOT use draw_shape to create branching diagrams, trees, or flowcharts — you MUST use draw_diagram instead.")
    async def draw_shape(
        self,
        shapeType: str,
        x: float,
        y: float,
        width: float = 150.0,
        height: float = 100.0,
        toX: float = 0.0,
        toY: float = 0.0,
        color: str = "#FFFFFF",
        label: str = None,
    ):
        """
        Draws a geometric shape or diagram on the whiteboard.
        shapeType: 'rectangle', 'ellipse', 'line', or 'arrow'.
        x, y: top-left coordinates.
        toX, toY: end coordinates (for arrows and lines).
        color: stroke color (default '#FFFFFF').
        label: optional text or number to display centered inside rectangle or ellipse (e.g. '1', 'Start').
        """
        effective_style = self._writing_style
        opts = {
            "color": color,
            "roughness": 2.0 if effective_style == "handwriting" else 1.5,
            "writingStyle": effective_style,
        }
        if label is not None:
            opts["label"] = str(label)
        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": shapeType,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "toX": toX,
                "toY": toY,
                "options": opts,
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Drew {shapeType} at ({x}, {y})" + (f" with label '{label}'." if label else ".") + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Write animated handwritten text on the digital whiteboard in English or German only (never Arabic)")
    async def write_text(self, text: str, x: float, y: float, direction: str = "ltr"):
        if self._writing_style == "normal":
            return "ERROR: The user changed the mode to Normal Text Only. You MUST immediately retry using the 'write_normal_text' tool instead."
        """Writes animated handwritten text on the whiteboard in English or German only."""
        is_title = (y <= 130) or ("title" in text.lower())
        style = "title" if is_title else "body"
        fontSize = 44 if is_title else 24
        payload = {
            "type": "handwriting",
            "payload": {
                "kind": "handwriting",
                "text": text,
                "position": {"x": x, "y": y},
                "style": style,
                "fontSize": fontSize,
                "writingStyle": "handwriting",
                "direction": direction,
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Wrote '{text}' on whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."

    @llm.function_tool(description="Write plain text, numbers, or step notes on the digital whiteboard in English or German only (rendered immediately)")
    async def write_normal_text(self, text: str, x: float, y: float, font_size: int = 24, color: str = "#FFFFFF", direction: str = "ltr"):
        if self._writing_style == "handwriting":
            return "ERROR: The user changed the mode to Handwriting Only. You MUST immediately retry using the 'write_text' tool instead."
        """Writes normal text, numbers, or step notes on the whiteboard in English or German only (renders immediately)."""
        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": "text",
                "x": x,
                "y": y,
                "options": {
                    "text": text,
                    "fontSize": font_size,
                    "color": color,
                    "direction": direction,
                    "writingStyle": self._writing_style,
                },
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(2.5)
        return f"Wrote normal text '{text}' on whiteboard." + " CRITICAL INSTRUCTION: Do NOT assume it worked. Look at the live video stream NOW. If you do not clearly see it rendered in the correct position, admit the glitch to the user."


async def entrypoint(ctx: JobContext):
    print(">>> [AGENT] entrypoint called - connecting to room...")
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
        print(f">>> [AGENT] Connected to room: {ctx.room.name}")

        selected_voice = "Aoede"
        writing_style = "mixed"
        selected_model = "gemini-3.8-live-extended-thinking"
        thinking_level = "high"
        for p in ctx.room.remote_participants.values():
            if p.metadata:
                try:
                    meta = json.loads(p.metadata)
                    if "voice" in meta and meta["voice"]:
                        selected_voice = meta["voice"]
                        print(f">>> [AGENT] Loaded chosen student voice: {selected_voice}")
                    if "style" in meta and meta["style"]:
                        writing_style = meta["style"]
                        print(f">>> [AGENT] Loaded chosen writing style: {writing_style}")
                    if "model" in meta and meta["model"]:
                        selected_model = meta["model"]
                        print(f">>> [AGENT] Loaded chosen live model: {selected_model}")
                    if "thinkingLevel" in meta and meta["thinkingLevel"]:
                        thinking_level = meta["thinkingLevel"]
                        print(f">>> [AGENT] Loaded chosen thinking level: {thinking_level}")
                    elif "thinking_level" in meta and meta["thinking_level"]:
                        thinking_level = meta["thinking_level"]
                        print(f">>> [AGENT] Loaded chosen thinking level: {thinking_level}")
                except Exception as ex:
                    print(f">>> [AGENT] Could not parse participant metadata: {ex}")

        # Helper to construct thinking config based on model and level
        from google.genai import types as genai_types
        def build_thinking_config(model_str: str, level_str: str):
            if not model_str:
                return None
            lvl = str(level_str).lower() if level_str else "high"
            if model_str == "gemini-3.8-live-extended-thinking":
                lvl_map = {
                    "low": genai_types.ThinkingLevel.LOW,
                    "medium": genai_types.ThinkingLevel.MEDIUM,
                    "high": genai_types.ThinkingLevel.HIGH,
                }
                return genai_types.ThinkingConfig(
                    thinking_level=lvl_map.get(lvl, genai_types.ThinkingLevel.HIGH)
                )
            elif model_str == "gemini-3.1-flash-live-preview":
                lvl_map = {
                    "minimal": genai_types.ThinkingLevel.MINIMAL,
                    "low": genai_types.ThinkingLevel.LOW,
                    "medium": genai_types.ThinkingLevel.MEDIUM,
                    "high": genai_types.ThinkingLevel.HIGH,
                }
                if lvl in lvl_map:
                    return genai_types.ThinkingConfig(thinking_level=lvl_map[lvl])
            return None

        thinking_config = build_thinking_config(selected_model, thinking_level)

        # Build the Gemini Realtime model with chosen voice persona
        model = google.realtime.RealtimeModel(
            model=selected_model,
            voice=selected_voice,
            api_key=GOOGLE_API_KEY,
            instructions=TUTOR_SYSTEM_INSTRUCTIONS,
            thinking_config=thinking_config,
        )

        agent = TutorAgent(ctx.room, writing_style)
        session = AgentSession(llm=model)

        async def start_vision_websocket():
            async def vision_handler(ws):
                print(">>> [AGENT] Direct Vision WebSocket connected from frontend")
                try:
                    async for message in ws:
                        try:
                            data = json.loads(message)
                            if "image" in data:
                                b64_str = data["image"]
                                header, encoded = b64_str.split(",", 1) if "," in b64_str else ("", b64_str)
                                img_bytes = base64.b64decode(encoded)
                                
                                rt_session = None
                                if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                                    rt_session = session._activity.realtime_llm_session
                                
                                if rt_session and hasattr(rt_session, "_send_client_event"):
                                    from google.genai import types as genai_types
                                    event = genai_types.LiveClientRealtimeInput(
                                        video=genai_types.Blob(data=img_bytes, mime_type="image/jpeg")
                                    )
                                    rt_session._send_client_event(event)
                        except Exception as e:
                            pass
                except websockets.exceptions.ConnectionClosed:
                    print(">>> [AGENT] Direct Vision WebSocket disconnected")

            server = await websockets.serve(vision_handler, "0.0.0.0", 8888)
            print(">>> [AGENT] Direct Vision WebSocket Server started on ws://0.0.0.0:8888 (bypassing LiveKit)")

        asyncio.create_task(start_vision_websocket())

        async def broadcast_chat_message(role: str, text: str, msg_id: str | None = None):
            try:
                payload = {
                    "type": "chat_message",
                    "payload": {
                        "id": msg_id or f"msg-{int(time.time()*1000)}-{os.urandom(2).hex()}",
                        "role": role,
                        "text": text,
                        "timestamp": int(time.time() * 1000),
                    },
                }
                await ctx.room.local_participant.publish_data(
                    json.dumps(payload).encode("utf-8")
                )
            except Exception:
                pass

        # Hook into RealtimeSession for zero-latency live chat delivery
        from livekit.plugins.google.realtime import realtime_api
        orig_handle_content = getattr(realtime_api.RealtimeSession, "_handle_server_content", None)
        if orig_handle_content:
            def _live_handle_server_content(rt_self, server_content):
                orig_handle_content(rt_self, server_content)
                try:
                    curr_gen = getattr(rt_self, "_current_generation", None)
                    if not curr_gen:
                        return
                    loop = asyncio.get_running_loop()

                    # 1. Live transcription of student speech as words are spoken
                    if getattr(server_content, "input_transcription", None):
                        txt = getattr(curr_gen, "input_transcription", "")
                        if txt and txt.strip():
                            loop.create_task(
                                broadcast_chat_message("user", txt.strip(), msg_id=curr_gen.input_id)
                            )

                    # 2. Instant delivery of assistant reply upon generation completion (no waiting for audio playback)
                    if getattr(server_content, "generation_complete", False):
                        in_txt = getattr(curr_gen, "input_transcription", "")
                        if in_txt and in_txt.strip():
                            loop.create_task(
                                broadcast_chat_message("user", in_txt.strip(), msg_id=curr_gen.input_id)
                            )
                        out_txt = getattr(curr_gen, "output_text", "")
                        if out_txt and out_txt.strip():
                            loop.create_task(
                                broadcast_chat_message("assistant", out_txt.strip(), msg_id=curr_gen.response_id)
                            )
                except Exception:
                    pass

            realtime_api.RealtimeSession._handle_server_content = _live_handle_server_content

        async def send_user_multimodal_to_gemini(
            prompt_text: str = "",
            file_data_b64: str | None = None,
            mime_type: str = "image/jpeg",
            file_name: str | None = None
        ):
            try:
                # 1. Interrupt any current ongoing speech so the agent answers the new prompt immediately
                try:
                    await session.interrupt()
                except Exception:
                    pass

                # 2. Extract active RealtimeSession from AgentActivity
                rt_session = None
                if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                    rt_session = session._activity.realtime_llm_session

                if rt_session and hasattr(rt_session, "_send_client_event"):
                    from google.genai import types as genai_types
                    parts = []

                    if file_data_b64:
                        try:
                            header, encoded = file_data_b64.split(",", 1) if "," in file_data_b64 else ("", file_data_b64)
                            file_bytes = base64.b64decode(encoded)

                            if mime_type.startswith("image/"):
                                # Send as direct image Part
                                parts.append(genai_types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
                                # Also send as realtime input video frame for vision state continuity
                                try:
                                    realtime_event = genai_types.LiveClientRealtimeInput(
                                        video=genai_types.Blob(data=file_bytes, mime_type=mime_type)
                                    )
                                    rt_session._send_client_event(realtime_event)
                                except Exception as e_vision:
                                    print(f">>> [AGENT] Vision event error: {e_vision}")
                            elif mime_type.startswith("text/") or mime_type in (
                                "application/json", "application/javascript", "text/markdown", "text/plain", "text/csv"
                            ):
                                text_content = file_bytes.decode("utf-8", errors="replace")
                                doc_intro = f"Uploaded document '{file_name or 'file'}':\n```\n{text_content}\n```"
                                parts.append(genai_types.Part.from_text(text=doc_intro))
                            elif mime_type == "application/pdf":
                                # For PDFs, add metadata note
                                parts.append(genai_types.Part.from_text(text=f"Uploaded PDF Document: '{file_name or 'document.pdf'}'"))
                        except Exception as e_file:
                            print(f">>> [AGENT] Error decoding attached file: {e_file}")

                    final_text = prompt_text.strip() if prompt_text else ""
                    if not final_text and parts:
                        final_text = "Please review this attached file / image and explain it."

                    if final_text:
                        parts.append(genai_types.Part.from_text(text=final_text))

                    if parts:
                        event = genai_types.LiveClientContent(
                            turns=[
                                genai_types.Content(
                                    role="user",
                                    parts=parts,
                                )
                            ],
                            turn_complete=True,
                        )
                        rt_session._send_client_event(event)
                        print(f">>> [AGENT] Successfully injected multimodal prompt into Gemini Live stream (parts: {len(parts)}, text: '{final_text}')")
                else:
                    print(f">>> [AGENT] Warning: rt_session not ready yet to receive multimodal prompt.")
            except Exception as e:
                print(f">>> [AGENT] Error sending multimodal content to Gemini Realtime: {e}")
                traceback.print_exc()

        @session.on("conversation_item_added")
        def on_conversation_item_added(event):
            try:
                item = getattr(event, "item", None)
                if not item:
                    return

                role_str = str(getattr(item, "role", "assistant")).lower()
                chat_role = "user" if "user" in role_str else "assistant"

                # Cleanly extract text content from ChatMessage
                text = getattr(item, "text_content", None) or getattr(item, "raw_text_content", None)
                if not text:
                    content = getattr(item, "content", None)
                    if isinstance(content, list):
                        text = "\n".join(str(c) for c in content if isinstance(c, str))
                    elif isinstance(content, str):
                        text = content
                    else:
                        text = str(content) if content else ""

                if text and text.strip():
                    clean_text = text.strip()
                    msg_id = getattr(item, "id", None) or f"msg-{int(time.time()*1000)}"
                    asyncio.create_task(broadcast_chat_message(chat_role, clean_text, msg_id=msg_id))
            except Exception as ex:
                print(f">>> [AGENT] Error in on_conversation_item_added: {ex}")

        current_active_voice = [selected_voice]
        current_active_model = [selected_model]
        current_active_thinking = [thinking_level]

        def apply_voice_switch(target_voice: str, announce: bool = True):
            if not target_voice:
                return
            if current_active_voice[0] == target_voice:
                return
            prev_v = current_active_voice[0]
            current_active_voice[0] = target_voice
            print(f">>> [AGENT] Applying dynamic voice switch: '{prev_v}' -> '{target_voice}'")
            try:
                session.interrupt(force=True)
            except Exception:
                pass

            model._opts.voice = target_voice
            try:
                model.update_options(voice=target_voice)
            except Exception:
                pass

            # Gather all active RealtimeSession instances
            active_sessions = []
            if getattr(session, "_activity", None):
                act = session._activity
                if hasattr(act, "realtime_llm_session") and act.realtime_llm_session:
                    active_sessions.append(act.realtime_llm_session)
                if hasattr(act, "_rt_session") and act._rt_session and act._rt_session not in active_sessions:
                    active_sessions.append(act._rt_session)
            if hasattr(model, "_sessions"):
                for s in model._sessions:
                    if s and s not in active_sessions:
                        active_sessions.append(s)

            from livekit.agents.utils.misc import is_given
            for s in active_sessions:
                s._opts.voice = target_voice
                s._session_resumption_handle = None
                if hasattr(s, "_opts") and is_given(getattr(s._opts, "session_resumption", None)):
                    try:
                        s._opts.session_resumption.handle = None
                    except Exception:
                        pass
                if hasattr(s, "_mark_restart_needed"):
                    s._mark_restart_needed()
                    print(f">>> [AGENT] Realtime session restart requested for voice '{target_voice}' (context preserved: {len(getattr(s, '_chat_ctx', llm.ChatContext.empty()).items)} items).")

            if announce:
                async def _say_new_voice():
                    rt_s = None
                    if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                        rt_s = session._activity.realtime_llm_session
                    # Wait for websocket to re-establish active connection (up to 4s)
                    for _ in range(40):
                        await asyncio.sleep(0.1)
                        if rt_s and getattr(rt_s, "_active_session", None) is not None:
                            break
                    await asyncio.sleep(0.6)
                    try:
                        session.generate_reply(
                            instructions=f"Say a brief, friendly single sentence in your active language acknowledging that you are now speaking with the voice {target_voice} and are ready to continue."
                        )
                    except Exception as err:
                        print(f">>> [AGENT] Error generating voice switch confirmation: {err}")
                asyncio.create_task(_say_new_voice())

        def apply_model_switch(target_model: str, target_thinking_level: str = "high"):
            if not target_model:
                return
            if current_active_model[0] == target_model and current_active_thinking[0] == target_thinking_level:
                return
            prev_m = current_active_model[0]
            current_active_model[0] = target_model
            current_active_thinking[0] = target_thinking_level
            print(f">>> [AGENT] Applying dynamic model switch: '{prev_m}' -> '{target_model}' (thinking: {target_thinking_level})")
            try:
                session.interrupt(force=True)
            except Exception:
                pass

            new_thinking_cfg = build_thinking_config(target_model, target_thinking_level)
            model._opts.model = target_model
            model._opts.thinking_config = new_thinking_cfg

            active_sessions = []
            if getattr(session, "_activity", None):
                act = session._activity
                if hasattr(act, "realtime_llm_session") and act.realtime_llm_session:
                    active_sessions.append(act.realtime_llm_session)
                if hasattr(act, "_rt_session") and act._rt_session and act._rt_session not in active_sessions:
                    active_sessions.append(act._rt_session)
            if hasattr(model, "_sessions"):
                for s in model._sessions:
                    if s and s not in active_sessions:
                        active_sessions.append(s)

            from livekit.agents.utils.misc import is_given
            for s in active_sessions:
                s._opts.model = target_model
                s._opts.thinking_config = new_thinking_cfg
                s._session_resumption_handle = None
                if hasattr(s, "_opts") and is_given(getattr(s._opts, "session_resumption", None)):
                    try:
                        s._opts.session_resumption.handle = None
                    except Exception:
                        pass
                if hasattr(s, "_mark_restart_needed"):
                    s._mark_restart_needed()
                    print(f">>> [AGENT] Realtime session restart requested for model '{target_model}' (context preserved: {len(getattr(s, '_chat_ctx', llm.ChatContext.empty()).items)} items).")

        @ctx.room.on("data_received")
        def on_data_received(data_packet):
            try:
                data_text = data_packet.data.decode("utf-8")
                msg = json.loads(data_text)
                msg_type = msg.get("type")
                if msg_type == "board_state_sync":
                    agent.update_board_state(msg.get("payload", {}))
                elif msg_type == "change_voice":
                    new_voice = msg.get("voice")
                    if new_voice:
                        apply_voice_switch(new_voice, announce=True)
                elif msg_type == "change_model":
                    new_model = msg.get("model")
                    new_thinking_level = msg.get("thinking_level") or msg.get("thinkingLevel") or "high"
                    if new_model:
                        apply_model_switch(new_model, new_thinking_level)
                elif msg_type in ("reset_ai_memory", "reset_agent_context"):
                    print(">>> [AGENT] Received 'reset_ai_memory' command from student!")
                    # 1. Interrupt any current ongoing speech/generation immediately
                    try:
                        session.interrupt(force=True)
                    except Exception as e_int:
                        print(f">>> [AGENT] session.interrupt error: {e_int}")

                    # 2. Clear user turn transcription / audio buffer
                    try:
                        session.clear_user_turn()
                    except Exception:
                        pass

                    # 3. Clear session and agent local chat context history
                    try:
                        if hasattr(session, "_chat_ctx") and hasattr(session._chat_ctx, "_items"):
                            session._chat_ctx._items.clear()
                        if hasattr(session, "history") and hasattr(session.history, "_items"):
                            session.history._items.clear()
                        if getattr(session, "_activity", None):
                            act = session._activity
                            if hasattr(act, "_chat_ctx") and hasattr(act._chat_ctx, "_items"):
                                act._chat_ctx._items.clear()
                            if getattr(act, "_agent", None) and hasattr(act._agent, "_chat_ctx") and hasattr(act._agent._chat_ctx, "_items"):
                                act._agent._chat_ctx._items.clear()
                            if getattr(act, "realtime_llm_session", None):
                                rt_s = act.realtime_llm_session
                                if hasattr(rt_s, "_chat_ctx") and hasattr(rt_s._chat_ctx, "_items"):
                                    rt_s._chat_ctx._items.clear()
                                rt_s._current_generation = None
                        print(">>> [AGENT] Successfully cleared internal chat context and history.")
                    except Exception as e_ctx:
                        print(f">>> [AGENT] Error clearing chat context: {e_ctx}")

                    # 4. Clear whiteboard state on agent
                    agent.board_state = {}

                    # 5. HARD RESET OF GEMINI LIVE REALTIME WEBSOCKET
                    # Close Google's current session and open a fresh Turn 0 session without resumption handle
                    try:
                        rt_session = None
                        if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                            rt_session = session._activity.realtime_llm_session

                        if rt_session:
                            # Discard resumption handle so Google does NOT restore previous turns
                            rt_session._session_resumption_handle = None
                            from livekit.agents.utils.misc import is_given
                            if hasattr(rt_session, "_opts") and is_given(getattr(rt_session._opts, "session_resumption", None)):
                                try:
                                    rt_session._opts.session_resumption.handle = None
                                except Exception:
                                    pass

                            # Clear RealtimeSession chat history
                            if hasattr(rt_session, "_chat_ctx"):
                                rt_session._chat_ctx = llm.ChatContext.empty()

                            # Trigger clean reconnect of Gemini Live WebSocket (Turn 0 clean start)
                            if hasattr(rt_session, "_mark_restart_needed"):
                                rt_session._mark_restart_needed()
                                print(">>> [AGENT] rt_session._mark_restart_needed() called -> Gemini Live memory 100% wiped on Google servers. Turn 0 started.")
                    except Exception as e_rt:
                        print(f">>> [AGENT] Error in hard reset of RealtimeSession: {e_rt}")
                        traceback.print_exc()
                elif msg_type in ("prompt", "user_prompt", "chat", "text", "text_input", "multimodal_prompt", "file_upload"):
                    prompt_text = msg.get("text") or msg.get("prompt") or msg.get("content") or ""
                    file_b64 = msg.get("file") or msg.get("image") or msg.get("data")
                    mime_type = msg.get("mimeType") or msg.get("mime_type") or "image/jpeg"
                    file_name = msg.get("fileName") or msg.get("file_name") or msg.get("name")
                    if prompt_text or file_b64:
                        print(f">>> [AGENT] Received student prompt (text: '{prompt_text}', file: {file_name}) -> Forwarding to Gemini Live...")
                        asyncio.create_task(send_user_multimodal_to_gemini(
                            prompt_text=prompt_text,
                            file_data_b64=file_b64,
                            mime_type=mime_type,
                            file_name=file_name
                        ))
            except Exception as ex:
                print(f">>> [AGENT] Error in on_data_received: {ex}")

        @ctx.room.on("participant_connected")
        def on_participant_connected(participant):
            try:
                if participant.metadata:
                    meta = json.loads(participant.metadata)
                    if "voice" in meta and meta["voice"]:
                        print(f">>> [AGENT] Participant joined with voice metadata: {meta['voice']}")
                        apply_voice_switch(meta["voice"], announce=False)
                    if "style" in meta and meta["style"]:
                        print(f">>> [AGENT] Participant joined with writing style metadata: {meta['style']}")
                        agent._writing_style = meta["style"]
                    if "model" in meta and meta["model"]:
                        new_lvl = meta.get("thinkingLevel") or meta.get("thinking_level") or "high"
                        apply_model_switch(meta["model"], new_lvl)
            except Exception as ex:
                print(f">>> [AGENT] Error in on_participant_connected: {ex}")

        @ctx.room.on("participant_metadata_changed")
        def on_participant_metadata_changed(participant, prev_metadata):
            try:
                if participant.metadata:
                    meta = json.loads(participant.metadata)
                    if "voice" in meta and meta["voice"]:
                        apply_voice_switch(meta["voice"], announce=False)
                    if "style" in meta and meta["style"]:
                        print(f">>> [AGENT] Participant updated writing style metadata: {meta['style']}")
                        agent._writing_style = meta["style"]
                    if "model" in meta and meta["model"]:
                        new_lvl = meta.get("thinkingLevel") or meta.get("thinking_level") or "high"
                        apply_model_switch(meta["model"], new_lvl)
            except Exception as ex:
                print(f">>> [AGENT] Error in on_participant_metadata_changed: {ex}")

        print(">>> [AGENT] Starting session with video_input=True...")
        await session.start(
            room=ctx.room,
            agent=agent,
            room_options=RoomOptions(
                video_input=True,
            ),
        )
        print(">>> [AGENT] Session started! Agent is live with built-in multimodal video pipeline.")

    except Exception as e:
        print(f">>> [AGENT] ERROR: {e}")
        traceback.print_exc()


async def request_fnc(req: JobRequest) -> None:
    print(f">>> [AGENT] Job request received for room: {req.room.name} - accepting...")
    await req.accept()


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            request_fnc=request_fnc,
        )
    )
