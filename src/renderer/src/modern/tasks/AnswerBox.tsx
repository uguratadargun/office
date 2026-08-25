import { useState } from 'react';
import { useStore } from '@/store/store';
import type { HiveTask, HumanQA } from '@/store/taskLedger';
import { answerTask } from '@/store/taskActions';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';

/**
 * Answer a card's open ask, wherever you are reading it.
 *
 * The draft lives in the STORE, keyed by task id, because this component
 * unmounts when the sheet closes or the nav switches — a half-typed answer has
 * to survive that and be finishable on the other board.
 *
 * `answerTask` writes the entry AND mails the god in one call. Never split that
 * pair: a filed answer nobody acts on is worse than no answer.
 */
export function AnswerBox({ task, onAnswered, autoFocus }: {
  task: HiveTask;
  onAnswered: (qa: HumanQA[]) => void;
  autoFocus?: boolean;
}) {
  const boss = useStore((s) => s.bossName);
  const draft = useStore((s) => s.answerDrafts[task.id] ?? '');
  const setAnswerDraft = useStore((s) => s.setAnswerDraft);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setFailed(false);
    try {
      const qa = await answerTask(task, text);
      // null = the ledger refused, so nothing was mailed either. Keep the draft;
      // the user retries rather than losing what they typed.
      if (qa) { onAnswered(qa); setAnswerDraft(task.id, ''); } else setFailed(true);
    } catch { setFailed(true); }
    setSending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => setAnswerDraft(task.id, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
        rows={3}
        aria-label="Your answer"
        placeholder="Your answer — or “done”, with the result…"
        className="text-[13px]"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!draft.trim() || sending} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Respond & unblock'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {failed ? `Not saved — nothing was sent to ${boss}. Try again.` : '⌘↵ to send'}
        </span>
      </div>
    </div>
  );
}
