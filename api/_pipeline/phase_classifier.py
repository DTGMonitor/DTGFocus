"""
phase_classifier.py — IV-regression based deformation phase classification.

Algorithm
---------
Rather than relying on velocity/acceleration thresholds (which become
unreliable when the preprocessor smoothing window is large), this module
uses the **Inverse Velocity (IV) linear-regression method** to detect the
onset of Progressive Failure:

  1. Compute IV = 1 / velocity for every point where velocity is above a
     significance threshold (v_low_frac × peak velocity).

  2. Retrospective IV scan: starting from the velocity peak and working
     backward, find the EARLIEST time t0 such that the IV series from t0 to
     the velocity peak fits a linear regression with:
       • slope < 0      (IV decreasing toward zero)
       • R² ≥ iv_r2_threshold
       • projected time-to-zero < max_horizon_days (plausible failure window)

  3. Phase assignment:
       index < t0  AND  velocity < v_threshold   → No Significant Movement
       index < t0  AND  velocity ≥ v_threshold   → Linear
       t0 ≤ index ≤ vel_peak                      → Progressive Failure
       index > vel_peak AND vel significant        → Regressive

  4. Short segments are merged into neighbours (same as before).

This approach is:
  • Robust to any smoothing window size (uses IV, not second derivative)
  • Physically grounded in the Fukuzono Inverse-Velocity model
  • Earlier onset detection (finds the first time the linear IV descent began)
  • Falls back to velocity/acceleration thresholds when IV regression fails

Public functions
----------------
:func:`classify`
    Main entry point; accepts smoothed velocity and acceleration series.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from models import (
    PHASE_LABELS,
    ClassificationConfig,
    ClassificationResult,
    WindowClassification,
)


# ---------------------------------------------------------------------------
# Internal helpers — segment merging and window conversion (unchanged)
# ---------------------------------------------------------------------------


def _merge_short_segments(
    phases: pd.Series,
    min_pts: int,
    protected: frozenset[str] | None = None,
) -> pd.Series:
    """Merge runs shorter than *min_pts* into their longer adjacent neighbour."""
    if protected is None:
        protected = frozenset()

    vals = phases.tolist()
    n = len(vals)
    changed = True
    while changed:
        changed = False
        i = 0
        while i < n:
            j = i
            while j < n and vals[j] == vals[i]:
                j += 1
            run_len = j - i
            if run_len >= min_pts or vals[i] in protected:
                i = j
                continue

            left_phase = vals[i - 1] if i > 0 else None
            right_phase = vals[j] if j < n else None

            if left_phase is None and right_phase is None:
                i = j
                continue

            if left_phase is None:
                fill = right_phase
            elif right_phase is None:
                fill = left_phase
            else:
                left_run = sum(
                    1 for k in range(i - 1, -1, -1) if vals[k] == left_phase
                )
                right_run = sum(
                    1 for k in range(j, n) if vals[k] == right_phase
                )
                fill = left_phase if left_run >= right_run else right_phase

            for k in range(i, j):
                vals[k] = fill
            changed = True
            i = j

    return pd.Series(vals, index=phases.index, dtype=object)


def _runs_to_windows(phases: pd.Series) -> list[WindowClassification]:
    """Convert a run-length-encoded phase Series to WindowClassification list."""
    windows: list[WindowClassification] = []
    if phases.empty:
        return windows

    run_start = phases.index[0]
    run_phase = phases.iloc[0]

    for ts, phase in phases.iloc[1:].items():
        if phase != run_phase:
            windows.append(
                WindowClassification(
                    start_time=run_start,
                    end_time=ts,
                    phase=run_phase,
                    confidence=1.0,
                    low_confidence=False,
                )
            )
            run_start = ts
            run_phase = phase

    windows.append(
        WindowClassification(
            start_time=run_start,
            end_time=phases.index[-1],
            phase=run_phase,
            confidence=1.0,
            low_confidence=False,
        )
    )
    return windows


def _detect_onset(windows: list[WindowClassification]) -> pd.Timestamp | None:
    """Return the start_time of the first 'Progressive Failure' segment."""
    for w in windows:
        if w.phase == "Progressive Failure":
            return w.start_time
    return None


# ---------------------------------------------------------------------------
# IV-based onset detection
# ---------------------------------------------------------------------------


def _find_progressive_onset_iv(
    velocity_smooth: pd.Series,
    iv_series: pd.Series,
    vel_peak_ts: pd.Timestamp,
    min_r2: float = 0.75,
    min_pts: int = 12,
    min_iv_ratio: float = 2.0,
) -> pd.Timestamp | None:
    """Find the earliest onset of Progressive Failure using IV regression.

    Scans backward from the velocity peak to find the earliest start time t0
    such that the IV series from t0 to the velocity peak:
      1. Fits a linear regression with R² ≥ min_r2
      2. Has a negative slope (IV decreasing toward zero)
      3. The fitted IV at start is at least ``min_iv_ratio`` × the fitted IV
         at the velocity peak — i.e. IV more than halved over the window.
         This is a scale-invariant proxy for "significant decline" and works
         regardless of how heavily the velocity is smoothed (with very large
         smoothing windows, slopes are gentle but the *relative* IV drop is
         still large during real Progressive Failure).

    Parameters
    ----------
    velocity_smooth:
        Smoothed velocity (DatetimeIndex, mm/day).
    iv_series:
        IV = 1/v, NaN where velocity is below the significance threshold.
    vel_peak_ts:
        Timestamp of the velocity maximum (failure point).
    min_r2:
        Minimum R² for the IV linear regression.  Default 0.75.
    min_pts:
        Minimum valid IV data points required in the regression window.
    min_iv_ratio:
        Required IV(start) / IV(end) ratio from the linear fit.  Default 2.0
        — IV must at least halve over the candidate window.

    Returns
    -------
    pd.Timestamp | None
        The earliest onset timestamp, or None if no clear Progressive Failure
        is detected.
    """
    # Work only with IV data up to the velocity peak (post-peak IV is meaningless)
    iv_pre = iv_series[iv_series.index <= vel_peak_ts].dropna()

    if len(iv_pre) < min_pts:
        return None

    idx = iv_pre.index
    # Convert to seconds from start for numerical stability
    t_s = (idx - idx[0]).total_seconds().values.astype(float)
    iv_vals = iv_pre.values.astype(float)
    n = len(iv_pre)

    best_onset_i: int | None = None

    # Search backward: start at (n - min_pts), move toward 0.
    # At each candidate start index, regress IV[start:] vs t[start:].
    for start_i in range(n - min_pts, -1, -1):
        t_w = t_s[start_i:]
        iv_w = iv_vals[start_i:]

        if len(t_w) < min_pts:
            continue

        # Linear regression via least squares (normalise t for stability)
        try:
            coeffs = np.polyfit(t_w - t_w[0], iv_w, 1)
            slope_ps = float(coeffs[0])  # per second
            intercept_at_start = float(coeffs[1])
        except (np.linalg.LinAlgError, ValueError):
            continue

        if slope_ps >= 0:
            continue  # IV must be declining

        iv_pred = slope_ps * (t_w - t_w[0]) + intercept_at_start
        ss_res = float(np.sum((iv_w - iv_pred) ** 2))
        ss_tot = float(np.sum((iv_w - iv_w.mean()) ** 2))

        if ss_tot == 0:
            continue  # Constant IV → not Progressive Failure

        r2 = 1.0 - ss_res / ss_tot

        if r2 < min_r2:
            continue

        # Scale-invariant "significant decline" check:
        # IV_start (from fit) should be ≥ min_iv_ratio × IV_end (from fit).
        # This works for any smoothing window — heavy smoothing just makes the
        # slope gentler, but the ratio remains large during real Progressive
        # Failure.
        iv_fit_start = intercept_at_start
        iv_fit_end = slope_ps * (t_w[-1] - t_w[0]) + intercept_at_start
        if iv_fit_start <= 0:
            continue
        if iv_fit_end <= 0:
            # Regression overshot zero — that's a very strong decline, accept
            ratio = float("inf")
        else:
            ratio = iv_fit_start / iv_fit_end

        if ratio < min_iv_ratio:
            continue

        # Valid candidate — keep the earliest one (loop continues backward).
        best_onset_i = start_i

    if best_onset_i is not None:
        return idx[best_onset_i]
    return None


# ---------------------------------------------------------------------------
# Fallback: acceleration-based Progressive Failure detection
# ---------------------------------------------------------------------------


def _classify_acceleration_based(
    vel_long: pd.Series,
    acc_long: pd.Series,
    v_threshold: float,
    a_multiplier: float,
) -> pd.Series:
    """Point-level phase labelling using long-smoothed velocity + acceleration.

    Used as a fallback when IV-based onset detection fails (e.g. no clear
    velocity peak or insufficient data).
    """
    v_abs = vel_long.abs()
    a_scale = float(acc_long.abs().quantile(0.75)) or 1e-6
    a_threshold = a_scale * a_multiplier

    phases = pd.Series("Linear", index=vel_long.index, dtype=object)
    phases[v_abs < v_threshold] = "No Significant Movement"
    phases[(vel_long >= v_threshold) & (acc_long >  a_threshold)] = "Progressive Failure"
    phases[(vel_long >= v_threshold) & (acc_long < -a_threshold)] = "Regressive"
    return phases


# ---------------------------------------------------------------------------
# Public API — manual-onset variant
# ---------------------------------------------------------------------------


def classify_with_manual_onset(
    velocity_smooth: pd.Series,
    config: ClassificationConfig,
    manual_onset: pd.Timestamp,
) -> ClassificationResult:
    """Build a classification using a **user-specified** Progressive Failure
    onset instead of the automatic IV detector.

    Phase assignment:
      • ``vel_long < v_threshold``                 → No Significant Movement
      • ``manual_onset ≤ t ≤ velocity_peak``        → Progressive Failure
      • ``t > velocity_peak`` (vel still > thresh)  → Regressive
      • All other significant-velocity points       → Linear

    This is the same logic used by :func:`classify` when its IV detector
    succeeds, but with the onset timestamp supplied by the analyst.

    Parameters
    ----------
    velocity_smooth:
        Smoothed velocity series (mm/day).
    config:
        Classification configuration (used for ``long_smooth_window``,
        ``v_low_frac`` and ``min_segment_pts``).
    manual_onset:
        Timestamp at which Progressive Failure begins, as picked by the user
        in the UI.
    """
    if velocity_smooth.empty:
        return ClassificationResult(errors=["velocity series is empty"])

    lw = max(3, getattr(config, "long_smooth_window", 24))
    min_p = max(1, lw // 4)
    vel_long = (
        velocity_smooth
        .rolling(lw, center=True, min_periods=min_p)
        .mean()
        .bfill()
        .ffill()
    )

    v_max = float(vel_long.abs().max()) or 1.0
    v_low_frac = float(getattr(config, "v_low_frac", 0.03))
    v_threshold = v_max * v_low_frac
    vel_peak_ts = vel_long.idxmax()

    # Clamp manual_onset into a usable range (must be < vel_peak_ts and
    # within the data span).
    if manual_onset > vel_peak_ts:
        # User pushed the onset past the failure peak; treat as no PF window.
        # The auto path would also produce no Progressive Failure here.
        manual_onset = vel_peak_ts
    if manual_onset < vel_long.index[0]:
        manual_onset = vel_long.index[0]

    v_abs_long = vel_long.abs()
    phases = pd.Series("Linear", index=vel_long.index, dtype=object)
    phases[v_abs_long < v_threshold] = "No Significant Movement"
    phases[
        (phases.index >= manual_onset) & (phases.index <= vel_peak_ts)
    ] = "Progressive Failure"
    phases[
        (phases.index > vel_peak_ts) & (v_abs_long >= v_threshold)
    ] = "Regressive"

    # Same segment-merging step as the automatic pathway.
    min_segment = max(2, getattr(config, "min_segment_pts", 12))
    phases = _merge_short_segments(phases, min_segment)

    windows = _runs_to_windows(phases)

    return ClassificationResult(
        windows=windows,
        onset_of_failure=manual_onset,
        errors=[],
    )


# ---------------------------------------------------------------------------
# Public API — fully-manual stage segmentation
# ---------------------------------------------------------------------------


def classify_from_manual_windows(
    velocity_smooth: pd.Series,
    windows_spec: list[dict],
) -> ClassificationResult:
    """Build a classification from an analyst-edited stage table.

    Unlike :func:`classify` and :func:`classify_with_manual_onset`, this
    function performs **no thresholding or re-detection** — the supplied stage
    boundaries are treated as authoritative.  It is the back-end for the
    editable stage table in the UI.

    Parameters
    ----------
    velocity_smooth:
        Smoothed velocity series.  Used only to clip the supplied windows to
        the available data range.
    windows_spec:
        Ordered list of dicts, each with keys ``"phase"`` (one of
        :data:`models.PHASE_LABELS`), ``"start"`` and ``"end"``
        (pd.Timestamp-coercible).  Rows with a missing/invalid phase, missing
        timestamps, or non-positive duration are dropped.

    Returns
    -------
    ClassificationResult
        Windows sorted by start time; ``onset_of_failure`` set to the start of
        the first ``"Progressive Failure"`` window (or None).
    """
    if velocity_smooth.empty:
        return ClassificationResult(errors=["velocity series is empty"])

    t_min = velocity_smooth.index[0]
    t_max = velocity_smooth.index[-1]

    errors: list[str] = []
    parsed: list[WindowClassification] = []
    for row in windows_spec:
        phase = row.get("phase")
        if phase not in PHASE_LABELS:
            continue
        try:
            start = pd.Timestamp(row.get("start"))
            end = pd.Timestamp(row.get("end"))
        except (ValueError, TypeError):
            continue
        if pd.isna(start) or pd.isna(end):
            continue
        # Clip to the available data range.
        start = max(start, t_min)
        end = min(end, t_max)
        if end <= start:
            continue
        parsed.append(
            WindowClassification(
                start_time=start,
                end_time=end,
                phase=phase,
                confidence=1.0,
                low_confidence=False,
            )
        )

    if not parsed:
        return ClassificationResult(
            errors=["no valid manual stages provided"],
        )

    parsed.sort(key=lambda w: w.start_time)

    onset = next(
        (w.start_time for w in parsed if w.phase == "Progressive Failure"),
        None,
    )

    return ClassificationResult(
        windows=parsed,
        onset_of_failure=onset,
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def classify(
    velocity_smooth: pd.Series,
    acceleration_smooth: pd.Series,
    config: ClassificationConfig | None = None,
    **_kwargs,
) -> ClassificationResult:
    """Classify deformation phases using the IV regression method.

    Phase detection algorithm:

    1. Long-window re-smoothing for a stable velocity signal (same as before).
    2. Adaptive No-Significant-Movement threshold from peak velocity.
    3. **IV-based onset detection** — retroactively finds the earliest time t0
       from which the inverse-velocity series decreases linearly toward zero
       with R² ≥ iv_r2_threshold.  This is the onset of Progressive Failure.
    4. Assign Progressive Failure for [t0, velocity_peak], Regressive after
       velocity_peak.
    5. Fallback to acceleration-based detection if IV method finds nothing.
    6. Merge short segments; convert to WindowClassification list.

    Parameters
    ----------
    velocity_smooth:
        Smoothed velocity time-series (DatetimeIndex, mm/day).
    acceleration_smooth:
        Smoothed acceleration time-series (DatetimeIndex, mm/day²).
    config:
        Classification configuration.  Defaults to ``ClassificationConfig()``.

    Returns
    -------
    ClassificationResult
    """
    if config is None:
        config = ClassificationConfig()

    errors: list[str] = []

    if velocity_smooth.empty:
        return ClassificationResult(errors=["velocity series is empty"])

    # ------------------------------------------------------------------
    # Step 1: Long-window re-smoothing for stable trend signal.
    # ------------------------------------------------------------------
    lw = max(3, getattr(config, "long_smooth_window", 24))
    min_p = max(1, lw // 4)

    vel_long = (
        velocity_smooth
        .rolling(lw, center=True, min_periods=min_p)
        .mean()
        .bfill()
        .ffill()
    )
    acc_long = (
        acceleration_smooth
        .rolling(lw, center=True, min_periods=min_p)
        .mean()
        .bfill()
        .ffill()
    )

    # ------------------------------------------------------------------
    # Step 2: Adaptive velocity significance threshold.
    # ------------------------------------------------------------------
    v_max = float(vel_long.abs().max()) or 1.0
    v_low_frac = float(getattr(config, "v_low_frac", 0.03))
    v_threshold = v_max * v_low_frac

    # ------------------------------------------------------------------
    # Step 3: Velocity peak (proxy for failure point).
    #
    # We use ``vel_long`` (long-smoothed velocity) rather than the raw
    # ``velocity_smooth`` because short user smoothing windows can produce
    # spurious noise peaks earlier than the real failure event.  The
    # long-smoothed peak is robust to those spikes.
    # ------------------------------------------------------------------
    vel_peak_ts = vel_long.idxmax()

    # ------------------------------------------------------------------
    # Step 4: Compute IV series for detection from ``vel_long``.
    #
    # Using the long-smoothed velocity makes the IV regression robust to
    # noise in short user smoothing windows (e.g. 30-min window on 7-min
    # sampling).  The chart still displays IV from the raw ``velocity_smooth``
    # so the user sees what their chosen window actually produces.
    # ------------------------------------------------------------------
    iv_series: pd.Series = pd.Series(np.nan, index=vel_long.index)
    sig_mask = vel_long > v_threshold
    iv_series[sig_mask] = 1.0 / vel_long[sig_mask]

    # ------------------------------------------------------------------
    # Step 5: IV-based onset detection.
    # ------------------------------------------------------------------
    iv_r2_threshold = float(getattr(config, "iv_r2_threshold", 0.75))
    min_pts = max(10, getattr(config, "min_segment_pts", 12))

    onset_ts = _find_progressive_onset_iv(
        vel_long,
        iv_series,
        vel_peak_ts,
        min_r2=iv_r2_threshold,
        min_pts=min_pts,
        min_iv_ratio=2.0,
    )

    # ------------------------------------------------------------------
    # Step 6: Phase assignment.
    # ------------------------------------------------------------------
    v_abs_long = vel_long.abs()

    if onset_ts is not None:
        # IV method succeeded — assign phases deterministically.
        phases = pd.Series("Linear", index=vel_long.index, dtype=object)
        phases[v_abs_long < v_threshold] = "No Significant Movement"
        phases[
            (phases.index >= onset_ts) & (phases.index <= vel_peak_ts)
        ] = "Progressive Failure"
        # Regressive: after the velocity peak where movement is still significant.
        phases[
            (phases.index > vel_peak_ts) & (v_abs_long >= v_threshold)
        ] = "Regressive"
    else:
        # Fallback: use velocity + acceleration thresholds.
        errors.append(
            "IV regression did not find a clear Progressive Failure phase; "
            "falling back to acceleration-based detection."
        )
        a_multiplier = float(getattr(config, "a_multiplier", 2.5))
        phases = _classify_acceleration_based(
            vel_long, acc_long, v_threshold, a_multiplier
        )

    # ------------------------------------------------------------------
    # Step 7: Merge short isolated segments.
    # ------------------------------------------------------------------
    min_segment = max(2, getattr(config, "min_segment_pts", 12))
    phases = _merge_short_segments(phases, min_segment)

    # ------------------------------------------------------------------
    # Step 8: Convert to WindowClassification objects; determine onset.
    # ------------------------------------------------------------------
    windows = _runs_to_windows(phases)
    onset = onset_ts or _detect_onset(windows)

    return ClassificationResult(
        windows=windows,
        onset_of_failure=onset,
        errors=errors,
    )
