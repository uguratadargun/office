import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, Terminal, Trash2, Plus } from 'lucide-react';
import { summarizeReleaseNotes } from '@shared/releaseNotes';
import { describeUpdateSettings, reduceStatus, type UpdateStatus } from '@shared/updateState';
import { uiMode, uiModeOf } from '@shared/uiMode';
import { bossName, DEFAULT_BOSS_NAME } from '@shared/bossName';
import { useAppTheme, useThemePreference, setThemePreference, type ThemePreference } from '@/design/theme';
import type { HarnessConfig } from '@/store/config';
import { Button } from '../components/ui/button';
import { Group, SectionHeader } from './Row';
import { TextRow, ToggleRow, SelectRow, ActionRow, type Choice } from './fields';
import type { ConfigApi } from './useConfig';

/**
 * Appearance binds to the theme PREFERENCE, not the resolved theme: 'system'
 * has to be a value the control can show, or choosing it would immediately read
 * back as whatever the OS happens to be right now.
 *
 * The list is derived from the `ThemePreference` union via a keyed map, so if
 * that union grows again the option appears here with no edit to this file.
 */
const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match system'
};

const OFFICE_THEMES: Choice[] = [
  { value: 'office', label: 'The Office' },
  { value: 'friends', label: 'Friends' },
  { value: 'brooklyn99', label: 'Brooklyn Nine-Nine' },
  { value: 'siliconvalley', label: 'Silicon Valley' },
  { value: 'got', label: 'Game of Thrones' },
  { value: 'hogwarts', label: 'Hogwarts' }
];

export function GeneralSection({ api }: { api: ConfigApi }) {
  const { config, save, reload } = api;
  if (!config) return null;
  const boss = bossName(config);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="General" blurb="Where Office keeps its work, how it looks, and how it behaves on this machine." />

      <Group title="Workspace">
        <HomeFolderRow config={config} />
        <DirectoriesRow config={config} save={save} />
        <TextRow
          id="set-boss"
          label="Boss name"
          help={`What the orchestrator is called across the app. Blank falls back to ${DEFAULT_BOSS_NAME}.`}
          value={config.bossName ?? ''}
          placeholder={DEFAULT_BOSS_NAME}
          onCommit={(v) => save({ bossName: v.trim() })}
        />
      </Group>

      <Group title="Appearance">
        <AppearanceRow />
        <InterfaceRow config={config} save={save} />
        <OfficeThemeRow config={config} save={save} />
      </Group>

      <Group title="Environment">
        <ToggleRow
          id="set-keepawake"
          label="Keep this Mac awake while agents run"
          help="Prevents display sleep so scheduled missions and terminals keep firing while you are away. Costs battery — best on AC."
          checked={!!config.strongKeepalive}
          onChange={(v) => save({ strongKeepalive: v })}
        />
        <ToggleRow
          id="set-audience"
          label="Explain things simply"
          help="Plain-English copy throughout, instead of the engineering register."
          checked={config.audience === 'non-technical'}
          onChange={(v) => save({ audience: v ? 'non-technical' : 'technical' })}
        />
        <NotificationsRow config={config} reload={reload} />
      </Group>

      <Group title="Maintenance">
        <ToggleRow
          id="set-autoupdate"
          label="Auto-update"
          help="Download and install new releases from GitHub as they ship."
          checked={config.autoUpdate !== false}
          onChange={(v) => save({ autoUpdate: v })}
        />
        <ToggleRow
          id="set-telemetry"
          label="Anonymous usage stats"
          help="Product analytics with no prompt or code content. See TELEMETRY.md."
          checked={config.telemetryEnabled !== false}
          onChange={(v) => save({ telemetryEnabled: v })}
        />
        <UpdatesRow />
      </Group>

      <Group
        title="Danger zone"
        description={`Ends every session, forgets every agent and returns Office to first run. ${boss} cannot undo it.`}
      >
        <ResetRow />
      </Group>
    </div>
  );
}

/**
 * Changing the home folder is two decisions, not one: which folder, and whether
 * to MOVE the existing hive into it or start FRESH there. The pixel UI asks the
 * second one in a sub-modal; here the row expands, which keeps the choice next
 * to the thing it is about and needs no overlay.
 *
 * `clearLocalState()` on 'fresh' is not cosmetic. Moving copies the hive and the
 * palace, so the renderer's cached roster still matches; a fresh home starts
 * empty, and leaving `cth.*` in localStorage would show agents that no longer
 * exist. A successful change relaunches the app and never resolves.
 */
function clearLocalState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('cth.')) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch { /* private mode */ }
}

