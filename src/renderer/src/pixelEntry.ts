/**
 * Entry point for the PIXEL UI, and the only module that imports its
 * stylesheet. `main.tsx` dynamically imports either this or `./modern/App`, so
 * `design/global.css` (and the `--cth-*` tokens it pulls in) enters the document
 * only when the pixel UI is the one running — the mirror of what
 * `modern/App.tsx` does for Tailwind. Keeping the import here rather than in
 * `App.tsx` leaves the pixel UI itself untouched by the split.
 */
import './design/global.css';

export { App } from './App';
