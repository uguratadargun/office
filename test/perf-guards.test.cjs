'use strict';

// MD-53 guards. Both wins here are one-line properties of the source that
// nothing else would notice losing: the app would still work, just slower and
// fatter, exactly the way it silently got that way in the first place.
//
// Measured on this branch (empty office, 60 Hz display, medians over 8×5 s):
//   • floor ticker running 15.1% CPU vs 3.9% stopped — the office floor is 74%
//     of the app's idle cost, so any full-viewport cover that forgets to pause
//     it burns ~11 points on pixels nobody can see.
//   • eager renderer bundle 11 967 kB → 5 287 kB once the IDE is split out;
//     boot parse+compile 121 ms → 54 ms, +46.9 MB → +19.6 MB RSS.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const src = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf8');

const APP = src('renderer', 'src', 'App.tsx');
const FLOOR = src('renderer', 'src', 'scene', 'office', 'OfficeFloor.tsx');

test('the IDE and the file editor stay out of the eager bundle', () => {
  // A plain `import { IdePanel } from '@/ide/IdePanel'` drags all of Monaco
  // (~6.3 MB) back into the boot chunk, and typecheck/lint would say nothing.
  assert.doesNotMatch(APP, /^import\s[^;]*from\s+'@\/ide\/IdePanel';/m,
    'IdePanel must be lazy() + import(), not a static import');
  assert.doesNotMatch(APP, /^import\s[^;]*from\s+'@\/components\/FullscreenFileEditor';/m,
    'FullscreenFileEditor must be lazy() + import(), not a static import');
  for (const mod of ['@/ide/IdePanel', '@/components/FullscreenFileEditor']) {
    assert.match(APP, new RegExp(`lazy\\(\\(\\) =>\\s*\\n?\\s*import\\('${mod.replace(/[/]/g, '\\/')}'\\)`),
      `${mod} should be code-split with lazy(() => import(...))`);
  }
  // A lazy component thrown without a Suspense boundary crashes the render.
  assert.match(APP, /<Suspense/, 'lazy() components need a Suspense boundary');
});

test('every full-viewport cover pauses the office floor', () => {
  const line = FLOOR.split('\n').find((l) => /^\s*const paused =/.test(l));
  assert.ok(line, 'OfficeFloor should still compute a `paused` flag');
  // The three opaque, inset-0 covers plus the hidden window. `ideOpen` was the
  // one missing when this test was written — the floor animated at full rate
  // underneath an opaque IDE panel.
  for (const flag of ['fullscreenAgentId', 'fullscreenFilePath', 'ideOpen', 'docHidden']) {
    assert.ok(line.includes(flag), `\`paused\` must account for ${flag}`);
  }
});

test('the floor ticker is capped so a 120 Hz display does not double its cost', () => {
  assert.match(FLOOR, /ticker\.maxFPS = 60;/,
    'Pixi follows the display refresh rate unless maxFPS caps it');
});
