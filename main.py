#!/usr/bin/env python3
"""
ZYREN AI Tutor - Unified Launcher (main.py)
===========================================
Starts all components of the ZYREN AI Tutor platform with a single command:
1. LiveKit WebRTC Server (local development server)
2. ZYREN Voice Agent (Gemini Live Realtime model + Whiteboard tools)
3. React + Vite Frontend (Whiteboard UI + Token generator)

Usage:
    python main.py
    python main.py --no-browser   (skip opening browser automatically)
"""

import os
import sys
import time
import socket
import signal
import atexit
import shutil
import platform
import threading
import subprocess
import webbrowser
import urllib.request
import urllib.error
from pathlib import Path

# Windows UTF-8 and console color support initialization
if platform.system() == "Windows":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except Exception:
        pass

# ANSI Color Codes for clean console output
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    
    RED = "\033[91m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN = "\033[96m"
    WHITE = "\033[97m"


ROOT_DIR = Path(__file__).resolve().parent
PROCESSES = []
SHUTTING_DOWN = False


def log(prefix: str, color: str, message: str):
    """Print formatted and colorized log line."""
    timestamp = time.strftime("%H:%M:%S")
    try:
        print(f"{Colors.DIM}[{timestamp}]{Colors.RESET} {color}{Colors.BOLD}[{prefix:^10}]{Colors.RESET} {message}", flush=True)
    except Exception:
        # Fallback if any character cannot be encoded
        safe_msg = message.encode("ascii", errors="replace").decode("ascii")
        print(f"[{timestamp}] [{prefix:^10}] {safe_msg}", flush=True)


def cleanup_orphaned_processes():
    """Kill any lingering background instances from previous aborted runs."""
    if platform.system() == "Windows":
        subprocess.run(
            ["taskkill", "/F", "/IM", "livekit-server.exe"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False
        )


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a TCP port is currently listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def is_livekit_healthy(host: str = "127.0.0.1", port: int = 7880) -> bool:
    """Verify that LiveKit server is actively responding with OK."""
    try:
        req = urllib.request.Request(f"http://{host}:{port}/", method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
            return "OK" in content or resp.status == 200
    except Exception:
        return False


def wait_for_livekit(timeout: float = 12.0) -> bool:
    """Wait until LiveKit server is confirmed healthy and responding."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if is_livekit_healthy():
            return True
        time.sleep(0.3)
    return False


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 15.0) -> bool:
    """Wait until a TCP port starts accepting connections."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if is_port_in_use(port, host):
            return True
        time.sleep(0.3)
    return False


def find_executable(names, search_dirs=None):
    """Find the first matching executable path from given names and directories."""
    if search_dirs:
        for d in search_dirs:
            for name in names:
                candidate = Path(d) / name
                if candidate.is_file() and os.access(candidate, os.X_OK | os.F_OK):
                    return str(candidate)
    
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


def stream_process_output(proc: subprocess.Popen, prefix: str, color: str):
    """Stream stdout/stderr from a child process to console."""
    try:
        for line in iter(proc.stdout.readline, ""):
            if SHUTTING_DOWN:
                break
            line_str = line.strip()
            if line_str:
                log(prefix, color, line_str)
    except Exception:
        pass
    finally:
        if proc.stdout:
            try:
                proc.stdout.close()
            except Exception:
                pass


def kill_process_tree(proc: subprocess.Popen):
    """Force kill a process and all its children cleanly."""
    try:
        if platform.system() == "Windows":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False
            )
        else:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def shutdown(signum=None, frame=None):
    """Cleanly shut down all child processes on exit/interrupt."""
    global SHUTTING_DOWN
    if SHUTTING_DOWN:
        return
    SHUTTING_DOWN = True
    
    print("\n" + "=" * 60)
    log("MAIN", Colors.YELLOW, "Shutting down ZYREN AI Tutor services...")
    
    for name, proc in reversed(PROCESSES):
        if proc.poll() is None:
            log("MAIN", Colors.DIM, f"Stopping {name} (PID {proc.pid})...")
            kill_process_tree(proc)

    cleanup_orphaned_processes()
            
    log("MAIN", Colors.GREEN, "All services stopped cleanly. Goodbye!")
    print("=" * 60 + "\n")
    sys.exit(0)


def check_environment():
    """Verify environment configuration."""
    env_path = ROOT_DIR / ".env"
    if not env_path.exists():
        log("WARN", Colors.YELLOW, "No .env file found in root directory!")
        log("WARN", Colors.YELLOW, "Creating default .env...")
        default_env = (
            "LIVEKIT_URL=ws://127.0.0.1:7880\n"
            "LIVEKIT_API_KEY=devkey\n"
            "LIVEKIT_API_SECRET=secret\n"
            "GEMINI_API_KEY=\n"
        )
        with open(env_path, "w", encoding="utf-8") as f:
            f.write(default_env)
        log("INFO", Colors.CYAN, "Created .env - please configure GEMINI_API_KEY if needed.")
    else:
        with open(env_path, "r", encoding="utf-8") as f:
            content = f.read()
            has_gemini = any(
                line.strip().startswith("GEMINI_API_KEY=") and len(line.strip().split("=", 1)[1]) > 5
                for line in content.splitlines()
            )
            if not has_gemini:
                log("WARN", Colors.YELLOW, "GEMINI_API_KEY is not configured in .env.")


def main():
    """Main launcher execution routine."""
    no_browser = "--no-browser" in sys.argv
    
    # Register signal and exit handlers
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    atexit.register(shutdown)
    
    print(f"\n{Colors.CYAN}{Colors.BOLD}" + "=" * 60)
    print("        ZYREN AI TUTOR - UNIFIED PLATFORM LAUNCHER")
    print("=" * 60 + f"{Colors.RESET}\n")
    
    check_environment()
    
    # 1. Locate LiveKit Server
    log("SETUP", Colors.BLUE, "Locating LiveKit server executable...")
    lk_search_dirs = [
        ROOT_DIR / "livekit_server",
        ROOT_DIR / "livekit-server",
        ROOT_DIR,
    ]
    lk_exec = find_executable(["livekit-server.exe", "livekit-server"], search_dirs=lk_search_dirs)
    if not lk_exec:
        log("ERROR", Colors.RED, "LiveKit server executable not found in livekit_server/ or PATH!")
        sys.exit(1)
    log("SETUP", Colors.GREEN, f"Found LiveKit Server: {lk_exec}")
    
    # 2. Locate Python executable for Agent
    log("SETUP", Colors.BLUE, "Locating Python environment for Agent...")
    agent_py_dirs = [
        ROOT_DIR / "agent" / "venv" / "Scripts",
        ROOT_DIR / "agent" / "venv" / "bin",
        ROOT_DIR / "venv" / "Scripts",
        ROOT_DIR / "venv" / "bin",
    ]
    agent_python = find_executable(["python.exe", "python3.exe", "python", "python3"], search_dirs=agent_py_dirs)
    if not agent_python:
        agent_python = sys.executable
    log("SETUP", Colors.GREEN, f"Found Agent Python: {agent_python}")
    
    agent_script = ROOT_DIR / "agent" / "agent.py"
    if not agent_script.exists():
        log("ERROR", Colors.RED, f"Agent script not found at {agent_script}!")
        sys.exit(1)

    # 3. Locate NPM / Vite for Frontend
    log("SETUP", Colors.BLUE, "Locating Node/NPM for Frontend...")
    npm_exec = find_executable(["npm.cmd", "npm", "npx.cmd", "npx"])
    if not npm_exec:
        log("ERROR", Colors.RED, "npm / npx not found in PATH! Please install Node.js.")
        sys.exit(1)
    log("SETUP", Colors.GREEN, f"Found NPM: {npm_exec}")
    
    # Check node_modules
    if not (ROOT_DIR / "node_modules").exists():
        log("SETUP", Colors.YELLOW, "node_modules not found. Running 'npm install'...")
        subprocess.run([npm_exec, "install"], cwd=str(ROOT_DIR), check=True)

    # Prepare subprocess environment
    sub_env = os.environ.copy()
    sub_env["PYTHONUNBUFFERED"] = "1"
    sub_env["FORCE_COLOR"] = "1"

    # ----------------------------------------------------
    # START PROCESS 1: LiveKit Server
    # ----------------------------------------------------
    log("START", Colors.CYAN, "Step 1/3: Starting LiveKit Server (port 7880)...")
    cleanup_orphaned_processes()
    time.sleep(0.3)
    
    lk_cmd = [lk_exec, "--dev"]
    lk_proc = subprocess.Popen(
        lk_cmd,
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=sub_env
    )
    PROCESSES.append(("LiveKit Server", lk_proc))
    threading.Thread(target=stream_process_output, args=(lk_proc, "LIVEKIT", Colors.CYAN), daemon=True).start()
    
    if wait_for_livekit(timeout=12.0):
        log("READY", Colors.CYAN, "LiveKit Server is up and ready on ws://127.0.0.1:7880")
    else:
        log("WARN", Colors.YELLOW, "LiveKit Server startup check timed out, proceeding...")

    time.sleep(1)

    # ----------------------------------------------------
    # START PROCESS 2: ZYREN AI Tutor Voice Agent
    # ----------------------------------------------------
    log("START", Colors.MAGENTA, "Step 2/3: Starting ZYREN AI Tutor Voice Agent...")
    agent_cmd = [agent_python, "-u", str(agent_script), "dev"]
    agent_proc = subprocess.Popen(
        agent_cmd,
        cwd=str(ROOT_DIR / "agent"),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=sub_env
    )
    PROCESSES.append(("Voice Agent", agent_proc))
    threading.Thread(target=stream_process_output, args=(agent_proc, "AGENT", Colors.MAGENTA), daemon=True).start()

    time.sleep(1)

    # ----------------------------------------------------
    # START PROCESS 3: Frontend (Vite Dev Server)
    # ----------------------------------------------------
    log("START", Colors.GREEN, "Step 3/3: Starting Frontend (Vite Dev Server)...")
    if npm_exec.endswith("npx") or npm_exec.endswith("npx.cmd"):
        vite_cmd = [npm_exec, "vite"]
    else:
        vite_cmd = [npm_exec, "run", "dev"]
        
    vite_proc = subprocess.Popen(
        vite_cmd,
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=sub_env
    )
    PROCESSES.append(("Frontend", vite_proc))
    threading.Thread(target=stream_process_output, args=(vite_proc, "FRONTEND", Colors.GREEN), daemon=True).start()

    # Wait for Vite server (port 5173) to be ready
    frontend_url = "http://localhost:5173"
    log("WAIT", Colors.BLUE, "Waiting for Frontend to become ready...")
    
    if wait_for_port(5173, timeout=15.0):
        log("READY", Colors.GREEN, f"Frontend is running at {frontend_url}")
    else:
        log("READY", Colors.GREEN, "Frontend initialized! Check console for assigned URL.")

    # ----------------------------------------------------
    # Open Browser
    # ----------------------------------------------------
    if not no_browser:
        time.sleep(1.5)
        log("MAIN", Colors.GREEN, f"Opening {frontend_url} in browser...")
        try:
            webbrowser.open(frontend_url)
        except Exception as e:
            log("WARN", Colors.YELLOW, f"Could not auto-open browser: {e}")

    # Determine local network IP for mobile device access
    def get_local_ip():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    local_ip = get_local_ip()

    print(f"\n{Colors.GREEN}{Colors.BOLD}" + "=" * 60)
    print("   ZYREN AI TUTOR APPLICATION IS NOW RUNNING!")
    print(f"   PC / Local URL:       http://localhost:5173")
    if local_ip != "127.0.0.1":
        print(f"   Mobile / Network URL: http://{local_ip}:5173")
    print("   Press Ctrl+C in this terminal to stop all services.")
    print("=" * 60 + f"{Colors.RESET}\n")

    # Monitor processes and keep main thread alive
    try:
        while True:
            for i, (name, proc) in enumerate(PROCESSES):
                code = proc.poll()
                if code is not None and not SHUTTING_DOWN:
                    log("ERROR", Colors.RED, f"{name} exited unexpectedly with code {code}.")
                    if name == "Voice Agent":
                        log("RESTART", Colors.MAGENTA, f"Restarting {name} to apply new voice/settings...")
                        agent_proc = subprocess.Popen(
                            agent_cmd,
                            cwd=str(ROOT_DIR / "agent"),
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT,
                            text=True,
                            encoding="utf-8",
                            errors="replace",
                            bufsize=1,
                            env=sub_env
                        )
                        PROCESSES[i] = ("Voice Agent", agent_proc)
                        threading.Thread(target=stream_process_output, args=(agent_proc, "AGENT", Colors.MAGENTA), daemon=True).start()
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()
