/* ============================================================
   renderer.js — dependency-free WebGL viewer (orbit camera, vertex
   coloured terrain mesh, line overlays, CPU picking, PNG export)
   ============================================================ */
'use strict';

var Viewer = (function () {

  /* ------------------------------------------------ mat4 helpers */
  function m4() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function mul(a, b, out) {
    out = out || m4();
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 4; j++) {
        var s = 0;
        for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        out[i * 4 + j] = s;
      }
    }
    return out;
  }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far), o = m4();
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1;
    o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  }
  function ortho(l, r, b, t, n, f) {
    var o = m4();
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n);
    return o;
  }
  function lookAt(eye, ctr, up) {
    var zx = eye[0] - ctr[0], zy = eye[1] - ctr[1], zz = eye[2] - ctr[2];
    var zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    var xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    var o = m4();
    o[0] = xx; o[1] = yx; o[2] = zx; o[4] = xy; o[5] = yy; o[6] = zy;
    o[8] = xz; o[9] = yz; o[10] = zz;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    return o;
  }
  function invert(m) {
    var inv = new Float32Array(16), a = m;
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
      a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
      a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
      b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
      b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return inv;
  }
  function xform(m, v) {
    var x = v[0], y = v[1], z = v[2], w = v[3] == null ? 1 : v[3];
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12] * w,
      m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w,
      m[3] * x + m[7] * y + m[11] * z + m[15] * w
    ];
  }

  /* ------------------------------------------------------ shaders */
  var VS_MESH = [
    'attribute vec3 aPos; attribute vec3 aNorm; attribute vec3 aCol;',
    'uniform mat4 uMVP; uniform float uZS;',
    'varying vec3 vN; varying vec3 vC;',
    'void main(){',
    '  vec3 p = vec3(aPos.xy, aPos.z*uZS);',
    '  vN = normalize(vec3(aNorm.xy, aNorm.z/uZS));',
    '  vC = aCol;',
    '  gl_Position = uMVP*vec4(p,1.0);',
    '}'
  ].join('\n');
  var FS_MESH = [
    'precision mediump float;',
    'uniform vec3 uSun; uniform float uShade; uniform float uAlpha;',
    'varying vec3 vN; varying vec3 vC;',
    'void main(){',
    '  float lam = abs(dot(normalize(vN), uSun));',
    '  float sh  = 0.32 + 0.78*lam;',
    '  vec3 c = mix(vC, vC*sh, uShade);',
    '  gl_FragColor = vec4(c, uAlpha);',
    '}'
  ].join('\n');
  var VS_LINE = [
    'attribute vec3 aPos;',
    'uniform mat4 uMVP; uniform float uZS;',
    'void main(){',
    '  vec3 p = vec3(aPos.xy, aPos.z*uZS);',
    '  gl_Position = uMVP*vec4(p,1.0);',
    '  gl_PointSize = 7.0;',
    '}'
  ].join('\n');
  var FS_LINE = [
    'precision mediump float; uniform vec4 uColor;',
    'void main(){ gl_FragColor = uColor; }'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    return p;
  }

  /* ==================================================== Viewer */
  function Viewer(canvas) {
    this.canvas = canvas;
    var gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    this.isGL2 = !!gl;
    if (!gl) {
      gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true }) ||
        canvas.getContext('experimental-webgl', { antialias: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL is not available in this browser.');
      this.u32 = !!gl.getExtension('OES_element_index_uint');
    } else this.u32 = true;
    this.gl = gl;

    this.pMesh = program(gl, VS_MESH, FS_MESH);
    this.pLine = program(gl, VS_LINE, FS_LINE);
    this.buf = {
      pos: gl.createBuffer(), norm: gl.createBuffer(), col: gl.createBuffer(),
      idx: gl.createBuffer(), wire: gl.createBuffer(), line: gl.createBuffer()
    };
    this.nIdx = 0; this.nWire = 0; this.wireReady = false;
    this.off = { x: 0, y: 0, z: 0 };
    this.cam = { yaw: 35, pitch: 32, dist: 1000, target: [0, 0, 0], fov: 42, ortho: false };
    this.opt = {
      zScale: 1, shade: 0.55, alpha: 1, sunAz: 315, sunEl: 45,
      wire: false, bg: [0.051, 0.063, 0.078]
    };
    this.lines = [];
    this.points = [];
    this.grid = null;
    this._drag = null;
    this._bind();
    this.resize();
  }

  Viewer.prototype.toLocal = function (x, y, z) {
    return [x - this.off.x, y - this.off.y, z - this.off.z];
  };

  /* --------------------------------------------------- geometry */
  Viewer.prototype.setGrid = function (g, der) {
    var gl = this.gl, nx = g.nx, ny = g.ny, n = nx * ny;
    this.grid = g; this.der = der;
    this.off = { x: g.x0 + (nx - 1) * g.dx / 2, y: g.y0 + (ny - 1) * g.dy / 2, z: (g.zmin + g.zmax) / 2 };

    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var id = j * nx + i, o = id * 3, z = g.z[id];
        pos[o] = g.x0 + i * g.dx - this.off.x;
        pos[o + 1] = g.y0 + j * g.dy - this.off.y;
        pos[o + 2] = (z === z ? z : g.zmin) - this.off.z;
        nor[o] = der.nx[id]; nor[o + 1] = der.ny[id]; nor[o + 2] = der.nz[id] || 1;
      }
    }
    /* indices, skipping no-data corners */
    var IdxType = (this.u32 && n > 65000) ? Uint32Array : Uint16Array;
    if (!this.u32 && n > 65000) console.warn('32-bit indices unavailable — reduce grid size.');
    var maxTri = (nx - 1) * (ny - 1) * 2;
    var idx = new IdxType(maxTri * 3), w = 0;
    var zz = g.z;
    function ok(id) { return zz[id] === zz[id]; }
    for (var jj = 0; jj < ny - 1; jj++) {
      for (var ii = 0; ii < nx - 1; ii++) {
        var a = jj * nx + ii, b = a + 1, c = a + nx, d = c + 1;
        var oa = ok(a), ob = ok(b), oc = ok(c), od = ok(d);
        var cnt = oa + ob + oc + od;
        if (cnt === 4) {
          idx[w++] = a; idx[w++] = b; idx[w++] = d;
          idx[w++] = a; idx[w++] = d; idx[w++] = c;
        } else if (cnt === 3) {
          if (!oa) { idx[w++] = b; idx[w++] = d; idx[w++] = c; }
          else if (!ob) { idx[w++] = a; idx[w++] = d; idx[w++] = c; }
          else if (!oc) { idx[w++] = a; idx[w++] = b; idx[w++] = d; }
          else { idx[w++] = a; idx[w++] = b; idx[w++] = c; }
        }
      }
    }
    this.nIdx = w;
    this.idxType = IdxType === Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.indices = idx.subarray(0, w);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.norm); gl.bufferData(gl.ARRAY_BUFFER, nor, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);
    var grey = new Float32Array(n * 3);
    grey.fill(0.55);
    this.setColors(grey);          // so the first draw has a valid colour buffer
    this.wireReady = false;
    this.fit();
  };

  Viewer.prototype.setColors = function (rgbFloat) {
    var gl = this.gl;
    this.colors = rgbFloat;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.col);
    gl.bufferData(gl.ARRAY_BUFFER, rgbFloat, gl.DYNAMIC_DRAW);
  };

  Viewer.prototype._buildWire = function () {
    if (!this.grid || this.wireReady) return;
    var gl = this.gl, g = this.grid, nx = g.nx, ny = g.ny;
    var step = Math.max(1, Math.round(Math.max(nx, ny) / 160));
    var arr = [], zz = g.z;
    for (var j = 0; j < ny; j += step) {
      for (var i = 0; i < nx - step; i += step) {
        var a = j * nx + i, b = j * nx + i + step;
        if (zz[a] === zz[a] && zz[b] === zz[b]) arr.push(a, b);
      }
    }
    for (var ii = 0; ii < nx; ii += step) {
      for (var jj = 0; jj < ny - step; jj += step) {
        var c = jj * nx + ii, d = (jj + step) * nx + ii;
        if (zz[c] === zz[c] && zz[d] === zz[d]) arr.push(c, d);
      }
    }
    var T = (this.u32 && nx * ny > 65000) ? Uint32Array : Uint16Array;
    var buf = new T(arr);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.wire);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buf, gl.STATIC_DRAW);
    this.nWire = buf.length;
    this.wireType = T === Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.wireReady = true;
  };

  /* ---------------------------------------------------- camera */
  Viewer.prototype.fit = function (keepAngles) {
    if (!this.grid) return;
    var g = this.grid;
    var W = (g.nx - 1) * g.dx, H = (g.ny - 1) * g.dy;
    var D = (g.zmax - g.zmin) * this.opt.zScale;
    this.cam.target = [0, 0, ((g.zmin + g.zmax) / 2 - this.off.z) * this.opt.zScale];
    /* distance that fits the largest extent vertically for the current FOV */
    this.cam.dist = 0.5 * Math.max(W, H, D) / Math.tan(this.cam.fov * Math.PI / 360) * 1.08;
    if (!keepAngles) { this.cam.yaw = 35; this.cam.pitch = 34; }
    this.draw();
  };
  Viewer.prototype.viewTop = function () { this.cam.yaw = 0; this.cam.pitch = 89.4; this.draw(); };
  Viewer.prototype.viewIso = function () { this.cam.yaw = 35; this.cam.pitch = 34; this.draw(); };
  /** put the eye at a sensor looking at the model centre */
  Viewer.prototype.viewFrom = function (wx, wy, wz) {
    var t = this.cam.target;
    var l = this.toLocal(wx, wy, wz); l[2] *= this.opt.zScale;
    var dx = t[0] - l[0], dy = t[1] - l[1], dz = t[2] - l[2];
    var hor = Math.hypot(dx, dy);
    this.cam.yaw = Math.atan2(dx, dy) * 180 / Math.PI;
    this.cam.pitch = -Math.atan2(dz, hor) * 180 / Math.PI;
    this.cam.dist = Math.max(1, Math.hypot(dx, dy, dz));
    this.draw();
  };

  Viewer.prototype.eye = function () {
    var c = this.cam, p = c.pitch * Math.PI / 180, y = c.yaw * Math.PI / 180;
    return [
      c.target[0] - c.dist * Math.cos(p) * Math.sin(y),
      c.target[1] - c.dist * Math.cos(p) * Math.cos(y),
      c.target[2] + c.dist * Math.sin(p)
    ];
  };
  Viewer.prototype.matrices = function () {
    var c = this.cam, asp = this.W / Math.max(1, this.H);
    var far = c.dist * 40 + 10000, near = Math.max(0.05, c.dist / 5000);
    var proj = c.ortho
      ? ortho(-c.dist * asp / 2, c.dist * asp / 2, -c.dist / 2, c.dist / 2, -far, far)
      : perspective(c.fov * Math.PI / 180, asp, near, far);
    var view = lookAt(this.eye(), c.target, [0, 0, 1]);
    return { proj: proj, view: view, mvp: mul(proj, view) };
  };

  /* ------------------------------------------------------ draw */
  Viewer.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 600;
    this.W = w; this.H = h;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.draw();
  };

  Viewer.prototype.draw = function () {
    var gl = this.gl, o = this.opt;
    gl.clearColor(o.bg[0], o.bg[1], o.bg[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.grid) return;
    var M = this.matrices();
    this._mvp = M.mvp;

    var az = o.sunAz * Math.PI / 180, el = o.sunEl * Math.PI / 180;
    var sun = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];

    /* ---- mesh ---- */
    if (this.nIdx) {
      gl.useProgram(this.pMesh);
      var P = this.pMesh;
      gl.uniformMatrix4fv(gl.getUniformLocation(P, 'uMVP'), false, M.mvp);
      gl.uniform1f(gl.getUniformLocation(P, 'uZS'), o.zScale);
      gl.uniform1f(gl.getUniformLocation(P, 'uShade'), o.shade);
      gl.uniform1f(gl.getUniformLocation(P, 'uAlpha'), o.alpha);
      gl.uniform3fv(gl.getUniformLocation(P, 'uSun'), new Float32Array(sun));
      if (o.alpha < 0.999) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
      else gl.disable(gl.BLEND);
      this._attr(P, 'aPos', this.buf.pos, 3);
      this._attr(P, 'aNorm', this.buf.norm, 3);
      this._attr(P, 'aCol', this.buf.col, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.idx);
      gl.drawElements(gl.TRIANGLES, this.nIdx, this.idxType, 0);
      gl.disable(gl.BLEND);
    }

    /* ---- overlays ---- */
    gl.useProgram(this.pLine);
    var L = this.pLine;
    gl.uniformMatrix4fv(gl.getUniformLocation(L, 'uMVP'), false, M.mvp);
    gl.uniform1f(gl.getUniformLocation(L, 'uZS'), o.zScale);
    var cLoc = gl.getUniformLocation(L, 'uColor');

    if (o.wire) {
      this._buildWire();
      if (this.nWire) {
        this._attr(L, 'aPos', this.buf.pos, 3);
        gl.uniform4f(cLoc, 0.55, 0.62, 0.72, 0.45);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.wire);
        gl.drawElements(gl.LINES, this.nWire, this.wireType, 0);
        gl.disable(gl.BLEND);
      }
    }

    for (var i = 0; i < this.lines.length; i++) {
      var b = this.lines[i];
      if (!b.verts || !b.verts.length) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.line);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.verts), gl.DYNAMIC_DRAW);
      var loc = gl.getAttribLocation(L, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(cLoc, b.color[0], b.color[1], b.color[2], b.color[3] == null ? 1 : b.color[3]);
      if (b.noDepth) gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(b.points ? gl.POINTS : gl.LINES, 0, b.verts.length / 3);
      gl.disable(gl.BLEND);
      if (b.noDepth) gl.enable(gl.DEPTH_TEST);
    }
  };

  Viewer.prototype._attr = function (P, name, buf, size) {
    var gl = this.gl, loc = gl.getAttribLocation(P, name);
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };

  /* ----------------------------------------------- interaction */
  Viewer.prototype._bind = function () {
    var self = this, cv = this.canvas;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) {
      cv.focus();
      self._drag = { x: e.clientX, y: e.clientY, b: e.button, moved: 0 };
      e.preventDefault();
    });
    window.addEventListener('mouseup', function (e) {
      if (self._drag && self._drag.moved < 4 && self._drag.b === 0 && self.onClick) {
        self.onClick(self.pickAt(e), e);
      }
      self._drag = null;
    });
    window.addEventListener('mousemove', function (e) {
      if (self._drag) {
        var dx = e.clientX - self._drag.x, dy = e.clientY - self._drag.y;
        self._drag.moved += Math.abs(dx) + Math.abs(dy);
        self._drag.x = e.clientX; self._drag.y = e.clientY;
        if (self._drag.b === 0 && !e.shiftKey) {
          self.cam.yaw += dx * 0.4;
          self.cam.pitch = Math.max(-89, Math.min(89.4, self.cam.pitch + dy * 0.3));
        } else {
          /* pan along the camera right / up axes */
          var c = self.cam, y = c.yaw * Math.PI / 180, p = c.pitch * Math.PI / 180;
          var s = c.ortho ? c.dist / Math.max(1, self.H)
            : 2 * c.dist * Math.tan(c.fov * Math.PI / 360) / Math.max(1, self.H);
          var right = [Math.cos(y), -Math.sin(y), 0];
          var up = [Math.sin(y) * Math.sin(p), Math.cos(y) * Math.sin(p), Math.cos(p)];
          for (var k = 0; k < 3; k++) c.target[k] += (-right[k] * dx + up[k] * dy) * s;
        }
        self.draw();
      } else if (self.onHover) {
        var r = cv.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          self.onHover(e);
        }
      }
    });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var f = Math.exp((e.deltaY > 0 ? 1 : -1) * 0.12);
      self.cam.dist = Math.max(1, Math.min(1e8, self.cam.dist * f));
      self.draw();
    }, { passive: false });
  };

  /* --------------------------------------------------- picking */
  /** screen event → world hit on the terrain, or null */
  Viewer.prototype.pickAt = function (ev) {
    if (!this.grid) return null;
    var r = this.canvas.getBoundingClientRect();
    var nxs = ((ev.clientX - r.left) / r.width) * 2 - 1;
    var nys = 1 - ((ev.clientY - r.top) / r.height) * 2;
    var M = this.matrices();
    var inv = invert(mul(M.proj, M.view));
    if (!inv) return null;
    var pa = xform(inv, [nxs, nys, -1, 1]), pb = xform(inv, [nxs, nys, 1, 1]);
    for (var k = 0; k < 3; k++) { pa[k] /= pa[3]; pb[k] /= pb[3]; }
    var zs = this.opt.zScale || 1;
    /* scaled-local → world */
    var ox = pa[0] + this.off.x, oy = pa[1] + this.off.y, oz = pa[2] / zs + this.off.z;
    var dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = (pb[2] - pa[2]) / zs;
    var g = this.grid;
    var far = this.cam.dist * 6 + Math.max(g.nx * g.dx, g.ny * g.dy) * 3;
    return Grid.rayHit(g, ox, oy, oz, dx, dy, dz, far);
  };

  /* --------------------------------------------- overlay helper */
  Viewer.prototype.setLines = function (batches) { this.lines = batches || []; };

  /** convenience builders (world coords in, local floats out) */
  Viewer.prototype.seg = function (arr, x1, y1, z1, x2, y2, z2) {
    var a = this.toLocal(x1, y1, z1), b = this.toLocal(x2, y2, z2);
    arr.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  };
  Viewer.prototype.vert = function (arr, x, y, z) {
    var a = this.toLocal(x, y, z); arr.push(a[0], a[1], a[2]);
  };

  /* ------------------------------------------------ screenshot */
  Viewer.prototype.snapshot = function (decorate) {
    this.draw();
    var src = this.canvas;
    var out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    var g = out.getContext('2d');
    g.drawImage(src, 0, 0);
    if (decorate) decorate(g, out.width, out.height, src.width / this.W);
    return out;
  };

  return Viewer;
})();
