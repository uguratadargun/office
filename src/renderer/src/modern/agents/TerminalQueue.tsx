import { useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Paperclip, Pencil, Send, X } from 'lucide-react';
import { useStore, type Agent, type QueuedMessage } from '@/store/store';
import { isProcessless } from '@shared/agentPresence';
import { queueGate } from '@shared/messageQueue';
import {
  addAttachments, composeWithAttachments, pasteKind, removeAttachment,
  type Attachment
} from '@shared/attachments';
import { useDeliveryClock, useDeliveryControl, useTerminalBlock } from '@/hooks/useQueueGates';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { IconButton } from '../components/IconButton';
import { WakeButton } from './WakeButton';

const EMPTY: QueuedMessage[] = [];

/**
 * The terminal's queue, under the terminal — the classic composer's job in this
 * UI (MD-145).
 *
 * You can always type. While the agent is mid-run the message parks here
 * instead of being typed over its work, and the app-wide drain (useHive's flush
 * loop) types it in the moment the terminal is genuinely free — front first,
 * one at a time. That drain is the SAME one the classic UI uses; this is a
 * front-end onto the same store queue, not a second delivery path. An agent
 * with no process keeps its queue too: what you write now is delivered after
 * Wake, through the same loop.
 *
 * Every hold is named rather than left to look like nothing is happening —
 * which one to name — and the sentence naming it — is `queueGate`'s call, in
 * the drain's own gate order.
 */
export function TerminalQueue({ agent }: { agent: Agent }) {
  const queue = useStore((s) => s.messageQueues[agent.id]) ?? EMPTY;
  const enqueueMessage = useStore((s) => s.enqueueMessage);
  const removeQueuedMessage = useStore((s) => s.removeQueuedMessage);
  const releaseQueuedMessage = useStore((s) => s.releaseQueuedMessage);
  const editQueuedMessage = useStore((s) => s.editQueuedMessage);
  const moveQueuedMessage = useStore((s) => s.moveQueuedMessage);
  const clearQueue = useStore((s) => s.clearQueue);

  // The draft lives in the STORE, keyed by agent: switching agents (or tabs, or
  // between the Agents page and the Floor inspector) remounts this, and local
  // state would eat what was typed.
  const text = useStore((s) => s.drafts[agent.id] ?? '');
  const setDraft = useStore((s) => s.setDraft);

  const idle = agent.status === 'idle';
  const asleep = isProcessless(agent);
  const block = useTerminalBlock(agent.ptyId, queue.length > 0 && idle);
  const control = useDeliveryControl(agent.id, queue.length > 0);
  const paused = control.floorPaused;
  const clock = useDeliveryClock(agent.id, queue.length > 0);
  // WHICH gate is reported, and the sentence naming it, are @shared's call in
  // the drain's own order — the cooldown and the boot grace included, which no
  // composer could see before (MD-155).
  const gate = queueGate({
    count: queue.length,
    idle: idle && !asleep,
    name: agent.name,
    hasProcess: !asleep,
    agentPaused: control.agentPaused,
    agentHalted: control.agentHalted,
    floorPaused: paused,
    frontManual: queue[0]?.manual,
    bootGraceMsLeft: clock.bootGraceMs,
    block,
    cooldownMsLeft: clock.cooldownMs
  });

  // Files/images staged for the NEXT message only. Component-local on purpose:
  // the draft persists per agent in the store, attachments deliberately do not
  // follow you to another agent — a path staged for one terminal is rarely the
  // thing you meant to hand the next one.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // A picker or a paste that failed is otherwise invisible: the chip simply
  // never appears and the user cannot tell whether it is slow or broken.
  const [attachError, setAttachError] = useState<string | null>(null);

  function stage(incoming: Attachment[]) {
    setAttachError(null);
    setAttachments((prev) => addAttachments(prev, incoming));
  }

  /** A cancelled picker is a decision, not a failure — say nothing. */
  function reportAttachFailure(error: string) {
    if (error !== 'cancelled') setAttachError(error);
  }

  async function pickFiles() {
    const res = await window.cth.attachFiles();
    if (res.ok) stage(res.files);
    else reportAttachFailure(res.error);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (!dropped.length) return;
    stage(dropped.map((f) => ({ path: window.cth.pathForFile(f), name: f.name })));
  }

  async function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = Array.from(e.clipboardData?.files ?? []);
    const kind = pasteKind(items, files.length);
    if (kind === 'text') return; // ordinary paste — leave it to the textarea
    // Both remaining kinds become attachments, so the characters must not also
    // land in the draft.
    e.preventDefault();
    if (kind === 'image') {
      const res = await window.cth.saveClipboardImage();
      if (res.ok) stage([res.file]);
      else reportAttachFailure(res.error);
      return;
    }
    stage(files.map((f) => ({ path: window.cth.pathForFile(f), name: f.name })));
  }

  // A screenshot on its own is a complete message — do not require typing.
  const canSend = !!text.trim() || attachments.length > 0;

  function queueIt() {
    if (!canSend) return;
    // The paths ARE the message: composed into the body under the convention
    // agents already read, so the queue item needs no new field and the drain
    // needs no new branch.
    enqueueMessage(agent.id, composeWithAttachments(text, attachments));
    setDraft(agent.id, '');
    setAttachments([]);
    setAttachError(null);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => {
        // Only when the cursor leaves the composer itself — entering a child
        // fires dragleave on the parent and would flicker the hint away.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
      className={cn('flex shrink-0 flex-col gap-2 border-t p-3',
        dragOver && 'ring-2 ring-inset ring-primary')}
    >
      {queue.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium">{queue.length} queued</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              · {gate?.label ?? ''}
            </span>
            {queue.length > 1 && (
              <Button variant="ghost" size="xs" onClick={() => clearQueue(agent.id)}>
                Clear all
              </Button>
            )}
          </div>

          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {queue.map((m, i) => (
              <QueueRow
                key={m.id}
                message={m}
                index={i}
                last={i === queue.length - 1}
                paused={paused}
                onSendNow={() => releaseQueuedMessage(agent.id, m.id)}
                onRemove={() => removeQueuedMessage(agent.id, m.id)}
                onEdit={(next) => editQueuedMessage(agent.id, m.id, next)}
                onMove={(delta) => moveQueuedMessage(agent.id, m.id, delta)}
              />
            ))}
          </div>
        </>
      )}

      {dragOver && (
        <span className="text-xs text-muted-foreground">Drop to attach</span>
      )}

      {/* Staged files/images. The chip shows the NAME and holds the full path in
          its tooltip — the path is what the agent gets, so it has to be
          checkable, but a column of absolute paths is not readable. */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.path}
              title={a.path}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-1 pr-1 pl-2 font-mono text-xs"
            >
              <Paperclip className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{a.name}</span>
              <IconButton
                label={`Remove ${a.name}`}
                size="icon-xs"
                onClick={() => setAttachments((prev) => removeAttachment(prev, a.path))}
              >
                <X />
              </IconButton>
            </span>
          ))}
        </div>
      )}

      {attachError && (
        <span className="text-xs text-destructive">Could not attach: {attachError}</span>
      )}

      <Textarea
        value={text}
        onChange={(e) => setDraft(agent.id, e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); queueIt(); }
        }}
        onPaste={onPaste}
        rows={2}
        aria-label={`Message ${agent.name}`}
        placeholder={asleep
          ? `${agent.name} has no terminal — queue a message for when it wakes`
          : idle ? `Message ${agent.name}` : `${agent.name} is busy — queue a message`}
        className="min-h-16 font-mono text-sm"
      />

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!canSend} onClick={queueIt}>
          <Send /> Send
        </Button>
        <IconButton label="Attach files — or drop them here, or paste a screenshot" onClick={pickFiles}>
          <Paperclip />
        </IconButton>
        {/* A message queued for a processless agent is not stuck, it is waiting
            for a process — so offer the one thing that starts one, here, rather
            than making the user find it above the terminal. */}
        {asleep && queue.length > 0 && <WakeButton agent={agent} size="xs" />}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {queue.length === 0 && !idle
            ? `${agent.name} is working — this queues until it is free`
            : attachments.length > 0
            ? `${attachments.length} attached — sent as paths to Read`
            : 'Enter to send · Shift+Enter for a new line'}
        </span>
      </div>
    </div>
  );
}

