/**
 * KNOWLEDGE — the documents you have ingested, at last visible.
 *
 * `kg:list` / `kg:search` / `kg:get` / `kg:remove` have been implemented and
 * unit-tested in main since the Knowledge Graph shipped, but only `kg:status`
 * and `kg:addFiles` ever reached the UI: you could add a document and then
 * never see, search, or delete it — including one added by mistake. This tab
 * is the missing half.
 *
 * One list, one search box. An empty query lists the corpus newest-first; a
 * non-empty one shows ranked chunk hits, because "which document" and "where
 * in it" are the same question asked twice. Clicking either opens the document.
 * Removal is two clicks on the row itself (the SkillsTab pattern) rather than a
 * modal — it deletes files off disk, so it deserves a confirmation, not a
 * ceremony.
 */
import { useCallback, useEffect, useState } from 'react';
import { PixelButton } from './PixelButton';
import { formatBytes } from '@shared/imageTypes';
import { relSince } from '@shared/relTime';
import type { KnowledgeStatus, KnowledgeDoc, KnowledgeHit } from '../../../preload';

export function KnowledgeTab() {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [open, setOpen] = useState<{ meta: KnowledgeDoc; text: string } | null>(null);
  /** Delete is destructive, so the first click arms this and the second does it. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    // Settings swallows this failure and shows a permanent "0 documents"; here a
    // broken corpus has to say so, or the empty state lies about why it is empty.
    try { setStatus(await window.cth.kgStatus()); setStatusError(null); }
    catch (e) { setStatusError(e instanceof Error ? e.message : String(e)); }
    try { setDocs(await window.cth.kgList()); } catch { setDocs([]); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Search runs on a short debounce: the index is read per keystroke otherwise.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    const t = setTimeout(() => {
      window.cth.kgSearch(q, 50).then(setHits).catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const openDoc = async (id: string) => {
    setNote('');
    try { setOpen(await window.cth.kgGet(id)); }
    catch (e) { setNote(e instanceof Error ? e.message : 'could not open that document'); }
  };

  const remove = async (id: string) => {
    setConfirming(null);
    setBusy(true);
    try {
      const res = await window.cth.kgRemove(id);
      if (!res.ok) { setNote('could not remove that document'); return; }
      if (open?.meta.id === id) setOpen(null);
      if (hits) setHits(hits.filter((h) => h.docId !== id));
      setNote('removed');
      await refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const addFiles = async () => {
    setBusy(true); setNote('');
    try {
      const res = await window.cth.kgAddFiles();
      if (!res.ok) { setNote(res.error === 'cancelled' ? '' : (res.error ?? 'failed')); return; }
      const added = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - added;
      setNote(`added ${added} document${added === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`);
      await refresh();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (open) return <DocView doc={open} onBack={() => setOpen(null)} onRemove={() => void remove(open.meta.id)} />;

  const searching = query.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* Controls */}
      <div style={{
        flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        padding: 10, borderBottom: '1px solid var(--cth-ink-300)'
      }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the knowledge graph…"
          style={{
            flex: 1, minWidth: 160, padding: '4px 8px',
            background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
            border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
            fontFamily: 'var(--cth-font-ui)', fontSize: 12
          }}
        />
        <PixelButton variant="ghost" size="sm" onClick={() => void addFiles()} disabled={busy}>
          add documents
        </PixelButton>
        <PixelButton variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>
          refresh
        </PixelButton>
      </div>

      {/* Corpus line */}
      <div style={{
        flexShrink: 0, padding: '6px 10px', display: 'flex', gap: 10, flexWrap: 'wrap',
        fontSize: 11, color: 'var(--cth-ink-700)', borderBottom: '1px solid var(--cth-ink-300)'
      }}>
        {statusError ? (
          <span style={{ color: 'var(--cth-coral)' }}>corpus unreadable — {statusError}</span>
        ) : status ? (
          <>
            <span>{status.docCount} document{status.docCount === 1 ? '' : 's'}</span>
            <span>{status.chunkCount} chunk{status.chunkCount === 1 ? '' : 's'}</span>
            {Object.entries(status.byModality).map(([m, n]) => <Chip key={m} text={`${m} ${n}`} />)}
            {!status.enabled && <span style={{ color: 'var(--cth-coral)' }}>graph off — agents cannot read it</span>}
          </>
        ) : <span>reading the corpus…</span>}
        {note && <span style={{ marginLeft: 'auto', color: 'var(--cth-ink-500)' }}>{note}</span>}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10 }}>
        {searching ? (
          hits === null ? <Muted>Searching…</Muted>
          : hits.length === 0 ? <Muted>Nothing in the graph matches that.</Muted>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hits.map((h) => (
                <div key={`${h.docId}:${h.chunkIdx}`} style={rowStyle}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 11, flex: 1, minWidth: 0 }}>
                      {h.title.toUpperCase()}
                    </span>
                    <Chip text={h.modality} />
                    <Chip text={`chunk ${h.chunkIdx}`} />
                    <Chip text={h.score.toFixed(2)} tone="accent" />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--cth-ink-700)', lineHeight: 1.45 }}>{h.snippet}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => void openDoc(h.docId)} style={actionBtn('quiet')}>open</button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : docs === null ? <Muted>Loading…</Muted>
        : docs.length === 0 ? (
          <Muted>
            Nothing ingested yet. “Add documents” above (or Settings → Knowledge Graph) picks files
            off disk; agents can also add them with the <code>kg</code> CLI. Whatever lands here is
            what an agent can search for context.
          </Muted>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docs.map((d) => (
              <div key={d.id} style={rowStyle}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 11, flex: 1, minWidth: 0 }}>
                    {d.title.toUpperCase()}
                  </span>
                  <Chip text={d.modality} />
                  {d.truncated && <Chip text="truncated" tone="accent" />}
                </div>
                <div style={{
                  fontFamily: 'var(--cth-font-mono)', fontSize: 10.5,
                  color: 'var(--cth-ink-500)', wordBreak: 'break-all'
                }}>{d.source}</div>
                <div style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>
                  {relSince(d.addedAt)} · {formatBytes(d.bytes)} · {d.chunkCount} chunk{d.chunkCount === 1 ? '' : 's'}
                  {d.tags.length ? ` · ${d.tags.join(', ')}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => void openDoc(d.id)} style={actionBtn('quiet')}>open</button>
                  {confirming === d.id ? (
                    <>
                      <button onClick={() => void remove(d.id)} style={actionBtn('danger')} disabled={busy}>
                        really remove
                      </button>
                      <button onClick={() => setConfirming(null)} style={actionBtn('quiet')}>cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirming(d.id)} style={actionBtn('quiet')}>remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One document: its metadata, then the extracted text agents actually search. */
function DocView({ doc, onBack, onRemove }: {
  doc: { meta: KnowledgeDoc; text: string };
  onBack: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const m = doc.meta;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{
        flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        padding: 10, borderBottom: '1px solid var(--cth-ink-300)'
      }}>
        <PixelButton variant="ghost" size="sm" onClick={onBack}>back</PixelButton>
        <span style={{
          fontFamily: 'var(--cth-font-display)', fontSize: 12, flex: 1, minWidth: 0,
          color: 'var(--cth-ink-900)'
        }}>{m.title.toUpperCase()}</span>
        {confirming ? (
          <>
            <button onClick={onRemove} style={actionBtn('danger')}>really remove</button>
            <button onClick={() => setConfirming(false)} style={actionBtn('quiet')}>cancel</button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} style={actionBtn('quiet')}>remove</button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ ...rowStyle, gap: 4 }}>
          <Meta label="source" value={m.source} mono />
          <Meta label="added" value={`${relSince(m.addedAt)} (${m.addedAt})`} />
          <Meta label="modality" value={`${m.modality}${m.mime ? ` · ${m.mime}` : ''} · ${m.origExt || '—'}`} />
          <Meta label="size" value={`${formatBytes(m.bytes)} · ${m.chunkCount} chunk${m.chunkCount === 1 ? '' : 's'}${m.truncated ? ' · truncated' : ''}`} />
          <Meta label="extractor" value={m.extractor} />
          {m.tags.length > 0 && <Meta label="tags" value={m.tags.join(', ')} />}
          {m.caption && <Meta label="caption" value={m.caption} />}
        </div>
        <pre style={{
          margin: 0, padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: 'var(--cth-font-mono)', fontSize: 11.5, lineHeight: 1.5,
          background: 'var(--cth-paper-100)', color: 'var(--cth-ink-900)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)'
        }}>{doc.text || '(no extracted text — this artifact is indexed by its metadata only)'}</pre>
      </div>
    </div>
  );
}

/* ──────────────────────────────── helpers ────────────────────────────────── */

const rowStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 5, padding: 10,
  background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
  color: 'var(--cth-ink-900)'
};

const actionBtn = (kind: 'quiet' | 'danger'): React.CSSProperties => ({
  padding: '3px 9px 2px', border: 'none', cursor: 'pointer', flexShrink: 0,
  fontFamily: 'var(--cth-font-ui)', fontSize: 11,
  color: 'var(--cth-ink-900)',
  background: kind === 'danger' ? 'var(--cth-coral-light)' : 'var(--cth-cream-200)',
  boxShadow: `inset 0 0 0 1px ${kind === 'danger' ? 'var(--cth-coral)' : 'var(--cth-ink-300)'}`
});

function Chip({ text, tone = 'quiet' }: { text: string; tone?: 'quiet' | 'accent' }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--cth-font-display)', letterSpacing: 0.4,
      padding: '2px 6px', flexShrink: 0, textTransform: 'uppercase',
      color: 'var(--cth-ink-900)',
      background: tone === 'accent' ? 'var(--cth-mint-light)' : 'var(--cth-cream-200)',
      boxShadow: `inset 0 0 0 1px ${tone === 'accent' ? 'var(--cth-mint)' : 'var(--cth-ink-300)'}`
    }}>{text}</span>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
      <span style={{
        fontFamily: 'var(--cth-font-display)', fontSize: 10, letterSpacing: 0.4,
        textTransform: 'uppercase', color: 'var(--cth-ink-500)', width: 74, flexShrink: 0
      }}>{label}</span>
      <span style={{
        color: 'var(--cth-ink-900)', minWidth: 0, wordBreak: 'break-all',
        fontFamily: mono ? 'var(--cth-font-mono)' : 'var(--cth-font-ui)'
      }}>{value}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', padding: 6, lineHeight: 1.5 }}>{children}</div>;
}
