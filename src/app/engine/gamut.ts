// ─── Gamut masking (James Gurney's technique) ────────────────────────────────
// A mask is a shape laid over the hue/saturation wheel; only colours inside it are
// allowed, which keeps a painting's palette harmonious. Shapes are polygons in
// unit-disc coordinates (x right, y down, 0° = top), rotated as a whole.

export type GamutId = 'none' | 'triad' | 'complementary' | 'analogous' | 'split';
export const GAMUTS: { id: GamutId; label: string }[] = [
  { id: 'none', label: 'Off' },
  { id: 'triad', label: 'Triad' },
  { id: 'complementary', label: 'Complement' },
  { id: 'analogous', label: 'Analogous' },
  { id: 'split', label: 'Split' },
];

type P = [number, number];
const polar = (deg: number, r: number): P => { const a = (deg - 90) * Math.PI / 180; return [Math.cos(a) * r, Math.sin(a) * r]; };

function baseShape(id: GamutId): P[] {
  switch (id) {
    case 'triad': return [polar(0, .94), polar(120, .94), polar(240, .94)];
    case 'complementary': {
      // Slim ellipse through the centre joining two opposite hues
      const pts: P[] = [];
      for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; pts.push([Math.sin(t) * .3, -Math.cos(t) * .95]); }
      return pts;
    }
    case 'analogous': {
      // A wedge: neighbouring hues, reaching a little past grey
      const pts: P[] = [polar(180, .16)];
      for (let d = -42; d <= 42; d += 6) pts.push(polar(d, .95));
      return pts;
    }
    case 'split': return [polar(0, .95), polar(148, .88), polar(212, .88)];
    default: return [];
  }
}

export function gamutPolygon(id: GamutId, rotDeg: number): P[] {
  const a = rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return baseShape(id).map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export function inPolygon(poly: P[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Nearest point on the polygon's boundary — used to clamp picks into the mask. */
export function clampToPolygon(poly: P[], x: number, y: number): P {
  if (!poly.length || inPolygon(poly, x, y)) return [x, y];
  let best: P = poly[0], bd = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const px = ax + dx * t, py = ay + dy * t, d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = [px, py]; }
  }
  return best;
}

export function loadGamut(): { id: GamutId; rot: number } {
  try { const g = JSON.parse(localStorage.getItem('mepaint-gamut') ?? 'null'); if (g?.id) return g; } catch { /* default */ }
  return { id: 'none', rot: 0 };
}
export function saveGamut(g: { id: GamutId; rot: number }) {
  try { localStorage.setItem('mepaint-gamut', JSON.stringify(g)); } catch { /* storage unavailable */ }
}
