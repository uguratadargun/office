#!/usr/bin/env node
/**
 * hivectl — one CLI for the bookkeeping every agent on this floor does by hand.
 *
 * Reading mail, sending mail, moving a card and integrating a branch were four
 * hand-written recipes, each re-derived per agent from PROTOCOL.md and board.md.
 * That is fine once and expensive forever: the recipes drifted, and a mistyped
 * one writes into ANOTHER agent's folder or clears a card's assignee — both of
 * which have happened. This is the recipe, written down and executable.
 *
 *   hivectl inbox [--agent <id>] [--keep]
 *       Print every message in an inbox compactly and move it to inbox/.done.
 *       --keep prints without moving (a peek). Defaults to $AGENT_ID.
 *
 *   hivectl send --to <id|god|broadcast> --act <act> --subject <s>
 *                (--body <text> | --body-file <path>)
 *                [--reply-to <msg-id>] [--conversation <id>] [--requires-reply]
 *       Write ONE valid message into your OWN outbox. Never another agent's —
 *       the orchestrator delivers it (PROTOCOL.md, "Sending a message").
 *
 *   hivectl card <MD-nnn> [--status <todo|doing|blocked|done>] [--assignee <id>]
 *                         [--result-file <path>] [--note <text>] [--branch <b>]
 *       Edit hive/tasks.json atomically. An absent flag changes nothing, and
 *       `assignee` is never cleared — "assignee is never cleared" is standing
 *       rule 1, and a full-file rewrite is exactly how it got cleared before.
 *
 *   hivectl merge <branch> [--no-build] [--keep-scratch]
 *       God's integration recipe: a scratch worktree DETACHED from origin/main,
 *       merge --no-ff, resolve ONLY CHANGELOG.md/package.json, typecheck +
 *       test:focused + build, one summary line. It never touches the human's
 *       checkout and it never pushes.
 *
 * Paths: $HIVE_ROOT for the hive, --repo / $HIVECTL_REPO for the checkout.
 * Run it through hive/bin/hive-node (the Electron-as-node shim) like every other
 * helper on this floor.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** The checkout hivectl integrates into, when nothing overrides it. Mirrors the
 *  path hive/bin/hive-node already hard-codes for its Electron binary. */
const DEFAULT_REPO = '/Users/ugur/Projects/munder-difflin';
/** Where `merge` builds its throwaway worktree. Under the hive's worktrees dir,
 *  never inside the repo — an untracked dir in a shared checkout got swept once. */
const DEFAULT_SCRATCH = '/Users/ugur/HarnessAgents/worktrees/god-scratch';

/** The message verbs PROTOCOL.md defines. Anything else is a typo, and a typo in
 *  `act` is silent: the router delivers it and the recipient never replies. */
const ACTS = ['request', 'inform', 'propose', 'query', 'agree', 'refuse', 'done'];
/** Verbs that EXPECT a reply. `inform`/`done` are terminal — replying to one is
 *  how two agents loop forever. */
const REPLY_ACTS = ['request', 'query', 'propose'];
/** The kanban columns in tasks.json. */
const STATUSES = ['todo', 'doing', 'blocked', 'done'];
/** The Keep a Changelog sections, in the order the repo's shape test demands. */
const SECTION_ORDER = ['Added', 'Changed', 'Fixed', 'Removed'];

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers. Everything below this line is deterministic and has a test in
// test/hivectl.test.cjs — the parts that decide what gets written are exactly
// the parts worth pinning.
// ─────────────────────────────────────────────────────────────────────────────

/** Parse `--key value` and `--key=value` pairs from argv; a flag with no value
 *  is `true`. Positional arguments collect into `_`. Same shape as
 *  resources/md-slack-reply.cjs, deliberately — one parser to learn. */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

/**
 * Validate and shape ONE outbox message. Throws with the offending field named,
 * because the alternative — a half-valid JSON file the router silently drops —
 * looks exactly like a message that was delivered and ignored.
 *
 * `id`, `from` and the timestamps are the harness's to fill in, so they are
 * deliberately absent here.
 */
