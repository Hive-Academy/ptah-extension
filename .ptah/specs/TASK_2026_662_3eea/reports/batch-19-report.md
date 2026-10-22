# Batch 19 report

## Changed files

- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-state.service.ts:391,448,508,532 — kept the prior lane's two independent setting keys, sequencing guards and optimistic state; pause and telemetry now call settings:set followed by settings:get readBack.
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-state.service.spec.ts:515 — replaced obsolete pause RPC mocks with file-setting load, write/readBack, key independence, host-authoritative readBack and failure tests.
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.ts:171,805,1030 — retained the prior lane's telemetry switch, reduced its markup and state glue, corrected a template-string parse error from backticks in a comment, and kept it available while Skills is paused.
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts:234,327 — added the telemetry stub and interaction proof; corrected stale mock signatures and two required fixture fields in this owned spec.
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\dashboard\src\lib\services\thoth-status.service.ts:64,325,380,574 — removed candidate count and synthesis RPC dependency; reads pause and telemetry through settings:get and shows telemetry On/Off.
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\dashboard\src\lib\services\thoth-status.service.spec.ts:69,322,349 — replaced candidate and legacy settings mocks, updated summary expectations, and added telemetry off, failure isolation and stale-read coverage.

## Write paths and flags

- skillSynthesis.enabled -> settings:set -> settings:get readBack -> skillsEnabledCommitted/skillsEnabled signals -> Library pause switch and disabled manual actions. The dashboard reads the same key with settings:get for its Paused badge.
- skills.telemetry.enabled -> settings:set -> settings:get readBack -> telemetryEnabledCommitted/telemetryEnabled signals -> Library telemetry switch. The dashboard reads the same key with settings:get for its On/Off tile.
- UI flag: the Library header switch has an associated label, help text, native switch semantics, disabled state during save or unknown state, and an error alert. Its handler restores the DOM checkbox to committed signal state until the write settles.
- WRITE-PATH flag: each write touches exactly one key. Turning pause off does not write or gate telemetry or harvesting; the test verifies the telemetry key remains enabled. The old synthesis settings form remains pending the later Library reduction batch.

## Verification and handoff

- `rg -n "listCandidates|getSettings" libs/frontend/dashboard` returned zero hits.
- `git diff --check` reported no whitespace errors.
- No tests, Nx, Jest, build, lint or typecheck commands were run, per executor instruction. Scoped ptah diagnostics initially found a template parse error and stale owned spec types; those were corrected. The final scoped diagnostics request timed out at 45 seconds and reported four files unchecked.
- Outside ownership: `libs/frontend/dashboard/src/lib/services/thoth-status-pillars.spec.ts:11,55` still constructs `ThothSkillsSummary` with `pendingCandidates`, and its test at :53 expects the removed count. Scoped diagnostics reported two errors there. Recommended: assign that spec to a dashboard owner to change the fixture to `telemetryEnabled` and the assertion to On/Off; alternative: temporarily accept the failing spec until a later batch. I did not edit it because Batch 19 restricts file ownership.

## Decisions

- Use the existing dashboard Skills tile for telemetry On/Off after removing the candidate metric. Options were an empty tile or a telemetry status. The plan preserves telemetry and dashboard status; the latter keeps the tile useful. Reversible.
- Keep the old synthesis settings form calls in place for this batch. Options were to remove the entire form now or leave its later planned reduction intact. Plan line 119 assigns that larger removal to the Library host reduction, while Batch 19 names only the pause and telemetry controls. Reversible.
- Keep the prior lane's independent state API and trim its tab markup. It already implemented the exact two-key write/readBack path; the visual block had excess status decoration and a syntax error. Reversible.

## Fix round 1

- Defect: the dashboard pillar spec still constructed Skills summaries with the removed `pendingCandidates` field and expected a candidate count, causing its typecheck and test to fail.
- Change: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\dashboard\src\lib\services\thoth-status-pillars.spec.ts:12,54` now uses `telemetryEnabled` fixtures and asserts the Skills tile shows `On` or `Off` with description `Skill telemetry`.
- Verification: no tests, Nx or Jest commands were run; the orchestrator will run checks.
