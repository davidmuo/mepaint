/* Ported from libmypaint (https://github.com/mypaint/libmypaint, commit d5a88fb):
 * mypaint-tiled-surface.c (dab mask, draw_dab, get_color) and brushmodes.c (blend modes).
 * libmypaint - The MyPaint Brush Library
 * Copyright (C) 2007-2014 Martin Renold <martinxyz@gmx.ch> and contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Adaptation: libmypaint renders into 64px tiles of 15-bit premultiplied ints;
 * this version renders straight into one 8-bit straight-alpha RGBA buffer with
 * float maths, so the run-length mask and tile queue are unnecessary.
 */
import { clamp, rgbToSpectral, spectralToRgb, WGM_EPSILON } from './helpers';

export interface DabParams {
  x: number; y: number; radius: number;
  r: number; g: number; b: number; opaque: number; hardness: number; softness: number; colorA: number;
  aspect: number; angle: number; lockAlpha: number; colorize: number; posterize: number; posterizeNum: number; paint: number;
}

export interface MyPaintSurface {
  drawDab(p: DabParams): boolean;
  getColor(x: number, y: number, radius: number, paint: number): [number, number, number, number];
}

const MIN_PAINT_OPACITY = 150 / 32768; // libmypaint clamps pigment-mode opacity to avoid rounding noise
const LUMA_R = 0.2126, LUMA_G = 0.7152, LUMA_B = 0.0722;
const RAD_AREA_1 = Math.sqrt(1 / Math.PI);

const spectralBlendFactor = (x: number) => { const b = x * 8 - 3; return 0.5 + b / (1 + Math.abs(b) * 1.65); };

// Layers are 8-bit, so every bottom colour is one of 2²⁴ triples: cache their log-spectra.
// (Pigment blending is a weighted geometric mean = exp of a weighted sum of logs.)
const LOG_CACHE = new Map<number, Float64Array>();
const _spec = new Float64Array(10);
function logSpectrum(r8: number, g8: number, b8: number): Float64Array {
  const key = (r8 << 16) | (g8 << 8) | b8;
  let v = LOG_CACHE.get(key);
  if (!v) {
    if (LOG_CACHE.size > 200000) LOG_CACHE.clear();
    rgbToSpectral(r8 / 255, g8 / 255, b8 / 255, _spec);
    v = new Float64Array(10);
    for (let i = 0; i < 10; i++) v[i] = Math.log(_spec[i]);
    LOG_CACHE.set(key, v);
  }
  return v;
}

/** Squared, aspect/angle-corrected distance of a pixel centre from the dab centre, normalised by radius². */
function rr(xp: number, yp: number, x: number, y: number, aspect: number, sn: number, cs: number, inv2: number) {
  const yy = yp + 0.5 - y, xx = xp + 0.5 - x;
  const yyr = (yy * cs - xx * sn) * aspect, xxr = yy * sn + xx * cs;
  return (yyr * yyr + xxr * xxr) * inv2;
}
const rSample = (x: number, y: number, aspect: number, sn: number, cs: number) => {
  const yyr = (y * cs - x * sn) * aspect, xxr = y * sn + x * cs;
  return yyr * yyr + xxr * xxr;
};
/** Anti-aliased variant for tiny dabs (radius < 3px): visibility at the nearest point, softened by the far one. */
function rrAA(xp: number, yp: number, x: number, y: number, aspect: number, sn: number, cs: number, inv2: number, rAAStart: number) {
  const right = x - xp, bottom = y - yp, cx = right - 0.5, cy = bottom - 0.5, left = right - 1, top = bottom - 1;
  let nx: number, ny: number, rrNear: number;
  if (left < 0 && right > 0 && top < 0 && bottom > 0) { nx = 0; ny = 0; rrNear = 0; }
  else {
    const l2 = cs * cs + sn * sn, t = (cx * cs + cy * sn) / l2;
    nx = clamp(cs * t, left, right); ny = clamp(sn * t, top, bottom);
    rrNear = rSample(nx, ny, aspect, sn, cs) * inv2;
  }
  if (rrNear > 1) return rrNear;
  const centerSign = (cx - cs) * sn - cs * (cy + sn);
  const fx = centerSign < 0 ? nx - sn * RAD_AREA_1 : nx + sn * RAD_AREA_1;
  const fy = centerSign < 0 ? ny + cs * RAD_AREA_1 : ny - cs * RAD_AREA_1;
  const rFar = rSample(fx, fy, aspect, sn, cs), rrFar = rFar * inv2;
  if (rFar < rAAStart) return (rrFar + rrNear) * 0.5;
  return 1 - (1 - rrNear) / (1 + (rrFar - rrNear));
}

