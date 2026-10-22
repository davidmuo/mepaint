// ─── Design tokens ────────────────────────────────────────────────────────────
// Every colour resolves through a CSS variable (src/styles/mepaint-theme.css), so
// the same inline styles render the light or dark theme. Names are historical:
// they describe the role each token played in the original palette.
export const CREAM   = 'var(--mp-bg)';          // workspace backdrop
export const WHITE   = 'var(--mp-surface)';     // panels, bars, cards
export const DARK    = 'var(--mp-ink)';         // text; also inverted (primary-dark) fills
export const LIME    = 'var(--mp-tint)';        // selected / active fill
export const PINK    = 'var(--mp-danger)';      // destructive
export const ACCENT  = 'var(--mp-accent)';      // vivid accent: CTAs, focus, strokes
export const ACCENT_INK = 'var(--mp-accent-ink)'; // accent text on tint
export const ON_ACCENT  = 'var(--mp-on-accent)';
export const MUTED   = 'var(--mp-muted)';
export const SAND    = 'var(--mp-surface-2)';   // secondary fills
export const LINE    = 'var(--mp-line)';
export const LINE_STRONG = 'var(--mp-line-strong)';
export const HERO    = 'var(--mp-hero)';       // fixed dark brand panel
export const BORDER  = '1px solid var(--mp-line)';
export const BR      = '10px';
export const SHADOW_SM = 'var(--mp-shadow-sm)';
export const SHADOW    = 'var(--mp-shadow-lg)';
export const SANS = "'Geist',system-ui,sans-serif";
export const MONO = "'Geist Mono',ui-monospace,monospace";
