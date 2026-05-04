// ── Subtractive (pigment) color mixing ───────────────────────────────────────
// Delta-corrected Kubelka-Munk mixing with 7-primary spectral upsampling and
// a neutral substrate reflectance for accurate dark-colour handling.
//
// Architecture:
//   1. sRGB → linear RGB → decompose into 7 pigment weights
//   2. Weights → spectral reflectance via substrate-offset basis curves
//      (dark colours keep their spectral shape instead of collapsing to zero)
//   3. Two parallel mixes in reflectance space:
//        K/S (Kubelka-Munk) — physically subtractive
//        Linear             — additive reference
//   4. DELTA = K/S − Linear  isolates the pure subtractive hue shift;
//      round-trip errors cancel exactly in the subtraction
//   5. Delta is tapered for thin glazing (small t) via a bell curve, then
//      added to a mathematically exact linear-sRGB blend
//
// Guarantees:
//   pigmentMix(a, b, 0) === a     (exact, delta=0)
//   pigmentMix(a, b, 1) === b     (exact, delta=0)
//   blue + yellow → green         (K/S subtractive hue shift)
//   dark colours stay accurate    (substrate prevents K/S blowup)

const N = 38; // 380–750 nm, 10 nm steps

// ─── sRGB ↔ linear ─────────────────────────────────────────────────────────
const S2L = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  S2L[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function l2s(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 255;
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return (s * 255 + 0.5) | 0;
}

// ─── CIE 1931 2° CMFs, 380–750 nm @ 10 nm ──────────────────────────────────
const CX = new Float64Array([0.0014,0.0042,0.0143,0.0435,0.1344,0.2839,0.3483,0.3362,0.2908,0.1954,0.0956,0.032,0.0049,0.0093,0.0633,0.1655,0.2904,0.4334,0.5945,0.7621,0.9163,1.0263,1.0622,1.0026,0.8544,0.6424,0.4479,0.2835,0.1649,0.0874,0.0468,0.0227,0.0114,0.0058,0.0029,0.0014,0.0007,0.0003]);
const CY = new Float64Array([0.0000,0.0001,0.0004,0.0012,0.004,0.0116,0.023,0.038,0.06,0.091,0.139,0.208,0.323,0.503,0.71,0.862,0.954,0.995,0.995,0.952,0.87,0.757,0.631,0.503,0.381,0.265,0.175,0.107,0.061,0.032,0.017,0.0082,0.0041,0.0021,0.001,0.0005,0.0003,0.0001]);
const CZ = new Float64Array([0.0065,0.0201,0.0679,0.2074,0.6456,1.3856,1.7471,1.7721,1.6692,1.2876,0.813,0.4652,0.272,0.1582,0.0782,0.0422,0.0203,0.0087,0.0039,0.0021,0.0017,0.0011,0.0008,0.0003,0.0002,0,0,0,0,0,0,0,0,0,0,0,0,0]);
let YN = 0; for (let i = 0; i < N; i++) YN += CY[i];

// ─── XYZ → linear sRGB (D65) ───────────────────────────────────────────────
const MR = [ 3.2404542, -1.5371385, -0.4985314];
const MG = [-0.9692660,  1.8760108,  0.0415560];
const MB = [ 0.0556434, -0.2040259,  1.0572252];

// ─── Neutral substrate reflectance ──────────────────────────────────────────
// When pigment weights sum to less than 1 (dark colours), the "missing" weight
// is filled by a neutral substrate at R_SUB.  This prevents reflectance from
// collapsing near zero and causing K/S singularity blowup.
//
// Effect:  R(λ) = R_SUB + Σ w[j] · (SPD[j](λ) − R_SUB)
//        = R_SUB · (1 − Σw) + Σ w[j] · SPD[j](λ)
//
// At full weight (Σw = 1):  R = SPD  (substrate cancels, no change)
// At zero weight (black):   R = R_SUB everywhere (neutral gray, K/S ≈ 2.4)
const R_SUB = 0.15;

// ─── 7-primary spectral reflectance curves ──────────────────────────────────
// Gentle sigmoid slopes give realistic pigment-like spectra.  Critical tuning:
//   • Blue steepness 0.04 (wide) → R(530nm) ≈ 0.20, so green survives in
//     blue+yellow K/S mix.  Real ultramarine has a gradual rolloff.
//   • Red/Cyan steepness 0.06 (moderate) → orange-yellow transition is smooth.
//   • Yellow steepness 0.08 → crisp absorption edge in blue region.
//   • Green/Magenta as Gaussians (σ ≈ 55-60 nm) → natural peaked shapes.
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const SPD = new Float64Array(7 * N); // 0=R 1=Y 2=G 3=C 4=B 5=M 6=W
for (let i = 0; i < N; i++) {
  const lam = 380 + 10 * i;
  SPD[0*N+i] = 0.05 + 0.92 * sig(0.06 * (lam - 590));                  // Red
  SPD[1*N+i] = 0.05 + 0.92 * sig(0.08 * (lam - 490));                  // Yellow
  SPD[2*N+i] = 0.05 + 0.92 * Math.exp(-((lam - 540) ** 2) / 7200);     // Green
  SPD[3*N+i] = 0.05 + 0.92 * sig(-0.06 * (lam - 590));                 // Cyan
  SPD[4*N+i] = 0.05 + 0.92 * sig(-0.04 * (lam - 490));                 // Blue
  SPD[5*N+i] = 0.97 - 0.92 * Math.exp(-((lam - 540) ** 2) / 6000);     // Magenta
  SPD[6*N+i] = 0.97;                                                     // White
}

// Precompute substrate-offset basis:  DSPD[j*N+i] = SPD[j](λ_i) − R_SUB
// toRefl becomes:  R(λ) = R_SUB + Σ w[j] · DSPD[j*N+i]
const DSPD = new Float64Array(7 * N);
for (let j = 0; j < 7; j++)
  for (let i = 0; i < N; i++)
    DSPD[j * N + i] = SPD[j * N + i] - R_SUB;

// ─── Decompose linear RGB → 7 primary weights ──────────────────────────────
// Any colour = white base + at most 2 adjacent hue primaries on the
// R-Y-G-C-B-M hexagon.  Weight sum = max(r,g,b).
function decompose(r: number, g: number, b: number, w: Float64Array) {
  w[0]=w[1]=w[2]=w[3]=w[4]=w[5]=0;
  const wh = Math.min(r, g, b);
  w[6] = wh;
  const cr = r - wh, cg = g - wh, cb = b - wh;
  if (cr < 1e-10 && cg < 1e-10 && cb < 1e-10) return;
  if (cb <= cr && cb <= cg) {
    if (cr >= cg) { w[0] = cr - cg; w[1] = cg; }
    else          { w[2] = cg - cr; w[1] = cr; }
  } else if (cr <= cg && cr <= cb) {
    if (cg >= cb) { w[2] = cg - cb; w[3] = cb; }
    else          { w[4] = cb - cg; w[3] = cg; }
  } else {
    if (cb >= cr) { w[4] = cb - cr; w[5] = cr; }
    else          { w[0] = cr - cb; w[5] = cb; }
  }
}

// ─── Weights → reflectance (substrate-offset) ──────────────────────────────
function toRefl(w: Float64Array, out: Float64Array) {
  for (let i = 0; i < N; i++) {
    let v = R_SUB
          + w[0]*DSPD[i] + w[1]*DSPD[N+i] + w[2]*DSPD[2*N+i]
          + w[3]*DSPD[3*N+i] + w[4]*DSPD[4*N+i] + w[5]*DSPD[5*N+i]
          + w[6]*DSPD[6*N+i];
    out[i] = v < 0.005 ? 0.005 : v > 0.995 ? 0.995 : v;
  }
}

// ─── Reflectance → linear RGB via CIE CMFs ─────────────────────────────────
function reflToLin(R: Float64Array): [number, number, number] {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < N; i++) {
    X += R[i] * CX[i];
    Y += R[i] * CY[i];
    Z += R[i] * CZ[i];
  }
  X /= YN; Y /= YN; Z /= YN;
  return [
    MR[0]*X + MR[1]*Y + MR[2]*Z,
    MG[0]*X + MG[1]*Y + MG[2]*Z,
    MB[0]*X + MB[1]*Y + MB[2]*Z,
  ];
}

