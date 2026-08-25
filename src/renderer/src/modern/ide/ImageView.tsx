import { useState } from 'react';
import { useWorkspaceImage } from '@/hooks/useWorkspaceImage';
import { formatBytes } from '@shared/imageTypes';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { cn } from '../lib/cn';

/**
 * Image tab body. The bytes-to-`blob:`-URL work — and its revocation, which
 * matters because blob URLs outlive the elements that reference them and IDE
 * tabs open and close all day — is `useWorkspaceImage`, reused verbatim from the
 * pixel IDE. Only the chrome is rebuilt.
 */
export function ImageView({ root, rel, onViewSource }: {
  root: string;
  rel: string;
  /** SVG only: the return leg of the source ⇄ picture round trip. */
  onViewSource?: () => void;
}) {
  const img = useWorkspaceImage(root, rel);
  // Fit first: the common case is a full-screen screenshot far wider than the
  // pane, and 1:1 would open every tab in the top-left corner of a picture
  // nobody can see the shape of.
  const [fit, setFit] = useState(true);

  if (img.status === 'loading') return <Skeleton className="m-4 h-64" />;
  if (img.status === 'error') {
    return <p className="p-4 text-sm text-destructive">{img.error ?? 'Could not read this image.'}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <span className="truncate font-mono">{rel}</span>
        <span className="ml-auto shrink-0">{formatBytes(img.size)}</span>
        {onViewSource && (
          <Button size="xs" variant="ghost" onClick={onViewSource}>view source</Button>
        )}
        <Button size="xs" variant="outline" aria-pressed={fit} onClick={() => setFit((v) => !v)}>
          {fit ? 'Actual size' : 'Fit'}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <img
          src={img.url}
          alt={rel}
          className={cn('mx-auto block', fit ? 'max-h-full max-w-full object-contain' : 'max-w-none')}
        />
      </div>
    </div>
  );
}
