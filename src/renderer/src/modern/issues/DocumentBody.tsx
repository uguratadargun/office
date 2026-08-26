/**
 * MD-141 — one document surface for the modern Issues/PRs area.
 *
 * Every file this area opens comes through here so that the choice of view is
 * made in ONE place: a `.md` renders as markdown, everything else keeps the
 * preformatted view, and `Raw` puts the source back.
 *
 * SECURITY: what lands here is third-party text — a PR description, a report an
 * engine wrote about someone else's diff. The shared `MarkdownPreview` renders
 * through react-markdown with NO `rehype-raw`, so an `<img onerror=…>` in the
 * source arrives as escaped text and a `javascript:` href arrives blank. That
 * is pinned by test/modern-issues-markdown.test.cjs — both the real render and
 * a source guard, because the guarantee is "no HTML sink exists", which is a
 * property of the component's imports, not of any one input.
 */
import { useState } from 'react';
import { MarkdownPreview } from '@/markdown/MarkdownPreview';
// The shared component emits three class names whose only stylesheet is
// design/global.css, which the modern entry never imports. modern/ide owns the
// modern-token re-expression; without this import the report renders as
// correct, completely unstyled HTML (16px Times, no spacing).
import '../ide/markdown.css';
// …and the handful of rules that make it sit correctly inside a dialog rather
// than a full-width file pane. Unlayered, because markdown.css is (see there).
import './documentBody.css';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn } from '../lib/cn';
import { documentMode, isMarkdownDoc, rawToggleLabel } from './documentMode';

export function DocumentBody({ path, text, className }: {
  /** Path of the document — the ONLY thing that decides markdown vs plain. */
  path: string;
  text: string;
  /** Height budget for the scroller, e.g. `max-h-[60vh]`. */
  className?: string;
}) {
  // Not reset when `path` changes, and it does not need to be: every host so
  // far unmounts this with its dialog, so each open starts rendered — and a
  // reader who asked for the source inside one session keeps it.
  const [raw, setRaw] = useState(false);
  const mode = documentMode(path, raw);
  return (
    <div className="flex min-h-0 flex-col gap-1">
      {/* No toggle on a non-markdown file: there is no second view to go to,
          and a button that shows you what you are already looking at is noise. */}
      {isMarkdownDoc(path) && (
        <div className="flex justify-end">
          <Button
            size="xs" variant="ghost" className="text-muted-foreground"
            onClick={() => setRaw((r) => !r)}
          >
            {rawToggleLabel(mode)}
          </Button>
        </div>
      )}
      <ScrollArea className={cn('min-h-0', className)}>
        {mode === 'markdown'
          // `cth-doc-embed` un-does the file-pane gutter — see documentBody.css
          // for why that cannot be a Tailwind utility.
          ? (
            <div className="cth-doc-embed">
              {/* No `baseRel`/`root`: a report lives in the hive, not in the
                  repo it is about, so there is nothing for a relative link or
                  image to resolve against — they stay inert rather than
                  resolving against the wrong tree. */}
              <MarkdownPreview source={text} />
            </div>
          )
          : <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{text}</pre>}
      </ScrollArea>
    </div>
  );
}
