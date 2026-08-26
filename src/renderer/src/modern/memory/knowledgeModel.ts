/**
 * What the Knowledge section SAYS, kept out of the component that says it.
 *
 * `kg:list` / `kg:search` / `kg:get` / `kg:remove` have been implemented and
 * unit-tested in main since the knowledge graph shipped, and modern only ever
 * called `kgStatus()` + `kgAddFiles()` (`settings/MemorySection.tsx`): from this
 * UI you could add a document and then never see, search or delete it —
 * including one added by mistake. That is the exact defect the pixel
 * `KnowledgeTab` was written to fix, reintroduced by the port (MD-147 card B).
 *
 * The pure half lives here for the reason `memoryModel.ts` does: the section is
 * an IPC surface with a debounce and an armed delete, and none of that has to
 * be stood up to check that removing a document also drops its search hits, or
 * that an empty corpus and an empty SEARCH do not say the same sentence.
 *
 * No new IPC — every channel below already exists in preload.
 */
import { relSince } from '@shared/relTime';
import { formatBytes } from '@shared/reflectSummary';

/** The preload shapes, re-declared loosely so the model stays testable without
 *  the renderer (the codebase's local-declare rule). */
export interface KgDoc {
  id: string;
  title: string;
  source: string;
  modality: string;
  mime?: string | null;
  origExt?: string;
  bytes: number;
  tags: string[];
  caption?: string | null;
  chunkCount: number;
  addedAt: string;
  extractor?: string;
  truncated?: boolean;
}

export interface KgHit {
  docId: string;
  title: string;
  source: string;
  modality: string;
  chunkIdx: number;
  score: number;
  snippet: string;
}

export interface KgStatus {
  enabled: boolean;
  root: string;
  docCount: number;
  chunkCount: number;
  byModality: Record<string, number>;
}

/** The index is read per keystroke otherwise. Matches the pixel tab. */
export const SEARCH_DEBOUNCE_MS = 200;
/** Chunk hits, not documents — one document can fill the page on its own. */
export const SEARCH_LIMIT = 50;

/** A search box with nothing typed in it is not a search: an empty query LISTS
 *  the corpus, it does not run `kgSearch('')` against every chunk. */
export function isSearching(query: string): boolean {
  return query.trim().length > 0;
}

/** A document can be hit more than once, so the doc id alone is not a key. */
export function hitKey(hit: KgHit): string {
  return `${hit.docId}:${hit.chunkIdx}`;
}

/**
 * The one line under a document's title.
 *
 * Age first because "when did this get in" is what you ask of a corpus an agent
 * has been adding to unattended; bytes because that is what the extractor
 * truncates against.
 */
export function docLine(doc: KgDoc, now?: number): string {
  const parts = [
    relSince(doc.addedAt, now),
    formatBytes(doc.bytes),
    `${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'}`
  ];
  if (doc.tags?.length) parts.push(doc.tags.join(', '));
  return parts.join(' · ');
}

/**
 * The corpus in one line.
 *
 * `enabled: false` is a SETTING, not a failure — the documents are still there,
 * agents just cannot read them — so it is said separately from the counts
 * rather than replacing them.
 */
export function corpusLine(status: KgStatus | null, error?: string | null): {
  text: string;
  modalities: string[];
  warning?: string;
} {
  if (error) return { text: 'Corpus unreadable', modalities: [], warning: error };
  if (!status) return { text: 'Reading the corpus…', modalities: [] };
  const docs = `${status.docCount} document${status.docCount === 1 ? '' : 's'}`;
  const chunks = `${status.chunkCount} chunk${status.chunkCount === 1 ? '' : 's'}`;
  return {
    text: `${docs} · ${chunks}`,
    modalities: Object.entries(status.byModality ?? {}).map(([m, n]) => `${m} ${n}`),
    warning: status.enabled ? undefined : 'Graph off — agents cannot read it.'
  };
}

/**
 * Which of the empties this is.
 *
 * "Nothing ingested yet" under an active search is a lie about the corpus, and
 * "nothing matches" over an empty corpus sends the reader hunting for a better
 * query when there is nothing to find.
 */
export function emptyCopy(query: string, docCount: number): string {
  if (isSearching(query)) {
    return docCount === 0
      ? 'Nothing is in the graph yet, so nothing can match.'
      : 'Nothing in the graph matches that.';
  }
  return 'Nothing ingested yet. “Add documents” picks files off disk; agents can also add them with the kg CLI.';
}

/**
 * What removing a document costs, said out loud.
 *
 * `kg:remove` deletes the extracted text and the chunks off disk — the original
 * file it was ingested FROM is untouched, and saying so is the difference
 * between a prompt someone reads and one they click through.
 */
export function removeCopy(doc: KgDoc): { label: string; confirm: string; consequence: string } {
  return {
    label: 'Remove',
    confirm: `Remove ${doc.title}`,
    consequence:
      `${doc.title} and its ${doc.chunkCount} chunk${doc.chunkCount === 1 ? '' : 's'} leave the graph, ` +
      `so no agent can find it again. The original file at ${doc.source} is left alone. There is no undo.`
  };
}

/**
 * Drop a removed document from what is on screen, before the refetch lands.
 *
 * The list is re-read after a remove, but the search hits are NOT (a query may
 * not even be running), so a stale hit for a document that no longer exists
 * would stay clickable and open nothing.
 */
export function pruneRemoved<T extends { docs: KgDoc[] | null; hits: KgHit[] | null }>(
  state: T,
  id: string
): { docs: KgDoc[] | null; hits: KgHit[] | null } {
  return {
    docs: state.docs ? state.docs.filter((d) => d.id !== id) : null,
    hits: state.hits ? state.hits.filter((h) => h.docId !== id) : null
  };
}

/** What `kgAddFiles()` did, in a sentence. A cancelled picker is not an error
 *  and must not leave a red line behind. */
export function addedCopy(res: {
  ok: boolean;
  results?: Array<{ ok: boolean }>;
  error?: string;
}): string {
  if (!res.ok) return res.error === 'cancelled' ? '' : (res.error ?? 'Could not add those files.');
  const results = res.results ?? [];
  const added = results.filter((r) => r.ok).length;
  const failed = results.length - added;
  return `Added ${added} document${added === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`;
}
