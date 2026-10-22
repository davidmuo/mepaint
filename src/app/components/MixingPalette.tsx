import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Pipette, RotateCcw, X, GripVertical } from 'lucide-react';
import { pigmentMix } from './pigment-mix';
import { samplePatch, advancePatch, patchIndex, newSmudgeState, type SmudgeState } from '../engine/smudge';
import { DARK, WHITE, MUTED, BORDER, LIME, ACCENT, ACCENT_INK, SANS } from './tokens';
import { microLabel } from './controls';

type RGB = [number, number, number];
type Tool = 'paint' | 'knife' | 'pick';
const PW = 288, PH = 176, SLAB: RGB = [246, 244, 239];
const STORE = 'mepaint-mixing-palette-v1';
// Short carry + partial lay-down: each pass folds the paints together rather than painting over
const KNIFE = { mode: 'smear' as const, length: 70, colorRate: 0 };

/**
 * A wet palette: dab paint down, drag it together with the palette knife (pigment
 * mixing, so blue + yellow really makes green), then pick the mix as your colour.
 */
export function MixingPalette({ color, pigments, onPick, onClose, onDragStart }: {
  color: RGB; pigments: { name: string; rgb: RGB }[];
  onPick: (c: RGB) => void; onClose: () => void; onDragStart: (e: React.MouseEvent) => void;
}) {
  const cref = useRef<HTMLCanvasElement>(null);
  const buf = useRef<Uint8ClampedArray>(new Uint8ClampedArray(PW * PH * 4));
  const [tool, setTool] = useState<Tool>('paint');
  const [size, setSize] = useState(14);
  const [hover, setHover] = useState<RGB | null>(null);
  const drag = useRef<{ x: number; y: number; knife: SmudgeState } | null>(null);
  const raf = useRef<number | null>(null);
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draw = useCallback(() => {
    raf.current = null;
    cref.current?.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf.current), PW, PH), 0, 0);
  }, []);
  const redraw = useCallback(() => { if (raf.current === null) raf.current = requestAnimationFrame(draw); }, [draw]);
  const persist = useCallback(() => {
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(() => { try { localStorage.setItem(STORE, cref.current!.toDataURL('image/png')); } catch { /* quota */ } }, 400);
  }, []);
  const clear = useCallback(() => {
    const b = buf.current;
    for (let i = 0; i < PW * PH; i++) { const g = (Math.random() - .5) * 3; b[i * 4] = SLAB[0] + g; b[i * 4 + 1] = SLAB[1] + g; b[i * 4 + 2] = SLAB[2] + g; b[i * 4 + 3] = 255; }
    redraw(); persist();
  }, [redraw, persist]);

  // Restore yesterday's mixes
  useEffect(() => {
    clear();
    let saved: string | null = null; try { saved = localStorage.getItem(STORE); } catch { /* none */ }
    if (!saved) return;
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = PW; c.height = PH; const x = c.getContext('2d')!; x.drawImage(img, 0, 0); buf.current.set(x.getImageData(0, 0, PW, PH).data); redraw(); };
    img.src = saved;
  }, [clear, redraw]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = cref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * PW / r.width, y: (e.clientY - r.top) * PH / r.height };
  };
  const read = (x: number, y: number): RGB => {
    const i = (Math.max(0, Math.min(PH - 1, y | 0)) * PW + Math.max(0, Math.min(PW - 1, x | 0))) * 4, b = buf.current;
    return [b[i], b[i + 1], b[i + 2]];
  };

  /** Soft round dab of the brush colour, mixed in like pigment. */
  const dab = (cx: number, cy: number) => {
    const b = buf.current, r = size;
    for (let y = Math.max(0, cy - r | 0); y < Math.min(PH, cy + r + 1); y++) for (let x = Math.max(0, cx - r | 0); x < Math.min(PW, cx + r + 1); x++) {
      const d = Math.hypot(x - cx, y - cy) / r; if (d >= 1) continue;
      const a = (1 - d * d) * .55, i = (y * PW + x) * 4;
      const m = pigmentMix([b[i], b[i + 1], b[i + 2]], color, a);
      b[i] = m[0]; b[i + 1] = m[1]; b[i + 2] = m[2];
    }
  };
  /** Palette knife: drag carried paint along (same engine as the canvas smudge). */
  const knife = (cx: number, cy: number, st: SmudgeState) => {
    const b = buf.current, r = size, fresh = samplePatch(b, null, PW, PH, cx, cy, r, 'smear');
    if (!st.patch) advancePatch(st, fresh.slice(), KNIFE, color);
    const P = st.patch!;
    for (let y = Math.max(0, cy - r | 0); y < Math.min(PH, cy + r + 1); y++) for (let x = Math.max(0, cx - r | 0); x < Math.min(PW, cx + r + 1); x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) / r; if (d >= 1) continue;
      const a = Math.min(1, (1 - d) * 1.5) * .55, i = (y * PW + x) * 4, k = patchIndex(dx, dy, r);
      const cc = [b[i], b[i + 1], b[i + 2]], pc = [P[k], P[k + 1], P[k + 2]];
      const diff = Math.abs(cc[0] - pc[0]) + Math.abs(cc[1] - pc[1]) + Math.abs(cc[2] - pc[2]);
      const m = diff > 24 ? pigmentMix(cc, pc, a) : [cc[0] + (pc[0] - cc[0]) * a, cc[1] + (pc[1] - cc[1]) * a, cc[2] + (pc[2] - cc[2]) * a];
      b[i] = m[0]; b[i + 1] = m[1]; b[i + 2] = m[2];
    }
    advancePatch(st, fresh, KNIFE, color);
  };
  const strokeTo = (x: number, y: number) => {
    const d = drag.current!; const dist = Math.hypot(x - d.x, y - d.y), step = Math.max(1, size * .28), n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) { const px = d.x + (x - d.x) * i / n, py = d.y + (y - d.y) * i / n; if (tool === 'paint') dab(px, py); else knife(px, py, d.knife); }
    d.x = x; d.y = y; redraw();
  };

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    if (tool === 'pick' || e.altKey) { onPick(read(p.x, p.y)); return; }
    drag.current = { ...p, knife: newSmudgeState() };
    if (tool === 'paint') { dab(p.x, p.y); redraw(); }
  };
  const move = (e: React.PointerEvent) => {
    const p = at(e);
    if (tool === 'pick' || e.altKey) setHover(read(p.x, p.y));
    if (drag.current) strokeTo(p.x, p.y);
  };
  const up = () => { if (drag.current) { drag.current = null; persist(); } };

  const toolBtn = (t: Tool, icon: React.ReactNode, label: string) => (
    <button onClick={() => setTool(t)} title={label} aria-pressed={tool === t}
      style={{ flex: 1, height: 30, borderRadius: 9, border: tool === t ? `1px solid ${ACCENT}` : BORDER, background: tool === t ? LIME : WHITE, color: tool === t ? ACCENT_INK : DARK, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: SANS }}>
      {icon}{label}
    </button>
  );

  return (
    <div className="pop" style={{ overflow: 'hidden', fontFamily: SANS, color: DARK }}>
      <div onMouseDown={onDragStart} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 12px', borderBottom: BORDER, cursor: 'move', userSelect: 'none' }}>
        <GripVertical size={12} color="var(--mp-muted)"/>
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>Mixing palette</span>
        <button onClick={clear} title="Clean the palette" className="sbtn" style={{ border: 'none', borderRadius: 7, padding: 4, cursor: 'pointer', color: MUTED, display: 'flex' }}><RotateCcw size={13}/></button>
        <button onClick={onClose} aria-label="Close" className="sbtn" style={{ border: 'none', borderRadius: 7, padding: 4, cursor: 'pointer', color: MUTED, display: 'flex' }}><X size={13}/></button>
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ position: 'relative' }}>
          <canvas ref={cref} width={PW} height={PH} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}
            style={{ width: '100%', aspectRatio: `${PW}/${PH}`, display: 'block', borderRadius: 10, boxShadow: 'inset 0 0 0 1px var(--mp-line-strong)', touchAction: 'none', cursor: tool === 'pick' ? 'crosshair' : 'default' }}/>
          {hover && <div style={{ position: 'absolute', right: 8, top: 8, width: 26, height: 26, borderRadius: '50%', background: `rgb(${hover.join(',')})`, border: '2.5px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.35)', pointerEvents: 'none' }}/>}
        </div>
        <div style={{ display: 'flex', gap: 4, margin: '10px 0 8px' }}>
          {toolBtn('paint', <Brush size={12}/>, 'Paint')}
          {toolBtn('knife', <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><path d="M2 14l6-6"/><path d="M8 8l5-5c1 1 1 3 0 4l-3 3z" fill="currentColor" fillOpacity={.25}/></svg>, 'Knife')}
          {toolBtn('pick', <Pipette size={12}/>, 'Pick')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={microLabel}>SIZE</span>
          <input type="range" min={4} max={36} value={size} onChange={e => setSize(+e.target.value)} aria-label="Palette brush size"
            style={{ flex: 1, background: `linear-gradient(to right,${ACCENT} ${(size - 4) / 32 * 100}%,var(--mp-track) 0%)` }}/>
          <div title="Current colour" style={{ width: 22, height: 22, borderRadius: '50%', background: `rgb(${color.join(',')})`, boxShadow: '0 0 0 1px var(--mp-line-strong)' }}/>
        </div>
        <span style={{ ...microLabel, display: 'block', marginBottom: 6 }}>LOAD A PIGMENT</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4 }}>
          {pigments.map(p => (
            <button key={p.name} title={p.name} onClick={() => { onPick(p.rgb); setTool('paint'); }}
              style={{ aspectRatio: '1', borderRadius: '50%', border: 'none', background: `rgb(${p.rgb.join(',')})`, boxShadow: '0 0 0 1px var(--mp-line-strong)', cursor: 'pointer', padding: 0 }}/>
          ))}
        </div>
        <p style={{ fontSize: 11, color: MUTED, margin: '8px 0 0', lineHeight: 1.45 }}>Dab colours, drag them together with the knife, then pick your mix. Alt-click picks in any tool.</p>
      </div>
    </div>
  );
}
