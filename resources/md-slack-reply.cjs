#!/usr/bin/env node
/**
 * md-slack-reply.cjs — post a message back into the chat thread that triggered
 * an office run, WITHOUT ever handling any bot token.
 *
 * Works for BOTH surfaces: a Slack channel id replies in Slack, a `tg:<chatId>`
 * channel replies in Telegram. Main routes on the channel; nothing here changes.
 *
 * The Office main process runs a loopback-only HTTP endpoint (bound to
 * 127.0.0.1, never tunneled) and writes its `{ port, token }` to a small
 * discovery file under the app's userData dir. This helper reads that file and
 * POSTs the reply to the endpoint, which holds the bot token and forwards to
 * the chat service. The token never appears here, in the prompt, or in any
 * transcript.
 *
 * Usage:
 *   node md-slack-reply.cjs --channel C123 --thread 1700000000.000100 --text "..."
 *   node md-slack-reply.cjs --channel tg:424242 --thread tg:424242:555 --text "..."
 *   (optional) --config /abs/path/to/slack-reply.json
 *
 * ASKING THE HUMAN SOMETHING (MD-143): add `--ask`, and the message is ALSO
 * raised on the ASK ME board as an open question on the thread's card — a
 * question that lives only in a chat thread is one the human is never shown.
 * Optional `--options "a: now|b: after MD-120|c: leave it"` makes the choices
 * clickable there instead of the human retyping a letter.
 *
 *   node md-slack-reply.cjs --channel tg:424242 --thread tg:424242:555 \
 *     --ask --options "a: now|b: after MD-120" --text "Ne zaman deploy edelim?"
 *
 * Without the flag a reply that READS as a question is still picked up, but the
 * flag is the one that does not depend on a heuristic.
 *
 * The discovery file is located via, in order: --config, then the
 * MD_SLACK_REPLY_CONFIG env var (injected into every agent by main).
 */
'use strict';

const fs = require('node:fs');
const http = require('node:http');

/** Parse `--key value` and `--key=value` pairs from argv. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function fail(msg) {
  process.stderr.write(`md-slack-reply: ${msg}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const channel = args.channel;
const thread = args.thread || args.thread_ts;
const text = args.text;

if (!channel || !thread || !text || text === true) {
  fail('required: --channel <id> --thread <ts> --text "<message>"');
}

const configPath = args.config || process.env.MD_SLACK_REPLY_CONFIG;
if (!configPath) {
  fail('cannot locate the reply endpoint: set MD_SLACK_REPLY_CONFIG or pass --config');
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  fail(`reply endpoint not running (could not read ${configPath}): ${e.message}`);
}
if (!cfg || typeof cfg.port !== 'number' || typeof cfg.token !== 'string') {
  fail(`malformed reply config at ${configPath}`);
}

// `--ask` with no value parses to `true`; `--ask=false` is honoured as an
// explicit no. The options string is passed through verbatim — main owns the
// one parser for it (`@shared/outboundAsk`), so the helper cannot disagree with
// the board about what the choices are.
const ask = args.ask === true || args.ask === 'true' || args.ask === '1';
const body = JSON.stringify({
  channel, thread_ts: thread, text,
  ...(ask ? { ask: true } : {}),
  ...(ask && typeof args.options === 'string' && args.options ? { options: args.options } : {})
});
const req = http.request(
  {
    method: 'POST',
    host: '127.0.0.1',
    port: cfg.port,
    path: '/reply',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'x-md-reply-token': cfg.token
    }
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let json = {};
      try { json = JSON.parse(raw); } catch { /* non-JSON body */ }
      if (res.statusCode === 200 && json.ok) {
        process.stdout.write('Posted reply.\n');
        process.exit(0);
      }
      fail(`reply failed (HTTP ${res.statusCode}): ${json.error || raw || 'unknown error'}`);
    });
  }
);
req.on('error', (e) => fail(`could not reach reply endpoint: ${e.message}`));
req.write(body);
req.end();
