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
| `--muted-foreground` | `#71717A` | `#A1A1AA` | secondary text, hints |
| `--border` / `--input` | `#E4E4E7` | `#2C2C31` | every hairline |
| `--ring` | `#A1A1AA` | `#52525B` | focus |
| `--destructive` | `#DC2626` | `#EF4444` | destructive only, never decoration |
| `--sidebar*` | `#FAFAFA` ground | `#0F0F12` ground | left nav, one step off `--background` |

No brand hue, no gradients, no colour that only means "pretty". Status colour is the one exception and
comes from `--destructive` / `--muted-foreground` / a single green, never a sixth accent.

## Type, spacing, radii, borders

- **Font**: `Inter` (already linked in `index.html`, so free) then the system stack. `--font-mono` is
  JetBrains Mono, for paths, ids, code and terminal only.
- **Scale**: 12 / **13 (UI default)** / 14 (body) / 16 (section title) / 20 (page title). Weight 400 body,
  500 for labels and active nav, 600 for page titles. Nothing bold, nothing uppercase, no letter-spacing.
- **Spacing**: Tailwind's 4px scale. Control height 32px (`h-8`), compact 28px, page gutter 24px,
  card padding 16px, gap between rows 8px, between sections 24px.
- **Radii**: `--radius: 8px`. Buttons/inputs `rounded-md` (6px), cards/menus `rounded-lg` (8px), pills
  `rounded-full`. Never a square corner — that is the pixel UI's language, not this one.
- **Borders and depth**: 1px `--border`, always. Shadows only on things that float over content
  (popover, dialog, dropdown) and only `shadow-sm`/`shadow-md`. A card gets a border, not a shadow.

## Components

Only shadcn primitives from `modern/components/ui`. Missing one? `npx shadcn@latest add <name>` —
`components.json` already points there. **Never hand-roll a control**, and never restyle a primitive
past what `className` can say.

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

## Boundaries

Tailwind (preflight included) is imported from `modern/App.tsx` only, so it loads with the modern root and
never reaches the pixel UI. Nav entries go in the one registry, `modern/nav.ts`; each area owns
`modern/<area>/` and nothing else. Feature inventory of what each area must cover:
`docs/superpowers/plans/2026-08-25-shadcn-migration.md`.
