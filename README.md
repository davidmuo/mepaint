
# mepaint

A browser-based painting studio where colour mixes like real pigment: blue and yellow make green, not grey. It has natural brushes, layers, frame-by-frame animation and real-time collaboration.

## Features

- **Pigment mixing.** Strokes blend with a Kubelka-Munk spectral model ([`pigment-mix.ts`](src/app/components/pigment-mix.ts)), not RGB averaging.
- **14 natural brushes** (soft round, bristle, watercolour, charcoal, gouache…), plus Procreate `.brush`/`.brushset` and Photoshop `.abr` (v1/v2) import.
- **Stabilizer.** The *Smooth* slider trails the brush behind the pointer for clean, confident lines. When you lift the pen, the stroke catches up to where you stopped.
- **Pop-up palette.** Right-click the canvas for a radial ring of recent colours and favourite brushes.
- **Layers** with opacity, blend modes, locking, image import, merge and flatten.
- **Selection tools:** transform, lasso (paint inside or move), symmetry, flip and textured paper surfaces.
- **Animate workspace** with onion skinning and WebM/SVG export.
- **Live rooms** with shared canvas, cursors and chat (Supabase Realtime).
- **Gallery** with 5-minute autosave. You can resume any piece from the start screen.
- **First-run guided tour.** Replay it any time from *Shortcuts* (`?`).
- **Light and dark themes.** A soft light theme and a neutral graphite studio theme. It follows the OS setting until you pick one from the header toggle. The theme variables live in [`mepaint-theme.css`](src/styles/mepaint-theme.css).

## Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `1`–`5` | Brushes | `E` / `S` | Eraser / smudge |
| `[` `]` | Brush size | `C` | Colour panel |
| `Ctrl+Z` | Undo | `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `T` / `L` | Transform / lasso | `Alt+E` | Eyedropper |
| `0` | Fit canvas to screen | `Space`+drag | Pan |

## Running the code

```bash
npm i        # install dependencies
npm run dev  # start the dev server
npm run build
```
