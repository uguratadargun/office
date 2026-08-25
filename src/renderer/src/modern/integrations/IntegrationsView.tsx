import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Copy, Stethoscope } from 'lucide-react';
import type { HarnessConfig } from '@/store/config';
import { integrationsClient } from '@/integrations/registryClient';
import { navigate } from '../navigation';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Table, TableBody, TableCell, TableRow } from '../components/ui/table';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { IconButton } from '../components/IconButton';
import { cn } from '../lib/cn';
import {
  actionableCount, endpointRows, isActionable, restRow, slackRow, sortDoctorResults, telegramRow,
  webhooksRow,
  type EndpointRow, type IntegrationState, type IntegrationStatusRow, type RestRecord
} from './integrationsData';

/**
 * Integrations — STATUS ONLY (MD-88 ruling).
 *
 * This page answers one question: is each bridge connected, and if not, which
 * field is stopping it. It writes NOTHING but Start/Stop, and deep-links every
 * edit into Settings — there is one editor in the app and it is not here.
 *
 * The failure it exists to prevent is a bridge that starts, looks fine, and
 * silently accepts nothing because its allowlist is empty. So a blocker always
 * NAMES the missing field; "not running" on its own would send someone hunting.
 * All of that reasoning is in `integrationsData.ts`, with tests.
 *
 * Config is typed from `@/store/config`, NOT preload: preload's narrower
 * HarnessConfig omits the Telegram fields entirely, and `getConfig()` really
 * returns them.
 */

/** Status calls are pull-only — there is no push channel for any of them — so
 *  the page refreshes on mount, on window focus, and after each Start/Stop. */
const REFRESH_EVENT = 'focus';

interface DoctorReport { ranAt: number; results: Array<{ id: string; engine: string; status: string; detail: string; ts: number }> }

