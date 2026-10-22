// ─── Impasto: paint thickness + raking light ─────────────────────────────────
// Layers that have received thick paint carry a height buffer (0–255 per pixel).
// At composite time the summed height field is turned into a surface normal and lit
// by a soft light from the top-left, so ridges, bristle grooves and knife marks
// catch highlights and cast shading, as in ArtRage/Rebelle or Krita's paint thickness.

const LX = -0.48, LY = -0.62, LZ = 0.62;          // light direction (normalised below)
const LN = Math.hypot(LX, LY, LZ);
const lx = LX / LN, ly = LY / LN, lz = LZ / LN;
// Blinn half-vector for a viewer straight above
const HN = Math.hypot(lx, ly, lz + 1);
const hx = lx / HN, hy = ly / HN, hz = (lz + 1) / HN;
const FLAT_SPEC = Math.pow(hz, 28);

/** How much height a dab deposits per unit of (mask × flow × thickness). */
export const DEPOSIT = 30;

/**
 * Light the composited rect in place.
 * @param comp  RGBA rect (rw×rh) at canvas offset (x1,y1)
 * @param hbufs height buffers of visible layers (full canvas size W×H)
 */
export function shadeImpasto(
  comp: Uint8ClampedArray, rw: number, rh: number, x1: number, y1: number,
  W: number, H: number, hbufs: Uint8ClampedArray[], ratio: number,
) {
  if (!hbufs.length) return;
  // Height is in "paint units"; slope taken over ±2px (smoother normals, less dab noise)
  // and scaled so ridge strength is DPI-independent
  const S = 0.0125 / Math.max(1, ratio);
  const one = hbufs.length === 1 ? hbufs[0] : null;
  const hAt = (x: number, y: number) => {
    x = x < 0 ? 0 : x >= W ? W - 1 : x; y = y < 0 ? 0 : y >= H ? H - 1 : y;
    const i = y * W + x;
    if (one) return one[i];
    let s = 0; for (let b = 0; b < hbufs.length; b++) s += hbufs[b][i];
    return s > 255 ? 255 : s;
  };
  for (let row = 0; row < rh; row++) {
    const Y = y1 + row;
    for (let col = 0; col < rw; col++) {
      const X = x1 + col;
      const gx = hAt(X + 2, Y) - hAt(X - 2, Y) + (hAt(X + 1, Y + 1) - hAt(X - 1, Y + 1) + hAt(X + 1, Y - 1) - hAt(X - 1, Y - 1)) * .5;
      const gy = hAt(X, Y + 2) - hAt(X, Y - 2) + (hAt(X + 1, Y + 1) - hAt(X + 1, Y - 1) + hAt(X - 1, Y + 1) - hAt(X - 1, Y - 1)) * .5;
      if (gx === 0 && gy === 0) continue;
      const nx = -gx * S, ny = -gy * S, inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const diff = (nx * lx + ny * ly + lz) * inv - lz;            // 0 on flat paper
      const nh = (nx * hx + ny * hy + hz) * inv;
      const spec = Math.max(0, Math.pow(Math.max(0, nh), 28) - FLAT_SPEC) * 70;
      const f = 1 + diff * 1.35;
      const di = (row * rw + col) * 4;
      comp[di]     = comp[di] * f + spec;
      comp[di + 1] = comp[di + 1] * f + spec;
      comp[di + 2] = comp[di + 2] * f + spec;
    }
  }
}
