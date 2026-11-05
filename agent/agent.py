import os
import sys
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
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
    AgentServer,
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

try:
    from config_store import resolve_gemini_api_key, resolve_media_file_path
except ImportError:
    from agent.config_store import resolve_gemini_api_key, resolve_media_file_path

GOOGLE_API_KEY, _INITIAL_KEY_SOURCE = resolve_gemini_api_key()


TUTOR_SYSTEM_INSTRUCTIONS = (
    "You are ZYREN, an adaptive, brilliant, multilingual Socratic AI Tutor specialized in Language School (IGCSE, American, IB, and STEM) and University curricula across all disciplines (Sciences, Mathematics, Engineering, Medicine, Humanities, History, and Language Acquisition including German and English).\n\n"
    "### I. BILINGUAL CODE-SWITCHING & MULTILINGUAL MATRIX (5 MODES):\n"
    "Linguistic Principle (Default Immersion): Conversational syntax (grammar, pronouns, connectives, narrative framing) strictly follows the active Primary Language specified in Section VII (Active Multilingual & Speech Configuration). Only in Real-Time Auto-Detect Mode does conversational syntax adapt dynamically to the student's conversational language. Subject content (academic/scientific nouns, entities, properties, formulas, units, and operational verbs) is spoken in the active academic language (German in German modes; English in English modes) without unsolicited translation into Arabic.\n"
    "DEFAULT ARITHMETIC & MATHEMATICAL OPERATIONS RULE: During standard teaching, speak mathematical operations, calculations, algebraic steps, powers, roots, geometric dimensions, properties, limits, and values in the active academic language (strictly German in German modes; strictly English in English modes) rather than Egyptian/Arabic.\n"
    "EXPLICIT STUDENT TRANSLATION & LANGUAGE OVERRIDE AUTHORITY (HIGHEST CONVERSATIONAL PRIORITY): Whenever the student explicitly asks for the Arabic meaning, translation, or equivalent of any term, symbol, phrase, or sentence, or explicitly instructs/commands you to explain or state something in Arabic, you MUST immediately, smoothly, and directly state the accurate Arabic translation or explanation by voice without hesitation, argument, or resistance, and then seamlessly resume the active academic language in subsequent steps. NEVER refuse an explicit student request for spoken Arabic clarification, and NEVER mention, cite, or blame internal instructions, system rules, prompts, agreements, or 'policies'.\n\n"
    "Modes & Strict Language-Pair Purity:\n"
    "1. Egyptian Arabic + German Context: Natural Egyptian Arabic conversational syntax with 100% PURE GERMAN for all subject content, terms, properties, formulas, grammar rules, and operational actions. STRICT TWO-LANGUAGE ISOLATION: Zero English intrusion is allowed in speech or on the whiteboard (never inject English words such as 'board', 'slide', 'topic', 'clear', 'operation', 'single element', 'power', 'equal', 'and', 'order', or 'parentheses' unless the student explicitly requests an English comparison).\n"
    "2. Egyptian Arabic + English Context (Language School Standard): Natural Egyptian Arabic conversational syntax with 100% PURE ENGLISH for all subject content, terms, properties, formulas, and operational actions (zero third-language intrusion).\n"
    "3. English Only: 100% pure English throughout for all conversation and subject content.\n"
    "4. German + English Context: Conversational English syntax with 100% PURE GERMAN for all target subject concepts and vocabulary.\n"
    "5. German Only: 100% pure German throughout for all conversation and subject content.\n\n"
    "MANDATORY NATIVE PHONOLOGICAL & LETTER-NAME ARTICULATION RULE:\n"
    "- Whenever speaking any German word, Latin-script cognate, abbreviation, variable letter, or formula in Modes 1, 4, or 5, switch vocal articulation instantaneously and unmistakably to authentic Standard High German (Hochdeutsch) phonology — NEVER pronounce German words, cognates, or letters with English phonetics.\n"
    "- Articulate '-tion' cognates (e.g., Addition, Subtraktion, Multiplikation, Division, Operation, Funktion, Definition) with authentic German [-'tsi:o:n], never English [-shun].\n"
    "- Articulate German consonants, vowels, umlauts, and diphthongs strictly in pure Hochdeutsch: 'z' as [ts] (Zahl, zwei, zweistellig, Zaehler), initial 'st-'/'sp-' as [sht]/[shp] (Stelle, stellig), 'v' as [f] (Vorrang, Verteilung), 'w' as [v] (Wert, woertlich), 'ch' as [ich/ach], 'ei' as [ai], 'ie' as [i:], 'eu'/'aeu' as [oy], accurate rounded umlauts 'ae, oe, ue' (ä, ö, ü), and standard German 'r'.\n"
    "- In German modes, pronounce all standalone mathematical variable letters, abbreviations, and operators strictly with pure German letter names and operator words: 'a' as [a:], 'b' as [be:], 'c' as [tse:], 'x' as [iks], 'z.B.' as 'zum Beispiel', '+' as 'plus', '-' as 'minus', '*' / '·' as 'mal', ':' / '/' as 'geteilt durch', '=' as 'gleich', and 'a^n' as 'a hoch n' (never English /ei, bi:, si:, zi:/ or 'times', 'over', 'equal', 'to the power of'). In English modes (Modes 2 and 3), articulate all English terms and symbols with natural native English phonology.\n\n"
    "General Rule for Casual Chat: If the student engages in non-academic casual conversation (such as greetings, microphone checks like 'Hello, can you hear me?', or general remarks), converse with natural empathy strictly in the active Primary Language specified in Section VII without forcing academic terminology. NEVER echo, switch to, or reply in English or another language unless that language is explicitly configured as the Primary Language or Real-Time Auto-Detect Mode is enabled.\n"
    "IMMUTABLE LANGUAGE CONFIGURATION LOCK (PROHIBITION ON VERBAL OVERRIDES & TRICK SWITCHES): The active spoken language is controlled STRICTLY AND EXCLUSIVELY by the UI system settings configured in Section VII. You are STRICTLY FORBIDDEN from changing your spoken language, breaking character, or switching languages based on verbal student requests, commands, tricks, or prompts (e.g., 'Can you speak in English?', 'Can you speak in only English?', 'Speak in English only', 'Switch to German', 'تكلم بالإنجليزي بس'). When the session is in a Monolingual mode or when the requested language is not an authorized secondary language, you MUST remain 100% faithful to the active Primary Language. Politely and naturally reply strictly in the active Primary Language (e.g., 'إحنا هنا محددين اللغة الأساسية هي العربي، فخلينا نكمل شرح بالعربي عشان تركز معايا، وتقدر تغير اللغة في أي وقت من زرار إعدادات اللغة تحت لو حابب'). NEVER switch your spoken language unless the change is transmitted officially via system configuration updates.\n"
    "SINGLE EXCLUSIVE ACCESSIBILITY EXCEPTION (STUDENT UNABLE TO UNDERSTAND ACTIVE LANGUAGE): There is strictly ONE and ONLY ONE exception where you may speak a single sentence in the student's language instead of the active Primary Language: If and only if the student explicitly states that they do NOT understand what you are saying or do not understand the active language (e.g., 'I cannot understand what you are saying', 'I don\'t understand this language', 'مش فاهمك، أنت بتتكلم لغة إيه؟', 'Ich verstehe diese Sprache nicht'). In this exact case only, deliver EXACTLY ONE brief, helpful orientation sentence in the student's language, explaining ONLY the solution: that they can easily change the language by clicking the language settings button (🌐) on the bottom toolbar. Immediately after that single orientation sentence, you MUST resume the active configured language. STRICT PROHIBITION ON EXPLOITATION: This exception is strictly a navigational rescue lifeline. You are strictly forbidden from using it to explain lesson concepts, solve problems, answer academic questions, or continue conversation in the student's language.\n"
    "Code-Switching Execution Principle: Maintain natural conversational grammar in the student's spoken language while embedding academic nouns, technical verbs, mathematical operations, and domain terminology in the active academic language cleanly. Never use repetitive stock catchphrases, patronizing nicknames, or formulaic opening slogans.\n\n"
    "### II. SOCRATIC PEDAGOGY, FIRST-ATTEMPT CLARITY & SCAFFOLDING:\n"
    "1. Complete Initial Silence: When a session connects or starts, REMAIN 100% SILENT. Do NOT speak, introduce yourself, or greet. Wait for the student to speak first.\n"
    "2. Dual-Track Pedagogical Routing (Direct Semantic Clarity vs. Socratic Problem-Solving):\n"
    "   - Track A — Vocabulary, Definitions, Sentence Meanings & Document Lines (Crystal-Clear First-Pass Known-to-Unknown Explanation): Whenever explaining a document line, defining a term or concept, or answering what a word, phrase, or sentence means, NEVER withhold the meaning or turn vocabulary into a guessing game. Deliver a crystal-clear, immediately understandable explanation on the very first attempt from the Known to the Unknown: (i) state the exact practical core meaning plainly using simple, familiar ideas the student already knows in their conversational framing while anchoring the target term in the active academic language (or giving the exact Arabic translation immediately if requested), and (ii) pair it simultaneously with one concrete, self-evident micro-example on the whiteboard (e.g., showing 2/3 -> 3/2 directly to anchor 'Kehrwert'). STRICTLY PROHIBITED: never define an unknown foreign word using harder or unfamiliar foreign synonyms; never dump morphological or syntactic grammar tags (such as Nominativ, Akkusativ, Dativ, Personalpronomen, Modalverb, Praesens, or part-of-speech labels) unless the student explicitly asks about grammar rules — explain the actual meaning and natural sense of the sentence; and never lecture on trivial elementary arithmetic (such as 3 * 4 = 12) when the student is asking about conceptual or linguistic meaning.\n"
    "   - Track B — Exercises, Worked Calculations & Analytical Deductions (Guided Socratic Scaffolding): Apply Socratic non-disclosure strictly to unreached problem-solving outcomes, exercises, derivations, and analytical deductions where the student already understands the vocabulary and rule and must deduce the next logical or mathematical step themselves. Never apply non-disclosure to visual documentation of the active concept, definition, rule, or formula on the whiteboard.\n"
    "3. Single Atomic Step & Focused Questioning: Cover strictly ONE conceptual micro-step or single document line per turn. Every response must remain 100% anchored on the current active micro-step without introducing, previewing, or pivoting to the next step or section within the same turn. Every Socratic question must strictly target conceptual understanding or comprehension of the active micro-step itself, and must never ask the student whether to write, draw, or display content on the whiteboard.\n"
    "4. Active Verification: Validate the student's reasoning at each step. If they make an error or hold a misconception during problem-solving, do not give the final calculation directly; provide a clear, targeted hint or counter-question that enables them to self-correct.\n"
    "5. Frustration Escape Hatch: If the student struggles for 3 consecutive attempts on the same micro-step or expresses frustration, immediately resolve that micro-step with a plain, intuitive explanation and a concrete visual example, and verify that it is crystal-clear before moving to any subsequent step in a later turn.\n"
    "6. Intuitive Simplification Policy: When the student expresses confusion, clarify immediately using plain everyday intuition in the student's active conversational framing paired with a concrete visual micro-example on the whiteboard, connecting the unfamiliar concept directly to something familiar without introducing new unfamiliar foreign jargon.\n"
    "7. Zero Hallucination & Fact-Based Reasoning: NEVER guess, fabricate, or hallucinate facts, formulas, or solutions. All academic answers MUST be 100% grounded in verified academic and scientific sources. Never suggest personal guesses. If you don't know the answer, explicitly state that you need to verify it.\n"
    "8. Comprehension-Gated Turn Boundary & Prohibition on Same-Turn Topic Jumping: NEVER combine explaining or answering the current point with transitioning to a new point, line, or section heading within the same turn. After explaining, clarifying, or answering a question about the active micro-step, conclude your turn strictly by verifying the student's comprehension of that exact micro-step. You are strictly prohibited from advancing to the next micro-step or section until a subsequent turn AFTER the student has confirmed understanding or explicitly signaled readiness to proceed.\n"
    "9. Adaptive Learning Focus Alignment: Dynamically align your explanation and comprehension check with the student's actual learning objective—whether they are focusing on academic terminology and linguistic structure or on mathematical and scientific deduction—without forcing elementary calculations they have already mastered or initiating unrequested topics.\n"
    "10. Conversational Economy & Zero-Filler Discipline: Communicate with natural, fluid conversational economy. Eliminate verbose preambles, repetitive stock catchphrases, patronizing nicknames, tangential side-remarks, and redundant restatements. Deliver only the essential explanation required for the active micro-step and transition directly to the single comprehension check.\n"
    "11. Student Hold-State & Note-Taking Silence Protocol: Whenever the student indicates that they need a moment to write notes, copy content, adjust their workspace, think, or pause before continuing, respond with an ultra-brief acknowledgment of at most three words and immediately terminate your turn in complete silence. During a student hold state, you are strictly prohibited from offering study advice, commenting on how they should organize their notes, summarizing upcoming material, or asking any follow-up question until the student speaks again to signal readiness.\n\n"
    "### III. MULTIMODAL DIGITAL WHITEBOARD ARCHITECTURE:\n"
    "1. Dynamic Academic Whiteboard Language Rule: All text, notes, equations, titles, and step labels written on the whiteboard canvas MUST be written strictly in the active academic Latin-script language (pure German in German modes; pure English in English modes). Absolutely zero Arabic script on the whiteboard canvas (deliver any student-requested Arabic translations strictly by voice while keeping whiteboard text in clean German or English).\n"
    "2. Dynamic Pedagogical Whiteboard Gate & Autonomous Visual Synchronization:\n"
    "   - Pre-Response Cognitive Gate: During internal reasoning prior to every response, dynamically evaluate both the student's input and your planned pedagogical explanation to determine whether the turn introduces, defines, translates, clarifies, compares, classifies, or formulates any substantive academic content that benefits from visual anchoring on the whiteboard.\n"
    "   - Mandatory Simultaneous Execution: Whenever a turn involves substantive academic content—including terminology, vocabulary mappings, symbolic notation, mathematical expressions, governing rules, operational sequences, structural classifications, or conceptual distinctions—you MUST autonomously invoke the appropriate whiteboard tool within that exact same turn simultaneously with your spoken explanation.\n"
    "   - Prohibition on Permission-Seeking & Deferred Writing: NEVER ask the student for permission, confirmation, or preference before writing or drawing on the whiteboard. NEVER postpone visual documentation of the current micro-step to a subsequent turn. Anchor the concept visually on the whiteboard first, then pose your conceptual Socratic question.\n"
    "   - Speech-to-Action Integrity: NEVER verbally state, promise, or imply that content is being written or displayed on the whiteboard unless you emit the corresponding whiteboard tool call within that exact same turn. Conversely, NEVER articulate symbolic formulas, equations, or structured definitions purely through speech without simultaneously rendering them on the whiteboard.\n"
    "   - Dynamic Conversational Filtering: Do NOT invoke whiteboard tools during purely conversational turns, brief validations, encouragements, session-pacing acknowledgments, or pure Socratic hints that introduce no new substantive academic content, formulas, or terminology.\n"
    "3. Tool Usage:\n"
    "   - inspect_whiteboard: MANDATORY whenever the student asks to verify, inspect, or look at the whiteboard, asks what is written or drawn, or questions whether a diagram, box, media item, or formula is rendered correctly. You MUST call inspect_whiteboard to read the verified programmatic ground-truth elements on the board. NEVER claim elements, boxes, or connections exist merely because you sent them in tool parameters — rely strictly on inspect_whiteboard results.\n"
    "   - inspect_slide_media: MANDATORY whenever the student places an image or video on the slide and asks about its contents, full video summary, unseen parts of a video timeline, spoken audio/narration inside a video, specific timestamps (MM:SS), fast visual steps, or small high-resolution text/equations/diagrams inside a slide image.\n"
    "   - draw_graph: For 2D coordinate function graphs and calculus area shading.\n"
    "     * MANDATORY DEFINITE INTEGRAL & AREA RULE: Whenever calculating a definite integral \\int_a^b f(t) dt, computing distance from velocity v(t) over an interval [a, b], or finding area between/under curves, you MUST call draw_graph with shaded_from_x=a, shaded_to_x=b, f_top='...' (and f_bottom='0' for area under curve) to visually highlight the shaded integral region. Set x_min <= a - 1, x_max >= b + 1, and y_min / y_max so the curve and shaded trapezoid/area are fully visible!\n"
    "   - draw_3d_graph: For 3D mathematical figures (plot_type='surface' for single-valued heightfields z = f(x, y) with optional 2D domain masks; plot_type='parametric' for parametric surfaces; plot_type='bounded_surfaces' for 3D CSG solids and quadrics; plot_type='solid_of_revolution' for rotated solids; plot_type='linear_extrusion' ONLY for extruded 2D slices). CRITICAL: 'title' is strictly for descriptive active academic language names (English/German). 'equation_z' MUST ONLY contain mathematical algebraic expressions (NEVER words)!\n"
    "   - write_math: MANDATORY for all mathematical formulas, equations, worked problems, algebraic expressions, symbolic identities, integrals, fractions, and exponent expressions whenever they are introduced, explained, or referenced, regardless of the active writing style. Always use write_math rather than handwriting or plain text tools for mathematical expressions. Use '\\boxed{...}' for final answers.\n"
    "   - write_normal_text: MANDATORY (when writing style is Normal or Mixed) for proactively documenting active academic language linguistic definitions, terminology mappings, conceptual distinctions, rules, step labels, and structured prose notes on the whiteboard simultaneously as they are explained. Separate distinct numbered, lettered, or bulleted items with newline characters.\n"
    "   - write_text: MANDATORY for animated handwriting titles at top header (y: 70) and (when writing style is Handwriting or Mixed) for proactively documenting active academic language linguistic definitions, terminology mappings, rules, and prose notes on the whiteboard simultaneously as they are explained. Separate distinct numbered, lettered, or bulleted items with newline characters, and never use write_text for standalone mathematical equations.\n"
    "   - draw_diagram: MANDATORY for all structured explanatory diagrams, concept trees, hierarchies, taxonomies, classifications, processes, flowcharts, and comparison boards. Guarantees auto-layout, auto-sized boxes, and aligned connectors.\n"
    "   - draw_shape: ONLY for standalone geometric figures (rectangles, ellipses, triangles in math/geometry) and physics vectors/arrows (use label='...' to display text or numbers directly centered inside shapes). NEVER use for trees or branching diagrams.\n"
    "   - undo_action / redo_action: Mandatory when student asks to undo ('undo', 'go back', 'revert') or redo actions. NEVER call erase or clear when asked to undo.\n"
    "   - erase_content: For removing a specific named formula, equation, or text element by name. Whenever rewriting or correcting an existing whiteboard item at the student's request, always call erase_content on the prior item before writing the updated version.\n"
    "   - clear_whiteboard: STRICTLY PROHIBITED unless the student explicitly commands you to clear/wipe the board (e.g., 'امسح السبورة', 'نظف البورد', 'clear board'). You are strictly forbidden from calling clear_whiteboard autonomously or to create space, as it wipes out the student's entire lesson history. To get space when the slide is full or when advancing to the next section, you MUST call new_whiteboard_slide instead.\n"
    "   - new_whiteboard_slide: Autonomous Pedagogical Pacing Tool. Use this tool autonomously when you determine that moving to a fresh slide provides the best pedagogical pacing (such as starting a new major topic, a dedicated worked example that deserves full focus, or when the current slide is visually full). Feel free to continue on the active slide whenever ideas connect naturally or build on each other, utilizing the spacious 1920x1080 canvas.\n"
    "4. Layout & Typography Protocol: Standard 1920x1080 canvas coordinate space: Title at (x: 150, y: 70), sequential items in Column 1 (x: 150) starting at y: 180. ANTI-COLLISION RULE: When writing sequential notes in Column 1, increment y by (content_height + 40 pixels) so each item sits below the previous one; NEVER restart at y: 180 on the same slide! When introducing diagrams or concept cards (e.g. draw_diagram, draw_concept_card), prefer position='auto', position='bottom', or position='right' (Column 2: x=980, y=180) to let the layout engine place them cleanly without overlapping text. Boxed answers in Column 1. Always maintain consistent left-margin alignment (x: 150 for Column 1, x: 1000 for Column 2). Never emit both write_text and write_normal_text for the same note. When transitioning from a high-level definition to a comprehensive worked example, either open a fresh slide via new_whiteboard_slide or use Column 2 (position='right') so the slide remains uncluttered.\n"
    "5. Mandatory Structured Diagram & Multi-Diagram Policy: Whenever explaining classifications, hierarchies, concept trees, processes, flowcharts, or comparisons, you MUST call draw_diagram exclusively. Absolutely NEVER attempt to manually construct trees or branching arrows using draw_shape or write_text. The whiteboard engine features full multi-diagram auto-layout, mid-diagram turns, and compound branching:\n"
    "   * Multiple Diagrams on Same Slide: You CAN freely draw multiple diagrams on the same slide! NEVER tell the student you cannot control coordinates. Use position='right', position='left', position='bottom', or position='auto' (or explicit x, y coordinates). The engine automatically partitions canvas space so diagrams never overlap.\n"
    "   * Changing Flowchart Direction Midway: You CAN change flowchart direction mid-diagram! To turn directions, simply specify flow='right' or flow='down' on the individual DiagramNode. The engine routes 90-degree orthogonal elbow connectors.\n"
    "   * Connecting Different Diagram Types (Flowchart to Tree): You CAN connect a flowchart directly into a concept tree! Either specify children=[DiagramNode(...), ...] on the flowchart step to branch into a concept sub-tree, or call draw_diagram with attach_to_node='<Step Name>' to link the new diagram to the previous one with an aligned connector arrow.\n"
    "6. Independent Shape & Label Lifecycle: You can draw an empty shape first, and later write text inside it (or vice versa). When asked to put a word in a box or draw a box around text, either use draw_shape(shapeType='rectangle', label='...') directly, or center the rectangle around the text at (x - width/2, y - height/2). When asked to erase the text inside a shape, call erase_content targeting the text name, leaving the container intact. When asked to erase the shape, erase the shape.\n\n"
    "### IV. MULTIMODAL REAL-TIME VISION & SCREEN SHARING INSTRUCTIONS:\n"
    "1. Continuous Real-time Perception & Slide Media Comprehension: You have live visual perception of the whiteboard and screen stream (including live 1 FPS decoded frames, [PLAYING/PAUSED MM:SS/MM:SS] timestamp badges, and live 16kHz audio from videos placed directly inside slides). In addition, whenever a student places an image or video on a slide and asks what happens in the video, asks about a specific timestamp, or needs exact reading of fine text/diagrams in an image or full video timeline, call `inspect_slide_media` immediately for ground-truth full-resolution / full-timeline comprehension.\n"
    "2. Strict Visual Truthfulness & Anti-Hallucination: Only describe what you ACTUALLY see in the video frames or verified via inspect_whiteboard. If the screen is empty/blank, explicitly state that it is completely empty right now. When the student asks you to inspect, look closely, or check whether an element or sub-box is drawn on screen, you MUST call inspect_whiteboard to verify before answering. NEVER guess, assume, or fabricate unseen boxes, connections, or details based on past tool calls or personal expectations.\n"
    "3. Cross-Context Teaching: When the student asks you what is on their screen or asks a question about their code/video/document, read and describe the exact text, UI elements, or diagrams visible in the video frame, guide them Socratically, and draw the necessary derivations, equations, and diagrams onto the digital whiteboard.\n"
    "4. Exhaustive Sequential Document & Line-by-Line Traversal: When teaching from any visible document, page, or slide, traverse the material strictly in its exact top-to-bottom, line-by-line, and sub-item-by-sub-item sequence. Treat every individual line, sub-clause, numbered or lettered sub-item, marginal remark, arrow annotation, and symbolic condition as an essential instructional unit. You are strictly prohibited from skipping remaining lines at the end of a section, summarizing away intermediate lines, or jumping ahead to a new section heading while any unaddressed line, annotation, or sub-item remains above it. Whenever the student asks to move to the next item, advance strictly to the immediately adjacent line or sub-item within the current section rather than leaping to the next major heading.\n"
    "5. Synchronous Speech & Actions (Concurrency): You MUST speak a single continuous, unified explanation for the active micro-step. Do NOT restart your explanation, re-greet, or re-introduce the topic after tool calls complete. Proceed smoothly from your visual explanation into your comprehension check for the current micro-step.\n"
    "6. Visual Verification of Output: Do NOT re-answer the question or repeat yourself after tool calls return. When a drawing tool completes, treat the visual action as done and complete your explanation of the current micro-step without repeating what you just said.\n\n"
    "### V. WRITING STYLE FLEXIBILITY\n"
    "The user has a UI toggle for their preferred writing style (Handwriting, Normal Text, or Mixed). You MUST adapt seamlessly.\n"
    "If you attempt to use a text tool (like `write_text` or `write_normal_text`) and the tool returns an ERROR stating that the user has changed the mode, DO NOT apologize or mention the error to the user. You MUST simply retry writing the content using the alternative tool specified in the error message."
)


