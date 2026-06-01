"""
models.py — Shared dataclasses and type definitions for the Slope Failure
Prediction Platform.

All pipeline layers import their input/output types from this module to avoid
circular dependencies and to keep the data contracts in one place.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pandas as pd


# ---------------------------------------------------------------------------
# Data Loader
# ---------------------------------------------------------------------------

@dataclass
class LoadResult:
    """Output of :func:`data_loader.load_excel`."""

    # Sheet 1 data indexed by pd.DatetimeIndex; columns include displacement
    # and any pre-computed velocity / inverse-velocity / acceleration columns.
    raw_df: pd.DataFrame = field(default_factory=pd.DataFrame)

    # Sheet 4 (Summary) data.
    summary_df: pd.DataFrame = field(default_factory=pd.DataFrame)

    # VCP identifiers extracted from the workbook.
    vcp_names: list[str] = field(default_factory=list)

    # Non-fatal issues (e.g., empty chart sheets).
    warnings: list[str] = field(default_factory=list)

    # Fatal issues that halt further processing.
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Preprocessor
# ---------------------------------------------------------------------------

@dataclass
class PreprocessConfig:
    """Configuration for :func:`preprocessor.preprocess`."""

    # Rolling mean window size applied to velocity and acceleration.
    # Valid range: 1 – len(series).  Reverts to 7 if out of range.
    smoothing_window: int = 7


@dataclass
class PreprocessResult:
    """Output of :func:`preprocessor.preprocess`."""

    # Cleaned displacement time-series (pd.Series with DatetimeIndex).
    displacement: pd.Series = field(default_factory=pd.Series)

    # First-order finite difference of displacement (mm/day).
    velocity: pd.Series = field(default_factory=pd.Series)

    # First-order finite difference of velocity.
    acceleration: pd.Series = field(default_factory=pd.Series)

    # Rolling-mean smoothed velocity.
    velocity_smooth: pd.Series = field(default_factory=pd.Series)

    # Rolling-mean smoothed acceleration.
    acceleration_smooth: pd.Series = field(default_factory=pd.Series)

    # Boolean mask: True at positions that are unresolvable gaps.
    gap_flags: pd.Series = field(default_factory=pd.Series)

    # Validation / processing errors encountered during preprocessing.
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Phase Classifier
# ---------------------------------------------------------------------------

# Valid phase labels produced by the classifier.
PHASE_LABELS: tuple[str, ...] = (
    "No Significant Movement",
    "Linear",
    "Progressive Failure",
    "Regressive",
    "Unclassified",  # Used when the model raises on a window.
)


@dataclass
class ClassificationConfig:
    """Configuration for :func:`phase_classifier.classify`."""

    # Extra long-window rolling mean applied to velocity and acceleration
    # before threshold-based phase assignment.
    # At 7-min intervals: 24 ≈ 2.8 h, 48 ≈ 5.6 h, 96 ≈ 11 h.
    # Larger values smooth out more noise but reduce temporal resolution.
    long_smooth_window: int = 24

    # Velocity threshold as a fraction of the peak long-smoothed velocity.
    # Readings with |vel_long| below this fraction are "No Significant Movement".
    # Default 0.03 = 3 % of the observed peak.
    v_low_frac: float = 0.03

    # Acceleration threshold multiplier.
    # a_threshold = a_multiplier × 75th-percentile of |acc_long|.
    # Higher → fewer Progressive / Regressive detections.  Default 2.5.
    a_multiplier: float = 2.5

    # Minimum consecutive readings to retain a phase segment.
    # Shorter runs are merged into their longer neighbour.
    # Default 12 ≈ 84 min at 7-min intervals — removes sub-hour noise
    # artefacts while keeping all genuine phase transitions (≥ 2 h).
    min_segment_pts: int = 12

    # R² threshold for the IV linear-regression onset detector.
    # The classifier scans backward from the velocity peak and finds the
    # earliest start time from which IV = 1/v decreases linearly to zero
    # with at least this R².  Higher values → stricter, later onset.
    # Lower values → more tolerant, potentially earlier onset.
    # Valid range: 0.50 – 1.0.  Default 0.75.
    iv_r2_threshold: float = 0.75


@dataclass
class WindowClassification:
    """Classification result for a single time window."""

    start_time: pd.Timestamp
    end_time: pd.Timestamp

    # One of the strings in PHASE_LABELS.
    phase: str

    # Maximum class probability from predict_proba; range [0.0, 1.0].
    confidence: float

    # True if confidence < low_confidence_threshold (default 0.70).
    low_confidence: bool


@dataclass
class ClassificationResult:
    """Output of :func:`phase_classifier.classify`."""

    windows: list[WindowClassification] = field(default_factory=list)

    # Start time of the first "Progressive Failure" window whose immediately
    # following window is also "Progressive Failure"; None if no such pair.
    onset_of_failure: pd.Timestamp | None = None

    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Failure Predictor
# ---------------------------------------------------------------------------

@dataclass
class FukuzonoConfig:
    """Configuration for :func:`failure_predictor.predict_fukuzono`."""

    # R² below this value triggers a low-fit-quality warning.
    # Valid range: 0.0 – 1.0.
    r2_warning_threshold: float = 0.80

    # Fraction of the Progressive Failure data to use for IV regression,
    # taken from the tail (most recent readings).  1.0 = use all data.
    # Reducing this focuses the regression on the accelerating portion
    # immediately before failure, where IV is most nearly linear.
    # Valid range: 0.1 – 1.0.
    tail_fraction: float = 0.20


@dataclass
class SLOConfig:
    """Configuration for :func:`failure_predictor.predict_slo_gradient`.

    The SLO Gradient method computes a rolling-window velocity gradient
    (dv/dt) over the Progressive Failure phase, fits a linear trend to that
    gradient, and extrapolates it to a critical threshold to predict the
    failure time.  Acts as an independent cross-check against the Fukuzono
    Inverse-Velocity prediction.
    """

    # Rolling window (number of readings) used to compute each instantaneous
    # velocity gradient via local linear regression.
    # Valid range: 3 – 50.  Default 5.
    rolling_window: int = 5

    # Velocity-gradient threshold (mm/day²) that triggers a failure
    # prediction when the extrapolated trend crosses it.  Failure is
    # forecast at the time when fitted gradient ≥ this value.
    # Higher → later prediction.  Default 50.0.
    critical_threshold: float = 50.0

    # Fraction of Progressive Failure data (tail = most recent readings)
    # used to fit the gradient trend.  Lower → focuses on the steepest
    # part near failure.  Valid range: 0.1 – 1.0.  Default 0.30.
    tail_fraction: float = 0.30

    # R² below this value triggers a low-fit-quality warning on the
    # gradient-trend regression.  Valid range: 0.0 – 1.0.  Default 0.70.
    r2_warning_threshold: float = 0.70



@dataclass
class PredictionResult:
    """Output of :func:`failure_predictor.predict_fukuzono` and
    :func:`failure_predictor.predict_slo_gradient`."""

    # "Fukuzono" or "SLO_Gradient".
    method: str = ""

    # None when prediction could not be produced.
    predicted_failure_time: pd.Timestamp | None = None

    # Coefficient of determination from the Fukuzono linear regression.
    # None for SLO Gradient results.
    r2: float | None = None

    # True when R² < r2_warning_threshold (Fukuzono only).
    low_r2_warning: bool = False

    # Log of excluded time steps.  Each entry follows the ExclusionLogEntry
    # schema defined below.
    exclusion_log: list[dict[str, Any]] = field(default_factory=list)

    # Non-None when a fatal or informational condition prevents a result.
    error: str | None = None

    # Fitted regression / trend line (Fukuzono: inverse-velocity fit;
    # SLO Gradient: velocity-gradient fit).  Index aligns with the points
    # used in the fit; values are the predicted y-coordinates.  ``None``
    # when no fit could be produced.
    regression_line: pd.Series | None = None

    # Forecast velocity trace — extrapolated V(t) = 1/IV_fit from the start
    # of the regression window to just before the predicted failure time.
    # Used to overlay a "what the model predicts" dashed line on the velocity
    # chart and to compute the forecast displacement curve.  ``None`` when
    # no valid extrapolation could be produced.
    velocity_forecast: pd.Series | None = None


# ---------------------------------------------------------------------------
# Exclusion Log Entry schema
# ---------------------------------------------------------------------------
# Each entry in PredictionResult.exclusion_log is a plain dict with the
# following keys (all required):
#
#   "vcp"       : str   — VCP identifier
#   "method"    : str   — "Fukuzono" or "SLO_Gradient"
#   "timestamp" : str   — ISO 8601 representation of the excluded time step
#   "reason"    : str   — Human-readable reason, e.g. "velocity <= 0"
#   "value"     : float — The raw value that triggered the exclusion
#
# Example:
#   {
#       "vcp": "VCP-01",
#       "method": "Fukuzono",
#       "timestamp": "2024-03-15T14:30:00",
#       "reason": "velocity <= 0",
#       "value": -0.003,
#   }


# ---------------------------------------------------------------------------
# VCP Data Container
# ---------------------------------------------------------------------------

@dataclass
class VCPData:
    """Aggregated analysis results for a single Vertical Control Point."""

    # VCP identifier (matches a key in LoadResult.vcp_names).
    name: str = ""

    # Raw displacement time-series (DatetimeIndex, values in mm).
    raw_displacement: pd.Series = field(default_factory=pd.Series)

    # Results from each pipeline stage.
    preprocessed: PreprocessResult = field(default_factory=PreprocessResult)
    classification: ClassificationResult = field(default_factory=ClassificationResult)
    fukuzono: PredictionResult = field(default_factory=lambda: PredictionResult(method="Fukuzono"))
    slo_gradient: PredictionResult = field(default_factory=lambda: PredictionResult(method="SLO_Gradient"))

    # Entered by the analyst for back-analysis error computation.
    actual_failure_time: pd.Timestamp | None = None
