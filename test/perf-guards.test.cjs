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
const POOL = src('renderer', 'src', 'components', 'terminalPool.ts');
const WEBHOOKS = src('renderer', 'src', 'components', 'triggers', 'WebhooksSection.tsx');
const CCP = src('renderer', 'src', 'components', 'CommandCenterPanel.tsx');
const SESSION = src('renderer', 'src', 'realtime', 'session.ts');

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

test('terminal scrollback stays capped', () => {
  // One xterm per pty for the app's lifetime, so this constant is multiplied by
  // the whole floor. It was 100000 — 100x xterm's default, ~1.3 GB worst case.
  const m = POOL.match(/scrollback: (\d+),/);
  assert.ok(m, 'terminalPool should still set an explicit scrollback');
  assert.ok(Number(m[1]) <= 10000, `scrollback ${m[1]} is above the 10000 cap`);
});

// MD-60. Measured on the built bundle: deferring these three took the eager boot
// chunk 5 287 kB -> 2 939 kB and its parse+compile 54 ms / +19.6 MB RSS -> 29 ms /
// +9.1 MB. Each is one static import away from coming back, invisibly.
test('the heavy optional deps stay out of the eager bundle', () => {
  assert.doesNotMatch(WEBHOOKS, /^import \{[^}]*JsonEditor[^}]*\} from '\.\/JsonEditor';/m,
    'JsonEditor (CodeMirror, ~1.2 MB) must be lazy()');
  assert.doesNotMatch(CCP, /^import \{[^}]*MarkdownPreview[^}]*\} from '@\/markdown\/MarkdownPreview';/m,
    'MarkdownPreview (react-markdown, ~360 kB) must be lazy()');
  // The realtime SDK is deferred by importing it inside connect(), not by a
  // lazy component — session.ts exports a hook, which cannot be code-split.
  assert.doesNotMatch(SESSION, /^import \{[^}]*\} from '@openai\/agents-realtime';/m,
    "the agents-realtime SDK (~1.1 MB) must be a type-only import at module scope");
  assert.match(SESSION, /(?<!from )import\('@openai\/agents-realtime'\)/,
    'connect() should load the SDK on demand');
});

test('the task board is not polled while the floor is paused', () => {
  // ~99 kB of ledger crosses IPC on every 5 s tick; while paused nothing it
  // produces can be drawn.
  assert.match(FLOOR, /if \(pausedRef\.current\) return;/,
    'pollTaskBoard should bail out while the floor is paused');
  assert.match(FLOOR, /__pollTaskBoard/,
    'resuming the floor should take one catch-up poll');
});
