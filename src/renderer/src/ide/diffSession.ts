/**
 * One side-by-side diff, owned end to end: two TextModels, one
 * DiffEditorWidget, and a teardown in the order Monaco requires.
 *
 * Why this exists (MD-110): `@monaco-editor/react`'s <DiffEditor/> disposes
 * the models FIRST and the widget LAST on unmount. Monaco 0.52's
 * DiffEditorWidget registers `onWillDispose` on every model it holds and
 * reports "TextModel got disposed before DiffEditorWidget model got reset"
 * through onUnexpectedError — uncaught, once per model, every time a diff tab
 * is closed, switched away from, or the IDE is left. There is no option on
 * the library component that fixes the order, only ones that skip disposal
 * and leak the models, so the diff's lifecycle lives here instead.
 *
 * Framework-free on purpose: the React component is a thin effect around it,
 * and the dispose order is asserted in test/monaco-diff-dispose.test.cjs
 * against a stand-in that enforces Monaco's invariant.
 */
import type * as Monaco from 'monaco-editor';

export interface DiffContents {
  original: string;
  modified: string;
  /** Monaco language id (from `languageForPath`). */
  language: string;
}

export interface DiffSessionOptions extends DiffContents {
  options?: Monaco.editor.IDiffEditorConstructionOptions;
}

export interface DiffSession {
  readonly editor: Monaco.editor.IStandaloneDiffEditor;
  /** Rewrite the two sides in place. Unchanged text is left alone (a rewrite
   *  resets scroll and selection); a changed language is applied to both
   *  models. Safe to call after `dispose()` — it does nothing. */
  update(next: DiffContents): void;
  /** detach → dispose the widget → dispose the models. Idempotent. */
  dispose(): void;
}

/** The slice of monaco a session needs; `typeof monaco` satisfies it. */
export type DiffMonaco = Pick<typeof Monaco, 'editor'>;

export function createDiffSession(
  monaco: DiffMonaco,
  container: HTMLElement,
  { original, modified, language, options }: DiffSessionOptions
): DiffSession {
  // No URI: Monaco assigns an inmemory:// one, so two tabs on the same path
  // never collide and nothing has to be looked up before it is created.
  const originalModel = monaco.editor.createModel(original, language);
  const modifiedModel = monaco.editor.createModel(modified, language);
  const editor = monaco.editor.createDiffEditor(container, { automaticLayout: true, ...options });
  editor.setModel({ original: originalModel, modified: modifiedModel });

  let disposed = false;
  let currentLanguage = language;

  return {
    editor,
    update(next) {
      if (disposed) return;
      if (next.language !== currentLanguage) {
        currentLanguage = next.language;
        monaco.editor.setModelLanguage(originalModel, next.language);
        monaco.editor.setModelLanguage(modifiedModel, next.language);
      }
      if (originalModel.getValue() !== next.original) originalModel.setValue(next.original);
      if (modifiedModel.getValue() !== next.modified) modifiedModel.setValue(next.modified);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // The widget must let go of the models before either is disposed —
      // that is the invariant it enforces with onWillDispose. Disposing the
      // widget then drops its listeners, and the models go last, silently.
      editor.setModel(null);
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    }
  };
}
