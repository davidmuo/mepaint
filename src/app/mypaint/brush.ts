/* Ported from libmypaint (https://github.com/mypaint/libmypaint, commit d5a88fb):
 * mypaint-brush.c and mypaint-mapping.c.
 * libmypaint - The MyPaint Brush Library
 * Copyright (C) 2007-2011 Martin Renold <martinxyz@gmx.ch> and contributors
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
import { INPUTS, INPUT_ALIASES, SETTING_DEFAULTS, SETTINGS, type InputName, type SettingName } from './settings';
import {
  clamp, modArith, smallestAngularDifference, RAD, DEG, mixColors, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb, makeRng, WGM_EPSILON,
} from './helpers';
import type { MyPaintSurface } from './surface';

const ACTUAL_RADIUS_MIN = 0.2, ACTUAL_RADIUS_MAX = 1000, GRID_SIZE = 256;
const NUM_BUCKETS = 256;
// smudge bucket layout
const SR = 0, SG = 1, SB = 2, SA = 3, PR = 4, PG = 5, PB = 6, PA = 7, RECENT = 8;
const IN = Object.fromEntries(INPUTS.map((n, i) => [n, i])) as Record<InputName, number>;

/** Piecewise-linear dynamics curves: setting = base + Σ curve_i(input_i). */
class Mapping {
  base = 0;
  pts: ({ xs: number[]; ys: number[] } | null)[] = INPUTS.map(() => null);
  used = 0;
  setPoints(input: number, points: [number, number][]) {
    const had = !!this.pts[input];
    if (points.length < 2) { this.pts[input] = null; if (had) this.used--; return; }
    this.pts[input] = { xs: points.map(p => p[0]), ys: points.map(p => p[1]) };
    if (!had) this.used++;
  }
  isConstant() { return this.used === 0; }
  calc(inputs: Float64Array) {
    let result = this.base;
    if (this.used === 0) return result;
    for (let j = 0; j < this.pts.length; j++) {
      const p = this.pts[j]; if (!p) continue;
      const x = inputs[j];
      let x0 = p.xs[0], y0 = p.ys[0], x1 = p.xs[1], y1 = p.ys[1];
      for (let i = 2; i < p.xs.length && x > x1; i++) { x0 = x1; y0 = y1; x1 = p.xs[i]; y1 = p.ys[i]; }
      result += x0 === x1 || y0 === y1 ? y0 : (y1 * (x - x0) + y0 * (x1 - x)) / (x1 - x0);
    }
    return result;
  }
}

const expDecay = (T: number, t: number) => (T <= 0.001 ? 0 : Math.exp(-t / T));

/** Brush state that evolves during a stroke (libmypaint STATE(...)). */
function freshState() {
  return {
    x: 0, y: 0, pressure: 0, partial_dabs: 0, actual_radius: 0,
    actual_x: 0, actual_y: 0, norm_dx_slow: 0, norm_dy_slow: 0, norm_speed1_slow: 0, norm_speed2_slow: 0,
    stroke: 0, stroke_started: 0, custom_input: 0, actual_elliptical_dab_ratio: 0, actual_elliptical_dab_angle: 0,
    direction_dx: 0, direction_dy: 0, declination: 0, ascension: 0, viewzoom: 0, viewrotation: 0,
    direction_angle_dx: 0, direction_angle_dy: 0, flip: -1, gridmap_x: 0, gridmap_y: 0, declinationx: 0, declinationy: 0,
    dabs_per_basic_radius: 0, dabs_per_actual_radius: 0, dabs_per_second: 0, barrel_rotation: 0,
  };
}

export class MyPaintBrush {
  private map = {} as Record<SettingName, Mapping>;
  /** current (dynamics-applied) value of every setting */
  v = {} as Record<SettingName, number>;
  private s = freshState();
  private buckets: (Float64Array | null)[] = new Array(NUM_BUCKETS).fill(null);
  private inputs = new Float64Array(INPUTS.length);
  private rng = makeRng(1000);
  private randomInput = 0;
  private skip = 0; private skipLastX = 0; private skipLastY = 0; private skippedDtime = 0;
  private resetRequested = true;
  private speedGamma = [0, 0]; private speedM = [0, 0]; private speedQ = [0, 0];
  private strokeTotalPaintingTime = 0; private strokeCurrentIdlingTime = 0;

  constructor() {
    for (const n of SETTINGS) { this.map[n] = new Mapping(); this.v[n] = 0; }
    this.fromDefaults();
    this.reset();
  }

