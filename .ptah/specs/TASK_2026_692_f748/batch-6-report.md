# Batch 6 report — TASK_2026_692_f748

## Task 6.1

Added `compaction.idleCompactionEnabled` and `compaction.idleCompactionMinTokens` after the existing compaction budget keys in `KNOWN_CONFIG_KEYS`. The export spec asserts both keys are present; its duplicate-key guard also passes.

Files modified:
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\types\settings-export.types.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\types\settings-export.types.spec.ts

## Task 6.2

Added `getIdleCompactionConfig(): { enabled: boolean; minTokens: number }`. It reads both settings on each call, uses `FILE_BASED_SETTINGS_DEFAULTS` for unset/null or invalid values, accepts only booleans for enabled and integer token minimums at least 100,000, and warns once per key/type/value through `warnOnce`. Invalid minimums return 200,000 without clamping. Tests cover defaults, live rereads, valid boundary and larger values, malformed values, distinct warning values, and successful provider construction with the boolean default alongside numeric budgets.

Files modified:
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts
- D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.spec.ts

## Verification

`NX_NO_CLOUD=true` was set. The specified Jest arguments and Nx typecheck were run sequentially in PowerShell; `Select-Object -Last` supplied the requested output tails because this shell has no `tail` command. Final command exit code: 0. Output tail:

```text
Test Suites: 2 passed, 2 total
Tests:       57 passed, 57 total
Snapshots:   0 total
Time:        6.791 s
Ran all test suites matching libs/backend/agent-sdk/src/lib/types/settings-export.types.spec.ts|libs/backend/agent-sdk/src/lib/helpers/compaction-config-provider.spec.ts.
> nx run @ptah-extension/agent-sdk:typecheck
> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json
NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk
Run duration:      7.0s
Cache:             0/1 hit (0%)
```

Jest also emitted a nonfatal Node ES-module warning while loading `jest.config.ts`. After a formatting-only change to the spec, `ptah_get_diagnostics` found 0 errors and 0 warnings in the final files and project siblings.

## Risks and assumptions

- Boolean default / `BUDGET_KEYS` (this batch): `BUDGET_KEYS` still enumerates only the four numeric budgets. The new spec proves the provider constructs with the shared boolean default and that `getConfig()` still reads a numeric budget. Idle values use separate validation.
- Malformed persisted values (this batch): both readers accept unknown input; invalid values fall back to shared defaults, warn once per distinct key/type/value, and never clamp the token minimum. Unset/null values use defaults without warning.
- Settings export/write-path risk (this batch's portion): the export allow-list now includes both keys, with a spec. Platform-core write allow-list and UI descriptors were supplied by Batch 5; end-to-end write-path tracing remains with the planned Mode 3 review.
- Shared advanced-settings count: owned by Task 5.1, outside Batch 6; no files outside this batch were edited.
- A1 anchor skew, A2 coordinator `/compact`, A3 event order, A4 usage split, A5 webview completion: live probe/QA and later batches own these assumptions. This batch changes no runtime send or event path.
- Direct-construction spec compatibility, service spec size, router admission race, `postCompactSeen` transition, pending-send liveness, timer handles, lifecycle-manager size, and UI completion evidence: each is assigned to later batches or visual review in plan validation. Batch 6 introduces none of those paths and made no out-of-scope edits.

## Decisions

- Used shared platform-core defaults and checked their types at the read boundary; this follows implementation-plan.md:632-637 and keeps malformed persisted settings fail-open. Reversible.
- Treated null like unset, matching existing provider budget reads and the plan's unset fallback. Reversible.
- Used the existing `warnOnce` key/type/value pattern for warning deduplication. Reversible.
