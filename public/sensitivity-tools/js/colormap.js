/* ============================================================
   colormap.js — editable colour scales
   Stops are [position 0..1, "#rrggbb"] pairs; a 256-entry LUT is
   baked for the shader / colorbar / histogram.
   ============================================================ */
'use strict';

var ColorMaps = (function () {

  /* ---- presets (IDS/Guardian-like first) ---- */
  var PRESETS = {
    'ids-green': {
      name: 'IDS Guardian Green',
      stops: [[0.00, '#ffffff'], [0.16, '#dcfadd'], [0.38, '#7fe382'],
              [0.60, '#22c322'], [0.80, '#0c8a12'], [1.00, '#01430a']]
    },
    'ids-green-dark': {
      name: 'IDS Green (dark base)',
      stops: [[0.00, '#0b1a10'], [0.20, '#0f5c22'], [0.45, '#1aa832'],
              [0.70, '#5ce05c'], [1.00, '#e8ffe8']]
    },
    'ids-jet': {
      name: 'IDS Radar Jet',
      stops: [[0.00, '#00007f'], [0.12, '#0000ff'], [0.30, '#00d4ff'],
              [0.48, '#22c322'], [0.62, '#ffff00'], [0.80, '#ff7f00'], [1.00, '#a80000']]
    },
    'ids-amplitude': {
      name: 'GBD Amplitude (blue-red)',
      stops: [[0.00, '#0a1a6e'], [0.25, '#1060d8'], [0.45, '#22c8d8'],
              [0.62, '#66d84a'], [0.78, '#ffe000'], [0.90, '#ff7400'], [1.00, '#c00000']]
    },
    'turbo': {
      name: 'Turbo',
      stops: [[0.00, '#30123b'], [0.14, '#4145ab'], [0.28, '#4675ed'], [0.42, '#39a8fd'],
              [0.55, '#1bd0d5'], [0.66, '#4ceb8f'], [0.76, '#a4fc3c'], [0.85, '#f1ca3a'],
              [0.93, '#fe8022'], [1.00, '#900c00']]
    },
    'viridis': {
      name: 'Viridis',
      stops: [[0.00, '#440154'], [0.20, '#414487'], [0.40, '#2a788e'],
              [0.60, '#22a884'], [0.80, '#7ad151'], [1.00, '#fde725']]
    },
    'inferno': {
      name: 'Inferno',
      stops: [[0.00, '#000004'], [0.20, '#320a5a'], [0.40, '#781c6d'],
              [0.60, '#bb3654'], [0.80, '#ed6925'], [1.00, '#fcffa4']]
    },
    'rdylgn': {
      name: 'Red-Yellow-Green (alarm)',
      stops: [[0.00, '#a50026'], [0.25, '#f46d43'], [0.50, '#fee08b'],
              [0.75, '#a6d96a'], [1.00, '#1a9850']]
    },
    'traffic': {
      name: 'Traffic light (3 band)',
      stops: [[0.00, '#d32f2f'], [0.33, '#d32f2f'], [0.34, '#fbc02d'],
              [0.66, '#fbc02d'], [0.67, '#388e3c'], [1.00, '#388e3c']]
    },
    'grey': { name: 'Greyscale', stops: [[0, '#101010'], [1, '#f5f5f5']] },
    'terrain': {
      name: 'Terrain',
      stops: [[0.00, '#2b5d34'], [0.25, '#7a9b4a'], [0.50, '#d9cf8a'],
              [0.75, '#a9835c'], [1.00, '#ffffff']]
    },
    'aspect': {
      name: 'Aspect (cyclic)',
      stops: [[0.00, '#ff0000'], [0.17, '#ffff00'], [0.33, '#00ff00'],
              [0.50, '#00ffff'], [0.67, '#0000ff'], [0.83, '#ff00ff'], [1.00, '#ff0000']]
    },
    'sensors': {
      name: 'Sensor index (discrete)',
      stops: [[0.00, '#ffd400'], [0.25, '#2f9bff'], [0.50, '#ff5252'],
              [0.75, '#12c2a0'], [1.00, '#e040fb']]
    }
  };

  /* ---- colour helpers ---- */
  function hex2rgb(h) {
    h = (h || '#000000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    function p(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + p(r) + p(g) + p(b);
  }

  /* ---- LUT ---- */
  /** cfg = {stops, reverse, bands, gamma} -> Uint8Array(256*3) */
  function buildLUT(cfg) {
    var N = 256, lut = new Uint8Array(N * 3);
    var stops = (cfg.stops || [[0, '#000'], [1, '#fff']]).slice()
      .map(function (s) { return [Math.max(0, Math.min(1, +s[0])), hex2rgb(s[1])]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    if (!stops.length) stops = [[0, [0, 0, 0]], [1, [255, 255, 255]]];
    if (stops.length === 1) stops.push([1, stops[0][1]]);
    var gamma = cfg.gamma && cfg.gamma > 0 ? cfg.gamma : 1;
    var bands = cfg.bands | 0;

    for (var i = 0; i < N; i++) {
      var t = i / (N - 1);
      if (bands > 0) t = Math.min(0.999999, Math.floor(t * bands) / Math.max(1, bands - 1));
      if (gamma !== 1) t = Math.pow(t, gamma);
      if (cfg.reverse) t = 1 - t;
      // locate segment
      var k = 0;
      while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      var a = stops[k], b = stops[k + 1];
      var span = b[0] - a[0];
      var f = span <= 1e-9 ? 0 : (t - a[0]) / span;
      f = Math.max(0, Math.min(1, f));
      lut[i * 3] = a[1][0] + (b[1][0] - a[1][0]) * f;
      lut[i * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * f;
      lut[i * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * f;
    }
    return lut;
  }

  function sample(lut, t) {
    var i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
    return [lut[i], lut[i + 1], lut[i + 2]];
  }
  function sampleHex(lut, t) { var c = sample(lut, t); return rgb2hex(c[0], c[1], c[2]); }

  /* ---- CSS gradient string (for the stop editor preview bar) ---- */
  function cssGradient(lut, horizontal) {
    var parts = [];
    for (var i = 0; i <= 16; i++) {
      var t = i / 16;
      parts.push(sampleHex(lut, t) + ' ' + (t * 100).toFixed(1) + '%');
    }
    return 'linear-gradient(to ' + (horizontal ? 'right' : 'top') + ',' + parts.join(',') + ')';
  }

  /* ---- vertical colorbar with tick labels ---- */
  function drawColorbar(cv, lut, vmin, vmax, opts) {
    opts = opts || {};
    var dpr = window.devicePixelRatio || 1;
    var W = opts.width || 76, H = opts.height || 300;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var bw = 22, bx = 6, by = 8, bh = H - 16;
    for (var y = 0; y < bh; y++) {
      var t = 1 - y / (bh - 1);
      var c = sample(lut, t);
      g.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      g.fillRect(bx, by + y, bw, 1);
    }
    g.strokeStyle = '#5a6472'; g.lineWidth = 1;
    g.strokeRect(bx + 0.5, by + 0.5, bw, bh);

    var ticks = opts.ticks || 5;
    g.font = '10px Consolas,monospace';
    g.fillStyle = '#c9d3df'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.strokeStyle = '#8f9bab';
    var dec = opts.decimals != null ? opts.decimals : (Math.abs(vmax - vmin) >= 50 ? 0 : 2);
    for (var i = 0; i < ticks; i++) {
      var f = i / (ticks - 1);
      var yy = by + bh - f * bh;
      var val = vmin + (vmax - vmin) * f;
      g.beginPath(); g.moveTo(bx + bw, yy); g.lineTo(bx + bw + 4, yy); g.stroke();
      g.fillText(opts.fmt ? opts.fmt(val) : val.toFixed(dec), bx + bw + 7, yy);
    }
    // threshold marker
    if (opts.marker != null && vmax > vmin) {
      var mf = (opts.marker - vmin) / (vmax - vmin);
      if (mf >= 0 && mf <= 1) {
        var my = by + bh - mf * bh;
        g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(bx - 3, my); g.lineTo(bx + bw + 3, my); g.stroke();
        g.strokeStyle = '#000'; g.lineWidth = 0.5;
        g.beginPath(); g.moveTo(bx - 3, my); g.lineTo(bx + bw + 3, my); g.stroke();
      }
    }
  }

  /* ---- horizontal bar used when compositing a PNG export ---- */
  function drawColorbarInto(g, x, y, w, h, lut, vmin, vmax, title) {
    for (var i = 0; i < h; i++) {
      var t = 1 - i / (h - 1), c = sample(lut, t);
      g.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      g.fillRect(x, y + i, w, 1);
    }
    g.strokeStyle = '#cfd8e3'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w, h);
    g.font = '12px Consolas,monospace'; g.fillStyle = '#f0f4f8';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    var dec = Math.abs(vmax - vmin) >= 50 ? 0 : 2;
    for (var k = 0; k < 5; k++) {
      var f = k / 4, yy = y + h - f * h;
      g.fillText((vmin + (vmax - vmin) * f).toFixed(dec), x + w + 6, yy);
    }
    if (title) {
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.font = '13px Segoe UI,sans-serif';
      g.fillText(title, x + w / 2, y - 8);
    }
  }

  return {
    PRESETS: PRESETS, buildLUT: buildLUT, sample: sample, sampleHex: sampleHex,
    hex2rgb: hex2rgb, rgb2hex: rgb2hex, cssGradient: cssGradient,
    drawColorbar: drawColorbar, drawColorbarInto: drawColorbarInto
  };
})();
