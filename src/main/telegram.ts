/**
 * Telegram ingestion — remote-control the office from a Telegram chat.
 *
 * Deliberately NOT a second copy of the Slack pipeline. Telegram reuses the
 * whole Slack round-trip (renderer enqueue → god → kanban card → done-summary
 * reply → the bundled `md-slack-reply.cjs` helper) by tagging the transport in
 * the `channel` field that pipeline already carries:
 *
 *   channel    "tg:<chatId>"              — the reply destination
 *   thread_ts  "tg:<chatId>:<messageId>"  — unique per request (dedup/ledger key)
 *
 * `parseTelegramTarget` is the single discriminator: anything that parses is a
 * Telegram destination, anything else is a Slack channel. index.ts's `postReply`
 * dispatches on it, so every existing reply path works for Telegram unchanged.
 *
 * Transport is long-polling `getUpdates` over plain `node:https` — no webhook,
 * no public URL, no npm dependency. See `TelegramPoller`.
 *
 * humanQA MIRROR (MD-58): an open ask on a blocked card is posted here as one
 * plain-text message and the human's REPLY to it writes the answer back — the
 * matching and the card transforms are pure, in @shared/humanQa, shared with the
 * ASK ME board so both front doors close the same entry the same way.
 *
 * SECURITY:
 *   - the bot token lives in main's config, is passed only as a URL path
 *     segment to api.telegram.org, and is NEVER logged (error paths log the
 *     message, never the request URL);
 *   - every update whose `chat.id` is not the configured allowed id is dropped
 *     in `filterUpdates` before anything else looks at it — one chat, one human;
 *   - message text is data: it is forwarded verbatim as a card title / god
 *     instruction and is never interpolated into a shell command here.
 */
import { request as httpsRequest } from 'node:https';

/** One accepted Telegram message, already mapped onto the Slack-shaped coords
 *  the rest of the app speaks. */
export interface TelegramInboundMessage {
  text: string;
  /** "tg:<chatId>" — the reply destination. */
  channel: string;
  /** "tg:<chatId>:<messageId>" — unique per request. */
  thread_ts: string;
  /** message_id this is a REPLY to, when the human replied to an earlier bot
   *  message. Present only for replies; main matches it against a mirrored
   *  humanQA ask (see @shared/humanQa) and falls through to normal god routing
   *  when it matches nothing. */
  replyToMessageId?: number;
}

/** A Telegram destination decoded from a `channel`/`thread_ts` string. */
export interface TelegramTarget {
  chatId: string;
  /** Present only when decoded from a thread_ts; used for `reply_to_message_id`. */
  messageId?: number;
}

/** Shape of the bits of a `getUpdates` result we care about. Everything else
 *  Telegram sends (edits, joins, photos, …) is ignored by construction. */
export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string };
    /** Set when the human used Telegram's reply-to on an earlier message. */
    reply_to_message?: { message_id?: number };
  };
}

/** Build the `channel` handle for a chat. */
export function telegramChannel(chatId: string | number): string {
  return `tg:${chatId}`;
}

/**
 * Decode a Telegram destination from a `channel` or `thread_ts` handle.
 * Returns null for anything that is not one (i.e. a real Slack channel) — this
 * is the ONLY thing that decides which service a reply is routed to.
 */
export function parseTelegramTarget(handle: string | undefined | null): TelegramTarget | null {
  if (typeof handle !== 'string' || !handle.startsWith('tg:')) return null;
  const [chatId, msg] = handle.slice(3).split(':');
  if (!chatId) return null;
  const messageId = msg !== undefined ? Number(msg) : NaN;
  return Number.isFinite(messageId) ? { chatId, messageId } : { chatId };
}

/**
 * The whole inbound decision, pure: allowlist, text extraction, offset advance.
 *
 * `nextOffset` is `max(update_id) + 1` over EVERY update seen — including the
 * ones dropped by the allowlist — so a stranger's message is acknowledged to
 * Telegram and never re-delivered, but is never forwarded either.
 */
