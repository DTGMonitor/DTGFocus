/* ============================================================
   radar-trend-ui.js — the trend strip along the bottom of the map.

   One chart, four quantities, four y-axes. They are drawn together rather
   than on tabs because the reading is a COMPARISON: a large deformation that
   is decelerating and a small one that is accelerating are opposite calls,
   and an operator who has to flip between two charts to see that is being
   asked to hold a shape in their head instead of looking at it.

   Everything the chart knows about is computed in radar-trend.js. This file
   owns the panel, the axes, the pixels and the read-out — nothing here
   decides what a number means.

   Two choices worth knowing about:

     the wall, not the      Every wall folder covering the spot is joined into
     folder                 one continuous record, because a wall outlives the
                            folder watching it. How that is done without
                            adding up two different zeros is radar-trend.js's
                            `stitch`; what this file owes it is to SHOW the
                            seams — a mark at each handover, the offset in the
                            note, and the folder on every hovered reading —
                            since a joined curve otherwise looks like one
                            uninterrupted measurement, which it is not.
     axes grow outward      Each series that is switched on takes a gutter,
                            inner pair first, and the plot shrinks to fit. A
                            series drawn against an axis that is not on screen
                            is a series whose numbers cannot be read, so the
                            axis is never dropped to buy plot width.
   ============================================================ */
'use strict';