// ─── K/S clamp ──────────────────────────────────────────────────────────────
const MAX_KS = 5.0;

// ─── Scratch arrays (reused per-pixel, no GC) ──────────────────────────────
const _w1 = new Float64Array(7);
const _w2 = new Float64Array(7);
const _Ra = new Float64Array(N);
const _Rb = new Float64Array(N);
const _Rks = new Float64Array(N);
const _Rln = new Float64Array(N);

/**
 * Subtractive (pigment) colour mix.
 *
 * @param a  Background pixel [R,G,B] 0-255
 * @param b  Foreground colour [R,G,B] 0-255
 * @param t  Mix ratio 0-1  (0 = all a, 1 = all b)
 * @returns  Mixed [R,G,B] 0-255
 */
export function pigmentMix(a: number[], b: number[], t: number): number[] {
  if (t <= 0) return a;
  if (t >= 1) return b;

  // sRGB → linear
  const ar = S2L[a[0]|0], ag = S2L[a[1]|0], ab = S2L[a[2]|0];
  const br = S2L[b[0]|0], bg = S2L[b[1]|0], bb = S2L[b[2]|0];

  // Decompose & build substrate-offset reflectance
  decompose(ar, ag, ab, _w1);
  decompose(br, bg, bb, _w2);
  toRefl(_w1, _Ra);
  toRefl(_w2, _Rb);

  // K/S subtractive mix + linear reference, both in reflectance space
  const t1 = 1 - t;
  for (let i = 0; i < N; i++) {
    const ra = _Ra[i], rb = _Rb[i];
    // Kubelka-Munk K/S
    let ks1 = (1 - ra) * (1 - ra) / (2 * ra);
    let ks2 = (1 - rb) * (1 - rb) / (2 * rb);
    if (ks1 > MAX_KS) ks1 = MAX_KS;
    if (ks2 > MAX_KS) ks2 = MAX_KS;
    const ks = t1 * ks1 + t * ks2;
    _Rks[i] = 1 + ks - Math.sqrt(ks * ks + 2 * ks);
    // Linear (additive reference)
    _Rln[i] = t1 * ra + t * rb;
  }

  // Convert both to linear RGB
  const [kr, kg, kb] = reflToLin(_Rks);
  const [lr, lg, lb] = reflToLin(_Rln);

  // Raw delta = pure subtractive effect (round-trip errors cancel)
  const dr = kr - lr;
  const dg = kg - lg;
  const db = kb - lb;

  // Strength tapering for thin glazes.
  // At t=0.5 (equal mix): full subtractive effect → correct hue shifts.
  // At small t (thin strokes): reduced effect → natural colour buildup.
  // Bell = 4·t·(1−t) ∈ [0,1], raised to 0.6 for gentle tapering.
  const bell = 4 * t * t1;
  const strength = Math.pow(bell, 0.6);

  // Final = correct linear-sRGB blend + subtractive delta × strength
  return [
    l2s(t1 * ar + t * br + dr * strength),
    l2s(t1 * ag + t * bg + dg * strength),
    l2s(t1 * ab + t * bb + db * strength),
  ];
}

/**
 * Smudge / push-blend in linear-light space.
 * No subtractive chemistry — just gamma-correct averaging.
 */
export function smudgeMix(a: number[], b: number[], t: number): number[] {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const t1 = 1 - t;
  return [
    l2s(t1 * S2L[a[0]|0] + t * S2L[b[0]|0]),
    l2s(t1 * S2L[a[1]|0] + t * S2L[b[1]|0]),
    l2s(t1 * S2L[a[2]|0] + t * S2L[b[2]|0]),
  ];
}
