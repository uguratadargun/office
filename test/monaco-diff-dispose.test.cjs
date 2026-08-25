// MonacoDiff teardown — the fix behind MD-110.
//
// `@monaco-editor/react`'s <DiffEditor/> cleanup disposes the two TextModels
// FIRST and the DiffEditorWidget LAST. Monaco 0.52 registers `onWillDispose` on
// every model a DiffEditorWidget holds and reports a BugIndicatingError
// ("TextModel got disposed before DiffEditorWidget model got reset") through
// onUnexpectedError — uncaught, once per model, every time a diff tab is
// closed, switched away from, or the IDE is left. Measured live in the built
// modern IDE: 4 uncaught errors for open → open → switch → leave.
//
// The diff's lifecycle is therefore owned here, by `createDiffSession`, whose
// dispose order is the one Monaco requires: detach (setModel(null)) → dispose
// the widget → dispose the models. The fake below enforces Monaco's invariant
// the same way Monaco does, so a regression in the order fails loudly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { createDiffSession } = loadTs('src/renderer/src/ide/diffSession.ts');

/** A monaco stand-in with exactly the invariant the real one has. */
function fakeMonaco() {
  const log = [];
  const errors = [];
  let n = 0;
  const model = (value, language) => {
    const m = {
      id: ++n,
      value,
      language,
      disposed: false,
      attachedTo: null,
      getValue: () => m.value,
      setValue: (v) => { log.push(`model${m.id}.setValue`); m.value = v; },
      dispose: () => {
        if (m.disposed) errors.push(`model${m.id} disposed twice`);
        if (m.attachedTo && !m.attachedTo.disposed) errors.push(`model${m.id}: TextModel got disposed before DiffEditorWidget model got reset`);
        m.disposed = true;
        log.push(`model${m.id}.dispose`);
      }
    };
    log.push(`createModel(${language})`);
    return m;
  };
  const editor = {
    createModel: (value, language) => model(value, language),
    setModelLanguage: (m, language) => { log.push(`setModelLanguage(model${m.id},${language})`); m.language = language; },
    createDiffEditor: (el, options) => {
      log.push('createDiffEditor');
      const e = {
        el,
        options,
        disposed: false,
        model: null,
        setModel: (pair) => {
          if (e.disposed) errors.push('setModel on a disposed editor');
          for (const m of e.model ? [e.model.original, e.model.modified] : []) m.attachedTo = null;
          e.model = pair;
          for (const m of pair ? [pair.original, pair.modified] : []) m.attachedTo = e;
          log.push(pair ? 'setModel(pair)' : 'setModel(null)');
        },
        getModel: () => e.model,
        updateOptions: (o) => { log.push('updateOptions'); Object.assign(e.options, o); },
        dispose: () => {
          if (e.disposed) errors.push('editor disposed twice');
          // Monaco's widget dispose releases its listeners; models it still
          // holds are left attached to nothing, which is fine.
          for (const m of e.model ? [e.model.original, e.model.modified] : []) m.attachedTo = null;
          e.disposed = true;
          log.push('editor.dispose');
        }
      };
      return e;
    }
  };
  return { editor, log, errors };
}

const open = (m) => createDiffSession(m, {}, { original: 'a', modified: 'b', language: 'typescript', options: { readOnly: true } });

test('a session builds two models and hands them to one diff editor', () => {
  const m = fakeMonaco();
  const s = open(m);
  assert.deepEqual(m.log, ['createModel(typescript)', 'createModel(typescript)', 'createDiffEditor', 'setModel(pair)']);
  assert.equal(s.editor.getModel().original.getValue(), 'a');
  assert.equal(s.editor.getModel().modified.getValue(), 'b');
  assert.deepEqual(m.errors, []);
});

test('dispose detaches the models before disposing anything, then disposes each once', () => {
  const m = fakeMonaco();
  const s = open(m);
  m.log.length = 0;
  s.dispose();
  assert.deepEqual(m.errors, [], 'Monaco would have reported these through onUnexpectedError');
  assert.deepEqual(m.log, ['setModel(null)', 'editor.dispose', 'model1.dispose', 'model2.dispose']);
});

test('dispose is idempotent — a second call (stale cleanup after a remount) touches nothing', () => {
  const m = fakeMonaco();
  const s = open(m);
  s.dispose();
  m.log.length = 0;
  s.dispose();
  assert.deepEqual(m.log, []);
  assert.deepEqual(m.errors, []);
});

test('update rewrites the models in place — a rerender never churns models', () => {
  const m = fakeMonaco();
  const s = open(m);
  m.log.length = 0;
  s.update({ original: 'a2', modified: 'b2', language: 'typescript' });
  assert.deepEqual(m.log, ['model1.setValue', 'model2.setValue']);
  assert.equal(s.editor.getModel().original.getValue(), 'a2');
  // Unchanged content is not rewritten (it would reset scroll/selection).
  m.log.length = 0;
  s.update({ original: 'a2', modified: 'b2', language: 'typescript' });
  assert.deepEqual(m.log, []);
});

test('update switches the language on both models when the path changes kind', () => {
  const m = fakeMonaco();
  const s = open(m);
  m.log.length = 0;
  s.update({ original: 'a', modified: 'b', language: 'markdown' });
  assert.deepEqual(m.log, ['setModelLanguage(model1,markdown)', 'setModelLanguage(model2,markdown)']);
});

test('update after dispose is a no-op (an effect that fires on a torn-down pane)', () => {
  const m = fakeMonaco();
  const s = open(m);
  s.dispose();
  m.log.length = 0;
  s.update({ original: 'x', modified: 'y', language: 'json' });
  assert.deepEqual(m.log, []);
  assert.deepEqual(m.errors, []);
});

test('MonacoDiff owns its diff through createDiffSession, not the library DiffEditor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/renderer/src/ide/MonacoDiff.tsx'), 'utf8');
  assert.doesNotMatch(src, /from ['"]@monaco-editor\/react['"]/, 'the library DiffEditor disposes models before the widget');
  assert.match(src, /createDiffSession\(/);
});