  fromDefaults() {
    for (const n of SETTINGS) { const m = this.map[n]; m.pts = INPUTS.map(() => null); m.used = 0; m.base = SETTING_DEFAULTS[n]; }
    this.map.opaque_multiply.setPoints(IN.pressure, [[0, 0], [1, 1]]);
    this.baseValuesChanged();
  }

  /** Load a MyPaint .myb (JSON version 3) brush. Returns false if the file isn't understood. */
  fromJSON(text: string): boolean {
    let json: { version?: number; settings?: Record<string, { base_value: number; inputs: Record<string, [number, number][]> }> };
    try { json = JSON.parse(text); } catch { return false; }
    if (json.version !== 3 || !json.settings) return false;
    this.fromDefaults();
    for (const [name, def] of Object.entries(json.settings)) {
      if (!(name in SETTING_DEFAULTS)) continue;
      const m = this.map[name as SettingName];
      m.base = def.base_value;
      for (const [inName, pts] of Object.entries(def.inputs ?? {})) {
        const id = IN[(INPUT_ALIASES[inName] ?? inName) as InputName];
        if (id === undefined) continue;
        m.setPoints(id, pts);
      }
    }
    this.baseValuesChanged();
    return true;
  }

  getBase(n: SettingName) { return this.map[n].base; }
  setBase(n: SettingName, value: number) { this.map[n].base = value; this.baseValuesChanged(); }
  /** Queue a state reset; applied on the next strokeTo (as in libmypaint). */
  reset() { this.resetRequested = true; }
  newStroke() { this.strokeCurrentIdlingTime = 0; this.strokeTotalPaintingTime = 0; }

  private brushReset() {
    this.skip = 0; this.skipLastX = 0; this.skipLastY = 0; this.skippedDtime = 0;
    this.s = freshState();
    this.buckets.fill(null);
  }

  private baseValuesChanged() {
    // speed input mapping: y = log(gamma + x) * m + q, fixed so speed 45 px/dab-radius → 0.5
    for (let i = 0; i < 2; i++) {
      const gamma = Math.exp(i === 0 ? this.map.speed1_gamma.base : this.map.speed2_gamma.base);
      const fix1x = 45, fix1y = 0.5, fix2x = 45, fix2dy = 0.015;
      const c1 = Math.log(fix1x + gamma), m = fix2dy * (fix2x + gamma), q = fix1y - m * c1;
      this.speedGamma[i] = gamma; this.speedM[i] = m; this.speedQ[i] = q;
    }
  }

  private directionalOffsets(baseRadius: number, flip: number) {
    const V = this.v, S = this.s;
    const mult = Math.exp(V.offset_multiplier);
    if (!isFinite(mult)) return { x: 0, y: 0 };
    let dx = V.offset_x, dy = V.offset_y;
    const adj = V.offset_angle_adj;
    const angleDeg = (DEG(Math.atan2(S.direction_angle_dy, S.direction_angle_dx)) - 90) % 360;
    if (V.offset_angle) { const a = RAD(angleDeg + adj); dx += Math.cos(a) * V.offset_angle; dy += Math.sin(a) * V.offset_angle; }
    const viewRot = S.viewrotation;
    if (V.offset_angle_asc) { const a = RAD(S.ascension - viewRot + adj); dx += Math.cos(a) * V.offset_angle_asc; dy += Math.sin(a) * V.offset_angle_asc; }
    if (V.offset_angle_view) { const a = RAD(viewRot + adj); dx += Math.cos(-a) * V.offset_angle_view; dy += Math.sin(-a) * V.offset_angle_view; }
    const dirMirror = Math.max(0, V.offset_angle_2);
    if (dirMirror) { const a = RAD(angleDeg + adj * flip); dx += Math.cos(a) * dirMirror * flip; dy += Math.sin(a) * dirMirror * flip; }
    const ascMirror = Math.max(0, V.offset_angle_2_asc);
    if (ascMirror) { const a = RAD(S.ascension - viewRot + adj * flip); dx += Math.cos(a) * flip * ascMirror; dy += Math.sin(a) * flip * ascMirror; }
    const viewMirror = Math.max(0, V.offset_angle_2_view);
    if (viewMirror) { const a = RAD(viewRot + adj); dx += Math.cos(-a) * flip * viewMirror; dy += Math.sin(-a) * flip * viewMirror; }
    const lim = 3240, k = baseRadius * mult;
    return { x: clamp(dx * k, -lim, lim), y: clamp(dy * k, -lim, lim) };
  }

