/* ============================================================
   ui.js — application wiring for SensiMap
   ============================================================ */
'use strict';

(function () {

  var $ = function (id) { return document.getElementById(id); };
  var DEG = Math.PI / 180;
  var TERRAIN_LAYERS = { slope: 1, aspect: 1, elev: 1 };

  /* ------------------------------------------------------- state */
  var S = {
    files: [],          // {name, text, type, dataset, note, pending}
    preview: null,      // ascii preview of the pending file
    merged: null,
    grid: null, der: null,
    radars: [], sel: 0,
    res: null, mask: null,
    layer: 'elev',
    pickMode: null, pickBuf: [],
    probe: null,
    busy: false,
    lastStatsHtml: ''
  };

  var LAYER_DEFAULTS = {
    sens: { preset: 'ids-green', vmin: 0, vmax: 1 },
    amp: { preset: 'ids-amplitude', vmin: 0, vmax: 1 },
    vis: { preset: 'rdylgn', vmin: 0, vmax: 1, bands: 2 },
    range: { preset: 'viridis', auto: true },
    slope: { preset: 'turbo', vmin: 0, vmax: 90 },
    aspect: { preset: 'aspect', vmin: 0, vmax: 360 },
    elev: { preset: 'terrain', auto: true },
    which: { preset: 'sensors', auto: true, discrete: true },
    mmres: { preset: 'ids-green', auto: true }
  };
  var LC = {};   // live per-layer colour configs
  Object.keys(LAYER_DEFAULTS).forEach(function (k) {
    var d = LAYER_DEFAULTS[k];
    LC[k] = {
      preset: d.preset, stops: ColorMaps.PRESETS[d.preset].stops.map(function (s) { return s.slice(); }),
      reverse: false, bands: d.bands || 0, gamma: 1,
      vmin: d.vmin != null ? d.vmin : 0, vmax: d.vmax != null ? d.vmax : 1,
      auto: !!d.auto
    };
  });

  var V = null;      // Viewer

  /* =============================================== bootstrap */
  function init() {
    try {
      V = new Viewer($('glcanvas'));
    } catch (e) {
      alert('WebGL error: ' + e.message);
      return;
    }
    V.onClick = onCanvasClick;
    V.onHover = throttle(onCanvasHover, 40);
    window.addEventListener('resize', function () { V.resize(); layoutHist(); });

    buildPresetList();
    bindData();
    bindRadar();
    bindSens();
    bindAOI();
    bindDisplay();
    bindExport();

    $('btnHelp').onclick = function () { $('helpModal').classList.remove('hidden'); };
    $('btnHelpClose').onclick = function () { $('helpModal').classList.add('hidden'); };

    status('Ready — load a DTM/DXF or press “Load demo open pit”.');
    setHud('No model loaded', 'Drop a .dtm / .dxf / .xyz file in panel 1');
    refreshStopEditor();
    layoutHist();
  }

  function throttle(fn, ms) {
    var last = 0, pend = null;
    return function () {
      var a = arguments, now = performance.now();
      if (now - last > ms) { last = now; fn.apply(null, a); }
      else { clearTimeout(pend); pend = setTimeout(function () { last = performance.now(); fn.apply(null, a); }, ms); }
    };
  }
  function status(t, right) {
    $('statusText').textContent = t;
    if (right != null) $('statusRight').textContent = right;
  }
  function setHud(title, sub) { $('hudTitle').textContent = title; $('hudSub').textContent = sub || ''; }
  function badge(t, cls) {
    var b = $('modeBadge'); b.textContent = t;
    b.className = 'badge' + (cls ? ' ' + cls : '');
  }
  function fmt(v, d) { return (v == null || v !== v) ? '—' : (+v).toFixed(d == null ? 2 : d); }
  function fmtInt(v) { return (v == null || v !== v) ? '—' : Math.round(v).toLocaleString(); }

  /* =========================================== 1. DATA LOADING */
  function bindData() {
    var dz = $('dropZone'), fi = $('fileInput');
    $('btnBrowse').onclick = function () { fi.click(); };
    dz.onclick = function () { fi.click(); };
    fi.onchange = function () { if (fi.files.length) readFiles(fi.files); fi.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('hot'); });
      document.addEventListener(ev, function (e) { e.preventDefault(); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function () { dz.classList.remove('hot'); });
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
    });

    $('btnDemo').onclick = function () {
      S.files = [{ name: 'demo-open-pit', type: 'demo', dataset: null, note: '' }];
      status('Generating demo pit…');
      setTimeout(function () {
        var ds = Parsers.demoPit({ step: 6, half: 900, ox: 512000, oy: 7458000 });
        S.files[0].dataset = ds; S.files[0].note = ds.note;
        renderFileList();
        $('asciiPanel').classList.add('hidden');
        $('inpTarget').value = 320;
        buildModel();
        /* handy default sensors: one on the low south berm, one on the high rim */
        S.radars = [];
        addRadar({ name: 'R1 – low bench', x: 512000, y: 7458000 - 560, color: '#ffd400' });
        addRadar({ name: 'R2 – high crest', x: 512000, y: 7458000 - 860, color: '#2f9bff' });
        S.sel = 0;
        renderRadarTable(); loadRadarForm();
        updateOverlays();
        status('Demo pit ready — press “Compute sensitivity map”.');
      }, 20);
    };

    $('btnApplyAscii').onclick = applyAsciiMapping;
    ['selDelim', 'inpSkip'].forEach(function (id) {
      $(id).onchange = function () { if (S.preview) showPreview(S.preview.file); };
    });
    $('btnBuild').onclick = function () { buildModel(); };
  }

  function readFiles(list) {
    var files = Array.prototype.slice.call(list);
    var pending = files.length;
    files.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function () {
        var txt = fr.result;
        var type = Parsers.sniff(txt, f.name);
        var rec = { name: f.name, text: txt, type: type, dataset: null, note: '', size: f.size };
        try {
          if (type === 'dxf') { rec.dataset = Parsers.parseDXF(txt, f.name); }
          else if (type === 'esri') { rec.dataset = Parsers.parseESRI(txt, f.name); }
          else if (type === 'surpac-dtm') { rec.dataset = Parsers.parseSurpacDTM(txt, f.name); }
          else { rec.pending = true; }
          if (rec.dataset) rec.note = rec.dataset.note;
        } catch (e) {
          rec.note = 'error: ' + e.message;
        }
        S.files.push(rec);
        if (--pending === 0) afterRead();
      };
      fr.onerror = function () { if (--pending === 0) afterRead(); };
      fr.readAsText(f);
    });
    status('Reading ' + files.length + ' file(s)…');
  }

  function afterRead() {
    renderFileList();
    var pend = S.files.filter(function (f) { return f.pending; });
    if (pend.length) {
      showPreview(pend[0]);
      applyAsciiMapping(true);          // auto-apply the guessed mapping
    } else {
      buildModel();
    }
  }

  function renderFileList() {
    var el = $('fileList');
    el.innerHTML = '';
    S.files.forEach(function (f, i) {
      var d = document.createElement('div');
      d.className = 'fileItem';
      var tag = f.type === 'dxf' ? 'DXF' : f.type === 'esri' ? 'ASC' :
        f.type === 'surpac-dtm' ? 'DTM' : f.type === 'demo' ? 'DEMO' : 'XYZ';
      d.innerHTML = '<span class="tag">' + tag + '</span><span>' + f.name + '</span>' +
        '<span class="dim">' + (f.note || '') + '</span><span class="x" title="remove">✕</span>';
      d.querySelector('.x').onclick = function (e) {
        e.stopPropagation();
        S.files.splice(i, 1); renderFileList();
        var p = S.files.filter(function (q) { return q.pending; });
        if (p.length) showPreview(p[0]); else $('asciiPanel').classList.add('hidden');
      };
      el.appendChild(d);
    });
  }

  function showPreview(file) {
    var skip = parseInt($('inpSkip').value, 10) || 0;
    var pv = Parsers.previewASCII(file.text, file.name, $('selDelim').value, skip);
    S.preview = { file: file, pv: pv };
    $('asciiPanel').classList.remove('hidden');

    ['selX', 'selY', 'selZ'].forEach(function (id, k) {
      var sel = $(id); sel.innerHTML = '';
      for (var c = 0; c < pv.ncol; c++) {
        var o = document.createElement('option');
        o.value = c; o.textContent = 'col ' + (c + 1) + (pv.numeric[c] ? '' : ' (text)');
        sel.appendChild(o);
      }
      sel.value = k === 0 ? pv.guess.x : k === 1 ? pv.guess.y : pv.guess.z;
    });

    var t = $('previewTable'), html = '<tr>';
    for (var c = 0; c < pv.ncol; c++) html += '<th>' + (c + 1) + '</th>';
    html += '</tr>';
    for (var r = 0; r < Math.min(8, pv.rows.length); r++) {
      html += '<tr>';
      for (var q = 0; q < pv.ncol; q++) html += '<td>' + (pv.rows[r][q] != null ? pv.rows[r][q] : '') + '</td>';
      html += '</tr>';
    }
    t.innerHTML = html;
  }

  function applyAsciiMapping(auto) {
    if (!S.preview) return;
    var map = {
      delim: $('selDelim').value, skip: parseInt($('inpSkip').value, 10) || 0,
      x: parseInt($('selX').value, 10), y: parseInt($('selY').value, 10),
      z: parseInt($('selZ').value, 10), swap: $('chkSwapXY').checked
    };
    var n = 0;
    S.files.forEach(function (f) {
      if (!f.pending) return;
      try {
        f.dataset = Parsers.parseASCII(f.text, f.name, map);
        f.note = f.dataset.note; f.pending = false; n++;
      } catch (e) { f.note = 'error: ' + e.message; }
    });
    renderFileList();
    if (n) buildModel();
    else if (!auto) status('Nothing to map.');
  }

  /* ============================================ MODEL BUILDING */
  function buildModel() {
    var dss = S.files.map(function (f) { return f.dataset; }).filter(Boolean);
    if (!dss.length) { status('No parsed data yet.'); return; }

    /* a pre-made raster (ESRI) short-circuits the gridder */
    var rasterFile = dss.filter(function (d) { return d.grid; })[0];
    var t0 = performance.now();
    try {
      if (rasterFile && dss.length === 1) {
        S.grid = rasterFile.grid;
        var zmin = Infinity, zmax = -Infinity, valid = 0;
        for (var i = 0; i < S.grid.z.length; i++) {
          var v = S.grid.z[i]; if (v !== v) continue;
          valid++; if (v < zmin) zmin = v; if (v > zmax) zmax = v;
        }
        S.grid.zmin = zmin; S.grid.zmax = zmax; S.grid.valid = valid;
        S.grid.method = 'esri raster'; S.grid.nPoints = valid; S.grid.nTris = 0;
        S.grid.cell = S.grid.dx;
        if ($('chkFill').checked) Grid.fillHoles(S.grid, parseInt($('inpFillIter').value, 10) || 0);
      } else {
        S.merged = Grid.merge(dss);
        S.grid = Grid.build(S.merged, {
          cell: parseFloat($('inpCell').value) || 0,
          targetCells: parseInt($('inpTarget').value, 10) || 320,
          searchCells: parseInt($('selSearch').value, 10) || 2,
          interp: $('selInterp').value,
          fill: $('chkFill').checked,
          fillIter: parseInt($('inpFillIter').value, 10) || 0,
          smooth: $('chkSmooth').checked ? (parseInt($('inpSmooth').value, 10) || 1) : 0
        });
      }
      S.der = Grid.derive(S.grid);
    } catch (e) {
      status('Build failed: ' + e.message);
      $('gridInfo').innerHTML = '<span class="w">' + e.message + '</span>';
      return;
    }
    var g = S.grid, ms = (performance.now() - t0).toFixed(0);
    S.res = null; S.probe = null;
    $('hudReadout').classList.add('hidden');

    $('gridInfo').innerHTML =
      '<b>' + g.nx + ' × ' + g.ny + '</b> cells @ <b>' + fmt(g.dx, 2) + ' m</b>  (' + fmtInt(g.nx * g.ny) + ' nodes)\n' +
      'valid ' + (100 * g.valid / (g.nx * g.ny)).toFixed(1) + '%   source: ' + g.method + '\n' +
      'X ' + fmtInt(g.x0) + ' → ' + fmtInt(g.x0 + (g.nx - 1) * g.dx) + '\n' +
      'Y ' + fmtInt(g.y0) + ' → ' + fmtInt(g.y0 + (g.ny - 1) * g.dy) + '\n' +
      'Z ' + fmt(g.zmin, 1) + ' → ' + fmt(g.zmax, 1) + ' m   (' + ms + ' ms)';

    V.setGrid(g, S.der);
    setAOIFull();
    if (!S.radars.length) {
      addRadar({ name: 'Radar 1', x: g.x0 + (g.nx - 1) * g.dx / 2, y: g.y0 + g.dy * 2, color: '#ffd400' });
      S.sel = 0;
    }
    S.radars.forEach(snapRadar);
    renderRadarTable(); loadRadarForm();
    S.layer = 'elev'; $('selLayer').value = 'elev';
    colorize(); updateOverlays(); updateStats(); updateRank();
    badge('model ready', 'on');
    setHud(S.files.map(function (f) { return f.name; }).join(', '),
      g.nx + '×' + g.ny + ' @ ' + fmt(g.dx, 1) + ' m · Z ' + fmt(g.zmin, 0) + '–' + fmt(g.zmax, 0) + ' m');
    status('Model built in ' + ms + ' ms — set the sensor then compute.', g.nx + '×' + g.ny);
  }

  /* ================================================ 2. RADARS */
  function bindRadar() {
    $('btnAddRadar').onclick = function () {
      var g = S.grid;
      addRadar({
        name: 'Radar ' + (S.radars.length + 1),
        x: g ? g.x0 + (g.nx - 1) * g.dx * (0.2 + 0.6 * Math.random()) : 0,
        y: g ? g.y0 + (g.ny - 1) * g.dy * (0.2 + 0.6 * Math.random()) : 0,
        color: ['#ffd400', '#2f9bff', '#ff5252', '#12c2a0', '#e040fb', '#ff9800'][S.radars.length % 6]
      });
      S.sel = S.radars.length - 1;
      renderRadarTable(); loadRadarForm(); updateOverlays();
    };
    $('btnDupRadar').onclick = function () {
      var r = S.radars[S.sel]; if (!r) return;
      var c = JSON.parse(JSON.stringify(r));
      c.name = r.name + ' copy';
      S.radars.push(c); S.sel = S.radars.length - 1;
      renderRadarTable(); loadRadarForm(); updateOverlays();
    };
    $('btnDelRadar').onclick = function () {
      if (S.radars.length <= 1) { status('Keep at least one sensor.'); return; }
      S.radars.splice(S.sel, 1); S.sel = Math.max(0, S.sel - 1);
      renderRadarTable(); loadRadarForm(); updateOverlays(); invalidate();
    };
    $('btnPickRadar').onclick = function () { setPickMode('radar'); };

    ['rName', 'rColor', 'rX', 'rY', 'rZ', 'rDz', 'rAz', 'rApAz', 'rApEl', 'rRmin', 'rRmax'].forEach(function (id) {
      $(id).oninput = saveRadarForm;
    });
    ['chkSnap', 'chkAutoAim'].forEach(function (id) { $(id).onchange = saveRadarForm; });
    $('selCombine').onchange = function () {
      if ($('selCombine').value === 'which') { S.layer = 'which'; $('selLayer').value = 'which'; }
      invalidate(); if (S.res) recompute();
    };
  }

  function addRadar(o) {
    var g = S.grid;
    var r = {
      name: o.name || 'Radar', color: o.color || '#ffd400',
      x: o.x || 0, y: o.y || 0, z: o.z != null ? o.z : 0, dz: o.dz != null ? o.dz : 3,
      snap: o.snap !== false, az: o.az || 0, apAz: o.apAz != null ? o.apAz : 90,
      apEl: o.apEl != null ? o.apEl : 45, rmin: o.rmin != null ? o.rmin : 30,
      rmax: o.rmax != null ? o.rmax : (g ? Math.round(Math.max((g.nx - 1) * g.dx, (g.ny - 1) * g.dy) * 1.3 / 50) * 50 : 4000),
      on: true, autoAim: o.autoAim !== false
    };
    S.radars.push(r);
    snapRadar(r);
    return r;
  }

  function snapRadar(r) {
    if (!S.grid) return;
    if (r.snap) {
      var zt = Grid.sampleZ(S.grid, r.x, r.y);
      if (zt === zt) r.z = zt + (+r.dz || 0);
      else r.z = S.grid.zmax + (+r.dz || 0);
    }
    if (r.autoAim) {
      var g = S.grid;
      var cx = g.x0 + (g.nx - 1) * g.dx / 2, cy = g.y0 + (g.ny - 1) * g.dy / 2;
      var az = Math.atan2(cx - r.x, cy - r.y) / DEG;
      r.az = Math.round(((az % 360) + 360) % 360);
    }
  }

  function renderRadarTable() {
    var tb = $('radarTable').querySelector('tbody');
    tb.innerHTML = '';
    S.radars.forEach(function (r, i) {
      var tr = document.createElement('tr');
      if (i === S.sel) tr.className = 'sel';
      tr.innerHTML =
        '<td><input type="checkbox" ' + (r.on ? 'checked' : '') + '></td>' +
        '<td><span class="dot" style="background:' + r.color + '"></span> ' + r.name + '</td>' +
        '<td class="n">' + fmt(r.x, 0) + '</td><td class="n">' + fmt(r.y, 0) + '</td>' +
        '<td class="n">' + fmt(r.z, 1) + '</td>' +
        '<td class="n">' + (S.res && rstat(i) ? (100 * rstat(i).usable).toFixed(0) + '%' : '') + '</td>';
      tr.onclick = function () { S.sel = i; renderRadarTable(); loadRadarForm(); updateOverlays(); if (S.res && $('selCombine').value === 'selected') recompute(); };
      tr.querySelector('input').onclick = function (e) {
        e.stopPropagation(); r.on = e.target.checked; invalidate(); updateOverlays();
      };
      tb.appendChild(tr);
    });
  }
  function rstat(i) {
    if (!S.res) return null;
    var r = S.radars[i];
    for (var k = 0; k < S.res.perRadar.length; k++) if (S.res.perRadar[k].radar === r) return S.res.perRadar[k].stats;
    return null;
  }

  function loadRadarForm() {
    var r = S.radars[S.sel]; if (!r) return;
    $('rName').value = r.name; $('rColor').value = r.color;
    $('rX').value = fmt(r.x, 2); $('rY').value = fmt(r.y, 2); $('rZ').value = fmt(r.z, 2);
    $('rDz').value = r.dz; $('chkSnap').checked = r.snap;
    /* The aperture inputs are the *total* sector width/height; r.apAz and r.apEl
       are the half-angles the model gates on (see Sensitivity.compute). */
    $('rAz').value = fmt(r.az, 0);
    $('rApAz').value = r.apAz * 2; $('rApEl').value = r.apEl * 2;
    $('rRmin').value = r.rmin; $('rRmax').value = r.rmax;
    $('chkAutoAim').checked = r.autoAim;
    $('rZ').disabled = r.snap;
  }
  function saveRadarForm() {
    var r = S.radars[S.sel]; if (!r) return;
    r.name = $('rName').value; r.color = $('rColor').value;
    r.x = parseFloat($('rX').value) || 0; r.y = parseFloat($('rY').value) || 0;
    r.dz = parseFloat($('rDz').value) || 0;
    r.snap = $('chkSnap').checked; r.autoAim = $('chkAutoAim').checked;
    if (!r.snap) r.z = parseFloat($('rZ').value) || 0;
    /* total aperture in, half-angle stored — the inverse of loadRadarForm */
    r.apAz = clamp(parseFloat($('rApAz').value) || 180, 2, 360) / 2;
    r.apEl = clamp(parseFloat($('rApEl').value) || 90, 2, 180) / 2;
    r.rmin = Math.max(0, parseFloat($('rRmin').value) || 0);
    r.rmax = Math.max(r.rmin + 1, parseFloat($('rRmax').value) || 1000);
    if (!r.autoAim) r.az = parseFloat($('rAz').value) || 0;
    snapRadar(r);
    $('rZ').disabled = r.snap;
    $('rZ').value = fmt(r.z, 2); $('rAz').value = fmt(r.az, 0);
    renderRadarTable(); updateOverlays(); invalidate();
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ============================================ 3. SENSITIVITY */
  function bindSens() {
    Array.prototype.forEach.call(document.querySelectorAll('input[name=smode]'), function (el) {
      el.onchange = function () {
        $('customVec').style.display = (mode() === 'custom') ? '' : 'none';
        invalidate();
      };
    });
    $('customVec').style.display = 'none';
    ['inpCustAz', 'inpCustPl', 'chkOcclusion', 'selOccAcc', 'inpOccTol', 'chkGrazing', 'inpGraz'].forEach(function (id) {
      $(id).onchange = invalidate;
    });
    $('inpThresh').onchange = function () { if (S.res) { restat(); colorize(); updateLegend(); } };
    $('inpTrue').onchange = function () {
      if (S.layer === 'mmres') { autoRangeIfNeeded(false); syncColorForm(); }
      colorize(); updateLegend();
    };
    $('chkMaskBelow').onchange = function () { colorize(); };
    $('btnCompute').onclick = recompute;
  }
  function mode() {
    var el = document.querySelector('input[name=smode]:checked');
    return el ? el.value : 'steepest';
  }
  function invalidate() {
    if (!S.res) return;
    badge('recompute needed', 'busy');
    status('Settings changed — press “Compute sensitivity map”.');
  }

  function computeOpts() {
    var active = S.radars.filter(function (r) { return r.on !== false; });
    var selIdx = Math.max(0, active.indexOf(S.radars[S.sel]));
    var cmb = $('selCombine').value;
    return {
      mode: mode(),
      custAz: parseFloat($('inpCustAz').value) || 0,
      custPl: parseFloat($('inpCustPl').value) || 0,
      occlusion: $('chkOcclusion').checked,
      occStep: parseFloat($('selOccAcc').value) || 1,
      occTol: parseFloat($('inpOccTol').value) || 0,
      grazing: $('chkGrazing').checked,
      grazMax: parseFloat($('inpGraz').value) || 85,
      threshold: parseFloat($('inpThresh').value) || 0,
      combine: cmb === 'which' ? 'max' : cmb,
      selectedIndex: selIdx,
      mask: S.mask,
      trueDispl: parseFloat($('inpTrue').value) || 10
    };
  }

  function recompute() {
    if (!S.grid) { status('Load a model first.'); return; }
    if (S.busy) return;
    S.busy = true;
    badge('computing…', 'busy');
    $('progWrap').classList.remove('hidden');
    S.mask = Sens.aoiMask(S.grid, S.der, aoiObj());
    var opts = computeOpts();
    var t0 = performance.now();
    Sens.compute(S.grid, S.der, S.radars, opts, function (f, nm) {
      $('progBar').style.width = (f * 100).toFixed(1) + '%';
      $('progText').textContent = (f * 100).toFixed(0) + '%  ' + (nm || '');
    }).then(function (res) {
      S.res = res;
      S.res.opts = opts;
      var ms = (performance.now() - t0).toFixed(0);
      $('progWrap').classList.add('hidden');
      S.busy = false;
      if (TERRAIN_LAYERS[S.layer]) { S.layer = 'sens'; $('selLayer').value = 'sens'; syncColorForm(); }
      autoRangeIfNeeded(false);
      colorize(); updateOverlays(); updateStats(); updateRank(); renderRadarTable();
      badge('sensitivity ' + opts.mode, 'on');
      var st = res.stats;
      status('Computed in ' + ms + ' ms — mean sensitivity ' + fmt(st.mean, 3) +
        ', usable area ' + (100 * st.usable).toFixed(1) + '%');
      setHud('Sensitivity · ' + opts.mode.toUpperCase(),
        S.radars.filter(function (r) { return r.on !== false; }).length + ' sensor(s) · ' +
        (opts.occlusion ? 'shadow test on' : 'shadow test off') +
        ' · threshold ' + fmt(opts.threshold, 2));
    }).catch(function (e) {
      S.busy = false;
      $('progWrap').classList.add('hidden');
      badge('error', 'busy');
      status('Compute failed: ' + e.message);
      console.error(e);
    });
  }
  function restat() {
    if (!S.res) return;
    var thr = parseFloat($('inpThresh').value) || 0;
    S.res.opts.threshold = thr;
    S.res.perRadar.forEach(function (P) { P.stats = Sens.summarise(P, S.mask, thr, S.grid); });
    S.res.stats = Sens.summarise(S.res.combined, S.mask, thr, S.grid);
    updateStats(); updateRank(); renderRadarTable();
  }

  /* ==================================================== 4. AOI */
  function bindAOI() {
    ['chkAOI', 'aoiXmin', 'aoiXmax', 'aoiYmin', 'aoiYmax', 'aoiZmin', 'aoiZmax', 'aoiSlopeMin', 'aoiSlopeMax']
      .forEach(function (id) {
        $(id).onchange = function () {
          if (!S.grid) return;
          S.mask = Sens.aoiMask(S.grid, S.der, aoiObj());
          colorize(); updateOverlays();
          if (S.res) restat();
          invalidate();
        };
      });
    $('btnAoiFull').onclick = function () { setAOIFull(); $('aoiXmin').onchange(); };
    $('btnAoiPick').onclick = function () { setPickMode('aoi'); };
  }
  function aoiObj() {
    return {
      on: $('chkAOI').checked,
      xmin: num('aoiXmin', -1e12), xmax: num('aoiXmax', 1e12),
      ymin: num('aoiYmin', -1e12), ymax: num('aoiYmax', 1e12),
      zmin: num('aoiZmin', -1e12), zmax: num('aoiZmax', 1e12),
      slopeMin: num('aoiSlopeMin', 0), slopeMax: num('aoiSlopeMax', 90)
    };
  }
  function num(id, d) { var v = parseFloat($(id).value); return isFinite(v) ? v : d; }
  function setAOIFull() {
    var g = S.grid; if (!g) return;
    $('aoiXmin').value = fmt(g.x0, 0); $('aoiXmax').value = fmt(g.x0 + (g.nx - 1) * g.dx, 0);
    $('aoiYmin').value = fmt(g.y0, 0); $('aoiYmax').value = fmt(g.y0 + (g.ny - 1) * g.dy, 0);
    $('aoiZmin').value = fmt(g.zmin, 0); $('aoiZmax').value = fmt(Math.ceil(g.zmax), 0);
    $('aoiSlopeMin').value = 0; $('aoiSlopeMax').value = 90;
    S.mask = Sens.aoiMask(g, S.der, aoiObj());
  }

  /* ================================================ 5. DISPLAY */
  function buildPresetList() {
    var sel = $('selPreset');
    sel.innerHTML = '';
    Object.keys(ColorMaps.PRESETS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = ColorMaps.PRESETS[k].name;
      sel.appendChild(o);
    });
  }

  function bindDisplay() {
    $('selLayer').onchange = function () {
      S.layer = $('selLayer').value;
      if (!S.res && !TERRAIN_LAYERS[S.layer]) {
        status('Compute the sensitivity map first — showing elevation.');
        S.layer = 'elev'; $('selLayer').value = 'elev';
      }
      syncColorForm(); autoRangeIfNeeded(); colorize(); updateLegend();
    };
    $('selPreset').onchange = function () {
      var p = ColorMaps.PRESETS[$('selPreset').value];
      cfg().preset = $('selPreset').value;
      cfg().stops = p.stops.map(function (s) { return s.slice(); });
      refreshStopEditor(); colorize(); updateLegend();
    };
    $('btnAddStop').onclick = function () {
      var c = cfg();
      c.stops.push([0.5, ColorMaps.sampleHex(lut(), 0.5)]);
      c.stops.sort(function (a, b) { return a[0] - b[0]; });
      refreshStopEditor(); colorize(); updateLegend();
    };
    $('btnEvenStops').onclick = function () {
      var c = cfg(), n = c.stops.length;
      c.stops.forEach(function (s, i) { s[0] = n > 1 ? i / (n - 1) : 0; });
      refreshStopEditor(); colorize(); updateLegend();
    };
    $('btnRevStops').onclick = function () {
      var c = cfg();
      c.stops = c.stops.map(function (s) { return [1 - s[0], s[1]]; }).sort(function (a, b) { return a[0] - b[0]; });
      refreshStopEditor(); colorize(); updateLegend();
    };
    ['inpVmin', 'inpVmax', 'inpBands', 'inpGamma'].forEach(function (id) {
      $(id).onchange = function () {
        var c = cfg();
        c.vmin = parseFloat($('inpVmin').value); c.vmax = parseFloat($('inpVmax').value);
        c.bands = parseInt($('inpBands').value, 10) || 0;
        c.gamma = parseFloat($('inpGamma').value) || 1;
        c.auto = false;
        if (!(c.vmax > c.vmin)) c.vmax = c.vmin + 1;
        refreshStopEditor(); colorize(); updateLegend();
      };
    });
    ['colNoData', 'colOccluded', 'colOutside', 'colBelow'].forEach(function (id) {
      $(id).onchange = function () { colorize(); };
    });
    $('btnAutoRange').onclick = function () { cfg().auto = true; autoRangeIfNeeded(true); colorize(); updateLegend(); };
    $('btnCmSave').onclick = exportScale;
    $('btnCmLoad').onclick = importScale;

    $('inpOpacity').oninput = function () { V.opt.alpha = +this.value; V.draw(); };
    $('inpZScale').oninput = function () { V.opt.zScale = +this.value; V.draw(); };
    $('inpSunAz').oninput = function () { V.opt.sunAz = +this.value; V.draw(); };
    $('inpSunEl').oninput = function () { V.opt.sunEl = +this.value; V.draw(); };
    $('inpShade').oninput = function () { V.opt.shade = +this.value; V.draw(); };
    $('selProjection').onchange = function () { V.cam.ortho = this.value === 'ortho'; V.draw(); };
    $('chkWire').onchange = function () { V.opt.wire = this.checked; V.draw(); };
    ['chkBox', 'chkFan', 'chkVec'].forEach(function (id) { $(id).onchange = updateOverlays; });
    $('btnViewIso').onclick = function () { V.viewIso(); };
    $('btnViewTop').onclick = function () { V.viewTop(); };
    $('btnViewLOS').onclick = function () {
      var r = S.radars[S.sel]; if (r) V.viewFrom(r.x, r.y, r.z);
    };
    $('btnResetView').onclick = function () { V.fit(); };
    syncColorForm();
  }

  function cfg() { return LC[S.layer] || LC.sens; }
  function lut() { return ColorMaps.buildLUT(cfg()); }

  function syncColorForm() {
    var c = cfg();
    $('selPreset').value = c.preset;
    $('inpVmin').value = c.vmin; $('inpVmax').value = c.vmax;
    $('inpBands').value = c.bands; $('inpGamma').value = c.gamma;
    $('cmName').textContent = '— ' + ($('selLayer').selectedOptions[0] ? $('selLayer').selectedOptions[0].textContent : '');
    refreshStopEditor();
  }

  function refreshStopEditor() {
    var c = cfg(), box = $('stopsEditor'), L = ColorMaps.buildLUT(c);
    box.innerHTML = '';
    c.stops.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'stopRow';
      row.innerHTML =
        '<input type="color" value="' + s[1] + '">' +
        '<input type="number" min="0" max="1" step="0.01" value="' + (+s[0]).toFixed(2) + '">' +
        '<div class="bar"></div><button class="rm" title="remove">✕</button>';
      var ci = row.children[0], pi = row.children[1], bar = row.children[2];
      bar.style.background = s[1];
      ci.oninput = function () { s[1] = ci.value; bar.style.background = ci.value; colorize(); updateLegend(); };
      pi.onchange = function () {
        s[0] = clamp(parseFloat(pi.value) || 0, 0, 1);
        c.stops.sort(function (a, b) { return a[0] - b[0]; });
        refreshStopEditor(); colorize(); updateLegend();
      };
      row.children[3].onclick = function () {
        if (c.stops.length <= 2) return;
        c.stops.splice(i, 1); refreshStopEditor(); colorize(); updateLegend();
      };
      box.appendChild(row);
    });
    var prev = document.createElement('div');
    prev.className = 'stopRow';
    prev.innerHTML = '<div class="bar" style="height:20px"></div>';
    prev.firstChild.style.background = ColorMaps.cssGradient(L, true);
    box.appendChild(prev);
  }

  /**
   * force = true  → stretch to the real data range (the “Auto range” button)
   * force = false → only layers flagged auto follow their natural range
   */
  function autoRangeIfNeeded(force) {
    if (!S.grid) return;
    var c = cfg(), L = currentLayer();
    if (!L) return;
    var r;
    if (force) r = Sens.range(L.values, S.mask);
    else if (c.auto) r = (L.vmin != null && L.vmax != null) ? [L.vmin, L.vmax] : Sens.range(L.values, S.mask);
    else return;
    c.vmin = +(+r[0]).toFixed(3); c.vmax = +(+r[1]).toFixed(3);
    if (!(c.vmax > c.vmin)) c.vmax = c.vmin + 1;
    $('inpVmin').value = c.vmin; $('inpVmax').value = c.vmax;
  }

  function currentLayer() {
    if (!S.grid) return null;
    var name = S.layer;
    if (!S.res && !TERRAIN_LAYERS[name]) name = 'elev';
    if (S.res) return Sens.layer(name, S.res, S.grid, S.der, { trueDispl: parseFloat($('inpTrue').value) || 10 });
    /* terrain-only layers before a compute */
    var n = S.grid.nx * S.grid.ny;
    if (name === 'slope') {
      var s = new Float32Array(n);
      for (var i = 0; i < n; i++) s[i] = S.der.slope[i] * 180 / Math.PI;
      return { values: s, vmin: 0, vmax: 90, label: 'Slope angle', unit: '°' };
    }
    if (name === 'aspect') return { values: S.der.aspect, vmin: 0, vmax: 360, label: 'Aspect', unit: '°' };
    return { values: S.grid.z, vmin: S.grid.zmin, vmax: S.grid.zmax, label: 'Elevation', unit: 'm' };
  }

  /* ------------------------------------------------- colorize */
  function colorize() {
    if (!S.grid) return;
    var L = currentLayer(); if (!L) return;
    S.curLayer = L;                       // cached for the hover read-out
    var c = cfg(), LUT = ColorMaps.buildLUT(c);
    var g = S.grid, n = g.nx * g.ny;
    var out = new Float32Array(n * 3);
    var vmin = c.vmin, vmax = c.vmax, span = (vmax - vmin) || 1;

    var cNo = ColorMaps.hex2rgb($('colNoData').value);
    var cOcc = ColorMaps.hex2rgb($('colOccluded').value);
    var cOut = ColorMaps.hex2rgb($('colOutside').value);
    var cLow = ColorMaps.hex2rgb($('colBelow').value);
    var useVis = S.res && !TERRAIN_LAYERS[S.layer] && S.layer !== 'vis';
    var vis = S.res ? S.res.combined.vis : null;
    var maskOn = $('chkAOI').checked && S.mask;
    var maskBelow = $('chkMaskBelow').checked && (S.layer === 'sens' || S.layer === 'mmres');
    var thr = parseFloat($('inpThresh').value) || 0;
    if (S.layer === 'mmres') thr = thr * (parseFloat($('inpTrue').value) || 10);
    var VISC = Sens.VIS;

    for (var id = 0; id < n; id++) {
      var o = id * 3, r, gg, b;
      var z = g.z[id];
      if (z !== z) { r = cNo[0]; gg = cNo[1]; b = cNo[2]; }
      else {
        var v = L.values[id];
        var code = vis ? vis[id] : VISC.OK;
        if (useVis && code === VISC.SHADOW) { r = cOcc[0]; gg = cOcc[1]; b = cOcc[2]; }
        else if (useVis && code === VISC.OUTSIDE) { r = cOut[0]; gg = cOut[1]; b = cOut[2]; }
        else if (useVis && code === VISC.GRAZING) { r = (cOcc[0] + cOut[0]) / 2; gg = (cOcc[1] + cOut[1]) / 2; b = (cOcc[2] + cOut[2]) / 2; }
        else if (v !== v) { r = cNo[0]; gg = cNo[1]; b = cNo[2]; }
        else if (maskBelow && v < thr) { r = cLow[0]; gg = cLow[1]; b = cLow[2]; }
        else {
          var t = (v - vmin) / span;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          var q = ColorMaps.sample(LUT, t);
          r = q[0]; gg = q[1]; b = q[2];
        }
        if (maskOn && !S.mask[id]) { r = r * 0.32 + cOut[0] * 0.68; gg = gg * 0.32 + cOut[1] * 0.68; b = b * 0.32 + cOut[2] * 0.68; }
      }
      out[o] = r / 255; out[o + 1] = gg / 255; out[o + 2] = b / 255;
    }
    V.setColors(out);
    V.draw();
    updateLegend();
  }

  function updateLegend() {
    if (!S.grid) return;
    var L = currentLayer(); if (!L) return;
    var c = cfg();
    $('legendTitle').innerHTML = L.label + (L.unit ? ' <span class="dim">[' + L.unit + ']</span>' : '');
    ColorMaps.drawColorbar($('cbCanvas'), ColorMaps.buildLUT(c), c.vmin, c.vmax, {
      width: 76, height: 300, ticks: 6,
      marker: (S.layer === 'sens') ? (parseFloat($('inpThresh').value) || null) : null,
      decimals: (c.vmax - c.vmin) >= 50 ? 0 : 2
    });
  }

  /* ------------------------------------------------- overlays */
  function updateOverlays() {
    if (!S.grid) return;
    var g = S.grid, batches = [];
    var x1 = g.x0, x2 = g.x0 + (g.nx - 1) * g.dx;
    var y1 = g.y0, y2 = g.y0 + (g.ny - 1) * g.dy;
    var z1 = g.zmin, z2 = g.zmax;
    var ext = Math.max(x2 - x1, y2 - y1);

    if ($('chkBox').checked) {
      var box = [];
      [[z1], [z2]].forEach(function (zz) {
        var z = zz[0];
        V.seg(box, x1, y1, z, x2, y1, z); V.seg(box, x2, y1, z, x2, y2, z);
        V.seg(box, x2, y2, z, x1, y2, z); V.seg(box, x1, y2, z, x1, y1, z);
      });
      V.seg(box, x1, y1, z1, x1, y1, z2); V.seg(box, x2, y1, z1, x2, y1, z2);
      V.seg(box, x2, y2, z1, x2, y2, z2); V.seg(box, x1, y2, z1, x1, y2, z2);
      batches.push({ verts: box, color: [0.35, 0.42, 0.52, 0.55] });
      /* north arrow + axes at the SW corner */
      var ax = [], al = ext * 0.09;
      V.seg(ax, x1, y1, z1, x1 + al, y1, z1);
      batches.push({ verts: ax, color: [1, 0.35, 0.35, 0.9] });
      var ay = [];
      V.seg(ay, x1, y1, z1, x1, y1 + al, z1);
      V.seg(ay, x1, y1 + al, z1, x1 - al * 0.12, y1 + al * 0.82, z1);
      V.seg(ay, x1, y1 + al, z1, x1 + al * 0.12, y1 + al * 0.82, z1);
      batches.push({ verts: ay, color: [0.4, 1, 0.5, 0.9] });
      var az2 = [];
      V.seg(az2, x1, y1, z1, x1, y1, z1 + al);
      batches.push({ verts: az2, color: [0.45, 0.7, 1, 0.9] });
    }

    /* AOI footprint draped on the surface */
    if ($('chkAOI').checked) {
      var a = aoiObj(), aoi = [];
      var corners = [[a.xmin, a.ymin], [a.xmax, a.ymin], [a.xmax, a.ymax], [a.xmin, a.ymax]];
      for (var k = 0; k < 4; k++) {
        var p = corners[k], q = corners[(k + 1) % 4], N = 24;
        for (var t = 0; t < N; t++) {
          var f0 = t / N, f1 = (t + 1) / N;
          var ax0 = p[0] + (q[0] - p[0]) * f0, ay0 = p[1] + (q[1] - p[1]) * f0;
          var ax1 = p[0] + (q[0] - p[0]) * f1, ay1 = p[1] + (q[1] - p[1]) * f1;
          var z0 = Grid.sampleZ(g, ax0, ay0), zq = Grid.sampleZ(g, ax1, ay1);
          if (z0 !== z0) z0 = g.zmin; if (zq !== zq) zq = g.zmin;
          V.seg(aoi, ax0, ay0, z0 + ext * 0.004, ax1, ay1, zq + ext * 0.004);
        }
      }
      batches.push({ verts: aoi, color: [1, 1, 1, 0.85] });
    }

    /* sensors */
    S.radars.forEach(function (r, i) {
      var col = ColorMaps.hex2rgb(r.color).map(function (v) { return v / 255; });
      var alpha = (r.on === false) ? 0.28 : 1;
      var v = [], s = ext * 0.012;
      /* mast */
      var zt = Grid.sampleZ(g, r.x, r.y);
      if (zt !== zt) zt = r.z - (r.dz || 0);
      V.seg(v, r.x, r.y, zt, r.x, r.y, r.z);
      /* box */
      var c1 = [r.x - s, r.y - s], c2 = [r.x + s, r.y - s], c3 = [r.x + s, r.y + s], c4 = [r.x - s, r.y + s];
      var zb = r.z, zu = r.z + s * 1.4;
      [[zb], [zu]].forEach(function (zz) {
        var z = zz[0];
        V.seg(v, c1[0], c1[1], z, c2[0], c2[1], z); V.seg(v, c2[0], c2[1], z, c3[0], c3[1], z);
        V.seg(v, c3[0], c3[1], z, c4[0], c4[1], z); V.seg(v, c4[0], c4[1], z, c1[0], c1[1], z);
      });
      [c1, c2, c3, c4].forEach(function (c) { V.seg(v, c[0], c[1], zb, c[0], c[1], zu); });
      /* cross-hair up-marker */
      V.seg(v, r.x, r.y, zu, r.x, r.y, zu + s * 1.6);
      batches.push({ verts: v, color: [col[0], col[1], col[2], alpha], noDepth: i === S.sel });

      /* scan footprint of the selected sensor */
      if ($('chkFan').checked && i === S.sel && r.on !== false) {
        var f = [], N2 = 64, R = Math.min(r.rmax, ext * 1.6);
        var a0 = (r.az - r.apAz) * DEG, a1 = (r.az + r.apAz) * DEG;
        var prev = null;
        for (var kk = 0; kk <= N2; kk++) {
          var ang = a0 + (a1 - a0) * kk / N2;
          var px = r.x + Math.sin(ang) * R, py = r.y + Math.cos(ang) * R;
          var pz = Grid.sampleZ(g, px, py);
          if (pz !== pz) pz = g.zmin;
          if (prev) V.seg(f, prev[0], prev[1], prev[2], px, py, pz);
          prev = [px, py, pz];
        }
        var e0x = r.x + Math.sin(a0) * R, e0y = r.y + Math.cos(a0) * R;
        var e1x = r.x + Math.sin(a1) * R, e1y = r.y + Math.cos(a1) * R;
        var z0 = Grid.sampleZ(g, e0x, e0y), z1b = Grid.sampleZ(g, e1x, e1y);
        V.seg(f, r.x, r.y, r.z, e0x, e0y, z0 === z0 ? z0 : g.zmin);
        V.seg(f, r.x, r.y, r.z, e1x, e1y, z1b === z1b ? z1b : g.zmin);
        batches.push({ verts: f, color: [col[0], col[1], col[2], 0.4] });
      }
    });

    /* probe: LOS + movement vectors */
    if (S.probe) {
      var p = S.probe, r0 = S.radars[S.sel];
      var los = [];
      if (r0) V.seg(los, r0.x, r0.y, r0.z, p.x, p.y, p.z);
      batches.push({ verts: los, color: [1, 1, 1, 0.75], noDepth: true });
      var mk = [], m = ext * 0.01;
      V.seg(mk, p.x - m, p.y, p.z, p.x + m, p.y, p.z);
      V.seg(mk, p.x, p.y - m, p.z, p.x, p.y + m, p.z);
      V.seg(mk, p.x, p.y, p.z - m, p.x, p.y, p.z + m);
      batches.push({ verts: mk, color: [1, 1, 0.2, 1], noDepth: true });

      if ($('chkVec').checked) {
        var id = Grid.nodeIndex(g, p.x, p.y);
        if (id >= 0) {
          var fx = S.der.fx[id], fy = S.der.fy[id];
          var mag2 = fx * fx + fy * fy, mag = Math.sqrt(mag2), Lv = ext * 0.05;
          function arrow(vx, vy, vz, col2) {
            var arr = [], n2 = Math.hypot(vx, vy, vz) || 1;
            var ex = p.x + vx / n2 * Lv, ey = p.y + vy / n2 * Lv, ez = p.z + vz / n2 * Lv;
            V.seg(arr, p.x, p.y, p.z, ex, ey, ez);
            batches.push({ verts: arr, color: col2, noDepth: true });
          }
          if (mag > 1e-9) {
            var LL = Math.sqrt(mag2 + mag2 * mag2);
            arrow(-fx / LL, -fy / LL, -mag2 / LL, [1, 0.32, 0.32, 1]);   // steepest
            arrow(-fx / mag, -fy / mag, 0, [0.3, 0.85, 0.35, 1]);        // horizontal
          }
          arrow(0, 0, -1, [0.2, 0.6, 1, 1]);                             // vertical
          if (mode() === 'custom') {
            var cv = Sens.customVec(parseFloat($('inpCustAz').value) || 0, parseFloat($('inpCustPl').value) || 0);
            arrow(cv[0], cv[1], cv[2], [0.88, 0.25, 0.98, 1]);
          }
        }
      }
    }

    V.setLines(batches);
    V.draw();
  }

  /* ------------------------------------------------ pick modes */
  function setPickMode(m) {
    S.pickMode = m; S.pickBuf = [];
    var b = $('pickBanner');
    if (m) {
      b.classList.remove('hidden');
      b.textContent = m === 'radar'
        ? 'Click on the model to place “' + (S.radars[S.sel] ? S.radars[S.sel].name : 'sensor') + '”  (Esc to cancel)'
        : 'Click the first AOI corner  (Esc to cancel)';
    } else b.classList.add('hidden');
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setPickMode(null); });

  function onCanvasClick(hit) {
    if (!hit) { if (!S.pickMode) { S.probe = null; $('hudReadout').classList.add('hidden'); updateOverlays(); } return; }
    if (S.pickMode === 'radar') {
      var r = S.radars[S.sel];
      r.x = hit.x; r.y = hit.y; r.snap = true;
      snapRadar(r);
      loadRadarForm(); renderRadarTable(); setPickMode(null);
      updateOverlays(); invalidate();
      status('Sensor moved to ' + fmt(r.x, 1) + ', ' + fmt(r.y, 1) + ', ' + fmt(r.z, 1));
      return;
    }
    if (S.pickMode === 'aoi') {
      S.pickBuf.push(hit);
      if (S.pickBuf.length === 1) { $('pickBanner').textContent = 'Click the opposite AOI corner'; return; }
      var a = S.pickBuf[0], b = S.pickBuf[1];
      $('aoiXmin').value = fmt(Math.min(a.x, b.x), 0); $('aoiXmax').value = fmt(Math.max(a.x, b.x), 0);
      $('aoiYmin').value = fmt(Math.min(a.y, b.y), 0); $('aoiYmax').value = fmt(Math.max(a.y, b.y), 0);
      $('chkAOI').checked = true;
      setPickMode(null);
      S.mask = Sens.aoiMask(S.grid, S.der, aoiObj());
      colorize(); updateOverlays(); if (S.res) restat(); invalidate();
      return;
    }
    S.probe = hit;
    showReadout(hit);
    updateOverlays();
  }

  function onCanvasHover(ev) {
    if (!S.grid || S.busy) return;
    var hit = V.pickAt(ev);
    if (!hit) { $('statusRight').textContent = ''; return; }
    var id = Grid.nodeIndex(S.grid, hit.x, hit.y);
    var L = S.curLayer;
    var txt = 'X ' + fmt(hit.x, 1) + '  Y ' + fmt(hit.y, 1) + '  Z ' + fmt(hit.z, 1);
    if (id >= 0 && L) {
      txt += '   |   slope ' + fmt(S.der.slope[id] * 180 / Math.PI, 1) + '°  az ' + fmt(S.der.aspect[id], 0) + '°';
      var v = L.values[id];
      if (v === v) txt += '   |   ' + L.label + ' ' + fmt(v, 3) + (L.unit || '');
    }
    $('statusRight').textContent = txt;
  }

  function showReadout(hit) {
    var g = S.grid, id = Grid.nodeIndex(g, hit.x, hit.y);
    if (id < 0) return;
    var r = S.radars[S.sel];
    var slope = S.der.slope[id] * 180 / Math.PI, asp = S.der.aspect[id];
    var html = '<b>PROBE</b><br>' +
      'X ' + fmt(hit.x, 2) + '<br>Y ' + fmt(hit.y, 2) + '<br>Z ' + fmt(hit.z, 2) + ' m<br>' +
      'slope ' + fmt(slope, 1) + '°  dip dir ' + fmt(asp, 0) + '°<br>';
    if (S.res) {
      var C = S.res.combined, code = C.vis[id];
      var st = ['no data', 'visible', 'SHADOWED', 'outside scan', 'grazing'][code] || '—';
      var f = parseFloat($('inpTrue').value) || 10;
      html += '<hr style="border:0;border-top:1px solid #2c3542;margin:5px 0">' +
        '<b>sensitivity ' + fmt(C.sens[id], 3) + '</b><br>' +
        'amplitude ' + fmt(C.amp[id], 3) + '<br>' +
        'range ' + fmt(C.range[id], 1) + ' m<br>' +
        'status ' + st + '<br>' +
        f + ' mm true → <b>' + fmt(C.sens[id] * f, 2) + ' mm</b> LOS';
      if (!C.single && C.which[id] === C.which[id]) {
        var w = S.res.perRadar[C.which[id]];
        if (w) html += '<br>best: ' + w.radar.name;
      }
    } else if (r) {
      var dx = hit.x - r.x, dy = hit.y - r.y, dz = hit.z - r.z;
      html += 'range ' + fmt(Math.hypot(dx, dy, dz), 1) + ' m';
    }
    $('hudReadout').innerHTML = html;
    $('hudReadout').classList.remove('hidden');
  }

  /* ------------------------------------------------ statistics */
  function updateStats() {
    if (!S.res) { $('statsBox').textContent = 'Compute the sensitivity map to see statistics.'; drawHist(null); return; }
    var st = S.res.stats, g = S.grid, ha = 1 / 10000;
    var pct = function (v) { return (100 * v).toFixed(1) + '%'; };
    $('statsBox').innerHTML =
      'analysed cells   <b>' + fmtInt(st.nData) + '</b>  (' + fmt(st.areaData * ha, 1) + ' ha)\n' +
      'visible          <b class="g">' + fmtInt(st.nVis) + '</b>  ' + pct(st.coverage) + '\n' +
      '  shadowed       ' + fmtInt(st.nShadow) + (st.nGraz ? '   grazing ' + fmtInt(st.nGraz) : '') + '\n' +
      '  outside scan   ' + fmtInt(st.nOutside) + '\n' +
      'sens ≥ ' + fmt(S.res.opts.threshold, 2) + '     <b>' + fmtInt(st.nAbove) + '</b>  ' + pct(st.usable) +
      '  (' + fmt(st.areaAbove * ha, 1) + ' ha)\n' +
      'mean / median    <b>' + fmt(st.mean, 3) + '</b> / ' + fmt(st.p50, 3) + '\n' +
      'p10 / p90        ' + fmt(st.p10, 3) + ' / ' + fmt(st.p90, 3) + '\n' +
      'mean amplitude   ' + fmt(st.meanAmp, 3) + '\n' +
      'mean range       ' + fmt(st.meanRange, 0) + ' m';
    drawHist(st.hist);
  }

  function layoutHist() { var c = $('histCanvas'); c.width = c.clientWidth * (window.devicePixelRatio || 1); drawHist(S.res ? S.res.stats.hist : null); }

  function drawHist(h) {
    var cv = $('histCanvas'), dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(60, cv.clientWidth * dpr); cv.height = 110 * dpr;
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = cv.width / dpr, H = cv.height / dpr;
    g.clearRect(0, 0, W, H);
    if (!h) {
      g.fillStyle = '#5a6472'; g.font = '11px Segoe UI'; g.textAlign = 'center';
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
    /* threshold marker */
    var thr = parseFloat($('inpThresh').value) || 0;
    g.strokeStyle = '#fff'; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(thr * W, 2); g.lineTo(thr * W, H - pad); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#8f9bab'; g.font = '9px Consolas'; g.textAlign = 'left';
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
        '<td>' + o.r.name + '</td>' +
        '<td class="n' + (i === bi ? ' best' : '') + '">' + (100 * o.s.usable).toFixed(1) + '%</td>' +
        '<td class="n">' + (100 * o.s.coverage).toFixed(1) + '%</td>' +
        '<td class="n">' + fmt(o.s.mean, 3) + '</td>' +
        '<td class="n">' + fmt(o.s.meanRange, 0) + '</td></tr>';
    });
    t.innerHTML = html;
  }

  /* =================================================== EXPORT */
  function bindExport() {
    $('btnExportPNG').onclick = exportPNG;
    $('btnExportCSV').onclick = exportCSV;
    $('btnExportASC').onclick = exportASC;
    $('btnSaveProj').onclick = saveProject;
    $('btnLoadProj').onclick = function () { $('hiddenProj').click(); };
    $('hiddenProj').onchange = function () {
      var f = this.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { loadProject(fr.result); };
      fr.readAsText(f); this.value = '';
    };
  }

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function exportPNG() {
    if (!S.grid) return;
    var L = currentLayer(), c = cfg();
    var out = V.snapshot(function (g, W, H, sc) {
      /* title block */
      g.font = (14 * sc) + 'px Segoe UI, sans-serif';
      g.fillStyle = '#0d1014dd';
      g.fillRect(10 * sc, 10 * sc, 430 * sc, 66 * sc);
      g.strokeStyle = '#2c3542'; g.strokeRect(10 * sc, 10 * sc, 430 * sc, 66 * sc);
      g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('SensiMap — ' + L.label, 20 * sc, 18 * sc);
      g.font = (11 * sc) + 'px Consolas, monospace';
      g.fillStyle = '#9fb0c4';
      var r = S.radars[S.sel];
      var l2 = S.res ? ('mode ' + S.res.opts.mode + '   sensors ' +
        S.radars.filter(function (q) { return q.on !== false; }).length +
        '   threshold ' + fmt(S.res.opts.threshold, 2)) : 'terrain view';
      g.fillText(l2, 20 * sc, 40 * sc);
      g.fillText(r ? ('sensor ' + r.name + '  ' + fmt(r.x, 1) + ', ' + fmt(r.y, 1) + ', ' + fmt(r.z, 1)) : '', 20 * sc, 56 * sc);
      /* colour bar */
      ColorMaps.drawColorbarInto(g, W - 96 * sc, 60 * sc, 26 * sc, 300 * sc,
        ColorMaps.buildLUT(c), c.vmin, c.vmax, L.label);
    });
    out.toBlob(function (b) { download('sensimap_' + S.layer + '_' + stamp() + '.png', b); });
  }

  function exportCSV() {
    if (!S.grid) { return; }
    var g = S.grid, n = g.nx * g.ny, res = S.res;
    var rows = ['x,y,z,slope_deg,aspect_deg' + (res ? ',range_m,sensitivity,amplitude,visible,measurable_mm' : '')];
    var f = parseFloat($('inpTrue').value) || 10;
    var maskOn = $('chkAOI').checked && S.mask;
    for (var j = 0; j < g.ny; j++) {
      for (var i = 0; i < g.nx; i++) {
        var id = j * g.nx + i;
        if (g.z[id] !== g.z[id]) continue;
        if (maskOn && !S.mask[id]) continue;
        var line = (g.x0 + i * g.dx).toFixed(3) + ',' + (g.y0 + j * g.dy).toFixed(3) + ',' + g.z[id].toFixed(3) +
          ',' + (S.der.slope[id] * 180 / Math.PI).toFixed(2) + ',' + S.der.aspect[id].toFixed(1);
        if (res) {
          var C = res.combined;
          line += ',' + (C.range[id] === C.range[id] ? C.range[id].toFixed(2) : '') +
            ',' + (C.sens[id] === C.sens[id] ? C.sens[id].toFixed(4) : '') +
            ',' + (C.amp[id] === C.amp[id] ? C.amp[id].toFixed(4) : '') +
            ',' + (C.vis[id] === Sens.VIS.OK ? 1 : 0) +
            ',' + (C.sens[id] === C.sens[id] ? (C.sens[id] * f).toFixed(3) : '');
        }
        rows.push(line);
      }
    }
    download('sensimap_' + stamp() + '.csv', new Blob([rows.join('\n')], { type: 'text/csv' }));
  }

  function exportASC() {
    if (!S.grid) return;
    var L = currentLayer(); if (!L) return;
    var g = S.grid, nod = -9999;
    var head = 'ncols ' + g.nx + '\nnrows ' + g.ny + '\nxllcenter ' + g.x0 + '\nyllcenter ' + g.y0 +
      '\ncellsize ' + g.dx + '\nNODATA_value ' + nod + '\n';
    var parts = [head];
    for (var j = g.ny - 1; j >= 0; j--) {
      var row = new Array(g.nx);
      for (var i = 0; i < g.nx; i++) {
        var id = j * g.nx + i, v = L.values[id];
        var ok = (v === v) && (!S.res || TERRAIN_LAYERS[S.layer] || S.res.combined.vis[id] === Sens.VIS.OK);
        row[i] = ok ? (+v).toFixed(4) : nod;
      }
      parts.push(row.join(' ') + '\n');
    }
    download('sensimap_' + S.layer + '_' + stamp() + '.asc', new Blob(parts, { type: 'text/plain' }));
  }

  function exportScale() {
    var out = { layer: S.layer, config: cfg() };
    download('sensimap_scale_' + S.layer + '.json', new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  }
  function importScale() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = function () {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(fr.result);
          var c = o.config || o;
          LC[S.layer] = {
            preset: c.preset || 'ids-green', stops: c.stops, reverse: !!c.reverse,
            bands: c.bands || 0, gamma: c.gamma || 1, vmin: c.vmin, vmax: c.vmax, auto: false
          };
          syncColorForm(); colorize(); updateLegend();
          status('Colour scale imported.');
        } catch (e) { status('Bad scale file: ' + e.message); }
      };
      fr.readAsText(inp.files[0]);
    };
    inp.click();
  }

  function saveProject() {
    var proj = {
      app: 'SensiMap', version: 1,
      radars: S.radars, sel: S.sel,
      sens: {
        mode: mode(), custAz: +$('inpCustAz').value, custPl: +$('inpCustPl').value,
        occlusion: $('chkOcclusion').checked, occAcc: $('selOccAcc').value,
        occTol: +$('inpOccTol').value, grazing: $('chkGrazing').checked, graz: +$('inpGraz').value,
        threshold: +$('inpThresh').value, trueDispl: +$('inpTrue').value,
        combine: $('selCombine').value
      },
      aoi: aoiObj(), layer: S.layer, colors: LC,
      grid: { cell: $('inpCell').value, target: +$('inpTarget').value, search: $('selSearch').value, interp: $('selInterp').value },
      view: { yaw: V.cam.yaw, pitch: V.cam.pitch, dist: V.cam.dist, target: V.cam.target, ortho: V.cam.ortho, opt: V.opt }
    };
    download('sensimap_project_' + stamp() + '.json', new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json' }));
  }

  function loadProject(txt) {
    var p;
    try { p = JSON.parse(txt); } catch (e) { status('Bad project file.'); return; }
    if (p.radars) { S.radars = p.radars; S.sel = Math.min(p.sel || 0, S.radars.length - 1); }
    if (p.sens) {
      var q = p.sens;
      var rb = document.querySelector('input[name=smode][value=' + q.mode + ']');
      if (rb) rb.checked = true;
      $('customVec').style.display = q.mode === 'custom' ? '' : 'none';
      $('inpCustAz').value = q.custAz; $('inpCustPl').value = q.custPl;
      $('chkOcclusion').checked = !!q.occlusion; $('selOccAcc').value = q.occAcc;
      $('inpOccTol').value = q.occTol; $('chkGrazing').checked = !!q.grazing; $('inpGraz').value = q.graz;
      $('inpThresh').value = q.threshold; $('inpTrue').value = q.trueDispl;
      $('selCombine').value = q.combine || 'selected';
    }
    if (p.aoi) {
      $('chkAOI').checked = !!p.aoi.on;
      $('aoiXmin').value = p.aoi.xmin; $('aoiXmax').value = p.aoi.xmax;
      $('aoiYmin').value = p.aoi.ymin; $('aoiYmax').value = p.aoi.ymax;
      $('aoiZmin').value = p.aoi.zmin; $('aoiZmax').value = p.aoi.zmax;
      $('aoiSlopeMin').value = p.aoi.slopeMin; $('aoiSlopeMax').value = p.aoi.slopeMax;
    }
    if (p.colors) Object.keys(p.colors).forEach(function (k) { if (LC[k]) LC[k] = p.colors[k]; });
    if (p.grid) {
      $('inpCell').value = p.grid.cell || ''; $('inpTarget').value = p.grid.target || 320;
      $('selSearch').value = p.grid.search || 2; $('selInterp').value = p.grid.interp || 'idw';
    }
    if (p.layer) { S.layer = p.layer; $('selLayer').value = p.layer; }
    if (p.view) {
      V.cam.yaw = p.view.yaw; V.cam.pitch = p.view.pitch; V.cam.dist = p.view.dist;
      V.cam.target = p.view.target; V.cam.ortho = !!p.view.ortho;
      if (p.view.opt) {
        Object.keys(p.view.opt).forEach(function (k) { V.opt[k] = p.view.opt[k]; });
        $('inpOpacity').value = V.opt.alpha; $('inpZScale').value = V.opt.zScale;
        $('inpSunAz').value = V.opt.sunAz; $('inpSunEl').value = V.opt.sunEl;
        $('inpShade').value = V.opt.shade; $('chkWire').checked = !!V.opt.wire;
        $('selProjection').value = V.cam.ortho ? 'ortho' : 'persp';
      }
    }
    renderRadarTable(); loadRadarForm(); syncColorForm();
    if (S.grid) {
      S.radars.forEach(snapRadar);
      S.mask = Sens.aoiMask(S.grid, S.der, aoiObj());
      colorize(); updateOverlays();
    }
    status('Project loaded — press “Compute sensitivity map”.');
    badge('project loaded', 'busy');
  }

  /* ---------------------------------------------------- start */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
