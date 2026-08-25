# Office — Modern UI design system

The second UI, at `src/renderer/src/modern/`. The pixel UI (`DESIGN.md`, `--cth-*`) is untouched and
still the default; the user switches with `ui.mode` in Settings and the window reloads. **The two never
render together**, so this system shares nothing with the pixel one — not a token, not a font, not a
reset. Do not reach for a `--cth-*` variable in here.

## References

ChatGPT desktop, Claude desktop, Codex app. What we are taking from them: a calm neutral ground with one
near-black/near-white primary, hairline borders instead of shadows, generous vertical rhythm inside a
dense information layout, and chrome that disappears — the content is the only thing with contrast.

## Palette

Neutral greys in shadcn's own variable names, in `modern/tokens.css`. Light on `:root`, dark on
`:root[data-cth-theme='dark']` — the same attribute the pixel UI's `design/theme.ts` stamps, so the one
theme toggle drives both UIs. **Both palettes define the same list, value for value** (same rule as
`DESIGN.md` §3): a variable in one and not the other paints a light value on a dark ground.

| Role | Light | Dark | Use |
|---|---|---|---|
| `--background` / `--foreground` | `#FFFFFF` / `#18181B` | `#131316` / `#FAFAFA` | app ground, body text |
| `--card` / `--popover` | `#FFFFFF` | `#1B1B1F` | raised surfaces, menus |
| `--primary` / `--primary-foreground` | `#18181B` / `#FAFAFA` | `#FAFAFA` / `#18181B` | the one filled control |
| `--secondary` / `--muted` / `--accent` | `#F4F4F5` | `#232327` | quiet fills, hover, selected row |
| `--muted-foreground` | `#5F5F68` | `#A1A1AA` | secondary text, hints (≥ 5.3:1 on every surface) |
| `--border` / `--input` | `#E4E4E7` | `#2C2C31` | every hairline |
| `--ring` | `#A1A1AA` | `#52525B` | focus |
| `--destructive` | `#CC2020` | `#EF4444` | destructive only, never decoration |
| `--sidebar*` | `#FAFAFA` ground | `#0F0F12` ground | left nav, one step off `--background` |

No brand hue, no gradients, no colour that only means "pretty". Status colour is the one exception and
comes from `--destructive` / `--muted-foreground` / a single green, never a sixth accent.

## Type, spacing, radii, borders

- **Font**: `Inter` (already linked in `index.html`, so free) then the system stack. `--font-mono` is
  JetBrains Mono, for paths, ids, code and terminal only.
- **Scale**: 13 (`text-xs`: meta, hints, badges) / **14 (UI default = `<body>` = `text-sm`: controls, rows,
  copy)** / 16 (`text-base`: section title) / 20 (`text-xl`: page title). The steps are pinned in
  `modern.css` (`@theme { --text-xs … }`), so a `text-xs` in any component resolves to 13px, never to
  Tailwind's 12 — **nothing in this UI is set below 13px** (MD-101: 52–69% of the characters on a screen
  are `text-xs`, so that step *is* the UI's size). Weight 400 body, 500 for labels and active nav, 600 for
  page titles. Nothing bold, nothing uppercase, no letter-spacing. **Never `text-[13px]`** or any other
  literal that is a step of the scale — write the step, or the scale cannot move (the test fails on it).
- **Rendering**: no `-webkit-font-smoothing: antialiased`. On macOS Chromium it strips 10–38% of the ink
  from every glyph (measured) and buys nothing — there is no subpixel AA to switch off. `text-muted-foreground`
  is held to ≥ 5.3:1 on every surface, primary text to ≥ 7:1; `test/modern-theme-contrast.test.cjs` is the
  gate for both palettes and for the scale.
- **Spacing**: Tailwind's 4px scale. Control height 32px (`h-8`), compact 28px, page gutter 24px,
  card padding 16px, gap between rows 8px, between sections 24px.
