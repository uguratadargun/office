'use strict';

/**
 * MD-142 — lettered options in an ask become CLICKABLE choices.
 *
 * The human's report: "when Claude asks me with options it lets me pick;
 * I write a/b/c in the question here too, it should be selectable — and I still
 * want to type my own answer when I don't like any of them."
 *
 * The questions below are REAL: copied verbatim out of the hive's delivered
 * `HUMAN ANSWER``HUMAN ANSWER` mail (each agent's inbox/.done), with the letter the human
 * actually replied. They are the specification — a parser that is elegant but
 * misses these is wrong.
 */

const test = require('node:test');
const assert = require('node:assert');
const loadTs = require('./load-ts.cjs');

const {
  parseAskOptions, askOptions, composeAnswer, answeredKey, chosenOption
} = loadTs('src/shared/askOptions.ts');

/* Verbatim from the hive log; the trailing comment is the letter the human sent. */
const REAL = {
  // 2026-08-21 — inline, slash-separated, prose continues after the last option.
  capacity:
    "Kapasite sorusu: munder-difflin'de tek geliştirici ajan var (Munder developer). "
    + 'Açar mısın (a) evet 2 tane / (b) hayır seri gitsin? Özellik numaralarını da aynı cevapta yazabilirsin.',
  // 2026-08-21 — (c) arrives two sentences after (b), inside a "NOT:" aside.
  merge:
    'MD-5 bitti: 4 bug düzeltmesi `fix/md4-bugs` dalında, testler 287/287, typecheck temiz. '
    + "Seçenek: (a) ben `main`'e fast-forward merge edeyim (push yok, sen push edersin) / "
    + '(b) önce sen dalı incele (`git log main..fix/md4-bugs`, 4 commit), sonra söyle. '
    + "NOT: Munder developer ve senin IDE'n aynı çalışma kopyasını paylaşıyor; "
    + "istersen Munder developer'ı da worktree'ye taşırım (c) evet taşı.",
  // 2026-08-25 — three options, ASCII, closing "Hangisi?".
  signing:
    'Release icin macOS imzalama gerekiyor; repoda hic secret yok. '
    + '(a) Apple Developer hesabim/sertifikam var — secret\'lari ben eklerim '
    + '(b) Yok — ilk release imzasiz ciksin (Gatekeeper uyarisi) '
    + '(c) Once Apple Developer hesabi acacagim, release beklesin. Hangisi?',
  // 2026-08-25 — bare `a)` markers, no parens, options on their own clause.
  spawn:
    'Kalan modern UI işleri için ajan lazım: MD-98, MD-100, MD-101, MD-102. '
    + 'a) Eski ajanları Office arayüzünden geri aç b) Ben spawn-requests ile 2 yeni worker açayım '
    + '(~$40–80) c) Şimdilik bekle',
  // 2026-08-26 — em-dash labels, the shape the god writes most often now.
  flip:
    'Modern UI hazır: iki bağımsız paketli QA da S1 yok dedi. Varsayılan arayüzü ne zaman modern yapalım? '
    + '(a) Hemen — S2 düzeltmeleri arkasından gelir. (b) MD-120/121 main\'e girince (tahmini bugün). '
    + '(c) Pixel varsayılan kalsın, modern Ayarlar → Interface\'ten seçilsin.',
  // 2026-08-26 — the answer the human gave was free text, not a letter.
  ulak:
    'ulak-desktop MR !608 CI\'ı düştü. Hive bu MR dalına push yapsın mı? '
    + '(a) Evet — Pam düzeltmeyi aynı dala push etsin. (b) Hayır — yalnızca teşhis + yama dosyası. '
    + '(c) ulak CI uyarılarını hive hiç ele almasın.'
};

test('every real lettered question yields its letters', () => {
  const keys = (q) => parseAskOptions(q).options.map((o) => o.key).join('');
  assert.equal(keys(REAL.capacity), 'ab');
  assert.equal(keys(REAL.merge), 'abc');
  assert.equal(keys(REAL.signing), 'abc');
  assert.equal(keys(REAL.spawn), 'abc');
  assert.equal(keys(REAL.flip), 'abc');
  assert.equal(keys(REAL.ulak), 'abc');
});

