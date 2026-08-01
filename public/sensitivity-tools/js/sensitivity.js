/* ============================================================
   sensitivity.js — the line-of-sight sensitivity model

   For every terrain cell P and sensor R:
        u = unit(P - R)                     radar line of sight
        m = assumed movement unit vector    (steepest | horizontal |
                                             vertical | normal | custom)
        S = |u · m|                         sensitivity, 0…1
   S is the fraction of a real slope displacement that the radar can
   actually measure along its line of sight.  S = 1 → movement dead-on
   towards the sensor; S = 0 → movement perpendicular to the LOS and
   therefore invisible, no matter how strong the returned amplitude is.

   Amplitude proxy   A = |u · n|   (n = surface normal) — how well the
   facet reflects back towards the antenna, i.e. why areas parallel to
   the LOS give poor signal.

   vis codes: 0 no-data · 1 visible · 2 shadowed · 3 outside scan · 4 grazing
   ============================================================ */
'use strict';

var Sens = (function () {

  var VIS = { NODATA: 0, OK: 1, SHADOW: 2, OUTSIDE: 3, GRAZING: 4 };
  var DEG = Math.PI / 180;

  function nextFrame() {
    return new Promise(function (r) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { r(); });
      else setTimeout(r, 0);
    });
  }

  /* -------------------------------------------- movement vector */
  /** custom trend/plunge → unit vector (x=east, y=north, z=up) */
  function customVec(azDeg, plDeg) {
    var a = azDeg * DEG, p = plDeg * DEG;
    return [Math.sin(a) * Math.cos(p), Math.cos(a) * Math.cos(p), -Math.sin(p)];
  }

  /* -------------------------------------------------- AOI mask */
  function aoiMask(g, der, aoi) {
    var n = g.nx * g.ny, mask = new Uint8Array(n);
    if (!aoi || !aoi.on) { mask.fill(1); return mask; }
    var smin = (aoi.slopeMin || 0) * DEG, smax = (aoi.slopeMax == null ? 90 : aoi.slopeMax) * DEG;
    for (var j = 0; j < g.ny; j++) {
      var y = g.y0 + j * g.dy;
      if (y < aoi.ymin || y > aoi.ymax) continue;
      for (var i = 0; i < g.nx; i++) {
        var x = g.x0 + i * g.dx;
        if (x < aoi.xmin || x > aoi.xmax) continue;
        var id = j * g.nx + i, z = g.z[id];
        if (z !== z) continue;
        if (z < aoi.zmin || z > aoi.zmax) continue;
        var s = der.slope[id];
        if (s === s && (s < smin - 1e-9 || s > smax + 1e-9)) continue;
        mask[id] = 1;
      }
    }
    return mask;
  }

  /* ------------------------------------------------- main compute */
  /**
   * radars: [{x,y,z, az, apAz, apEl, rmin, rmax, on, name, color}]
   * opts  : {mode, custAz, custPl, occlusion, occStep, occTol,
   *          grazing, grazMax, threshold, combine, mask}
   */
  async function compute(g, der, radars, opts, onProgress) {
    var n = g.nx * g.ny, nx = g.nx, ny = g.ny;
    var active = radars.filter(function (r) { return r.on !== false; });
    if (!active.length) throw new Error('No enabled sensor position.');

    var mode = opts.mode || 'steepest';
    var cust = customVec(opts.custAz || 0, opts.custPl || 45);
    var occ = !!opts.occlusion, occStep = +opts.occStep || 1, occTol = +opts.occTol || 0.5;
    var grazOn = !!opts.grazing, grazCos = Math.cos((opts.grazMax == null ? 85 : opts.grazMax) * DEG);
    var perRadar = [], total = active.length * n, done = 0;
    var CHUNK = occ ? 6000 : 60000;

    for (var ri = 0; ri < active.length; ri++) {
      var R = active[ri];
      var sens = new Float32Array(n), amp = new Float32Array(n), rng = new Float32Array(n);
      var vis = new Uint8Array(n);
      sens.fill(NaN); amp.fill(NaN); rng.fill(NaN);

      var apAz = R.apAz == null ? 180 : R.apAz, apEl = R.apEl == null ? 90 : R.apEl;
      var rmin = R.rmin || 0, rmax = R.rmax || 1e9, bore = R.az || 0;
      /* elevation cone is centred on the antenna tilt, not on the horizon —
         a sensor in a pit is aimed up at the wall it monitors */
      var tilt = R.el || 0;

      for (var start = 0; start < n; start += CHUNK) {
        var end = Math.min(n, start + CHUNK);
        for (var id = start; id < end; id++) {
          var z = g.z[id];
          if (z !== z) { vis[id] = VIS.NODATA; continue; }
          var i = id % nx, j = (id - i) / nx;
          var px = g.x0 + i * g.dx, py = g.y0 + j * g.dy;

          var dx = px - R.x, dy = py - R.y, dz = z - R.z;
          var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          rng[id] = dist;
          if (dist < 1e-6) { vis[id] = VIS.OUTSIDE; continue; }
          var ux = dx / dist, uy = dy / dist, uz = dz / dist;

          /* --- surface normal & amplitude proxy --- */
          var ncos = Math.abs(ux * der.nx[id] + uy * der.ny[id] + uz * der.nz[id]);
          amp[id] = ncos;

          /* --- movement vector --- */
          var fx = der.fx[id], fy = der.fy[id];
          var mx, my, mz, mag2 = fx * fx + fy * fy, mag = Math.sqrt(mag2);
          if (mode === 'vertical') { mx = 0; my = 0; mz = -1; }
          else if (mode === 'custom') { mx = cust[0]; my = cust[1]; mz = cust[2]; }
          else if (mode === 'normal') {
            /* straight out of the face — the outward surface normal, per cell.
               S then equals the amplitude proxy by construction: the geometry
               that reflects best is the geometry that measures best. */
            mx = der.nx[id]; my = der.ny[id]; mz = der.nz[id];
          }
          else if (mode === 'horizontal') {
            if (mag < 1e-9) { sens[id] = NaN; vis[id] = VIS.NODATA; continue; }
            mx = -fx / mag; my = -fy / mag; mz = 0;
          } else { /* steepest */
            if (mag < 1e-9) { mx = 0; my = 0; mz = -1; }
            else {
              var L = Math.sqrt(mag2 + mag2 * mag2);
              mx = -fx / L; my = -fy / L; mz = -mag2 / L;
            }
          }

          sens[id] = Math.abs(ux * mx + uy * my + uz * mz);

          /* --- scan footprint --- */
          if (dist < rmin || dist > rmax) { vis[id] = VIS.OUTSIDE; continue; }
          if (apAz < 180) {
            var az = Math.atan2(dx, dy) / DEG;
            var d = az - bore;
            while (d > 180) d -= 360; while (d < -180) d += 360;
            if (Math.abs(d) > apAz) { vis[id] = VIS.OUTSIDE; continue; }
          }
          if (apEl < 90 || tilt !== 0) {
            var el = Math.asin(Math.max(-1, Math.min(1, dz / dist))) / DEG;
            if (Math.abs(el - tilt) > apEl) { vis[id] = VIS.OUTSIDE; continue; }
          }
          if (grazOn && ncos < grazCos) { vis[id] = VIS.GRAZING; continue; }
          if (occ && !Grid.losClear(g, R.x, R.y, R.z, px, py, z, occStep, occTol)) {
            vis[id] = VIS.SHADOW; continue;
          }
          vis[id] = VIS.OK;
        }
        done += (end - start);
        if (onProgress) onProgress(done / total, R.name);
        await nextFrame();
      }
      perRadar.push({ radar: R, sens: sens, amp: amp, range: rng, vis: vis });
    }

    /* ------------------------------------------- combination */
    var combined = combine(perRadar, opts.combine || 'selected', opts.selectedIndex || 0, n);

    /* per-sensor statistics for the planning table */
    var mask = opts.mask;
    for (var k = 0; k < perRadar.length; k++) {
      perRadar[k].stats = summarise(perRadar[k], mask, opts.threshold, g);
    }
    var cstats = summarise(combined, mask, opts.threshold, g);

    return { perRadar: perRadar, combined: combined, stats: cstats, mode: mode, VIS: VIS };
  }

  /* --------------------------------------------------- combine */
  function combine(perRadar, how, selIdx, n) {
    if (perRadar.length === 1 || how === 'selected') {
      var pick = perRadar[Math.min(selIdx, perRadar.length - 1)] || perRadar[0];
      var which = new Float32Array(n); which.fill(NaN);
      for (var q = 0; q < n; q++) if (pick.vis[q] === VIS.OK) which[q] = pick.__idx != null ? pick.__idx : selIdx;
      return { sens: pick.sens, amp: pick.amp, range: pick.range, vis: pick.vis, which: which, single: true };
    }
    var sens = new Float32Array(n), amp = new Float32Array(n), rng = new Float32Array(n);
    var vis = new Uint8Array(n), which = new Float32Array(n);
    sens.fill(NaN); amp.fill(NaN); rng.fill(NaN); which.fill(NaN);

    for (var id = 0; id < n; id++) {
      var best = -1, bi = -1, sum = 0, cnt = 0, anyData = false, code = VIS.NODATA;
      for (var r = 0; r < perRadar.length; r++) {
        var P = perRadar[r], v = P.vis[id];
        if (v !== VIS.NODATA) anyData = true;
        if (v !== VIS.OK) { if (code === VIS.NODATA || code === VIS.OUTSIDE) code = v; continue; }
        var s = P.sens[id];
        if (s !== s) continue;
        sum += s; cnt++;
        if (s > best) { best = s; bi = r; }
      }
      if (cnt > 0) {
        vis[id] = VIS.OK;
        which[id] = bi;
        sens[id] = (how === 'mean') ? sum / cnt : best;
        amp[id] = perRadar[bi].amp[id];
        rng[id] = perRadar[bi].range[id];
      } else {
        vis[id] = anyData ? (code === VIS.NODATA ? VIS.OUTSIDE : code) : VIS.NODATA;
        /* still expose geometric sensitivity of the first sensor for reference */
        var f = perRadar[0];
        sens[id] = f.sens[id]; amp[id] = f.amp[id]; rng[id] = f.range[id];
      }
    }
    return { sens: sens, amp: amp, range: rng, vis: vis, which: which, single: false };
  }

  /* ------------------------------------------------ statistics */
  function summarise(F, mask, thr, g) {
    var n = F.sens.length, cellA = g.dx * g.dy;
    var vals = [], nData = 0, nVis = 0, nAbove = 0, sumS = 0, sumA = 0, sumR = 0;
    var nShadow = 0, nOutside = 0, nGraz = 0;
    thr = thr == null ? 0.5 : thr;
    for (var id = 0; id < n; id++) {
      if (mask && !mask[id]) continue;
      var v = F.vis[id];
      if (v === VIS.NODATA && !(F.sens[id] === F.sens[id])) continue;
      nData++;
      if (v === VIS.SHADOW) nShadow++;
      else if (v === VIS.OUTSIDE) nOutside++;
      else if (v === VIS.GRAZING) nGraz++;
      if (v !== VIS.OK) continue;
      var s = F.sens[id];
      if (s !== s) continue;
      nVis++; sumS += s; vals.push(s);
      if (s >= thr) nAbove++;
      if (F.amp[id] === F.amp[id]) sumA += F.amp[id];
      if (F.range[id] === F.range[id]) sumR += F.range[id];
    }
    vals.sort(function (a, b) { return a - b; });
    function pct(p) { return vals.length ? vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))] : NaN; }
    return {
      nData: nData, nVis: nVis, nAbove: nAbove,
      nShadow: nShadow, nOutside: nOutside, nGraz: nGraz,
      areaData: nData * cellA, areaVis: nVis * cellA, areaAbove: nAbove * cellA,
      coverage: nData ? nVis / nData : 0,
      usable: nData ? nAbove / nData : 0,
      mean: nVis ? sumS / nVis : NaN,
      meanAmp: nVis ? sumA / nVis : NaN,
      meanRange: nVis ? sumR / nVis : NaN,
      p10: pct(0.10), p50: pct(0.50), p90: pct(0.90),
      min: vals.length ? vals[0] : NaN, max: vals.length ? vals[vals.length - 1] : NaN,
      hist: histogram(vals, 25)
    };
  }

  function histogram(sorted, bins) {
    var h = new Int32Array(bins);
    for (var i = 0; i < sorted.length; i++) {
      var b = Math.floor(sorted[i] * bins);
      if (b < 0) b = 0; if (b >= bins) b = bins - 1;
      h[b]++;
    }
    return h;
  }

  /* --------------------------- layer extraction for the renderer */
  /** returns {values:Float32Array, vmin, vmax, unit, label, cyclic} */
  function layer(name, res, g, der, opts) {
    var n = g.nx * g.ny;
    switch (name) {
      case 'sens': return { values: res.combined.sens, vmin: 0, vmax: 1, label: 'Sensitivity |cos θ|', unit: '' };
      case 'amp': return { values: res.combined.amp, vmin: 0, vmax: 1, label: 'Amplitude proxy |cos i|', unit: '' };
      case 'range': return { values: res.combined.range, vmin: null, vmax: null, label: 'Range to sensor', unit: 'm' };
      case 'vis': {
        var v = new Float32Array(n);
        for (var i = 0; i < n; i++) {
          var c = res.combined.vis[i];
          v[i] = (c === VIS.NODATA) ? NaN : (c === VIS.OK ? 1 : 0);
        }
        return { values: v, vmin: 0, vmax: 1, label: 'Visible (1) / shadowed (0)', unit: '' };
      }
      case 'slope': {
        var s = new Float32Array(n);
        for (var k = 0; k < n; k++) s[k] = der.slope[k] * 180 / Math.PI;
        return { values: s, vmin: 0, vmax: 90, label: 'Slope angle', unit: '°' };
      }
      case 'aspect': return { values: der.aspect, vmin: 0, vmax: 360, label: 'Aspect (downslope az)', unit: '°', cyclic: true };
      case 'elev': return { values: g.z, vmin: g.zmin, vmax: g.zmax, label: 'Elevation', unit: 'm' };
      case 'which': {
        var w = new Float32Array(res.combined.which);
        return { values: w, vmin: 0, vmax: Math.max(1, res.perRadar.length - 1), label: 'Best sensor #', unit: '', discrete: true };
      }
      case 'mmres': {
        var f = opts && opts.trueDispl ? opts.trueDispl : 10;
        var m = new Float32Array(n);
        for (var q = 0; q < n; q++) m[q] = res.combined.sens[q] * f;
        return { values: m, vmin: 0, vmax: f, label: 'Measurable displacement of ' + f + ' mm', unit: 'mm' };
      }
    }
    return { values: res.combined.sens, vmin: 0, vmax: 1, label: 'Sensitivity', unit: '' };
  }

  function range(values, mask) {
    var mn = Infinity, mx = -Infinity;
    for (var i = 0; i < values.length; i++) {
      if (mask && !mask[i]) continue;
      var v = values[i]; if (v !== v) continue;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    if (mx - mn < 1e-9) mx = mn + 1;
    return [mn, mx];
  }

  return {
    VIS: VIS, compute: compute, aoiMask: aoiMask, layer: layer,
    customVec: customVec, range: range, summarise: summarise
  };
})();
