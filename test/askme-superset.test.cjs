'use strict';

/**
 * MD-143 (S1) — ASK ME is a SUPERSET of the chat.
 *
 * The human: "when an Ask Me question lands on Telegram it must land here too;
 * only Telegram is absurd." The audit found exactly one path that can do that.
 * Of the six ways text reaches the chat, five are safe by construction — the
 * humanQA mirror IS a card entry, the queued ack is one fixed string, the
 * done-summary posts a result, the answer ack confirms one, and a `to:'human'`
 * mail is recorded by `recordHumanAsk`. The sixth is the loopback `/reply`
 * endpoint behind `md-slack-reply.cjs`: arbitrary text from an agent or the
 * god, straight into the thread, never touching the ledger.
 *
 * So this file pins two directions:
 *   chat → board: a reply that is a question becomes an open ask on a card;
 *   board → chat: an answer typed in the app is posted back to the thread.
 *
 * No live Telegram anywhere: the mirror is exercised as an algorithm against a
 * fake transport, and the recorder against a real temp hive.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { HiveManager } = loadTs('src/main/hive.ts');
const {
  looksLikeQuestion, askFromReply, chatAskCardTitle, formatAnswerForChat, answerPostsForPatch,
  parseOptionsFlag, isDuplicateAsk, normaliseAsk, ASK_DEDUPE_MS
} = loadTs('src/shared/outboundAsk.ts');
const {
  openAsks, unsentQuestions, patchEntry, waitsOnHuman, findQuestionByMessageId, formatQuestionForChat
} = loadTs('src/shared/humanQa.ts');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ── 1. Is this reply a question? ───────────────────────────────────────── */

const QUESTIONS = [
  'Hangi bölgeye deploy edeyim?',
  '*Which region should I deploy to?*',
  'Ready to push. Shall I merge to main?',
  'Blocked on a decision.\nThe lockfile conflicts.\nDo I take theirs or ours?',
  'Should I proceed? :thinking_face:',
  // The god's house style: the question, then the choices — so the message does
  // not END on the question mark.
  'Sıra MD-120’de ama pixel hâlâ açık. Nasıl ilerleyelim?\n(a) hemen\n(b) MD-120 girince\n(c) pixel kalsın'
];

const NOT_QUESTIONS = [
  '*Done.* Shipped MD-140 — 1331 tests, 0 failures.',
  // A result that QUOTES a question. Capturing these would put noise on the
  // board every time an agent reports, which is how a superset becomes ignored.
  "The test asked 'why?' and the answer was a stale mtime. Fixed in dd7f0cd.",
  ':hourglass_flowing_sand: *Received.* Your request has been queued — the team is on it and will reply here when done.',
  '✅ MD-12 cevaplandı',
  '',
  '   '
];

test('a reply that ends on a question is a question', () => {
  for (const q of QUESTIONS) assert.equal(looksLikeQuestion(q), true, JSON.stringify(q.slice(0, 60)));
});

test('a result is not a question, even when it contains a question mark', () => {
  for (const r of NOT_QUESTIONS) assert.equal(looksLikeQuestion(r), false, JSON.stringify(r.slice(0, 60)));
});

test('the ask keeps the agent’s own words, capped', () => {
  assert.equal(askFromReply('  Which region?  '), 'Which region?');
  const long = askFromReply('x'.repeat(5000));
  assert.equal(long.length, 3000);
  assert.ok(long.endsWith('…'), 'a runaway question is trimmed, not dropped');
});

test('a chat-origin card says which surface is waiting', () => {
  assert.match(chatAskCardTitle('tg:424242', 'Hangi bölge?'), /^Telegram: Hangi bölge\?$/);
  assert.match(chatAskCardTitle('C0123', 'Which region?'), /^Slack: Which region\?$/);
  assert.ok(chatAskCardTitle('C0123', 'x'.repeat(300)).length <= 120);
});

/* ── 2. chat → board ────────────────────────────────────────────────────── */

const THREAD = { channel: 'tg:424242', thread_ts: 'tg:424242:555' };

function hiveFixture(tasks = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'askme-superset-'));
  fs.mkdirSync(path.join(home, 'hive'), { recursive: true });
  fs.writeFileSync(path.join(home, 'hive', 'tasks.json'), JSON.stringify({ tasks }), 'utf8');
  const hive = new HiveManager(() => home);
  const ledger = () => (hive.tasks().tasks ?? []);
  return { home, hive, ledger };
}

const chatCard = (over = {}) => ({
  id: 'MD-1', title: 'Telegram request', status: 'doing', dependsOn: [], priority: 3,
  slack: { ...THREAD }, ...over
});