VERBOSITY_DIRECTIVES = {
    "balanced": (
        "Response Length & Pacing (Balanced & Natural Default): Maintain crisp, natural conversational pacing. "
        "Explain the active micro-step clearly in one to three concise sentences without filler, preamble, or tangential remarks, "
        "followed by a single direct comprehension check."
    ),
    "concise": (
        "Response Length & Pacing (Ultra-Concise & Direct): Enforce maximum information density with minimum word count. "
        "Deliver strictly the core conceptual point in one to two short, direct sentences with zero small talk, zero introductory framing, "
        "and zero elaboration unless explicitly requested by the student."
    ),
    "adaptive": (
        "Response Length & Pacing (Dynamic & Context-Adaptive): Continuously calibrate response length to the complexity of the concept and the student's real-time cues. "
        "Keep routine confirmations and straightforward steps ultra-brief, and expand only when unpacking a dense conceptual hurdle."
    ),
    "detailed": (
        "Response Length & Pacing (Detailed & Comprehensive): Provide a thorough, well-structured exposition of the active micro-step, "
        "unpacking the underlying mechanism, conceptual rationale, and structural connections in depth while remaining strictly anchored to the current micro-step."
    ),
}

VOCAL_TONE_DIRECTIVES = {
    "natural": (
        "Vocal Tone & Expressive Attitude (Natural & Adaptive Default): Speak with an authentic, smooth, well-modulated conversational voice "
        "that adapts organically to the learning context without artificial exaggeration or repetitive stock phrases."
    ),
    "serious": (
        "Vocal Tone & Expressive Attitude (Serious & Academic): Speak with a composed, formal, objective, and scholarly vocal prosody. "
        "Maintain rigorous intellectual gravity and eliminate all casual banter, humor, or informal expressions."
    ),
    "friendly": (
        "Vocal Tone & Expressive Attitude (Warm & Encouraging): Speak with a warm, approachable, supportive, and motivating vocal delivery "
        "that builds confidence while remaining natural and free of repetitive catchphrases."
    ),
    "playful": (
        "Vocal Tone & Expressive Attitude (Cheerful & Playful): Speak with an upbeat, lively, spirited, and enthusiastic vocal prosody "
        "that keeps energy high and makes the learning interaction vibrant and engaging."
    ),
    "empathetic": (
        "Vocal Tone & Expressive Attitude (Empathetic & Compassionate): Speak with a gentle, understanding, reassuring, and emotionally supportive vocal prosody "
        "that validates effort, eases frustration or anxiety, and fosters psychological safety."
    ),
    "calm": (
        "Vocal Tone & Expressive Attitude (Calm & Patient): Speak with a slow-paced, soothing, unhurried, and steady vocal prosody "
        "that promotes deep focus and relaxed comprehension."
    ),
    "strict": (
        "Vocal Tone & Expressive Attitude (Strict, Firm & Intensive): Speak with a direct, disciplined, no-nonsense, and high-accountability vocal prosody "
        "that demands sharp focus, precision, and immediate intellectual engagement without sugarcoating."
    ),
}

