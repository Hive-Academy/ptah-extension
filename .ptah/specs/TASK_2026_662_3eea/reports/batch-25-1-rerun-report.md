## Files changed

- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`: refresh enhancement after saving its timeout.
- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts`: update the fake and assertion for that refresh.
- `libs/frontend/core/src/lib/services/providers-settings.types.ts`: remove judging and lane patch types and fields; retain the enhancement types and keys.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`: remove lane and judging stores, views, refresh methods, exports, and readiness checks.
- `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts`: remove obsolete lane and judging fixtures and assertions; retain enhancement, tier scope, and other tests.
- `libs/frontend/core/src/lib/services/providers-commit.service.ts`: remove lane and judging write operations.
- `libs/frontend/core/src/lib/services/providers-commit.service.spec.ts`: remove the judging operation test.

## Acceptance rg results

- `rg -n 'refreshJudging' libs apps tools`: 0 hits.
- `rg -n 'SkillLane|judgeProvider|judgeModel|enhanceTimeoutMs|Lanes' libs/frontend/core`: 0 hits.
- `rg -n 'skillSynthesis:(getLanes|setLanes)' libs/frontend/core`: 0 hits.
- `rg -n 'ProvidersJudgingSettings|ProvidersJudgingPatch|refreshLanes|refreshJudging' libs apps`: 0 hits.
- `git diff --check` for the seven edited files: clean.
- No test, typecheck, lint, build, serve, or e2e command was run, as instructed.

## Decisions

- Kept the enhancement slice and `skills.enhancement.provider/model/timeoutMs` settings.
- Kept the S3 scope tests and the `PendingSettingsTab` union, including `judging-enhancement`.
- Narrowed the combined lane and tier spec to test tier scope after removing the lane behavior.

## Clarifications Needed

- `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts:1629` still supplies `lanes: { judge: { provider: '' } }` to the Providers settings patch. It is outside the seven allowed files. The harness owner needs to remove or migrate that scenario; its typecheck may fail after this patch.
