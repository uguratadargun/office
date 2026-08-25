import { useEffect, useState } from 'react';
import { resolvePublicUrl, describePublicUrl } from '@shared/publicUrl';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Group, SectionHeader } from './Row';
import { TextRow, ToggleRow, SelectRow, ActionRow } from './fields';
import { numOrUndefined, numText, type ConfigApi } from './useConfig';

/**
 * Slack and Telegram do NOT go through `updateConfig`. Each has its own
 * `*SetConfig` IPC, because persisting a credential also has to start or stop
 * the server that uses it — writing the key alone would leave a running
 * connection on a secret that no longer exists.
 *
 * Credentials are write-only over IPC: nothing reads a token back. The fields
 * therefore show what is on disk when the config carries it and never try to
 * "confirm" a secret — a blank box means unset, not hidden.
 */
export function ConnectionsSection({ api }: { api: ConfigApi }) {
  const { config, save, reload } = api;
  const [slack, setSlack] = useState<{ running: boolean; url?: string; transport?: string }>({ running: false });
  const [tg, setTg] = useState<{ running: boolean; username?: string }>({ running: false });

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [s, t] = await Promise.all([window.cth.slackStatus(), window.cth.telegramStatus()]);
        if (!cancelled) { setSlack(s); setTg(t); }
      } catch { /* the badges just stay stale */ }
    };
    void poll();
    // Same cadence as the pixel modal: these are two IPC round-trips, and the
    // state only changes when the user presses a button on this screen.
    const id = window.setInterval(poll, 4000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  if (!config) return null;
  const socket = config.slackTransport === 'socket';
  const publicUrl = resolvePublicUrl(config.publicUrl);

  const setSlackCfg = async (patch: Parameters<typeof window.cth.slackSetConfig>[0]) => {
    await window.cth.slackSetConfig(patch);
    await reload();
  };
  const setTgCfg = async (patch: Parameters<typeof window.cth.telegramSetConfig>[0]) => {
    await window.cth.telegramSetConfig(patch);
    await reload();
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader title="Connections" blurb="How the outside world reaches your agents." />

      <Group title="Public URL" description={describePublicUrl(publicUrl)}>
        <TextRow
          id="set-publicurl"
          label="Public URL"
          help="Where Slack and webhooks send events. Leave blank to use the tunnel Office opens for you."
          value={config.publicUrl ?? ''}
          placeholder={slack.url ?? 'https://…'}
          monospace
          onCommit={(v) => save({ publicUrl: v.trim() })}
        />
      </Group>

      <Group title="Repositories">
        <SelectRow
          id="set-issuehost"
          label="Issue tracker"
          help="Which host to read issues and pull requests from."
          value={config.issueHost ?? 'auto'}
          choices={[
            { value: 'auto', label: 'Detect from the remote' },
            { value: 'github', label: 'GitHub' },
            { value: 'gitlab', label: 'GitLab' }
          ]}
          onChange={(v) => save({ issueHost: v as 'auto' | 'github' | 'gitlab' })}
        />
        <ToggleRow
          id="set-automerge"
          label="Auto-merge ready PRs"
          help="Merge a pull request as soon as its checks pass and it has no conflicts."
          checked={!!config.prAutoMerge}
          onChange={(v) => save({ prAutoMerge: v })}
        />
      </Group>

      <Group title="Slack">
        <ActionRow
          id="set-slack-on"
          label="Slack"
          help="Bring messages from a Slack channel into the boss's queue, and post replies back."
        >
          <div className="flex items-center gap-2">
            {slack.running
              ? <Badge variant="secondary" className="font-normal">Connected{slack.transport ? ` · ${slack.transport}` : ''}</Badge>
              : <Badge variant="secondary" className="font-normal">Not connected</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (slack.running) { await window.cth.slackStop(); }
                else { await setSlackCfg({ enabled: true }); await window.cth.slackStart(); }
                setSlack(await window.cth.slackStatus());
              }}
            >
              {slack.running ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
        </ActionRow>
        <SelectRow
          id="set-slack-transport"
          label="Connection"
          help="Socket Mode dials out over a WebSocket and needs no public URL. The Events API needs a reachable Request URL."
          value={config.slackTransport ?? 'events'}
          choices={[
            { value: 'events', label: 'Events API (needs a public URL)' },
            { value: 'socket', label: 'Socket Mode (no public URL)' }
          ]}
          onChange={(v) => setSlackCfg({ transport: v as 'events' | 'socket' })}
        />
        <TextRow
          id="set-slack-apptoken"
          label="App-level token"
          help="Socket Mode only. Starts xapp-, scope connections:write."
          type="password"
          monospace
          disabled={!socket}
          value={config.slackAppToken ?? ''}
          placeholder="xapp-…"
          onCommit={(v) => setSlackCfg({ appToken: v.trim() })}
        />
        <TextRow
          id="set-slack-secret"
          label="Signing secret"
          help="Verifies that an inbound request really came from Slack."
          type="password"
          monospace
          disabled={socket}
          value={config.slackSigningSecret ?? ''}
          onCommit={(v) => setSlackCfg({ signingSecret: v.trim() })}
        />
        <TextRow
          id="set-slack-bottoken"
          label="Bot token"
          help="Starts xoxb-. Used to post replies."
          type="password"
          monospace
          value={config.slackBotToken ?? ''}
          placeholder="xoxb-…"
          onCommit={(v) => setSlackCfg({ botToken: v.trim() })}
        />
        <TextRow
          id="set-slack-users"
          label="Allowed user ids"
          help="Required. Comma or space separated Slack user ids — blank accepts nobody, and ingestion refuses to start."
          monospace
          value={config.slackAllowedUserIds ?? ''}
          placeholder="U0123ABC, U0456DEF"
          onCommit={(v) => setSlackCfg({ allowedUserIds: v.trim() })}
        />
        <TextRow
          id="set-slack-channel"
          label="Channel id"
          help="Restrict to one channel. Blank listens to every channel the bot is in."
          monospace
          value={config.slackChannelId ?? ''}
          placeholder="C0123… or blank for any"
          onCommit={(v) => setSlackCfg({ channelId: v.trim() })}
        />
        <TextRow
          id="set-slack-port"
          label="Port"
          help="Local port the Events API server listens on."
          type="number"
          disabled={socket}
          value={numText(config.slackPort)}
          placeholder="3847"
          onCommit={(v) => setSlackCfg({ port: numOrUndefined(v) })}
        />
        <ToggleRow
          id="set-slack-proactive"
          label="Proactive posting"
          help="Lets Office start a Slack thread on its own. Replies to messages that came FROM Slack are never gated by this."
          checked={!!config.slackProactivePosting}
          onChange={(v) => setSlackCfg({ proactivePosting: v })}
        />
      </Group>

      <Group title="Telegram">
        <ActionRow
          id="set-telegram-on"
          label="Telegram remote control"
          help="Talk to the boss from your phone. Long-polls; needs no public URL."
        >
          <div className="flex items-center gap-2">
            {tg.running
              ? <Badge variant="secondary" className="font-normal">Connected{tg.username ? ` · @${tg.username}` : ''}</Badge>
              : <Badge variant="secondary" className="font-normal">Not connected</Badge>}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (tg.running) { await window.cth.telegramStop(); }
                else { await setTgCfg({ enabled: true }); await window.cth.telegramStart(); }
                setTg(await window.cth.telegramStatus());
              }}
            >
              {tg.running ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
        </ActionRow>
        <TextRow
          id="set-telegram-token"
          label="Bot token"
          help="From @BotFather."
          type="password"
          monospace
          value={config.telegramBotToken ?? ''}
          placeholder="123456:ABC-DEF…"
          onCommit={(v) => setTgCfg({ botToken: v.trim() })}
        />
        <TextRow
          id="set-telegram-chat"
          label="Allowed chat id"
          help="Required. Only this chat may drive Office."
          monospace
          value={config.telegramChatId ?? ''}
          placeholder="123456789"
          onCommit={(v) => setTgCfg({ chatId: v.trim() })}
        />
      </Group>
    </div>
  );
}