function HomeFolderRow({ config }: { config: HarnessConfig }) {
  const [pending, setPending] = useState<string | null>(null);
  const [mode, setMode] = useState<'move' | 'fresh'>('move');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async () => {
    setErr('');
    const res = await window.cth.chooseFolder();
    if (!res.ok) return; // cancelled
    setMode('move'); // recommended: keeps the data
    setPending(res.path);
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true); setErr('');
    if (mode === 'fresh') clearLocalState();
    try {
      const res = await window.cth.changeHome(pending, mode);
      // ok === true never returns — the process relaunches.
      if (!res.ok) { setErr(res.error ?? 'Could not change the home folder.'); setBusy(false); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ActionRow
      id="set-home"
      label="Home folder"
      help="Where agents, their memory and the shared board live."
      stacked={pending !== null}
    >
      {pending === null ? (
        <div className="flex items-center gap-2">
          <code className="max-w-[22rem] truncate rounded-md border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {config.harnessHome ?? 'not set'}
          </code>
          <Button variant="outline" size="sm" onClick={() => void pick()}>
            <FolderOpen /> Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="text-sm">
            Move to <code className="font-mono text-xs">{pending}</code>?
          </div>
          <SelectRow
            id="set-home-mode"
            label="What happens to the current hive"
            value={mode}
            choices={[
              { value: 'move', label: 'Move it — keep every agent and their memory' },
              { value: 'fresh', label: 'Start fresh — the new folder begins empty' }
            ]}
            width="w-[22rem]"
            onChange={(v) => setMode(v as 'move' | 'fresh')}
          />
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void apply()}>
              {busy ? 'Changing…' : 'Change home folder'}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setPending(null); setErr(''); }}>
              Cancel
            </Button>
            <span className="text-xs text-muted-foreground">Office restarts afterwards.</span>
          </div>
        </div>
      )}
    </ActionRow>
  );
}

/**
 * The registered-repo list, lifted out of the pixel Floor tab (it was never a
 * Floor concern). Removing a repo drops the quick-pick ONLY — agents already
 * working in that folder keep their cwd, which is what makes the control safe
 * to offer without a confirm dialog, and why the help line says so out loud.
 */
