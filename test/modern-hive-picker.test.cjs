// The modern hive picker (MD-87b) — two invariants that fail SILENTLY.
//
// Neither is a type error and neither is visible in a screenshot, which is why
// they are pinned here rather than left to review:
//
//   1. `useHive` must be gated on hiveOpened, NOT on onboardingComplete. The
//      picker exists so the user can switch hives BEFORE anything spins up;
//      bootstrapping earlier starts agents, terminals and pollers against the
//      hive they are in the middle of leaving. The pixel App gets this right
//      (`useHive(hiveOpened ? config : null)`), so the modern one must too.
//
//   2. Both UIs must use the SAME skip-once localStorage key. changeHome
//      relaunches the process, and a switch can begin in one front-end and come
//      back up in the other. Two keys means the flag is written by one and never
//      read by the other, so the user lands back on the picker for the hive they
//      just chose — and it looks like the switch failed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const pixelApp = read('App.tsx');
const modernApp = read('modern', 'App.tsx');
const modernPicker = read('modern', 'hivepicker', 'HivePickerView.tsx');
const pixelPicker = read('components', 'HivePicker.tsx');

test('the modern App bootstraps the hive only after the picker is passed', () => {
  const call = modernApp.match(/useHive\(([^)]*)\)/);
  assert.ok(call, 'modern App no longer calls useHive');
  assert.match(
    call[1],
    /hiveOpened/,
    `useHive(${call[1]}) — must gate on hiveOpened, or agents start in the hive ` +
    'the user is still choosing to leave'
  );
  assert.ok(
    !/useHive\([^)]*onboardingComplete/.test(modernApp),
    'useHive must not gate on onboardingComplete — that fires before the picker'
  );
});

test('the pixel App still gates the same way (the behaviour being matched)', () => {
  const call = pixelApp.match(/useHive\(([^)]*)\)/);
  assert.ok(call, 'pixel App no longer calls useHive');
  assert.match(call[1], /hiveOpened/);
});

test('both front-ends share one skip-once key', () => {
  const KEY = 'cth.skipHivePickerOnce';
  for (const [name, src] of [['modern picker', modernPicker], ['pixel picker', pixelPicker]]) {
    assert.ok(src.includes(KEY), `${name} does not use ${KEY}`);
  }
  // The modern App must READ the shared constant, not re-spell the string —
  // re-spelling is how the two drift apart one rename later.
  assert.match(
    modernApp,
    /import \{[^}]*SKIP_KEY[^}]*\} from '\.\/hivepicker\/HivePickerView'/,
    'modern App should import SKIP_KEY rather than inline the string'
  );
  assert.ok(
    !/'cth\.skipHivePickerOnce'/.test(modernApp),
    'modern App inlines the key instead of importing it'
  );
});

test('a failed switch takes the skip flag back', () => {
  // changeHome only RETURNS on failure (success relaunches). Leaving the flag
  // set there would skip the picker on the next launch for a hive that was
  // never opened.
  const removals = modernPicker.match(/removeItem\(SKIP_KEY\)/g) ?? [];
  assert.ok(
    removals.length >= 2,
    `expected the flag to be taken back on both the !ok and the throw path, found ${removals.length}`
  );
});
