"""
run_pattern_recognition.py — Python pipeline runner for the Next.js API.

Reads a JSON object from stdin describing the mode and inputs, runs the
pattern-recognition pipeline, and writes the JSON result to stdout.

Supported modes
---------------
"analyze"
    Full pipeline for one or more (file × smoothing-window) VCP pairs.
    Input shape:
        {
            "mode": "analyze",
            "files": [
                {
                    "path": "/tmp/pr_xxx_file.xlsx",
                    "vcpNamePrefix": "VCP-01",
                    "smoothingWindows": [7, 14]
                }
            ],
            "params": { ... }
        }

"classify-manual"
    Re-classify a single VCP using analyst-supplied stage boundaries.
    Input shape:
        {
            "mode": "classify-manual",
            "vcpName": "VCP-01",
            "smoothingWindow": 7,
            "displacement": {"x": [...ISO strings...], "y": [...numbers...]},
            "velocity_smooth": {"x": [...ISO strings...], "y": [...numbers...]},
            "windows": [{"phase": "Linear", "start": "...", "end": "..."}, ...]
        }

Exit codes
----------
0   Success — JSON result written to stdout.
1   Unhandled exception — error message (no traceback) written to stderr.
"""

from __future__ import annotations

import base64
import json
import math
import sys
import os

# Ensure stdout and stderr use UTF-8 on all platforms (including Windows where
# the default console encoding may be cp1252 / charmap which cannot encode
# Unicode characters such as Δ that appear in stage summary column names).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# The pipeline modules (preprocessor, phase_classifier, etc.) live alongside
# this file (bundled into the repo for the Vercel Python runtime). Ensure this
# directory is importable regardless of how the function is invoked.
# ---------------------------------------------------------------------------
_PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
if _PIPELINE_DIR not in sys.path:
    sys.path.insert(0, _PIPELINE_DIR)

import pandas as pd

import data_loader
import preprocessor
import phase_classifier
import failure_predictor
import visualizer
from models import (
    ClassificationConfig,
    FukuzonoConfig,
    PreprocessConfig,
    SLOConfig,
)


# ---------------------------------------------------------------------------
# Serialisation helpers (Requirements 11.1, 11.2, 11.3)
# ---------------------------------------------------------------------------


def serialise_timestamp(ts) -> str | None:
    """Convert pd.Timestamp (or None) to ISO 8601 string."""
    if ts is None:
        return None
    if isinstance(ts, pd.Timestamp):
        return ts.isoformat()
    return str(ts)


def serialise_series(series) -> dict:
    """Convert pd.Series with DatetimeIndex to {"x": [...ISO...], "y": [...numbers...]}.

    NaN values in the y-array are serialised as null (JSON null).
    This is the single canonical format — no other format is permitted
    (Requirement 11.2).
    """
    if series is None or (hasattr(series, "empty") and series.empty):
        return {"x": [], "y": []}
    x = [ts.isoformat() for ts in series.index]
    y = [None if (isinstance(v, float) and math.isnan(v)) else float(v) for v in series.values]
    return {"x": x, "y": y}


def serialise_figure(fig) -> dict:
    """Serialise a Plotly figure to a plain dict via fig.to_json()."""
    return json.loads(fig.to_json())


# ---------------------------------------------------------------------------
# Parameter extraction helpers
# ---------------------------------------------------------------------------


def _estimate_sampling_minutes(index) -> float:
    """Median sampling interval (minutes) of a DatetimeIndex.

    Used to convert user-facing window sizes (minutes) into preprocessor reading
    counts, mirroring the Streamlit app. Returns 7.0 when < 2 timestamps.
    """
    if index is None or len(index) < 2:
        return 7.0
    deltas = index.to_series().diff().dropna().dt.total_seconds() / 60.0
    if deltas.empty:
        return 7.0
    return max(0.1, float(deltas.median()))


def _minutes_to_readings(minutes: float, sampling_minutes: float) -> int:
    """Round a window in minutes to a number of readings, floored at 2."""
    return max(2, int(round(minutes / max(0.1, sampling_minutes))))


