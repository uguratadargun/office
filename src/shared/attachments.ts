/**
 * What a composer stages before sending, and how it becomes the queued text.
 *
 * Files and images never travel as bytes. They travel as ABSOLUTE PATHS in the
 * message body, under an "Attached files:" heading — the same convention the
 * Slack inbound path uses (useHive.ts) — because the agent on the other end is
 * a Claude CLI that Reads files. That means the queued item needs no new field
 * and the drain needs no new branch: the paths ARE the message.
 *
 * Pure on purpose (`src/shared`): both composers stage attachments the same way
 * — the classic `MessageQueueComposer` and the modern `TerminalQueue` — and a
 * node test can drive the whole model without a renderer, a clipboard or a
 * file picker.
 */

/** A file or image staged on the draft. Travels to the agent as a PATH it Reads. */
export interface Attachment {
  path: string;
  name: string;
}

/**
 * Stage more attachments onto the current list.
 *
 * De-duplicated by path, because all three entry points can name the same file
 * (pick it, then drop it, then paste it) and attaching it twice would tell the
 * agent to read it twice. A path-less entry is dropped: `pathForFile` returns
 * '' for anything the OS did not hand us a real file for (a browser drag, a
 * text/html drop), and an empty path in the body is an instruction to read
 * nothing.
 *
 * Nothing fresh ⇒ the SAME array reference back, so a duplicate drop does not
 * re-render the composer or reset a chip's tooltip.
 */
export function addAttachments(prev: Attachment[], incoming: Attachment[]): Attachment[] {
  const list = prev ?? [];
  const seen = new Set(list.map((a) => a.path));
  const fresh = (incoming ?? []).filter((a) => {
    if (!a || !a.path || seen.has(a.path)) return false;
    // Guard within the incoming batch too — one drop can carry the same file
    // twice, and the `seen` set has not learned about it yet.
    seen.add(a.path);
    return true;
  });
  return fresh.length ? [...list, ...fresh] : list;
}

/** Drop one staged attachment by path. */
export function removeAttachment(prev: Attachment[], path: string): Attachment[] {
  const list = prev ?? [];
  return list.some((a) => a.path === path) ? list.filter((a) => a.path !== path) : list;
}

/**
 * The body that actually gets queued: the typed text, then the paths.
 *
 * An attachment-only message is legal — dragging a screenshot in and pressing
 * send is a complete thought — so the heading stands alone rather than the send
 * being refused. With no attachments the text is returned untouched: a plain
 * message must not grow a trailing block.
 */
export function composeWithAttachments(text: string, attachments: Attachment[]): string {
  const list = attachments ?? [];
  if (!list.length) return text;
  const typed = String(text ?? '').trim();
  const head = typed ? `${text}\n\nAttached files:\n` : 'Attached files:\n';
  return head + list.map((a) => `- ${a.path} (${a.name})`).join('\n');
}

/**
 * What a paste is carrying, so the composer knows which door to open.
 *
 * A screenshot from the OS screenshot tool is a clipboard IMAGE with no path —
 * it only becomes attachable once main writes it to a temp PNG. A file copied
 * in Finder arrives as a real File that already has a path. Text is neither,
 * and must fall through to the textarea untouched: intercepting an ordinary
 * paste is how a composer eats what someone just copied.
 */
export function pasteKind(
  items: { kind: string; type: string }[],
  fileCount: number
): 'image' | 'files' | 'text' {
  if ((items ?? []).some((it) => it && it.kind === 'file' && String(it.type ?? '').startsWith('image/'))) {
    return 'image';
  }
  return fileCount > 0 ? 'files' : 'text';
}