/**
 * Iterate the dab footprint, calling `fn(index, opacity)` for every pixel with a non-zero mask.
 * Mirrors libmypaint's render_dab_mask (two-segment hardness falloff, softness, ellipse).
 */
function forEachMaskPixel(
  W: number, H: number, x: number, y: number, radius: number, hardness: number, softness: number, aspect: number, angle: number,
  fn: (i: number, opa: number) => void,
) {
  hardness = clamp(hardness, 0, 1); if (aspect < 1) aspect = 1;
  if (hardness === 0) return;
  const s1o = 1 - softness, s1s = -(1 / hardness - 1) * (1 - softness);
  const s2o = hardness / (1 - hardness) * (1 - softness), s2s = -hardness / (1 - hardness) * (1 - softness);
  const a = angle / 360 * 2 * Math.PI, cs = Math.cos(a), sn = Math.sin(a);
  const rf = radius + 1;
  const x0 = Math.max(0, Math.floor(x - rf)), y0 = Math.max(0, Math.floor(y - rf));
  const x1 = Math.min(W - 1, Math.floor(x + rf)), y1 = Math.min(H - 1, Math.floor(y + rf));
  const inv2 = 1 / (radius * radius);
  const small = radius < 3;
  let rAAStart = radius > 1 ? radius - 1 : 0; rAAStart *= rAAStart / aspect;
  for (let yp = y0; yp <= y1; yp++) for (let xp = x0; xp <= x1; xp++) {
    const r2 = small ? rrAA(xp, yp, x, y, aspect, sn, cs, inv2, rAAStart) : rr(xp, yp, x, y, aspect, sn, cs, inv2);
    if (r2 > 1) continue;
    const opa = r2 <= hardness ? s1o + r2 * s1s : s2o + r2 * s2s;
    if (opa * 32768 < 1) continue; // same cut-off as the 15-bit mask
    fn(yp * W + xp, opa);
  }
}

export interface SurfaceOptions {
  buf: Uint8ClampedArray; W: number; H: number;
  /** pixels outside the lasso are left untouched */
  mask?: Uint8Array | null;
  /** global flow multiplier (mepaint's Flow slider) */
  flow?: number;
  onDirty?: (x1: number, y1: number, x2: number, y2: number) => void;
  symmetry?: 'none' | 'vertical' | 'horizontal' | 'both';
  wrap?: boolean;
}

/** A MyPaint surface backed by one mepaint layer buffer (device pixels, straight 8-bit RGBA). */
export class LayerSurface implements MyPaintSurface {
  constructor(public o: SurfaceOptions) {}
  private sa = new Float64Array(10); private sb = new Float64Array(10); private sm = new Float64Array(10); private rgb = [0, 0, 0];

