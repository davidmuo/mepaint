import { useEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import { MUTED, BORDER, LIME, MONO, ACCENT_INK } from './tokens';

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

/**
 * Saturation/value square + hue rail + editable hex.
 * `onChange` fires continuously while dragging; `onCommit` once on release
 * (used to push into the recent-colours row without flooding it).
 */
export function ColorPicker({ rgb, onChange, onCommit, onEyedropper }: {
  rgb: RGB; onChange: (c: RGB) => void; onCommit?: (c: RGB) => void; onEyedropper?: () => void;
}) {
  const [hsv, setHsv] = useState(() => rgbToHsv(rgb));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
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
  return (
    <div>
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
