/* Ported from libmypaint (https://github.com/mypaint/libmypaint, commit d5a88fb), helpers.c.
 * libmypaint - The MyPaint Brush Library
 * Copyright (C) 2007-2008 Martin Renold <martinxyz@gmx.ch> and contributors
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
 */

export const WGM_EPSILON = 0.001;
export const clamp = (x: number, lo: number, hi: number) => (x > hi ? hi : x < lo ? lo : x);

// ─── 10-band spectral upsampling (MyPaint 2 "pigment" mode) ──────────────────
const T = [
  [0.026595621243689, 0.049779426257903, 0.022449850859496, -0.218453689278271, -0.256894883201278, 0.445881722194840, 0.772365886289756, 0.194498761382537, 0.014038157587820, 0.007687264480513],
  [-0.032601672674412, -0.061021043498478, -0.052490001018404, 0.206659098273522, 0.572496335158169, 0.317837248815438, -0.021216624031211, -0.019387668756117, -0.001521339050858, -0.000835181622534],
  [0.339475473216284, 0.635401374177222, 0.771520797089589, 0.113222640692379, -0.055251113343776, -0.048222578468680, -0.012966666339586, -0.001523814504223, -0.000094718948810, -0.000051604594741],
];
const SR = [0.009281362787953, 0.009732627042016, 0.011254252737167, 0.015105578649573, 0.024797924177217, 0.083622585502406, 0.977865045723212, 1.000000000000000, 0.999961046144372, 0.999999992756822];
const SG = [0.002854127435775, 0.003917589679914, 0.012132151699187, 0.748259205918013, 1.000000000000000, 0.865695937531795, 0.037477469241101, 0.022816789725717, 0.021747419446456, 0.021384940572308];
const SB = [0.537052150373386, 0.546646402401469, 0.575501819073983, 0.258778829633924, 0.041709923751716, 0.012662638828324, 0.007485593127390, 0.006766900622462, 0.006699764779016, 0.006676219883241];

/** rgb (0–1, straight) → 10-band reflectance (written into `out`). */
export function rgbToSpectral(r: number, g: number, b: number, out: Float64Array) {
  const off = 1 - WGM_EPSILON;
  r = r * off + WGM_EPSILON; g = g * off + WGM_EPSILON; b = b * off + WGM_EPSILON;
  for (let i = 0; i < 10; i++) out[i] = SR[i] * r + SG[i] * g + SB[i] * b;
}
/** 10-band reflectance → rgb (0–1). */
export function spectralToRgb(s: Float64Array, out: number[]) {
  const off = 1 - WGM_EPSILON;
  for (let c = 0; c < 3; c++) {
    let t = 0; const row = T[c];
    for (let i = 0; i < 10; i++) t += row[i] * s[i];
    out[c] = clamp((t - WGM_EPSILON) / off, 0, 1);
  }
}

const _sa = new Float64Array(10), _sb = new Float64Array(10), _sm = new Float64Array(10), _rgb = [0, 0, 0];
/** Weighted-geometric-mean pigment mix of two straight RGBA colours (libmypaint mix_colors). */
export function mixColors(a: number[], b: number[], fac: number, paintMode: number, out: number[]) {
  const opaA = fac, opaB = 1 - opaA;
  out[3] = clamp(opaA * a[3] + opaB * b[3], 0, 1);
  const sfacA = a[3] === 0 ? 0 : opaA * a[3] / (a[3] + b[3] * opaB), sfacB = 1 - sfacA;
  if (paintMode > 0) {
    rgbToSpectral(a[0], a[1], a[2], _sa); rgbToSpectral(b[0], b[1], b[2], _sb);
    for (let i = 0; i < 10; i++) _sm[i] = Math.pow(_sa[i], sfacA) * Math.pow(_sb[i], sfacB);
    spectralToRgb(_sm, _rgb);
    out[0] = _rgb[0]; out[1] = _rgb[1]; out[2] = _rgb[2];
  }
  if (paintMode < 1) for (let i = 0; i < 3; i++) out[i] = out[i] * paintMode + (1 - paintMode) * (a[i] * opaA + b[i] * opaB);
  return out;
}

// ─── Angles ──────────────────────────────────────────────────────────────────
export const modArith = (a: number, n: number) => a - n * Math.floor(a / n);
export function smallestAngularDifference(a: number, b: number) {
  let d = modArith(b - a + 180, 360) - 180;
  d += d > 180 ? -360 : d < -180 ? 360 : 0;
  return d;
}
export const RAD = (d: number) => d * Math.PI / 180;
export const DEG = (r: number) => r / (2 * Math.PI) * 360;

// ─── Colour models (in-place on a [r|h, g|s, b|v|l] triple, all 0–1) ─────────
export function rgbToHsv(c: number[]) {
  const r = clamp(c[0], 0, 1), g = clamp(c[1], 0, 1), b = clamp(c[2], 0, 1);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = 0;
  if (d > 0.0001) {
    s = d / max;
    if (r === max) { h = (g - b) / d; if (h < 0) h += 6; }
    else if (g === max) h = 2 + (b - r) / d;
    else h = 4 + (r - g) / d;
    h /= 6;
  }
  c[0] = h; c[1] = s; c[2] = max;
}
export function hsvToRgb(c: number[]) {
  let h = c[0] - Math.floor(c[0]);
  const s = clamp(c[1], 0, 1), v = clamp(c[2], 0, 1);
  if (s === 0) { c[0] = c[1] = c[2] = v; return; }
  if (h === 1) h = 0;
  h *= 6;
  const i = Math.floor(h), f = h - i, w = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const out = [[v, t, w], [q, v, w], [w, v, t], [w, q, v], [t, w, v], [v, w, q]][i] ?? [v, v, v];
  c[0] = out[0]; c[1] = out[1]; c[2] = out[2];
}
export function rgbToHsl(c: number[]) {
  const r = clamp(c[0], 0, 1), g = clamp(c[1], 0, 1), b = clamp(c[2], 0, 1);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    s = l <= 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min);
    const d = max - min || 1;
    if (r === max) h = (g - b) / d; else if (g === max) h = 2 + (b - r) / d; else h = 4 + (r - g) / d;
    h /= 6; if (h < 0) h += 1;
  }
  c[0] = h; c[1] = s; c[2] = l;
}
const hslValue = (n1: number, n2: number, hue: number) => {
  if (hue > 6) hue -= 6; else if (hue < 0) hue += 6;
  if (hue < 1) return n1 + (n2 - n1) * hue;
  if (hue < 3) return n2;
  if (hue < 4) return n1 + (n2 - n1) * (4 - hue);
  return n1;
};
export function hslToRgb(c: number[]) {
  const h = c[0] - Math.floor(c[0]), s = clamp(c[1], 0, 1), l = clamp(c[2], 0, 1);
  if (s === 0) { c[0] = c[1] = c[2] = l; return; }
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  c[0] = hslValue(m1, m2, h * 6 + 2); c[1] = hslValue(m1, m2, h * 6); c[2] = hslValue(m1, m2, h * 6 - 2);
}

// ─── Randomness (libmypaint's rand_gauss: sum of 4 uniforms, unit variance) ──
export function makeRng(seed = 1000) {
  let s = seed >>> 0 || 1;
  const next = () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, gauss: () => (next() + next() + next() + next()) * 1.73205080757 - 3.46410161514 };
}
