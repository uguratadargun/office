'use strict';

// The boss's name is a SETTING (config.bossName), resolved through exactly one
// accessor: src/shared/bossName.ts. 331 occurrences across 52 files had to be
// swept to get there, and a single re-inlined literal is invisible until a user
// renames the boss and finds one panel still calling him Michael.
//
// So: no bare "Michael" survives in shipped source outside the allowlist below.
// Two things deliberately keep the name and are NOT the boss:
//   • the Office parody CAST — 'michael' is one of fifteen selectable sprite
//     characters (Jim, Pam, Dwight…), a skin, not the orchestrator;
//   • frozen release copy (a published release body / its dev fixture), which is
//     history in the same sense CHANGELOG entries are.
// Comments are not swept — they are not user-visible, and rewriting 200 of them
// would have buried the change. Identifiers (MichaelBooting, michael-voice) are
// not swept either: file paths and the 'god' routing id stay put by design.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** Files allowed to spell the name out. */
const ALLOWED = new Set([
  // The ONE default. Everything else reads it through bossName().
  'src/shared/bossName.ts',
  // Office-parody cast roster: a sprite skin named after the show's character.
  'src/renderer/src/scene/office/cast.ts',
  // Frozen release copy — published/simulated release bodies, i.e. history.
  'src/shared/releaseDrop.ts',
  'src/main/updater.ts'
]);

/** Bare "Michael" — not MichaelBooting, not michael-voice, not 'michael'. */
const BARE = /(?<![A-Za-z0-9_-])Michael(?![A-Za-z0-9_-])/;

/** A line that is nothing but a comment. Comments are not user-visible. */
const COMMENT = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield full;
  }
}

test('no bare "Michael" outside the allowlist — the name is a setting', () => {
  const hits = [];
  for (const f of sources(SRC)) {
    const rel = f.slice(ROOT.length + 1).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (COMMENT.test(line)) return;
      if (BARE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(hits, [], `inline the boss name nowhere — use bossName(config):\n${hits.join('\n')}`);
});

// The allowlist only earns its keep if the accessor it protects actually works.
test('bossName() falls back on unset, blank and whitespace', () => {
  const { bossName, DEFAULT_BOSS_NAME } = require('../src/shared/bossName.ts');
  assert.equal(bossName(undefined), DEFAULT_BOSS_NAME);
  assert.equal(bossName(null), DEFAULT_BOSS_NAME);
  assert.equal(bossName({}), DEFAULT_BOSS_NAME);
  assert.equal(bossName({ bossName: '' }), DEFAULT_BOSS_NAME);
  assert.equal(bossName({ bossName: '   ' }), DEFAULT_BOSS_NAME);
  assert.equal(bossName({ bossName: 'Toby' }), 'Toby');
  assert.equal(bossName({ bossName: '  Toby  ' }), 'Toby');
});

// The default must be declared exactly once, in the accessor — a second copy is
// how "renamed everywhere except one screen" comes back.
test('DEFAULT_BOSS_NAME is declared once, in the accessor', () => {
  const src = readFileSync(join(SRC, 'shared', 'bossName.ts'), 'utf8');
  const decls = src.match(/=\s*'Michael'/g) ?? [];
  assert.equal(decls.length, 1);
});
