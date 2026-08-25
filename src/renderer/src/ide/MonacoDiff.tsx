import { useEffect, useRef } from 'react';
import { setupMonaco, useMonacoTheme, languageForPath } from './monaco';
import { createDiffSession, type DiffSession } from './diffSession';

const monaco = setupMonaco();

export interface MonacoDiffProps {
  /** File path — drives syntax language only. */
  path: string;
  /** Left side (committed HEAD content). */
  original: string;
  /** Right side (current working-tree content). */
  modified: string;
}

const OPTIONS = {
  readOnly: true,
  renderSideBySide: true,
  fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
  fontSize: 12,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  ignoreTrimWhitespace: false,
  renderOverviewRuler: false
} as const;

/** Read-only side-by-side diff (working tree vs HEAD) on Monaco's built-in
 *  DiffEditorWidget — the same dependency as the editor, no extra view layer.
 *
 *  Not `@monaco-editor/react`'s <DiffEditor/>: its unmount disposes the models
 *  before the widget, which Monaco reports as an uncaught "TextModel got
 *  disposed before DiffEditorWidget model got reset" on every tab close /
 *  switch (MD-110). `createDiffSession` owns the order instead. */
export function MonacoDiff({ path, original, modified }: MonacoDiffProps) {
  // Defines + applies the app theme to every Monaco surface on each switch.
  useMonacoTheme();
  const host = useRef<HTMLDivElement>(null);
  const session = useRef<DiffSession | null>(null);

  // One session per mounted pane. Content and language changes flow through
  // `update` below; only unmount tears the widget down.
  useEffect(() => {
    if (!host.current) return undefined;
    const s = createDiffSession(monaco, host.current, {
      original, modified, language: languageForPath(path), options: OPTIONS
    });
    session.current = s;
    return () => {
      s.dispose();
      session.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; props are applied by the effect below
  }, []);

  useEffect(() => {
    session.current?.update({ original, modified, language: languageForPath(path) });
  }, [path, original, modified]);

  return <div ref={host} style={{ width: '100%', height: '100%', minHeight: 0 }} />;
}
