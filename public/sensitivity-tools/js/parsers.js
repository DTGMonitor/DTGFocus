/* ============================================================
   parsers.js — terrain file readers
   Supported
     · DXF        3DFACE, POLYFACE / POLYLINE meshes, POINT, LINE,
                  LWPOLYLINE (with elevation), VERTEX
     · Surpac     .str (string file) + .dtm (TRISOLATION triangle list)
     · ASCII      free format X Y Z with user column mapping
     · ESRI       .asc / .grd ArcInfo ASCII raster
   Every parser returns
     { kind, name, pts:[x,y,z,...], tris:[i0,i1,i2,...], note }
   ============================================================ */
'use strict';

var Parsers = (function () {

  /* ---------------------------------------------------------- utils */
  function splitLines(txt) {
    return txt.split(/\r\n|\r|\n/);
  }
  function isNum(s) {
    if (s == null) return false;
    s = String(s).trim();
    if (!s) return false;
    return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s);
  }
  function guessDelim(lines) {
    var cand = [',', ';', '\t', ' '], best = ' ', bestScore = -1;
    for (var c = 0; c < cand.length; c++) {
      var d = cand[c], counts = [], n = 0;
      for (var i = 0; i < lines.length && n < 12; i++) {
        var L = lines[i].trim(); if (!L) continue;
        var f = splitBy(L, d);
        if (f.length < 2) { n++; counts.push(0); continue; }
        var num = 0;
        for (var k = 0; k < f.length; k++) if (isNum(f[k])) num++;
        counts.push(num); n++;
      }
      var score = 0;
      for (var j = 0; j < counts.length; j++) score += counts[j];
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
  function splitBy(line, delim) {
    if (delim === ' ') return line.trim().split(/\s+/);
    return line.split(delim).map(function (s) { return s.trim(); });
  }

  /* ---------------------------------------------------- ASCII preview */
  /** Returns {delim, rows[][], ncol, guess:{x,y,z}} */
  function previewASCII(txt, fileName, delimOpt, skip) {
    var lines = splitLines(txt);
    var body = [];
    for (var i = skip | 0; i < lines.length && body.length < 40; i++) {
      if (lines[i].trim()) body.push(lines[i]);
    }
    var delim = (!delimOpt || delimOpt === 'auto') ? guessDelim(body) : (delimOpt === '\\t' ? '\t' : delimOpt);
    var rows = body.map(function (L) { return splitBy(L, delim); });
    var ncol = 0;
    rows.forEach(function (r) { ncol = Math.max(ncol, r.length); });

    /* which columns are consistently numeric? (ignore first row = maybe header) */
    var numeric = [];
    for (var c = 0; c < ncol; c++) {
      var ok = 0, tot = 0;
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].length <= c) continue;
        tot++; if (isNum(rows[r][c])) ok++;
      }
      numeric.push(tot > 0 && ok / tot > 0.8);
    }
    var numCols = [];
    for (var q = 0; q < ncol; q++) if (numeric[q]) numCols.push(q);

    var g = { x: numCols[0] != null ? numCols[0] : 0, y: numCols[1] != null ? numCols[1] : 1, z: numCols[2] != null ? numCols[2] : 2 };
    var ext = (fileName || '').toLowerCase().split('.').pop();

    /* Surpac .str  →  id, Y, X, Z, description */
    if (ext === 'str' && numCols.length >= 4) g = { x: numCols[2], y: numCols[1], z: numCols[3] };
    /* leading integer id column (Surpac / Micromine style dumps) */
    else if (numCols.length >= 4 && looksLikeId(rows, numCols[0])) {
      g = { x: numCols[1], y: numCols[2], z: numCols[3] };
    }
    /* named header row */
    var head = rows[0] || [];
    for (var h = 0; h < head.length; h++) {
      var t = String(head[h]).toLowerCase().replace(/[^a-z]/g, '');
      if (t === 'x' || t === 'east' || t === 'easting' || t === 'xcoord') g.x = h;
      if (t === 'y' || t === 'north' || t === 'northing' || t === 'ycoord') g.y = h;
      if (t === 'z' || t === 'elev' || t === 'elevation' || t === 'rl' || t === 'level' || t === 'zcoord') g.z = h;
    }
    return { delim: delim, rows: rows, ncol: ncol, guess: g, numeric: numeric };
  }
  function looksLikeId(rows, c) {
    var prev = null, seq = 0, n = 0;
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][c]; if (!isNum(v)) continue;
      var f = parseFloat(v); if (f !== Math.floor(f)) return false;
      if (prev !== null && (f === prev || f === prev + 1)) seq++;
      prev = f; n++;
    }
    return n > 3 && seq / n > 0.5;
  }

  /* ---------------------------------------------------- ASCII parse */
  function parseASCII(txt, name, map) {
    var lines = splitLines(txt);
    var delim = map.delim === 'auto' ? guessDelim(lines.slice(0, 60)) : (map.delim === '\\t' ? '\t' : map.delim);
    var xc = map.x, yc = map.y, zc = map.z;
    if (map.swap) { var t = xc; xc = yc; yc = t; }
    var pts = [], bad = 0, maxc = Math.max(xc, yc, zc);
    for (var i = map.skip | 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L) continue;
      var s = L.trim();
      if (!s || s[0] === '#' || s[0] === '!' || s[0] === '*') continue;
      var f = splitBy(s, delim);
      if (f.length <= maxc) { bad++; continue; }
      var x = parseFloat(f[xc]), y = parseFloat(f[yc]), z = parseFloat(f[zc]);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { bad++; continue; }
      /* Surpac end-of-string sentinel lines */
      if (x === 0 && y === 0 && z === 0) continue;
      pts.push(x, y, z);
    }
    return { kind: 'points', name: name, pts: pts, tris: [], note: (pts.length / 3) + ' points' + (bad ? ', ' + bad + ' lines skipped' : '') };
  }

  /* ------------------------------------------- Surpac .dtm triangles */
  /** Triangle records reference node numbers of the matching .str file. */
  function parseSurpacDTM(txt, name) {
    var lines = splitLines(txt), tris = [], started = false;
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (!s) continue;
      var up = s.toUpperCase();
      if (up.indexOf('TRISOLATION') === 0 || up.indexOf('OBJECT') === 0) { started = true; continue; }
      if (!started) continue;
      var f = s.split(',').map(function (v) { return v.trim(); });
      if (f.length < 4) continue;
      if (!isNum(f[0]) || !isNum(f[1]) || !isNum(f[2]) || !isNum(f[3])) continue;
      var a = parseInt(f[1], 10), b = parseInt(f[2], 10), c = parseInt(f[3], 10);
      if (a > 0 && b > 0 && c > 0) tris.push(a - 1, b - 1, c - 1);
    }
    return { kind: 'tri-index', name: name, pts: [], tris: tris, note: (tris.length / 3) + ' triangles (needs matching .str)' };
  }
  function isSurpacDTM(txt) {
    var head = txt.substr(0, 4000).toUpperCase();
    return head.indexOf('TRISOLATION') >= 0 || (head.indexOf('OBJECT') >= 0 && head.indexOf('NEIGHBOUR') >= 0);
  }

  /* -------------------------------------------------- ESRI ASCII grid */
  function isESRI(txt) { return /^\s*ncols\s+\d+/i.test(txt.substr(0, 200)); }
  function parseESRI(txt, name) {
    var lines = splitLines(txt), hdr = {}, i = 0;
    for (; i < lines.length; i++) {
      var m = lines[i].trim().match(/^([a-zA-Z_]+)\s+([-+0-9.eE]+)/);
      if (!m) break;
      hdr[m[1].toLowerCase()] = parseFloat(m[2]);
    }
    var nx = hdr.ncols | 0, ny = hdr.nrows | 0, cs = hdr.cellsize || 1;
    var nod = hdr.nodata_value != null ? hdr.nodata_value : -9999;
    var x0 = hdr.xllcorner != null ? hdr.xllcorner + cs / 2 : (hdr.xllcenter || 0);
    var y0 = hdr.yllcorner != null ? hdr.yllcorner + cs / 2 : (hdr.yllcenter || 0);
    var z = new Float32Array(nx * ny);
    var vals = [], rest = lines.slice(i).join(' ');
    var tok = rest.split(/\s+/);
    var p = 0;
    for (var t = 0; t < tok.length && p < nx * ny; t++) {
      if (!tok[t]) continue;
      var v = parseFloat(tok[t]);
      vals.push(v); p++;
    }
    /* ESRI rows run north → south, our grid runs south → north */
    for (var r = 0; r < ny; r++) {
      for (var c = 0; c < nx; c++) {
        var v2 = vals[r * nx + c];
        z[(ny - 1 - r) * nx + c] = (v2 == null || v2 === nod) ? NaN : v2;
      }
    }
    return {
      kind: 'grid', name: name,
      grid: { nx: nx, ny: ny, dx: cs, dy: cs, x0: x0, y0: y0, z: z },
      pts: [], tris: [], note: nx + ' × ' + ny + ' raster @ ' + cs + ' m'
    };
  }

  /* ---------------------------------------------------------- DXF */
  function parseDXF(txt, name) {
    var lines = splitLines(txt);
    var pts = [], tris = [];
    var vmap = Object.create(null);

    function vid(x, y, z) {
      var k = x.toFixed(3) + '|' + y.toFixed(3) + '|' + z.toFixed(3);
      var i = vmap[k];
      if (i !== undefined) return i;
      i = pts.length / 3;
      pts.push(x, y, z);
      vmap[k] = i;
      return i;
    }
    function num(v) { var f = parseFloat(v); return isFinite(f) ? f : 0; }

    var i = 0, N = lines.length;
    var ent = null, entName = '', section = '';
    /* polyline / polyface state */
    var plActive = false, plFlags = 0, plVerts = [], plFaces = [];

    function pushEnt() {
      if (!ent) return;
      var E = entName;
      if (E === '3DFACE') {
        var a = vid(num(ent[10]), num(ent[20]), num(ent[30]));
        var b = vid(num(ent[11]), num(ent[21]), num(ent[31]));
        var c = vid(num(ent[12]), num(ent[22]), num(ent[32]));
        var d = ent[13] !== undefined ? vid(num(ent[13]), num(ent[23]), num(ent[33])) : c;
        if (a !== b && b !== c && a !== c) tris.push(a, b, c);
        if (d !== c && d !== a) tris.push(a, c, d);
      } else if (E === 'POINT') {
        vid(num(ent[10]), num(ent[20]), num(ent[30]));
      } else if (E === 'LINE') {
        vid(num(ent[10]), num(ent[20]), num(ent[30]));
        vid(num(ent[11]), num(ent[21]), num(ent[31]));
      } else if (E === 'LWPOLYLINE') {
        var xs = ent.__x || [], ys = ent.__y || [], el = ent[38] !== undefined ? num(ent[38]) : 0;
        for (var k = 0; k < Math.min(xs.length, ys.length); k++) vid(xs[k], ys[k], el);
      } else if (E === 'POLYLINE') {
        plActive = true; plFlags = ent[70] !== undefined ? parseInt(ent[70], 10) : 0;
        plVerts = []; plFaces = [];
        ent = null; entName = '';
        return;
      } else if (E === 'VERTEX') {
        var vf = ent[70] !== undefined ? parseInt(ent[70], 10) : 0;
        if ((vf & 128) && ent[71] !== undefined) {
          plFaces.push([parseInt(ent[71], 10) || 0, parseInt(ent[72], 10) || 0,
                        parseInt(ent[73], 10) || 0, parseInt(ent[74], 10) || 0]);
        } else {
          plVerts.push([num(ent[10]), num(ent[20]), num(ent[30])]);
        }
      } else if (E === 'SEQEND') {
        flushPolyline();
      }
      ent = null; entName = '';
    }

    function flushPolyline() {
      if (!plActive) return;
      var idx = plVerts.map(function (v) { return vid(v[0], v[1], v[2]); });
      if (plFaces.length) {
        for (var f = 0; f < plFaces.length; f++) {
          var q = plFaces[f].map(function (v) { return Math.abs(v) - 1; });
          var a = idx[q[0]], b = idx[q[1]], c = idx[q[2]], d = q[3] >= 0 ? idx[q[3]] : undefined;
          if (a === undefined || b === undefined || c === undefined) continue;
          if (a !== b && b !== c && a !== c) tris.push(a, b, c);
          if (d !== undefined && d !== c && d !== a) tris.push(a, c, d);
        }
      }
      plActive = false; plVerts = []; plFaces = [];
    }

    while (i + 1 < N) {
      var code = parseInt(lines[i].trim(), 10);
      var val = lines[i + 1];
      i += 2;
      if (isNaN(code)) continue;
      if (code === 0) {
        pushEnt();
        var nm = (val || '').trim().toUpperCase();
        if (nm === 'SECTION' || nm === 'ENDSEC' || nm === 'EOF') { entName = ''; ent = null; continue; }
        entName = nm; ent = Object.create(null);
        if (nm !== 'VERTEX' && nm !== 'SEQEND' && plActive) flushPolyline();
        continue;
      }
      if (!ent) continue;
      if (entName === 'LWPOLYLINE') {
        if (code === 10) { (ent.__x = ent.__x || []).push(num(val)); continue; }
        if (code === 20) { (ent.__y = ent.__y || []).push(num(val)); continue; }
      }
      if (ent[code] === undefined) ent[code] = (val || '').trim();
    }
    pushEnt(); flushPolyline();

    var note = (pts.length / 3) + ' vertices, ' + (tris.length / 3) + ' triangles';
    return { kind: tris.length ? 'mesh' : 'points', name: name, pts: pts, tris: tris, note: note };
  }

  /* ------------------------------------------------------ dispatch */
  function sniff(txt, fileName) {
    var ext = (fileName || '').toLowerCase().split('.').pop();
    var head = txt.substr(0, 3000);
    if (ext === 'dxf' || /^\s*0\s*[\r\n]+\s*SECTION/i.test(head) || head.indexOf('AutoCAD') >= 0 && head.indexOf('$ACADVER') >= 0) return 'dxf';
    if (isESRI(txt)) return 'esri';
    if (ext === 'dtm' && isSurpacDTM(txt)) return 'surpac-dtm';
    if (isSurpacDTM(txt)) return 'surpac-dtm';
    return 'ascii';
  }

  /* ------------------------------------------------- demo open pit */
  /** Synthetic benched open pit with a bulging failing wall. */
  function demoPit(opt) {
    opt = opt || {};
    var step = opt.step || 6;                 // sample spacing (m)
    var half = opt.half || 900;               // model half-width (m)
    var crestZ = 1000, depth = 330;
    var benchH = 15, benchW = 15;             // 45° overall
    var pts = [];
    function rnd(x, y) {                      // cheap deterministic noise
      var s = Math.sin(x * 0.013) * Math.cos(y * 0.011) + 0.5 * Math.sin(x * 0.031 + y * 0.017);
      return s;
    }
    for (var y = -half; y <= half; y += step) {
      for (var x = -half; x <= half; x += step) {
        var r = Math.sqrt(x * x + y * y);
        var th = Math.atan2(y, x);
        /* elliptical, lobed crest outline */
        var Rtop = 620 + 90 * Math.cos(th) + 55 * Math.sin(2 * th + 0.6);
        var z;
        if (r >= Rtop) {
          z = crestZ + 6 * rnd(x, y) + 0.012 * (r - Rtop);
        } else {
          var into = Rtop - r;
          var k = Math.floor(into / benchW);
          var frac = (into - k * benchW) / benchW;
          var d = k * benchH + (frac > 0.45 ? (frac - 0.45) / 0.55 * benchH : 0);
          if (d > depth) d = depth;
          z = crestZ - d;
          /* toe ramp on the floor */
          if (d >= depth) z = crestZ - depth + 0.02 * (r - 0) * 0;
          /* haul ramp spiralling on the east wall */
          var ramp = ((th + Math.PI) / (2 * Math.PI));
          var rampR = Rtop - (ramp * (Rtop - 150));
          if (Math.abs(r - rampR) < 14 && d < depth) z = crestZ - (ramp * depth) - 4;
          /* bulging unstable NE wall */
          var bx = x - 300, by = y - 320;
          var bulge = 26 * Math.exp(-(bx * bx + by * by) / (2 * 150 * 150));
          z += bulge;
          z += 1.4 * rnd(x * 1.6, y * 1.6);
        }
        pts.push(x + (opt.ox || 0), y + (opt.oy || 0), z);
      }
    }
    return {
      kind: 'points', name: 'demo-open-pit', pts: pts, tris: [],
      note: (pts.length / 3) + ' synthetic points (330 m deep pit, 15 m benches)'
    };
  }

  return {
    sniff: sniff, previewASCII: previewASCII, parseASCII: parseASCII,
    parseDXF: parseDXF, parseESRI: parseESRI, parseSurpacDTM: parseSurpacDTM,
    isSurpacDTM: isSurpacDTM, demoPit: demoPit, splitLines: splitLines
  };
})();
