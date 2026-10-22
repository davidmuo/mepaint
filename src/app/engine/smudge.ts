// ─── Wet smudge ───────────────────────────────────────────────────────────────
// The brush carries a small "patch" of paint (PS×PS cells in dab-normalised space,
// each r,g,b,alpha,height). Every dab:
//   1. samples what's under it (before painting),
//   2. lays the carried patch down onto the canvas,
//   3. lets the carried patch pick up some of what it just sampled.
// Smudge length decides how much of the old patch survives each dab (how far paint
// is dragged); colour rate loads fresh brush colour into the patch with pigment
// mixing, which turns the smudge tool into a wet-blending brush.
import { pigmentMix } from '../components/pigment-mix';

export type SmudgeMode = 'smear' | 'dull';
export interface SmudgeConfig {
  mode: SmudgeMode;
  /** 0–100: how much carried paint survives each dab */
  length: number;
  /** 0–100: how much fresh brush colour is loaded each dab */
  colorRate: number;
}
export const DEFAULT_SMUDGE: SmudgeConfig = { mode: 'smear', length: 72, colorRate: 0 };

export const PS = 20;
const CH = 5; // r, g, b, alpha 0–1, height 0–255

export interface SmudgeState { patch: Float32Array | null }
export const newSmudgeState = (): SmudgeState => ({ patch: null });

/** Sample the dab footprint into a fresh patch. Coordinates outside the canvas clamp to the edge. */
export function samplePatch(
  buf: Uint8ClampedArray, hbuf: Uint8ClampedArray | null, W: number, H: number,
  cx: number, cy: number, radius: number, mode: SmudgeMode,
): Float32Array {
  const p = new Float32Array(PS * PS * CH);
  for (let j = 0; j < PS; j++) for (let i = 0; i < PS; i++) {
    const px = Math.max(0, Math.min(W - 1, Math.round(cx + ((i + .5) / PS * 2 - 1) * radius)));
    const py = Math.max(0, Math.min(H - 1, Math.round(cy + ((j + .5) / PS * 2 - 1) * radius)));
    const bi = (py * W + px) * 4, k = (j * PS + i) * CH;
    p[k] = buf[bi]; p[k + 1] = buf[bi + 1]; p[k + 2] = buf[bi + 2];
    p[k + 3] = buf[bi + 3] / 255; p[k + 4] = hbuf ? hbuf[py * W + px] : 0;
  }
  if (mode === 'dull') {
    // Dulling: replace the footprint with its (alpha-weighted) average inside the round dab
    let r = 0, g = 0, b = 0, a = 0, h = 0, n = 0;
    for (let j = 0; j < PS; j++) for (let i = 0; i < PS; i++) {
      const u = (i + .5) / PS * 2 - 1, v = (j + .5) / PS * 2 - 1;
      if (u * u + v * v > 1) continue;
      const k = (j * PS + i) * CH, w = p[k + 3];
      r += p[k] * w; g += p[k + 1] * w; b += p[k + 2] * w; a += w; h += p[k + 4]; n++;
    }
    const aw = a || 1, avg = [r / aw, g / aw, b / aw, a / (n || 1), h / (n || 1)];
    for (let k = 0; k < p.length; k += CH) for (let c = 0; c < CH; c++) p[k + c] = avg[c];
  }
  return p;
}

/** Let the carried patch pick up the freshly sampled paint (+ optionally fresh brush colour). */
export function advancePatch(state: SmudgeState, fresh: Float32Array, cfg: SmudgeConfig, brush: number[]) {
  if (!state.patch) { state.patch = fresh; return; }
  const P = state.patch, keep = Math.min(.985, cfg.length / 100);
  for (let k = 0; k < P.length; k++) P[k] = P[k] * keep + fresh[k] * (1 - keep);
  if (cfg.colorRate > 0) {
    const r = cfg.colorRate / 100 * .45;
    const tmp = [0, 0, 0];
    for (let k = 0; k < P.length; k += CH) {
      tmp[0] = P[k]; tmp[1] = P[k + 1]; tmp[2] = P[k + 2];
      // Transparent cells take the brush colour outright; painted cells mix like pigment
      const m = P[k + 3] < .02 ? brush : pigmentMix(tmp, brush, r);
      P[k] = m[0]; P[k + 1] = m[1]; P[k + 2] = m[2];
      P[k + 3] = P[k + 3] + (1 - P[k + 3]) * r;
    }
  }
}

/** Read the carried patch cell under a dab-local offset (dx,dy in pixels from the dab centre). */
export function patchIndex(dx: number, dy: number, radius: number): number {
  const i = Math.max(0, Math.min(PS - 1, Math.floor((dx / radius + 1) / 2 * PS)));
  const j = Math.max(0, Math.min(PS - 1, Math.floor((dy / radius + 1) / 2 * PS)));
  return (j * PS + i) * CH;
}

export function loadSmudge(): SmudgeConfig {
  try { const s = JSON.parse(localStorage.getItem('mepaint-smudge') ?? 'null'); if (s?.mode) return { ...DEFAULT_SMUDGE, ...s }; } catch { /* default */ }
  return DEFAULT_SMUDGE;
}
export function saveSmudge(c: SmudgeConfig) {
  try { localStorage.setItem('mepaint-smudge', JSON.stringify(c)); } catch { /* storage unavailable */ }
}