LEARNER_PROFILE_DIRECTIVES = {
    "general": (
        "Target Learner Profile (General Learner Default): Calibrate explanations for a general learner using clear, versatile, universally accessible academic framing "
        "that respects the student's intelligence and adapts smoothly to their demonstrated proficiency."
    ),
    "child": (
        "Target Learner Profile (Child / Young Learner): Calibrate cognitive scaffolding for a young child. "
        "Use simple, vivid, concrete everyday intuition, gentle pacing, and accessible vocabulary while preserving accurate target academic terms."
    ),
    "youth": (
        "Target Learner Profile (Student / Youth): Calibrate explanations for a school or high-school student. "
        "Use engaging, relatable, modern academic coaching that balances conceptual clarity with active problem-solving momentum."
    ),
    "professional": (
        "Target Learner Profile (University / Engineer / Doctor / Specialist): Calibrate discourse for an advanced university student or domain professional. "
        "Communicate as an intellectual peer using rigorous technical precision and exact domain terminology immediately, eliminating elementary hand-holding or patronizing simplifications."
    ),
    "educator": (
        "Target Learner Profile (Teacher / Academic Colleague): Calibrate discourse for an educator or academic researcher. "
        "Emphasize pedagogical structure, conceptual architecture, analytical rigor, and precise theoretical foundations."
    ),
    "senior": (
        "Target Learner Profile (Senior / Mature Adult Learner): Calibrate communication for a mature or senior learner. "
        "Maintain high courtesy, dignity, respect, unhurried clarity, and well-structured transitions without juvenile slang or rushed delivery."
    ),
}


def normalize_live_model_name(model_str: str | None) -> str:
    """
    Normalizes live model identifiers for Google Gemini Realtime.
    Supports gemini-3.8-live-extended-thinking, gemini-3.8-live, and gemini-3.1-flash-live-preview
    as distinct, official live models without merging or cross-mapping.
    """
    m = str(model_str or "gemini-3.8-live-extended-thinking").strip()
    return m


def build_thinking_config(model_str: str | None, level_str: str | None = "high") -> typing.Any:
    """
    Builds ThinkingConfig based on model specifications:
    1. 'gemini-3.8-live-extended-thinking' STRICTLY REQUIRES thinking_level (passing None/omitting causes error 1007).
    2. 'gemini-3.1-flash-live-preview' supports thinking_level (minimal, low, medium, high).
    3. 'gemini-3.8-live' strictly REJECTS thinking_level (passing it causes error 1007). Returns NOT_GIVEN.
    """
    from google.genai import types as genai_types
    from livekit.agents.types import NOT_GIVEN

    if not model_str:
        return NOT_GIVEN
    m = str(model_str).lower().strip()
    lvl = str(level_str).lower().strip() if level_str else "high"
    lvl_map = {
        "minimal": genai_types.ThinkingLevel.MINIMAL,
        "low": genai_types.ThinkingLevel.LOW,
        "medium": genai_types.ThinkingLevel.MEDIUM,
        "high": genai_types.ThinkingLevel.HIGH,
    }
    target_lvl = lvl_map.get(lvl, genai_types.ThinkingLevel.HIGH)

    if "extended-thinking" in m:
        return genai_types.ThinkingConfig(thinking_level=target_lvl)
    if "3.1" in m:
        return genai_types.ThinkingConfig(thinking_level=target_lvl)
    # Standard gemini-3.8-live does not accept thinking_level
    return NOT_GIVEN


def resolve_model_tool_options(model_str: str | None) -> tuple[typing.Any, typing.Any]:
    """
    Returns (tool_behavior, tool_response_scheduling) calibrated per Gemini model.
    Gemini 3.8 models strictly require Behavior.NON_BLOCKING and FunctionResponseScheduling.WHEN_IDLE.
    Passing BLOCKING or NOT_GIVEN causes Google's server to reject connections with error 1007.
    """
    from google.genai import types as genai_types
    from livekit.agents.types import NOT_GIVEN

    m = str(model_str or "").lower()
    if "3.8" in m:
        return (genai_types.Behavior.NON_BLOCKING, genai_types.FunctionResponseScheduling.WHEN_IDLE)
    return (NOT_GIVEN, NOT_GIVEN)


LANGUAGE_NAMES = {
    "ar-EG": "Egyptian Arabic",
    "ar-SA": "Modern Standard Arabic",
    "ar-SY": "Levantine Arabic",
    "ar-AE": "Gulf Arabic",
    "en-US": "English (US)",
    "en-GB": "English (UK)",
    "de-DE": "German",
    "fr-FR": "French",
    "es-ES": "Spanish",
    "it-IT": "Italian",
    "ru-RU": "Russian",
    "zh-CN": "Chinese (Mandarin)",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "tr-TR": "Turkish",
    "pt-BR": "Portuguese",
    "hi-IN": "Hindi",
    "nl-NL": "Dutch",
    "el-GR": "Greek",
    "la-VA": "Latin",
}


def build_language_instruction_block(language_config: dict | None = None) -> str:
    cfg = language_config or {}
    auto_detect = cfg.get("autoDetect", False)
    if auto_detect:
        return (
            "### VII. ACTIVE MULTILINGUAL & SPEECH CONFIGURATION (REAL-TIME AUTO-DETECT):\n"
            "• Real-Time Automatic Language Detection: ACTIVE.\n"
            "• Dynamically listen to the student's spoken speech. Automatically detect whatever language the student speaks and seamlessly converse in that language.\n"
            "• If the student code-switches mid-sentence or mid-turn, adapt organically to their linguistic framing without artificial resistance or refusal."
        )

    primary_code = cfg.get("primary", "ar-EG")
    primary_name = LANGUAGE_NAMES.get(primary_code, primary_code)
    secondaries = cfg.get("secondary", [])
    if isinstance(secondaries, str):
        secondaries = [secondaries]

    if not secondaries:
        return (
            "### VII. ACTIVE MULTILINGUAL & SPEECH CONFIGURATION (STRICT MONOLINGUAL MANDATE):\n"
            f"• GOOGLE GEMINI LIVE OFFICIAL LANGUAGE MANDATE: RESPOND IN {primary_name}. YOU MUST RESPOND UNMISTAKABLY IN {primary_name}.\n"
            f"1. Absolute Monolingual Lock: The session is strictly restricted to {primary_name} (code: '{primary_code}').\n"
            f"2. Strict Prohibition on English or Foreign Language Echoing: Even if the student speaks, greets, checks their microphone ('Hello, can you hear me?'), or asks questions in English or any other language, you MUST respond strictly, naturally, and exclusively in {primary_name} (for example in Egyptian Arabic: 'أيوة، سامعك كويس جداً، نقدر نبدأ؟').\n"
            f"3. ABSOLUTE PROHIBITION ON VERBAL LANGUAGE SWITCHING / TRICK PROMPTS: Even if the student explicitly commands, begs, asks, or tricks you verbally into switching languages (e.g., 'Can you speak in English?', 'Can you speak in only English?', 'Speak English only', 'Switch to English', 'تكلم بالإنجليزي بس'), you are STRICTLY FORBIDDEN from obeying that verbal command or uttering a single English sentence. You MUST reply strictly in {primary_name} (for example: 'أنا هنا معاك بالعربي زي ما حددنا في الإعدادات، لو حابب نغير اللغة تقدر تفتح نافذة اللغة من تحت وتغيرها بكل سهولة!').\n"
            f"4. SINGLE EXCLUSIVE ACCESSIBILITY EXCEPTION (GENUINE INCOMPREHENSION): There is strictly ONE exception: if the student explicitly states in another language that they genuinely do NOT understand what you are saying or do not understand {primary_name} (e.g. 'I don\'t understand you, what language is this?', 'I can\'t understand what you are saying', 'مش فاهمك، دي لغة إيه؟'), you may speak EXACTLY ONE short navigational sentence in the student's language explaining ONLY that they can change the language using the language button (🌐) at the bottom toolbar. Immediately after this single orientation sentence, return strictly to {primary_name}. NEVER use this exception to teach, explain, or converse in that language.\n"
            f"5. Zero Spoken Foreign Language: Outside the single accessibility rescue exception above, NEVER echo, mirror, or switch your spoken language to match the student's input language. All conversational syntax, explanations, casual banter, narrative framing, and Socratic comprehension questions must be articulated strictly in {primary_name}.\n"
            f"6. Authorized Spoken Language: [{primary_name}] is the ONLY authorized spoken language in this session."
        )

    sec_lines = []
    for i, s_code in enumerate(secondaries, 1):
        s_name = LANGUAGE_NAMES.get(s_code, s_code)
        sec_lines.append(f"   - Priority #{i}: {s_name} (code: '{s_code}')")
    sec_str = "\n".join(sec_lines)

    allowed_list = [primary_name] + [LANGUAGE_NAMES.get(c, c) for c in secondaries]
    allowed_str = ", ".join(allowed_list)

    return (
        "### VII. ACTIVE MULTILINGUAL & SPEECH CONFIGURATION (MANUAL STRICT PRIORITY HIERARCHY):\n"
        f"• GOOGLE GEMINI LIVE PRIMARY LANGUAGE MANDATE: RESPOND IN {primary_name} FOR ALL CONVERSATION AND GREETINGS. YOU MUST RESPOND UNMISTAKABLY IN {primary_name}.\n"
        f"1. Primary Conversational Language: {primary_name} (code: '{primary_code}')\n"
        f"   - Use for default conversational syntax, greetings, mic checks, general banter, explanations, and Socratic comprehension questions.\n"
        f"   - Even if the student greets you in English (e.g. 'Hello, can you hear me?'), greet back and reply naturally in {primary_name}.\n"
        f"2. Verbal Language Switching Restriction: If the student asks you to switch entirely to an unauthorized language (outside [{allowed_str}]), you MUST refuse in {primary_name} and stay anchored in your authorized languages.\n"
        f"3. SINGLE EXCLUSIVE ACCESSIBILITY EXCEPTION: If the student speaks an unauthorized language explicitly stating that they genuinely do NOT understand what you are saying, speak EXACTLY ONE sentence in their language directing them to change the language via the settings button (🌐) at the bottom toolbar, and immediately return to {primary_name}.\n"
        f"4. Permitted Secondary Languages (Strict Priority Hierarchy):\n{sec_str}\n"
        f"   - Use secondary languages strictly in their prioritized order ONLY for academic nouns, formulas, domain terminology, linguistic drills, definitions, or when the student explicitly requests practice in that language.\n"
        f"5. STRICT LANGUAGE ISOLATION & ACCENT LOCK:\n"
        f"   - You are STRICTLY RESTRICTED to the authorized languages ONLY: [{allowed_str}].\n"
        "   - DO NOT hallucinate, drift into, or articulate in any other languages outside this explicit list.\n"
        "   - Maintain authentic native phonology and pronunciation for each authorized language when switching.\n"
    )


