/* ============================================================
   radar-ui.js — the radar deformation workflow.

   Attaches through window.SensiMap rather than living inside ui.js, so the
   core tool stays readable and this whole feature can be reasoned about (or
   removed) in one file.

   The workflow it implements:

     drop a scan  ->  its wall folder is recognised from the filename
                  ->  if that folder already has a georeference, the scan is
                      placed immediately and the operator does nothing
                  ->  otherwise they tie it down by hand, once, and every
                      later scan of that folder is placed for free

   Tie-pointing is done against the FRONT VIEW, not the 3-D scene: before it is
   georeferenced a scan has no position, so there is nothing in 3-D to click.
   The front view is the one place the scan definitely exists, and it is also
   how the operator already reads these images.
   ============================================================ */
'use strict';

var RadarUI = (function () {

  var $ = function (id) { return document.getElementById(id); };

  var SCALE_KEY = 'sensimap.radarScale.v1';

  var S = {
    folders: Object.create(null),   // key -> folder record
    order: [],                      // keys, newest activity first
    /* Symmetric by construction: one limit sets both ends, so the middle
       colour is always 0 mm. 5 mm is the default the crews read; 0 = auto. */
    limit: 5,
    alpha: 1,
    /* Project each pixel down its sight line onto the survey surface, so the
       drape cannot float above or sink into the terrain. */
    drape: true,
    stops: ScanLayer.defaultStops(),
    bands: 0,
    gamma: 1,
    gr: null,                       // active georeference session
    booted: false
  };

  /* ---------------------------------------------- colour scale */

  /* A tuned scale is a per-operator preference, not a per-session one — having
     to rebuild it on every reload is what stops people tuning it at all. */
  function loadScale() {
    try {
      var raw = JSON.parse(localStorage.getItem(SCALE_KEY) || 'null');
      if (!raw) return;
      if (raw.stops && raw.stops.length >= 2) S.stops = raw.stops;
      if (isFinite(raw.limit) && raw.limit >= 0) S.limit = raw.limit;
      if (isFinite(raw.bands)) S.bands = raw.bands;
      if (isFinite(raw.gamma) && raw.gamma > 0) S.gamma = raw.gamma;
      if (isFinite(raw.alpha) && raw.alpha > 0) S.alpha = raw.alpha;
      if (typeof raw.drape === 'boolean') S.drape = raw.drape;
    } catch (e) { /* a corrupt preference is not worth failing the tool over */ }
  }

  function saveScale() {
    try {
      localStorage.setItem(SCALE_KEY, JSON.stringify({
        stops: S.stops, limit: S.limit, bands: S.bands, gamma: S.gamma,
        alpha: S.alpha, drape: S.drape
      }));
    } catch (e) { /* private browsing, quota — the scale still works this session */ }
  }

  function rampLut() {
    return ScanLayer.lut(S.stops, { bands: S.bands, gamma: S.gamma });
  }

  /** Redraw everything the scale touches: the drapes, the bar, the front view. */
  function applyScale() {
    saveScale();
    recolourAll();
    drawBar();
    renderStopsNote();
    if (S.gr) drawFrontView();
  }

  function drawBar() {
    var cv = $('radarBar');
    if (!cv) return;
    var w = cv.clientWidth || 260;
    cv.width = w;
    var ctx = cv.getContext('2d');
    var L = rampLut();
    for (var x = 0; x < w; x++) {
      var c = ColorMaps.sample(L, w === 1 ? 0 : x / (w - 1));
      ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx.fillRect(x, 0, 1, cv.height);
    }
    var lim = effectiveLimit();
    $('radarBarMin').textContent = lim ? '−' + mm(lim) : '−auto';
    $('radarBarMax').textContent = lim ? '+' + mm(lim) : '+auto';
  }

  /* A round limit reads better without a decimal point; a sub-millimetre one
     is meaningless without it. */
  function mm(v) {
    if (!isFinite(v)) return '—';
    return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
  }

  /* What the scale actually spans right now: the typed limit, or — on auto —
     the widest limit any loaded scan resolved to, so the bar never claims a
     range the drapes are not using. */
  function effectiveLimit() {
    if (S.limit > 0) return S.limit;
    var lim = 0;
    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      for (var j = 0; j < f.scans.length; j++) {
        if (f.scans[j].dom && f.scans[j].dom.limit > lim) lim = f.scans[j].dom.limit;
      }
    }
    return lim;
  }

  function renderStops() {
    var box = $('radarStops');
    if (!box) return;
    box.innerHTML = '';

    S.stops.forEach(function (stop, i) {
      var row = document.createElement('div');
      row.className = 'stopRow';
      row.innerHTML =
        '<input type="color" value="' + stop[1] + '">' +
        '<input type="number" min="0" max="1" step="0.01" value="' + (+stop[0]).toFixed(2) + '">' +
        '<div class="bar"></div><button class="rm" title="remove">✕</button>';
      var ci = row.children[0], pi = row.children[1], bar = row.children[2];
      bar.style.background = stop[1];

      ci.oninput = function () {
        stop[1] = ci.value; bar.style.background = ci.value; applyScale();
      };
      pi.onchange = function () {
        var v = parseFloat(pi.value);
        stop[0] = Math.max(0, Math.min(1, isFinite(v) ? v : 0));
        S.stops.sort(function (a, b) { return a[0] - b[0]; });
        renderStops(); applyScale();
      };
      row.children[3].onclick = function () {
        /* Two stops is the least a gradient can be made of. */
        if (S.stops.length <= 2) return;
        S.stops.splice(i, 1); renderStops(); applyScale();
      };
      box.appendChild(row);
    });

    var note = document.createElement('div');
    note.id = 'radarStopNote';
    note.className = 'dim';
    note.style.cssText = 'font-size:10px;margin-top:2px';
    box.appendChild(note);
    renderStopsNote();
  }

  /* The position column runs 0..1 across the ramp; say what that means in
     millimetres, because the operator thinks in mm and 0.5 is the one that
     matters — it is where "no movement" sits. */
  function renderStopsNote() {
    var note = $('radarStopNote');
    if (!note) return;
    var lim = effectiveLimit();
    note.textContent = lim
      ? 'Position 0 = −' + mm(lim) + ' mm · 0.5 = 0 mm · 1 = +' + mm(lim) + ' mm'
      : 'Position 0.5 is 0 mm — the ends follow the auto range.';
  }

  /* folder = { key, meta, transform, record, scans: [scanRec], registered }
     scanRec = { id, scan, mesh, cidx, visible, dom } */

  /* ---------------------------------------------- small helpers */

  function fmtWindow(meta) {
    if (!meta.startAt) return meta.filename || '—';
    return stamp(meta.startAt) + '  →  ' + stamp(meta.endAt);
  }
  function stamp(d) {
    if (!d) return '—';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v, d) { return (v == null || !isFinite(v)) ? '—' : (+v).toFixed(d == null ? 1 : d); }
  function status(m) { if (window.SensiMap) SensiMap.status(m); }
  function viewer() { return window.SensiMap ? SensiMap.viewer() : null; }

  /* Newest scan window in a folder — the sort key everywhere a list of folders
     or scans is shown, because "what moved most recently" is the question. */
  function newestAt(folder) {
    var t = 0;
    for (var i = 0; i < folder.scans.length; i++) {
      var e = folder.scans[i].scan.meta.endAt;
      if (e && +e > t) t = +e;
    }
    if (!t && folder.record && folder.record.scans) {
      for (var j = 0; j < folder.record.scans.length; j++) {
        var v = Date.parse(folder.record.scans[j].endAt);
        if (v > t) t = v;
      }
    }
    return t;
  }

  function sortFolders() {
    S.order.sort(function (a, b) { return newestAt(S.folders[b]) - newestAt(S.folders[a]); });
  }

  /* ---------------------------------------------- taking a file */

  /**
   * Called by ui.js when a dropped CSV sniffs as a radar export.
   * Parsing is synchronous and quick (a few ms for 25k pixels); the
   * georeference lookup is not, so placement happens in a promise.
   */
  function acceptFile(name, text) {
    var scan = RadarScan.parse(text, name);
    var key = scan.meta.key;

    var folder = S.folders[key];
    if (!folder) {
      folder = S.folders[key] = {
        key: key, meta: scan.meta, transform: null, record: null,
        scans: [], registered: false, loading: true
      };
      S.order.push(key);
    }

    /* Re-dropping the same window replaces it rather than stacking duplicates. */
    var existing = null;
    for (var i = 0; i < folder.scans.length; i++) {
      if (folder.scans[i].scan.meta.filename === scan.meta.filename) existing = folder.scans[i];
    }
    var rec = existing || { id: key + '|' + scan.meta.filename, visible: true };
    rec.scan = scan;
    if (!existing) folder.scans.push(rec);

    folder.scans.sort(function (a, b) {
      return (+b.scan.meta.endAt || 0) - (+a.scan.meta.endAt || 0);
    });

    status('Loaded ' + scan.meta.filename + ' — ' + scan.nx + '×' + scan.ny + ' pixels');
    open();
    render();

    if (folder.transform) {
      placeScan(folder, rec);
      rememberWindows(folder);   // a new window of an already-placed folder
      render();
      return;
    }

    /* First scan of this folder in this session: ask the store whether it has
       been placed before. A lookup FAILURE must not be reported as "not
       registered" — that would send the operator off to re-survey ties that
       already exist — so the two outcomes are kept distinct. */
    GeorefStore.load(key).then(function (record) {
      folder.loading = false;
      if (record) {
        var tr = Georef.deserialise(record);
        if (tr) {
          folder.transform = tr;
          folder.record = record;
          folder.registered = true;
          for (var k = 0; k < folder.scans.length; k++) placeScan(folder, folder.scans[k]);
          status('“' + folder.meta.folder + '” is already registered — scan placed automatically.');
        }
      }
      rememberWindows(folder);
      render();
    }).catch(function (e) {
      folder.loading = false;
      folder.lookupFailed = e.message || 'lookup failed';
      render();
    });
  }

  /* Keep a note of every scan window seen, so the folder list survives a
     session even though the CSVs themselves are never uploaded. */
  function rememberWindows(folder) {
    if (!folder.registered || !folder.record) return;
    var have = Object.create(null);
    var list = (folder.record.scans || []).slice();
    for (var i = 0; i < list.length; i++) have[list[i].filename] = 1;

    var added = 0;
    for (var j = 0; j < folder.scans.length; j++) {
      var m = folder.scans[j].scan.meta;
      if (have[m.filename]) continue;
      list.push({
        filename: m.filename,
        startAt: m.startAt ? m.startAt.toISOString() : null,
        endAt: m.endAt ? m.endAt.toISOString() : null
      });
      added++;
    }
    if (!added) return;

    list.sort(function (a, b) { return Date.parse(b.endAt) - Date.parse(a.endAt); });
    folder.record.scans = list.slice(0, 200);
    GeorefStore.save(folder.key, folder.record).catch(function () { /* best effort */ });
  }

  /* ---------------------------------------------- placing a scan */

  /* On auto, the tails are trimmed so one noisy pixel cannot flatten the whole
     scan to the middle of the ramp. An explicit limit is taken as written. */
  function domainFor(scan) {
    return ScanLayer.domain(scan, {
      limit: S.limit > 0 ? S.limit : 0,
      clipPercentile: S.limit > 0 ? 0 : 0.5
    });
  }

  function placeScan(folder, rec) {
    var V = viewer();
    if (!V || !folder.transform) return;

    rec.dom = domainFor(rec.scan);

    /* Projecting onto the survey surface costs a raycast per pixel, so say so
       before starting rather than appearing to hang on a 25k-pixel scan. */
    var grid = S.drape ? SensiMap.grid() : null;
    if (grid) status('Draping ' + (rec.scan.meta.folder || 'scan') + ' onto the surface…');

    rec.mesh = ScanLayer.buildMesh(rec.scan, folder.transform,
      grid ? { terrain: grid } : {});
    rec.cidx = ScanLayer.coverageIndex(rec.scan, folder.transform,
      rec.mesh.drape ? { range: rec.mesh.drape.range } : null);

    /* The offset the drape absorbed IS the georeference error, so it is
       reported rather than quietly swallowed — a clean-looking drape over a
       bad pose is exactly the thing worth catching. */
    var d = rec.mesh.drape;
    rec.drapeNote = d
      ? Math.round(100 * d.hit / rec.scan.n) + '% draped · offset ' + num(d.medianOffset, 1) + ' m'
      : null;
    if (d) {
      status('Draped ' + (rec.scan.meta.folder || 'scan') + ' — ' + rec.drapeNote +
        (d.medianOffset > 25 ? '  (large offset: check the georeference)' : ''));
    }

    var cols = ScanLayer.colours(rec.scan, rec.dom, rampLut());
    V.setScan(rec.id, rec.mesh, cols, rec.mesh.normals,
      { visible: rec.visible, alpha: S.alpha });
    V.draw();
  }

  /* Colour-only update: the geometry is untouched, so the mesh and the
     coverage index are left alone and only the colour buffer is refilled. */
  function recolourAll() {
    var V = viewer();
    if (!V) return;
    var L = rampLut();
    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      for (var j = 0; j < f.scans.length; j++) {
        var rec = f.scans[j];
        if (!rec.mesh) continue;
        rec.dom = domainFor(rec.scan);
        V.setScanColours(rec.id, ScanLayer.colours(rec.scan, rec.dom, L));
      }
    }
    V.draw();
  }

  function replaceAll() {
    var V = viewer();
    if (!V) return;
    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      if (!f.transform) continue;
      for (var j = 0; j < f.scans.length; j++) placeScan(f, f.scans[j]);
    }
  }

  /* ---------------------------------------------- georeference session */

  function startGeoref(key) {
    var folder = S.folders[key];
    if (!folder || !folder.scans.length) return;
    if (!SensiMap.grid()) {
      status('Load the survey surface first — tie points are placed on it.');
      return;
    }

    /* Re-georeferencing reopens the existing ties rather than a blank image:
       the usual reason to come back here is that one point was off, and
       re-placing all of them to fix one is what makes people avoid the job. */
    var prior = [];
    if (folder.record && folder.record.ties) {
      for (var i = 0; i < folder.record.ties.length; i++) {
        var t = folder.record.ties[i];
        if (!t.src || !t.dst || t.px == null) continue;
        prior.push({
          px: t.px, py: t.py,
          src: t.src.slice(), dst: t.dst.slice(),
          label: t.label || ('P' + (i + 1))
        });
      }
    }

    S.gr = {
      key: key,
      rec: folder.scans[0],          // newest window reads clearest
      pairs: prior,
      pendingSrc: null,
      fit: null
    };
    if (folder.record && folder.record.mode) $('grMode').value = folder.record.mode;
    if (prior.length) solve();
    $('georefPanel').classList.remove('hidden');
    $('grFolder').textContent = folder.meta.folder || key;
    open();
    drawFrontView();
    renderTies();
  }

  function cancelGeoref() {
    if (!S.gr) return;
    S.gr = null;
    SensiMap.releasePick();
    $('georefPanel').classList.add('hidden');
    render();
  }

  /* ---- the front view the tie points are picked on ---- */

  function drawFrontView() {
    var g = S.gr;
    if (!g) return;
    var scan = g.rec.scan, cv = $('grCanvas');
    /* Same scale as the 3-D drape, so a feature the operator is aiming at
       looks the same in both places while they are tying it down. */
    var dom = domainFor(scan);
    var L = rampLut();

    var off = document.createElement('canvas');
    off.width = scan.nx; off.height = scan.ny;
    var octx = off.getContext('2d');
    var img = octx.createImageData(scan.nx, scan.ny);
    var span = dom.vmax - dom.vmin;

    /* Blank where the radar returned nothing, so a gap never masquerades as a
       0 mm reading the operator might tie a point to. */
    for (var p = 0; p < img.data.length; p += 4) img.data[p + 3] = 0;

    for (var i = 0; i < scan.n; i++) {
      var t = (scan.def[i] - dom.vmin) / span;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var c = ColorMaps.sample(L, t);
      /* Y counts up from the bottom in the export; the canvas counts down. */
      var col = scan.px[i] - 1, row = scan.ny - scan.py[i];
      var o = (row * scan.nx + col) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    var w = Math.max(260, Math.min(560, scan.nx * 3));
    cv.width = w;
    cv.height = Math.round(w * scan.ny / scan.nx);
    var ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(off, 0, 0, cv.width, cv.height);

    for (var k = 0; k < g.pairs.length; k++) marker(ctx, cv, scan, g.pairs[k].px, g.pairs[k].py, String(k + 1), '#12c2a0');
    if (g.pendingSrc) marker(ctx, cv, scan, g.pendingSrc.px, g.pendingSrc.py, '?', '#ffb300');

    cv.classList.toggle('armed', !!g.pendingSrc);
    $('grCanvasNote').textContent = g.pendingSrc
      ? 'Now click the same feature on the survey surface in the 3-D view.'
      : 'Front view as the radar sees it — colour is deformation. Click a feature to start a tie.';
  }

  function marker(ctx, cv, scan, px, py, label, colour) {
    var x = (px - 0.5) / scan.nx * cv.width;
    var y = (scan.ny - py + 0.5) / scan.ny * cv.height;
    ctx.strokeStyle = colour; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = colour;
    ctx.font = 'bold 10px Consolas,monospace';
    ctx.fillText(label, x + 9, y - 6);
  }

  function onCanvasPick(ev) {
    var g = S.gr;
    if (!g) return;
    var cv = $('grCanvas'), scan = g.rec.scan;
    var r = cv.getBoundingClientRect();
    var px = Math.floor((ev.clientX - r.left) / r.width * scan.nx) + 1;
    var py = scan.ny - Math.floor((ev.clientY - r.top) / r.height * scan.ny);
    if (px < 1 || px > scan.nx || py < 1 || py > scan.ny) return;

    var idx = scan.idx[(py - 1) * scan.nx + (px - 1)];
    if (idx < 0) { status('That pixel has no radar return — pick one on the wall.'); return; }

    g.pendingSrc = {
      px: px, py: py,
      src: [scan.x[idx], scan.y[idx], scan.z[idx]],
      range: scan.range[idx]
    };
    drawFrontView();

    SensiMap.claimPick(function (hit) {
      g.pairs.push({
        px: g.pendingSrc.px, py: g.pendingSrc.py,
        src: g.pendingSrc.src,
        dst: [hit.x, hit.y, hit.z],
        label: 'P' + (g.pairs.length + 1)
      });
      g.pendingSrc = null;
      SensiMap.releasePick();
      drawFrontView();
      solve();
      renderTies();
    }, 'Click the same feature on the survey surface  (Esc to cancel this tie)', function () {
      g.pendingSrc = null;
      drawFrontView();
      renderTies();
    });
  }

  /* ---- solve & report ---- */

  function solve() {
    var g = S.gr;
    if (!g) return;
    g.fit = Georef.solve(g.pairs, { mode: $('grMode').value });
  }

  /**
   * The tie table, every cell editable.
   *
   * Clicking features on a low-resolution radar image is fiddly, and the
   * numbers are often already known — read off a survey pickup, or nudged one
   * pixel at a time to chase the residual down. So the pixel and the mine
   * coordinates are both typed here, and picking is one way to fill the row
   * rather than the only way.
   */
  function renderTieRows() {
    var g = S.gr, table = $('grTable');
    if (!g) return;
    table.innerHTML = '';
    if (!g.pairs.length) return;

    var head = document.createElement('tr');
    head.innerHTML = '<th>#</th><th>px</th><th>py</th><th>easting</th>' +
      '<th>northing</th><th>RL</th><th>resid</th><th></th>';
    table.appendChild(head);

    var fit = g.fit;

    g.pairs.forEach(function (p, i) {
      var tr = document.createElement('tr');
      var worst = fit && fit.ok && fit.worst === i && g.pairs.length > 2;
      if (worst) tr.className = 'worst';

      var cells = [
        { txt: String(i + 1) },
        { key: 'px', val: p.px, step: 1 },
        { key: 'py', val: p.py, step: 1 },
        { key: 0, val: p.dst[0], step: 0.1 },
        { key: 1, val: p.dst[1], step: 0.1 },
        { key: 2, val: p.dst[2], step: 0.1 }
      ];

      cells.forEach(function (c) {
        var td = document.createElement('td');
        if (c.txt != null) {
          td.textContent = c.txt;
        } else {
          var inp = document.createElement('input');
          inp.type = 'number';
          inp.step = c.step;
          inp.className = 'tieIn';
          inp.value = typeof c.val === 'number' ? +(+c.val).toFixed(3) : c.val;
          inp.onchange = function () { editTie(i, c.key, parseFloat(inp.value)); };
          td.appendChild(inp);
        }
        tr.appendChild(td);
      });

      var res = document.createElement('td');
      res.textContent = fit && fit.ok ? num(fit.residuals[i], 2) : '—';
      res.title = p.warn || '';
      if (p.warn) { res.textContent = '!'; res.className = 'bad'; }
      tr.appendChild(res);

      var rm = document.createElement('td');
      rm.className = 'drop';
      rm.textContent = '✕';
      rm.title = 'Remove this tie';
      rm.onclick = function () {
        g.pairs.splice(i, 1);
        solve(); drawFrontView(); renderTies();
      };
      tr.appendChild(rm);

      table.appendChild(tr);
    });
  }

  /**
   * Apply one typed cell.
   *
   * A pixel edit has to re-read the radar-local coordinate behind it, because
   * THAT is what the solve uses — the pixel is only how the operator refers to
   * it. A pixel with no return is kept and flagged rather than silently reset,
   * so a typo is visible instead of looking like it worked.
   */
  function editTie(i, key, value) {
    var g = S.gr;
    if (!g || !isFinite(value)) { renderTies(); return; }
    var p = g.pairs[i], scan = g.rec.scan;

    if (key === 'px' || key === 'py') {
      var px = key === 'px' ? Math.round(value) : p.px;
      var py = key === 'py' ? Math.round(value) : p.py;
      px = Math.max(1, Math.min(scan.nx, px));
      py = Math.max(1, Math.min(scan.ny, py));
      p.px = px; p.py = py;

      var idx = scan.idx[(py - 1) * scan.nx + (px - 1)];
      if (idx < 0) {
        p.warn = 'pixel ' + px + ',' + py + ' has no radar return';
        status(p.warn);
      } else {
        p.warn = null;
        p.src = [scan.x[idx], scan.y[idx], scan.z[idx]];
      }
    } else {
      p.dst[key] = value;
    }

    solve(); drawFrontView(); renderTies();
  }

  /* Add a row to type into. Seeded at the image centre and, when the operator
     has probed the surface, at that point — so the common case is adjusting
     two numbers rather than entering six. */
  function addManualTie() {
    var g = S.gr;
    if (!g) return;
    var scan = g.rec.scan;
    var px = Math.max(1, Math.round(scan.nx / 2));
    var py = Math.max(1, Math.round(scan.ny / 2));
    var idx = scan.idx[(py - 1) * scan.nx + (px - 1)];

    var probe = S.lastProbe;
    g.pairs.push({
      px: px, py: py,
      src: idx >= 0 ? [scan.x[idx], scan.y[idx], scan.z[idx]] : [0, 0, 0],
      dst: probe ? [probe.x, probe.y, probe.z] : [0, 0, 0],
      label: 'P' + (g.pairs.length + 1),
      warn: idx >= 0 ? null : 'pixel ' + px + ',' + py + ' has no radar return'
    });
    solve(); drawFrontView(); renderTies();
    var first = $('grTable').querySelector('input');
    if (first) { first.focus(); first.select(); }
  }

  function renderTies() {
    var g = S.gr;
    if (!g) return;
    $('grCount').textContent = g.pairs.length;
    $('grUndo').disabled = !g.pairs.length && !g.pendingSrc;

    renderTieRows();

    var fit = g.fit;
    var box = $('grResult');
    if (!fit) { box.classList.add('hidden'); $('grSave').disabled = true; return; }
    box.classList.remove('hidden');

    if (!fit.ok) {
      box.innerHTML = '<span class="w">' + esc(fit.error) + '</span>';
      $('grSave').disabled = true;
      return;
    }

    /* The sensor position is the most checkable number here — a surveyor knows
       where the radar stands, so it catches a bad fit faster than an RMS does. */
    var html =
      '<b>Sensor</b> ' + num(fit.origin[0], 1) + ', ' + num(fit.origin[1], 1) +
      ', RL ' + num(fit.origin[2], 1) + '<br>' +
      '<b>Bearing</b> ' + num(fit.bearingDeg, 2) + '°' +
      (fit.mode === 'rigid' ? ' · <b>tilt</b> ' + num(fit.tiltDeg, 2) + '°' : '') + '<br>' +
      '<b>RMS</b> <span class="' + (fit.rms > 5 ? 'w' : 'g') + '">' + num(fit.rms, 2) + ' m</span>' +
      ' · worst ' + num(fit.maxResidual, 2) + ' m';
    if (fit.warning) html += '<br><span class="w">' + esc(fit.warning) + '</span>';
    box.innerHTML = html;
    $('grSave').disabled = false;
  }

  function saveGeoref() {
    var g = S.gr;
    if (!g || !g.fit || !g.fit.ok) return;
    var folder = S.folders[g.key];

    var record = Georef.serialise(g.fit, g.pairs);
    /* Georef stores ties as pure coordinates; the pixel each one was picked on
       is a SensiMap concern, and keeping it is what lets a re-georeference
       reopen with the existing crosses already on the front view instead of
       starting from a blank image. */
    for (var t = 0; t < record.ties.length; t++) {
      record.ties[t].px = g.pairs[t].px;
      record.ties[t].py = g.pairs[t].py;
    }
    record.radar = folder.meta.radar;
    record.folder = folder.meta.folder;
    record.commenced = folder.meta.commenced;

    /* Carried so a later session with no CSVs on disk can still answer "which
       folders cover this point". */
    var cidx = ScanLayer.coverageIndex(g.rec.scan, { r: g.fit.r, t: g.fit.t });
    record.footprint = ScanLayer.footprint(g.rec.scan, cidx);
    record.scans = (folder.record && folder.record.scans) || [];

    $('grSave').disabled = true;
    status('Saving georeference…');

    GeorefStore.save(g.key, record).then(function (saved) {
      folder.transform = Georef.deserialise(saved || record);
      folder.record = saved || record;
      folder.registered = true;
      for (var i = 0; i < folder.scans.length; i++) placeScan(folder, folder.scans[i]);
      rememberWindows(folder);
      status('“' + (folder.meta.folder || g.key) + '” registered — later scans will place automatically.');
      cancelGeoref();
    }).catch(function (e) {
      $('grSave').disabled = false;
      status('Could not save the georeference: ' + (e.message || e));
    });
  }

  /* ---------------------------------------------- sidebar list */

  function render() {
    if (!S.booted) return;
    sortFolders();
    var host = $('radarFolders'), out = [];

    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      var placed = !!f.transform;
      var cls = placed ? 'placed' : 'unplaced';

      var tag = f.loading ? '<span class="tag">checking…</span>'
        : f.lookupFailed ? '<span class="tag warn" title="' + esc(f.lookupFailed) +
            '">registry unreachable</span>'
        : placed ? '<span class="tag ok">registered</span>'
        : '<span class="tag warn">needs georeference</span>';

      var scans = [];
      for (var j = 0; j < f.scans.length; j++) {
        var s = f.scans[j], m = s.scan.meta;
        var peak = Math.max(Math.abs(s.scan.defMin), Math.abs(s.scan.defMax));
        scans.push(
          '<div class="scanRow">' +
          '<button class="eyeBtn ' + (s.visible ? 'on' : '') + '" data-vis="' + esc(s.id) +
          '" title="Show / hide in 3-D">' + (s.visible ? '◉' : '○') + '</button>' +
          '<span class="when">' + esc(fmtWindow(m)) + '</span>' +
          '<span class="peak">' + num(peak, 0) + ' mm</span>' +
          '</div>'
        );
      }

      out.push(
        '<div class="folderCard ' + cls + '">' +
        '<div class="folderHead">' +
        '<span class="folderName" title="' + esc(f.key) + '">' + esc(f.meta.folder || f.key) + '</span>' +
        tag +
        '</div>' +
        '<div class="folderMeta">' + esc(f.meta.radar || '') +
        (f.transform && f.record ? ' · bearing ' + num(f.record.bearingDeg, 1) + '°' +
          ' · RMS ' + num(f.record.rms, 2) + ' m' : '') +
        (f.scans[0] && f.scans[0].drapeNote ? '<br>' + esc(f.scans[0].drapeNote) : '') +
        '</div>' +
        '<div class="folderBody">' + scans.join('') +
        '<div class="row" style="margin-top:5px">' +
        '<button class="miniBtn" data-geo="' + esc(f.key) + '">' +
        (placed ? 'Re-georeference' : 'Georeference…') + '</button>' +
        '</div></div></div>'
      );
    }

    host.innerHTML = out.join('');
    $('radarIntro').classList.toggle('hidden', S.order.length > 0);
  }

  /* ---------------------------------------------- coverage on click */

  /**
   * Every registered wall folder covering the clicked point, newest first.
   *
   * A folder qualifies on a single pixel of overlap — that is the point of the
   * question: an operator standing at a spot wants every folder that watches
   * it, not just the one that watches it best.
   */
  function onProbe(hit) {
    if (!hit) return;
    /* Kept so "Add tie" can seed the mine coordinates from the last place the
       operator probed, rather than making them type all three. */
    S.lastProbe = { x: hit.x, y: hit.y, z: hit.z };
    var found = [];

    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      if (!f.transform) continue;

      var scans = [], testable = false;
      for (var j = 0; j < f.scans.length; j++) {
        var s = f.scans[j];
        if (!s.cidx) continue;
        testable = true;
        var c = ScanLayer.coverAt(s.scan, s.cidx, hit.x, hit.y, hit.z);
        if (c) scans.push({ meta: s.scan.meta, def: c.def, id: s.id });
      }

      /* Fall back to the stored footprint ONLY when there was nothing loaded to
         test against, so a folder registered on another machine still shows up.
         When the real pixels were available and said no, that answer stands —
         the coarse grid must never overrule the exact test. */
      if (!testable && f.record && f.record.footprint) {
        var ap = ScanLayer.coverFootprint(f.record.footprint, f.transform, hit.x, hit.y, hit.z);
        if (ap) {
          var known = (f.record.scans || []).slice(0, 12);
          for (var k = 0; k < known.length; k++) {
            scans.push({
              meta: {
                filename: known[k].filename,
                startAt: known[k].startAt ? new Date(known[k].startAt) : null,
                endAt: known[k].endAt ? new Date(known[k].endAt) : null
              },
              def: null, approximate: true
            });
          }
          if (!scans.length) scans.push({ meta: f.meta, def: null, approximate: true });
        }
      }

      if (!scans.length) continue;
      scans.sort(function (a, b) { return (+b.meta.endAt || 0) - (+a.meta.endAt || 0); });
      found.push({ folder: f, scans: scans, at: +scans[0].meta.endAt || 0 });
    }

    found.sort(function (a, b) { return b.at - a.at; });
    showCover(hit, found);
  }

  function showCover(hit, found) {
    var body = $('coverBody'), panel = $('coverPanel');
    $('coverTitle').textContent = 'Wall folders here';

    if (!found.length) {
      body.innerHTML = '<div class="coverEmpty">No registered wall folder covers ' +
        num(hit.x, 0) + ', ' + num(hit.y, 0) + '.<br>' +
        (S.order.length ? 'Georeference a folder to see it listed here.'
                        : 'Drop a radar deformation export to begin.') + '</div>';
      panel.classList.remove('hidden');
      return;
    }

    var out = [];
    for (var i = 0; i < found.length; i++) {
      var f = found[i].folder, scans = found[i].scans;
      var rows = [];
      for (var j = 0; j < scans.length; j++) {
        var s = scans[j];
        rows.push(
          '<div class="coverScan ' + (j === 0 ? 'latest' : '') + '"' +
          (s.id ? ' data-focus="' + esc(s.id) + '"' : '') + '>' +
          '<span>' + esc(fmtWindow(s.meta)) + '</span>' +
          '<span class="mm">' + (s.def == null ? '·' : num(s.def, 1) + ' mm') + '</span>' +
          '</div>'
        );
      }
      out.push(
        '<div class="coverFolder">' +
        '<div class="cf">' + esc(f.meta.folder || f.key) + '</div>' +
        '<div class="cm">' + esc(f.meta.radar || '') + ' · ' + scans.length + ' scan' +
        (scans.length === 1 ? '' : 's') +
        (scans[0].approximate ? ' · from registry' : '') + '</div>' +
        rows.join('') +
        '</div>'
      );
    }
    body.innerHTML = out.join('');
    panel.classList.remove('hidden');
  }

  /* ---------------------------------------------- wiring */

  function open() { $('secRadar').open = true; }

  function bind() {
    S.booted = true;

    $('grCanvas').addEventListener('click', onCanvasPick);
    $('grCancel').onclick = cancelGeoref;
    $('grSave').onclick = saveGeoref;
    $('grMode').onchange = function () { solve(); renderTies(); };

    $('grUndo').onclick = function () {
      var g = S.gr;
      if (!g) return;
      if (g.pendingSrc) { g.pendingSrc = null; SensiMap.releasePick(); }
      else g.pairs.pop();
      solve(); drawFrontView(); renderTies();
    };

    $('grAddTie').onclick = addManualTie;

    $('radarFolders').addEventListener('click', function (e) {
      var t = e.target;
      var geo = t.getAttribute && t.getAttribute('data-geo');
      if (geo) { startGeoref(geo); return; }
      var vis = t.getAttribute && t.getAttribute('data-vis');
      if (vis) toggleScan(vis);
    });

    $('coverClose').onclick = function () { $('coverPanel').classList.add('hidden'); };

    /* ---- colour scale controls ---- */
    $('radarLimit').onchange = function () {
      S.limit = Math.max(0, +this.value || 0);
      applyScale();
    };
    $('radarAuto').onclick = function () {
      S.limit = 0;
      $('radarLimit').value = 0;
      applyScale();
    };
    $('radarBands').onchange = function () {
      S.bands = Math.max(0, Math.min(32, +this.value || 0));
      applyScale();
    };
    $('radarGamma').onchange = function () {
      var v = +this.value;
      S.gamma = (isFinite(v) && v > 0) ? v : 1;
      applyScale();
    };
    $('radarAddStop').onclick = function () {
      /* Drop the new stop in the widest gap and give it the colour already
         there, so adding one never changes how the map looks — it only gives
         the operator a handle to pull. */
      var at = 0.5, gap = -1;
      for (var i = 0; i + 1 < S.stops.length; i++) {
        var d = S.stops[i + 1][0] - S.stops[i][0];
        if (d > gap) { gap = d; at = (S.stops[i][0] + S.stops[i + 1][0]) / 2; }
      }
      var c = ColorMaps.sample(rampLut(), at);
      S.stops.push([at, ColorMaps.rgb2hex(c[0], c[1], c[2])]);
      S.stops.sort(function (a, b) { return a[0] - b[0]; });
      renderStops(); applyScale();
    };
    $('radarEvenStops').onclick = function () {
      var n = S.stops.length - 1;
      S.stops.forEach(function (s, i) { s[0] = n ? i / n : 0; });
      renderStops(); applyScale();
    };
    $('radarRevStops').onclick = function () {
      var cols = S.stops.map(function (s) { return s[1]; }).reverse();
      S.stops.forEach(function (s, i) { s[1] = cols[i]; });
      renderStops(); applyScale();
    };
    $('radarResetStops').onclick = function () {
      S.stops = ScanLayer.defaultStops();
      S.bands = 0; S.gamma = 1;
      $('radarBands').value = 0; $('radarGamma').value = 1;
      renderStops(); applyScale();
    };

    $('radarDrape').onchange = function () {
      S.drape = this.checked;
      saveScale();
      /* Geometry changes, so this is a full rebuild rather than a recolour. */
      replaceAll();
      render();
    };

    $('radarAlpha').oninput = function () {
      S.alpha = Math.max(0.2, (+this.value || 100) / 100);
      var V = viewer();
      if (!V) return;
      for (var i = 0; i < V.scans.length; i++) V.setScanOpts(V.scans[i].id, { alpha: S.alpha });
      V.draw();
      saveScale();
    };

    SensiMap.onProbe(onProbe);

    /* Reflect the stored preference into the controls before anything draws. */
    loadScale();
    $('radarLimit').value = S.limit;
    $('radarBands').value = S.bands;
    $('radarGamma').value = S.gamma;
    $('radarAlpha').value = Math.round(S.alpha * 100);
    $('radarDrape').checked = S.drape;
    renderStops();
    drawBar();

    render();
  }

  function toggleScan(id) {
    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      for (var j = 0; j < f.scans.length; j++) {
        if (f.scans[j].id !== id) continue;
        f.scans[j].visible = !f.scans[j].visible;
        var V = viewer();
        if (V) { V.setScanOpts(id, { visible: f.scans[j].visible }); V.draw(); }
        render();
        return;
      }
    }
  }

  /* ui.js boots on DOMContentLoaded and creates the viewer; this must land
     after that, or SensiMap is not there yet. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  return { acceptFile: acceptFile, _state: S };
})();
