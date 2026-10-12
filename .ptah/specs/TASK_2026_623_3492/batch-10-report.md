## Backend implementation — `TASK_2026_623_3492`, batch 10

**Tasks completed**: Task 10.1 — a lookup-level case proving the lookup never passes `refresh`.

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\cli-agent-runtime\src\lib\cli-agents\limits\lane-limit-lookup.service.spec.ts — added one case: `never forwards \`refresh\` to the plan-usage caches when called as \`agent.limits(rows)\` calls it`.

No production code changed. No other file created or modified, apart from this report.

**Call shape verified**: `agent-namespace.builder.ts:499-502` (`limits: async (rows) => getLaneLimits(rows)`) and `ptah-api-builder.service.ts:750` (`getLaneLimits: this.laneLimitLookup?.lookup.bind(...)`) show that `ptah_agent_list` / `agent.limits(rows)` call `LaneLimitLookupService.lookup(rows)` with rows only and no options. The new case calls it the same way.

**What the case asserts** (six rows covering every read path in `readLane`, `lane-limit-lookup.service.ts:172-201`):

- Provider reads: codex, opencode, antigravity, and a Ptah CLI Ollama Cloud lane.
- A ledger-only read: a Ptah CLI run with a recorded Claude owner, read through `snapshotWithoutRead`.
- A lane with no owner: copilot.

It checks:

- The lookups come back as `ok, ok, ok, ok, ok, no-owner`.
- `getOwnerSnapshot` is called exactly 4 times. On every call, `Object.keys(options)` equals `['signal']`, `options` has no `refresh` property, and the target has no `refresh` property.
- `ledger.snapshotFor` is called once, with the owner key as its only argument.

**Production check (no forwarding found)**: `lane-limit-lookup.service.ts:186` calls `this.snapshots.getOwnerSnapshot(plan.target, { signal })`. The only way `refresh` reaches `PlanUsageService` is `PlanUsageRequestOptions.refresh` (`auth-providers/src/lib/quota/plan-usage.service.ts:107`), and the lookup never sets it. `LaneLimitLookupOptions` (`lane-limit-lookup.service.ts:65-70`) has no `refresh` field either. Nothing needed to be stopped or escalated.

**Risk handling — HIGH "$limits privacy / side effects"**: this is the lookup-level guard named in the batches.md plan validation. If the lookup ever adds `refresh` to its options, the `Object.keys(options) === ['signal']` assertion fails. Adding `refresh: false` would also fail it, because the assertion requires the key to be absent. This matches decision #18: the lookup may read the 30 s cache and never forces a refresh. Tasks 9.1 and 7.1 cover the other side effects (spawn, stop, session) and the privacy side; this case does not.

**Stack observed**: tsyringe `@injectable` service with constructor injection (`lane-limit-lookup.service.ts:110-120`). The spec builds the service directly with `jest.fn` collaborators through the existing `createHarness` (`spec:61-90`). I used that harness unchanged.

**Verification**:

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-limit-lookup.service.spec.ts --coverage=false --maxWorkers=2`
  - The first run failed before any test ran: it could not locate module `marked`, because the worktree has no node_modules.
  - Re-run with the accepted Batch 8 override, passed on the command line only (no config file edited): `--moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'`.
  - Result: `Test Suites: 1 passed; Tests: 11 passed, 11 total` (10 existing cases plus the new one).
- `npx nx lint @ptah-extension/cli-agent-runtime --parallel=1` → "Successfully ran target lint", 0 errors and 45 warnings. All 45 warnings are in other files.
- `npx eslint` on the changed spec → no output, exit 0.
- Typecheck was not run, because the batch does not list it.

**Plan deviations**: none.

**Out-of-scope observations**: none.