export function filterUpdates(
  updates: TelegramUpdate[] | undefined | null,
  allowedChatId: string,
  offset: number
): { messages: TelegramInboundMessage[]; nextOffset: number } {
  const messages: TelegramInboundMessage[] = [];
  let nextOffset = offset;
  const allowed = String(allowedChatId ?? '').trim();
  for (const u of Array.isArray(updates) ? updates : []) {
    if (typeof u?.update_id === 'number' && u.update_id >= nextOffset) nextOffset = u.update_id + 1;
    const m = u?.message;
    const chatId = m?.chat?.id;
    if (chatId === undefined || chatId === null) continue;
    // SECURITY: the allowlist is the gate. No allowed id configured ⇒ nothing
    // is ever accepted (fail closed), and a mismatch is dropped silently.
    if (!allowed || String(chatId) !== allowed) continue;
    const text = typeof m?.text === 'string' ? m.text.trim() : '';
    if (!text) continue; // text-only: no attachments, no commands, no media
    const messageId = typeof m?.message_id === 'number' ? m.message_id : 0;
    const msg: TelegramInboundMessage = {
      text,
      channel: telegramChannel(chatId),
      thread_ts: `tg:${chatId}:${messageId}`
    };
    const replyTo = m?.reply_to_message?.message_id;
    if (typeof replyTo === 'number') msg.replyToMessageId = replyTo;
    messages.push(msg);
  }
  return { messages, nextOffset };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One Bot API call over plain https. The token is a path segment and is never
 *  logged — callers only ever see `{ ok, error }`. */
function callBotApi(
  botToken: string,
  method: string,
  body: unknown,
  timeoutMs: number
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return new Promise((resolve) => {
    if (!botToken) { resolve({ ok: false, error: 'missing bot token' }); return; }
    const payload = JSON.stringify(body ?? {});
    const req = httpsRequest({
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/${method}`,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as
            { ok?: boolean; result?: unknown; description?: string };
          resolve({ ok: json.ok === true, result: json.result, error: json.description });
        } catch { resolve({ ok: false, error: 'bad response from Telegram' }); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ ok: false, error: errMsg(e) }));
    req.write(payload);
    req.end();
  });
}

/** Telegram `sendMessage`. Plain text, no `parse_mode`: agent replies are
 *  Slack-mrkdwn and Telegram would 400 on unbalanced markup, which would lose
 *  the answer entirely. `reply_to_message_id` nests the answer under the
 *  request when we know it, and degrades to a plain chat message otherwise. */
export function sendTelegramMessage(opts: {
  botToken: string;
  chatId: string;
  text: string;
  replyToMessageId?: number;
}): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  if (!opts.chatId?.trim() || !opts.text?.trim()) {
    return Promise.resolve({ ok: false, error: 'missing chat or text' });
  }
  const body: Record<string, unknown> = {
    chat_id: opts.chatId,
    // Telegram hard-caps a message at 4096 chars; over that it 400s.
    text: opts.text.length > 4000 ? `${opts.text.slice(0, 3999)}…` : opts.text
  };
  if (opts.replyToMessageId) {
    body.reply_to_message_id = opts.replyToMessageId;
    body.allow_sending_without_reply = true; // the original may have been deleted
  }
  return callBotApi(opts.botToken, 'sendMessage', body, 15_000).then((r) => {
    // The id of the message we just posted: the handle a humanQA ask is mapped
    // to, so the human's reply to it can be matched back.
    const messageId = (r.result as { message_id?: number } | undefined)?.message_id;
    return typeof messageId === 'number'
      ? { ok: r.ok, messageId, error: r.error }
      : { ok: r.ok, error: r.error };
  });
}

/** Telegram API errors that will never succeed on retry for this config. */
export const TERMINAL_TELEGRAM_ERRORS = [
  'Unauthorized', 'Forbidden', 'chat not found', 'bot was blocked', 'bot was kicked'
];

/** True when a Telegram error description is permanent for this config. */
export function isTerminalTelegramError(error: string | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return TERMINAL_TELEGRAM_ERRORS.some((t) => e.includes(t.toLowerCase()));
}

/** Long-poll timeout handed to Telegram; the socket gets a little more. */
const POLL_TIMEOUT_SECONDS = 25;
/** Backoff after a failed poll, so a bad token / dead network doesn't spin. */
const POLL_ERROR_BACKOFF_MS = 5_000;

/**
 * Long-polling `getUpdates` loop. One instance per running integration; `stop()`
 * makes it exit after the in-flight request settles (there is no way to cancel a
 * long poll mid-flight, and letting it finish is harmless).
 */
export class TelegramPoller {
  private readonly botToken: string;
  private readonly allowedChatId: string;
  private readonly onMessage: (m: TelegramInboundMessage) => void | Promise<void>;
  private running = false;
  private offset = 0;

  constructor(opts: {
    botToken: string;
    allowedChatId: string;
    onMessage: (m: TelegramInboundMessage) => void | Promise<void>;
  }) {
    this.botToken = opts.botToken;
    this.allowedChatId = String(opts.allowedChatId ?? '').trim();
    this.onMessage = opts.onMessage;
  }

  /** Verify the credentials with `getMe`, then start the loop. Resolves the bot's
   *  username on success so Settings can show what it connected as. */
  async start(): Promise<{ ok: boolean; username?: string; error?: string }> {
    if (this.running) return { ok: false, error: 'already running' };
    if (!this.botToken) return { ok: false, error: 'missing bot token' };
    if (!this.allowedChatId) return { ok: false, error: 'missing allowed chat id' };
    const me = await callBotApi(this.botToken, 'getMe', {}, 15_000);
    if (!me.ok) return { ok: false, error: me.error ?? 'could not reach Telegram' };
    this.running = true;
    void this.loop();
    const username = (me.result as { username?: string } | undefined)?.username;
    return { ok: true, username };
  }

  /** Stop after the in-flight poll settles. Idempotent. */
  stop(): void {
    this.running = false;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const res = await callBotApi(
        this.botToken,
        'getUpdates',
        { offset: this.offset, timeout: POLL_TIMEOUT_SECONDS, allowed_updates: ['message'] },
        (POLL_TIMEOUT_SECONDS + 10) * 1000
      );
      if (!this.running) return;
      if (!res.ok) {
        // NEVER log the request URL (it carries the token) — the description only.
        console.error('[telegram] getUpdates failed:', res.error);
        if (isTerminalTelegramError(res.error)) { this.running = false; return; }
        await new Promise((r) => setTimeout(r, POLL_ERROR_BACKOFF_MS));
        continue;
      }
      const { messages, nextOffset } = filterUpdates(
        res.result as TelegramUpdate[], this.allowedChatId, this.offset
      );
      this.offset = nextOffset;
      for (const m of messages) {
        try { await this.onMessage(m); } catch { /* delivery is best-effort */ }
      }
    }
  }
}
