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
 */
let activeId: string = DEFAULT_NAV_ID;
const subscribers = new Set<() => void>();

export function navigate(id: string): void {
  if (id === activeId) return;
  activeId = id;
  subscribers.forEach((fn) => fn());
}

export function activeNavId(): string {
  return activeId;
}

export function useActiveNavId(): string {
  return useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    () => activeId
  );
}
