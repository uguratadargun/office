import { useSyncExternalStore } from 'react';
import { DEFAULT_NAV_ID } from './nav';

/**
 * WHICH SECTION IS ON SCREEN, as a module store rather than AppShell state.
 *
 * Cross-area links are the whole reason: an Integrations row wants to send the
 * user to Settings, a Monitor alert wants to open the Agents view. Those callers
 * are arbitrarily deep inside a lazy view that AppShell knows nothing about, so
 * the alternatives were threading a prop through every layer or a context whose
 * provider is one more thing every area has to be inside. A module store is
 * neither: `navigate('settings')` works from a component, an event handler, or a
 * plain function with no React around it at all.
 *
 * AppShell reads it with `useActiveNavId()` and is otherwise unchanged.
 *
 * A nav id ALONE was not enough (MD-94 S1). Every Integrations row deep-linked
 * with `navigate('settings')` and every one of them landed on Settings › General,
 * because that is where SettingsView starts — so the Slack row, the Telegram row
 * and the webhook row all sent you to the same wrong page. A target therefore
 * carries an optional `section` (which pane/card the view should open) and an
 * optional `anchor` (the DOM id inside it to scroll to), and the view that owns
 * those names is the one that interprets them: `navigation.ts` stays ignorant of
 * what a section is called anywhere.
 */

export interface NavTarget {
  id: string;
  /** Sub-section of the view to open. Meaning is the destination view's. */
  section?: string;
  /** DOM id inside that section to scroll to and flash. */
  anchor?: string;
  /**
   * Bumped on EVERY navigate(), including a repeat of the id already on screen.
   * A consumer keys its effect on this, which is what makes clicking two
   * different rows of the SAME page both land — an effect keyed on the section
   * alone would not re-run for the second click after you scrolled away.
   */
  seq: number;
}

export interface NavOptions {
  section?: string;
  anchor?: string;
}

let target: NavTarget = { id: DEFAULT_NAV_ID, seq: 0 };
const subscribers = new Set<() => void>();

export function navigate(id: string, opts: NavOptions = {}): void {
  target = { id, section: opts.section, anchor: opts.anchor, seq: target.seq + 1 };
  subscribers.forEach((fn) => fn());
}

export function activeNavId(): string {
  return target.id;
}

export function navTarget(): NavTarget {
  return target;
}

function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => subscribers.delete(onChange);
}

export function useActiveNavId(): string {
  return useSyncExternalStore(subscribe, () => target.id);
}

/**
 * The whole current target. The snapshot is the stored object itself — replaced
 * only inside `navigate()` — so `useSyncExternalStore` sees a stable identity
 * between navigations and does not re-render forever.
 */
export function useNavTarget(): NavTarget {
  return useSyncExternalStore(subscribe, () => target);
}