  private updateStates(stepDdab: number, stepDx: number, stepDy: number, stepDpressure: number, stepDecl: number, stepAsc: number,
    stepDtime: number, viewzoom: number, viewrotation: number, stepDeclX: number, stepDeclY: number, stepBarrel: number) {
    const S = this.s, V = this.v, M = this.map, inp = this.inputs;
    if (stepDtime <= 0) stepDtime = 0.001;
    S.x += stepDx; S.y += stepDy; S.pressure += stepDpressure;
    S.declination += stepDecl; S.ascension += stepAsc; S.declinationx += stepDeclX; S.declinationy += stepDeclY;
    S.viewzoom = viewzoom;
    const viewrot = modArith(DEG(viewrotation) + 180, 360) - 180;
    S.viewrotation = viewrot;
    { // gridmap
      const scale = Math.exp(V.gridmap_scale), sz = scale * GRID_SIZE;
      S.gridmap_x = modArith(Math.abs(S.actual_x * V.gridmap_scale_x), sz) / sz * GRID_SIZE;
      S.gridmap_y = modArith(Math.abs(S.actual_y * V.gridmap_scale_y), sz) / sz * GRID_SIZE;
      if (S.actual_x < 0) S.gridmap_x = GRID_SIZE - S.gridmap_x;
      if (S.actual_y < 0) S.gridmap_y = GRID_SIZE - S.gridmap_y;
    }
    const baseRadius = Math.exp(M.radius_logarithmic.base);
    S.barrel_rotation += stepBarrel;
    if (S.pressure <= 0) S.pressure = 0;
    const pressure = S.pressure;
    { // stroke start/end (for the "stroke" input)
      const lim = 0.0001, threshold = M.stroke_threshold.base;
      if (!S.stroke_started && pressure > threshold + lim) { S.stroke_started = 1; S.stroke = 0; }
      else if (S.stroke_started && pressure <= threshold * 0.9 + lim) S.stroke_started = 0;
    }
    const normDx = stepDx / stepDtime * S.viewzoom, normDy = stepDy / stepDtime * S.viewzoom;
    const normSpeed = Math.hypot(normDx, normDy);
    const normDist = Math.hypot(stepDx / stepDtime / baseRadius, stepDy / stepDtime / baseRadius) * stepDtime;

    inp[IN.pressure] = pressure * Math.exp(M.pressure_gain_log.base);
    inp[IN.speed1] = Math.log(this.speedGamma[0] + S.norm_speed1_slow) * this.speedM[0] + this.speedQ[0];
    inp[IN.speed2] = Math.log(this.speedGamma[1] + S.norm_speed2_slow) * this.speedM[1] + this.speedQ[1];
    inp[IN.random] = this.randomInput;
    inp[IN.stroke] = Math.min(S.stroke, 1);
    const dirAngle = Math.atan2(S.direction_dy, S.direction_dx);
    inp[IN.direction] = modArith(DEG(dirAngle) + viewrot + 180, 180);
    const dirAngle360 = Math.atan2(S.direction_angle_dy, S.direction_angle_dx);
    inp[IN.direction_angle] = (DEG(dirAngle360) + viewrot + 360) % 360;
    inp[IN.tilt_declination] = S.declination;
    inp[IN.tilt_ascension] = modArith(S.ascension + viewrot + 180, 360) - 180;
    inp[IN.viewzoom] = M.radius_logarithmic.base - Math.log(baseRadius / S.viewzoom);
    inp[IN.attack_angle] = smallestAngularDifference(S.ascension, modArith(DEG(dirAngle360) + 90, 360));
    inp[IN.brush_radius] = M.radius_logarithmic.base;
    inp[IN.gridmap_x] = clamp(S.gridmap_x, 0, GRID_SIZE);
    inp[IN.gridmap_y] = clamp(S.gridmap_y, 0, GRID_SIZE);
    inp[IN.tilt_declinationx] = S.declinationx;
    inp[IN.tilt_declinationy] = S.declinationy;
    inp[IN.custom] = S.custom_input;
    inp[IN.barrel_rotation] = modArith(S.barrel_rotation, 360);

    for (const n of SETTINGS) V[n] = M[n].calc(inp);

    S.dabs_per_basic_radius = V.dabs_per_basic_radius;
    S.dabs_per_actual_radius = V.dabs_per_actual_radius;
    S.dabs_per_second = V.dabs_per_second;
    { const fac = 1 - expDecay(V.slow_tracking_per_dab, stepDdab); S.actual_x += (S.x - S.actual_x) * fac; S.actual_y += (S.y - S.actual_y) * fac; }
    {
      const f1 = 1 - expDecay(V.speed1_slowness, stepDtime); S.norm_speed1_slow += (normSpeed - S.norm_speed1_slow) * f1;
      const f2 = 1 - expDecay(V.speed2_slowness, stepDtime); S.norm_speed2_slow += (normSpeed - S.norm_speed2_slow) * f2;
    }
    {
      let tc = Math.exp(V.offset_by_speed_slowness * 0.01) - 1; if (tc < 0.002) tc = 0.002;
      const fac = 1 - expDecay(tc, stepDtime);
      S.norm_dx_slow += (normDx - S.norm_dx_slow) * fac; S.norm_dy_slow += (normDy - S.norm_dy_slow) * fac;
    }
    { // direction, filtered in dab-time
      let dx = stepDx * S.viewzoom, dy = stepDy * S.viewzoom;
      const step = Math.hypot(dx, dy);
      const fac = 1 - expDecay(Math.exp(V.direction_filter * 0.5) - 1, step);
      const dxOld = S.direction_dx, dyOld = S.direction_dy;
      S.direction_angle_dx += (dx - S.direction_angle_dx) * fac;
      S.direction_angle_dy += (dy - S.direction_angle_dy) * fac;
      // ignore 180° turns for the (0–180°) direction input
      if ((dxOld - dx) ** 2 + (dyOld - dy) ** 2 > (dxOld + dx) ** 2 + (dyOld + dy) ** 2) { dx = -dx; dy = -dy; }
      S.direction_dx += (dx - S.direction_dx) * fac; S.direction_dy += (dy - S.direction_dy) * fac;
    }
    { const fac = 1 - expDecay(V.custom_input_slowness, 0.1); S.custom_input += (V.custom_input - S.custom_input) * fac; }
    {
      const freq = Math.exp(-V.stroke_duration_logarithmic);
      const stroke = Math.max(0, S.stroke + normDist * freq), wrap = 1 + Math.max(0, V.stroke_holdtime);
      if (stroke >= wrap && wrap > 9.9 + 1) S.stroke = 1;
      else if (stroke >= wrap) S.stroke = stroke % wrap;
      else S.stroke = stroke;
    }
    S.actual_radius = clamp(Math.exp(V.radius_logarithmic), ACTUAL_RADIUS_MIN, ACTUAL_RADIUS_MAX);
    S.actual_elliptical_dab_ratio = V.elliptical_dab_ratio;
    S.actual_elliptical_dab_angle = modArith(V.elliptical_dab_angle - viewrot + 180, 180) - 180;
  }

