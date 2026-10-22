
# mepaint

A browser-based painting studio where colour mixes like real pigment: blue and yellow make green, not grey. It has natural brushes, wet blending, thick paint, layers, frame-by-frame animation and real-time collaboration.

## Features

**Paint**
- **Pigment mixing.** Strokes blend with a Kubelka-Munk spectral model ([`pigment-mix.ts`](src/app/components/pigment-mix.ts)), not RGB averaging.
- **14 built-in brushes** plus **49 MyPaint brushes**. The MyPaint brushes run on a TypeScript port of the libmypaint engine, with its 10-band spectral pigment mode. Procreate `.brush`/`.brushset` and Photoshop `.abr` (v1/v2) import is also supported.
- **Wet smudge.** Two modes: *smear* drags paint along with its texture, and *dull* averages it. *Colour rate* loads fresh paint for wet-into-wet blending.
- **Impasto.** Thick-paint brushes build up a surface that catches a raking light.
- **Pressure curves** (draggable editor and presets), speed thinning, jitter, **paper grain** and **dual brush** tips.
- **Stabilizer.** The brush trails the pointer for clean ink lines.
- **Pop-up palette.** Right-click the canvas for recent colours and favourite brushes.

**Colour**
- Saturation/value square, or a hue wheel with **gamut masks** (triad, complement, analogous, split).
- **Mixing palette.** Dab paint on a porcelain slab, fold it together with a palette knife, then pick the mix.

**Canvas**
- Layers with opacity, blend modes, locking, image import, merge and flatten.
- Transform, lasso, symmetry, flip and textured paper surfaces.
- **Canvas rotation**, **wrap-around tiling** for seamless textures, and **1- or 2-point perspective guides** with stroke snapping.

**More**
- Animate workspace with onion skinning and WebM/SVG export.
- Live rooms with a shared canvas, cursors and chat (Supabase Realtime).
- Gallery with 5-minute autosave; resume any piece from the start screen.
- Light and dark themes (follows the OS setting until you pick one).
- First-run guided tour, replayable from *Shortcuts* (`?`).

## Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `1`–`5` | Brushes | `E` / `S` | Eraser / smudge |
| `[` `]` | Brush size | `C` / `P` | Colour panel / mixing palette |
| `Ctrl+Z` | Undo | `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `T` / `L` | Transform / lasso | `Alt+E` | Eyedropper |
| `,` `.` / `R` | Rotate view / reset | `W` / `A` | Wrap-around / perspective guides |
| `0` | Fit canvas to screen | `Space`+drag | Pan (`Shift` too: rotate) |

## Running the code

```bash
npm i        # install dependencies
npm run dev  # start the dev server
npm run build
```

## Licences

Third-party code and assets are listed in [ATTRIBUTIONS.md](ATTRIBUTIONS.md): libmypaint (ISC), the MyPaint brushes (CC0) and shadcn/ui (MIT).
