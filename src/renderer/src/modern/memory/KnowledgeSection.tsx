import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FilePlus2, RotateCw, Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { IconButton } from '../components/IconButton';
import { DestructiveButton } from '../components/DestructiveButton';
import { relSince } from '@shared/relTime';
import { formatBytes } from '@shared/reflectSummary';
import { cn } from '../lib/cn';
import {
  SEARCH_DEBOUNCE_MS, SEARCH_LIMIT, addedCopy, corpusLine, docLine, emptyCopy,
  hitKey, isSearching, pruneRemoved, removeCopy,
  type KgDoc, type KgHit, type KgStatus
} from './knowledgeModel';

/**
 * Knowledge — the documents the floor has ingested, at last visible in modern.
 *
 * Modern shipped with exactly two of the six knowledge channels wired
 * (`kgStatus` and `kgAddFiles`, in Settings › Memory & Knowledge), so from this
 * UI a document went IN and could never be listed, searched, read or removed —
 * a one-way door with a delete button on the other side of the app (MD-157).
 *
 * It lives inside Memory rather than in its own nav row because it answers the
 * same question the rest of this view does — "what does the hive know, and
 * where is it written down" — one half being what agents wrote themselves and
 * this half being what we handed them.
 *
 * One list, one search box: an empty query lists the corpus newest-first, a
 * non-empty one shows ranked chunk hits, because "which document" and "where in
 * it" are the same question asked twice. Removal deletes extracted text off
 * disk, so it goes through `DestructiveButton` — the same arm→confirm machine
 * the pixel UI uses, not a second policy.
 */
