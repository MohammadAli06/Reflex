"""Runner script to launch both Mock API (8000) and Control API (8001) simultaneously.

Usage:
    python run_servers.py [--reload]
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

# Ensure backend root is working directory
BACKEND_DIR = Path(__file__).resolve().parent
os.chdir(BACKEND_DIR)


def stream_logs(pipe, prefix: str):
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            print(f"{prefix} {line}", end="", flush=True)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="Run Mock API (8000) and Control API (8001) simultaneously.")
    parser.add_argument("--reload", action="store_true", help="Enable uvicorn hot-reload")
    args = parser.parse_args()

    python_bin = sys.executable

    cmd_mock = [
        python_bin, "-m", "uvicorn", "app.mock_api.main:app",
        "--host", "127.0.0.1", "--port", "8000"
    ]
    cmd_control = [
        python_bin, "-m", "uvicorn", "app.control_api.main:app",
        "--host", "127.0.0.1", "--port", "8001"
    ]

    if args.reload:
        cmd_mock.append("--reload")
        cmd_control.append("--reload")

    print("=" * 60)
    print(" Starting Reflex Backend Servers Simultaneously:")
    print("   * Mock API:    http://127.0.0.1:8000")
    print("   * Control API: http://127.0.0.1:8001")
    print(" Press Ctrl+C at any time to shut down both.")
    print("=" * 60)

    p_mock = subprocess.Popen(
        cmd_mock,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=str(BACKEND_DIR),
    )

    p_control = subprocess.Popen(
        cmd_control,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=str(BACKEND_DIR),
    )

    t1 = threading.Thread(target=stream_logs, args=(p_mock.stdout, "[Mock:8000]   "), daemon=True)
    t2 = threading.Thread(target=stream_logs, args=(p_control.stdout, "[Control:8001]"), daemon=True)
    t1.start()
    t2.start()

    def cleanup(sig=None, frame=None):
        print("\nShutting down both servers...")
        for p in (p_mock, p_control):
            try:
                p.terminate()
            except Exception:
                pass
        time.sleep(0.5)
        for p in (p_mock, p_control):
            try:
                if p.poll() is None:
                    p.kill()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, cleanup)

    try:
        while True:
            code_mock = p_mock.poll()
            code_control = p_control.poll()
            if code_mock is not None:
                print(f"[Mock:8000] exited with code {code_mock}")
                cleanup()
            if code_control is not None:
                print(f"[Control:8001] exited with code {code_control}")
                cleanup()
            time.sleep(0.5)
    except KeyboardInterrupt:
        cleanup()


if __name__ == "__main__":
    main()
