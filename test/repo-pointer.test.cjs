'use strict';

// Which GitHub repo this app belongs to is written down in three places that
// must agree — the builder's `publish` block (stamped into app-update.yml, so
// it decides what a packaged build polls), `updater.ts`'s REPO (the in-app
// check and its releases/latest fallback), and package.json's repository URL.
// Nothing pinned them together, which is how all three sat pointing at the
// upstream project this was forked from long after the fork. A packaged build
// would have offered someone else's release as an update to ours.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const EXPECTED = 'uguratadargun/office';

test('electron-builder publish, updater REPO and package.json name the same repo', () => {
  const yml = read('electron-builder.yml');
  const owner = /^\s*owner:\s*(\S+)\s*$/m.exec(yml);
  const repo = /^\s*repo:\s*(\S+)\s*$/m.exec(yml);
  assert.ok(owner && repo, 'electron-builder.yml has no publish owner/repo');
  assert.equal(`${owner[1]}/${repo[1]}`, EXPECTED);

  const updater = /const REPO = '([^']+)'/.exec(read('src', 'main', 'updater.ts'));
  assert.ok(updater, 'updater.ts no longer declares a REPO constant');
  assert.equal(updater[1], EXPECTED);

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.repository.url, `https://github.com/${EXPECTED}.git`);
});

// The bundle id is the app's identity to the OS: macOS keys TCC folder grants
// and the Keychain ACL by it, Windows keys its registry entries by it. Changing
// it re-prompts every user once, so it must not drift back by accident — and the
// old munderdiffl.in-derived id must not survive anywhere in code or config.
const APP_ID = 'com.drgn.office';
const STALE_APP_ID = 'in.munderdiffl.office';

test('the bundle id is com.drgn.office and the old one is gone', () => {
  const appId = /^\s*appId:\s*(\S+)\s*$/m.exec(read('electron-builder.yml'));
  assert.ok(appId, 'electron-builder.yml declares no appId');
  assert.equal(appId[1], APP_ID);

  const hits = [];
  for (const f of ['electron-builder.yml', 'package.json']) {
    if (read(f).includes(STALE_APP_ID)) hits.push(f);
  }
  for (const dir of ['src', 'tools', 'build', '.github']) {
    for (const f of files(join(ROOT, dir))) {
      if (readFileSync(f, 'utf8').includes(STALE_APP_ID)) hits.push(f.slice(ROOT.length + 1));
    }
  }
  assert.deepEqual(hits, []);
});

// The three above are the ones that break an update. The rest — hero feed, the
// GitHub links in the UI, the release-link checker — are the ones that rot
// silently, so sweep the whole source tree instead of listing them.
const STALE = 'chaitanyagiri/munder-difflin';
const SKIP = new Set(['node_modules', '.git', 'out', 'dist', 'release']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

test('no source or config file still points at the upstream repo', () => {
  const hits = [];
  for (const dir of ['src', 'tools', 'build', '.github']) {
    for (const f of files(join(ROOT, dir))) {
      if (readFileSync(f, 'utf8').includes(STALE)) hits.push(f.slice(ROOT.length + 1));
    }
  }
  // CHANGELOG/RELEASE.md keep upstream PR links deliberately — they are history,
  // not pointers, which is why only code and config are swept here.
  assert.deepEqual(hits, []);
});
