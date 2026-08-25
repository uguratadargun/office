import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { uiModeOf, DEFAULT_UI_MODE } from '@shared/uiMode';
import brandLogo from '@brand/logo.png?url';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/png';
favicon.href = brandLogo;
document.head.appendChild(favicon);

const splashMark = document.querySelector('#cth-splash .mk');
if (splashMark) {
  const img = document.createElement('img');
  img.src = brandLogo;
  img.alt = 'Office';
  img.style.cssText = 'height:56px;width:auto;display:block';
  splashMark.replaceWith(img);
}

const root = document.getElementById('root');
if (!root) throw new Error('No root element');

/**
 * ONE OF TWO FRONT-ENDS, CHOSEN AT BOOT.
 *
 * The import is dynamic and the branch is here rather than inside a component
 * because it is not really a component choice — it is which STYLESHEET the
 * document gets. The pixel UI is ~100 inline-styled screens on `--cth-*` tokens;
 * the modern one is Tailwind with preflight. Loading both would have preflight
 * reset the pixel UI's lists, headings and svgs, and the pixel token file paint
 * the modern one. Each entry module imports its own CSS (see `pixelEntry.ts`
 * and `modern/App.tsx`), so only the running UI's styles ever exist.
 *
 * Config can fail to load (first boot, a corrupt file) — fall back to the pixel
 * UI, which is the one that is always complete, rather than showing nothing.
 */
async function boot(): Promise<void> {
  let mode = DEFAULT_UI_MODE;
  try {
    mode = uiModeOf(await window.cth.getConfig());
  } catch { /* fall through to the pixel UI */ }

  const { App } = mode === 'modern'
    ? await import('./modern/App')
    : await import('./pixelEntry');

  createRoot(root!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void boot();
