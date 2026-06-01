"""
run_pattern_recognition.py — local CLI shim for the pattern-recognition pipeline.

The pipeline and its handlers now live in ``api/_pipeline`` (bundled into the
repo and used by the Vercel Python serverless functions in
``api/pattern-recognition``). This shim simply re-exports those handlers and
keeps the stdin→stdout CLI working for local tooling and tests.

Reads a JSON job ({"mode": "analyze"|"classify-manual", ...}) from stdin and
writes the JSON result to stdout; on error writes the message (no traceback)
to stderr and exits 1.
"""

from __future__ import annotations

import os
import sys

_RUNNER_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api", "_pipeline")
)
if _RUNNER_DIR not in sys.path:
    sys.path.insert(0, _RUNNER_DIR)

# Re-export the public API so existing imports (e.g. serialise helpers in tests)
# keep working: `from run_pattern_recognition import serialise_timestamp`.
from runner import (  # noqa: E402,F401
    serialise_timestamp,
    serialise_series,
    serialise_figure,
    handle_analyze,
    handle_classify_manual,
    main,
)

if __name__ == "__main__":
    main()
