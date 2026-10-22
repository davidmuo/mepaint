import { useRef, useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { DARK, WHITE, MUTED, SAND, BORDER, LIME, ACCENT, ACCENT_INK, LINE, LINE_STRONG, SANS } from './tokens';
import { CURVE_PRESETS, curvePath, type Dynamics, type PressureCurve } from '../engine/dynamics';
import type { SmudgeConfig } from '../engine/smudge';
import { Row, Toggle, microLabel } from './controls';

export interface AdvValues {
  sizeJitter: number; opacityJitter: number; spacingMult: number;
  thickness: number; grain: number; dualTip: string; dualScale: number; dualAmount: number;
}
type Tab = 'dynamics' | 'texture' | 'smudge';

const label = microLabel;

/** Draggable two-handle Bézier editor for pen pressure → output. */
function CurveEditor({ curve, onChange }: { curve: PressureCurve; onChange: (c: PressureCurve) => void }) {
  const S = 132, ref = useRef<SVGSVGElement>(null), drag = useRef<0 | 1 | 2>(0);
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    onChange(drag.current === 1 ? { ...curve, x1: x, y1: y } : { ...curve, x2: x, y2: y });
  };
  const handle = (i: 1 | 2, x: number, y: number) => (
    <circle cx={x * S} cy={(1 - y) * S} r={6.5} fill="#fff" stroke={ACCENT} strokeWidth={2} style={{ cursor: 'grab' }}
      onPointerDown={e => { drag.current = i; (e.target as Element).setPointerCapture(e.pointerId); }}/>
  );
  return (
    <svg ref={ref} width={S} height={S} viewBox={`-8 -8 ${S + 16} ${S + 16}`} onPointerMove={move} onPointerUp={() => { drag.current = 0; }}
      style={{ display: 'block', background: SAND, borderRadius: 10, border: BORDER, touchAction: 'none', overflow: 'visible', flexShrink: 0 }}>
      {[.25, .5, .75].map(g => <g key={g}><line x1={g * S} y1={0} x2={g * S} y2={S} stroke={LINE} /><line x1={0} y1={g * S} x2={S} y2={g * S} stroke={LINE}/></g>)}
      <line x1={0} y1={S} x2={S} y2={0} stroke={LINE_STRONG} strokeDasharray="3 3"/>
      <line x1={0} y1={S} x2={curve.x1 * S} y2={(1 - curve.y1) * S} stroke={ACCENT} strokeOpacity={.45}/>
      <line x1={S} y1={0} x2={curve.x2 * S} y2={(1 - curve.y2) * S} stroke={ACCENT} strokeOpacity={.45}/>
      <path d={curvePath(curve, S)} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round"/>
      {handle(1, curve.x1, curve.y1)}{handle(2, curve.x2, curve.y2)}
    </svg>
  );
}

