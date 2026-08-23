/* ============================================================
   ui/clip.js — display-only cutting: a six-face clip box, or a thin slab that
   reads as a cross-section. The shaders discard the hidden fragments, so the
   analysis is untouched — link it to the selection mask when you want both.
   ============================================================ */
'use strict';

SM.Clip = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, clamp = SM.clamp;

  var AXIS_SHORT = ['E', 'N', 'RL'];
  var AXIS_COL = ['#E63946', '#00B050', '#38BDF8'];

  function init() {
    Array.prototype.forEach.call($('clipModes').children, function (b) {
      b.onclick = function () { setMode(b.getAttribute('data-clip')); };
    });
    Array.prototype.forEach.call($('clipAxes').children, function (b) {
      b.onclick = function () {
        S.clip.axis = parseInt(b.getAttribute('data-axis'), 10);
        var w = SM.V.clipWorld(), a = S.clip.axis;
        S.clip.centre = (w.bmin[a] + w.bmax[a]) / 2;
        S.clip.thick = Math.max((w.bmax[a] - w.bmin[a]) / 25, 0.05);
        applySlab(); syncForm();
      };
    });
    $('chkClipHandles').onchange = function () {
      SM.V.setClipEnabled(S.clip.mode !== 'off', this.checked);
    };
    $('chkClipBox').onchange = function () {
      SM.V.setClipBoxVisible(this.checked);
      syncBoxUI();
      SM.status(this.checked
        ? 'Cutting box shown again.'
        : 'Cutting box hidden — the section is still running, there is just nothing drawn ' +
          'around it. Tick it again to move the faces.');
    };
    syncBoxUI();
    $('btnClipReset').onclick = function () {
      SM.V.clipFit();
      if (S.clip.mode === 'slab') {
        var w = SM.V.clipWorld(), a = S.clip.axis;
        S.clip.centre = (w.bmin[a] + w.bmax[a]) / 2;
        S.clip.thick = Math.max((w.bmax[a] - w.bmin[a]) / 25, 0.05);
        applySlab();
      }
      syncForm(); SM.V.draw();
    };
    $('clipPos').oninput = function () { S.clip.centre = +this.value; applySlab(); syncForm(true); };
    $('clipPosNum').onchange = function () { S.clip.centre = +this.value; applySlab(); syncForm(); };
    $('clipThick').onchange = function () {
      S.clip.thick = Math.max(0.01, +this.value); applySlab(); syncForm();
    };
    $('clipThickRange').oninput = function () {
      S.clip.thick = Math.max(0.01, +this.value); applySlab(); syncForm(true);
    };
    /* dragging a face in the view must feed the sliders back */
    SM.V.onClipChange = function () { if (!S.clipSyncing) syncForm(true); };
  }

  /* With the cage hidden there is nothing to put arrows on, so the handles
     switch has nothing to act on and says so rather than sitting there live. */
  function syncBoxUI() {
    var shown = $('chkClipBox').checked;
    $('chkClipHandles').disabled = !shown;
    $('chkClipHandles').parentNode.title = shown
      ? 'Shows a draggable coloured arrow on each face of the box. Drag one in the 3D view ' +
        'to slide that face; orbiting is suspended while you do.'
      : 'The box is hidden, so there are no faces on screen to drag.';
  }

  function setMode(mode) {
    S.clip.mode = mode;
    Array.prototype.forEach.call($('clipModes').children, function (b) {
      b.className = (b.getAttribute('data-clip') === mode) ? 'on' : '';
    });
    $('clipOpts').classList.toggle('hidden', mode === 'off');
    $('clipBoxPane').classList.toggle('hidden', mode !== 'box');
    $('clipSlabPane').classList.toggle('hidden', mode !== 'slab');
    if (mode === 'slab') {
      var w = SM.V.clipWorld(), a = S.clip.axis;
      if (!isFinite(S.clip.centre)) S.clip.centre = (w.bmin[a] + w.bmax[a]) / 2;
      if (!isFinite(S.clip.thick)) S.clip.thick = Math.max((w.bmax[a] - w.bmin[a]) / 25, 0.05);
      applySlab();
    }
    SM.V.setClipBoxVisible($('chkClipBox').checked);
    SM.V.setClipEnabled(mode !== 'off', $('chkClipHandles').checked);
    syncForm();
    SM.Cmd.refresh();
  }

  /** a slab keeps a thin band on one axis and the whole extent on the others */
  function applySlab() {
    if (!S.grid) return;
    var w = SM.V.clipWorld(), a = S.clip.axis;
    var half = Math.max(S.clip.thick, 0.01) / 2;
    var mn = w.bmin.slice(), mx = w.bmax.slice();
    mn[a] = Math.max(w.bmin[a], S.clip.centre - half);
    mx[a] = Math.min(w.bmax[a], S.clip.centre + half);
    S.clipSyncing = true;
    SM.V.setClipWorld(mn, mx);
    S.clipSyncing = false;
  }

  function step(dir) {
    if (S.clip.mode !== 'slab') return;
    var w = SM.V.clipWorld(), a = S.clip.axis;
    S.clip.centre = clamp(S.clip.centre + dir * S.clip.thick, w.bmin[a], w.bmax[a]);
    applySlab(); syncForm();
  }

  /** rebuild the panel from the viewer's box (quick = numbers only) */
  function syncForm(quick) {
    if (!S.grid) return;
    var w = SM.V.clipWorld(), a = S.clip.axis;
    Array.prototype.forEach.call($('clipAxes').children, function (b) {
      b.className = (parseInt(b.getAttribute('data-axis'), 10) === a) ? 'on' : '';
    });

    if (S.clip.mode === 'slab') {
      var span = w.bmax[a] - w.bmin[a];
      var st = Math.max(span / 2000, 0.001);
      var pos = $('clipPos');
      pos.min = w.bmin[a]; pos.max = w.bmax[a]; pos.step = st; pos.value = S.clip.centre;
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
        var s = Math.max((w.bmax[ax] - w.bmin[ax]) / 2000, 0.001);
        row.innerHTML =
          '<span class="ax"><i style="background:' + AXIS_COL[ax] + '"></i>' + AXIS_SHORT[ax] + '</span>' +
          cell('cmin' + ax, w.bmin[ax], w.bmax[ax], s, w.min[ax]) +
          cell('cmax' + ax, w.bmin[ax], w.bmax[ax], s, w.max[ax]);
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
    function cell(id, lo, hi, st2, v) {
      var which = id.indexOf('cmin') === 0 ? 'c0' : 'c1';
      return '<span class="clipCell ' + which + '"><input type="range" min="' + lo + '" max="' + hi +
        '" step="' + st2 + '" value="' + v + '"><span>' + fmt(v, 1) + '</span></span>';
    }
    function wireCell(row, ax2) {
      var lo = row.querySelector('.c0 input'), hi = row.querySelector('.c1 input');
      lo.oninput = function () { pushFace(ax2 * 2, +lo.value); };
      hi.oninput = function () { pushFace(ax2 * 2 + 1, +hi.value); };
    }
    function pushFace(face, worldValue) {
      var ww = SM.V.clipWorld();
      var mn = ww.min.slice(), mx = ww.max.slice(), axis = face >> 1;
      if (face & 1) mx[axis] = worldValue; else mn[axis] = worldValue;
      S.clipSyncing = true;
      SM.V.setClipWorld(mn, mx);
      S.clipSyncing = false;
      syncForm(true);
    }
  }

  function toAOI() {
    var w = SM.V.clipWorld();
    SM.AOI.setBox(w.min, w.max);
    SM.status('Selection mask set from the clip box.');
  }

  function fromAOI() {
    var a = SM.AOI.aoiObj();
    SM.V.setClipWorld([a.xmin, a.ymin, a.zmin], [a.xmax, a.ymax, a.zmax]);
    syncForm();
    SM.status('Clip box set from the selection mask.');
  }

  return { init: init, setMode: setMode, step: step, syncForm: syncForm, toAOI: toAOI, fromAOI: fromAOI };
})();
