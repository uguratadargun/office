'use strict';

/**
 * MD-149 — the modern composer gains attachments (S1 from the parity inventory).
 *
 * The classic composer could attach a file, take a drop and paste a screenshot;
 * the modern one could not, so a screenshot had to be described in words. What
 * these tests protect is the thing that makes that safe to add in a second
 * place: files never travel as bytes, they travel as PATHS composed into the
 * message body. That means the queue item needs no new field and the drain
 * needs no new branch — and it means the composition rule must live in ONE
 * module, or the two UIs start handing agents different instructions for the
 * same drop.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const loadTs = require('./load-ts.cjs');

const {
  addAttachments, removeAttachment, composeWithAttachments, pasteKind
} = loadTs('src/shared/attachments.ts');

const a = (path, name) => ({ path, name: name ?? path.split('/').pop() });

/* ── staging: what ends up on the draft ─────────────────────────────────── */

test('the same file staged twice is attached once', () => {
  // All three doors can name one file — pick it, drop it, paste it — and
  // attaching it twice tells the agent to read it twice.
  const one = addAttachments([], [a('/tmp/shot.png')]);
  assert.equal(one.length, 1);
  assert.equal(addAttachments(one, [a('/tmp/shot.png')]).length, 1);
  // …including a duplicate inside a single batch, which the `seen` set has not
  // learned about yet when the batch is filtered.
  assert.equal(addAttachments([], [a('/tmp/x.png'), a('/tmp/x.png')]).length, 1);
});

test('a path-less entry is dropped, never staged as an empty path', () => {
  // pathForFile returns '' for anything the OS gave us no real file for (a
  // browser drag, a text/html drop). An empty path in the body is an
  // instruction to read nothing.
  const out = addAttachments([], [{ path: '', name: 'dragged.png' }, a('/tmp/real.png')]);
  assert.deepEqual(out.map((x) => x.path), ['/tmp/real.png']);
});

test('nothing fresh returns the SAME array, so a duplicate drop does not re-render', () => {
  const cur = addAttachments([], [a('/tmp/a.png')]);
  assert.equal(addAttachments(cur, [a('/tmp/a.png')]), cur);
  assert.equal(addAttachments(cur, []), cur);
  // Same rule on the way out: removing what is not there changes nothing.
  assert.equal(removeAttachment(cur, '/tmp/nope.png'), cur);
  assert.equal(removeAttachment(cur, '/tmp/a.png').length, 0);
});

/* ── composition: the paths ARE the message ─────────────────────────────── */

test('the queued item carries the paths, under the convention agents read', () => {
  const body = composeWithAttachments('look at this', [a('/tmp/shot.png'), a('/w/notes.md')]);
  assert.equal(body,
    'look at this\n\nAttached files:\n- /tmp/shot.png (shot.png)\n- /w/notes.md (notes.md)');
  // The absolute path is what the agent Reads — a name alone is not findable.
  assert.ok(body.includes('/tmp/shot.png'), 'the path, not just the name');
});

test('an attachment with no text is a complete message', () => {
  // Dragging a screenshot in and pressing send is a whole thought; refusing it
  // would make the drop feel broken.
  assert.equal(composeWithAttachments('', [a('/tmp/shot.png')]),
    'Attached files:\n- /tmp/shot.png (shot.png)');
  assert.equal(composeWithAttachments('   ', [a('/tmp/shot.png')]),
    'Attached files:\n- /tmp/shot.png (shot.png)');
});

test('a plain message never grows a trailing block', () => {
  assert.equal(composeWithAttachments('just words', []), 'just words');
  // Whitespace the user typed is theirs to keep — this is not a trim helper.
  assert.equal(composeWithAttachments('  spaced  ', []), '  spaced  ');
});

/* ── paste: which door a paste opens ────────────────────────────────────── */

test('a pasted screenshot goes to the clipboard-image door, not the textarea', () => {
  // A screenshot is a clipboard IMAGE with no path; it only becomes attachable
  // once main writes it to a temp PNG.
  assert.equal(pasteKind([{ kind: 'file', type: 'image/png' }], 0), 'image');
  // Even when the browser also exposes it as a File — the image branch wins,
  // because pathForFile has nothing real to resolve for it.
  assert.equal(pasteKind([{ kind: 'file', type: 'image/png' }], 1), 'image');
});

test('files copied in Finder paste as files, and ordinary text is left alone', () => {
  assert.equal(pasteKind([{ kind: 'file', type: 'application/pdf' }], 1), 'files');
  // The one that matters most: intercepting a text paste is how a composer
  // eats what someone just copied.
  assert.equal(pasteKind([{ kind: 'string', type: 'text/plain' }], 0), 'text');
  assert.equal(pasteKind([], 0), 'text');
  // An image MIME on a string item is not a file — a copied <img> tag's HTML.
  assert.equal(pasteKind([{ kind: 'string', type: 'image/png' }], 0), 'text');
});

/* ── shape: one rule, both composers ────────────────────────────────────── */

const read = (rel) => fs.readFileSync(require('node:path').resolve(__dirname, '..', rel), 'utf8');
const MODERN = read('src/renderer/src/modern/agents/TerminalQueue.tsx');
const PIXEL = read('src/renderer/src/components/MessageQueueComposer.tsx');

test('both composers compose through @shared/attachments, neither spells it out', () => {
  for (const [name, src] of [['modern', MODERN], ['pixel', PIXEL]]) {
    assert.match(src, /from '@shared\/attachments'/, `${name}: imports the shared model`);
    assert.match(src, /composeWithAttachments\(text, attachments\)/, `${name}: one composition rule`);
    assert.match(src, /pasteKind\(items, files\.length\)/, `${name}: one paste decision`);
    // The literal heading anywhere but @shared/attachments is a second rule
    // that will drift from the first.
    assert.doesNotMatch(src, /Attached files:/, `${name}: the body format is not restated here`);
  }
});

test('the modern composer opens all three doors, and sends on attachments alone', () => {
  assert.match(MODERN, /window\.cth\.attachFiles\(\)/, 'the picker');
  assert.match(MODERN, /window\.cth\.pathForFile\(f\)/, 'the drop');
  assert.match(MODERN, /window\.cth\.saveClipboardImage\(\)/, 'the paste');
  assert.match(MODERN, /onDrop=\{onDrop\}/);
  assert.match(MODERN, /onPaste=\{onPaste\}/);
  // Send used to gate on typed text; a staged screenshot must enable it.
  assert.match(MODERN, /const canSend = !!text\.trim\(\) \|\| attachments\.length > 0;/);
  assert.match(MODERN, /disabled=\{!canSend\}/);
  assert.doesNotMatch(MODERN, /disabled=\{!text\.trim\(\)\}/, 'the old text-only gate is gone');
});

test('attachments are cleared on send, so the next message does not re-send them', () => {
  // The draft persists per agent in the store; attachments must not silently
  // ride along on the message after.
  assert.match(MODERN, /setAttachments\(\[\]\);/);
  assert.match(PIXEL, /setAttachments\(\[\]\);/);
});
