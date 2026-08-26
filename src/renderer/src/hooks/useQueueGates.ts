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
import { bootGraceMsLeft, cooldownMsLeft } from './deliveryClock';

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

/**
 * Poll the main-process control state that bears on delivery, while this agent
 * has messages waiting. 2s is plenty — these flip on human timescales, and the
 * drain re-reads the live snapshot before every send.
 *
 * `paused`/`halted` are NOT delivery gates (they deny the agent's tool calls),
 * but they are why a queue's agent is not going idle — which is the question
 * the operator is actually asking (MD-155).
 */
export interface DeliveryControl {
  floorPaused: boolean;
  agentPaused: boolean;
  agentHalted: boolean;
}

const NO_CONTROL: DeliveryControl = { floorPaused: false, agentPaused: false, agentHalted: false };

export function useDeliveryControl(agentId: string, active: boolean): DeliveryControl {
  const [control, setControl] = useState<DeliveryControl>(NO_CONTROL);
  useEffect(() => {
    if (!active) { setControl(NO_CONTROL); return; }
    let alive = true;
    const read = () => {
      window.cth.controlSnapshot(agentId)
        .then((s) => {
          if (!alive) return;
          setControl({
            floorPaused: !!s?.autoDeliveryPaused,
            agentPaused: !!s?.paused,
            agentHalted: !!s?.halted
          });
        })
        .catch(() => { /* main not ready — assume nothing is holding */ });
    };
    read();
    const iv = setInterval(read, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [agentId, active]);
  return control;
}

/** Back-compat for callers that only want the floor-wide pause. */
export function useDeliveryPaused(agentId: string, active: boolean): boolean {
  return useDeliveryControl(agentId, active).floorPaused;
}

/**
 * The drain's two clocks — the boot grace and the one-at-a-time cooldown — as
 * milliseconds remaining.
 *
 * Polled at 500ms rather than 1s: these are the two gates a label puts a NUMBER
 * on, and a countdown that skips seconds reads as broken. Only while something
 * is waiting on them.
 */
export function useDeliveryClock(agentId: string, active: boolean): { bootGraceMs: number; cooldownMs: number } {
  const [clock, setClock] = useState({ bootGraceMs: 0, cooldownMs: 0 });
  useEffect(() => {
    if (!agentId || !active) { setClock({ bootGraceMs: 0, cooldownMs: 0 }); return; }
    const read = () => {
      const now = Date.now();
      setClock({ bootGraceMs: bootGraceMsLeft(agentId, now), cooldownMs: cooldownMsLeft(agentId, now) });
    };
    read();
    const iv = setInterval(read, 500);
    return () => clearInterval(iv);
  }, [agentId, active]);
  return clock;
}