  private bucket(): Float64Array {
    const i = clamp(Math.round(this.v.smudge_bucket), 0, NUM_BUCKETS - 1);
    return this.buckets[i] ?? (this.buckets[i] = new Float64Array(9));
  }

  private updateSmudge(surface: MyPaintSurface, b: Float64Array, smudgeLength: number, px: number, py: number, radius: number, legacy: boolean, paint: number): boolean {
    let update = Math.max(0.01, smudgeLength);
    const lengthLog = this.v.smudge_length_log;
    const recentness = b[RECENT] * update;
    b[RECENT] = recentness;
    let r: number, g: number, bl: number, a: number;
    // Sampling is as costly as a dab, so reuse the previous sample unless it's gone stale
    if (recentness < Math.min(1, Math.pow(0.5 * update, lengthLog) + 1e-16)) {
      if (recentness === 0) update = 0; // first sample initialises the smudge colour
      b[RECENT] = 1;
      const sr = clamp(radius * Math.exp(this.v.smudge_radius_log), ACTUAL_RADIUS_MIN, ACTUAL_RADIUS_MAX);
      [r, g, bl, a] = surface.getColor(px, py, sr, legacy ? -1 : paint);
      const lim = this.v.smudge_transparency;
      if ((lim > 0 && a < lim) || (lim < 0 && a > -lim)) return true;
      b[PR] = r; b[PG] = g; b[PB] = bl; b[PA] = a;
    } else { r = b[PR]; g = b[PG]; bl = b[PB]; a = b[PA]; }
    if (legacy) {
      const fo = update, fn = (1 - update) * a;
      b[SR] = fo * b[SR] + fn * r; b[SG] = fo * b[SG] + fn * g; b[SB] = fo * b[SB] + fn * bl;
      b[SA] = clamp(fo * b[SA] + fn, 0, 1);
    } else if (a > WGM_EPSILON * 10) {
      const out = mixColors([b[SR], b[SG], b[SB], b[SA]], [r, g, bl, a], update, paint, [0, 0, 0, 0]);
      b[SR] = out[0]; b[SG] = out[1]; b[SB] = out[2]; b[SA] = out[3];
    } else b[SA] = (b[SA] + a) / 2;
    return false;
  }

