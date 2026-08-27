---
name: thisQuarter
description: Resolve "this quarter" to an exact ISO date range. Use before any task scoped to this quarter.
allowed-tools:
  - Bash
---

## /thisQuarter

Get the concrete date range for **this quarter so far (quarter start → today)** by running the bundled resolver:

```bash
node "$AGENT_DIR/.claude/skills/temporal/when.mjs" thisQuarter
```

It prints a human-readable line plus a JSON record:

- `start` / `end` — inclusive civil dates (`YYYY-MM-DD`) in your local timezone
- `startUtc` / `endExclusiveUtc` — the same window as a half-open `[start, end)`
  range of exact UTC instants, for timestamp-based queries
- `days`, `timezone`, `asOf` — the span, your timezone, and when this resolved

Use the returned dates as the time bounds for the task at hand. **Do not derive
dates by hand** — this resolver is the source of truth. For the full window list
or an arbitrary range (e.g. `last45days`, `last6months`), see the `/temporal` skill.
