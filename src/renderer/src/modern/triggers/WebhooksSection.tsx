import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/store/store';
import { TRIGGER_MODES, type TriggerMode, type WebhookTrigger } from '@shared/triggers';
import {
  deleteWebhook, generateWebhookSecret, listWebhooks, newWebhook, saveWebhooks,
  webhooksStatus, type WebhooksStatus
} from '@/components/triggers/api';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger
} from '../components/ui/alert-dialog';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { Field, MonoLine, RowDisclosure, SecretField, TriggerRow } from './controls';

// CodeMirror + its language packs are ~1.2 MB and this editor is one field
// inside one webhook's schema box. Split so opening the app never loads it.
const JsonEditor = lazy(() => import('./JsonEditor').then((m) => ({ default: m.JsonEditor })));

/**
 * WEBHOOKS — one inbound HTTP endpoint per caller. Several share one port and
 * one tunnel and are told apart by the id in the path, so the URL you hand out
 * is per endpoint, never the tunnel root.
 *
 * The list lives in the STORE, not here: pixel Settings → Connections edits the
 * same endpoints off the same mirror, so a save on either surface repaints the
 * other with no refetch.
 *
 * MIRROR-THEN-PERSIST: keystroke edits (a name) update the mirror only, so the
 * other surface stays live while you type without a disk write per character;
 * everything discrete (toggle, mode, schema, add, delete) persists on the spot.
 */

const STATUS_POLL_MS = 5000;