  private applySmudge(b: Float64Array, smudgeValue: number, legacy: boolean, paint: number, col: number[]): number {
    const f = Math.min(1, smudgeValue);
    // a partly transparent smudge colour erases towards that transparency
    const target = clamp(1 - f + f * b[SA], 0, 1);
    if (target > 0) {
      if (legacy) {
        const cf = 1 - f;
        col[0] = (f * b[SR] + cf * col[0]) / target; col[1] = (f * b[SG] + cf * col[1]) / target; col[2] = (f * b[SB] + cf * col[2]) / target;
      } else {
        const out = mixColors([b[SR], b[SG], b[SB], b[SA]], [col[0], col[1], col[2], 1], f, paint, [0, 0, 0, 0]);
        col[0] = out[0]; col[1] = out[1]; col[2] = out[2];
      }
    } else { col[0] = 1; col[1] = 0; col[2] = 0; }
    return target;
  }

  private prepareAndDrawDab(surface: MyPaintSurface): boolean {
    const S = this.s, V = this.v, M = this.map;
    let opaque = clamp(Math.max(0, V.opaque) * V.opaque_multiply, 0, 1);
    const lin = M.opaque_linearize.base;
    if (lin) {
      let dpp = (S.dabs_per_actual_radius + S.dabs_per_basic_radius) * 2;
      if (dpp < 1) dpp = 1;
      dpp = 1 + lin * (dpp - 1);
      opaque = 1 - Math.pow(1 - opaque, 1 / dpp);
    }
    let x = S.actual_x, y = S.actual_y;
    const baseRadius = Math.exp(M.radius_logarithmic.base);
    const offs = this.directionalOffsets(baseRadius, S.flip);
    x += offs.x; y += offs.y;
    if (V.offset_by_speed) { x += S.norm_dx_slow * V.offset_by_speed * 0.1 / S.viewzoom; y += S.norm_dy_slow * V.offset_by_speed * 0.1 / S.viewzoom; }
    if (V.offset_by_random) { const amp = Math.max(0, V.offset_by_random); x += this.rng.gauss() * amp * baseRadius; y += this.rng.gauss() * amp * baseRadius; }
    let radius = S.actual_radius;
    if (V.radius_by_random) {
      radius = clamp(Math.exp(V.radius_logarithmic + this.rng.gauss() * V.radius_by_random), ACTUAL_RADIUS_MIN, ACTUAL_RADIUS_MAX);
      const corr = (S.actual_radius / radius) ** 2;
      if (corr <= 1) opaque *= corr;
    }
    const paint = V.paint_mode;
    const legacy = paint <= 0 && M.paint_mode.isConstant();
    const col = [M.color_h.base, M.color_s.base, M.color_v.base];
    hsvToRgb(col);

    const smudgeLength = V.smudge_length;
    if (smudgeLength < 1 && (V.smudge !== 0 || !M.smudge.isConstant())) {
      if (this.updateSmudge(surface, this.bucket(), smudgeLength, Math.round(x), Math.round(y), radius, legacy, paint)) return false;
    }
    let eraserTarget = 1;
    if (V.smudge > 0) eraserTarget = this.applySmudge(this.bucket(), V.smudge, legacy, paint, col);
    if (V.eraser) eraserTarget *= 1 - V.eraser;

    if (V.change_color_h || V.change_color_hsv_s || V.change_color_v) {
      rgbToHsv(col);
      col[0] += V.change_color_h; col[1] += col[1] * col[2] * V.change_color_hsv_s; col[2] += V.change_color_v;
      hsvToRgb(col);
    }
    if (V.change_color_l || V.change_color_hsl_s) {
      rgbToHsl(col);
      col[2] += V.change_color_l;
      col[1] += col[1] * Math.min(Math.abs(1 - col[2]), Math.abs(col[2])) * 2 * V.change_color_hsl_s;
      hslToRgb(col);
    }

    let hardness = clamp(V.hardness, 0, 1);
    const softness = clamp(V.softness, 0, 1);
    // anti-aliasing: soften very hard edges but keep the optical radius
    const fade = radius * (1 - hardness), minFade = V.anti_aliasing;
    if (fade < minFade) {
      const optical = radius - (1 - hardness) * radius / 2;
      const hNew = (optical - minFade / 2) / (optical + minFade / 2);
      radius = minFade / (1 - hNew); hardness = hNew;
    }
    const snap = V.snap_to_pixel;
    if (snap > 0) {
      x += (Math.floor(x) + 0.5 - x) * snap; y += (Math.floor(y) + 0.5 - y) * snap;
      let sr = Math.round(radius * 2) / 2; if (sr < 0.5) sr = 0.5; if (snap > 0.9999) sr -= 0.0001;
      radius += (sr - radius) * snap;
    }
    return surface.drawDab({
      x, y, radius, r: col[0], g: col[1], b: col[2], opaque, hardness, softness, colorA: eraserTarget,
      aspect: S.actual_elliptical_dab_ratio, angle: S.actual_elliptical_dab_angle,
      lockAlpha: V.lock_alpha, colorize: V.colorize, posterize: V.posterize, posterizeNum: V.posterize_num, paint,
    });
  }

