# Attributions

## Third-party code

### libmypaint (ISC licence)

`src/app/mypaint/` (`brush.ts`, `surface.ts`, `helpers.ts`, `settings.ts`) is a TypeScript port of parts of
[libmypaint](https://github.com/mypaint/libmypaint) at commit `d5a88fb`: the brush engine, dynamics mappings,
dab rasteriser, blend modes and spectral "pigment" mixing.

```
libmypaint - The MyPaint Brush Library
Copyright (C) 2007-2014 Martin Renold <martinxyz@gmx.ch> and contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### shadcn/ui (MIT)

This project includes components from [shadcn/ui](https://ui.shadcn.com/) used under the
[MIT licence](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).

## Brushes and media

### MyPaint brushes (CC0 1.0)

`public/brushes/mypaint/*.myb` are brush settings from
[mypaint-brushes](https://github.com/mypaint/mypaint-brushes), dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Only the settings files are included (not the
upstream preview images); `index.json` records each brush's source path. With thanks to the artists:
David Revoy, Ramón Miranda, Marcelo "Tanda" Cerviño, Guillaume Loussarévian, Brien Dieterle, and the MyPaint team.

### Photos

This project includes photos from [Unsplash](https://unsplash.com) used under [licence](https://unsplash.com/license).

## Original work (no third-party code)

The pigment mixer (`src/app/components/pigment-mix.ts`), stroke stabilizer, pop-up palette, wet smudge,
impasto lighting, pressure curves, dual brush, gamut masks, mixing palette, canvas rotation, wrap-around tiling
and perspective guides are independent implementations. Some are inspired by features found in Krita, but no
Krita source code (GPL) is used.