export function WebhooksSection({ onSummary }: { onSummary: (s: string) => void }) {
  const hooks = useStore((s) => s.webhookTriggers);
  const setHooks = useStore((s) => s.setWebhookTriggers);
  const [status, setStatus] = useState<WebhooksStatus>({ running: false, endpoints: [] });
  const [minting, setMinting] = useState(false);

  useEffect(() => {
    let alive = true;
    // App seeds the mirror from getConfig() at boot and both editing surfaces
    // keep it current — so this read only covers the never-seeded case. Adopting
    // unconditionally could clobber an edit being typed elsewhere right now.
    if (useStore.getState().webhookTriggers.length === 0) {
      void listWebhooks().then((l) => {
        if (alive && l && useStore.getState().webhookTriggers.length === 0) setHooks(l);
      });
    }
    const poll = () => { void webhooksStatus().then((s) => { if (alive) setStatus(s); }); };
    poll();
    const t = setInterval(poll, STATUS_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [setHooks]);

  useEffect(() => {
    onSummary(hooks.length === 0 ? 'none' : `${hooks.length} · ${status.running ? 'live' : 'offline'}`);
  }, [hooks, status.running, onSummary]);

  /** Update the shared mirror; optionally write it through. Main sanitises what
   *  it stores (it will not enable a secretless endpoint), so we adopt its
   *  answer when it comes back rather than assuming ours was accepted. */
  const apply = (next: WebhookTrigger[], persist = true) => {
    setHooks(next);
    if (!persist) return;
    void saveWebhooks(next).then((canonical) => { if (canonical) setHooks(canonical); });
  };
  const patch = (id: string, fields: Partial<WebhookTrigger>, persist = true) =>
    apply(hooks.map((w) => (w.id === id ? { ...w, ...fields } : w)), persist);

  const remove = (id: string) => {
    setHooks(hooks.filter((w) => w.id !== id));
    void deleteWebhook(id).then((canonical) => { if (canonical) setHooks(canonical); });
  };

  const add = async () => {
    setMinting(true);
    try {
      const secret = await generateWebhookSecret();
      apply([...hooks, newWebhook(secret, hooks.length)]);
    } finally {
      setMinting(false);
    }
  };

  const urlFor = (id: string) => status.endpoints.find((e) => e.id === id)?.url ?? '';

  return (
    <>
      <p className="text-[13px] leading-5 text-muted-foreground">
        Anyone holding a URL and its secret can post work in. Each endpoint carries its own secret,
        so revoking one caller leaves the others alone.
      </p>

      {hooks.length === 0 && <p className="text-[13px] text-muted-foreground">No endpoints yet.</p>}
      {hooks.map((w) => (
        <WebhookRow
          key={w.id}
          hook={w}
          url={urlFor(w.id)}
          serverRunning={status.running}
          onPatch={(fields, persist) => patch(w.id, fields, persist)}
          onDelete={() => remove(w.id)}
        />
      ))}

      <div className="flex flex-col gap-1.5">
        <div>
          <Button variant="outline" size="sm" onClick={() => { void add(); }} disabled={minting}>
            <Plus /> {minting ? 'Minting…' : 'Add webhook'}
          </Button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          A new endpoint starts switched off. Copy its URL and secret, then turn it on.
        </p>
      </div>
    </>
  );
}

/* ─────────────────────────────── one endpoint ────────────────────────────── */

function WebhookRow({ hook, url, serverRunning, onPatch, onDelete }: {
  hook: WebhookTrigger;
  url: string;
  serverRunning: boolean;
  onPatch: (fields: Partial<WebhookTrigger>, persist?: boolean) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'url' | 'secret' | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaText, setSchemaText] = useState(hook.schema);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaSaved, setSchemaSaved] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A closed row must not keep a revealed secret on screen, and re-opening the
  // schema editor should start from what is actually stored.
  useEffect(() => {
    if (open) return;
    setRevealed(false);
    setSchemaOpen(false);
  }, [open]);

  useEffect(() => {
    if (!schemaOpen) return;
    setSchemaText(hook.schema);
    setSchemaError(null);
    setSchemaSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaOpen]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const copy = (what: 'url' | 'secret', text: string) => {
    void window.cth.copyToClipboard(text).catch(() => { /* noop */ });
    setCopied(what);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1300);
  };

  const saveSchema = () => {
    try {
      JSON.parse(schemaText);
    } catch (e) {
      // Never persist a schema that cannot be parsed — a broken one would lock
      // the caller out of their own endpoint with nothing on screen to say why.
      setSchemaError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSchemaError(null);
    onPatch({ schema: schemaText });
    setSchemaSaved(true);
    setTimeout(() => setSchemaSaved(false), 1300);
  };

  const modeLabel = TRIGGER_MODES.find((m) => m.value === hook.mode)?.label ?? hook.mode;
  const reach = url ? 'reachable' : serverRunning ? 'no URL yet' : 'server offline';

  return (
    <TriggerRow
      open={open}
      onOpenChange={setOpen}
      header={
        <div className="flex items-center gap-2">
          <RowDisclosure open={open} label={hook.name || 'unnamed'} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px]">{hook.name || 'unnamed'}</span>
            <span className="truncate text-[12px] text-muted-foreground">{modeLabel} · {reach}</span>
          </span>
          <Switch
            checked={hook.enabled}
            onCheckedChange={(enabled) => onPatch({ enabled })}
            aria-label={`Enable ${hook.name || 'endpoint'}`}
          />
        </div>
      }
    >
      <Field label="Name">
        {/* Mirror while typing, write through on blur. */}
        <Input
          value={hook.name}
          onChange={(e) => onPatch({ name: e.target.value }, false)}
          onBlur={() => onPatch({ name: hook.name })}
          placeholder="Who calls this"
          className="h-8"
        />
      </Field>

      <Field
        label="Post to"
        hint={url ? undefined : serverRunning
          ? 'This endpoint has no public address yet. It appears once the tunnel picks it up.'
          : 'The webhook server is not listening, so there is no address to hand out yet.'}
      >
        {url && (
          <div className="flex items-center gap-2">
            <MonoLine className="min-w-0 flex-1">{url}</MonoLine>
            <Button variant="outline" size="icon-sm" onClick={() => copy('url', url)} aria-label="Copy URL">
              {copied === 'url' ? <Check /> : <Copy />}
            </Button>
          </div>
        )}
      </Field>

      <Field label="Secret" hint="Callers echo this in the x-md-webhook-secret header.">
        <SecretField
          value={hook.secret}
          revealed={revealed}
          onReveal={() => setRevealed((r) => !r)}
          onCopy={() => copy('secret', hook.secret)}
          copied={copied === 'secret'}
        />
      </Field>

      <Field label="Trust" hint={TRIGGER_MODES.find((m) => m.value === hook.mode)?.blurb}>
        <Select value={hook.mode} onValueChange={(mode) => onPatch({ mode: mode as TriggerMode })}>
          <SelectTrigger className="h-8 w-full" aria-label="Trust"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRIGGER_MODES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Body schema">
        {!schemaOpen && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSchemaOpen(true)}>Edit schema</Button>
            <span className="text-[12px] text-muted-foreground">what an inbound body must look like</span>
          </div>
        )}
        {schemaOpen && (
          <div className="flex flex-col gap-2">
            <Suspense fallback={<Skeleton className="h-[180px] w-full" />}>
              <JsonEditor value={schemaText} onChange={(v) => { setSchemaText(v); setSchemaError(null); }} />
            </Suspense>
            {schemaError && (
              <Alert variant="destructive">
                <AlertDescription>Not valid JSON — {schemaError}. Nothing was saved.</AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={saveSchema}>{schemaSaved ? 'Saved' : 'Save schema'}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSchemaOpen(false)}>Close</Button>
            </div>
          </div>
        )}
      </Field>

      <div className="flex items-center">
        <span className="flex-1" />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              <Trash2 /> Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {hook.name || 'this endpoint'}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its URL stops answering and its secret is revoked. Anyone calling it will start
                getting errors. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete it</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TriggerRow>
  );
}
