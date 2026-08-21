'use strict';

/**
 * Which installer a fresh worktree gets.
 *
 * A `git worktree` checkout has no node_modules, so an isolated agent cannot run
 * the repo's tests until something installs — which is why every dispatch had to
 * remember to say "run npm ci first", and the ones that forgot produced an agent
 * that could not verify its own work.
 *
 * Picking the WRONG installer is worse than picking none: `npm ci` in a pnpm repo
 * rewrites the lockfile and hands the agent a tree its project never described.
 * So the precedence is the thing worth pinning.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { pickInstall, LOCKFILE_INSTALL } = loadTs('src/shared/lockfiles.ts');

const withFiles = (...files) => (f) => files.includes(f);

test('each lockfile selects its own package manager', () => {
  assert.deepEqual(pickInstall(withFiles('pnpm-lock.yaml')), { lock: 'pnpm-lock.yaml', cmd: 'pnpm', args: ['install', '--frozen-lockfile'] });
  assert.deepEqual(pickInstall(withFiles('yarn.lock')),      { lock: 'yarn.lock', cmd: 'yarn', args: ['install', '--frozen-lockfile'] });
  assert.deepEqual(pickInstall(withFiles('bun.lockb')),      { lock: 'bun.lockb', cmd: 'bun',  args: ['install', '--frozen-lockfile'] });
  assert.deepEqual(pickInstall(withFiles('package-lock.json')), { lock: 'package-lock.json', cmd: 'npm', args: ['ci'] });
});

test('a dedicated package manager beats a leftover package-lock.json', () => {
  // Repos that migrated to pnpm/yarn often still carry the old npm lockfile.
  // Running `npm ci` there rewrites the tree the project actually describes.
  assert.equal(pickInstall(withFiles('pnpm-lock.yaml', 'package-lock.json')).cmd, 'pnpm');
  assert.equal(pickInstall(withFiles('yarn.lock', 'package-lock.json')).cmd, 'yarn');
  assert.equal(pickInstall(withFiles('bun.lockb', 'package-lock.json')).cmd, 'bun');
});

test('no lockfile means no install — never guess', () => {
  assert.equal(pickInstall(withFiles()), null);
  assert.equal(pickInstall(withFiles('package.json')), null,
    'a package.json without a lockfile is not enough to reproduce a tree');
  assert.equal(pickInstall(withFiles('Cargo.toml', 'go.mod')), null);
});

test('every plan installs from the lockfile, never resolving fresh', () => {
  for (const p of LOCKFILE_INSTALL) {
    const frozen = p.args.includes('--frozen-lockfile') || p.args.includes('ci');
    assert.ok(frozen, `${p.cmd} must install from the lockfile, got: ${p.args.join(' ')}`);
  }
});
