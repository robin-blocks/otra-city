# Third-party notices

Code and assets this repository carries that were written elsewhere. Their
licences are reproduced or pointed to here because the vendored copies do not
always carry the notice themselves.

## three.js (vendored at `public/vendor/three/`, also a dependency)

Copyright © 2010-2026 three.js authors — https://github.com/mrdoob/three.js

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Draco (decoder vendored at `public/vendor/three/jsm/libs/draco/`)

Apache License 2.0 — https://github.com/google/draco. Used by the client to
decode Draco-compressed plots; the same decoder is a dependency
(`draco3dgltf`) of the validator.

## Fable Cities (patterns and two ported files)

`public/js/quality.js` (hardware detection and preset selection) and the
frame-time guard in `public/js/perfguard.js` are ported from
https://github.com/rawprogress/fable-cities (`src/shared/quality.js`,
`src/modules/perfguard/`), and `scripts/check-client.mjs` follows the shape of
its `tools/check.mjs` and `tools/uishot.mjs`. Both are marked at the top of the
file. Fable Cities is MIT licensed:

MIT License

Copyright (c) 2026 raw (github.com/rawprogress)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
