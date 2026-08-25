import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/store/store';
import { useRealtimeMichael } from '@/realtime/session';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

/**
 * Which microphone the voice loop captures and which speaker it plays through.
 *
 * Both selections are held in the realtime session singleton (`realtime/session.ts`):
 * the mic is applied on the next `connect()` (getUserMedia `{ deviceId: { exact } }`),
 * the speaker is applied immediately to the live `<audio>` sink via `setSinkId()`.
 * Both fall back to the system default if a stored id is stale.
 *
 * `enumerateDevices()` only returns device LABELS once the page has been granted
 * mic access at least once, so before that we show generic "Microphone N" names
 * and say why — the picker stays usable cold.
 */

interface AudioDevice { deviceId: string; label: string }

/** Whether this runtime can route audio output to a chosen sink. When false the
 *  speaker picker is hidden rather than shown as an inert control. */
const CAN_PICK_SPEAKER =
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/** A radix Select cannot hold an empty string as a value, so "system default"
 *  gets a sentinel and is mapped back to `null` on the way to the session. */
const SYSTEM_DEFAULT = '__default';

async function listDevices(kind: 'audioinput' | 'audiooutput'): Promise<AudioDevice[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const fallback = kind === 'audioinput' ? 'Microphone' : 'Speaker';
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === kind)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
}

export function DevicePicker() {
  const { deviceId, setDeviceId, outputDeviceId, setOutputDeviceId } = useRealtimeMichael();
  const boss = useStore((s) => s.bossName);
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  /** True once at least one device exposes a real label ⇒ mic permission granted. */
  const [labelled, setLabelled] = useState(false);

  const refresh = useCallback(async () => {
    const [ins, outs] = await Promise.all([
      listDevices('audioinput'),
      CAN_PICK_SPEAKER ? listDevices('audiooutput') : Promise.resolve<AudioDevice[]>([])
    ]);
    setMics(ins);
    setSpeakers(outs);
    setLabelled(ins.some((m) => m.label && !/^Microphone \d+$/.test(m.label)));
  }, []);

  useEffect(() => {
    void refresh();
    // Hot-plug / unplug a device, or a permission grant that reveals labels → re-list.
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md) return;
    const onChange = () => { void refresh(); };
    md.addEventListener?.('devicechange', onChange);
    return () => md.removeEventListener?.('devicechange', onChange);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Microphone</Label>
        <Select
          value={deviceId ?? SYSTEM_DEFAULT}
          onValueChange={(v) => setDeviceId(v === SYSTEM_DEFAULT ? null : v)}
        >
          <SelectTrigger className="h-8 w-full" aria-label="Microphone"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SYSTEM_DEFAULT}>System default</SelectItem>
            {mics.map((m) => <SelectItem key={m.deviceId} value={m.deviceId}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {CAN_PICK_SPEAKER && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Speaker</Label>
          <Select
            value={outputDeviceId ?? SYSTEM_DEFAULT}
            onValueChange={(v) => setOutputDeviceId(v === SYSTEM_DEFAULT ? null : v)}
          >
            <SelectTrigger className="h-8 w-full" aria-label="Speaker"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SYSTEM_DEFAULT}>System default</SelectItem>
              {speakers.map((s) => <SelectItem key={s.deviceId} value={s.deviceId}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {!labelled && (
        <p className="text-xs leading-4 text-muted-foreground">
          Device names appear after you first start a voice session and grant mic access.
          The microphone choice applies the next time {boss} connects; the speaker switches live.
        </p>
      )}
    </div>
  );
}
