import type { MpEntry } from '../mypaint/library';
import { DARK, MUTED, BORDER, LIME, ACCENT, ACCENT_INK, SANS } from './tokens';
import { microLabel } from './controls';

/** Brush-library tab for the bundled MyPaint brushes: live-rendered previews, grouped by category. */
export function MyPaintLibrary({ entries, previews, activeId, onSelect, error }: {
  entries: MpEntry[] | null; previews: Record<string, string>; activeId: string | null;
  onSelect: (e: MpEntry) => void; error?: string | null;
}) {
  if (error) return <p style={{ fontSize: 12, color: MUTED, padding: 12 }}>Couldn't load the MyPaint brushes: {error}</p>;
  if (!entries) return <p style={{ fontSize: 12, color: MUTED, padding: 12 }}>Loading brushes…</p>;
  const cats = [...new Set(entries.map(e => e.category))];
  return (
    <div style={{ fontFamily: SANS }}>
      {cats.map(cat => (
        <div key={cat} style={{ marginBottom: 12 }}>
          <div style={{ ...microLabel, marginBottom: 6 }}>{cat.toUpperCase()}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(126px,1fr))', gap: 5 }}>
            {entries.filter(e => e.category === cat).map(e => {
              const on = e.id === activeId;
              return (
                <button key={e.id} onClick={() => onSelect(e)} title={`${e.name} — by ${e.author} (CC0)`}
                  style={{ border: on ? `1.5px solid ${ACCENT}` : BORDER, borderRadius: 10, background: on ? LIME : 'transparent', padding: 4, cursor: 'pointer', textAlign: 'left', color: on ? ACCENT_INK : DARK }}>
                  <div style={{ height: 40, borderRadius: 7, background: '#F7F4EE', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {previews[e.id]
                      ? <img src={previews[e.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}/>
                      : <div style={{ width: '60%', height: 2, borderRadius: 2, background: 'rgba(0,0,0,.08)' }}/>}
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 500, margin: '5px 3px 1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 10.5, color: MUTED, lineHeight: 1.5, margin: '4px 2px 2px' }}>
        Brushes from the MyPaint community (CC0). Engine ported from libmypaint (ISC licence).
      </p>
    </div>
  );
}
