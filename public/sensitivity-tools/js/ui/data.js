/* ============================================================
   ui/data.js — the Data Sources panel: reading dropped files, the ASCII
   column mapper, and turning whatever was loaded into the raster everything
   else works on.
   ============================================================ */
'use strict';

SM.Data = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, fmtInt = SM.fmtInt, fmtCoord = SM.fmtCoord;
  var status = SM.status, badge = SM.badge;

  /* ------------------------------------------------------- wiring */
  function init() {
    var dz = $('dropZone'), fi = $('fileInput');
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

    $('btnApplyAscii').onclick = function () { applyAsciiMapping(); };
    ['selDelim', 'inpSkip'].forEach(function (id) {
      $(id).onchange = function () { if (S.preview) showPreview(S.preview.file); };
    });
  }

  /* ------------------------------------------------------- demo */
  function loadDemo() {
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
      SM.Sensors.create({ name: 'R1 – low bench', x: 512000, y: 7458000 - 560, color: '#FFC000' });
      SM.Sensors.create({ name: 'R2 – high crest', x: 512000, y: 7458000 - 860, color: '#05CAC8' });
      S.sel = 0;
      SM.Sensors.loadForm();
      SM.Tree.refresh();
      SM.Overlays.update();
      status('Demo pit ready — press “Compute sensitivity map”.');
    }, 20);
  }

  /* ------------------------------------------------------- reading */

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
    SM.Cmd.refresh();
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
      d.innerHTML = '<span class="tag">' + tag + '</span>' +
        '<span class="nm" title="' + SM.esc(f.note || '') + '">' + SM.esc(f.name) + '</span>' +
        '<span class="x" title="remove">✕</span>';
      d.querySelector('.x').onclick = function (e) {
        e.stopPropagation();
        S.files.splice(i, 1); renderFileList();
        SM.Cmd.refresh();
        var p = S.files.filter(function (q) { return q.pending; });
        if (p.length) showPreview(p[0]); else $('asciiPanel').classList.add('hidden');
      };
      el.appendChild(d);
    });
  }

  /* ------------------------------------------------- ASCII mapper */
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
    status('Re-read as plain text — check the column mapping against the preview.');
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
    SM.Cmd.refresh();
    if (n) { $('asciiPanel').classList.add('hidden'); buildModel(); }
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
      reportBuildFailure(e);
      return;
    }
    var g = S.grid, ms = (performance.now() - t0).toFixed(0);
    S.res = null; S.probe = null;
    $('hudReadout').classList.add('hidden');
    describeGrid(g, dss, ms);

    SM.V.setGrid(g, S.der);
    /* a new model resets the clip box to its extent */
    S.clip.centre = NaN; S.clip.thick = NaN;
    SM.Clip.setMode(S.clip.mode);
    SM.AOI.setFull();
    if (!S.radars.length) {
      SM.Sensors.create({ name: 'Radar 1', x: g.x0 + (g.nx - 1) * g.dx / 2, y: g.y0 + g.dy * 2, color: '#FFC000' });
      S.sel = 0;
    }
    S.radars.forEach(SM.Sensors.snap);
    SM.Sensors.loadForm();
    S.layer = 'elev';
    SM.Symbology.syncForm();
    /* Elevation is flagged auto, and its stored range is still the 0-1 default
       until something stretches it — without this the whole surface clamps to
       the top of the ramp and the colour bar reads 0.00-1.00 metres. */
    SM.Symbology.autoRange(false);
    SM.Symbology.syncForm();
    SM.Symbology.colorize();
    SM.Overlays.update();
    SM.Stats.update(); SM.Stats.updateRank();
    SM.Tree.refresh();
    SM.Cmd.refresh();
    /* land on the layer that is now on screen, so Properties opens on
       something rather than telling the operator to pick a row */
    SM.Tree.select('layer', 'elev');
    $('sbCell2').textContent = 'cell ' + fmt(g.dx, 2) + ' m';
    badge('model ready', 'on');
    SM.setHud(S.files.map(function (f) { return f.name; }).join(', '),
      g.nx + '×' + g.ny + ' @ ' + fmt(g.dx, 1) + ' m · Z ' + fmt(g.zmin, 0) + '–' + fmt(g.zmax, 0) + ' m');
    status('Model built in ' + ms + ' ms — place the radar then compute.', g.nx + '×' + g.ny);
    SM.emit('model:built');
  }

  /* Say WHY a text file yielded nothing, instead of only that it did. */
  function reportBuildFailure(e) {
    status('Build failed: ' + e.message);
    var html = '<span class="w">' + e.message + '</span>';
    /* a .dtm with no .str is not a dead end — let the user look inside it */
    var triFile = S.files.filter(function (f) {
      return f.dataset && f.dataset.kind === 'tri-index';
    })[0];
    var hasPts = S.files.some(function (f) {
      return f.dataset && (f.dataset.pts || []).length;
    });
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
  }

  /* warn when the raster is too coarse to hold the bench geometry */
  function describeGrid(g, dss, ms) {
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
  }

  return {
    init: init, loadDemo: loadDemo, buildModel: buildModel,
    renderFileList: renderFileList, readFiles: readFiles
  };
})();
