import { useEffect, useMemo, useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { yaml } from '@codemirror/lang-yaml';
import { Icon } from './Icon';
import { PixelButton } from './PixelButton';

// ─── Theme — rides the tokens, so light/dark comes for free ────────────────
// CodeMirror takes plain CSS here, so `var(--cth-*)` resolves against whatever
// `data-cth-theme` is on <html> at paint time. The previous version hardcoded a
// light cream palette in both the chrome AND the syntax colours, so the editor
// stayed cream — with 1.5:1 syntax on it — whenever the app was in dark mode.
// `{ dark: false }` below only tells CodeMirror which of its own defaults to
// fall back on for anything this theme does not name; every colour that matters
// is named.
const cthEditorTheme = EditorView.theme({
  '&': {
    background: 'var(--cth-paper-100)',
    color: 'var(--cth-ink-900)',
    height: '100%',
    fontFamily: 'var(--cth-font-mono)',
    fontSize: 'var(--cth-text-mono-md)'
  },
  '.cm-content': { caretColor: 'var(--cth-accent)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cth-accent)', borderLeftWidth: '2px' },
  '.cm-scroller': { fontFamily: 'inherit', overflow: 'auto' },
  '.cm-gutters': {
    background: 'var(--cth-cream-200)',
    color: 'var(--cth-ink-500)',
    borderRight: '1px solid var(--cth-ink-100)'
  },
  '.cm-activeLineGutter': { background: 'var(--cth-cream-300)', color: 'var(--cth-ink-900)' },
  '.cm-activeLine': { background: 'var(--cth-cream-100)' },
  '.cm-selectionBackground, ::selection': { background: 'var(--cth-accent-light) !important' },
  '.cm-searchMatch': { background: 'var(--cth-lemon-light)', outline: '1px solid var(--cth-ink-300)' },
  '.cm-searchMatch.cm-searchMatch-selected': { background: 'var(--cth-lemon)', color: 'var(--cth-on-accent)' }
}, { dark: false });

const cthSyntax = HighlightStyle.define([
  { tag: tags.keyword,        color: 'var(--cth-code-keyword)' },
  { tag: tags.operator,       color: 'var(--cth-code-operator)' },
  { tag: [tags.string, tags.regexp], color: 'var(--cth-code-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--cth-code-number)' },
  { tag: tags.comment,        color: 'var(--cth-code-comment)', fontStyle: 'italic' },
  { tag: tags.variableName,   color: 'var(--cth-code-variable)' },
  { tag: tags.function(tags.variableName), color: 'var(--cth-code-function)' },
  { tag: [tags.typeName, tags.className], color: 'var(--cth-code-type)' },
  { tag: tags.propertyName,   color: 'var(--cth-code-property)' },
  { tag: tags.heading,        color: 'var(--cth-code-variable)', fontWeight: 'bold' as any },
  { tag: tags.link,           color: 'var(--cth-code-type)', textDecoration: 'underline' as any },
  { tag: tags.meta,           color: 'var(--cth-code-meta)' }
]);

function extensionsFor(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx'].includes(ext)) return [javascript({ jsx: true, typescript: true })];
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return [javascript({ jsx: ext.endsWith('x') })];
  if (ext === 'json') return [json()];
  if (['md', 'markdown'].includes(ext)) return [markdown()];
  if (ext === 'py') return [python()];
  if (['html', 'htm'].includes(ext)) return [html()];
  if (ext === 'css') return [css()];
  if (['yml', 'yaml'].includes(ext)) return [yaml()];
  return [];
}

export interface CodeEditorProps {
  root: string;
  /** Relative file path within `root` */
  filePath: string | null;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onCopyPath?: () => void;
}

export function CodeEditor({
  root, filePath, fullscreen, onToggleFullscreen, onCopyPath
}: CodeEditorProps) {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [absPath, setAbsPath] = useState<string | undefined>();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Load file on path change
  useEffect(() => {
    let cancelled = false;
    if (!filePath) {
      setContent(''); setOriginalContent(''); setError(undefined);
      setAbsPath(undefined);
      return;
    }
    setLoading(true);
    setError(undefined);
    window.cth.readFile(root, filePath).then(res => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) {
        setContent(res.content);
        setOriginalContent(res.content);
        setAbsPath(res.path);
      } else {
        setContent('');
        setOriginalContent('');
        setAbsPath(undefined);
        setError(res.error);
      }
    });
    return () => { cancelled = true; };
  }, [root, filePath]);

  const dirty = content !== originalContent;

  const save = useCallback(async () => {
    if (!filePath || !dirty) return;
    setSaveState('saving');
    const res = await window.cth.writeFile(root, filePath, content);
    if (res.ok) {
      setOriginalContent(content);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1200);
    } else {
      setSaveState('error');
      setError(res.error);
      setTimeout(() => setSaveState('idle'), 4000);
    }
  }, [filePath, dirty, content, root]);

  // Cmd-S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const extensions = useMemo(
    () => [cthEditorTheme, syntaxHighlighting(cthSyntax), ...(filePath ? extensionsFor(filePath) : [])],
    [filePath]
  );

  if (!filePath) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        background: 'var(--cth-paper-200)',
        textAlign: 'center'
      }}>
        <div style={{ opacity: 0.5 }}>
          <Icon name="code" size={2} />
        </div>
        <div style={{
          fontFamily: 'var(--cth-font-display)', fontSize: 8, lineHeight: '14px',
          textTransform: 'uppercase', letterSpacing: 1,
          color: 'var(--cth-ink-700)'
        }}>
          No file open
        </div>
        <div style={{
          fontFamily: 'var(--cth-font-ui)', fontSize: 13,
          color: 'var(--cth-ink-500)'
        }}>
          Pick a file from the tree to view it here.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--cth-paper-100)'
    }}>
      {/* Mini header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px',
        background: 'var(--cth-cream-200)',
        borderBottom: '1px solid var(--cth-ink-700)',
        fontFamily: 'var(--cth-font-ui)', fontSize: 12,
        color: 'var(--cth-ink-700)'
      }}>
        <Icon name="code" />
        <span style={{
          flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }} title={absPath}>{filePath}{dirty && ' •'}</span>
        {onCopyPath && (
          <button
            onClick={onCopyPath}
            title="Copy absolute path"
            style={editorBtn}
          >copy path</button>
        )}
        <button
          onClick={save}
          disabled={!dirty || saveState === 'saving'}
          title="Save (Cmd-S)"
          style={{ ...editorBtn, opacity: dirty ? 1 : 0.5 }}
        >
          {saveState === 'saving' ? '...' : saveState === 'saved' ? 'saved' : saveState === 'error' ? 'err' : 'save'}
        </button>
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            style={editorBtn}
          >
            <Icon name={fullscreen ? 'minimize' : 'expand'} />
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 12, color: 'var(--cth-ink-500)' }}>loading…</div>
        ) : error ? (
          <div style={{ padding: 12, color: 'var(--cth-coral)' }}>{error}</div>
        ) : (
          <CodeMirror
            value={content}
            onChange={(v) => setContent(v)}
            extensions={extensions}
            height="100%"
            theme="light"
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              foldGutter: true,
              autocompletion: false
            }}
          />
        )}
      </div>

      {/* Footer actions when fullscreen */}
      {fullscreen && (
        <div style={{
          padding: 8, borderTop: '1px solid var(--cth-ink-700)',
          background: 'var(--cth-cream-200)',
          display: 'flex', justifyContent: 'flex-end', gap: 8
        }}>
          <PixelButton variant="secondary" size="sm" onClick={onToggleFullscreen}>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <Icon name="minimize" /> exit fullscreen
            </span>
          </PixelButton>
        </div>
      )}
    </div>
  );
}

const editorBtn: React.CSSProperties = {
  padding: '0 6px', height: 22,
  fontFamily: 'var(--cth-font-ui)', fontSize: 12,
  color: 'var(--cth-ink-900)',
  background: 'var(--cth-cream-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 4
};
