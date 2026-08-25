import { useEffect, useState } from 'react';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { authTypeNeedsSecret, validateIntegrationRecord } from '@shared/integrations';
import {
  integrationsClient, slugify,
  type IntegrationAuthType, type IntegrationKind, type IntegrationRecord,
  type IntegrationRecordView, type IntegrationTemplate, type TestResult
} from '@/integrations/registryClient';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '../components/ui/alert-dialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';

/**
 * The custom-REST registry, in modern Settings.
 *
 * MD-94 S1: nothing in `modern/` rendered this at all. The Integrations page is
 * status-only by ruling (MD-88) and deep-links every edit into Settings, so a
 * modern-default user could SEE "2 configured · 1 usable" and had no way to add,
 * edit, or revoke any of them. This is that missing editor, and it is the reason
 * the Integrations row's "Settings ↗" now has somewhere to land.
 *
 * Validation is `validateIntegrationRecord` — the SAME function the main-process
 * upsert runs — rather than a second copy of its rules. The pixel editor
 * re-inlined the slug/URL/header regexes locally and can therefore drift from
 * what the backend will actually accept; here a save that main would reject is
 * rejected in the form, with main's own sentence.
 *
 * SECURITY: a secret goes one way. `list()` returns `hasSecret`, never a value,
 * so the field is always empty on open and blank means "leave the stored one
 * alone" — never "clear it".
 */

interface Draft {
  isNew: boolean;
  id: string;
  label: string;
  kind: IntegrationKind;
  baseUrl: string;
  authType: IntegrationAuthType;
  authHeader: string;
  enabled: boolean;
  hasSecret: boolean;
  createdAt: number;
  /** Write-only input buffer. Blank on save = keep whatever is stored. */
  secret: string;
  secretLabel?: string;
  secretHelp?: string;
}

const AUTH_LABEL: Record<IntegrationAuthType, string> = {
  none: 'None (public API)',
  bearer: 'Bearer token',
  header: 'Custom header',
  github: 'GitHub'
};

/** Auth types a user may choose for a kind. `github` is not a free choice — the
 *  broker signs those requests its own way — so its records stay on it. */
function authChoices(kind: IntegrationKind): IntegrationAuthType[] {
  return kind === 'github' ? ['github'] : ['none', 'bearer', 'header'];
}

function usable(r: IntegrationRecordView): boolean {
  return r.enabled && (!authTypeNeedsSecret(r.authType) || r.hasSecret);
}

function draftFromTemplate(t: IntegrationTemplate, now: number): Draft {
  return {
    isNew: true, id: slugify(t.idSuggestion || t.label), label: t.label, kind: t.kind,
    baseUrl: t.baseUrl, authType: t.authType, authHeader: t.authHeader ?? '',
    enabled: true, hasSecret: false, createdAt: now, secret: '',
    secretLabel: t.secretLabel, secretHelp: t.secretHelp
  };
}

function draftFromRecord(r: IntegrationRecordView): Draft {
  return {
    isNew: false, id: r.id, label: r.label, kind: r.kind, baseUrl: r.baseUrl,
    authType: r.authType, authHeader: r.authHeader ?? '', enabled: r.enabled,
    hasSecret: r.hasSecret, createdAt: r.createdAt, secret: ''
  };
}

/** The record main will be asked to store. Kept separate from validation so the
 *  form checks EXACTLY what it is about to send. */
export function recordFromDraft(d: Draft, now: number): IntegrationRecord {
  const id = slugify(d.id || d.label);
  return {
    id,
    label: d.label.trim(),
    kind: d.kind,
    baseUrl: d.baseUrl.trim(),
    authType: d.authType,
    authHeader: d.authType === 'header' ? d.authHeader.trim() : undefined,
    secretRef: authTypeNeedsSecret(d.authType) ? `int:${id}` : undefined,
    enabled: d.enabled,
    createdAt: d.isNew ? now : d.createdAt,
    updatedAt: now
  };
}

function fmtTest(t: TestResult): string {
  return t.ok
    ? `Connected${t.status ? ` (${t.status})` : ''}`
    : `${t.error || 'Failed'}${t.status ? ` (${t.status})` : ''}`;
}