/**
 * One pending message. Collapsed it clamps to two lines; editing turns the row
 * into its own textarea, because a message you can only delete and retype is a
 * message you retype.
 */
function QueueRow({ message, index, last, paused, onSendNow, onRemove, onEdit, onMove }: {
  message: QueuedMessage;
  index: number;
  last: boolean;
  paused: boolean;
  onSendNow: () => void;
  onRemove: () => void;
  onEdit: (text: string) => void;
  onMove: (delta: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Measure against the CLAMPED box: the expanded one never overflows and would
  // report clipped = false, taking the toggle away with it.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || editing !== null) return;
    const measure = () => { if (!expanded) setClipped(el.scrollHeight > el.clientHeight + 1); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [message.text, expanded, editing]);

  function commit() {
    if (editing !== null && editing.trim()) onEdit(editing);
    setEditing(null);
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-2.5 py-2">
      <span className="mt-px w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing !== null ? (
          <>
            <Textarea
              autoFocus
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
              }}
              rows={2}
              aria-label="Edit this queued message"
              className="min-h-14 font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button size="xs" onClick={commit} disabled={!editing.trim()}><Check /> Save</Button>
              <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            <div
              ref={bodyRef}
              title={expanded ? undefined : message.text}
              className={cn('font-mono text-xs leading-5 break-words whitespace-pre-wrap',
                expanded ? 'max-h-52 overflow-y-auto' : 'line-clamp-2')}
            >
              {message.text}
            </div>
            {(clipped || expanded || (paused && !message.manual)) && (
              <div className="flex items-center gap-3">
                {(clipped || expanded) && (
                  <button
                    onClick={() => setExpanded((e) => !e)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                )}
                {/* The escape hatch from a floor-wide pause. Only the pause is
                    bypassed — idle/draft/picker safety still hold, so this is
                    "next", not "now, over whatever is on the prompt". */}
                {paused && !message.manual && (
                  <button
                    onClick={onSendNow}
                    title="Deliver this one even though auto-delivery is paused. It moves to the front and types in as soon as the terminal is free."
                    className="text-xs underline-offset-2 hover:underline"
                  >
                    Send now
                  </button>
                )}
              </div>
            )}
            {paused && message.manual && (
              <span className="text-xs text-muted-foreground">sending when free…</span>
            )}
          </>
        )}
      </div>

      {editing === null && (
        <div className="flex shrink-0 items-center">
          <RowAction label="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></RowAction>
          <RowAction label="Move down" disabled={last} onClick={() => onMove(1)}><ArrowDown /></RowAction>
          <RowAction label="Edit" onClick={() => setEditing(message.text)}><Pencil /></RowAction>
          <RowAction label="Remove from queue" onClick={onRemove}><X /></RowAction>
        </div>
      )}
    </div>
  );
}

/** Icon button + tooltip. The span is what keeps the tooltip alive on a disabled
 *  button — `disabled` kills pointer events and takes the tooltip with it. */
function RowAction({ label, disabled, onClick, children }: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button variant="ghost" size="icon-xs" aria-label={label} disabled={disabled} onClick={onClick}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
