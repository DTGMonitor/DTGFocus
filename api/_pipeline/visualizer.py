"""
visualizer.py — Plotly figure construction and summary table assembly.

All figures use the fixed phase colour mapping defined at the top of the
module.  The summary table is returned as a Pandas DataFrame with the string
``"N/A"`` substituted for any unavailable value.

Public functions
----------------
:func:`build_combined_chart`
    Single-panel chart with three y-axes (Displacement left, Velocity right,
    Inverse Velocity far-right) sharing a common time axis.  Includes phase
    bands, onset / Fukuzono / SLO vlines, and optional live-preview onset
    marker.

:func:`build_multi_vcp_chart`
    Three-row comparison chart (Displacement / Velocity / Inverse Velocity),
    one trace per VCP per row, for side-by-side VCP comparison.

:func:`build_summary_table`
    Summary DataFrame with VCP name, onset, Fukuzono predicted, SLO predicted,
    actual failure time, and per-method errors.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import plotly.graph_objects as go  # type: ignore[import]
from plotly.subplots import make_subplots  # type: ignore[import]

from models import ClassificationResult, PredictionResult

# ---------------------------------------------------------------------------
# Phase colour mapping (fixed, per design §2.5)
# ---------------------------------------------------------------------------

PHASE_COLORS: dict[str, str] = {
    "No Significant Movement": "#2196F3",
    "Linear": "#4CAF50",
    "Progressive Failure": "#FF5722",
    "Regressive": "#9C27B0",
    "Unclassified": "#9E9E9E",
}

_NA = "N/A"

# Distinguishable colours for multi-VCP overlays (up to 8 VCPs).
_VCP_COLORS: list[str] = [
    "#FFFFFF",  # 1 — white
    "#FFD700",  # 2 — gold
    "#00E5FF",  # 3 — cyan
    "#FF6B35",  # 4 — orange
    "#FF69B4",  # 5 — hot pink
    "#7FFF00",  # 6 — chartreuse
    "#DA70D6",  # 7 — orchid
    "#FA8072",  # 8 — salmon
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _add_phase_bands(
    fig: go.Figure,
    classification: ClassificationResult,
    row: int = 1,
    col: int = 1,
) -> None:
    """Add colour-band vrect shapes for each deformation phase window."""
    for w in classification.windows:
        color = PHASE_COLORS.get(w.phase, "#9E9E9E")
        fig.add_vrect(
            x0=w.start_time,
            x1=w.end_time,
            fillcolor=color,
            opacity=0.15,
            layer="below",
            line_width=0,
            row=row,
            col=col,
        )
        if w.low_confidence:
            # Dashed border overlay for low-confidence windows.
            fig.add_vrect(
                x0=w.start_time,
                x1=w.end_time,
                fillcolor=color,
                opacity=0.25,
                layer="above",
                line_width=2,
                line_dash="dot",
                line_color=color,
                row=row,
                col=col,
            )


def _hours_diff(t_pred: pd.Timestamp, t_actual: pd.Timestamp) -> float:
    """Return (t_pred − t_actual) in hours, rounded to 2 decimal places."""
    diff_hours = (t_pred - t_actual).total_seconds() / 3600.0
    return round(diff_hours, 2)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


_LEGEND_PHASES: list[tuple[str, str]] = [
    ("No Significant Movement", PHASE_COLORS["No Significant Movement"]),
    ("Linear", PHASE_COLORS["Linear"]),
    ("Progressive Failure", PHASE_COLORS["Progressive Failure"]),
    ("Regressive", PHASE_COLORS["Regressive"]),
]


def _compute_iv(
    velocity_smooth: pd.Series,
    cutoff: pd.Timestamp | None = None,
    v_min_frac: float = 0.02,
) -> pd.Series:
    """Return Inverse Velocity (day/mm) for display purposes.

    Filters and truncates the IV series so that the chart shows only the
    physically meaningful decreasing trend as failure approaches:

    * **Minimum velocity filter** — points where velocity < ``v_min_frac`` ×
      peak velocity are excluded.  This removes the large IV spikes caused by
      near-zero velocity periods at the start of a dataset (before the slope
      starts moving) without affecting the important pre-failure trend.
    * **Upper time cutoff** — IV is only shown up to the velocity peak (the
      failure point).  Post-failure regressive velocity drops back toward zero,
      which would otherwise cause IV spikes that obscure the pre-failure trend.

    Parameters
    ----------
    velocity_smooth:
        Smoothed velocity series (mm/day).
    cutoff:
        Upper time limit.  Defaults to ``velocity_smooth.idxmax()`` (velocity
        peak).  Pass ``None`` to use the default.
    v_min_frac:
        Minimum velocity as a fraction of the series peak.  Points below this
        fraction are excluded from the IV series.  Default 0.02 (2 % of peak).
    """
    if cutoff is None:
        cutoff = velocity_smooth.idxmax()

    v_max = float(velocity_smooth.max())
    v_min = v_max * v_min_frac if v_max > 0 else 0.0

    series = velocity_smooth[velocity_smooth.index <= cutoff]
    # Keep only points where velocity is above the significance floor.
    series = series[series > v_min]
    return series.apply(lambda v: 1.0 / v)


def _velocity_unit_factor(velocity_unit: str) -> float:
    """Multiplier to convert an internal mm/day velocity to the display unit."""
    return 1.0 / 24.0 if velocity_unit == "mm/h" else 1.0


def _inverse_velocity_unit(velocity_unit: str) -> str:
    """Inverse-velocity display unit paired with the velocity unit."""
    return "h/mm" if velocity_unit == "mm/h" else "day/mm"


def _inverse_velocity_unit_factor(velocity_unit: str) -> float:
    """Multiplier to convert an internal day/mm inverse velocity to the display unit.

    Inverse velocity is 1/velocity, so converting velocity mm/day → mm/h scales
    inverse velocity day/mm → h/mm by ×24.
    """
    return 24.0 if velocity_unit == "mm/h" else 1.0


def build_combined_chart(
    displacement: pd.Series,
    velocity_smooth: pd.Series,
    classification: ClassificationResult,
    fukuzono_result: PredictionResult | None = None,
    slo_result: PredictionResult | None = None,
    vcp_name: str = "",
    preview_onset: pd.Timestamp | None = None,
    velocity_unit: str = "mm/day",
) -> go.Figure:
    """Build a single-panel chart with three y-axes sharing a common time axis.

    Layout:
    - Left y-axis  — Displacement (mm), white trace
    - Right y-axis — Velocity (mm/day), green trace
    - Far-right y-axis — Inverse Velocity (day/mm), blue trace

    Inverse Velocity is shown only up to the velocity peak so the classic
    "IV decreases towards zero as failure approaches" trend is clearly visible.
    Phase bands, forecast overlays, and event markers are all included.

    Parameters
    ----------
    displacement:
        Cleaned displacement time-series (DatetimeIndex, mm).
    velocity_smooth:
        Smoothed velocity series (DatetimeIndex, mm/day).
    classification:
        Phase classification result for this VCP.
    fukuzono_result:
        Optional IV/Fukuzono result.  When provided, an orange dashed
        vertical line marks the predicted failure time.
    slo_result:
        Optional SLO Gradient result.  When provided, a cyan dashed
        vertical line marks the SLO-predicted failure time.
    vcp_name:
        VCP identifier used in the chart title.

    Returns
    -------
    go.Figure
    """
    fig = go.Figure()

    # Velocity is computed internally in mm/day; the chart may display it in
    # mm/h when the analysis window is sub-daily (Requirement: issue 3). The
    # paired inverse-velocity unit (day/mm ↔ h/mm) tracks the velocity unit.
    vfac = _velocity_unit_factor(velocity_unit)
    iv_unit = _inverse_velocity_unit(velocity_unit)
    ivfac = _inverse_velocity_unit_factor(velocity_unit)

    # ── IV cutoff: velocity peak only ─────────────────────────────────────
    # Do NOT use predicted_failure_time as cutoff — it can be earlier than
    # the velocity peak, which would truncate the IV even further and make
    # the decreasing trend harder to see.  The velocity peak is the only
    # physically meaningful end point for the IV display.
    iv_cutoff = velocity_smooth.idxmax()

    # ── Phase bands (yref='paper' by default → span full chart height) ───
    _add_phase_bands(fig, classification)

    # ── Displacement — primary y-axis (left) ─────────────────────────────
    fig.add_trace(
        go.Scatter(
            x=displacement.index,
            y=displacement.values,
            mode="lines",
            name="Displacement (mm)",
            yaxis="y",
            line={"color": "#FFFFFF", "width": 1.5},
        )
    )

    # ── Velocity — secondary y-axis (right) ──────────────────────────────
    fig.add_trace(
        go.Scatter(
            x=velocity_smooth.index,
            y=velocity_smooth.values * vfac,
            mode="lines",
            name=f"Velocity ({velocity_unit})",
            yaxis="y2",
            line={"color": "#4CAF50", "width": 1.5},
        )
    )

    # ── Inverse Velocity — tertiary y-axis (far-right), truncated ────────
    iv = _compute_iv(velocity_smooth, cutoff=iv_cutoff)
    fig.add_trace(
        go.Scatter(
            x=iv.index,
            y=iv.values * ivfac,
            mode="lines+markers",
            name=f"Inv. Velocity ({iv_unit})",
            yaxis="y3",
            line={"color": "#64B5F6"},
            marker={"size": 3},
        )
    )

    # ── Fukuzono / IV overlays ────────────────────────────────────────────
    if fukuzono_result is not None:
        vel_fc = fukuzono_result.velocity_forecast

        if vel_fc is not None and not vel_fc.empty:
            # Forecast velocity (y2)
            fig.add_trace(
                go.Scatter(
                    x=vel_fc.index,
                    y=vel_fc.values * vfac,
                    mode="lines",
                    name="Forecast Velocity",
                    yaxis="y2",
                    line={"color": "#FF9800", "width": 2, "dash": "dash"},
                )
            )

            # Forecast displacement (y1) — trapezoidal integration
            fc_start = vel_fc.index[0]
            disp_before = displacement[displacement.index <= fc_start]
            d_start = (
                float(disp_before.iloc[-1])
                if not disp_before.empty
                else float(displacement.iloc[-1])
            )
            t_days = (
                vel_fc.index.to_series()
                .diff()
                .dt.total_seconds()
                .div(86_400.0)
                .fillna(0.0)
                .to_numpy()
            )
            vel_vals = vel_fc.to_numpy(dtype=float)
            increments = (vel_vals[:-1] + vel_vals[1:]) / 2.0 * t_days[1:]
            cumulative = np.concatenate([[0.0], np.cumsum(increments)])
            fig.add_trace(
                go.Scatter(
                    x=vel_fc.index,
                    y=d_start + cumulative,
                    mode="lines",
                    name="Forecast Displacement",
                    yaxis="y",
                    line={"color": "#FF9800", "width": 2, "dash": "dash"},
                )
            )

        # IV regression line (y3)
        if (
            fukuzono_result.regression_line is not None
            and not fukuzono_result.regression_line.empty
        ):
            fig.add_trace(
                go.Scatter(
                    x=fukuzono_result.regression_line.index,
                    y=fukuzono_result.regression_line.values * ivfac,
                    mode="lines",
                    name="IV Regression",
                    yaxis="y3",
                    line={"color": "#FF5722", "width": 2},
                )
            )

    # ── Phase legend dummy traces ─────────────────────────────────────────
    for phase_label, phase_color in _LEGEND_PHASES:
        fig.add_trace(
            go.Scatter(
                x=[None],
                y=[None],
                mode="markers",
                marker={"color": phase_color, "size": 12, "symbol": "square"},
                name=phase_label,
                showlegend=True,
            )
        )

    # ── Vertical event markers (ISO string x → unambiguous on date axes) ─
    if classification.onset_of_failure is not None:
        onset_ts = classification.onset_of_failure
        onset_str = onset_ts.isoformat()
        fig.add_vline(x=onset_str, line_color="#E91E63", line_dash="dot")
        fig.add_annotation(
            x=onset_str, y=0.97, xref="x", yref="paper",
            text=f"Onset: {onset_ts.strftime('%Y-%m-%d %H:%M')}",
            showarrow=False, font={"color": "#E91E63", "size": 10},
            xanchor="left", yanchor="top",
            bgcolor="rgba(0,0,0,0.6)", bordercolor="#E91E63", borderpad=3,
        )

    # Live preview vline — yellow, drawn when the user is dragging the
    # onset slider but hasn't clicked Apply yet.  Only shown when the
    # preview differs from the committed onset.
    if (
        preview_onset is not None
        and (
            classification.onset_of_failure is None
            or preview_onset != classification.onset_of_failure
        )
    ):
        pv_str = preview_onset.isoformat()
        fig.add_vline(x=pv_str, line_color="#FFEB3B", line_dash="solid", line_width=2)
        fig.add_annotation(
            x=pv_str, y=0.75, xref="x", yref="paper",
            text=f"⚙ Preview onset: {preview_onset.strftime('%Y-%m-%d %H:%M')}",
            showarrow=False, font={"color": "#FFEB3B", "size": 10},
            xanchor="left", yanchor="top",
            bgcolor="rgba(0,0,0,0.6)", bordercolor="#FFEB3B", borderpad=3,
        )

    if fukuzono_result is not None and fukuzono_result.predicted_failure_time is not None:
        t_f = fukuzono_result.predicted_failure_time
        tf_str = t_f.isoformat()
        fig.add_vline(x=tf_str, line_color="#FF9800", line_dash="dash")
        fig.add_annotation(
            x=tf_str, y=0.90, xref="x", yref="paper",
            text=f"IV Predicted: {t_f.strftime('%Y-%m-%d %H:%M')}",
            showarrow=False, font={"color": "#FF9800", "size": 10},
            xanchor="left", yanchor="top",
            bgcolor="rgba(0,0,0,0.6)", bordercolor="#FF9800", borderpad=3,
        )

    # SLO Gradient predicted failure — cyan dashed vline (so it visually
    # contrasts with the Fukuzono orange vline).
    if (
        slo_result is not None
        and slo_result.predicted_failure_time is not None
    ):
        t_slo = slo_result.predicted_failure_time
        slo_str = t_slo.isoformat()
        fig.add_vline(x=slo_str, line_color="#00BCD4", line_dash="dashdot")
        fig.add_annotation(
            x=slo_str, y=0.83, xref="x", yref="paper",
            text=f"SLO Predicted: {t_slo.strftime('%Y-%m-%d %H:%M')}",
            showarrow=False, font={"color": "#00BCD4", "size": 10},
            xanchor="left", yanchor="top",
            bgcolor="rgba(0,0,0,0.6)", bordercolor="#00BCD4", borderpad=3,
        )

    # ── Layout — three y-axes ─────────────────────────────────────────────
    # No in-figure title (the front-end panel renders its own header) — keeps
    # the legend clear of an overlapping title.
    fig.update_layout(
        title=None,
        template="plotly_dark",
        # Transparent backgrounds so the chart adopts the host app's theme
        # (the front-end further adjusts font/grid colours per light/dark mode).
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        hovermode="x unified",
        height=550,
        legend={
            "title": "Series / Phase",
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.02,
            "xanchor": "left",
            "x": 0,
        },
        xaxis={
            "domain": [0, 0.78],
            "type": "date",
            "title": "Time",
        },
        yaxis={
            "title": {"text": "Displacement (mm)", "font": {"color": "#AAAAAA"}},
            "tickfont": {"color": "#AAAAAA"},
            "side": "left",
        },
        yaxis2={
            "title": {"text": f"Velocity ({velocity_unit})", "font": {"color": "#4CAF50"}},
            "tickfont": {"color": "#4CAF50"},
            "overlaying": "y",
            "side": "right",
            "anchor": "x",
        },
        yaxis3={
            "title": {"text": f"Inv. Vel. ({iv_unit})", "font": {"color": "#64B5F6"}},
            "tickfont": {"color": "#64B5F6"},
            "overlaying": "y",
            "side": "right",
            "anchor": "free",
            "position": 0.87,
        },
        margin={"r": 90},
    )

    return fig


def build_multi_vcp_chart(
    vcp_list: list[dict[str, Any]],
    velocity_unit: str = "mm/day",
) -> go.Figure:
    """Build a three-row comparison chart for multiple VCPs.

    Each row shows one data type (Displacement / Velocity / Inverse Velocity)
    with all VCPs overlaid in the same panel using distinct colours.  The
    bottom row shares the x-axis with the rows above.

    Parameters
    ----------
    vcp_list:
        List of dicts, one per VCP, each containing:
        - ``"name"`` : str — VCP label.
        - ``"displacement"`` : pd.Series
        - ``"velocity_smooth"`` : pd.Series
        - ``"classification"`` : ClassificationResult
        - ``"fukuzono"`` : PredictionResult | None

    Returns
    -------
    go.Figure
    """
    if not vcp_list:
        return go.Figure()

    n = len(vcp_list)
    colors = (_VCP_COLORS * ((n // len(_VCP_COLORS)) + 1))[:n]
    vfac = _velocity_unit_factor(velocity_unit)
    iv_unit = _inverse_velocity_unit(velocity_unit)
    ivfac = _inverse_velocity_unit_factor(velocity_unit)

    fig = make_subplots(
        rows=3,
        cols=1,
        shared_xaxes=True,
        row_heights=[0.40, 0.30, 0.30],
        vertical_spacing=0,
    )

    for idx, info in enumerate(vcp_list):
        color = colors[idx]
        name: str = info["name"]
        displacement: pd.Series = info["displacement"]
        velocity_smooth: pd.Series = info["velocity_smooth"]
        classification: ClassificationResult = info["classification"]
        fukuzono: PredictionResult | None = info.get("fukuzono")

        # Phase bands from first VCP only to avoid visual clutter.
        if idx == 0:
            for row_num in [1, 2, 3]:
                _add_phase_bands(fig, classification, row=row_num, col=1)

        # ── Row 1 — Displacement ─────────────────────────────────────────
        fig.add_trace(
            go.Scatter(
                x=displacement.index,
                y=displacement.values,
                mode="lines",
                name=f"{name} — Displacement",
                legendgroup=name,
                line={"color": color, "width": 1.5},
            ),
            row=1, col=1,
        )

        # ── Row 2 — Velocity ─────────────────────────────────────────────
        fig.add_trace(
            go.Scatter(
                x=velocity_smooth.index,
                y=velocity_smooth.values * vfac,
                mode="lines",
                name=f"{name} — Velocity",
                legendgroup=name,
                showlegend=False,
                line={"color": color, "width": 1.5, "dash": "dash"},
            ),
            row=2, col=1,
        )

        # ── Row 3 — Inverse Velocity (truncated at velocity peak) ────────
        iv = _compute_iv(velocity_smooth, cutoff=velocity_smooth.idxmax())
        fig.add_trace(
            go.Scatter(
                x=iv.index,
                y=iv.values * ivfac,
                mode="lines+markers",
                name=f"{name} — IV",
                legendgroup=name,
                showlegend=False,
                line={"color": color, "width": 1.5, "dash": "dot"},
                marker={"size": 3},
            ),
            row=3, col=1,
        )

        # IV regression (row 3)
        if (
            fukuzono is not None
            and fukuzono.regression_line is not None
            and not fukuzono.regression_line.empty
        ):
            fig.add_trace(
                go.Scatter(
                    x=fukuzono.regression_line.index,
                    y=fukuzono.regression_line.values * ivfac,
                    mode="lines",
                    name=f"{name} — IV Reg.",
                    legendgroup=name,
                    showlegend=False,
                    line={"color": color, "width": 2},
                ),
                row=3, col=1,
            )

        # Per-VCP predicted failure vline
        if fukuzono is not None and fukuzono.predicted_failure_time is not None:
            tf_str = fukuzono.predicted_failure_time.isoformat()
            fig.add_vline(x=tf_str, line_color=color, line_dash="dash", line_width=1.5)
            fig.add_annotation(
                x=tf_str,
                y=0.97 - idx * 0.07,
                xref="x",
                yref="paper",
                text=f"IV [{name}]: {fukuzono.predicted_failure_time.strftime('%Y-%m-%d %H:%M')}",
                showarrow=False,
                font={"color": color, "size": 10},
                xanchor="left",
                yanchor="top",
                bgcolor="rgba(0,0,0,0.6)",
                bordercolor=color,
                borderpad=3,
            )

    # Force date axes then hide tick labels for rows 1 and 2.
    for row_num in [1, 2, 3]:
        fig.update_xaxes(type="date", row=row_num, col=1)
    fig.update_xaxes(showticklabels=False, ticks="", row=1, col=1)
    fig.update_xaxes(showticklabels=False, ticks="", row=2, col=1)
    fig.update_xaxes(title_text="Time", row=3, col=1)

    fig.update_yaxes(title_text="Displacement (mm)", row=1, col=1)
    fig.update_yaxes(title_text=f"Velocity ({velocity_unit})", row=2, col=1)
    fig.update_yaxes(title_text=f"Inv. Velocity ({iv_unit})", row=3, col=1)

    fig.update_layout(
        title=None,
        template="plotly_dark",
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        hovermode="x unified",
        height=820,
        legend={
            "title": "VCP",
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.02,
            "xanchor": "left",
            "x": 0,
        },
    )

    return fig


def build_summary_table(
    vcp_results: list[dict[str, Any]],
) -> pd.DataFrame:
    """Build the summary table DataFrame.

    Parameters
    ----------
    vcp_results:
        List of dicts, one per VCP, with keys:
        - ``vcp_name``: str
        - ``onset_of_failure``: pd.Timestamp | None
        - ``fukuzono_predicted``: pd.Timestamp | None
        - ``slo_predicted``: pd.Timestamp | None
        - ``actual_failure_time``: pd.Timestamp | None

    Returns
    -------
    pd.DataFrame
        Columns: VCP Name, Onset of Failure, IV Predicted,
        SLO Gradient Predicted, Actual Failure Time,
        IV Error (h), SLO Error (h).
        Unavailable values are the string "N/A".
    """
    rows = []
    for r in vcp_results:
        vcp_name = r.get("vcp_name", _NA)
        onset = r.get("onset_of_failure")
        fuk_pred = r.get("fukuzono_predicted")
        slo_pred = r.get("slo_predicted")
        actual = r.get("actual_failure_time")

        def _fmt(ts: pd.Timestamp | None) -> str:
            if ts is None:
                return _NA
            return ts.strftime("%Y-%m-%d %H:%M")

        fuk_error: str
        if fuk_pred is not None and actual is not None:
            fuk_error = str(_hours_diff(fuk_pred, actual))
        else:
            fuk_error = _NA

        slo_error: str
        if slo_pred is not None and actual is not None:
            slo_error = str(_hours_diff(slo_pred, actual))
        else:
            slo_error = _NA

        rows.append(
            {
                "VCP Name": vcp_name,
                "Onset of Failure": _fmt(onset),
                "IV Predicted": _fmt(fuk_pred),
                "SLO Gradient Predicted": _fmt(slo_pred),
                "Actual Failure Time": _fmt(actual),
                "IV Error (h)": fuk_error,
                "SLO Error (h)": slo_error,
            }
        )

    return pd.DataFrame(
        rows,
        columns=[
            "VCP Name",
            "Onset of Failure",
            "IV Predicted",
            "SLO Gradient Predicted",
            "Actual Failure Time",
            "IV Error (h)",
            "SLO Error (h)",
        ],
    )


# ---------------------------------------------------------------------------
# Per-stage summary table
# ---------------------------------------------------------------------------


def _format_duration(start: pd.Timestamp, end: pd.Timestamp) -> str:
    """Render a span as a compact ``Xd Yh Zm`` string (omitting zero parts)."""
    total_min = int(round((end - start).total_seconds() / 60.0))
    if total_min <= 0:
        return "0m"
    days, rem = divmod(total_min, 1440)
    hours, mins = divmod(rem, 60)
    parts: list[str] = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if mins or not parts:
        parts.append(f"{mins}m")
    return " ".join(parts)


def _stage_field_stats(
    series: pd.Series,
    start: pd.Timestamp,
    end: pd.Timestamp,
    decimals: int = 3,
) -> tuple[Any, Any, Any]:
    """Return ``(min, max, net_change)`` for *series* over ``[start, end]``.

    ``net_change`` is the last valid value minus the first valid value within
    the stage (per the agreed "value different = end − start" semantics).
    Returns ``(nan, nan, nan)`` when the slice has no valid points — NaN (not a
    string) keeps each numeric column a single dtype so it serialises cleanly.
    """
    if series is None or series.empty:
        return np.nan, np.nan, np.nan
    sl = series.loc[(series.index >= start) & (series.index <= end)].dropna()
    if sl.empty:
        return np.nan, np.nan, np.nan
    v_min = round(float(sl.min()), decimals)
    v_max = round(float(sl.max()), decimals)
    delta = round(float(sl.iloc[-1] - sl.iloc[0]), decimals)
    return v_min, v_max, delta


def _inverse_velocity(velocity_smooth: pd.Series) -> pd.Series:
    """Return 1/velocity with non-positive velocities masked to NaN."""
    if velocity_smooth is None or velocity_smooth.empty:
        return pd.Series(dtype=float)
    v = velocity_smooth.where(velocity_smooth > 0)
    return 1.0 / v


def build_stage_summary(
    vcp_results: list[dict[str, Any]],
) -> pd.DataFrame:
    """Build the per-stage pattern-recognition summary.

    One row per (VCP × detected stage), listing the stage's time span,
    duration, and the min / max / net-change of each field
    (deformation, velocity, inverse velocity) over that span.

    Parameters
    ----------
    vcp_results:
        List of dicts, one per VCP, with keys:
        - ``name``: str
        - ``displacement``: pd.Series   (deformation, mm)
        - ``velocity_smooth``: pd.Series (mm/day)
        - ``classification``: ClassificationResult

    Returns
    -------
    pd.DataFrame
        Columns: VCP, Stage, Start, End, Duration, then a min/max/Δ triple for
        Deformation (mm), Velocity (mm/day), and Inverse Velocity (day/mm).
        Stages of a phase that occurs more than once for a VCP are suffixed
        with an occurrence number (e.g. ``Linear 1``, ``Linear 2``).
    """
    cols = [
        "VCP",
        "Stage",
        "Start",
        "End",
        "Duration",
        "Deformation min (mm)",
        "Deformation max (mm)",
        "Deformation Δ (mm)",
        "Velocity min (mm/day)",
        "Velocity max (mm/day)",
        "Velocity Δ (mm/day)",
        "Inv. Velocity min (day/mm)",
        "Inv. Velocity max (day/mm)",
        "Inv. Velocity Δ (day/mm)",
    ]

    rows: list[dict[str, Any]] = []
    for r in vcp_results:
        name = r.get("name", _NA)
        displacement: pd.Series = r.get("displacement", pd.Series(dtype=float))
        velocity: pd.Series = r.get("velocity_smooth", pd.Series(dtype=float))
        classification: ClassificationResult | None = r.get("classification")
        if classification is None:
            continue

        inv_velocity = _inverse_velocity(velocity)

        windows = classification.windows
        # Count occurrences of each phase so single-occurrence phases stay
        # unsuffixed and repeated ones get " 1", " 2", … modifiers.
        phase_totals: dict[str, int] = {}
        for w in windows:
            phase_totals[w.phase] = phase_totals.get(w.phase, 0) + 1
        phase_seen: dict[str, int] = {}

        for w in windows:
            if phase_totals.get(w.phase, 0) > 1:
                phase_seen[w.phase] = phase_seen.get(w.phase, 0) + 1
                stage_label = f"{w.phase} {phase_seen[w.phase]}"
            else:
                stage_label = w.phase

            d_min, d_max, d_delta = _stage_field_stats(
                displacement, w.start_time, w.end_time
            )
            v_min, v_max, v_delta = _stage_field_stats(
                velocity, w.start_time, w.end_time
            )
            iv_min, iv_max, iv_delta = _stage_field_stats(
                inv_velocity, w.start_time, w.end_time, decimals=5
            )

            rows.append(
                {
                    "VCP": name,
                    "Stage": stage_label,
                    "Start": w.start_time.strftime("%Y-%m-%d %H:%M"),
                    "End": w.end_time.strftime("%Y-%m-%d %H:%M"),
                    "Duration": _format_duration(w.start_time, w.end_time),
                    "Deformation min (mm)": d_min,
                    "Deformation max (mm)": d_max,
                    "Deformation Δ (mm)": d_delta,
                    "Velocity min (mm/day)": v_min,
                    "Velocity max (mm/day)": v_max,
                    "Velocity Δ (mm/day)": v_delta,
                    "Inv. Velocity min (day/mm)": iv_min,
                    "Inv. Velocity max (day/mm)": iv_max,
                    "Inv. Velocity Δ (day/mm)": iv_delta,
                }
            )

    return pd.DataFrame(rows, columns=cols)


# ---------------------------------------------------------------------------
# Draggable stage boundaries (overlaid on the main combined chart)
# ---------------------------------------------------------------------------

# Distinctive colour for the draggable inter-stage boundary lines.  Chosen so
# the front-end component can tell them apart from every other shape on the
# combined chart (onset #E91E63, preview #FFEB3B, IV #FF9800, SLO #00BCD4, and
# the PHASE_COLORS phase bands) — only shapes of this exact colour are movable.
STAGE_BOUNDARY_COLOR = "#FFD54F"


def add_boundary_lines(fig: go.Figure, windows: list) -> go.Figure:
    """Overlay draggable inter-stage boundary lines onto *fig* in place.

    Each internal boundary (the shared edge between consecutive stages) becomes
    a full-height vertical line shape in :data:`STAGE_BOUNDARY_COLOR`.  The
    custom front-end component makes only these shapes draggable and reports
    their positions back; a double-click adds or removes one.

    Parameters
    ----------
    fig:
        A figure from :func:`build_combined_chart`.
    windows:
        Ordered list of ``WindowClassification`` (objects exposing
        ``end_time``).  ``windows[:-1]`` supplies the internal boundaries.
    """
    for w in windows[:-1]:
        fig.add_shape(
            type="line",
            xref="x",
            yref="paper",
            x0=w.end_time,
            x1=w.end_time,
            y0=0.0,
            y1=1.0,
            line={"color": STAGE_BOUNDARY_COLOR, "width": 3},
        )
    return fig