function DirectoriesRow({
  config,
  save
}: {
  config: HarnessConfig;
  save: ConfigApi['save'];
}) {
  const repos = config.registeredRepos ?? [];
  const add = async () => {
    const res = await window.cth.chooseFolder();
    if (!res.ok) return; // cancelled
    const p = res.path.trim();
    if (!p) return;
    // Prepend + dedupe (most-recent-first), then ADOPT THE SAVED LIST: main
    // expands `~` when it persists, so the value we sent is not the value on
    // disk. Trusting the local array is the AddAgentModal bug.
    await save({ registeredRepos: [p, ...repos.filter((r) => r !== p)] });
  };
  const remove = (path: string) => save({ registeredRepos: repos.filter((r) => r !== path) });
  /**
   * Removing a project is one stray click away from a list you then have to
   * rebuild by hand, and the trash icon sits next to "open in Terminal". So the
   * first click ARMS and the second removes, and the armed state times out on
   * its own — a confirm you have to answer would be heavier than the action
   * deserves, and no confirm at all is how the list quietly loses a row.
   */
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), 5000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <ActionRow
      id="set-repos"
      label="Directories"
      help="Projects offered when you spawn an agent. Removing one only drops the quick-pick — agents already working there keep their folder."
      stacked
    >
      <div className="flex flex-col gap-1">
        {repos.length === 0 && (
          <p className="py-1 text-xs text-muted-foreground">
            No registered projects yet. Add one and it becomes the default folder for new agents.
          </p>
        )}
        {repos.map((r) => (
          <div key={r} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={r}>{r}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${r} in Terminal`}
              onClick={() => void window.cth.openTerminalAt(r)}
            >
              <Terminal />
            </Button>
            {armed === r ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Confirm removing ${r} from registered projects`}
                className="text-destructive"
                onClick={() => { setArmed(null); void remove(r); }}
              >
                Remove?
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${r} from registered projects`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setArmed(r)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        <div className="pt-1">
          <Button variant="outline" size="sm" onClick={() => void add()}>
            <Plus /> Add project
          </Button>
        </div>
      </div>
    </ActionRow>
  );
}

/**
 * Both values come straight from the theme store: the row shows the CHOICE and
 * the help line shows what that choice currently resolves to, so the topbar
 * toggle and the OS flipping under 'system' both land here without local state.
 */
function AppearanceRow() {
  const resolved = useAppTheme();
  const pref = useThemePreference();

  return (
    <SelectRow
      id="set-appearance"
      label="Theme"
      help={pref === 'system'
        ? `Following this Mac — currently ${resolved}. Applies to both interfaces, including terminals and the editor.`
        : 'Applies to both interfaces, including terminals and the editor.'}
      value={pref}
      choices={(Object.keys(THEME_LABELS) as ThemePreference[]).map((t) => ({ value: t, label: THEME_LABELS[t] }))}
      onChange={(v) => { setThemePreference(v as ThemePreference); }}
    />
  );
}

function InterfaceRow({ config, save }: { config: HarnessConfig; save: ConfigApi['save'] }) {
  const mode = uiModeOf(config);
  const pick = async (next: string) => {
    await save({ ui: { ...(config.ui ?? {}), mode: uiMode(next) } });
    // Each UI loads its own stylesheet from its own entry module, so swapping
    // roots in place would leave the outgoing UI's CSS in the document.
    window.location.reload();
  };
  return (
    <SelectRow
      id="set-uimode"
      label="Interface"
      help="Two front-ends over the same hive. Switching reloads the window; agents, terminals and settings are untouched."
      value={mode}
      choices={[{ value: 'pixel', label: 'Classic (pixel)' }, { value: 'modern', label: 'Modern' }]}
      onChange={pick}
    />
  );
}

/**
 * Office themes are two settings behind one control: an off switch and a
 * choice. Collapsing them into a single select — with "Off" as a value — is
 * honest here because "which office" is meaningless while the feature is off,
 * and two rows for one decision is the kind of thing that made the pixel modal
 * 2800 lines.
 */
function OfficeThemeRow({ config, save }: { config: HarnessConfig; save: ConfigApi['save'] }) {
  const value = config.tvShowOffices ? (config.officeTheme ?? 'office') : 'off';
  const pick = async (next: string) => {
    if (next === 'off') { await save({ tvShowOffices: false }); return; }
    await save({ tvShowOffices: true, officeTheme: next as HarnessConfig['officeTheme'] });
  };
  return (
    <SelectRow
      id="set-office-theme"
      label="Office theme"
      help="Swaps the floor map and the cast. Running agents keep their sessions."
      value={value}
      choices={[{ value: 'off', label: 'Off — the default office' }, ...OFFICE_THEMES]}
      onChange={pick}
    />
  );
}

/** Notifications live behind their own IPC (it asks the OS), so this row reads
 *  back what the OS granted rather than what we asked for. */
function NotificationsRow({ config, reload }: { config: HarnessConfig; reload: () => Promise<void> }) {
  const [on, setOn] = useState(!!config.notifications);
  useEffect(() => { setOn(!!config.notifications); }, [config.notifications]);
  return (
    <ToggleRow
      id="set-notifications"
      label="Desktop notifications"
      help="A banner when an agent needs you or a long run finishes."
      checked={on}
      onChange={async (v) => {
        setOn(v);
        await window.cth.setNotifications(v);
        await reload();
      }}
    />
  );
}

/**
 * Two-step arm, no dialog: the pixel UI's `DestructiveAction` pattern, which
 * disarms itself after a few seconds so a stray first click cannot sit there
 * waiting to be completed by a second one minutes later.
 */
const ARM_MS = 8000;

function ResetRow() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <ActionRow
      id="set-reset"
      label="Reset and start over"
      help={armed
        ? 'Click again to erase everything and return to first run.'
        : 'Erases agents, sessions and settings, then reopens first-run setup.'}
    >
      <Button
        variant={armed ? 'destructive' : 'outline'}
        size="sm"
        onClick={async () => {
          if (!armed) { setArmed(true); return; }
          // Same order the pixel UI uses: drop the renderer's cached `cth.*`
          // keys FIRST, because resetAll wipes the hive and relaunches — it
          // never resolves, so anything after it does not run.
          clearLocalState();
          await window.cth.resetAll();
        }}
      >
        {armed ? 'Yes, erase everything' : 'Reset…'}
      </Button>
    </ActionRow>
  );
}


/**
 * Version + updates, in the place people actually go to ask.
 *
 * The toolbar chip already carries this stream, but it stays blank when
 * everything is fine — which is the right thing for a chip and useless for the
 * question "am I on the latest?". Modern had the chip's toast and nothing else
 * (MD-93 S2): no manual check, no release notes, no version string, and an
 * Auto-update switch with nothing behind it.
 *
 * The wording comes from `describeUpdateSettings` — the same shared reducer and
 * states the pixel block and the badge use, so the three can never disagree
 * about what is installed.
 */
function UpdatesRow() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Subscribe BEFORE pulling: main may have emitted while this view was
    // unmounted, and `update:current` re-serves the last known state.
    const off = window.cth.onUpdateStatus?.((next) => setStatus((prev) => reduceStatus(prev, next)));
    void window.cth.updateCurrent?.()
      .then((cur) => { if (cur) setStatus((prev) => reduceStatus(prev, cur)); })
      .catch(() => { /* the push channel still works */ });
    return off;
  }, []);

  const view = describeUpdateSettings(status, window.cth.version);
  const notes = useMemo(
    () => summarizeReleaseNotes(status && 'notes' in status ? status.notes : undefined),
    [status]
  );

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
    } catch { /* the emitted status carries the failure */ }
    setBusy(false);
  }, [view.action, busy, status]);

  return (
    <ActionRow id="set-updates" label="Version and updates" help={view.detail} stacked>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{view.headline}</span>
          {/* The headline already names a version in most states ("You're on
              v0.4.5"); printing it again beside itself reads as two numbers. */}
          {!view.headline.includes(window.cth.version) && (
            <span className="font-mono text-xs text-muted-foreground">v{window.cth.version}</span>
          )}
          {view.button && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy || view.busy}
              onClick={() => void onClick()}
            >
              {busy || view.busy ? 'Working…' : view.button}
            </Button>
          )}
        </div>
        {notes.length > 0 && (
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </div>
    </ActionRow>
  );
}
