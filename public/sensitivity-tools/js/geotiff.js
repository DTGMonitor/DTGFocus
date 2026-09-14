/* ============================================================
   geotiff.js — GeoTIFF / TIFF terrain reader

   A mine DEM handed over as .tif is a raster of elevations plus the tags
   that say where on the ground it sits, so it short-circuits the gridder
   exactly like an ESRI .asc does and returns the same
     { kind:'grid', name, grid:{nx,ny,dx,dy,x0,y0,z}, pts, tris, note }

   The same file format also arrives as an orthophoto, which is a picture of
   the ground rather than the ground — readPhoto() returns that as RGB for
   draping over the terrain, and read() refuses it so a photograph can never
   be mistaken for elevations.

   Covers what GDAL actually writes for terrain:
     · classic TIFF and BigTIFF, either byte order
     · strips or tiles
     · uint8/16/32, int8/16/32, float32/64 samples
     · compression none, LZW, Deflate (zlib and Adobe), PackBits
     · predictor 1 (none), 2 (horizontal), 3 (floating point)
     · ModelPixelScale + ModelTiepoint, or an axis-aligned ModelTransformation
     · GDAL_NODATA, and the GeoKeys that decide pixel-is-area vs -point,
       the linear units, and whether the file is in degrees at all

   Dependency-free on purpose: the inflate, LZW and PackBits decoders below
   are the whole reason this file is long. Everything is synchronous, so the
   reader plugs into the same call site as every other parser.
   ============================================================ */
'use strict';

