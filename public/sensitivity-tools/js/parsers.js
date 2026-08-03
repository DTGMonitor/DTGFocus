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

    /* Surpac writes id, Y, X, Z, description — northing BEFORE easting.
       A .str, or any file still carrying the OBJECT/TRISOLATION markers,
       is a Surpac product and uses that order. */
    var surpacOrder = (ext === 'str') || isSurpacDTM(txt);
    if (surpacOrder && numCols.length >= 4) g = { x: numCols[2], y: numCols[1], z: numCols[3] };
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
    var pts = [], maxc = Math.max(xc, yc, zc);
    /* keep a reason for every rejected line so a zero-point result can explain itself */
    var d = { lines: 0, blank: 0, comment: 0, tooFewCols: 0, notNumeric: 0, zeroSentinel: 0, sample: '', cols: 0 };
    for (var i = map.skip | 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L) { d.blank++; continue; }
      var s = L.trim();
      if (!s) { d.blank++; continue; }
      if (s[0] === '#' || s[0] === '!' || s[0] === '*') { d.comment++; continue; }
      d.lines++;
      var f = splitBy(s, delim);
      if (f.length > d.cols) d.cols = f.length;
      if (f.length <= maxc) {
        d.tooFewCols++; if (!d.sample) d.sample = s.slice(0, 90);
        continue;
      }
      var x = parseFloat(f[xc]), y = parseFloat(f[yc]), z = parseFloat(f[zc]);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
        d.notNumeric++; if (!d.sample) d.sample = s.slice(0, 90);
        continue;
      }
      /* Surpac end-of-string sentinel lines */
      if (x === 0 && y === 0 && z === 0) { d.zeroSentinel++; continue; }
      pts.push(x, y, z);
    }
    d.used = pts.length / 3;
    d.delim = delim === '\t' ? 'tab' : delim === ' ' ? 'whitespace' : delim;
    var bad = d.tooFewCols + d.notNumeric;
    return {
      kind: 'points', name: name, pts: pts, tris: [], diag: d,
      note: d.used + ' points' + (bad ? ', ' + bad + ' lines skipped' : '')
    };
  }

  /** human-readable reason a text file yielded nothing */
  function explainEmpty(d, map) {
    if (!d) return '';
    if (!d.lines) return 'The file contains no data lines after the ' + (map.skip | 0) + ' skipped rows.';
    var t = ['Read <b>' + d.lines + '</b> data lines with delimiter “' + d.delim + '” (' +
      d.cols + ' columns detected), but none produced a coordinate:'];
    if (d.tooFewCols) t.push('· <b>' + d.tooFewCols + '</b> lines had fewer columns than the X/Y/Z you picked');
    if (d.notNumeric) t.push('· <b>' + d.notNumeric + '</b> lines had non-numeric text in those columns');
    if (d.zeroSentinel) t.push('· ' + d.zeroSentinel + ' were 0,0,0 end-of-string markers');
    if (d.sample) t.push('First rejected line:<br><code>' + d.sample.replace(/</g, '&lt;') + '</code>');
    t.push('Check the X / Y / Z column pickers against the preview table.');
    return t.join('<br>');
  }

  /**
   * Text readers cannot help with a binary file. Control characters and U+FFFD
   * replacement marks (produced when readAsText hits invalid UTF-8) give it away.
   */
  function looksBinary(txt) {
    var n = Math.min(txt.length, 4096), bad = 0;
    if (!n) return false;
    for (var i = 0; i < n; i++) {
      var c = txt.charCodeAt(i);
      if (c === 0 || c === 0xFFFD || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
    }
    return bad / n > 0.02;
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

  /**
   * Not every .dtm is an index file. Surpac writes node numbers as bare
   * integers (`1, 4, 5, 12, ...`) while coordinates always carry decimals
   * (`1, 7458100.000, 512200.000, 1035.500`). Sample the records and decide,
   * so a coordinate-bearing .dtm is read as XYZ text instead of nonsense
   * triangles.
   */
  function dtmRecordsAreIndices(txt) {
    var lines = splitLines(txt.substr(0, 400000));
    var started = false, tot = 0, dotted = 0, big = 0;
    for (var i = 0; i < lines.length && tot < 300; i++) {
      var s = lines[i].trim();
      if (!s) continue;
      var up = s.toUpperCase();
      if (up.indexOf('TRISOLATION') === 0 || up.indexOf('OBJECT') === 0) { started = true; continue; }
      if (!started) continue;
      var f = s.split(',');
      if (f.length < 4) continue;
      if (!isNum(f[0]) || !isNum(f[1]) || !isNum(f[2]) || !isNum(f[3])) continue;
      tot++;
      if (/\./.test(f[1]) || /\./.test(f[2]) || /\./.test(f[3])) dotted++;
      /* node numbers below ~50 million; eastings/northings routinely exceed it */
      if (Math.abs(parseFloat(f[1])) > 5e7 || Math.abs(parseFloat(f[2])) > 5e7) big++;
    }
    if (!tot) return true;                       // nothing to judge — keep old behaviour
    return (dotted / tot < 0.5) && (big / tot < 0.5);
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

  /* ---------------------------------------------------------- DXF
     Handles 3DFACE, polyface and polygon meshes, MESH, POINT, LINE,
     LWPOLYLINE, and expands BLOCK / INSERT references — mine surfaces are
     very often exported as a block instanced once, which yields nothing at
     all if INSERT is ignored. Every entity type seen is counted so a file
     that produces no geometry can say what it does contain.
     ------------------------------------------------------------------- */
  /* ---- binary DXF -------------------------------------------------------
     Same group-code/value stream as ASCII DXF, but packed: a 22-byte
     sentinel, then a 1-byte code (0xFF escapes a 2-byte code) followed by a
     value whose width depends on the code. Reusing the ASCII entity state
     machine means both dialects build geometry through one code path.
     -------------------------------------------------------------------- */
  var BIN_SENTINEL = 'AutoCAD Binary DXF';

  function isBinaryDXF(buf) {
    if (!buf || buf.byteLength < 22) return false;
    var b = new Uint8Array(buf, 0, BIN_SENTINEL.length), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s === BIN_SENTINEL;
  }

  /** value width for a binary group code */
  function binType(code) {
    if (code < 10) return 's';
    if (code < 60) return 'd';
    if (code < 90) return 'i16';
    if (code < 100) return 'i32';
    if (code < 110) return 's';
    if (code < 160) return 'd';
    if (code < 170) return 'i64';
    if (code < 210) return 'i16';
    if (code < 240) return 'd';
    if (code < 260) return 'i16';
    if (code < 270) return 'd';
    if (code < 290) return 'i16';
    if (code < 300) return 'i8';
    if (code < 310) return 's';
    if (code < 320) return 'chunk';
    if (code < 370) return 's';
    if (code < 390) return 'i16';
    if (code < 400) return 's';
    if (code < 410) return 'i16';
    if (code < 420) return 's';
    if (code < 430) return 'i32';
    if (code < 440) return 's';
    if (code < 460) return 'i32';
    if (code < 470) return 'd';
    if (code < 480) return 's';
    if (code < 1010) return 's';
    if (code < 1060) return 'd';
    if (code < 1071) return 'i16';
    if (code === 1071) return 'i32';
    return 's';
  }

  /** returns iterate(cb) over (code, value) pairs of a binary DXF */
  function binaryDXFTags(buf) {
    return function (cb) {
      var dv = new DataView(buf), n = buf.byteLength;
      var p = 22;                                   // past the sentinel
      while (p < n) {
        var code = dv.getUint8(p); p += 1;
        if (code === 255) {
          if (p + 2 > n) break;
          code = dv.getInt16(p, true); p += 2;
        }
        var t = binType(code), v;
        if (t === 's') {
          var s = '';
          while (p < n) {
            var ch = dv.getUint8(p); p += 1;
            if (ch === 0) break;
            s += String.fromCharCode(ch);
          }
          v = s;
        } else if (t === 'd') {
          if (p + 8 > n) break;
          v = dv.getFloat64(p, true); p += 8;
        } else if (t === 'i16') {
          if (p + 2 > n) break;
          v = dv.getInt16(p, true); p += 2;
        } else if (t === 'i32') {
          if (p + 4 > n) break;
          v = dv.getInt32(p, true); p += 4;
        } else if (t === 'i64') {
          if (p + 8 > n) break;
          v = dv.getInt32(p, true); p += 8;         // low word is plenty here
        } else if (t === 'i8') {
          if (p + 1 > n) break;
          v = dv.getUint8(p); p += 1;
        } else {                                     // binary chunk
          if (p + 1 > n) break;
          var len = dv.getUint8(p); p += 1 + len;
          v = '';
        }
        cb(code, v);
      }
    };
  }

  function parseBinaryDXF(buf, name) {
    return dxfFromTags(binaryDXFTags(buf), name, true);
  }

  /* ---- streaming ASCII DXF ---------------------------------------------
     A JS string tops out near 512 M characters, and splitting one into a
     line array costs several times the file again. Mine-wide DXFs run to
     hundreds of megabytes, so walk the bytes directly: numbers are parsed
     from the raw digits and only genuinely textual values become strings.
     -------------------------------------------------------------------- */
  function numFromBytes(b, s, e) {
    while (s < e && (b[s] === 32 || b[s] === 9)) s++;
    var neg = false;
    if (s < e && (b[s] === 45 || b[s] === 43)) { neg = b[s] === 45; s++; }
    var v = 0, seen = false, c;
    while (s < e && (c = b[s]) >= 48 && c <= 57) { v = v * 10 + (c - 48); s++; seen = true; }
    if (s < e && b[s] === 46) {
      s++;
      var f = 0.1;
      while (s < e && (c = b[s]) >= 48 && c <= 57) { v += (c - 48) * f; f *= 0.1; s++; seen = true; }
    }
    if (!seen) return NaN;
    if (s < e && (b[s] === 101 || b[s] === 69)) {
      s++;
      var eneg = false;
      if (s < e && (b[s] === 45 || b[s] === 43)) { eneg = b[s] === 45; s++; }
      var ex = 0;
      while (s < e && (c = b[s]) >= 48 && c <= 57) { ex = ex * 10 + (c - 48); s++; }
      v *= Math.pow(10, eneg ? -ex : ex);
    }
    return neg ? -v : v;
  }

  function strFromBytes(b, s, e) {
    while (s < e && (b[s] === 32 || b[s] === 9)) s++;
    while (e > s && (b[e - 1] === 32 || b[e - 1] === 9 || b[e - 1] === 13)) e--;
    if (e <= s) return '';
    if (e - s > 4096) e = s + 4096;
    return String.fromCharCode.apply(null, b.subarray(s, e));
  }

  /** returns iterate(cb) over an ASCII DXF held as bytes */
  function asciiDXFTagsFromBytes(buf) {
    return function (cb) {
      var b = new Uint8Array(buf), n = b.length, i = 0;
      /* [start,end) of the next line, EOL consumed; returns false at the end */
      var ls = 0, le = 0;
      function nextLine() {
        if (i >= n) return false;
        ls = i;
        while (i < n && b[i] !== 10 && b[i] !== 13) i++;
        le = i;
        if (i < n && b[i] === 13) i++;
        if (i < n && b[i] === 10) i++;
        return true;
      }
      while (nextLine()) {
        /* code line: integer, possibly right-justified with spaces */
        var s = ls, e = le;
        while (s < e && (b[s] === 32 || b[s] === 9)) s++;
        while (e > s && (b[e - 1] === 32 || b[e - 1] === 9)) e--;
        if (e <= s) continue;                       // blank — resync
        var neg = false, c0 = b[s];
        if (c0 === 45 || c0 === 43) { neg = c0 === 45; s++; }
        var code = 0, digits = 0, ok = true;
        for (var k = s; k < e; k++) {
          var c = b[k];
          if (c < 48 || c > 57) { ok = false; break; }
          code = code * 10 + (c - 48); digits++;
        }
        if (!ok || !digits) continue;               // not a code line — resync
        if (neg) code = -code;
        if (!nextLine()) break;                     // value line
        cb(code, binType(code) === 's'
          ? strFromBytes(b, ls, le)
          : numFromBytes(b, ls, le));
      }
    };
  }

  /**
   * Welding shared vertices makes a tidier mesh, but the lookup table costs
   * far more than the duplicated coordinates it saves — and a 3DFACE list
   * repeats every vertex anyway. Past a threshold, skip it: the gridder does
   * not care whether triangles share vertices.
   */
  var WELD_LIMIT_BYTES = 64 * 1024 * 1024;

  function parseDXFBuffer(buf, name) {
    var weld = buf.byteLength < WELD_LIMIT_BYTES;
    if (isBinaryDXF(buf)) return dxfFromTags(binaryDXFTags(buf), name, true, weld);
    return dxfFromTags(asciiDXFTagsFromBytes(buf), name, false, weld);
  }

  /** ArrayBuffer → text, tolerating invalid bytes */
  function decodeText(buf) {
    if (typeof TextDecoder === 'function') {
      return new TextDecoder('utf-8', { fatal: false }).decode(buf);
    }
    var b = new Uint8Array(buf), s = '', CH = 0x8000;
    for (var i = 0; i < b.length; i += CH) {
      s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    }
    return s;
  }

  function parseDXF(txt, name) {
    var lines = splitLines(txt);
    /**
     * Codes and values alternate, but a fixed stride of two desynchronises
     * permanently on a single stray or blank line — and then every code is
     * read from a value line and the rest of the file is lost. Scan for the
     * next line that parses as an integer code instead, and take the line
     * after it verbatim as the value (which may legitimately be empty).
     */
    return dxfFromTags(function (cb) {
      var i = 0, n = lines.length;
      while (i < n) {
        var t = lines[i].trim(); i++;
        if (t === '') continue;                     // blank between records
        var code = parseInt(t, 10);
        if (isNaN(code) || !/^[-+]?\d+$/.test(t)) continue;   // resync
        if (i >= n) break;
        cb(code, lines[i]); i++;
      }
    }, name, false);
  }

  /** the shared entity state machine — fed by either dialect */
  function dxfFromTags(iterate, name, isBin, weld) {
    var counts = Object.create(null);
    if (weld === undefined) weld = true;

    function newSink() {
      return {
        pts: [], tris: [], inserts: [], base: [0, 0, 0],
        map: weld ? Object.create(null) : null
      };
    }
    /* Welding vertices keeps the mesh small, but the lookup table costs more
       than the geometry on a huge file. Past the cap, stop welding and just
       append — duplicated vertices are harmless to the gridder. */
    var WELD_CAP = 2000000;
    function vid(s, x, y, z) {
      if (s.map === null) {
        var j = s.pts.length / 3;
        s.pts.push(x, y, z);
        return j;
      }
      var k = x.toFixed(3) + '|' + y.toFixed(3) + '|' + z.toFixed(3);
      var i = s.map[k];
      if (i !== undefined) return i;
      i = s.pts.length / 3;
      s.pts.push(x, y, z);
      if (i < WELD_CAP) s.map[k] = i; else s.map = null;
      return i;
    }
    function num(v) { var f = parseFloat(v); return isFinite(f) ? f : 0; }

    var main = newSink(), sink = main;
    var blocks = Object.create(null);
    var ent = null, entName = '';
    var plActive = false, plFlags = 0, plM = 0, plN = 0, plVerts = [], plFaces = [];

    function tri(s, a, b, c) {
      if (a === undefined || b === undefined || c === undefined) return;
      if (a === b || b === c || a === c) return;
      s.tris.push(a, b, c);
    }

    function pushEnt() {
      if (!ent) return;
      var E = entName, k;
      if (E === '3DFACE' || E === 'SOLID' || E === 'TRACE') {
        var x1 = num(ent[10]), y1 = num(ent[20]), z1 = num(ent[30]);
        var x3 = num(ent[12]), y3 = num(ent[22]), z3 = num(ent[32]);
        var has4 = ent[13] !== undefined;
        var x4 = has4 ? num(ent[13]) : x3, y4 = has4 ? num(ent[23]) : y3,
            z4 = has4 ? num(ent[33]) : z3;
        var a = vid(sink, x1, y1, z1);
        var b = vid(sink, num(ent[11]), num(ent[21]), num(ent[31]));
        var c = vid(sink, x3, y3, z3);
        tri(sink, a, b, c);
        /* A triangular 3DFACE still writes four corners, padding the fourth by
           repeating one of the others. The spec says repeat the third, but real
           exporters repeat the first (Gem4D pit surfaces do). Either way there
           is no second triangle. Compare coordinates rather than vertex indices,
           because welding — which used to collapse the repeat — may be off. */
        var padded = (x4 === x3 && y4 === y3 && z4 === z3) ||
                     (x4 === x1 && y4 === y1 && z4 === z1);
        if (!padded) tri(sink, a, c, vid(sink, x4, y4, z4));
      } else if (E === 'POINT') {
        vid(sink, num(ent[10]), num(ent[20]), num(ent[30]));
      } else if (E === 'LINE') {
        vid(sink, num(ent[10]), num(ent[20]), num(ent[30]));
        vid(sink, num(ent[11]), num(ent[21]), num(ent[31]));
      } else if (E === 'LWPOLYLINE') {
        var xs = ent.__x || [], ys = ent.__y || [], el = ent[38] !== undefined ? num(ent[38]) : 0;
        for (k = 0; k < Math.min(xs.length, ys.length); k++) vid(sink, xs[k], ys[k], el);
      } else if (E === 'MESH') {
        flushMesh();
      } else if (E === 'INSERT') {
        sink.inserts.push({
          name: (ent[2] || '').toUpperCase(),
          x: num(ent[10]), y: num(ent[20]), z: num(ent[30]),
          sx: ent[41] !== undefined ? num(ent[41]) : 1,
          sy: ent[42] !== undefined ? num(ent[42]) : 1,
          sz: ent[43] !== undefined ? num(ent[43]) : 1,
          rot: (ent[50] !== undefined ? num(ent[50]) : 0) * Math.PI / 180
        });
      } else if (E === 'BLOCK') {
        var bn = (ent[2] || '').toUpperCase();
        blocks[bn] = newSink();
        blocks[bn].base = [num(ent[10]), num(ent[20]), num(ent[30])];
        sink = blocks[bn];
      } else if (E === 'ENDBLK') {
        sink = main;
      } else if (E === 'POLYLINE') {
        plActive = true;
        plFlags = ent[70] !== undefined ? parseInt(ent[70], 10) : 0;
        plM = ent[71] !== undefined ? parseInt(ent[71], 10) : 0;
        plN = ent[72] !== undefined ? parseInt(ent[72], 10) : 0;
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

    /** AutoCAD MESH: 92 = vertex count, then 10/20/30; 93 = face-list size, then 90s */
    function flushMesh() {
      var xs = ent.__x || [], ys = ent.__y || [], zs = ent.__z || [], fl = ent.__f || [];
      var nv = ent[92] !== undefined ? parseInt(ent[92], 10) : xs.length;
      var verts = [];
      for (var k = 0; k < Math.min(nv, xs.length, ys.length, zs.length); k++) {
        verts.push(vid(sink, xs[k], ys[k], zs[k]));
      }
      var nf = ent[93] !== undefined ? parseInt(ent[93], 10) : fl.length;
      var p = 0, lim = Math.min(nf, fl.length);
      while (p < lim) {
        var cnt = fl[p++];
        if (!(cnt >= 3) || p + cnt > fl.length) break;
        for (var f = 1; f < cnt - 1; f++) {
          tri(sink, verts[fl[p]], verts[fl[p + f]], verts[fl[p + f + 1]]);
        }
        p += cnt;
      }
    }

    function flushPolyline() {
      if (!plActive) return;
      var idx = plVerts.map(function (v) { return vid(sink, v[0], v[1], v[2]); });
      if (plFaces.length) {
        /* polyface mesh: explicit face records */
        for (var f = 0; f < plFaces.length; f++) {
          var q = plFaces[f].map(function (v) { return Math.abs(v) - 1; });
          var a = idx[q[0]], b = idx[q[1]], c = idx[q[2]], d = q[3] >= 0 ? idx[q[3]] : undefined;
          tri(sink, a, b, c);
          if (d !== undefined) tri(sink, a, c, d);
        }
      } else if ((plFlags & 16) && plM > 1 && plN > 1 && idx.length >= plM * plN) {
        /* 3D polygon mesh: M x N grid of vertices in row-major order */
        for (var m = 0; m < plM - 1; m++) {
          for (var n2 = 0; n2 < plN - 1; n2++) {
            var i0 = idx[m * plN + n2], i1 = idx[m * plN + n2 + 1];
            var i2 = idx[(m + 1) * plN + n2 + 1], i3 = idx[(m + 1) * plN + n2];
            tri(sink, i0, i1, i2); tri(sink, i0, i2, i3);
          }
        }
      }
      plActive = false; plVerts = []; plFaces = [];
    }

    iterate(function (code, val) {
      if (code === 0) {
        pushEnt();
        var nm = String(val == null ? '' : val).trim().toUpperCase();
        counts[nm] = (counts[nm] || 0) + 1;
        if (nm === 'SECTION' || nm === 'ENDSEC' || nm === 'EOF') { entName = ''; ent = null; return; }
        entName = nm; ent = Object.create(null);
        if (nm !== 'VERTEX' && nm !== 'SEQEND' && plActive) flushPolyline();
        return;
      }
      if (!ent) return;
      if (entName === 'LWPOLYLINE') {
        if (code === 10) { (ent.__x = ent.__x || []).push(num(val)); return; }
        if (code === 20) { (ent.__y = ent.__y || []).push(num(val)); return; }
      }
      if (entName === 'MESH') {
        if (code === 10) { (ent.__x = ent.__x || []).push(num(val)); return; }
        if (code === 20) { (ent.__y = ent.__y || []).push(num(val)); return; }
        if (code === 30) { (ent.__z = ent.__z || []).push(num(val)); return; }
        if (code === 90) { (ent.__f = ent.__f || []).push(parseInt(val, 10) || 0); return; }
      }
      if (ent[code] === undefined) {
        ent[code] = (typeof val === 'string') ? val.trim() : val;
      }
    });
    pushEnt(); flushPolyline();

    /* ---- resolve block references ---- */
    function appendTransformed(out, src, ins, base) {
      var o = out.pts.length / 3;
      var c = Math.cos(ins.rot), s = Math.sin(ins.rot);
      for (var k = 0; k < src.pts.length; k += 3) {
        var x = (src.pts[k] - base[0]) * ins.sx;
        var y = (src.pts[k + 1] - base[1]) * ins.sy;
        var z = (src.pts[k + 2] - base[2]) * ins.sz;
        out.pts.push(ins.x + x * c - y * s, ins.y + x * s + y * c, ins.z + z);
      }
      for (var t = 0; t < src.tris.length; t++) out.tris.push(src.tris[t] + o);
    }
    function flatten(bn, depth) {
      var b = blocks[bn];
      if (!b) return null;
      if (b.flat) return b.flat;
      var out = { pts: b.pts.slice(), tris: b.tris.slice() };
      b.flat = out;                                    // set first: guards cycles
      if (depth < 5) {
        for (var q = 0; q < b.inserts.length; q++) {
          var ins = b.inserts[q];
          if (ins.name === bn) continue;
          var inner = flatten(ins.name, depth + 1);
          if (inner) appendTransformed(out, inner, ins, blocks[ins.name].base);
        }
      }
      return out;
    }
    var expanded = 0;
    for (var q2 = 0; q2 < main.inserts.length; q2++) {
      var ins2 = main.inserts[q2];
      var blk = flatten(ins2.name, 0);
      if (blk && (blk.pts.length || blk.tris.length)) {
        appendTransformed(main, blk, ins2, blocks[ins2.name].base);
        expanded++;
      }
    }

    var note = (isBin ? 'binary DXF · ' : '') +
      (main.pts.length / 3) + ' vertices, ' + (main.tris.length / 3) + ' triangles' +
      (expanded ? ', ' + expanded + ' block insert' + (expanded === 1 ? '' : 's') + ' expanded' : '');
    return {
      kind: main.tris.length ? 'mesh' : 'points', name: name,
      pts: main.pts, tris: main.tris, note: note, binary: !!isBin,
      counts: counts, nInserts: main.inserts.length, nBlocks: Object.keys(blocks).length
    };
  }

  /** what a DXF actually contains, for when it yields no geometry */
  function explainDXF(ds) {
    var c = ds && ds.counts;
    if (!c) return '';
    var skip = { SECTION: 1, ENDSEC: 1, EOF: 1, TABLE: 1, ENDTAB: 1, CLASS: 1, BLOCK: 1, ENDBLK: 1 };
    var list = [];
    Object.keys(c).forEach(function (k) { if (!skip[k]) list.push([k, c[k]]); });
    list.sort(function (a, b) { return b[1] - a[1]; });
    if (!list.length) return 'The file has no entities at all — it may be a header-only or truncated export.';
    var top = list.slice(0, 8).map(function (e) { return e[0] + ' × ' + e[1].toLocaleString(); });
    var msg = 'The DXF parsed but produced no coordinates. It contains: <b>' + top.join('</b>, <b>') + '</b>.';
    if (c.INSERT && !ds.pts.length) msg += '<br>It is built from <b>block references</b> whose blocks hold no ' +
      'usable geometry — in your CAD package, <b>explode</b> the blocks and export again.';
    if (c['3DSOLID'] || c.BODY || c.REGION || c.SURFACE) msg += '<br>It holds <b>ACIS solids</b> ' +
      '(3DSOLID/BODY/REGION), which are a proprietary binary blob no DXF reader can triangulate. ' +
      'Convert the surface to a mesh or TIN before exporting.';
    if (c.SPLINE || c.ARC || c.CIRCLE || c.TEXT || c.MTEXT || c.DIMENSION) msg += '<br>Entities like ' +
      'SPLINE, ARC, TEXT and DIMENSION carry no surface — export the triangulation itself ' +
      '(3D faces or a mesh), not the drawing annotation.';
    return msg;
  }

  /* ------------------------------------------------------ dispatch */
  function sniff(txt, fileName) {
    var ext = (fileName || '').toLowerCase().split('.').pop();
    var head = txt.substr(0, 3000);
    if (looksBinary(head)) return 'binary';
    if (ext === 'dxf' || /^\s*0\s*[\r\n]+\s*SECTION/i.test(head) || head.indexOf('AutoCAD') >= 0 && head.indexOf('$ACADVER') >= 0) return 'dxf';
    if (isESRI(txt)) return 'esri';
    /* a .dtm whose records are coordinates, not node numbers, is really ASCII */
    if (isSurpacDTM(txt)) return dtmRecordsAreIndices(txt) ? 'surpac-dtm' : 'ascii';
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
    isBinaryDXF: isBinaryDXF, parseBinaryDXF: parseBinaryDXF, decodeText: decodeText,
    parseDXFBuffer: parseDXFBuffer,
    isSurpacDTM: isSurpacDTM, dtmRecordsAreIndices: dtmRecordsAreIndices,
    looksBinary: looksBinary, explainEmpty: explainEmpty, explainDXF: explainDXF,
    demoPit: demoPit, splitLines: splitLines
  };
})();
