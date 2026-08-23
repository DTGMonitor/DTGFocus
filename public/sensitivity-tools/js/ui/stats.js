/* ============================================================
   ui/stats.js — the Statistics tab: the summary block, the sensitivity
   histogram and the position ranking that answers "where should the radar
   actually go".
   ============================================================ */
'use strict';

SM.Stats = (function () {

  var $ = SM.$, S = SM.S, LC = SM.LC, fmt = SM.fmt, fmtInt = SM.fmtInt;

  /* the bars currently on screen, plus which one the pointer is over. The
     histogram counts only the visible cells, the same population the mean and
     the percentiles above it describe. */
  var HIST = { bins: null, hover: -1 };

  function init() {
    var cv = $('histCanvas');
    cv.onmousemove = function (e) {
      var h = HIST.bins;
      if (!h || !h.length) return;
      var r = cv.getBoundingClientRect(), w = r.width || 1;
      var k = Math.floor((e.clientX - r.left) / w * h.length);
      if (k < 0) k = 0;
      if (k >= h.length) k = h.length - 1;
      if (k !== HIST.hover) { HIST.hover = k; drawHist(h); }
      showHistTip(k, e.clientX - r.left);
    };
    cv.onmouseleave = function () {
      $('histTip').classList.add('hidden');
      if (HIST.hover < 0) return;
      HIST.hover = -1; drawHist(HIST.bins);
    };
    /* the canvas has no width while its pane is hidden, so it is re-laid out
       when the tab comes forward as well as on a window resize */
    SM.on('stats:shown', layoutHist);
    SM.on('layout', layoutHist);
    layoutHist();
  }

  function update() {
    if (!S.res) {
      $('statsBox').textContent = 'Compute the sensitivity map to see statistics.';
      drawHist(null); return;
    }
    var st = S.res.stats, ha = 1 / 10000;
    var pct = function (v) { return (100 * v).toFixed(1) + '%'; };
    $('statsBox').innerHTML =
      'analysed cells   <b>' + fmtInt(st.nData) + '</b>  (' + fmt(st.areaData * ha, 1) + ' ha)' + maskNote() + '\n' +
      'visible          <b class="g">' + fmtInt(st.nVis) + '</b>  ' + pct(st.coverage) + '\n' +
      '  shadowed       ' + fmtInt(st.nShadow) + (st.nGraz ? '   grazing ' + fmtInt(st.nGraz) : '') + '\n' +
      '  outside scan   ' + fmtInt(st.nOutside) + '\n' +
      'sens ≥ ' + fmt(S.res.opts.threshold, 2) + '     <b>' + fmtInt(st.nAbove) + '</b>  ' + pct(st.usable) +
      '  (' + fmt(st.areaAbove * ha, 1) + ' ha)\n' +
      'mean / median    <b>' + fmt(st.mean, 3) + '</b> / ' + fmt(st.p50, 3) + '\n' +
      'p10 / p90        ' + fmt(st.p10, 3) + ' / ' + fmt(st.p90, 3) + '\n' +
      'p20 / p80        ' + fmt(st.p20, 3) + ' / ' + fmt(st.p80, 3) + '\n' +
      'mean amplitude   ' + fmt(st.meanAmp, 3) + '\n' +
      'mean range       ' + fmt(st.meanRange, 0) + ' m' +
      hintFor(st);
    drawHist(st.hist);
  }

  /* Where the numbers are actually read, say what they cover — a joined figure
     over three walls is a different claim from the same figure over one. */
  function maskNote() {
    if (!$('chkAOI').checked || !S.polys.length) return '';
    return '  <span class="g">' + (S.polys.length === 1
      ? 'in 1 region' : 'joined over ' + S.polys.length + ' regions') + '</span>';
  }

  /** turn a bad-looking result into an actionable next step */
  function hintFor(st) {
    if (!st.nData) return '';
    var out = st.nOutside / st.nData, sh = st.nShadow / st.nData;
    var t = [];
    /* a buried sensor explains everything else, so lead with it */
    S.radars.forEach(function (r) {
      if (r.on === false) return;
      var c = SM.Sensors.clearance(r);
      if (c === c && c < -0.05) t.push('<span class="w"><b>' + r.name + ' is ' + fmt(-c, 1) +
        ' m below the terrain</b> — that alone forces 0% coverage. Select it in the Layers ' +
        'tree, tick “Z = terrain + antenna height” in Properties, and recompute.</span>');
    });
    if (out > 0.5) t.push('<span class="w">' + (100 * out).toFixed(0) +
      '% is outside the scan geometry. Widen “Az/El scan width”, raise “Range max”, ' +
      'or tick “Auto-aim at model” so the boresight and tilt point at the pit.</span>');
    if (sh > 0.5) t.push('<span class="w">' + (100 * sh).toFixed(0) +
      '% is shadowed. On a benched wall a low sensor mostly sees berm tops — raise the ' +
      'antenna, move it back, or identify a dark cell to read how much lift it needs. ' +
      'Untick the shadow test for the pure geometric cosine map.</span>');
    if (st.nVis && st.mean < 0.3) t.push('<span class="w">mean sensitivity is low — this ' +
      'line of sight is nearly perpendicular to the assumed movement. Check the movement ' +
      'vector, or try a position that looks along the failure direction.</span>');
    return t.length ? '\n\n' + t.join('\n\n') : '';
  }

  function layoutHist() {
    var c = $('histCanvas');
    c.width = Math.max(60, c.clientWidth * (window.devicePixelRatio || 1));
    drawHist(S.res ? S.res.stats.hist : null);
  }

  function showHistTip(k, px) {
    var h = HIST.bins, tip = $('histTip'), cv = $('histCanvas');
    var total = 0, upTo = 0;
    for (var i = 0; i < h.length; i++) { total += h[i]; if (i <= k) upTo += h[i]; }
    var lo = k / h.length, hi = (k + 1) / h.length, cells = h[k];
    var area = S.grid ? cells * S.grid.dx * S.grid.dy / 10000 : NaN;
    tip.innerHTML =
      '<b>S ' + lo.toFixed(2) + ' – ' + hi.toFixed(2) + '</b>' +
      '<span>' + fmtInt(cells) + ' cells · ' + (total ? (100 * cells / total).toFixed(1) : '0.0') +
      '% of visible' + (area === area ? ' · ' + fmt(area, 1) + ' ha' : '') + '</span>' +
      '<span>' + (total ? (100 * upTo / total).toFixed(1) : '0.0') + '% at or below ' + hi.toFixed(2) + '</span>';
    tip.classList.remove('hidden');
    /* follow the pointer horizontally but stay inside the canvas, so the text
       never spills over the panel edge and gets clipped */
    var w = tip.offsetWidth, room = cv.clientWidth - w;
    tip.style.left = Math.max(0, Math.min(room, px - w / 2)) + 'px';
  }

  function drawHist(h) {
    var cv = $('histCanvas'), dpr = window.devicePixelRatio || 1;
    HIST.bins = h;
    if (!h) { HIST.hover = -1; $('histTip').classList.add('hidden'); }
    cv.width = Math.max(60, cv.clientWidth * dpr); cv.height = 110 * dpr;
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = cv.width / dpr, H = cv.height / dpr;
    g.clearRect(0, 0, W, H);
    if (!h) {
      g.fillStyle = SM.cssVar('--dim2', '#5a6472'); g.font = '11px Segoe UI'; g.textAlign = 'center';
      g.fillText('sensitivity distribution', W / 2, H / 2); return;
    }
    var max = 0;
    for (var i = 0; i < h.length; i++) max = Math.max(max, h[i]);
    if (!max) return;
    var LUT = ColorMaps.buildLUT(LC.sens);
    var bw = W / h.length, pad = 16;
    for (var k = 0; k < h.length; k++) {
      var t = (k + 0.5) / h.length;
      var c = ColorMaps.sample(LUT, t);
      var bh = (h[k] / max) * (H - pad - 4);
      g.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      g.fillRect(k * bw + 0.5, H - pad - bh, Math.max(1, bw - 1), bh);
    }
    if (HIST.hover >= 0 && HIST.hover < h.length) {
      g.save();
      g.strokeStyle = SM.cssVar('--fg', '#e6ebf2'); g.lineWidth = 1; g.globalAlpha = 0.7;
      g.strokeRect(HIST.hover * bw + 1, 2.5, Math.max(1, bw - 2), H - pad - 2.5);
      g.restore();
    }
    /* threshold marker */
    var thr = parseFloat($('inpThresh').value) || 0;
    g.strokeStyle = SMTheme.col('--sm-fg'); g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(thr * W, 2); g.lineTo(thr * W, H - pad); g.stroke();
    g.setLineDash([]);
    g.fillStyle = SM.cssVar('--dim', '#8f9bab'); g.font = '9px Consolas'; g.textAlign = 'left';
    g.fillText('0', 2, H - 4);
    g.textAlign = 'center'; g.fillText('sensitivity', W / 2, H - 4);
    g.textAlign = 'right'; g.fillText('1', W - 2, H - 4);
  }

  function updateRank() {
    var t = $('rankTable');
    if (!S.res) { t.innerHTML = '<tr><td class="dim">Compute with 1+ sensors to rank positions.</td></tr>'; return; }
    var rows = S.res.perRadar.map(function (P) { return { r: P.radar, s: P.stats }; });
    var best = -1, bi = -1;
    rows.forEach(function (o, i) { if (o.s.usable > best) { best = o.s.usable; bi = i; } });
    var html = '<tr><th>#</th><th>sensor</th><th>usable</th><th>cover</th><th>mean S</th><th>rng</th></tr>';
    rows.forEach(function (o, i) {
      html += '<tr' + (i === bi ? ' class="sel"' : '') + '>' +
        '<td><span class="dot" style="background:' + o.r.color + '"></span></td>' +
        '<td>' + SM.esc(o.r.name) + '</td>' +
        '<td class="n' + (i === bi ? ' best' : '') + '">' + (100 * o.s.usable).toFixed(1) + '%</td>' +
        '<td class="n">' + (100 * o.s.coverage).toFixed(1) + '%</td>' +
        '<td class="n">' + fmt(o.s.mean, 3) + '</td>' +
        '<td class="n">' + fmt(o.s.meanRange, 0) + '</td></tr>';
    });
    t.innerHTML = html;
  }

  return { init: init, update: update, updateRank: updateRank, layoutHist: layoutHist, drawHist: drawHist };
})();
