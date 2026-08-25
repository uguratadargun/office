'use strict';

/**
 * MD-99 — cross-area deep links actually land, and two Integrations rows stop
 * lying.
 *
 * MD-94 found every "Settings ↗" on the Integrations page arriving at Settings ›
 * General, because `navigate()` took a nav id and nothing else: four rows, one
 * destination, none of them right. The fix is a target that carries a section
 * and a row anchor, so what is pinned here is the part a rewrite would tidy
 * away — that a repeat navigation to the page you are ALREADY on still fires,
 * and that every anchor a row names is a row that exists.
 *
 * The two data fixes are the same shape: a claim the UI made that main does not
 * make (Slack "cannot start" without a bot token) and a list printed from the
 * wrong source (endpoint ids, disabled endpoints offered as live ones).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { navigate, navTarget, activeNavId } = loadTs('src/renderer/src/modern/navigation.ts');
const { SETTINGS, SECTIONS, isSection } = loadTs('src/renderer/src/modern/settings/index.ts');
const { slackRow, endpointRows } = loadTs('src/renderer/src/modern/integrations/integrationsData.ts');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'src', 'modern');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

// ─── navigate(id, opts) ──────────────────────────────────────────────────────

test('a nav target carries the section and the row to land on', () => {
  navigate('settings', { section: 'Connections', anchor: 'set-slack-on' });
  assert.equal(activeNavId(), 'settings');
  assert.equal(navTarget().section, 'Connections');
  assert.equal(navTarget().anchor, 'set-slack-on');
});

test('a second link to the page already on screen still fires', () => {
  // The whole failure mode of the old store: `if (id === activeId) return`, so
  // clicking Telegram after Slack did nothing at all. `seq` is what the
  // consumer keys its effect on, so it must move even when the id does not.
  navigate('settings', { section: 'Connections', anchor: 'set-slack-on' });
  const first = navTarget().seq;
  navigate('settings', { section: 'Connections', anchor: 'set-telegram-on' });
  assert.ok(navTarget().seq > first, 'seq must advance on a repeat navigation');
  assert.equal(navTarget().anchor, 'set-telegram-on');
});

test('a plain navigate clears a previous target instead of inheriting it', () => {
  navigate('settings', { section: 'Voice', anchor: 'set-openaikey' });
  navigate('agents');
  assert.equal(navTarget().section, undefined);
  assert.equal(navTarget().anchor, undefined);
});

test('isSection rejects a section name Settings does not have', () => {
  assert.equal(isSection('Connections'), true);
  assert.equal(isSection('Integrations'), false, 'the tooltip named this for a year; it never existed');
});

// ─── every deep link in Integrations resolves ───────────────────────────────

/** The `link: {...}` literals the Integrations rows carry, read out of the
 *  source so a renamed anchor fails here rather than at a user's click. */
function integrationLinks() {
  const src = read('integrations/IntegrationsView.tsx');
  return [...src.matchAll(/link: \{([^}]*)\}/g)].map((m) => {
    const body = m[1];
    const field = (name) => (body.match(new RegExp(`${name}: '([^']*)'`)) || [])[1];
    return { navId: field('navId'), section: field('section'), anchor: field('anchor'), label: field('label') };
  });
}

/** The card names TriggersView will accept from a deep link. */
function triggerSections() {
  const src = read('triggers/TriggersView.tsx');
  const m = src.match(/TRIGGER_SECTIONS = \[([^\]]*)\]/);
  assert.ok(m, 'TRIGGER_SECTIONS not found — did TriggersView move?');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('every Integrations row deep-links somewhere that exists', () => {
  const links = integrationLinks();
  assert.equal(links.length, 4, 'one link per integration row — Slack, Telegram, Webhooks, Custom REST');
  const ids = new Set(SETTINGS.map((e) => e.id));
  const cards = triggerSections();
  for (const link of links) {
    if (link.navId === 'settings') {
      assert.ok(SECTIONS.includes(link.section), `${link.section} is not a Settings section`);
      assert.ok(ids.has(link.anchor), `${link.anchor} is not a row in the Settings index`);
      const entry = SETTINGS.find((e) => e.id === link.anchor);
      assert.equal(entry.section, link.section, `${link.anchor} lives in ${entry.section}, not ${link.section}`);
    } else if (link.navId === 'triggers') {
      assert.ok(cards.includes(link.section), `${link.section} is not a Triggers card`);
    } else {
      assert.fail(`unknown deep-link destination ${link.navId}`);
    }
  }
});

