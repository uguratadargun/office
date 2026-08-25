'use strict';

/**
 * MD-83 — every question to the human lands on ASK ME, and from there on their
 * phone.
 *
 * The report was "some questions do not land on ASK ME — they land inside a
 * Tasks card and I am expected to answer them there." The cause was not one bug
 * but FOUR different answers to the same question, "is the human being asked
 * something?":
 *
 *   taskLedger.waitsOnHuman   blocked-only            → ASK ME tab + its badge
 *   taskLedger.openQuestion   status-free             → the Tasks card's answer box
 *   OfficeFloor (inline)      blocked-only, ignored
 *                             dismissedAt             → the note count on the wall
 *   humanQa.isOpen            status-free             → the Telegram mirror
 *
 * …plus two writers that never touched a card at all, so nothing downstream
 * could see them: mail addressed to `"to": "human"` (routed to the god's inbox
 * and stopping there) and the Slack/Telegram autonomy protocol's async-question
 * clause (posted to the thread and nowhere else).
 *
 * These tests pin the single answer and the single write path.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const {
  waitsOnHuman, openAsk, openAsks, unsentQuestions, withNewAsk,
  askAlreadyRecorded, askTargetCard, askCardTitle, formatAskFromMessage, ASK_STATUS
} = loadTs('src/shared/humanQa.ts');
const ledger = loadTs('src/renderer/src/store/taskLedger.ts');
const { HiveManager } = loadTs('src/main/hive.ts');

const card = (id, humanQA, extra = {}) => ({ id, title: `card ${id}`, humanQA, ...extra });

// ─── one predicate, whatever the card's status ───────────────────────────────

test('an open ask counts WHATEVER the card status is', () => {
  // The leak the human hit: the god appends the ask and leaves the card in
  // `doing` (or moves it to `done` with the ask still open). The Tasks card
  // showed an answer box; ASK ME showed nothing.
  for (const status of ['todo', 'doing', 'blocked', 'done']) {
    assert.equal(
      waitsOnHuman(card('a', [{ q: 'which region?' }], { status })), true,
      `an open ask on a "${status}" card must still reach ASK ME`
    );
  }
});

test('answered and dismissed asks are closed, on every status', () => {
  assert.equal(waitsOnHuman(card('a', [{ q: 'q', a: 'yes' }], { status: 'blocked' })), false);
  assert.equal(waitsOnHuman(card('a', [{ q: 'q', dismissedAt: 'x' }], { status: 'doing' })), false);
  assert.equal(waitsOnHuman(card('a', [], { status: 'blocked' })), false);
  assert.equal(waitsOnHuman(card('a', undefined, { status: 'blocked' })), false);
  assert.equal(waitsOnHuman(undefined), false);
});

test('the newest unresolved entry is the live one; the ones above it are history', () => {
  const open = openAsk([{ q: 'first', a: 'done' }, { q: 'second' }, { q: 'third', dismissedAt: 'x' }]);
  assert.equal(open.q, 'second');
});

test('the renderer reads the SAME predicate as the mirror — no second definition', () => {
  // taskLedger used to hand-roll both of these. If they ever drift again, an
  // ask visible in the chat is invisible on the board (or the reverse).
  const t = ledger.parseTasks({ tasks: [{ id: 'a', title: 'T', status: 'doing', humanQA: [{ q: 'which?' }] }] })[0];
  assert.equal(ledger.waitsOnHuman(t), true, 'ASK ME must list it');
  assert.equal(ledger.openQuestion(t).q, 'which?');
  assert.equal(unsentQuestions([t]).length, 1, 'and the Telegram mirror must send it');
});

test('the ASK ME badge counts exactly what the ASK ME tab lists', () => {
  const asked = [{ q: 'which one?' }];
  const tasks = ledger.parseTasks({ tasks: [
    { id: 'a', title: 'blocked, asked', status: 'blocked', humanQA: asked },
    { id: 'b', title: 'DOING, asked', status: 'doing', humanQA: asked },
    { id: 'c', title: 'done, still asking', status: 'done', humanQA: asked },
    { id: 'd', title: 'blocked, archived', status: 'blocked', archived: true, humanQA: asked },
    { id: 'e', title: 'blocked, nothing asked', status: 'blocked' },
    { id: 'f', title: 'dismissed', status: 'blocked', humanQA: [{ q: 'q', dismissedAt: 'x' }] }
  ] });
  const listed = tasks.filter(ledger.waitsOnHuman).map((t) => t.id);
  assert.deepEqual(listed, ['a', 'b', 'c', 'd'], 'doing and done cards belong on ASK ME too');
  const counts = ledger.badgeCounts(tasks);
  assert.equal(counts.askMe, listed.length, 'the badge must not promise a card the tab hides');
  // TASKS is the live board, so it drops the archived one — and only that.
  assert.equal(counts.tasks, 3);
});

test('the floor board reads the shared predicate instead of a third copy', () => {
  // OfficeFloor is .tsx (the test loader cannot transpile it), so this is a
  // source-shape assertion — the accepted fallback for renderer JSX here.
  const src = fs.readFileSync('src/renderer/src/scene/office/OfficeFloor.tsx', 'utf8');
  assert.match(src, /import \{ waitsOnHuman[^}]*\} from '@shared\/humanQa'/,
    'the wall count must come from the one predicate');
  assert.match(src, /arr\.filter\(waitsOnHuman\)/);
  assert.doesNotMatch(src, /humanQA!\.some\(/,
    'the hand-rolled blocked-only / dismissedAt-blind copy must be gone');
});

// ─── raising an ask ──────────────────────────────────────────────────────────

test('a new ask is appended, never overwriting the decision trail', () => {
  const before = [{ q: 'old', a: 'answered' }];
  const after = withNewAsk(before, '  which region?  ', 'T0', 'msg-1');
  assert.equal(after.length, 2);
  assert.deepEqual(after[0], before[0], 'history is untouched');
  assert.deepEqual(after[1], { q: 'which region?', askedAt: 'T0', fromMessageId: 'msg-1' });
});

test('the same message never stacks a second ask', () => {
  const tasks = [card('a', withNewAsk(undefined, 'q', 'T0', 'msg-1'))];
  assert.equal(askAlreadyRecorded(tasks, 'msg-1'), true);
  assert.equal(askAlreadyRecorded(tasks, 'msg-2'), false);
  assert.equal(askAlreadyRecorded(tasks, undefined), false);
});

test('a mailed ask hangs on the sender\'s live card, preferring the one they are on', () => {
  const tasks = [
    card('x', undefined, { assignee: 'jim', status: 'todo' }),
    card('y', undefined, { assignee: 'jim', status: 'doing' }),
    card('z', undefined, { assignee: 'pam', status: 'doing' })
  ];
  assert.equal(askTargetCard(tasks, 'jim'), 'y');
  assert.equal(askTargetCard(tasks, 'pam'), 'z');
  // done and archived cards are not somewhere to hang a live question
  assert.equal(askTargetCard([card('d', undefined, { assignee: 'jim', status: 'done' })], 'jim'), null);
  assert.equal(askTargetCard([card('d', undefined, { assignee: 'jim', status: 'doing', archived: true })], 'jim'), null);
  assert.equal(askTargetCard(tasks, 'nobody'), null);
  assert.equal(askTargetCard(tasks, undefined), null);
});

test('the ask text carries who is asking and the detail behind it', () => {
  assert.equal(
    formatAskFromMessage({ from: 'jim', subject: 'Ship to prod?', body: 'Tests are green.' }),
    '[jim] Ship to prod?\n\nTests are green.'
  );
  // Subject-only and body-only both still produce a readable line.
  assert.equal(formatAskFromMessage({ from: 'jim', subject: 'Ship it?' }), '[jim] Ship it?');
  assert.equal(formatAskFromMessage({ from: 'jim', body: 'line one\nline two' }), '[jim] line one');
  assert.match(askCardTitle({ from: 'jim', subject: 'Ship to prod?' }), /^jim: Ship to prod\?$/);
});

// ─── the router: "to": "human" reaches the board ─────────────────────────────

function floor(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-askme-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  hive.ensureHive();
  // A two-agent floor, laid down directly: ensureAgent() spawns a whole Claude
  // workspace, and all the router needs is a registry and an inbox to drop into.
  const root = path.join(home, 'hive');
  for (const id of ['god', 'jim']) fs.mkdirSync(path.join(root, 'agents', id, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({
    godId: 'god',
    agents: {
      god: { id: 'god', name: 'God', provider: 'claude', isGod: true },
      jim: { id: 'jim', name: 'Jim', provider: 'claude' }
    }
  }), 'utf8');
  return hive;
}

const openOn = (hive) => openAsks(hive.tasks().tasks);

test('a message addressed to the human lands on ASK ME', (t) => {
  const hive = floor(t);
  hive.send({ to: 'human', from: 'jim', act: 'query', subject: 'Which AWS region?', body: 'eu-central-1 or us-east-1?' }, 'jim');

  const asks = openOn(hive);
  assert.equal(asks.length, 1, 'before MD-83 this went to the god\'s inbox and nowhere else');
  assert.match(asks[0].q, /Which AWS region\?/);
  // …and therefore the chat mirror will send it, unprompted.
  assert.equal(unsentQuestions(hive.tasks().tasks).length, 1);
  // The god is still told — the board is an ADDITION to the mail, not a detour.
  assert.ok(hive.inbox('god').some((m) => m.subject === 'Which AWS region?'));
});

test('the ask attaches to the sender\'s live card rather than opening a new one', (t) => {
  const hive = floor(t);
  hive.addTask({ id: 'MD-1', title: 'the work', assignee: 'jim', status: 'doing', dependsOn: [], priority: 3, createdAt: 'T0' });
  hive.send({ to: 'human', from: 'jim', act: 'query', subject: 'Which region?' }, 'jim');

  const tasks = hive.tasks().tasks;
  assert.equal(tasks.length, 1, 'no card spam — the question belongs next to the work');
  assert.equal(tasks[0].id, 'MD-1');
  assert.equal(tasks[0].status, ASK_STATUS, 'the kanban says the work is stalled');
  assert.equal(openAsks(tasks).length, 1);
});

test('a redelivered ask does not stack a duplicate', (t) => {
  const hive = floor(t);
  const msg = hive.send({ to: 'human', from: 'jim', act: 'query', subject: 'Which region?' }, 'jim');
  assert.equal(openOn(hive).length, 1);
  hive.send({ ...msg }, 'jim'); // same id — mail is redelivered as a normal event
  assert.equal(openOn(hive).length, 1, 'the same message id must never raise a second ask');
});

test('answering on the board closes it for the chat too, and vice versa', (t) => {
  const hive = floor(t);
  hive.send({ to: 'human', from: 'jim', act: 'query', subject: 'Which region?' }, 'jim');
  const [ask] = openOn(hive);
  const card0 = hive.tasks().tasks.find((c) => c.id === ask.taskId);
  hive.patchTask(ask.taskId, {
    humanQA: card0.humanQA.map((e, i) => (i === ask.index ? { ...e, a: 'eu-central-1', answeredAt: 'T1' } : e))
  });
  assert.equal(openOn(hive).length, 0, 'ASK ME is clear');
  assert.equal(unsentQuestions(hive.tasks().tasks).length, 0, 'and the mirror stops offering it');
});

test('an answer from the human is not itself re-raised as a question', (t) => {
  const hive = floor(t);
  hive.send({ to: 'god', from: 'human', act: 'inform', subject: 'HUMAN ANSWER on task "x"', body: 'A: yes' }, 'human');
  assert.equal(openOn(hive).length, 0);
});

// ─── the instructions the writers actually read ──────────────────────────────

test('both protocols name the card as the only way to reach the human', () => {
  const src = fs.readFileSync('src/main/index.ts', 'utf8');
  const async6 = src.slice(src.indexOf('6. ASYNC QUESTIONS'), src.indexOf('7. THE FENCED MESSAGE'));
  assert.match(async6, /humanQA/, 'the Slack/Telegram async-question clause must route through the card');
  assert.match(async6, /ASK ME/);
  const hiveSrc = fs.readFileSync('src/main/hive.ts', 'utf8');
  assert.match(hiveSrc, /"to": "human".*ASK ME board/s, 'the agent protocol must say where a human-addressed message surfaces');
});

test('the chat mirror sweeps the backlog the moment it connects', () => {
  const src = fs.readFileSync('src/main/index.ts', 'utf8');
  const fn = src.slice(src.indexOf('function startTelegramQaObserver'), src.indexOf('function stopTelegramQaObserver'));
  assert.match(fn, /void pollTelegramQuestions\(\);\s*\n\}/,
    'asks raised while the bridge was down must be sent on connect, not one tick later');
});