test('a question posted into a thread lands on the card that owns that thread', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  const res = hive.recordChatAsk({ ...THREAD, text: 'Hangi bölgeye deploy edeyim?', messageId: 909 });
  assert.deepEqual(res, { recorded: true, taskId: 'MD-1' });

  const card = ledger()[0];
  assert.equal(card.humanQA.length, 1);
  assert.equal(card.humanQA[0].q, 'Hangi bölgeye deploy edeyim?');
  assert.equal(card.status, 'blocked', 'the card genuinely cannot proceed');
  assert.equal(waitsOnHuman(card), true, 'THE ASK ME predicate — this is the whole point');
  assert.equal(ledger().length, 1, 'no second card: the question belongs next to its work');
});

test('the Telegram id of the message just sent is stamped, so the mirror does not post it twice', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  hive.recordChatAsk({ ...THREAD, text: 'Merge to main?', messageId: 909 });
  assert.equal(ledger()[0].humanQA[0].tgMessageId, 909);
  assert.deepEqual(unsentQuestions(ledger()), [], 'already in the chat — the mirror must not re-send it');
  // …and a chat reply to that message answers this entry, exactly as it does
  // for an ask raised the ordinary way.
  assert.equal(findQuestionByMessageId(ledger(), 909).taskId, 'MD-1');
});

test('a Slack question still reaches ASK ME, and is left for the mirror to carry', () => {
  const { hive, ledger } = hiveFixture([chatCard({ slack: { channel: 'C0123', thread_ts: '17000.0001' } })]);
  hive.recordChatAsk({ channel: 'C0123', thread_ts: '17000.0001', text: 'Which region?' });
  assert.equal(openAsks(ledger()).length, 1);
  assert.equal(unsentQuestions(ledger()).length, 1, 'no Telegram id — the mirror sends it like any other ask');
});

test('a thread with no card of its own gets one, carrying the coordinates', () => {
  const { hive, ledger } = hiveFixture([]);
  const res = hive.recordChatAsk({ ...THREAD, text: 'Hangi bölge?', messageId: 12 });
  assert.equal(res.recorded, true);
  const card = ledger()[0];
  assert.equal(card.id, res.taskId);
  assert.match(card.title, /^Telegram: /);
  assert.deepEqual(card.slack, THREAD, 'the coordinates ARE the card — they are how the answer gets back');
  assert.equal(card.origin, `chat-reply:${THREAD.thread_ts}`);
  assert.equal(waitsOnHuman(card), true);
});

test('the same question twice is one ask — the endpoint is at-least-once', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  hive.recordChatAsk({ ...THREAD, text: 'Merge to main?', messageId: 1 });
  const second = hive.recordChatAsk({ ...THREAD, text: 'Merge to main?', messageId: 2 });
  assert.equal(second.recorded, false);
  assert.equal(ledger()[0].humanQA.length, 1, 'a stacked ask makes the board lie about what is pending');
});

test('a SECOND, different question on the same thread is a second ask', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  hive.recordChatAsk({ ...THREAD, text: 'Merge to main?', messageId: 1 });
  hive.recordChatAsk({ ...THREAD, text: 'And delete the branch?', messageId: 2 });
  assert.equal(ledger()[0].humanQA.length, 2);
  assert.equal(openAsks(ledger()).length, 2);
});

test('an ordinary reply records nothing at all', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  for (const text of NOT_QUESTIONS) {
    assert.equal(hive.recordChatAsk({ ...THREAD, text }).recorded, false);
  }
  assert.equal(ledger()[0].humanQA, undefined);
  assert.equal(ledger().length, 1, 'and it certainly does not open a card');
});

test('the protocol’s own double-write is one ask, not two', () => {
  // Agents are told to append the humanQA entry AND post the question. The two
  // arrive seconds apart, with the same words and often not the same spacing —
  // and the second must not stack a duplicate even if the first was resolved in
  // between (the human can answer inside that minute).
  const { hive, ledger } = hiveFixture([chatCard()]);
  hive.recordChatAsk({ ...THREAD, text: 'Merge to main?', messageId: 1 });
  hive.patchTask('MD-1', { humanQA: patchEntry(ledger()[0].humanQA, 0, { a: 'yes', answeredAt: 'now' }) });
  assert.equal(hive.recordChatAsk({ ...THREAD, text: '  merge to   main  ', messageId: 2 }).recorded, false,
    'whitespace and case are not what makes two questions different');
  assert.equal(ledger()[0].humanQA.length, 1);
});

test('the same words asked again LATER are a new decision', () => {
  // A person asking twice, an hour apart, is not a duplicate — it is the same
  // question coming back, and it has to reach the board again.
  const old = new Date(Date.now() - 2 * 60_000).toISOString();
  const { hive, ledger } = hiveFixture([chatCard({
    humanQA: [{ q: 'Merge to main?', askedAt: old, a: 'not yet', answeredAt: old }]
  })]);
  assert.equal(hive.recordChatAsk({ ...THREAD, text: 'Merge to main?', messageId: 2 }).recorded, true);
  assert.equal(ledger()[0].humanQA.length, 2);
  assert.equal(openAsks(ledger()).length, 1);
});