function buildMessage(a) {
  const need = (k, v) => {
    if (typeof v !== 'string' || !v.trim()) throw new Error(`send: --${k} is required`);
    return v.trim();
  };
  const act = need('act', a.act);
  if (!ACTS.includes(act)) throw new Error(`send: --act "${act}" is not one of ${ACTS.join('/')}`);
  const msg = {
    to: need('to', a.to),
    act,
    subject: need('subject', a.subject),
    body: need('body', a.body)
  };
  if (a.conversation) msg.conversation = String(a.conversation).trim();
  if (a.replyTo) msg.in_reply_to = String(a.replyTo).trim();
  // Only ask for a reply with a verb that can carry one — `requires_reply` on an
  // `inform` is a request the recipient is told not to answer.
  if (a.requiresReply) {
    if (!REPLY_ACTS.includes(act)) {
      throw new Error(`send: --requires-reply needs act ${REPLY_ACTS.join('/')}, not "${act}"`);
    }
    msg.requires_reply = true;
  }
  return msg;
}

/**
 * Apply one card edit to a parsed tasks.json, returning the NEW document and the
 * list of fields that actually moved.
 *
 * The rule that matters: an absent flag changes nothing, and `assignee` is never
 * cleared. Standing rule 1 says the assignee survives dispatch to done, and the
 * way it got cleared was a rewrite that wrote back every field it knew about,
 * including the ones it had no opinion on.
 */
function applyCardEdit(doc, id, edits) {
  const tasks = Array.isArray(doc) ? doc : doc && doc.tasks;
  if (!Array.isArray(tasks)) throw new Error('card: tasks.json has no tasks array');
  const i = tasks.findIndex((t) => t && t.id === id);
  if (i === -1) throw new Error(`card: no card ${id} in tasks.json`);

  const changed = [];
  const card = { ...tasks[i] };
  const set = (field, value) => {
    if (value === undefined || value === null || value === '' || value === true) return;
    const v = String(value);
    if (card[field] === v) return;
    card[field] = v;
    changed.push(field);
  };

  if (edits.status !== undefined && edits.status !== '' && edits.status !== true) {
    const s = String(edits.status);
    if (!STATUSES.includes(s)) throw new Error(`card: --status "${s}" is not one of ${STATUSES.join('/')}`);
    set('status', s);
  }
  // Never a clear: an empty --assignee is a no-op, not "unassign".
  set('assignee', edits.assignee);
  set('result', edits.result);
  set('branch', edits.branch);
  set('note', edits.note);

  const next = tasks.slice();
  next[i] = card;
  const outDoc = Array.isArray(doc) ? next : { ...doc, tasks: next };
  return { doc: outDoc, card, changed };
}

/**
 * Replace every git conflict hunk with BOTH sides, ours first.
 *
 * For a changelog that is the correct resolution and picking a side never is:
 * both branches wrote entries a human needs, and whichever side loses, the loss
 * is silent. Handles diff3 output too (the `|||||||` base section is dropped —
 * it is the common ancestor, already represented in both sides).
 */
function unionConflicts(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) { out.push(lines[i++]); continue; }
    i++;                                   // past <<<<<<<
    const ours = [];
    while (i < lines.length && !/^(\|\|\|\|\|\|\||=======)/.test(lines[i])) ours.push(lines[i++]);
    if (i < lines.length && lines[i].startsWith('|||||||')) {   // diff3 base — drop it
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) i++;
    }
    i++;                                   // past =======
    const theirs = [];
    while (i < lines.length && !lines[i].startsWith('>>>>>>>')) theirs.push(lines[i++]);
    i++;                                   // past >>>>>>>
    out.push(...ours, ...theirs);
  }
  return out.join('\n');
}