var GeoTIFF = (function () {

  /* ============================================================ inflate
     Raw DEFLATE (RFC 1951). Bit-by-bit canonical Huffman decoding is too
     slow for a mine-scale raster, so each tree also gets a 9-bit lookup
     table and only the long codes fall through to the slow path.
     ============================================================ */

  var FAST_BITS = 9, FAST_MASK = (1 << FAST_BITS) - 1;

  /** Canonical Huffman tree from a code-length array. */
  function buildHuff(lens, n) {
    var count = new Int32Array(16), i, len;
    for (i = 0; i < n; i++) count[lens[i]]++;
    count[0] = 0;
    var offs = new Int32Array(16), symbol = new Int32Array(n);
    for (len = 1; len < 16; len++) offs[len] = offs[len - 1] + count[len - 1];
    for (i = 0; i < n; i++) if (lens[i]) symbol[offs[lens[i]]++] = i;

    /* first code of each length, canonical order */
    var firstCode = new Int32Array(16), code = 0;
    for (len = 1; len < 16; len++) { code = (code + count[len - 1]) << 1; firstCode[len] = code; }

    var fast = new Int16Array(1 << FAST_BITS);
    for (i = 0; i < fast.length; i++) fast[i] = -1;
    var nextCode = firstCode.slice(), idx = 0;
    for (len = 1; len < 16; len++) {
      for (var k = 0; k < count[len]; k++) {
        var sym = symbol[idx++], c = nextCode[len]++;
        if (len > FAST_BITS) continue;
        /* DEFLATE feeds Huffman codes MSB first, the bit buffer hands them
           over LSB first, so the table is keyed on the reversed code */
        var rev = 0;
        for (var b = 0; b < len; b++) rev |= ((c >> (len - 1 - b)) & 1) << b;
        for (var fill = rev; fill < fast.length; fill += (1 << len)) fast[fill] = (len << 9) | sym;
      }
    }
    return { count: count, symbol: symbol, fast: fast };
  }

  var FIX_LIT = null, FIX_DIST = null;
  function fixedTrees() {
    if (FIX_LIT) return;
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    FIX_LIT = buildHuff(l, 288);
    var d = new Uint8Array(30);
    for (i = 0; i < 30; i++) d[i] = 5;
    FIX_DIST = buildHuff(d, 30);
  }

  var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  /**
   * Inflate a raw DEFLATE stream.
   * @param {Uint8Array} src
   * @param {number} [expected] exact output size when known — lets the whole
   *        buffer be allocated once, which is the common case here because a
   *        TIFF strip's uncompressed size is arithmetic.
   */
  function inflateRaw(src, expected) {
    fixedTrees();
    var out = new Uint8Array(expected > 0 ? expected : Math.max(1024, src.length * 4));
    var olen = 0, pos = 0, bitbuf = 0, bitcnt = 0, slen = src.length;

    function need(n) {
      while (bitcnt < n) {
        bitbuf |= (pos < slen ? src[pos] : 0) << bitcnt;
        pos++; bitcnt += 8;
      }
    }
    function bits(n) {
      if (!n) return 0;
      need(n);
      var v = bitbuf & ((1 << n) - 1);
      bitbuf >>>= n; bitcnt -= n;
      return v;
    }
    function decode(h) {
      need(FAST_BITS);
      var t = h.fast[bitbuf & FAST_MASK];
      if (t >= 0) {
        var l = t >> 9;
        bitbuf >>>= l; bitcnt -= l;
        return t & 511;
      }
      var code = 0, firstC = 0, index = 0, len = 1;
      while (len < 16) {
        code |= bits(1);
        var cnt = h.count[len];
        if (code - firstC < cnt) return h.symbol[index + code - firstC];
        index += cnt; firstC = (firstC + cnt) << 1; code <<= 1; len++;
      }
      throw new Error('corrupt compressed data (bad Huffman code)');
    }
    function room(n) {
      if (olen + n <= out.length) return;
      var cap = out.length * 2;
      while (cap < olen + n) cap *= 2;
      var b = new Uint8Array(cap);
      b.set(out.subarray(0, olen));
      out = b;
    }

    for (;;) {
      var last = bits(1), type = bits(2);
      if (type === 0) {                                   /* stored */
        /* skip to the byte boundary — whole bytes still sitting in the bit
           buffer have already moved `pos` on, so give them back first */
        pos -= (bitcnt >> 3);
        bitbuf = 0; bitcnt = 0;
        if (pos + 4 > slen) throw new Error('truncated stored block');
        var n = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        room(n);
        out.set(src.subarray(pos, pos + n), olen);
        olen += n; pos += n;
      } else if (type === 1 || type === 2) {
        var lit, dist;
        if (type === 1) { lit = FIX_LIT; dist = FIX_DIST; }
        else {
          var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
          var clens = new Uint8Array(19), i;
          for (i = 0; i < hclen; i++) clens[CL_ORDER[i]] = bits(3);
          var clTree = buildHuff(clens, 19);
          var lens = new Uint8Array(hlit + hdist);
          i = 0;
          while (i < hlit + hdist) {
            var sym = decode(clTree), rep, val = 0;
            if (sym < 16) { lens[i++] = sym; continue; }
            if (sym === 16) {
              if (!i) throw new Error('corrupt compressed data (no code to repeat)');
              val = lens[i - 1]; rep = 3 + bits(2);
            } else if (sym === 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            while (rep-- > 0 && i < hlit + hdist) lens[i++] = val;
          }
          lit = buildHuff(lens.subarray(0, hlit), hlit);
          dist = buildHuff(lens.subarray(hlit), hdist);
        }
        for (;;) {
          var s = decode(lit);
          if (s < 256) { room(1); out[olen++] = s; continue; }
          if (s === 256) break;
          s -= 257;
          if (s >= LEN_BASE.length) throw new Error('corrupt compressed data (bad length code)');
          var length = LEN_BASE[s] + bits(LEN_EXTRA[s]);
          var ds = decode(dist);
          if (ds >= DIST_BASE.length) throw new Error('corrupt compressed data (bad distance code)');
          var d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
          if (d > olen) throw new Error('corrupt compressed data (distance before start)');
          room(length);
          var from = olen - d;
          for (var k = 0; k < length; k++) out[olen + k] = out[from + k];
          olen += length;
        }
      } else throw new Error('corrupt compressed data (reserved block type)');
      if (last) break;
      if (pos > slen && bitcnt <= 0) throw new Error('truncated compressed data');
    }
    return olen === out.length ? out : out.subarray(0, olen);
  }

  /** Deflate as TIFF writes it: zlib-wrapped, occasionally raw. */
  function inflate(src, expected) {
    if (src.length > 1 && (src[0] & 0x0f) === 8 && ((src[0] << 8 | src[1]) % 31) === 0) {
      return inflateRaw(src.subarray(2), expected);
    }
    return inflateRaw(src, expected);
  }

  /* ============================================================ LZW
     TIFF's variant: codes packed MSB first, 9 to 12 bits wide, and the
     width steps up one code *early* (at 511, not 512) — the quirk that
     separates TIFF LZW from GIF's.
     ============================================================ */
  function lzwDecode(src, expected) {
    var MAXC = 4096;
    var prev = new Int32Array(MAXC), tail = new Uint8Array(MAXC),
        llen = new Int32Array(MAXC), firstB = new Uint8Array(MAXC);
    for (var i = 0; i < 256; i++) { prev[i] = -1; tail[i] = i; llen[i] = 1; firstB[i] = i; }

    var out = new Uint8Array(expected > 0 ? expected : Math.max(1024, src.length * 4)), olen = 0;
    var next = 258, nbits = 9, oldCode = -1;
    var bitp = 0, total = src.length * 8;

    function room(n) {
      if (olen + n <= out.length) return;
      var cap = out.length * 2;
      while (cap < olen + n) cap *= 2;
      var b = new Uint8Array(cap);
      b.set(out.subarray(0, olen));
      out = b;
    }
    function readCode() {
      if (bitp + nbits > total) return 257;
      var byteI = bitp >> 3, sh = bitp & 7;
      var v = (src[byteI] << 16) | ((src[byteI + 1] || 0) << 8) | (src[byteI + 2] || 0);
      bitp += nbits;
      return (v >> (24 - sh - nbits)) & ((1 << nbits) - 1);
    }
    function emit(code) {
      var n = llen[code];
      room(n);
      var c = code;
      for (var k = n - 1; k >= 0; k--) { out[olen + k] = tail[c]; c = prev[c]; }
      olen += n;
    }

    for (;;) {
      var code = readCode();
      if (code === 257) break;
      if (code === 256) { next = 258; nbits = 9; oldCode = -1; continue; }
      if (oldCode === -1) {
        if (code > 255) throw new Error('corrupt LZW data (first code is not a literal)');
        emit(code); oldCode = code; continue;
      }
      if (code < next) {
        emit(code);
        if (next < MAXC) {
          prev[next] = oldCode; tail[next] = firstB[code];
          llen[next] = llen[oldCode] + 1; firstB[next] = firstB[oldCode]; next++;
        }
      } else {
        /* the KwKwK case: the code being read is the one we are about to add */
        if (next >= MAXC) throw new Error('corrupt LZW data (dictionary overflow)');
        prev[next] = oldCode; tail[next] = firstB[oldCode];
        llen[next] = llen[oldCode] + 1; firstB[next] = firstB[oldCode]; next++;
        emit(next - 1);
      }
      oldCode = code;
      if (next === 511) nbits = 10;
      else if (next === 1023) nbits = 11;
      else if (next === 2047) nbits = 12;
    }
    return olen === out.length ? out : out.subarray(0, olen);
  }

  /* ============================================================ PackBits */
  function packBits(src, expected) {
    var out = new Uint8Array(expected > 0 ? expected : src.length * 2), o = 0, i = 0;
    while (i < src.length && o < out.length) {
      var n = src[i++];
      if (n > 127) n -= 256;
      if (n >= 0) {
        for (var k = 0; k <= n && o < out.length && i < src.length; k++) out[o++] = src[i++];
      } else if (n !== -128) {
        var b = src[i++];
        for (var j = 0; j < 1 - n && o < out.length; j++) out[o++] = b;
      }
    }
    return out;
  }

  /* ============================================================ predictors */

  /** Horizontal differencing, undone in place across each row. */
  function unpredictHoriz(bytes, cols, rows, spp, bps, little) {
    var r, c, s;
    if (bps === 8) {
      var stride = spp, rowLen = cols * spp;
      for (r = 0; r < rows; r++) {
        var o = r * rowLen;
        for (c = stride; c < rowLen; c++) bytes[o + c] = (bytes[o + c] + bytes[o + c - stride]) & 255;
      }
      return;
    }
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var wb = bps >> 3, rowBytes = cols * spp * wb;
    for (r = 0; r < rows; r++) {
      var base = r * rowBytes;
      for (c = 1; c < cols; c++) {
        for (s = 0; s < spp; s++) {
          var off = base + (c * spp + s) * wb, pre = off - spp * wb;
          if (bps === 16) dv.setUint16(off, (dv.getUint16(off, little) + dv.getUint16(pre, little)) & 0xffff, little);
          else dv.setUint32(off, (dv.getUint32(off, little) + dv.getUint32(pre, little)) >>> 0, little);
        }
      }
    }
  }

  /**
   * Floating-point predictor. The row is stored byte-plane by byte-plane,
   * most significant plane first, with horizontal differencing applied to
   * the bytes — so undo the differencing, then re-interleave the planes.
   * The reassembled sample bytes are big-endian whatever the file's byte
   * order is, which is why the caller is told to read them that way.
   */
  function unpredictFloat(bytes, cols, rows, spp, bps) {
    var wb = bps >> 3, rowBytes = cols * spp * wb, stride = spp;
    var tmp = new Uint8Array(rowBytes);
    for (var r = 0; r < rows; r++) {
      var base = r * rowBytes, i;
      for (i = stride; i < rowBytes; i++) bytes[base + i] = (bytes[base + i] + bytes[base + i - stride]) & 255;
      tmp.set(bytes.subarray(base, base + rowBytes));
      var wc = cols * spp;
      for (var count = 0; count < wc; count++) {
        for (var b = 0; b < wb; b++) bytes[base + wb * count + b] = tmp[b * wc + count];
      }
    }
  }

  /* ============================================================ TIFF tags */

  var T = {
    NEW_SUBFILE: 254, WIDTH: 256, HEIGHT: 257, BITS: 258, COMPRESSION: 259,
    PHOTOMETRIC: 262, STRIP_OFFSETS: 273, SAMPLES: 277, ROWS_PER_STRIP: 278,
    STRIP_COUNTS: 279, PLANAR: 284, PREDICTOR: 317, SAMPLE_FORMAT: 339,
    TILE_WIDTH: 322, TILE_HEIGHT: 323, TILE_OFFSETS: 324, TILE_COUNTS: 325,
    COLOR_MAP: 320,
    PIXEL_SCALE: 33550, TIEPOINT: 33922, TRANSFORM: 34264,
    GEO_KEYS: 34735, GEO_DOUBLE: 34736, GEO_ASCII: 34737, GDAL_NODATA: 42113
  };

  var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

  var COMPRESSION_NAMES = {
    1: 'none', 2: 'CCITT RLE', 3: 'CCITT G3', 4: 'CCITT G4', 5: 'LZW',
    6: 'old JPEG', 7: 'JPEG', 8: 'deflate', 32773: 'PackBits',
    32946: 'deflate', 34712: 'JPEG 2000', 34887: 'LERC', 50000: 'zstd', 50001: 'WebP'
  };

  function isTIFF(buf) {
    if (!buf || buf.byteLength < 8) return false;
    var b = new Uint8Array(buf, 0, 4);
    var little = b[0] === 0x49 && b[1] === 0x49, big = b[0] === 0x4d && b[1] === 0x4d;
    if (!little && !big) return false;
    var magic = little ? (b[2] | (b[3] << 8)) : ((b[2] << 8) | b[3]);
    return magic === 42 || magic === 43;
  }

  /** Read one IFD's entries into {tag: {type, count, value[]}}. */
  function readIFD(dv, off, little, big) {
    var entries = {}, n, entrySize, i;
    if (big) { n = Number(dv.getBigUint64(off, little)); off += 8; entrySize = 20; }
    else { n = dv.getUint16(off, little); off += 2; entrySize = 12; }
    if (n < 0 || n > 100000) throw new Error('not a readable TIFF (absurd tag count)');
    for (i = 0; i < n; i++) {
      var e = off + i * entrySize;
      var tag = dv.getUint16(e, little), type = dv.getUint16(e + 2, little);
      var count = big ? Number(dv.getBigUint64(e + 4, little)) : dv.getUint32(e + 4, little);
      var valOff = big ? e + 12 : e + 8;
      var size = TYPE_SIZE[type] || 0;
      if (!size) continue;                         /* unknown type — ignore the tag */
      var total = size * count;
      var inline = big ? total <= 8 : total <= 4;
      var at = inline ? valOff : (big ? Number(dv.getBigUint64(valOff, little)) : dv.getUint32(valOff, little));
      entries[tag] = { type: type, count: count, offset: at };
    }
    var nextOff = off + n * entrySize;
    var next = big ? Number(dv.getBigUint64(nextOff, little)) : dv.getUint32(nextOff, little);
    return { entries: entries, next: next };
  }

  /** Materialise a tag's values. */
  function tagValues(dv, ent, little) {
    if (!ent) return null;
    var out = [], i, o = ent.offset, t = ent.type, sz = TYPE_SIZE[t];
    for (i = 0; i < ent.count; i++, o += sz) {
      switch (t) {
        case 1: case 7: out.push(dv.getUint8(o)); break;
        case 2: out.push(String.fromCharCode(dv.getUint8(o))); break;
        case 3: out.push(dv.getUint16(o, little)); break;
        case 4: case 13: out.push(dv.getUint32(o, little)); break;
        case 5: out.push(dv.getUint32(o, little) / (dv.getUint32(o + 4, little) || 1)); break;
        case 6: out.push(dv.getInt8(o)); break;
        case 8: out.push(dv.getInt16(o, little)); break;
        case 9: out.push(dv.getInt32(o, little)); break;
        case 10: out.push(dv.getInt32(o, little) / (dv.getInt32(o + 4, little) || 1)); break;
        case 11: out.push(dv.getFloat32(o, little)); break;
        case 12: out.push(dv.getFloat64(o, little)); break;
        case 16: case 18: out.push(Number(dv.getBigUint64(o, little))); break;
        case 17: out.push(Number(dv.getBigInt64(o, little))); break;
        default: return null;
      }
    }
    if (t === 2) return out.join('').replace(/\0+$/, '');
    return out;
  }

  function first(v, dflt) {
    if (v == null) return dflt;
    if (typeof v === 'string') return v;
    return v.length ? v[0] : dflt;
  }

  /** GeoKeyDirectory → {keyId: value}. Only the short keys are resolved. */
  function readGeoKeys(dir, doubles, ascii) {
    var keys = {};
    if (!dir || dir.length < 4) return keys;
    var n = dir[3];
    for (var i = 0; i < n; i++) {
      var o = 4 + i * 4;
      if (o + 3 >= dir.length) break;
      var id = dir[o], loc = dir[o + 1], count = dir[o + 2], val = dir[o + 3];
      if (loc === 0) keys[id] = val;
      else if (loc === T.GEO_DOUBLE && doubles) keys[id] = doubles[val];
      else if (loc === T.GEO_ASCII && typeof ascii === 'string') keys[id] = ascii.substr(val, count).replace(/\|$/, '');
    }
    return keys;
  }

  /* ============================================================ reader

     A TIFF is opened once into a `doc` — header, tags, georeferencing, block
     layout — and the strip/tile decoding is shared. What differs between a DEM
     and an aerial photograph is only what the decoded bytes are turned into,
     so the two readers below are each a single inner loop.
     ============================================================ */

  var MAX_CELLS = 4e6;        /* elevation cells kept before decimating */
  var MAX_PIXELS = 24e6;      /* photo pixels kept before decimating */

  /** cell sizes land on values like 30.480060960121918 after a feet conversion */
  function fmtCell(v) {
    return String(Math.round(v * 1000) / 1000);
  }

  /** a half-copied file walks its own offsets off the end, which surfaces as a
      DataView range error — say what that actually means */
  function friendly(e) {
    if (e instanceof RangeError || /outside the bounds|out of range/i.test(e.message || '')) {
      return new Error('the file is truncated or corrupt — a tag or strip points past the end of it');
    }
    return e;
  }

  /**
   * Header, the full-resolution IFD, and every tag both readers need. Nothing
   * here decides whether the file is terrain or a photograph — that is the
   * caller's business.
   */
  function openDoc(buf) {
    if (!isTIFF(buf)) throw new Error('not a TIFF file');
    var dv = new DataView(buf);
    var little = dv.getUint8(0) === 0x49;
    var big = dv.getUint16(2, little) === 43;
    var ifdOff;
    if (big) {
      var offSize = dv.getUint16(4, little);
      if (offSize !== 8) throw new Error('BigTIFF with ' + offSize + '-byte offsets is not supported');
      ifdOff = Number(dv.getBigUint64(8, little));
    } else ifdOff = dv.getUint32(4, little);

    /* GDAL writes overviews as extra IFDs flagged "reduced resolution" — take
       the first full-resolution image, not a pyramid level, and count the rest
       so the note can say a pyramid was passed over */
    var ifd = null, guard = 0, nImages = 0;
    while (ifdOff && guard++ < 64) {
      var cand = readIFD(dv, ifdOff, little, big);
      nImages++;
      var sub = first(tagValues(dv, cand.entries[T.NEW_SUBFILE], little), 0);
      if (!(sub & 1) && !ifd) ifd = cand;
      ifdOff = cand.next;
    }
    if (!ifd) throw new Error('the file holds only reduced-resolution overviews, no full image');
    var get = function (tag) { return tagValues(dv, ifd.entries[tag], little); };

    var d = {
      buf: buf, dv: dv, little: little, nImages: nImages, get: get,
      nx: first(get(T.WIDTH), 0) | 0,
      ny: first(get(T.HEIGHT), 0) | 0,
      spp: first(get(T.SAMPLES), 1) | 0,
      bps: (get(T.BITS) || [8])[0] | 0,
      sfmt: (get(T.SAMPLE_FORMAT) || [1])[0] | 0,    /* 1 uint, 2 int, 3 float */
      comp: first(get(T.COMPRESSION), 1) | 0,
      pred: first(get(T.PREDICTOR), 1) | 0,
      planar: first(get(T.PLANAR), 1) | 0,
      photo: first(get(T.PHOTOMETRIC), 1) | 0
    };
    if (!d.nx || !d.ny) throw new Error('the TIFF header has no image size');
    if (d.bps !== 8 && d.bps !== 16 && d.bps !== 32 && d.bps !== 64) {
      throw new Error(d.bps + '-bit samples are not supported — export as 8-bit, ' +
        '16-bit integer or 32-bit float');
    }
    if (d.sfmt === 3 && d.bps !== 32 && d.bps !== 64) {
      throw new Error('floating point samples must be 32 or 64 bit');
    }
    if (!(d.comp === 1 || d.comp === 5 || d.comp === 8 || d.comp === 32946 || d.comp === 32773)) {
      throw new Error((COMPRESSION_NAMES[d.comp] || ('code ' + d.comp)) +
        ' compression is not supported — re-export with COMPRESS=DEFLATE, LZW or NONE ' +
        '(gdal_translate -co COMPRESS=DEFLATE)');
    }
    if (d.planar !== 1 && d.spp > 1) {
      throw new Error('planar (band-separated) TIFFs with more than one band are not ' +
        'supported — re-export with INTERLEAVE=PIXEL');
    }
    d.wb = d.bps >> 3;

    /* ---------------------------------------------------- georeferencing */
    var scale = get(T.PIXEL_SCALE), tie = get(T.TIEPOINT), xform = get(T.TRANSFORM);
    d.geoKeys = readGeoKeys(get(T.GEO_KEYS), get(T.GEO_DOUBLE), get(T.GEO_ASCII));
    d.georefNote = '';
    d.unitNote = '';

    if (scale && scale.length >= 2 && tie && tie.length >= 6) {
      d.dx = Math.abs(scale[0]); d.dy = Math.abs(scale[1]);
      /* the tiepoint maps raster (i,j) to world (x,y) */
      d.x0 = tie[3] - tie[0] * d.dx;
      d.y0 = tie[4] + tie[1] * d.dy;                 /* raster rows run north → south */
    } else if (xform && xform.length >= 16) {
      if (Math.abs(xform[1]) > 1e-9 || Math.abs(xform[4]) > 1e-9) {
        throw new Error('the raster is rotated relative to north — reproject it north-up ' +
          '(gdalwarp) before loading');
      }
      d.dx = Math.abs(xform[0]); d.dy = Math.abs(xform[5]);
      d.x0 = xform[3]; d.y0 = xform[7];
    } else {
      d.dx = d.dy = 1; d.x0 = 0; d.y0 = 0;
      d.georefNote = 'no georeferencing in the file — assuming 1 m pixels from 0,0';
    }
    if (!(d.dx > 0) || !(d.dy > 0)) throw new Error('the pixel size in the file is zero');

    /* degrees, not metres: every downstream number — slope, range, sensitivity,
       and where a photo lands against the terrain — is metric, so a lat/lon
       raster would be quietly meaningless rather than merely wrong */
    var modelType = d.geoKeys[1024];
    var looksGeographic = modelType === 2 ||
      (modelType == null && d.dx < 0.01 && Math.abs(d.x0) <= 180 && Math.abs(d.y0) <= 90);
    if (looksGeographic) {
      throw new Error('this raster is in degrees (a geographic CRS), and SensiMap works in ' +
        'metres — reproject it to UTM first, e.g. gdalwarp -t_srs EPSG:32750');
    }

    /* linear units: feet is the one that actually shows up */
    var lin = d.geoKeys[3076], vert = d.geoKeys[4099];
    var xyToM = (lin === 9002) ? 0.3048 : (lin === 9003) ? (1200 / 3937) : 1;
    d.zToM = (vert === 9002) ? 0.3048 : (vert === 9003) ? (1200 / 3937) : 1;
    if (xyToM !== 1) {
      d.dx *= xyToM; d.dy *= xyToM; d.x0 *= xyToM; d.y0 *= xyToM;
      d.unitNote = 'converted from feet';
    }

    /* pixel-is-area puts the tiepoint on the pixel corner; both readers want
       the centre of the north-west pixel, so move half a cell in */
    if (d.geoKeys[1025] !== 2) { d.x0 += d.dx / 2; d.y0 -= d.dy / 2; }
    d.epsg = d.geoKeys[3072];

    /* ---------------------------------------------------- no-data */
    d.nodata = NaN;
    var nodataTxt = get(T.GDAL_NODATA);
    if (typeof nodataTxt === 'string' && nodataTxt.trim()) {
      var nv = parseFloat(nodataTxt.trim());
      if (nv === nv) d.nodata = nv;
    }
    /* match the ESRI reader's convention when the file does not say */
    d.assumedNodata = d.nodata !== d.nodata;
    if (d.assumedNodata) d.nodata = -9999;

    /* ---------------------------------------------------- block layout */
    var tileW = first(get(T.TILE_WIDTH), 0) | 0, tileH = first(get(T.TILE_HEIGHT), 0) | 0;
    d.tiled = tileW > 0 && tileH > 0;
    if (d.tiled) {
      d.offsets = get(T.TILE_OFFSETS); d.counts = get(T.TILE_COUNTS);
      d.blockW = tileW; d.blockH = tileH;
      d.across = Math.ceil(d.nx / tileW);
    } else {
      d.offsets = get(T.STRIP_OFFSETS); d.counts = get(T.STRIP_COUNTS);
      var rps = first(get(T.ROWS_PER_STRIP), d.ny) | 0;
      d.blockH = (!rps || rps > d.ny) ? d.ny : rps;
      d.blockW = d.nx;
      d.across = 1;
    }
    if (!d.offsets || !d.offsets.length) {
      throw new Error('the TIFF has no image data (no strip or tile offsets)');
    }
    if (!d.counts || !d.counts.length) {
      throw new Error('the TIFF has no strip or tile byte counts');
    }
    d.down = Math.ceil(d.ny / d.blockH);
    return d;
  }

  /** true for a picture — an RGB(A) or palette raster, not elevations */
  function isPhoto(d) {
    if (d.photo === 3) return true;                        /* palette */
    if (d.photo === 2) return d.spp >= 3;                  /* RGB / RGBA */
    /* Three or more integer bands is a picture whatever the photometric tag
       says: elevation is one band, always. Photogrammetry and GDAL routinely
       leave the tag at BlackIsZero on an RGB ortho — QGIS shows those bands as
       "Gray" — and trusting the tag alone would read band one of a photograph
       as 0-255 "elevations" that grid perfectly happily and mean nothing. */
    return d.spp >= 3 && d.sfmt === 1 && d.bps <= 16;
  }

  /**
   * Decode every strip or tile the decimation actually lands on, and hand the
   * bytes to `onBlock`. Blocks the step never samples are skipped without
   * being decompressed, which is what keeps a large tiled file from paying for
   * what it does not use.
   */
  function decodeBlocks(d, step, onBlock) {
    for (var bi = 0; bi < d.offsets.length; bi++) {
      var brow = d.tiled ? Math.floor(bi / d.across) : bi;
      var bcol = d.tiled ? (bi % d.across) : 0;
      if (brow >= d.down) break;
      var rowStart = brow * d.blockH, colStart = bcol * d.blockW;
      var rowsHere = Math.min(d.blockH, d.ny - rowStart);
      var colsHere = d.tiled ? d.blockW : d.nx;      /* tiles are full width, padded */
      if (rowsHere <= 0) continue;

      var sampled = false, rr;
      for (rr = rowStart; rr < rowStart + rowsHere; rr++) if (rr % step === 0) { sampled = true; break; }
      if (!sampled) continue;
      if (d.tiled) {
        var anyCol = false;
        for (var cc = colStart; cc < colStart + colsHere && cc < d.nx; cc++) {
          if (cc % step === 0) { anyCol = true; break; }
        }
        if (!anyCol) continue;
      }

      var off = d.offsets[bi], len = d.counts[bi];
      if (off == null || !len) continue;
      if (off + len > d.buf.byteLength) {
        throw new Error('the file is truncated — a strip runs past the end');
      }
      var raw = new Uint8Array(d.buf, off, len);
      var decRows = d.tiled ? d.blockH : rowsHere;   /* tiles are stored whole */
      var expect = colsHere * decRows * d.spp * d.wb;
      var data;
      try {
        /* an uncompressed strip is a view straight onto the file, so it has to
           be copied before a predictor rewrites it in place */
        if (d.comp === 1) data = (d.pred === 1) ? raw : new Uint8Array(raw);
        else if (d.comp === 5) data = lzwDecode(raw, expect);
        else if (d.comp === 8 || d.comp === 32946) data = inflate(raw, expect);
        else data = packBits(raw, expect);
      } catch (e) {
        throw new Error('could not decompress ' + (d.tiled ? 'tile ' : 'strip ') + bi +
          ' (' + (COMPRESSION_NAMES[d.comp] || d.comp) + '): ' + e.message);
      }
      if (data.length < expect) {
        var padded = new Uint8Array(expect);
        padded.set(data.subarray(0, Math.min(data.length, expect)));
        data = padded;
      }
      if (d.pred === 2) unpredictHoriz(data, colsHere, decRows, d.spp, d.bps, d.little);
      else if (d.pred === 3) unpredictFloat(data, colsHere, decRows, d.spp, d.bps);

      onBlock({
        dv: new DataView(data.buffer, data.byteOffset, data.byteLength),
        rows: rowsHere, cols: colsHere,
        rowStart: rowStart, colStart: colStart,
        rowBytes: colsHere * d.spp * d.wb,
        /* the float predictor reassembles samples big-endian whatever the
           file's own byte order is */
        le: (d.pred === 3) ? false : d.little
      });
    }
  }

  /** one sample, whatever the file's type is */
  function sampleAt(d, dv, off, le) {
    if (d.sfmt === 3) return (d.bps === 64) ? dv.getFloat64(off, le) : dv.getFloat32(off, le);
    if (d.sfmt === 2) {
      return (d.bps === 8) ? dv.getInt8(off)
        : (d.bps === 16) ? dv.getInt16(off, le) : dv.getInt32(off, le);
    }
    return (d.bps === 8) ? dv.getUint8(off)
      : (d.bps === 16) ? dv.getUint16(off, le) : dv.getUint32(off, le);
  }

  /* ------------------------------------------------------------ terrain */

  /**
   * Read a GeoTIFF DEM into the standard dataset shape.
   * @param {ArrayBuffer} buf
   * @param {string} name
   * @param {{maxCells:number}} [opt] cap on cells kept — a raster bigger than
   *        this is decimated on read, which is what keeps a mine-scale COG
   *        from allocating hundreds of MB the viewer cannot draw anyway.
   */
  function read(buf, name, opt) {
    try {
      return readTerrain(buf, name, opt);
    } catch (e) { throw friendly(e); }
  }

  function readTerrain(buf, name, opt) {
    var maxCells = (opt && opt.maxCells > 0) ? opt.maxCells : MAX_CELLS;
    var d = openDoc(buf);

    /* a colour image is a picture of terrain, not terrain: reading band one
       would hand the model 0-255 "elevations" that grid perfectly happily and
       mean nothing. A palette image is single-band, so it needs its own test. */
    if (d.photo === 3) {
      throw new Error('this is a palette-colour image (a shaded or classified picture), ' +
        'not an elevation raster — load the DEM it was made from, or drape this one ' +
        'over the terrain as a photo');
    }
    if (isPhoto(d)) {
      throw new Error('this is a ' + d.spp + '-band colour image (a hillshade or ' +
        'orthophoto), not an elevation raster — load the DEM the image was made from, ' +
        'or drape this one over the terrain as a photo');
    }

    var step = 1;
    while (Math.ceil(d.nx / step) * Math.ceil(d.ny / step) > maxCells) step++;
    var onx = Math.ceil(d.nx / step), ony = Math.ceil(d.ny / step);

    var z = new Float32Array(onx * ony);
    z.fill(NaN);

    decodeBlocks(d, step, function (b) {
      for (var r = 0; r < b.rows; r++) {
        var srcRow = b.rowStart + r;
        if (srcRow % step) continue;
        var outRow = ony - 1 - (srcRow / step);       /* TIFF runs north → south */
        if (outRow < 0 || outRow >= ony) continue;
        var rowOff = r * b.rowBytes;
        for (var c = 0; c < b.cols; c++) {
          var srcCol = b.colStart + c;
          if (srcCol >= d.nx || srcCol % step) continue;
          /* band one of an interleaved pixel */
          var v = sampleAt(d, b.dv, rowOff + c * d.spp * d.wb, b.le);
          if (v !== v || !isFinite(v) || v === d.nodata || v <= -1e38) continue;  /* stays NaN */
          z[outRow * onx + srcCol / step] = v * d.zToM;
        }
      }
    });

    var valid = 0;
    for (var q = 0; q < z.length; q++) if (z[q] === z[q]) valid++;
    if (!valid) {
      throw new Error('every cell in the raster is no-data' +
        (d.assumedNodata ? ' (the file names no no-data value, so -9999 was assumed)' : ''));
    }

    /* the grid's y0 is the south edge; d.y0 is the north row's centre */
    var gy0 = d.y0 - (ony - 1) * d.dy * step;
    var fmtName = (d.sfmt === 3 ? 'float' : d.sfmt === 2 ? 'int' : 'uint') + d.bps;
    var note = onx + ' × ' + ony + ' raster @ ' + fmtCell(d.dx * step) + ' m (' + fmtName + ', ' +
      (COMPRESSION_NAMES[d.comp] || d.comp) + (d.tiled ? ', tiled' : '') +
      (d.epsg ? ', EPSG:' + d.epsg : '') + ')';
    if (step > 1) note += ' — decimated ' + step + '× from ' + d.nx + ' × ' + d.ny;
    if (d.unitNote) note += ' — ' + d.unitNote;
    if (d.georefNote) note += ' — ' + d.georefNote;
    if (d.nImages > 1) note += ' — ' + (d.nImages - 1) + ' further image(s) in the file ignored';

    return {
      kind: 'grid', name: name,
      grid: { nx: onx, ny: ony, dx: d.dx * step, dy: d.dy * step, x0: d.x0, y0: gy0, z: z },
      pts: [], tris: [], note: note,
      source: 'geotiff'
    };
  }

  /* ------------------------------------------------------------- photo */

  /** Is this file a picture rather than a DEM? Header only, so it is cheap. */
  function looksLikeImage(buf) {
    try { return isPhoto(openDoc(buf)); }
    catch (e) { return false; }
  }

  /** the palette a photometric-3 file indexes into, as 0-255 RGB triples */
  function readPalette(d) {
    var map = d.get(T.COLOR_MAP);
    if (!map || !map.length) return null;
    var n = map.length / 3;
    var pal = new Uint8Array(n * 3);
    /* TIFF palettes are 16-bit per channel, all reds, then greens, then blues */
    for (var i = 0; i < n; i++) {
      pal[i * 3] = map[i] >> 8;
      pal[i * 3 + 1] = map[n + i] >> 8;
      pal[i * 3 + 2] = map[2 * n + i] >> 8;
    }
    return pal;
  }

  /**
   * Read a georeferenced photograph — an orthophoto, a hillshade, any picture
   * of the ground — as 8-bit RGB plus, where the file has one, an alpha band.
   * Rows run north → south, the natural raster order, because the caller
   * samples it by world position rather than walking it.
   *
   * @returns {{kind:'image', image:{w,h,rgb,alpha,x0,y0,dx,dy}}} where x0,y0
   *          is the centre of the north-west pixel.
   */
  function readPhoto(buf, name, opt) {
    try { return readPhotoInner(buf, name, opt); }
    catch (e) { throw friendly(e); }
  }

  function readPhotoInner(buf, name, opt) {
    var maxPixels = (opt && opt.maxPixels > 0) ? opt.maxPixels : MAX_PIXELS;
    var d = openDoc(buf);

    if (d.sfmt === 3) {
      throw new Error('this is a floating-point raster, not a photograph — load it as terrain');
    }
    if (d.bps !== 8 && d.bps !== 16) {
      throw new Error(d.bps + '-bit images are not supported — export the photo as 8-bit RGB');
    }
    var pal = (d.photo === 3) ? readPalette(d) : null;
    if (d.photo === 3 && !pal) throw new Error('the palette image carries no colour map');
    /* colour comes from having three bands, not from the photometric tag */
    var isRGB = !pal && d.spp >= 3;

    var step = 1;
    while (Math.ceil(d.nx / step) * Math.ceil(d.ny / step) > maxPixels) step++;
    var w = Math.ceil(d.nx / step), h = Math.ceil(d.ny / step);

    var rgb = new Uint8Array(w * h * 3);
    /* An ortho is clipped to a flight boundary, and it says so about the
       outside in one of two ways: an alpha band, or a declared no-data value —
       the black corners of a photo that declares neither are, as far as the
       file is concerned, black photograph. */
    var alphaBand = isRGB ? 3 : 1;
    var hasAlphaBand = (isRGB && d.spp >= 4) || (!isRGB && !pal && d.spp >= 2);
    var ndMask = !d.assumedNodata;
    var hasAlpha = hasAlphaBand || ndMask;
    var alpha = hasAlpha ? new Uint8Array(w * h) : null;
    if (alpha) alpha.fill(255);

    var shift = (d.bps === 16) ? 8 : 0;              /* 16-bit channels scale down */
    var whiteIsZero = d.photo === 0;

    decodeBlocks(d, step, function (b) {
      for (var r = 0; r < b.rows; r++) {
        var srcRow = b.rowStart + r;
        if (srcRow % step) continue;
        var outRow = srcRow / step;                  /* kept north → south */
        if (outRow >= h) continue;
        var rowOff = r * b.rowBytes;
        for (var c = 0; c < b.cols; c++) {
          var srcCol = b.colStart + c;
          if (srcCol >= d.nx || srcCol % step) continue;
          var px = rowOff + c * d.spp * d.wb;
          var o = (outRow * w + srcCol / step) * 3;
          var v0 = sampleAt(d, b.dv, px, b.le);
          if (pal) {
            var idx = v0 * 3;
            rgb[o] = pal[idx]; rgb[o + 1] = pal[idx + 1]; rgb[o + 2] = pal[idx + 2];
          } else if (isRGB) {
            rgb[o] = v0 >> shift;
            rgb[o + 1] = sampleAt(d, b.dv, px + d.wb, b.le) >> shift;
            rgb[o + 2] = sampleAt(d, b.dv, px + 2 * d.wb, b.le) >> shift;
          } else {
            var g = v0 >> shift;
            if (whiteIsZero) g = 255 - g;
            rgb[o] = rgb[o + 1] = rgb[o + 2] = g;
          }
          if (alpha) {
            var ai = outRow * w + srcCol / step;
            if (hasAlphaBand) {
              alpha[ai] = sampleAt(d, b.dv, px + alphaBand * d.wb, b.le) >> shift;
            } else if (v0 === d.nodata) alpha[ai] = 0;
          }
        }
      }
    });

    var kindName = pal ? 'palette' : (isRGB ? 'RGB' : 'greyscale');
    if (isRGB && d.spp > 3) kindName = d.spp + '-band';
    if (d.bps !== 8) kindName += ' ' + d.bps + '-bit';
    var note = w + ' × ' + h + ' photo @ ' + fmtCell(d.dx * step) + ' m (' + kindName +
      (hasAlpha ? '+alpha' : '') + ', ' + (COMPRESSION_NAMES[d.comp] || d.comp) +
      (d.tiled ? ', tiled' : '') + (d.epsg ? ', EPSG:' + d.epsg : '') + ')';
    if (step > 1) note += ' — decimated ' + step + '× from ' + d.nx + ' × ' + d.ny;
    if (d.unitNote) note += ' — ' + d.unitNote;
    if (d.georefNote) note += ' — ' + d.georefNote;

    return {
      kind: 'image', name: name,
      image: {
        w: w, h: h, rgb: rgb, alpha: alpha,
        dx: d.dx * step, dy: d.dy * step, x0: d.x0, y0: d.y0
      },
      note: note, source: 'geotiff'
    };
  }

  return {
    isTIFF: isTIFF, read: read, readPhoto: readPhoto, looksLikeImage: looksLikeImage,
    /* exposed for the tests */
    inflate: inflate, inflateRaw: inflateRaw, lzwDecode: lzwDecode, packBits: packBits,
    readGeoKeys: readGeoKeys
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeoTIFF;