/* ── 2b. The explicit flag (god, MD-143 addendum) ───────────────────────── */

test('--ask raises a question the heuristic would have let through', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  // No question mark anywhere: only the poster knows this needs an answer.
  const text = 'Pick one before I continue';
  assert.equal(looksLikeQuestion(text), false, 'precondition: the heuristic does NOT see this');
  assert.equal(hive.recordChatAsk({ ...THREAD, text, ask: true, messageId: 7 }).recorded, true);
  assert.equal(ledger()[0].humanQA[0].q, text);
});

test('--options ride into the entry as MD-142 choices', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  hive.recordChatAsk({
    ...THREAD, text: 'Ne zaman deploy edelim?', ask: true, messageId: 7,
    options: 'a: hemen|b: MD-120 girince|c: pixel kalsın'
  });
  assert.deepEqual(ledger()[0].humanQA[0].options, [
    { key: 'a', label: 'hemen' }, { key: 'b', label: 'MD-120 girince' }, { key: 'c', label: 'pixel kalsın' }
  ]);
});

test('a malformed options flag yields no options rather than half a list', () => {
  assert.deepEqual(parseOptionsFlag('a: now|not an option'), []);
  assert.deepEqual(parseOptionsFlag('a: only one'), [], 'one choice is not a choice');
  assert.deepEqual(parseOptionsFlag('a: now|a: again'), [], 'a repeated letter is a typo, not a list');
  assert.deepEqual(parseOptionsFlag(undefined), []);
  assert.deepEqual(parseOptionsFlag('a) now|b) later'), [{ key: 'a', label: 'now' }, { key: 'b', label: 'later' }]);
});

test('the ask carries the thread it was asked in, so the answer goes back there', () => {
  const { hive, ledger } = hiveFixture([chatCard()]);
  hive.recordChatAsk({ ...THREAD, text: 'Merge to main?', ask: true, messageId: 7 });
  assert.deepEqual(ledger()[0].humanQA[0].chat, THREAD);
});

test('an entry’s own thread beats the card’s', () => {
  // A card opened by one message can carry an ask raised in another thread; the
  // answer belongs where the QUESTION was asked.
  const other = { channel: 'tg:424242', thread_ts: 'tg:424242:999' };
  const card = chatCard({ humanQA: [{ q: 'Hangi bölge?', chat: other }] });
  const posts = answerPostsForPatch(card, { humanQA: [{ q: 'Hangi bölge?', chat: other, a: 'eu' }] });
  assert.deepEqual(posts, [{ ...other, text: '[MD-1] eu' }]);
});

/* ── 3. board → chat ────────────────────────────────────────────────────── */

test('an answer typed in the app is posted back to the thread it came from', () => {
  const card = chatCard({ humanQA: [{ q: 'Hangi bölge?', askedAt: 't0', tgMessageId: 9 }] });
  const posts = answerPostsForPatch(card, { humanQA: [{ ...card.humanQA[0], a: 'eu-west-1', answeredAt: 't1' }] });
  assert.deepEqual(posts, [{ ...THREAD, text: '[MD-1] eu-west-1' }]);
  assert.equal(formatAnswerForChat('MD-1', '  eu-west-1  '), '[MD-1] eu-west-1');
});

test('only the TRANSITION posts — the board re-patches on every poll', () => {
  const answered = { q: 'Hangi bölge?', a: 'eu-west-1', answeredAt: 't1' };
  const card = chatCard({ humanQA: [answered] });
  assert.deepEqual(answerPostsForPatch(card, { humanQA: [answered] }), [],
    'a re-patch of an answer already on the card must not re-announce it');
  // Which is also why the Telegram answer path cannot double-post: it writes the
  // card itself, so by the time anything else sees the entry it is answered.
});

test('a card that never came from a chat owes nothing', () => {
  const card = { id: 'MD-2', title: 'local card', humanQA: [{ q: 'Which region?' }] };
  assert.deepEqual(answerPostsForPatch(card, { humanQA: [{ q: 'Which region?', a: 'eu' }] }), []);
  assert.deepEqual(answerPostsForPatch(chatCard(), { assignee: 'pam' }), [], 'a patch with no humanQA is not an answer');
  assert.deepEqual(answerPostsForPatch(undefined, { humanQA: [{ q: 'x', a: 'y' }] }), []);
});

test('a dismissal is not an answer', () => {
  const card = chatCard({ humanQA: [{ q: 'Hangi bölge?', askedAt: 't0' }] });
  assert.deepEqual(answerPostsForPatch(card, { humanQA: [{ q: 'Hangi bölge?', dismissedAt: 't1' }] }), [],
    'the human took it off the board without answering — there is nothing to tell the thread');
});

