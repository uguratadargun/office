import { Pause, Play } from 'lucide-react';

import { useFloorDelivery } from '@/hooks/useFloorDelivery';
import { useStore } from '@/store/store';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

/**
 * The floor-wide auto-delivery switch.
 *
 * This UI could only READ the pause (`TerminalQueue` reports "held — auto
 * -delivery is paused floor-wide") and never set it, so a floor paused from the
 * classic UI could be seen and not undone, and a queue could not be held before
 * a risky run without switching front-ends (MD-148 E).
 *
 * It lives in the shell header rather than in an agent's terminal because that
 * is what it is: one switch for every agent's queue, god included. Paused is the
 * abnormal state and says so in words — a floor where nothing is being delivered
 * must not look like an idle floor.
 */
export function DeliveryToggle() {
  const selectedId = useStore((s) => s.selectedId);
  // Polled: the same switch exists in the classic UI, and the two windows are
  // the same floor — a pause set over there has to show up here.
  const { paused, available, toggle } = useFloorDelivery(selectedId, 5000);
  if (!available) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {paused ? (
          <Button size="xs" variant="secondary" onClick={() => void toggle()}>
            <Play /> Delivery paused
          </Button>
        ) : (
          <Button size="icon-sm" variant="ghost" aria-label="Pause queue delivery for every agent" onClick={() => void toggle()}>
            <Pause />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {paused
          ? 'Queued messages are held for every agent — click to resume the floor'
          : 'Queues are delivering — click to hold every agent’s queue'}
      </TooltipContent>
    </Tooltip>
  );
}