def _build_preprocess_config(params: dict, smoothing_window: int) -> PreprocessConfig:
    return PreprocessConfig(smoothing_window=smoothing_window)


def _build_classification_config(params: dict) -> ClassificationConfig:
    return ClassificationConfig(
        long_smooth_window=int(params.get("longSmoothWindow", 24)),
        v_low_frac=float(params.get("vLowFrac", 0.03)),
        a_multiplier=float(params.get("aMultiplier", 2.5)),
        min_segment_pts=int(params.get("minSegmentPts", 12)),
        iv_r2_threshold=float(params.get("ivR2Threshold", 0.75)),
    )


def _build_fukuzono_config(params: dict) -> FukuzonoConfig:
    return FukuzonoConfig(
        r2_warning_threshold=float(params.get("r2WarningThreshold", 0.80)),
        tail_fraction=float(params.get("fukuzonoTailFraction", 0.20)),
    )


def _build_slo_config(params: dict) -> SLOConfig:
    return SLOConfig(
        rolling_window=int(params.get("sloRollingWindow", 5)),
        critical_threshold=float(params.get("sloCriticalThreshold", 50.0)),
        tail_fraction=float(params.get("sloTailFraction", 0.30)),
        r2_warning_threshold=float(params.get("sloR2WarningThreshold", 0.70)),
    )


# ---------------------------------------------------------------------------
# Window serialisation helper
# ---------------------------------------------------------------------------


def _serialise_windows(windows) -> list[dict]:
    """Convert a list of WindowClassification objects to JSON-safe dicts."""
    result = []
    for w in windows:
        duration = visualizer._format_duration(w.start_time, w.end_time)
        result.append({
            "phase": w.phase,
            "start": serialise_timestamp(w.start_time),
            "end": serialise_timestamp(w.end_time),
            "duration": duration,
        })
    return result


# ---------------------------------------------------------------------------
# Stage summary serialisation helper
# ---------------------------------------------------------------------------


def _serialise_stage_summary_rows(df) -> list[dict]:
    """Convert a stage summary DataFrame to a list of JSON-safe dicts.

    NaN numeric values are converted to null.
    """
    rows = []
    for _, row in df.iterrows():
        serialised_row = {}
        for col, val in row.items():
            if isinstance(val, float) and math.isnan(val):
                serialised_row[col] = None
            elif isinstance(val, pd.Timestamp):
                serialised_row[col] = serialise_timestamp(val)
            else:
                serialised_row[col] = val
        rows.append(serialised_row)
    return rows


# ---------------------------------------------------------------------------
# Core pipeline runner for a single (file × smoothing-window) VCP pair
# ---------------------------------------------------------------------------