export function RestRegistry() {
  const [records, setRecords] = useState<IntegrationRecordView[] | null>(null);
  const [templates, setTemplates] = useState<IntegrationTemplate[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowTest, setRowTest] = useState<Record<string, TestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const refresh = async () => setRecords(await integrationsClient.list());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [tpls, recs] = await Promise.all([
        integrationsClient.listTemplates().catch(() => []),
        integrationsClient.list().catch(() => [])
      ]);
      if (!alive) return;
      setTemplates(tpls);
      setRecords(recs);
    })();
    return () => { alive = false; };
  }, []);

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const close = () => { setDraft(null); setShowSecret(false); setErr(''); };

  const startAdd = () => {
    const t = templates.find((x) => x.kind === 'custom-rest') ?? templates[0];
    if (!t) { setErr('No integration templates are available.'); return; }
    setErr('');
    setShowSecret(false);
    setDraft(draftFromTemplate(t, Date.now()));
  };

  const save = async () => {
    if (!draft) return;
    const record = recordFromDraft(draft, Date.now());
    const v = validateIntegrationRecord(record);
    if (!v.ok) { setErr(v.error); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await integrationsClient.save(record, draft.secret.trim() || undefined);
      if (!res.ok) { setErr(res.error || 'Could not save.'); return; }
      await refresh();
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: IntegrationRecordView) => {
    setBusy(true);
    try {
      await integrationsClient.remove(r.id);
      setRowTest((m) => { const n = { ...m }; delete n[r.id]; return n; });
      await refresh();
      if (draft && !draft.isNew && draft.id === r.id) close();
    } catch { setErr(`Could not remove “${r.label}”.`); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setTestingId(id);
    try {
      const res = await integrationsClient.test(id);
      setRowTest((m) => ({ ...m, [id]: res }));
    }
    catch { setRowTest((m) => ({ ...m, [id]: { ok: false, error: 'Test failed to run.' } })); }
    finally { setTestingId(null); }
  };

  const list = records ?? [];
  const needsSecretNow = draft ? authTypeNeedsSecret(draft.authType) : false;

  return (
    <div className="flex w-full flex-col gap-3">
      {err && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words">{err}</span>
            <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={() => setErr('')}>×</Button>
          </AlertDescription>
        </Alert>
      )}

      {records !== null && list.length === 0 && !draft && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nothing registered. Add one to give every worker a credentialed HTTP client for it —
          the key is stored encrypted on this machine and never read back.
        </p>
      )}

      {list.length > 0 && (
        <div className="flex flex-col divide-y divide-border/60 rounded-lg border">
          {list.map((r) => (
            <div key={r.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{r.label}</span>
                <Badge variant={usable(r) ? 'secondary' : 'outline'}>
                  {!r.enabled ? 'off' : usable(r) ? 'usable' : 'no secret'}
                </Badge>
                <div className="ml-auto flex items-center gap-1">
                  <Button size="xs" variant="ghost" disabled={testingId === r.id} onClick={() => void test(r.id)}>
                    {testingId === r.id ? 'Testing…' : 'Test'}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => { setErr(''); setShowSecret(false); setDraft(draftFromRecord(r)); }}>
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="xs" variant="ghost" className="text-destructive">Remove</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove “{r.label}”?</AlertDialogTitle>
                        {/* No undo window, unlike the other destructive actions: this
                            revokes a live credential, and the secret cannot be read
                            back to retype. Deferring that is worse than one confirm. */}
                        <AlertDialogDescription>
                          The integration and its stored secret are deleted. The secret cannot be
                          recovered — you would have to paste a new one.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(r)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <p className="font-mono text-[11px] text-muted-foreground">
                {r.kind}{r.baseUrl ? ` · ${r.baseUrl}` : ''}
              </p>
              {rowTest[r.id] && (
                <p className={rowTest[r.id].ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
                  {fmtTest(rowTest[r.id])}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {draft ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <p className="text-sm font-medium">{draft.isNew ? 'New integration' : `Edit ${draft.label}`}</p>

          <Field label="Name">
            <Input
              value={draft.label}
              spellCheck={false}
              onChange={(e) => patch({
                label: e.target.value,
                // The id is the secret's handle, so it is frozen once stored —
                // renaming it would orphan the credential.
                id: draft.isNew ? slugify(e.target.value) : draft.id
              })}
            />
          </Field>

          <Field label="Id" hint="Used as the secret handle and by workers to name the client.">
            <Input value={slugify(draft.id || draft.label)} disabled className="font-mono text-xs" />
          </Field>

          <Field label="Base URL" hint="https:// — or http://localhost / 127.0.0.1 for a local target.">
            <Input
              value={draft.baseUrl}
              spellCheck={false}
              placeholder="https://api.example.com"
              className="font-mono text-xs"
              onChange={(e) => patch({ baseUrl: e.target.value })}
            />
          </Field>

          <Field label="Authentication">
            <Select
              value={draft.authType}
              onValueChange={(v) => patch({ authType: v as IntegrationAuthType })}
            >
              <SelectTrigger aria-label="Authentication"><SelectValue /></SelectTrigger>
              <SelectContent>
                {authChoices(draft.kind).map((a) => (
                  <SelectItem key={a} value={a}>{AUTH_LABEL[a]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {draft.authType === 'header' && (
            <Field label="Header name" hint="1–64 characters of A–Z, 0–9 or “-”.">
              <Input
                value={draft.authHeader}
                spellCheck={false}
                placeholder="X-Api-Key"
                className="font-mono text-xs"
                onChange={(e) => patch({ authHeader: e.target.value })}
              />
            </Field>
          )}

          {needsSecretNow && (
            <Field
              label={draft.secretLabel ?? 'Secret'}
              hint={draft.secretHelp ?? (draft.hasSecret
                ? 'A secret is stored. Leave blank to keep it; paste a new one to replace it.'
                : 'Stored encrypted on this machine and never read back.')}
            >
              <div className="flex items-center gap-2">
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={draft.secret}
                  spellCheck={false}
                  placeholder={draft.hasSecret ? 'stored — paste to replace' : 'paste the key'}
                  className="font-mono text-xs"
                  onChange={(e) => patch({ secret: e.target.value })}
                />
                <Button
                  size="icon-xs" variant="ghost"
                  aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                  onClick={() => setShowSecret((s) => !s)}
                >
                  {showSecret ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </Field>
          )}

          <div className="flex items-center gap-2">
            <Switch id="rest-enabled" checked={draft.enabled} onCheckedChange={(v: boolean) => patch({ enabled: v })} />
            <Label htmlFor="rest-enabled" className="text-xs text-muted-foreground">
              Enabled — workers may call it
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={close}>Cancel</Button>
            {!draft.isNew && (
              <Button size="sm" variant="outline" disabled={testingId === draft.id} onClick={() => void test(draft.id)}>
                {testingId === draft.id ? 'Testing…' : 'Test'}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="self-start" onClick={startAdd}>
          <Plus /> Add integration
        </Button>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}
