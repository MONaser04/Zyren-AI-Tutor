# LiveKit WebRTC Local Server

This directory is designated for the pre-compiled **LiveKit Server** binary used by the automated launcher (`main.py`).

### 📦 Setup Instructions

- **Windows**: Place `livekit-server.exe` directly in this directory (or install via `winget install LiveKit.LiveKitCLI`).
- **macOS / Linux**: Install via Homebrew:
  ```bash
  brew install livekit
  ```
  or download pre-built binaries from [LiveKit Releases](https://github.com/livekit/livekit/releases).
- **Docker**:
  ```bash
  docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev
  ```

> *Note: Binary executables (`*.exe`, `*.zip`) are git-ignored to keep the repository lightweight.*
