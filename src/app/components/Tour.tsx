import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { DARK, LIME, WHITE, MUTED, SAND, BORDER, SHADOW, SANS, MONO } from './tokens';

export interface TourStep {
  /** `data-tour` id(s) to spotlight — every visible match is unioned; omit for a centred card */
  target?: string | string[];
  chip?: string;
  title: string;
  body: ReactNode;
  /** keycaps shown under the body, e.g. ['[', ']'] */
  keys?: string[];
  /** custom hero shown above the title on centred cards */
  hero?: ReactNode;
  placement?: 'right' | 'left' | 'top' | 'bottom';
  pad?: number;
}

type Rect = { x: number; y: number; w: number; h: number };
const GAP = 14, MARGIN = 12;

function findTarget(target: string | string[]): DOMRect | null {
  // Union every visible match, so a step can frame a run of controls (first…last)
  // and hidden desktop/mobile twins are ignored
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const id of ([] as string[]).concat(target)) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      x1 = Math.min(x1, r.left); y1 = Math.min(y1, r.top); x2 = Math.max(x2, r.right); y2 = Math.max(y2, r.bottom);
    }
  }
  if (x1 === Infinity) return null;
  // Clip to the viewport so oversized targets (the canvas) still leave room for the card
  x1 = Math.max(x1, 4); y1 = Math.max(y1, 4); x2 = Math.min(x2, window.innerWidth - 4); y2 = Math.min(y2, window.innerHeight - 4);
  return new DOMRect(x1, y1, x2 - x1, y2 - y1);
}

/**
 * Guided first-run tour: a dimmed backdrop with a spotlight that glides between
 * targets, and a tip card that docks beside whatever is highlighted.
 */