var RadarTrendUI = (function () {

  var $ = function (id) { return document.getElementById(id); };
  var PREF_KEY = 'sensimap.trend.v1';
  var HOUR = 3600e3;

  /* The four quantities, in the order their axes stack outward from the plot.

     These are DATA colours, not chrome: they identify a quantity, the same way
     the sensor palette identifies a radar, so they stay categorical rather
     than following the panel's theme. They must stay distinguishable from each
     other — four series on one chart is exactly where a near-miss pair costs a
     misreading — so they are spread around the wheel rather than shaded. */
  var SERIES = [
    { key: 'd', field: 'd', side: 'L', colour: '#05CAC8',
      label: 'Cumulative deformation', short: 'deformation',
      unit: { h: 'mm', d: 'mm' }, factor: { h: 1, d: 1 }, pct: 0,
      hint: 'Movement along the radar’s line of sight since the start of the first scan window. Negative is toward the radar.' },
    { key: 'v', field: 'v', side: 'R', colour: '#E97132',
      label: 'Velocity', short: 'velocity',
      unit: { h: 'mm/h', d: 'mm/day' }, factor: { h: 1, d: 24 }, pct: 0,
      hint: 'Slope of the deformation curve over the trailing rate window.' },
    { key: 'iv', field: 'iv', side: 'R', colour: '#8B5CF6',
      label: 'Inverse velocity', short: 'inverse velocity',
      unit: { h: 'h/mm', d: 'day/mm' }, factor: { h: 1, d: 1 / 24 }, pct: 0.05,
      hint: '1 / |velocity| — the Fukuzono construction. A straight run down toward zero is the classic collapse signature; the axis ignores the top few per cent so a quiet spell cannot flatten it.' },
    { key: 'a', field: 'a', side: 'L', colour: '#E63946',
      label: 'Acceleration', short: 'acceleration',
      unit: { h: 'mm/h²', d: 'mm/day²' }, factor: { h: 1, d: 576 }, pct: 0.05,
      hint: 'Slope of the velocity over the same rate window. Positive means the movement is building.' }
  ];

  var WINDOWS = [
    [0, 'scan to scan'], [1, '1 hour'], [3, '3 hours'], [6, '6 hours'],
    [12, '12 hours'], [24, '1 day'], [48, '2 days'], [72, '3 days'], [168, '7 days']
  ];

  /* The default: every wall folder that watches the spot, joined into one
     record. A wall outlives the folder watching it — the radar is moved, or
     the folder re-commences after a re-survey — and the question is about the
     wall, not about the filing. Narrowing to a single folder stays available,
     because it is how the join itself gets checked. */
  var ALL = '*';

  var S = {
    shown: false,
    /* What the curve is OF. `point` follows the last Identify click; `region`
       follows a drawn region by index, looked up by name so a region deleted
       out from under the strip degrades to "gone" rather than to another
       region that happens to have inherited its index. */
    src: null,                  // {kind:'point', x,y,z} | {kind:'region', name}
    folderKey: ALL,             // ALL, or one wall folder pinned out of the join
    stat: 'mean',
    windowHours: 12,
    unit: 'h',                  // rates per hour or per day
    mode: 'auto',               // window composition, see radar-trend.js
    on: { d: true, v: true, iv: true, a: true },
    height: 210,
    res: null,                  // the last RadarTrend.build()
    covering: [],               // folder keys that cover the current source
    hover: -1,
    /* The stretch of time on screen, or null for the whole record. Purely a
       view: the series is built once over everything, and zooming re-ranges
       the axes to what is visible rather than recomputing anything. */
    zoom: null,                 // {t0, t1}
    drag: null,                 // a zoom being dragged out, {x0, x1, live}
    noteOpen: false,            // is the detail under the chart unfolded
    layout: null,               // the last drawn geometry, for hit-testing
    booted: false
  };

  /* ---------------------------------------------- preferences */

  function loadPrefs() {
    try {
      var r = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (!r) return;
      if (r.on) for (var k in S.on) if (typeof r.on[k] === 'boolean') S.on[k] = r.on[k];
      if (isFinite(r.windowHours) && r.windowHours >= 0) S.windowHours = r.windowHours;
      if (r.unit === 'h' || r.unit === 'd') S.unit = r.unit;
      if (r.stat) S.stat = r.stat;
      if (r.mode) S.mode = r.mode;
      if (isFinite(r.height)) S.height = clamp(r.height, 130, 620);
      if (typeof r.noteOpen === 'boolean') S.noteOpen = r.noteOpen;
      /* Stored from a session that ended mid-toggle, or hand-edited: an empty
         chart is not a state the operator can get out of from the chips. */
      var live = 0, key;
      for (key in S.on) if (S.on[key]) live++;
      if (!live) S.on.d = true;
    } catch (e) { /* a corrupt preference is not worth failing the tool over */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        on: S.on, windowHours: S.windowHours, unit: S.unit,
        stat: S.stat, mode: S.mode, height: S.height, noteOpen: S.noteOpen
      }));
    } catch (e) { /* private browsing, quota — the strip still works this session */ }
  }

  /* ---------------------------------------------- small helpers */

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function status(m) { if (window.SensiMap) SensiMap.status(m); }
  function col(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  /* UTC everywhere, for the same reason radar-scan.js builds the stamps in it:
     the filenames carry no zone, so a fixed frame beats one that shifts under
     the reader's own daylight saving. */
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(t) { var d = new Date(t); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
  function ddmm(t) { var d = new Date(t); return p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1); }
  function stamp(t) { return ddmm(t) + ' ' + hhmm(t); }

  /** A duration in the largest unit that keeps it readable. */
  function dur(ms) {
    var h = ms / HOUR;
    if (h < 1) return Math.round(h * 60) + ' min';
    if (h < 48) return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h';
    return (h / 24 < 10 ? (h / 24).toFixed(1) : Math.round(h / 24)) + ' days';
  }

  /** Axis-tick friendly: enough decimals to tell one tick from the next. */
  function fmtVal(v, step) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a >= 1e5 || (a > 0 && a < 1e-3)) return v.toExponential(1);
    var dp = step >= 10 ? 0 : step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
    return v.toFixed(dp);
  }

  /* ---------------------------------------------- what is being plotted */

  function allScans() {
    return (window.RadarUI && RadarUI.scans) ? RadarUI.scans() : [];
  }

  /** The rings of the region the strip is pointed at, or null. */
  function regionRings() {
    if (!S.src || S.src.kind !== 'region') return null;
    var list = (window.SensiMap && SensiMap.regions) ? SensiMap.regions() : [];
    for (var i = 0; i < list.length; i++) {
      /* By name first: a region deleted above this one shifts every index
         below it, and silently re-pointing the chart at a different piece of
         wall is the one failure here nobody would notice. */
      if (S.src.name && list[i].name === S.src.name) return [list[i].ring];
    }
    return null;
  }

  /* ---------------------------------------------- the series */

  /**
   * Sample everything, then decide what to keep.
   *
   * "Which folders cover this spot" is not asked separately, because the only
   * honest answer to it is the one the sampling already produced — a folder
   * covers the spot exactly when a scan of it returned a value. Asking twice
   * meant two passes over every pixel of every scan AND two chances for the
   * two answers to disagree.
   */
  function recompute() {
    S.res = null;
    S.hover = -1;
    /* A different place, or a scan added or hidden, is a different record —
       and a time window dragged out over the old one frames nothing in
       particular on the new one. */
    S.zoom = null;
    if (!S.src) { render(); return; }

    var recs = allScans(), samples;
    if (S.src.kind === 'region') {
      var rings = regionRings();
      samples = rings ? RadarTrend.sampleArea(recs, rings, { stat: S.stat }) : [];
    } else {
      samples = RadarTrend.samplePoint(recs, S.src.x, S.src.y, S.src.z);
    }

    /* Listed in the order the wall was watched, which is the order the chart
       joins them in — a select that disagrees with the curve about which
       record came first is a select that gets read wrong. */
    var first = Object.create(null), keys = [];
    for (var i = 0; i < samples.length; i++) {
      var k = samples[i].key || '', t = samples[i].startAt;
      if (first[k] === undefined) { first[k] = t; keys.push(k); }
      else if (t < first[k]) first[k] = t;
    }
    keys.sort(function (a, b) { return first[a] - first[b]; });
    S.covering = keys;

    /* A folder pinned in an earlier session, or before the view moved, that
       has nothing to say here — fall back to the joined curve rather than to
       an empty chart the operator has to work out how to leave. */
    if (S.folderKey !== ALL && keys.indexOf(S.folderKey) < 0) S.folderKey = ALL;

    var use = samples;
    if (S.folderKey !== ALL) {
      use = samples.filter(function (s) { return s.key === S.folderKey; });
    }

    S.res = RadarTrend.build(use, { mode: S.mode, windowHours: S.windowHours });
    render();
  }

  /* ---------------------------------------------- panel chrome */

  /**
   * Tell the map how much of its bottom edge is gone.
   *
   * The compass, the scale bar, the view hint and both floating panels are
   * positioned off `--trendH` rather than off a constant, because this strip
   * is resizable — and a scale bar behind a chart is a scale bar nobody has.
   */
  function layout() {
    var vp = $('viewport');
    if (!vp) return;
    vp.style.setProperty('--trendH', (S.shown ? S.height : 0) + 'px');
  }

  function open(src) {
    if (src) S.src = src;
    if (!S.src && S.lastHit) S.src = S.lastHit;
    S.shown = true;
    $('trendPanel').classList.remove('hidden');
    $('trendPanel').style.height = S.height + 'px';
    layout();
    recompute();
  }

  function close() {
    S.shown = false;
    $('trendPanel').classList.add('hidden');
    $('trendTip').classList.add('hidden');
    layout();
  }

  function toggle() { if (S.shown) close(); else open(); }

  /** The Identify click drives the point source while the strip is open. */
  function onProbe(hit) {
    if (!hit) return;
    S.lastHit = { kind: 'point', x: hit.x, y: hit.y, z: hit.z };
    if (!S.shown) return;
    if (S.src && S.src.kind === 'region') return;   // a pinned region is not a click target
    S.src = S.lastHit;
    recompute();
  }

  /** Open on the last place the operator clicked — the cover panel's button. */
  function openHere() {
    if (!S.lastHit) { status('Click a point on the model with Identify first.'); return; }
    open(S.lastHit);
  }

  /* ---------------------------------------------- rendering */

  function render() {
    if (!S.booted || !S.shown) return;
    renderSource();
    renderWhere();
    renderChips();
    renderNote();
    draw();
  }

  /** The source list: the last click, then every drawn region by name. */
  function renderSource() {
    var sel = $('trendSource'), out = [];
    var regions = (window.SensiMap && SensiMap.regions) ? SensiMap.regions() : [];
    var cur = !S.src ? '' : S.src.kind === 'region' ? 'r:' + S.src.name : 'p';

    out.push('<option value="p">the point I click</option>');
    for (var i = 0; i < regions.length; i++) {
      out.push('<option value="r:' + esc(regions[i].name) + '">' +
        esc(regions[i].name) + '</option>');
    }
    sel.innerHTML = out.join('');
    sel.value = cur;
    if (!sel.value) sel.value = 'p';

    /* Only a region has pixels to summarise; a point is one pixel and the
       question does not arise. */
    $('trendStatWrap').classList.toggle('hidden', !S.src || S.src.kind !== 'region');

    /* The joined record leads, because it is the answer to the question the
       operator asked; the individual folders follow, for checking a join that
       has been flagged. Offered only once there is more than one to join. */
    var f = $('trendFolder'), fo = [
      '<option value="' + ALL + '">all ' + S.covering.length + ', joined</option>'
    ];
    for (var k = 0; k < S.covering.length; k++) {
      fo.push('<option value="' + esc(S.covering[k]) + '">' +
        esc(S.covering[k]) + ' only</option>');
    }
    f.innerHTML = fo.join('');
    f.value = S.folderKey || ALL;
    if (!f.value) f.value = ALL;
    $('trendFolderWrap').classList.toggle('hidden', S.covering.length < 2);
  }

  function renderWhere() {
    var w = $('trendWhere'), bits = [];
    if (!S.src) bits.push('nothing picked');
    else if (S.src.kind === 'region') bits.push('region “' + esc(S.src.name) + '”');
    else bits.push('E ' + S.src.x.toFixed(0) + '  N ' + S.src.y.toFixed(0) +
      '  RL ' + S.src.z.toFixed(0));

    var n = S.res ? S.res.folders.length : 0;
    if (n === 1) bits.push(esc(S.res.folders[0].key));
    else if (n > 1) bits.push(n + ' wall folders joined');

    if (S.res && S.res.samples.length) {
      bits.push(S.res.samples.length + ' scan' + (S.res.samples.length === 1 ? '' : 's'));
    }
    w.innerHTML = bits.join('  ·  ');
  }

  /**
   * A folder key short enough to label a handover with.
   *
   * The radar number alone is not enough and the commonest case is exactly why:
   * a folder usually hands over to the SAME radar re-commenced after a
   * re-survey, and two marks both reading "SSR900" would say nothing about
   * which record is which. The commencement date is the part that differs.
   */
  function shortKey(key) {
    var p = window.RadarScan && RadarScan.parseKey ? RadarScan.parseKey(key) : null;
    if (p && p.radar && p.commenced) return p.radar + '·' + p.commenced;
    if (p && p.radar) return p.radar;
    return String(key || '').split('_').slice(0, 2).join('·');
  }

  /**
   * One chip per quantity, each carrying its latest value.
   *
   * The value on the chip is the point of it: with four axes the eye needs
   * somewhere to read the current number without finding the right axis first,
   * and "what is it now" is the question asked far more often than "what shape
   * is it".
   */
  function renderChips() {
    var host = $('trendSeries'), out = [];
    var last = lastValues();

    for (var i = 0; i < SERIES.length; i++) {
      var s = SERIES[i], on = !!S.on[s.key];
      var v = last[s.key];
      var dead = v == null || !isFinite(v);
      out.push(
        '<button class="trendChip' + (on ? ' on' : '') + (dead ? ' dead' : '') +
        '" data-series="' + s.key + '" title="' + esc(s.hint) + '">' +
        '<i style="background:' + s.colour + '"></i>' +
        '<span class="tcName">' + esc(s.label) + '</span>' +
        '<span class="tcVal">' + (dead ? '—' : fmtVal(v, Math.abs(v) / 50 || 0.01)) +
        ' <em>' + esc(s.unit[S.unit]) + '</em></span></button>'
      );
    }
    host.innerHTML = out.join('');
  }

  /**
   * The newest finite value of each quantity, in the displayed unit.
   *
   * Newest ON SCREEN, not newest in the record: while a window is framed, a
   * chip quoting a number from outside it reads as the value of the curve
   * being looked at, and is not.
   */
  function lastValues() {
    var out = {};
    if (!S.res || !S.res.points.length) return out;
    var pts = S.res.points, hi = S.zoom ? S.zoom.t1 : Infinity;
    for (var i = 0; i < SERIES.length; i++) {
      var s = SERIES[i];
      for (var k = pts.length - 1; k >= 0; k--) {
        if (pts[k].t > hi) continue;
        var v = pts[k][s.field];
        if (v === v && isFinite(v)) { out[s.key] = v * s.factor[S.unit]; break; }
      }
    }
    return out;
  }

  /**
   * What the operator has to be told about this curve.
   *
   * Split in two on purpose. A wall watched for a year can carry a dozen
   * handovers and as many notes, and putting all of that under the chart is
   * how the chart disappears — which is a failure of the annotation, not of
   * the reader. So the head line holds the facts that change how every number
   * above it is read, the rest sits behind a count, and the detail is bounded
   * and scrolls rather than growing into the plot.
   */
  function renderNote() {
    var head = $('trendNoteHead'), body = $('trendNoteBody');
    if (!head) return;
    var r = S.res, bits = [], detail = [], i;

    if (r && r.ok) {
      /* How the windows were composed is not a detail — it decides the shape
         of the whole curve — so it is always on screen. See radar-trend.js. */
      bits.push('<span class="tnFact">' +
        (r.mode === 'mixed'
          ? 'Windows composed per folder — the folders were exported differently'
          : r.mode === 'shared'
            ? 'Windows share one start, so each scan’s value is already cumulative'
            : 'Windows run end to start, so the curve is their running sum') +
        (r.forced ? ' <b>(forced)</b>' : ' <span class="dim">(detected)</span>') +
        '</span>');

      /* Where one folder handed over to the next, and by how much it had to be
         shifted to continue the curve. The offset IS the answer to "how much
         had this wall already moved before this folder started counting", so a
         handful of them belong on the head line; a dozen belong behind a
         count, where they can be read one at a time instead of skimmed. */
      var joinBits = [], bridged = 0;
      for (i = 0; i < r.joins.length; i++) {
        var J = r.joins[i];
        if (J.bridged) bridged++;
        joinBits.push('<span class="tnFact">joined ' + esc(shortKey(J.to)) + ' at ' +
          stamp(J.t) + ' <span class="dim">(' +
          (J.offset >= 0 ? '+' : '−') + fmtVal(Math.abs(J.offset), 0.1) + ' mm' +
          (J.bridged ? ', carried across a ' + dur(J.gapHours * HOUR) + ' gap'
                     : ', from ' + J.overlap + ' overlapping scan' + (J.overlap === 1 ? '' : 's')) +
          ')</span></span>');
      }
      if (joinBits.length <= 3) {
        bits = bits.concat(joinBits);
      } else {
        bits.push('<span class="tnFact">' + r.folders.length + ' folders · ' +
          joinBits.length + ' joins' +
          (bridged ? ' <span class="dim">(' + bridged + ' across gaps)</span>' : '') +
          '</span>');
        detail = detail.concat(joinBits);
      }

      var vt0 = S.zoom ? S.zoom.t0 : r.span.t0, vt1 = S.zoom ? S.zoom.t1 : r.span.t1;
      bits.push('<span class="tnFact">' + stamp(vt0) + ' → ' + stamp(vt1) +
        '  ·  ' + dur(vt1 - vt0) + '</span>');
      /* A framed window looks exactly like a short record, so say which it is
         and carry the way out — the double-click is not discoverable on its own. */
      if (S.zoom) {
        bits.push('<button class="tnMore" data-note-fit="1" ' +
          'title="Show the whole record again. Double-clicking the chart does the same.">' +
          'zoomed · fit all</button>');
      }
      bits.push('<span class="tnFact">rate over ' +
        (r.windowHours ? dur(r.windowHours * HOUR) : 'each scan interval') + '</span>');
    }

    var warn = [];
    for (i = 0; r && i < r.warnings.length; i++) {
      warn.push('<span class="tnWarn">⚠ ' + esc(r.warnings[i]) + '</span>');
    }
    /* One warning is short enough to read in place; more than one is a list,
       and a list under the chart is the thing that pushed the chart away. */
    if (warn.length === 1 && !detail.length) bits = bits.concat(warn);
    else detail = detail.concat(warn);

    if (detail.length) {
      bits.push('<button class="tnMore' + (warn.length ? ' warn' : '') +
        '" data-note-more="1">' + (warn.length ? '⚠ ' : '') + detail.length +
        (S.noteOpen ? ' notes ▾' : ' notes ▸') + '</button>');
    }

    head.innerHTML = bits.join('');
    body.innerHTML = detail.join('');
    body.classList.toggle('hidden', !detail.length || !S.noteOpen);
  }

  /* ---------------------------------------------- the chart */

  var PAD_TOP = 20, PAD_BOT = 34, GUTTER = 56, PAD_EDGE = 10;

  function draw() {
    var cv = $('trendCanvas');
    if (!cv) return;
    var dpr = window.devicePixelRatio || 1;
    var W = Math.max(120, cv.clientWidth), H = Math.max(80, cv.clientHeight);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    S.layout = null;

    var msg = emptyMessage();
    if (msg) { centreText(g, W, H, msg); return; }

    var pts = S.res.points;

    /* What is on screen, and what the axes are therefore fitted to. Rescaling
       to the window is the whole value of zooming: against the full record a
       zoomed-in stretch would be a flat line across the middle of the plot,
       which is exactly the detail the operator zoomed in to see. */
    var vt0 = S.res.span.t0, vt1 = S.res.span.t1, scope = pts;
    if (S.zoom) {
      vt0 = S.zoom.t0; vt1 = S.zoom.t1;
      var inw = [];
      for (var z = 0; z < pts.length; z++) {
        if (pts[z].t >= vt0 && pts[z].t <= vt1) inw.push(pts[z]);
      }
      /* Fewer than two readings inside the window leaves nothing to fit, so
         the axes keep the record's own range rather than collapsing. */
      if (inw.length >= 2) scope = inw;
    }

    /* Which axes are actually drawable. A quantity switched on but with
       nothing finite in it — acceleration needs three scans, not two — keeps
       its chip and loses its axis, rather than drawing an empty gutter. */
    var axes = [];
    for (var i = 0; i < SERIES.length; i++) {
      var s = SERIES[i];
      if (!S.on[s.key]) continue;
      var r = RadarTrend.range(scope, s.field, s.pct);
      if (!r) continue;
      var f = s.factor[S.unit];
      var lo = r.min * f, hi = r.max * f;
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      /* Zero is the reference every one of these is measured from, so it stays
         on the axis even when the data never goes near it. */
      lo = Math.min(lo, 0); hi = Math.max(hi, 0);
      var nice = niceRange(lo, hi, 4);
      axes.push({ s: s, lo: nice.lo, hi: nice.hi, step: nice.step, factor: f,
        clipped: (r.trueMax * f > nice.hi + 1e-9) || (r.trueMin * f < nice.lo - 1e-9) });
    }

    /* Switched on, but none of them has a single finite value to draw — a
       wall that has not moved has no inverse velocity, for instance. Say which
       ones, because the chips look identical whether or not they hold numbers. */
    if (!axes.length) {
      var off = [];
      for (var q = 0; q < SERIES.length; q++) if (S.on[SERIES[q].key]) off.push(SERIES[q].short);
      centreText(g, W, H, 'Nothing to plot: there is no ' + off.join(' or ') +
        ' in this series. Switch another quantity on above.');
      return;
    }

    var nL = 0, nR = 0, k;
    for (k = 0; k < axes.length; k++) { if (axes[k].s.side === 'L') nL++; else nR++; }

    var x0 = PAD_EDGE + nL * GUTTER, x1 = W - PAD_EDGE - nR * GUTTER;
    var y0 = PAD_TOP, y1 = H - PAD_BOT;
    if (x1 - x0 < 60 || y1 - y0 < 40) { centreText(g, W, H, 'Too small to draw — widen the panel'); return; }

    var t0 = vt0, t1 = vt1;
    if (t1 <= t0) t1 = t0 + HOUR;
    var xOf = function (t) { return x0 + (t - t0) / (t1 - t0) * (x1 - x0); };
    /* The inverse, kept with the layout: a drag hands back pixels and the only
       thing that can turn those into an instant is the mapping just used. */
    var tOf = function (x) { return t0 + (x - x0) / (x1 - x0) * (t1 - t0); };

    /* Inner pair against the plot, the rest stepping outward from it. */
    var li = 0, ri = 0;
    for (k = 0; k < axes.length; k++) {
      var a = axes[k];
      a.x = a.s.side === 'L' ? x0 - (li++) * GUTTER : x1 + (ri++) * GUTTER;
      a.yOf = (function (ax) {
        return function (v) {
          return y1 - (v * ax.factor - ax.lo) / (ax.hi - ax.lo) * (y1 - y0);
        };
      })(a);
    }

    drawTimeAxis(g, t0, t1, x0, x1, y0, y1);
    drawGrid(g, axes[0], x0, x1, y0, y1);
    drawJoins(g, xOf, x0, x1, y0, y1);
    for (k = 0; k < axes.length; k++) drawYAxis(g, axes[k], y0, y1);
    for (k = 0; k < axes.length; k++) drawSeries(g, axes[k], pts, xOf, x0, x1, y0, y1);

    S.layout = { axes: axes, xOf: xOf, tOf: tOf, x0: x0, x1: x1,
      y0: y0, y1: y1, t0: t0, t1: t1 };
    drawDragBand(g, y0, y1);
    if (S.hover >= 0 && S.hover < pts.length) drawCrosshair(g, pts[S.hover], xOf, y0, y1);
  }

  function emptyMessage() {
    if (!allScans().length) {
      return 'Drop radar deformation exports — a trend needs at least two scan windows, from any mix of the wall folders watching a spot.';
    }
    if (!S.src) return 'Click a point on the model with Identify, or pick a drawn region above.';
    if (S.src.kind === 'region' && !regionRings()) {
      return 'The region “' + S.src.name + '” is gone. Pick another source above.';
    }
    if (!S.res || !S.res.samples.length) {
      return S.folderKey === ALL
        ? 'No georeferenced wall folder covers this ' + S.src.kind + '.'
        : 'No scan of ' + S.folderKey + ' covers this ' + S.src.kind +
          '. Switch back to the joined record above.';
    }
    if (!S.res.ok) {
      return 'Only one usable scan window here — a trend needs two. Drop ' +
        'another export of ' + (S.res.folders[0] ? S.res.folders[0].key : 'this wall') + '.';
    }
    return null;
  }

  function centreText(g, W, H, text) {
    g.fillStyle = col('--dim2', '#6d7887');
    g.font = '11px "Segoe UI",sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    /* Wrap by words: these messages are instructions, and one clipped at the
       panel edge is an instruction the operator cannot follow. */
    var words = String(text).split(' '), line = '', lines = [], max = W - 40;
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(t).width > max && line) { lines.push(line); line = words[i]; }
      else line = t;
    }
    if (line) lines.push(line);
    for (var k = 0; k < lines.length; k++) {
      g.fillText(lines[k], W / 2, H / 2 + (k - (lines.length - 1) / 2) * 15);
    }
  }

  /* ---- axes ---- */

  function niceStep(span, want) {
    var raw = span / Math.max(1, want);
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  function niceRange(lo, hi, want) {
    if (!(hi > lo)) { var m = isFinite(lo) ? lo : 0; lo = m - 1; hi = m + 1; }
    var step = niceStep(hi - lo, want);
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step: step };
  }

  /* Only steps that divide a day evenly, so a tick never lands at 03:17 and
     the labels stay comparable down the axis. */
  var TIME_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168, 336, 720];

  function timeStep(span, width) {
    var want = Math.max(2, Math.floor(width / 88));
    for (var i = 0; i < TIME_STEPS.length; i++) {
      if (span / (TIME_STEPS[i] * HOUR) <= want) return TIME_STEPS[i] * HOUR;
    }
    /* Past a month a step of its own, so a year of scans does not fall back to
       thirty-day ticks and print a label over every other one. */
    var top = TIME_STEPS[TIME_STEPS.length - 1] * HOUR;
    return Math.ceil(span / want / top) * top;
  }

  function drawTimeAxis(g, t0, t1, x0, x1, y0, y1) {
    var step = timeStep(t1 - t0, x1 - x0);
    var line = col('--line', '#2c3542'), dim = col('--dim2', '#6d7887');

    g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y1 + 0.5); g.lineTo(x1, y1 + 0.5); g.stroke();

    g.font = '9px Consolas,monospace';
    g.textAlign = 'center'; g.textBaseline = 'top';

    var start = Math.ceil(t0 / step) * step, prevDay = null;
    for (var t = start; t <= t1; t += step) {
      var x = x0 + (t - t0) / (t1 - t0) * (x1 - x0);
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, y1); g.lineTo(Math.round(x) + 0.5, y1 + 4); g.stroke();
      g.fillStyle = dim;
      /* The clock under every tick, the date only when it changes: a full
         stamp on each one is three times the ink for one extra fact. */
      if (step < 24 * HOUR) g.fillText(hhmm(t), x, y1 + 6);
      var day = ddmm(t);
      if (day !== prevDay || step >= 24 * HOUR) {
        g.fillStyle = col('--dim', '#8f9bab');
        g.fillText(day, x, y1 + (step < 24 * HOUR ? 17 : 6));
        prevDay = day;
      }
    }
  }

  /**
   * A mark where one wall folder handed over to the next.
   *
   * Without it the joined curve looks like one uninterrupted measurement,
   * which is exactly the thing it is not: everything left of the mark was
   * measured by a different folder, and the level on the right is inherited
   * rather than measured. A join that bridged a gap, or that put two
   * meaningfully different lines of sight together, is drawn in the warning
   * colour — the same thing the note under the chart says in words.
   */
  function drawJoins(g, xOf, x0, x1, y0, y1) {
    var joins = (S.res && S.res.joins) || [];
    g.save();
    g.font = '9px Consolas,monospace';
    g.textBaseline = 'top';

    for (var i = 0; i < joins.length; i++) {
      var J = joins[i], x = xOf(J.t);
      if (x < x0 - 1 || x > x1 + 1) continue;
      var bad = J.bridged || J.angleDeg > 10;
      var c = bad ? col('--warn', '#ffb300') : col('--dim2', '#6d7887');

      g.strokeStyle = c; g.lineWidth = 1; g.globalAlpha = bad ? 0.75 : 0.5;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, y0);
      g.lineTo(Math.round(x) + 0.5, y1);
      g.stroke();
      g.setLineDash([]);

      /* Label inward from whichever side has room, so a handover close to the
         right edge is not written off the end of the plot. */
      var label = shortKey(J.to);
      var w = g.measureText(label).width;
      var right = x + 3 + w < x1;
      g.globalAlpha = 1;
      g.fillStyle = c;
      g.textAlign = right ? 'left' : 'right';
      g.fillText(label, x + (right ? 3 : -3), y0 + 1);
    }
    g.restore();
    g.globalAlpha = 1;
  }

  /** Horizontal rules, from the innermost axis only — four grids is a mesh. */
  function drawGrid(g, axis, x0, x1, y0, y1) {
    if (!axis) return;
    g.strokeStyle = col('--line', '#2c3542');
    g.lineWidth = 1;
    for (var v = axis.lo; v <= axis.hi + axis.step * 1e-6; v += axis.step) {
      var y = Math.round(y1 - (v - axis.lo) / (axis.hi - axis.lo) * (y1 - y0)) + 0.5;
      g.globalAlpha = Math.abs(v) < axis.step * 1e-6 ? 0.9 : 0.35;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    }
    g.globalAlpha = 1;
  }

  function drawYAxis(g, a, y0, y1) {
    var right = a.s.side === 'R', ax = a.x;

    g.strokeStyle = a.s.colour; g.globalAlpha = 0.55; g.lineWidth = 1;
    g.beginPath(); g.moveTo(ax + 0.5, y0); g.lineTo(ax + 0.5, y1); g.stroke();
    g.globalAlpha = 1;

    g.font = '9px Consolas,monospace';
    g.textAlign = right ? 'left' : 'right';
    g.textBaseline = 'middle';
    g.fillStyle = a.s.colour;

    for (var v = a.lo; v <= a.hi + a.step * 1e-6; v += a.step) {
      var y = y1 - (v - a.lo) / (a.hi - a.lo) * (y1 - y0);
      g.globalAlpha = 0.45;
      g.beginPath();
      g.moveTo(ax + (right ? 1 : -1) * 1, y + 0.5);
      g.lineTo(ax + (right ? 1 : -1) * 4, y + 0.5);
      g.stroke();
      g.globalAlpha = 1;
      g.fillText(fmtVal(v, a.step), ax + (right ? 6 : -6), y);
    }

    /* The unit caption sits at the head of its own axis, in its own colour —
       with four axes up, a legend somewhere else would make the reader match
       colours across the panel on every glance. */
    g.textAlign = right ? 'left' : 'right';
    g.textBaseline = 'alphabetic';
    g.font = '9.5px "Segoe UI",sans-serif';
    g.fillText(a.s.unit[S.unit] + (a.clipped ? ' ↕' : ''), ax + (right ? 2 : -2), y0 - 7);
  }

  /* ---- the lines ---- */

  function drawSeries(g, a, pts, xOf, x0, x1, y0, y1) {
    var s = a.s;
    g.save();
    g.beginPath(); g.rect(x0, y0 - 1, x1 - x0, y1 - y0 + 2); g.clip();

    g.strokeStyle = s.colour; g.lineWidth = 1.6;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();

    var started = false;
    for (var i = 0; i < pts.length; i++) {
      var v = pts[i][s.field];
      if (v !== v || !isFinite(v)) { started = false; continue; }   // a break, not a bridge
      var x = xOf(pts[i].t), y = a.yOf(v);
      if (started) g.lineTo(x, y); else { g.moveTo(x, y); started = true; }
    }
    g.stroke();

    /* A dot at every real scan: four points joined by straight lines look
       exactly like four hundred, and the difference is the whole question of
       how much the curve between them can be trusted. The planted zero gets a
       smaller, fainter one — it is the definition of the reference, not a
       reading, and should not sit on the curve looking like the others. */
    for (var k = 0; k < pts.length; k++) {
      var w = pts[k][s.field];
      if (w !== w || !isFinite(w)) continue;
      g.fillStyle = s.colour;
      g.globalAlpha = pts[k].sample ? 1 : 0.5;
      g.beginPath();
      g.arc(xOf(pts[k].t), a.yOf(w), pts[k].sample ? 2.8 : 2, 0, 6.2832);
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  /** The stretch being dragged out. Faint, because the point of the gesture
   *  is to see the curves underneath it while choosing. */
  function drawDragBand(g, y0, y1) {
    if (!S.drag || !S.drag.live) return;
    var a = Math.min(S.drag.x0, S.drag.x1), b = Math.max(S.drag.x0, S.drag.x1);
    g.save();
    g.fillStyle = col('--acc', '#2f9bff');
    g.globalAlpha = 0.16;
    g.fillRect(a, y0, b - a, y1 - y0);
    g.globalAlpha = 0.7;
    g.strokeStyle = col('--acc', '#2f9bff');
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(a) + 0.5, y0); g.lineTo(Math.round(a) + 0.5, y1);
    g.moveTo(Math.round(b) + 0.5, y0); g.lineTo(Math.round(b) + 0.5, y1);
    g.stroke();
    g.restore();
  }

  /**
   * Frame a stretch of time, clamped to the record it came from.
   *
   * Nothing is recomputed: the series already covers everything, so this only
   * changes which part of it the axes are fitted to and drawn over.
   */
  function setZoom(a, b) {
    if (!S.res || !S.res.ok) return;
    var sp = S.res.span;
    var lo = clamp(Math.min(a, b), sp.t0, sp.t1);
    var hi = clamp(Math.max(a, b), sp.t0, sp.t1);
    /* A window narrower than a minute is a slip of the hand, not a request,
       and framing it would leave nothing on screen to drag back out of. */
    if (hi - lo < 60e3) { draw(); return; }
    S.zoom = { t0: lo, t1: hi };
    S.hover = -1;
    render();
    status('Zoomed to ' + stamp(lo) + ' → ' + stamp(hi) +
      ' — double-click the chart to fit the whole record again.');
  }

  /** Back to the whole record. */
  function fitAll() {
    if (!S.zoom) return;
    S.zoom = null;
    S.hover = -1;
    render();
    status('Showing the whole record.');
  }

  function drawCrosshair(g, pt, xOf, y0, y1) {
    var x = Math.round(xOf(pt.t)) + 0.5;
    g.strokeStyle = col('--fg', '#e6ebf2');
    g.globalAlpha = 0.45; g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
  }

  /* ---------------------------------------------- hover read-out */

  function onMove(ev) {
    var L = S.layout;
    if (!L || !S.res || S.drag) return;   // mid-drag the band is the read-out
    var cv = $('trendCanvas'), r = cv.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (x < L.x0 - 8 || x > L.x1 + 8 || y < L.y0 - 8 || y > L.y1 + 8) { onLeave(); return; }

    var pts = S.res.points, best = -1, bestD = Infinity;
    for (var i = 0; i < pts.length; i++) {
      /* Only what is on screen: zoomed in, the nearest reading by pixel can
         easily be one just outside the window, and reading out a sample the
         operator cannot see is worse than reading out none. */
      if (pts[i].t < L.t0 || pts[i].t > L.t1) continue;
      var d = Math.abs(L.xOf(pts[i].t) - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) { onLeave(); return; }
    if (best !== S.hover) { S.hover = best; draw(); }
    showTip(pts[best], L, r);
  }

  function onLeave() {
    $('trendTip').classList.add('hidden');
    if (S.hover < 0) return;
    S.hover = -1; draw();
  }

  function showTip(pt, L, r) {
    var tip = $('trendTip'), out = [];
    out.push('<b>' + stamp(pt.t) + '</b>');

    /* Which folder this reading came from, whenever more than one is joined:
       on a joined curve "what does this number mean" cannot be answered
       without it, and the two stretches can be measured quite differently. */
    if (pt.key && S.res && S.res.folders.length > 1) {
      out.push('<span class="ttWin">' + esc(pt.key) + '</span>');
    }
    if (pt.sample) {
      out.push('<span class="ttWin">' + stamp(pt.sample.startAt) + ' → ' +
        stamp(pt.sample.endAt) + '</span>');
      if (S.src && S.src.kind === 'region') {
        out.push('<span class="ttWin">' + pt.sample.n + ' pixels, ' + S.stat + '</span>');
      }
    } else {
      out.push('<span class="ttWin">reference — start of ' +
        (pt.key && S.res && S.res.folders.length > 1 ? 'this folder' : 'the first window') +
        '</span>');
    }

    for (var i = 0; i < SERIES.length; i++) {
      var s = SERIES[i];
      if (!S.on[s.key]) continue;
      var v = pt[s.field];
      var txt = (v === v && isFinite(v)) ? fmtVal(v * s.factor[S.unit], Math.abs(v * s.factor[S.unit]) / 50 || 0.01) : '—';
      out.push('<span class="ttRow"><i style="background:' + s.colour + '"></i>' +
        '<span class="ttName">' + esc(s.short) + '</span>' +
        '<span class="ttVal">' + txt + ' <em>' + esc(s.unit[S.unit]) + '</em></span></span>');
    }

    tip.innerHTML = out.join('');
    tip.classList.remove('hidden');

    /* Follow the point but stay inside the plot: a read-out clipped by the
       panel edge is one the operator has to move the mouse to finish reading,
       by which time it describes a different sample. */
    var px = L.xOf(pt.t), w = tip.offsetWidth;
    tip.style.left = clamp(px + 12, 4, Math.max(4, r.width - w - 4)) + 'px';
    tip.style.top = (L.y0 + 2) + 'px';
  }

  /* ---------------------------------------------- export */

  /**
   * The series as CSV, in the unit on screen.
   *
   * Everything needed to redo the arithmetic elsewhere goes in the file: the
   * scan each row came from, its window, and — in a header comment — how the
   * windows were composed, because the numbers below mean different things
   * under the two rules.
   */
  function exportCsv() {
    if (!S.res || !S.res.ok) { status('Nothing to export yet.'); return; }
    var u = S.unit, rows = [];

    var i, w;
    rows.push('# SensiMap deformation trend');
    rows.push('# source,' + (S.src.kind === 'region'
      ? 'region ' + S.src.name + ' (' + S.stat + ' of the pixels inside)'
      : 'point E ' + S.src.x.toFixed(2) + ' N ' + S.src.y.toFixed(2) + ' RL ' + S.src.z.toFixed(2)));

    /* Every folder in the curve, and every shift applied to join them. A
       reader who cannot see the offsets cannot take the file apart again into
       what each radar actually measured, which is the whole point of keeping
       the folder on every row. */
    for (i = 0; i < S.res.folders.length; i++) {
      var F = S.res.folders[i];
      rows.push('# folder,' + F.key + ',' + F.samples.length +
        (F.samples.length === 1 ? ' scan,' : ' scans,') +
        new Date(F.span.t0).toISOString() + ',' + new Date(F.span.t1).toISOString());
    }
    for (i = 0; i < S.res.joins.length; i++) {
      var J = S.res.joins[i];
      rows.push('# join,' + J.from + ',' + J.to + ',' + new Date(J.t).toISOString() +
        ',offset ' + J.offset.toPrecision(6) + ' mm,' +
        (J.bridged ? 'carried across a gap'
                   : J.overlap + ' overlapping scan' + (J.overlap === 1 ? '' : 's')) +
        (J.angleDeg === J.angleDeg ? ',sight lines ' + J.angleDeg.toFixed(1) + ' deg apart' : ''));
    }

    rows.push('# windows,' + (S.res.mode === 'mixed'
      ? 'composed per folder — see the folder rows'
      : S.res.mode === 'shared'
        ? 'share one start — each value already cumulative'
        : 'run end to start — values summed'));
    rows.push('# rate window,' + (S.res.windowHours ? S.res.windowHours + ' h' : 'scan to scan'));
    for (w = 0; w < S.res.warnings.length; w++) rows.push('# warning,"' + S.res.warnings[w].replace(/"/g, '""') + '"');

    rows.push(['time (UTC)', 'deformation (mm)',
      'velocity (' + SERIES[1].unit[u] + ')',
      'inverse velocity (' + SERIES[2].unit[u] + ')',
      'acceleration (' + SERIES[3].unit[u] + ')',
      'window start', 'window end', 'pixels', 'wall folder', 'scan'].join(','));

    var pts = S.res.points;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], s = p.sample;
      rows.push([
        new Date(p.t).toISOString(),
        cell(p.d, 1), cell(p.v, SERIES[1].factor[u]),
        cell(p.iv, SERIES[2].factor[u]), cell(p.a, SERIES[3].factor[u]),
        s ? new Date(s.startAt).toISOString() : '',
        s ? new Date(s.endAt).toISOString() : '',
        s ? s.n : '',
        p.key || '',
        s ? '"' + String(s.filename).replace(/"/g, '""') + '"' : ''
      ].join(','));
    }

    var blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (S.res.folders.length === 1 ? S.res.folders[0].key : 'joined') + '_trend.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    status('Exported ' + pts.length + ' rows.');
  }

  function cell(v, f) {
    return (v === v && v != null && isFinite(v)) ? (v * f).toPrecision(6) : '';
  }

  /* ---------------------------------------------- wiring */

  function bind() {
    if (!$('trendPanel')) return;    // an older index.html without the strip
    loadPrefs();

    /* controls */
    $('trendClose').onclick = close;
    $('trendCsv').onclick = exportCsv;

    $('trendSource').onchange = function () {
      if (this.value === 'p') {
        S.src = S.lastHit || null;
        if (!S.src) status('Click a point on the model with Identify.');
      } else {
        var name = this.value.slice(2);
        S.src = { kind: 'region', name: name };
      }
      /* A new place has its own set of folders, so any pin on one of the
         old place's is meaningless — start from the joined record again. */
      S.folderKey = ALL;
      recompute();
    };
    /* Rebuilt as the list drops open rather than on a change hook: regions are
       created, renamed and deleted by three other modules, and a stale list is
       a list that points the chart at the wrong wall. */
    $('trendSource').onmousedown = function () { if (S.shown) renderSource(); };

    $('trendFolder').onchange = function () { S.folderKey = this.value; recompute(); };
    $('trendStat').onchange = function () { S.stat = this.value; savePrefs(); recompute(); };
    $('trendMode').onchange = function () { S.mode = this.value; savePrefs(); recompute(); };
    $('trendWindow').onchange = function () {
      S.windowHours = +this.value; savePrefs(); recompute();
    };
    $('trendUnit').onchange = function () { S.unit = this.value; savePrefs(); render(); };

    var win = $('trendWindow'), wo = [];
    for (var i = 0; i < WINDOWS.length; i++) {
      wo.push('<option value="' + WINDOWS[i][0] + '">' + WINDOWS[i][1] + '</option>');
    }
    win.innerHTML = wo.join('');
    win.value = String(S.windowHours);
    $('trendUnit').value = S.unit;
    $('trendStat').value = S.stat;
    $('trendMode').value = S.mode;

    /* series chips */
    $('trendSeries').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-series]') : null;
      if (!b) return;
      var k = b.getAttribute('data-series');
      /* The last one on may not be switched off: an empty chart with four
         axes still drawn is a worse answer than the panel simply being shut. */
      var live = 0, key;
      for (key in S.on) if (S.on[key]) live++;
      if (S.on[k] && live === 1) { status('At least one quantity has to be shown.'); return; }
      S.on[k] = !S.on[k];
      savePrefs();
      renderChips();
      draw();
    });

    $('trendNoteHead').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-note-fit]')) { fitAll(); return; }
      if (!(e.target.closest && e.target.closest('[data-note-more]'))) return;
      S.noteOpen = !S.noteOpen;
      savePrefs();
      renderNote();
      /* Unfolding takes height from the plot, and the canvas is sized from the
         box it is given — so it has to be told the box changed. */
      draw();
    });

    /* hover, and the drag that frames a window */
    var cv = $('trendCanvas');
    cv.addEventListener('mousemove', onMove);
    cv.addEventListener('mouseleave', onLeave);
    cv.addEventListener('mousedown', onDown);
    cv.addEventListener('dblclick', fitAll);

    bindGrip();

    /* The strip covers the bottom of the map, so the map has to know it is
       there — otherwise the scale bar and the view hint sit underneath it. */
    if (window.SensiMap) {
      SensiMap.onProbe(onProbe);
      if (window.RadarUI && RadarUI.onChange) {
        RadarUI.onChange(function () { if (S.shown) recompute(); });
      }
    }
    window.addEventListener('resize', function () { if (S.shown) draw(); });

    S.booted = true;
  }

  /* ---------------------------------------------- framing a window

     Drag across the plot to frame a stretch of time; double-click to fit the
     whole record again. Horizontal only, because the y axes are fitted to
     whatever is framed — there are four of them and no single one of them is
     the thing being zoomed. */

  /* The cursor says which gesture is under way — crosshair to pick an edge,
     a horizontal resize once a width is actually being chosen. */
  function plotBox(dragging) {
    var box = document.querySelector('.trendPlot');
    if (box) box.classList.toggle('dragging', !!dragging);
  }

  function onDown(ev) {
    var L = S.layout;
    if (!L || ev.button !== 0) return;
    var cv = $('trendCanvas'), r = cv.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (x < L.x0 - 4 || x > L.x1 + 4 || y < L.y0 - 4 || y > L.y1 + 4) return;
    ev.preventDefault();

    S.drag = { x0: clamp(x, L.x0, L.x1), x1: clamp(x, L.x0, L.x1), live: false };
    $('trendTip').classList.add('hidden');
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  }

  function onDragMove(ev) {
    var L = S.layout;
    if (!L || !S.drag) return;
    var r = $('trendCanvas').getBoundingClientRect();
    S.drag.x1 = clamp(ev.clientX - r.left, L.x0, L.x1);
    /* A few pixels is a click that wandered, not a selection. Below the
       threshold nothing is drawn, so a plain click never flashes a band. */
    S.drag.live = Math.abs(S.drag.x1 - S.drag.x0) >= 6;
    plotBox(S.drag.live);
    draw();
  }

  function onDragUp() {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
    var d = S.drag, L = S.layout;
    S.drag = null;
    plotBox(false);
    if (!d || !d.live || !L) { draw(); return; }
    setZoom(L.tOf(d.x0), L.tOf(d.x1));
  }

  /** Drag the top edge to trade map for chart. */
  function bindGrip() {
    var grip = $('trendGrip'), panel = $('trendPanel');
    grip.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var y = e.clientY, h0 = panel.offsetHeight;
      grip.classList.add('dragging');
      function move(ev) {
        /* The controls row, the chips and the note's summary line cannot
           shrink, so the floor has to leave the plot its own minimum on top of
           them — otherwise dragging the strip shut hides the chart first. */
        S.height = clamp(h0 + (y - ev.clientY), 180, window.innerHeight - 220);
        panel.style.height = S.height + 'px';
        layout();
        draw();
      }
      function up() {
        grip.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        savePrefs();
        draw();
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  return {
    open: open, close: close, toggle: toggle, openHere: openHere,
    refresh: recompute, shown: function () { return S.shown; },
    zoom: setZoom, fitAll: fitAll,
    _state: S, _series: SERIES
  };
})();
