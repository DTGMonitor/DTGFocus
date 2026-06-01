"""
Vercel Python serverless function — POST /api/pattern-recognition/analyze

Accepts JSON:
    {
      "files": [
        {"name": "f.xlsx", "contentBase64": "...", "vcpNamePrefix": "VCP-01",
         "smoothingWindows": [60]}
      ],
      "params": { smoothingWindow, longSmoothWindow, vLowFrac, aMultiplier,
                  minSegmentPts, ivR2Threshold, r2WarningThreshold,
                  fukuzonoTailFraction, enableForecasting, enableFukuzono,
                  enableSloGradient, sloRollingWindow, sloCriticalThreshold,
                  sloTailFraction, sloR2WarningThreshold }
    }

Returns the analysis result JSON, or { "error": "..." } with a 4xx/5xx status.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler

# Bundled pipeline + handlers live in ../_pipeline.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_pipeline"))

from runner import handle_analyze  # noqa: E402

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB (note: Vercel caps request body ~4.5 MB)

REQUIRED_PARAMS = [
    "smoothingWindow",
    "longSmoothWindow",
    "vLowFrac",
    "aMultiplier",
    "minSegmentPts",
    "ivR2Threshold",
    "r2WarningThreshold",
    "fukuzonoTailFraction",
    "enableForecasting",
]


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
            payload = json.loads(raw or b"{}")
        except Exception:  # noqa: BLE001
            return self._send(400, {"error": "Invalid JSON body."})

        files = payload.get("files") or []
        if not files:
            return self._send(400, {"error": "No files uploaded."})

        params = payload.get("params") or {}
        for key in REQUIRED_PARAMS:
            value = params.get(key)
            if value is None or value == "":
                return self._send(400, {"error": f"Missing required parameter: {key}"})

        # Enforce per-file size limit (approx. from base64 length).
        for f in files:
            b64 = f.get("contentBase64") or ""
            approx_size = (len(b64) * 3) // 4
            if approx_size > MAX_FILE_SIZE:
                return self._send(
                    400,
                    {"error": f"File \"{f.get('name', '')}\" exceeds the 50 MB size limit."},
                )

        try:
            result = handle_analyze({"files": files, "params": params})
        except Exception as exc:  # noqa: BLE001
            # No stack trace / internal detail leaks to the client.
            print(f"pattern-recognition analyze error: {exc}", file=sys.stderr)
            return self._send(500, {"error": "Analysis failed. Please try again."})

        return self._send(200, result)
