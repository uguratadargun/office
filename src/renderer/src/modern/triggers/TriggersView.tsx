import { useCallback, useState } from 'react';
import { SchedulesSection } from './SchedulesSection';
import { ContextSection } from './ContextSection';
import { WebhooksSection } from './WebhooksSection';
import { HistorySection } from './HistorySection';
import { TriggerSection } from './controls';

/**
 * TRIGGERS — every way the floor gets woken up without a human typing, in one
 * page. Four kinds (src/shared/triggers.ts is the contract): schedules, context,
 * webhooks, and the history of what the outside world actually sent.
 *
 * Each kind is a collapsed card carrying its name, a one-line "what this is" and
 * a live summary badge; schedules opens expanded because it is the incumbent.
 * Inside a card, each row collapses the same way, so nothing is more than two
 * disclosures from legible — the same shape as the pixel tab, which had to do it
 * because it lived in a 360px sidebar, kept here because it still reads best.
 */
export function TriggersView() {
  const [schedules, setSchedules] = useState('');
  const [context, setContext] = useState('');
  const [webhooks, setWebhooks] = useState('');
  const [history, setHistory] = useState('');

  // Stable callbacks: each section reports its summary from an effect keyed on
  // its own data, and a fresh function identity every render would make that
  // effect re-run forever.
  const onSchedules = useCallback((s: string) => setSchedules(s), []);
  const onContext = useCallback((s: string) => setContext(s), []);
  const onWebhooks = useCallback((s: string) => setWebhooks(s), []);
  const onHistory = useCallback((s: string) => setHistory(s), []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-6">
      <p className="text-[13px] text-muted-foreground">
        Everything that can start work without you typing.
      </p>

      <TriggerSection title="Schedules" blurb="Run a prompt on a repeating clock." summary={schedules} defaultOpen>
        <SchedulesSection onSummary={onSchedules} />
      </TriggerSection>

      <TriggerSection title="Context" blurb="Compact or clear an agent as its context fills." summary={context}>
        <ContextSection onSummary={onContext} />
      </TriggerSection>

      <TriggerSection title="Webhooks" blurb="Let an outside system post work in." summary={webhooks}>
        <WebhooksSection onSummary={onWebhooks} />
      </TriggerSection>

      <TriggerSection title="History" blurb="What callers sent, and what we said back." summary={history}>
        <HistorySection onSummary={onHistory} />
      </TriggerSection>
    </div>
  );
}
