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

   Two things this file holds that are easy to miss:

     the registry   every folder the platform has a georeference for is read
                    at start-up, whether or not a CSV of it is open. It is not
                    LISTED — a row that cannot be drawn, coloured or
                    georeferenced is only clutter — but it is what lets a click
                    in the pit answer "which wall folders watch this spot"
                    for someone who has loaded nothing yet.
     the style      the colour scale and the opacity can belong to the whole
                    session, to a wall folder, or to a single scan, and are
                    resolved most-specific-first. The override is created when
                    a control is TOUCHED, never when a row is selected, so
                    tuning the default keeps reaching everything the operator
                    has merely clicked on.
   ============================================================ */
'use strict';

var RadarUI = (function () {

  var $ = function (id) { return document.getElementById(id); };

  var SCALE_KEY = 'sensimap.radarScale.v1';

  /* The colour scale and the opacity are a STYLE, and three things can own
     one: these defaults, a wall folder, or a single scan. `styleOf` resolves
     them most-specific-first, so a scan that has never been touched keeps
     following the defaults instead of being detached the moment it is
     selected. The fields below are the style's own shape as well — the
     defaults ARE a style, which is what lets the form edit either. */
  var S = {
    folders: Object.create(null),   // key -> folder record
    order: [],                      // keys, newest activity first
    /* Symmetric by construction: one limit sets both ends, so the middle
       colour is always 0 mm. 5 mm is the default the crews read; 0 = auto. */
    limit: 5,
    alpha: 1,
    /* Project each pixel down its sight line onto the survey surface, so the
       drape cannot float above or sink into the terrain. Geometry, not style:
       it is about the drape being right, so it stays global. */
    drape: true,
    stops: ScanLayer.defaultStops(),
    bands: 0,
    gamma: 1,
    /* What the properties sheet is editing: [] = the defaults, one entry = one
       scan or one folder, several = one edit applied across all of them.
       Each entry is {key, id} — `id` null means the whole folder. */
    sel: [],
    anchor: null,                   // the row Shift-click extends from
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

  function rampLut(st) {
    st = st || S;
    return ScanLayer.lut(st.stops, { bands: st.bands, gamma: st.gamma });
  }

  /** Redraw everything the scale touches: the drapes, the bar, the front view. */
  function applyScale() {
    /* Only the defaults are worth remembering — a per-scan override belongs to
       scans that are not on disk next time anyway. */
    if (!S.sel.length) saveScale();
    recolourAll();
    drawBar();
    renderStopsNote();
    renderStyleNote();
    if (S.gr) drawFrontView();
  }

  /* ---------------------------------------------- style resolution */

  function cloneStops(stops) {
    return stops.map(function (s) { return [s[0], s[1]]; });
  }

  function cloneStyle(st) {
    return { limit: st.limit, stops: cloneStops(st.stops), bands: st.bands,
             gamma: st.gamma, alpha: st.alpha };
  }

  /** The style one scan is actually drawn with: its own, its folder's, or the defaults. */
  function styleOf(rec) {
    if (rec.style) return rec.style;
    var f = S.folders[rec.folderKey];
    if (f && f.style) return f.style;
    return S;
  }

  /* ---------------------------------------------- the selection

     Properties describes ONE thing at a time — a scan, or a wall folder — and
     that is what gives the sheet the authority to send it to the georeference
     workflow. Several rows can be selected together, and the edits that have
     an obvious answer for a set — the colour scale, the opacity — then apply
     to all of them at once, every row taking the same value. A georeference is
     the exception: it belongs to exactly one wall folder, so it is locked out
     rather than applied to a set and hoped for. */

  function folderOf(entry) { return entry ? S.folders[entry.key] || null : null; }

  function recOf(folder, id) {
    for (var i = 0; folder && i < folder.scans.length; i++) {
      if (folder.scans[i].id === id) return folder.scans[i];
    }
    return null;
  }

  /** Every scan record the selection covers, in list order, no duplicates. */
  function targetRecs() {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < S.sel.length; i++) {
      var e = S.sel[i], f = folderOf(e);
      if (!f) continue;
      for (var j = 0; j < f.scans.length; j++) {
        var rec = f.scans[j];
        if (e.id && rec.id !== e.id) continue;
        if (seen[rec.id]) continue;
        seen[rec.id] = 1;
        out.push(rec);
      }
    }
    return out;
  }

  /** True while the sheet may offer the georeference — one folder, no guessing. */
  function singleTarget() { return S.sel.length === 1; }

  /** The style the form DISPLAYS — resolved, never materialised. */
  function viewStyle() {
    var t = targetRecs();
    if (t.length) return styleOf(t[0]);
    var f = folderOf(S.sel[0]);
    if (f) return f.style || S;
    return S;
  }

  /**
   * The style objects the form EDITS, created on demand.
   *
   * Materialising here rather than on selection is the whole point: selecting
   * a scan must not detach it from the defaults, or tuning the default scale
   * would quietly stop reaching everything the operator had ever clicked.
   */
  function editStyles() {
    if (!S.sel.length) return [S];
    var out = [];
    for (var i = 0; i < S.sel.length; i++) {
      var e = S.sel[i], f = folderOf(e);
      if (!f) continue;
      if (!e.id) {
        /* A folder owns one scale for everything under it, so its scans give
           up their own — the operator asked for the folder, not for five
           scans that happen to be in it. */
        if (!f.style) f.style = cloneStyle(f.scans[0] ? styleOf(f.scans[0]) : S);
        for (var j = 0; j < f.scans.length; j++) f.scans[j].style = null;
        out.push(f.style);
      } else {
        var rec = recOf(f, e.id);
        if (!rec) continue;
        if (!rec.style) rec.style = cloneStyle(styleOf(rec));
        out.push(rec.style);
      }
    }
    return out.length ? out : [S];
  }

  function beginEdit() { return editStyles()[0]; }

  /* An edit made with several rows selected gives them all the SAME value.
     Nudging each one's own setting by the same delta would be the other
     reading, and nobody can predict the result of that.

     Colour and opacity spread separately: they are on the same sheet but they
     are not one edit, and changing the ramp must not quietly flatten opacities
     that were set one at a time. */
  function spread(primary) {
    if (S.sel.length < 2) return;
    var styles = editStyles();
    for (var i = 0; i < styles.length; i++) {
      var st = styles[i];
      if (st === primary) continue;
      st.limit = primary.limit;
      st.bands = primary.bands;
      st.gamma = primary.gamma;
      st.stops = cloneStops(primary.stops);
    }
  }

  function spreadAlpha(primary) {
    if (S.sel.length < 2) return;
    var styles = editStyles();
    for (var i = 0; i < styles.length; i++) {
      if (styles[i] !== primary) styles[i].alpha = primary.alpha;
    }
  }

  /** Give the selected rows their inherited scale back. */
  function clearStyle() {
    for (var i = 0; i < S.sel.length; i++) {
      var e = S.sel[i], f = folderOf(e);
      if (!f) continue;
      if (!e.id) {
        f.style = null;
        for (var j = 0; j < f.scans.length; j++) f.scans[j].style = null;
      } else {
        var rec = recOf(f, e.id);
        if (rec) rec.style = null;
      }
    }
    syncScaleForm();
    applyScale();
    applyAlphaAll();
  }

  /** How many of the selected rows carry a scale of their own. */
  function ownStyleCount() {
    var n = 0;
    for (var i = 0; i < S.sel.length; i++) {
      var e = S.sel[i], f = folderOf(e);
      if (!f) continue;
      if (!e.id) {
        /* A folder counts when anything under it has been detached, because
           resetting it is what puts those scans back on the default too. */
        if (f.style) { n++; continue; }
        for (var j = 0; j < f.scans.length; j++) {
          if (f.scans[j].style) { n++; break; }
        }
      } else { var rec = recOf(f, e.id); if (rec && rec.style) n++; }
    }
    return n;
  }

  /**
   * Point the properties sheet at a set of rows.
   *
   * `list` is [{key, id}], `id` null meaning the whole wall folder. The tree
   * owns the click semantics — plain, ctrl, shift — and hands the answer here.
   */
  function setSelection(list) {
    var out = [], seen = Object.create(null);
    for (var i = 0; list && i < list.length; i++) {
      var e = list[i];
      if (!e || !S.folders[e.key]) continue;
      var tag = e.key + '|' + (e.id || '');
      if (seen[tag]) continue;
      seen[tag] = 1;
      out.push({ key: e.key, id: e.id || null });
    }
    S.sel = out;
    syncScaleForm();
    render();
  }

  function selection() {
    return S.sel.map(function (e) { return { key: e.key, id: e.id }; });
  }

  function isSelected(key, id) {
    for (var i = 0; i < S.sel.length; i++) {
      if (S.sel[i].key === key && (S.sel[i].id || null) === (id || null)) return true;
    }
    return false;
  }

  /* Reflect the selection into every control the sheet owns. */
  function syncScaleForm() {
    if (!S.booted) return;
    var st = viewStyle();
    $('radarLimit').value = st.limit;
    $('radarBands').value = st.bands;
    $('radarGamma').value = st.gamma;
    $('radarAlpha').value = Math.round(st.alpha * 100);
    renderStops();
    drawBar();
    renderSelHeader();
  }

  /** The header that says what the sheet is about to change, and what it cannot. */
  function renderSelHeader() {
    var name = $('radarSelName');
    if (!name) return;
    var note = $('radarSelNote');
    var recs = targetRecs();
    var one = singleTarget();
    var f = one ? folderOf(S.sel[0]) : null;

    if (!S.sel.length) {
      name.textContent = 'Default scale · every scan';
      note.textContent = 'Select a scan in the Layers tree to give it its own colour and ' +
        'opacity. Ctrl-click or Shift-click to select several — then only the colour can ' +
        'be changed.';
    } else if (one && !S.sel[0].id) {
      name.textContent = f.key;
      note.textContent = 'The whole wall folder — ' + recs.length + ' scan' +
        (recs.length === 1 ? '' : 's') + ' share this colour and opacity.';
    } else if (one) {
      name.textContent = f.key + '  ·  ' + (recs[0] ? fmtWindow(recs[0].scan.meta) : '—');
      note.textContent = 'This scan only. Colour, opacity and the georeference all apply here.';
    } else {
      name.textContent = S.sel.length + ' rows selected · ' + recs.length + ' scan' +
        (recs.length === 1 ? '' : 's');
      note.textContent = 'Colour and opacity apply to all of them at once. A georeference ' +
        'belongs to one wall folder, so that needs a single selection.';
    }

    /* A georeference belongs to exactly one folder, so it is switched off
       rather than guessing which of the selection was meant. Colour and
       opacity have an obvious answer for a set — give them all the same — so
       they stay live however many rows are selected. */
    var canOne = !!(one && f);

    var geo = $('radarGeoref');
    geo.disabled = !canOne || !recs.length;
    geo.textContent = canOne && f.transform ? 'Re-georeference…' : 'Georeference…';
    geo.title = !canOne
      ? 'Select a single scan or wall folder to georeference it'
      : !recs.length
        ? 'Drop a scan of this folder first — tie points are picked on the radar image'
        : 'Tie this wall folder to the mine grid';

    $('radarSelClear').disabled = !S.sel.length;
    renderStyleNote();
  }

  /* Says whether what is on screen is this row's own scale or an inherited
     one, because otherwise "why did the default not change it" has no answer. */
  function renderStyleNote() {
    var btn = $('radarStyleReset');
    if (!btn) return;
    var own = ownStyleCount();
    btn.classList.toggle('hidden', !own);
    btn.textContent = own > 1 ? 'Use the default scale (' + own + ')' : 'Use the default scale';
  }

  /* Opacity is a renderer option rather than a colour, so recolouring does not
     carry it and it gets its own push. */
  function applyAlphaAll() {
    var V = viewer();
    if (!V) return;
    var recs = allRecs();
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].mesh) V.setScanOpts(recs[i].id, { alpha: styleOf(recs[i]).alpha });
    }
    V.draw();
  }

  function drawBar() {
    var cv = $('radarBar');
    if (!cv) return;
    var w = cv.clientWidth || 260;
    cv.width = w;
    var ctx = cv.getContext('2d');
    var L = rampLut(viewStyle());
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
     the widest limit any scan drawn with this style resolved to, so the bar
     never claims a range the drapes are not using. */
  function effectiveLimit(st) {
    st = st || viewStyle();
    if (st.limit > 0) return st.limit;
    var lim = 0, recs = S.sel.length ? targetRecs() : allRecs();
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].dom && recs[i].dom.limit > lim) lim = recs[i].dom.limit;
    }
    return lim;
  }

  function allRecs() {
    var out = [];
    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      for (var j = 0; j < f.scans.length; j++) out.push(f.scans[j]);
    }
    return out;
  }

  function renderStops() {
    var box = $('radarStops');
    if (!box) return;
    box.innerHTML = '';

    /* The rows are built from the style being LOOKED at, but every handler
       edits through beginEdit(): touching a control is what gives a selected
       scan a scale of its own, so merely selecting one leaves it following the
       defaults. The row index survives that, because the override starts as a
       copy of what is on screen. */
    viewStyle().stops.forEach(function (stop, i) {
      var row = document.createElement('div');
      row.className = 'stopRow';
      row.innerHTML =
        '<input type="color" value="' + stop[1] + '">' +
        '<input type="number" min="0" max="1" step="0.01" value="' + (+stop[0]).toFixed(2) + '">' +
        '<div class="bar"></div><button class="rm" title="remove">✕</button>';
      var ci = row.children[0], pi = row.children[1], bar = row.children[2];
      bar.style.background = stop[1];

      ci.oninput = function () {
        var st = beginEdit();
        st.stops[i][1] = ci.value; bar.style.background = ci.value;
        spread(st); applyScale();
      };
      pi.onchange = function () {
        var st = beginEdit();
        var v = parseFloat(pi.value);
        st.stops[i][0] = Math.max(0, Math.min(1, isFinite(v) ? v : 0));
        st.stops.sort(function (a, b) { return a[0] - b[0]; });
        spread(st); renderStops(); applyScale();
      };
      row.children[3].onclick = function () {
        /* Two stops is the least a gradient can be made of. */
        var st = beginEdit();
        if (st.stops.length <= 2) return;
        st.stops.splice(i, 1);
        spread(st); renderStops(); applyScale();
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

  /* The wall folder's full identity, exactly as the filename spells it —
     SSR535_260808_HVM_HVK7_East_Wall-1. The bare folder name is not enough to
     name a folder by: two radars can watch walls the operators called the same
     thing, and a wall re-surveyed months later commences again under a new
     date, which the registry files as a different folder. That leading
     RADAR_YYMMDD_ is exactly what tells those apart. */
  function label(f) {
    return (f && (f.key || (f.meta && f.meta.key))) || '—';
  }

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
        scans: [], registered: false, loading: true, style: null
      };
      S.order.push(key);
    } else if (folder.fromRegistry) {
      /* The folder was listed from the registry before any CSV arrived; the
         file is the better source for the identity, so take it over. */
      folder.fromRegistry = false;
      folder.meta = scan.meta;
    }

    /* Re-dropping the same window replaces it rather than stacking duplicates. */
    var existing = null;
    for (var i = 0; i < folder.scans.length; i++) {
      if (folder.scans[i].scan.meta.filename === scan.meta.filename) existing = folder.scans[i];
    }
    var rec = existing || {
      id: key + '|' + scan.meta.filename, folderKey: key, visible: true, style: null
    };
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
          status('“' + label(folder) + '” is already registered — scan placed automatically.');
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
  function domainFor(rec) {
    var st = styleOf(rec);
    return ScanLayer.domain(rec.scan, {
      limit: st.limit > 0 ? st.limit : 0,
      clipPercentile: st.limit > 0 ? 0 : 0.5
    });
  }

  function placeScan(folder, rec) {
    var V = viewer();
    if (!V || !folder.transform) return;

    rec.dom = domainFor(rec);

    /* Projecting onto the survey surface costs a raycast per pixel, so say so
       before starting rather than appearing to hang on a 25k-pixel scan. */
    var grid = S.drape ? SensiMap.grid() : null;
    if (grid) status('Draping ' + (rec.scan.meta.key || 'scan') + ' onto the surface…');

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
      status('Draped ' + (rec.scan.meta.key || 'scan') + ' — ' + rec.drapeNote +
        (d.medianOffset > 25 ? '  (large offset: check the georeference)' : ''));
    }

    var cols = ScanLayer.colours(rec.scan, rec.dom, rampLut(styleOf(rec)));
    V.setScan(rec.id, rec.mesh, cols, rec.mesh.normals,
      { visible: rec.visible, alpha: styleOf(rec).alpha });
    V.draw();
  }

  /* Colour-only update: the geometry is untouched, so the mesh and the
     coverage index are left alone and only the colour buffer is refilled. */
  function recolourAll() {
    var V = viewer();
    if (!V) return;
    var recs = allRecs();
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      if (!rec.mesh) continue;
      rec.dom = domainFor(rec);
      V.setScanColours(rec.id,
        ScanLayer.colours(rec.scan, rec.dom, rampLut(styleOf(rec))));
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
    if (!folder) return;
    /* Tie points are picked on the radar image, so a folder listed from the
       registry with nothing loaded has nothing to pick on. */
    if (!folder.scans.length) {
      status('Drop a scan of “' + label(folder) + '” first — tie points are picked on the radar image.');
      return;
    }
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
    $('grFolder').textContent = label(folder);
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
    var dom = domainFor(g.rec);
    var L = rampLut(styleOf(g.rec));

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
      status('“' + label(folder) + '” registered — later scans will place automatically.');
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
      /* Registry-only folders are held for the coverage panel, not shown here
         — see listFolders(). A card with no scan under it offers nothing. */
      if (!f.scans.length) continue;
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
          '<div class="scanRow' + (isSelected(f.key, s.id) ? ' sel' : '') +
          '" data-pick="' + esc(s.id) + '" data-key="' + esc(f.key) + '">' +
          '<button class="eyeBtn ' + (s.visible ? 'on' : '') + '" data-vis="' + esc(s.id) +
          '" title="Show / hide in 3-D">' + (s.visible ? '◉' : '○') + '</button>' +
          '<span class="when">' + esc(fmtWindow(m)) + '</span>' +
          '<span class="peak">' + num(peak, 0) + ' mm</span>' +
          '</div>'
        );
      }
      out.push(
        '<div class="folderCard ' + cls + (isSelected(f.key, null) ? ' sel' : '') + '">' +
        '<div class="folderHead" data-pick="" data-key="' + esc(f.key) + '">' +
        '<span class="folderName" title="' + esc(f.key) + '">' + esc(label(f)) + '</span>' +
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
    /* Keyed off the cards actually drawn, not off S.order: a registry listing
       must not make the "drop a scan" introduction disappear. */
    $('radarIntro').classList.toggle('hidden', out.length > 0);
    /* the folders are also rows in the layer tree */
    if (window.SensiMap && SensiMap.refreshTree) SensiMap.refreshTree();
  }

  /**
   * The folder list, flattened for the layer tree.
   *
   * Deliberately a copy rather than the live records: the tree only needs to
   * label and toggle them, and handing out `S.folders` would let it reach the
   * scan buffers and the transforms.
   */
  function listFolders() {
    var out = [];
    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]], scans = [];
      /* A folder listed from the registry with no CSV open is a row that
         cannot be drawn, coloured or georeferenced — nothing but a name — so
         it stays out of the tree and the cards. It is still held in memory,
         which is what lets a click in the pit name it. */
      if (!f.scans.length) continue;
      for (var j = 0; j < f.scans.length; j++) {
        var s = f.scans[j];
        var peak = Math.max(Math.abs(s.scan.defMin), Math.abs(s.scan.defMax));
        scans.push({
          id: s.id, key: f.key, visible: !!s.visible,
          selected: isSelected(f.key, s.id),
          when: fmtWindow(s.scan.meta), peak: num(peak, 0) + ' mm'
        });
      }
      out.push({
        key: f.key, name: label(f), radar: f.meta.radar || '',
        placed: !!f.transform, selected: isSelected(f.key, null), scans: scans
      });
    }
    return out;
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
        '<div class="cf">' + esc(label(f)) + '</div>' +
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

  /* The shell decides where the deformation panel lives; all this module
     knows is that a scan just landed and the operator should be looking at it. */
  function open() {
    if (window.SensiMap && SensiMap.revealScans) SensiMap.revealScans();
  }

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
      if (vis) { toggleScan(vis); return; }
      /* The cards are the same rows as the tree's, so clicking one selects it
         there too — two lists of the same thing must not disagree about which
         of them is being edited. */
      var row = t.closest && t.closest('[data-key]');
      if (!row) return;
      var key = row.getAttribute('data-key');
      var id = row.getAttribute('data-pick') || null;
      pickRow({ key: key, id: id }, e);
    });

    $('coverClose').onclick = function () { $('coverPanel').classList.add('hidden'); };

    /* ---- selection ---- */
    $('radarGeoref').onclick = function () {
      if (S.sel.length !== 1) return;
      startGeoref(S.sel[0].key);
    };
    $('radarSelClear').onclick = function () { setSelection([]); };
    $('radarStyleReset').onclick = clearStyle;

    /* ---- colour scale controls ----
       Every one of these edits whatever the selection points at: the defaults
       when nothing is selected, otherwise the selected scans' own scale. */
    $('radarLimit').onchange = function () {
      var st = beginEdit();
      st.limit = Math.max(0, +this.value || 0);
      spread(st); applyScale();
    };
    $('radarAuto').onclick = function () {
      var st = beginEdit();
      st.limit = 0;
      $('radarLimit').value = 0;
      spread(st); applyScale();
    };
    $('radarBands').onchange = function () {
      var st = beginEdit();
      st.bands = Math.max(0, Math.min(32, +this.value || 0));
      spread(st); applyScale();
    };
    $('radarGamma').onchange = function () {
      var st = beginEdit();
      var v = +this.value;
      st.gamma = (isFinite(v) && v > 0) ? v : 1;
      spread(st); applyScale();
    };
    $('radarAddStop').onclick = function () {
      /* Drop the new stop in the widest gap and give it the colour already
         there, so adding one never changes how the map looks — it only gives
         the operator a handle to pull. */
      var st = beginEdit();
      var at = 0.5, gap = -1;
      for (var i = 0; i + 1 < st.stops.length; i++) {
        var d = st.stops[i + 1][0] - st.stops[i][0];
        if (d > gap) { gap = d; at = (st.stops[i][0] + st.stops[i + 1][0]) / 2; }
      }
      var c = ColorMaps.sample(rampLut(st), at);
      st.stops.push([at, ColorMaps.rgb2hex(c[0], c[1], c[2])]);
      st.stops.sort(function (a, b) { return a[0] - b[0]; });
      spread(st); renderStops(); applyScale();
    };
    $('radarEvenStops').onclick = function () {
      var st = beginEdit();
      var n = st.stops.length - 1;
      st.stops.forEach(function (s, i) { s[0] = n ? i / n : 0; });
      spread(st); renderStops(); applyScale();
    };
    $('radarRevStops').onclick = function () {
      var st = beginEdit();
      var cols = st.stops.map(function (s) { return s[1]; }).reverse();
      st.stops.forEach(function (s, i) { s[1] = cols[i]; });
      spread(st); renderStops(); applyScale();
    };
    $('radarResetStops').onclick = function () {
      var st = beginEdit();
      st.stops = ScanLayer.defaultStops();
      st.bands = 0; st.gamma = 1;
      $('radarBands').value = 0; $('radarGamma').value = 1;
      spread(st); renderStops(); applyScale();
    };

    /* Drape is geometry rather than style — whether the image sits ON the
       surveyed surface is not a per-scan taste — so it stays global. */
    $('radarDrape').onchange = function () {
      S.drape = this.checked;
      saveScale();
      /* Geometry changes, so this is a full rebuild rather than a recolour. */
      replaceAll();
      render();
    };

    $('radarAlpha').oninput = function () {
      var st = beginEdit();
      st.alpha = Math.max(0.2, (+this.value || 100) / 100);
      spreadAlpha(st);
      if (!S.sel.length) saveScale();
      applyAlphaAll();
      renderStyleNote();
    };

    SensiMap.onProbe(onProbe);

    /* Reflect the stored preference into the controls before anything draws. */
    loadScale();
    $('radarDrape').checked = S.drape;
    syncScaleForm();

    render();
    loadRegistry();
  }

  /**
   * One click on a folder or scan row, with the modifiers applied.
   *
   * Ctrl/Cmd toggles a row in or out; Shift extends from the row clicked last
   * over the list as it is displayed; a plain click replaces the selection.
   * Clicking the selected row again clears it, which is the only way back to
   * editing the defaults without hunting for a button.
   */
  function pickRow(entry, ev) {
    var rows = rowOrder();
    var sel = selection();

    if (ev && (ev.ctrlKey || ev.metaKey)) {
      var at = indexOfEntry(sel, entry);
      if (at >= 0) sel.splice(at, 1);
      else sel.push(entry);
    } else if (ev && ev.shiftKey && S.anchor) {
      var a = indexOfEntry(rows, S.anchor), b = indexOfEntry(rows, entry);
      if (a < 0 || b < 0) sel = [entry];
      else sel = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else {
      sel = (sel.length === 1 && indexOfEntry(sel, entry) === 0) ? [] : [entry];
    }

    if (!ev || !ev.shiftKey) S.anchor = entry;
    setSelection(sel);
  }

  /** Every selectable row, folder then its scans, in the order they are shown. */
  function rowOrder() {
    var out = [];
    for (var i = 0; i < S.order.length; i++) {
      var f = S.folders[S.order[i]];
      /* Must match what is on screen, or a Shift-range spans rows nobody can
         see — registry-only folders are not drawn. */
      if (!f.scans.length) continue;
      out.push({ key: f.key, id: null });
      for (var j = 0; j < f.scans.length; j++) out.push({ key: f.key, id: f.scans[j].id });
    }
    return out;
  }

  function indexOfEntry(list, entry) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === entry.key && (list[i].id || null) === (entry.id || null)) return i;
    }
    return -1;
  }

  /**
   * Folders that were georeferenced on some other machine, or in an earlier
   * session, listed before any CSV is dropped.
   *
   * Without this the coverage panel can only answer for folders whose scans
   * happen to be open, which is exactly backwards: the operator asking "what
   * watches this spot" is usually the one who has loaded nothing yet.
   */
  function loadRegistry() {
    if (!window.GeorefStore || !GeorefStore.list) return;
    GeorefStore.list().then(function (records) {
      var added = 0;
      for (var i = 0; i < (records || []).length; i++) {
        var rec = records[i];
        if (!rec || !rec.key || S.folders[rec.key]) continue;
        var tr = Georef.deserialise(rec);
        if (!tr) continue;
        var meta = RadarScan.parseKey(rec.key) || {};
        S.folders[rec.key] = {
          key: rec.key,
          meta: {
            key: rec.key,
            radar: rec.radar || meta.radar || null,
            commenced: rec.commenced || meta.commenced || null,
            folder: rec.folder || meta.folder || rec.key,
            startAt: null, endAt: null, filename: rec.key
          },
          transform: tr, record: rec, scans: [],
          registered: true, fromRegistry: true, style: null
        };
        S.order.push(rec.key);
        added++;
      }
      if (added) render();
    }).catch(function () {
      /* A registry that cannot be listed is not an error the operator can act
         on — dropping a CSV still works, and a failed LOOKUP is reported per
         folder where it does mean something. */
    });
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

  return {
    acceptFile: acceptFile, folders: listFolders,
    toggleScan: toggleScan, georeference: startGeoref,
    /* the layer tree drives the same selection this sheet is written against */
    pick: pickRow, setSelection: setSelection, selection: selection,
    isSelected: isSelected, refreshRegistry: loadRegistry,
    _state: S
  };
})();
