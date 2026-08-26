import { Pause, Play } from 'lucide-react';

import { useFloorDelivery } from '@/hooks/useFloorDelivery';
import { useStore } from '@/store/store';
import { Button } from './ui/button';
import { IconButton } from './IconButton';
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

  // Paused is the abnormal state, so it is a labelled button and not a second
  // glyph; running, it is one more icon in a header of icons. Two returns
  // rather than a ternary inside the trigger: `asChild` clones its child, and
  // the ref scan (test/modern-tooltip-anchor) follows an inline child only.
  if (paused) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="xs" variant="secondary" onClick={() => void toggle()}>
            <Play /> Delivery paused
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Queued messages are held for every agent — click to resume the floor
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <IconButton
      label="Hold every agent's queue"
      side="bottom"
      onClick={() => void toggle()}
    >
      <Pause />
    </IconButton>
  );
}
