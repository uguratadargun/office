/**
 * Toolbar version + update control — top-left, right next to the logo.
 *
 * Always shows the running version. When main's updater reports anything
 * interesting it grows a chip that IS the button: "v0.3.7 ready to install"
 * (click → download), "downloading 42%", "restart to update to v0.3.7"
 * (click → quitAndInstall). With nothing pending, clicking the version itself
 * runs a manual check — the old build only ever checked 30s after boot and then
 * every 6h, so there was no way to ask.
 *
 * All of the "what does this state say and do" logic lives in
 * src/shared/updateState.ts so it can be unit-tested without Electron; this file
 * is wiring and pixels.
 */
import { useCallback, useEffect, useState } from 'react';
import { describeUpdate, reduceStatus, type UpdateStatus } from '@shared/updateState';

declare const __APP_VERSION__: string;

export function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Subscribe first, then pull — main may have emitted before this window
    // finished loading (or before a reload), and `update:current` re-serves it.
    const off = window.cth.onUpdateStatus?.((next) => setStatus((prev) => reduceStatus(prev, next)));
    void window.cth.updateCurrent?.().then((cur) => {
      if (cur) setStatus((prev) => reduceStatus(prev, cur));
    }).catch(() => { /* older main without the handler — the push channel still works */ });
    return off;
  }, []);

  const view = describeUpdate(status, __APP_VERSION__);

  const onClick = useCallback(async () => {
    if (view.action === 'none' || busy) return;
    setBusy(true);
    try {
      if (view.action === 'restart') await window.cth.updateRestartAndInstall();
      else if (view.action === 'download') await window.cth.updateDownload();
      else if (view.action === 'check') await window.cth.updateCheckNow();
      else if (view.action === 'open-release') {
        await window.cth.updateOpenRelease(status?.state === 'available-manual' ? status.url : undefined);
      }
    } catch { /* the emitted status carries the failure — nothing to do here */ }
    setBusy(false);
  }, [view.action, busy, status]);

  const interactive = view.action !== 'none' && !view.busy;
  // The chip only earns colour when it wants something: ready = mint (act on
  // me), warn = amber (something went wrong), busy/idle stay in the titlebar's
  // own greys so a quiet app looks exactly like it did before.
  const chipBg =
    view.tone === 'ready' ? 'var(--cth-mint-light)'
      : view.tone === 'warn' ? 'var(--cth-warn-light)'
        : 'transparent';

  return (
    <button
      className="cth-titlebar-nodrag"
      onClick={() => { void onClick(); }}
      disabled={!interactive}
      title={view.title}
      aria-label={view.label ? `${view.title}` : `Version ${__APP_VERSION__} — check for updates`}
      aria-busy={view.busy || busy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: view.label ? '2px 8px' : '2px 4px',
        margin: 0,
        background: chipBg,
        border: 'none',
        borderRadius: 2,
        boxShadow: view.label ? 'inset 0 0 0 1px var(--cth-ink-300)' : 'none',
        fontFamily: 'var(--cth-font-ui)',
        fontSize: 13,
        lineHeight: '18px',
        color: view.tone === 'idle' ? 'var(--cth-ink-500)' : 'var(--cth-ink-900)',
        cursor: interactive ? 'pointer' : 'default'
      }}
    >
      <span>v{__APP_VERSION__}</span>
      {view.label && (
        <>
          <span aria-hidden style={{ color: 'var(--cth-ink-500)' }}>·</span>
          <span style={{ fontWeight: 600 }}>{view.label}</span>
        </>
      )}
    </button>
  );
}
