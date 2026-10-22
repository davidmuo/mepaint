import { useEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import { MUTED, BORDER, LIME, MONO, ACCENT, ACCENT_INK } from './tokens';
import { GAMUTS, gamutPolygon, inPolygon, clampToPolygon, loadGamut, saveGamut, type GamutId } from '../engine/gamut';
import { Row, microLabel } from './controls';

type RGB = [number, number, number];

function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (mx === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, mx ? d / mx : 0, mx];
}
function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
export const toHex = (c: RGB) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
function parseHex(s: string): RGB | null {
  let h = s.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Hue/saturation wheel (0° = top, clockwise) with an optional gamut mask. */
function ColorWheel({ hsv, onPick, gamut, onGamut }: {
  hsv: [number, number, number];
  onPick: (h: number, s: number, commit: boolean) => void;
  gamut: { id: GamutId; rot: number }; onGamut: (g: { id: GamutId; rot: number }) => void;
}) {
  const D = 196, cref = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null);
  const [h, s, v] = hsv;
  const poly = gamut.id === 'none' ? [] : gamutPolygon(gamut.id, gamut.rot);

  // Paint the disc for the current brightness; outside-mask colours are greyed out
  useEffect(() => {
    const c = cref.current; if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), N = Math.round(D * dpr);
    c.width = N; c.height = N;
    const img = new ImageData(N, N), d = img.data, R = N / 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ux = (x + .5 - R) / R, uy = (y + .5 - R) / R, r = Math.hypot(ux, uy);
      if (r > 1 + 1 / R) continue;
      const hue = (Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360;
      let [cr, cg, cb] = hsvToRgb(hue, Math.min(1, r), v);
      let a = Math.max(0, Math.min(1, (1 - r) * R + .5));
      if (poly.length && !inPolygon(poly, ux, uy)) {
        const g = cr * .3 + cg * .59 + cb * .11;
        cr = g + (cr - g) * .25; cg = g + (cg - g) * .25; cb = g + (cb - g) * .25; a *= .38;
      }
      const i = (y * N + x) * 4; d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = a * 255;
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [v, gamut.id, gamut.rot]);

  const pick = (e: { clientX: number; clientY: number }, commit = false) => {
    const r = wrap.current!.getBoundingClientRect();
    let ux = (e.clientX - r.left - r.width / 2) / (r.width / 2), uy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const len = Math.hypot(ux, uy); if (len > 1) { ux /= len; uy /= len; }
    if (poly.length) [ux, uy] = clampToPolygon(poly, ux, uy);
    onPick((Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360, Math.min(1, Math.hypot(ux, uy)), commit);
  };
  const mx = Math.sin(h * Math.PI / 180) * s, my = -Math.cos(h * Math.PI / 180) * s;
  const pts = poly.map(([x, y]) => `${(x + 1) * D / 2},${(y + 1) * D / 2}`).join(' ');
  return (
    <div>
      <div ref={wrap} style={{ position: 'relative', width: D, height: D, margin: '0 auto', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e); }}
        onPointerUp={e => pick(e, true)}>
        <canvas ref={cref} style={{ width: D, height: D, display: 'block', borderRadius: '50%', boxShadow: '0 0 0 1px var(--mp-line-strong)' }}/>
        {poly.length > 0 && (
          <svg width={D} height={D} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
            <polygon points={pts} fill="none" stroke="#fff" strokeWidth={3} strokeLinejoin="round" opacity={.9}/>
            <polygon points={pts} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeLinejoin="round"/>
          </svg>
        )}
        <div style={{ position: 'absolute', left: (mx + 1) * D / 2, top: (my + 1) * D / 2, width: 16, height: 16, borderRadius: '50%', transform: 'translate(-50%,-50%)', border: '2.5px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.25), 0 2px 6px rgba(0,0,0,.35)', background: `rgb(${hsvToRgb(h, s, v).join(',')})`, pointerEvents: 'none' }}/>
      </div>
      <span style={{ ...microLabel, display: 'block', margin: '12px 0 6px' }}>GAMUT MASK</span>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: gamut.id === 'none' ? 4 : 10 }}>
        {GAMUTS.map(g => (
          <button key={g.id} onClick={() => onGamut({ ...gamut, id: g.id })}
            style={{ height: 24, padding: '0 8px', borderRadius: 7, border: gamut.id === g.id ? `1px solid ${ACCENT}` : BORDER, background: gamut.id === g.id ? LIME : 'transparent', color: gamut.id === g.id ? ACCENT_INK : 'var(--mp-ink)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            {g.label}
          </button>
        ))}
      </div>
      {gamut.id !== 'none' && <Row name="Mask rotation" value={gamut.rot} min={0} max={359} onChange={rot => onGamut({ ...gamut, rot })} format={x => `${x}°`}/>}
    </div>
  );
}

/**
 * Colour picker: saturation/value square or hue wheel (with gamut masking), plus editable hex.
 * `onChange` fires continuously while dragging; `onCommit` once on release
 * (used to push into the recent-colours row without flooding it).
 */
export function ColorPicker({ rgb, onChange, onCommit, onEyedropper }: {
  rgb: RGB; onChange: (c: RGB) => void; onCommit?: (c: RGB) => void; onEyedropper?: () => void;
}) {
  const [hsv, setHsv] = useState(() => rgbToHsv(rgb));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [mode, setModeState] = useState<'square' | 'wheel'>(() => { try { return localStorage.getItem('mepaint-picker-mode') === 'wheel' ? 'wheel' : 'square'; } catch { return 'square'; } });
  const setMode = (m: 'square' | 'wheel') => { setModeState(m); try { localStorage.setItem('mepaint-picker-mode', m); } catch { /* storage unavailable */ } };
  const [gamut, setGamutState] = useState(loadGamut);
  const setGamut = (g: { id: GamutId; rot: number }) => { setGamutState(g); saveGamut(g); };
  const svRef = useRef<HTMLDivElement>(null);
  const lastOut = useRef(toHex(rgb));

  // Sync from outside (pigment click, eyedropper) without losing hue on greys
  useEffect(() => {
    const hx = toHex(rgb);
    if (hx === lastOut.current) return;
    lastOut.current = hx;
    const [h, s, v] = rgbToHsv(rgb);
    setHsv(p => [s === 0 || v === 0 ? p[0] : h, s, v]);
  }, [rgb]);

  const emit = (h: number, s: number, v: number, commit = false) => {
    setHsv([h, s, v]);
    const out = hsvToRgb(h, s, v);
    lastOut.current = toHex(out);
    onChange(out);
    if (commit) onCommit?.(out);
  };

  const pickSV = (e: { clientX: number; clientY: number }, commit = false) => {
    const r = svRef.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    emit(hsv[0], s, v, commit);
  };

  const [h, s, v] = hsv;
  const cur = hsvToRgb(h, s, v);
  const full = hsvToRgb(h, s, 1);
  return (
    <div>
      <div className="seg" style={{ marginBottom: 12 }}>
        {(['square', 'wheel'] as const).map(m => (
          <button key={m} className={`ws-tab${mode === m ? ' on' : ''}`} onClick={() => setMode(m)} style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }}>{m}</button>
        ))}
      </div>
      {mode === 'square' ? <>
        <div ref={svRef}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pickSV(e); }}
          onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pickSV(e); }}
          onPointerUp={e => pickSV(e, true)}
          style={{
            position: 'relative', height: 148, borderRadius: 12, border: BORDER, cursor: 'crosshair', touchAction: 'none',
            background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${h},100%,50%))`,
          }}>
          <div style={{
            position: 'absolute', left: `${s * 100}%`, top: `${(1 - v) * 100}%`, width: 16, height: 16, borderRadius: '50%',
            transform: 'translate(-50%,-50%)', border: '2.5px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.25), 0 2px 6px rgba(0,0,0,.35)',
            background: `rgb(${cur.join(',')})`, pointerEvents: 'none',
          }}/>
        </div>
        <input type="range" className="hue-rail" min={0} max={360} value={Math.round(h)}
          onChange={e => emit(+e.target.value, s, v)}
          onPointerUp={() => onCommit?.(hsvToRgb(h, s, v))}
          aria-label="Hue" style={{ width: '100%', margin: '12px 0 10px' }}/>
      </> : <>
        <ColorWheel hsv={hsv} gamut={gamut} onGamut={setGamut} onPick={(nh, ns, commit) => emit(nh, ns, v, commit)}/>
        <input type="range" className="hue-rail" min={0} max={100} value={Math.round(v * 100)}
          onChange={e => emit(h, s, +e.target.value / 100)}
          onPointerUp={() => onCommit?.(hsvToRgb(h, s, v))}
          aria-label="Brightness" style={{ width: '100%', margin: '4px 0 10px', background: `linear-gradient(to right,#000,rgb(${full.join(',')}))` }}/>
      </>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: MONO, fontSize: 9.5, fontWeight: 500, color: MUTED, letterSpacing: .4 }}>HEX</span>
          <input className="inp" value={hexDraft ?? toHex(rgb)} spellCheck={false}
            onChange={e => setHexDraft(e.target.value)}
            onBlur={() => { const p = hexDraft && parseHex(hexDraft); if (p) { const [nh, ns, nv] = rgbToHsv(p); emit(ns ? nh : h, ns, nv, true); } setHexDraft(null); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ paddingLeft: 42, fontFamily: MONO, fontWeight: 500, fontSize: 12.5, padding: '7px 10px 7px 42px' }}/>
        </div>
        {onEyedropper && (
          <button onClick={onEyedropper} title="Pick from canvas [Alt+E]"
            style={{ width: 36, height: 36, border: 'none', borderRadius: 10, background: LIME, color: ACCENT_INK, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Pipette size={13} strokeWidth={2}/>
          </button>
        )}
      </div>
    </div>
  );
}
