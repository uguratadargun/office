import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Send } from 'lucide-react';
import { toast } from 'sonner';
import { relSince } from '@shared/relTime';
import type { HiveMessage } from '../../../../preload';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { clipBody, mergeThreads, replyPayload, type Thread } from './threads';

const POLL_MS = 3000;

/** `destructive` is for real failure only, so a refusal is the only act that
 *  earns it; everything else is one quiet chip. */
function actTone(act: string): 'secondary' | 'destructive' | 'outline' {
  if (act === 'refuse') return 'destructive';
  if (act === 'request' || act === 'query') return 'outline';
  return 'secondary';
}

/**
 * One agent's hive conversations: what it was sent, what it answered, and a box
 * to say the next thing. Reads the WHOLE mailbox — the live inbox alone shows
 * the questions and none of the answers, and loses even those the moment the
 * router files them under `.done`.
 */
export function MessagesTab({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    const read = async () => {
      try {
        const all = await window.cth.hiveMailbox(agentId);
        if (!alive) return;
        setThreads(mergeThreads(all));
        setLoaded(true);
      } catch {
        // Keep the last good render rather than blanking the tab on one bad poll.
        if (alive) setLoaded(true);
      }
    };
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [agentId]);

  if (loaded && threads.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center">
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Messages this agent sends or receives appear here as threads.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-4">
        {threads.map((thread) => (
          <ThreadCard key={thread.conversation} agentId={agentId} agentName={agentName} thread={thread} />
        ))}
      </div>
    </ScrollArea>
  );
}

function ThreadCard({ agentId, agentName, thread }: { agentId: string; agentName: string; thread: Thread }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    // The human is the sender: `hiveSend(payload, 'human')`, same as the pixel
    // surface — an agent must never see a message that claims to be from another
    // agent when a person wrote it.
    const res = await window.cth.hiveSend(replyPayload(agentId, thread, draft), 'human');
    setBusy(false);
    if (res.ok) { setDraft(''); toast('sent'); }
    // Keep the text on failure — it is the only copy the user has.
    else toast(`not sent — ${res.error ?? 'unknown error'}`);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="truncate text-sm font-medium">{thread.subject}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {thread.messages.length} · {relSince(thread.lastAt)}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <Separator />
        <div className="flex flex-col gap-3 p-3">
          {thread.messages.map((m) => <Message key={m.id} message={m} />)}

          <div className="flex items-end gap-2 pt-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder={`Message ${agentName}…`}
              className="min-h-[52px]"
            />
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void send()}>
              <Send /> Send
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Message({ message }: { message: HiveMessage }) {
  const [expanded, setExpanded] = useState(false);
  const { text, clipped } = clipBody(message.body, expanded);

  return (
    <div className="border-l pl-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{message.from}</span>
        <span className="text-xs text-muted-foreground">→ {message.to}</span>
        <Badge variant={actTone(message.act)} className="h-5 px-1.5 text-[10px] font-normal">
          {message.act}
        </Badge>
        {message.needs_human && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">needs you</Badge>
        )}
        <span
          className="ml-auto text-xs text-muted-foreground"
          title={new Date(message.created_at).toLocaleString()}
        >
          {relSince(message.created_at)}
        </span>
      </div>
      <p className="mt-1 text-sm leading-5 break-words whitespace-pre-wrap text-muted-foreground">
        {text}
        {clipped && (
          <Button
            size="xs"
            variant="link"
            className="ml-1 h-auto p-0 align-baseline"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'less' : 'more'}
          </Button>
        )}
      </p>
    </div>
  );
}