def _run_single_vcp(
    displacement: pd.Series,
    vcp_name: str,
    smoothing_window: int,
    params: dict,
) -> dict:
    """Run the full pipeline for one VCP and return a JSON-safe result dict.

    ``smoothing_window`` is the user-facing window size in **minutes**; it is
    converted to a reading count using the file's sampling interval before
    preprocessing (mirroring the Streamlit app), and reused as-is for the
    mm/day↔mm/h display-unit choice.
    """
    errors: list[str] = []

    # Display velocity in mm/h when the analysis window is sub-daily, else
    # mm/day (issue 3). This decision uses the window in MINUTES.
    velocity_unit = "mm/h" if smoothing_window < 1440 else "mm/day"

    # 1. Preprocess — convert the window (minutes) → readings via sampling rate.
    sampling_minutes = _estimate_sampling_minutes(displacement.index)
    smoothing_readings = _minutes_to_readings(smoothing_window, sampling_minutes)
    preprocess_cfg = _build_preprocess_config(params, smoothing_readings)
    prep_result = preprocessor.preprocess(displacement, preprocess_cfg, vcp_name=vcp_name)
    errors.extend(prep_result.errors)

    if prep_result.velocity_smooth.empty:
        return {
            "vcpName": vcp_name,
            "smoothingWindow": smoothing_window,
            "windows": [],
            "onsetOfFailure": None,
            "fukuzono": None,
            "slo": None,
            "stageSummaryRows": [],
            "combinedChartJson": None,
            "errors": errors or ["Preprocessing produced no velocity data."],
        }

    # 2. Classify
    classify_cfg = _build_classification_config(params)
    classification = phase_classifier.classify(
        prep_result.velocity_smooth,
        prep_result.acceleration_smooth,
        classify_cfg,
    )
    errors.extend(classification.errors)

    # 3. Build progressive mask for failure predictors
    progressive_mask = pd.Series(False, index=prep_result.velocity_smooth.index)
    for w in classification.windows:
        if w.phase == "Progressive Failure":
            mask = (prep_result.velocity_smooth.index >= w.start_time) & \
                   (prep_result.velocity_smooth.index <= w.end_time)
            progressive_mask[mask] = True

    # 4. Fukuzono prediction
    fukuzono_result = None
    fukuzono_json = None
    enable_forecasting = params.get("enableForecasting", True)
    enable_fukuzono = params.get("enableFukuzono", True)
    enable_slo = params.get("enableSloGradient", False)

    if enable_forecasting and enable_fukuzono:
        fukuzono_cfg = _build_fukuzono_config(params)
        fukuzono_result = failure_predictor.predict_fukuzono(
            prep_result.velocity_smooth,
            progressive_mask,
            fukuzono_cfg,
            vcp_name=vcp_name,
        )
        if fukuzono_result.error:
            errors.append(fukuzono_result.error)
        fukuzono_json = {
            "predictedFailureTime": serialise_timestamp(fukuzono_result.predicted_failure_time),
            "r2": fukuzono_result.r2,
            "lowR2Warning": fukuzono_result.low_r2_warning,
        }

    # 5. SLO Gradient prediction
    slo_result = None
    slo_json = None
    if enable_forecasting and enable_slo:
        slo_cfg = _build_slo_config(params)
        slo_result = failure_predictor.predict_slo_gradient(
            prep_result.velocity_smooth,
            progressive_mask,
            slo_cfg,
            vcp_name=vcp_name,
        )
        if slo_result.error:
            errors.append(slo_result.error)
        slo_json = {
            "predictedFailureTime": serialise_timestamp(slo_result.predicted_failure_time),
        }

    # 6. Build combined chart
    combined_fig = visualizer.build_combined_chart(
        displacement=prep_result.displacement,
        velocity_smooth=prep_result.velocity_smooth,
        classification=classification,
        fukuzono_result=fukuzono_result,
        slo_result=slo_result,
        vcp_name=vcp_name,
        velocity_unit=velocity_unit,
    )

    # 7. Build stage summary (single VCP)
    stage_summary_df = visualizer.build_stage_summary([
        {
            "name": vcp_name,
            "displacement": prep_result.displacement,
            "velocity_smooth": prep_result.velocity_smooth,
            "classification": classification,
        }
    ])

    return {
        "vcpName": vcp_name,
        "smoothingWindow": smoothing_window,
        "velocityUnit": velocity_unit,
        "windows": _serialise_windows(classification.windows),
        "onsetOfFailure": serialise_timestamp(classification.onset_of_failure),
        "fukuzono": fukuzono_json,
        "slo": slo_json,
        "stageSummaryRows": _serialise_stage_summary_rows(stage_summary_df),
        "combinedChartJson": serialise_figure(combined_fig),
        # Preprocessed series (mm and mm/day) sent to the client so the manual
        # stage / boundary editor can replay them through classify-manual mode.
        "displacementSeries": serialise_series(prep_result.displacement),
        "velocitySmoothSeries": serialise_series(prep_result.velocity_smooth),
        # Store preprocessed series for classify-manual mode (not in final output)
        "_displacement": prep_result.displacement,
        "_velocity_smooth": prep_result.velocity_smooth,
        "_classification": classification,
        "_fukuzono_result": fukuzono_result,
        "_slo_result": slo_result,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# "analyze" mode handler
# ---------------------------------------------------------------------------


def handle_analyze(payload: dict) -> dict:
    """Process all (file × smoothing-window) VCP pairs and return the result."""
    files = payload.get("files", [])
    params = payload.get("params", {})

    vcp_results_raw = []  # includes internal _* keys for multi-vcp chart

    for file_spec in files:
        vcp_name_prefix = file_spec.get("vcpNamePrefix", "VCP")
        smoothing_windows = file_spec.get("smoothingWindows", [params.get("smoothingWindow", 7)])

        # Read the Excel bytes from base64 (HTTP) or a local path (CLI/tests).
        if file_spec.get("contentBase64") is not None:
            file_bytes = base64.b64decode(file_spec["contentBase64"])
        else:
            with open(file_spec["path"], "rb") as f:
                file_bytes = f.read()

        load_result = data_loader.load_excel(file_bytes)

        if load_result.errors:
            # Emit one error VCP entry per smoothing window so the frontend
            # can display the error inline.
            for sw in smoothing_windows:
                vcp_name = (
                    f"{vcp_name_prefix}_{sw}min"
                    if len(smoothing_windows) > 1
                    else vcp_name_prefix
                )
                vcp_results_raw.append({
                    "vcpName": vcp_name,
                    "smoothingWindow": sw,
                    "windows": [],
                    "onsetOfFailure": None,
                    "fukuzono": None,
                    "slo": None,
                    "stageSummaryRows": [],
                    "combinedChartJson": None,
                    "errors": load_result.errors,
                })
            continue

        # Use the first VCP column from the loaded DataFrame
        if not load_result.vcp_names:
            for sw in smoothing_windows:
                vcp_name = (
                    f"{vcp_name_prefix}_{sw}min"
                    if len(smoothing_windows) > 1
                    else vcp_name_prefix
                )
                vcp_results_raw.append({
                    "vcpName": vcp_name,
                    "smoothingWindow": sw,
                    "windows": [],
                    "onsetOfFailure": None,
                    "fukuzono": None,
                    "slo": None,
                    "stageSummaryRows": [],
                    "combinedChartJson": None,
                    "errors": ["No VCP columns found in the uploaded file."],
                })
            continue

        # Use the first available VCP column
        col_name = load_result.vcp_names[0]
        displacement_raw = load_result.raw_df[col_name].dropna()

        for sw in smoothing_windows:
            vcp_name = (
                f"{vcp_name_prefix}_{sw}min"
                if len(smoothing_windows) > 1
                else vcp_name_prefix
            )
            result = _run_single_vcp(displacement_raw, vcp_name, sw, params)
            vcp_results_raw.append(result)

    # Build multi-VCP comparison chart when ≥ 2 VCPs succeeded
    successful_vcps = [
        r for r in vcp_results_raw
        if r.get("_displacement") is not None
    ]

    multi_vcp_chart_json = None
    if len(successful_vcps) >= 2:
        vcp_list_for_chart = [
            {
                "name": r["vcpName"],
                "displacement": r["_displacement"],
                "velocity_smooth": r["_velocity_smooth"],
                "classification": r["_classification"],
                "fukuzono": r.get("_fukuzono_result"),
            }
            for r in successful_vcps
        ]
        # Use mm/h only when every compared VCP has a sub-daily window.
        multi_unit = (
            "mm/h"
            if all(r.get("smoothingWindow", 0) < 1440 for r in successful_vcps)
            else "mm/day"
        )
        multi_fig = visualizer.build_multi_vcp_chart(
            vcp_list_for_chart, velocity_unit=multi_unit
        )
        multi_vcp_chart_json = serialise_figure(multi_fig)

    # Strip internal _* keys before serialising to stdout
    clean_vcps = []
    for r in vcp_results_raw:
        clean = {k: v for k, v in r.items() if not k.startswith("_")}
        clean_vcps.append(clean)

    return {
        "vcps": clean_vcps,
        "multiVcpComparisonChartJson": multi_vcp_chart_json,
    }


# ---------------------------------------------------------------------------
# "classify-manual" mode handler
# ---------------------------------------------------------------------------


def handle_classify_manual(payload: dict) -> dict:
    """Re-classify a VCP using analyst-supplied stage boundaries."""
    vcp_name = payload.get("vcpName", "VCP")
    smoothing_window = int(payload.get("smoothingWindow", 7))
    windows_spec = payload.get("windows", [])

    # Reconstruct pd.Series from x/y arrays
    disp_data = payload.get("displacement", {"x": [], "y": []})
    vel_data = payload.get("velocity_smooth", {"x": [], "y": []})

    def _reconstruct_series(data: dict) -> pd.Series:
        x = [pd.Timestamp(ts) for ts in data.get("x", [])]
        y = data.get("y", [])
        return pd.Series(
            [float(v) if v is not None else float("nan") for v in y],
            index=pd.DatetimeIndex(x),
        )

    displacement = _reconstruct_series(disp_data)
    velocity_smooth = _reconstruct_series(vel_data)

    # Call classify_from_manual_windows
    classification = phase_classifier.classify_from_manual_windows(
        velocity_smooth, windows_spec
    )

    # Recompute the forecast from the (possibly edited) Progressive Failure
    # windows so dragging PF boundaries updates the prediction — matching the
    # Streamlit behaviour (issue 4).
    params = payload.get("params", {})
    enable_forecasting = params.get("enableForecasting", False)
    enable_fukuzono = params.get("enableFukuzono", True)
    enable_slo = params.get("enableSloGradient", False)

    progressive_mask = pd.Series(False, index=velocity_smooth.index)
    for w in classification.windows:
        if w.phase == "Progressive Failure":
            mask = (velocity_smooth.index >= w.start_time) & (
                velocity_smooth.index <= w.end_time
            )
            progressive_mask[mask] = True

    fukuzono_result = None
    fukuzono_json = None
    if enable_forecasting and enable_fukuzono:
        fukuzono_result = failure_predictor.predict_fukuzono(
            velocity_smooth,
            progressive_mask,
            _build_fukuzono_config(params),
            vcp_name=vcp_name,
        )
        fukuzono_json = {
            "predictedFailureTime": serialise_timestamp(
                fukuzono_result.predicted_failure_time
            ),
            "r2": fukuzono_result.r2,
            "lowR2Warning": fukuzono_result.low_r2_warning,
        }

    slo_result = None
    slo_json = None
    if enable_forecasting and enable_slo:
        slo_result = failure_predictor.predict_slo_gradient(
            velocity_smooth,
            progressive_mask,
            _build_slo_config(params),
            vcp_name=vcp_name,
        )
        slo_json = {
            "predictedFailureTime": serialise_timestamp(
                slo_result.predicted_failure_time
            ),
        }

    # Rebuild combined chart (match the analyze-mode velocity unit choice)
    velocity_unit = "mm/h" if smoothing_window < 1440 else "mm/day"
    combined_fig = visualizer.build_combined_chart(
        displacement=displacement,
        velocity_smooth=velocity_smooth,
        classification=classification,
        fukuzono_result=fukuzono_result,
        slo_result=slo_result,
        vcp_name=vcp_name,
        velocity_unit=velocity_unit,
    )

    # Rebuild stage summary
    stage_summary_df = visualizer.build_stage_summary([
        {
            "name": vcp_name,
            "displacement": displacement,
            "velocity_smooth": velocity_smooth,
            "classification": classification,
        }
    ])

    return {
        "windows": _serialise_windows(classification.windows),
        "onsetOfFailure": serialise_timestamp(classification.onset_of_failure),
        "fukuzono": fukuzono_json,
        "slo": slo_json,
        "combinedChartJson": serialise_figure(combined_fig),
        "stageSummaryRows": _serialise_stage_summary_rows(stage_summary_df),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input)

        mode = payload.get("mode", "analyze")

        if mode == "analyze":
            result = handle_analyze(payload)
        elif mode == "classify-manual":
            result = handle_classify_manual(payload)
        else:
            raise ValueError(f"Unknown mode: {mode!r}")

        # Write JSON result to stdout (Requirements 11.1, 11.2, 11.3)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        sys.stdout.flush()

    except Exception as exc:  # noqa: BLE001
        # Write only the exception message — no traceback — to stderr
        # (Requirement 11.6)
        sys.stderr.write(str(exc))
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
