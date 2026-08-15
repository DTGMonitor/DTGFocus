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
    clip: { mode: 'off', axis: 2, centre: NaN, thick: NaN },
    clipSyncing: false,
    pickMode: null, pickBuf: [],
    probe: null,
    busy: false,
    lastStatsHtml: ''
  };

  /* Attachment point for optional add-on modules (radar-ui.js). They need two
     things ui.js cannot anticipate: to take over canvas clicks while a
     tie-point is being placed, and to watch ordinary probe clicks so they can
     answer "what covers this spot". Kept as a tiny surface so ui.js never has
     to know what the add-on actually does. */
  var EXT = { pick: null, cancel: null, probe: [] };

  var LAYER_DEFAULTS = {
    sens: { preset: 'green', vmin: 0, vmax: 1 },
    amp: { preset: 'amplitude', vmin: 0, vmax: 1 },
    vis: { preset: 'rdylgn', vmin: 0, vmax: 1, bands: 2 },
    range: { preset: 'viridis', auto: true },
    slope: { preset: 'turbo', vmin: 0, vmax: 90 },
    aspect: { preset: 'aspect', vmin: 0, vmax: 360 },
    elev: { preset: 'terrain', auto: true },
    which: { preset: 'sensors', auto: true, discrete: true },
    mmres: { preset: 'green', auto: true }
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
    window.addEventListener('platformtheme', function () { updateLegend(); layoutHist(); });

    buildPresetList();
    bindData();
    bindRadar();
    bindSens();
    bindAOI();
    bindDisplay();
    bindClip();
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
  /* counts may be grouped for readability … */
  function fmtInt(v) { return (v == null || v !== v) ? '—' : Math.round(v).toLocaleString(); }
  /* … but survey coordinates never are: a locale that groups with "." turns
     57996 into "57.996", which reads as 58 metres. Plain digits only. */
  function fmtCoord(v) { return (v == null || v !== v) ? '—' : String(Math.round(v)); }

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
        addRadar({ name: 'R1 – low bench', x: 512000, y: 7458000 - 560, color: '#FFC000' });
        addRadar({ name: 'R2 – high crest', x: 512000, y: 7458000 - 860, color: '#05CAC8' });
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

  /** first bytes as printable text + hex — the last-resort “what IS this file” */
  function signature(buf) {
    var b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 48));
    var asc = '', hex = [];
    for (var i = 0; i < b.length; i++) {
      asc += (b[i] >= 32 && b[i] < 127) ? String.fromCharCode(b[i]) : '·';
      hex.push(('0' + b[i].toString(16)).slice(-2));
    }
    return { ascii: asc, hex: hex.join(' ') };
  }

  function readFiles(list) {
    var files = Array.prototype.slice.call(list);
    var pending = files.length;
    files.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function () {
        /* Work from bytes. A JS string caps near 512 M characters, so a large
           DXF must never be decoded whole — it is streamed from the buffer. */
        var buf = fr.result;
        var head = Parsers.decodeText(buf.slice(0, 8192));
        var isDxf = Parsers.isBinaryDXF(buf) ||
          /\.dxf$/i.test(f.name) ||
          /^\s*0\s*[\r\n]+\s*SECTION/i.test(head);
        if (isDxf) {
          var brec = { name: f.name, text: '', type: 'dxf', dataset: null, note: '', size: f.size, head: signature(buf) };
          try {
            brec.dataset = Parsers.parseDXFBuffer(buf, f.name);
            brec.note = brec.dataset.note;
          } catch (e) { brec.note = 'error: ' + e.message; }
          S.files.push(brec);
          if (--pending === 0) afterRead();
          return;
        }
        /* every other reader needs text, which the engine cannot hold past ~512 MB */
        if (buf.byteLength > 400 * 1024 * 1024) {
          S.files.push({
            name: f.name, text: '', type: 'toobig', dataset: null, size: f.size,
            tooBig: true, head: signature(buf),
            note: (buf.byteLength / 1048576).toFixed(0) + ' MB — too large to read as text'
          });
          if (--pending === 0) afterRead();
          return;
        }
        var txt = Parsers.decodeText(buf);

        /* A radar deformation export is a CSV and would otherwise be read as a
           survey point cloud — its Easting/Northing columns are radar-local
           metres, so it would land beside the pit rather than on it. Hand it to
           the radar module instead, before the terrain readers see it. */
        if (window.RadarUI && RadarScan.sniff(txt)) {
          try { RadarUI.acceptFile(f.name, txt); }
          catch (e) { status('Could not read ' + f.name + ': ' + e.message); }
          if (--pending === 0) afterRead();
          return;
        }

        var type = Parsers.sniff(txt, f.name);
        var rec = { name: f.name, text: txt, type: type, dataset: null, note: '', size: f.size, head: signature(buf) };
        try {
          if (type === 'binary') {
            rec.note = 'binary file — not readable as text';
            rec.binary = true;
          }
          else if (type === 'dxf') { rec.dataset = Parsers.parseDXF(txt, f.name); }
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
      fr.readAsArrayBuffer(f);
    });
    status('Reading ' + files.length + ' file(s)…');
  }

  function afterRead() {
    renderFileList();
    var big = S.files.filter(function (f) { return f.tooBig; });
    if (big.length) {
      $('gridInfo').innerHTML = '<span class="w"><b>' + big[0].name + ' is ' +
        (big[0].size / 1048576).toFixed(0) + ' MB.</b> Only DXF is streamed from disk; every ' +
        'other reader needs the file as text, and a browser cannot hold a string beyond about ' +
        '512 MB. Export a smaller area, decimate the surface, or convert it to DXF.</span>';
      status(big[0].name + ' is too large for a text reader — use DXF, or export a smaller area.');
      badge('file too large', 'busy');
      return;
    }
    var bin = S.files.filter(function (f) { return f.binary; });
    if (bin.length) {
      var msg = '<span class="w"><b>' + bin[0].name + ' is a binary file.</b> SensiMap reads ' +
        'text formats only: DXF, Surpac .str/.dtm, ASCII XYZ/CSV and ESRI ASCII grid. ' +
        'Binary triangulations (Vulcan .00t, Datamine .dm, Micromine .tridb, binary DXF, ' +
        'GLB/PLY) have to be exported to one of those first — Gem4D, Surpac and Vulcan can ' +
        'all write DXF.</span>';
      $('gridInfo').innerHTML = msg;
      status(bin[0].name + ' is binary — export it as DXF or ASCII first.');
      badge('unsupported file', 'busy');
      return;
    }
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

    /* an index-only .dtm has no coordinates in ANY column — say so loudly,
       otherwise mapping node numbers builds a plausible-looking fake surface */
    var note = $('asciiNote');
    if (Parsers.isSurpacDTM(file.text) && Parsers.dtmRecordsAreIndices(file.text)) {
      file.indexDtm = true;
      note.innerHTML = '<span class="w"><b>These are not coordinates.</b> This is a Surpac ' +
        'triangle list: column 1 is the triangle id, columns 2–4 are <b>node numbers</b> ' +
        'referencing the .str, and 5–7 are neighbour triangle ids (0 = boundary). No ' +
        'easting, northing or level exists anywhere in this file. Any mapping you choose ' +
        'here can only produce a meaningless surface — you need the matching .str.</span>';
      note.classList.remove('hidden');
    } else {
      file.indexDtm = false;
      note.classList.add('hidden');
    }

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

  /** re-read a file as free-format ASCII and open the column mapper on it */
  function retryAsAscii(f) {
    f.dataset = null; f.pending = true; f.type = 'ascii';
    f.note = 're-read as XYZ text';
    renderFileList();
    showPreview(f);
    applyAsciiMapping(true);
    status('Re-read as plain text — check the column mapping in panel 1 against the preview.');
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
        f.dataset.indexWarning = !!f.indexDtm;   // carried through to the build warning
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
          targetCells: parseInt($('inpTarget').value, 10) || 1000,
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
      var html = '<span class="w">' + e.message + '</span>';
      /* a .dtm with no .str is not a dead end — let the user look inside it */
      var triFile = S.files.filter(function (f) {
        return f.dataset && f.dataset.kind === 'tri-index';
      })[0];
      var hasPts = S.files.some(function (f) {
        return f.dataset && (f.dataset.pts || []).length;
      });
      /* say WHY a text file yielded nothing, instead of only that it did */
      if (!hasPts && !triFile) {
        S.files.forEach(function (f) {
          if (!f.dataset || (f.dataset.pts || []).length) return;
          if (f.dataset.diag) {
            html += '\n<span class="w">' + f.name + ': ' +
              Parsers.explainEmpty(f.dataset.diag, { skip: parseInt($('inpSkip').value, 10) || 0 }) +
              '</span>';
          } else if (f.dataset.counts) {
            html += '\n<span class="w">' + f.name + ': ' + Parsers.explainDXF(f.dataset) + '</span>';
          }
          /* nothing recognised at all — show what the file actually starts with */
          if (f.head && (!f.dataset.counts || !Object.keys(f.dataset.counts).length)) {
            html += '\n<span class="dim">first bytes: <code>' +
              f.head.ascii.replace(/</g, '&lt;') + '</code>\n' + f.head.hex + '</span>';
          }
        });
      }
      $('gridInfo').innerHTML = html;
      if (triFile && !hasPts) {
        var b = document.createElement('button');
        b.className = 'wide'; b.style.marginTop = '8px';
        b.textContent = 'No .str? Read this .dtm as plain text →';
        b.onclick = function () { retryAsAscii(triFile); };
        $('gridInfo').appendChild(b);
      }
      return;
    }
    var g = S.grid, ms = (performance.now() - t0).toFixed(0);
    S.res = null; S.probe = null;
    $('hudReadout').classList.add('hidden');

    /* warn when the raster is too coarse to hold the bench geometry */
    var warn = '';
    if (dss.some(function (d) { return d.indexWarning; })) warn +=
      '<span class="w"><b>NOT A REAL SURFACE.</b> This model was built from Surpac triangle ' +
      'node numbers, not survey coordinates. Every value below is meaningless — load the ' +
      'matching .str file.</span>\n';
    if (g.dropped) warn += '<span class="w">' + fmtInt(g.dropped) +
      ' triangles ignored — node numbers outside the .str (wrong file pair?)</span>\n';
    if (g.nTris > 0 && g.dx > 4) warn += '<span class="w">cell ' + fmt(g.dx, 1) +
      ' m may smooth out benches — raise “Target cells” or set “Cell size” to resolve them</span>\n';

    var W = (g.nx - 1) * g.dx, H = (g.ny - 1) * g.dy;
    var empty = 100 - 100 * g.valid / (g.nx * g.ny);
    if (empty > 25) warn += '<span class="w">' + empty.toFixed(0) +
      '% of the bounding box has no data — normal for a non-rectangular survey ' +
      'outline; those cells draw as background</span>\n';

    $('gridInfo').innerHTML = warn +
      '<b>' + g.nx + ' × ' + g.ny + '</b> cells @ <b>' + fmt(g.dx, 2) + ' m</b>  (' + fmtInt(g.nx * g.ny) + ' nodes)\n' +
      'valid ' + (100 * g.valid / (g.nx * g.ny)).toFixed(1) + '%   source: ' + g.method +
      (g.nTris ? '  (' + fmtInt(g.nTris) + ' tri)' : '') + '\n' +
      'X ' + fmtCoord(g.x0) + ' → ' + fmtCoord(g.x0 + W) + '   (' + fmtCoord(W) + ' m)\n' +
      'Y ' + fmtCoord(g.y0) + ' → ' + fmtCoord(g.y0 + H) + '   (' + fmtCoord(H) + ' m)\n' +
      'Z ' + fmt(g.zmin, 1) + ' → ' + fmt(g.zmax, 1) + ' m   (' + ms + ' ms)';

    V.setGrid(g, S.der);
    /* a new model resets the clip box to its extent */
    S.clip.centre = NaN; S.clip.thick = NaN;
    setClipMode(S.clip.mode);
    setAOIFull();
    if (!S.radars.length) {
      addRadar({ name: 'Radar 1', x: g.x0 + (g.nx - 1) * g.dx / 2, y: g.y0 + g.dy * 2, color: '#FFC000' });
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
        color: ['#FFC000', '#05CAC8', '#E63946', '#00B050', '#8B5CF6', '#E97132'][S.radars.length % 6]
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

    ['rName', 'rColor', 'rX', 'rY', 'rZ', 'rDz', 'rAz', 'rEl', 'rApAz', 'rApEl', 'rRmin', 'rRmax']
      .forEach(function (id) { $(id).oninput = saveRadarForm; });
    ['chkSnap', 'chkAutoAim'].forEach(function (id) { $(id).onchange = saveRadarForm; });
    $('selCombine').onchange = function () {
      if ($('selCombine').value === 'which') { S.layer = 'which'; $('selLayer').value = 'which'; }
      invalidate(); if (S.res) recompute();
    };
  }

  function addRadar(o) {
    var g = S.grid;
    var r = {
      name: o.name || 'Radar', color: o.color || '#FFC000',
      x: o.x || 0, y: o.y || 0, z: o.z != null ? o.z : 0, dz: o.dz != null ? o.dz : 3,
      snap: o.snap !== false, az: o.az || 0, el: o.el || 0, apAz: o.apAz != null ? o.apAz : 90,
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
      /* tilt the antenna at the centre of the model too, so a narrow
         elevation aperture still covers the slope */
      var cz = Grid.sampleZ(g, cx, cy);
      if (cz !== cz) cz = (g.zmin + g.zmax) / 2;
      var hor = Math.hypot(cx - r.x, cy - r.y);
      r.el = hor > 1 ? Math.round(Math.atan2(cz - r.z, hor) / DEG) : 0;
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
    /* the form shows TOTAL scan widths; the model stores half-angles */
    $('rAz').value = fmt(r.az, 0); $('rEl').value = fmt(r.el || 0, 0);
    $('rApAz').value = fmt(r.apAz * 2, 0); $('rApEl').value = fmt(r.apEl * 2, 0);
    $('rRmin').value = r.rmin; $('rRmax').value = r.rmax;
    $('chkAutoAim').checked = r.autoAim;
    $('rZ').disabled = r.snap;
    $('rAz').disabled = r.autoAim; $('rEl').disabled = r.autoAim;
    updateRadarNote();
  }
  function saveRadarForm() {
    var r = S.radars[S.sel]; if (!r) return;
    r.name = $('rName').value; r.color = $('rColor').value;
    r.x = parseFloat($('rX').value) || 0; r.y = parseFloat($('rY').value) || 0;
    r.dz = parseFloat($('rDz').value) || 0;
    r.snap = $('chkSnap').checked; r.autoAim = $('chkAutoAim').checked;
    if (!r.snap) r.z = parseFloat($('rZ').value) || 0;
    /* form = total width, model = half-angle. numOr keeps a typed 0 as 0
       instead of silently snapping back to the default. */
    r.apAz = clamp(numOr('rApAz', 180) / 2, 1, 180);
    r.apEl = clamp(numOr('rApEl', 90) / 2, 1, 90);
    r.rmin = Math.max(0, numOr('rRmin', 0));
    r.rmax = Math.max(r.rmin + 1, numOr('rRmax', 1000));
    if (!r.autoAim) { r.az = numOr('rAz', 0); r.el = clamp(numOr('rEl', 0), -90, 90); }
    snapRadar(r);
    $('rZ').disabled = r.snap;
    $('rAz').disabled = r.autoAim; $('rEl').disabled = r.autoAim;
    $('rZ').value = fmt(r.z, 2);
    $('rAz').value = fmt(r.az, 0); $('rEl').value = fmt(r.el || 0, 0);
    updateRadarNote();
    renderRadarTable(); updateOverlays(); invalidate();
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /** how far a sensor sits above the terrain; negative = underground */
  function clearance(r) {
    if (!S.grid || !r) return NaN;
    var zt = Grid.sampleZ(S.grid, r.x, r.y);
    return zt === zt ? r.z - zt : NaN;
  }

  /** a buried antenna makes every line of sight start inside rock */
  function updateRadarNote() {
    var el = $('rNote'), r = S.radars[S.sel];
    if (!r || !S.grid) { el.classList.add('hidden'); return; }
    var zt = Grid.sampleZ(S.grid, r.x, r.y), c = clearance(r), msg = '';
    if (zt !== zt) {
      msg = '<span class="w"><b>Sensor is outside the surveyed area.</b> There is no terrain ' +
        'beneath it, so it cannot be levelled automatically. Move it over the model, or ' +
        'set Level Z by hand.</span>';
    } else if (c < -0.05) {
      msg = '<span class="w"><b>Sensor is ' + fmt(-c, 1) + ' m BELOW the terrain.</b> ' +
        'The surface here is ' + fmt(zt, 1) + ' m. Every line of sight starts underground, ' +
        'so the whole model reads as shadowed and coverage will be 0%. ' +
        'Tick “Z = terrain + antenna height”, or raise Level Z above ' + fmt(zt, 1) + '.</span>';
    }
    if (msg) { el.innerHTML = msg; el.classList.remove('hidden'); }
    else el.classList.add('hidden');
  }
  /** value of a numeric field, falling back only when it is blank or unparseable
      — `parseFloat(x) || def` would throw away a deliberate 0 */
  function numOr(id, def) {
    var v = parseFloat($(id).value);
    return isFinite(v) ? v : def;
  }

  /* ============================================ 3. SENSITIVITY */
  function bindSens() {
    Array.prototype.forEach.call(document.querySelectorAll('input[name=smode]'), function (el) {
      el.onchange = function () {
        $('customVec').style.display = (mode() === 'custom') ? '' : 'none';
        invalidate();
      };
    });
    $('customVec').style.display = 'none';
    syncCustomForm();
    $('chkCustRel').onchange = function () { syncCustomForm(); invalidate(); };
    ['inpCustAz', 'inpCustPl', 'inpCustOff', 'chkOcclusion', 'selOccAcc', 'inpOccTol', 'chkGrazing', 'inpGraz'].forEach(function (id) {
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
  /** typed trend+plunge, or the per-cell offset from the steepest line */
  function custRel() { return $('chkCustRel').checked; }
  function syncCustomForm() {
    $('customAbs').classList.toggle('hidden', custRel());
    $('customOff').classList.toggle('hidden', !custRel());
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
      custRel: custRel(),
      custOff: numOr('inpCustOff', 0),
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
    c.preset = ColorMaps.resolve(c.preset);   // tolerate keys from older files
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
    updateMaskLegend();
  }

  /* the dark tones are meaningful, not missing data — spell them out */
  function updateMaskLegend() {
    var box = $('legendMask');
    if (!S.res || TERRAIN_LAYERS[S.layer] || S.layer === 'vis') { box.innerHTML = ''; return; }
    var st = S.res.stats, n = st.nData || 1;
    var rows = [
      ['#colOccluded', 'shadowed', st.nShadow / n],
      ['#colOutside', 'out of scan', st.nOutside / n]
    ];
    if (st.nGraz) rows.push(['#colOccluded', 'grazing', st.nGraz / n]);
    if ($('chkMaskBelow').checked) rows.push(['#colBelow', 'below thr.', null]);
    rows.push(['#colNoData', 'no data', null]);
    box.innerHTML = rows.map(function (r) {
      return '<div class="r"><i style="background:' + $(r[0].slice(1)).value + '"></i>' + r[1] +
        (r[2] != null ? '<b>' + (100 * r[2]).toFixed(0) + '%</b>' : '') + '</div>';
    }).join('');
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

      /* the selected marker is drawn through the terrain, which would otherwise
         hide the fact that the antenna is underground — flag it in red */
      if (zt === zt && r.z < zt - 0.05) {
        var bur = [], m2 = ext * 0.014;
        V.seg(bur, r.x, r.y, r.z, r.x, r.y, zt);
        V.seg(bur, r.x - m2, r.y, r.z, r.x + m2, r.y, r.z);
        V.seg(bur, r.x, r.y - m2, r.z, r.x, r.y + m2, r.z);
        V.seg(bur, r.x - m2, r.y - m2, zt, r.x + m2, r.y + m2, zt);
        V.seg(bur, r.x - m2, r.y + m2, zt, r.x + m2, r.y - m2, zt);
        batches.push({ verts: bur, color: [1, 0.15, 0.15, 1], noDepth: true });
      }

      /* scan footprint of the selected sensor */
      if ($('chkFan').checked && i === S.sel && r.on !== false) {
        var f = [], N2 = 64, R = Math.min(r.rmax, ext * 1.6);
        var lift = R * Math.tan(Math.max(-80, Math.min(80, r.el || 0)) * DEG);
        var a0 = (r.az - r.apAz) * DEG, a1 = (r.az + r.apAz) * DEG;
        var prev = null;
        for (var kk = 0; kk <= N2; kk++) {
          var ang = a0 + (a1 - a0) * kk / N2;
          var px = r.x + Math.sin(ang) * R, py = r.y + Math.cos(ang) * R;
          var pz = Grid.sampleZ(g, px, py);
          if (pz !== pz) pz = g.zmin;
          pz += lift;
          if (prev) V.seg(f, prev[0], prev[1], prev[2], px, py, pz);
          prev = [px, py, pz];
        }
        var e0x = r.x + Math.sin(a0) * R, e0y = r.y + Math.cos(a0) * R;
        var e1x = r.x + Math.sin(a1) * R, e1y = r.y + Math.cos(a1) * R;
        var z0 = Grid.sampleZ(g, e0x, e0y), z1b = Grid.sampleZ(g, e1x, e1y);
        V.seg(f, r.x, r.y, r.z, e0x, e0y, (z0 === z0 ? z0 : g.zmin) + lift);
        V.seg(f, r.x, r.y, r.z, e1x, e1y, (z1b === z1b ? z1b : g.zmin) + lift);
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
          arrow(S.der.nx[id], S.der.ny[id], S.der.nz[id], [1, 0.6, 0.1, 1]); // normal
          if (mode() === 'custom') {
            var cv = custRel()
              ? Sens.slopeRelVec(fx, fy, numOr('inpCustOff', 0))
              : Sens.customVec(parseFloat($('inpCustAz').value) || 0, parseFloat($('inpCustPl').value) || 0);
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
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (EXT.pick) { var c = EXT.cancel; extRelease(); if (c) c(); return; }
    setPickMode(null);
  });

  function extRelease() {
    EXT.pick = null; EXT.cancel = null;
    $('pickBanner').classList.add('hidden');
  }

  function onCanvasClick(hit) {
    /* An add-on placing a tie-point owns the click outright — it must not also
       move the probe or drop an AOI corner. */
    if (EXT.pick) { if (hit) EXT.pick(hit); return; }
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
    for (var pi = 0; pi < EXT.probe.length; pi++) EXT.probe[pi](hit);
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
    var html = '<b>PROBE</b><br>' +
      'X ' + fmt(hit.x, 2) + '<br>Y ' + fmt(hit.y, 2) + '<br>Z ' + fmt(hit.z, 2) + ' m<br>' +
      'slope ' + fmt(slope, 1) + '°  dip dir ' + fmt(asp, 0) + '°<br>';
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
      'mean range       ' + fmt(st.meanRange, 0) + ' m' +
      hintFor(st);
    drawHist(st.hist);
  }

  /** turn a bad-looking result into an actionable next step */
  function hintFor(st) {
    if (!st.nData) return '';
    var out = st.nOutside / st.nData, sh = st.nShadow / st.nData;
    var t = [];
    /* a buried sensor explains everything else, so lead with it */
    S.radars.forEach(function (r) {
      if (r.on === false) return;
      var c = clearance(r);
      if (c === c && c < -0.05) t.push('<span class="w"><b>' + r.name + ' is ' + fmt(-c, 1) +
        ' m below the terrain</b> — that alone forces 0% coverage. Tick “Z = terrain + ' +
        'antenna height” in panel 2 and recompute.</span>');
    });
    if (out > 0.5) t.push('<span class="w">' + (100 * out).toFixed(0) +
      '% is outside the scan geometry. Widen “Az/El scan width”, raise “Range max”, ' +
      'or tick “Auto-aim at model” so the boresight and tilt point at the pit.</span>');
    if (sh > 0.5) t.push('<span class="w">' + (100 * sh).toFixed(0) +
      '% is shadowed. On a benched wall a low sensor mostly sees berm tops — raise the ' +
      'antenna, move it back, or click a dark cell to read how much lift it needs. ' +
      'Untick the shadow test for the pure geometric cosine map.</span>');
    if (st.nVis && st.mean < 0.3) t.push('<span class="w">mean sensitivity is low — this ' +
      'line of sight is nearly perpendicular to the assumed movement. Check the movement ' +
      'vector, or try a position that looks along the failure direction.</span>');
    return t.length ? '\n\n' + t.join('\n\n') : '';
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
      g.fillStyle = SMTheme.col('--sm-dim2'); g.font = '11px Segoe UI'; g.textAlign = 'center';
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
    g.strokeStyle = SMTheme.col('--sm-fg'); g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(thr * W, 2); g.lineTo(thr * W, H - pad); g.stroke();
    g.setLineDash([]);
    g.fillStyle = SMTheme.col('--sm-dim'); g.font = '9px Consolas'; g.textAlign = 'left';
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

  /* ================================================ 6. CLIPPING
     Display-only cutting: a six-face clip box, or a thin slab that reads as a
     cross-section. The shaders discard the hidden fragments, so the analysis
     is untouched — link it to the Selection Mask when you want both.
     ============================================================ */
  var AXIS_NAME = ['Easting', 'Northing', 'Elevation'];
  var AXIS_SHORT = ['E', 'N', 'RL'];
  var AXIS_COL = ['#E63946', '#00B050', '#38BDF8'];

  function bindClip() {
    Array.prototype.forEach.call($('clipModes').children, function (b) {
      b.onclick = function () { setClipMode(b.getAttribute('data-mode')); };
    });
    Array.prototype.forEach.call($('clipAxes').children, function (b) {
      b.onclick = function () {
        S.clip.axis = parseInt(b.getAttribute('data-axis'), 10);
        var w = V.clipWorld(), a = S.clip.axis;
        S.clip.centre = (w.bmin[a] + w.bmax[a]) / 2;
        S.clip.thick = Math.max((w.bmax[a] - w.bmin[a]) / 25, 0.05);
        applySlab(); syncClipForm();
      };
    });
    $('chkClipHandles').onchange = function () {
      V.setClipEnabled(S.clip.mode !== 'off', this.checked);
    };
    $('btnClipReset').onclick = function () {
      V.clipFit();
      if (S.clip.mode === 'slab') {
        var w = V.clipWorld(), a = S.clip.axis;
        S.clip.centre = (w.bmin[a] + w.bmax[a]) / 2;
        S.clip.thick = Math.max((w.bmax[a] - w.bmin[a]) / 25, 0.05);
        applySlab();
      }
      syncClipForm(); V.draw();
    };
    $('clipPos').oninput = function () { S.clip.centre = +this.value; applySlab(); syncClipForm(true); };
    $('clipPosNum').onchange = function () { S.clip.centre = +this.value; applySlab(); syncClipForm(); };
    $('clipThick').onchange = function () {
      S.clip.thick = Math.max(0.01, +this.value); applySlab(); syncClipForm();
    };
    $('clipThickRange').oninput = function () {
      S.clip.thick = Math.max(0.01, +this.value); applySlab(); syncClipForm(true);
    };
    $('btnClipStepBack').onclick = function () { stepSlab(-1); };
    $('btnClipStepFwd').onclick = function () { stepSlab(1); };
    $('btnClipToAOI').onclick = function () {
      var w = V.clipWorld();
      $('aoiXmin').value = fmt(w.min[0], 1); $('aoiXmax').value = fmt(w.max[0], 1);
      $('aoiYmin').value = fmt(w.min[1], 1); $('aoiYmax').value = fmt(w.max[1], 1);
      $('aoiZmin').value = fmt(w.min[2], 1); $('aoiZmax').value = fmt(w.max[2], 1);
      $('chkAOI').checked = true;
      $('aoiXmin').onchange();
      status('Selection mask set from the clip box.');
    };
    $('btnClipFromAOI').onclick = function () {
      var a = aoiObj();
      V.setClipWorld([a.xmin, a.ymin, a.zmin], [a.xmax, a.ymax, a.zmax]);
      syncClipForm();
      status('Clip box set from the selection mask.');
    };
    /* dragging a face in the view must feed the sliders back */
    V.onClipChange = function () { if (!S.clipSyncing) syncClipForm(true); };
  }

  function setClipMode(mode) {
    S.clip.mode = mode;
    Array.prototype.forEach.call($('clipModes').children, function (b) {
      b.className = (b.getAttribute('data-mode') === mode) ? 'on' : '';
    });
    $('clipOpts').classList.toggle('hidden', mode === 'off');
    $('clipBoxPane').classList.toggle('hidden', mode !== 'box');
    $('clipSlabPane').classList.toggle('hidden', mode !== 'slab');
    if (mode === 'slab') {
      var w = V.clipWorld(), a = S.clip.axis;
      if (!isFinite(S.clip.centre)) S.clip.centre = (w.bmin[a] + w.bmax[a]) / 2;
      if (!isFinite(S.clip.thick)) S.clip.thick = Math.max((w.bmax[a] - w.bmin[a]) / 25, 0.05);
      applySlab();
    }
    V.setClipEnabled(mode !== 'off', $('chkClipHandles').checked);
    syncClipForm();
  }

  /** a slab keeps a thin band on one axis and the whole extent on the others */
  function applySlab() {
    if (!S.grid) return;
    var w = V.clipWorld(), a = S.clip.axis;
    var half = Math.max(S.clip.thick, 0.01) / 2;
    var mn = w.bmin.slice(), mx = w.bmax.slice();
    mn[a] = Math.max(w.bmin[a], S.clip.centre - half);
    mx[a] = Math.min(w.bmax[a], S.clip.centre + half);
    S.clipSyncing = true;
    V.setClipWorld(mn, mx);
    S.clipSyncing = false;
  }

  function stepSlab(dir) {
    var w = V.clipWorld(), a = S.clip.axis;
    S.clip.centre = clamp(S.clip.centre + dir * S.clip.thick, w.bmin[a], w.bmax[a]);
    applySlab(); syncClipForm();
  }

  /** rebuild the panel from the viewer's box (quick = numbers only) */
  function syncClipForm(quick) {
    if (!S.grid) return;
    var w = V.clipWorld(), a = S.clip.axis;
    Array.prototype.forEach.call($('clipAxes').children, function (b) {
      b.className = (parseInt(b.getAttribute('data-axis'), 10) === a) ? 'on' : '';
    });

    if (S.clip.mode === 'slab') {
      var span = w.bmax[a] - w.bmin[a];
      var step = Math.max(span / 2000, 0.001);
      var pos = $('clipPos');
      pos.min = w.bmin[a]; pos.max = w.bmax[a]; pos.step = step; pos.value = S.clip.centre;
      $('clipPosNum').value = fmt(S.clip.centre, 2);
      $('clipThick').value = fmt(S.clip.thick, 2);
      var tr = $('clipThickRange');
      tr.min = Math.max(span / 5000, 0.01); tr.max = span; tr.step = Math.max(span / 5000, 0.01);
      tr.value = Math.min(S.clip.thick, span);
      $('clipSlabInfo').innerHTML = 'slab <b>' + AXIS_SHORT[a] + '</b>  ' +
        fmt(S.clip.centre - S.clip.thick / 2, 1) + '  →  ' + fmt(S.clip.centre + S.clip.thick / 2, 1) +
        '   (' + fmt(S.clip.thick, 2) + ' m thick)';
    }

    /* box sliders */
    var box = $('clipSliders');
    if (!quick || box.children.length !== 3) {
      box.innerHTML = '';
      for (var ax = 0; ax < 3; ax++) {
        var row = document.createElement('div');
        row.className = 'clipRow';
        var st = Math.max((w.bmax[ax] - w.bmin[ax]) / 2000, 0.001);
        row.innerHTML =
          '<span class="ax"><i style="background:' + AXIS_COL[ax] + '"></i>' + AXIS_SHORT[ax] + '</span>' +
          cell('cmin' + ax, w.bmin[ax], w.bmax[ax], st, w.min[ax]) +
          cell('cmax' + ax, w.bmin[ax], w.bmax[ax], st, w.max[ax]);
        box.appendChild(row);
        wireCell(row, ax);
      }
    } else {
      for (var k = 0; k < 3; k++) {
        var r = box.children[k];
        r.querySelector('.c0 input').value = w.min[k];
        r.querySelector('.c0 span').textContent = fmt(w.min[k], 1);
        r.querySelector('.c1 input').value = w.max[k];
        r.querySelector('.c1 span').textContent = fmt(w.max[k], 1);
      }
    }
    function cell(id, lo, hi, st, v) {
      var which = id.indexOf('cmin') === 0 ? 'c0' : 'c1';
      return '<span class="clipCell ' + which + '"><input type="range" min="' + lo + '" max="' + hi +
        '" step="' + st + '" value="' + v + '"><span>' + fmt(v, 1) + '</span></span>';
    }
    function wireCell(row, ax) {
      var lo = row.querySelector('.c0 input'), hi = row.querySelector('.c1 input');
      lo.oninput = function () { pushFace(ax * 2, +lo.value); };
      hi.oninput = function () { pushFace(ax * 2 + 1, +hi.value); };
    }
    function pushFace(face, worldValue) {
      var ww = V.clipWorld();
      var mn = ww.min.slice(), mx = ww.max.slice(), axis = face >> 1;
      if (face & 1) mx[axis] = worldValue; else mn[axis] = worldValue;
      S.clipSyncing = true;
      V.setClipWorld(mn, mx);
      S.clipSyncing = false;
      syncClipForm(true);
    }
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
      g.fillStyle = SMTheme.col('--sm-hud-bg2');
      g.fillRect(10 * sc, 10 * sc, 430 * sc, 66 * sc);
      g.strokeStyle = SMTheme.col('--sm-line'); g.strokeRect(10 * sc, 10 * sc, 430 * sc, 66 * sc);
      g.fillStyle = SMTheme.col('--sm-fg'); g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText('SensiMap — ' + L.label, 20 * sc, 18 * sc);
      g.font = (11 * sc) + 'px Consolas, monospace';
      g.fillStyle = SMTheme.col('--sm-dim');
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
            preset: ColorMaps.resolve(c.preset), stops: c.stops, reverse: !!c.reverse,
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
        custRel: custRel(), custOff: +$('inpCustOff').value,
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
      /* projects saved before the per-cell offset existed carry neither key */
      $('chkCustRel').checked = !!q.custRel;
      if (q.custOff != null) $('inpCustOff').value = q.custOff;
      syncCustomForm();
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

  /* ---------------------------------------------------- add-on surface

     Everything an add-on module is allowed to reach. Deliberately functions
     rather than live references, because the viewer and grid are replaced
     wholesale when a new survey is loaded. */
  window.SensiMap = {
    viewer: function () { return V; },
    /* "Is there a surface to click on?" The viewer's grid is the honest answer,
       because that is the thing pickAt actually raycasts — S.grid is ui.js's
       copy of the same raster and is only consulted as a fallback. */
    grid: function () { return (V && V.grid) || S.grid || null; },
    status: status,
    redraw: function () { if (V) V.draw(); },

    /* Take exclusive ownership of canvas clicks until released. `onCancel`
       fires if the user presses Escape, so the add-on can unwind its own
       half-finished state instead of being left mid-workflow. */
    claimPick: function (fn, message, onCancel) {
      setPickMode(null);
      EXT.pick = fn; EXT.cancel = onCancel || null;
      var b = $('pickBanner');
      b.classList.remove('hidden');
      b.textContent = message || 'Click on the model  (Esc to cancel)';
    },
    setPickMessage: function (message) {
      var b = $('pickBanner');
      if (!b.classList.contains('hidden')) b.textContent = message;
    },
    releasePick: extRelease,

    /* Observe ordinary probe clicks — the ones that are not placing anything. */
    onProbe: function (fn) { EXT.probe.push(fn); }
  };

  /* ---------------------------------------------------- start */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
