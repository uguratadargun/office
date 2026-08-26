/**
 * The two live gates a queue composer has to watch, polled.
 *
 * Neither lives in the store: the terminal's automation block is a plain module
 * map in the terminal pool, and the floor-wide pause is main-process control
 * state. There is nothing to subscribe to, so both are polled — but only while
 * something is actually waiting on them.
 *
 * Lifted out of `components/MessageQueueComposer` when the modern Terminal tab
 * grew the same queue (MD-145). Two composers polling two different intervals
 * with two different notions of "blocked" is exactly the drift this prevents.
 */
import { useEffect, useState } from 'react';
import { terminalAutomationBlockFor } from '@/components/terminalPool';
import type { TerminalAutomationBlock } from '@/components/terminalAutomation';

/** Poll the pty's automation block while there is something waiting on it. 1s
 *  while the queue is pending is enough. */
export function useTerminalBlock(ptyId: string | undefined, active: boolean): TerminalAutomationBlock {
  const [block, setBlock] = useState<TerminalAutomationBlock>(null);
  useEffect(() => {
    if (!ptyId || !active) { setBlock(null); return; }
    const read = () => setBlock(terminalAutomationBlockFor(ptyId));
    read();
    const iv = setInterval(read, 1000);
    return () => clearInterval(iv);
  }, [ptyId, active]);
  // 'settling' is a sub-second gap between writes — not worth telling anyone.
  return block === 'settling' ? null : block;
}

/** Poll the floor-wide auto-delivery pause (main-process control state) while
 *  this agent has messages waiting. 2s is plenty — the pause flips on human
 *  timescales, and the drain re-reads the live snapshot before every send. */
export function useDeliveryPaused(agentId: string, active: boolean): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!active) { setPaused(false); return; }
    let alive = true;
    const read = () => {
      window.cth.controlSnapshot(agentId)
        .then((s) => { if (alive) setPaused(!!s?.autoDeliveryPaused); })
        .catch(() => { /* main not ready — assume not paused */ });
    };
    read();
    const iv = setInterval(read, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [agentId, active]);
  return paused;
}