  private countDabsTo(x: number, y: number, dt: number) {
    const S = this.s;
    const baseRadius = clamp(Math.exp(this.map.radius_logarithmic.base), ACTUAL_RADIUS_MIN, ACTUAL_RADIUS_MAX);
    if (S.actual_radius === 0) S.actual_radius = baseRadius;
    const dx = x - S.x, dy = y - S.y;
    let dist: number;
    if (S.actual_elliptical_dab_ratio > 1) {
      const a = RAD(S.actual_elliptical_dab_angle), cs = Math.cos(a), sn = Math.sin(a);
      const yyr = (dy * cs - dx * sn) * S.actual_elliptical_dab_ratio, xxr = dy * sn + dx * cs;
      dist = Math.sqrt(yyr * yyr + xxr * xxr);
    } else dist = Math.hypot(dx, dy);
    const res = dist / S.actual_radius * S.dabs_per_actual_radius + dist / baseRadius * S.dabs_per_basic_radius + dt * S.dabs_per_second;
    return isNaN(res) || res < 0 ? 0 : res;
  }

  /**
   * Feed one pointer event. Coordinates are surface pixels, dtime in seconds,
   * tilt in [-1, 1], viewrotation in radians. Returns true when the stroke is finished/empty.
   */
  strokeTo(surface: MyPaintSurface, x: number, y: number, pressure: number, xtilt: number, ytilt: number,
    dtime: number, viewzoom: number, viewrotation: number, barrelRotation = 0): boolean {
    const S = this.s, M = this.map;
    const maxDtime = 5;
    let asc = 0, decl = 90, declX = 90, declY = 90;
    if (xtilt !== 0 || ytilt !== 0) {
      xtilt = clamp(xtilt, -1, 1); ytilt = clamp(ytilt, -1, 1);
      asc = DEG(Math.atan2(-xtilt, ytilt));
      decl = 90 - Math.hypot(xtilt, ytilt) * 60; declX = xtilt * 60; declY = ytilt * 60;
    }
    if (pressure <= 0) pressure = 0;
    if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 1e10 || Math.abs(y) > 1e10) { x = 0; y = 0; pressure = 0; viewzoom = 0; viewrotation = 0; barrelRotation = 0; }
    if (dtime <= 0) dtime = 0.0001;
    if (dtime > 0.1 && pressure && S.pressure === 0) {
      // tablets that don't report hover motion: don't interpolate pressure across the gap
      this.strokeTo(surface, x, y, 0, 90, 0, dtime - 0.0001, viewzoom, viewrotation, 0);
      dtime = 0.0001;
    }
    if (this.skip > 0.001) {
      const dist = Math.hypot(this.skipLastX - x, this.skipLastY - y);
      this.skipLastX = x; this.skipLastY = y; this.skippedDtime += dtime; this.skip -= dist; dtime = this.skippedDtime;
      if (this.skip > 0.001 && !(dtime > maxDtime || this.resetRequested)) return false;
      this.skip = 0; this.skipLastX = 0; this.skipLastY = 0; this.skippedDtime = 0;
    }
    { // tracking noise + slow tracking
      if (M.tracking_noise.base) {
        const noise = Math.exp(M.radius_logarithmic.base) * M.tracking_noise.base;
        if (noise > 0.001) {
          this.skip = 0.5 * noise; this.skipLastX = x; this.skipLastY = y;
          x += noise * this.rng.gauss(); y += noise * this.rng.gauss();
        }
      }
      const fac = 1 - expDecay(M.slow_tracking.base, 100 * dtime);
      x = S.x + (x - S.x) * fac; y = S.y + (y - S.y) * fac;
    }
    if (dtime > maxDtime || this.resetRequested) {
      this.resetRequested = false;
      this.brushReset();
      this.randomInput = this.rng.next();
      this.s.x = x; this.s.y = y; this.s.pressure = pressure;
      this.s.actual_x = x; this.s.actual_y = y; this.s.stroke = 1;
      return true;
    }
    const St = this.s;
    let painted = 0; // 0 unknown, 1 yes, 2 no
    let dtimeLeft = dtime;
    let stepDdab: number, stepDx: number, stepDy: number, stepDpressure = 0, stepDtime: number;
    let stepDecl: number, stepAsc: number, stepDeclX: number, stepDeclY: number, stepBarrel: number;
    let dabsMoved = St.partial_dabs;
    let dabsTodo = this.countDabsTo(x, y, dtime);
    let guard = 0;
    while (dabsMoved + dabsTodo >= 1 && guard++ < 4000) {
      if (dabsMoved > 0) { stepDdab = 1 - dabsMoved; dabsMoved = 0; } else stepDdab = 1;
      const frac = stepDdab / dabsTodo;
      stepDx = frac * (x - St.x); stepDy = frac * (y - St.y);
      stepDpressure = frac * (pressure - St.pressure);
      stepDtime = frac * dtimeLeft;
      stepDecl = frac * (decl - St.declination);
      stepDeclX = frac * (declX - St.declinationx); stepDeclY = frac * (declY - St.declinationy);
      stepAsc = frac * smallestAngularDifference(St.ascension, asc);
      stepBarrel = frac * smallestAngularDifference(St.barrel_rotation, barrelRotation * 360);
      this.updateStates(stepDdab, stepDx, stepDy, stepDpressure, stepDecl, stepAsc, stepDtime, viewzoom, viewrotation, stepDeclX, stepDeclY, stepBarrel);
      St.flip *= -1;
      const now = this.prepareAndDrawDab(surface);
      if (now) painted = 1; else if (painted === 0) painted = 2;
      this.randomInput = this.rng.next();
      dtimeLeft -= stepDtime;
      dabsTodo = this.countDabsTo(x, y, dtimeLeft);
    }
    // move the brush to the current time (no more dabs this event)
    stepDpressure = pressure - St.pressure;
    this.updateStates(dabsTodo, x - St.x, y - St.y, stepDpressure, decl - St.declination,
      smallestAngularDifference(St.ascension, asc), dtimeLeft, viewzoom, viewrotation,
      declX - St.declinationx, declY - St.declinationy, smallestAngularDifference(St.barrel_rotation, barrelRotation * 360));
    St.partial_dabs = dabsMoved + dabsTodo;

    if (painted === 0) painted = this.strokeCurrentIdlingTime > 0 || this.strokeTotalPaintingTime === 0 ? 2 : 1;
    if (painted === 1) {
      this.strokeTotalPaintingTime += dtime; this.strokeCurrentIdlingTime = 0;
      if (this.strokeTotalPaintingTime > 4 + 3 * pressure && stepDpressure >= 0) return true;
    } else {
      this.strokeCurrentIdlingTime += dtime;
      if (this.strokeTotalPaintingTime === 0) { if (this.strokeCurrentIdlingTime > 1) return true; }
      else if (this.strokeTotalPaintingTime + this.strokeCurrentIdlingTime > 0.9 + 5 * pressure) return true;
    }
    return false;
  }
}

/** Set a brush's colour base values from an sRGB 0–255 triple. */
export function setBrushColor(b: MyPaintBrush, rgb: [number, number, number]) {
  const c = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  rgbToHsv(c);
  b.setBase('color_h', c[0]); b.setBase('color_s', c[1]); b.setBase('color_v', c[2]);
}