/**
 * Fold a changelog so each release block carries each `### ` section ONCE, in
 * the agreed order.
 *
 * A union merge leaves `### Fixed` twice in `[Unreleased]` — both entries are
 * right, the shape is wrong, and test/changelog-shape.test.cjs fails on exactly
 * that. Duplicate bodies are concatenated and identical lines dropped, so the
 * same bullet arriving from both sides appears once.
 */
function foldChangelog(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  // Preamble: everything before the first release heading, verbatim.
  while (i < lines.length && !lines[i].startsWith('## ')) out.push(lines[i++]);

  while (i < lines.length) {
    const heading = lines[i++];
    const raw = [];                         // the block verbatim, for the untouched case
    const loose = [];                       // lines between `## ` and the first `### `
    const order = [];                       // section names, first-seen
    const seen = [];                        // EVERY `### ` seen, repeats included
    const bodies = new Map();               // name → lines
    for (let j = i; j < lines.length && !lines[j].startsWith('## '); j++) raw.push(lines[j]);
    while (i < lines.length && !lines[i].startsWith('## ')) {
      if (lines[i].startsWith('### ')) {
        const name = lines[i].slice(4).trim();
        seen.push(name);
        if (!bodies.has(name)) { bodies.set(name, []); order.push(name); }
        i++;
        while (i < lines.length && !lines[i].startsWith('## ') && !lines[i].startsWith('### ')) {
          bodies.get(name).push(lines[i++]);
        }
      } else {
        loose.push(lines[i++]);
      }
    }
    // A block that is ALREADY well-formed is emitted byte-for-byte. Reflowing it
    // would rewrite years of shipped release notes on every merge — 157 lines of
    // pure churn in the first run of this — and bury the entries that changed.
    // ...and carries no bullet twice. A union merge can leave the SAME line in a
    // single section from both sides, which is well-shaped but still a duplicate.
    // Blank lines are NOT a repeat — two of them at EOF are punctuation, and
    // counting them sent every well-formed file down the reflow path.
    const duped = [...bodies.values()].some(hasRepeatedLine);
    if (isWellFormed(seen) && !duped) {
      out.push(heading, ...raw);
      continue;
    }
    // Known sections first, in the agreed order; anything else keeps its place
    // after them rather than being dropped or reordered arbitrarily.
    const known = SECTION_ORDER.filter((n) => bodies.has(n));
    const rest = order.filter((n) => !SECTION_ORDER.includes(n));

    out.push(heading, '');
    const looseBody = trimBlanks(loose);
    if (looseBody.length) out.push(...looseBody, '');
    for (const name of [...known, ...rest]) {
      out.push(`### ${name}`);
      const body = trimBlanks(dedupeLines(bodies.get(name)));
      if (body.length) out.push(...body);
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}$/, '\n');
}

/** True when a release block's sections are already unique and in the agreed
 *  order — i.e. the fold has nothing to do and must not touch it. Unknown
 *  section names never make a block ill-formed; they are simply not ranked. */
function isWellFormed(order) {
  if (new Set(order).size !== order.length) return false;
  const ranks = order.filter((n) => SECTION_ORDER.includes(n)).map((n) => SECTION_ORDER.indexOf(n));
  return ranks.every((r, k) => k === 0 || ranks[k - 1] < r);
}

/** True when a section body carries the same NON-BLANK line twice. */
function hasRepeatedLine(body) {
  const seen = new Set();
  for (const l of body) {
    if (!l.trim()) continue;
    if (seen.has(l)) return true;
    seen.add(l);
  }
  return false;
}

/** Drop leading/trailing blank lines (the joins add their own). */
function trimBlanks(lines) {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

/** Drop repeats of an identical non-blank line, keeping the first. Two blank
 *  lines in a row also collapse — the folding already spaces the sections. */
function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    if (!l.trim()) { if (out.length && !out[out.length - 1].trim()) continue; out.push(l); continue; }
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(l);
  }
  return out;
}

