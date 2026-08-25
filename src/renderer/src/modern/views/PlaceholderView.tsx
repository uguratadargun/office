import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

/**
 * What a nav entry renders until its area lands (see `modern/nav.ts`). It says
 * what will live here rather than "coming soon", so the shell is honest about
 * being a shell and an area's owner can read their own brief off the screen.
 */
export function PlaceholderView({ title, blurb }: { title: string; blurb?: string }) {
  return (
    <div className="p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{blurb ?? 'This area has not been built yet.'}</CardDescription>
        </CardHeader>
        <CardContent className="text-[13px] text-muted-foreground">
          The classic UI still has this screen — switch back in Settings while this one is being built.
        </CardContent>
      </Card>
    </div>
  );
}
