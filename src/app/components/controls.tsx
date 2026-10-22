import { DARK, ACCENT, ACCENT_INK, MUTED, SANS, MONO } from './tokens';

export const microLabel = { fontFamily: MONO, fontSize: 9.5, fontWeight: 500, color: MUTED, letterSpacing: .4 } as const;

/** Labelled slider with an accent fill; shows "Off" at 0 for unitless 0-based ranges. */
export function Row({ name, value, min, max, step = 1, unit = '', onChange, hint, format }: {
  name: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void; hint?: string; format?: (v: number) => string;
}) {
  const pct = (value - min) / (max - min) * 100;
  const shown = format ? format(value) : value === 0 && unit === '' && min === 0 ? 'Off' : `${value}${unit}`;
  return (
    <div style={{ marginBottom: 11 }} title={hint}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{name}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: ACCENT_INK, fontWeight: 500 }}>{shown}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={name}
        onChange={e => onChange(+e.target.value)}
        style={{ width: '100%', background: `linear-gradient(to right,${ACCENT} ${pct}%,var(--mp-track) 0%)` }}/>
    </div>
  );
}

/** iOS-style switch row. */
export function Toggle({ name, on, onChange, hint, kbd }: { name: string; on: boolean; onChange: (v: boolean) => void; hint?: string; kbd?: string }) {
  return (
    <button onClick={() => onChange(!on)} title={hint} role="switch" aria-checked={on}
      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none', padding: '5px 0', cursor: 'pointer', color: DARK, fontFamily: SANS, fontSize: 12.5, fontWeight: 500, textAlign: 'left' }}>
      <span style={{ flex: 1 }}>{name}</span>
      {kbd && <kbd style={{ ...microLabel, border: '1px solid var(--mp-line-strong)', borderRadius: 5, padding: '0 5px' }}>{kbd}</kbd>}
      <span style={{ width: 30, height: 18, borderRadius: 10, background: on ? ACCENT : 'var(--mp-track)', position: 'relative', transition: 'background 160ms ease', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)', transition: 'left 160ms cubic-bezier(.22,1,.36,1)' }}/>
      </span>
    </button>
  );
}
