import { useEffect, useRef, useState, useCallback } from 'react';
import JSZip from 'jszip';
import { pigmentMix, smudgeMix } from './components/pigment-mix';
import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '/utils/supabase/info';
import {
  Music2, ImageIcon, HelpCircle, Undo2, Trash2, Download,
  Play, Pause, X, Upload, Blend,
  ChevronRight, Eye, EyeOff, ZoomIn, ZoomOut, Users,
  Pipette, Spline, Copy, Check, Link, Settings2, LayoutGrid,
  MessageSquare, Send, ChevronDown, Plus, Film,
  Paintbrush2, ChevronLeft,
  LogIn, LogOut, UserPlus, Mail, Lock, User, Expand,
  Video, FileImage, Maximize, Minus, SkipBack, GripVertical, RotateCcw,
  Layers, LockOpen, Move, Lasso, Eraser, Menu,
} from 'lucide-react';

// ─── Supabase singleton ───────────────────────────────────────────────────────
// Provide a no-op lock so gotrue-js never blocks on the Web Locks API.
// This prevents the "lock was not released within 5000ms" warning that occurs
// in React Strict Mode when a component unmounts before the lock is freed.
const noopLock = (_name: string, _timeout: number, fn: () => Promise<unknown>) => fn();

const SUPA_KEY = '__mepaint_supabase_client__';
if (!(window as any)[SUPA_KEY]) {
  (window as any)[SUPA_KEY] = createClient(`https://${projectId}.supabase.co`, publicAnonKey, {
    auth: { storageKey: 'mepaint-auth-v2', lock: noopLock as any },
  });
}
const supabase: ReturnType<typeof createClient> = (window as any)[SUPA_KEY];
const SERVER = `https://${projectId}.supabase.co/functions/v1/make-server-8a330b06`;
const AUTH_H = { 'Authorization': `Bearer ${publicAnonKey}`, 'Content-Type': 'application/json' };

// ─── Types ────────────────────────────────────────────────────────────────────
type BrushType   = 'soft-round' | 'flat' | 'bristle' | 'watercolor' | 'thick-paint' | 'eraser' | 'pencil' | 'chalk' | 'marker' | 'ink' | 'charcoal' | 'sponge' | 'fan' | 'gouache';
type Symmetry    = 'none' | 'vertical' | 'horizontal' | 'both';
type SurfaceType = 'smooth' | 'coldpress' | 'canvas' | 'newsprint' | 'toned';
type Workspace   = 'paint' | 'animate';
type AuthMode    = 'signin' | 'signup';
interface StampSettings { brushType: BrushType; brushSize: number; color: [number,number,number]; opacity: number; eraser?: boolean; layerIdx?: number }
interface BrushAdvanced { sizeJitter: number; opacityJitter: number; spacingMult: number }
interface RemoteCursor { x: number; y: number; color: string; name: string }
interface StrokeMsg { uid: string; x1: number; y1: number; x2: number; y2: number; bt: BrushType; bs: number; col: [number,number,number]; op: number; er?: boolean; li?: number }
interface CursorMsg { uid: string; x: number; y: number; name?: string; color?: string }
interface ChatMsg { uid: string; name: string; color: string; text: string; ts: number }
interface GalleryEntry { id: string; name: string; dataUrl: string; createdAt: number; isAuto?: boolean }
interface AuthUser { id: string; email: string; name: string }
interface CustomBrush { id: string; name: string; mask: Float32Array; spacing: number; source: 'procreate'|'photoshop'; previewUrl?: string }
interface Layer { id: string; name: string; opacity: number; visible: boolean; locked: boolean; blendMode: string; buf: Uint8ClampedArray | null }
interface UndoSnapshot { bufs: (Uint8ClampedArray|null)[]; meta: {id:string;name:string;opacity:number;visible:boolean;locked:boolean;blendMode:string}[]; activeIdx: number }

// ─── Design System — Editorial Bold (inspired by clean NFT marketplace UI) ────
const CREAM   = '#EDE8DA';  // Warm cream canvas background
const WHITE   = '#FFFFFF';  // Pure white for panels
const DARK    = '#0D0B07';  // Warm near-black (text, borders)
const LIME    = '#C4FF45';  // Neon lime — primary accent
const PINK    = '#FF6EB0';  // Hot pink — danger
const ACCENT  = '#3A51D8';  // Blue — links, info
const MUTED   = '#80796A';  // Warm muted text
const SAND    = '#E2DACA';  // Subtle dividers / secondary bg
const BORDER  = `2px solid ${DARK}`;
const BR      = '9px';

// ─── Surface definitions ──────────────────────────────────────────────────────
const SURFACE_W = 256, SURFACE_H = 256;
const SURFACES: { type: SurfaceType; label: string; paper: [number,number,number]; texStrength: number }[] = [
  { type:'smooth',    label:'Smooth',    paper:[248,245,240], texStrength:0    },
  { type:'coldpress', label:'Cold Press',paper:[244,239,228], texStrength:0.55 },
  { type:'canvas',    label:'Canvas',    paper:[238,231,216], texStrength:0.65 },
  { type:'newsprint', label:'Newsprint', paper:[241,237,221], texStrength:0.40 },
  { type:'toned',     label:'Toned',     paper:[190,188,180], texStrength:0.25 },
];
const SURFACE_TEXTURES: Record<SurfaceType, Float32Array> = (() => {
  const gen = (type: SurfaceType): Float32Array => {
    let s = 314159;
    const rand = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 4294967295; };
    const buf = new Float32Array(SURFACE_W * SURFACE_H);
    for (let y = 0; y < SURFACE_H; y++) for (let x = 0; x < SURFACE_W; x++) {
      const r = rand(); let v = 1.0;
      switch (type) {
        case 'smooth':    v = 1.0; break;
        case 'coldpress': { const n1=Math.sin(x*.21+y*.17+1.3)*Math.cos(x*.13-y*.29+2.0); const n2=Math.sin(x*.43-y*.31+.8)*.5; v=.72+(n1*.4+n2*.2+(r-.5)*.25)*.5; break; }
        case 'canvas':    { const gx=Math.abs(Math.sin(x*.68)),gy=Math.abs(Math.sin(y*.68)); v=.28+Math.max(gx,gy)*.58+(r-.5)*.12; break; }
        case 'newsprint': { v=.74+Math.sin((x+y*.72)*1.1)*.22+Math.sin((x*.9-y)*1.4)*.12+(r-.5)*.08; break; }
        case 'toned':     { v=.88+(r-.5)*.1; break; }
      }
      buf[y*SURFACE_W+x] = Math.max(0.02, Math.min(1.0, v));
    }
    return buf;
  };
  return { smooth:gen('smooth'), coldpress:gen('coldpress'), canvas:gen('canvas'), newsprint:gen('newsprint'), toned:gen('toned') };
})();

function loadGallery(): GalleryEntry[] { try { return JSON.parse(localStorage.getItem('mepaint-gallery-v2') ?? '[]'); } catch { return []; } }
function persistGallery(e: GalleryEntry[]) { localStorage.setItem('mepaint-gallery-v2', JSON.stringify(e.slice(0,24))); }
function hslToRgb(h:number,s:number,l:number):[number,number,number]{s/=100;l/=100;const a=s*Math.min(l,1-l);const f=(n:number)=>{const k=(n+h/30)%12;return l-a*Math.max(-1,Math.min(k-3,9-k,1));};return[Math.round(f(0)*255),Math.round(f(8)*255),Math.round(f(4)*255)];}
function rgbToHsl(r:number,g:number,b:number):[number,number,number]{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;if(mx===mn)return[0,0,Math.round(l*100)];const d=mx-mn,s=l>.5?d/(2-mx-mn):d/(mx+mn);let h=0;switch(mx){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}return[Math.round(h*360),Math.round(s*100),Math.round(l*100)];}
function extractYouTubeId(url:string):string|null{const m=url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);return m?m[1]:null;}
const COLLAB_COLORS=['#E85C4A','#3B8CF8','#38B48A','#E8960C','#A855F7','#EC4899','#14B8A6','#F97316'];
function collabColor(uid:string){const h=uid.split('').reduce((a,c)=>(a+c.charCodeAt(0))|0,0);return COLLAB_COLORS[h%COLLAB_COLORS.length];}

const BLEND_MODES = [
  {id:'normal',    label:'Normal'},
  {id:'multiply',  label:'Multiply'},
  {id:'screen',    label:'Screen'},
  {id:'overlay',   label:'Overlay'},
  {id:'darken',    label:'Darken'},
  {id:'lighten',   label:'Lighten'},
  {id:'color-dodge',label:'Color Dodge'},
  {id:'color-burn', label:'Color Burn'},
  {id:'hard-light', label:'Hard Light'},
  {id:'soft-light', label:'Soft Light'},
  {id:'difference', label:'Difference'},
  {id:'exclusion',  label:'Exclusion'},
];
function applyBlend(bm:string,r1:number,g1:number,b1:number,r2:number,g2:number,b2:number):[number,number,number]{
  const ch=(a:number,b:number)=>{
    switch(bm){
      case 'multiply':  return a*b;
      case 'screen':    return 1-(1-a)*(1-b);
      case 'overlay':   return a<.5?2*a*b:1-2*(1-a)*(1-b);
      case 'darken':    return Math.min(a,b);
      case 'lighten':   return Math.max(a,b);
      case 'color-dodge': return b<1?Math.min(1,a/(1-b)):1;
      case 'color-burn':  return b>0?1-Math.min(1,(1-a)/b):0;
      case 'hard-light':  return b<.5?2*a*b:1-2*(1-a)*(1-b);
      case 'soft-light':  return b<.5?a-(1-2*b)*a*(1-a):a+(2*b-1)*(( a<.25?((16*a-12)*a+4)*a:Math.sqrt(a))-a);
      case 'difference':  return Math.abs(a-b);
      case 'exclusion':   return a+b-2*a*b;
      default:            return b;
    }
  };
  return [ch(r1,r2),ch(g1,g2),ch(b1,b2)];
}
const ART_PRE=['Vivid','Bold','Dreamy','Swift','Cosmic','Serene','Wild','Gentle'];
const ART_NAM=['Monet','Dali','Klimt','Basquiat','Hockney','Kahlo','Warhol','Rembrandt'];
function generateName(){return `${ART_PRE[Math.floor(Math.random()*ART_PRE.length)]} ${ART_NAM[Math.floor(Math.random()*ART_NAM.length)]}`;}
const PIGMENTS:{name:string;rgb:[number,number,number]}[]=[
  {name:'Cadmium Yellow',rgb:[254,236,0]},{name:'Hansa Yellow',rgb:[252,211,0]},
  {name:'Cadmium Orange',rgb:[255,105,0]},{name:'Cadmium Red',rgb:[255,39,2]},
  {name:'Quinacridone Magenta',rgb:[128,2,46]},{name:'Cobalt Violet',rgb:[78,0,66]},
  {name:'Ultramarine Blue',rgb:[25,0,89]},{name:'Cobalt Blue',rgb:[0,33,133]},
  {name:'Phthalo Green',rgb:[0,60,50]},{name:'Sap Green',rgb:[107,148,4]},
  {name:'Burnt Sienna',rgb:[123,72,0]},{name:'Raw Umber',rgb:[115,92,56]},
  {name:'Titanium White',rgb:[249,250,249]},{name:'Ivory Black',rgb:[13,9,1]},
];
const BRUSH_SPACING:Record<BrushType,number>={'soft-round':0.18,'flat':0.13,'bristle':0.22,'watercolor':0.45,'thick-paint':0.18,'eraser':0.13,'pencil':0.06,'chalk':0.15,'marker':0.08,'ink':0.05,'charcoal':0.14,'sponge':0.30,'fan':0.20,'gouache':0.10};
const BRUSH_DEFS=[
  {type:'soft-round' as BrushType,label:'Soft Round',key:'1',category:'Basic'},
  {type:'flat'       as BrushType,label:'Flat',      key:'2',category:'Basic'},
  {type:'bristle'    as BrushType,label:'Bristle',   key:'3',category:'Basic'},
  {type:'watercolor' as BrushType,label:'Watercolor',key:'4',category:'Basic'},
  {type:'thick-paint'as BrushType,label:'Thick',     key:'5',category:'Basic'},
  {type:'eraser'     as BrushType,label:'Eraser',    key:'6',category:'Basic'},
  {type:'pencil'     as BrushType,label:'Pencil',    key:'' ,category:'Drawing'},
  {type:'chalk'      as BrushType,label:'Chalk',     key:'' ,category:'Drawing'},
  {type:'marker'     as BrushType,label:'Marker',    key:'' ,category:'Drawing'},
  {type:'ink'        as BrushType,label:'Ink Pen',   key:'' ,category:'Drawing'},
  {type:'charcoal'   as BrushType,label:'Charcoal',  key:'' ,category:'Texture'},
  {type:'sponge'     as BrushType,label:'Sponge',    key:'' ,category:'Texture'},
  {type:'fan'        as BrushType,label:'Fan',       key:'' ,category:'Texture'},
  {type:'gouache'    as BrushType,label:'Gouache',   key:'' ,category:'Paint'},
];
const DEFAULT_ADV: Record<BrushType,BrushAdvanced>={
  'soft-round': {sizeJitter:0,  opacityJitter:0,  spacingMult:1.0},
  'flat':       {sizeJitter:3,  opacityJitter:5,  spacingMult:1.0},
  'bristle':    {sizeJitter:22, opacityJitter:28, spacingMult:1.0},
  'watercolor': {sizeJitter:16, opacityJitter:38, spacingMult:1.0},
  'thick-paint':{sizeJitter:8,  opacityJitter:8,  spacingMult:1.0},
  'eraser':     {sizeJitter:0,  opacityJitter:0,  spacingMult:1.0},
  'pencil':     {sizeJitter:4,  opacityJitter:10, spacingMult:1.0},
  'chalk':      {sizeJitter:18, opacityJitter:30, spacingMult:1.2},
  'marker':     {sizeJitter:0,  opacityJitter:5,  spacingMult:1.0},
  'ink':        {sizeJitter:2,  opacityJitter:0,  spacingMult:1.0},
  'charcoal':   {sizeJitter:20, opacityJitter:25, spacingMult:1.0},
  'sponge':     {sizeJitter:12, opacityJitter:20, spacingMult:1.5},
  'fan':        {sizeJitter:8,  opacityJitter:10, spacingMult:1.0},
  'gouache':    {sizeJitter:3,  opacityJitter:5,  spacingMult:1.0},
};
const CANVAS_PRESETS = [
  { label:'512 sq',  w:512,  h:512  },{ label:'1024 sq', w:1024, h:1024 },
  { label:'2048 sq', w:2048, h:2048 },{ label:'720p',    w:1280, h:720  },
  { label:'1080p',   w:1920, h:1080 },{ label:'Portrait',w:720,  h:1280 },
  { label:'A4 Land', w:1123, h:794  },{ label:'Twitter', w:1200, h:628  },
];


// ─── Brush SVG Icons ──────────────────────────────────────────────────────────
function BrushIcon({type,size=16}:{type:BrushType;size?:number}){
  const s={width:size,height:size} as React.CSSProperties;
  switch(type){
    case 'soft-round': return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><circle cx="10" cy="10" r="7" opacity=".1"/><circle cx="10" cy="10" r="4.5" opacity=".25"/><circle cx="10" cy="10" r="2.5"/></svg>);
    case 'flat':       return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><rect x="2" y="8" width="16" height="4" rx="1.5"/></svg>);
    case 'bristle':    return(<svg viewBox="0 0 20 20" style={s} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="10" y1="17" x2="6" y2="3"/><line x1="10" y1="17" x2="8.5" y2="2.5"/><line x1="10" y1="17" x2="10" y2="2"/><line x1="10" y1="17" x2="11.5" y2="2.5"/><line x1="10" y1="17" x2="14" y2="3"/></svg>);
    case 'watercolor': return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><path d="M10 2C10 2 4 8.5 4 13a6 6 0 0012 0C16 8.5 10 2 10 2z" opacity=".15"/><path d="M10 7C10 7 7.5 11 7.5 13a2.5 2.5 0 005 0c0-2-2.5-6-2.5-6z" opacity=".6"/></svg>);
    case 'thick-paint':return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><ellipse cx="10" cy="11" rx="7" ry="4" opacity=".35"/><ellipse cx="9.5" cy="10" rx="4" ry="2.5" opacity=".7"/></svg>);
    case 'eraser':     return(<svg viewBox="0 0 20 20" style={s} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 17H7L3 13l8-8 6 6-3 3"/><line x1="6" y1="14" x2="9" y2="11" opacity=".4"/></svg>);
    case 'pencil':     return(<svg viewBox="0 0 20 20" style={s} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3l3 3-9 9H5v-3L14 3z"/><line x1="12" y1="5" x2="15" y2="8" opacity=".4"/></svg>);
    case 'chalk':      return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><rect x="7" y="2" width="6" height="14" rx="2" opacity=".25"/><rect x="8" y="3" width="4" height="12" rx="1.5" opacity=".5"/><line x1="7" y1="6" x2="13" y2="6" stroke="currentColor" strokeWidth=".7" opacity=".6"/><line x1="7" y1="9" x2="13" y2="9" stroke="currentColor" strokeWidth=".7" opacity=".4"/><line x1="7" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth=".7" opacity=".3"/><polygon points="8,16 12,16 10,19" opacity=".8"/></svg>);
    case 'marker':     return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><rect x="3" y="8" width="14" height="5" rx="1"/><path d="M14 8L17 10.5 14 13z" opacity=".5"/></svg>);
    case 'ink':        return(<svg viewBox="0 0 20 20" style={s} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M10 17C10 17 4 11 4 7a6 6 0 0112 0C16 11 10 17 10 17z" fill="currentColor" opacity=".15"/><path d="M10 14C10 14 7.5 11 7.5 9a2.5 2.5 0 015 0C12.5 11 10 14 10 14z" fill="currentColor" opacity=".7"/></svg>);
    case 'charcoal':   return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><rect x="2" y="8.5" width="16" height="3" rx="1.5" opacity=".8"/><rect x="4" y="7" width="12" height="2" rx="1" opacity=".3"/><rect x="6" y="11" width="10" height="1.5" rx=".75" opacity=".2"/></svg>);
    case 'sponge':     return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><circle cx="6" cy="6" r="2" opacity=".5"/><circle cx="11" cy="5" r="1.5" opacity=".7"/><circle cx="15" cy="8" r="2" opacity=".4"/><circle cx="7" cy="11" r="2.5" opacity=".6"/><circle cx="13" cy="13" r="1.8" opacity=".5"/><circle cx="4" cy="15" r="1.3" opacity=".35"/></svg>);
    case 'fan':        return(<svg viewBox="0 0 20 20" style={s} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><line x1="10" y1="18" x2="3" y2="4"/><line x1="10" y1="18" x2="6" y2="3"/><line x1="10" y1="18" x2="10" y2="2"/><line x1="10" y1="18" x2="14" y2="3"/><line x1="10" y1="18" x2="17" y2="4"/></svg>);
    case 'gouache':    return(<svg viewBox="0 0 20 20" style={s} fill="currentColor"><rect x="3" y="7" width="14" height="7" rx="2"/><rect x="5" y="8" width="10" height="5" rx="1" opacity=".4"/></svg>);
  }
}
function FlipHIcon({size=14}:{size?:number}){return(<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="8" y1="1.5" x2="8" y2="14.5" strokeDasharray="2 1.5"/><path d="M5.5 4.5L2 8l3.5 3.5"/><path d="M10.5 4.5L14 8l-3.5 3.5"/></svg>);}
function FlipVIcon({size=14}:{size?:number}){return(<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="1.5" y1="8" x2="14.5" y2="8" strokeDasharray="2 1.5"/><path d="M4.5 5.5L8 2l3.5 3.5"/><path d="M4.5 10.5L8 14l3.5-3.5"/></svg>);}
function SurfaceIcon({type,size=13}:{type:SurfaceType;size?:number}){
  const s={width:size,height:size} as React.CSSProperties;
  switch(type){
    case 'smooth':    return(<svg viewBox="0 0 14 14" style={s} fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="1" y="1" width="12" height="12" rx="2"/></svg>);
    case 'coldpress': return(<svg viewBox="0 0 14 14" style={s} fill="currentColor"><circle cx="3.5" cy="3.5" r="1"/><circle cx="7" cy="5" r="1.2"/><circle cx="10.5" cy="3.5" r=".8"/><circle cx="5" cy="9" r="1"/><circle cx="9.5" cy="8.5" r="1.3"/></svg>);
    case 'canvas':    return(<svg viewBox="0 0 14 14" style={s} fill="none" stroke="currentColor" strokeWidth="1"><line x1="1" y1="3.5" x2="13" y2="3.5"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="10.5" x2="13" y2="10.5"/><line x1="3.5" y1="1" x2="3.5" y2="13"/><line x1="7" y1="1" x2="7" y2="13"/><line x1="10.5" y1="1" x2="10.5" y2="13"/></svg>);
    case 'newsprint': return(<svg viewBox="0 0 14 14" style={s} fill="none" stroke="currentColor" strokeWidth="1.1"><line x1="1" y1="2" x2="13" y2="2"/><line x1="1" y1="4.5" x2="9" y2="4.5"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="9.5" x2="11" y2="9.5"/></svg>);
    case 'toned':     return(<svg viewBox="0 0 14 14" style={s} fill="currentColor" opacity=".5"><rect x="1" y="1" width="12" height="12" rx="2"/></svg>);
  }
}

// ─── Clipboard fallback ────────────────────────────────────────────────────────
function fallbackCopy(text: string, onDone: () => void) {
  const ta = document.createElement('textarea');
  ta.value = text;
  Object.assign(ta.style, { position:'fixed', left:'-9999px', top:'-9999px', opacity:'0' });
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
  onDone();
}

