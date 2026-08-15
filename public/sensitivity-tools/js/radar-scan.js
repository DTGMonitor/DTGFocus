/* ============================================================
   radar-scan.js — read a slope-monitoring radar deformation export.

   The radar writes one CSV per scan window: a complete front-view
   raster, one row per pixel, in scan order.

     Index, Easting, Northing, Elevation, X, Y, Deformation (mm), Range (m)

   Two coordinate systems live in that file and they must not be confused:

     X, Y                      integer pixel column/row of the front-view
                               image, 1-based, a full nx x ny grid with no
                               gaps — this is the *image*.
     Easting/Northing/Elevation
                               metres in a RADAR-LOCAL Cartesian frame whose
                               origin is the sensor head. Range is exactly
                               hypot(E,N,Elev), which is what proves the
                               origin is the sensor and not the mine grid.

   So the numbers are internally consistent — the shape of the scan is
   correct to the millimetre — but the frame is only as good as the radar's
   own idea of where it is standing and which way it is looking. Placing the
   scan on the mine grid is therefore a *rigid* transform (see georef.js),
   never a warp: the geometry is already right, only the pose is wrong.

   Grid convention matches grid.js: index = (y-1)*nx + (x-1), x fastest.
   ============================================================ */
'use strict';

var RadarScan = (function () {

  /* ---------------------------------------------- filename -> identity */

  /* <RADAR>_<YYMMDD>_<WALL FOLDER>_<DDMMYYYY>_<HHMM>_<DDMMYYYY>_<HHMM>
     e.g. SSR535_260808_HVM_HVK7_East_Wall-1_15082026_1838_16082026_0136

     The wall-folder name is operator-typed and contains both underscores and
     digits, so it cannot be found by counting fields from the left. The two
     trailing date-time pairs are the only fixed-width anchor, so the split is
     made from the END: `.+` is greedy and `$` pins the tail, which makes the
     engine give up the RIGHTMOST valid split — the real scan window even when
     the folder name itself ends in something digit-shaped. */
  var NAME_RE = /^(.+)_(\d{8})_(\d{4})_(\d{8})_(\d{4})$/;

  /* Inside the key: radar number, the folder's own commencement date, name. */
  var KEY_RE = /^([A-Za-z]+[0-9]+)_(\d{6})_(.+)$/;

  /* DDMMYYYY + HHMM -> Date. Built in UTC on purpose: these stamps carry no
     zone, and the only thing the tool does with them is sort and display, so a
     fixed frame beats one that shifts under the reader's own DST. */
  function stampToDate(ddmmyyyy, hhmm) {
    var d = +ddmmyyyy.slice(0, 2),
        m = +ddmmyyyy.slice(2, 4),
        y = +ddmmyyyy.slice(4, 8),
        hh = +hhmm.slice(0, 2),
        mm = +hhmm.slice(2, 4);
    if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
    var t = new Date(Date.UTC(y, m - 1, d, hh, mm));
    /* Rejects 31/02 and friends, which Date.UTC would silently roll over. */
    if (t.getUTCDate() !== d || t.getUTCMonth() !== m - 1) return null;
    return t;
  }

  /**
   * Split a scan filename into the wall-folder identity and its time window.
   *
   * `key` is everything before the trailing date-time pair — the value that
   * makes two scans "the same wall folder", and therefore the value a saved
   * georeference is filed under so the next upload auto-applies.
   *
   * Returns null if the name does not carry a window, so callers can tell a
   * radar export from any other CSV the user drags in.
   */
  function parseName(filename) {
    var base = String(filename).replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
    var m = NAME_RE.exec(base);
    if (!m) return null;

    var startAt = stampToDate(m[2], m[3]);
    var endAt = stampToDate(m[4], m[5]);
    if (!startAt || !endAt) return null;

    var key = m[1], radar = null, commenced = null, folder = key;
    var k = KEY_RE.exec(key);
    if (k) { radar = k[1]; commenced = k[2]; folder = k[3]; }

    return {
      key: key,           // wall-folder identity — the georeference is filed here
      radar: radar,       // radars.radar_number, e.g. SSR535
      commenced: commenced, // folder commencement, YYMMDD as written
      folder: folder,     // radar_wall_folders.name, e.g. HVM_HVK7_East_Wall-1
      startAt: startAt,
      endAt: endAt,
      filename: base
    };
  }

  /* ---------------------------------------------- header -> column map */

  var WANT = {
    east:  { exact: 'easting',          re: /^east(ing)?$/ },
    north: { exact: 'northing',         re: /^north(ing)?$/ },
    elev:  { exact: 'elevation',        re: /^(elev(ation)?|z|rl)$/ },
    px:    { exact: 'x',                re: /^x$/ },
    py:    { exact: 'y',                re: /^y$/ },
    def:   { exact: 'deformation (mm)', re: /deform/ },
    range: { exact: 'range (m)',        re: /^range/ }
  };

  /* The export pads every cell after the comma (",  Easting"), so trim before
     matching. Exact names win outright; the regexes only cover a firmware that
     renames a column, and are ordered so `x`/`y` can never steal Easting. */
  function mapColumns(headerCells) {
    var norm = headerCells.map(function (h) { return String(h).trim().toLowerCase(); });
    var col = {}, name;
    for (name in WANT) {
      if (!Object.prototype.hasOwnProperty.call(WANT, name)) continue;
      var i = norm.indexOf(WANT[name].exact);
      if (i < 0) {
        for (var j = 0; j < norm.length; j++) {
          if (WANT[name].re.test(norm[j])) { i = j; break; }
        }
      }
      col[name] = i;
    }
    return col;
  }

  function missingColumns(col) {
    var out = [], k;
    for (k in WANT) {
      if (Object.prototype.hasOwnProperty.call(WANT, k) && !(col[k] >= 0)) out.push(k);
    }
    return out;
  }

  /* ---------------------------------------------- CSV -> raster */

  /**
   * Parse a radar deformation CSV into a structured raster.
   *
   * Points arrive in scan order rather than row-major, and a scan may be
   * clipped, so the pixel grid is addressed through `idx` (cell -> point, -1
   * where the radar returned nothing) instead of assuming density.
   *
   * Coordinates stay in the radar-local frame — georeferencing is a separate,
   * reversible step, so the raw file is never the thing that gets edited.
   */
  function parse(text, filename) {
    var lines = String(text).split(/\r?\n/);
    var li = 0;

    while (li < lines.length && !lines[li].trim()) li++;
    if (li >= lines.length) throw new Error('empty file');

    var col = mapColumns(lines[li].split(','));
    var missing = missingColumns(col);
    if (missing.length) {
      throw new Error(
        'not a radar deformation export — missing column(s): ' + missing.join(', ')
      );
    }
    li++;

    var n = lines.length - li;
    var ex = new Float64Array(n), ny_ = new Float64Array(n), ez = new Float64Array(n);
    var def = new Float32Array(n), rng = new Float32Array(n);
    var pxa = new Int32Array(n), pya = new Int32Array(n);

    var count = 0, nx = 0, nyMax = 0, bad = 0;
    var dmin = Infinity, dmax = -Infinity;

    for (; li < lines.length; li++) {
      var line = lines[li];
      if (!line || !line.trim()) continue;
      var c = line.split(',');

      var x = c[col.px] | 0, y = c[col.py] | 0;
      var e = +c[col.east], nn = +c[col.north], z = +c[col.elev];
      var d = +c[col.def];

      /* A pixel with no return, or a truncated final line, is dropped rather
         than defaulted — a fabricated 0 mm would read as "stable ground". */
      if (!(x > 0) || !(y > 0) || !isFinite(e) || !isFinite(nn) || !isFinite(z) || !isFinite(d)) {
        bad++;
        continue;
      }

      ex[count] = e; ny_[count] = nn; ez[count] = z;
      def[count] = d;
      rng[count] = +c[col.range];
      pxa[count] = x; pya[count] = y;

      if (x > nx) nx = x;
      if (y > nyMax) nyMax = y;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
      count++;
    }

    if (!count) throw new Error('no usable rows');

    /* cell -> point lookup, so the mesher can walk the image in row-major
       order and know instantly whether a corner exists */
    var idx = new Int32Array(nx * nyMax).fill(-1);
    for (var i = 0; i < count; i++) idx[(pya[i] - 1) * nx + (pxa[i] - 1)] = i;

    var meta = parseName(filename || '') || {
      key: String(filename || 'scan').replace(/\.[^.]*$/, ''),
      radar: null, commenced: null, folder: null,
      startAt: null, endAt: null, filename: String(filename || 'scan')
    };

    return {
      meta: meta,
      nx: nx, ny: nyMax, n: count,
      x: ex.subarray(0, count),      // radar-local metres, origin = sensor head
      y: ny_.subarray(0, count),
      z: ez.subarray(0, count),
      def: def.subarray(0, count),   // mm, signed (negative = toward radar)
      range: rng.subarray(0, count), // m
      px: pxa.subarray(0, count),
      py: pya.subarray(0, count),
      idx: idx,
      defMin: dmin, defMax: dmax,
      skipped: bad
    };
  }

  /**
   * True when a dropped file looks like a radar export rather than a survey.
   * Cheap enough to run on the first few hundred bytes of a 2 MB file.
   */
  function sniff(text) {
    var head = String(text).slice(0, 400).split(/\r?\n/)[0] || '';
    var col = mapColumns(head.split(','));
    return missingColumns(col).length === 0;
  }

  return {
    parseName: parseName,
    parse: parse,
    sniff: sniff,
    _mapColumns: mapColumns   // exported for tests
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RadarScan;