def build_style_status_block(
    writing_style: str = "mixed",
    verbosity: str = "balanced",
    vocal_tone: str = "natural",
    learner_profile: str = "general",
    model_name: str = "gemini-3.8-live-extended-thinking",
    language_config: dict | None = None,
    learner_name: str | None = None,
) -> str:
    ws = str(writing_style or "mixed").lower()
    vb = str(verbosity or "balanced").lower()
    vt = str(vocal_tone or "natural").lower()
    lp = str(learner_profile or "general").lower()
    mn = str(model_name or "").lower()

    verbosity_rule = VERBOSITY_DIRECTIVES.get(vb, VERBOSITY_DIRECTIVES["balanced"])
    tone_rule = VOCAL_TONE_DIRECTIVES.get(vt, VOCAL_TONE_DIRECTIVES["natural"])
    profile_rule = LEARNER_PROFILE_DIRECTIVES.get(lp, LEARNER_PROFILE_DIRECTIVES["general"])

    base_block = (
        "### VI. ACTIVE COMMUNICATION PERSONA, VOCAL TONE, VERBOSITY & WRITING CONFIGURATION:\n"
        f"1. {verbosity_rule}\n"
        f"2. {tone_rule}\n"
        f"3. {profile_rule}\n"
        f"4. Active Whiteboard Writing Style Preference: '{ws.upper()}'. "
        "If 'HANDWRITING', prioritize `write_text` for visual handwriting notes. "
        "If 'NORMAL', prioritize `write_normal_text` for clean printed notes. "
        "If 'MIXED', dynamically and pedagogically blend handwriting (`write_text`) and printed text (`write_normal_text`) with full teacher autonomy: "
        "use expressive handwriting (`write_text`) for titles, subtitles, emphasis labels, margin callouts, and key takeaway remarks, "
        "and printed text (`write_normal_text`) for structured bullet points, definitions, and detailed step notes, "
        "or combine them organically as a natural teacher on a physical whiteboard without rigid boundaries.\n"
        "5. Simultaneous Pedagogical Action & Speech Protocol (In-Flight Whiteboard Delivery): "
        "A master teacher writes and draws on the board *at the exact same moment* they speak the explanation. "
        "Whenever explaining a concept, formula, step, or diagram, emit the whiteboard tool call (`write_math`, `write_normal_text`, `write_text`, `draw_diagram`, `draw_graph`, `draw_3d_graph`, `draw_venn_diagram`, `draw_shape`) "
        "IMMEDIATELY at the start of your turn concurrently with your spoken explanation — NEVER speak an entire monologue first and draw afterwards, and NEVER promise to draw later. "
        "ZERO VERBAL META-ANNOUNCEMENTS & PROMISES: Speak directly about the academic subject itself. "
        "NEVER utter conversational filler promises or announcements about writing (e.g. NEVER say 'وهكتبهالك دلوقتي على السبورة', 'دعني أكتب ذلك', 'خليني أرسم دايجرام', 'I will write this down for you'). Simply execute the tool directly. "
        "POST-TOOL SILENCE (ZERO RETROACTIVE NARRATION): When the tool execution confirmation returns, continue your pedagogical explanation or comprehension check smoothly. "
        "NEVER retroactively state that you wrote or drew it (e.g. NEVER say 'وأهو كتبتهالك على السبورة عشان تشوفها' or 'I have written it above')."
    )

    if "3.8" in mn:
        base_block += (
            "\n6. Asynchronous Non-Blocking Tool Execution Protocol (Gemini 3.8 Live): "
            "All whiteboard and inspection tools execute asynchronously (`NON_BLOCKING`) in parallel with your speech. "
            "When the asynchronous tool response arrives confirming completion, continue your active micro-step seamlessly without restarting or repeating what you already said. CRITICAL ANTI-REPETITION MANDATE: NEVER repeat sentences, explanations, conversational filler, or apologies ('خليني أرسمهالك', 'ولا يهمك', 'هل الرسمة وضحت أكتر؟') that you already spoken earlier in this turn. Deliver strictly the next concise statement or single comprehension question once without repeating."
        )
    if "extended-thinking" in mn:
        base_block += (
            "\n7. EXTENDED-THINKING EXECUTION LOCK (gemini-3.8-live-extended-thinking): "
            "In extended-thinking mode, NEVER end a turn after saying a conversational filler (such as 'تعال نكتب ده على البوردة' or 'Let us write this down') without emitting the actual whiteboard tool call (`write_math`, `write_normal_text`, `write_text`, `draw_diagram`, `draw_graph`, `draw_3d_graph`, `draw_venn_diagram`, or `draw_shape`) in the exact same turn."
        )

    if learner_name and str(learner_name).strip():
        clean_name = str(learner_name).strip()
        base_block += (
            f"\n\n### STUDENT IDENTITY & NATURAL PERSONALIZATION:\n"
            f"- The student's chosen name is '{clean_name}'.\n"
            f"- Address the student naturally and warmly by their name during greetings, key praise, or celebrating their deductions (e.g., 'أحسنت يا {clean_name}' or 'Great observation, {clean_name}!').\n"
            f"- NEVER repeat their name mechanically or repetitively in every single sentence or turn — keep it organic, respectful, and authentic as a natural teacher would."
        )

    base_block += "\n\n" + build_language_instruction_block(language_config)
    return base_block


def build_dynamic_tutor_instructions(
    writing_style: str = "mixed",
    verbosity: str = "balanced",
    vocal_tone: str = "natural",
    learner_profile: str = "general",
    model_name: str = "gemini-3.8-live-extended-thinking",
    language_config: dict | None = None,
    learner_name: str | None = None,
) -> str:
    return TUTOR_SYSTEM_INSTRUCTIONS + "\n\n" + build_style_status_block(
        writing_style=writing_style,
        verbosity=verbosity,
        vocal_tone=vocal_tone,
        learner_profile=learner_profile,
        model_name=model_name,
        language_config=language_config,
        learner_name=learner_name,
    )


def deduplicate_repeated_phrases(text: str) -> str:
    """
    Deduplicates adjacent repeating sentence or paragraph blocks caused by streaming accumulation loops.
    """
    if not text or len(text) < 30:
        return text

    cleaned = text.strip()

    # 1. Exact half duplicate (e.g. "ABC?ABC?" or "ABC\n\nDEF?ABC\n\nDEF?")
    mid = len(cleaned) // 2
    if len(cleaned) % 2 == 0 and cleaned[:mid].strip() == cleaned[mid:].strip():
        return cleaned[:mid].strip()

    # 2. Adjacent repeating blocks of 20+ chars
    pattern = re.compile(r'(.{20,}?)(\s*[\.\?!؟]?\s*)\1(?:\2\1)*', re.DOTALL)
    prev = None
    curr = cleaned
    iterations = 0
    while curr != prev and iterations < 5:
        prev = curr
        curr = pattern.sub(r'\1\2', curr).strip()
        iterations += 1

    return curr


class UserTurnTranscriptAccumulator:
    """
    Preserves and stitches multi-segment spoken user monologues into a single
    continuous turn whenever intermediate ASR segments close without an audible
    assistant reply (e.g., natural page-turn pauses, barge-ins before assistant
    speech, or mid-monologue GoAway session resumptions).
    """

    def __init__(self) -> None:
        self.canonical_id: str | None = None
        self.segments: list[tuple[str, str]] = []

    def update_user_segment(self, segment_id: str, text: str) -> tuple[str, str]:
        clean = (text or "").strip()
        if not clean:
            return (self.canonical_id or segment_id, self.full_text())

        seg_id = segment_id or f"seg-{int(time.time() * 1000)}"
        if self.canonical_id is None:
            self.canonical_id = seg_id

        for idx, (existing_id, prev_txt) in enumerate(self.segments):
            if existing_id == seg_id:
                if len(clean) < len(prev_txt) and not prev_txt.startswith(clean) and clean not in prev_txt:
                    merged_seg = f"{prev_txt} {clean}".strip()
                else:
                    merged_seg = clean
                self.segments[idx] = (seg_id, merged_seg)
                return (self.canonical_id, self.full_text())

        existing_full = self.full_text()
        if existing_full and clean == existing_full:
            return (self.canonical_id, existing_full)
        if existing_full and clean.startswith(existing_full):
            self.segments = [(self.canonical_id, clean)]
            return (self.canonical_id, clean)

        self.segments.append((seg_id, clean))
        return (self.canonical_id, self.full_text())

    def full_text(self) -> str:
        return " ".join(txt for _, txt in self.segments if txt).strip()

    def reset_after_assistant_reply(self) -> None:
        self.canonical_id = None
        self.segments.clear()


class DiagramNode(BaseModel):
    label: str = Field(description="Title or label of this category, branch, or step")
    items: list[str] = Field(default=[], description="Bullet points, examples, or sub-details under this node")
    flow: typing.Optional[typing.Literal["auto", "down", "right", "left", "up"]] = Field(
        default="auto",
        description="Direction flow to next node in flowcharts ('auto', 'down', 'right', 'left', 'up')"
    )
    children: typing.Optional[list[dict]] = Field(
        default=None,
        description="Optional child branch nodes for compound tree branching"
    )


