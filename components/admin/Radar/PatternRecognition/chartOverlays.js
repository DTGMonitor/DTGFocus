/**
 * Shared chart overlays + view state for the Pattern Recognition charts.
 *
 * The on-screen ChartPanel and the printed report have to show the SAME picture.
 * The report cannot snapshot the live graph div (it re-renders the stored figure
 * JSON on a white page), so everything the analyst changed on screen — which
 * traces they hid, how far they zoomed — has to travel as plain data, and the
 * deformation-event markers have to be rebuilt from the same event list.
 * Keeping all three here is what keeps the two in step.
 */

/** Deformation-event types plotted as vertical markers + chart icons/labels. */
export const EVENT_ICON = {
  'Blast Event': '💥',
  'Rock Fall': '🪨',
  'Material Detachment': '⛏️',
  'Rainfall Event': '🌧️',
  Failure: '⚠️',
};

export const EVENT_SHORT = {
  'Blast Event': 'Blast',
  'Rock Fall': 'Rock Fall',
  'Material Detachment': 'Material Detachment',
  'Rainfall Event': 'Rainfall',
  Failure: 'Failure',
};

export const EVENT_COLOR = '#FF1744';
export const ACTUAL_FAILURE_COLOR = '#FF4081';

/**
 * Vertical marker lines + rotated labels for the included deformation events
 * (blast / rainfall / rock fall / material detachment / failure), plus the
 * confirmed actual-failure line when one is set.
 *
 * `print` swaps the label plate from a dark to a light one so the markers stay
 * legible on the report's white page.
 */
export function buildEventOverlays({ events = [], actualFailureTime = '', print = false } = {}) {
  const shapes = [];
  const annotations = [];
  const plate = print ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.55)';

  (Array.isArray(events) ? events : []).forEach((ev) => {
    if (!ev?.time) return;
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: ev.time,
      x1: ev.time,
      y0: 0,
      y1: 1,
      line: { color: EVENT_COLOR, width: 1.5, dash: 'dot' },
    });
    annotations.push({
      x: ev.time,
      xref: 'x',
      y: 0.04,
      yref: 'paper',
      text: `${EVENT_ICON[ev.type] ?? '💥'} ${EVENT_SHORT[ev.type] ?? ev.type ?? 'Event'}`,
      showarrow: false,
      textangle: -90,
      font: { color: EVENT_COLOR, size: 9 },
      xanchor: 'left',
      yanchor: 'bottom',
      bgcolor: plate,
      bordercolor: EVENT_COLOR,
      borderpad: 2,
    });
  });

  if (actualFailureTime) {
    shapes.push({
      type: 'line',
      xref: 'x',
      yref: 'paper',
      x0: actualFailureTime,
      x1: actualFailureTime,
      y0: 0,
      y1: 1,
      line: { color: ACTUAL_FAILURE_COLOR, width: 2.5 },
    });
    annotations.push({
      x: actualFailureTime,
      xref: 'x',
      y: 0.99,
      yref: 'paper',
      text: '⚑ Actual Failure',
      showarrow: false,
      font: { color: ACTUAL_FAILURE_COLOR, size: 10 },
      xanchor: 'left',
      yanchor: 'top',
      bgcolor: plate,
      bordercolor: ACTUAL_FAILURE_COLOR,
      borderpad: 3,
    });
  }

  return { shapes, annotations };
}

/**
 * Read the analyst's current view off a live Plotly graph div: which traces are
 * hidden (legend clicks write `visible: 'legendonly'` onto `gd.data`) and which
 * axes have been zoomed (a zoom writes an explicit `range` onto `gd.layout`;
 * an untouched axis keeps `autorange` and is left out so the report can still
 * fit the data itself).
 *
 * Visibility is recorded twice: by trace index for the chart it was captured
 * from, and by trace name so the same choice carries to the other VCP charts,
 * whose traces sit at the same positions but are not the same objects.
 */
export function captureChartView(gd) {
  if (!gd || !Array.isArray(gd.data)) return null;

  const byIndex = gd.data.map((t) => (t?.visible === undefined ? true : t.visible));
  const byName = {};
  gd.data.forEach((t) => {
    if (t?.name != null) byName[t.name] = t?.visible === undefined ? true : t.visible;
  });

  const ranges = {};
  const layout = gd.layout ?? {};
  for (const key of Object.keys(layout)) {
    const ax = layout[key];
    if (
      /^[xy]axis\d*$/.test(key) &&
      ax &&
      typeof ax === 'object' &&
      Array.isArray(ax.range) &&
      ax.autorange !== true
    ) {
      ranges[key] = [...ax.range];
    }
  }

  return { byIndex, byName, ranges };
}

/**
 * Re-apply a captured view onto a figure.
 *
 * `matchByIndex` is for the chart the view came from — an exact replay. Other
 * VCP charts match on trace name and pass an `axisFilter` limiting the ranges
 * to the shared time axis: they cover the same period but their displacement /
 * velocity magnitudes are their own.
 */
export function applyChartView(figure, view, { matchByIndex = false, axisFilter = null } = {}) {
  const base = {
    data: Array.isArray(figure?.data) ? figure.data : [],
    layout: figure?.layout ?? {},
  };
  if (!view) return base;

  const data = base.data.map((trace, i) => {
    const visible = matchByIndex
      ? view.byIndex?.[i]
      : trace?.name != null
        ? view.byName?.[trace.name]
        : undefined;
    if (visible === undefined || visible === true) return trace;
    return { ...trace, visible };
  });

  const layout = { ...base.layout };
  for (const [key, range] of Object.entries(view.ranges ?? {})) {
    if (axisFilter && !axisFilter(key)) continue;
    layout[key] = { ...(layout[key] ?? {}), range: [...range], autorange: false };
  }

  return { data, layout };
}

/** Axis filter that keeps only the shared time axis. */
export const timeAxisOnly = (key) => /^xaxis\d*$/.test(key);
