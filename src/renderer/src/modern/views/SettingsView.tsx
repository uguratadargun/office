import { useEffect, useState } from 'react';
import { uiMode, type UiMode } from '@shared/uiMode';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select';

/**
 * Settings placeholder — the full panel is a later batch. The ONE setting that
 * has to live here from day one is the interface switch: without it the modern
 * UI is a one-way door, since the pixel Settings modal is no longer on screen.
 */
export function SettingsView() {
  const [mode, setMode] = useState<UiMode>('modern');

  useEffect(() => {
    let cancelled = false;
    window.cth.getConfig().then((c) => { if (!cancelled) setMode(uiMode(c.uiMode)); });
    return () => { cancelled = true; };
  }, []);

  async function pick(next: string) {
    const value = uiMode(next);
    setMode(value);
    await window.cth.updateConfig({ uiMode: value });
    // Each UI's stylesheet is loaded by its own entry module, so swapping roots
    // in place would leave the outgoing UI's CSS in the document. A reload is
    // the honest switch — and it is what the pixel side does too.
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Interface</CardTitle>
          <CardDescription>
            Two front-ends over the same hive. Switching reloads the window; nothing about your
            agents, terminals or settings changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={mode} onValueChange={pick}>
            <SelectTrigger className="w-64" aria-label="Interface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pixel">Classic (pixel)</SelectItem>
              <SelectItem value="modern">Modern</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Everything else</CardTitle>
          <CardDescription>
            Engines, connections, autonomy and budgets have not been ported yet — switch to the
            classic UI to reach them.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
