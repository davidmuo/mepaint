// ─── Bundled MyPaint brushes (CC0, github.com/mypaint/mypaint-brushes) ───────
// Brush files live in /public/brushes/mypaint and are fetched on demand, so the
// app bundle doesn't grow with the library.
import { MyPaintBrush, setBrushColor } from './brush';
import { LayerSurface } from './surface';

export interface MpEntry { id: string; name: string; category: string; author: string; source: string }

const BASE = '/brushes/mypaint/';
let indexP: Promise<MpEntry[]> | null = null;
const texts = new Map<string, Promise<string>>();

export function loadIndex(): Promise<MpEntry[]> {
  return indexP ??= fetch(BASE + 'index.json').then(r => r.json()).then(j => j.brushes as MpEntry[]).catch(e => { indexP = null; throw e; });
}
export function loadBrushText(id: string): Promise<string> {
  let p = texts.get(id);
  if (!p) { p = fetch(BASE + encodeURIComponent(id) + '.myb').then(r => { if (!r.ok) throw new Error(r.statusText); return r.text(); }); texts.set(id, p); p.catch(() => texts.delete(id)); }
  return p;
}
export async function loadBrush(id: string): Promise<MyPaintBrush> {
  const b = new MyPaintBrush();
  if (!b.fromJSON(await loadBrushText(id))) throw new Error(`Unsupported brush file: ${id}`);
  return b;
}

/** Paint a small S-stroke with the brush (radius capped to fit) and return it as a PNG data URL. */
export function renderPreview(brush: MyPaintBrush, ink: [number, number, number], W = 132, H = 44): string {
  const buf = new Uint8ClampedArray(W * H * 4);
  const surf = new LayerSurface({ buf, W, H });
  const r0 = brush.getBase('radius_logarithmic');
  brush.setBase('radius_logarithmic', Math.min(r0, Math.log(H * 0.16)));
  setBrushColor(brush, ink);
  brush.reset(); brush.newStroke();
  brush.strokeTo(surf, 10, H / 2, 0, 0, 0, 10, 1, 0);
  const N = 48;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    brush.strokeTo(surf, 10 + t * (W - 20), H / 2 + Math.sin(t * Math.PI * 2) * H * 0.2, Math.sin(t * Math.PI) * .85 + .15, 0, 0, 0.012, 1, 0);
  }
  brush.strokeTo(surf, W - 10, H / 2, 0, 0, 0, 0.012, 1, 0);
  brush.setBase('radius_logarithmic', r0);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d')!.putImageData(new ImageData(buf, W, H), 0, 0);
  return c.toDataURL('image/png');
}
