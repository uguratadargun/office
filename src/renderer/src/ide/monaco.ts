/**
 * Monaco bootstrap for the Electron renderer (electron-vite / Vite).
 *
 * Two things have to be true for Monaco to work in a bundled Electron app:
 *
 *  1. Workers must be SELF-HOSTED, not fetched from a CDN. We import each
 *     language worker through Vite's `?worker` suffix, which emits a real
 *     bundled worker chunk and a constructor. `MonacoEnvironment.getWorker`
 *     hands Monaco the right one per language. This is the electron-vite-safe
 *     equivalent of the classic `getWorkerUrl` CDN dance — it works offline and
 *     inside the packaged `app.asar` because the worker URL is resolved by Vite
 *     at build time (relative `base: './'`).
 *
 *  2. `@monaco-editor/react` must use THIS bundled `monaco` instance rather than
 *     its default behaviour of lazy-loading monaco from a CDN via AMD. We pin it
 *     with `loader.config({ monaco })`.
 *
 * Import this module once (for its side effects) before any editor mounts.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import { useLayoutEffect } from 'react';
import { appTheme, useAppTheme, type AppTheme } from '@/design/theme';
import { readToken } from '@/design/cssTokens';

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new JsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'typescript':
      case 'javascript':
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  }
};

/** Monaco takes literal colours and cannot read CSS custom properties, so the
 *  theme is BUILT from the tokens rather than copied from them. `readToken`
 *  resolves against whatever `data-cth-theme` is on <html> right now, so the
 *  theme is (re)defined per switch instead of once at module load — which is
 *  why the editor used to stay cream in dark mode. `rules` want bare hex, the
 *  `colors` map wants a leading `#`. */
/** Monaco's `rules[]` want SIX bare hex digits and throw `Illegal value for
 *  token color` on anything else — including the perfectly valid 3-digit form.
 *  A token can arrive that way without anyone writing it: a CSS minifier
 *  collapses `#ffffff` to `#fff` on its way into the bundle, so the shorthand
 *  shows up in `getComputedStyle` even when the source says otherwise. Expanding
 *  here means a theme cannot be broken by how its stylesheet was compressed. */
function hex6(value: string): string {
  const v = value.replace('#', '').trim();
  return v.length === 3 ? v.split('').map((ch) => ch + ch).join('') : v;
}

function defineTheme(m: typeof monaco, name: string, base: 'vs' | 'vs-dark'): void {
  const t = (token: string, fallback: string) => hex6(readToken(token, fallback));
  const c = (token: string, fallback: string) => '#' + t(token, fallback);

  const ink900 = t('--cth-ink-900', '#12161C');
  const ok = t('--cth-code-string', '#2F6B4A');
  const bad = t('--cth-code-number', '#A6362C');

  m.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [
      { token: '', foreground: ink900, background: t('--cth-paper-100', '#FFFFFF') },
      { token: 'comment', foreground: t('--cth-code-comment', '#68727F'), fontStyle: 'italic' },
      { token: 'keyword', foreground: t('--cth-code-keyword', '#7A4FA8') },
      { token: 'string', foreground: ok },
      { token: 'number', foreground: bad },
      { token: 'type', foreground: t('--cth-code-type', '#2C6E77') },
      { token: 'function', foreground: t('--cth-code-function', '#8A5A28') },
      { token: 'variable', foreground: ink900 },
      { token: 'delimiter', foreground: t('--cth-code-operator', '#5F6976') }
    ],
    colors: {
      'editor.background': c('--cth-paper-100', '#FFFFFF'),
      'editor.foreground': c('--cth-ink-900', '#12161C'),
      'editorLineNumber.foreground': c('--cth-ink-300', '#7D8692'),
      'editorLineNumber.activeForeground': c('--cth-ink-700', '#3A424E'),
      'editor.selectionBackground': c('--cth-accent-light', '#E2E9F2'),
      'editor.lineHighlightBackground': c('--cth-cream-100', '#F2F4F7'),
      'editorCursor.foreground': c('--cth-accent', '#3E6091'),
      'editorGutter.background': c('--cth-cream-200', '#E6E9EE'),
      'editorWidget.background': c('--cth-cream-100', '#F2F4F7'),
      'editorIndentGuide.background1': c('--cth-cream-300', '#D5DAE2'),
      // Diff tints: the same two hues at 20%/13% alpha, so an inserted line
      // reads as a wash and the changed span inside it reads as a highlight.
      'diffEditor.insertedTextBackground': '#' + ok + '33',
      'diffEditor.removedTextBackground': '#' + bad + '33',
      'diffEditor.insertedLineBackground': '#' + ok + '22',
      'diffEditor.removedLineBackground': '#' + bad + '22'
    }
  });
}

let configured = false;

const themeName = (t: AppTheme): string => (t === 'dark' ? 'cth-dark' : 'cth-light');

/** Pin @monaco-editor/react to the bundled monaco. Idempotent. */
export function setupMonaco(): typeof monaco {
  if (!configured) {
    configured = true;
    loader.config({ monaco });
  }
  // Define the ACTIVE theme here, not just in the hook below: consumers call
  // setupMonaco() at module scope, and Monaco applies the `theme` prop on its
  // own async init — possibly before any effect of ours has run.
  const t = appTheme();
  defineTheme(monaco, themeName(t), t === 'dark' ? 'vs-dark' : 'vs');
  return monaco;
}

/** The Monaco theme name for the app's current theme.
 *
 *  Monaco caches a theme by NAME, and the token values behind it only exist for
 *  whichever palette is live — so the definition is refreshed on every switch
 *  rather than registered once at import. That is the whole reason the IDE used
 *  to stay cream while the rest of the app went dark: there was one theme,
 *  `cth-light`, baked from light-mode hexes. */
export function useMonacoTheme(): string {
  const theme = useAppTheme();
  const name = themeName(theme);
  useLayoutEffect(() => {
    defineTheme(monaco, name, theme === 'dark' ? 'vs-dark' : 'vs');
    monaco.editor.setTheme(name);
  }, [name, theme]);
  return name;
}

/** Map a filename to a Monaco language id (used to set the model language). */
export function languageForPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  switch (ext) {
    case 'ts': return 'typescript';
    case 'tsx': return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs': return 'javascript';
    case 'json': return 'json';
    case 'md':
    case 'markdown': return 'markdown';
    case 'py': return 'python';
    case 'rb': return 'ruby';
    case 'go': return 'go';
    case 'rs': return 'rust';
    case 'java': return 'java';
    case 'c':
    case 'h': return 'c';
    case 'cpp':
    case 'cc':
    case 'hpp': return 'cpp';
    case 'cs': return 'csharp';
    case 'php': return 'php';
    case 'sh':
    case 'bash':
    case 'zsh': return 'shell';
    case 'html':
    case 'htm': return 'html';
    case 'css': return 'css';
    case 'scss': return 'scss';
    case 'less': return 'less';
    case 'yml':
    case 'yaml': return 'yaml';
    case 'toml': return 'ini';
    case 'xml': return 'xml';
    case 'sql': return 'sql';
    case 'dockerfile': return 'dockerfile';
    default:
      if (name.toLowerCase() === 'dockerfile') return 'dockerfile';
      return 'plaintext';
  }
}