test('labels carry the option text, and the stem is the question without them', () => {
  const { stem, options } = parseAskOptions(REAL.flip);
  assert.match(stem, /Varsayılan arayüzü ne zaman modern yapalım\?$/);
  assert.equal(options[0].label, 'Hemen — S2 düzeltmeleri arkasından gelir.');
  assert.equal(options[1].label, "MD-120/121 main'e girince (tahmini bugün).");
  assert.match(options[2].label, /^Pixel varsayılan kalsın/);
});

test('an option run survives prose between the options', () => {
  // The real trap: (c) sits after a "NOT:" aside, well past (b). Ending the run
  // at the first gap would have lost the option the god actually offered.
  const { options } = parseAskOptions(REAL.merge);
  assert.match(options[1].label, /önce sen dalı incele/);
  assert.match(options[2].label, /evet taşı/);
});

test('a `/`-separated inline run keeps the separator out of the label', () => {
  const { options } = parseAskOptions(REAL.capacity);
  assert.equal(options[0].label, 'evet 2 tane');
  assert.match(options[1].label, /^hayır seri gitsin\?/);
});

test('MD-120/121 and ordinary parentheses are not options', () => {
  assert.deepEqual(parseAskOptions('Rebase MD-120/121 onto main (see the note) first?').options, []);
  assert.deepEqual(parseAskOptions('Ship it (it is small) or wait?').options, []);
});

test('a question with no options parses to itself and an empty list', () => {
  const q = 'gh auth login çalıştırır mısın? Sonra Issues sekmesinde dene.';
  assert.deepEqual(parseAskOptions(q), { stem: q, options: [] });
});

test('a run must start at (a) and be consecutive', () => {
  // A lone "(b)" mid-sentence is prose, not a choice.
  assert.deepEqual(parseAskOptions('As agreed in (b) above, ship it.').options, []);
  // c) without a) and b) is not a run either.
  assert.deepEqual(parseAskOptions('See item c) in the plan and d) after it.').options, []);
});

test('bare a/b/c gives selectable letters when there is nothing to label', () => {
  const { options } = parseAskOptions('Hangisi olsun: a/b/c?');
  assert.deepEqual(options, [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }]);
});

test('a structured options field wins over the prose', () => {
  const entry = {
    q: 'Pick one. (a) parsed one (b) parsed two',
    options: [{ key: 'A', label: 'Explicit one' }, { key: 'b', label: 'Explicit two' }]
  };
  const { stem, options } = askOptions(entry);
  assert.equal(stem, entry.q);
  assert.deepEqual(options, [{ key: 'a', label: 'Explicit one' }, { key: 'b', label: 'Explicit two' }]);
});

test('a malformed or single-entry options field falls back to the prose', () => {
  assert.equal(askOptions({ q: REAL.signing, options: [{ key: 'a', label: 'only one' }] }).options.length, 3);
  assert.equal(askOptions({ q: REAL.signing, options: 'nope' }).options.length, 3);
});

test('the payload for a chosen option is exactly the letter the agents expect', () => {
  // This is the contract with every agent that reads humanQA[n].a. The human
  // answered these six questions with a bare letter; a click must produce the
  // same string a keystroke did.
  assert.equal(composeAnswer('a', ''), 'a');
  assert.equal(composeAnswer('b', '   '), 'b');
  assert.equal(composeAnswer('A', undefined), 'a');
});

test('free text alone is sent as itself, and a note rides behind the letter', () => {
  assert.equal(composeAnswer(null, 'hangisini uygun gorursen onu yap'), 'hangisini uygun gorursen onu yap');
  assert.equal(composeAnswer('a', 'ama önce testleri çalıştır'), 'a — ama önce testleri çalıştır');
  assert.equal(composeAnswer(null, ''), '');
});