export function IntegrationsView() {
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const [slack, setSlack] = useState<{ running: boolean; url?: string; transport?: 'events' | 'socket' }>({ running: false });
  const [telegram, setTelegram] = useState<{ running: boolean; username?: string }>({ running: false });
  const [hooks, setHooks] = useState<{ running: boolean; url?: string; endpoints: { id: string; url: string }[] }>({ running: false, endpoints: [] });
  const [hookTriggers, setHookTriggers] = useState<Array<{ id: string; name: string; enabled: boolean }>>([]);
  const [rest, setRest] = useState<RestRecord[]>([]);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [cfg, s, t, w, list] = await Promise.all([
      window.cth.getConfig().catch(() => null),
      window.cth.slackStatus().catch(() => ({ running: false })),
      window.cth.telegramStatus().catch(() => ({ running: false })),
      window.cth.webhooksStatus().catch(() => ({ running: false, endpoints: [] })),
      window.cth.listWebhooks().catch(() => [])
    ]);
    if (cfg) setConfig(cfg as HarnessConfig);
    setSlack(s);
    setTelegram(t);
    setHooks(w);
    // The CONFIGURED list, not just its length: it is the only source of a
    // webhook's name and its enabled flag, and the status call has neither.
    setHookTriggers(Array.isArray(list) ? list.map((w) => ({ id: w.id, name: w.name, enabled: w.enabled })) : []);
    try {
      const records = await integrationsClient.list();
      setRest((records ?? []).map((r) => ({
        id: r.id, label: r.label, enabled: r.enabled, hasSecret: r.hasSecret, authType: r.authType
      })));
    } catch { /* the registry is optional; its row degrades to "none configured" */ }
  }, []);

  useEffect(() => {
    void refresh();
    void window.cth.doctorResults?.().then((r) => setDoctor(r as DoctorReport | null)).catch(() => { /* never run */ });
    const onFocus = () => { void refresh(); };
    window.addEventListener(REFRESH_EVENT, onFocus);
    return () => window.removeEventListener(REFRESH_EVENT, onFocus);
  }, [refresh]);

  /** Start/Stop is lifecycle, not configuration — the only thing this page
   *  writes. Every failure is shown; a bridge that refused to start silently is
   *  the exact thing this screen is for. */
  const lifecycle = async (id: string, run: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(id);
    setError(null);
    try {
      const r = await run();
      if (!r.ok) setError(r.error ?? `Could not start ${id}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const runDoctor = async () => {
    setDoctorBusy(true);
    try { setDoctor((await window.cth.doctorRun()) as DoctorReport); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setDoctorBusy(false); }
  };

  if (!config) {
    return (
      <div className="flex flex-col gap-2 p-6">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  /** Named, enabled-only, and joined to whatever URL the tunnel has minted. */
  const endpoints: EndpointRow[] = endpointRows(hooks, hookTriggers);

  const rows: Array<IntegrationStatusRow & {
    onToggle?: () => void;
    extra?: React.ReactNode;
    link?: DeepLink;
  }> = [
    {
      ...slackRow(config, slack),
      link: { navId: 'settings', section: 'Connections', anchor: 'set-slack-on', label: 'Settings', where: 'Settings → Connections → Slack' },
      onToggle: () => void lifecycle('slack', slack.running ? () => window.cth.slackStop() : () => window.cth.slackStart()),
      // Only the Events API has a URL to paste; Socket Mode dials out.
      extra: slack.running && slack.url ? <CopyRow label="Request URL" value={slack.url} /> : null
    },
    {
      ...telegramRow(config, telegram),
      link: { navId: 'settings', section: 'Connections', anchor: 'set-telegram-on', label: 'Settings', where: 'Settings → Connections → Telegram' },
      onToggle: () => void lifecycle('telegram', telegram.running ? () => window.cth.telegramStop() : () => window.cth.telegramStart())
    },
    {
      ...webhooksRow(hooks, hookTriggers.length),
      // The webhook EDITOR lives under Triggers, not Settings — so that is where
      // this row's link goes, and it opens the right card once it lands.
      link: { navId: 'triggers', section: 'Webhooks', label: 'Triggers', where: 'Triggers → Webhooks' },
      extra: endpoints.length > 0 ? (
        <div className="flex flex-col gap-1">
          {endpoints.map((e) => (
            <CopyRow key={e.id} label={e.name} value={e.url} />
          ))}
        </div>
      ) : null
    },
    {
      ...restRow(rest),
      link: { navId: 'settings', section: 'Connections', anchor: 'set-rest', label: 'Settings', where: 'Settings → Connections → Custom REST' },
      extra: rest.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {rest.map((r) => (
            <Badge key={r.id} variant={r.enabled && (r.authType === 'none' || r.hasSecret) ? 'secondary' : 'outline'}>
              {r.label}{r.enabled ? (r.authType === 'none' || r.hasSecret ? '' : ' · no secret') : ' · off'}
            </Badge>
          ))}
        </div>
      ) : null
    }
  ];

  const todo = actionableCount(doctor?.results);

  return (
    <ScrollArea className="h-full min-h-0">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            What is connected, and what is stopping the rest. Each row links to where it is edited.
          </p>
        </header>

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-start gap-2">
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <IconButton size="icon-xs" label="Dismiss" onClick={() => setError(null)}>×</IconButton>
            </AlertDescription>
          </Alert>
        )}

        <section className="rounded-lg border">
          {rows.map((row, i) => (
            <div key={row.id}>
              {i > 0 && <Separator />}
              <div className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <StateDot state={row.state} />
                  <span className="text-sm font-medium">{row.label}</span>
                  <StateWord row={row} />
                  <div className="ml-auto flex items-center gap-2">
                    {row.lifecycle && row.onToggle && (
                      <Button
                        size="sm"
                        // Outline both ways: four bridges off means four filled
                        // Starts, and none of them is the page's action —
                        // Run checks is (MD-100).
                        variant="outline"
                        disabled={busy === row.id || row.state === 'blocked' || row.state === 'off'}
                        onClick={row.onToggle}
                      >
                        {busy === row.id ? '…' : row.state === 'connected' ? 'Stop' : 'Start'}
                      </Button>
                    )}
                    {row.link && <DeepLinkButton link={row.link} />}
                  </div>
                </div>
                {/* A blocker NAMES the field to fix. "Not running" alone is what
                    sends someone hunting through four other settings. */}
                {row.blocker && (
                  <p className="pl-5 text-sm text-destructive">{row.blocker}</p>
                )}
                {row.detail && <p className="pl-5 text-xs text-muted-foreground">{row.detail}</p>}
                {row.extra && <div className="pl-5">{row.extra}</div>}
              </div>
            </div>
          ))}
        </section>

        {/* ── Provider Doctor ────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Stethoscope className="size-4 text-muted-foreground" />
            <h2 className="text-base font-medium">Provider Doctor</h2>
            {doctor && (
              <Badge variant={todo > 0 ? 'destructive' : 'secondary'}>
                {todo > 0 ? `${todo} to fix` : 'nothing to fix'}
              </Badge>
            )}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {doctor ? `last run ${new Date(doctor.ranAt).toLocaleString()}` : 'never run'}
              </span>
              <Button size="sm" variant="outline" disabled={doctorBusy} onClick={() => void runDoctor()}>
                {doctorBusy ? 'Checking…' : doctor ? 'Run again' : 'Run checks'}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            This app hard-codes flags and model ids belonging to each engine&apos;s CLI, and those change
            without telling anyone. These checks read the installed CLIs&apos; own <code className="font-mono text-xs">--help</code>.
            Nothing is spawned, no network call is made, and no provider config is written.
          </p>
          {doctor && (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableBody>
                  {sortDoctorResults(doctor.results).map((r) => (
                    <TableRow key={r.id}>
                      {/* A mismatch is the ONLY row that means "go fix
                          something". not-installed and unverifiable are
                          ANSWERS — painting them as failures makes the whole
                          page cry wolf, and then nobody reads the one row
                          that mattered. */}
                      <TableCell className={cn(
                        'w-32 font-mono text-xs',
                        isActionable(r.status) ? 'font-medium text-destructive' : 'text-muted-foreground'
                      )}>{r.status}</TableCell>
                      <TableCell className="w-40 truncate font-mono text-xs text-foreground/80">{r.id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.detail}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {doctor && (
            <p className="text-xs text-muted-foreground">
              Some facts cannot be settled from <code className="font-mono">--help</code> at all — live model ids
              and MCP package names need a network call this app does not make. Those are listed as
              unverifiable rather than assumed correct.
            </p>
          )}
        </section>
      </div>
    </ScrollArea>
  );
}

/** The only colour on the page at rest. `off` is hollow, not grey-filled: switched
 *  off is a choice, not a degraded state. */
function StateDot({ state }: { state: IntegrationState }) {
  return (
    <span className={cn(
      'size-2 shrink-0 rounded-full',
      state === 'connected' && 'bg-success',
      state === 'blocked' && 'bg-destructive',
      state === 'stopped' && 'bg-muted-foreground',
      state === 'off' && 'border border-border'
    )} />
  );
}

function StateWord({ row }: { row: IntegrationStatusRow }) {
  const word = row.state === 'connected' ? 'connected'
    : row.state === 'blocked' ? 'cannot start'
      : row.state === 'off' ? 'disabled' : 'stopped';
  return <span className="text-xs text-muted-foreground">{word}</span>;
}

/** Where one row's edit actually lives. */
interface DeepLink {
  navId: string;
  section?: string;
  anchor?: string;
  /** Button text — not always "Settings": webhooks are edited under Triggers. */
  label: string;
  /** The full path, for the tooltip. Says where you are about to go. */
  where: string;
}

/**
 * Every edit leaves this page — the editors live elsewhere, so nothing here
 * duplicates a credential form.
 *
 * It used to be ONE shared `SettingsLink` calling `navigate('settings')`, and
 * every row therefore landed on Settings › General (MD-94 S1): the Slack row,
 * the Telegram row and the webhook row all went to the same wrong page, and the
 * tooltip named a "Settings → Integrations" section that has never existed. Each
 * row now carries its own target — including the webhook one, whose editor is
 * not in Settings at all — and `navigate()` takes the section and the row id.
 */
function DeepLinkButton({ link }: { link: DeepLink }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          onClick={() => navigate(link.navId, { section: link.section, anchor: link.anchor })}
        >
          {link.label} <ArrowUpRight />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Configure this in {link.where}</TooltipContent>
    </Tooltip>
  );
}

/** A URL you can copy but not edit, under the name of the thing it belongs to.
 *  `''` means the tunnel has not come up — saying so beats offering a link that
 *  goes nowhere.
 *
 *  The label used to appear ONLY in that waiting case, so a live endpoint was an
 *  anonymous URL and you could not tell which webhook it was (MD-94 S2 is only
 *  half-fixed by naming the row — the name has to be on screen). */
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return <p className="text-xs text-muted-foreground">{label} — waiting for tunnel</p>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{value}</span>
      <IconButton
        size="icon-xs" label={`Copy ${label}`} side="left"
        onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}
      >
        <Copy />
      </IconButton>
      {copied && <span className="text-xs text-muted-foreground">copied</span>}
    </div>
  );
}
