"""
preprocessor.py — Gap detection, interpolation, velocity/acceleration
computation, and rolling-mean smoothing for displacement time-series.

Processing sequence (per design §2.2):
  1. Detect null values; record positions in gap_flags.
  2. Fill interior gaps of 1–3 consecutive nulls via linear interpolation;
     flag interior gaps ≥ 4 and all leading/trailing gaps as unresolvable.
  3. If fewer than 2 valid readings remain after interpolation, skip steps
     4–7 and emit an error identifying the VCP and count.
  4. Compute velocity: v[i] = (d[i+1] − d[i]) / (t[i+1] − t[i])  (mm/day).
  5. Compute acceleration: a[i] = (v[i+1] − v[i]) / (t[i+1] − t[i]).
  6. Validate smoothing_window ∈ [1, len(series)]; revert to 7 if invalid.
  7. Apply rolling mean with validated smoothing_window to velocity and
     acceleration; treat zero outputs as valid.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from models import PreprocessConfig, PreprocessResult


# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------

_SECONDS_PER_DAY: float = 86_400.0
_DEFAULT_SMOOTHING_WINDOW: int = 7


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _time_deltas_in_days(index: pd.DatetimeIndex) -> np.ndarray:
    """Return consecutive time differences in days (length N-1).

    Computed via ``total_seconds()`` so the result is independent of the index
    resolution.  (A raw ``index.asi8`` view returns nanoseconds for a
    ``datetime64[ns]`` index but **microseconds** for ``datetime64[us]`` — the
    default when pandas ≥ 2.0 reads datetimes from Excel — which would otherwise
    inflate every velocity by 1000×.)
    """
    deltas_seconds = index.to_series().diff().dropna().dt.total_seconds().to_numpy()
    return deltas_seconds / _SECONDS_PER_DAY


def _finite_difference(values: np.ndarray, dt_days: np.ndarray) -> np.ndarray:
    """First-order finite differences: result[i] = (values[i+1] - values[i]) / dt_days[i]."""
    return np.diff(values) / dt_days


def _classify_gaps(
    null_mask: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Classify null positions into fillable (interior, run ≤ 3) and unresolvable.

    Parameters
    ----------
    null_mask:
        Boolean array; ``True`` where the value is null.

    Returns
    -------
    fillable:
        Boolean array; ``True`` for interior null positions whose run length
        is 1–3 (should be filled by linear interpolation).
    unresolvable:
        Boolean array; ``True`` for positions that cannot be resolved:
        leading/trailing nulls, or interior runs of ≥ 4 consecutive nulls.
    """
    n = len(null_mask)
    fillable = np.zeros(n, dtype=bool)
    unresolvable = np.zeros(n, dtype=bool)

    if not null_mask.any():
        return fillable, unresolvable

    # Find first and last valid (non-null) positions.
    first_valid: int | None = None
    last_valid: int | None = None
    for i in range(n):
        if not null_mask[i]:
            first_valid = i
            break
    for i in range(n - 1, -1, -1):
        if not null_mask[i]:
            last_valid = i
            break

    # All values are null.
    if first_valid is None:
        unresolvable[:] = True
        return fillable, unresolvable

    # Leading nulls (before first valid value).
    if first_valid > 0:
        unresolvable[:first_valid] = True

    # Trailing nulls (after last valid value).
    if last_valid < n - 1:
        unresolvable[last_valid + 1 :] = True

    # Walk through interior null runs.
    i = first_valid
    while i <= last_valid:
        if null_mask[i]:
            run_start = i
            while i <= last_valid and null_mask[i]:
                i += 1
            run_end = i  # exclusive
            run_length = run_end - run_start
            if run_length <= 3:
                fillable[run_start:run_end] = True
            else:
                unresolvable[run_start:run_end] = True
        else:
            i += 1

    return fillable, unresolvable


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def preprocess(
    displacement: pd.Series,
    config: PreprocessConfig | None = None,
    vcp_name: str = "",
) -> PreprocessResult:
    """Clean, interpolate, differentiate, and smooth a displacement time-series.

    Parameters
    ----------
    displacement:
        Raw displacement series.  The index MUST be a ``pd.DatetimeIndex``
        with monotonically increasing timestamps.  Values are in mm.
    config:
        Preprocessing configuration.  Defaults to ``PreprocessConfig()`` if
        not supplied.
    vcp_name:
        Optional VCP identifier used in error messages.

    Returns
    -------
    PreprocessResult
        Contains cleaned displacement, velocity, acceleration, smoothed
        series, gap flags, and any error/validation messages.
    """
    if config is None:
        config = PreprocessConfig()

    errors: list[str] = []
    vcp_label = f"VCP '{vcp_name}'" if vcp_name else "the series"

    # ------------------------------------------------------------------
    # Step 1: Detect null values; record positions in gap_flags.
    # ------------------------------------------------------------------
    null_mask: np.ndarray = displacement.isna().to_numpy()
    fillable, unresolvable = _classify_gaps(null_mask)

    # gap_flags: True = unresolvable position.
    gap_flags = pd.Series(unresolvable, index=displacement.index, name="gap_flags")

    # ------------------------------------------------------------------
    # Step 2: Fill interior gaps of 1–3 via linear interpolation.
    # ------------------------------------------------------------------
    # Work on a copy so the caller's Series is not mutated.
    disp_clean = displacement.copy().astype(float)

    if fillable.any():
        # pandas interpolate(method='linear', limit_area='inside') fills NaN
        # values that have valid neighbours on both sides.
        disp_clean = disp_clean.interpolate(method="linear", limit_area="inside")

        # Re-apply unresolvable mask: large interior gaps may have been
        # partially filled by pandas if they happen to sit between valid
        # values; force them back to NaN.
        disp_clean[unresolvable] = np.nan

    # ------------------------------------------------------------------
    # Step 3: Check for sufficient valid readings.
    # ------------------------------------------------------------------
    valid_count = int(disp_clean.notna().sum())
    if valid_count < 2:
        errors.append(
            f"Preprocessor: {vcp_label} has only {valid_count} valid reading(s) "
            f"after interpolation — velocity and acceleration computation skipped."
        )
        empty = pd.Series(dtype=float)
        return PreprocessResult(
            displacement=disp_clean,
            velocity=empty,
            acceleration=empty,
            velocity_smooth=empty,
            acceleration_smooth=empty,
            gap_flags=gap_flags,
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Step 6: Validate smoothing_window before computing derivatives so
    # the validated window is ready when we apply smoothing in step 7.
    # ------------------------------------------------------------------
    series_len = len(disp_clean)
    sw = config.smoothing_window
    if sw < 1 or sw > series_len:
        errors.append(
            f"Preprocessor: smoothing_window={sw} is outside the accepted range "
            f"[1, {series_len}] — reverting to default window size of "
            f"{_DEFAULT_SMOOTHING_WINDOW}."
        )
        sw = _DEFAULT_SMOOTHING_WINDOW

    # ------------------------------------------------------------------
    # Step 4: Compute velocity (mm/day) via first-order finite difference.
    # ------------------------------------------------------------------
    if not isinstance(disp_clean.index, pd.DatetimeIndex):
        raise TypeError(
            "displacement.index must be a pd.DatetimeIndex for time-delta "
            "computation."
        )

    dt_days = _time_deltas_in_days(disp_clean.index)  # length N-1
    disp_values = disp_clean.to_numpy(dtype=float)
    vel_values = _finite_difference(disp_values, dt_days)  # length N-1

    # Align velocity to the *later* index (index[1:]).
    vel_index = disp_clean.index[1:]
    velocity = pd.Series(vel_values, index=vel_index, name="velocity")

    # ------------------------------------------------------------------
    # Step 5: Compute acceleration (mm/day²) via first-order finite
    # difference of velocity.
    # ------------------------------------------------------------------
    dt_days_vel = _time_deltas_in_days(vel_index)  # length N-2
    acc_values = _finite_difference(vel_values, dt_days_vel)  # length N-2

    acc_index = vel_index[1:]
    acceleration = pd.Series(acc_values, index=acc_index, name="acceleration")

    # ------------------------------------------------------------------
    # Step 7: Apply rolling mean with validated smoothing_window.
    # Zero outputs are treated as valid (Requirement 2.5).
    # ------------------------------------------------------------------
    velocity_smooth = (
        velocity.rolling(window=sw, min_periods=1, center=False)
        .mean()
        .rename("velocity_smooth")
    )
    acceleration_smooth = (
        acceleration.rolling(window=sw, min_periods=1, center=False)
        .mean()
        .rename("acceleration_smooth")
    )

    return PreprocessResult(
        displacement=disp_clean,
        velocity=velocity,
        acceleration=acceleration,
        velocity_smooth=velocity_smooth,
        acceleration_smooth=acceleration_smooth,
        gap_flags=gap_flags,
        errors=errors,
    )
