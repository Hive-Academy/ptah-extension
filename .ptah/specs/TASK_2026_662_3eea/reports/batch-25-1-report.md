## Changed files

- None. Task 25.1 stopped before editing because a live consumer of an exported service method is outside the five owned files.

## Shared-contract greps

- `rg -n 'ProvidersJudgingSettings|ProvidersJudgingPatch' libs apps tools -g '!**/migrations/00[0-5]*'`: hits only in the owned core type and service files.
- `rg -n 'refreshJudging' libs apps tools -g '!**/migrations/00[0-5]*'`: live hit at `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:164` (`(timeoutSaved)="state.refreshJudging()"`). Its spec has a fake at line 118 and an assertion at line 488. The same method is defined and used in the owned core service and spec.
- Other `.lanes()` hits in chat-ui and tribunal-panel refer to unrelated state, not `ProvidersSettingsStateService`. No outside `refreshLanes` consumer was found.
- This is a batch-default shared-contract stop: the chat component and spec are neither Task 25.1 owned files nor already cut. Removing `refreshJudging` would break the live enhancement timeout handler and its test.

## Post-cut grep

- Not applicable: no cut was made. The requested core grep still has live obsolete hits. No test, Nx, Jest, lint, typecheck, build or e2e command was run.

## O20 projects

- `rg -n 'ProvidersSettingsStateService' libs apps --glob '*.spec.ts'` hits projects `libs/frontend/chat`, `libs/frontend/core`, `libs/frontend/memory-curator-ui`, `libs/frontend/setup-wizard`, and `libs/frontend/webview-e2e-harness`. A later API cut must gate these projects under O20, subject to each project's applicable check.

## Preserve check

- The existing `enhancement` slice and `skills.enhancement.provider/model/timeoutMs` code remain intact because no source was edited. The S3 scope tests remain intact. `PendingSettingsTab` and shared RPC types were not edited.

## Decisions

- Stop before deleting `refreshJudging` or the judging slice. Options: remove the method and break chat; retain a compatibility shim; or first switch the chat enhancement timeout handler and spec to `refreshEnhancement()`. Evidence: the live template and test hits above; `refreshEnhancement` already exists in the core service. Recommend the third option. Reversible: yes.

## Proposed Removals

- After the chat owner updates the live handler and its test, remove the lane and judging slices, their refresh methods and calls, `SkillLane*Dto` imports, old judge/timeout settings, lane section ids, and corresponding owned specs. Preserve the enhancement slice, its keys and S3 scope tests.

## Clarifications Needed

1. May the chat owner update `orchestration-settings.component.ts:164` and its spec to use `refreshEnhancement()` before Task 25.1 resumes? (Recommended: yes; alternative: reassign those two files to this batch with an updated gate.)
