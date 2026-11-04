# Implementation brief — TASK_2026_874_93f0

Worktree: D:\projects\ptah-extension\.claude-worktrees\welcome-vitals-data
Read first: research-report.md and decisions.md in this folder (the approved design).
Deliverable: implementation-report.md in this folder — changed files, what each change does,
tests added, exact verify command(s) and their tail result.

## FIX 1 (backend) libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts
Today `invalidateCache()` (~line 289) nulls `detectionInFlight`, so `agent:detectClis`
(agent-rpc.handlers.ts:1258 calls invalidateCache then detectAll) starts a second concurrent scan
while `provider:getPlanLimits` scans; and detectAll's `finally` (~line 162) nulls whatever promise
is current. Change to a generation counter:
- Private `generation` number. `invalidateCache()` clears detectionCache and modelCache and
  increments generation. It does NOT null detectionInFlight.
- `detectAll()`: cache hit -> return it. In-flight -> return it (join). Otherwise start a scan and
  remember the generation at start. The scan writes detectionCache only if the generation is
  unchanged when it finishes (find where doDetectAll writes detectionCache and gate that write).
  `finally` clears detectionInFlight only if it is still this same promise.
- Result: a call after invalidateCache joins the running scan (no doubled spawns), and a scan
  that started before invalidation is not cached, so the next call after it rescans.
Regression tests in the spec next to the service (create only if absent):
(a) invalidateCache during a scan -> a concurrent detectAll joins the same scan (each adapter
detect called once); (b) after that scan resolves, the next detectAll scans again;
(c) normal caching still works without invalidation.

## FIX 2 (frontend) libs/frontend/chat/src/lib/services/vitals/welcome-vitals.store.ts
The welcome loads plan limits once. Beside the existing recents-error retry effect on the shared
clock, add a retry that calls PlanLimitsStore load again while `loadError()` is set or
`snapshot().discoveryIncomplete` is true (do not stack a load while one is in flight if the store
exposes a loading signal). Make the plan ring show the `error` state when
`PlanLimitsStore.loadError()` is set, instead of the empty "no plan window" placeholder
(toPlanRingLoad never reads loadError; usage-vitals.view.ts ~184). Minimal change, existing
patterns. Do NOT touch UsageVitalsCache or analytics:spendSummary (another PR changes them).
Regression tests in welcome-vitals.store.spec.ts (and the view spec if the view mapping changes).

## FIX 3 (backend) libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts
`registerListInstalled` answers a thrown scan with `{ skills: [] }`, which HostInventoryCache
caches as a real zero for 60 s. First find every frontend caller of 'skillsSh:listInstalled'
(grep the string under libs/frontend and apps). Make the RPC fail (rethrow, or the error shape
sibling handlers in that file use) so callers see an error. If a caller would break visibly
(e.g. marketplace installed page), handle it there minimally and list it in the report.
Update skills-sh-rpc.handlers.spec.ts.

## Rules (mandatory)
- Angular: standalone, signals, inject(). No `any`, no `@ts-ignore`, no `as unknown as`.
  Injected Logger, no console.*. Never swallow errors silently.
- Never run npm install (node_modules is a junction to the main checkout). Never run
  build/serve/dev/e2e/package or workspace-wide checks. Never nx run-many across projects you
  did not change.
- Verify only with `npm run verify -- -p <projects>` using the real Nx project names of the libs
  you changed (see each lib's project.json). Run once in the foreground with a long timeout and
  tail the output. Confirm the header shows the requested project count.
- Electron is the priority host.
- Do not commit, push, or open a PR. Only the orchestrator commits.
- End with: WROTE: <path> + one-line verdict.