- **Radii**: `--radius: 8px`. Buttons/inputs `rounded-md` (6px), cards/menus `rounded-lg` (8px), pills
  `rounded-full`. Never a square corner — that is the pixel UI's language, not this one.
- **Borders and depth**: 1px `--border`, always. Shadows only on things that float over content
  (popover, dialog, dropdown) and only `shadow-sm`/`shadow-md`. A card gets a border, not a shadow.

## Components

Only shadcn primitives from `modern/components/ui`. **That directory is owned by MD-84 and 26
primitives are already in it** — button, input, textarea, label, select, checkbox, switch, tabs, card,
badge, table, progress, sheet, dialog, alert-dialog, dropdown-menu, popover, tooltip, separator,
scroll-area, skeleton, collapsible, resizable, command, sonner, alert. Do **not** run `shadcn add`
yourself: every area would collide on the same files. Need one that is missing? Ask god.
**Never hand-roll a control**, and never restyle a primitive past what `className` can say.

| Need | Primitive |
|---|---|
| action | `Button` (`default` = the one primary per view; `outline`, `ghost`, `destructive`) |
| text entry | `Input`, `Textarea` + `Label` |
| choice | `Select` (>4 options), `RadioGroup`, `Switch` (instant effect), `Checkbox` (staged) |
| grouping | `Card`, `Separator`, `Tabs` |
| status | `Badge` (`secondary` by default; `destructive` only for real failure) |
| overlay | `Dialog` (decision), `Sheet` (side panel), `Popover`, `DropdownMenu`, `Tooltip` |
| lists | `ScrollArea`, `Table` |
| waiting | `Skeleton`, never a spinner over existing content |
| icons | `lucide-react` at `size-4` (16px), `size-3.5` in dense rows |

**Do**: one primary action per view · empty states that say what to do next · `text-muted-foreground` for
anything secondary · keyboard reachable, `focus-visible` ring left alone · `Tooltip` for icon-only buttons.
**Don't**: inline `style=` (that is the pixel UI's mechanism — this one is utilities only) · a colour
outside the table above · nested cards · a border *and* a shadow on the same element · animation over 150ms.

## Dark mode

`@custom-variant dark` matches `data-cth-theme='dark'` on `<html>`, not a `.dark` class. Define every
colour as a token in `modern/tokens.css` and use it through a utility (`bg-card`, `text-muted-foreground`).
A `dark:` utility in a component is a smell — it means the value belongs in the token file. Check both
themes before you push; the shell's topbar toggle is the fastest way.

## What the shell owns

`AppShell` mounts three things exactly once, so no area has to (or gets to):

- **The nav** — `modern/nav.ts`. Your area lands by filling in its row's lazy `component`; that is the
  only shell file you touch, so two areas landing together conflict on one line each.
- **The single `<Toaster/>`** (sonner). Call `toast()` from anywhere; a second mount doubles every toast.
- **One fullscreen overlay host** — `modern/overlay.tsx`. A fullscreen surface renders as
  `<Overlay>…</Overlay>` from wherever its state lives and portals above the shell. One host, so two
  overlays can never fight over z-index.

- **One right-hand inspector host** — `modern/inspector.tsx`, the same shape as the overlay and for the
  same reason. An area that needs a panel BESIDE its own `<main>` renders `<Inspector>…</Inspector>`
  from inside its own chunk and portals into the shell's `<aside>`; it is resizable and remembers its
  width (it holds a terminal), and unmounting it — including navigating away — closes it. It used to be
  an `inspector` render prop on `AppShell`, which put the selection state of whichever area had one in
  the shell.

`AppShell` still takes a `status` (topbar) slot. Use these rather than inventing a second column — that
is what keeps every screen's gutters lined up.

## Boundaries

Tailwind (preflight included) is imported from `modern/App.tsx` only, so it loads with the modern root and
never reaches the pixel UI. Nav entries go in the one registry, `modern/nav.ts`; each area owns
`modern/<area>/` and nothing else. Feature inventory of what each area must cover:
`docs/superpowers/plans/2026-08-25-shadcn-migration.md`.