export function Tour({ steps, open, onClose, labels }: {
  steps: TourStep[]; open: boolean; onClose: (completed: boolean) => void;
  labels?: { start?: string; skip?: string; finish?: string };
}) {
  const [idx, setIdx] = useState(0);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [card, setCard] = useState<{ x: number; y: number; arrow?: { side: string; at: number } } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[idx];
  const isFirst = idx === 0, isLast = idx === steps.length - 1;
  const centred = !step?.target || !spot;

  useEffect(() => { if (open) setIdx(0); }, [open]);

  const measure = useCallback(() => {
    if (!step) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = step.target ? findTarget(step.target) : null;
    const cw = cardRef.current?.offsetWidth ?? 320, ch = cardRef.current?.offsetHeight ?? 200;
    if (!r) {
      setSpot(null);
      setCard({ x: (vw - cw) / 2, y: Math.max(MARGIN, (vh - ch) / 2) });
      return;
    }
    const pad = step.pad ?? 6;
    const s = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
    setSpot(s);
    const room = { right: vw - (s.x + s.w), left: s.x, bottom: vh - (s.y + s.h), top: s.y };
    let side: string = step.placement ?? Object.entries(room).sort((a, b) => b[1] - a[1])[0][0];
    // Fall back to any side that fits; a target filling the screen gets the card docked inside it
    const fits = (sd: string) => sd === 'right' || sd === 'left' ? room[sd as 'left'] >= cw + GAP + MARGIN : room[sd as 'top'] >= ch + GAP + MARGIN;
    if (!fits(side)) side = ['right', 'left', 'bottom', 'top'].find(fits) ?? 'inside';
    if (side === 'inside') {
      setCard({ x: Math.max(MARGIN, s.x + s.w - cw - 20), y: Math.max(MARGIN, s.y + s.h - ch - 20) });
      return;
    }
    let x = 0, y = 0;
    if (side === 'right') { x = s.x + s.w + GAP; y = s.y + s.h / 2 - ch / 2; }
    if (side === 'left') { x = s.x - GAP - cw; y = s.y + s.h / 2 - ch / 2; }
    if (side === 'bottom') { x = s.x + s.w / 2 - cw / 2; y = s.y + s.h + GAP; }
    if (side === 'top') { x = s.x + s.w / 2 - cw / 2; y = s.y - GAP - ch; }
    x = Math.max(MARGIN, Math.min(vw - cw - MARGIN, x));
    y = Math.max(MARGIN, Math.min(vh - ch - MARGIN, y));
    const horiz = side === 'left' || side === 'right';
    const at = horiz ? Math.max(18, Math.min(ch - 18, s.y + s.h / 2 - y)) : Math.max(18, Math.min(cw - 18, s.x + s.w / 2 - x));
    setCard({ x, y, arrow: { side, at } });
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // Re-measure once layout settles (fonts, panels animating in)
    const t1 = setTimeout(measure, 60), t2 = setTimeout(measure, 280);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', measure); };
  }, [open, idx, measure]);

  const next = useCallback(() => { if (isLast) onClose(true); else setIdx(i => i + 1); }, [isLast, onClose]);
  const back = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);

  // Capture-phase keys so painting shortcuts don't fire underneath the tour
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, next, back, onClose]);

  if (!open || !step) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const sp = spot ?? { x: vw / 2, y: vh / 2, w: 0, h: 0 };
  const tipSteps = steps.filter(s => s.target).length;
  const tipNo = steps.slice(0, idx + 1).filter(s => s.target).length;
  const ease = 'cubic-bezier(.22,1,.36,1)';
  const arrow = card?.arrow && !centred ? card.arrow : null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9500 }} role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Click shield — the tour is a guided moment, not a modal you click past */}
      <div style={{ position: 'absolute', inset: 0 }}/>
      {/* Spotlight: the giant spread shadow dims everything except the cut-out */}
      <div style={{
        position: 'absolute', left: sp.x, top: sp.y, width: sp.w, height: sp.h, borderRadius: centred ? 0 : 12,
        boxShadow: `0 0 0 9999px rgba(13,11,7,${centred ? .62 : .55})`,
        outline: centred ? 'none' : `2.5px solid ${LIME}`, outlineOffset: 0,
        transition: `all 380ms ${ease}`, pointerEvents: 'none',
      }}>
        {!centred && <div className="tour-pulse" style={{ position: 'absolute', inset: -2, borderRadius: 12, border: `2px solid ${LIME}` }}/>}
      </div>

      <div ref={cardRef} key={idx} style={{
        position: 'absolute', left: card?.x ?? -9999, top: card?.y ?? -9999,
        width: centred ? Math.min(400, vw - 24) : Math.min(312, vw - 24),
        background: WHITE, border: BORDER, borderRadius: 16, boxShadow: SHADOW, fontFamily: SANS, color: DARK,
        transition: `left 380ms ${ease}, top 380ms ${ease}`, animation: 'tourIn 260ms cubic-bezier(.34,1.56,.64,1)',
      }}>
        {arrow && (
          <div style={{
            position: 'absolute', width: 12, height: 12, background: WHITE, transform: 'rotate(45deg)',
            ...(arrow.side === 'right' && { left: -8, top: arrow.at - 6, borderLeft: BORDER, borderBottom: BORDER }),
            ...(arrow.side === 'left' && { right: -8, top: arrow.at - 6, borderTop: BORDER, borderRight: BORDER }),
            ...(arrow.side === 'bottom' && { top: -8, left: arrow.at - 6, borderTop: BORDER, borderLeft: BORDER }),
            ...(arrow.side === 'top' && { bottom: -8, left: arrow.at - 6, borderBottom: BORDER, borderRight: BORDER }),
          }}/>
        )}

        {step.hero && <div style={{ background: DARK, borderRadius: '13px 13px 0 0', padding: '22px 20px 16px', display: 'flex', justifyContent: 'center', borderBottom: BORDER }}>{step.hero}</div>}

        <div style={{ padding: centred ? '20px 22px 18px' : '16px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: 1, background: LIME, border: BORDER, borderRadius: 100, padding: '2px 9px' }}>
              {step.chip ?? (step.target ? `TIP ${tipNo}/${tipSteps}` : 'MEPAINT')}
            </span>
            <div style={{ flex: 1 }}/>
            {!isLast && (
              <button onClick={() => onClose(false)} aria-label="Skip tour" title="Skip tour [Esc]"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex', padding: 2, borderRadius: 6 }}>
                <X size={14} strokeWidth={2.2}/>
              </button>
            )}
          </div>
          <h3 style={{ fontSize: centred ? 22 : 16, fontWeight: 800, letterSpacing: centred ? -.6 : -.3, lineHeight: 1.2, marginBottom: 6 }}>{step.title}</h3>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: '#4A453B', fontWeight: 500 }}>{step.body}</div>
          {step.keys && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 10 }}>
              {step.keys.map(k => <kbd key={k} style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, background: SAND, border: `1.5px solid ${DARK}`, borderBottomWidth: 3, borderRadius: 6, padding: '2px 7px' }}>{k}</kbd>)}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
            {step.target ? (
              <div style={{ display: 'flex', gap: 3, flex: 1 }} aria-hidden>
                {steps.filter(s => s.target).map((_, i) => (
                  <span key={i} style={{ height: 5, width: i === tipNo - 1 ? 16 : 5, borderRadius: 5, background: i < tipNo ? DARK : 'rgba(13,11,7,.15)', transition: `all 300ms ${ease}` }}/>
                ))}
              </div>
            ) : isFirst ? (
              <button onClick={() => onClose(false)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', color: MUTED, fontFamily: SANS, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                {labels?.skip ?? "I'll explore on my own"}
              </button>
            ) : <div style={{ flex: 1 }}/>}

            {!isFirst && !isLast && (
              <button onClick={back} aria-label="Back" style={{ width: 34, height: 34, border: BORDER, borderRadius: 9, background: WHITE, color: DARK, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowLeft size={14} strokeWidth={2.2}/>
              </button>
            )}
            <button onClick={next} autoFocus
              style={{ height: 34, padding: '0 14px', border: BORDER, borderRadius: 9, background: isFirst || isLast ? LIME : DARK, color: isFirst || isLast ? DARK : WHITE, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: SANS, fontSize: 12, fontWeight: 700, boxShadow: isFirst || isLast ? `2px 2px 0 ${DARK}` : 'none' }}>
              {isFirst ? (labels?.start ?? 'Show me around') : isLast ? (labels?.finish ?? 'Start painting') : 'Next'}
              <ArrowRight size={13} strokeWidth={2.4}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
