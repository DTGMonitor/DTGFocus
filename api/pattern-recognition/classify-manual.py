"""
Vercel Python serverless function — POST /api/pattern-recognition/classify-manual

Accepts JSON:
    {
      "vcpName": "VCP-01",
      "smoothingWindow": 60,
      "displacement": {"x": [...ISO...], "y": [...]},
      "velocity_smooth": {"x": [...ISO...], "y": [...]},
      "windows": [{"phase": "Linear", "start": "...", "end": "..."}, ...],
      "params": { ...forecasting params... }
    }

Returns { windows, onsetOfFailure, fukuzono, slo, combinedChartJson,
stageSummaryRows }, or { "error": "..." } with a 4xx/5xx status.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_pipeline"))

from runner import handle_classify_manual  # noqa: E402

PHASE_LABELS = [
    "No Significant Movement",
    "Linear",
    "Progressive Failure",
    "Regressive",
    "Unclassified",
]


def _validate(body):
    vcp_name = body.get("vcpName")
    if not vcp_name:
        return "Missing required field: vcpName"
    sw = body.get("smoothingWindow")
    if sw is None or sw == "":
        return "Missing required field: smoothingWindow"
    disp = body.get("displacement")
    if not disp or not isinstance(disp.get("x"), list) or not isinstance(disp.get("y"), list):
        return "Missing or invalid field: displacement must have x and y arrays"
    vel = body.get("velocity_smooth")
    if not vel or not isinstance(vel.get("x"), list) or not isinstance(vel.get("y"), list):
        return "Missing or invalid field: velocity_smooth must have x and y arrays"
    windows = body.get("windows")
    if not isinstance(windows, list) or len(windows) == 0:
        return "Missing or invalid field: windows must be a non-empty array"
    for i, w in enumerate(windows):
        if not isinstance(w, dict):
            return f"Invalid window at index {i}: must be an object"
        if w.get("phase") not in PHASE_LABELS:
            return f"Invalid phase \"{w.get('phase')}\" at index {i}."
    return None


class handler(BaseHTTPRequestHandler):
    def _send(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        try:
            length = int(self.headers.get("content-length") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            body = json.loads(raw or b"{}")
        except Exception:  # noqa: BLE001
            return self._send(400, {"error": "Invalid JSON body."})

        error = _validate(body)
        if error:
            return self._send(400, {"error": error})

        try:
            result = handle_classify_manual(body)
        except Exception as exc:  # noqa: BLE001
            print(f"pattern-recognition classify-manual error: {exc}", file=sys.stderr)
            return self._send(500, {"error": "Classification failed. Please try again."})

        return self._send(
            200,
            {
                "windows": result.get("windows"),
                "onsetOfFailure": result.get("onsetOfFailure"),
                "fukuzono": result.get("fukuzono"),
                "slo": result.get("slo"),
                "combinedChartJson": result.get("combinedChartJson"),
                "stageSummaryRows": result.get("stageSummaryRows"),
            },
        )
