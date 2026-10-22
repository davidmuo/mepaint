// ─── Brush dynamics: pressure response curve + speed thinning ────────────────
// The pressure curve is a cubic Bézier from (0,0) to (1,1) with two free control
// points (same model as CSS easing). It's baked into a 256-entry lookup table so
// the per-dab cost is a single array read.

export interface PressureCurve { x1: number; y1: number; x2: number; y2: number }

export interface Dynamics {
  curve: PressureCurve;
  /** pen pressure scales dab size */
  pressureSize: boolean;
  /** pen pressure scales dab flow */
  pressureFlow: boolean;
  /** 0–100: fast strokes get thinner, like an ink nib */
  speedThin: number;
}

export const CURVE_PRESETS: { id: string; label: string; curve: PressureCurve }[] = [
  { id: 'soft',    label: 'Soft',    curve: { x1: .08, y1: .55, x2: .4,  y2: .95 } },
  { id: 'natural', label: 'Natural', curve: { x1: .2,  y1: .42, x2: .55, y2: .88 } },
  { id: 'linear',  label: 'Linear',  curve: { x1: .33, y1: .33, x2: .67, y2: .67 } },
  { id: 'firm',    label: 'Firm',    curve: { x1: .55, y1: .08, x2: .92, y2: .5  } },
];

export const DEFAULT_DYNAMICS: Dynamics = {
  curve: CURVE_PRESETS[1].curve, pressureSize: true, pressureFlow: true, speedThin: 0,
};

const bez = (a: number, b: number, t: number) => {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
};

/** Bake the curve into a LUT indexed by round(pressure*255). */
export function curveLUT(c: PressureCurve): Float32Array {
  const N = 600, xs = new Float32Array(N + 1), ys = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) { const t = i / N; xs[i] = bez(c.x1, c.x2, t); ys[i] = bez(c.y1, c.y2, t); }
  const lut = new Float32Array(256);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    while (j < N && xs[j + 1] < x) j++;
    const span = xs[j + 1] - xs[j];
    const f = span > 1e-6 ? (x - xs[j]) / span : 0;
    lut[i] = Math.max(0, Math.min(1, ys[j] + (ys[j + 1] - ys[j]) * Math.max(0, Math.min(1, f))));
  }
  return lut;
}

/** SVG path for drawing the curve in a size×size box (y up). */
export function curvePath(c: PressureCurve, size: number): string {
  const p = (x: number, y: number) => `${(x * size).toFixed(1)} ${((1 - y) * size).toFixed(1)}`;
  return `M ${p(0, 0)} C ${p(c.x1, c.y1)}, ${p(c.x2, c.y2)}, ${p(1, 1)}`;
}

export function loadDynamics(): Dynamics {
  try {
    const d = JSON.parse(localStorage.getItem('mepaint-dynamics') ?? 'null');
    if (d && d.curve) return { ...DEFAULT_DYNAMICS, ...d };
  } catch { /* fall through */ }
  return DEFAULT_DYNAMICS;
}
export function saveDynamics(d: Dynamics) {
  try { localStorage.setItem('mepaint-dynamics', JSON.stringify(d)); } catch { /* storage unavailable */ }
}
