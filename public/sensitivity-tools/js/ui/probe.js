/* ============================================================
   ui/probe.js — the Identify tool's two read-outs: the live status bar under
   the cursor, and the pinned panel that explains one cell in full.
   ============================================================ */
'use strict';

SM.Probe = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, DEG = SM.DEG;

  /* ------------------------------------------------- status bar */
  function hover(ev) {
    if (!S.grid || S.busy) return;
    var hit = SM.V.pickAt(ev);
    if (!hit) {
      $('sbCoord').textContent = 'E —   N —   RL —';
      $('sbValue').textContent = '—';
      $('statusRight').textContent = '';
      return;
    }
    $('sbCoord').textContent =
      'E ' + fmt(hit.x, 1) + '   N ' + fmt(hit.y, 1) + '   RL ' + fmt(hit.z, 1);

    var id = Grid.nodeIndex(S.grid, hit.x, hit.y);
    var L = S.curLayer;
    if (id >= 0) {
      $('statusRight').textContent =
        'slope ' + fmt(S.der.slope[id] * 180 / Math.PI, 1) + '°  dip dir ' + fmt(S.der.aspect[id], 0) + '°';
      if (L) {
        var v = L.values[id];
        $('sbValue').textContent = (v === v)
          ? L.label + ' ' + fmt(v, 3) + (L.unit || '')
          : L.label + ' —';
      }
    } else {
      $('statusRight').textContent = '';
      $('sbValue').textContent = '—';
    }
  }

  /* ------------------------------------------------- pinned panel */
  function show(hit) {
    var g = S.grid;
    /* The probe reads the terrain rasters, so it has nothing to say before a
       surface is built. Reachable when a hit arrives from somewhere other than
       the terrain — an add-on drape, say — and dereferencing a null grid here
       would take the whole click handler down with it. */
    if (!g || !S.der) return;
    var id = Grid.nodeIndex(g, hit.x, hit.y);
    if (id < 0) return;
    var r = S.radars[S.sel];
    var slope = S.der.slope[id] * 180 / Math.PI, asp = S.der.aspect[id];
    var html = '<b>IDENTIFY</b><br>' +
      'X ' + fmt(hit.x, 2) + '<br>Y ' + fmt(hit.y, 2) + '<br>Z ' + fmt(hit.z, 2) + ' m<br>' +
      'slope ' + fmt(slope, 1) + '°  dip dir ' + fmt(asp, 0) + '°<br>';
    /* a cell inside a structural domain is not modelled on the global movement
       assumption, so the read-out has to say which vector produced its number */
    var dh = S.domIdx ? S.domIdx[id] : -1;
    if (dh >= 0 && S.domains[dh]) {
      var D = S.domains[dh];
      html += '<span style="color:' + D.color + '">▪ ' + SM.esc(D.name) + ' — moves ' +
        fmt(D.trend, 0) + '° → ' + fmt(D.plunge, 0) + '°</span><br>';
    }
    /* line-of-sight geometry from the selected sensor, so “out of scan” can be
       traced to the exact gate that rejected the cell */
    if (r) {
      var dx = hit.x - r.x, dy = hit.y - r.y, dz = hit.z - r.z;
      var hor = Math.hypot(dx, dy), dist = Math.hypot(dx, dy, dz);
      var azTo = ((Math.atan2(dx, dy) / DEG) % 360 + 360) % 360;
      var elTo = Math.atan2(dz, hor) / DEG;
      var dAz = azTo - (((r.az % 360) + 360) % 360);
      while (dAz > 180) dAz -= 360; while (dAz < -180) dAz += 360;
      var dEl = elTo - (r.el || 0);
      var bad = [];
      if (Math.abs(dAz) > r.apAz) bad.push('az off boresight ' + fmt(Math.abs(dAz), 1) + '° > ±' + fmt(r.apAz, 1) + '°');
      if (Math.abs(dEl) > r.apEl) bad.push('el off boresight ' + fmt(Math.abs(dEl), 1) + '° > ±' + fmt(r.apEl, 1) + '°');
      if (dist < r.rmin) bad.push('range ' + fmt(dist, 0) + ' m < min ' + fmt(r.rmin, 0) + ' m');
      if (dist > r.rmax) bad.push('range ' + fmt(dist, 0) + ' m > max ' + fmt(r.rmax, 0) + ' m');
      html += 'LOS az ' + fmt(azTo, 1) + '°  el ' + (elTo >= 0 ? '+' : '') + fmt(elTo, 1) + '°<br>';
      if (bad.length) html += '<span style="color:var(--sm-warn)">✗ ' + bad.join('<br>✗ ') + '</span><br>';
    }
    if (S.res) {
      var C = S.res.combined, code = C.vis[id];
      var st = ['no data', 'visible', 'SHADOWED', 'outside scan', 'grazing'][code] || '—';
      var f = parseFloat($('inpTrue').value) || 10;
      html += '<hr style="border:0;border-top:1px solid var(--sm-line);margin:5px 0">' +
        '<b>sensitivity ' + fmt(C.sens[id], 3) + '</b><br>' +
        'amplitude ' + fmt(C.amp[id], 3) + '<br>' +
        'range ' + fmt(C.range[id], 1) + ' m<br>' +
        'status ' + st + '<br>' +
        f + ' mm true → <b>' + fmt(C.sens[id] * f, 2) + ' mm</b> LOS';
      if (!C.single && C.which[id] === C.which[id]) {
        var w = S.res.perRadar[C.which[id]];
        if (w) html += '<br>best: ' + w.radar.name;
      }
      /* explain a shadow: what blocks it, and how much higher the antenna
         would have to sit to clear it */
      if (code === Sens.VIS.SHADOW && r) {
        var b = Grid.losBlocker(S.grid, r.x, r.y, r.z, hit.x, hit.y, hit.z,
          parseFloat($('selOccAcc').value) || 1, parseFloat($('inpOccTol').value) || 0);
        if (b) {
          html += '<br><span style="color:var(--sm-warn)">blocked ' + fmt(b.dist, 0) + ' m out' +
            '<br>terrain ' + fmt(b.excess, 1) + ' m above the LOS' +
            '<br>raise antenna ≈ ' + fmt(b.raise, 1) + ' m to clear</span>';
        }
      }
    }
    $('hudReadout').innerHTML = html;
    $('hudReadout').classList.remove('hidden');
  }

  return { hover: hover, show: show };
})();