/** Split a `node --test test/a.cjs test/b.cjs` script into its prefix and file
 *  list. The prefix is every token before the first path-looking one, so a
 *  future `--test-concurrency=1` survives the round trip. */
function parseFocused(cmd) {
  const tok = String(cmd).trim().split(/\s+/).filter(Boolean);
  const at = tok.findIndex((t) => t.endsWith('.cjs') || t.endsWith('.mjs') || t.endsWith('.js'));
  if (at === -1) return { prefix: tok.join(' '), files: [] };
  return { prefix: tok.slice(0, at).join(' '), files: tok.slice(at) };
}

/**
 * Merge two `test:focused` scripts: the UNION of their files, minus any that no
 * longer exist.
 *
 * Union because both sides registered a test and dropping either is how a fix
 * ships with its test silently unregistered. Minus the missing ones because a
 * branch that renamed or deleted a test file leaves the other side's entry
 * pointing at nothing, and `node --test` on a missing path fails the whole run.
 */
function mergeFocused(oursCmd, theirsCmd, exists) {
  const ours = parseFocused(oursCmd);
  const theirs = parseFocused(theirsCmd);
  const seen = new Set();
  const files = [];
  for (const f of [...ours.files, ...theirs.files]) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (exists(f)) files.push(f);
  }
  return [ours.prefix || theirs.prefix, ...files].join(' ');
}

/**
 * Resolve a conflicted package.json from both sides.
 *
 * `test:focused` is unioned (see mergeFocused). Every other map entry present on
 * only one side is kept; anything genuinely CONTRADICTORY — a version bump, a
 * dependency pinned two ways — keeps OURS (origin/main) and is reported, because
 * a silent auto-pick of a version number is a decision, not a merge.
 */
function resolvePackageJson(oursText, theirsText, exists) {
  const ours = JSON.parse(oursText);
  const theirs = JSON.parse(theirsText);
  const warnings = [];
  const out = { ...ours };

  const MAPS = ['scripts', 'dependencies', 'devDependencies', 'optionalDependencies'];
  for (const key of MAPS) {
    if (!theirs[key]) continue;
    const merged = { ...(ours[key] || {}) };
    for (const [k, v] of Object.entries(theirs[key])) {
      if (!(k in merged)) { merged[k] = v; continue; }
      if (merged[k] === v) continue;
      if (key === 'scripts' && k === 'test:focused') { merged[k] = mergeFocused(merged[k], v, exists); continue; }
      warnings.push(`${key}.${k} differs — kept ours`);
    }
    out[key] = merged;
  }
  for (const [k, v] of Object.entries(theirs)) {
    if (MAPS.includes(k)) continue;
    if (!(k in out)) { out[k] = v; continue; }
    if (JSON.stringify(out[k]) !== JSON.stringify(v)) warnings.push(`${k} differs — kept ours`);
  }
  return { text: JSON.stringify(out, null, 2) + '\n', warnings };
}

