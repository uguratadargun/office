'use strict';

/**
 * MD-120 — the four Agents/Floor findings from the MD-119 QA pass.
 *
 * F1 is testable as a pure function plus the two call sites that must ask it.
 * F2 is arithmetic the class-string greps in modern-theme-contrast.test.cjs
 * cannot see: the old bug was a COMPOSITE, `opacity-60` on the row multiplying
 * a correct ladder down after the classes were already right. So this file does
 * the compositing itself and then pins the shape that keeps it from happening.
 * F3 and F5 are shapes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-ts.cjs');
const { presenceBubble, presenceCopy, PARKED_ACTION } = load('src/shared/agentPresence.ts');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/* ── F1 — the floor bubble ─────────────────────────────────────────────── */

test('F1: a processless agent gets presence copy for its bubble, not an action', () => {
  const asleep = { sleeping: true, action: 'reconnecting…' };
  const parked = { sleeping: false, action: 'reconnecting…' };
  assert.equal(presenceBubble(asleep), 'asleep');
  assert.equal(presenceBubble(parked), 'parked — no process');
  // A pty that died while the window was open: sleeping is set so mail can wake
  // it, and PARKED_ACTION is what still says it was a death (MD-114b).
  assert.equal(presenceBubble({ sleeping: true, action: PARKED_ACTION }), 'parked — no process');
});

test('F1: a live agent keeps its own action — presence must not talk over it', () => {
  assert.equal(presenceBubble({ ptyId: 'pty-x', action: 'edit App.tsx' }), '');
  assert.equal(presenceBubble({ ptyId: 'pty-x' }), '');
});

test('F1: the bubble and the detail pane use ONE vocabulary', () => {
  // Two surfaces describing the same agent must not invent separate words for
  // it — that is how the rail came to read `asleep` two inches from a character
  // insisting it was reconnecting.
  for (const a of [{ sleeping: true }, { sleeping: false }, { sleeping: true, action: PARKED_ACTION }]) {
    assert.equal(presenceBubble(a), presenceCopy(a).title.toLowerCase());
  }
});

test('F1: the scene asks presence BEFORE it reads action', () => {
  const src = read('scene/office/OfficeFloor.tsx');
  const body = /function liveActivity\(agent: Agent, fallback = ''\): string \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(body, 'liveActivity moved — re-point this test');
  const presenceAt = body[1].indexOf('presenceBubble(agent)');
  const actionAt = body[1].indexOf('agent.action');
  assert.ok(presenceAt >= 0, 'the floor bubble must ask presence');
  assert.ok(presenceAt < actionAt, 'presence must be consulted before the stale action');
});

test('F1: the store stops stamping reconnecting… on an agent with no pty', () => {
  const src = read('store/store.ts');
  const fn = /function loadPersistedAgents\(\): Agent\[\] \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(fn, 'loadPersistedAgents moved — re-point this test');
  assert.ok(/isProcessless\(a\)/.test(fn[1]),
    'the reconnecting… stamp must be conditional on there being a pty to reconnect');
  assert.ok(fn[1].includes('PARKED_ACTION'),
    'a parked agent must keep PARKED_ACTION across a reload or it reads as merely asleep');
});

/* ── F2 — the selection ladder must survive the fade ───────────────────── */

const TOKENS = fs.readFileSync(path.join(SRC, 'modern', 'tokens.css'), 'utf8');
function tokens(selector) {
  const css = TOKENS.replace(/\/\*[\s\S]*?\*\//g, '');
  const open = css.indexOf('{', css.indexOf(selector));
  const out = {};
  for (const m of css.slice(open, css.indexOf('\n}', open)).matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]+)\s*;/g)) {
    out['--' + m[1]] = m[2];
  }
  return out;
}
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
/** `opacity` on an element composites the element AND its background over
 *  whatever is behind it — which is why fading the row took the fill with it. */
const over = (fg, bg, alpha) => rgb(fg).map((c, i) => Math.round(c * alpha + rgb(bg)[i] * (1 - alpha)));
const apart = (a, b) => Math.max(...a.map((c, i) => Math.abs(c - b[i])));

for (const [theme, sel] of [['light', ':root {'], ['dark', ":root[data-cth-theme='dark']"]]) {
  test(`F2: fading the ROW would collapse selected onto hover in ${theme}`, () => {
    // The measurement that made this an S3 rather than a nitpick. Kept as a
    // test so that if someone reaches for opacity on the row again, the number
    // that says why is right here rather than in a QA doc.
    const t = tokens(sel);
    const ground = rgb(t['--background']);
    const hoverAwake = rgb(t['--accent']);
    const selectedFaded = over(t['--selected'], t['--background'], 0.6);
    assert.ok(apart(selectedFaded, hoverAwake) <= 4,
      `${theme}: expected the old composite to sit on the hover fill, got ${selectedFaded} vs ${hoverAwake}`);
    // And the ladder is real at full strength — this is what is being protected.
    assert.ok(apart(rgb(t['--selected']), hoverAwake) > 4, `${theme}: selected must clear hover`);
    assert.ok(apart(hoverAwake, ground) > 4, `${theme}: hover must clear the ground`);
  });
}

test('F2: the fade is on the row CONTENT, never on the row', () => {
  const src = read('modern/agents/AgentList.tsx');
  const btn = /className=\{cn\(\s*'group w-full rounded-lg border[\s\S]*?\)\}/.exec(src);
  assert.ok(btn, 'the AgentRow button className moved — re-point this test');
  assert.ok(!/opacity-/.test(btn[0]),
    'opacity on the row composites the selection fill down with it — fade an inner element');
  assert.match(src, /<span className=\{cn\('block', isProcessless\(agent\) && 'opacity-60'\)\}>/,
    'the processless fade must still exist, on a content wrapper');
});

/* ── F3 — the disabled engine controls say why ─────────────────────────── */

test('F3: a disabled engine row carries a reason, on a span trigger', () => {
  const src = read('modern/agents/AgentsOverview.tsx');
  const tail = src.slice(src.indexOf('function EngineRow('));
  assert.match(tail, /if \(!disabled\) return row;/,
    'an enabled row must not grow a tooltip it does not need');
  assert.match(tail, /<TooltipTrigger asChild>\s*<span[^>]*>\{row\}<\/span>/,
    'a disabled control is pointer-events:none — the span must be the trigger');
  assert.match(tail, /wake this agent first/, 'the reason must name the action that fixes it');
});

/* ── F5 — the restore-failure note ─────────────────────────────────────── */

test('F5: the bulk-restore summary counts and names, and leaves paths to the rows', () => {
  const hook = read('hooks/useRestoreTeam.ts');
  assert.match(hook, /failures\[a\.id\] = out\.error/, 'each failure must be filed under its agent id');
  const note = /if \(failedNames\.length\) parts\.push\(([\s\S]*?)\);/.exec(hook);
  assert.ok(note, 'the failure summary moved — re-point this test');
  // Names joined with a comma and NOTHING else: a `map` or a `;` separator in
  // here is the shape that produced five wrapped lines of absolute path.
  assert.match(note[1], /failedNames\.join\(', '\)/, 'the summary lists names');
  assert.ok(!/\.map\(|'; '|out\.error/.test(note[1]),
    'the summary must not repeat a reason per agent — the row prints its own');
  assert.match(hook, /restoreFailures: Record<string, string>/, 'the rows need the reasons');

  const view = read('modern/agents/AgentsOverview.tsx');
  assert.match(view, /\{ \.\.\.restoreFailures, \.\.\.ownErrors \}/,
    'a row must show a bulk-restore failure in the same slot as its own');
});
