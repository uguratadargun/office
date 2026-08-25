import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy } from 'react';
import {
  Building2,
  Users,
  ListChecks,
  MessagesSquare,
  Activity,
  Zap,
  Mic,
  CircleAlert,
  Plug,
  Code2,
  Settings,
  type LucideIcon
} from 'lucide-react';

/**
 * THE ONE PLACE THE MODERN UI'S NAVIGATION IS DECLARED.
 *
 * Every area (`modern/<area>/`) is owned by a different agent, and the shell is
 * owned by none of them — so this file is the single seam between the two. An
 * area lands by filling in its own row's `component`; nothing else in the shell
 * needs editing, and two areas landing at once conflict on one line each rather
 * than on `AppShell.tsx`.
 *
 * `component` is LAZY on purpose: the IDE pulls in Monaco (~9 MB) and the Floor
 * pulls in Pixi. A session that never opens the IDE must not pay for it, which
 * is the same reason the pixel `App.tsx` lazy-loads those two.
 *
 * A row with no `component` renders the placeholder card, so the shell is
 * complete and navigable from day one and an unfinished area is visibly
 * unfinished rather than a dead link.
 */
export interface NavEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The area's root view. Omit until the area lands. */
  component?: LazyExoticComponent<ComponentType>;
  /** One line for the placeholder card — say what will live here. */
  blurb?: string;
}

export const NAV: NavEntry[] = [
  {
    id: 'floor',
    label: 'Floor',
    icon: Building2,
    component: lazy(() => import('./views/FloorView').then((m) => ({ default: m.FloorView })))
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: Users,
    component: lazy(() => import('./agents/AgentsView').then((m) => ({ default: m.AgentsView })))
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: ListChecks,
    component: lazy(() => import('./tasks/TasksView').then((m) => ({ default: m.TasksView })))
  },
  {
    id: 'askme',
    label: 'Ask Me',
    icon: MessagesSquare,
    component: lazy(() => import('./askme/AskMeView').then((m) => ({ default: m.AskMeView })))
  },
  {
    id: 'monitor',
    label: 'Monitor',
    icon: Activity,
    component: lazy(() => import('./monitor/MonitorView').then((m) => ({ default: m.MonitorView })))
  },
  {
    // Issues and PRs are ONE entry: they are the same review queue seen from two
    // ends, and splitting them made the pixel UI's two tabs bounce.
    id: 'issues',
    label: 'Issues & PRs',
    icon: CircleAlert,
    // ONE entry, two segments (Issues | PRs) inside it — see modern/issues/SPEC.md.
    component: lazy(() => import('./issues/IssuesView').then((m) => ({ default: m.IssuesView })))
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Plug,
    component: lazy(() => import('./integrations/IntegrationsView').then((m) => ({ default: m.IntegrationsView })))
  },
  {
    id: 'triggers',
    label: 'Triggers',
    icon: Zap,
    component: lazy(() => import('./triggers/TriggersView').then((m) => ({ default: m.TriggersView })))
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: Mic,
    component: lazy(() => import('./realtime/VoiceView').then((m) => ({ default: m.VoiceView })))
  },
  {
    id: 'ide',
    label: 'IDE',
    icon: Code2,
    component: lazy(() => import('./ide/IdeView').then((m) => ({ default: m.IdeView })))
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    component: lazy(() => import('./settings/SettingsView').then((m) => ({ default: m.SettingsView })))
  }
];

export const DEFAULT_NAV_ID = NAV[0].id;

export function navEntry(id: string): NavEntry {
  return NAV.find((n) => n.id === id) ?? NAV[0];
}
