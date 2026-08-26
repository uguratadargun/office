import { useCallback, useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { setupPrompt, type ToolKind, type ToolStatus } from '@shared/toolCatalog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { IconButton } from '../components/IconButton';
import { Group, SectionHeader } from './Row';

/**
 * PREREQUISITES — the tools that live outside the app bundle, and whether you
 * have them.
 *
 * Every one of them degrades SILENTLY when missing: no mempalace means no
 * semantic recall, no engine CLI means that engine's agents never start, and
 * from the floor "switched off" and "not installed" look identical. This is the
 * only screen that tells them apart, which is why MD-93 filed its absence from
 * modern rather than treating the narrower Provider Doctor on Integrations as a
 * replacement — that answers "is this provider reachable", not "what am I
 * missing".
 *
 * The pixel panel's primary action SEEDS the boss's dispatch box with an exact
 * install contract. Modern has no consumer for `requestDispatchSeed` yet
 * (MD-94's Issues Assign S1 is the same gap, owned by another card), so here the
 * same prompt is copied to the clipboard instead of dropped into a box that no
 * longer exists. Either way the user still presses send: installing software
 * touches their machine and can need a password, so nothing is shelled out from
 * the renderer.
 */
const SECTIONS: { kind: ToolKind; title: string; blurb: string }[] = [
  { kind: 'prerequisite', title: 'Prerequisites', blurb: 'The groundwork everything else builds on.' },
  { kind: 'memory', title: 'Memory layer', blurb: 'Meaning-based recall across everything your agents learn.' },
  { kind: 'engine', title: 'Agent engines', blurb: 'The CLIs your agents run on. You need whichever ones you actually use — not all of them.' }
];

export function PrerequisitesSection() {
  const [tools, setTools] = useState<ToolStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try { setTools(await window.cth.toolsStatus()); }
    catch { setTools([]); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const missingEssential = (tools ?? []).filter((t) => !t.found && t.essential);

  const copySetup = () => {
    void navigator.clipboard.writeText(setupPrompt(missingEssential)).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); },
      () => { /* clipboard denied — every install command is on screen to copy */ }
    );
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Prerequisites"
        blurb="External tools this app leans on. Anything missing degrades a feature quietly rather than failing loudly, so this is where you check."
      />

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw /> {busy ? 'Checking…' : 'Re-check'}
        </Button>
        {missingEssential.length > 0 && (
          <Button size="sm" variant="outline" onClick={copySetup}>
            <Copy /> {copied ? 'Copied' : `Copy a setup request for ${missingEssential.length} missing`}
          </Button>
        )}
      </div>

      {tools === null
        ? <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        : SECTIONS.map((s) => {
          const rows = tools.filter((t) => t.kind === s.kind);
          if (rows.length === 0) return null;
          return (
            <Group key={s.kind} title={s.title} description={s.blurb}>
              {rows.map((t) => <ToolRow key={t.id} tool={t} />)}
            </Group>
          );
        })}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolStatus }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(tool.installCommand).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); },
      () => { /* the command is on screen either way */ }
    );
  };
  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{tool.label}</span>
        <Badge variant={tool.found ? 'secondary' : tool.essential ? 'destructive' : 'outline'}>
          {tool.found ? 'ready' : tool.essential ? 'missing' : 'not set up'}
        </Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{tool.why}</p>
      {/* Found: say WHERE, so "ready" is verifiable rather than trusted. */}
      {tool.found && tool.path && (
        <p className="truncate font-mono text-xs text-muted-foreground" title={tool.path}>{tool.path}</p>
      )}
      {tool.detail && <p className="text-xs text-muted-foreground">{tool.detail}</p>}
      {!tool.found && tool.installCommand && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border px-2 py-1 font-mono text-xs">
            {tool.installCommand}
          </code>
          <IconButton
            size="icon-xs"
            label={`Copy the install command for ${tool.label}`}
            side="left"
            onClick={copy}
          >
            <Copy />
          </IconButton>
          {copied && <span className="text-xs text-muted-foreground">copied</span>}
        </div>
      )}
      {!tool.found && !tool.installCommand && tool.note && (
        <p className="text-xs text-muted-foreground">{tool.note}</p>
      )}
    </div>
  );
}
