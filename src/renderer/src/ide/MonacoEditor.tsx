import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { setupMonaco, useMonacoTheme, languageForPath } from './monaco';

// Pin @monaco-editor/react to the bundled monaco + register themes at module load,
// before any <Editor/> mounts (avoids a CDN fetch / unthemed first paint).
setupMonaco();

export interface MonacoEditorProps {
  /** File path — drives syntax language only. */
  path: string;
  value: string;
  onChange: (value: string) => void;
  /** Invoked on Cmd/Ctrl+S while the editor has focus. */
  onSave?: () => void;
  readOnly?: boolean;
  /** 1-based line to scroll to and put the cursor on — how a search result
   *  opens its file AT the match. Re-applied whenever it changes, so clicking a
   *  second hit in a file already open still jumps. */
  revealLine?: number;
}

export function MonacoEditor({ path, value, onChange, onSave, readOnly, revealLine }: MonacoEditorProps) {
  const theme = useMonacoTheme();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  // Keep the latest onSave in a ref so the editor command (bound once at mount)
  // always calls the current handler without rebinding.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });
    reveal(editor, revealLineRef.current);
  };

  // Read through a ref so mount can apply a line that was already requested
  // before the editor existed (opening a file from a search result mounts the
  // editor and asks for the line in the same render).
  const revealLineRef = useRef(revealLine);
  revealLineRef.current = revealLine;
  // Depends on `path` too, so switching files re-applies the requested line.
  // No remount is needed for that: <Editor/>'s own effect swaps the model first
  // (child effects run before this parent's), so the reveal lands on the new
  // file — and the editor instance keeps each file's undo history and scroll.
  useEffect(() => { reveal(editorRef.current, revealLine); }, [revealLine, path]);

  return (
    <Editor
      theme={theme}
      language={languageForPath(path)}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      loading={<div style={{ padding: 12, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-ui)' }}>loading editor…</div>}
      options={{
        readOnly,
        fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
        fontSize: 12,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderWhitespace: 'selection',
        tabSize: 2,
        wordWrap: 'off',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        padding: { top: 8, bottom: 8 }
      }}
    />
  );
}

/** Put the cursor on `line` and scroll it into view. No-op before the editor
 *  mounts or when nothing asked for a line. */
function reveal(editor: Parameters<OnMount>[0] | null | undefined, line: number | undefined): void {
  if (!editor || !line || line < 1) return;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: 1 });
  editor.focus();
}