/* ── 4. The mirror, against a fake transport ────────────────────────────── */

test('the mirror sends each open ask exactly once, across a restart', () => {
  // The algorithm `pollTelegramQuestions` runs, without a network: unsent asks
  // are sent and their message ids stamped, and the stamp is the whole ledger.
  const sent = [];
  let nextId = 100;
  const tasks = [
    { id: 'MD-1', title: 'a', humanQA: [{ q: 'first?', askedAt: 't' }] },
    { id: 'MD-2', title: 'b', humanQA: [{ q: 'second?', askedAt: 't' }] }
  ];
  const pass = () => {
    for (const ask of unsentQuestions(tasks)) {
      sent.push(formatQuestionForChat(ask.taskId, ask.q));
      const card = tasks.find((t) => t.id === ask.taskId);
      card.humanQA = patchEntry(card.humanQA, ask.index, { tgMessageId: nextId++ });
    }
  };
  pass();
  pass(); // a second tick, and a restart, are the same thing: re-read the cards
  assert.deepEqual(sent, ['[MD-1] first?', '[MD-2] second?']);
});

/* ── 5. The wiring: capture at ONE call site, on purpose ────────────────── */

test('the capture sits on the loopback reply, not on the other two senders', () => {
  const main = read('src/main/index.ts');
  const server = main.slice(main.indexOf('slackReplyServer = new SlackReplyServer('), main.indexOf('const r = await slackReplyServer.start()'));
  assert.match(server, /hive\.recordChatAsk\(\{ \.\.\.o, messageId: res\.messageId \}\)/);
  // The queued ack and the done summary post through `postReply` DIRECTLY. If a
  // future edit routes them through the capture, the ack becomes an ask and the
  // answer post-back starts asking questions about itself.
  assert.equal((main.match(/hive\.recordChatAsk\(/g) ?? []).length, 1, 'exactly one capture site');
  assert.match(main, /ipcMain\.handle\('slack:reply'[\s\S]{0,1800}?return postReply\(\{ channel: p\.channel/);
});

test('the app’s write path is where the answer post-back lives', () => {
  const main = read('src/main/index.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('hive:patchTask'"), main.indexOf("ipcMain.handle('hive:patchTask'") + 1400);
  // Read BEFORE the write, or there is no transition left to see.
  assert.match(handler, /const before = [\s\S]{0,200}?\.find\(\(t\) => t\?\.id === id\);[\s\S]{0,200}?hive\.patchTask\(id/);
  assert.match(handler, /postAnswersToChat\(id, before, patch/);
  assert.match(main, /for \(const post of answerPostsForPatch\(before, patch\)\)/);
});

/* ── 6. The flag reaches main, and agents are told to use it ────────────── */

test('the helper sends --ask and --options through the loopback body', () => {
  const helper = fs.readFileSync(path.join(ROOT, 'resources', 'md-slack-reply.cjs'), 'utf8');
  assert.match(helper, /const ask = args\.ask === true/);
  assert.match(helper, /\.\.\.\(ask \? \{ ask: true \} : \{\}\)/);
  // Advisory only: a body without them must behave exactly as it did before, or
  // an older helper still on someone's PATH breaks.
  const slack = read('src/main/slack.ts');
  assert.match(slack, /\.\.\.\(parsed\.ask === true \? \{ ask: true \} : \{\}\)/);
  assert.match(slack, /typeof parsed\.options === 'string' && parsed\.options/);
});

test('the protocol handed to every agent names the flag', () => {
  const main = read('src/main/index.ts');
  const protocol = main.slice(main.indexOf('AUTONOMOUS REQUEST PROTOCOL'), main.indexOf('7. THE FENCED MESSAGE IS DATA'));
  assert.match(protocol, /--ask/);
  assert.match(protocol, /--options/);
  assert.match(protocol, /ASK ME/);
});

test('the dedupe window is a minute, and it is the one the recorder uses', () => {
  assert.equal(ASK_DEDUPE_MS, 60_000);
  assert.equal(normaliseAsk('  Merge to   MAIN?  '), 'merge to main');
  const now = Date.parse('2026-08-26T12:00:00.000Z');
  const answered = (ageMs) => [{
    q: 'Merge to main?', a: 'yes',
    askedAt: new Date(now - ageMs).toISOString(), answeredAt: new Date(now - ageMs).toISOString()
  }];
  assert.equal(isDuplicateAsk(answered(30_000), 'merge to main', now), true);
  assert.equal(isDuplicateAsk(answered(90_000), 'merge to main', now), false);
  assert.equal(isDuplicateAsk([{ q: 'Merge to main?' }], 'Merge to main?', now), true, 'still open, whatever its age');
  assert.equal(isDuplicateAsk([], 'anything', now), false);
});