/** Pull `# pass N` / `# fail N` out of a `node --test` run. */
function parseTestTotals(stdout) {
  const n = (re) => { const m = re.exec(stdout); return m ? Number(m[1]) : null; };
  return { pass: n(/^# pass (\d+)$/m), fail: n(/^# fail (\d+)$/m) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filesystem + git. Everything below touches the world.
// ─────────────────────────────────────────────────────────────────────────────

function fail(msg) {
  process.stderr.write(`hivectl: ${msg}\n`);
  process.exit(1);
}

function hiveRoot(args) {
  const root = args.hive || process.env.HIVE_ROOT;
  if (!root) fail('no hive root — set $HIVE_ROOT or pass --hive <path>');
  if (!fs.existsSync(root)) fail(`hive root not found: ${root}`);
  return root;
}

function selfId(args) {
  const id = args.agent || process.env.AGENT_ID;
  if (!id) fail('no agent id — set $AGENT_ID or pass --agent <id>');
  return String(id);
}

/** Write via a temp sibling + rename, so a reader never sees a half file and a
 *  crash mid-write cannot leave tasks.json unparseable. */
function atomicWrite(file, text) {
  const tmp = `${file}.hivectl-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function run(cmd, argv, cwd, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function git(cwd, ...argv) {
  const r = run('git', argv, cwd);
  if (r.code !== 0) throw new Error(`git ${argv.join(' ')} failed:\n${r.out.trim()}`);
  return r.out.trim();
}

// ── inbox ───────────────────────────────────────────────────────────────────

function cmdInbox(args) {
  const root = hiveRoot(args);
  const id = selfId(args);
  const dir = path.join(root, 'agents', id, 'inbox');
  if (!fs.existsSync(dir)) fail(`no inbox at ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) { process.stdout.write(`hivectl: ${id} inbox is empty\n`); return; }

  const done = path.join(dir, '.done');
  if (!args.keep) fs.mkdirSync(done, { recursive: true });
  for (const f of files) {
    const p = path.join(dir, f);
    let m;
    try { m = JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (e) { process.stdout.write(`\n── ${f}  [UNPARSEABLE: ${e.message}]\n`); continue; }
    const flag = m.requires_reply ? '  requires-reply' : '';
    process.stdout.write(
      `\n── ${m.id || f}  from ${m.from || '?'}  act:${m.act || '?'}${flag}` +
      `${m.conversation ? `  conv:${m.conversation}` : ''}${m.created_at ? `  ${m.created_at}` : ''}\n` +
      `   ${m.subject || '(no subject)'}\n\n${m.body || ''}\n`
    );
    if (!args.keep) fs.renameSync(p, path.join(done, f));
  }
  process.stdout.write(
    `\nhivectl: ${files.length} message(s)${args.keep ? ' (kept — --keep)' : ' → inbox/.done'}\n`
  );
}

// ── send ────────────────────────────────────────────────────────────────────

function cmdSend(args) {
  const root = hiveRoot(args);
  const id = selfId(args);
  let body = args.body;
  if (args['body-file']) {
    const p = String(args['body-file']);
    if (!fs.existsSync(p)) fail(`--body-file not found: ${p}`);
    body = fs.readFileSync(p, 'utf8');
  }
  let msg;
  try {
    msg = buildMessage({
      to: args.to, act: args.act, subject: args.subject, body,
      conversation: args.conversation, replyTo: args['reply-to'],
      requiresReply: args['requires-reply'] === true || args['requires-reply'] === 'true'
    });
  } catch (e) { fail(e.message); }

  // Your OWN outbox, always. Writing into another agent's folder is the one
  // thing PROTOCOL.md forbids outright — every file here is single-writer.
  const outbox = path.join(root, 'agents', id, 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = msg.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const file = path.join(outbox, `${stamp}-${slug || 'msg'}.json`);
  atomicWrite(file, JSON.stringify(msg, null, 2) + '\n');
  process.stdout.write(`hivectl: queued ${msg.act} → ${msg.to}  ${file}\n`);
}

// ── card ────────────────────────────────────────────────────────────────────

function cmdCard(args) {
  const root = hiveRoot(args);
  const id = args._[0];
  if (!id) fail('card: needs a card id, e.g. `hivectl card MD-169 --status done`');
  const file = path.join(root, 'tasks.json');
  if (!fs.existsSync(file)) fail(`no tasks.json at ${file}`);

  let result = args.result;
  if (args['result-file']) {
    const p = String(args['result-file']);
    if (!fs.existsSync(p)) fail(`--result-file not found: ${p}`);
    result = fs.readFileSync(p, 'utf8').trim();
  }

  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { fail(`tasks.json is unparseable: ${e.message}`); }

  let edit;
  try {
    edit = applyCardEdit(doc, id, {
      status: args.status, assignee: args.assignee, result, note: args.note, branch: args.branch
    });
  } catch (e) { fail(e.message); }

  if (!edit.changed.length) {
    process.stdout.write(`hivectl: ${id} unchanged (status ${edit.card.status}, assignee ${edit.card.assignee || '—'})\n`);
    return;
  }
  atomicWrite(file, JSON.stringify(edit.doc, null, 2) + '\n');
  process.stdout.write(
    `hivectl: ${id} ${edit.changed.join(', ')} updated — status ${edit.card.status}, assignee ${edit.card.assignee || '—'}\n`
  );
}

// ── merge ───────────────────────────────────────────────────────────────────

/** The only two files this recipe is allowed to resolve on its own. Anything
 *  else conflicting is a real disagreement about code and stops the merge. */
const AUTO_RESOLVE = new Set(['CHANGELOG.md', 'package.json']);

function cmdMerge(args) {
  const branch = args._[0];
  if (!branch) fail('merge: needs a branch, e.g. `hivectl merge feat/hivectl`');
  const repo = args.repo || process.env.HIVECTL_REPO || DEFAULT_REPO;
  const scratch = args.scratch || DEFAULT_SCRATCH;
  if (!fs.existsSync(path.join(repo, '.git'))) fail(`--repo is not a checkout: ${repo}`);

  const notes = [];
  try {
    git(repo, 'rev-parse', '--verify', `${branch}^{commit}`);
  } catch { fail(`merge: no such branch: ${branch}`); }

  // origin/main is the integration target, so make sure it is current. `fetch`
  // moves no HEAD and touches no index — the human's checkout is untouched by it.
  try { git(repo, 'fetch', '--quiet', 'origin', 'main'); }
  catch (e) { notes.push('fetch failed — using the origin/main already on disk'); void e; }

  // A leftover scratch from an earlier run is a stale tree, never a head start.
  if (fs.existsSync(scratch)) {
    try { git(repo, 'worktree', 'remove', '--force', scratch); }
    catch { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
  try { git(repo, 'worktree', 'prune'); } catch { /* nothing to prune */ }
  git(repo, 'worktree', 'add', '--detach', scratch, 'origin/main');

  // node_modules is 1 GB of the same bytes; symlink it so typecheck/test/build
  // can run at all without a per-merge install.
  const mods = path.join(scratch, 'node_modules');
  if (!fs.existsSync(mods)) {
    try { fs.symlinkSync(path.join(repo, 'node_modules'), mods, 'dir'); }
    catch (e) { notes.push(`node_modules symlink failed (${e.code || e.message})`); }
  }

  const cleanup = (why) => {
    if (args['keep-scratch']) return;
    try { git(repo, 'worktree', 'remove', '--force', scratch); } catch { /* leave it */ }
    void why;
  };

  const base = git(scratch, 'rev-parse', '--short', 'HEAD');
  const merged = run('git', ['merge', '--no-ff', '--no-edit', branch], scratch);
  let resolved = [];
  if (merged.code !== 0) {
    const conflicts = git(scratch, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    const unhandled = conflicts.filter((f) => !AUTO_RESOLVE.has(f));
    if (!conflicts.length || unhandled.length) {
      try { git(scratch, 'merge', '--abort'); } catch { /* nothing to abort */ }
      cleanup('unresolvable');
      fail(
        `merge ${branch} → CONFLICT in ${(unhandled.length ? unhandled : ['(none reported)']).join(', ')}` +
        ` — only ${[...AUTO_RESOLVE].join('/')} are auto-resolved; merge aborted, nothing changed.`
      );
    }
    for (const f of conflicts) {
      const full = path.join(scratch, f);
      if (f === 'CHANGELOG.md') {
        // Both sides' entries, then folded back into one set of sections.
        atomicWrite(full, foldChangelog(unionConflicts(fs.readFileSync(full, 'utf8'))));
      } else {
        // JSON with conflict markers is not parseable, so take the two staged
        // sides straight from the index instead of the marked-up worktree file.
        const ours = git(scratch, 'show', ':2:package.json');
        const theirs = git(scratch, 'show', ':3:package.json');
        const r = resolvePackageJson(ours, theirs, (rel) => fs.existsSync(path.join(scratch, rel)));
        atomicWrite(full, r.text);
        notes.push(...r.warnings);
      }
      git(scratch, 'add', f);
      resolved.push(f);
    }
    git(scratch, 'commit', '--no-edit');
  }

  const head = git(scratch, 'rev-parse', '--short', 'HEAD');
  const stat = git(scratch, 'diff', '--shortstat', `${base}..HEAD`) || 'no file change';

  const steps = [];
  const typecheck = run('npm', ['run', 'typecheck'], scratch);
  steps.push(`typecheck ${typecheck.code === 0 ? 'ok' : 'FAILED'}`);
  const tests = run('npm', ['run', 'test:focused'], scratch);
  const totals = parseTestTotals(tests.out);
  steps.push(tests.code === 0
    ? `test:focused ${totals.pass ?? '?'}/${(totals.pass ?? 0) + (totals.fail ?? 0)}`
    : `test:focused FAILED (${totals.fail ?? '?'} failing)`);
  let build = { code: 0 };
  if (args['no-build']) steps.push('build skipped');
  else {
    build = run('npm', ['run', 'build'], scratch);
    steps.push(`build ${build.code === 0 ? 'ok' : 'FAILED'}`);
  }

  const ok = typecheck.code === 0 && tests.code === 0 && build.code === 0;
  if (!ok) {
    // The failing output is the whole point of running these — print it, then
    // KEEP the worktree so the failure can be reproduced in place.
    const failed = typecheck.code !== 0 ? typecheck : (tests.code !== 0 ? tests : build);
    process.stderr.write(`\n--- failing step (tail) ---\n${failed.out.slice(-4000)}\n---\n`);
  }
  if (ok) cleanup('done');

  process.stdout.write(
    `hivectl merge ${branch} → ${ok ? 'OK' : 'FAILED'} ${head} onto origin/main@${base}` +
    ` · ${stat.replace(/^\s+/, '')}` +
    `${resolved.length ? ` · resolved ${resolved.join('+')}` : ''}` +
    ` · ${steps.join(' · ')}` +
    `${notes.length ? ` · notes: ${notes.join('; ')}` : ''}` +
    ` · not pushed · ${ok && !args['keep-scratch'] ? 'scratch removed' : `scratch ${scratch}`}\n`
  );
  process.exit(ok ? 0 : 1);
}

// ── entry point ─────────────────────────────────────────────────────────────

const USAGE = `hivectl <command> [flags]

  inbox [--agent <id>] [--keep]            print + drain your inbox
  send  --to <id|god|broadcast> --act <${ACTS.join('|')}>
        --subject <s> (--body <t> | --body-file <p>)
        [--reply-to <id>] [--conversation <id>] [--requires-reply]
  card  <MD-nnn> [--status <${STATUSES.join('|')}>] [--assignee <id>]
        [--branch <b>] [--result-file <p>] [--note <t>]
  merge <branch> [--no-build] [--keep-scratch] [--repo <p>] [--scratch <p>]
`;

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._.shift();
  switch (cmd) {
    case 'inbox': return cmdInbox(args);
    case 'send': return cmdSend(args);
    case 'card': return cmdCard(args);
    case 'merge': return cmdMerge(args);
    case 'help': case '--help': case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      process.stderr.write(`hivectl: unknown command "${cmd}"\n\n${USAGE}`);
      process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  parseArgs, buildMessage, applyCardEdit,
  unionConflicts, foldChangelog, isWellFormed, hasRepeatedLine, dedupeLines, trimBlanks,
  parseFocused, mergeFocused, resolvePackageJson, parseTestTotals,
  ACTS, REPLY_ACTS, STATUSES, SECTION_ORDER, AUTO_RESOLVE, main
};