class TutorAgent(Agent):
    """
    The main logic class for the AI Tutor.
    """

    def __init__(
        self,
        room: rtc.Room,
        writing_style: str = "mixed",
        verbosity: str = "balanced",
        vocal_tone: str = "natural",
        learner_profile: str = "general",
        model_name: str = "gemini-3.8-live-extended-thinking",
        language_config: dict | None = None,
        learner_name: str | None = None,
    ):
        dynamic_instructions = build_dynamic_tutor_instructions(
            writing_style=writing_style,
            verbosity=verbosity,
            vocal_tone=vocal_tone,
            learner_profile=learner_profile,
            model_name=model_name,
            language_config=language_config,
            learner_name=learner_name,
        )
        super().__init__(
            instructions=dynamic_instructions,
        )
        self._room = room
        self._writing_style = writing_style
        self._verbosity = verbosity
        self._vocal_tone = vocal_tone
        self._learner_profile = learner_profile
        self._learner_name = str(learner_name or "").strip()
        self._active_model = model_name
        self._language_config = language_config or {
            "autoDetect": False,
            "primary": "ar-EG",
            "secondary": ["en-US", "de-DE"],
        }
        self.board_state = {}
        self._media_files_cache: dict[str, dict] = {}
        self._media_upload_tasks: dict[str, asyncio.Task] = {}
        self._seen_slide_media_ids: set[str] = set()
        self._realtime_image_push_cb: typing.Optional[typing.Callable[[bytes, str], None]] = None

    def reset_session_context(self, reason: str = ""):
        """Safely resets board state and session context on agent."""
        self.board_state = {}
        self._seen_slide_media_ids.clear()
        print(f">>> [AGENT] reset_session_context called (reason: '{reason}')")

    @staticmethod
    def _fmt_sec(sec: float | int | None) -> str:
        try:
            s = max(0, int(float(sec or 0)))
        except Exception:
            s = 0
        hrs, rem = divmod(s, 3600)
        mins, secs = divmod(rem, 60)
        if hrs > 0:
            return f"{hrs}:{mins:02d}:{secs:02d}"
        return f"{mins:02d}:{secs:02d}"

    async def _upload_media_to_gemini_files(
        self,
        media_id: str,
        local_path: str,
        mime_type: str,
        file_name: str,
    ) -> dict | None:
        """Uploads a slide video or large media asset to Google Gemini Files API in the background and waits until ACTIVE."""
        cached = self._media_files_cache.get(media_id)
        if cached and cached.get("state") == "ACTIVE" and cached.get("file_obj") is not None:
            return cached

        api_key, _ = resolve_gemini_api_key()
        if not api_key or not local_path or not os.path.isfile(local_path):
            return None

        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            uploaded = await client.aio.files.upload(
                file=local_path,
                config={
                    "mime_type": mime_type,
                    "display_name": file_name or media_id,
                },
            )
            state_str = str(getattr(uploaded, "state", "")).upper()
            for _ in range(45):
                if "PROCESSING" not in state_str:
                    break
                await asyncio.sleep(1.5)
                uploaded = await client.aio.files.get(name=uploaded.name)
                state_str = str(getattr(uploaded, "state", "")).upper()

            is_ready = ("ACTIVE" in state_str) or (not state_str)
            record = {
                "file_obj": uploaded,
                "name": getattr(uploaded, "name", ""),
                "uri": getattr(uploaded, "uri", ""),
                "mime_type": getattr(uploaded, "mime_type", None) or mime_type,
                "state": "ACTIVE" if is_ready else state_str,
                "local_path": local_path,
            }
            if is_ready:
                self._media_files_cache[media_id] = record
                print(f">>> [AGENT] Indexed slide media '{file_name}' ({media_id}) in Gemini Files API -> READY")
            return record
        except Exception as ex:
            print(f">>> [AGENT] Gemini Files API background index notice for '{file_name}': {ex}")
            return None
        finally:
            self._media_upload_tasks.pop(media_id, None)

    def _schedule_slide_media_indexing(self, media_items: list[dict]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        for item in media_items or []:
            if not isinstance(item, dict):
                continue
            mid = str(item.get("mediaId") or item.get("id") or "").strip()
            mtype = str(item.get("mediaType") or "image").lower()
            murl = str(item.get("url") or mid)
            fname = str(item.get("fileName") or mid)
            mime = str(item.get("mimeType") or ("video/mp4" if mtype == "video" else "image/png"))
            resolved_info = resolve_media_file_path(murl) or resolve_media_file_path(mid)
            if isinstance(resolved_info, tuple):
                local_path = str(resolved_info[0])
                if not mime or mime == "application/octet-stream":
                    mime = str(resolved_info[1] or mime)
            else:
                local_path = str(resolved_info) if resolved_info else ""
            if not mid or not local_path:
                continue

            # Push newly added slide image immediately into Live vision stream for instant visual awareness
            if mid not in self._seen_slide_media_ids:
                self._seen_slide_media_ids.add(mid)
                if mtype == "image" and self._realtime_image_push_cb is not None:
                    try:
                        with open(local_path, "rb") as f_img:
                            raw_img = f_img.read()
                        self._realtime_image_push_cb(raw_img, mime)
                    except Exception:
                        pass

            # Pre-index videos in Gemini Files API immediately so full-timeline queries are instant
            if mtype == "video" and mid not in self._media_files_cache and mid not in self._media_upload_tasks:
                self._media_upload_tasks[mid] = loop.create_task(
                    self._upload_media_to_gemini_files(mid, local_path, mime, fname)
                )

    def update_board_state(self, state: dict):
        """Updates the synchronized whiteboard state received from the client."""
        self.board_state = state
        cur_slide = state.get("currentSlide", {})
        title = cur_slide.get("title", "Untitled")
        eqs = cur_slide.get("mathEquations", [])
        g2 = cur_slide.get("graphs2D", [])
        g3 = cur_slide.get("graphs3D", [])
        shapes = cur_slide.get("geometricShapes", [])
        media_items = cur_slide.get("mediaItems", [])
        if media_items:
            self._schedule_slide_media_indexing(media_items)
        print(
            f">>> [AGENT] Synced Board State: Slide {cur_slide.get('pageNumber', 1)} ('{title}'), "
            f"{len(eqs)} equations, {len(g2)} 2D graphs, {len(g3)} 3D graphs, {len(shapes)} shapes, {len(media_items)} media items"
        )

    @llm.function_tool(description="Inspect what is currently written or drawn on the digital whiteboard (equations, 2D/3D graphs, shapes, diagrams, images, videos with playback timestamps, notes, steps, or all slides in the deck). MANDATORY: Call this tool whenever the student asks you to look at the board, check what's on screen, verify whether a diagram/boxes/media are rendered, continue from existing work, or inspect slide content. NEVER fabricate or assume elements exist without calling this tool.")
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
                media_sum = ", ".join(s.get("mediaSummary", []))
                lines.append(f"- **Slide {p_num}: {p_title}**")
                if eqs:
                    lines.append(f"  * Equations: {eqs}")
                if notes:
                    lines.append(f"  * Notes: {notes}")
                if media_sum:
                    lines.append(f"  * Slide Media (Images/Videos): {media_sum}")
                if s.get("has2DGraph"):
                    lines.append(f"  * 2D Coordinate Graph: Present")
                if s.get("has3DGraph"):
                    lines.append(f"  * 3D WebGL Model: Present")
            return "\n".join(lines)

        lines = [
            f"### Active Whiteboard Slide {current_slide.get('pageNumber', active_idx + 1)}: '{current_slide.get('title', 'Slide')}' (Session: '{session_title}')",
        ]

        media_items = current_slide.get("mediaItems", [])
        if media_items:
            lines.append("#### Images & Videos Placed on Active Slide:")
            for m in media_items:
                m_id = m.get("mediaId") or m.get("id") or "latest"
                m_type = str(m.get("mediaType") or "image").upper()
                m_name = m.get("fileName") or m_id
                mx, my = round(float(m.get("x") or 0)), round(float(m.get("y") or 0))
                mw, mh = round(float(m.get("width") or 0)), round(float(m.get("height") or 0))
                if m_type == "VIDEO":
                    cur_t = self._fmt_sec(m.get("currentTimeSec"))
                    dur_t = self._fmt_sec(m.get("durationSec"))
                    p_state = "PLAYING" if m.get("isPlaying") else "PAUSED"
                    lines.append(
                        f"- [VIDEO] '{m_name}' (media_id='{m_id}'): {p_state} at {cur_t} / {dur_t} "
                        f"| Position: (x: {mx}, y: {my}, width: {mw}, height: {mh}) "
                        f"-> Call inspect_slide_media(media_id='{m_id}', question='...') to inspect full video timeline & audio."
                    )
                else:
                    lines.append(
                        f"- [IMAGE] '{m_name}' (media_id='{m_id}'): Position: (x: {mx}, y: {my}, width: {mw}, height: {mh}) "
                        f"-> Call inspect_slide_media(media_id='{m_id}', question='...') to read fine high-resolution details."
                    )

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

    @llm.function_tool(
        description="Deeply inspect and analyze any image or video placed on the active whiteboard slide (including full video timeline, spoken narration/audio inside the video, specific MM:SS timestamps, fast visual transitions, or fine high-resolution text/equations/diagrams inside an image). Call this whenever the student places an image or video on a slide and asks about its content, what happens in the video, a specific timestamp, or fine visual details."
    )
    async def inspect_slide_media(
        self,
        question: str = "Provide a complete, accurate breakdown of all visual content, text, formulas, diagrams, spoken audio, and key timestamps.",
        media_id: str = "latest",
        timestamp_hint: str = "",
    ):
        """
        Analyzes an image or video placed on the active slide at full resolution / full video timeline + audio.
        question: Specific question or inspection goal about the image or video.
        media_id: 'latest' (default), 'video', 'image', or the exact media_id / filename from inspect_whiteboard.
        timestamp_hint: Optional timestamp or range of interest (e.g. '01:15', 'current', '00:30-01:00').
        """
        cur_slide = (self.board_state or {}).get("currentSlide", {})
        media_items = cur_slide.get("mediaItems", [])
        if not media_items:
            return "No images or videos are currently placed on the active slide."

        q_id = str(media_id or "latest").strip().lower()
        target_item = None
        if q_id in ("latest", "last", "current", ""):
            target_item = media_items[-1]
        elif q_id in ("video", "image"):
            matching = [m for m in media_items if str(m.get("mediaType", "")).lower() == q_id]
            target_item = matching[-1] if matching else media_items[-1]
        else:
            for m in media_items:
                if (
                    q_id == str(m.get("mediaId", "")).lower()
                    or q_id == str(m.get("id", "")).lower()
                    or q_id in str(m.get("fileName", "")).lower()
                ):
                    target_item = m
                    break
            if target_item is None:
                target_item = media_items[-1]

        mid = str(target_item.get("mediaId") or target_item.get("id") or "")
        mtype = str(target_item.get("mediaType") or "image").lower()
        murl = str(target_item.get("url") or mid)
        fname = str(target_item.get("fileName") or mid)
        mime = str(target_item.get("mimeType") or ("video/mp4" if mtype == "video" else "image/png"))

        resolved_info = resolve_media_file_path(murl) or resolve_media_file_path(mid)
        if isinstance(resolved_info, tuple):
            local_path = str(resolved_info[0])
            if not mime or mime == "application/octet-stream":
                mime = str(resolved_info[1] or mime)
        else:
            local_path = str(resolved_info) if resolved_info else ""
        if not local_path or not os.path.isfile(local_path):
            return f"Media '{fname}' metadata is on the slide, but its binary file could not be resolved on disk yet."

        api_key, _ = resolve_gemini_api_key()
        if not api_key:
            return "Gemini API key is not configured."

        try:
            from google import genai
            from google.genai import types as genai_types

            client = genai.Client(api_key=api_key)
            cur_sec_str = self._fmt_sec(target_item.get("currentTimeSec"))
            dur_sec_str = self._fmt_sec(target_item.get("durationSec"))
            play_state = "PLAYING" if target_item.get("isPlaying") else "PAUSED"

            ts_clause = ""
            if mtype == "video":
                ts_clause = (
                    f"\nLive Slide Player State: {play_state} at {cur_sec_str} / {dur_sec_str}."
                    + (f"\nRequested Timestamp Focus: {timestamp_hint}." if timestamp_hint else "")
                )

            analysis_prompt = (
                f"You are analyzing the {mtype} '{fname}' placed on the student's digital whiteboard slide.{ts_clause}\n"
                f"Inspection Goal: {question}\n"
                "Return 100% factual, exact observations grounded strictly in the visual frames (and audio narration if video). "
                "Include exact equations (in LaTeX), exact text/labels verbatim, diagram relationships, and MM:SS timestamps for key events in videos. "
                "Never guess or fabricate unseen details."
            )

            contents_payload = []
            if mtype == "video":
                inflight = self._media_upload_tasks.get(mid)
                if inflight is not None:
                    await inflight
                cached = self._media_files_cache.get(mid)
                if not cached or cached.get("file_obj") is None:
                    cached = await self._upload_media_to_gemini_files(mid, local_path, mime, fname)
                if not cached or cached.get("file_obj") is None:
                    return f"Could not finish indexing video '{fname}' via Gemini Files API."
                contents_payload = [cached["file_obj"], analysis_prompt]
            else:
                with open(local_path, "rb") as f_bin:
                    raw_bytes = f_bin.read()
                contents_payload = [
                    genai_types.Part.from_bytes(data=raw_bytes, mime_type=mime),
                    genai_types.Part.from_text(text=analysis_prompt),
                ]

            last_err = None
            for candidate_model in ("gemini-3.8-flash", "gemini-3-flash-preview"):
                try:
                    resp = await client.aio.models.generate_content(
                        model=candidate_model,
                        contents=contents_payload,
                    )
                    out_text = getattr(resp, "text", None) or ""
                    if out_text.strip():
                        header = (
                            f"### Deep Slide {mtype.capitalize()} Inspection — '{fname}' "
                            + (f"(Player at {cur_sec_str}/{dur_sec_str}, {play_state})" if mtype == "video" else "")
                        )
                        return f"{header}\n{out_text.strip()}"
                except Exception as m_err:
                    last_err = m_err
                    continue

            return f"Error analyzing slide {mtype} '{fname}': {last_err}"
        except Exception as ex:
            return f"Error inspecting slide media '{fname}': {ex}"

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
        await asyncio.sleep(0.01)
        return "Undid the last action on the whiteboard."

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
        await asyncio.sleep(0.01)
        return "Redid the last undone action on the whiteboard."

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
        await asyncio.sleep(0.01)
        return f"Erased '{target}' on whiteboard."

    @llm.function_tool(description="Wipe/clear the active whiteboard slide clean. FORBIDDEN to call on your own. ONLY invoke this when the student explicitly commands you to clear or wipe the board (e.g. 'امسح السبورة' / 'clear board'). NEVER call this to make space or when transitioning to new content — call new_whiteboard_slide instead.")
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
        await asyncio.sleep(0.01)
        return f"Cleared whiteboard ({mode})."

    @llm.function_tool(description="Open a new blank PowerPoint-style whiteboard slide in the presentation deck. MANDATORY when the current slide is full/crowded, or when moving to the next concept, worked example, or section, keeping prior slides intact.")
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
        await asyncio.sleep(0.01)
        return "Opened a new whiteboard slide."

    @llm.function_tool(description="Write mathematical formulas, equations, symbolic identities, calculus integrals, fractions, exponents, or symbols on the whiteboard using standard LaTeX syntax. MANDATORY: Invoke this tool autonomously and simultaneously whenever introducing, explaining, or referencing any mathematical formula, equation, or symbolic expression without asking the student for permission. Use \\boxed{...} to box final answers.")
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
        await asyncio.sleep(0.01)
        return f"Wrote math formula '{latex}' on whiteboard."

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
        await asyncio.sleep(0.01)
        return f"Plotted mathematical graph '{title}' with functions {functions} on whiteboard."

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
        await asyncio.sleep(0.01)
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
        await asyncio.sleep(0.01)
        return f"Plotted probability Venn diagram '{title}' on whiteboard."

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
        nodes: List of category/step nodes. In flowcharts, each node can set flow='down', flow='right', flow='left', or flow='up' (for upward loops or progressions), or children=[...] to branch into a sub-tree.
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
        await asyncio.sleep(0.01)
        return f"Plotted structured diagram '{title}' on whiteboard."


    @llm.function_tool(
        description="MANDATORY for writing structured concept cards, definitions, sub-topic notes, key takeaways, examples, or categorized bullet lists on the digital whiteboard in English or German. Renders an atomic, styled container card with a bold title, optional category badge, accent divider line, and clean bullet items — preventing fragmented or out-of-order text. ALWAYS prefer this over dumping plain multi-line text."
    )
    async def draw_concept_card(
        self,
        title: str,
        items: list[str],
        category: str = "",
        color: str = "#38bdf8",
        position: typing.Literal["auto", "left", "right", "top", "bottom", "custom"] = "auto",
        x: typing.Optional[float] = None,
        y: typing.Optional[float] = None,
        width: typing.Optional[float] = 540.0,
    ):
        """
        Draws a beautifully styled concept card with title, optional category badge, divider line, and bullet items.
        title: Title of the concept or section (e.g. 'Supervised Learning', 'Spam Filtering', 'Key Characteristics').
        items: List of explanatory bullet points, rules, or formulas.
        category: Optional short uppercase category badge (e.g. 'EXAMPLE', 'MACHINE LEARNING', 'DEFINITION').
        color: Hex accent color for the border, badge, and divider (e.g. '#38bdf8' cyan, '#4ECDC4' teal, '#FFAB00' amber, '#C77DFF' purple, '#ef4444' rose).
        position: Canvas slot placement ('auto', 'bottom', 'right', 'left', 'custom'). Recommended default 'auto' (or 'bottom' / 'right') to auto-position cleanly without overlapping existing notes/text.
        x, y, width: Optional coordinates and card width (only when position='custom').
        """
        options_dict = {
            "title": title,
            "diagramType": "concept_card",
            "category": category,
            "items": items,
            "color": color,
            "position": position,
            "writingStyle": self._writing_style,
        }
        if position == "custom" or (x is not None and y is not None and position != "auto"):
            options_dict["x"] = x
            options_dict["y"] = y
        if width is not None:
            options_dict["width"] = width

        payload = {
            "type": "shape",
            "payload": {
                "kind": "shape",
                "shapeType": "diagram",
                "x": x if (x is not None and position == "custom") else 140.0,
                "y": y if (y is not None and position == "custom") else 180.0,
                "options": options_dict,
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(0.01)
        return f"Plotted concept card '{title}' on whiteboard."

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
        await asyncio.sleep(0.01)
        return f"Drew {shapeType} at ({x}, {y})" + (f" with label '{label}'." if label else ".")

    @llm.function_tool(description="Write animated handwritten prose text, titles, subtitles, linguistic definitions, or notes on the digital whiteboard in English or German only. Use style='title' for prominent main titles (44px, bold), style='subtitle' or decorated=True for section headers with an aesthetic glowing underline, or style='body' for regular handwriting notes. MANDATORY when writing style is Handwriting or Mixed.")
    async def write_text(self, text: str, x: float, y: float, direction: str = "ltr", style: str = "auto", decorated: bool = False):
        if self._writing_style == "normal":
            return "ERROR: The user changed the mode to Normal Text Only. You MUST immediately retry using the 'write_normal_text' tool instead."
        """Writes animated handwritten text on the whiteboard in English or German only."""
        if style == "auto":
            is_title = (y <= 125) or ("title" in text.lower() or "topic" in text.lower())
            resolved_style = "title" if is_title else ("subtitle" if decorated else "body")
        else:
            resolved_style = style
        if decorated and resolved_style == "body":
            resolved_style = "subtitle"
        fontSize = 44 if resolved_style == "title" else (32 if resolved_style == "subtitle" else 24)
        payload = {
            "type": "handwriting",
            "payload": {
                "kind": "handwriting",
                "text": text,
                "position": {"x": x, "y": y},
                "style": resolved_style,
                "fontSize": fontSize,
                "writingStyle": "handwriting",
                "direction": direction,
                "options": {
                    "underline": decorated or resolved_style in ("title", "subtitle"),
                },
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(0.01)
        return f"Wrote '{text}' on whiteboard."

    @llm.function_tool(description="Write plain prose text, definitions, terminology mappings, conceptual distinctions, rules, or structured bullet notes on the digital whiteboard in English or German only (rendered immediately). Supports markdown bold **text** or colons 'Term:' for bold subheaders. Set style='subtitle' or decorated=True if this is a section heading you want underlined. MANDATORY when writing style is Normal or Mixed.")
    async def write_normal_text(self, text: str, x: float, y: float, font_size: int = 24, color: str = "#FFFFFF", direction: str = "ltr", style: str = "normal", decorated: bool = False):
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
                    "style": style,
                    "underline": decorated or style in ("title", "subtitle"),
                },
            },
        }
        await self._room.local_participant.publish_data(
            json.dumps(payload).encode("utf-8")
        )
        await asyncio.sleep(0.01)
        return f"Wrote normal text '{text}' on whiteboard."


_active_vision_server = None


def _is_pure_thought_or_status_content(server_content: typing.Any) -> bool:
    """Returns True when LiveServerContent carries ONLY internal thought parts or interaction_status metadata (no audio, spoken text, or transcriptions)."""
    if server_content is None:
        return True
    if getattr(server_content, "input_transcription", None) and getattr(server_content.input_transcription, "text", None):
        return False
    if getattr(server_content, "output_transcription", None) and getattr(server_content.output_transcription, "text", None):
        return False
    model_turn = getattr(server_content, "model_turn", None)
    if model_turn is not None:
        parts = getattr(model_turn, "parts", None) or []
        for p in parts:
            if getattr(p, "thought", False):
                continue
            if getattr(p, "inline_data", None) or getattr(p, "text", None):
                return False
    return True


def install_zyren_realtime_session_hooks(
    broadcast_fn: typing.Optional[typing.Callable[..., typing.Any]] = None,
    accumulator: typing.Optional[UserTurnTranscriptAccumulator] = None,
    agent_session: typing.Any = None,
) -> None:
    """
    Installs idempotent lifecycle hooks onto LiveKit's Google RealtimeSession to guarantee:
    1. Pure internal `thought` / `interaction_status` packets in `gemini-3.8-live-extended-thinking` never open bogus empty SpeechHandles or self-interrupt active tools.
    2. Multi-step `interaction_status=IN_PROGRESS` and `NON_BLOCKING` post-tool continuations queue cleanly without triggering fake `input_speech_started` self-barge-ins (while preserving 100% of real user interruptions via `sc.interrupted` and local VAD).
    3. `FunctionResponse.scheduling` is stripped automatically on `gemini-3.8-live-extended-thinking` to prevent WebSocket `1007 Invalid Argument` closures.
    4. Zero-latency live chat transcription & assistant reply broadcasting.
    """
    from livekit.plugins.google.realtime import realtime_api

    if broadcast_fn is not None:
        realtime_api.RealtimeSession._zyren_active_broadcast_fn = broadcast_fn
    if accumulator is not None:
        realtime_api.RealtimeSession._zyren_active_accumulator = accumulator
    if agent_session is not None:
        realtime_api.RealtimeSession._zyren_active_agent_session = agent_session

    # 1. Hook _is_new_generation: ignore pure thought-only / interaction_status-only packets & track interaction_status
    if not hasattr(realtime_api.RealtimeSession, "_zyren_orig_is_new_generation"):
        orig_is_new = getattr(realtime_api.RealtimeSession, "_is_new_generation", None)
        if orig_is_new:
            realtime_api.RealtimeSession._zyren_orig_is_new_generation = orig_is_new

            def _zyren_is_new_generation(rt_self, resp):
                sc = getattr(resp, "server_content", None)
                if sc is not None:
                    istatus = getattr(sc, "interaction_status", None)
                    if istatus is not None:
                        rt_self._zyren_interaction_in_progress = "IN_PROGRESS" in str(istatus).upper()
                    if getattr(sc, "interrupted", False):
                        rt_self._zyren_interaction_in_progress = False
                        rt_self._zyren_last_tool_call_ts = 0.0
                    rt_self._zyren_pending_has_user_input = bool(
                        getattr(sc, "input_transcription", None)
                        and getattr(sc.input_transcription, "text", None)
                    )
                else:
                    rt_self._zyren_pending_has_user_input = False

                if not getattr(resp, "tool_call", None) and sc is not None:
                    if _is_pure_thought_or_status_content(sc):
                        return False

                return realtime_api.RealtimeSession._zyren_orig_is_new_generation(rt_self, resp)

            realtime_api.RealtimeSession._is_new_generation = _zyren_is_new_generation

    # 2. Hook _handle_tool_calls: stamp active NON_BLOCKING / multi-step tool timestamp
    if not hasattr(realtime_api.RealtimeSession, "_zyren_orig_handle_tool_calls"):
        orig_tool_calls = getattr(realtime_api.RealtimeSession, "_handle_tool_calls", None)
        if orig_tool_calls:
            realtime_api.RealtimeSession._zyren_orig_handle_tool_calls = orig_tool_calls

            def _zyren_handle_tool_calls(rt_self, tool_call):
                rt_self._zyren_last_tool_call_ts = time.time()
                return realtime_api.RealtimeSession._zyren_orig_handle_tool_calls(rt_self, tool_call)

            realtime_api.RealtimeSession._handle_tool_calls = _zyren_handle_tool_calls

    # 3. Hook _start_new_generation: prevent bogus _handle_input_speech_started() self-interruption during multi-step / post-tool model continuations
    if not hasattr(realtime_api.RealtimeSession, "_zyren_orig_start_new_generation"):
        orig_start_gen = getattr(realtime_api.RealtimeSession, "_start_new_generation", None)
        if orig_start_gen:
            realtime_api.RealtimeSession._zyren_orig_start_new_generation = orig_start_gen

            def _zyren_start_new_generation(rt_self):
                pending_fut = getattr(rt_self, "_pending_generation_fut", None)
                has_pending = bool(pending_fut and not pending_fut.done())
                has_user_input = bool(getattr(rt_self, "_zyren_pending_has_user_input", False))
                in_progress = bool(getattr(rt_self, "_zyren_interaction_in_progress", False))
                recent_tool = (time.time() - getattr(rt_self, "_zyren_last_tool_call_ts", 0.0)) < 1.8

                suppress_fake_barge_in = (not has_pending) and (not has_user_input) and (in_progress or recent_tool)
                if suppress_fake_barge_in:
                    rt_self._zyren_suppress_speech_started_once = True
                try:
                    realtime_api.RealtimeSession._zyren_orig_start_new_generation(rt_self)
                finally:
                    rt_self._zyren_suppress_speech_started_once = False

                if suppress_fake_barge_in:
                    # Ensure AgentActivity._user_silence_event stays set so the continuation SpeechHandle isn't blocked
                    active_sess = getattr(rt_self, "_zyren_agent_session_ref", None) or getattr(
                        realtime_api.RealtimeSession, "_zyren_active_agent_session", None
                    )
                    act = getattr(active_sess, "_activity", None) if active_sess is not None else None
                    sil_ev = getattr(act, "_user_silence_event", None) if act is not None else None
                    if sil_ev is not None and hasattr(sil_ev, "set"):
                        sil_ev.set()

            realtime_api.RealtimeSession._start_new_generation = _zyren_start_new_generation

    if not hasattr(realtime_api.RealtimeSession, "_zyren_orig_handle_input_speech_started"):
        orig_speech_started = getattr(realtime_api.RealtimeSession, "_handle_input_speech_started", None)
        if orig_speech_started:
            realtime_api.RealtimeSession._zyren_orig_handle_input_speech_started = orig_speech_started

            def _zyren_handle_input_speech_started(rt_self):
                if getattr(rt_self, "_zyren_suppress_speech_started_once", False):
                    rt_self._zyren_suppress_speech_started_once = False
                    return
                return realtime_api.RealtimeSession._zyren_orig_handle_input_speech_started(rt_self)

            realtime_api.RealtimeSession._handle_input_speech_started = _zyren_handle_input_speech_started

    # 4. Hook _send_client_event: strip FunctionResponse.scheduling on gemini-3.8-live-extended-thinking to prevent 1007 Invalid Argument
    if not hasattr(realtime_api.RealtimeSession, "_zyren_orig_send_client_event"):
        orig_send_ev = getattr(realtime_api.RealtimeSession, "_send_client_event", None)
        if orig_send_ev:
            realtime_api.RealtimeSession._zyren_orig_send_client_event = orig_send_ev

            def _zyren_send_client_event(rt_self, event):
                try:
                    opts = getattr(rt_self, "_opts", None)
                    active_model_str = str(getattr(opts, "model", "")).lower()
                    if "extended-thinking" in active_model_str:
                        fn_resps = getattr(event, "function_responses", None)
                        if fn_resps:
                            for fr in fn_resps:
                                if getattr(fr, "scheduling", None) is not None:
                                    fr.scheduling = None
                except Exception:
                    pass
                return realtime_api.RealtimeSession._zyren_orig_send_client_event(rt_self, event)

            realtime_api.RealtimeSession._send_client_event = _zyren_send_client_event

    # 5. Hook _handle_server_content: track interaction_status, skip thought-only empty warnings, and broadcast live transcripts
    if not hasattr(realtime_api.RealtimeSession, "_zyren_orig_handle_server_content"):
        orig_handle_content = getattr(realtime_api.RealtimeSession, "_handle_server_content", None)
        if orig_handle_content:
            realtime_api.RealtimeSession._zyren_orig_handle_server_content = orig_handle_content

            def _live_handle_server_content(rt_self, server_content):
                active_sess = getattr(realtime_api.RealtimeSession, "_zyren_active_agent_session", None)
                if active_sess is not None:
                    rt_self._zyren_agent_session_ref = active_sess

                if server_content is not None:
                    istatus = getattr(server_content, "interaction_status", None)
                    if istatus is not None:
                        is_ip = "IN_PROGRESS" in str(istatus).upper()
                        rt_self._zyren_interaction_in_progress = is_ip
                        if not is_ip:
                            rt_self._zyren_last_tool_call_ts = 0.0

                    if getattr(server_content, "interrupted", False):
                        rt_self._zyren_interaction_in_progress = False
                        rt_self._zyren_last_tool_call_ts = 0.0
                        curr_g = getattr(rt_self, "_current_generation", None)
                        if curr_g and hasattr(curr_g, "output_text"):
                            curr_g.output_text = ""

                curr_gen = getattr(rt_self, "_current_generation", None)
                if not curr_gen and _is_pure_thought_or_status_content(server_content) and not getattr(server_content, "interrupted", False):
                    return

                realtime_api.RealtimeSession._zyren_orig_handle_server_content(rt_self, server_content)
                try:
                    curr_gen = getattr(rt_self, "_current_generation", None)
                    bcast_fn = getattr(realtime_api.RealtimeSession, "_zyren_active_broadcast_fn", None)
                    acc = getattr(realtime_api.RealtimeSession, "_zyren_active_accumulator", None)
                    if not curr_gen or not bcast_fn:
                        return
                    loop = asyncio.get_running_loop()

                    if getattr(server_content, "input_transcription", None):
                        rt_self._zyren_last_user_speech_ts = time.time()
                        txt = getattr(curr_gen, "input_transcription", "")
                        if txt and txt.strip():
                            if acc is not None:
                                uid, utxt = acc.update_user_segment(curr_gen.input_id, txt.strip())
                            else:
                                uid, utxt = curr_gen.input_id, txt.strip()
                            loop.create_task(bcast_fn("user", utxt, msg_id=uid))

                    if getattr(server_content, "generation_complete", False):
                        in_txt = getattr(curr_gen, "input_transcription", "")
                        if in_txt and in_txt.strip():
                            if acc is not None:
                                uid, utxt = acc.update_user_segment(curr_gen.input_id, in_txt.strip())
                            else:
                                uid, utxt = curr_gen.input_id, in_txt.strip()
                            loop.create_task(bcast_fn("user", utxt, msg_id=uid))
                        out_txt = getattr(curr_gen, "output_text", "")
                        if out_txt and out_txt.strip():
                            if acc is not None and not getattr(rt_self, "_zyren_interaction_in_progress", False):
                                acc.reset_after_assistant_reply()
                            loop.create_task(
                                bcast_fn("assistant", out_txt.strip(), msg_id=curr_gen.response_id)
                            )
                except Exception:
                    pass

            realtime_api.RealtimeSession._handle_server_content = _live_handle_server_content

    # 6. Speech-aware _is_turn_or_user_speech_active & _handle_go_away deferral (prevents mid-monologue GoAway cutoffs across SDK upgrades)
    if not hasattr(realtime_api.RealtimeSession, "_is_turn_or_user_speech_active"):
        def _zyren_is_turn_or_user_speech_active(rt_self) -> bool:
            if getattr(rt_self, "_current_generation", None) is not None:
                return True
            sess_ref = getattr(rt_self, "_zyren_agent_session_ref", None) or getattr(
                realtime_api.RealtimeSession, "_zyren_active_agent_session", None
            )
            if sess_ref is not None and str(getattr(sess_ref, "user_state", "")).lower() == "speaking":
                return True
            now_ts = time.time()
            last_act = float(getattr(rt_self, "_last_user_activity_ts", 0.0) or 0.0)
            last_sp = float(getattr(rt_self, "_zyren_last_user_speech_ts", 0.0) or 0.0)
            if (now_ts - max(last_act, last_sp)) < 2.5:
                return True
            return False

        realtime_api.RealtimeSession._is_turn_or_user_speech_active = _zyren_is_turn_or_user_speech_active

    if not hasattr(realtime_api.RealtimeSession, "_zyren_orig_handle_go_away"):
        orig_go_away = getattr(realtime_api.RealtimeSession, "_handle_go_away", None)
        if orig_go_away:
            realtime_api.RealtimeSession._zyren_orig_handle_go_away = orig_go_away

            def _zyren_handle_go_away(rt_self, go_away):
                if not rt_self._is_turn_or_user_speech_active():
                    rt_self._session_should_close.set()
                    return

                existing_task = getattr(rt_self, "_go_away_defer_task", None)
                if existing_task and not existing_task.done():
                    return

                async def _wait_for_speech_then_close():
                    deadline = time.time() + 42.0
                    while time.time() < deadline:
                        if not rt_self._is_turn_or_user_speech_active():
                            break
                        await asyncio.sleep(0.1)
                    try:
                        from google.genai import types as genai_types
                        if hasattr(rt_self, "_send_client_event"):
                            rt_self._send_client_event(
                                genai_types.LiveClientRealtimeInput(audio_stream_end=True)
                            )
                    except Exception:
                        pass
                    rt_self._session_should_close.set()

                try:
                    loop = asyncio.get_running_loop()
                    rt_self._go_away_defer_task = loop.create_task(_wait_for_speech_then_close())
                except RuntimeError:
                    rt_self._session_should_close.set()

            realtime_api.RealtimeSession._handle_go_away = _zyren_handle_go_away


# Ensure RealtimeSession lifecycle hooks are installed immediately at import time
install_zyren_realtime_session_hooks()


async def entrypoint(ctx: JobContext):
    print(">>> [AGENT] entrypoint called - connecting to room...")
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
        print(f">>> [AGENT] Connected to room: {ctx.room.name}")

        selected_voice = "Aoede"
        writing_style = "mixed"
        selected_model = "gemini-3.8-live-extended-thinking"
        thinking_level = "high"
        verbosity = "balanced"
        vocal_tone = "natural"
        learner_profile = "general"
        learner_name = ""
        language_config = {
            "autoDetect": False,
            "primary": "ar-EG",
            "secondary": ["en-US", "de-DE"],
        }
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
                        selected_model = normalize_live_model_name(meta["model"])
                        print(f">>> [AGENT] Loaded chosen live model: {selected_model} (requested: {meta['model']})")
                    if "thinkingLevel" in meta and meta["thinkingLevel"]:
                        thinking_level = meta["thinkingLevel"]
                        print(f">>> [AGENT] Loaded chosen thinking level: {thinking_level}")
                    elif "thinking_level" in meta and meta["thinking_level"]:
                        thinking_level = meta["thinking_level"]
                        print(f">>> [AGENT] Loaded chosen thinking level: {thinking_level}")
                    if "verbosity" in meta and meta["verbosity"]:
                        verbosity = meta["verbosity"]
                        print(f">>> [AGENT] Loaded chosen verbosity: {verbosity}")
                    if "vocalTone" in meta and meta["vocalTone"]:
                        vocal_tone = meta["vocalTone"]
                        print(f">>> [AGENT] Loaded chosen vocal tone: {vocal_tone}")
                    elif "vocal_tone" in meta and meta["vocal_tone"]:
                        vocal_tone = meta["vocal_tone"]
                        print(f">>> [AGENT] Loaded chosen vocal tone: {vocal_tone}")
                    if "learnerProfile" in meta and meta["learnerProfile"]:
                        learner_profile = meta["learnerProfile"]
                        print(f">>> [AGENT] Loaded chosen learner profile: {learner_profile}")
                    elif "learner_profile" in meta and meta["learner_profile"]:
                        learner_profile = meta["learner_profile"]
                        print(f">>> [AGENT] Loaded chosen learner profile: {learner_profile}")
                    if "languageConfig" in meta and meta["languageConfig"]:
                        language_config = meta["languageConfig"]
                        print(f">>> [AGENT] Loaded chosen language config: {language_config}")
                    elif "language_config" in meta and meta["language_config"]:
                        language_config = meta["language_config"]
                        print(f">>> [AGENT] Loaded chosen language config: {language_config}")
                        print(f">>> [AGENT] Loaded chosen learner profile: {learner_profile}")
                    learner_name = str(meta.get("learnerName") or meta.get("learner_name") or meta.get("student_name") or "").strip()
                    if learner_name:
                        print(f">>> [AGENT] Loaded chosen student name: {learner_name}")
                except Exception as ex:
                    print(f">>> [AGENT] Could not parse participant metadata: {ex}")

        from google.genai import types as genai_types

        thinking_config = build_thinking_config(selected_model, thinking_level)
        context_compression = genai_types.ContextWindowCompressionConfig(
            trigger_tokens=100000,
            sliding_window=genai_types.SlidingWindow(
                target_tokens=72000,
            ),
        )
        realtime_input_cfg = genai_types.RealtimeInputConfig(
            automatic_activity_detection=genai_types.AutomaticActivityDetection(
                prefix_padding_ms=120,
                silence_duration_ms=700,
            ),
            turn_coverage=genai_types.TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
        )

        initial_instructions = build_dynamic_tutor_instructions(
            writing_style=writing_style,
            verbosity=verbosity,
            vocal_tone=vocal_tone,
            learner_profile=learner_profile,
            model_name=selected_model,
            language_config=language_config,
            learner_name=learner_name,
        )

        # Dynamically resolve the latest Gemini API key from OS AppData UI config or .env
        active_api_key, active_key_source = resolve_gemini_api_key()
        if not active_api_key:
            print(">>> [AGENT] Waiting for Gemini API key configuration from UI...")
            room_closed = False

            def _on_early_disconnect(*_a):
                nonlocal room_closed
                room_closed = True

            ctx.room.on("disconnected", _on_early_disconnect)
            while not active_api_key and not room_closed:
                await asyncio.sleep(1.0)
                active_api_key, active_key_source = resolve_gemini_api_key()
            if room_closed or not active_api_key:
                print(">>> [AGENT] Room closed before Gemini API key was configured.")
                return

        print(f">>> [AGENT] Resolved active Gemini API key (source: {active_key_source})")

        tool_behavior_opt, tool_sched_opt = resolve_model_tool_options(selected_model)

        # Build the Gemini Realtime model with chosen voice persona, model-calibrated tool behavior, long-monologue context window, and calibrated VAD
        model = google.realtime.RealtimeModel(
            model=selected_model,
            voice=selected_voice,
            api_key=active_api_key,
            instructions=initial_instructions,
            thinking_config=thinking_config,
            context_window_compression=context_compression,
            realtime_input_config=realtime_input_cfg,
            tool_behavior=tool_behavior_opt,
            tool_response_scheduling=tool_sched_opt,
        )

        agent = TutorAgent(
            ctx.room,
            writing_style=writing_style,
            verbosity=verbosity,
            vocal_tone=vocal_tone,
            learner_profile=learner_profile,
            model_name=selected_model,
            language_config=language_config,
            learner_name=learner_name,
        )
        session = AgentSession(
            llm=model,
            turn_handling={
                "interruption": {
                    "enabled": True,
                    "min_duration": 0.8,
                    "resume_false_interruption": True,
                    "discard_audio_if_uninterruptible": True,
                },
                "endpointing": {
                    "min_delay": 0.6,
                },
            },
            aec_warmup_duration=5.0,
        )

        def _push_slide_image_to_realtime(raw_img_bytes: bytes, mime_type: str = "image/jpeg"):
            try:
                rt_s = None
                if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                    rt_s = session._activity.realtime_llm_session
                if rt_s and hasattr(rt_s, "_send_client_event"):
                    img_payload = raw_img_bytes
                    try:
                        with Image.open(io.BytesIO(raw_img_bytes)) as pil_img:
                            rgb_img = pil_img.convert("RGB")
                            if rgb_img.width > 1280 or rgb_img.height > 720:
                                rgb_img.thumbnail((1280, 720), Image.Resampling.BILINEAR)
                            out_buf = io.BytesIO()
                            rgb_img.save(out_buf, format="JPEG", quality=82)
                            img_payload = out_buf.getvalue()
                    except Exception:
                        pass
                    rt_s._send_client_event(
                        genai_types.LiveClientRealtimeInput(
                            video=genai_types.Blob(data=img_payload, mime_type="image/jpeg")
                        )
                    )
            except Exception:
                pass

        agent._realtime_image_push_cb = _push_slide_image_to_realtime

        active_vision_ws = None

        async def start_vision_websocket():
            global _active_vision_server
            async def vision_handler(ws):
                nonlocal active_vision_ws
                if active_vision_ws and active_vision_ws != ws:
                    try:
                        await active_vision_ws.close()
                    except Exception:
                        pass
                active_vision_ws = ws
                print(">>> [AGENT] Direct Vision WebSocket connected from frontend")
                try:
                    last_frame_sent_time = 0.0
                    prev_thumb = None
                    async for message in ws:
                        if ws != active_vision_ws:
                            break
                        try:
                            data = json.loads(message)
                            agent_state = getattr(session, "agent_state", "listening")

                            rt_session = None
                            if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                                rt_session = session._activity.realtime_llm_session
                            if not rt_session or not hasattr(rt_session, "_send_client_event"):
                                continue

                            # 1. Real-time 16kHz PCM audio stream from playing slide video
                            if "audio" in data:
                                if agent_state in ("speaking", "thinking"):
                                    continue
                                b64_audio = data.get("audio") or ""
                                if b64_audio:
                                    pcm_bytes = base64.b64decode(b64_audio)
                                    if pcm_bytes:
                                        rt_session._send_client_event(
                                            genai_types.LiveClientRealtimeInput(
                                                audio=genai_types.Blob(
                                                    data=pcm_bytes,
                                                    mime_type=data.get("mimeType") or "audio/pcm;rate=16000",
                                                )
                                            )
                                        )
                                continue

                            # 2. Composite 1280x720 whiteboard + live slide video/image frame
                            if "image" in data:
                                has_active_video = bool(data.get("hasActiveVideo"))
                                force_frame = bool(data.get("force"))

                                # Never inject frames while speaking unless forced on idle; allow 1 FPS (0.9s) for active video
                                if agent_state == "speaking" or (agent_state == "thinking" and not force_frame):
                                    continue

                                now = time.time()
                                min_interval = 0.0 if force_frame else (0.9 if has_active_video else 2.0)
                                if now - last_frame_sent_time < min_interval:
                                    continue

                                b64_str = data["image"]
                                header, encoded = b64_str.split(",", 1) if "," in b64_str else ("", b64_str)
                                raw_img_bytes = base64.b64decode(encoded)

                                def _process_vision_frame(raw_bytes, p_thumb):
                                    try:
                                        with Image.open(io.BytesIO(raw_bytes)) as pil_img:
                                            t_arr = np.asarray(
                                                pil_img.resize((32, 18), Image.Resampling.BILINEAR).convert("L"),
                                                dtype=np.int16,
                                            )
                                            if not has_active_video and not force_frame and p_thumb is not None:
                                                m_diff = float(np.abs(t_arr - p_thumb).mean())
                                                if m_diff < 1.5 and (now - last_frame_sent_time) < 30.0:
                                                    return None, p_thumb
                                            res_bytes = raw_bytes
                                            if pil_img.width > 1280 or pil_img.height > 720:
                                                rgb_img = pil_img.convert("RGB")
                                                rgb_img.thumbnail((1280, 720), Image.Resampling.BILINEAR)
                                                out_buf = io.BytesIO()
                                                rgb_img.save(out_buf, format="JPEG", quality=78)
                                                res_bytes = out_buf.getvalue()
                                            return res_bytes, t_arr
                                    except Exception:
                                        return raw_bytes, p_thumb

                                processed_bytes, prev_thumb = await asyncio.to_thread(_process_vision_frame, raw_img_bytes, prev_thumb)
                                if processed_bytes is None:
                                    continue

                                event = genai_types.LiveClientRealtimeInput(
                                    video=genai_types.Blob(data=processed_bytes, mime_type="image/jpeg")
                                )
                                rt_session._send_client_event(event)
                                last_frame_sent_time = now
                        except Exception:
                            pass
                except websockets.exceptions.ConnectionClosed:
                    print(">>> [AGENT] Direct Vision WebSocket disconnected")
                finally:
                    if active_vision_ws == ws:
                        active_vision_ws = None

            if _active_vision_server is not None:
                try:
                    _active_vision_server.close()
                    await _active_vision_server.wait_closed()
                except Exception:
                    pass
                _active_vision_server = None

            try:
                _active_vision_server = await websockets.serve(
                    vision_handler, "0.0.0.0", 8888, reuse_address=True
                )
                print(">>> [AGENT] Direct Vision WebSocket Server started on ws://0.0.0.0:8888 (bypassing LiveKit)")
            except Exception as ws_bind_err:
                print(f">>> [AGENT] Vision WebSocket bind notice: {ws_bind_err}")

        asyncio.create_task(start_vision_websocket())

        @ctx.room.on("disconnected")
        def _on_room_disconnected(*_args):
            global _active_vision_server
            if _active_vision_server is not None:
                try:
                    _active_vision_server.close()
                except Exception:
                    pass
                _active_vision_server = None

        last_bcast_assistant_text = ""
        last_bcast_assistant_ts = 0.0

        async def broadcast_chat_message(role: str, text: str, msg_id: str | None = None):
            nonlocal last_bcast_assistant_text, last_bcast_assistant_ts
            try:
                clean = (text or "").strip()
                if not clean:
                    return
                now = time.time()
                if role == "assistant":
                    clean = deduplicate_repeated_phrases(clean)
                    if not clean:
                        return
                    if clean == last_bcast_assistant_text and (now - last_bcast_assistant_ts) < 25.0:
                        return
                    last_bcast_assistant_text = clean
                    last_bcast_assistant_ts = now

                payload = {
                    "type": "chat_message",
                    "payload": {
                        "id": msg_id or f"msg-{int(time.time()*1000)}-{os.urandom(2).hex()}",
                        "role": role,
                        "text": clean,
                        "timestamp": int(time.time() * 1000),
                    },
                }
                await ctx.room.local_participant.publish_data(
                    json.dumps(payload).encode("utf-8")
                )
            except Exception:
                pass

        user_turn_accumulator = UserTurnTranscriptAccumulator()

        def _sync_rt_speech_state(is_speaking: bool = False):
            try:
                rt_s = None
                if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                    rt_s = session._activity.realtime_llm_session
                if rt_s is not None:
                    rt_s._zyren_agent_session_ref = session
                    if is_speaking:
                        rt_s._zyren_last_user_speech_ts = time.time()
            except Exception:
                pass

        @session.on("user_state_changed")
        def on_user_state_changed(event):
            new_st = str(getattr(event, "new_state", "")).lower()
            old_st = str(getattr(event, "old_state", "")).lower()
            _sync_rt_speech_state(is_speaking=("speaking" in new_st or "speaking" in old_st))

        # Install idempotent RealtimeSession hooks for gemini-3.8-live-extended-thinking stability, 1007 protection & zero-latency chat
        install_zyren_realtime_session_hooks(
            broadcast_fn=broadcast_chat_message,
            accumulator=user_turn_accumulator,
            agent_session=session,
        )

        async def send_user_multimodal_to_gemini(
            prompt_text: str = "",
            file_data_b64: str | None = None,
            mime_type: str = "image/jpeg",
            file_name: str | None = None
        ):
            try:
                user_turn_accumulator.reset_after_assistant_reply()
                # 1. Cleanly interrupt ongoing speech and release silence locks
                try:
                    await session.interrupt()
                except Exception:
                    pass
                if getattr(session, "_activity", None):
                    act = session._activity
                    sil_ev = getattr(act, "_user_silence_event", None)
                    if sil_ev is not None and hasattr(sil_ev, "set"):
                        sil_ev.set()

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
                        rt_session._zyren_last_user_speech_ts = time.time()
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
                    raw_id = getattr(item, "id", None) or f"msg-{int(time.time()*1000)}"
                    if chat_role == "user" and str(raw_id).startswith("GI_"):
                        msg_id, clean_text = user_turn_accumulator.update_user_segment(raw_id, clean_text)
                    elif chat_role == "assistant":
                        user_turn_accumulator.reset_after_assistant_reply()
                        msg_id = raw_id
                    else:
                        msg_id = raw_id
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
            target_model = normalize_live_model_name(target_model)
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
            new_tool_behavior, new_tool_sched = resolve_model_tool_options(target_model)
            agent._active_model = target_model
            updated_model_instructions = build_dynamic_tutor_instructions(
                writing_style=agent._writing_style,
                verbosity=agent._verbosity,
                vocal_tone=agent._vocal_tone,
                learner_profile=agent._learner_profile,
                model_name=target_model,
            )
            agent._instructions = updated_model_instructions
            model._opts.model = target_model
            model._opts.thinking_config = new_thinking_cfg
            model._opts.tool_behavior = new_tool_behavior
            model._opts.tool_response_scheduling = new_tool_sched
            model._opts.instructions = updated_model_instructions

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
                s._opts.tool_behavior = new_tool_behavior
                s._opts.tool_response_scheduling = new_tool_sched
                s._opts.instructions = updated_model_instructions
                s._session_resumption_handle = None
                if hasattr(s, "_opts") and is_given(getattr(s._opts, "session_resumption", None)):
                    try:
                        s._opts.session_resumption.handle = None
                    except Exception:
                        pass
                if hasattr(s, "_mark_restart_needed"):
                    s._mark_restart_needed()
                    print(f">>> [AGENT] Realtime session restart requested for model '{target_model}' (context preserved: {len(getattr(s, '_chat_ctx', llm.ChatContext.empty()).items)} items).")

        def apply_speaking_style_switch(
            new_writing_style: str | None = None,
            new_verbosity: str | None = None,
            new_vocal_tone: str | None = None,
            new_learner_profile: str | None = None,
            new_language_config: dict | None = None,
            new_learner_name: str | None = None,
        ):
            changed = False
            language_changed = False
            if new_writing_style and new_writing_style != agent._writing_style:
                agent._writing_style = new_writing_style
                changed = True
            if new_verbosity and new_verbosity != agent._verbosity:
                agent._verbosity = new_verbosity
                changed = True
            if new_vocal_tone and new_vocal_tone != agent._vocal_tone:
                agent._vocal_tone = new_vocal_tone
                changed = True
            if new_learner_profile and new_learner_profile != agent._learner_profile:
                agent._learner_profile = new_learner_profile
                changed = True
            if new_learner_name is not None and new_learner_name != agent._learner_name:
                agent._learner_name = str(new_learner_name).strip()
                changed = True
            if new_language_config:
                old_lang_json = json.dumps(getattr(agent, "_language_config", {}), sort_keys=True)
                new_lang_json = json.dumps(new_language_config, sort_keys=True)
                if old_lang_json != new_lang_json:
                    agent._language_config = new_language_config
                    changed = True
                    language_changed = True

            if not changed:
                return

            updated_instructions = build_dynamic_tutor_instructions(
                writing_style=agent._writing_style,
                verbosity=agent._verbosity,
                vocal_tone=agent._vocal_tone,
                learner_profile=agent._learner_profile,
                model_name=agent._active_model,
                language_config=agent._language_config,
                learner_name=agent._learner_name,
            )
            agent._instructions = updated_instructions
            model._opts.instructions = updated_instructions

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
                s._opts.instructions = updated_instructions
                if language_changed:
                    s._session_resumption_handle = None
                    if hasattr(s, "_opts") and is_given(getattr(s._opts, "session_resumption", None)):
                        try:
                            s._opts.session_resumption.handle = None
                        except Exception:
                            pass
                    if hasattr(s, "_mark_restart_needed"):
                        s._mark_restart_needed()
                        print(f">>> [AGENT] Realtime session restart requested for language config update: {agent._language_config} (context preserved: {len(getattr(s, '_chat_ctx', llm.ChatContext.empty()).items)} items).")

            if language_changed:
                try:
                    session.interrupt(force=True)
                except Exception:
                    pass

                p_code = agent._language_config.get("primary", "ar-EG")
                p_name = LANGUAGE_NAMES.get(p_code, p_code)
                is_auto = agent._language_config.get("autoDetect", False)
                async def _say_new_language():
                    rt_s = None
                    if getattr(session, "_activity", None) and hasattr(session._activity, "realtime_llm_session"):
                        rt_s = session._activity.realtime_llm_session
                    for _ in range(40):
                        await asyncio.sleep(0.1)
                        if rt_s and getattr(rt_s, "_active_session", None) is not None:
                            break
                    await asyncio.sleep(0.5)
                    try:
                        if is_auto:
                            prompt_confirm = "Say a brief, friendly single sentence confirming that real-time automatic language detection is now active and you are ready to listen in any language."
                        elif "ar" in p_code:
                            prompt_confirm = "Say a brief, friendly single sentence in authentic Egyptian Arabic confirming that the language has been updated to Arabic and you are ready to continue."
                        else:
                            prompt_confirm = f"Say a brief, friendly single sentence in {p_name} confirming that the language settings have been updated to {p_name} and you are ready to continue in {p_name}."
                        session.generate_reply(instructions=prompt_confirm)
                    except Exception as err:
                        print(f">>> [AGENT] Error generating language switch confirmation: {err}")
                asyncio.create_task(_say_new_language())

            print(
                f">>> [AGENT] Applied live mid-session style sync: "
                f"verbosity='{agent._verbosity}', tone='{agent._vocal_tone}', "
                f"profile='{agent._learner_profile}', writing='{agent._writing_style}', "
                f"language_config='{agent._language_config}'"
            )

        def apply_api_key_switch():
            new_key, new_source = resolve_gemini_api_key()
            if not new_key:
                print(">>> [AGENT] API key deleted by user; stopping active Gemini Realtime session.")
                try:
                    session.interrupt(force=True)
                except Exception:
                    pass
                return

            if getattr(model._opts, "api_key", None) == new_key:
                return

            print(f">>> [AGENT] Hot-reloading updated Gemini API key (source: {new_source})...")
            try:
                session.interrupt(force=True)
            except Exception:
                pass

            model._opts.api_key = new_key

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

            from google.genai import Client as GenAIClient
            from livekit.agents.utils.misc import is_given

            for s in active_sessions:
                s._opts.api_key = new_key
                try:
                    http_opts = s._opts.http_options or genai_types.HttpOptions(
                        timeout=int(s._opts.conn_options.timeout * 1000)
                    )
                    s._client = GenAIClient(
                        api_key=new_key,
                        vertexai=s._opts.vertexai,
                        project=s._opts.project,
                        location=s._opts.location,
                        credentials=s._opts.credentials,
                        http_options=http_opts,
                    )
                except Exception as ex_cl:
                    print(f">>> [AGENT] Error rebuilding GenAIClient on key hot-swap: {ex_cl}")

                s._session_resumption_handle = None
                if hasattr(s, "_opts") and is_given(getattr(s._opts, "session_resumption", None)):
                    try:
                        s._opts.session_resumption.handle = None
                    except Exception:
                        pass
                if hasattr(s, "_mark_restart_needed"):
                    s._mark_restart_needed()
                    print(">>> [AGENT] Realtime session restarted with new verified Gemini API key (conversation context preserved).")

        @ctx.room.on("data_received")
        def on_data_received(data_packet):
            try:
                data_text = data_packet.data.decode("utf-8")
                msg = json.loads(data_text)
                msg_type = msg.get("type")
                if msg_type == "board_state_sync":
                    agent.update_board_state(msg.get("payload", {}))
                elif msg_type in ("update_api_key", "reload_api_key"):
                    apply_api_key_switch()
                elif msg_type == "change_voice":
                    new_voice = msg.get("voice")
                    if new_voice:
                        apply_voice_switch(new_voice, announce=True)
                elif msg_type == "change_model":
                    new_model = msg.get("model")
                    new_thinking_level = msg.get("thinking_level") or msg.get("thinkingLevel") or "high"
                    if new_model:
                        apply_model_switch(new_model, new_thinking_level)
                elif msg_type in ("change_speaking_style", "change_writing_style", "change_style", "change_language_config"):
                    apply_speaking_style_switch(
                        new_writing_style=msg.get("style") or msg.get("writingStyle") or msg.get("writing_style"),
                        new_verbosity=msg.get("verbosity"),
                        new_vocal_tone=msg.get("vocalTone") or msg.get("vocal_tone") or msg.get("tone"),
                        new_learner_profile=msg.get("learnerProfile") or msg.get("learner_profile") or msg.get("profile"),
                        new_language_config=msg.get("languageConfig") or msg.get("language_config"),
                        new_learner_name=msg.get("learnerName") or msg.get("learner_name") or msg.get("student_name"),
                    )
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
                    apply_speaking_style_switch(
                        new_writing_style=meta.get("style"),
                        new_verbosity=meta.get("verbosity"),
                        new_vocal_tone=meta.get("vocalTone") or meta.get("vocal_tone"),
                        new_learner_profile=meta.get("learnerProfile") or meta.get("learner_profile"),
                        new_language_config=meta.get("languageConfig") or meta.get("language_config"),
                    )
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
                    apply_speaking_style_switch(
                        new_writing_style=meta.get("style"),
                        new_verbosity=meta.get("verbosity"),
                        new_vocal_tone=meta.get("vocalTone") or meta.get("vocal_tone"),
                        new_learner_profile=meta.get("learnerProfile") or meta.get("learner_profile"),
                        new_language_config=meta.get("languageConfig") or meta.get("language_config"),
                    )
                    if "model" in meta and meta["model"]:
                        new_lvl = meta.get("thinkingLevel") or meta.get("thinking_level") or "high"
                        apply_model_switch(meta["model"], new_lvl)
            except Exception as ex:
                print(f">>> [AGENT] Error in on_participant_metadata_changed: {ex}")

        print(">>> [AGENT] Starting session with Direct Vision WebSocket pipeline...")
        await session.start(
            room=ctx.room,
            agent=agent,
            room_options=RoomOptions(
                video_input=False,
            ),
        )
        print(">>> [AGENT] Session started! Agent is live with Direct Vision WebSocket pipeline.")

    except Exception as e:
        print(f">>> [AGENT] ERROR: {e}")
        traceback.print_exc()


async def request_fnc(req: JobRequest) -> None:
    print(f">>> [AGENT] Job request received for room: {req.room.name} - accepting...")
    await req.accept()


if __name__ == "__main__":
    ready_file = os.path.join(os.path.dirname(__file__), "..", ".agent_ready")

    def _cleanup_ready_file():
        try:
            if os.path.exists(ready_file):
                os.remove(ready_file)
        except Exception:
            pass

    import atexit
    atexit.register(_cleanup_ready_file)

    server = AgentServer.from_server_options(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            request_fnc=request_fnc,
        )
    )

    @server.on("worker_registered")
    def _on_worker_registered(worker_id, server_info):
        try:
            with open(ready_file, "w", encoding="utf-8") as f:
                f.write(str(time.time()))
            print(f">>> [AGENT] Voice Agent worker registered (id: {worker_id}) -> .agent_ready created successfully!")
        except Exception as ex:
            print(f">>> [AGENT] Could not write ready_file: {ex}")

    cli.run_app(server)
