import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';

/**
 * ONE AREA'S FAILURE STOPS AT THAT AREA.
 *
 * Without this, an uncaught render error anywhere in a lazy view unmounts the
 * whole React tree and the window goes blank white — no message, no sidebar, no
 * way back. From the outside that is indistinguishable from "the app didn't
 * start", which is exactly how a Monaco theme error read during MD-89.
 *
 * Class component because that is still the only way to catch a render error;
 * `key` is the nav id, so navigating away and back gives a fresh instance
 * without the boundary having to watch the route itself.
 */
interface Props {
  /** Shown on the card so the user can say WHICH screen broke. */
  area: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ViewBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is the only record of what happened — the boundary swallows the
    // throw, so without this the error never reaches the console at all.
    console.error(`[modern] ${this.props.area} view crashed`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="p-6">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">{this.props.area} stopped</CardTitle>
            <CardDescription>
              Something in this screen threw while rendering. The rest of the app is unaffected —
              the other sections still work.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3">
            <pre className="max-h-40 w-full overflow-auto rounded-md bg-muted p-3 font-mono text-[12px] whitespace-pre-wrap">
              {error.message || String(error)}
            </pre>
            {/* Retry, not reload: a transient failure (a file that vanished, a
                git call that raced) clears on a re-render, and a full reload
                would cost every other area its state too. */}
            <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
              <RotateCcw /> Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
