# Skills

**What the agents on this machine can already do, and what else they could.**

Ported from the classic `components/SkillsTab.tsx` (MD-159, inventory card G).
Modern had no Skills surface at all, which does not lose data — the reason it
was S2 and not S1 — but it makes agent behaviour **unexplainable**: a skill is
instructions that fire inside an agent, and with no list of them "why did it
just do that?" has no answer in this UI.

## Two questions, one search box

| Mode | Question | Source |
|---|---|---|
| Installed | *why did my agent just do that?* | `cth.skillsLocal()` |
| Browse | *what else is out there?* | `cth.skillsCatalog(force)` |

They share the search box because the user's way of asking either one is
usually a single word. They do **not** share a filter set: publisher and
category are facts about the catalog, so those selects only exist in Browse.

The catalog is fetched **when Browse is first opened**, never on mount — seeing
what is installed must not cost a network round trip.

## Rules this area does not get to relax

- **Installing is a decision, not a click.** A skill runs inside an agent
  holding the user's tools and keys. Every catalog row names its **publisher**
  and links out; nothing is installed without a press on that row.
- **Uninstall is armed** (`DestructiveButton` → `@/components/ui/destructive`),
  like every other destructive action in the app.
- **Bundled skills offer no remove button.** They ship inside the app and are
  re-copied into every agent on spawn, so "removing" one deletes a folder that
  comes straight back. The row says *Ships with the app* instead of offering a
  button that lies.
- **The render cap is stated, never silent.** `CATALOG_RENDER_CAP` puts 300 of
  ~1,200 rows in the DOM; the line above the list always prints the real
  matching total and says when it is showing fewer.
- **`unsupported` is not an ordinary failure.** It means the entry has no
  downloadable source, so a retry can never work — the row says to open the
  page instead of inviting a retry loop.

## Where the logic lives

`skillsModel.ts`, pure and tested (`test/modern-skills.test.cjs`):
`filterLocal`, `filterCatalog` (**one** predicate returning the matching list
AND the capped slice — the classic tab derived the rows and the count through
two separate copies of the same chain), `facetCounts`, `isRemovable`,
`installedEmptyCopy`, `catalogSourceNote`, `installOutcome`, `setRow`.

Row action state is **keyed by row id** (catalog url / local path). A single
panel-wide error makes one refused install look like the whole catalog being
down, and the user refreshes instead of reading the reason.

## Not built

- No per-agent scope. `skillsLocal(cwd)` accepts one, and the classic tab passed
  the open agent's cwd. This is a nav AREA, not an agent pane — there is no
  "current agent" here, and inventing one would make the list silently depend on
  a selection made on another screen. A project-scoped view belongs on the
  agent, if anyone asks for it.
