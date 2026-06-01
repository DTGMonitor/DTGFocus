"""
failure_predictor.py — Fukuzono Inverse Velocity Method and SLO Gradient
Method failure-time prediction.

Public functions
----------------
:func:`predict_fukuzono`
    Applies the Fukuzono Inverse Velocity Method to estimate failure time.

:func:`predict_slo_gradient`
    Applies the SLO Gradient Method to estimate failure time.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from models import FukuzonoConfig, PredictionResult, SLOConfig


def _linregress(x, y) -> tuple[float, float, float]:
    """Ordinary least-squares linear fit — drop-in for scipy.stats.linregress.

    Returns ``(slope, intercept, r_value)`` (the only fields the pipeline uses),
    avoiding a scipy dependency so the serverless bundle stays small.
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(x)
    if n < 2:
        return float("nan"), float("nan"), float("nan")
    x_mean = x.mean()
    y_mean = y.mean()
    dx = x - x_mean
    dy = y - y_mean
    ss_xx = float(np.sum(dx * dx))
    if ss_xx == 0.0:
        return float("nan"), float("nan"), float("nan")
    slope = float(np.sum(dx * dy) / ss_xx)
    intercept = float(y_mean - slope * x_mean)
    ss_yy = float(np.sum(dy * dy))
    r_value = 0.0 if ss_yy == 0.0 else float(np.sum(dx * dy) / np.sqrt(ss_xx * ss_yy))
    return slope, intercept, r_value

# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------