test('the webhook row leaves Settings alone — its editor is under Triggers', () => {
  const hook = integrationLinks().find((l) => l.navId === 'triggers');
  assert.ok(hook, 'the webhooks row must point at Triggers; Settings has no webhook editor');
  assert.equal(hook.section, 'Webhooks');
  assert.equal(hook.label, 'Triggers', 'the button must not say "Settings" when it goes to Triggers');
});

test('the two editors the deep links land on are actually rendered', () => {
  assert.match(read('settings/ConnectionsSection.tsx'), /<RestRegistry \/>/);
  assert.match(read('settings/VoiceSection.tsx'), /<OpenAiKeyRow /);
  // Write-only, like every other secret in this panel.
  assert.match(read('settings/VoiceSection.tsx'), /providerKeySet\(\{ backend: 'openai'/);
});

test('SettingsView acts on the target rather than always opening General', () => {
  const src = read('settings/SettingsView.tsx');
  assert.match(src, /useNavTarget/);
  assert.match(src, /goTo\(target\.section, target\.anchor\)/);
});

// ─── Slack: what main actually refuses to start on ──────────────────────────

const SLACK_OK = {
  slackEnabled: true,
  slackTransport: 'events',
  slackSigningSecret: 'shh',
  slackAllowedUserIds: 'U1',
  slackBotToken: 'xoxb-1'
};

test('a missing bot token does not block Slack from starting', () => {
  // main's startSlackServer refuses on the transport credential and on an empty
  // allowlist — never on the bot token, which is only what replies are POSTED
  // with. Saying "cannot start" here disabled a Start button that works.
  const row = slackRow({ ...SLACK_OK, slackBotToken: '' }, { running: false });
  assert.equal(row.state, 'stopped');
  assert.equal(row.blocker, undefined);
  assert.match(row.detail, /no bot token/, 'still worth saying — just not as a refusal');
});

test('the credentials main does refuse on are still blockers', () => {
  assert.equal(slackRow({ ...SLACK_OK, slackSigningSecret: '' }, { running: false }).blocker, 'no signing secret');
  assert.equal(
    slackRow({ ...SLACK_OK, slackTransport: 'socket', slackAppToken: '' }, { running: false }).blocker,
    'no app token — Socket Mode needs one'
  );
  assert.equal(
    slackRow({ ...SLACK_OK, slackAllowedUserIds: '' }, { running: false }).blocker,
    'no allowed senders — nothing would be ingested'
  );
});

// ─── webhook endpoints: names, and only the live ones ───────────────────────

const HOOKS = {
  endpoints: [
    { id: 'w1', url: 'https://tunnel.test/w1' },
    { id: 'w2', url: 'https://tunnel.test/w2' },
    { id: 'w3', url: '' }
  ]
};
const TRIGGERS = [
  { id: 'w1', name: 'deploy hook', enabled: true },
  { id: 'w2', name: 'paused hook', enabled: false },
  { id: 'w3', name: 'new hook', enabled: true }
];

test('an endpoint is printed by name, not by its internal id', () => {
  const rows = endpointRows(HOOKS, TRIGGERS);
  assert.deepEqual(rows.map((r) => r.name), ['deploy hook', 'new hook']);
});

test('a disabled endpoint is not offered as a live URL', () => {
  const rows = endpointRows(HOOKS, TRIGGERS);
  assert.equal(rows.some((r) => r.id === 'w2'), false, 'nothing can call a disabled webhook');
});

test('a configured endpoint with no tunnel yet keeps its row and loses its URL', () => {
  // Dropping it would read as "not configured"; printing an empty URL would read
  // as a broken one. The row stays and the caller says "waiting for tunnel".
  const row = endpointRows(HOOKS, TRIGGERS).find((r) => r.id === 'w3');
  assert.equal(row.url, '');
});

test('a webhook saved with no name falls back to its id rather than blanking', () => {
  const rows = endpointRows(HOOKS, [{ id: 'w1', name: '', enabled: true }]);
  assert.equal(rows[0].name, 'w1');
});
