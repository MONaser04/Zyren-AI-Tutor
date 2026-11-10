# 🎓 ZYREN AI Tutor — Real-Time Multimodal Socratic Learning Platform

<div align="center">

![ZYREN AI Tutor Banner](https://img.shields.io/badge/ZYREN_AI_Tutor-v2.5.0-6366F1?style=for-the-badge&logo=openai&logoColor=white)
![Build Passing](https://img.shields.io/badge/build-passing-10B981?style=for-the-badge&logo=githubactions&logoColor=white)
![Tests Passing](https://img.shields.io/badge/tests-196%20passed-success?style=for-the-badge&logo=vitest&logoColor=white)
![Providers](https://img.shields.io/badge/AI%20Providers-40%2B%20Models-8B5CF6?style=for-the-badge&logo=nvidia&logoColor=white)
![LiveKit WebRTC](https://img.shields.io/badge/LiveKit-WebRTC%20RTC-00D26A?style=for-the-badge&logo=livekit&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Gemini_Live-Multimodal%20Realtime-EA4335?style=for-the-badge&logo=google&logoColor=white)
![React 18](https://img.shields.io/badge/React_18-TypeScript-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Three.js WebGL](https://img.shields.io/badge/Three.js-3D%20WebGL-000000?style=for-the-badge&logo=three.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

<p align="center">
  <b>A state-of-the-art, real-time Socratic AI tutoring workstation combining bidirectional low-latency voice streaming, an Executive Model Hub supporting 40+ AI providers, multimodal instant quizzes, live web intelligence, synchronized YouTube co-learning, autonomous blackboard camera tracking, deterministic multi-directional diagrams, vector Venn diagrams, and a cutting-edge 3D WebGL Marching Cubes geometry engine.</b>
</p>

[Key Features](#-key-features) • [Architecture](#-system-architecture) • [3D & Geometry Engine](#-3d-mathematical-geometry-engine) • [Quick Start](#-quick-start) • [Configuration](#-configuration) • [Testing & Quality Assurance](#-testing--quality-assurance)

</div>

---

## 🌟 Overview

**ZYREN AI Tutor** is an autonomous, real-time pedagogical pair-learning workstation engineered for university and advanced secondary education across Mathematics, Physics, Computer Science, Engineering, Medicine, and Humanities.

Unlike conventional chatbots or disjointed speech interfaces, **AI Tutor** acts as a genuine classroom instructor standing in front of a digital blackboard:
- **Speaks and Listens Simultaneously**: Full-duplex conversation with zero awkward pauses, immediate interruptibility, and 30 distinct vocal personas powered by Google Gemini Live Realtime.
- **Decoupled Executive Model Hub (40+ Providers)**: Decouples streaming conversational voice latency from deep spatial/mathematical blackboard execution by dispatching complex diagram layouts, proofs, and grading to an Executive Intermediate Model (supporting NVIDIA NIM, OpenRouter, Groq, DeepSeek, xAI, Ollama, LM Studio, and more).
- **Interactive Multimodal Instant Quizzes**: Tests student comprehension in real time across 6 formats (Multiple Choice, True/False, Matching Pairs, Fill in Blank, Step Ordering, Short Answer) responsive to touch/clicks, voice speech answers, handwriting, and freehand encircling gestures.
- **Live Web Intelligence & Synchronized Video Co-Learning**: Real-time web fact search, instant whiteboard image placement, and programmatic YouTube video control (play, pause, seek) so the tutor pauses lectures at key timestamps to explain complex concepts synchronously.
- **Autonomous Blackboard Camera Tracking**: Intelligently tracks the tutor's live handwriting, formulas, and diagrams, smoothly framing the active learning focal point without disrupting user zoom.
- **Multimodal Video & Document Perception**: Sees student screen-shares, webcams, pasted assignment snapshots, high-resolution slide images, and HTML5 video lectures with frame-accurate timecode inspection.
- **Dynamic Board Drawing & Auto-Layout**: Real-time chalk handwriting, step-by-step LaTeX formula typesetting, interactive 2D calculus curves with shaded definite integrals, 4-directional hierarchical trees (TB, BT, LR, RL), vector Venn diagrams, and interactive 3D WebGL solids with orbit controls.
- **Socratic Pedagogical Scaffolding**: Built around the Socratic method and cognitive code-switching — guiding students turn-by-turn with targeted micro-steps rather than handing out unearned answers.
- **Multimodal Speech Stability Benchmark & Language Hierarchy**: Configure primary and ordered secondary languages with official Google Gemini Live acoustic stability calibration.

---

## 🏛 System Architecture

The platform runs as a coordinated tripartite system managed by an autonomous Python launcher (`main.py`):

```mermaid
flowchart TB
    subgraph Client ["🖥️ Modern Web Frontend (React 18 + Vite + TypeScript)"]
        UI["Interactive Blackboard Canvas (1080p Virtual World)"]
        CamCtrl["CameraFollowController (Autonomous Blackboard Tracking)"]
        MediaLayer["SlideMediaOverlay (In-Slide Video Player & Audio Tap)"]
        QuizLayer["QuizOverlay (6-Format Multimodal Quiz Engine & Gesture Parser)"]
        ThumbStrip["SlidePanel & SlideThumbnail (Live 16:9 Previews)"]
        ProviderHub["ProvidersModal (40+ Model Orchestrator & Vault)"]
        GLOverlay["3D WebGL Card (Three.js + Marching Cubes)"]
        GraphOverlay["2D Calculus Engine (Area Shading & Function Plot)"]
        VennEngine["Vector Venn Overlay (SVG Boolean Masks)"]
        DiagramEngine["DiagramLayoutEngine 2.0 (Trees, Multi-Directional Flowcharts)"]
        CollisionEng["CollisionDetector (2-Column Flow & Lookahead Spacing)"]
        SyncEngine["SyncEngine (Speech-to-Stroke Clock Alignment)"]
        VaultClient["Session AutoSave & Local Storage Vault (IndexedDB + Disk)"]
    end

    subgraph Transport ["📡 Real-Time WebRTC Media Fabric (LiveKit Server)"]
        AudioTrack["Bidirectional Opus Audio Stream (<200ms latency)"]
        VideoTrack["H.264 / VP8 Screen & Webcam Stream"]
        DataChannel["Reliable Bidirectional JSON DataChannel"]
    end

    subgraph Agent ["🤖 AI Tutor Worker (Python 3.10+ & LiveKit Agents)"]
        TutorCore["Socratic Tutor Agent Core"]
        PromptEngine["5-Mode Multilingual Matrix & Code-Switching Engine"]
        ConfigStore["Persistent ConfigStore (agent_config.json)"]
        ToolExecutor["Atomic Whiteboard Tool Handlers"]
        GeminiWS["Google Gemini Live Realtime WebSocket Session"]
        ExecutiveDisp["Executive Model Dispatcher (NVIDIA NIM, DeepSeek, Groq, Ollama)"]
        InternetSvc["Internet Intelligence Service (DuckDuckGo & YouTube Engine)"]
    end

    Client <-->|"Audio I/O & In-Slide Video Audio Tap"| AudioTrack
    Client -->|"Video / Frame Capture (1 FPS Vision)"| VideoTrack
    Client <-->|"Board State, Slide Deck, Quiz Responses & Sync"| DataChannel

    AudioTrack <-->|"Realtime Audio"| TutorCore
    VideoTrack -->|"Multimodal Vision"| TutorCore
    DataChannel <-->|"Tool Calls & Board Sync"| ToolExecutor

    TutorCore <-->|"Bidirectional Realtime Stream"| GeminiWS
    ToolExecutor <-->|"Spatial Layout, Math & Quiz Grading"| ExecutiveDisp
    ToolExecutor <-->|"Web Search & Video Transcripts"| InternetSvc
    ToolExecutor -->|"Scheduled Draw Commands (SILENT)"| DataChannel
    SyncEngine -->|"Render Operations"| UI
    SyncEngine -->|"Focal Point Tracking"| CamCtrl
    SyncEngine -->|"Media Playback & Inspection"| MediaLayer
    SyncEngine -->|"Interactive Quiz Cards"| QuizLayer
    SyncEngine -->|"3D Meshes"| GLOverlay
    SyncEngine -->|"2D Curves & Shading"| GraphOverlay
    SyncEngine -->|"Venn Masks"| VennEngine
    SyncEngine -->|"Auto Layout"| DiagramEngine
```

### ⚡ Unified Orchestrator (`main.py`)
Launch the entire ecosystem with a single terminal command:
```bash
python main.py
```
`main.py` automatically:
1. Validates `.env` and checks for your `GEMINI_API_KEY` (or prompts onboarding via the In-App Vault).
2. Launches the local **LiveKit WebRTC Server** (`--dev` mode on port `7880`).
3. Starts the **Python Voice Agent** worker in its isolated virtual environment with live auto-reload and settings change tracking.
4. Boots the **Vite Dev Server** (port `5173`) and checks dependencies.
5. Launches the app in standalone desktop app window mode (`--app` via Edge/Chrome) or default browser.
6. Gracefully terminates all background sub-processes on `Ctrl+C`.

---

## ✨ Key Features

### 🎙️ 1. Ultra-Low Latency Voice & Decoupled Executive Model Hub (40+ Providers)
- **Gemini Live Realtime Streaming**: Instant conversational turn-taking with sub-second response times and full-duplex speech.
- **Decoupled Spatial Dual-Engine Architecture**: Decouples voice latency from deep spatial/mathematical blackboard planning:
  - *Streaming Conversational Voice*: Handled with sub-second latency by Google Gemini Live Realtime.
  - *Executive Whiteboard Specialist (`ExecutiveModelDispatcher`)*: Dispatches complex multi-branch diagrams, mathematical proofs, and interactive quizzes to a dedicated reasoning model.
- **Comprehensive 40+ Provider Matrix (`ProvidersModal`)**:
  - **Enterprise Cloud Providers**: NVIDIA NIM, OpenRouter, Groq, xAI, DeepSeek, Azure OpenAI, Together AI, Mistral AI, Cerebras, SambaNova, Fireworks, Novita, Cloudflare Workers AI, and Google Vertex AI.
  - **Local & Offline Inference**: Native zero-latency integration with local Ollama daemons, LM Studio, llama.cpp (`llama-server`), and any custom OpenAI-compatible proxy (`localhost:8000`).
  - **In-App Provider Hub**: Real-time connection testing, latency benchmarking, dynamic model discovery (`/v1/models`), per-provider thinking depth controls, and secure local AppData vault storage.
- **Mid-Session Gemini Model Switcher**:
  - `gemini-3.8-live-extended-thinking` (Configurable thinking levels: `minimal`, `low`, `medium`, `high`)
  - `gemini-3.8-live` (Ultra-low latency streaming voice & native tool execution)
  - `gemini-3.1-flash-live-preview` (Agile multimodal preview with thinking depth)
- **Zero-Disconnection Voice Switching**: Audition and switch between **30 Gemini vocal personas** (Aoede, Puck, Charon, Kore, Fenrir, Zephyr, etc.) mid-call with instant audio preview playback and favorites filtering.
- **Learner & Tutor Name Personalization**: Configure student and teacher identities (defaulting to **Zyren**). The AI Tutor adopts this identity when introducing itself and addresses you warmly by your student name. Stored strictly in local device storage (`localStorage`) with runtime WebRTC injection to preserve git privacy.

### 🧩 2. Interactive Multimodal Instant Quizzes & Real-Time Assessment (`QuizOverlay`)
- **6 Pedagogical Quiz Paradigms**:
  - *Multiple Choice*: Single and multi-select structured question cards.
  - *True / False*: Rapid concept verification with immediate explanation.
  - *Pair Matching & Association*: Interactive left/right concept pairing (e.g. definitions to terms).
  - *Fill in the Blank*: Interactive cloze tests with inline student text input.
  - *Step Ordering*: Algorithmic and chronological sequence sorting.
  - *Short Answer & Oral Socratic Dialogue*: Open-ended prompts with AI evaluation.
- **4-Way Multimodal Response & Evaluation Modes**:
  - *Direct Canvas Touch / Click*: Tap directly on quiz options, matching buttons, and ordering handles.
  - *Verbal Voice Answers (`QuizSpeechParser`)*: Student answers aloud (*"The correct answer is Option A because..."*); Gemini Live and the speech parser extract and evaluate the response, rendering real-time green checkmarks on the canvas.
  - *Freehand Circling Gesture Recognition*: Draw a loose loop or circle around any option on the board; the engine detects the enclosure and selects the choice.
  - *Handwriting & Text*: Write or type answers directly on the whiteboard canvas.
- **Instant Visual Feedback & Scoring**: Real-time scoring badges, Socratic explanatory hints, and retry capabilities.

### 🌐 3. Multilingual Hierarchy & Speech Stability Benchmark
- **Speech Language Priority Configuration (`LanguageSelectorModal`)**:
  - **Primary Conversational Language**: Select the base instructional language (Egyptian Arabic, Standard Arabic, English, German, French, Spanish, etc.).
  - **Secondary Languages Priority Hierarchy**: Add, remove, and reorder secondary languages (`Priority #1`, `Priority #2`, etc.) for terminology, definitions, and code-switching.
- **Official Google Gemini Live Stability Calibration**:
  - 🟢 **1 Language**: Ultra-Stable (Optimal) — Maximum acoustic accuracy, zero switching latency, 100% deterministic speech recognition.
  - 🔵 **2 Languages**: Highly Stable (Recommended) — Seamless bilingual code-switching; pairing with English provides highest stability.
  - 🟡 **3 Languages**: Moderate Stability — Functional with strict secondary hierarchy; minor chance of acoustic overlap.
  - 🔴 **4+ Languages**: Experimental / Low Stability — Elevated risk of phonetic drift and voice accent bleeding.
- **Single Exclusive Accessibility Lifeline**: If a student indicates they cannot understand the active language, the tutor replies with a single rescue sentence pointing to the 🌐 language button on the toolbar, then immediately resumes the active language with strict anti-jailbreak guardrails.
- **Persistent Configuration Store (`agent/config_store.py`)**: Remembers language priorities, active model, vocal tone, verbosity, and learner profile across reboots.

### 🎬 4. Synchronized Video Co-Learning & Web Intelligence Suite
- **Embedded YouTube & HTML5 Videos (`SlideMediaOverlay`)**: Embed YouTube videos or local HTML5 lectures directly onto whiteboard slides with timeline scrubbing, volume, speed, and Picture-in-Picture.
- **Autonomous Video Player Control (`control_video`)**: The AI Tutor programmatically controls playback (`play`, `pause`, `seek_to`, `seek_relative`). The tutor can pause a lecture at a specific timestamp, illustrate the concept on the whiteboard, and resume playback seamlessly.
- **Live Video Audio Tap**: WebAudio 16kHz PCM tap streams playing video audio directly to Gemini Live API so the tutor can listen and discuss recorded lectures.
- **Deep Multimodal Inspection (`inspect_slide_media`)**: Autonomous tool allows the tutor to inspect specific slide media, examine small text/equations, and fetch video transcripts.
- **Live Web Intelligence Suite (`internet_service.py`)**:
  - *Live Web Search (`search_the_web`)*: DuckDuckGo real-time search for up-to-date facts, documentation, and scientific citations.
  - *Web Image Placement (`search_and_display_web_image`)*: Live image discovery and automated placement on the active slide.
  - *Internet Access Gating*: One-click toolbar toggle (`🌐 Web: ON/OFF`) to enable or restrict live web access.
- **PointerCapture Overlay Precision**: Robust PointerCapture window dragging and resizing preventing mouse focus loss or dragging lockups.

### 📑 5. Visual Slide Deck, Autonomous Navigation & Multi-Slide Memory
- **Autonomous Slide Navigation (`switch_whiteboard_slide`)**: AI tutor can programmatically create, switch, and navigate whiteboard slides to organize multi-part lessons.
- **Cross-Slide & Session Memory Recall (`recall_session_memory`)**: Contextual memory vault searches across previous slides and past sessions for deep conceptual continuity.
- **Session Pinning & Eviction Immunity (📌)**: Pin essential study sessions to the top of the session manager in both IndexedDB and the AppData disk vault, immune to automatic LRU disk eviction.
- **Context Grounding & Reconnection Resilience**: Automatically handles Google Gemini Live 9-minute `GoAway` reconnects by re-injecting slide state and grounding student text messages with active media and diagram context (`[CURRENT WHITEBOARD GROUNDING]`).
- **Separate Chat & AI Memory Controls**: Clear chat history (`🧹 Clear Chat`) without losing tutor context, or perform a hard Turn-0 memory reset (`🔄 Reset AI`).
- **Multi-Format Export**: Export entire lessons to multi-page **PDF** or high-resolution **PNG**.

### 📊 6. Deterministic Tree Diagram Engine 2.0 & High-DPI Typography
- **`DiagramLayoutEngine 2.0` & `TreeDiagramModel`**:
  - Deterministic auto-layout for concept maps, taxonomy trees, hierarchical flowcharts, and comparison boards.
  - **4-Way Multi-Directional Trees**: Full support for Top-to-Bottom (`TB`), Bottom-to-Top (`BT` - upward trees / foundation-to-peak architectures), Left-to-Right (`LR`), and Right-to-Left (`RL`).
  - **Continuous Subtree Append (`attachToNode`)**: Attaches new branches or step sequences to existing nodes without duplicating or clearing previous work.
  - **Atomic Integrated Diagram Titling**: Integrates topic headers directly into the diagram bounding box, eliminating orphan text elements.
  - 90° orthogonal elbow connectors eliminating crossing diagonal lines.
- **High-DPI Canvas Zoom Sharpness (`CanvasLayer` & `RoughJsAdapter`)**:
  - Canvas resolution dynamically scales with user zoom level (with 60 FPS debounced gestures), rendering razor-sharp lines and text even at 400%+ zoom.
- **Dynamic Font Size & Surgical Resizing**:
  - Supports custom font sizes (12px to 80px) and live item updates (`update_whiteboard_item`) across handwriting, normal text, and mathematical formulas.
- **Canvas Markdown Typography**:
  - Tokenized parsing of bold (`**text**`), italic/notes (`*text*`), subheaders with colons, and bullet normalization.
- **Sequential 2-Column Layout with Widow Heading Prevention (`CollisionDetector.ts`)**:
  - Strict two-column gravity flow (Column 1 = 150px, Column 2 = 1000px) with contextual lookahead buffer.

### 🎥 7. Autonomous Blackboard Camera Tracking & Adaptive Auto-Resize (`CameraFollowController`)
- **Smart Focal Point Navigation**: Automatically pans the viewport to follow where the AI Tutor writes on the 1920x1080 canvas.
- **Adaptive Auto-Resize & Auto-Framing (Auto-Fit)**: Dynamically evaluates the bounding box of active multi-node diagrams, multi-column layouts, and wide formulas. If the structure exceeds the safe viewing zone, the camera smoothly and adaptively adjusts both zoom and pan simultaneously so the entire structure fits comfortably on screen without manual zooming.
- **Deadzone-Aware Smooth Framing**: Evaluates a comfortable viewing deadzone ratio (68%) with frame-rate independent exponential LERP decay for jitter-free cinematic motion.
- **Manual Override Freedom**: Student can pan and zoom freely using mouse, touchpad, or touch gestures; auto-follow and auto-resize smoothly yield to user interaction with an automatic cooldown timer.

### 📐 8. Smart 3D WebGL Mathematical Geometry Engine
- **Marching Cubes Volumetric Meshing**: Real-time rendering of implicit quadric surfaces and CSG intersections (e.g. $9 \le x^2 + y^2 + z^2 \le 16$, Steinmetz solids, ellipsoids, hyperboloids).
- **Feature-Preserving Meshing**: Exact sub-voxel zero-crossing root finding and QEF singularity resolution to eliminate floating artifacts and ghost blobs.
- **Parametric Manifolds**: Vector manifold builders for Möbius strips, Toruses, Trefoil knots, and Klein bottles.
- **Solids of Revolution & Extrusions**: Dynamic revolves around $X, Y, Z$ axes and linear bounded extrusions with closed, watertight capped ends.
- **Watertight Clipping Planes**: Real-time cross-section slicing ($x \ge 0, z \le 2$).
- **Isolated 3D OrbitControls**: Pan, rotate, and zoom 3D graphs directly inside their whiteboard cards without disrupting canvas navigation.

### 📈 9. Calculus 2D Graphing with Area Shading & Vector Venn Diagrams
- **2D Calculus Engine**: Interactive Cartesian coordinate system with auto-scaling bounds, definite integral area shading between $f_{\text{top}}(x)$ and $f_{\text{bottom}}(x)$ over $[a, b]$, and Gaussian probability density curves.
- **Vector Venn Diagrams**: High-precision 2-set and 3-set Venn diagrams rendered with native SVG Boolean masking (`<clipPath>`, `<mask />`) and exact geometric centroid label placement.

---

## 📂 Project Structure

```
AI_Tutor/
├── agent/                          # Python AI Tutor Voice Agent & Worker
│   ├── agent.py                    # TutorAgent class, tools & Gemini Live integration
│   ├── config_store.py             # Persistent configuration store (agent_config.json)
│   ├── executive_model.py          # Decoupled Executive Model Dispatcher (40+ AI providers)
│   ├── internet_service.py         # Live DuckDuckGo search, image lookup & YouTube intelligence
│   ├── requirements.txt            # Python dependencies (livekit-agents, google-genai, etc.)
│   └── venv/                       # (Git-ignored) Virtual environment
├── livekit_server/                 # Pre-compiled LiveKit WebRTC Server
│   ├── livekit-server.exe          # Local development binary
│   └── LICENSE                     # Apache 2.0 License
├── public/                         # Public assets & PWA manifest
│   ├── manifest.webmanifest        # Progressive Web App manifest
│   └── favicon.ico                 # App icon
├── scripts/                        # Automation & deployment scripts
│   ├── create-desktop-shortcut.ps1 # Windows desktop shortcut generator
│   └── run.bat                     # Quick launch batch script
├── src/                            # Frontend React 18 + TypeScript Application
│   ├── adapters/                   # Architectural abstraction layers
│   │   ├── canvas/                 # RoughJsAdapter (High-DPI canvas & markdown typography)
│   │   ├── llm/                    # Gemini adapter interfaces
│   │   └── tts/                    # ElevenLabs & TTS preview adapters
│   ├── components/                 # React UI components
│   │   ├── ApiKeyModal.tsx         # In-App Gemini API Key onboarding gate & vault
│   │   ├── ChatDrawer.tsx          # Real-time chat & multimodal file uploader
│   │   ├── FileMenu.tsx            # Save/Open, PDF/PNG export, recent sessions & auto-save
│   │   ├── FloatingVideoPiP.tsx    # Picture-in-Picture webcam & screen video
│   │   ├── LanguageSelectorModal.tsx# Multilingual hierarchy & stability benchmark modal
│   │   ├── ModelSelectorModal.tsx  # Dynamic Gemini Live model & thinking level modal
│   │   ├── PersonaSelectorModal.tsx# Verbosity, vocal tone & learner profile modal
│   │   ├── ProvidersModal.tsx      # 40+ AI model orchestrator, API key vault & latency benchmark
│   │   ├── SlidePanel.tsx          # PowerPoint-style slide sorter drawer
│   │   ├── SlideThumbnail.tsx      # Live 16:9 miniature canvas thumbnail renderer
│   │   ├── ThreeGraph3DCard.tsx    # 3D Three.js card with isolated OrbitControls
│   │   ├── UserDrawingLayer.tsx    # Student freehand annotation canvas
│   │   ├── VoiceSelectorModal.tsx  # 30-voice persona audition & selector modal
│   │   └── Whiteboard.tsx          # Master blackboard workspace orchestrator
│   ├── engine/                     # Core computational & synchronization engines
│   │   ├── AudioClock.ts           # Web Audio clock source & drift calculator
│   │   ├── CameraFollowController.ts# Autonomous blackboard camera tracking controller
│   │   ├── CollisionDetector.ts    # 2-column layout solver & lookahead spacing
│   │   ├── DiagramLayoutEngine.ts  # Deterministic multi-directional diagram auto-layout
│   │   ├── DriftCorrector.ts       # Audio-visual synchronization drift compensator
│   │   ├── InterruptionHandler.ts  # Millisecond vocal interruption recovery
│   │   ├── QuizSpeechParser.ts     # Spoken verbal answer parser & semantic matching
│   │   ├── SyncEngine.ts           # Master render dispatcher & undo/redo stack
│   │   ├── SyncQueue.ts            # Priority command queue
│   │   └── TreeDiagramModel.ts     # Canonical recursive tree model & 4-way layout normalization
│   ├── layers/                     # Canvas visual overlays
│   │   ├── ArabicShaper.ts         # RTL Arabic text shaping & glyph normalization
│   │   ├── CanvasLayer.tsx         # Rough.js sketchy blackboard drawings with High-DPI scaling
│   │   ├── Graph3DOverlay.tsx      # 3D WebGL container overlay
│   │   ├── GraphOverlay.tsx        # 2D coordinate graphs & calculus area shading
│   │   ├── MathOverlay.tsx         # KaTeX LaTeX formula renderer
│   │   ├── QuizOverlay.tsx         # Interactive multimodal 6-format quiz card engine
│   │   ├── SlideMediaOverlay.tsx   # In-slide interactive HTML5/YouTube video player & audio tap
│   │   ├── SVGOverlay.tsx          # Stroke-by-stroke animated handwriting
│   │   └── VennOverlay.tsx         # Vector SVG boolean mask Venn diagram engine
│   ├── math3d/                     # Mathematical 3D geometry engine
│   │   ├── builders/               # Surface, revolution, parametric & solid builders
│   │   ├── marchingCubes/          # 3D Marching Cubes algorithm & lookup tables
│   │   ├── astParser.ts            # AST algebraic expression parser
│   │   ├── compiler.ts             # High-speed math function compiler
│   │   ├── expressionGuard.ts      # Math safety & evaluation validator
│   │   ├── implicitResolver.ts     # Implicit-to-explicit equation resolver
│   │   ├── multiBoundarySolver.ts  # Multi-constraint spatial domain solver
│   │   └── router.ts               # 3D plot type routing logic
│   ├── server/                     # Full-stack local backend services
│   │   └── zyrenBackendVault.ts    # Secure AppData vault, API key manager & disk session storage
│   ├── services/                   # Client application services
│   │   └── sessionAutoSave.ts      # Dual IndexedDB + disk continuous auto-save
│   ├── store/                      # Zustand state store
│   ├── transport/                  # LiveKit WebRTC client & DataChannel protocol
│   ├── types/                      # Shared TypeScript type definitions
│   │   ├── index.ts                # Core domain types, whiteboard & quiz interfaces
│   │   └── providers.ts            # Multi-provider definitions, settings & status contracts
│   ├── App.tsx                     # Top-level React entrypoint & token lifecycle
│   ├── index.css                   # Global blackboard styling & Tailwind classes
│   └── main.tsx                    # React DOM root
├── tests/                          # Automated test suites (188 passing tests)
│   ├── agent/                      # Pytest backend agent tests (60 tests)
│   │   ├── test_agent.py           # Agent async tool execution
│   │   ├── test_config_store.py    # Persistent JSON configuration store
│   │   ├── test_ext_thinking_auto_heal.py # Extended thinking recovery & watchdog
│   │   ├── test_intermediate_executive.py # Executive model dispatcher & 40+ providers
│   │   ├── test_internet_and_youtube.py # Web search, image embedding & YouTube analysis
│   │   ├── test_language_config.py # Multilingual hierarchy & accessibility rescue
│   │   ├── test_media_and_extended_thinking.py # Slide media perception & thinking locks
│   │   ├── test_mlf_instructions.py# Multilingual matrix prompt validation
│   │   ├── test_problem7_fixes.py  # Upward diagram flow & speech-action synchronization
│   │   ├── test_quiz_feature.py    # Interactive quiz tool & normalization suite
│   │   ├── test_slide_navigation_and_memory.py # Autonomous slide switching & memory vault
│   │   └── test_video_control.py   # Synchronized video playback control suite
│   └── unit/                       # Vitest frontend unit tests (128 tests)
│       ├── diagram_layout.test.ts  # Multi-directional diagrams & append layout (45 tests)
│       ├── expressionGuard.test.ts # AST math expression safety & validation (12 tests)
│       ├── graph_shading.test.ts   # 2D calculus area shading test suite (5 tests)
│       ├── new_features.test.ts    # Slide thumbnails, auto-save & media hooks (15 tests)
│       ├── quiz_overlay.test.ts    # Multimodal quiz interaction & gesture suite (20 tests)
│       ├── venn_diagram.test.ts    # VennOverlay boolean masking test suite (14 tests)
│       ├── video_control.test.ts   # Video player control & synchronization suite (8 tests)
│       └── whiteboard_session.test.ts # Session state & serialization test suite (9 tests)
├── .env.example                    # Environment configuration template
├── .gitignore                      # Git exclusion rules
├── index.html                      # HTML template
├── main.py                         # Unified platform launcher script
├── package.json                    # Node dependencies & npm scripts
├── tsconfig.json                   # TypeScript project configuration
└── vite.config.ts                  # Vite build, API middleware & LiveKit token server config
```

---

## 🚀 Quick Start

### 📋 Prerequisites
Ensure your machine has the following installed:
- **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
- **Python**: v3.10, v3.11, or v3.12 ([Download Python](https://www.python.org/))
- **Google Gemini API Key**: Free or paid key from [Google AI Studio](https://aistudio.google.com/)

---

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/MONaser04/Zyren-AI-Tutor.git
cd Zyren-AI-Tutor
```

### 2️⃣ Configure Environment Variables
Copy the template `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` in any text editor and insert your Gemini API Key (or configure it directly inside the app via the In-App Key Vault):
```ini
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
GEMINI_API_KEY=AIzaSy...your_actual_gemini_api_key...
```

### 3️⃣ Install Dependencies

#### Frontend (Node.js)
```bash
npm install
```

#### Voice Agent (Python)
It is recommended to use a virtual environment:
```bash
# Create virtual environment inside agent folder
python -m venv agent/venv

# Activate virtual environment
# Windows (PowerShell):
agent\venv\Scripts\Activate.ps1
# Windows (CMD):
agent\venv\Scripts\activate.bat
# Linux / macOS:
source agent/venv/bin/activate

# Install required Python packages
pip install -r agent/requirements.txt
```

---

### 4️⃣ Launch AI Tutor!
Start all services (LiveKit Server + Python Voice Agent + Vite Frontend) with a single command:
```bash
python main.py
```
*Windows users can also double-click `scripts/create-desktop-shortcut.ps1` to place a standalone native desktop app icon on their desktop.*

The launcher initializes all components, verifies LiveKit health, connects the Gemini Realtime session, and opens the application window:
```
http://localhost:5173
```
To run on a tablet, iPad, or mobile phone on the same Wi-Fi network, access the LAN URL printed in the console (e.g., `http://192.168.1.X:5173`).

---

## ⚙️ Environment Configuration

| Variable | Default Value | Description |
|---|---|---|
| `LIVEKIT_URL` | `ws://127.0.0.1:7880` | WebSocket URL of the LiveKit WebRTC server (`wss://...` for LiveKit Cloud). |
| `LIVEKIT_API_KEY` | `devkey` | LiveKit API Key (`devkey` for local development). |
| `LIVEKIT_API_SECRET` | `secret` | LiveKit API Secret (`secret` for local development). |
| `GEMINI_API_KEY` | *(Configurable in UI or .env)* | Google Gemini API Key from [Google AI Studio](https://aistudio.google.com/). |
| `ZYREN_APPDATA_DIR` | *(OS AppData default)* | Custom directory for session snapshots, media files, and settings. |

---

## 🧪 Testing & Quality Assurance

AI Tutor enforces strict quality assurance with **196 automated passing tests** across both frontend and backend layers:

### 1. Frontend Test Suite (Vitest — 132 Tests)
Executes 132 unit tests validating dynamic table layouts and KaTeX cell parsing, interactive quiz interactions, synchronized video playback controls, multi-directional 4-way diagram layouts, adaptive auto-resize transforms, session pinning, SVG Venn masks, 2D calculus area shading, slide thumbnail generation, session persistence, and AST math expression safety:
```bash
npm test
```
```
 ✓ tests/unit/quiz_overlay.test.ts (20 tests)
 ✓ tests/unit/whiteboard_session.test.ts (9 tests)
 ✓ tests/unit/table_overlay.test.ts (4 tests)
 ✓ tests/unit/video_control.test.ts (8 tests)
 ✓ tests/unit/venn_diagram.test.ts (14 tests)
 ✓ tests/unit/diagram_layout.test.ts (45 tests)
 ✓ tests/unit/new_features.test.ts (15 tests)
 ✓ tests/unit/graph_shading.test.ts (5 tests)
 ✓ src/math3d/expressionGuard.test.ts (12 tests)

 Test Files  9 passed (9)
      Tests  132 passed (132)
```

### 2. Backend Agent Test Suite (Pytest — 64 Tests)
Validates asynchronous tool calls, pedagogical comparison table rendering, Executive Model dispatching across 40+ providers, thinking mode parameter normalization, DuckDuckGo web search, YouTube transcript analysis, interactive quiz payload creation, autonomous slide navigation, memory recall, persistent JSON config stores, student and tutor name personalization without git leaks, language hierarchy and accessibility lifelines, slide media perception, and upward diagram flow:
```bash
# In active Python virtual environment:
pytest tests/agent/ -v
```
```
tests/agent/test_agent.py .                                              [  1%]
tests/agent/test_config_store.py ..                                      [  4%]
tests/agent/test_ext_thinking_auto_heal.py ...                           [  9%]
tests/agent/test_intermediate_executive.py .........                     [ 23%]
tests/agent/test_internet_and_youtube.py ......                          [ 32%]
tests/agent/test_language_config.py .........                            [ 46%]
tests/agent/test_media_and_extended_thinking.py ....                     [ 53%]
tests/agent/test_mlf_instructions.py .                                   [ 54%]
tests/agent/test_problem7_fixes.py ...........                           [ 70%]
tests/agent/test_quiz_feature.py ...........                             [ 87%]
tests/agent/test_slide_navigation_and_memory.py ...                      [ 90%]
tests/agent/test_table_tool.py ....                                      [ 96%]
tests/agent/test_video_control.py ..                                     [100%]

============================= 64 passed in 6.60s =============================
```

### 3. Frontend Production Build Check
```bash
npm run build
```
Validates full TypeScript typing (`tsc -b`) and bundles production assets via Vite with zero errors.

---

## 🤝 Contributing

Contributions are welcomed! Follow these steps to contribute:
1. **Fork the repository** on GitHub.
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```
3. **Commit your changes** using conventional commits:
   ```bash
   git commit -m "feat: Add interactive geometry compass tool"
   ```
4. **Push to the branch**:
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Open a Pull Request**.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

The LiveKit Server binary included in `livekit_server/` is distributed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

---

<div align="center">
  <sub>Engineered with precision for autonomous AI-assisted learning. Built with Google Gemini Live & LiveKit.</sub>
</div>
