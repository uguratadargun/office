# MD-87 — modern/onboarding

The full spec for this area (feature inventory, IPC calls, wireframe, open questions) lives in
`../settings/SPEC.md` — Settings and Onboarding share the same config surface, the same `audience`
copy register and the same shadcn primitive set, so splitting them across two documents would
have duplicated the whole key table.

Onboarding-specific summary — 7 steps `persona → welcome → home → orchestrator → repos →
permissions → done`; calls `chooseFolder()`, `ensureHarnessHome()`, `setLoginItem()` (reconcile to
the OS return value, never to local state), `setNotifications()`, `openExternal()`, and ONE final
`updateConfig({ onboardingComplete, audience, harnessHome, registeredRepos, autoMode, godProvider,
godModel, telemetryEnabled })`. Guards to preserve: whitespace-only home is rejected and bounces to
the `home` step; Next is disabled on `persona` until an audience is chosen; the container scrolls
(step 2 lists 8 engines + a model select — taller than a 1080p window).