export function KnowledgeSection() {
  const [status, setStatus] = useState<KgStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [docs, setDocs] = useState<KgDoc[] | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KgHit[] | null>(null);
  const [open, setOpen] = useState<{ meta: KgDoc; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    // Settings swallows this failure and shows a permanent "0 documents"; here
    // a broken corpus has to say so, or the empty state lies about why it is
    // empty.
    try { setStatus(await window.cth.kgStatus()); setStatusError(null); }
    catch (e) { setStatusError(e instanceof Error ? e.message : String(e)); }
    try { setDocs(await window.cth.kgList()); } catch { setDocs([]); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Debounced: the index is read per keystroke otherwise.
  useEffect(() => {
    if (!isSearching(query)) { setHits(null); return; }
    const t = setTimeout(() => {
      window.cth.kgSearch(query.trim(), SEARCH_LIMIT).then(setHits).catch(() => setHits([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const openDoc = async (id: string): Promise<void> => {
    setNote('');
    try { setOpen(await window.cth.kgGet(id)); }
    catch (e) { setNote(e instanceof Error ? e.message : 'Could not open that document.'); }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      const res = await window.cth.kgRemove(id);
      if (!res.ok) { setNote('Could not remove that document.'); return; }
      // The list is refetched below, but the hits are not — a stale hit for a
      // document that no longer exists would stay clickable and open nothing.
      const pruned = pruneRemoved({ docs, hits }, id);
      setDocs(pruned.docs);
      setHits(pruned.hits);
      if (open?.meta.id === id) setOpen(null);
      setNote('Removed.');
      await refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const addFiles = async (): Promise<void> => {
    setBusy(true); setNote('');
    try {
      setNote(addedCopy(await window.cth.kgAddFiles()));
      await refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const corpus = useMemo(() => corpusLine(status, statusError), [status, statusError]);
  const searching = isSearching(query);

  if (open) {
    return <DocView doc={open} busy={busy} onBack={() => setOpen(null)} onRemove={() => void remove(open.meta.id)} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-6">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the knowledge graph…"
            aria-label="Search the knowledge graph"
            className="h-7 pl-7"
          />
        </div>
        <Separator orientation="vertical" className="h-4" />
        <Button size="sm" variant="outline" onClick={() => void addFiles()} disabled={busy}>
          <FilePlus2 /> Add documents
        </Button>
        <IconButton label="Reload the corpus" onClick={() => void refresh()} disabled={busy}>
          <RotateCw />
        </IconButton>
      </div>

      {/* The corpus in one line — counts, what is in it, and whether agents can
          actually read any of it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-1.5 text-xs text-muted-foreground">
        <span>{corpus.text}</span>
        {corpus.modalities.map((m) => (
          <Badge key={m} variant="secondary" className="font-normal">{m}</Badge>
        ))}
        {corpus.warning && <span className="text-destructive">{corpus.warning}</span>}
        {note && <span className="ml-auto" role="status">{note}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {searching ? (
          hits === null ? <Muted>Searching…</Muted>
          : hits.length === 0 ? <Muted>{emptyCopy(query, docs?.length ?? 0)}</Muted>
          : (
            <ul className="flex max-w-3xl flex-col gap-2">
              {hits.map((h) => (
                <li key={hitKey(h)} className="flex flex-col gap-1.5 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.title}</span>
                    <Badge variant="secondary" className="font-normal">{h.modality}</Badge>
                    <Badge variant="secondary" className="font-normal">chunk {h.chunkIdx}</Badge>
                    <Badge variant="outline" className="font-normal">{h.score.toFixed(2)}</Badge>
                  </div>
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">{h.snippet}</p>
                  <div>
                    <Button size="xs" variant="outline" onClick={() => void openDoc(h.docId)}>Open</Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : docs === null ? <Muted>Loading…</Muted>
        : docs.length === 0 ? <Muted>{emptyCopy(query, 0)}</Muted>
        : (
          <ul className="flex max-w-3xl flex-col gap-2">
            {docs.map((d) => {
              const copy = removeCopy(d);
              return (
                <li key={d.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.title}</span>
                    <Badge variant="secondary" className="font-normal">{d.modality}</Badge>
                    {d.truncated && <Badge variant="outline" className="font-normal">truncated</Badge>}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{d.source}</p>
                  <p className="text-xs text-muted-foreground">{docLine(d)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="xs" variant="outline" onClick={() => void openDoc(d.id)}>Open</Button>
                    <DestructiveButton
                      size="xs"
                      label={copy.label}
                      confirmLabel={copy.confirm}
                      consequence={copy.consequence}
                      disabled={busy}
                      onRun={() => void remove(d.id)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One document: its metadata, then the extracted text agents actually search. */
function DocView({ doc, busy, onBack, onRemove }: {
  doc: { meta: KgDoc; text: string };
  busy: boolean;
  onBack: () => void;
  onRemove: () => void;
}) {
  const m = doc.meta;
  const copy = removeCopy(m);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-6">
        <IconButton label="Back to the document list" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.title}</span>
        <DestructiveButton
          size="xs"
          label={copy.label}
          confirmLabel={copy.confirm}
          consequence={copy.consequence}
          disabled={busy}
          onRun={onRemove}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
        <dl className="grid max-w-3xl grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <Meta label="Source" value={m.source} mono />
          <Meta label="Added" value={`${relSince(m.addedAt)} (${m.addedAt})`} />
          <Meta label="Modality" value={`${m.modality}${m.mime ? ` · ${m.mime}` : ''} · ${m.origExt || '—'}`} />
          <Meta
            label="Size"
            value={`${formatBytes(m.bytes)} · ${m.chunkCount} chunk${m.chunkCount === 1 ? '' : 's'}${m.truncated ? ' · truncated' : ''}`}
          />
          {m.extractor && <Meta label="Extractor" value={m.extractor} />}
          {m.tags.length > 0 && <Meta label="Tags" value={m.tags.join(', ')} />}
          {m.caption && <Meta label="Caption" value={m.caption} />}
        </dl>
        <pre className="max-w-3xl rounded-md border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap">
          {doc.text || '(no extracted text — this artifact is indexed by its metadata only)'}
        </pre>
      </div>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono')}>{value}</dd>
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{children}</p>;
}
