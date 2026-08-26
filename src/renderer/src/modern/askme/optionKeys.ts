/**
 * Keyboard selection over a lettered option list — the pure half of
 * `OptionAnswer`, so the behaviour the human actually asked for ("let me pick
 * it like Claude does") is testable without rendering anything.
 */
import type { AskOption } from '@shared/askOptions';

/**
 * The option `delta` steps from the current one, wrapping.
 *
 * Nothing selected yet means the first arrow lands on the first option rather
 * than on the last — pressing Down on an untouched list should walk forward.
 */
export function stepOption(options: AskOption[], current: string | null, delta: number): string | null {
  if (!options.length) return null;
  const at = options.findIndex((o) => o.key === current);
  if (at < 0) return options[delta > 0 ? 0 : options.length - 1].key;
  return options[((at + delta) % options.length + options.length) % options.length].key;
}

/**
 * What a keypress means on the list: a letter selects that option, the arrows
 * step, anything else is not ours and must fall through — the textarea beside
 * the list and ⌘↵ to send both depend on that.
 */
export function optionKeyIntent(
  options: AskOption[],
  current: string | null,
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }
): { select: string } | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    const next = stepOption(options, current, 1);
    return next ? { select: next } : null;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    const next = stepOption(options, current, -1);
    return next ? { select: next } : null;
  }
  if (e.key.length !== 1) return null;
  const hit = options.find((o) => o.key === e.key.toLowerCase());
  return hit ? { select: hit.key } : null;
}
