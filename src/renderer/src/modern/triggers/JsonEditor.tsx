import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { json } from '@codemirror/lang-json';

/**
 * A small JSON editor for a webhook's schema — the one control in this area that
 * cannot be a shadcn primitive (the migration inventory marks it NOT migratable).
 *
 * Cut down for a form field: no line numbers, no fold gutter, no search bar. The
 * colours come from the MODERN tokens (`--foreground`, `--muted-foreground`,
 * `--border`) rather than the pixel `--cth-*` set, so it follows this UI's theme
 * — which is why it is a copy of the pixel editor rather than an import of it.
 */

const editorTheme = EditorView.theme({
  '&': {
    background: 'transparent',
    color: 'var(--foreground)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { padding: '8px 10px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)', borderLeftWidth: '2px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '18px' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { background: 'transparent' },
  '.cm-selectionBackground, ::selection': { background: 'var(--accent) !important' }
});

const editorSyntax = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--foreground)' },
  { tag: tags.string, color: 'var(--muted-foreground)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--destructive)' },
  { tag: tags.punctuation, color: 'var(--muted-foreground)' }
]);

const extensions = [json(), EditorView.lineWrapping, editorTheme, syntaxHighlighting(editorSyntax)];

export function JsonEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="overflow-hidden rounded-md border bg-muted/30">
      <CodeMirror
        value={value}
        onChange={onChange}
        height="180px"
        extensions={extensions}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          searchKeymap: false,
          highlightSelectionMatches: false
        }}
      />
    </div>
  );
}
