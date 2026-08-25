import { useState, type ReactNode } from 'react';
import { ChevronRight, Check, Copy, Eye, EyeOff } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Progress } from '../components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { cn } from '../lib/cn';
import { INTERVAL_OPTS, MINUTE, fmtInterval } from './interval';

/**
 * The chrome the four trigger sections share.
 *
 * The pixel tab grew its own mini design system (`components/triggers/ui.tsx`,
 * 389 lines of `--cth-*` inline styles) because it lived in a 360px sidebar with
 * nothing to build on. Here there IS something to build on, so every one of those
 * pieces is a shadcn primitive with a class on it — the only things left are the
 * three genuinely composite controls (interval, percent, secret) and the two
 * disclosure shells, which are compositions rather than new primitives.
 */

/* ───────────────────────────── disclosure shells ─────────────────────────── */

/**
 * A top-level trigger type: title, one line of what it is, a live summary.
 *
 * The children stay MOUNTED while collapsed (`forceMount` + hidden, never
 * unmounted) for the two reasons the pixel tab found: the summary badge is fed
 * BY the section, so it would blank the moment you closed it, and a row you left
 * open inside a section survives collapsing its parent.
 */
export function TriggerSection({ title, blurb, summary, defaultOpen = false, children }: {
  title: string;
  blurb: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[14px] font-medium">{title}</span>
            <span className="truncate text-[12px] text-muted-foreground">{blurb}</span>
          </span>
          {summary != null && summary !== '' && (
            <Badge variant="secondary" className="shrink-0 font-normal">{summary}</Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent forceMount className="data-[state=closed]:hidden">
          <div className="flex flex-col gap-2 border-t px-4 py-3">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** One row inside a section (a mission, a rule, an endpoint). `header` is always
 *  visible and carries the switch; `children` only when expanded. */
export function TriggerRow({ open, onOpenChange, header, resting, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  header: ReactNode;
  /** Shown only while collapsed — the one line that makes the row legible shut. */
  resting?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border">
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {header}
        {!open && resting}
      </div>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t px-3 py-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The chevron that opens a row. Icon-only, so it carries its own label. */
export function RowDisclosure({ open, label }: { open: boolean; label: string }) {
  return (
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="icon-xs" aria-label={open ? `Collapse ${label}` : `Expand ${label}`}>
        <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
      </Button>
    </CollapsibleTrigger>
  );
}

/* ──────────────────────────────── field ──────────────────────────────────── */

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[12px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ──────────────────────────── interval picker ────────────────────────────── */

const CUSTOM = '__custom';

/**
 * @param minMs/maxMs the range MAIN will actually store. Context rules are
 * clamped to 1 minute … 24 hours on the way in, so offering "weekly" there would
 * put a label on screen the saved value does not match.
 */
export function IntervalPicker({ value, onChange, minMs = MINUTE, maxMs = Number.POSITIVE_INFINITY }: {
  value: number;
  onChange: (ms: number) => void;
  minMs?: number;
  maxMs?: number;
}) {
  const opts = INTERVAL_OPTS.filter((o) => o.ms >= minMs && o.ms <= maxMs);
  const preset = opts.some((o) => o.ms === value);
  const [custom, setCustom] = useState(!preset);
  const showCustom = custom || !preset;
  const clamp = (ms: number) => Math.min(maxMs, Math.max(minMs, ms));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={showCustom ? CUSTOM : String(value)}
        onValueChange={(v) => {
          if (v === CUSTOM) { setCustom(true); return; }
          setCustom(false);
          onChange(Number(v));
        }}
      >
        <SelectTrigger className="h-8 w-32" aria-label="Interval">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => <SelectItem key={o.ms} value={String(o.ms)}>{o.label}</SelectItem>)}
          <SelectItem value={CUSTOM}>{preset ? 'custom…' : `${fmtInterval(value)} (custom)`}</SelectItem>
        </SelectContent>
      </Select>
      {showCustom && (
        <span className="flex items-center gap-1.5">
          <Input
            type="number"
            aria-label="Interval in minutes"
            min={Math.max(1, Math.round(minMs / MINUTE))}
            max={Number.isFinite(maxMs) ? Math.round(maxMs / MINUTE) : undefined}
            value={Math.max(1, Math.round(value / MINUTE))}
            onChange={(e) => {
              const mins = Number(e.target.value);
              if (Number.isFinite(mins) && mins > 0) onChange(clamp(Math.round(mins) * MINUTE));
            }}
            className="h-8 w-20 font-mono"
          />
          <span className="text-[12px] text-muted-foreground">min</span>
        </span>
      )}
    </div>
  );
}

/* ───────────────────────────── percent field ─────────────────────────────── */

export function PctField({ value, onChange, label }: { value: number; onChange: (pct: number) => void; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-3">
      <Input
        type="number"
        aria-label={label}
        min={0}
        max={100}
        value={pct}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0);
        }}
        className="h-8 w-20 font-mono"
      />
      <span className="text-[12px] text-muted-foreground">%</span>
      <Progress value={pct} className="flex-1" />
    </div>
  );
}

/* ────────────────────────────── secret field ─────────────────────────────── */

/** Masked by default; reveals only on demand. The value never lands in a
 *  `title`/tooltip — those leak into screenshots and accessibility trees. */
export function SecretField({ value, revealed, onReveal, onCopy, copied }: {
  value: string;
  revealed: boolean;
  onReveal: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type={revealed ? 'text' : 'password'}
        value={value}
        readOnly
        aria-label="Endpoint secret"
        className="h-8 flex-1 font-mono text-[12px]"
      />
      <Button variant="outline" size="icon-sm" onClick={onReveal} aria-label={revealed ? 'Hide secret' : 'Show secret'}>
        {revealed ? <EyeOff /> : <Eye />}
      </Button>
      <Button variant="outline" size="icon-sm" onClick={onCopy} aria-label="Copy secret">
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** A one-line mono readout — a URL, a prompt preview. Never wraps. */
export function MonoLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(
      'truncate rounded-md border bg-muted/40 px-2 py-1 font-mono text-[12px] leading-5 text-foreground',
      className
    )}>{children}</div>
  );
}
