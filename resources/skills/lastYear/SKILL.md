---
name: lastYear
description: |
  Resolve "last year" to a concrete ISO date range relative to now — inclusive civil
  dates plus exact UTC instants. Read-only. Use before any task scoped to last year.
allowed-tools:
  - Bash
---

## /lastYear

Get the concrete date range for **the previous full calendar year** by running the bundled resolver:

```bash
node "$AGENT_DIR/.claude/skills/temporal/when.mjs" lastYear
```

It prints a human-readable line plus a JSON record:

- `start` / `end` — inclusive civil dates (`YYYY-MM-DD`) in your local timezone
- `startUtc` / `endExclusiveUtc` — the same window as a half-open `[start, end)`
  range of exact UTC instants, for timestamp-based queries
- `days`, `timezone`, `asOf` — the span, your timezone, and when this resolved

Use the returned dates as the time bounds for the task at hand. **Do not derive
dates by hand** — this resolver is the source of truth. For the full window list
or an arbitrary range (e.g. `last45days`, `last6months`), see the `/temporal` skill.
