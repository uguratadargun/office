import { useStore } from '@/store/store';
import { useState } from 'react';
import { askOptions, composeAnswer } from '@shared/askOptions';
import type { HiveTask, HumanQA } from '@/store/taskLedger';
import { openQuestion } from '@/store/taskLedger';
import { answerTask } from '@/store/taskActions';
import { OptionAnswer } from '../askme/OptionAnswer';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';

/**
 * Answer a card's open ask, wherever you are reading it.
 *
 * The draft — and the picked option — live in the STORE, keyed by task id,
 * because this component unmounts when the sheet closes or the nav switches: a
 * half-typed answer, or a chosen (b) not yet sent, has to survive that and be
 * finishable on the other board.
 *
 * When the ask carries lettered options (MD-142) they are shown as a pickable
 * list ABOVE the box, and the box becomes the "none of these" lane. Both feed
 * ONE payload through `composeAnswer`: a letter alone for a plain pick — byte
 * for byte what the human used to type — the free text alone when nothing is
 * picked, and `a — note` when they want both.
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
  const picked = useStore((s) => s.answerChoices[task.id] ?? null);
  const setAnswerChoice = useStore((s) => s.setAnswerChoice);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  const { options } = askOptions(openQuestion(task));
  const payload = composeAnswer(picked, draft);

  async function send() {
    if (!payload || sending) return;
    setSending(true); setFailed(false);
    try {
      const qa = await answerTask(task, payload);
      // null = the ledger refused, so nothing was mailed either. Keep the draft
      // AND the pick; the user retries rather than losing what they chose.
      if (qa) { onAnswered(qa); setAnswerDraft(task.id, ''); setAnswerChoice(task.id, null); } else setFailed(true);
    } catch { setFailed(true); }
    setSending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {options.length > 0 && (
        <>
          <OptionAnswer
            options={options}
            value={picked}
            onChange={(key) => setAnswerChoice(task.id, key)}
            disabled={sending}
          />
          <p className="text-xs text-muted-foreground">
            {picked
              ? 'Picked — add a note below if you want, or click it again to write your own instead.'
              : 'Pick one, or write your own answer below.'}
          </p>
        </>
      )}
      <Textarea
        value={draft}
        autoFocus={autoFocus}
        onChange={(e) => setAnswerDraft(task.id, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
        rows={options.length > 0 ? 2 : 3}
        aria-label="Your answer"
        placeholder={options.length > 0
          ? 'Write my own answer — or a note to go with the option above…'
          : 'Your answer — or “done”, with the result…'}
        className="text-sm"
      />
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={!payload || sending} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Respond & unblock'}
        </Button>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {failed
            ? `Not saved — nothing was sent to ${boss}. Try again.`
            // What actually lands on the card. Shown only for a pick, because a
            // letter on its own is the one answer whose meaning is not on screen.
            : picked ? `Sends “${payload}”` : '⌘↵ to send'}
        </span>
      </div>
    </div>
  );
}
