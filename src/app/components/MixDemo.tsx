import { pigmentMix } from './pigment-mix';
import { DARK } from './tokens';

// Two overlapping paint dabs whose overlap is computed with the same
// Kubelka-Munk mixer the brushes use — blue + yellow really does make green.
const BLUE: [number,number,number]   = [30,100,220];
const YELLOW: [number,number,number] = [255,220,0];
const MIX = pigmentMix(BLUE, YELLOW, .5);
const rgb = (c: number[]) => `rgb(${c.join(',')})`;

export function MixDemo({ size = 120, stroke = DARK }: { size?: number; stroke?: string }) {
  const r = size * .3, cy = size * .38, ax = size * .36, bx = size * .64;
  return (
    <svg width={size} height={size * .76} viewBox={`0 0 ${size} ${size * .76}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <clipPath id="mix-a"><circle cx={ax} cy={cy} r={r}/></clipPath>
      </defs>
      <circle cx={ax} cy={cy} r={r} fill={rgb(BLUE)} stroke={stroke} strokeWidth={2}/>
      <circle cx={bx} cy={cy} r={r} fill={rgb(YELLOW)} stroke={stroke} strokeWidth={2}/>
      <circle cx={bx} cy={cy} r={r} fill={rgb(MIX)} clipPath="url(#mix-a)"/>
      <circle cx={ax} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={2}/>
      <circle cx={bx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={2}/>
    </svg>
  );
}

export const MIX_COLORS = { blue: rgb(BLUE), yellow: rgb(YELLOW), mix: rgb(MIX) };
