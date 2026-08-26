'use strict';

/**
 * MD-151 — the modern Add-Agent dialog was missing four things the pixel modal
 * has: a per-agent token cap, the five role templates, the resume-session
 * folder fill, and registering a project.
 *
 * The token cap is the one with teeth: `agentTokenCaps` is what the breaker
 * enforces, so a form that writes it wrong either strangles an agent on its
 * first turn or uncaps the whole floor. The arithmetic and the merge are pinned
 * here, and both UIs are pinned to the same implementation of them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const { resolveTokenCap, withAgentCap, formatTokenCap } = loadTs('src/shared/tokenCap.ts');
const { ROLE_TEMPLATES } = loadTs('src/shared/roleTemplates.ts');

test('an empty budget field is NO cap, never a cap of zero', () => {
  assert.equal(resolveTokenCap(''), undefined);
  assert.equal(resolveTokenCap('   '), undefined);
  assert.equal(resolveTokenCap('0'), undefined);
  // Nothing typed → a manifest's value still stands.
  assert.equal(resolveTokenCap('', 2_000_000), 2_000_000);
  assert.equal(resolveTokenCap('0', 2_000_000), 2_000_000);
  // A manifest asking for zero is not a cap either.
  assert.equal(resolveTokenCap('', 0), undefined);
});

test('what the human typed beats what the manifest asked for', () => {
  assert.equal(resolveTokenCap('500000', 2_000_000), 500_000);
  // Typed the way people type budgets.
  assert.equal(resolveTokenCap('2,000,000'), 2_000_000);
  assert.equal(resolveTokenCap('1 000 000'), 1_000_000);
  assert.equal(formatTokenCap(2_000_000), '2,000,000');
});

test('capping one agent does not uncap the others', () => {
  const caps = { michael: 1000, pam: 2000 };
  assert.deepEqual(withAgentCap(caps, 'jim', 3000), { michael: 1000, pam: 2000, jim: 3000 });
  assert.deepEqual(caps, { michael: 1000, pam: 2000 }, 'the existing map was mutated');
  assert.deepEqual(withAgentCap(undefined, 'jim', 3000), { jim: 3000 });
});

test('there is ONE set of role templates, and both forms use it', () => {
  assert.equal(ROLE_TEMPLATES.length, 5);
  for (const t of ROLE_TEMPLATES) {
    assert.ok(t.label && t.description && t.goal, `${t.label} is incomplete`);
  }
  assert.deepEqual(
    ROLE_TEMPLATES.map((t) => t.label),
    ['Repo janitor', 'Docs writer', 'Bug triager', 'Research assistant', 'Release manager']
  );
  for (const file of [
    'src/renderer/src/components/AddAgentModal.tsx',
    'src/renderer/src/modern/agents/AddAgentDialog.tsx'
  ]) {
    assert.match(read(file), /ROLE_TEMPLATES/, `${file} does not use the shared templates`);
  }
});

test('the registered-projects rules live in one hook', () => {
  const hook = read('src/renderer/src/hooks/useProjectRegistry.ts');
  // Front, deduped.
  assert.match(hook, /\[p, \.\.\.repos\.filter\(\(r\) => r !== p\)\]/);
  // Adopt what main stored — it expands `~`.
  assert.match(hook, /updated\.registeredRepos \?\? next/);
  // After an isolated spawn, promote the PROJECT and not the worktree.
  assert.match(hook, /worktree \? picked\.trim\(\) : spawnedCwd/);

  const pixel = read('src/renderer/src/components/AddAgentModal.tsx');
  assert.match(pixel, /useProjectRegistry\(config, onConfigChange\)/);
  assert.doesNotMatch(pixel, /setRepos\(/, 'the pixel modal still owns the list itself');
});

test('the modern dialog has all four, and the hire pre-fill still feeds them', () => {
  const src = read('src/renderer/src/modern/agents/AddAgentDialog.tsx');
  assert.match(src, /id="agent-token-cap"/, 'no token budget field');
  assert.match(src, /withAgentCap\(config\.agentTokenCaps, id, cap\)/, 'the cap is not persisted');
  assert.match(src, /hire\?\.tokenCap/, 'a manifest cap no longer pre-fills the field');
  assert.match(src, /ROLE_TEMPLATES\.map/, 'no role templates');
  assert.match(src, /onBlur=\{\(\) => void resolveFolderFromSession\(\)\}/, 'resume does not fill the folder');
  assert.match(src, /window\.cth\.resolveSessionCwd/);
  assert.match(src, /useProjectRegistry\(config, onConfigChange\)/, 'projects are not registered');
  assert.match(src, /promoteProject\(cwd\.trim\(\), realCwd, res\.worktreePath\)/);
  // MD-148 must keep working: every field still seeds from a pushed manifest.
  assert.match(src, /const hire = editing \? undefined : pendingHire/);
});