export function BrushSettings({
  brushLabel, adv, onAdv, onResetAdv, dynamics, onDynamics, smudge, onSmudge, smudgeOn, onToggleSmudge,
  impastoLight, onImpastoLight, tipOptions,
}: {
  brushLabel: string;
  adv: AdvValues; onAdv: (patch: Partial<AdvValues>) => void; onResetAdv: () => void;
  dynamics: Dynamics; onDynamics: (patch: Partial<Dynamics>) => void;
  smudge: SmudgeConfig; onSmudge: (patch: Partial<SmudgeConfig>) => void; smudgeOn: boolean; onToggleSmudge: () => void;
  impastoLight: boolean; onImpastoLight: (v: boolean) => void;
  tipOptions: { id: string; label: string; icon: ReactNode }[];
}) {
  const [tab, setTab] = useState<Tab>(() => smudgeOn ? 'smudge' : 'dynamics');
  const activePreset = CURVE_PRESETS.find(p => JSON.stringify(p.curve) === JSON.stringify(dynamics.curve))?.id;
  return (
    <div style={{ padding: '14px 16px 6px', fontFamily: SANS, color: DARK }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Settings2 size={14} strokeWidth={2}/>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Brush settings</span>
          <span style={{ ...label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brushLabel}</span>
        </div>
        <button onClick={onResetAdv} className="sbtn" style={{ border: 'none', borderRadius: 7, padding: '3px 8px', cursor: 'pointer', ...label, color: MUTED }}>Reset</button>
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        {(['dynamics', 'texture', 'smudge'] as Tab[]).map(t => (
          <button key={t} className={`ws-tab${tab === t ? ' on' : ''}`} onClick={() => setTab(t)} style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'dynamics' && <>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <CurveEditor curve={dynamics.curve} onChange={curve => onDynamics({ curve })}/>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ ...label, marginBottom: 2 }}>PRESSURE CURVE</span>
            {CURVE_PRESETS.map(p => (
              <button key={p.id} onClick={() => onDynamics({ curve: p.curve })}
                style={{ height: 26, borderRadius: 8, border: activePreset === p.id ? `1px solid ${ACCENT}` : BORDER, background: activePreset === p.id ? LIME : WHITE, color: activePreset === p.id ? ACCENT_INK : DARK, fontFamily: SANS, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle name="Pressure → size" on={dynamics.pressureSize} onChange={v => onDynamics({ pressureSize: v })}/>
        <Toggle name="Pressure → flow" on={dynamics.pressureFlow} onChange={v => onDynamics({ pressureFlow: v })}/>
        <div style={{ height: 8 }}/>
        <Row name="Speed thinning" value={dynamics.speedThin} min={0} max={100} onChange={v => onDynamics({ speedThin: v })} hint="Fast strokes get thinner, like an ink nib"/>
        <Row name="Size jitter" value={adv.sizeJitter} min={0} max={100} unit="%" onChange={v => onAdv({ sizeJitter: v })}/>
        <Row name="Flow jitter" value={adv.opacityJitter} min={0} max={100} unit="%" onChange={v => onAdv({ opacityJitter: v })}/>
        <Row name="Spacing" value={Math.round(adv.spacingMult * 100)} min={10} max={300} unit="%" onChange={v => onAdv({ spacingMult: v / 100 })}/>
      </>}

      {tab === 'texture' && <>
        <Row name="Paint thickness" value={adv.thickness} min={0} max={100} onChange={v => onAdv({ thickness: v })} hint="Impasto: strokes build up a surface that catches the light"/>
        <Toggle name="Show impasto lighting" on={impastoLight} onChange={onImpastoLight}/>
        <div style={{ height: 8 }}/>
        <Row name="Paper grain" value={adv.grain} min={0} max={200} unit="%" onChange={v => onAdv({ grain: v })} hint="How strongly the paper's tooth breaks up this brush"/>
        <span style={{ ...label, display: 'block', margin: '4px 0 7px' }}>DUAL BRUSH</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4, marginBottom: 10 }}>
          {[{ id: 'none', label: 'None', icon: null }, ...tipOptions].map(t => {
            const on = adv.dualTip === t.id;
            return (
              <button key={t.id} onClick={() => onAdv({ dualTip: t.id, dualAmount: t.id === 'none' ? 0 : adv.dualAmount || 55 })} title={t.label}
                style={{ height: 44, borderRadius: 9, border: on ? `1px solid ${ACCENT}` : BORDER, background: on ? LIME : WHITE, color: on ? ACCENT_INK : DARK, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer', fontFamily: SANS, fontSize: 10, fontWeight: 500 }}>
                {t.icon}{t.label}
              </button>
            );
          })}
        </div>
        {adv.dualTip !== 'none' && <>
          <Row name="Dual amount" value={adv.dualAmount} min={0} max={100} unit="%" onChange={v => onAdv({ dualAmount: v })}/>
          <Row name="Dual scale" value={adv.dualScale} min={25} max={300} unit="%" onChange={v => onAdv({ dualScale: v })}/>
        </>}
      </>}

      {tab === 'smudge' && <>
        <Toggle name="Smudge mode" on={smudgeOn} onChange={onToggleSmudge} hint="Toggle with S"/>
        <div className="seg" style={{ margin: '8px 0 12px' }}>
          {(['smear', 'dull'] as const).map(m => (
            <button key={m} className={`ws-tab${smudge.mode === m ? ' on' : ''}`} onClick={() => onSmudge({ mode: m })} style={{ flex: 1, justifyContent: 'center', textTransform: 'capitalize' }}>{m}</button>
          ))}
        </div>
        <Row name="Smudge length" value={smudge.length} min={0} max={100} unit="%" onChange={v => onSmudge({ length: v })} hint="How far picked-up paint is dragged"/>
        <Row name="Colour rate" value={smudge.colorRate} min={0} max={100} unit="%" onChange={v => onSmudge({ colorRate: v })} hint="Load fresh brush colour into the smudge — a wet blending brush"/>
        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: MUTED, margin: '2px 0 10px' }}>
          <b style={{ color: DARK, fontWeight: 600 }}>Smear</b> drags paint along with its texture; <b style={{ color: DARK, fontWeight: 600 }}>dull</b> averages it. Raise colour rate to paint wet-into-wet: colours mix like real pigment as you push them.
        </p>
      </>}
    </div>
  );
}
