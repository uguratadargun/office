import { useNavBadgeCounts } from './lib/navBadges';

/**
 * The rail's two count badges. They live beside `nav.ts` rather than inside it
 * because that file is the shell's registry and stays a `.ts` — and because
 * these are the only two entries that carry one, so a shared abstraction would
 * be one indirection for a pair.
 *
 * Both read ONE poller (see ./lib/navBadges.ts). Zero renders nothing: an
 * always-present "0" is a permanent smudge on a rail whose whole job is to be
 * quiet until something needs you.
 */
function Count({ n, title }: { n: number; title: string }) {
  if (!n) return null;
  return (
    <span
      title={title}
      aria-label={title}
      className="ml-auto min-w-5 shrink-0 rounded-full bg-sidebar-accent px-1.5 text-center text-xs leading-5 font-medium tabular-nums text-sidebar-accent-foreground"
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** Cards on the board carrying an open question. */
export function TasksBadge() {
  const n = useNavBadgeCounts().tasks;
  return <Count n={n} title={`${n} ${n === 1 ? 'card' : 'cards'} with an open question`} />;
}

/** Questions actually waiting on the human — the one badge that is an alert. */
export function AskMeBadge() {
  const n = useNavBadgeCounts().askMe;
  return <Count n={n} title={`${n} ${n === 1 ? 'question is' : 'questions are'} waiting on you`} />;
}
