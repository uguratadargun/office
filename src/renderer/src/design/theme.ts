/**
 * App-wide theme (v0.3.4) — ONE light/dark switch for the whole UI, not just
 * the terminal.
 *
 * The entire renderer is styled through the `--cth-*` tokens, so dark mode is
 * a token swap: this module stamps `data-cth-theme` on <html> and tokens.css
 * carries the dark overrides. The xterm palette (PtyTerminalView) and the
 * per-agent Claude session theme (config.terminalTheme, applied on spawn)
 * follow the same state, so terminals and TUIs match the chrome.
 *
 * Shared subscribable module (same pattern as terminalFontSize): components
 * read it with `useAppTheme()`; the ONE toggle lives in the title bar.
 */
import { useSyncExternalStore } from 'react';

export type AppTheme = 'light' | 'dark';
/** What the user CHOSE. 'system' resolves per the OS and re-resolves when the OS
 *  flips; every consumer still reads a resolved 'light' | 'dark' through
 *  `appTheme()` / `useAppTheme()`, so nothing downstream has to know about it. */
export type ThemePreference = AppTheme | 'system';

const LS_KEY = 'cth.theme';
/** Pre-0.3.4 the terminal had its own theme key — honor it once as the seed. */
const LEGACY_LS_KEY = 'cth.ptyTheme';

function systemTheme(): AppTheme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'light'; }
}

function loadPreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(LS_KEY) ?? window.localStorage.getItem(LEGACY_LS_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch { /* noop */ }
  return 'light';
}

let preference: ThemePreference = loadPreference();
let theme: AppTheme = preference === 'system' ? systemTheme() : preference;
const subscribers = new Set<() => void>();

function apply(): void {
  try { document.documentElement.dataset.cthTheme = theme; } catch { /* SSR/tests */ }
}
apply();

export function appTheme(): AppTheme {
  return theme;
}

export function setAppTheme(next: AppTheme): void {
  setThemePreference(next);
}

/** The user's choice, including 'system' — what a Settings control binds to. */
export function themePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  try { window.localStorage.setItem(LS_KEY, next); } catch { /* noop */ }
  const resolved = next === 'system' ? systemTheme() : next;
  if (resolved === theme) return;
  theme = resolved;
  apply();
  subscribers.forEach((fn) => fn());
}

// Follow the OS while — and only while — the preference is 'system'. Registered
// once at module scope: the listener is cheap and unregistering it on every
// preference change would need bookkeeping that buys nothing.
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preference !== 'system') return;
    theme = systemTheme();
    apply();
    subscribers.forEach((fn) => fn());
  });
} catch { /* matchMedia unavailable (tests) */ }

/** Flip to the opposite of what is CURRENTLY SHOWING. From 'system' that means
 *  the user leaves system-following behind, which is what pressing a light/dark
 *  toggle means — a three-way cycle would make the button unpredictable. */
export function toggleAppTheme(): AppTheme {
  const next: AppTheme = theme === 'dark' ? 'light' : 'dark';
  setAppTheme(next);
  return next;
}

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(
    (onChange) => {
      subscribers.add(onChange);
      return () => subscribers.delete(onChange);
    },
    () => theme
  );
}
