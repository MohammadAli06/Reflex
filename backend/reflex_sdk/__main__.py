"""``python -m reflex_sdk demo`` entry point.

Adds the backend root to ``sys.path`` so ``app.*`` (settings, registry and the
rest of the engine) resolve the same way ``python cli/demo.py`` already does,
without any packaging step.
"""
from __future__ import annotations

import sys
from pathlib import Path


def _ensure_backend_on_path() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))


def main() -> int:
    _ensure_backend_on_path()
    from .demo import main as demo_main

    return demo_main()


if __name__ == "__main__":
    raise SystemExit(main())
