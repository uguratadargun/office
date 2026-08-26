import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Send, X } from 'lucide-react';
import { useStore, type Agent, type QueuedMessage } from '@/store/store';
import { isProcessless } from '@shared/agentPresence';
import { queueHoldReason, type QueueHold } from '@shared/messageQueue';
import { useDeliveryPaused, useTerminalBlock } from '@/hooks/useQueueGates';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
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
 * which one to name is `queueHoldReason`'s call, in the drain's own gate order.
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
  const paused = useDeliveryPaused(agent.id, queue.length > 0);
  const hold = queueHoldReason({
    count: queue.length, idle: idle && !asleep, paused, frontManual: queue[0]?.manual, block
  });

  function queueIt() {
    if (!text.trim()) return;
    enqueueMessage(agent.id, text);
    setDraft(agent.id, '');
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t p-3">
      {queue.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium">{queue.length} queued</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              · {holdCopy(hold, agent.name, asleep)}
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

      <Textarea
        value={text}
        onChange={(e) => setDraft(agent.id, e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); queueIt(); }
        }}
        rows={2}
        aria-label={`Message ${agent.name}`}
        placeholder={asleep
          ? `${agent.name} has no terminal — queue a message for when it wakes`
          : idle ? `Message ${agent.name}` : `${agent.name} is busy — queue a message`}
        className="min-h-16 font-mono text-sm"
      />

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!text.trim()} onClick={queueIt}>
          <Send /> Send
        </Button>
        {/* A message queued for a processless agent is not stuck, it is waiting
            for a process — so offer the one thing that starts one, here, rather
            than making the user find it above the terminal. */}
        {asleep && queue.length > 0 && <WakeButton agent={agent} size="xs" />}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {queue.length === 0 && !idle
            ? `${agent.name} is working — this queues until it is free`
            : 'Enter to send · Shift+Enter for a new line'}
        </span>
      </div>
    </div>
  );
}

/** What to say about the hold. `sending` is the good case and still gets a line:
 *  "why has my message not appeared yet" is the question this whole strip
 *  exists to answer. */
function holdCopy(hold: QueueHold, name: string, asleep: boolean): string {
  if (asleep) return 'delivering after Wake';
  switch (hold) {
    case 'busy': return 'delivering when idle';
    case 'paused': return 'held — auto-delivery is paused floor-wide';
    case 'draft': return `held — ${name}'s prompt has unsent text on it`;
    case 'picker': return `held — a slash-command picker is open in ${name}'s terminal`;
    case 'exited': return `held — ${name}'s terminal has exited`;
    // Not "delivering now": the drain has gates no composer can see (a
    // post-send cooldown, the agent's boot grace), so a queue with no KNOWN
    // hold can still sit for a few seconds. Say what will happen, not that it
    // is happening this instant.
    default: return 'delivering one at a time';
  }
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