// ─── Drag utility ──────────────────────────────────────��──────────────────────
function startDrag(
  e: { preventDefault():void; clientX:number; clientY:number; target:EventTarget|null },
  current: {x:number;y:number},
  setter: (p:{x:number;y:number}) => void
) {
  const tgt = e.target as HTMLElement | null;
  if (tgt?.closest('button,input,a,select')) return;
  e.preventDefault();
  const startMX = e.clientX, startMY = e.clientY;
  const startX = current.x, startY = current.y;
  const onMove = (ev: MouseEvent) => setter({ x: startX + ev.clientX - startMX, y: startY + ev.clientY - startMY });
  const onUp   = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function App() {

  // ── Core refs
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const ytIframeRef    = useRef<HTMLIFrameElement>(null);
  const ytInputRef     = useRef<HTMLInputElement>(null);
  const refResizeRef   = useRef<{startX:number;startY:number;startW:number;startH:number}|null>(null);
  const channelRef     = useRef<ReturnType<typeof supabase.channel>|null>(null);
  const channelReady   = useRef(false);
  const cursorThrottle = useRef(0);
  const autoSaveTimer  = useRef<ReturnType<typeof setInterval>|null>(null);
  const chatEndRef     = useRef<HTMLDivElement>(null);
  const surfacePopRef  = useRef<HTMLDivElement>(null);
  const brushAdvPopRef = useRef<HTMLDivElement>(null);
  const profilePopRef  = useRef<HTMLDivElement>(null);
  const brushLibRef    = useRef<HTMLDivElement>(null);
  const colorPanelRef  = useRef<HTMLDivElement>(null);
  const colorBtnRef    = useRef<HTMLButtonElement>(null);
  const surfaceBtnRef  = useRef<HTMLButtonElement>(null);
  const brushAdvBtnRef = useRef<HTMLButtonElement>(null);
  const brushLibBtnRef = useRef<HTMLButtonElement>(null);
  const brushFileInputRef = useRef<HTMLInputElement>(null);
  const cursorDivRef   = useRef<HTMLDivElement>(null);
  // Animation
  const animFramesRef  = useRef<string[]>([]);
  const animFrameRef   = useRef(0);
  const animFpsRef     = useRef(12);
  const animPlayRef    = useRef<ReturnType<typeof setInterval>|null>(null);
  const onionCanvasRef = useRef<HTMLCanvasElement>(null);
  const showOnionRef   = useRef(true);
  const workspaceRef   = useRef<Workspace>('paint');
  // Brush / surface
  const brushAdvancedRef  = useRef<Record<BrushType,BrushAdvanced>>(DEFAULT_ADV);
  const surfaceRef        = useRef<SurfaceType>('smooth');
  const selectedCustomRef = useRef<CustomBrush|null>(null);
  const customBrushesRef  = useRef<CustomBrush[]>([]);
  const flipHRef         = useRef(false);
  const flipVRef         = useRef(false);
  const pixelBufRef      = useRef<Uint8ClampedArray|null>(null);
  const brushMasks       = useRef<Map<string,Float32Array>>(new Map());
  const ds = useRef({
    isDrawing:false, isPanning:false, isSpaceHeld:false,
    lastX:0, lastY:0, panStartX:0, panStartY:0, panStartPX:0, panStartPY:0,
    smudgeColor:null as number[]|null, pressure:1.0,
  });
  // Collab
  const myUid   = useRef((() => { let id=sessionStorage.getItem('mepaint-uid'); if(!id){id=crypto.randomUUID();sessionStorage.setItem('mepaint-uid',id);} return id; })());
  const myName  = useRef((() => { let n=localStorage.getItem('mepaint-display-name'); if(!n){n=generateName();localStorage.setItem('mepaint-display-name',n);} return n; })());
  const myColor = useRef(collabColor(myUid.current));
  const isHost  = useRef(false);
  // RAF
  const dirtyRef       = useRef({x1:Infinity,y1:Infinity,x2:-Infinity,y2:-Infinity});
  const rafRef         = useRef<number|null>(null);
  const isDirtyRef     = useRef(false);
  const canvasInitDone = useRef(false);
  // Layers
  const layersRef          = useRef<Layer[]>([]);
  const activeLayerIdxRef  = useRef<number>(0);
  const layerPanelRef      = useRef<HTMLDivElement>(null);
  const imgImportRef       = useRef<HTMLInputElement>(null);
  const thumbTimerRef      = useRef<ReturnType<typeof setTimeout>|null>(null);
  const undoSnapshots      = useRef<UndoSnapshot[]>([]);
  const maxUndo            = 14;
  // ── Stable refs so pointer listeners never re-register mid-stroke
  const activePointerIdRef = useRef<number|null>(null);
  const toolStateRef       = useRef({brushType:'soft-round' as BrushType, brushSize:28, color:[0,0,0] as [number,number,number], opacity:82});
  const toCanvasRef        = useRef<(cx:number,cy:number)=>{x:number,y:number}>(()=>({x:0,y:0}));
  const interpolateRef     = useRef<(x1:number,y1:number,x2:number,y2:number,s:StampSettings,local?:boolean)=>void>(()=>{});
  const broadcastStrokeRef = useRef<(x1:number,y1:number,x2:number,y2:number,s:StampSettings)=>void>(()=>{});

  // ── State: tool
  const [brushType,  setBrushType]  = useState<BrushType>('soft-round');
  const [brushSize,  setBrushSize]  = useState(28);
  const [opacity,    setOpacity]    = useState(82);
  const [smudgeMode, setSmudgeMode] = useState(false);
  const [eraserMode, setEraserMode] = useState(false);
  const eraserModeRef = useRef(false);
  useEffect(()=>{eraserModeRef.current=eraserMode;},[eraserMode]);
  const [symmetry,   setSymmetry]   = useState<Symmetry>('none');
  const [isEyedropper,setIsEyedropper]=useState(false);
  // ── State: transform tool
  const [isTransformMode, setIsTransformMode] = useState(false);
  const [txPhase, setTxPhase] = useState<'select'|'active'>('select');
  const [txRect, setTxRect] = useState<{x:number;y:number;w:number;h:number}|null>(null);
  const [txPreviewUrl, setTxPreviewUrl] = useState<string|null>(null);
  const txCapRef     = useRef<ImageData|null>(null);
  const txOrigRef    = useRef<{x:number;y:number;w:number;h:number}|null>(null);
  const isTransformRef = useRef(false);
  const txPhaseRef   = useRef<'select'|'active'>('select');
  const txRectRef    = useRef<{x:number;y:number;w:number;h:number}|null>(null);
  const txDsRef      = useRef({active:false,type:'selecting' as 'selecting'|'moving'|'resizing',handle:'',startCX:0,startCY:0,startRect:{x:0,y:0,w:0,h:0}});
  const txOrigFullRef= useRef<ImageData|null>(null);  // full bbox snapshot used for lasso cancel
  // ── State: lasso tool
  const [isLassoMode, setIsLassoMode] = useState(false);
  const [lassoPath, setLassoPath] = useState<{x:number;y:number}[]>([]);
  const isLassoRef   = useRef(false);
  const lassoPathRef = useRef<{x:number;y:number}[]>([]);
  const lassoDrawRef = useRef(false);   // true while finger/pen is held down drawing
  const [lassoPhase, setLassoPhase] = useState<'drawing'|'painting'>('drawing');
  const lassoPhaseRef = useRef<'drawing'|'painting'>('drawing');
  const lassoMaskRef = useRef<Uint8Array|null>(null);
  // ── State: color
  const [color,       setColor]       = useState<[number,number,number]>(hslToRgb(210,65,55));
  const [hsl,         setHsl]         = useState<[number,number,number]>([210,65,55]);
  const [activePig,   setActivePig]   = useState(-1);
  const [recentColors,setRecentColors]= useState<[number,number,number][]>([]);
  // ── State: viewport
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({x:0,y:0});
  const vpRef = useRef({zoom:1,panX:0,panY:0});
  useEffect(()=>{vpRef.current={zoom,panX:pan.x,panY:pan.y};},[zoom,pan]);
  useEffect(()=>{isTransformRef.current=isTransformMode;if(!isTransformMode)txDsRef.current.active=false;},[isTransformMode]);
  useEffect(()=>{txPhaseRef.current=txPhase;},[txPhase]);
  useEffect(()=>{txRectRef.current=txRect;},[txRect]);
  useEffect(()=>{isLassoRef.current=isLassoMode;if(!isLassoMode){lassoDrawRef.current=false;}},[isLassoMode]);
  useEffect(()=>{lassoPhaseRef.current=lassoPhase;},[lassoPhase]);
  // ── State: flip
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  useEffect(()=>{flipHRef.current=flipH;},[flipH]);
  useEffect(()=>{flipVRef.current=flipV;},[flipV]);
  // ── State: surface
  const [surface, _setSurface] = useState<SurfaceType>('smooth');
  const setSurface = useCallback((s:SurfaceType)=>{ surfaceRef.current=s; _setSurface(s); },[]);
  // ── State: brush advanced
  const [brushAdvanced, _setBrushAdvanced] = useState<Record<BrushType,BrushAdvanced>>(DEFAULT_ADV);
  const setBrushAdvanced = useCallback((fn:(p:Record<BrushType,BrushAdvanced>)=>Record<BrushType,BrushAdvanced>)=>{
    _setBrushAdvanced(prev=>{ const next=fn(prev); brushAdvancedRef.current=next; return next; });
  },[]);
  // ── State: workspace
  const [workspace,  setWorkspace]  = useState<Workspace>('paint');
  useEffect(()=>{workspaceRef.current=workspace;},[workspace]);
  // ── State: animation
  const [animFrames,  setAnimFrames]  = useState<string[]>([]);
  const [animFrame,   setAnimFrame]   = useState(0);
  const [animFps,     setAnimFps]     = useState(12);
  const [animPlaying, setAnimPlaying] = useState(false);
  const [showOnion,   setShowOnion]   = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  useEffect(()=>{ animFpsRef.current=animFps; },[animFps]);
  useEffect(()=>{ showOnionRef.current=showOnion; },[showOnion]);
  // ── State: canvas size
  const [showCanvasSize, setShowCanvasSize] = useState(false);
  const [csW, setCsW] = useState(1024);
  const [csH, setCsH] = useState(768);
  const [csMode, setCsMode] = useState<'crop'|'scale'>('crop');
  const [canvasW, setCanvasW] = useState(0);
  const [canvasH, setCanvasH] = useState(0);
  // ── State: startup size picker
  const [showStartupPicker, setShowStartupPicker] = useState(true);
  const [spW, setSpW] = useState(1024);
  const [spH, setSpH] = useState(768);
  // ── State: auth + name
  const [authUser,    setAuthUser]    = useState<AuthUser|null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [authMode,    setAuthMode]    = useState<AuthMode>('signin');
  const [authEmail,   setAuthEmail]   = useState('');
  const [authPass,    setAuthPass]    = useState('');
  const [authNameInput,setAuthNameInput]=useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError,   setAuthError]   = useState('');
  const [editNameVal, setEditNameVal] = useState('');
  const [userName,    setUserName]    = useState(myName.current);
  const [showAuthForm,setShowAuthForm]=useState(false);
  // ── State: gallery
  const [gallery,     setGallery]     = useState<GalleryEntry[]>(loadGallery);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryName, setGalleryName] = useState('');
  const autoGalleryRef = useRef<ReturnType<typeof setInterval>|null>(null);
  // ── State: collab
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput,    setChatInput]    = useState('');
  const [collabTab,    setCollabTab]    = useState<'room'|'people'|'chat'>('room');
  // ── State: misc UI
  const [isOverCanvas,  setIsOverCanvas]  = useState(false);
  // mouseScreen removed — cursor position updated via cursorDivRef DOM manipulation
  const [clearConfirm,  setClearConfirm]  = useState(false);
  const [showHelp,      setShowHelp]      = useState(false);
  const [showMusic,     setShowMusic]     = useState(false);
  const [showRef,       setShowRef]       = useState(false);
  const [showInvite,    setShowInvite]    = useState(false);
  const [showBrushAdv,    setShowBrushAdv]    = useState(false);
  const [showSurface,     setShowSurface]     = useState(false);
  const [showBrushLib,    setShowBrushLib]    = useState(false);
  const [showColorPanel,  setShowColorPanel]  = useState(false);
  // ── State: layers
  const [layers,          _setLayersUI]       = useState<Layer[]>([]);
  const [activeLayerIdx,  _setActiveIdxUI]    = useState<number>(0);
  const [showLayerPanel,  setShowLayerPanel]  = useState(false);
  const [layerPanelTop,   setLayerPanelTop]   = useState(60);
  const layerBtnRef = useRef<HTMLButtonElement>(null);
  const [layerThumbs,     setLayerThumbs]     = useState<Record<string,string>>({});
  const [renamingId,      setRenamingId]      = useState<string|null>(null);
  const [renameVal,       setRenameVal]       = useState('');
  const [layerDragIdx,    setLayerDragIdx]    = useState<number|null>(null);
  const [layerDropIdx,    setLayerDropIdx]    = useState<number|null>(null);
  const [customBrushes,   setCustomBrushes]   = useState<CustomBrush[]>(()=>{try{const s=localStorage.getItem('mepaint-custom-brushes-v1');if(!s)return[];const arr=JSON.parse(s);return arr.map((b:Omit<CustomBrush,'mask'>)=>({...b,mask:new Float32Array(128*128)}));}catch{return [];}});
  const [selectedCustom,  setSelectedCustom]  = useState<CustomBrush|null>(null);
  const [brushImportLoading, setBrushImportLoading] = useState(false);
  const [brushImportError,   setBrushImportError]   = useState('');
  const [brushLibTab,     setBrushLibTab]     = useState<'builtin'|'imported'>('builtin');
  // sync selectedCustom to ref (must be AFTER selectedCustom useState above)
  useEffect(()=>{ selectedCustomRef.current=selectedCustom; },[selectedCustom]);
  const [refImage,      setRefImage]      = useState<string|null>(null);
  const [refSize,       setRefSize]       = useState({w:240,h:200});
  const [refFit,        setRefFit]        = useState<'cover'|'contain'>('contain');
  const [ytUrl,         setYtUrl]         = useState('');
  const [videoId,       setVideoId]       = useState<string|null>(null);
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [roomId,        setRoomId]        = useState<string|null>(null);
  const [isConnected,   setIsConnected]   = useState(false);
  const [linkCopied,    setLinkCopied]    = useState(false);
  const [remoteCursors, setRemoteCursors] = useState<Map<string,RemoteCursor>>(new Map());
  const [onlineUsers,   setOnlineUsers]   = useState<{uid:string;name:string;color:string}[]>([]);
  // ── State: draggable windows
  const [musicPos,      setMusicPos]      = useState(()=>({x:62,y:Math.max(80,window.innerHeight-380)}));
  const [refPos,        setRefPos]        = useState(()=>({x:Math.max(0,window.innerWidth-264),y:56}));

  // ── Mobile responsive
  const [isMobile, setIsMobile] = useState(()=>window.innerWidth<768);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [mobileToolExpanded, setMobileToolExpanded] = useState(false);
  useEffect(()=>{const h=()=>{const m=window.innerWidth<768;setIsMobile(m);if(!m)setMobileDrawer(false);};window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);

  const currentSurface = SURFACES.find(s=>s.type===surface)!;
  const [h,s,l]=hsl;
  const colorCss=`rgb(${color.join(',')})`;
  const activeBrushLabel=selectedCustom?.name ?? BRUSH_DEFS.find(b=>b.type===brushType)?.label??'';
  const spaceHeld=ds.current.isSpaceHeld;
  const sideW=isMobile?0:54;
  const headerH=isMobile?42:48;
  const toolH=isMobile?56:76;
  const animBottom=workspace==='animate'?(isMobile?120:148):toolH;

  // ── Click-outside detection
  useEffect(()=>{
    const onDown=(e:MouseEvent)=>{
      if(showSurface&&surfacePopRef.current&&!surfacePopRef.current.contains(e.target as Node)&&!(surfaceBtnRef.current&&surfaceBtnRef.current.contains(e.target as Node)))setShowSurface(false);
      if(showBrushAdv&&brushAdvPopRef.current&&!brushAdvPopRef.current.contains(e.target as Node)&&!(brushAdvBtnRef.current&&brushAdvBtnRef.current.contains(e.target as Node)))setShowBrushAdv(false);
      if(showProfile&&profilePopRef.current&&!profilePopRef.current.contains(e.target as Node))setShowProfile(false);
      if(showBrushLib&&brushLibRef.current&&!brushLibRef.current.contains(e.target as Node)&&!(brushLibBtnRef.current&&brushLibBtnRef.current.contains(e.target as Node)))setShowBrushLib(false);
      if(showColorPanel&&colorPanelRef.current&&!colorPanelRef.current.contains(e.target as Node)&&!(colorBtnRef.current&&colorBtnRef.current.contains(e.target as Node)))setShowColorPanel(false);
      // Layer panel stays open (explicit close via X button)
    };
    document.addEventListener('mousedown',onDown);
    return()=>document.removeEventListener('mousedown',onDown);
  },[showSurface,showBrushAdv,showProfile,showBrushLib,showColorPanel]);

  // ── Check auth session
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      if(session?.user){
        const name=session.user.user_metadata?.name||myName.current;
        setAuthUser({id:session.user.id,email:session.user.email!,name});
        myName.current=name;setUserName(name);
      }
    });
  },[]);

  // ── Layer sync helpers
  const syncLayers = useCallback((next: Layer[], activeIdx: number) => {
    layersRef.current = next;
    activeLayerIdxRef.current = activeIdx;
    pixelBufRef.current = next[activeIdx]?.buf ?? null;
    _setLayersUI(next);
    _setActiveIdxUI(activeIdx);
  }, []);

  const setActiveLayer = useCallback((idx: number) => {
    activeLayerIdxRef.current = idx;
    pixelBufRef.current = layersRef.current[idx]?.buf ?? null;
    _setActiveIdxUI(idx);
  }, []);

  // ── Color helpers
  const pushRecent=useCallback((rgb:[number,number,number])=>setRecentColors(p=>{const f=p.filter(c=>!(c[0]===rgb[0]&&c[1]===rgb[1]&&c[2]===rgb[2]));return[rgb,...f].slice(0,10);}),[]);
  const applyColor=useCallback((rgb:[number,number,number])=>{setColor(rgb);setHsl(rgbToHsl(rgb[0],rgb[1],rgb[2]));setActivePig(-1);pushRecent(rgb);},[pushRecent]);
  const setFromHsl=useCallback((h:number,s:number,l:number)=>{const rgb=hslToRgb(h,s,l);setColor(rgb);setHsl([h,s,l]);setActivePig(-1);},[]);

  // ── Name save (works for BOTH guests and signed-in users)
  const saveDisplayName=useCallback(()=>{
    const n=editNameVal.trim();if(!n) return;
    myName.current=n;localStorage.setItem('mepaint-display-name',n);setUserName(n);
    if(authUser)setAuthUser(prev=>prev?{...prev,name:n}:null);
    // Update presence so other collaborators see the new name immediately
    if(channelReady.current&&channelRef.current)channelRef.current.track({name:n,color:myColor.current});
    setEditNameVal('');
  },[editNameVal,authUser]);

  // ── Auth functions
  const signIn=useCallback(async()=>{
    setAuthLoading(true);setAuthError('');
    const{data,error}=await supabase.auth.signInWithPassword({email:authEmail,password:authPass});
    if(error){setAuthError(error.message);setAuthLoading(false);return;}
    const name=data.user?.user_metadata?.name||myName.current;
    setAuthUser({id:data.user!.id,email:data.user!.email!,name});
    myName.current=name;setUserName(name);localStorage.setItem('mepaint-display-name',name);
    setAuthLoading(false);setShowAuthForm(false);setAuthEmail('');setAuthPass('');
  },[authEmail,authPass]);
  const signUp=useCallback(async()=>{
    setAuthLoading(true);setAuthError('');
    try{
      const res=await fetch(`${SERVER}/auth/signup`,{method:'POST',headers:AUTH_H,body:JSON.stringify({email:authEmail,password:authPass,name:authNameInput||myName.current})});
      const json=await res.json();if(!res.ok){setAuthError(json.error||'Signup failed');setAuthLoading(false);return;}
      const{data,error}=await supabase.auth.signInWithPassword({email:authEmail,password:authPass});
      if(error){setAuthError(error.message);setAuthLoading(false);return;}
      const name=authNameInput||data.user?.user_metadata?.name||myName.current;
      setAuthUser({id:data.user!.id,email:data.user!.email!,name});
      myName.current=name;setUserName(name);localStorage.setItem('mepaint-display-name',name);
      setAuthLoading(false);setShowAuthForm(false);setAuthEmail('');setAuthPass('');setAuthNameInput('');
    }catch(err){setAuthError(String(err));setAuthLoading(false);}
  },[authEmail,authPass,authNameInput]);
  const signOut=useCallback(async()=>{
    await supabase.auth.signOut();setAuthUser(null);setShowAuthForm(false);
  },[]);

  // ── Brush import helpers
  const imageUrlToMask=useCallback((url:string):Promise<Float32Array>=>new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const MS=128,cnv=document.createElement('canvas');cnv.width=MS;cnv.height=MS;
      const ctx=cnv.getContext('2d')!;ctx.drawImage(img,0,0,MS,MS);
      const d=ctx.getImageData(0,0,MS,MS).data;
      const mask=new Float32Array(MS*MS);
      for(let i=0;i<MS*MS;i++){
        const a=d[i*4+3]/255,r=d[i*4]/255,g=d[i*4+1]/255,b=d[i*4+2]/255;
        const luma=.299*r+.587*g+.114*b;
        mask[i]=a<.05?(1-luma):a;
      }
      resolve(mask);
    };
    img.onerror=()=>reject(new Error('Could not load brush stamp image'));
    img.src=url;
  }),[]);

  const parseProcreate=useCallback(async(file:File):Promise<CustomBrush[]>=>{
    const zip=await JSZip.loadAsync(file);
    const stamps:{name:string;entry:JSZip.JSZipObject}[]=[];
    // .brush: flat zip with Stamp.png directly
    // .brushset: zip containing .brush directories (which are also zips)
    zip.forEach((path,entry)=>{
      if(!entry.dir&&(path.endsWith('Stamp.png')||path.toLowerCase().endsWith('stamp.png'))){
        const parts=path.split('/');
        const nm=parts.length>=2?parts[parts.length-2].replace(/\.brush$/i,''):file.name.replace(/\.(brush|brushset)$/i,'');
        stamps.push({name:nm,entry});
      }
    });
    // If .brushset — inner .brush files may be nested zips
    if(stamps.length===0){
      const brushEntries:{name:string;entry:JSZip.JSZipObject}[]=[];
      zip.forEach((path,entry)=>{if(!entry.dir&&path.match(/\.brush$/i))brushEntries.push({name:path.replace(/\.brush$/i,''),entry});});
      for(const{name,entry}of brushEntries){
        try{
          const innerBlob=await entry.async('blob');
          const innerZip=await JSZip.loadAsync(innerBlob);
          innerZip.forEach((p2,e2)=>{if(!e2.dir&&p2.match(/stamp\.png$/i))stamps.push({name,entry:e2});});
        }catch{}
      }
    }
    if(stamps.length===0)throw new Error('No brush stamps found. Make sure the file contains a Stamp.png.');
    const results:CustomBrush[]=[];
    for(const{name,entry}of stamps){
      const blob=await entry.async('blob');
      const url=URL.createObjectURL(blob);
      const mask=await imageUrlToMask(url);
      results.push({id:crypto.randomUUID(),name:name||'Imported',mask,spacing:0.18,source:'procreate',previewUrl:url});
    }
    return results;
  },[imageUrlToMask]);

  const parseAbr=useCallback(async(file:File):Promise<CustomBrush[]>=>{
    const buf=await file.arrayBuffer();const view=new DataView(buf);
    const version=view.getUint16(0);
    if(version===6||version===7){throw new Error('Photoshop ABR v6/v7 format is not supported. Please export brushes as ABR v2 from Photoshop (Edit > Preset Manager).');}
    if(version!==1&&version!==2){throw new Error(`Unknown ABR version ${version}. Only ABR v1 and v2 are supported.`);}
    const count=view.getUint16(2);let offset=4;
    const results:CustomBrush[]=[];
    for(let i=0;i<count&&offset<buf.byteLength-4;i++){
      const type=view.getUint16(offset);offset+=2;
      const bsize=view.getUint32(offset);offset+=4;
      const end=offset+bsize;
      if(type===2){// sampled
        offset+=4;// misc
        const spacing=view.getUint16(offset);offset+=2;
        // pascal string name
        const namelen=view.getUint8(offset);offset+=1;
        let nm='';for(let c=0;c<namelen;c++)nm+=String.fromCharCode(view.getUint8(offset++));
        if(namelen%2===0)offset++;// pad
        offset+=2;// antialiasing
        const top=view.getInt16(offset);const left=view.getInt16(offset+2);const bottom=view.getInt16(offset+4);const right=view.getInt16(offset+6);offset+=8;
        const depth=view.getUint16(offset);offset+=2;
        const W=right-left,H=bottom-top;
        if(W>0&&H>0&&depth===8){
          const rowLen=Math.floor((W+7)/8)*8/8;// bytes per row
          const pixBuf=new Uint8Array(W*H);
          for(let row=0;row<H;row++){for(let col=0;col<W;col++){const idx=offset+row*rowLen+col;if(idx<buf.byteLength)pixBuf[row*W+col]=view.getUint8(idx);}}
          const MS=128,cnv=document.createElement('canvas');cnv.width=W;cnv.height=H;
          const ctx=cnv.getContext('2d')!;const id=ctx.createImageData(W,H);
          for(let p=0;p<W*H;p++){id.data[p*4]=id.data[p*4+1]=id.data[p*4+2]=0;id.data[p*4+3]=pixBuf[p];}
          ctx.putImageData(id,0,0);
          const cnv2=document.createElement('canvas');cnv2.width=MS;cnv2.height=MS;
          cnv2.getContext('2d')!.drawImage(cnv,0,0,MS,MS);
          const d2=cnv2.getContext('2d')!.getImageData(0,0,MS,MS).data;
          const mask=new Float32Array(MS*MS);
          for(let p=0;p<MS*MS;p++)mask[p]=d2[p*4+3]/255;
          results.push({id:crypto.randomUUID(),name:nm||`Brush ${i+1}`,mask,spacing:Math.max(0.05,spacing/1000),source:'photoshop'});
        }
      }
      offset=end;
    }
    if(results.length===0)throw new Error('No sampled brushes found in the ABR file.');
    return results;
  },[]);

  const handleBrushImport=useCallback(async(file:File)=>{
    setBrushImportLoading(true);setBrushImportError('');
    try{
      let imported:CustomBrush[]=[];
      const name=file.name.toLowerCase();
      if(name.endsWith('.brush')||name.endsWith('.brushset'))imported=await parseProcreate(file);
      else if(name.endsWith('.abr'))imported=await parseAbr(file);
      else throw new Error('Unsupported format. Please use .brush, .brushset (Procreate) or .abr v1/v2 (Photoshop).');
      const next=[...customBrushesRef.current,...imported];
      setCustomBrushes(next);customBrushesRef.current=next;
      // Persist metadata (not the Float32Array since localStorage is limited)
      try{localStorage.setItem('mepaint-custom-brushes-v1',JSON.stringify(next.map(b=>({id:b.id,name:b.name,spacing:b.spacing,source:b.source}))));}catch{}
      setBrushLibTab('imported');
    }catch(err){setBrushImportError(String(err).replace('Error:','').trim());}
    finally{setBrushImportLoading(false);}
  },[parseProcreate,parseAbr]);



  // ── RAF flush — composites all visible layers into the canvas dirty rect
  const flushCanvas=useCallback(()=>{
    rafRef.current=null;
    const d=dirtyRef.current;if(d.x1>=d.x2||d.y1>=d.y2) return;
    const canvas=canvasRef.current;if(!canvas) return;
    const W=canvas.width,H=canvas.height;
    const x1=Math.max(0,Math.floor(d.x1)),y1=Math.max(0,Math.floor(d.y1));
    const x2=Math.min(W,Math.ceil(d.x2)),y2=Math.min(H,Math.ceil(d.y2));
    const rw=x2-x1,rh=y2-y1;if(rw<=0||rh<=0) return;
    const llist=layersRef.current;
    // Paper bg colour
    const surf=SURFACES.find(s=>s.type===surfaceRef.current)!;
    const pp=surf.paper;
    const comp=new Uint8ClampedArray(rw*rh*4);
    for(let i=0;i<rw*rh;i++){comp[i*4]=pp[0];comp[i*4+1]=pp[1];comp[i*4+2]=pp[2];comp[i*4+3]=255;}
    // Alpha-over composite each visible layer (with blend mode support)
    for(let li=0;li<llist.length;li++){
      const layer=llist[li];if(!layer.visible||!layer.buf) continue;
      const la=layer.opacity/100;
      const bm=layer.blendMode||'normal';
      for(let row=0;row<rh;row++){
        for(let col=0;col<rw;col++){
          const si=((y1+row)*W+(x1+col))*4;
          const di=(row*rw+col)*4;
          const pa=(layer.buf[si+3]/255)*la;
          if(pa<0.002) continue;
          if(bm==='normal'){
            comp[di]  =(comp[di]  *(1-pa)+layer.buf[si]  *pa)|0;
            comp[di+1]=(comp[di+1]*(1-pa)+layer.buf[si+1]*pa)|0;
            comp[di+2]=(comp[di+2]*(1-pa)+layer.buf[si+2]*pa)|0;
          } else {
            const [br,bg,bb]=applyBlend(bm,comp[di]/255,comp[di+1]/255,comp[di+2]/255,layer.buf[si]/255,layer.buf[si+1]/255,layer.buf[si+2]/255);
            comp[di]  =(comp[di]  *(1-pa)+br*255*pa)|0;
            comp[di+1]=(comp[di+1]*(1-pa)+bg*255*pa)|0;
            comp[di+2]=(comp[di+2]*(1-pa)+bb*255*pa)|0;
          }
        }
      }
    }
    canvas.getContext('2d')!.putImageData(new ImageData(comp,rw,rh),x1,y1);
    d.x1=Infinity;d.y1=Infinity;d.x2=-Infinity;d.y2=-Infinity;
  },[]);
  const scheduleFlush=useCallback(()=>{if(rafRef.current!==null) return;rafRef.current=requestAnimationFrame(flushCanvas);},[flushCanvas]);

  // ── Center canvas in container (defined early — referenced in useEffect below)
  const centerCanvas=useCallback((zoom_=1)=>{
    const con=containerRef.current,cnv=canvasRef.current;if(!con||!cnv) return;
    const cw=con.offsetWidth,ch=con.offsetHeight;
    const canW=cnv.offsetWidth,canH=cnv.offsetHeight;
    setPan({x:(cw-canW*zoom_)/2,y:(ch-canH*zoom_)/2});
  },[]);

  // ── Canvas init — creates background layer
  const initCanvasBuffer=useCallback((canvas:HTMLCanvasElement,W:number,H:number)=>{
    const paper=SURFACES.find(s=>s.type===surfaceRef.current)!.paper;
    const pc=canvas.width*canvas.height;const buf=new Uint8ClampedArray(pc*4);
    for(let i=0;i<pc;i++){const g=(Math.random()-.5)*8;buf[i*4]=Math.max(0,Math.min(255,paper[0]+g))|0;buf[i*4+1]=Math.max(0,Math.min(255,paper[1]+g*.82))|0;buf[i*4+2]=Math.max(0,Math.min(255,paper[2]+g*.65))|0;buf[i*4+3]=255;}
    const bg:Layer={id:crypto.randomUUID(),name:'Background',opacity:100,visible:true,locked:false,blendMode:'normal',buf};
    layersRef.current=[bg];activeLayerIdxRef.current=0;
    _setLayersUI([bg]);_setActiveIdxUI(0);
    pixelBufRef.current=buf;
    undoSnapshots.current=[];
    const ctx=canvas.getContext('2d')!;ctx.putImageData(new ImageData(buf,canvas.width,canvas.height),0,0);
    setCanvasW(W);setCanvasH(H);
  },[]);

  // ── Init canvas with a specific pixel size (called from startup picker + resize modal)
  const initWithSize=useCallback((W:number,H:number)=>{
    const canvas=canvasRef.current;if(!canvas) return;
    const ratio=window.devicePixelRatio||1;
    canvas.width=W*ratio;canvas.height=H*ratio;
    canvas.style.width=W+'px';canvas.style.height=H+'px';
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    ctx.setTransform(ratio,0,0,ratio,0,0);
    initCanvasBuffer(canvas,W,H);
    canvasInitDone.current=true;
    requestAnimationFrame(()=>centerCanvas(1));
  },[initCanvasBuffer,centerCanvas]);

  useEffect(()=>{
    // Only re-center on window resize; canvas init is deferred until user picks a size
    const onResize=()=>{if(canvasInitDone.current)requestAnimationFrame(()=>centerCanvas(vpRef.current.zoom));};
    window.addEventListener('resize',onResize);return()=>window.removeEventListener('resize',onResize);
  },[centerCanvas]);

  // ── Canvas size change — flattens layers then resizes
  const changeCanvasSize=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas) return;
    const ratio=window.devicePixelRatio||1;
    const physW=csW*ratio,physH=csH*ratio;
    // Snapshot composited canvas first
    const tmp=document.createElement('canvas');tmp.width=canvas.width;tmp.height=canvas.height;
    tmp.getContext('2d')!.drawImage(canvas,0,0);
    canvas.width=physW;canvas.height=physH;canvas.style.width=csW+'px';canvas.style.height=csH+'px';
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    const paper=SURFACES.find(s=>s.type===surfaceRef.current)!.paper;
    ctx.fillStyle=`rgb(${paper.join(',')})`;ctx.fillRect(0,0,physW,physH);
    if(csMode==='scale'){ctx.drawImage(tmp,0,0,physW,physH);}
    else{const ox=Math.floor((physW-tmp.width)/2),oy=Math.floor((physH-tmp.height)/2);ctx.drawImage(tmp,ox,oy);}
    const newBuf=new Uint8ClampedArray(physW*physH*4);
    newBuf.set(ctx.getImageData(0,0,physW,physH).data);
    // Reset to single background layer with new content
    const bg:Layer={id:crypto.randomUUID(),name:'Background',opacity:100,visible:true,locked:false,blendMode:'normal',buf:newBuf};
    layersRef.current=[bg];activeLayerIdxRef.current=0;
    _setLayersUI([bg]);_setActiveIdxUI(0);
    pixelBufRef.current=newBuf;
    undoSnapshots.current=[];
    setCanvasW(csW);setCanvasH(csH);setShowCanvasSize(false);
    setZoom(1);requestAnimationFrame(()=>centerCanvas(1));
  },[csW,csH,csMode,centerCanvas]);

  // ── Startup size confirm
  const confirmStartupSize=useCallback(()=>{
    setCsW(spW);setCsH(spH);
    setShowStartupPicker(false);
    setTimeout(()=>initWithSize(spW,spH),60);
  },[spW,spH,initWithSize]);

  // ── Room from URL
  useEffect(()=>{const p=new URLSearchParams(window.location.search);const rid=p.get('room');if(rid){setRoomId(rid);isHost.current=false;}},[]);

  // ── Brush
  const generateMask=useCallback((type:BrushType):Float32Array=>{
    const MS=128,mask=new Float32Array(MS*MS),cx=MS/2;
    // Deterministic hash noise for organic variation (avoids Math.random for reproducibility)
    const hash=(a:number,b:number)=>{let h=(a*2654435761^b*2246822519)&0x7fffffff;h=((h>>16)^h)*0x45d9f3b;h=((h>>16)^h)*0x45d9f3b;return((h>>16)^h&0x7fffffff)/0x7fffffff;};
    const fbm=(px:number,py:number,oct:number,freq:number)=>{let v=0,amp=1,f=freq,t=0;for(let o=0;o<oct;o++){const ix=Math.floor(px*f),iy=Math.floor(py*f),fx=px*f-ix,fy=py*f-iy;const c00=hash(ix,iy),c10=hash(ix+1,iy),c01=hash(ix,iy+1),c11=hash(ix+1,iy+1);const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);v+=amp*((c00*(1-sx)+c10*sx)*(1-sy)+(c01*(1-sx)+c11*sx)*sy);t+=amp;amp*=.5;f*=2;}return v/t;};
    for(let y=0;y<MS;y++) for(let x=0;x<MS;x++){
      const dx=x-cx,dy=y-cx,dist=Math.sqrt(dx*dx+dy*dy),nd=dist/cx;
      const ang=Math.atan2(dy,dx);
      const h1=hash(x,y),h2=hash(x+137,y+241),h3=hash(x*3+7,y*5+13);
      let a=0;
      switch(type){
        case 'soft-round':{
          // Gentle Gaussian with micro-grain at the edges for a painterly feel
          const base=Math.exp(-4.2*nd*nd);
          const grain=.93+h1*.14; // subtle per-pixel grain
          a=base*grain;
          // Soften outer fringe
          if(nd>.6) a*=1-(.08*h2*(nd-.6)/.4);
        }break;
        case 'flat':{
          // Flat brush — rectangular, slight bristle lines across width, paint loading variation
          const ndx=dx/cx,ndy=dy/cx,ar=2.2;
          if(Math.abs(ndx)<ar&&Math.abs(ndy)<.95){
            const ed=Math.max(Math.abs(ndx)/ar,Math.abs(ndy)/.95);
            const base=ed<.82?1:Math.max(0,1-(ed-.82)/.18);
            // Bristle streaks along the long axis
            const streak=.75+.25*(.5+.5*Math.sin(ndy*42+h3*6.28));
            // Paint loading — slightly uneven coverage
            const load=.85+.15*fbm(x,y,2,.08);
            a=base*streak*load;
          }
        }break;
        case 'bristle':{
          // Realistic bristle brush — individual hair strands radiating from center
          if(nd<1.2){
            const nBristles=22;
            const bristleAng=ang*nBristles/(2*Math.PI);
            const bi=Math.floor(bristleAng);
            const bf=bristleAng-bi;
            // Per-bristle random offset and thickness
            const bh1=hash(bi,100),bh2=hash(bi,200),bh3=hash(bi,300);
            const thickness=.3+bh1*.7; // bristle varies 0.3-1.0
            const lengthVar=.7+bh2*.55; // each bristle has different length
            const wobble=bh3*.15; // slight angular wobble
            // Distance check with per-bristle length
            const bndist=nd/lengthVar;
            // Cross-section (how close to bristle centerline)
            const cross=Math.abs(bf-.5)*2; // 0=center, 1=edge
            const inBristle=cross<thickness;
            if(inBristle&&bndist<1.0){
              const radial=bndist<.3?1:bndist<.85?1-(bndist-.3)*.15/.55:Math.max(0,1-(bndist-.85)/.15);
              const grain=.7+.3*hash(x+bi*17,y+bi*31);
              a=radial*grain;
            }
            // Fill the inner core more solidly
            if(nd<.25){const core=1-nd/.25*.2;a=Math.max(a,core*(.8+.2*h1));}
          }
        }break;
        case 'watercolor':{
          // Wet-edge watercolor — organic puddle shape with concentration at edges
          const warp1=fbm(x,y,3,.03)-.5,warp2=fbm(x+99,y+77,3,.03)-.5;
          const warped=Math.sqrt((dx+warp1*28)**2+(dy+warp2*28)**2)/cx;
          if(warped<1.05){
            // Wet edge: higher opacity at rim, lower in center
            const inner=warped<.7?.04+warped/.7*.06:.10;
            const edge=warped>.75&&warped<1.05?Math.max(0,(1-(warped-.75)/.3))*.25:0;
            const grain=.7+.3*h1;
            a=(inner+edge)*grain;
            // Random bleed spots
            if(h2>.88&&warped<.9) a+=.08;
          }
        }break;
        case 'thick-paint':{
          // Impasto thick paint — textured surface, paint ridges
          const edgeWobble=Math.sin(ang*9+1.3)*.06+Math.sin(ang*17)*.03;
          const radius=.92+edgeWobble;
          if(nd<radius+.12){
            const base=nd<radius?1:Math.max(0,1-(nd-radius)/.12);
            // Impasto texture — simulates thick paint ridges
            const ridge=.8+.2*(.5+.5*Math.sin(dx*.28+.5))*(.5+.5*Math.cos(dy*.24+.7));
            const micro=.9+.1*h1;
            a=base*ridge*micro;
          }
        }break;
        case 'eraser':{
          // Hard eraser fallback (eraser mode uses current brush instead)
          a=nd<.93?1:nd<1?Math.max(0,(1-nd)/.07):0;
        }break;
        case 'pencil':{
          // Graphite pencil — directional grain, core/halo, pressure-like density
          const falloff=Math.exp(-7*nd*nd);
          // Graphite grain — directional (simulates paper tooth + pencil angle)
          const g1=Math.sin(x*12.7+y*3.8)*.5+.5;
          const g2=Math.cos(x*5.3-y*14.1)*.5+.5;
          const g3=Math.sin((x+y)*8.5)*.5+.5;
          const grain=g1*.35+g2*.35+g3*.3;
          // Core (darker center) vs halo (lighter rim)
          const core=nd<.15?1:nd<.4?.9:nd<.7?.6+.25*grain:.35*grain;
          a=falloff*core*(.5+grain*.5);
        }break;
        case 'chalk':{
          // Chalk / pastel — heavy breakup, paper tooth interaction, crumbly edges
          if(nd<1.08){
            const falloff=Math.max(0,1-nd*1.0);
            // Paper tooth — multi-scale noise simulates rough surface
            const tooth=fbm(x,y,3,.12);
            // Chalk only catches on raised paper grain
            const catch_=tooth>.35?((tooth-.35)/.65):.0;
            // Large-scale breakup
            const breakup=fbm(x+500,y+500,2,.04)>.3?1:.0;
            // Edge crumble
            const edgeCrumble=nd>.7?(.6+.4*h1):1;
            a=falloff*catch_*breakup*edgeCrumble;
            a=Math.min(1,a*1.4); // boost to compensate for breakup
          }
        }break;
        case 'marker':{
          // Alcohol marker — rectangular with slight bleed, ink saturation
          const ndx=dx/cx,ndy=dy/cx,ar=1.5;
          if(Math.abs(ndx)<ar+.1&&Math.abs(ndy)<.55){
            const edx=Math.abs(ndx)/ar,edy=Math.abs(ndy)/.5;
            const ed=Math.max(edx,edy);
            // Soft bleed at edges
            const base=ed<.78?.92:ed<1.05?Math.max(0,(1.05-ed)/.27)*.92:0;
            // Ink saturation — slightly uneven
            const sat=.88+.12*(.5+.5*Math.sin(x*.6)*Math.cos(y*.7));
            a=base*sat;
          }
        }break;
        case 'ink':{
          // Ink pen — crisp with very slight organic edge wobble and ink pooling
          const edgeWobble=Math.sin(ang*23+2.1)*.025+Math.sin(ang*11)*.018+h1*.012;
          const r=.86+edgeWobble;
          if(nd<r+.06){
            a=nd<r?1:Math.max(0,1-(nd-r)/.06);
            // Slight ink density variation
            a*=.94+.06*h2;
          }
        }break;
        case 'charcoal':{
          // Charcoal — broad, crumbly, heavy breakup with directional streaks
          if(nd<1.15){
            const falloff=Math.max(0,1-nd*.92);
            // Directional streaks (simulates charcoal stick dragged in one direction)
            const streak1=.5+.5*Math.sin(y*.35+x*.08);
            const streak2=.5+.5*Math.sin(y*.7-x*.15+1.7);
            const streak=streak1*.6+streak2*.4;
            // Crumbly noise — charcoal breaks up on paper texture
            const crumble=fbm(x,y,3,.09);
            const keep=crumble>.25?((crumble-.25)/.75):0;
            // Combine
            a=falloff*(.15+streak*.55)*keep;
            a=Math.min(1,a*1.6);
            // Random dark specks
            if(h3>.92&&nd<.8) a=Math.min(1,a+.3);
          }
        }break;
        case 'sponge':{
          // Natural sponge — irregular pore pattern, organic cellular structure
          if(nd<1.02){
            const falloff=Math.max(0,1-nd*1.05);
            // Voronoi-like pore pattern using multi-frequency noise
            const cell1=fbm(x,y,2,.05);
            const cell2=fbm(x+200,y+200,2,.09);
            const pore=cell1>.45&&cell2>.35?1:0;
            // Vary pore density with distance from center
            const density=nd<.7?pore:pore*(h1>.3?1:0);
            const grain=.6+.4*h2;
            a=falloff*density*grain;
          }
        }break;
        case 'fan':{
          // Fan brush — spread tines with irregular gaps
          if(nd>.04&&nd<1.02){
            const falloff=Math.max(0,1-nd*1.02);
            const nTines=9;
            const tineAng=ang*nTines/(Math.PI); // fan covers ~180 degrees
            const ti=Math.floor(tineAng);
            const tf=tineAng-ti;
            const th=hash(ti,42);
            const tWidth=.28+th*.25; // varied tine width
            const inTine=Math.abs(tf-.5)<tWidth*.5;
            if(inTine){
              const spread=.6+.4*hash(ti,99);
              a=falloff*spread*(.7+.3*h1);
            }
          }
        }break;
        case 'gouache':{
          // Gouache — opaque, flat, slight edge buildup and brush marks
          const edgeWobble=Math.sin(ang*8+.3)*.04+Math.sin(ang*13+1.7)*.025;
          const r=.90+edgeWobble;
          if(nd<r+.1){
            const base=nd<r?1:Math.max(0,1-(nd-r)/.1);
            // Slight brush direction marks
            const mark=.92+.08*(.5+.5*Math.sin(dx*.18+dy*.06));
            // Edge buildup (paint accumulates at edge of stroke)
            const buildup=nd>r-.08&&nd<r?.08:0;
            a=(base+buildup)*mark;
          }
        }break;
      }
      mask[y*MS+x]=Math.max(0,Math.min(1,a));
    }
    return mask;
  },[]);

  const stamp=useCallback((x:number,y:number,settings:StampSettings,localSmudge?:number[]|null)=>{
    if(!canvasRef.current) return;
    // Determine target layer — remote strokes may specify a layer index
    const targetIdx=settings.layerIdx!==undefined?Math.max(0,Math.min(settings.layerIdx,layersRef.current.length-1)):activeLayerIdxRef.current;
    const curLayer=layersRef.current[targetIdx];
    if(!curLayer||curLayer.locked||!curLayer.buf) return;
    const canvas=canvasRef.current,ratio=window.devicePixelRatio||1,buf=curLayer.buf;
    const W=canvas.width,H=canvas.height;
    const{brushType:bt,brushSize:bs,color:col,opacity:op}=settings;
    const sx=Math.floor(x*ratio),sy=Math.floor(y*ratio),radius=Math.max(1,Math.floor(bs*ratio/2));
    const bx1=Math.max(0,sx-radius),by1=Math.max(0,sy-radius),bx2=Math.min(W,sx+radius),by2=Math.min(H,sy+radius);
    if(bx2<=bx1||by2<=by1) return;
    dirtyRef.current.x1=Math.min(dirtyRef.current.x1,bx1);dirtyRef.current.y1=Math.min(dirtyRef.current.y1,by1);
    dirtyRef.current.x2=Math.max(dirtyRef.current.x2,bx2);dirtyRef.current.y2=Math.max(dirtyRef.current.y2,by2);
    const cb=selectedCustomRef.current;
    const maskKey=cb?`custom:${cb.id}`:bt;
    let mask=brushMasks.current.get(maskKey);
    if(!mask){mask=cb?cb.mask:generateMask(bt);brushMasks.current.set(maskKey,mask);}
    const MS=128,eff=op/100,isWc=bt==='watercolor';
    const isErasing=settings.eraser!==undefined?settings.eraser:(eraserModeRef.current||bt==='eraser');
    const surf=SURFACES.find(s=>s.type===surfaceRef.current)!;
    // Eraser now gets surface texture too (textured erase with chalk/bristle etc.)
    const texStr=bt==='thick-paint'?surf.texStrength*.35:surf.texStrength;
    const texBuf=SURFACE_TEXTURES[surfaceRef.current];
    const paper=surf.paper;
    const isBackground=targetIdx===0;
    for(let py=by1;py<by2;py++) for(let px=bx1;px<bx2;px++){
      const dx=px-sx,dy=py-sy;
      const mx=Math.floor((dx/radius+1)*MS/2),my=Math.floor((dy/radius+1)*MS/2);
      if(mx<0||mx>=MS||my<0||my>=MS) continue;
      let ma=mask[my*MS+mx];if(ma<.004) continue;
      if(isWc)ma*=.9+Math.random()*.2;
      if(texStr>0){const tv=texBuf[(py%SURFACE_H)*SURFACE_W+(px%SURFACE_W)];ma*=1-texStr*(1-tv);}
      const pi=(py*W+px)*4;
      if(lassoMaskRef.current&&!lassoMaskRef.current[py*W+px]) continue;
      const cc=[buf[pi],buf[pi+1],buf[pi+2]];
      const dst_a=buf[pi+3]/255;
      const ea=eff*ma;
      let nc:number[];
      if(isErasing){
        // Erase using the current brush's mask shape/texture
        if(isBackground){
          const g=(Math.random()-.5)*4;
          const bg=[paper[0]+g|0,paper[1]+g*.82|0,paper[2]+g*.65|0];
          nc=[cc[0]*(1-ea)+bg[0]*ea,cc[1]*(1-ea)+bg[1]*ea,cc[2]*(1-ea)+bg[2]*ea];
          buf[pi+3]=255;
        } else {
          buf[pi+3]=Math.max(0,buf[pi+3]-(ea*255))|0;
          nc=cc;
        }
      } else if(localSmudge!==undefined){
        if(localSmudge){ds.current.smudgeColor=smudgeMix(ds.current.smudgeColor||cc,cc,.22);nc=smudgeMix(cc,ds.current.smudgeColor!,Math.min(1,ea*1.2));}else nc=cc;
        if(!isBackground){const na=ea+dst_a*(1-ea);buf[pi+3]=Math.min(255,na*255)|0;}
      } else {
        if(!isBackground&&dst_a<0.01){nc=[col[0],col[1],col[2]];}else{nc=pigmentMix(cc,col,ea);}
        if(!isBackground){const na=ea+dst_a*(1-ea);buf[pi+3]=Math.min(255,na*255)|0;}
      }
      buf[pi]=Math.max(0,Math.min(255,nc[0]))|0;buf[pi+1]=Math.max(0,Math.min(255,nc[1]))|0;buf[pi+2]=Math.max(0,Math.min(255,nc[2]))|0;
    }
    isDirtyRef.current=true;scheduleFlush();
  },[generateMask,scheduleFlush]);

  const interpolate=useCallback((x1:number,y1:number,x2:number,y2:number,settings:StampSettings,isLocal=true)=>{
    const dx=x2-x1,dy=y2-y1,dist=Math.sqrt(dx*dx+dy*dy);
    const adv=brushAdvancedRef.current[settings.brushType];
    const spacing=Math.max(settings.brushSize*BRUSH_SPACING[settings.brushType]*(isLocal?(adv?.spacingMult??1):1),.5);
    const steps=Math.ceil(dist/spacing),pressure=isLocal?ds.current.pressure:1.0;
    // Power curve gives natural tablet feel — more sensitivity in mid-range
    const pc=Math.pow(Math.max(0,Math.min(1,pressure)),0.55);
    // Handle zero-length strokes (single tap / initial stamp) for remote users
    if(steps===0&&!isLocal){stamp(x1,y1,settings,undefined);return;}
    for(let i=1;i<=steps;i++){
      const t=i/steps,sx=x1+dx*t,sy=y1+dy*t;
      if(isLocal){
        const sJ=1+(Math.random()-.5)*(adv?.sizeJitter??0)*.02,oJ=1+(Math.random()-.5)*(adv?.opacityJitter??0)*.02;
        const eff:StampSettings={...settings,brushSize:settings.brushSize*(0.06+pc*0.94)*Math.max(.1,sJ),opacity:settings.opacity*(0.04+pc*0.96)*Math.max(.05,oJ)};
        stamp(sx,sy,eff,smudgeMode?ds.current.smudgeColor:undefined);
        const canvas=canvasRef.current;
        if(canvas){const CW=canvas.offsetWidth,CH=canvas.offsetHeight;if(symmetry==='vertical'||symmetry==='both')stamp(CW-sx,sy,eff);if(symmetry==='horizontal'||symmetry==='both')stamp(sx,CH-sy,eff);if(symmetry==='both')stamp(CW-sx,CH-sy,eff);}
      }else{stamp(sx,sy,settings,undefined);}
    }
  },[stamp,smudgeMode,symmetry]);

  const toCanvas=useCallback((clientX:number,clientY:number)=>{
    const canvas=canvasRef.current;if(!canvas) return{x:0,y:0};
    const rect=canvas.getBoundingClientRect();
    // Derive scale from DOM directly — avoids stale vpRef.zoom on HiDPI screens.
    const scaleX=rect.width/canvas.offsetWidth||1;
    const scaleY=rect.height/canvas.offsetHeight||1;
    let x=(clientX-rect.left)/scaleX,y=(clientY-rect.top)/scaleY;
    if(flipHRef.current)x=canvas.offsetWidth-x;
    if(flipVRef.current)y=canvas.offsetHeight-y;
    return{x,y};
  },[]);

  const zoomAt=useCallback((cx:number,cy:number,delta:number)=>{
    const container=containerRef.current;if(!container) return;
    const rect=container.getBoundingClientRect(),lcx=cx-rect.left,lcy=cy-rect.top;
    const vp=vpRef.current,nz=Math.max(.1,Math.min(12,vp.zoom*delta));
    setZoom(nz);setPan({x:lcx-(lcx-vp.panX)*(nz/vp.zoom),y:lcy-(lcy-vp.panY)*(nz/vp.zoom)});
  },[]);
  const resetZoom=useCallback(()=>{setZoom(1);centerCanvas(1);},[centerCanvas]);

  // ── Drag the canvas panel itself (moves pan, not a separate window position)
  const startCanvasDrag=useCallback((e:React.MouseEvent)=>{
    const tgt=e.target as HTMLElement;if(tgt?.closest('button,input,a,select')) return;
    e.preventDefault();
    const startMX=e.clientX,startMY=e.clientY;
    const startPX=vpRef.current.panX,startPY=vpRef.current.panY;
    const onMove=(ev:MouseEvent)=>setPan({x:startPX+ev.clientX-startMX,y:startPY+ev.clientY-startMY});
    const onUp=()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);};
    window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);
  },[]);

  const saveUndo=useCallback(()=>{
    const snap:UndoSnapshot={
      bufs:layersRef.current.map(l=>l.buf?new Uint8ClampedArray(l.buf):null),
      meta:layersRef.current.map(({id,name,opacity,visible,locked,blendMode})=>({id,name,opacity,visible,locked,blendMode:blendMode||'normal'})),
      activeIdx:activeLayerIdxRef.current,
    };
    undoSnapshots.current.push(snap);
    if(undoSnapshots.current.length>maxUndo)undoSnapshots.current.shift();
  },[]);
  const handleUndo=useCallback(()=>{
    if(!undoSnapshots.current.length||!canvasRef.current) return;
    const snap=undoSnapshots.current.pop()!;
    const restored:Layer[]=snap.meta.map((m,i)=>({...m,buf:snap.bufs[i]}));
    layersRef.current=restored;
    activeLayerIdxRef.current=snap.activeIdx;
    pixelBufRef.current=restored[snap.activeIdx]?.buf??null;
    _setLayersUI(restored);_setActiveIdxUI(snap.activeIdx);
    const canvas=canvasRef.current;
    dirtyRef.current={x1:0,y1:0,x2:canvas.width,y2:canvas.height};
    scheduleFlush();
  },[scheduleFlush]);
  const handleClear=useCallback(()=>{
    if(!clearConfirm){setClearConfirm(true);setTimeout(()=>setClearConfirm(false),3000);return;}
    saveUndo();const canvas=canvasRef.current;if(!canvas||!pixelBufRef.current) return;
    const buf=pixelBufRef.current;
    const isBackground=activeLayerIdxRef.current===0;
    if(isBackground){
      const paper=SURFACES.find(s=>s.type===surfaceRef.current)!.paper;
      const pc=canvas.width*canvas.height;
      for(let i=0;i<pc;i++){const g=(Math.random()-.5)*10;buf[i*4]=Math.max(0,Math.min(255,paper[0]+g))|0;buf[i*4+1]=Math.max(0,Math.min(255,paper[1]+g*.82))|0;buf[i*4+2]=Math.max(0,Math.min(255,paper[2]+g*.65))|0;buf[i*4+3]=255;}
    } else {
      // Clear upper layer to transparent
      buf.fill(0);
    }
    setClearConfirm(false);isDirtyRef.current=true;
    dirtyRef.current={x1:0,y1:0,x2:canvas.width,y2:canvas.height};
    scheduleFlush();
  },[clearConfirm,saveUndo,scheduleFlush]);
  const handleSave=useCallback(()=>{const canvas=canvasRef.current;if(!canvas) return;const a=document.createElement('a');a.download=`mepaint-${Date.now()}.png`;a.href=canvas.toDataURL('image/png');a.click();},[]);
  const loadCanvasFromUrl=useCallback((dataUrl:string,cb?:()=>void)=>{
    const canvas=canvasRef.current;if(!canvas) return;
    const img=new Image();
    img.onload=()=>{
      const ctx=canvas.getContext('2d')!;
      ctx.setTransform(1,0,0,1,0,0);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const d=ctx.getImageData(0,0,canvas.width,canvas.height);
      const ratio=window.devicePixelRatio||1;
      ctx.setTransform(ratio,0,0,ratio,0,0);
      // Load into background layer only
      const bg=layersRef.current[0];
      if(bg?.buf){bg.buf.set(d.data);}
      else{const newBuf=new Uint8ClampedArray(d.data);const newBg:Layer={id:crypto.randomUUID(),name:'Background',opacity:100,visible:true,locked:false,blendMode:'normal',buf:newBuf};layersRef.current=[newBg];_setLayersUI([newBg]);_setActiveIdxUI(0);pixelBufRef.current=newBuf;}
      if(activeLayerIdxRef.current===0)pixelBufRef.current=layersRef.current[0].buf;
      dirtyRef.current={x1:0,y1:0,x2:canvas.width,y2:canvas.height};
      scheduleFlush();cb?.();
    };img.src=dataUrl;
  },[scheduleFlush]);

  // ── Animation
  const updateOnionSkin=useCallback((frameIdx:number)=>{
    const onionCanvas=onionCanvasRef.current,mainCanvas=canvasRef.current;if(!onionCanvas||!mainCanvas) return;
    onionCanvas.width=mainCanvas.width;onionCanvas.height=mainCanvas.height;
    onionCanvas.style.width=mainCanvas.style.width;onionCanvas.style.height=mainCanvas.style.height;
    const ctx=onionCanvas.getContext('2d')!;ctx.clearRect(0,0,onionCanvas.width,onionCanvas.height);
    if(!showOnionRef.current||frameIdx===0||animFramesRef.current.length===0) return;
    const prevUrl=animFramesRef.current[frameIdx-1];if(!prevUrl) return;
    const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,onionCanvas.width,onionCanvas.height);img.src=prevUrl;
  },[]);
  const saveCurrentAnimFrame=useCallback(()=>{const canvas=canvasRef.current;if(!canvas) return;animFramesRef.current[animFrameRef.current]=canvas.toDataURL('image/jpeg',.88);},[]);
  const loadAnimFrame=useCallback((idx:number)=>{
    const frames=animFramesRef.current;if(idx<0||idx>=frames.length) return;
    loadCanvasFromUrl(frames[idx],()=>updateOnionSkin(idx));
    animFrameRef.current=idx;setAnimFrame(idx);setAnimFrames([...frames]);
  },[loadCanvasFromUrl,updateOnionSkin]);
  const stopPlayback=useCallback(()=>{if(animPlayRef.current){clearInterval(animPlayRef.current);animPlayRef.current=null;}setAnimPlaying(false);},[]);
  const startPlayback=useCallback(()=>{
    saveCurrentAnimFrame();setAnimPlaying(true);let f=animFrameRef.current;
    animPlayRef.current=setInterval(()=>{f=(f+1)%animFramesRef.current.length;loadAnimFrame(f);},1000/animFpsRef.current);
  },[saveCurrentAnimFrame,loadAnimFrame]);
  const addAnimFrame=useCallback((duplicate=false)=>{
    stopPlayback();saveCurrentAnimFrame();const canvas=canvasRef.current;if(!canvas) return;
    let newData:string;
    if(duplicate){newData=animFramesRef.current[animFrameRef.current];}
    else{const tmp=document.createElement('canvas');tmp.width=canvas.width;tmp.height=canvas.height;const ctx=tmp.getContext('2d')!;const p=SURFACES.find(s=>s.type===surfaceRef.current)!.paper;ctx.fillStyle=`rgb(${p.join(',')})`;ctx.fillRect(0,0,tmp.width,tmp.height);newData=tmp.toDataURL('image/jpeg',.88);}
    const newIdx=animFrameRef.current+1;animFramesRef.current.splice(newIdx,0,newData);loadAnimFrame(newIdx);
  },[stopPlayback,saveCurrentAnimFrame,loadAnimFrame]);
  const deleteAnimFrame=useCallback((idx:number)=>{
    if(animFramesRef.current.length<=1) return;stopPlayback();saveCurrentAnimFrame();
    animFramesRef.current.splice(idx,1);loadAnimFrame(Math.min(idx,animFramesRef.current.length-1));
  },[stopPlayback,saveCurrentAnimFrame,loadAnimFrame]);
  // ── Layer operations ──────────────────────────────────────────────────────────
  const fullRepaint=useCallback(()=>{
    const c=canvasRef.current;if(!c) return;
    dirtyRef.current={x1:0,y1:0,x2:c.width,y2:c.height};scheduleFlush();
  },[scheduleFlush]);

  const generateThumb=useCallback((layer:Layer):string=>{
    if(!layer.buf||!canvasRef.current) return '';
    const W=canvasRef.current.width,H=canvasRef.current.height;
    const tw=54,th=Math.max(1,Math.round(54*H/Math.max(1,W)));
    const tc=document.createElement('canvas');tc.width=tw;tc.height=th;
    const tctx=tc.getContext('2d')!;
    for(let cy=0;cy<th;cy+=4) for(let cx2=0;cx2<tw;cx2+=4){tctx.fillStyle=((cx2/4+cy/4)%2===0)?'#bbb':'#eee';tctx.fillRect(cx2,cy,4,4);}
    const sc=document.createElement('canvas');sc.width=W;sc.height=H;
    sc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(layer.buf),W,H),0,0);
    tctx.drawImage(sc,0,0,tw,th);
    return tc.toDataURL('image/jpeg',.6);
  },[]);

  const scheduleThumbUpdate=useCallback(()=>{
    if(thumbTimerRef.current)clearTimeout(thumbTimerRef.current);
    thumbTimerRef.current=setTimeout(()=>{
      const thumbs:Record<string,string>={};
      layersRef.current.forEach(l=>{thumbs[l.id]=generateThumb(l);});
      setLayerThumbs(thumbs);
    },350);
  },[generateThumb]);

  const addLayer=useCallback(()=>{
    const c=canvasRef.current;if(!c) return;
    const buf=new Uint8ClampedArray(c.width*c.height*4);
    const n=layersRef.current.length;
    const newL:Layer={id:crypto.randomUUID(),name:`Layer ${n+1}`,opacity:100,visible:true,locked:false,blendMode:'normal',buf};
    const idx=activeLayerIdxRef.current;
    const next=[...layersRef.current];next.splice(idx+1,0,newL);
    syncLayers(next,idx+1);fullRepaint();
  },[syncLayers,fullRepaint]);

  const addImageLayer=useCallback((file:File)=>{
    const c=canvasRef.current;if(!c) return;
    saveUndo();
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      const W=c.width,H=c.height;
      const buf=new Uint8ClampedArray(W*H*4);
      // Scale image to fit canvas, centered
      const scale=Math.min(W/img.width,H/img.height,1);
      const dw=Math.round(img.width*scale),dh=Math.round(img.height*scale);
      const dx=Math.round((W-dw)/2),dy=Math.round((H-dh)/2);
      const tc=document.createElement('canvas');tc.width=W;tc.height=H;
      const tctx=tc.getContext('2d')!;
      tctx.drawImage(img,dx,dy,dw,dh);
      const d=tctx.getImageData(0,0,W,H);
      buf.set(d.data);
      URL.revokeObjectURL(url);
      const name=file.name.replace(/\.[^.]+$/,'').slice(0,28)||'Image';
      const n=layersRef.current.length;
      const newL:Layer={id:crypto.randomUUID(),name,opacity:100,visible:true,locked:false,blendMode:'normal',buf};
      const idx=activeLayerIdxRef.current;
      const next=[...layersRef.current];next.splice(idx+1,0,newL);
      syncLayers(next,idx+1);fullRepaint();scheduleThumbUpdate();
    };
    img.onerror=()=>URL.revokeObjectURL(url);
    img.src=url;
  },[saveUndo,syncLayers,fullRepaint,scheduleThumbUpdate]);

  const deleteLayer=useCallback((idx:number)=>{
    if(layersRef.current.length<=1) return;
    saveUndo();
    const next=layersRef.current.filter((_,i)=>i!==idx);
    const newIdx=Math.max(0,Math.min(activeLayerIdxRef.current,next.length-1));
    syncLayers(next,newIdx);fullRepaint();
  },[syncLayers,fullRepaint,saveUndo]);

  const duplicateLayer=useCallback((idx:number)=>{
    const l=layersRef.current[idx];if(!l) return;
    saveUndo();
    const newBuf=l.buf?new Uint8ClampedArray(l.buf):null;
    const newL:Layer={...l,id:crypto.randomUUID(),name:l.name+' copy',buf:newBuf};
    const next=[...layersRef.current];next.splice(idx+1,0,newL);
    syncLayers(next,idx+1);fullRepaint();scheduleThumbUpdate();
  },[syncLayers,fullRepaint,saveUndo,scheduleThumbUpdate]);

  const mergeDown=useCallback((idx:number)=>{
    if(idx===0||!canvasRef.current) return;
    saveUndo();
    const ls=layersRef.current;
    const upper=ls[idx],lower=ls[idx-1];
    if(!upper.buf||!lower.buf) return;
    const W=canvasRef.current.width,H=canvasRef.current.height;
    const ua=upper.opacity/100;
    for(let i=0;i<W*H;i++){
      const pa=(upper.buf[i*4+3]/255)*ua;if(pa<0.002) continue;
      lower.buf[i*4]  =(lower.buf[i*4]  *(1-pa)+upper.buf[i*4]  *pa)|0;
      lower.buf[i*4+1]=(lower.buf[i*4+1]*(1-pa)+upper.buf[i*4+1]*pa)|0;
      lower.buf[i*4+2]=(lower.buf[i*4+2]*(1-pa)+upper.buf[i*4+2]*pa)|0;
      lower.buf[i*4+3]=Math.min(255,(lower.buf[i*4+3])+(upper.buf[i*4+3]*ua))|0;
    }
    const next=ls.filter((_,i)=>i!==idx);
    syncLayers(next,idx-1);fullRepaint();scheduleThumbUpdate();
  },[syncLayers,fullRepaint,saveUndo,scheduleThumbUpdate]);

  const flattenAll=useCallback(()=>{
    if(!canvasRef.current||layersRef.current.length<=1) return;
    saveUndo();
    const c=canvasRef.current;
    const composited=c.getContext('2d')!.getImageData(0,0,c.width,c.height);
    const newBuf=new Uint8ClampedArray(composited.data);
    const bg:Layer={id:crypto.randomUUID(),name:'Background',opacity:100,visible:true,locked:false,blendMode:'normal',buf:newBuf};
    syncLayers([bg],0);
  },[syncLayers,saveUndo]);

  const updateLayerProp=useCallback((idx:number,patch:Partial<Omit<Layer,'buf'>>)=>{
    const next=layersRef.current.map((l,i)=>i===idx?{...l,...patch}:l);
    layersRef.current=next;_setLayersUI([...next]);
    if(patch.visible!==undefined||patch.opacity!==undefined||patch.blendMode!==undefined)fullRepaint();
  },[fullRepaint]);

  const reorderLayer=useCallback((fromIdx:number,toIdx:number)=>{
    if(fromIdx===toIdx) return;
    saveUndo();
    const next=[...layersRef.current];const[moved]=next.splice(fromIdx,1);next.splice(toIdx,0,moved);
    let newActive=activeLayerIdxRef.current;
    if(activeLayerIdxRef.current===fromIdx)newActive=toIdx;
    else if(fromIdx<activeLayerIdxRef.current&&toIdx>=activeLayerIdxRef.current)newActive--;
    else if(fromIdx>activeLayerIdxRef.current&&toIdx<=activeLayerIdxRef.current)newActive++;
    syncLayers(next,newActive);fullRepaint();
  },[syncLayers,fullRepaint,saveUndo]);

  useEffect(()=>{
    const onUp=()=>{if(isDirtyRef.current)scheduleThumbUpdate();};
    document.addEventListener('pointerup',onUp);return()=>document.removeEventListener('pointerup',onUp);
  },[scheduleThumbUpdate]);

  const switchWorkspace=useCallback((w:Workspace)=>{
    if(w===workspaceRef.current) return;
    if(w==='animate'){stopPlayback();if(animFramesRef.current.length===0){const canvas=canvasRef.current;if(!canvas) return;const dataUrl=canvas.toDataURL('image/jpeg',.88);animFramesRef.current=[dataUrl];animFrameRef.current=0;setAnimFrames([dataUrl]);setAnimFrame(0);}}
    else{stopPlayback();}
    setWorkspace(w);
  },[stopPlayback]);

  // ── Export
  const exportAnimSvg=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas) return;saveCurrentAnimFrame();
    const w=canvasW||canvas.offsetWidth,hh=canvasH||canvas.offsetHeight;
    const dataUrl=canvas.toDataURL('image/png');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}">\n  <image href="${dataUrl}" width="${w}" height="${hh}"/>\n</svg>`;
    const blob=new Blob([svg],{type:'image/svg+xml'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.download=`mepaint-frame-${animFrame+1}.svg`;a.href=url;a.click();URL.revokeObjectURL(url);
  },[saveCurrentAnimFrame,animFrame,canvasW,canvasH]);

  const exportAnimVideo=useCallback(async()=>{
    const canvas=canvasRef.current;if(!canvas||animFramesRef.current.length===0) return;
    saveCurrentAnimFrame();setIsRecording(true);
    const offCanvas=document.createElement('canvas');offCanvas.width=canvas.width;offCanvas.height=canvas.height;
    const offCtx=offCanvas.getContext('2d')!;
    const mimeType=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    const stream=offCanvas.captureStream(animFpsRef.current);
    const chunks:BlobPart[]=[];
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:8_000_000});
    recorder.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
    recorder.onstop=()=>{
      const blob=new Blob(chunks,{type:mimeType});const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.download='mepaint-animation.webm';a.href=url;a.click();URL.revokeObjectURL(url);
      setIsRecording(false);
    };
    recorder.start();
    const msPerFrame=Math.max(100,1000/animFpsRef.current);
    for(let i=0;i<animFramesRef.current.length;i++){
      await new Promise<void>(resolve=>{const img=new Image();img.onload=()=>{offCtx.drawImage(img,0,0,offCanvas.width,offCanvas.height);setTimeout(resolve,msPerFrame);};img.src=animFramesRef.current[i];});
    }
    recorder.stop();
  },[saveCurrentAnimFrame]);

  // ── Gallery
  const saveToGallery=useCallback((name?:string)=>{const canvas=canvasRef.current;if(!canvas) return;canvas.toBlob(blob=>{if(!blob) return;const reader=new FileReader();reader.onload=e=>{const dataUrl=e.target?.result as string;const entry:GalleryEntry={id:crypto.randomUUID(),name:name||`Painting — ${new Date().toLocaleDateString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}`,dataUrl,createdAt:Date.now(),isAuto:false};setGallery(prev=>{const next=[entry,...prev].slice(0,24);persistGallery(next);return next;});isDirtyRef.current=false;};reader.readAsDataURL(blob);},'image/jpeg',.72);},[]);
  const deleteFromGallery=useCallback((id:string)=>setGallery(prev=>{const next=prev.filter(e=>e.id!==id);persistGallery(next);return next;}),[]);
  const loadFromGallery=useCallback((dataUrl:string)=>{saveUndo();loadCanvasFromUrl(dataUrl);setShowGallery(false);},[saveUndo,loadCanvasFromUrl]);
  useEffect(()=>{autoGalleryRef.current=setInterval(()=>{if(!isDirtyRef.current) return;const canvas=canvasRef.current;if(!canvas) return;canvas.toBlob(blob=>{if(!blob) return;const reader=new FileReader();reader.onload=e=>{const dataUrl=e.target?.result as string;const entry:GalleryEntry={id:`auto-${Date.now()}`,name:`Auto — ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`,dataUrl,createdAt:Date.now(),isAuto:true};setGallery(prev=>{const manuals=prev.filter(e=>!e.isAuto),autos=prev.filter(e=>e.isAuto).slice(0,2);const next=[entry,...manuals,...autos].slice(0,24);persistGallery(next);return next;});isDirtyRef.current=false;};reader.readAsDataURL(blob);},'image/jpeg',.45);},5*60*1000);return()=>{if(autoGalleryRef.current)clearInterval(autoGalleryRef.current);};},[]);

  const sampleColor=useCallback((cx:number,cy:number)=>{const canvas=canvasRef.current;if(!canvas) return;const{x,y}=toCanvas(cx,cy);const ratio=window.devicePixelRatio||1;const px=Math.floor(x*ratio),py=Math.floor(y*ratio);if(px<0||py<0||px>=canvas.width||py>=canvas.height) return;const d=canvas.getContext('2d')!.getImageData(px,py,1,1).data;applyColor([d[0],d[1],d[2]]);setIsEyedropper(false);},[toCanvas,applyColor]);

  // ── Transform callbacks
  const commitTxSelection=useCallback(()=>{
    const r=txRectRef.current,c=canvasRef.current;if(!r||!c) return;
    const nrx=Math.min(r.x,r.x+r.w),nry=Math.min(r.y,r.y+r.h);
    const nrw=Math.abs(r.w),nrh=Math.abs(r.h);
    if(nrw<4||nrh<4){setTxRect(null);txRectRef.current=null;return;}
    saveUndo();
    const ratio=window.devicePixelRatio||1;
    const px=Math.max(0,Math.round(nrx*ratio)),py=Math.max(0,Math.round(nry*ratio));
    const pw=Math.min(Math.round(nrw*ratio),c.width-px),ph=Math.min(Math.round(nrh*ratio),c.height-py);
    if(pw<1||ph<1) return;
    const ctx=c.getContext('2d')!;
    const cap=ctx.getImageData(px,py,pw,ph);
    txCapRef.current=cap;
    const normalRect={x:nrx,y:nry,w:nrw,h:nrh};
    txOrigRef.current=normalRect;
    // Generate preview URL
    const src=document.createElement('canvas');src.width=pw;src.height=ph;
    src.getContext('2d')!.putImageData(cap,0,0);
    setTxPreviewUrl(src.toDataURL());
    // Cut from active layer
    const curLayer=layersRef.current[activeLayerIdxRef.current];
    if(curLayer?.buf){
      const W=c.width;
      for(let ry=py;ry<py+ph;ry++) for(let rx=px;rx<px+pw;rx++){const i=(ry*W+rx)*4;curLayer.buf[i]=curLayer.buf[i+1]=curLayer.buf[i+2]=curLayer.buf[i+3]=0;}
      pixelBufRef.current=curLayer.buf;
      dirtyRef.current={x1:0,y1:0,x2:c.width,y2:c.height};scheduleFlush();
    }
    setTxRect(normalRect);txRectRef.current=normalRect;
    setTxPhase('active');txPhaseRef.current='active';
  },[saveUndo,scheduleFlush]);
  const commitTxSelRef=useRef(commitTxSelection);
  useEffect(()=>{commitTxSelRef.current=commitTxSelection;},[commitTxSelection]);

  const applyTransform=useCallback(()=>{
    const cap=txCapRef.current,r=txRectRef.current,c=canvasRef.current;
    if(!cap||!r||!c){setIsTransformMode(false);isTransformRef.current=false;return;}
    const ratio=window.devicePixelRatio||1;
    const px=Math.round(r.x*ratio),py=Math.round(r.y*ratio);
    const pw=Math.max(1,Math.round(r.w*ratio)),ph=Math.max(1,Math.round(r.h*ratio));
    const tmp=document.createElement('canvas');tmp.width=pw;tmp.height=ph;
    const src=document.createElement('canvas');src.width=cap.width;src.height=cap.height;
    src.getContext('2d')!.putImageData(cap,0,0);
    tmp.getContext('2d')!.drawImage(src,0,0,cap.width,cap.height,0,0,pw,ph);
    const scaled=tmp.getContext('2d')!.getImageData(0,0,pw,ph);
    const curLayer=layersRef.current[activeLayerIdxRef.current];
    if(curLayer?.buf){
      const W=c.width,H=c.height;
      for(let ry=0;ry<ph;ry++) for(let rx=0;rx<pw;rx++){
        const cx=px+rx,cy=py+ry;if(cx<0||cy<0||cx>=W||cy>=H) continue;
        const di=(cy*W+cx)*4,si=(ry*pw+rx)*4;
        const sa=scaled.data[si+3]/255;if(sa<=0) continue;
        const da=curLayer.buf[di+3]/255,oa=sa+da*(1-sa);
        if(oa>0){curLayer.buf[di]=Math.round((scaled.data[si]*sa+curLayer.buf[di]*da*(1-sa))/oa);curLayer.buf[di+1]=Math.round((scaled.data[si+1]*sa+curLayer.buf[di+1]*da*(1-sa))/oa);curLayer.buf[di+2]=Math.round((scaled.data[si+2]*sa+curLayer.buf[di+2]*da*(1-sa))/oa);curLayer.buf[di+3]=Math.round(oa*255);}
      }
      pixelBufRef.current=curLayer.buf;
      dirtyRef.current={x1:0,y1:0,x2:W,y2:H};scheduleFlush();
    }
    txCapRef.current=null;txOrigRef.current=null;setTxPreviewUrl(null);
    setTxRect(null);txRectRef.current=null;
    setTxPhase('select');txPhaseRef.current='select';
    setIsTransformMode(false);isTransformRef.current=false;
  },[scheduleFlush]);

  const cancelTransform=useCallback(()=>{
    // For lasso mode txOrigFullRef holds the full bbox snapshot so we can restore
    // pixels that were OUTSIDE the lasso path. Falls back to txCapRef for rect-transform.
    const restoreCap=txOrigFullRef.current||txCapRef.current;
    const orig=txOrigRef.current,c=canvasRef.current;
    if(restoreCap&&orig&&c){
      const ratio=window.devicePixelRatio||1;
      const px=Math.round(orig.x*ratio),py=Math.round(orig.y*ratio);
      const curLayer=layersRef.current[activeLayerIdxRef.current];
      if(curLayer?.buf){
        const W=c.width,H=c.height;
        for(let ry=0;ry<restoreCap.height;ry++) for(let rx=0;rx<restoreCap.width;rx++){
          const cx=px+rx,cy=py+ry;if(cx<0||cy<0||cx>=W||cy>=H) continue;
          const di=(cy*W+cx)*4,si=(ry*restoreCap.width+rx)*4;
          curLayer.buf[di]=restoreCap.data[si];curLayer.buf[di+1]=restoreCap.data[si+1];curLayer.buf[di+2]=restoreCap.data[si+2];curLayer.buf[di+3]=restoreCap.data[si+3];
        }
        pixelBufRef.current=curLayer.buf;
        dirtyRef.current={x1:0,y1:0,x2:c.width,y2:c.height};scheduleFlush();
      }
    }
    txCapRef.current=null;txOrigRef.current=null;txOrigFullRef.current=null;setTxPreviewUrl(null);
    setTxRect(null);txRectRef.current=null;
    setTxPhase('select');txPhaseRef.current='select';
    setIsTransformMode(false);isTransformRef.current=false;
    setIsLassoMode(false);isLassoRef.current=false;
    setLassoPath([]);lassoPathRef.current=[];
  },[scheduleFlush]);
  const cancelTransformRef=useRef(cancelTransform);
  useEffect(()=>{cancelTransformRef.current=cancelTransform;},[cancelTransform]);

  // ── Lasso commit: close the freehand path → mask → cut → enter transform active phase
  const commitLassoSelection=useCallback(()=>{
    const path=lassoPathRef.current,c=canvasRef.current;
    if(!c||path.length<4){setLassoPath([]);lassoPathRef.current=[];setIsLassoMode(false);isLassoRef.current=false;return;}
    // Compute bounding box in canvas CSS coords
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    path.forEach(p=>{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);});
    const nrw=maxX-minX,nrh=maxY-minY;
    if(nrw<4||nrh<4){setLassoPath([]);lassoPathRef.current=[];setIsLassoMode(false);isLassoRef.current=false;return;}
    saveUndo();
    const ratio=window.devicePixelRatio||1;
    const px=Math.max(0,Math.round(minX*ratio)),py=Math.max(0,Math.round(minY*ratio));
    const pw=Math.min(Math.round(nrw*ratio),c.width-px),ph=Math.min(Math.round(nrh*ratio),c.height-py);
    if(pw<1||ph<1) return;
    // Build mask: fill the lasso polygon on an offscreen canvas
    const mCv=document.createElement('canvas');mCv.width=pw;mCv.height=ph;
    const mCtx=mCv.getContext('2d')!;
    mCtx.fillStyle='black';mCtx.fillRect(0,0,pw,ph);
    mCtx.beginPath();
    path.forEach((pt,i)=>{
      const sx=(pt.x-minX)*ratio,sy=(pt.y-minY)*ratio;
      i===0?mCtx.moveTo(sx,sy):mCtx.lineTo(sx,sy);
    });
    mCtx.closePath();mCtx.fillStyle='white';mCtx.fill();
    const maskData=mCtx.getImageData(0,0,pw,ph);
    // Capture full bbox pixels (for cancel restore)
    const ctx=c.getContext('2d')!;
    const fullBbox=ctx.getImageData(px,py,pw,ph);
    txOrigFullRef.current=fullBbox;
    // Build masked ImageData (transparent outside lasso)
    const masked=new ImageData(pw,ph);
    for(let i=0;i<pw*ph;i++){
      if(maskData.data[i*4]>128){
        masked.data[i*4]=fullBbox.data[i*4];masked.data[i*4+1]=fullBbox.data[i*4+1];
        masked.data[i*4+2]=fullBbox.data[i*4+2];masked.data[i*4+3]=fullBbox.data[i*4+3];
      }
    }
    txCapRef.current=masked;
    const normalRect={x:minX,y:minY,w:nrw,h:nrh};
    txOrigRef.current=normalRect;
    // Preview PNG
    const previewCv=document.createElement('canvas');previewCv.width=pw;previewCv.height=ph;
    previewCv.getContext('2d')!.putImageData(masked,0,0);
    setTxPreviewUrl(previewCv.toDataURL());
    // Cut masked pixels from active layer
    const curLayer=layersRef.current[activeLayerIdxRef.current];
    if(curLayer?.buf){
      const W=c.width;
      for(let i=0;i<pw*ph;i++){
        if(maskData.data[i*4]>128){
          const lx=i%pw,ly=Math.floor(i/pw),cx=px+lx,cy=py+ly;
          if(cx<0||cy<0||cx>=W||cy>=c.height) continue;
          const bi=(cy*W+cx)*4;
          curLayer.buf[bi]=curLayer.buf[bi+1]=curLayer.buf[bi+2]=curLayer.buf[bi+3]=0;
        }
      }
      pixelBufRef.current=curLayer.buf;
      dirtyRef.current={x1:0,y1:0,x2:c.width,y2:c.height};scheduleFlush();
    }
    // Clear lasso drawing path + mask
    setLassoPath([]);lassoPathRef.current=[];
    setIsLassoMode(false);isLassoRef.current=false;
    lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';
    // Enter transform active phase (reuse transform overlay + apply/cancel machinery)
    setTxRect(normalRect);txRectRef.current=normalRect;
    setTxPhase('active');txPhaseRef.current='active';
    setIsTransformMode(true);isTransformRef.current=true;
  },[saveUndo,scheduleFlush]);
  const commitLassoSelRef=useRef(commitLassoSelection);
  useEffect(()=>{commitLassoSelRef.current=commitLassoSelection;},[commitLassoSelection]);

  // ── Lasso paint phase: close the path → build pixel mask → stay in paint mode
  const enterLassoPaintPhase=useCallback(()=>{
    const path=lassoPathRef.current,c=canvasRef.current;
    if(!c||path.length<4){setLassoPath([]);lassoPathRef.current=[];setIsLassoMode(false);isLassoRef.current=false;lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';return;}
    const ratio=window.devicePixelRatio||1;
    const W=c.width,H=c.height;
    const mc=document.createElement('canvas');mc.width=W;mc.height=H;
    const mctx=mc.getContext('2d')!;
    mctx.fillStyle='black';mctx.fillRect(0,0,W,H);
    mctx.beginPath();
    path.forEach((pt,i)=>{const px=pt.x*ratio,py=pt.y*ratio;i===0?mctx.moveTo(px,py):mctx.lineTo(px,py);});
    mctx.closePath();mctx.fillStyle='white';mctx.fill();
    const imgData=mctx.getImageData(0,0,W,H);
    const mask=new Uint8Array(W*H);
    for(let i=0;i<W*H;i++){mask[i]=imgData.data[i*4]>128?1:0;}
    lassoMaskRef.current=mask;
    setLassoPhase('painting');lassoPhaseRef.current='painting';
  },[]);
  const enterLassoPaintPhaseRef=useRef(enterLassoPaintPhase);
  useEffect(()=>{enterLassoPaintPhaseRef.current=enterLassoPaintPhase;},[enterLassoPaintPhase]);

  // ── Exit lasso paint mode (done painting, keep pixels, clear mask)
  const exitLassoPaint=useCallback(()=>{
    lassoMaskRef.current=null;
    setLassoPhase('drawing');lassoPhaseRef.current='drawing';
    setLassoPath([]);lassoPathRef.current=[];
    setIsLassoMode(false);isLassoRef.current=false;
  },[]);

  // ── Server canvas / collab
  const saveCanvasToServer=useCallback(async(rid:string)=>{
    const canvas=canvasRef.current;if(!canvas||!isDirtyRef.current) return;
    return new Promise<void>(resolve=>{canvas.toBlob(blob=>{if(!blob){resolve();return;}const reader=new FileReader();reader.onload=async e=>{const dataUrl=e.target?.result as string;try{await fetch(`${SERVER}/rooms/${rid}/canvas`,{method:'POST',headers:AUTH_H,body:JSON.stringify({dataUrl})});isDirtyRef.current=false;}catch(err){console.log('Save error:',err);}resolve();};reader.readAsDataURL(blob);},'image/jpeg',.35);});
  },[]);

  const connectRoom=useCallback(async(rid:string,asHost:boolean)=>{
    if(channelRef.current){channelReady.current=false;await channelRef.current.unsubscribe();channelRef.current=null;}
    if(!asHost){try{const res=await fetch(`${SERVER}/rooms/${rid}/canvas`,{headers:{'Authorization':`Bearer ${publicAnonKey}`}});if(res.ok){const{dataUrl}=await res.json();if(dataUrl)setTimeout(()=>loadCanvasFromUrl(dataUrl),200);}}catch(e){console.log('Canvas fetch:',e);}}
    const ch=supabase.channel(`mepaint:${rid}`,{config:{broadcast:{self:false},presence:{key:myUid.current}}});
    ch.on('broadcast',{event:'stroke'},({payload}:{payload:StrokeMsg})=>{interpolateRef.current(payload.x1,payload.y1,payload.x2,payload.y2,{brushType:payload.bt,brushSize:payload.bs,color:payload.col,opacity:payload.op,eraser:!!payload.er,layerIdx:payload.li},false);});
    ch.on('broadcast',{event:'cursor'},({payload}:{payload:CursorMsg})=>{setRemoteCursors(prev=>{const next=new Map(prev);const ex=next.get(payload.uid)??{x:0,y:0,color:collabColor(payload.uid),name:'Artist'};next.set(payload.uid,{...ex,x:payload.x,y:payload.y,name:payload.name??ex.name,color:payload.color??ex.color});return next;});});
    ch.on('broadcast',{event:'chat'},({payload}:{payload:ChatMsg})=>{setChatMessages(prev=>[...prev,payload]);});
    ch.on('presence',{event:'sync'},()=>{const state=ch.presenceState<{name:string;color:string}>();setOnlineUsers(Object.entries(state).map(([uid,pa])=>({uid,name:(pa[0] as any)?.name??'Artist',color:(pa[0] as any)?.color??collabColor(uid)})));});
    ch.on('presence',{event:'join'},()=>{if(asHost)setTimeout(()=>saveCanvasToServer(rid),800);});
    ch.on('presence',{event:'leave'},({key}:{key:string})=>{setRemoteCursors(prev=>{const next=new Map(prev);next.delete(key);return next;});});
    ch.subscribe(async(status)=>{if(status==='SUBSCRIBED'){channelReady.current=true;await ch.track({name:myName.current,color:myColor.current});setIsConnected(true);if(asHost)setTimeout(()=>saveCanvasToServer(rid),500);}else{channelReady.current=false;setIsConnected(false);}});
    channelRef.current=ch;if(asHost)autoSaveTimer.current=setInterval(()=>saveCanvasToServer(rid),30000);
  },[loadCanvasFromUrl,saveCanvasToServer]);
  useEffect(()=>{if(roomId)connectRoom(roomId,isHost.current);return()=>{channelReady.current=false;channelRef.current?.unsubscribe();if(autoSaveTimer.current)clearInterval(autoSaveTimer.current);};},[roomId,connectRoom]);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:'smooth'});},[chatMessages]);
  const createRoom=useCallback(()=>{const rid=crypto.randomUUID().slice(0,8);isHost.current=true;setRoomId(rid);const url=new URL(window.location.href);url.searchParams.set('room',rid);window.history.pushState({},'',url.toString());},[]);
  const leaveRoom=useCallback(async()=>{const rid=roomId;if(isHost.current&&rid){isDirtyRef.current=true;await saveCanvasToServer(rid).catch(()=>{});}channelReady.current=false;if(channelRef.current){channelRef.current.unsubscribe();channelRef.current=null;}if(autoSaveTimer.current){clearInterval(autoSaveTimer.current);autoSaveTimer.current=null;}setRoomId(null);setIsConnected(false);setRemoteCursors(new Map());setOnlineUsers([]);setChatMessages([]);isHost.current=false;const url=new URL(window.location.href);url.searchParams.delete('room');window.history.pushState({},'',url.toString());},[roomId,saveCanvasToServer]);
  const broadcastStroke=useCallback((x1:number,y1:number,x2:number,y2:number,settings:StampSettings)=>{if(!channelReady.current||!channelRef.current||workspaceRef.current==='animate') return;channelRef.current.send({type:'broadcast',event:'stroke',payload:{uid:myUid.current,x1,y1,x2,y2,bt:settings.brushType,bs:settings.brushSize,col:settings.color,op:settings.opacity,er:eraserModeRef.current||settings.brushType==='eraser',li:activeLayerIdxRef.current}});},[]);
  const sendChat=useCallback(()=>{const text=chatInput.trim();if(!text||!channelReady.current||!channelRef.current) return;const msg:ChatMsg={uid:myUid.current,name:myName.current,color:myColor.current,text,ts:Date.now()};channelRef.current.send({type:'broadcast',event:'chat',payload:msg});setChatMessages(prev=>[...prev,msg]);setChatInput('');},[chatInput]);
  const copyLink=useCallback(()=>{
    const url=new URL(window.location.href);
    url.searchParams.set('room',roomId!);
    const text=url.toString();
    const fin=()=>{setLinkCopied(true);setTimeout(()=>setLinkCopied(false),2500);};
    if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(text).then(fin).catch(()=>fallbackCopy(text,fin));
    } else {
      fallbackCopy(text,fin);
    }
  },[roomId]);

  // ── Keep stable refs in sync so pointer handlers never need to re-register
  useEffect(()=>{toCanvasRef.current=toCanvas;},[toCanvas]);
  useEffect(()=>{interpolateRef.current=interpolate;},[interpolate]);
  useEffect(()=>{broadcastStrokeRef.current=broadcastStroke;},[broadcastStroke]);
  useEffect(()=>{toolStateRef.current={brushType,brushSize,color,opacity};},[brushType,brushSize,color,opacity]);

  // ── Pointer events — registered ONCE (empty deps) so pointerup is never missed mid-stroke.
  // All tool state is read through refs that are always current.
  useEffect(()=>{
    const onMove=(e:PointerEvent)=>{
      // Update brush cursor position directly via DOM (avoids full re-render on every move).
      // Only track the primary pointer or the active drawing pointer to avoid jitter from
      // mouse-emulation events that can have slightly different coordinates.
      if(!ds.current.isDrawing||activePointerIdRef.current===null||e.pointerId===activePointerIdRef.current){
        const cd=cursorDivRef.current;if(cd){cd.style.left=e.clientX+'px';cd.style.top=e.clientY+'px';}
      }
      const rr=refResizeRef.current;if(rr){const dx=e.clientX-rr.startX,dy=e.clientY-rr.startY;setRefSize({w:Math.max(150,Math.min(560,rr.startW+dx)),h:Math.max(120,Math.min(560,rr.startH+dy))});}
      // ── Lasso: accumulate path points (throttled by distance, only while drawing)
      if(isLassoRef.current&&lassoDrawRef.current&&lassoPhaseRef.current==='drawing'){
        const{x,y}=toCanvasRef.current(e.clientX,e.clientY);
        const last=lassoPathRef.current[lassoPathRef.current.length-1];
        if(!last||Math.hypot(x-last.x,y-last.y)>2){
          lassoPathRef.current.push({x,y});
          setLassoPath([...lassoPathRef.current]);
        }
        return;
      }
      // ── Transform drag handling
      if(isTransformRef.current&&txDsRef.current.active){
        const tx=txDsRef.current;const vp=vpRef.current;
        const cdx=(e.clientX-tx.startCX)/vp.zoom,cdy=(e.clientY-tx.startCY)/vp.zoom;
        const sr=tx.startRect;
        if(tx.type==='selecting'){
          const{x,y}=toCanvasRef.current(e.clientX,e.clientY);
          const nr={x:sr.x,y:sr.y,w:x-sr.x,h:y-sr.y};
          setTxRect(nr);txRectRef.current=nr;
        } else if(tx.type==='moving'){
          const nr={...sr,x:sr.x+cdx,y:sr.y+cdy};
          setTxRect(nr);txRectRef.current=nr;
        } else if(tx.type==='resizing'){
          let{x,y,w,h}=sr;const h_=tx.handle;
          if(h_.includes('e')) w=Math.max(10,sr.w+cdx);
          if(h_.includes('s')) h=Math.max(10,sr.h+cdy);
          if(h_.includes('w')){x=sr.x+cdx;w=Math.max(10,sr.w-cdx);}
          if(h_.includes('n')){y=sr.y+cdy;h=Math.max(10,sr.h-cdy);}
          const nr={x,y,w,h};setTxRect(nr);txRectRef.current=nr;
        }
        return;
      }
      const d=ds.current;
      if(d.isPanning){const dx=e.clientX-d.panStartX,dy=e.clientY-d.panStartY;setPan({x:d.panStartPX+dx,y:d.panStartPY+dy});return;}
      // Only process this move event if it belongs to the active drawing pointer.
      // This prevents a secondary hover/mouse-emulation pointer from painting.
      if(d.isDrawing&&activePointerIdRef.current!==null&&e.pointerId!==activePointerIdRef.current) return;
      if(d.isDrawing){
        e.preventDefault(); // Prevent browser gesture interference mid-stroke
        // Pressure EMA — hold last known value if tablet sends a rogue 0 mid-stroke
        const rawP=e.pointerType==='mouse'?1.0:e.pressure>0?Math.max(0.01,e.pressure):d.pressure;
        d.pressure=d.pressure*0.5+rawP*0.5;
        const ts=toolStateRef.current;
        const{x,y}=toCanvasRef.current(e.clientX,e.clientY);
        const settings:StampSettings={brushType:ts.brushType,brushSize:ts.brushSize,color:ts.color,opacity:ts.opacity};
        interpolateRef.current(d.lastX,d.lastY,x,y,settings);
        broadcastStrokeRef.current(d.lastX,d.lastY,x,y,settings);
        d.lastX=x;d.lastY=y;
      }
      const{x,y}=toCanvasRef.current(e.clientX,e.clientY);const now=Date.now();
      if(now-cursorThrottle.current>50&&channelReady.current&&channelRef.current){cursorThrottle.current=now;channelRef.current.send({type:'broadcast',event:'cursor',payload:{uid:myUid.current,x,y,name:myName.current,color:myColor.current}});}
    };
    const endStroke=(e:PointerEvent)=>{
      // Ignore releases from pointers that aren't the active drawing pointer
      if(activePointerIdRef.current!==null&&e.pointerId!==activePointerIdRef.current) return;
      activePointerIdRef.current=null;
      if(isLassoRef.current&&lassoDrawRef.current&&lassoPhaseRef.current==='drawing'){
        lassoDrawRef.current=false;enterLassoPaintPhaseRef.current();return;
      }
      if(isTransformRef.current&&txDsRef.current.active){
        const wasSelecting=txDsRef.current.type==='selecting';
        txDsRef.current.active=false;
        if(wasSelecting) commitTxSelRef.current();
        return;
      }
      ds.current.isDrawing=false;ds.current.smudgeColor=null;ds.current.isPanning=false;ds.current.pressure=1.0;refResizeRef.current=null;
    };
    const onKey=(e:KeyboardEvent)=>{if(e.code==='Space'&&!ds.current.isSpaceHeld){ds.current.isSpaceHeld=true;const cd=cursorDivRef.current;if(cd)cd.style.opacity='0';}};
    const onKeyUp=(e:KeyboardEvent)=>{if(e.code==='Space'){ds.current.isSpaceHeld=false;const cd=cursorDivRef.current;if(cd)cd.style.opacity='1';}};
    document.addEventListener('pointermove',onMove);
    document.addEventListener('pointerup',endStroke);
    document.addEventListener('pointercancel',endStroke);
    document.addEventListener('keydown',onKey);
    document.addEventListener('keyup',onKeyUp);
    return()=>{
      document.removeEventListener('pointermove',onMove);
      document.removeEventListener('pointerup',endStroke);
      document.removeEventListener('pointercancel',endStroke);
      document.removeEventListener('keydown',onKey);
      document.removeEventListener('keyup',onKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{const container=containerRef.current;if(!container) return;const onWheel=(e:WheelEvent)=>{e.preventDefault();zoomAt(e.clientX,e.clientY,e.deltaY<0?1.12:.88);};container.addEventListener('wheel',onWheel,{passive:false});return()=>container.removeEventListener('wheel',onWheel);},[zoomAt]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const tag=(e.target as HTMLElement).tagName;if(tag==='INPUT'||tag==='TEXTAREA') return;
      if(e.altKey&&e.code==='KeyE'){setIsEyedropper(p=>!p);return;}
      if(e.ctrlKey||e.metaKey){if(e.key==='z'){e.preventDefault();handleUndo();}else if(e.key==='s'){e.preventDefault();handleSave();}return;}
      switch(e.key){
        case '1':setBrushType('soft-round');break;case '2':setBrushType('flat');break;case '3':setBrushType('bristle');break;
        case '4':setBrushType('watercolor');break;case '5':setBrushType('thick-paint');break;case '6':case 'e':setEraserMode(p=>!p);break;
        case 's':setSmudgeMode(p=>!p);break;case '[':setBrushSize(p=>Math.max(2,p-5));break;case ']':setBrushSize(p=>Math.min(150,p+5));break;
        case 'f':case 'F':setFlipH(p=>!p);break;case 'V':setFlipV(p=>!p);break;
        case 'g':case 'G':setShowGallery(p=>!p);break;case 'c':setShowColorPanel(p=>!p);setShowBrushAdv(false);setShowSurface(false);break;case '?':setShowHelp(p=>!p);break;
        case 'Escape':setShowHelp(false);setIsEyedropper(false);setShowGallery(false);setShowBrushAdv(false);setShowSurface(false);setShowProfile(false);setShowCanvasSize(false);setShowLayerPanel(false);setShowBrushLib(false);setShowInvite(false);setShowColorPanel(false);if(isTransformRef.current)cancelTransformRef.current();if(isLassoRef.current){setIsLassoMode(false);isLassoRef.current=false;setLassoPath([]);lassoPathRef.current=[];lassoDrawRef.current=false;lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';}break;
        case 't':case 'T':if(!isTransformRef.current){if(isLassoRef.current){setIsLassoMode(false);isLassoRef.current=false;setLassoPath([]);lassoPathRef.current=[];}setIsTransformMode(true);isTransformRef.current=true;}else{cancelTransformRef.current();}break;
        case 'l':case 'L':if(!isLassoRef.current){if(isTransformRef.current)cancelTransformRef.current();setIsLassoMode(true);isLassoRef.current=true;setLassoPath([]);lassoPathRef.current=[];setLassoPhase('drawing');lassoPhaseRef.current='drawing';lassoMaskRef.current=null;}else{setIsLassoMode(false);isLassoRef.current=false;setLassoPath([]);lassoPathRef.current=[];lassoDrawRef.current=false;lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';}break;
        case '=':case '+':zoomAt(window.innerWidth/2,window.innerHeight/2,1.25);break;
        case '-':zoomAt(window.innerWidth/2,window.innerHeight/2,.8);break;case '0':resetZoom();break;
      }
    };
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[handleUndo,handleSave,zoomAt,resetZoom]);

  const handleCanvasDown=useCallback((e:React.PointerEvent<HTMLCanvasElement>)=>{
    e.preventDefault();
    setShowSurface(false);setShowBrushAdv(false);setShowProfile(false);
    if(animPlaying) return;
    // ── Transform: select phase — start marquee (guard against mouse-emulation re-entry)
    if(isTransformRef.current){
      if(txPhaseRef.current==='select'&&!txDsRef.current.active){
        const{x,y}=toCanvas(e.clientX,e.clientY);
        txDsRef.current={active:true,type:'selecting',handle:'',startCX:e.clientX,startCY:e.clientY,startRect:{x,y,w:0,h:0}};
        setTxRect({x,y,w:0,h:0});txRectRef.current={x,y,w:0,h:0};
      }
      return;
    }
    // ── Lasso: start freehand draw (guard against mouse-emulation re-entry)
    if(isLassoRef.current&&lassoPhaseRef.current==='drawing'){
      if(lassoDrawRef.current) return; // Already drawing — ignore emulated pointerdown
      const{x,y}=toCanvas(e.clientX,e.clientY);
      lassoPathRef.current=[{x,y}];setLassoPath([{x,y}]);
      lassoDrawRef.current=true;return;
    }
    if(isEyedropper||e.altKey){sampleColor(e.clientX,e.clientY);return;}
    if(ds.current.isSpaceHeld){ds.current.isPanning=true;ds.current.panStartX=e.clientX;ds.current.panStartY=e.clientY;ds.current.panStartPX=vpRef.current.panX;ds.current.panStartPY=vpRef.current.panY;return;}
    // Guard: if a stroke is already active (e.g. mouse-emulation pointerdown after pen pointerdown), ignore
    if(activePointerIdRef.current!==null) return;
    // Initialize pressure AFTER re-entry guard so mouse-emulation events can't corrupt the active stroke's pressure
    ds.current.pressure=e.pointerType==='mouse'?1.0:e.pressure>0?Math.max(0.01,e.pressure):1.0;
    const{x,y}=toCanvas(e.clientX,e.clientY);
    if(smudgeMode&&pixelBufRef.current&&canvasRef.current){const ratio=window.devicePixelRatio||1,W=canvasRef.current.width;const px=Math.floor(x*ratio),py=Math.floor(y*ratio),i=(py*W+px)*4,b=pixelBufRef.current;ds.current.smudgeColor=[b[i],b[i+1],b[i+2]];}
    activePointerIdRef.current=e.pointerId;
    ds.current.isDrawing=true;ds.current.lastX=x;ds.current.lastY=y;saveUndo();
    const adv=brushAdvancedRef.current[brushType];const pressure=ds.current.pressure;
    const pc=Math.pow(Math.max(0,Math.min(1,pressure)),0.55);
    const sJ=1+(Math.random()-.5)*(adv?.sizeJitter??0)*.02,oJ=1+(Math.random()-.5)*(adv?.opacityJitter??0)*.02;
    const eff:StampSettings={brushType,brushSize:brushSize*(0.06+pc*0.94)*Math.max(.1,sJ),color,opacity:opacity*(0.04+pc*0.96)*Math.max(.05,oJ)};
    stamp(x,y,eff,smudgeMode?ds.current.smudgeColor:undefined);
    const canvas=canvasRef.current;if(canvas){const CW=canvas.offsetWidth,CH=canvas.offsetHeight;if(symmetry==='vertical'||symmetry==='both')stamp(CW-x,y,eff);if(symmetry==='horizontal'||symmetry==='both')stamp(x,CH-y,eff);if(symmetry==='both')stamp(CW-x,CH-y,eff);}
    // Broadcast initial stamp so remote users see pen-down dots and first-point strokes
    broadcastStrokeRef.current(x,y,x,y,eff);
  },[isEyedropper,sampleColor,toCanvas,smudgeMode,brushType,brushSize,color,opacity,saveUndo,stamp,symmetry,animPlaying]);

  const cycleSymmetry=()=>{const o:Symmetry[]=['none','vertical','horizontal','both'];setSymmetry(s=>o[(o.indexOf(s)+1)%o.length]);};
  const ytCtrl=useCallback((cmd:string,args:unknown[]=[])=>{ytIframeRef.current?.contentWindow?.postMessage(JSON.stringify({event:'command',func:cmd,args}),'*');},[]);
  const loadVideo=useCallback(()=>{const val=ytInputRef.current?.value??ytUrl;const id=extractYouTubeId(val);if(id){setVideoId(id);setIsPlaying(true);setYtUrl('');if(ytInputRef.current)ytInputRef.current.value='';}},[ytUrl]);
  const togglePlay=useCallback(()=>{if(isPlaying){ytCtrl('pauseVideo');setIsPlaying(false);}else{ytCtrl('playVideo');setIsPlaying(true);}},[isPlaying,ytCtrl]);
  const handleRefUpload=useCallback((e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file) return;const reader=new FileReader();reader.onload=ev=>setRefImage(ev.target?.result as string);reader.readAsDataURL(file);},[]);

  // ── UI button helper — clean editorial style
  type BtnVariant = 'lime'|'dark'|'ghost'|'danger'|'default';
  const ibtn = (variant: BtnVariant = 'default', active = false): React.CSSProperties => {
    const base: React.CSSProperties = {border:BORDER,borderRadius:BR,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 90ms ease',flexShrink:0,fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:12,gap:5};
    if (variant === 'lime')    return {...base, background:LIME, color:DARK};
    if (variant === 'dark')    return {...base, background:DARK, color:WHITE};
    if (variant === 'danger')  return {...base, background:clearConfirm?PINK:WHITE, color:clearConfirm?WHITE:DARK};
    if (variant === 'ghost')   return {...base, border:'none', background:'transparent', color:MUTED};
    return {...base, background:active?LIME:WHITE, color:DARK};
  };
  const sidebtn = (active = false): React.CSSProperties => ({
    width: 38, height: 38, border: BORDER, borderRadius: BR, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? LIME : WHITE, color: DARK,
    transition: 'all 120ms cubic-bezier(0.34,1.56,0.64,1)', flexShrink: 0, position: 'relative',
  });

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
        html,body,#root{width:100%;height:100%;overflow:hidden}
        body{font-family:'Space Grotesk',system-ui,sans-serif;background:${CREAM};color:${DARK}}
        input,textarea,select{font-family:'Space Grotesk',system-ui,sans-serif;color:${DARK}}
        input[type=range]{-webkit-appearance:none;appearance:none;height:3px;border-radius:2px;outline:none;cursor:pointer;border:none;background:rgba(0,0,0,.12)}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:${WHITE};border:${BORDER};cursor:grab}
        input[type=range]::-webkit-slider-thumb:active{cursor:grabbing;background:${LIME}}
        .inp{background:${WHITE};border:${BORDER};border-radius:8px;color:${DARK};font-family:'Space Grotesk',sans-serif;font-size:13px;padding:9px 12px;outline:none;width:100%;transition:border-color 120ms}
        .inp:focus{border-color:${ACCENT};box-shadow:0 0 0 2px rgba(58,81,216,.1)}
        .inp::placeholder{color:${MUTED}}
        .mono{font-family:'Space Mono',monospace}
        .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:${BORDER};border-radius:100px;font-family:'Space Mono',monospace;font-size:9px;font-weight:700;letter-spacing:.8px;flex-shrink:0}
        .pop{background:${WHITE};border:${BORDER};border-radius:12px}
        .modal-bg{position:fixed;inset:0;background:rgba(13,11,7,.5);display:flex;align-items:center;justify-content:center;z-index:500;backdrop-filter:blur(4px)}
        .modal{background:${WHITE};border:${BORDER};border-radius:16px;padding:28px 32px;width:480px;max-width:94vw;max-height:90vh;overflow-y:auto}
        .anim-thumb{border-radius:7px;cursor:pointer;position:relative;transition:transform 150ms;border:${BORDER};overflow:hidden;flex-shrink:0}
        .anim-thumb:hover{transform:translateY(-2px)}
        .anim-thumb.sel{border-color:${ACCENT};border-width:2px}
        .anim-thumb .rm{display:none;position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:${PINK};border:${BORDER};cursor:pointer;color:${WHITE};font-size:9px;font-weight:700;align-items:center;justify-content:center;z-index:2}
        .anim-thumb:hover .rm{display:flex}
        .pig{cursor:pointer;border:${BORDER}!important;transition:transform 100ms cubic-bezier(0.34,1.56,0.64,1)}.pig:hover{transform:scale(1.4)!important}
        .sb::-webkit-scrollbar{width:3px;height:3px}.sb::-webkit-scrollbar-track{background:transparent}.sb::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:2px}
        .rov{position:absolute;inset:0;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 150ms}.rov:hover{background:rgba(0,0,0,.35)}.rov span{opacity:0;transition:opacity 150ms;color:#fff;font-size:11px;font-weight:700}.rov:hover span{opacity:1}
        .ws-tab{padding:0 16px;height:36px;border:${BORDER};border-radius:8px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;transition:all 100ms}
        button:active{transform:translate(1px,1px)}
        @keyframes fi{from{opacity:0}to{opacity:1}}
        @keyframes su{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes sl{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
        @keyframes slu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes marchAnts{0%{opacity:1}50%{opacity:0.4}100%{opacity:1}}
        .layer-item{transition:background 80ms,border-color 80ms}
        .layer-item:hover{background:rgba(0,0,0,.03)!important}
        [draggable]{cursor:grab}[draggable]:active{cursor:grabbing}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes slideRight{from{transform:translateX(-100%);opacity:0}to{transform:translateX(0);opacity:1}}
        @keyframes fadeIn2{from{opacity:0}to{opacity:1}}
        .mob-drawer-bg{position:fixed;inset:0;background:rgba(13,11,7,.4);z-index:500;animation:fadeIn2 120ms ease}
        .mob-drawer{position:fixed;left:0;top:0;bottom:0;width:260px;background:${WHITE};border-right:${BORDER};z-index:510;animation:slideRight 200ms cubic-bezier(.4,.8,.6,1);overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:6}
        @media(max-width:767px){
          .ws-tab{padding:0 10px;height:30px;font-size:10px}
          .pill{padding:2px 7px;font-size:8px}
          .modal{padding:20px 18px;border-radius:14px}
        }
      `}</style>
      <input type="file" ref={fileInputRef} accept="image/*" onChange={handleRefUpload} style={{display:'none'}}/>

      {/* ── BRUSH CURSOR — starts invisible, onPointerEnter/Leave toggles opacity via DOM */}
      {!isMobile&&!spaceHeld&&!isEyedropper&&!animPlaying&&!isTransformMode&&!(isLassoMode&&lassoPhase==='drawing')&&(
        <div ref={cursorDivRef} style={{position:'fixed',pointerEvents:'none',left:0,top:0,transform:'translate(-50%,-50%)',zIndex:9999,opacity:isOverCanvas?1:0,transition:'opacity 60ms ease'}}>
          <div style={{width:brushSize*zoom,height:brushSize*zoom,borderRadius:brushType==='flat'?'4px':'50%',border:`1.5px solid ${DARK}`,background:`rgba(${color.join(',')},0.18)`,boxShadow:`0 0 0 1px rgba(255,255,255,.5)`}}/>
        </div>
      )}

      <div style={{width:'100vw',height:'100vh',overflow:'hidden',position:'relative'}}>

        {/* ══ SIDEBAR ══════════════════════════════════════════════════════════ */}
        <div style={{position:'fixed',left:0,top:0,bottom:0,width:54,background:CREAM,borderRight:BORDER,display:isMobile?'none':'flex',flexDirection:'column',alignItems:'center',padding:'10px 0',zIndex:200,gap:4}}>

          {/* Profile avatar — ALWAYS editable (guest or signed in) */}
          <div ref={profilePopRef} style={{position:'relative',marginBottom:6}}>
            <button onClick={()=>{setEditNameVal(userName);setShowProfile(p=>!p);setShowAuthForm(false);setAuthError('');}}
              style={{width:34,height:34,borderRadius:9,background:authUser?LIME:DARK,border:BORDER,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:authUser?DARK:WHITE,flexShrink:0,fontFamily:"'Space Grotesk',sans-serif"}}>
              {userName.charAt(0).toUpperCase()}
            </button>
            {authUser&&<span style={{position:'absolute',bottom:-1,right:-1,width:7,height:7,borderRadius:'50%',background:'#22c55e',border:`1.5px solid ${CREAM}`}}/>}

            {showProfile&&(
              <div style={{position:'absolute',left:46,top:0,width:270,zIndex:600,animation:'sl 180ms cubic-bezier(0.34,1.56,0.64,1)'}} className="pop">
                <div style={{padding:'16px'}}>

                  {/* ── Name section — available to ALL users */}
                  <div style={{marginBottom:14,paddingBottom:14,borderBottom:BORDER}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                      <div style={{width:32,height:32,borderRadius:8,background:LIME,border:BORDER,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,color:DARK,flexShrink:0,fontFamily:"'Space Grotesk',sans-serif"}}>{userName.charAt(0).toUpperCase()}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:13,color:DARK}}>{userName}</div>
                        <div style={{fontSize:10,color:MUTED,fontFamily:"'Space Mono',monospace"}}>{authUser?authUser.email:'Guest'}</div>
                      </div>
                    </div>
                    <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,letterSpacing:1,marginBottom:5,fontWeight:700}}>DISPLAY NAME</div>
                    <div style={{display:'flex',gap:6}}>
                      <input value={editNameVal} onChange={e=>setEditNameVal(e.target.value)} onKeyDown={e=>e.key==='Enter'&&saveDisplayName()} placeholder="Your name..." className="inp" style={{flex:1,fontSize:12,padding:'7px 10px'}}/>
                      <button onClick={saveDisplayName} style={{...ibtn('lime'),width:36,height:36,borderRadius:8}}>
                        <Check size={13} strokeWidth={2.5}/>
                      </button>
                    </div>
                  </div>

                  {/* ── Auth section */}
                  {authUser?(
                    <button onClick={signOut} style={{...ibtn('default'),width:'100%',height:34,borderRadius:8,justifyContent:'center',gap:7,fontSize:12}}>
                      <LogOut size={12} strokeWidth={2}/> Sign Out
                    </button>
                  ):(
                    <>
                      {!showAuthForm?(
                        <button onClick={()=>setShowAuthForm(true)} style={{...ibtn('dark'),width:'100%',height:34,borderRadius:8,justifyContent:'center',gap:7,fontSize:12}}>
                          <LogIn size={12} strokeWidth={2}/> Sign In or Create Account
                        </button>
                      ):(
                        <div style={{animation:'slu 180ms ease'}}>
                          <div style={{display:'flex',gap:0,border:BORDER,borderRadius:8,overflow:'hidden',marginBottom:12}}>
                            {(['signin','signup'] as AuthMode[]).map(m=>(
                              <button key={m} onClick={()=>{setAuthMode(m);setAuthError('');}} style={{flex:1,height:30,border:'none',borderRight:m==='signin'?BORDER:'none',background:authMode===m?DARK:SAND,color:authMode===m?WHITE:MUTED,cursor:'pointer',fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:10,letterSpacing:.3}}>
                                {m==='signin'?'Sign In':'Sign Up'}
                              </button>
                            ))}
                          </div>
                          {authError&&<div style={{background:`${PINK}18`,border:`1.5px solid ${PINK}`,borderRadius:7,padding:'7px 10px',marginBottom:10,fontSize:11,color:PINK,fontWeight:600}}>{authError}</div>}
                          {authMode==='signup'&&(
                            <div style={{position:'relative',marginBottom:7}}>
                              <User size={12} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:MUTED}} strokeWidth={2}/>
                              <input value={authNameInput} onChange={e=>setAuthNameInput(e.target.value)} placeholder="Artist name" className="inp" style={{paddingLeft:28,fontSize:12,padding:'7px 10px 7px 28px'}}/>
                            </div>
                          )}
                          <div style={{position:'relative',marginBottom:7}}>
                            <Mail size={12} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:MUTED}} strokeWidth={2}/>
                            <input value={authEmail} onChange={e=>setAuthEmail(e.target.value)} type="email" placeholder="Email" className="inp" style={{paddingLeft:28,fontSize:12,padding:'7px 10px 7px 28px'}}/>
                          </div>
                          <div style={{position:'relative',marginBottom:10}}>
                            <Lock size={12} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:MUTED}} strokeWidth={2}/>
                            <input value={authPass} onChange={e=>setAuthPass(e.target.value)} type="password" placeholder="Password" className="inp" style={{paddingLeft:28,fontSize:12,padding:'7px 10px 7px 28px'}} onKeyDown={e=>e.key==='Enter'&&(authMode==='signin'?signIn():signUp())}/>
                          </div>
                          <button onClick={authMode==='signin'?signIn:signUp} disabled={authLoading} style={{...ibtn('dark'),width:'100%',height:36,borderRadius:8,justifyContent:'center',gap:7,opacity:authLoading?.6:1}}>
                            {authLoading?<div style={{width:12,height:12,border:`2px solid ${WHITE}`,borderTop:'2px solid transparent',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
                              :authMode==='signin'?<><LogIn size={12} strokeWidth={2}/> Sign In</>:<><UserPlus size={12} strokeWidth={2}/> Create Account</>}
                          </button>
                          <button onClick={()=>{setShowAuthForm(false);setAuthError('');}} style={{...ibtn('ghost'),width:'100%',justifyContent:'center',marginTop:4,fontSize:11}}>Back</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{width:28,height:1.5,background:DARK,opacity:.15,marginBottom:2}}/>

          {/* Sidebar tool buttons */}
          {[
            {icon:<Users size={15} strokeWidth={2}/>,active:showInvite,cb:()=>setShowInvite(p=>!p),hide:workspace==='animate',badge:isConnected,tip:'Collaborate'},
            {icon:<Music2 size={15} strokeWidth={2}/>,active:showMusic,cb:()=>setShowMusic(p=>!p),tip:'Music'},
            {icon:<ImageIcon size={15} strokeWidth={2}/>,active:showRef,cb:()=>setShowRef(p=>!p),tip:'Reference'},
          ].filter((x:any)=>!x.hide).map((item:any)=>(
            <button key={item.tip} onClick={item.cb} style={{...sidebtn(item.active),marginBottom:2}} title={item.tip}>
              {item.icon}
              {item.badge&&<span style={{position:'absolute',top:4,right:4,width:6,height:6,borderRadius:'50%',background:LIME,border:`1.5px solid ${CREAM}`,animation:'pulse 2s ease infinite'}}/>}
            </button>
          ))}

          <div style={{width:28,height:1.5,background:DARK,opacity:.15,margin:'4px 0'}}/>

          <button onClick={()=>{if(isTransformMode){cancelTransform();}else{if(isLassoMode){setIsLassoMode(false);isLassoRef.current=false;setLassoPath([]);lassoPathRef.current=[];}setIsTransformMode(true);isTransformRef.current=true;setIsEyedropper(false);}}} style={{...sidebtn(isTransformMode),marginBottom:2}} title="Transform [T]"><Move size={15} strokeWidth={2}/></button>
          <button onClick={()=>{if(isLassoMode){setIsLassoMode(false);isLassoRef.current=false;setLassoPath([]);lassoPathRef.current=[];lassoDrawRef.current=false;lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';}else{if(isTransformMode)cancelTransform();setIsLassoMode(true);isLassoRef.current=true;setIsEyedropper(false);setLassoPhase('drawing');lassoPhaseRef.current='drawing';lassoMaskRef.current=null;}}} style={{...sidebtn(isLassoMode),marginBottom:2}} title="Lasso Select [L]"><Lasso size={15} strokeWidth={2}/></button>
          <button ref={brushLibBtnRef} onClick={()=>{setShowBrushLib(p=>!p);setShowBrushAdv(false);setShowSurface(false);setShowColorPanel(false);}} style={{...sidebtn(showBrushLib),marginBottom:2}} title="Brush Library">
            {selectedCustom?<Paintbrush2 size={15} strokeWidth={2}/>:<BrushIcon type={brushType} size={15}/>}
          </button>
          <button onClick={()=>setIsEyedropper(p=>!p)} style={{...sidebtn(isEyedropper),marginBottom:2}} title="Eyedropper [Alt+E]"><Pipette size={15} strokeWidth={2}/></button>
          <button onClick={cycleSymmetry} style={{...sidebtn(symmetry!=='none'),marginBottom:2}} title={`Symmetry: ${symmetry}`}>
            <Spline size={14} strokeWidth={2}/>
            {symmetry!=='none'&&<span style={{position:'absolute',bottom:3,right:3,fontSize:6,fontFamily:"'Space Mono',monospace",fontWeight:700,lineHeight:1}}>{symmetry==='vertical'?'V':symmetry==='horizontal'?'H':'+'}</span>}
          </button>
          <button onClick={()=>setShowCanvasSize(p=>!p)} style={{...sidebtn(showCanvasSize),marginBottom:2}} title="Canvas Size"><Expand size={14} strokeWidth={2}/></button>
          <button ref={surfaceBtnRef} onClick={()=>{setShowSurface(p=>!p);setShowBrushAdv(false);setShowColorPanel(false);setShowBrushLib(false);}} style={{...sidebtn(showSurface),marginBottom:2}} title={`Surface: ${currentSurface.label}`}>
            <div style={{width:18,height:18,borderRadius:5,background:`rgb(${currentSurface.paper.join(',')})`,display:'flex',alignItems:'center',justifyContent:'center'}}><SurfaceIcon type={surface} size={11}/></div>
          </button>

          <div style={{width:28,height:1.5,background:DARK,opacity:.15,margin:'4px 0'}}/>

          <button ref={layerBtnRef} onClick={()=>{if(layerBtnRef.current){const r=layerBtnRef.current.getBoundingClientRect();const top=Math.min(r.top,window.innerHeight-400);setLayerPanelTop(Math.max(top,8));}setShowLayerPanel(p=>!p);}} style={sidebtn(showLayerPanel)} title="Layers"><Layers size={15} strokeWidth={2}/></button>
          <button onClick={()=>setShowGallery(p=>!p)} style={sidebtn(showGallery)} title="Gallery [G]"><LayoutGrid size={15} strokeWidth={2}/></button>

          <div style={{flex:1}}/>
          <div style={{width:28,height:1.5,background:DARK,opacity:.15,marginBottom:6}}/>
          <button onClick={()=>setShowHelp(p=>!p)} style={sidebtn(showHelp)} title="Shortcuts [?]"><HelpCircle size={14} strokeWidth={2}/></button>
        </div>

        {/* ══ HEADER ═══════════════════════════════════════════════════════════ */}
        <div style={{position:'fixed',left:sideW,right:0,top:0,height:headerH,background:WHITE,borderBottom:BORDER,display:'flex',alignItems:'center',padding:isMobile?'0 10px':'0 16px',zIndex:150,gap:isMobile?6:12}}>

          {/* Mobile hamburger */}
          {isMobile&&<button onClick={()=>setMobileDrawer(true)} style={{width:32,height:32,border:BORDER,borderRadius:8,background:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Menu size={15} strokeWidth={2}/></button>}

          {/* Logo */}
          <div style={{display:'flex',alignItems:'baseline',gap:0,flexShrink:0,userSelect:'none'}}>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:isMobile?13:16,fontWeight:800,color:DARK,letterSpacing:-0.8,lineHeight:1}}>me</span>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:isMobile?13:16,fontWeight:400,color:MUTED,letterSpacing:-0.4,lineHeight:1}}>paint</span>
          </div>

          {!isMobile&&<div style={{width:1,height:22,background:DARK,opacity:.12,flexShrink:0}}/>}

          {/* Workspace tabs */}
          <div style={{display:'flex',gap:4,flexShrink:0}}>
            <button className="ws-tab" onClick={()=>switchWorkspace('paint')}
              style={{background:workspace==='paint'?DARK:SAND,color:workspace==='paint'?WHITE:MUTED,border:workspace==='paint'?BORDER:`1.5px solid ${SAND}`}}>
              <Paintbrush2 size={12} strokeWidth={2}/>{!isMobile&&' Paint'}
            </button>
            <button className="ws-tab" onClick={()=>switchWorkspace('animate')}
              style={{background:workspace==='animate'?LIME:SAND,color:workspace==='animate'?DARK:MUTED,border:workspace==='animate'?BORDER:`1.5px solid ${SAND}`}}>
              <Film size={12} strokeWidth={2}/>{!isMobile&&' Animate'}
            </button>
          </div>

          {!isMobile&&<div style={{width:1,height:22,background:DARK,opacity:.12,flexShrink:0}}/>}

          {/* Status pills */}
          <div style={{display:isMobile?'none':'flex',alignItems:'center',gap:5,flexShrink:0}}>
            {workspace==='animate'?(
              <>
                <span className="pill" style={{background:LIME,color:DARK}}>F {animFrame+1} / {Math.max(1,animFrames.length)}</span>
                <span className="pill" style={{background:SAND,color:MUTED}}>{animFps} FPS</span>
                {animPlaying&&<span className="pill" style={{background:DARK,color:WHITE}}>PLAYING</span>}
                {isRecording&&<span className="pill" style={{background:PINK,color:WHITE}}>REC</span>}
              </>
            ):(
              <>
                <span className="pill" style={{background:LIME,color:DARK}}>{activeBrushLabel.toUpperCase()}</span>
                {smudgeMode&&<span className="pill" style={{background:DARK,color:WHITE}}>SMUDGE</span>}
                {isEyedropper&&<span className="pill" style={{background:ACCENT,color:WHITE}}>PICK</span>}
                {isTransformMode&&<span className="pill" style={{background:DARK,color:LIME}}>{txPhase==='select'?'SELECT AREA':'TRANSFORM'}</span>}
                {isLassoMode&&<span className="pill" style={{background:DARK,color:LIME}}>{lassoPhase==='painting'?'LASSO PAINT':'LASSO'}</span>}
                {(flipH||flipV)&&<span className="pill" style={{background:SAND,color:MUTED}}>{flipH&&flipV?'H+V FLIP':flipH?'H FLIP':'V FLIP'}</span>}
                {symmetry!=='none'&&<span className="pill" style={{background:SAND,color:MUTED}}>{symmetry.toUpperCase()} SYM</span>}
              </>
            )}
          </div>

          <div style={{flex:1}}/>

          {/* Canvas size display */}
          {!isMobile&&<button onClick={()=>setShowCanvasSize(p=>!p)} style={{display:'flex',alignItems:'center',gap:5,background:SAND,border:`1.5px solid ${DARK}`,borderRadius:7,padding:'4px 10px',cursor:'pointer',color:MUTED,fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,letterSpacing:.5}}>
            <Maximize size={9} strokeWidth={2}/>{canvasW}×{canvasH}
          </button>}

          {/* Flip buttons */}
          {!isMobile&&[{icon:<FlipHIcon size={12}/>,active:flipH,cb:()=>setFlipH(p=>!p),tip:'Flip H [F]'},{icon:<FlipVIcon size={12}/>,active:flipV,cb:()=>setFlipV(p=>!p),tip:'Flip V [V]'}].map((b,i)=>(
            <button key={i} onClick={b.cb} title={b.tip} style={{width:28,height:28,border:BORDER,borderRadius:7,background:b.active?LIME:SAND,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              {b.icon}
            </button>
          ))}

          {!isMobile&&<div style={{width:1,height:22,background:DARK,opacity:.12,flexShrink:0}}/>}

          {/* Zoom */}
          <div style={{display:'flex',alignItems:'center',gap:isMobile?2:3,flexShrink:0}}>
            <button onClick={()=>zoomAt(window.innerWidth/2,window.innerHeight/2,.8)} style={{width:isMobile?24:26,height:isMobile?24:26,border:BORDER,background:SAND,borderRadius:6,cursor:'pointer',color:DARK,display:'flex',alignItems:'center',justifyContent:'center'}}><ZoomOut size={isMobile?10:11}/></button>
            <button onClick={resetZoom} style={{background:SAND,border:`1.5px solid ${DARK}`,cursor:'pointer',color:MUTED,fontFamily:"'Space Mono',monospace",fontSize:isMobile?8:9,minWidth:isMobile?34:42,textAlign:'center',padding:isMobile?'3px 4px':'4px 6px',borderRadius:5,fontWeight:700}}>{Math.round(zoom*100)}%</button>
            <button onClick={()=>zoomAt(window.innerWidth/2,window.innerHeight/2,1.25)} style={{width:isMobile?24:26,height:isMobile?24:26,border:BORDER,background:SAND,borderRadius:6,cursor:'pointer',color:DARK,display:'flex',alignItems:'center',justifyContent:'center'}}><ZoomIn size={isMobile?10:11}/></button>
          </div>

          {/* Online users in header */}
          {!isMobile&&workspace==='paint'&&isConnected&&onlineUsers.length>0&&(
            <div style={{display:'flex',gap:3,flexShrink:0}}>
              {onlineUsers.filter(u=>u.uid!==myUid.current).slice(0,4).map(u=>(<div key={u.uid} title={u.name} style={{width:24,height:24,borderRadius:7,background:u.color,border:BORDER,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:WHITE,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif"}}>{u.name.charAt(0)}</div>))}
            </div>
          )}
        </div>

        {/* ══ WORKSPACE + CANVAS ═══════════════════════════════════════════════ */}
        {/* Full workspace — used as coordinate reference for pan/zoom/cursors */}
        <div ref={containerRef} style={{
          position:'fixed',left:sideW,top:headerH,right:0,bottom:animBottom,
          overflow:'hidden',zIndex:10,touchAction:'none',
          backgroundImage:`radial-gradient(circle, rgba(13,11,7,.08) 1px, transparent 1px)`,
          backgroundSize:'24px 24px',backgroundColor:CREAM,
          cursor:(isLassoMode&&lassoPhase==='drawing')?`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cellipse cx='13' cy='10' rx='9' ry='7' fill='none' stroke='%230D0B07' stroke-width='2.2'/%3E%3Cpath d='M20 15 L20 24 M17.5 21.5 L20 24 L22.5 21.5' fill='none' stroke='%230D0B07' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 13 10, crosshair`:(isTransformMode&&txPhase==='select')?`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Crect x='1' y='1' width='20' height='20' rx='1.5' fill='none' stroke='%230D0B07' stroke-width='1.5' stroke-dasharray='3.5 2'/%3E%3Cline x1='11' y1='3' x2='11' y2='19' stroke='%230D0B07' stroke-width='1.2'/%3E%3Cline x1='3' y1='11' x2='19' y2='11' stroke='%230D0B07' stroke-width='1.2'/%3E%3C/svg%3E") 11 11, crosshair`:isEyedropper?'crosshair':spaceHeld?'grab':'default'}}>

          {/* Pan/zoom wrapper — the canvas panel floats directly inside the workspace */}
          <div style={{position:'absolute',top:0,left:0,transformOrigin:'0 0',transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`,willChange:'transform'}}>

            {/* Single floating canvas panel: drag handle + drawing canvas, tightly fitted */}
            <div style={{display:'inline-flex',flexDirection:'column',border:BORDER,borderRadius:10,overflow:'hidden',verticalAlign:'top'}}>

              {/* Drag handle — grab here to reposition canvas */}
              <div onMouseDown={startCanvasDrag} style={{height:isMobile?20:24,background:DARK,display:'flex',alignItems:'center',padding:'0 8px',cursor:'move',flexShrink:0,gap:6,userSelect:'none'}}>
                <GripVertical size={isMobile?10:12} color="rgba(255,255,255,.5)" strokeWidth={2}/>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:isMobile?6:7.5,color:'rgba(255,255,255,.55)',fontWeight:700,letterSpacing:1.2,flex:1}}>{isMobile?'DRAG TO MOVE':'CANVAS — DRAG TO MOVE'}</span>
                <button onClick={resetZoom} title="Re-center canvas"
                  style={{background:'rgba(255,255,255,.08)',border:'none',cursor:'pointer',color:'rgba(255,255,255,.4)',display:'flex',alignItems:'center',padding:'2px 5px',borderRadius:4,gap:3}}>
                  <RotateCcw size={8} strokeWidth={2}/><span style={{fontFamily:"'Space Mono',monospace",fontSize:6.5,fontWeight:700,letterSpacing:.5}}>CENTER</span>
                </button>
              </div>

              {/* Drawing canvas — the only white surface */}
              <div style={{transform:`scaleX(${flipH?-1:1}) scaleY(${flipV?-1:1})`,transformOrigin:'50% 50%',display:'block',position:'relative',lineHeight:0}}>
                <canvas ref={canvasRef} onPointerDown={handleCanvasDown}
                  onPointerEnter={()=>{setIsOverCanvas(true);const cd=cursorDivRef.current;if(cd)cd.style.opacity='1';}}
                  onPointerLeave={()=>{setIsOverCanvas(false);const cd=cursorDivRef.current;if(cd)cd.style.opacity='0';}}
                  style={{display:'block',cursor:(isLassoMode&&lassoPhase==='drawing')||isTransformMode||isEyedropper||spaceHeld?'inherit':'none',userSelect:'none',WebkitUserSelect:'none',touchAction:'none'}}/>
                <canvas ref={onionCanvasRef} style={{position:'absolute',top:0,left:0,width:canvasW,height:canvasH,pointerEvents:'none',opacity:.28,display:workspace==='animate'&&showOnion?'block':'none'}}/>
                {symmetry!=='none'&&canvasRef.current&&(()=>{const W=canvasRef.current.offsetWidth,H=canvasRef.current.offsetHeight;return(<>{(symmetry==='vertical'||symmetry==='both')&&<div style={{position:'absolute',left:W/2-.5,top:0,width:1,height:H,background:ACCENT,opacity:.3,pointerEvents:'none'}}/>}{(symmetry==='horizontal'||symmetry==='both')&&<div style={{position:'absolute',top:H/2-.5,left:0,height:1,width:W,background:ACCENT,opacity:.3,pointerEvents:'none'}}/>}</>);})()}
                {/* ── Lasso path overlay */}
                {isLassoMode&&lassoPath.length>1&&(()=>{
                  const d=lassoPath.map((p,i)=>`${i===0?'M':'L'}${p.x} ${p.y}`).join(' ')+'Z';
                  const sw=Math.max(0.5,1.5/zoom);
                  if(lassoPhase==='painting'){
                    // Painting phase: solid lime outline + subtle fill, action bar
                    const minX=Math.min(...lassoPath.map(p=>p.x)),minY=Math.min(...lassoPath.map(p=>p.y));
                    return(
                      <>
                        <svg style={{position:'absolute',inset:0,width:canvasW,height:canvasH,pointerEvents:'none',overflow:'visible',zIndex:20}}>
                          <path d={d} fill="rgba(196,255,69,0.07)" stroke="rgba(13,11,7,0.4)" strokeWidth={sw*2} strokeLinejoin="round" strokeLinecap="round"/>
                          <path d={d} fill="none" stroke={LIME} strokeWidth={sw*1.5} strokeLinejoin="round" strokeLinecap="round"/>
                          <circle cx={lassoPath[0].x} cy={lassoPath[0].y} r={Math.max(2,4/zoom)} fill={LIME} stroke={DARK} strokeWidth={sw}/>
                        </svg>
                        {/* Lasso paint action bar */}
                        <div style={{position:'absolute',left:minX,top:Math.max(0,minY-38),pointerEvents:'auto',zIndex:30,display:'flex',gap:4}}>
                          <button onClick={()=>{lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';commitLassoSelRef.current();}} style={{height:26,padding:'0 10px',border:BORDER,borderRadius:7,background:DARK,color:LIME,cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,letterSpacing:.4,display:'flex',alignItems:'center',gap:4}}><Move size={9} strokeWidth={2.5}/>TRANSFORM</button>
                          <button onClick={exitLassoPaint} style={{height:26,padding:'0 10px',border:BORDER,borderRadius:7,background:WHITE,color:DARK,cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,letterSpacing:.4,display:'flex',alignItems:'center',gap:4}}><Check size={9} strokeWidth={2.5}/>DONE</button>
                          <button onClick={()=>{lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';setLassoPath([]);lassoPathRef.current=[];setIsLassoMode(false);isLassoRef.current=false;}} style={{height:26,padding:'0 8px',border:BORDER,borderRadius:7,background:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center'}}><X size={9} strokeWidth={2.5}/></button>
                        </div>
                      </>
                    );
                  }
                  return(
                    <svg style={{position:'absolute',inset:0,width:canvasW,height:canvasH,pointerEvents:'none',overflow:'visible',zIndex:20}}>
                      {/* Shadow stroke for contrast on light areas */}
                      <path d={d} fill="rgba(196,255,69,0.12)" stroke="rgba(13,11,7,0.5)" strokeWidth={sw*2.5} strokeLinejoin="round" strokeLinecap="round" fillRule="evenodd"/>
                      {/* Lime dashed stroke */}
                      <path d={d} fill="rgba(196,255,69,0.12)" stroke={LIME} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={`${5/zoom} ${3/zoom}`}/>
                      {/* Closing line indicator */}
                      {lassoPath.length>2&&(
                        <line x1={lassoPath[lassoPath.length-1].x} y1={lassoPath[lassoPath.length-1].y} x2={lassoPath[0].x} y2={lassoPath[0].y} stroke={LIME} strokeWidth={sw*0.6} strokeDasharray={`${3/zoom} ${3/zoom}`} opacity={0.5}/>
                      )}
                      {/* Start point dot */}
                      <circle cx={lassoPath[0].x} cy={lassoPath[0].y} r={Math.max(2,4/zoom)} fill={LIME} stroke={DARK} strokeWidth={sw}/>
                    </svg>
                  );
                })()}
                {/* ── Transform overlay */}
                {isTransformMode&&txRect&&(()=>{
                  const nr={x:Math.min(txRect.x,txRect.x+txRect.w),y:Math.min(txRect.y,txRect.y+txRect.h),w:Math.abs(txRect.w),h:Math.abs(txRect.h)};
                  if(nr.w<1||nr.h<1) return null;
                  const HS=8;
                  const handles=txPhase==='active'?[
                    {id:'nw',cx:-HS/2,cy:-HS/2},{id:'n',cx:nr.w/2-HS/2,cy:-HS/2},{id:'ne',cx:nr.w-HS/2,cy:-HS/2},
                    {id:'w',cx:-HS/2,cy:nr.h/2-HS/2},{id:'e',cx:nr.w-HS/2,cy:nr.h/2-HS/2},
                    {id:'sw',cx:-HS/2,cy:nr.h-HS/2},{id:'s',cx:nr.w/2-HS/2,cy:nr.h-HS/2},{id:'se',cx:nr.w-HS/2,cy:nr.h-HS/2},
                  ]:[];
                  const hCursor=(id:string)=>{if(id==='nw'||id==='se') return 'nwse-resize';if(id==='ne'||id==='sw') return 'nesw-resize';if(id==='n'||id==='s') return 'ns-resize';return 'ew-resize';};
                  return(
                    <div style={{position:'absolute',left:nr.x,top:nr.y,width:nr.w,height:nr.h,
                      border:txPhase==='select'?`1.5px dashed ${DARK}`:`1.5px solid ${LIME}`,
                      pointerEvents:txPhase==='active'?'auto':'none',cursor:'move',zIndex:20,boxSizing:'border-box'}}
                      onPointerDown={txPhase==='active'?(e)=>{e.stopPropagation();txDsRef.current={active:true,type:'moving',handle:'move',startCX:e.clientX,startCY:e.clientY,startRect:{...txRectRef.current!}};}:undefined}>
                      {/* Preview image */}
                      {txPhase==='active'&&txPreviewUrl&&(
                        <img src={txPreviewUrl} draggable={false} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'fill',imageRendering:'pixelated',userSelect:'none',pointerEvents:'none'}}/>
                      )}
                      {/* Selection animation for select phase */}
                      {txPhase==='select'&&<div style={{position:'absolute',inset:0,border:`1.5px dashed ${WHITE}`,animation:'marchAnts 0.4s linear infinite',pointerEvents:'none'}}/>}
                      {/* Corner + edge handles */}
                      {handles.map(h=>(
                        <div key={h.id} style={{position:'absolute',left:h.cx,top:h.cy,width:HS,height:HS,background:WHITE,border:`1.5px solid ${LIME}`,borderRadius:2,cursor:hCursor(h.id),zIndex:21}}
                          onPointerDown={(e)=>{e.stopPropagation();e.preventDefault();txDsRef.current={active:true,type:'resizing',handle:h.id,startCX:e.clientX,startCY:e.clientY,startRect:{...txRectRef.current!}};}}/>
                      ))}
                      {/* Action bar */}
                      {txPhase==='active'&&(
                        <div style={{position:'absolute',top:'100%',left:0,marginTop:8,display:'flex',gap:4,pointerEvents:'auto',zIndex:30}}>
                          <button onClick={applyTransform} style={{height:28,padding:'0 12px',border:BORDER,borderRadius:7,background:LIME,color:DARK,cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,letterSpacing:.3,display:'flex',alignItems:'center',gap:5}}>
                            <Check size={10} strokeWidth={2.5}/>APPLY</button>
                          <button onClick={cancelTransform} style={{height:28,padding:'0 12px',border:BORDER,borderRadius:7,background:WHITE,color:DARK,cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,letterSpacing:.3,display:'flex',alignItems:'center',gap:5}}>
                            <X size={10} strokeWidth={2.5}/>CANCEL</button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

            </div>
          </div>

          {/* Remote cursors — positioned in workspace space */}
          {Array.from(remoteCursors.entries()).map(([uid,cursor])=>{const sx=cursor.x*zoom+pan.x,sy=cursor.y*zoom+pan.y+24*zoom;if(sx<-20||sy<-20||sx>8000||sy>8000) return null;return(<div key={uid} style={{position:'absolute',left:sx,top:sy,transform:'translate(-2px,-2px)',pointerEvents:'none',zIndex:50}}><div style={{width:10,height:10,borderRadius:'50%',background:cursor.color,border:`1.5px solid ${DARK}`}}/><div style={{position:'absolute',top:13,left:4,whiteSpace:'nowrap',background:cursor.color,color:WHITE,fontSize:9,fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,padding:'2px 6px',borderRadius:4,border:BORDER}}>{cursor.name}</div></div>);})}

        </div>{/* end workspace */}

        {/* ══ ANIMATION STRIP ══════════════════════════════════════════════════ */}
        {workspace==='animate'&&(
          <div style={{position:'fixed',left:sideW,right:0,bottom:toolH,height:isMobile?64:72,background:SAND,borderTop:BORDER,borderBottom:BORDER,display:'flex',alignItems:'center',padding:isMobile?'0 6px':'0 12px',gap:isMobile?4:8,zIndex:148,animation:'slu 280ms ease'}}>

            <button onClick={()=>{setShowOnion(p=>{const n=!p;showOnionRef.current=n;updateOnionSkin(animFrameRef.current);return n;});}} style={{...ibtn('default',showOnion),width:40,height:52,borderRadius:9,flexDirection:'column',gap:2,fontSize:9,fontFamily:"'Space Mono',monospace",letterSpacing:.5}}>
              <Eye size={12} strokeWidth={2}/>{showOnion?'ON':'OFF'}
            </button>

            <div style={{width:1,height:36,background:DARK,opacity:.1,flexShrink:0}}/>

            <div className="sb" style={{display:'flex',gap:5,flex:1,overflowX:'auto',alignItems:'center',padding:'3px 0'}}>
              {animFrames.map((frame,i)=>(
                <div key={i} className={`anim-thumb${i===animFrame?' sel':''}`} onClick={()=>{if(animPlaying) return;saveCurrentAnimFrame();loadAnimFrame(i);}} style={{width:68,height:50,background:WHITE}}>
                  <img src={frame} alt={`F${i+1}`} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                  <div style={{position:'absolute',bottom:2,left:2,background:DARK,color:WHITE,fontFamily:"'Space Mono',monospace",fontSize:7,padding:'1px 4px',borderRadius:3}}>{i+1}</div>
                  {animFrames.length>1&&!animPlaying&&<button className="rm" onClick={e=>{e.stopPropagation();deleteAnimFrame(i);}}>×</button>}
                </div>
              ))}
              {!animPlaying&&(
                <div style={{display:'flex',gap:4,flexShrink:0}}>
                  {[{label:'BLANK',icon:<Plus size={12}/>,cb:()=>addAnimFrame(false)},{label:'DUP',icon:<Copy size={10}/>,cb:()=>addAnimFrame(true)}].map(({label,icon,cb})=>(
                    <button key={label} onClick={cb} style={{width:44,height:50,border:`1.5px dashed ${DARK}`,borderRadius:8,background:'transparent',color:MUTED,cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,fontSize:8,fontFamily:"'Space Mono',monospace",fontWeight:700,letterSpacing:.3}}>
                      {icon}{label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{width:1,height:36,background:DARK,opacity:.1,flexShrink:0}}/>

            {/* Playback controls */}
            <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
              <button onClick={()=>{saveCurrentAnimFrame();loadAnimFrame(Math.max(0,animFrameRef.current-1));}} disabled={animPlaying} style={{...ibtn('default'),width:28,height:32,borderRadius:7,opacity:animPlaying?.4:1}}><ChevronLeft size={13} strokeWidth={2}/></button>
              <button onClick={animPlaying?stopPlayback:startPlayback} style={{...ibtn(animPlaying?'lime':'dark'),width:44,height:44,borderRadius:10}}>
                {animPlaying?<Pause size={17} strokeWidth={2.5}/>:<Play size={17} strokeWidth={2.5}/>}
              </button>
              <button onClick={()=>{saveCurrentAnimFrame();loadAnimFrame(Math.min(animFrames.length-1,animFrameRef.current+1));}} disabled={animPlaying} style={{...ibtn('default'),width:28,height:32,borderRadius:7,opacity:animPlaying?.4:1}}><ChevronRight size={13} strokeWidth={2}/></button>
            </div>

            <div style={{width:1,height:36,background:DARK,opacity:.1,flexShrink:0}}/>

            {/* FPS */}
            <div style={{flexShrink:0,minWidth:80}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,fontWeight:700,letterSpacing:.5}}>FPS</span>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:DARK,fontWeight:700}}>{animFps}</span>
              </div>
              <input type="range" min={1} max={30} value={animFps} onChange={e=>{const v=+e.target.value;setAnimFps(v);animFpsRef.current=v;}} style={{width:'100%',background:`linear-gradient(to right,${DARK} ${(animFps-1)/29*100}%,rgba(0,0,0,.1) 0%)`}}/>
            </div>

            <div style={{width:1,height:36,background:DARK,opacity:.1,flexShrink:0}}/>

            {/* Export */}
            <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
              <button onClick={exportAnimSvg} style={{...ibtn('default'),height:22,padding:'0 9px',borderRadius:6,fontSize:9,fontFamily:"'Space Mono',monospace",fontWeight:700,letterSpacing:.3}}>
                <FileImage size={9} strokeWidth={2}/> SVG
              </button>
              <button onClick={exportAnimVideo} disabled={isRecording} style={{...ibtn(isRecording?'danger':'lime'),height:22,padding:'0 9px',borderRadius:6,fontSize:9,fontFamily:"'Space Mono',monospace",fontWeight:700,letterSpacing:.3,opacity:isRecording?.6:1}}>
                <Video size={9} strokeWidth={2}/> {isRecording?'REC…':'VIDEO'}
              </button>
            </div>
          </div>
        )}

        {/* ══ MUSIC PANEL ═══════════════════════════════════════���══════════════ */}
        {showMusic&&(
          <div style={{position:'fixed',left:isMobile?8:musicPos.x,top:isMobile?headerH+8:musicPos.y,right:isMobile?8:undefined,width:isMobile?'auto':288,maxWidth:isMobile?'calc(100vw - 16px)':undefined,zIndex:220,animation:'slu 220ms ease'}}>
            <div className="pop">
              <div onMouseDown={e=>startDrag(e,musicPos,setMusicPos)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px 9px',borderBottom:BORDER,cursor:'move',userSelect:'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:7,fontWeight:700,fontSize:13,color:DARK}}>
                  <GripVertical size={12} color={MUTED} strokeWidth={2}/>
                  <Music2 size={13} strokeWidth={2}/> Studio Music
                </div>
                <button onClick={()=>setShowMusic(false)} style={{...ibtn('ghost'),width:24,height:24}}><X size={12} strokeWidth={2}/></button>
              </div>
              <div style={{background:'#0C0A16',height:130,position:'relative',overflow:'hidden'}}>
                {videoId?(<iframe ref={ytIframeRef} key={videoId} src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1`} width="100%" height="100%" style={{border:'none',display:'block'}} allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen/>):(
                  <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8}}><Music2 size={20} color="rgba(255,255,255,.15)" strokeWidth={1.5}/><span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:'rgba(255,255,255,.18)',letterSpacing:1.5}}>PASTE A YOUTUBE LINK</span></div>
                )}
              </div>
              <div style={{padding:'10px 12px',display:'flex',gap:6}}>
                <input ref={ytInputRef} className="inp" placeholder="youtube.com/watch?v=..." value={ytUrl} onChange={e=>setYtUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loadVideo()} style={{fontSize:11,padding:'7px 10px'}}/>
                <button onClick={loadVideo} style={{...ibtn('dark'),width:34,height:34,borderRadius:7,flexShrink:0}}><ChevronRight size={13} strokeWidth={2}/></button>
              </div>
              <div style={{display:'flex',justifyContent:'center',gap:8,padding:'0 12px 12px'}}>
                <button onClick={()=>{ytCtrl('seekTo',[0,true]);setIsPlaying(true);}} disabled={!videoId} style={{...ibtn('default'),width:30,height:30,opacity:videoId?1:.3}}><SkipBack size={11} strokeWidth={2}/></button>
                <button onClick={togglePlay} disabled={!videoId} style={{...ibtn(isPlaying?'lime':'dark'),width:38,height:38,borderRadius:10,opacity:videoId?1:.3}}>{isPlaying?<Pause size={14} strokeWidth={2.5}/>:<Play size={14} strokeWidth={2.5}/>}</button>
                <button onClick={()=>{setVideoId(null);setIsPlaying(false);}} disabled={!videoId} style={{...ibtn('default'),width:30,height:30,opacity:videoId?1:.3}}><X size={11} strokeWidth={2}/></button>
              </div>
            </div>
          </div>
        )}

        {/* ══ REFERENCE ════════════════════════════════════════════════════════ */}
        {showRef&&(
          <div style={{position:'fixed',left:isMobile?8:refPos.x,top:isMobile?headerH+8:refPos.y,right:isMobile?8:undefined,width:isMobile?'auto':refSize.w,maxWidth:isMobile?'calc(100vw - 16px)':undefined,zIndex:220,animation:'su 200ms ease'}}>
            <div className="pop" style={{overflow:'hidden'}}>
              <div onMouseDown={e=>startDrag(e,refPos,setRefPos)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',borderBottom:BORDER,background:SAND,cursor:'move',userSelect:'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,fontWeight:700,fontSize:12,color:DARK}}>
                  <GripVertical size={12} color={MUTED} strokeWidth={2}/>
                  <ImageIcon size={13} strokeWidth={2}/> Reference
                </div>
                <div style={{display:'flex',gap:4}}>
                  {refImage&&<button onClick={()=>setRefFit(f=>f==='cover'?'contain':'cover')} style={{background:WHITE,border:BORDER,cursor:'pointer',color:DARK,fontSize:9,fontFamily:"'Space Mono',monospace",fontWeight:700,padding:'2px 8px',borderRadius:5}}>{refFit==='cover'?'FILL':'FIT'}</button>}
                  <button onClick={()=>fileInputRef.current?.click()} style={{...ibtn('default'),width:26,height:26,borderRadius:6}}><Upload size={10} strokeWidth={2}/></button>
                  <button onClick={()=>setShowRef(false)} style={{...ibtn('ghost'),width:24,height:24}}><X size={11} strokeWidth={2}/></button>
                </div>
              </div>
              <div style={{height:refSize.h,position:'relative',background:refImage?'#111':SAND,cursor:refImage?'default':'pointer'}} onClick={!refImage?()=>fileInputRef.current?.click():undefined}>
                {refImage?(<><img src={refImage} alt="ref" style={{width:'100%',height:'100%',objectFit:refFit,display:'block'}}/><div className="rov" onClick={()=>fileInputRef.current?.click()}><span>Change image</span></div></>):(
                  <div style={{width:'100%',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10}}><div style={{width:40,height:40,border:`1.5px dashed ${MUTED}`,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center'}}><Upload size={16} color={MUTED} strokeWidth={1.5}/></div><span style={{fontSize:12,color:MUTED,fontWeight:600}}>Click to load reference</span></div>
                )}
              </div>
              <div style={{display:'flex',gap:6,padding:'8px 12px',borderTop:BORDER,alignItems:'center',background:SAND}}>
                <Minus size={9} color={MUTED}/>
                <input type="range" min={140} max={560} value={(refSize.w+refSize.h)/2} onChange={e=>{const v=+e.target.value,r=refSize.h/Math.max(1,refSize.w);setRefSize({w:v,h:Math.round(v*r)});}} style={{flex:1,background:`linear-gradient(to right,${DARK} ${((refSize.w+refSize.h)/2-140)/(560-140)*100}%,rgba(0,0,0,.1) 0%)`}}/>
                <Eye size={9} color={MUTED}/>
                <div onMouseDown={e=>{e.preventDefault();refResizeRef.current={startX:e.clientX,startY:e.clientY,startW:refSize.w,startH:refSize.h};}} style={{cursor:'nwse-resize',padding:4,opacity:.4}}>
                  <svg width="9" height="9" viewBox="0 0 9 9" fill={DARK}><rect x="5.5" y="0" width="1.4" height="1.4" rx=".4"/><rect x="0" y="5.5" width="1.4" height="1.4" rx=".4"/><rect x="5.5" y="5.5" width="1.4" height="1.4" rx=".4"/><rect x="2.7" y="5.5" width="1.4" height="1.4" rx=".4"/><rect x="5.5" y="2.7" width="1.4" height="1.4" rx=".4"/></svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ BRUSH ADV POPOVER ════════════════════════════════════════════════ */}
        {showBrushAdv&&(()=>{const adv=brushAdvanced[brushType];return(
          <div ref={brushAdvPopRef} style={{position:'fixed',left:isMobile?8:62,right:isMobile?8:undefined,bottom:animBottom+10,width:isMobile?'auto':264,maxWidth:isMobile?'calc(100vw - 16px)':undefined,animation:'slu 180ms ease',zIndex:310}} className="pop">
            <div style={{padding:'14px 16px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,paddingBottom:12,borderBottom:BORDER}}>
                <div style={{display:'flex',alignItems:'center',gap:7}}><Settings2 size={13} strokeWidth={2}/><span style={{fontWeight:700,fontSize:14}}>Brush Dynamics</span></div>
                <button onClick={()=>setBrushAdvanced(p=>({...p,[brushType]:DEFAULT_ADV[brushType]}))} style={{...ibtn('default'),height:26,padding:'0 9px',fontSize:9,fontFamily:"'Space Mono',monospace",fontWeight:700,letterSpacing:.3}}>RESET</button>
              </div>
              {([{label:'Size Jitter',key:'sizeJitter',val:adv.sizeJitter,max:100,unit:'%'},{label:'Opacity Jitter',key:'opacityJitter',val:adv.opacityJitter,max:100,unit:'%'},{label:'Spacing',key:'spacingMult',val:Math.round(adv.spacingMult*100),max:300,unit:'%',scale:.01}] as {label:string;key:keyof BrushAdvanced;val:number;max:number;unit:string;scale?:number}[]).map(({label,key,val,max,unit,scale})=>(
                <div key={key} style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span style={{fontSize:12,fontWeight:600}}>{label}</span><span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:ACCENT,fontWeight:700}}>{val}{unit}</span></div>
                  <input type="range" min={0} max={max} value={val} style={{width:'100%',background:`linear-gradient(to right,${DARK} ${val/max*100}%,rgba(0,0,0,.1) 0%)`}} onChange={e=>setBrushAdvanced(p=>({...p,[brushType]:{...p[brushType],[key]:scale?+e.target.value*scale:+e.target.value}}))}/>
                </div>
              ))}
              <div style={{borderTop:BORDER,paddingTop:10,display:'flex',gap:3}}>
                {BRUSH_DEFS.filter(b=>b.category==='Basic'&&b.type!=='eraser').map(b=>(<button key={b.type} onClick={()=>{setBrushType(b.type);setEraserMode(false);}} style={{flex:1,height:28,border:BORDER,borderRadius:7,background:brushType===b.type&&!eraserMode?LIME:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 100ms'}}><BrushIcon type={b.type} size={13}/></button>))}
              </div>
            </div>
          </div>
        );})()}

        {/* ══ SURFACE POPOVER ══════════════════════════════════════════════════ */}
        {showSurface&&(
          <div ref={surfacePopRef} style={{position:'fixed',left:isMobile?8:62,right:isMobile?8:undefined,bottom:animBottom+10,width:isMobile?'auto':216,maxWidth:isMobile?'calc(100vw - 16px)':undefined,animation:'slu 180ms ease',zIndex:310}} className="pop">
            <div style={{padding:'12px'}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:10,paddingBottom:9,borderBottom:BORDER}}>Canvas Surface</div>
              {SURFACES.map(surf=>(
                <button key={surf.type} onClick={()=>{setSurface(surf.type);setShowSurface(false);}} style={{width:'100%',display:'flex',alignItems:'center',gap:9,padding:'7px 9px',border:BORDER,borderRadius:8,background:surface===surf.type?LIME:WHITE,cursor:'pointer',marginBottom:4,transition:'all 100ms'}}>
                  <div style={{width:26,height:26,borderRadius:6,border:BORDER,background:`rgb(${surf.paper.join(',')})`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SurfaceIcon type={surf.type} size={13}/></div>
                  <div style={{textAlign:'left',flex:1}}>
                    <div style={{fontSize:12,fontWeight:surface===surf.type?700:500}}>{surf.label}</div>
                    <div style={{fontFamily:"'Space Mono',monospace",fontSize:7.5,color:MUTED,letterSpacing:.3,marginTop:1}}>{surf.texStrength===0?'NO TEXTURE':`${Math.round(surf.texStrength*100)}% TEX`}</div>
                  </div>
                  {surface===surf.type&&<Check size={11} strokeWidth={2.5}/>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ══ COLOR PANEL ══════════════════════════════════════════════════════ */}
        {showColorPanel&&(
          <div ref={colorPanelRef} style={{position:'fixed',left:isMobile?8:62,right:isMobile?8:undefined,bottom:animBottom+10,width:isMobile?'auto':260,maxWidth:isMobile?'calc(100vw - 16px)':undefined,animation:'slu 180ms ease',zIndex:310}} className="pop">
            <div style={{padding:'14px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,paddingBottom:10,borderBottom:BORDER}}>
                <span style={{fontWeight:700,fontSize:13}}>Color</span>
                <button onClick={()=>setShowColorPanel(false)} style={{...ibtn(),width:24,height:24,borderRadius:7}}><X size={11} strokeWidth={2}/></button>
              </div>

              {/* Color swatch + native picker */}
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                <div className="hs" style={{position:'relative',width:44,height:44,borderRadius:'50%',background:colorCss,border:BORDER,overflow:'hidden',cursor:'pointer',flexShrink:0}}>
                  <input type="color" value={`#${color.map(v=>v.toString(16).padStart(2,'0')).join('')}`} onChange={e=>{const hx=e.target.value;applyColor([parseInt(hx.slice(1,3),16),parseInt(hx.slice(3,5),16),parseInt(hx.slice(5,7),16)]);}} style={{position:'absolute',inset:0,opacity:0,width:'100%',height:'100%',cursor:'pointer'}} title="System color picker"/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:MUTED,fontWeight:700,letterSpacing:.5,marginBottom:3}}>HEX</div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:700,color:DARK}}>#{color.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}</div>
                </div>
              </div>

              {/* HSL sliders */}
              <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
                {([{lbl:'H',val:h,min:0,max:360,bg:`linear-gradient(to right,hsl(0,${s}%,${l}%),hsl(60,${s}%,${l}%),hsl(120,${s}%,${l}%),hsl(180,${s}%,${l}%),hsl(240,${s}%,${l}%),hsl(300,${s}%,${l}%),hsl(360,${s}%,${l}%))`,cb:(v:number)=>setFromHsl(v,s,l)},{lbl:'S',val:s,min:0,max:100,bg:`linear-gradient(to right,hsl(${h},0%,${l}%),hsl(${h},100%,${l}%))`,cb:(v:number)=>setFromHsl(h,v,l)},{lbl:'L',val:l,min:0,max:100,bg:`linear-gradient(to right,#000,hsl(${h},${s}%,50%),#fff)`,cb:(v:number)=>setFromHsl(h,s,v)}] as const).map(({lbl,val,min,max,bg,cb})=>(
                  <div key={lbl} style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:MUTED,fontWeight:700,width:11}}>{lbl}</span>
                    <input type="range" min={min} max={max} value={val} onChange={e=>cb(+e.target.value)} style={{flex:1,background:bg}}/>
                    <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:DARK,fontWeight:700,width:30,textAlign:'right'}}>{val}{lbl==='H'?'\u00B0':'%'}</span>
                  </div>
                ))}
              </div>

              {/* Recent colors */}
              {recentColors.length>0&&(
                <div style={{marginBottom:14}}>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:6}}>RECENT</div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {recentColors.map((rc,ci)=>(<div key={ci} className="pig" onClick={()=>applyColor(rc)} style={{width:18,height:18,borderRadius:'50%',background:`rgb(${rc.join(',')})`,border:`1.5px solid ${DARK}20`,cursor:'pointer',transition:'transform 100ms'}}/>))}
                  </div>
                </div>
              )}

              {/* Pigment palette */}
              <div>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:6}}>PIGMENTS</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
                  {PIGMENTS.map((p,idx)=>(<div key={idx} className="pig" onClick={()=>{setColor(p.rgb);setHsl(rgbToHsl(p.rgb[0],p.rgb[1],p.rgb[2]));setActivePig(idx);pushRecent(p.rgb);setIsEyedropper(false);}} title={p.name} style={{width:'100%',aspectRatio:'1',borderRadius:'50%',background:`rgb(${p.rgb.join(',')})`,transform:activePig===idx?'scale(1.2)':'scale(1)',cursor:'pointer',transition:'transform 100ms',border:activePig===idx?`2px solid ${LIME}`:`1.5px solid ${DARK}15`}}/>))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ BRUSH LIBRARY PANEL ══════════════════════════════════════════════ */}
        {showBrushLib&&(
          <div ref={brushLibRef} style={{position:'fixed',left:isMobile?8:62,right:isMobile?8:undefined,top:isMobile?headerH+8:160,width:isMobile?'auto':460,maxWidth:isMobile?'calc(100vw - 16px)':undefined,maxHeight:isMobile?'calc(100vh - 130px)':480,animation:'sl 180ms ease',zIndex:320,background:WHITE,border:BORDER,borderRadius:14,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            {/* Header */}
            <div style={{padding:'12px 14px 10px',borderBottom:BORDER,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{fontWeight:800,fontSize:13,letterSpacing:-.3}}>Brush Library</div>
              <div style={{display:'flex',gap:2}}>
                {(['builtin','imported'] as const).map(tab=>(
                  <button key={tab} onClick={()=>setBrushLibTab(tab)} style={{height:24,padding:'0 10px',border:BORDER,borderRadius:7,background:brushLibTab===tab?DARK:WHITE,color:brushLibTab===tab?WHITE:DARK,cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,letterSpacing:.4,transition:'all 100ms'}}>
                    {tab==='builtin'?'BUILT-IN':'IMPORTED'}{tab==='imported'&&customBrushes.length>0?` (${customBrushes.length})`:''}
                  </button>
                ))}
              </div>
            </div>

            {/* Brush grid */}
            <div className="sb" style={{flex:1,overflowY:'auto',padding:'10px 12px'}}>
              {brushLibTab==='builtin'&&(()=>{
                const cats=['Basic','Drawing','Texture','Paint'];
                return cats.map(cat=>{
                  const brushes=BRUSH_DEFS.filter(b=>b.category===cat&&b.type!=='eraser');
                  if(!brushes.length) return null;
                  return(
                    <div key={cat} style={{marginBottom:10}}>
                      <div style={{fontFamily:"'Space Mono',monospace",fontSize:7.5,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:6}}>{cat.toUpperCase()}</div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                        {brushes.map(({type,label,key})=>{
                          const isActive=!selectedCustom&&brushType===type&&!eraserMode;
                          return(
                            <button key={type} onClick={()=>{setBrushType(type);setSelectedCustom(null);setIsEyedropper(false);setShowBrushLib(false);setEraserMode(false);}} title={key?`${label} [${key}]`:label}
                              style={{width:68,height:56,border:BORDER,borderRadius:9,background:isActive?LIME:WHITE,color:DARK,cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,transition:'all 110ms cubic-bezier(0.34,1.56,0.64,1)',flexShrink:0}}>
                              <BrushIcon type={type} size={18}/>
                              <span style={{fontFamily:"'Space Mono',monospace",fontSize:6.5,fontWeight:700,letterSpacing:.3,color:isActive?DARK:MUTED,lineHeight:1}}>{label.toUpperCase()}</span>
                              {key&&<span style={{fontFamily:"'Space Mono',monospace",fontSize:5.5,color:isActive?DARK:MUTED,opacity:.6}}>[{key}]</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
              {brushLibTab==='imported'&&(
                customBrushes.length===0?(
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:120,gap:8,opacity:.5}}>
                    <Upload size={22} strokeWidth={1.5} color={MUTED}/>
                    <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:MUTED,fontWeight:700}}>NO IMPORTED BRUSHES YET</span>
                  </div>
                ):(
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                    {customBrushes.map(cb=>{
                      const isActive=selectedCustom?.id===cb.id;
                      return(
                        <div key={cb.id} style={{position:'relative'}}>
                          <button onClick={()=>{setSelectedCustom(cb);setShowBrushLib(false);}}
                            style={{width:68,height:56,border:BORDER,borderRadius:9,background:isActive?LIME:WHITE,color:DARK,cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,transition:'all 110ms'}}>
                            {cb.previewUrl?<img src={cb.previewUrl} alt="" style={{width:22,height:22,objectFit:'contain',imageRendering:'pixelated',opacity:.85}}/>:<Paintbrush2 size={18}/>}
                            <span style={{fontFamily:"'Space Mono',monospace",fontSize:5.5,fontWeight:700,color:isActive?DARK:MUTED,letterSpacing:.3,maxWidth:60,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{cb.name.toUpperCase()}</span>
                          </button>
                          <button onClick={()=>{const next=customBrushes.filter(x=>x.id!==cb.id);setCustomBrushes(next);customBrushesRef.current=next;if(selectedCustom?.id===cb.id)setSelectedCustom(null);}} title="Remove brush" style={{position:'absolute',top:-4,right:-4,width:14,height:14,border:BORDER,borderRadius:'50%',background:WHITE,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',padding:0,zIndex:1}}>
                            <X size={7} strokeWidth={2.5}/>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* Import section */}
            <div style={{borderTop:BORDER,padding:'10px 12px',background:CREAM,flexShrink:0}}>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:7.5,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:7}}>IMPORT BRUSHES</div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <button onClick={()=>brushFileInputRef.current?.click()} disabled={brushImportLoading}
                  style={{flex:1,height:32,border:BORDER,borderRadius:8,background:brushImportLoading?SAND:DARK,color:WHITE,cursor:brushImportLoading?'wait':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:7,fontFamily:"'Space Grotesk',sans-serif",fontSize:11,fontWeight:700,transition:'all 100ms'}}>
                  <Upload size={11} strokeWidth={2}/>
                  {brushImportLoading?'Importing…':'Import .brush / .brushset / .abr'}
                </button>
                <input ref={brushFileInputRef} type="file" accept=".brush,.brushset,.abr" style={{display:'none'}} onChange={e=>{const f=e.target.files?.[0];if(f)handleBrushImport(f);e.target.value='';}}/>
              </div>
              {brushImportError&&<div style={{marginTop:6,fontFamily:"'Space Mono',monospace",fontSize:8,color:PINK,fontWeight:700,lineHeight:1.4}}>{brushImportError}</div>}
              <div style={{marginTop:6,fontFamily:"'Space Mono',monospace",fontSize:7,color:MUTED,letterSpacing:.3,lineHeight:1.5}}>
                Procreate: .brush or .brushset — Photoshop: .abr (v1/v2 only)
              </div>
            </div>
          </div>
        )}

        {/* ══ TOOL TRAY ════════════════════════════════════════════════════════ */}
        <div style={{position:'fixed',left:sideW,right:0,bottom:0,height:toolH,background:WHITE,borderTop:BORDER,display:'flex',alignItems:'center',padding:isMobile?'0 6px':'0 14px',gap:isMobile?4:8,zIndex:150,overflowX:'auto',scrollbarWidth:'none'}}>

          {/* Quick-access basic brushes */}
          <div style={{display:'flex',gap:2,flexShrink:0,alignItems:'center'}}>
            {BRUSH_DEFS.filter(b=>b.category==='Basic'&&b.type!=='eraser').map(({type,key})=>{
              const isActive=!selectedCustom&&brushType===type&&!eraserMode;
              return(
                <button key={type} onClick={()=>{setBrushType(type);setSelectedCustom(null);setIsEyedropper(false);setEraserMode(false);}} title={`${BRUSH_DEFS.find(b=>b.type===type)?.label} [${key}]`}
                  style={{width:isMobile?28:32,height:isMobile?38:46,border:BORDER,borderRadius:8,background:isActive?LIME:WHITE,color:DARK,cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,transition:'all 110ms cubic-bezier(0.34,1.56,0.64,1)',flexShrink:0}}>
                  <BrushIcon type={type} size={isMobile?10:12}/>
                  {!isMobile&&<span style={{fontFamily:"'Space Mono',monospace",fontSize:5.5,fontWeight:700,letterSpacing:.5,color:isActive?DARK:MUTED}}>{key}</span>}
                </button>
              );
            })}
          </div>

          <button onClick={()=>{setEraserMode(p=>!p);setSmudgeMode(false);}} title="Eraser Mode [E] -- uses current brush" style={{...ibtn('default',eraserMode),width:isMobile?28:34,height:isMobile?38:46,borderRadius:9,flexShrink:0,flexDirection:'column',gap:3,fontSize:9,fontFamily:"'Space Mono',monospace",letterSpacing:.3,background:eraserMode?PINK:WHITE,color:eraserMode?WHITE:DARK}}>
            <Eraser size={isMobile?11:13} strokeWidth={2}/>
          </button>
          <button onClick={()=>{setSmudgeMode(p=>!p);setEraserMode(false);}} title="Smudge [S]" style={{...ibtn('default',smudgeMode),width:isMobile?28:34,height:isMobile?38:46,borderRadius:9,flexShrink:0,flexDirection:'column',gap:3,fontSize:9,fontFamily:"'Space Mono',monospace",letterSpacing:.3}}>
            <Blend size={isMobile?11:13} strokeWidth={2}/>
          </button>
          {!isMobile&&<button ref={brushAdvBtnRef} onClick={()=>{setShowBrushAdv(p=>!p);setShowSurface(false);setShowBrushLib(false);setShowColorPanel(false);}} style={{...ibtn('default',showBrushAdv),width:28,height:34,borderRadius:8,flexShrink:0}}>
            <Settings2 size={11} strokeWidth={2}/>
          </button>}

          {/* Size & Flow — grouped with brushes */}
          {!isMobile?(<div style={{display:'flex',flexDirection:'column',gap:6,flexShrink:0,marginLeft:4}}>
            {([{lbl:'SIZE',val:brushSize,min:2,max:150,cb:(v:number)=>setBrushSize(v)},{lbl:'FLOW',val:opacity,min:5,max:100,cb:(v:number)=>setOpacity(v)}] as const).map(({lbl,val,min,max,cb})=>(
              <div key={lbl} style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,fontWeight:700,width:28,letterSpacing:.5}}>{lbl}</span>
                <input type="range" min={min} max={max} value={val} onChange={e=>cb(+e.target.value)} style={{width:88,background:`linear-gradient(to right,${DARK} ${(val-min)/(max-min)*100}%,rgba(0,0,0,.1) 0%)`}}/>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:DARK,fontWeight:700,width:26,textAlign:'right'}}>{val}{lbl==='FLOW'?'%':''}</span>
              </div>
            ))}
          </div>):(
            /* Mobile: compact size slider only */
            <div style={{display:'flex',alignItems:'center',gap:3,flexGrow:1,flexShrink:0,flexBasis:0,maxWidth:120}}>
              <input type="range" min={2} max={150} value={brushSize} onChange={e=>setBrushSize(+e.target.value)} style={{flex:1,background:`linear-gradient(to right,${DARK} ${(brushSize-2)/148*100}%,rgba(0,0,0,.1) 0%)`}}/>
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:7,color:DARK,fontWeight:700,width:18,textAlign:'right'}}>{brushSize}</span>
            </div>
          )}

          {!isMobile&&<div style={{width:1,height:36,background:DARK,opacity:.1,flexShrink:0}}/>}

          {/* Color swatch — opens color panel */}
          <button ref={colorBtnRef} onClick={()=>{setShowColorPanel(p=>!p);setShowBrushAdv(false);setShowSurface(false);}} title="Color [C]" style={{position:'relative',width:isMobile?30:38,height:isMobile?30:38,borderRadius:'50%',background:colorCss,border:showColorPanel?`2.5px solid ${LIME}`:BORDER,cursor:'pointer',flexShrink:0,padding:0,display:'flex',alignItems:'center',justifyContent:'center',transition:'border 120ms ease'}}>
            <ChevronDown size={isMobile?8:10} strokeWidth={2.5} style={{color:l>60?DARK:WHITE,opacity:.7}}/>
          </button>

          <div style={{flex:isMobile?0:1}}/>

          {/* Actions */}
          <div style={{display:'flex',gap:isMobile?3:5,alignItems:'center',flexShrink:0}}>
            <button onClick={handleUndo} style={{...ibtn(),width:isMobile?28:34,height:isMobile?38:46,borderRadius:9}} title="Undo [Cmd+Z]"><Undo2 size={isMobile?11:13} strokeWidth={2}/></button>
            {!isMobile&&<button onClick={handleClear} style={{...ibtn('danger'),width:34,height:46,borderRadius:9}} title={clearConfirm?'Confirm clear?':'Clear canvas'}><Trash2 size={13} strokeWidth={2}/></button>}
            {!isMobile&&<button onClick={()=>saveToGallery()} style={{width:34,height:46,border:BORDER,borderRadius:9,background:'#1a9e5c',color:WHITE,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}} title="Save to gallery"><LayoutGrid size={13} strokeWidth={2}/></button>}
            <button onClick={handleSave} style={{height:isMobile?38:46,padding:isMobile?'0 10px':'0 16px',border:BORDER,borderRadius:9,background:DARK,color:WHITE,cursor:'pointer',display:'flex',alignItems:'center',gap:6,fontFamily:"'Space Grotesk',sans-serif",fontSize:isMobile?10:12,fontWeight:700,flexShrink:0}}>
              <Download size={isMobile?11:13} strokeWidth={2}/>{!isMobile&&' Save PNG'}
            </button>
          </div>
        </div>

        {/* ══ CANVAS SIZE MODAL ════════════════════════════════════════════════ */}
        {showCanvasSize&&(
          <div className="modal-bg" onClick={()=>setShowCanvasSize(false)} style={{animation:'fi 140ms ease'}}>
            <div className="modal" onClick={e=>e.stopPropagation()} style={{animation:'su 200ms ease',width:isMobile?'auto':500}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:isMobile?14:22}}>
                <div>
                  <h2 style={{fontWeight:800,fontSize:isMobile?18:22,color:DARK,letterSpacing:-0.5}}>Canvas Size</h2>
                  <p style={{fontSize:11,color:MUTED,marginTop:3,fontFamily:"'Space Mono',monospace"}}>Current: {canvasW} × {canvasH} px</p>
                </div>
                <button onClick={()=>setShowCanvasSize(false)} style={{...ibtn(),width:32,height:32,borderRadius:8}}><X size={13} strokeWidth={2}/></button>
              </div>

              <div style={{marginBottom:18}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:9}}>PRESETS</div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(3,1fr)':'repeat(4,1fr)',gap:6}}>
                  {CANVAS_PRESETS.map(p=>(
                    <button key={p.label} onClick={()=>{setCsW(p.w);setCsH(p.h);}} style={{border:BORDER,borderRadius:8,padding:'7px 4px',background:csW===p.w&&csH===p.h?LIME:WHITE,color:DARK,cursor:'pointer',fontFamily:"'Space Grotesk',sans-serif",fontWeight:600,transition:'all 100ms',textAlign:'center'}}>
                      <div style={{fontSize:10,fontWeight:700}}>{p.label}</div>
                      <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,marginTop:2}}>{p.w}×{p.h}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:18}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:9}}>CUSTOM</div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:5}}>Width (px)</div>
                    <input type="number" value={csW} onChange={e=>setCsW(Math.max(64,Math.min(4096,+e.target.value)))} className="inp" style={{textAlign:'center',fontFamily:"'Space Mono',monospace",fontWeight:700}}/>
                  </div>
                  <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:20,fontWeight:800,color:MUTED,paddingTop:20}}>×</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,fontWeight:700,marginBottom:5}}>Height (px)</div>
                    <input type="number" value={csH} onChange={e=>setCsH(Math.max(64,Math.min(4096,+e.target.value)))} className="inp" style={{textAlign:'center',fontFamily:"'Space Mono',monospace",fontWeight:700}}/>
                  </div>
                </div>
              </div>

              <div style={{marginBottom:22}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:9}}>CONTENT MODE</div>
                <div style={{display:'flex',gap:8}}>
                  {([['crop','Crop / Center','Keeps existing content, adjusts canvas edges'],['scale','Scale Content','Stretches painting to fit new dimensions']] as const).map(([m,label,desc])=>(
                    <button key={m} onClick={()=>setCsMode(m)} style={{flex:1,border:BORDER,borderRadius:9,padding:'10px 12px',background:csMode===m?LIME:WHITE,color:DARK,cursor:'pointer',textAlign:'left',transition:'all 100ms'}}>
                      <div style={{fontWeight:700,fontSize:12}}>{label}</div>
                      <div style={{fontSize:10,color:MUTED,marginTop:3,lineHeight:1.4}}>{desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setShowCanvasSize(false)} style={{...ibtn(),flexGrow:1,flexBasis:0,height:44,borderRadius:10,justifyContent:'center',fontSize:13}}>Cancel</button>
                <button onClick={changeCanvasSize} style={{...ibtn('lime'),flexGrow:2,flexBasis:0,height:44,borderRadius:10,gap:7,fontSize:13,justifyContent:'center',fontWeight:700}}>
                  <Maximize size={14} strokeWidth={2}/> Apply {csW} × {csH}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ GALLERY MODAL ════════════════════════════════════════════════════ */}
        {showGallery&&(
          <div className="modal-bg" onClick={()=>setShowGallery(false)} style={{animation:'fi 140ms ease',alignItems:'flex-start',paddingTop:60}}>
            <div onClick={e=>e.stopPropagation()} style={{background:WHITE,border:BORDER,borderRadius:isMobile?14:16,width:isMobile?'auto':700,maxWidth:'94vw',maxHeight:'85vh',display:'flex',flexDirection:'column',animation:'su 200ms ease',overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 22px 14px',borderBottom:BORDER,background:CREAM,flexShrink:0}}>
                <div>
                  <h2 style={{fontWeight:800,fontSize:20,color:DARK,letterSpacing:-0.5}}>Gallery</h2>
                  <p style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:MUTED,marginTop:2,fontWeight:700}}>{gallery.length} SAVED</p>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  {!isMobile&&<div style={{display:'flex',border:BORDER,borderRadius:9,overflow:'hidden'}}>
                    <input value={galleryName} onChange={e=>setGalleryName(e.target.value)} placeholder="Name this painting..." onKeyDown={e=>e.key==='Enter'&&(saveToGallery(galleryName||undefined),setGalleryName(''))} style={{background:WHITE,border:'none',outline:'none',color:DARK,fontFamily:"'Space Grotesk',sans-serif",fontWeight:500,fontSize:12,padding:'8px 13px',width:200}}/>
                    <button onClick={()=>{saveToGallery(galleryName||undefined);setGalleryName('');}} style={{background:DARK,border:'none',borderLeft:BORDER,cursor:'pointer',color:WHITE,padding:'0 14px',fontFamily:"'Space Grotesk',sans-serif",fontSize:12,fontWeight:700}}>Save</button>
                  </div>}
                  <button onClick={()=>setShowGallery(false)} style={{...ibtn(),width:34,height:34,borderRadius:8}}><X size={13} strokeWidth={2}/></button>
                </div>
              </div>
              <div className="sb" style={{flex:1,overflowY:'auto',padding:'18px 22px'}}>
                {gallery.length===0?(
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:200,gap:14}}>
                    <div style={{width:52,height:52,border:`1.5px dashed ${MUTED}`,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center'}}><LayoutGrid size={22} color={MUTED} strokeWidth={1.5}/></div>
                    <div style={{textAlign:'center'}}><p style={{fontSize:15,fontWeight:700,color:DARK}}>No paintings saved yet</p><p style={{fontSize:12,color:MUTED,marginTop:4}}>Paint something and save it to your gallery.</p></div>
                  </div>
                ):(
                  <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(auto-fill,minmax(130px,1fr))':'repeat(auto-fill,minmax(190px,1fr))',gap:isMobile?8:12}}>
                    {gallery.map(entry=>(
                      <div key={entry.id} style={{border:BORDER,borderRadius:10,overflow:'hidden',background:WHITE,cursor:'pointer',transition:'all 140ms'}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.transform='translateY(-2px)';}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.transform='';}}
                        onClick={()=>loadFromGallery(entry.dataUrl)}>
                        <div style={{height:124,overflow:'hidden',position:'relative',background:CREAM,borderBottom:BORDER}}>
                          <img src={entry.dataUrl} alt={entry.name} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                          {entry.isAuto&&<span style={{position:'absolute',top:5,left:5,background:SAND,color:MUTED,border:BORDER,borderRadius:5,fontFamily:"'Space Mono',monospace",fontSize:7,padding:'1px 5px',fontWeight:700,letterSpacing:.5}}>AUTO</span>}
                        </div>
                        <div style={{padding:'8px 10px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:6}}>
                          <div style={{minWidth:0}}>
                            <div style={{fontWeight:700,fontSize:11,color:DARK,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{entry.name}</div>
                            <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,marginTop:2}}>{new Date(entry.createdAt).toLocaleDateString([],{month:'short',day:'numeric'})}</div>
                          </div>
                          <button onClick={e=>{e.stopPropagation();deleteFromGallery(entry.id);}} style={{background:PINK,border:BORDER,cursor:'pointer',color:WHITE,display:'flex',padding:5,borderRadius:7,flexShrink:0}}><Trash2 size={9} strokeWidth={2.5}/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══ COLLAB MODAL ═════════════════════════════════════════════════════ */}
        {showInvite&&workspace==='paint'&&(
          <div className="modal-bg" onClick={()=>setShowInvite(false)} style={{animation:'fi 140ms ease'}}>
            <div className="modal" onClick={e=>e.stopPropagation()} style={{animation:'su 200ms ease',width:isMobile?'auto':420}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:16}}>
                <div><h2 style={{fontWeight:800,fontSize:isMobile?18:20,letterSpacing:-0.5}}>Collaborate</h2><p style={{fontSize:12,color:MUTED,marginTop:2}}>Paint together in real time</p></div>
                <button onClick={()=>setShowInvite(false)} style={{...ibtn(),width:32,height:32,borderRadius:8}}><X size={13} strokeWidth={2}/></button>
              </div>

              <div style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',background:CREAM,borderRadius:9,border:BORDER,marginBottom:14}}>
                <div style={{width:30,height:30,borderRadius:8,background:myColor.current,border:BORDER,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:WHITE,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif"}}>{userName.charAt(0)}</div>
                <div><div style={{fontSize:13,fontWeight:700}}>{userName}</div><div style={{fontSize:9,fontFamily:"'Space Mono',monospace",color:MUTED,fontWeight:700,marginTop:2}}>{isConnected?'CONNECTED':'OFFLINE'}</div></div>
                {isConnected&&<span className="pill" style={{marginLeft:'auto',background:LIME,color:DARK}}>LIVE</span>}
              </div>

              {roomId&&(
                <div style={{display:'flex',gap:2,background:CREAM,border:BORDER,borderRadius:9,padding:3,marginBottom:14}}>
                  {(['room','people','chat'] as const).map(tab=>(
                    <button key={tab} onClick={()=>setCollabTab(tab)} style={{flex:1,padding:'7px 0',border:tab===collabTab?BORDER:'none',borderRadius:7,cursor:'pointer',fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,background:tab===collabTab?WHITE:CREAM,color:tab===collabTab?DARK:MUTED,transition:'all 140ms',letterSpacing:.5,position:'relative'}}>
                      {tab.toUpperCase()}
                      {tab==='chat'&&chatMessages.length>0&&collabTab!=='chat'&&<span style={{position:'absolute',top:5,right:8,width:5,height:5,borderRadius:'50%',background:PINK,border:BORDER}}/>}
                    </button>
                  ))}
                </div>
              )}

              {!roomId&&(
                <div style={{textAlign:'center',padding:'14px 0'}}>
                  <div style={{width:48,height:48,border:`1.5px dashed ${MUTED}`,borderRadius:12,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}><Users size={22} color={MUTED} strokeWidth={1.5}/></div>
                  <p style={{fontSize:13,color:MUTED,marginBottom:18,lineHeight:1.6}}>Start a shared room and invite others to paint together.</p>
                  <button onClick={createRoom} style={{...ibtn('lime'),height:44,padding:'0 24px',borderRadius:10,gap:8,fontSize:13,justifyContent:'center',fontWeight:700}}>
                    <Users size={14} strokeWidth={2}/> Create Shared Room
                  </button>
                </div>
              )}
              {roomId&&collabTab==='room'&&(
                <div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:7}}>INVITE LINK</div>
                  <div style={{display:'flex',gap:6,marginBottom:14}}>
                    <div style={{flex:1,background:CREAM,border:BORDER,borderRadius:8,padding:'8px 11px',fontSize:10,fontFamily:"'Space Mono',monospace",color:DARK,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:5}}><Link size={9} color={MUTED}/>{`${window.location.origin}?room=${roomId}`}</div>
                    <button onClick={copyLink} style={{...ibtn(linkCopied?'lime':'default'),width:38,height:38,borderRadius:8}}>
                      {linkCopied?<Check size={12} strokeWidth={2.5}/>:<Copy size={12} strokeWidth={2}/>}
                    </button>
                  </div>
                  <button onClick={()=>{leaveRoom();setShowInvite(false);}} style={{...ibtn('default'),width:'100%',height:38,borderRadius:9,gap:7,fontSize:12,justifyContent:'center',fontWeight:700,color:'#C4453A',border:'1.5px solid #C4453A22'}}>
                    <LogOut size={13} strokeWidth={2}/> Leave Room
                  </button>
                </div>
              )}
              {roomId&&collabTab==='people'&&(
                <div className="sb" style={{maxHeight:200,overflowY:'auto'}}>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:9}}>IN ROOM ({onlineUsers.length})</div>
                  {onlineUsers.length===0&&<p style={{fontSize:13,color:MUTED,textAlign:'center',padding:'18px 0'}}>Waiting for others to join...</p>}
                  {onlineUsers.map(u=>(<div key={u.uid} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 10px',background:CREAM,borderRadius:8,border:BORDER,marginBottom:5}}><div style={{width:24,height:24,borderRadius:7,background:u.color,border:BORDER,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:WHITE,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif"}}>{u.name.charAt(0)}</div><span style={{fontSize:12,fontWeight:600}}>{u.name}</span>{u.uid===myUid.current&&<span className="pill" style={{marginLeft:'auto',background:SAND,color:MUTED}}>YOU</span>}</div>))}
                </div>
              )}
              {roomId&&collabTab==='chat'&&(
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <div className="sb" style={{height:180,overflowY:'auto',display:'flex',flexDirection:'column',gap:5}}>
                    {chatMessages.length===0&&<div style={{height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,opacity:.35}}><MessageSquare size={24} color={DARK} strokeWidth={1.5}/><p style={{fontSize:12,fontWeight:600}}>No messages yet</p></div>}
                    {chatMessages.map((msg,i)=>{const isOwn=msg.uid===myUid.current;return(<div key={i} style={{display:'flex',gap:6,flexDirection:isOwn?'row-reverse':'row',alignItems:'flex-start'}}><div style={{width:20,height:20,borderRadius:6,background:msg.color,border:BORDER,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,color:WHITE,fontWeight:700,flexShrink:0,fontFamily:"'Space Grotesk',sans-serif"}}>{msg.name.charAt(0)}</div><div style={{maxWidth:'72%'}}>{!isOwn&&<div style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,marginBottom:2,fontWeight:700}}>{msg.name}</div>}<div style={{background:isOwn?DARK:CREAM,color:isOwn?WHITE:DARK,borderRadius:isOwn?'9px 9px 2px 9px':'9px 9px 9px 2px',padding:'6px 10px',fontSize:12,lineHeight:1.5,wordBreak:'break-word',border:BORDER,fontWeight:500}}>{msg.text}</div></div></div>);})}
                    <div ref={chatEndRef}/>
                  </div>
                  <div style={{display:'flex',gap:6}}>
                    <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}} placeholder="Send a message..." className="inp" style={{flex:1,fontSize:12}}/>
                    <button onClick={sendChat} disabled={!chatInput.trim()||!isConnected} style={{...ibtn(chatInput.trim()&&isConnected?'dark':'default'),width:36,height:36,borderRadius:8,opacity:chatInput.trim()&&isConnected?1:.5}}><Send size={12} strokeWidth={2}/></button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ HELP MODAL ═══════════════════════════════════════════════════════ */}
        {showHelp&&(
          <div className="modal-bg" onClick={()=>setShowHelp(false)} style={{animation:'fi 140ms ease'}}>
            <div className="modal" onClick={e=>e.stopPropagation()} style={{animation:'su 200ms ease',width:isMobile?'auto':520}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:isMobile?14:22}}>
                <div>
                  <h2 style={{fontWeight:800,fontSize:isMobile?18:22,letterSpacing:-0.5}}>Keyboard Shortcuts</h2>
                  <p style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:MUTED,fontWeight:700,marginTop:3,letterSpacing:.5}}>MEPAINT STUDIO</p>
                </div>
                <button onClick={()=>setShowHelp(false)} style={{...ibtn(),width:32,height:32,borderRadius:8}}><X size={13} strokeWidth={2}/></button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:isMobile?'4px 10px':'5px 20px'}}>
                {[['1–5','Select brushes'],['E','Eraser mode'],['S','Toggle smudge'],['C','Color panel'],['[ / ]','Brush size ±5'],['Alt+E','Eyedropper'],['T','Transform tool'],['L','Lasso select'],['Cmd+Z','Undo'],['Cmd+S','Save PNG'],['Scroll','Zoom'],['Space+Drag','Pan canvas'],['0','Reset zoom'],['F','Flip horizontal'],['V','Flip vertical'],['G','Gallery'],['+ / -','Zoom in/out'],['?','Show shortcuts'],['Esc','Close all panels']].map(([k,d])=>(
                  <div key={k} style={{display:'flex',alignItems:'center',gap:9,padding:'6px 0',borderBottom:`1px solid rgba(0,0,0,.06)`}}>
                    <kbd style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:DARK,background:LIME,border:BORDER,borderRadius:6,padding:'3px 8px',minWidth:70,textAlign:'center',flexShrink:0}}>{k}</kbd>
                    <span style={{fontSize:12,color:DARK}}>{d}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:18,paddingTop:14,borderTop:BORDER,textAlign:'center'}}>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:MUTED,fontWeight:700,letterSpacing:.5}}>SPECTRAL REFLECTANCE PIGMENT MIXING</span>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ══ LAYER PANEL ══════════════════════════════════════════════════════ */}
      {showLayerPanel&&(
        <div ref={layerPanelRef} style={{position:'fixed',left:isMobile?8:58,right:isMobile?8:undefined,top:isMobile?headerH+8:layerPanelTop,width:isMobile?'auto':234,maxWidth:isMobile?'calc(100vw - 16px)':undefined,zIndex:230,animation:'sl 180ms cubic-bezier(0.34,1.56,0.64,1)',display:'flex',flexDirection:'column',background:WHITE,border:BORDER,borderRadius:14,overflow:'hidden',maxHeight:isMobile?`calc(100vh - ${headerH+toolH+16}px)`:`calc(100vh - ${layerPanelTop + 8}px)`}}>
          {/* Header */}
          <div style={{display:'flex',alignItems:'center',gap:7,padding:'11px 12px 9px',borderBottom:BORDER,userSelect:'none',flexShrink:0,background:DARK}}>
            <Layers size={12} color="rgba(255,255,255,.8)" strokeWidth={2}/>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:11,color:'rgba(255,255,255,.9)',flex:1,letterSpacing:-.2}}>Layers</span>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:'rgba(255,255,255,.35)',fontWeight:700}}>{layers.length}</span>
            <button onClick={()=>setShowLayerPanel(false)} style={{background:'rgba(255,255,255,.1)',border:'none',cursor:'pointer',color:'rgba(255,255,255,.5)',display:'flex',padding:3,borderRadius:4,marginLeft:2}}>
              <X size={10} strokeWidth={2.5}/>
            </button>
          </div>

          {/* Action toolbar */}
          <div style={{display:'flex',gap:3,padding:'8px 10px 6px',borderBottom:BORDER,flexShrink:0,background:CREAM}}>
            <button onClick={addLayer} title="Add Layer" style={{flex:1,height:26,border:BORDER,borderRadius:7,background:LIME,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4,fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,letterSpacing:.3}}>
              <Plus size={10} strokeWidth={2.5}/> NEW
            </button>
            <button onClick={()=>imgImportRef.current?.click()} title="Import Image as Layer" style={{width:26,height:26,border:BORDER,borderRadius:7,background:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <ImageIcon size={10} strokeWidth={2}/>
            </button>
            <button onClick={()=>duplicateLayer(activeLayerIdx)} title="Duplicate" style={{width:26,height:26,border:BORDER,borderRadius:7,background:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Copy size={10} strokeWidth={2}/>
            </button>
            <button onClick={()=>mergeDown(activeLayerIdx)} disabled={activeLayerIdx===0} title="Merge Down" style={{width:26,height:26,border:BORDER,borderRadius:7,background:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',opacity:activeLayerIdx===0?.3:1}}>
              <ChevronDown size={11} strokeWidth={2.5}/>
            </button>
            <button onClick={flattenAll} disabled={layers.length<=1} title="Flatten All" style={{width:26,height:26,border:BORDER,borderRadius:7,background:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',opacity:layers.length<=1?.3:1,fontFamily:"'Space Mono',monospace",fontSize:7,fontWeight:700}}>
              <Layers size={10} strokeWidth={2}/>
            </button>
          </div>
          {/* Hidden image import input */}
          <input ref={imgImportRef} type="file" accept="image/*" style={{display:'none'}}
            onChange={e=>{const f=e.target.files?.[0];if(f)addImageLayer(f);e.target.value='';}}
          />

          {/* Layer list — reversed so top layer is at top */}
          <div className="sb" style={{flex:1,overflowY:'auto',padding:'6px 0'}}>
            {[...layers].reverse().map((layer,ri)=>{
              const idx=layers.length-1-ri;// actual index in layers array
              const isActive=idx===activeLayerIdx;
              const thumb=layerThumbs[layer.id]||'';
              return(
                <div key={layer.id}
                  draggable
                  onDragStart={()=>setLayerDragIdx(idx)}
                  onDragOver={e=>{e.preventDefault();setLayerDropIdx(idx);}}
                  onDrop={()=>{if(layerDragIdx!==null&&layerDropIdx!==null)reorderLayer(layerDragIdx,layerDropIdx);setLayerDragIdx(null);setLayerDropIdx(null);}}
                  onDragEnd={()=>{setLayerDragIdx(null);setLayerDropIdx(null);}}
                  onClick={()=>setActiveLayer(idx)}
                  style={{
                    display:'flex',alignItems:'center',gap:0,
                    padding:'5px 10px',cursor:'pointer',
                    background:isActive?`${LIME}28`:layerDropIdx===idx?`${DARK}08`:'transparent',
                    borderLeft:`3px solid ${isActive?LIME:'transparent'}`,
                    transition:'background 100ms',userSelect:'none',
                    borderBottom:ri<layers.length-1?`1px solid ${DARK}0A`:'none',
                  }}>
                  {/* Visibility */}
                  <button onClick={e=>{e.stopPropagation();updateLayerProp(idx,{visible:!layer.visible});}}
                    style={{background:'none',border:'none',cursor:'pointer',padding:'2px 3px 2px 0',color:layer.visible?DARK:MUTED,display:'flex',flexShrink:0}}>
                    {layer.visible?<Eye size={12} strokeWidth={2}/>:<EyeOff size={12} strokeWidth={1.5}/>}
                  </button>
                  {/* Thumbnail */}
                  <div style={{width:36,height:28,border:`1.5px solid ${isActive?DARK:'rgba(0,0,0,.15)'}`,borderRadius:4,overflow:'hidden',flexShrink:0,background:'#ddd',marginRight:7,position:'relative'}}>
                    {thumb?<img src={thumb} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>:<div style={{width:'100%',height:'100%',background:'repeating-conic-gradient(#bbb 0% 25%,#eee 0% 50%) 0 0/8px 8px'}}/>}
                  </div>
                  {/* Name */}
                  <div style={{flex:1,minWidth:0}}>
                    {renamingId===layer.id?(
                      <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)}
                        onBlur={()=>{updateLayerProp(idx,{name:renameVal||layer.name});setRenamingId(null);}}
                        onKeyDown={e=>{if(e.key==='Enter'){updateLayerProp(idx,{name:renameVal||layer.name});setRenamingId(null);}if(e.key==='Escape')setRenamingId(null);}}
                        onClick={e=>e.stopPropagation()}
                        style={{background:WHITE,border:BORDER,borderRadius:5,color:DARK,fontFamily:"'Space Grotesk',sans-serif",fontSize:11,fontWeight:600,padding:'2px 5px',outline:'none',width:'100%'}}/>
                    ):(
                      <div onDoubleClick={e=>{e.stopPropagation();setRenamingId(layer.id);setRenameVal(layer.name);}}
                        style={{fontSize:11,fontWeight:isActive?700:500,color:DARK,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.3}}>{layer.name}</div>
                    )}
                    {/* Opacity mini-slider */}
                    <div style={{display:'flex',alignItems:'center',gap:4,marginTop:3}}>
                      <input type="range" min={0} max={100} value={layer.opacity}
                        onClick={e=>e.stopPropagation()}
                        onChange={e=>{e.stopPropagation();updateLayerProp(idx,{opacity:+e.target.value});}}
                        style={{flex:1,height:2,background:`linear-gradient(to right,${isActive?DARK:'rgba(0,0,0,.4)'} ${layer.opacity}%,rgba(0,0,0,.08) 0%)`}}/>
                      <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,fontWeight:700,flexShrink:0,width:24,textAlign:'right'}}>{layer.opacity}%</span>
                    </div>
                    {/* Blend mode selector */}
                    <div style={{marginTop:4}} onClick={e=>e.stopPropagation()}>
                      <select value={layer.blendMode||'normal'}
                        onChange={e=>{e.stopPropagation();updateLayerProp(idx,{blendMode:e.target.value});}}
                        style={{width:'100%',background:isActive?`${DARK}0A`:CREAM,border:`1px solid ${DARK}18`,borderRadius:5,color:DARK,fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,padding:'2px 4px',cursor:'pointer',outline:'none',appearance:'none',textAlign:'center'}}>
                        {BLEND_MODES.map(bm=>(
                          <option key={bm.id} value={bm.id}>{bm.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* Lock */}
                  <button onClick={e=>{e.stopPropagation();updateLayerProp(idx,{locked:!layer.locked});}}
                    title={layer.locked?'Unlock':'Lock'}
                    style={{background:'none',border:'none',cursor:'pointer',padding:'2px 0 2px 4px',color:layer.locked?DARK:MUTED,flexShrink:0,display:'flex'}}>
                    {layer.locked?<Lock size={11} strokeWidth={2}/>:<LockOpen size={11} strokeWidth={1.5}/>}
                  </button>
                  {/* Delete */}
                  {layers.length>1&&(
                    <button onClick={e=>{e.stopPropagation();deleteLayer(idx);}}
                      title="Delete Layer"
                      style={{background:'none',border:'none',cursor:'pointer',padding:'2px 0 2px 3px',color:MUTED,flexShrink:0,display:'flex'}}>
                      <X size={10} strokeWidth={2}/>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer info */}
          <div style={{borderTop:BORDER,padding:'6px 12px',flexShrink:0,background:CREAM,display:'flex',alignItems:'center',gap:6}}>
            <div style={{width:10,height:10,borderRadius:3,background:activeLayerIdx<layers.length?`rgba(${layers[activeLayerIdx]?.opacity||100}%,0%,0%,0)`:SAND,border:BORDER,flexShrink:0}}/>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>
              {layers[activeLayerIdx]?.name||'—'}
            </span>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:DARK,fontWeight:700,flexShrink:0}}>{canvasW}×{canvasH}</span>
          </div>
        </div>
      )}

      {/* ══ STARTUP CANVAS SIZE PICKER ══════════════════════════════════════ */}
      {/* ══ MOBILE DRAWER ═══════════════════════════════════════════════════ */}
      {isMobile&&mobileDrawer&&(
        <>
          <div className="mob-drawer-bg" onClick={()=>setMobileDrawer(false)}/>
          <div className="mob-drawer">
            {/* Profile */}
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0 12px',borderBottom:BORDER,marginBottom:6}}>
              <div style={{width:34,height:34,borderRadius:9,background:authUser?LIME:DARK,border:BORDER,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:authUser?DARK:WHITE,fontFamily:"'Space Grotesk',sans-serif"}}>{userName.charAt(0).toUpperCase()}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{userName}</div>
                <div style={{fontSize:9,fontFamily:"'Space Mono',monospace",color:MUTED,fontWeight:700}}>{authUser?authUser.email:'Guest'}</div>
              </div>
              <button onClick={()=>setMobileDrawer(false)} style={{...ibtn('ghost'),width:28,height:28}}><X size={14} strokeWidth={2}/></button>
            </div>

            {/* Tool buttons */}
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:4,marginTop:4}}>TOOLS</div>
            {[
              {icon:<Move size={14}/>,label:'Transform [T]',active:isTransformMode,cb:()=>{if(isTransformMode){cancelTransform();}else{if(isLassoMode){setIsLassoMode(false);isLassoRef.current=false;setLassoPath([]);lassoPathRef.current=[];}setIsTransformMode(true);isTransformRef.current=true;setIsEyedropper(false);}setMobileDrawer(false);}},
              {icon:<Lasso size={14}/>,label:'Lasso [L]',active:isLassoMode,cb:()=>{if(isLassoMode){setIsLassoMode(false);isLassoRef.current=false;setLassoPath([]);lassoPathRef.current=[];lassoDrawRef.current=false;lassoMaskRef.current=null;setLassoPhase('drawing');lassoPhaseRef.current='drawing';}else{if(isTransformMode)cancelTransform();setIsLassoMode(true);isLassoRef.current=true;setIsEyedropper(false);setLassoPhase('drawing');lassoPhaseRef.current='drawing';lassoMaskRef.current=null;}setMobileDrawer(false);}},
              {icon:<Pipette size={14}/>,label:'Eyedropper',active:isEyedropper,cb:()=>{setIsEyedropper(p=>!p);setMobileDrawer(false);}},
              {icon:<Spline size={14}/>,label:`Symmetry: ${symmetry}`,active:symmetry!=='none',cb:()=>{cycleSymmetry();}},
              {icon:<Expand size={14}/>,label:'Canvas Size',active:showCanvasSize,cb:()=>{setShowCanvasSize(true);setMobileDrawer(false);}},
            ].map((item,i)=>(
              <button key={i} onClick={item.cb} style={{width:'100%',height:38,border:BORDER,borderRadius:9,background:item.active?LIME:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',gap:10,padding:'0 12px',fontFamily:"'Space Grotesk',sans-serif",fontSize:12,fontWeight:600,transition:'all 100ms'}}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}

            <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:4,marginTop:8}}>PANELS</div>
            {[
              {icon:<Paintbrush2 size={14}/>,label:'Brush Library',cb:()=>{setShowBrushLib(p=>!p);setMobileDrawer(false);}},
              {icon:<Settings2 size={14}/>,label:'Brush Settings',cb:()=>{setShowBrushAdv(p=>!p);setMobileDrawer(false);}},
              {icon:<Layers size={14}/>,label:'Layers',cb:()=>{setShowLayerPanel(p=>!p);setMobileDrawer(false);}},
              {icon:<Users size={14}/>,label:'Collaborate',active:isConnected,cb:()=>{setShowInvite(p=>!p);setMobileDrawer(false);}},
              {icon:<LayoutGrid size={14}/>,label:'Gallery',cb:()=>{setShowGallery(p=>!p);setMobileDrawer(false);}},
              {icon:<Music2 size={14}/>,label:'Music',cb:()=>{setShowMusic(p=>!p);setMobileDrawer(false);}},
              {icon:<ImageIcon size={14}/>,label:'Reference',cb:()=>{setShowRef(p=>!p);setMobileDrawer(false);}},
            ].map((item,i)=>(
              <button key={i} onClick={item.cb} style={{width:'100%',height:38,border:BORDER,borderRadius:9,background:(item as any).active?LIME:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',gap:10,padding:'0 12px',fontFamily:"'Space Grotesk',sans-serif",fontSize:12,fontWeight:600,transition:'all 100ms',position:'relative'}}>
                {item.icon}<span>{item.label}</span>
                {(item as any).active&&<span style={{marginLeft:'auto',width:6,height:6,borderRadius:'50%',background:LIME,border:`1.5px solid ${DARK}`}}/>}
              </button>
            ))}

            <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:4,marginTop:8}}>VIEW</div>
            {[
              {icon:<FlipHIcon size={14}/>,label:`Flip H${flipH?' (ON)':''}`,active:flipH,cb:()=>setFlipH(p=>!p)},
              {icon:<FlipVIcon size={14}/>,label:`Flip V${flipV?' (ON)':''}`,active:flipV,cb:()=>setFlipV(p=>!p)},
            ].map((item,i)=>(
              <button key={i} onClick={item.cb} style={{width:'100%',height:38,border:BORDER,borderRadius:9,background:item.active?LIME:WHITE,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',gap:10,padding:'0 12px',fontFamily:"'Space Grotesk',sans-serif",fontSize:12,fontWeight:600,transition:'all 100ms'}}>
                {item.icon}<span>{item.label}</span>
              </button>
            ))}

            <div style={{fontFamily:"'Space Mono',monospace",fontSize:8,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:4,marginTop:8}}>SURFACE</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4}}>
              {SURFACES.map(s=>(
                <button key={s.type} onClick={()=>setSurface(s.type)} style={{border:BORDER,borderRadius:8,padding:'8px 4px',background:surface===s.type?LIME:WHITE,color:DARK,cursor:'pointer',textAlign:'center',transition:'all 100ms'}}>
                  <SurfaceIcon type={s.type} size={12}/>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:7,fontWeight:700,marginTop:3,color:surface===s.type?DARK:MUTED}}>{s.label.toUpperCase()}</div>
                </button>
              ))}
            </div>

            <div style={{flex:1}}/>

            {/* Flow slider in drawer */}
            <div style={{borderTop:BORDER,paddingTop:10,marginTop:8}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:MUTED,fontWeight:700,width:28}}>FLOW</span>
                <input type="range" min={5} max={100} value={opacity} onChange={e=>setOpacity(+e.target.value)} style={{flex:1,background:`linear-gradient(to right,${DARK} ${(opacity-5)/95*100}%,rgba(0,0,0,.1) 0%)`}}/>
                <span style={{fontFamily:"'Space Mono',monospace",fontSize:8,color:DARK,fontWeight:700,width:26,textAlign:'right'}}>{opacity}%</span>
              </div>
            </div>

            {/* Actions */}
            <div style={{display:'flex',gap:4,marginTop:6}}>
              <button onClick={()=>{handleClear();setMobileDrawer(false);}} style={{...ibtn('danger'),flexGrow:1,flexBasis:0,height:38,borderRadius:9,justifyContent:'center',gap:5}}><Trash2 size={12}/> Clear</button>
              <button onClick={()=>{saveToGallery();setMobileDrawer(false);}} style={{flex:1,height:38,border:BORDER,borderRadius:9,background:'#1a9e5c',color:WHITE,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:5,fontFamily:"'Space Grotesk',sans-serif",fontSize:11,fontWeight:700}}><LayoutGrid size={12}/> Save</button>
            </div>

            <button onClick={()=>{setShowHelp(true);setMobileDrawer(false);}} style={{...ibtn('ghost'),width:'100%',height:32,justifyContent:'center',gap:5,fontSize:11,marginTop:4}}>
              <HelpCircle size={12}/> Shortcuts
            </button>
          </div>
        </>
      )}

      {showStartupPicker&&(
        <div style={{position:'fixed',inset:0,background:CREAM,display:'flex',alignItems:'center',justifyContent:'center',zIndex:9000,animation:'fi 180ms ease'}}>
          {/* Dot-grid background texture */}
          <div style={{position:'absolute',inset:0,backgroundImage:`radial-gradient(circle, rgba(13,11,7,.07) 1px, transparent 1px)`,backgroundSize:'28px 28px',pointerEvents:'none'}}/>
          <div style={{position:'relative',background:WHITE,border:BORDER,borderRadius:isMobile?14:18,boxShadow:`8px 8px 0 ${DARK}`,padding:isMobile?'24px 18px':'36px 40px',width:540,maxWidth:'94vw',maxHeight:isMobile?'90vh':undefined,overflowY:isMobile?'auto':undefined,animation:'su 240ms ease'}}>

            {/* Header */}
            <div style={{marginBottom:isMobile?18:28}}>
              <div style={{display:'flex',alignItems:'baseline',gap:0,marginBottom:12,userSelect:'none'}}>
                <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:26,fontWeight:800,color:DARK,letterSpacing:-1,lineHeight:1}}>me</span>
                <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:26,fontWeight:400,color:MUTED,letterSpacing:-0.5,lineHeight:1}}>paint</span>
              </div>
              <h2 style={{fontWeight:800,fontSize:isMobile?22:30,color:DARK,letterSpacing:-1,lineHeight:1.1,marginBottom:8}}>New Canvas</h2>
              <p style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:MUTED,fontWeight:700,letterSpacing:.8}}>CHOOSE YOUR CANVAS SIZE TO BEGIN</p>
            </div>

            {/* Presets */}
            <div style={{marginBottom:20}}>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:10}}>PRESETS</div>
              <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(3,1fr)':'repeat(4,1fr)',gap:isMobile?5:7}}>
                {CANVAS_PRESETS.map(p=>{
                  const sel=spW===p.w&&spH===p.h;
                  const aspect=p.w/p.h;
                  const bw=Math.min(36,Math.round(36*Math.min(1,aspect)));
                  const bh=Math.min(24,Math.round(24*Math.min(1,1/aspect)));
                  return(
                    <button key={p.label} onClick={()=>{setSpW(p.w);setSpH(p.h);}}
                      style={{border:BORDER,borderRadius:9,padding:'10px 6px 8px',background:sel?LIME:WHITE,color:DARK,cursor:'pointer',transition:'all 110ms cubic-bezier(0.34,1.56,0.64,1)',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                      {/* Aspect ratio preview */}
                      <div style={{width:bw,height:bh,border:`1.5px solid ${sel?DARK:'rgba(0,0,0,.25)'}`,borderRadius:3,background:sel?'rgba(0,0,0,.12)':'rgba(0,0,0,.04)',flexShrink:0}}/>
                      <div style={{fontSize:10,fontWeight:800,fontFamily:"'Space Grotesk',sans-serif"}}>{p.label}</div>
                      <div style={{fontFamily:"'Space Mono',monospace",fontSize:7.5,color:sel?DARK:MUTED}}>{p.w}×{p.h}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom */}
            <div style={{marginBottom:isMobile?18:28}}>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,fontWeight:700,color:MUTED,letterSpacing:1,marginBottom:10}}>CUSTOM SIZE</div>
              <div style={{display:'flex',gap:isMobile?8:12,alignItems:'flex-end'}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Width (px)</div>
                  <input type="number" value={spW} onChange={e=>setSpW(Math.max(64,Math.min(4096,+e.target.value)))} className="inp" style={{textAlign:'center',fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:14}}/>
                </div>
                <span style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:800,color:MUTED,paddingBottom:10}}>×</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,fontWeight:700,marginBottom:6}}>Height (px)</div>
                  <input type="number" value={spH} onChange={e=>setSpH(Math.max(64,Math.min(4096,+e.target.value)))} className="inp" style={{textAlign:'center',fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:14}}/>
                </div>
                {/* Live aspect indicator */}
                <div style={{flexShrink:0,display:isMobile?'none':'flex',flexDirection:'column',alignItems:'center',gap:4,paddingBottom:8}}>
                  <div style={{width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',border:BORDER,borderRadius:8,background:SAND}}>
                    {(()=>{const a=spW/Math.max(1,spH);const bw=Math.min(22,Math.round(22*Math.min(1,a)));const bh=Math.min(22,Math.round(22*Math.min(1,1/a)));return<div style={{width:bw,height:bh,border:`1.5px solid ${DARK}`,borderRadius:2,background:'rgba(0,0,0,.08)'}}/>;})()}
                  </div>
                  <span style={{fontFamily:"'Space Mono',monospace",fontSize:7,color:MUTED,fontWeight:700}}>{(spW/Math.max(1,spH)).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Confirm */}
            <button onClick={confirmStartupSize}
              style={{width:'100%',height:54,border:BORDER,borderRadius:12,background:LIME,color:DARK,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,fontFamily:"'Space Grotesk',sans-serif",fontSize:15,fontWeight:800,letterSpacing:-0.3,transition:'all 100ms'}}>
              <Paintbrush2 size={17} strokeWidth={2.5}/>
              Start Painting — {spW} × {spH}
            </button>

            <div style={{marginTop:14,textAlign:'center'}}>
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:8.5,color:MUTED,fontWeight:700,letterSpacing:.5}}>CANVAS IS FREELY MOVABLE AND RESIZABLE ANYTIME</span>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
