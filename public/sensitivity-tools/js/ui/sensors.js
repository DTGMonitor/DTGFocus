/* ============================================================
   ui/sensors.js — radar positions: the list under the tree, the property
   form, and the levelling / auto-aim rules that keep a sensor sitting on the
   terrain rather than inside it.
   ============================================================ */
'use strict';

SM.Sensors = (function () {

  var $ = SM.$, S = SM.S, fmt = SM.fmt, DEG = SM.DEG, clamp = SM.clamp, numOr = SM.numOr;

  var PALETTE = ['#FFC000', '#05CAC8', '#E63946', '#00B050', '#8B5CF6', '#E97132'];

  function init() {
    ['rName', 'rColor', 'rX', 'rY', 'rZ', 'rDz', 'rAz', 'rEl', 'rApAz', 'rApEl', 'rRmin', 'rRmax']
      .forEach(function (id) { $(id).oninput = saveForm; });
    ['chkSnap', 'chkAutoAim'].forEach(function (id) { $(id).onchange = saveForm; });
    $('selCombine').onchange = function () {
      if ($('selCombine').value === 'which') S.layer = 'which';
      SM.Model.invalidate();
      SM.Tree.refresh();
      if (S.res) SM.Model.recompute();
    };
  }

  /* ------------------------------------------------------- model */
  function create(o) {
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
    snap(r);
    return r;
  }

  function add() {
    var g = S.grid;
    create({
      name: 'Radar ' + (S.radars.length + 1),
      x: g ? g.x0 + (g.nx - 1) * g.dx * (0.2 + 0.6 * Math.random()) : 0,
      y: g ? g.y0 + (g.ny - 1) * g.dy * (0.2 + 0.6 * Math.random()) : 0,
      color: PALETTE[S.radars.length % PALETTE.length]
    });
    S.sel = S.radars.length - 1;
    loadForm(); SM.Tree.refresh(); SM.Overlays.update();
    SM.Tree.select('sensor', S.sel);
  }

  function duplicate() {
    var r = S.radars[S.sel]; if (!r) return;
    var c = JSON.parse(JSON.stringify(r));
    c.name = r.name + ' copy';
    S.radars.push(c); S.sel = S.radars.length - 1;
    loadForm(); SM.Tree.refresh(); SM.Overlays.update();
    SM.Tree.select('sensor', S.sel);
  }

  function remove(i) {
    if (S.radars.length <= 1) { SM.status('Keep at least one radar position.'); return; }
    var gone = S.radars.splice(i, 1)[0];
    S.sel = Math.max(0, Math.min(S.sel, S.radars.length - 1));
    loadForm(); SM.Tree.refresh(); SM.Overlays.update(); SM.Model.invalidate();
    if (S.node.kind === 'sensor') SM.Tree.select('sensor', S.sel);
    SM.status('Removed “' + gone.name + '”.');
  }

  function select(i) {
    S.sel = i;
    loadForm(); SM.Overlays.update();
    SM.Tree.select('sensor', i);
    if (S.res && $('selCombine').value === 'selected') SM.Model.recompute();
  }

  function setEnabled(i, on) {
    var r = S.radars[i]; if (!r) return;
    r.on = on;
    SM.Model.invalidate(); SM.Overlays.update(); SM.Tree.refresh();
  }

  /** put the antenna on the terrain, and point it at the model if asked */
  function snap(r) {
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

  /** how far a sensor sits above the terrain; negative = underground */
  function clearance(r) {
    if (!S.grid || !r) return NaN;
    var zt = Grid.sampleZ(S.grid, r.x, r.y);
    return zt === zt ? r.z - zt : NaN;
  }

  /* ------------------------------------------------------- form */
  function loadForm() {
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
    updateNote();
  }

  function saveForm() {
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
    snap(r);
    $('rZ').disabled = r.snap;
    $('rAz').disabled = r.autoAim; $('rEl').disabled = r.autoAim;
    $('rZ').value = fmt(r.z, 2);
    $('rAz').value = fmt(r.az, 0); $('rEl').value = fmt(r.el || 0, 0);
    updateNote();
    $('propName').textContent = r.name;
    SM.Tree.refresh(); SM.Overlays.update(); SM.Model.invalidate();
  }

  /** a buried antenna makes every line of sight start inside rock */
  function updateNote() {
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

  /** the Place-radar tool landed a click */
  function placeAt(hit) {
    var r = S.radars[S.sel]; if (!r) return;
    r.x = hit.x; r.y = hit.y; r.snap = true;
    snap(r);
    loadForm(); SM.Tree.refresh();
    SM.Overlays.update(); SM.Model.invalidate();
    SM.status('Radar moved to ' + fmt(r.x, 1) + ', ' + fmt(r.y, 1) + ', ' + fmt(r.z, 1));
  }

  return {
    init: init, create: create, add: add, duplicate: duplicate, remove: remove,
    select: select, setEnabled: setEnabled, snap: snap, clearance: clearance,
    loadForm: loadForm, saveForm: saveForm, placeAt: placeAt
  };
})();