  drawDab(p: DabParams): boolean {
    const { W, H, symmetry = 'none', wrap } = this.o;
    const draw = (x: number, y: number, angle: number) => {
      if (!wrap) return this.drawOne({ ...p, x, y, angle });
      // Wrap-around: also lay the dab on the opposite edges it crosses
      let any = false; const r = p.radius + 2, wx = ((x % W) + W) % W, wy = ((y % H) + H) % H;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const px = wx + ox * W, py = wy + oy * H;
        if (px + r < 0 || py + r < 0 || px - r > W || py - r > H) continue;
        any = this.drawOne({ ...p, x: px, y: py, angle }) || any;
      }
      return any;
    };
    const modified = draw(p.x, p.y, p.angle);
    if (modified && symmetry !== 'none') {
      // Same mirror maths as libmypaint's draw_dab symmetry pass (axes through the canvas centre)
      if (symmetry === 'vertical' || symmetry === 'both') draw(W - p.x, p.y, -180 - p.angle);
      if (symmetry === 'horizontal' || symmetry === 'both') draw(p.x, H - p.y, -p.angle);
      if (symmetry === 'both') draw(W - p.x, H - p.y, p.angle);
    }
    return modified;
  }

  private drawOne(p: DabParams): boolean {
    const opaque = clamp(p.opaque * (this.o.flow ?? 1), 0, 1), hardness = clamp(p.hardness, 0, 1), softness = clamp(p.softness, 0, 1);
    const lockAlpha = clamp(p.lockAlpha, 0, 1), colorize = clamp(p.colorize, 0, 1), posterize = clamp(p.posterize, 0, 1);
    const posterizeNum = clamp(Math.round(p.posterizeNum * 100), 1, 128), paint = clamp(p.paint, 0, 1);
    if (p.radius < 0.1 || hardness === 0 || softness === 1 || opaque === 0) return false;
    const cr = clamp(p.r, 0, 1), cg = clamp(p.g, 0, 1), cb = clamp(p.b, 0, 1), ca = clamp(p.colorA, 0, 1);
    const normal = (1 - lockAlpha) * (1 - colorize) * (1 - posterize);
    const { buf, W, H, mask } = this.o;
    const sa = this.sa, sm = this.sm, rgb = this.rgb;
    if (paint > 0) rgbToSpectral(cr, cg, cb, sa);
    const lsa = paint > 0 ? Array.from(sa, Math.log) : null; // top colour is constant: hoist its logs
    // per-mode opacities, exactly as process_op() derives them
    const oNormal = normal * opaque * (1 - paint), oLock = lockAlpha * opaque * (1 - colorize) * (1 - posterize) * (1 - paint);
    const oNormalP = Math.max(normal * opaque * paint, MIN_PAINT_OPACITY), oLockP = Math.max(lockAlpha * opaque * (1 - colorize) * (1 - posterize) * paint, MIN_PAINT_OPACITY);
    const oColor = colorize * opaque, oPost = posterize * opaque;
    const topLum = cr * LUMA_R + cg * LUMA_G + cb * LUMA_B;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;

    const wgm = (fa: number, r: number, g: number, b: number) => {
      // spectral weighted geometric mean of top and bottom (straight 0–1) colours, via cached logs
      const fb = 1 - fa, lsb = logSpectrum((r * 255 + .5) | 0, (g * 255 + .5) | 0, (b * 255 + .5) | 0);
      for (let i = 0; i < 10; i++) sm[i] = Math.exp(fa * lsa![i] + fb * lsb[i]);
      spectralToRgb(sm, rgb);
    };

    forEachMaskPixel(W, H, p.x, p.y, p.radius, hardness, softness, p.aspect, p.angle, (i, m) => {
      if (mask && !mask[i]) return;
      const bi = i * 4;
      let A = buf[bi + 3] / 255, R = buf[bi] / 255 * A, G = buf[bi + 1] / 255 * A, B = buf[bi + 2] / 255 * A;

      if (paint < 1) {
        if (normal) {
          const oa0 = m * oNormal, ob = 1 - oa0, oa = ca === 1 ? oa0 : oa0 * ca;
          A = oa + ob * A; R = oa * cr + ob * R; G = oa * cg + ob * G; B = oa * cb + ob * B;
        }
        if (lockAlpha && ca !== 0) {
          const oa0 = m * oLock, ob = 1 - oa0, oa = oa0 * A;
          R = oa * cr + ob * R; G = oa * cg + ob * G; B = oa * cb + ob * B;
        }
      }
      if (paint > 0) {
        if (normal) {
          if (ca === 1) {
            const oa = m * oNormalP, ob = 1 - oa;
            if (A <= 0) { A = oa + ob * A; R = oa * cr + ob * R; G = oa * cg + ob * G; B = oa * cb + ob * B; }
            else {
              const fa = oa / (oa + ob * A);
              wgm(fa, R / A, G / A, B / A);
              A = oa + ob * A; R = rgb[0] * A; G = rgb[1] * A; B = rgb[2] * A;
            }
          } else {
            // smudging/erasing pigment dab: additive at low alpha, spectral when mostly opaque
            const oa = m * normal * opaque * paint, ob = 1 - oa, oa2 = oa * ca, out = oa2 + ob * A;
            const sf = clamp(spectralBlendFactor(A), 0, 1), af = 1 - sf;
            let nr = 0, ng = 0, nb = 0;
            if (af) { nr = oa2 * cr + ob * R; ng = oa2 * cg + ob * G; nb = oa2 * cb + ob * B; }
            if (sf && A !== 0) {
              const fa = oa / (oa + ob * A) * ca;
              wgm(fa, R / A, G / A, B / A);
              nr = af * nr + sf * rgb[0] * out; ng = af * ng + sf * rgb[1] * out; nb = af * nb + sf * rgb[2] * out;
            }
            A = out; R = nr; G = ng; B = nb;
          }
        }
        if (lockAlpha && ca !== 0) {
          const oa0 = m * oLockP, ob = 1 - oa0, oa = oa0 * A;
          if (A <= 0) { R = oa * cr + ob * R; G = oa * cg + ob * G; B = oa * cb + ob * B; }
          else {
            const fa = oa / (oa + ob * A);
            wgm(fa, R / A, G / A, B / A);
            R = rgb[0] * A; G = rgb[1] * A; B = rgb[2] * A;
          }
        }
      }
      if (colorize) {
        // "Color" blend: source hue/saturation, target luminance (premultiplied in, premultiplied out)
        let r = A ? R / A : 0, g = A ? G / A : 0, b = A ? B / A : 0;
        const diff = (r * LUMA_R + g * LUMA_G + b * LUMA_B) - topLum;
        r = cr + diff; g = cg + diff; b = cb + diff;
        const lum = r * LUMA_R + g * LUMA_G + b * LUMA_B, mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        if (mn < 0) { r = lum + (r - lum) * lum / (lum - mn); g = lum + (g - lum) * lum / (lum - mn); b = lum + (b - lum) * lum / (lum - mn); }
        if (mx > 1) { r = lum + (r - lum) * (1 - lum) / (mx - lum); g = lum + (g - lum) * (1 - lum) / (mx - lum); b = lum + (b - lum) * (1 - lum) / (mx - lum); }
        const oa = m * oColor, ob = 1 - oa;
        R = oa * r * A + ob * R; G = oa * g * A + ob * G; B = oa * b * A + ob * B;
      }
      if (posterize) {
        const oa = m * oPost, ob = 1 - oa, n = posterizeNum;
        R = oa * Math.round(R * n) / n + ob * R; G = oa * Math.round(G * n) / n + ob * G; B = oa * Math.round(B * n) / n + ob * B;
      }

      A = clamp(A, 0, 1);
      if (A > 0.0005) {
        buf[bi] = R / A * 255 + 0.5; buf[bi + 1] = G / A * 255 + 0.5; buf[bi + 2] = B / A * 255 + 0.5;
      }
      buf[bi + 3] = A * 255 + 0.5;
      const px = i % W, py = (i - px) / W;
      if (px < x1) x1 = px; if (px > x2) x2 = px; if (py < y1) y1 = py; if (py > y2) y2 = py;
    });
    if (x2 >= x1) { this.o.onDirty?.(x1, y1, x2 + 1, y2 + 1); return true; }
    return false;
  }

  getColor(x: number, y: number, radius: number, paint: number): [number, number, number, number] {
    if (radius < 1) radius = 1;
    const { buf, W, H } = this.o, spec = this.sb, avg = this.sm;
    let sumW = 0, sumA = 0;
    // Same sampling budget as libmypaint: every pixel for tiny dabs, else every n-th plus a random share
    const interval = radius <= 2 ? 1 : Math.floor(radius * 7), randRate = 1 / (7 * radius);
    let counter = 0;
    if (paint < 0) {
      let r = 0, g = 0, b = 0, a = 0;
      forEachMaskPixel(W, H, x, y, radius, 0.5, 0.5, 1, 0, (i, m) => {
        const bi = i * 4, A = buf[bi + 3] / 255;
        sumW += m; r += m * buf[bi] / 255 * A; g += m * buf[bi + 1] / 255 * A; b += m * buf[bi + 2] / 255 * A; a += m * A;
      });
      if (sumW <= 0) return [0, 1, 0, 0];
      r /= sumW; g /= sumW; b /= sumW; a /= sumW;
      return a > 0 ? [clamp(r / a, 0, 1), clamp(g / a, 0, 1), clamp(b / a, 0, 1), clamp(a, 0, 1)] : [0, 1, 0, 0];
    }
    const avgRgb = [0, 0, 0];
    if (paint > 0) rgbToSpectral(0, 0, 0, avg);
    forEachMaskPixel(W, H, x, y, radius, 0.5, 0.5, 1, 0, (i, m) => {
      if (counter === 0 || Math.random() < randRate) {
        const bi = i * 4, A = buf[bi + 3] / 255, a = m * A, sums = a + sumA;
        sumW += m;
        let fa = 1, fb = 1;
        if (sums > 0) { fa = a / sums; fb = 1 - fa; }
        if (A > 0) {
          const r = buf[bi] / 255, g = buf[bi + 1] / 255, b = buf[bi + 2] / 255;
          if (paint > 0) { rgbToSpectral(r, g, b, spec); for (let k = 0; k < 10; k++) avg[k] = Math.pow(spec[k], fa) * Math.pow(avg[k], fb); }
          if (paint < 1) { avgRgb[0] = r * fa + avgRgb[0] * fb; avgRgb[1] = g * fa + avgRgb[1] * fb; avgRgb[2] = b * fa + avgRgb[2] * fb; }
        }
        sumA += a;
      }
      counter = (counter + 1) % interval;
    });
    if (sumW <= 0) return [0, 1, 0, 0];
    const sr = [0, 0, 0];
    if (paint > 0) spectralToRgb(avg, sr);
    const a = clamp(sumA / sumW, 0, 1);
    if (a <= 0) return [0, 1, 0, 0];
    return [
      clamp(sr[0] * paint + (1 - paint) * avgRgb[0], 0, 1),
      clamp(sr[1] * paint + (1 - paint) * avgRgb[1], 0, 1),
      clamp(sr[2] * paint + (1 - paint) * avgRgb[2], 0, 1),
      a,
    ];
  }
}

export { WGM_EPSILON };
