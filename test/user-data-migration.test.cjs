'use strict';

const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const { planUserDataMigration, LEGACY_USER_DATA_NAMES } =
  loadTs('src/main/userDataMigration.ts');

/** A fake disk: every listed dir exists, and is empty iff its value is 0. */
const disk = (dirs) => ({
  exists: (p) => p in dirs,
  isEmpty: (p) => (dirs[p] ?? 0) === 0
});

const NEW = '/Application Support/Office';
const OLD = '/Application Support/Munder Difflin';

test('a rename with an existing profile adopts the old dir', () => {
  assert.equal(planUserDataMigration(NEW, [OLD], disk({ [OLD]: 3 })), OLD);
});

test('the new dir already holding state is never clobbered', () => {
  // Both dirs full: the user has already run the renamed app. Migrating now
  // would throw away everything done since.
  assert.equal(planUserDataMigration(NEW, [OLD], disk({ [OLD]: 3, [NEW]: 5 })), null);
});

test('an empty new dir is still adopted — an installer may have created it', () => {
  assert.equal(planUserDataMigration(NEW, [OLD], disk({ [OLD]: 3, [NEW]: 0 })), OLD);
});

test('a fresh install with no old profile migrates nothing', () => {
  assert.equal(planUserDataMigration(NEW, [OLD], disk({})), null);
});

test('an empty old profile is not worth moving', () => {
  assert.equal(planUserDataMigration(NEW, [OLD], disk({ [OLD]: 0 })), null);
});

test('the first non-empty legacy name wins, and current is never its own source', () => {
  const DEV = '/Application Support/munder-difflin';
  assert.equal(planUserDataMigration(NEW, [OLD, DEV], disk({ [DEV]: 2 })), DEV);
  // Running the dev build under the OLD name: nothing to do, not a self-move.
  assert.equal(planUserDataMigration(DEV, [OLD, DEV], disk({ [DEV]: 2 })), null);
});

test('both legacy names are covered', () => {
  assert.deepEqual([...LEGACY_USER_DATA_NAMES], ['Munder Difflin', 'munder-difflin']);
});
