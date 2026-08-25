import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ContextRule, ContextTriggerConfig } from '@shared/triggers';
import { getContextTrigger, setContextTrigger } from '@/components/triggers/api';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Skeleton } from '../components/ui/skeleton';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import { Field, IntervalPicker, PctField, RowDisclosure, TriggerRow } from './controls';
import { fmtInterval } from './interval';

/**
 * CONTEXT — the trigger that fires on an agent's own terminal filling up rather
 * than on the clock alone. Two rules, and they are not the same operation:
 * compaction SUMMARISES the context, clearing THROWS IT AWAY.
 *
 * The IPC is `components/triggers/api.ts` verbatim — it deep-fills a half-written
 * rule so a missing sub-field never reaches a number input as `undefined` and
 * flips it uncontrolled.
 */

const WRITE_DEBOUNCE_MS = 400;

/** Main clamps a context cadence to 1 minute … 24 hours on the way in, so the
 *  picker offers exactly that and never labels a value it cannot store. */
const MIN_EVERY_MS = 60_000;
const MAX_EVERY_MS = 86_400_000;

export function ContextSection({ onSummary }: { onSummary: (s: string) => void }) {
  const [cfg, setCfg] = useState<ContextTriggerConfig | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    getContextTrigger().then((c) => { if (alive) setCfg(c); }).catch(() => { /* defaults */ });
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!cfg) return;
    const on = [cfg.compact.enabled ? 'compact' : null, cfg.clear.enabled ? 'clear' : null].filter(Boolean);
    onSummary(on.length ? on.join(' + ') : 'both off');
  }, [cfg, onSummary]);

  // Optimistic + debounced: the controls answer instantly, and a burst of typing
  // in the message box collapses into one write instead of one per keystroke.
  const commit = (next: ContextTriggerConfig) => {
    setCfg(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setContextTrigger(next), WRITE_DEBOUNCE_MS);
  };
  const patch = (key: 'compact' | 'clear', fields: Partial<ContextRule>) => {
    if (!cfg) return;
    commit({ ...cfg, [key]: { ...cfg[key], ...fields } });
  };

  if (!cfg) return <Skeleton className="h-24 w-full" />;

  return (
    <>
      <p className="text-[13px] leading-5 text-muted-foreground">
        A rule fires only when both halves agree: the gap since its last run has passed, AND that
        agent&apos;s context is at least as full as the bar. A bar of 0% means the clock alone.
      </p>

      <RuleRow
        title="Compact"
        blurb="Summarises the context so the thread keeps going."
        rule={cfg.compact}
        messageLabel="Extra focus"
        messageHint="Appended to the provider's compaction command. Empty sends the bare command."
        messagePlaceholder="What the summary must keep…"
        onPatch={(fields) => patch('compact', fields)}
      />

      <RuleRow
        title="Clear"
        blurb="Discards the context. Nothing is summarised."
        rule={cfg.clear}
        messageLabel="Command"
        messageHint="Sent literally. Empty sends the bare clear command."
        messagePlaceholder="/clear"
        caution={
          <>
            Clearing throws context away — it is not a smaller version of compaction. An agent
            mid-task forgets what it was doing. Leave this off unless you keep context another way.
          </>
        }
        onPatch={(fields) => patch('clear', fields)}
      />
    </>
  );
}

function RuleRow({ title, blurb, rule, messageLabel, messageHint, messagePlaceholder, caution, onPatch }: {
  title: string;
  blurb: string;
  rule: ContextRule;
  messageLabel: string;
  messageHint: string;
  messagePlaceholder: string;
  caution?: ReactNode;
  onPatch: (fields: Partial<ContextRule>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <TriggerRow
      open={open}
      onOpenChange={setOpen}
      resting={
        <p className="text-[12px] text-muted-foreground">
          {rule.enabled
            ? <>Every {fmtInterval(rule.everyMs)}, once context passes {rule.minContextPct}%.</>
            : <>Off.</>}
        </p>
      }
      header={
        <>
          <div className="flex items-center gap-2">
            <RowDisclosure open={open} label={title} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px]">{title}</span>
              <span className="truncate text-[12px] text-muted-foreground">{blurb}</span>
            </span>
            <Switch
              checked={rule.enabled}
              onCheckedChange={(enabled) => onPatch({ enabled })}
              aria-label={`Enable ${title}`}
            />
          </div>
          {/* The caution is always on screen — it is why this ships off — but it
              only goes destructive once the rule is actually armed. A red box
              over a switched-off setting is crying wolf. */}
          {caution && (
            <Alert variant={rule.enabled ? 'destructive' : 'default'}>
              {rule.enabled && <TriangleAlert />}
              <AlertDescription>{caution}</AlertDescription>
            </Alert>
          )}
        </>
      }
    >
      <Field label="No sooner than every">
        <IntervalPicker
          value={rule.everyMs}
          onChange={(everyMs) => onPatch({ everyMs })}
          minMs={MIN_EVERY_MS}
          maxMs={MAX_EVERY_MS}
        />
      </Field>
      <Field label="Context bar" hint="How full the window must be before this may run. 0% = time alone.">
        <PctField label={`${title} context bar`} value={rule.minContextPct} onChange={(minContextPct) => onPatch({ minContextPct })} />
      </Field>
      <Field
        label="Bar on big windows"
        hint="Used on ~1M-token windows, where a smaller slice is still an enormous amount of text."
      >
        <PctField
          label={`${title} big-window bar`}
          value={rule.minContextPctLargeWindow}
          onChange={(minContextPctLargeWindow) => onPatch({ minContextPctLargeWindow })}
        />
      </Field>
      <Field label={messageLabel} hint={messageHint}>
        <Textarea
          value={rule.message}
          onChange={(e) => onPatch({ message: e.target.value })}
          rows={3}
          placeholder={messagePlaceholder}
          className="font-mono text-[12px]"
        />
      </Field>
    </TriggerRow>
  );
}