test('an answered entry shows which option it was', () => {
  assert.equal(chosenOption({ q: REAL.signing, a: 'b' }).label, 'Yok — ilk release imzasiz ciksin (Gatekeeper uyarisi)');
  // Real answers came in as 'A', and from the chat as 'a) evet' / '(a)'.
  assert.equal(answeredKey('A'), 'a');
  assert.equal(answeredKey('(a)'), 'a');
  assert.equal(answeredKey('a — ama önce testleri çalıştır'), 'a');
  assert.equal(answeredKey('a) evet 2 tane'), 'a');
  // Free text that merely starts with a letter word is not a choice.
  assert.equal(answeredKey('hayir desktop ile ilgili bir sey pushlamayacagiz'), null);
  assert.equal(answeredKey('calistirdim'), null);
  assert.equal(chosenOption({ q: REAL.ulak, a: 'hayir desktop ile ilgili bir sey pushlamayacagiz' }), null);
});

/* ── the pickable list: keyboard, and the wiring that reaches it ─────────── */

const { stepOption, optionKeyIntent } = loadTs('src/renderer/src/modern/askme/optionKeys.ts');

const OPTS = parseAskOptions(REAL.signing).options; // a, b, c

test('letters select the option they name', () => {
  assert.deepEqual(optionKeyIntent(OPTS, null, { key: 'b' }), { select: 'b' });
  assert.deepEqual(optionKeyIntent(OPTS, 'a', { key: 'C' }), { select: 'c' });
  // A letter that is not on the list is the human typing, not choosing.
  assert.equal(optionKeyIntent(OPTS, null, { key: 'z' }), null);
});

test('arrows step and wrap, and an untouched list starts at the first option', () => {
  assert.equal(stepOption(OPTS, null, 1), 'a');
  assert.equal(stepOption(OPTS, 'a', 1), 'b');
  assert.equal(stepOption(OPTS, 'c', 1), 'a');
  assert.equal(stepOption(OPTS, 'a', -1), 'c');
  assert.equal(stepOption([], null, 1), null);
  assert.deepEqual(optionKeyIntent(OPTS, 'b', { key: 'ArrowDown' }), { select: 'c' });
  assert.deepEqual(optionKeyIntent(OPTS, 'b', { key: 'ArrowLeft' }), { select: 'a' });
});

test('⌘↵ and other shortcuts fall through the list untouched', () => {
  // The send shortcut lives on the textarea beside the options; swallowing a
  // modified key here would make the whole box unsendable from the keyboard.
  assert.equal(optionKeyIntent(OPTS, 'a', { key: 'Enter', metaKey: true }), null);
  assert.equal(optionKeyIntent(OPTS, 'a', { key: 'b', metaKey: true }), null);
  assert.equal(optionKeyIntent(OPTS, 'a', { key: 'Tab' }), null);
  assert.equal(optionKeyIntent(OPTS, 'a', { key: 'Enter' }), null);
});

test('both answer boxes go through the shared parse and payload', () => {
  // Source-shape: the only way to pin "no second implementation of the letter
  // rules" for a .tsx. Two surfaces, one vocabulary — the same reason MD-83
  // collapsed four copies of "is the human being asked something".
  const fs = require('node:fs');
  const modern = fs.readFileSync('src/renderer/src/modern/tasks/AnswerBox.tsx', 'utf8');
  assert.match(modern, /from '@shared\/askOptions'/);
  assert.match(modern, /composeAnswer\(picked, draft\)/);
  const pixel = fs.readFileSync('src/renderer/src/components/AskMeTab.tsx', 'utf8');
  assert.match(pixel, /askOptions\(open\)/);
});

test('the renderer keeps an explicit option list across the 5s re-parse', () => {
  // answering writes the WHOLE humanQA array back, so a field the parser drops
  // is a field the answer ERASES from tasks.json (the tgMessageId trap).
  const { parseTasks } = loadTs('src/renderer/src/store/taskLedger.ts');
  const [card] = parseTasks({ tasks: [{
    id: 'MD-1', title: 'x', status: 'blocked',
    humanQA: [{ q: 'Pick', options: [{ key: 'a', label: 'One' }, { key: 'b', label: 'Two' }, { bad: 1 }] }]
  }] });
  assert.deepEqual(card.humanQA[0].options, [{ key: 'a', label: 'One' }, { key: 'b', label: 'Two' }]);
  const [plain] = parseTasks({ tasks: [{ id: 'MD-2', title: 'y', status: 'todo', humanQA: [{ q: 'no options' }] }] });
  assert.equal(plain.humanQA[0].options, undefined);
});
