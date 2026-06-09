/* Tests for the QMK/keymap-editor info.json layout parser (layout-json.js).
   Verifies conversion into the internal centi-unit geometry model
   {w,h,x,y,rot,rx,ry}, including a rotated board. Run: node test/layout-json.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseQmkInfoJson } = require('../layout-json.js');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

console.log('basic conversion: key units -> centi-units, defaults');
{
  const lay = parseQmkInfoJson({ layouts: { d: { layout: [ { x: 0, y: 0 }, { x: 1, y: 2 } ] } } });
  eq(lay.length, 1, 'one layout returned');
  eq(lay[0].length, 2, 'two keys');
  eq(lay[0][0], { w: 100, h: 100, x: 0, y: 0, rot: 0, rx: 0, ry: 0 }, 'origin key: x100, w/h default 1u, no rotation');
  eq(lay[0][1], { w: 100, h: 100, x: 100, y: 200, rot: 0, rx: 100, ry: 200 }, 'positioned key: x/y x100, rx/ry default to x/y');
}

console.log('width alias: keymap-editor uses `u`, QMK/KLE use `w`');
{
  const u = parseQmkInfoJson({ layouts: { d: { layout: [ { x: 0, y: 0, u: 1.5 } ] } } });
  const w = parseQmkInfoJson({ layouts: { d: { layout: [ { x: 0, y: 0, w: 1.5 } ] } } });
  eq(u[0][0].w, 150, '`u` is read as width (1.5u -> 150)');
  eq(w[0][0].w, 150, '`w` is read as width (1.5u -> 150)');
  const h = parseQmkInfoJson({ layouts: { d: { layout: [ { x: 0, y: 0, h: 2 } ] } } });
  eq(h[0][0].h, 200, '`h` is read as height (2u -> 200)');
}

console.log('rotation: degrees -> centi-degrees, absolute pivot');
{
  const lay = parseQmkInfoJson({ layouts: { d: { layout: [ { x: 3, y: 0, r: 22.5, rx: 3.5, ry: 1 } ] } } });
  eq(lay[0][0], { w: 100, h: 100, x: 300, y: 0, rot: 2250, rx: 350, ry: 100 }, 'r*100 centi-degrees; rx/ry absolute x100');
}

console.log('rotation pivot defaults to the key\'s own x/y when rx/ry omitted');
{
  const lay = parseQmkInfoJson({ layouts: { d: { layout: [ { x: 2, y: 1, r: 10 } ] } } });
  eq(lay[0][0].rx, 200, 'rx defaults to x (200)');
  eq(lay[0][0].ry, 100, 'ry defaults to y (100)');
}

console.log('layout array is index-aligned to bindings (count preserved, order kept)');
{
  const lay = parseQmkInfoJson({ layouts: { d: { layout: [ { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 } ] } } });
  eq(lay[0].length, 3, 'all 3 keys present in order');
  eq(lay[0].map(k => k.x), [0, 100, 200], 'x order preserved');
}

console.log('accepts a layout given as a bare array (not wrapped in {layout:[]})');
{
  const lay = parseQmkInfoJson({ layouts: { d: [ { x: 0, y: 0 }, { x: 1, y: 0 } ] } });
  eq(lay[0].length, 2, 'bare-array layout parsed');
}

console.log('multiple named layouts each become a layout');
{
  const lay = parseQmkInfoJson({ layouts: {
    full: { layout: [ { x: 0, y: 0 }, { x: 1, y: 0 } ] },
    split: { layout: [ { x: 0, y: 0 } ] }
  } });
  eq(lay.length, 2, 'two layouts');
  eq(lay.map(l => l.length).sort(), [1, 2], 'each layout keeps its own key count');
}

console.log('rejects non-layout / malformed JSON (this is the safety filter)');
{
  eq(parseQmkInfoJson('not json at all {'), [], 'invalid JSON string -> []');
  eq(parseQmkInfoJson({ name: 'my-package', version: '1.0.0' }), [], 'package.json-shaped object -> []');
  eq(parseQmkInfoJson({ layouts: {} }), [], 'empty layouts -> []');
  eq(parseQmkInfoJson(null), [], 'null -> []');
  eq(parseQmkInfoJson({ layouts: { d: { layout: [ { row: 0, col: 0 } ] } } }), [], 'keys without x/y -> [] (no coords to place)');
  eq(parseQmkInfoJson({ layouts: { d: { layout: [ { x: 0, y: 0 }, { row: 1 } ] } } }), [], 'partial layout (one key lacks coords) -> rejected, not half-rendered');
}

console.log('real rotated fixture file -> exact expected coords');
{
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'info-rotated.json'), 'utf8');
  const lay = parseQmkInfoJson(text);
  eq(lay.length, 1, 'fixture yields one layout');
  eq(lay[0], [
    { w: 100, h: 100, x: 0,   y: 0,   rot: 0,     rx: 0,   ry: 0   },
    { w: 150, h: 100, x: 100, y: 0,   rot: 0,     rx: 100, ry: 0   },
    { w: 100, h: 100, x: 0,   y: 100, rot: 1500,  rx: 0,   ry: 100 },
    { w: 125, h: 100, x: 100, y: 100, rot: -3000, rx: 100, ry: 100 }
  ], 'all four keys convert correctly, incl. +15deg and -30deg rotated thumbs with `u` width');
}

console.log(`\n${pass} assertions passed.`);