_DEFAULT_SLO_ROLLING_WINDOW: int = 5
_SLO_ROLLING_WINDOW_MIN: int = 3
_SLO_ROLLING_WINDOW_MAX: int = 50


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _series_to_numeric_days(series: pd.Series) -> np.ndarray:
    """Convert a DatetimeIndex series to numeric days since the first timestamp."""
    t0 = series.index[0]
    return np.array(
        [(ts - t0).total_seconds() / 86_400.0 for ts in series.index],
        dtype=float,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def predict_fukuzono(
    velocity_smooth: pd.Series,
    progressive_mask: pd.Series,
    config: FukuzonoConfig | None = None,
    vcp_name: str = "",
) -> PredictionResult:
    """Apply the Fukuzono Inverse Velocity Method.

    Parameters
    ----------
    velocity_smooth:
        Smoothed velocity time-series (DatetimeIndex, mm/day).
    progressive_mask:
        Boolean Series aligned to ``velocity_smooth``; True for time steps
        within the Progressive Failure phase.
    config:
        Fukuzono configuration.  Defaults to ``FukuzonoConfig()``.
    vcp_name:
        Optional VCP identifier used in exclusion log entries.

    Returns
    -------
    PredictionResult
        method = "Fukuzono"
    """
    if config is None:
        config = FukuzonoConfig()

    exclusion_log: list[dict[str, Any]] = []

    # ------------------------------------------------------------------
    # Step 1: Filter velocity to Progressive Failure phase.
    # ------------------------------------------------------------------
    mask_aligned = progressive_mask.reindex(velocity_smooth.index, fill_value=False)
    vel_prog = velocity_smooth[mask_aligned]

    if vel_prog.empty:
        return PredictionResult(
            method="Fukuzono",
            predicted_failure_time=None,
            error="Fukuzono: no Progressive Failure phase data available.",
            exclusion_log=exclusion_log,
        )

    # ------------------------------------------------------------------
    # Step 2: Exclude time steps where velocity ≤ 0; log each exclusion.
    # ------------------------------------------------------------------
    valid_mask = vel_prog > 0
    for ts, val in vel_prog[~valid_mask].items():
        exclusion_log.append(
            {
                "vcp": vcp_name,
                "method": "Fukuzono",
                "timestamp": ts.isoformat(),
                "reason": "velocity <= 0",
                "value": float(val),
            }
        )
    vel_valid = vel_prog[valid_mask]

    # ------------------------------------------------------------------
    # Step 3: Check minimum data points.
    # ------------------------------------------------------------------
    if len(vel_valid) < 3:
        return PredictionResult(
            method="Fukuzono",
            predicted_failure_time=None,
            error=(
                f"Fukuzono: insufficient data — only {len(vel_valid)} valid "
                "Inverse Velocity point(s) after exclusions (minimum 3 required)."
            ),
            exclusion_log=exclusion_log,
        )

    # ------------------------------------------------------------------
    # Step 4: Compute inverse velocity.
    # ------------------------------------------------------------------
    iv = 1.0 / vel_valid

    # ------------------------------------------------------------------
    # Step 4b: Clip to the velocity peak (IV minimum).
    # Post-failure velocity decelerates, causing IV to rise again.  Using
    # post-peak data reverses the sign of the regression slope and yields a
    # wildly incorrect extrapolation.  We trim the IV series to the last
    # monotonically-decreasing segment ending at the minimum IV value.
    # ------------------------------------------------------------------
    if len(iv) >= 4:
        # Find the index of the global minimum IV (= velocity maximum).
        min_idx = int(np.argmin(iv.to_numpy()))
        if min_idx < len(iv) - 1:
            # There are data points AFTER the IV minimum — drop them.
            iv = iv.iloc[: min_idx + 1]

    # ------------------------------------------------------------------
    # Step 4c: Apply tail fraction — keep only the last N % of IV points.
    # This focuses the regression on the accelerating portion near failure
    # and avoids the regression being dominated by the long near-zero
    # velocity plateau that precedes the acceleration.
    # ------------------------------------------------------------------
    tf = float(getattr(config, "tail_fraction", 1.0))
    tf = max(0.1, min(1.0, tf))
    tail_n = max(3, int(round(len(iv) * tf)))
    if tail_n < len(iv):
        iv = iv.iloc[-tail_n:]

    # ------------------------------------------------------------------
    # Step 5: Fit linear regression on (time_numeric, iv).
    # ------------------------------------------------------------------
    t_numeric = _series_to_numeric_days(iv)
    slope, intercept, r_value = _linregress(t_numeric, iv.to_numpy())

    r2 = float(r_value ** 2)
    low_r2_warning = r2 < config.r2_warning_threshold

    # ------------------------------------------------------------------
    # Step 6: Extrapolate to iv = 0 → t_f = t_0 − intercept / slope.
    # ------------------------------------------------------------------
    if slope == 0.0 or not np.isfinite(slope) or not np.isfinite(intercept):
        return PredictionResult(
            method="Fukuzono",
            predicted_failure_time=None,
            r2=r2,
            low_r2_warning=low_r2_warning,
            error=(
                "Fukuzono: regression slope/intercept is not finite — "
                "cannot extrapolate to failure (data may be degenerate)."
            ),
            exclusion_log=exclusion_log,
        )

    # t_f in days since iv.index[0]
    t_f_days = -intercept / slope
    if not np.isfinite(t_f_days):
        return PredictionResult(
            method="Fukuzono",
            predicted_failure_time=None,
            r2=r2,
            low_r2_warning=low_r2_warning,
            error="Fukuzono: extrapolated failure time is not finite.",
            exclusion_log=exclusion_log,
        )

    # Guard against extrapolations so large that pandas can't represent them
    # as a Timedelta (>>> 292 years).  Use 100 years as a reasonable bound;
    # any real slope-failure forecast within an order of magnitude of this
    # is physically meaningless.
    if abs(t_f_days) > 36_500.0:  # ~100 years
        return PredictionResult(
            method="Fukuzono",
            predicted_failure_time=None,
            r2=r2,
            low_r2_warning=low_r2_warning,
            error=(
                f"Fukuzono: extrapolated failure time is {t_f_days:.1f} days "
                "from t0 — outside the physically plausible range."
            ),
            exclusion_log=exclusion_log,
        )
    t0 = iv.index[0]
    predicted_failure_time = t0 + pd.Timedelta(days=t_f_days)

    # Build the fitted regression line over the same time index as the
    # input IV points so the Visualizer can overlay it.
    regression_line = pd.Series(
        slope * t_numeric + intercept,
        index=iv.index,
        name="fukuzono_fit",
    )

    # ------------------------------------------------------------------
    # Build the velocity forecast from the regression window start to the
    # point where velocity = 2× the peak observed velocity (to avoid the
    # asymptote blowing up the chart scale).  The predicted failure time
    # is still marked as a vertical line by the visualizer.
    # V(t) = 1 / (slope*t + intercept)
    # ------------------------------------------------------------------
    velocity_forecast: pd.Series | None = None
    t_start_fc = t_numeric[0]       # start of regression window (days from t0)

    # Stop forecast at 2× the maximum actual velocity in the regression window.
    v_peak_actual = float(vel_valid.max())
    iv_end_fc = 1.0 / (v_peak_actual * 2.0)           # IV at 2× peak velocity
    t_end_fc_slope = (iv_end_fc - intercept) / slope   # time when IV reaches that value
    # Clamp: must be between regression start and the extrapolated failure time.
    t_end_fc = max(t_start_fc, min(t_f_days * 0.9999, t_end_fc_slope))

    if t_end_fc > t_start_fc:
        n_fc = max(40, min(500, int((t_end_fc - t_start_fc) * 24 * 6)))
        t_fc = np.linspace(t_start_fc, t_end_fc, n_fc)
        iv_fc = slope * t_fc + intercept
        valid_fc = iv_fc > 1e-9
        if valid_fc.any():
            vel_fc_vals = 1.0 / iv_fc[valid_fc]
            fc_times = pd.DatetimeIndex(
                [t0 + pd.Timedelta(days=float(d)) for d in t_fc[valid_fc]]
            )
            velocity_forecast = pd.Series(
                vel_fc_vals, index=fc_times, name="velocity_forecast"
            )

    return PredictionResult(
        method="Fukuzono",
        predicted_failure_time=predicted_failure_time,
        r2=r2,
        low_r2_warning=low_r2_warning,
        exclusion_log=exclusion_log,
        error=None,
        regression_line=regression_line,
        velocity_forecast=velocity_forecast,
    )


def predict_slo_gradient(
    velocity_smooth: pd.Series,
    progressive_mask: pd.Series,
    config: SLOConfig | None = None,
    vcp_name: str = "",  # noqa: ARG001 — kept for API symmetry with Fukuzono
) -> PredictionResult:
    """Apply the SLO Gradient method as an independent cross-check.

    Algorithm:
      1. Filter velocity to the Progressive Failure phase.
      2. Compute the velocity gradient (dv/dt, mm/day²) over rolling windows
         of ``config.rolling_window`` readings via local linear regression.
      3. Apply the tail fraction — keep only the most recent N % of the
         gradient series so the trend fit focuses on the steepest part.
      4. Fit a linear trend to the gradient series: ``grad(t) = m*t + c``.
      5. Predict failure when the extrapolated gradient reaches
         ``config.critical_threshold`` (mm/day²) — i.e. when acceleration
         hits the user's "failure-imminent" level.

    Unlike the Fukuzono method (which extrapolates 1/v → 0, i.e. infinite
    velocity), the SLO method extrapolates the *gradient* to a finite,
    user-set threshold — typically giving an earlier predicted failure
    time and providing a useful comparison check.

    Parameters
    ----------
    velocity_smooth:
        Smoothed velocity time-series (DatetimeIndex, mm/day).
    progressive_mask:
        Boolean Series aligned to ``velocity_smooth``; True for time steps
        within the Progressive Failure phase.
    config:
        SLO Gradient configuration.  Defaults to ``SLOConfig()``.
    vcp_name:
        Optional VCP identifier (unused in SLO but kept for API symmetry).

    Returns
    -------
    PredictionResult
        method = "SLO_Gradient"
    """
    if config is None:
        config = SLOConfig()

    # ------------------------------------------------------------------
    # Step 1: Validate rolling_window.
    # ------------------------------------------------------------------
    rw = config.rolling_window
    if rw < _SLO_ROLLING_WINDOW_MIN:
        rw = _DEFAULT_SLO_ROLLING_WINDOW
    if rw > _SLO_ROLLING_WINDOW_MAX:
        rw = _SLO_ROLLING_WINDOW_MAX

    # ------------------------------------------------------------------
    # Step 2: Filter velocity to Progressive Failure phase.
    # ------------------------------------------------------------------
    mask_aligned = progressive_mask.reindex(velocity_smooth.index, fill_value=False)
    vel_prog = velocity_smooth[mask_aligned]

    if vel_prog.empty:
        return PredictionResult(
            method="SLO_Gradient",
            predicted_failure_time=None,
            error="SLO Gradient: no Progressive Failure phase data available.",
        )

    # ------------------------------------------------------------------
    # Step 3: Compute rolling velocity gradient (dv/dt, mm/day²).
    # ------------------------------------------------------------------
    t_numeric_full = _series_to_numeric_days(vel_prog)
    vel_values = vel_prog.to_numpy(dtype=float)
    n = len(vel_values)

    if n < rw:
        return PredictionResult(
            method="SLO_Gradient",
            predicted_failure_time=None,
            error=(
                f"SLO Gradient: insufficient data — need at least {rw} "
                f"readings in Progressive Failure (have {n})."
            ),
        )

    gradient_values: list[float] = []
    gradient_times: list[pd.Timestamp] = []

    for i in range(rw - 1, n):
        window_t = t_numeric_full[i - rw + 1 : i + 1]
        window_v = vel_values[i - rw + 1 : i + 1]
        if len(window_t) < 2:
            continue
        slope, _intercept, _r = _linregress(window_t, window_v)
        gradient_values.append(float(slope))
        gradient_times.append(vel_prog.index[i])

    if len(gradient_values) < 3:
        return PredictionResult(
            method="SLO_Gradient",
            predicted_failure_time=None,
            error=(
                f"SLO Gradient: only {len(gradient_values)} gradient point(s) "
                "computed — need ≥ 3 for a stable trend fit."
            ),
        )

    gradient_series = pd.Series(gradient_values, index=gradient_times)

    # ------------------------------------------------------------------
    # Step 4: Apply tail fraction — focus on the most recent N % of points.
    #
    # Allowed range: 0.01 – 1.00.  The hard 3-point floor below ensures a
    # linear regression remains well-defined even for very small fractions.
    # ------------------------------------------------------------------
    tf = float(getattr(config, "tail_fraction", 0.30))
    tf = max(0.01, min(1.0, tf))
    tail_n = max(3, int(round(len(gradient_series) * tf)))
    if tail_n < len(gradient_series):
        gradient_series = gradient_series.iloc[-tail_n:]

    # ------------------------------------------------------------------
    # Step 5: Fit a linear trend to the (possibly truncated) gradient series.
    # ------------------------------------------------------------------
    t_grad_numeric = _series_to_numeric_days(gradient_series)
    grad_slope, grad_intercept, r_value = _linregress(
        t_grad_numeric, gradient_series.to_numpy()
    )

    r2 = float(r_value ** 2) if np.isfinite(r_value) else 0.0
    low_r2_warning = r2 < float(getattr(config, "r2_warning_threshold", 0.70))

    # Build trend line for the visualizer.
    trend_line = pd.Series(
        grad_slope * t_grad_numeric + grad_intercept,
        index=gradient_series.index,
        name="slo_gradient_fit",
    )

    # ------------------------------------------------------------------
    # Step 6: Extrapolate to gradient = critical_threshold.
    # ------------------------------------------------------------------
    if grad_slope == 0.0 or not np.isfinite(grad_slope):
        return PredictionResult(
            method="SLO_Gradient",
            predicted_failure_time=None,
            r2=r2,
            low_r2_warning=low_r2_warning,
            error=(
                "SLO Gradient: gradient trend slope is zero or non-finite — "
                "cannot extrapolate to critical threshold."
            ),
            regression_line=trend_line,
        )

    critical = float(config.critical_threshold)
    t_intersect_days = (critical - grad_intercept) / grad_slope

    if not np.isfinite(t_intersect_days):
        return PredictionResult(
            method="SLO_Gradient",
            predicted_failure_time=None,
            r2=r2,
            low_r2_warning=low_r2_warning,
            error="SLO Gradient: extrapolated failure time is not finite.",
            regression_line=trend_line,
        )

    # Sanity bound: physical-plausibility window of ±100 years from t0_grad.
    if abs(t_intersect_days) > 36_500.0:
        return PredictionResult(
            method="SLO_Gradient",
            predicted_failure_time=None,
            r2=r2,
            low_r2_warning=low_r2_warning,
            error=(
                f"SLO Gradient: extrapolated failure time is "
                f"{t_intersect_days:.1f} days from regression start — "
                "outside the physically plausible range. "
                "Try a lower critical_threshold."
            ),
            regression_line=trend_line,
        )

    t0_grad = gradient_series.index[0]
    predicted_failure_time = t0_grad + pd.Timedelta(days=t_intersect_days)

    return PredictionResult(
        method="SLO_Gradient",
        predicted_failure_time=predicted_failure_time,
        r2=r2,
        low_r2_warning=low_r2_warning,
        exclusion_log=[],
        error=None,
        regression_line=trend_line,
    )
