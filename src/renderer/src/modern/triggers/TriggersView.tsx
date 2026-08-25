import { useCallback, useEffect, useState } from 'react';
import { useNavTarget } from '../navigation';
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
/** The card ids a cross-area deep link may name, and their DOM ids. Integrations
 *  sends the webhook row here because the webhook EDITOR lives on this page and
 *  nowhere else — pointing it at Settings (MD-94 S1) landed on a page with no
 *  webhooks on it at all. */
export const TRIGGER_SECTIONS = ['Schedules', 'Context', 'Webhooks', 'History'] as const;
export type TriggerSectionName = (typeof TRIGGER_SECTIONS)[number];
export function triggerSectionDomId(name: TriggerSectionName): string {
  return `trigger-${name.toLowerCase()}`;
}

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

  /**
   * Which cards are expanded. This used to live inside each `TriggerSection`,
   * and had to come up here for one reason: a deep link from Integrations has to
   * OPEN the Webhooks card, which nothing outside the card could do. Schedules
   * still starts open — it is the incumbent.
   */
  const [open, setOpen] = useState<Partial<Record<TriggerSectionName, boolean>>>({ Schedules: true });
  const setOne = useCallback((name: TriggerSectionName) => (v: boolean) => {
    setOpen((o) => ({ ...o, [name]: v }));
  }, []);

  const target = useNavTarget();
  useEffect(() => {
    const name = target.section as TriggerSectionName | undefined;
    if (target.id !== 'triggers' || !name || !TRIGGER_SECTIONS.includes(name)) return;
    setOpen((o) => ({ ...o, [name]: true }));
    // Two frames: one for the expand to commit, one for layout — the same shape
    // Settings uses for a search hit.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(triggerSectionDomId(name))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
  }, [target]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-6">
      <p className="text-[13px] text-muted-foreground">
        Everything that can start work without you typing.
      </p>

      <TriggerSection id={triggerSectionDomId('Schedules')} title="Schedules" blurb="Run a prompt on a repeating clock." summary={schedules} open={!!open.Schedules} onOpenChange={setOne('Schedules')}>
        <SchedulesSection onSummary={onSchedules} />
      </TriggerSection>

      <TriggerSection id={triggerSectionDomId('Context')} title="Context" blurb="Compact or clear an agent as its context fills." summary={context} open={!!open.Context} onOpenChange={setOne('Context')}>
        <ContextSection onSummary={onContext} />
      </TriggerSection>

      <TriggerSection id={triggerSectionDomId('Webhooks')} title="Webhooks" blurb="Let an outside system post work in." summary={webhooks} open={!!open.Webhooks} onOpenChange={setOne('Webhooks')}>
        <WebhooksSection onSummary={onWebhooks} />
      </TriggerSection>

      <TriggerSection id={triggerSectionDomId('History')} title="History" blurb="What callers sent, and what we said back." summary={history} open={!!open.History} onOpenChange={setOne('History')}>
        <HistorySection onSummary={onHistory} />
      </TriggerSection>
    </div>
  );
}
