# Batch 27 report

## Changed files

- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:20,75-110,115-155` — Skills renders the Library directly, retains pause/telemetry, the diverged deep link, and the VS Code notice; removes the old tabs, stat strip, diagnostics, curator action, and synthesis settings form.
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts:31-143` — replaces tests of the deleted parent UI with Library, switches, deep link, and VS Code notice checks.
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts:104-123,389-549` — removes the unused synthesis settings signal and `loadSettings`/`getSettings` path; retains independent pause and telemetry settings:get/set readback.
- `libs/frontend/skill-synthesis-ui/src/index.ts:34-35` — removes the `SkillSynthesisLiveService` barrel export.
- `libs/frontend/skill-synthesis-ui/src/services.ts:1-17` — removes the `SkillSynthesisLiveService` services entry export and stale eager-handler documentation.

## Removed from the Skills tab

| Item | Plan reference |
| --- | --- |
| Recommended, Sessions, Activity, and old Settings subviews, including their navigation | Plan row 24; plan line 119 Library-only host; G2 |
| Candidate/Promoted/Rejected stat strip and candidate actions | Plan row 24 and line 119: pipeline-only non-Library UI |
| Run Curator, activity indicator, diagnostics, queue, digest, and spec controls | Plan row 24 and line 119: non-Library polling and pipeline UI |
| Old synthesis settings form Save/get/update calls | Plan line 119 and Batch 27 carried item from Batch 19 |
| Parent injection of `SkillSynthesisLiveService` | Plan row 24 and Batch 27 R6 |

## Preserve check

| Required item | Where it is now |
| --- | --- |
| Library Skills/Agents/Commands tabs with counts | `components/clones/skill-clones-view.component.ts:119-122,655-659`, hosted at parent `:106` |
| Clone cards and detail drawer | `components/clones/skill-clones-view.component.ts:312,352` |
| History and revert | `components/clones/skill-clones-view.component.ts:355,375,761` |
| Enhance preview, diff, and explicit Save (O14) | `components/clones/skill-clones-view.component.ts:380-386,813-834`; `components/clones/enhance-preview-drawer.component.ts:124-127,166-171` |
| Agent model editor | `components/clones/agent-model-editor.component.ts:153`; Library `AgentModelsStore` at `skill-clones-view.component.ts:94,463` |
| Scorecard | `components/clones/skill-clones-view.component.ts:314,357-363,985-1023` |
| Pause switch and manual enhancement guard | Parent `skill-synthesis-tab.component.ts:75,108-110,121`; `skills-pause-switch.component.ts`; state `skill-synthesis-state.service.ts:420-477` |
| Telemetry switch and independent setting | Parent `skill-synthesis-tab.component.ts:78-105,140-151`; state `skill-synthesis-state.service.ts:389-413,506-549` |
| VS Code desktop notice | Parent `skill-synthesis-tab.component.ts:28-53` |

## Post-cut greps

- `rg -n 'getSettings|updateSettings'` on the state service and parent: **zero hits**.
- `rg -n 'SkillSynthesisLiveService' libs apps --glob '!**/skill-synthesis-live.service*'`: no barrel or parent import remains. Hits remain in orphan SU integration spec, stale state/spec comments, and `apps/ptah-electron-e2e/src/specs/thoth/message-handlers-eager.spec.ts:6,32,61,79`; also a stale backend digest comment. The external e2e test is a live assertion of curator push behavior and is outside batch ownership.
- G2 `rg -n 'refreshSuggestions|listSuggestions|skill-diagnostics-rpc.service|skill-synthesis-live.service' libs/frontend/skill-synthesis-ui/src/lib`: **nonzero**. The state service still calls `listSuggestions` at `:571`; the orphan Suggestions view calls its state API at `suggestions/skill-suggestions-view.component.ts:416-541`. `SkillSynthesisLiveService` calls state `refreshSuggestions`, `refreshCandidates`, `loadStats`, and `refreshDigest` at `skill-synthesis-live.service.ts:114-166`.
- `ptah_get_diagnostics` on all five edited files: **zero diagnostics in requested files**; 11 sibling diagnostics remain, including stale orphan specs and two shared BigInt target errors. No nx/Jest/typecheck/build/e2e command was run, per batch instruction.

## O20 projects

`rg -n 'SkillSynthesisStateService' libs apps --glob '*.spec.ts'` finds **skill-synthesis-ui**, **thoth-shell**, and **ptah-electron-e2e**. The current checkout has no dashboard spec hit. The thoth-shell fixture is owned by batch 28 and was not edited.

## Decisions

- **Candidate stat strip removed.** Options were retain or remove; plan line 119 makes Library the sole host, and the strip displays pipeline candidate counts. Reversible by restoring it if a Library-specific metric is specified.
- **Preserved orphan state methods temporarily.** Options were delete them now (breaks the included `src/**/*.ts` typecheck because the orphan Suggestions component and live service call them), keep their real implementation, or add stubs (forbidden). Kept real implementation; this leaves Batch 27's zero-obsolete-RPC requirement **incomplete**. Reversible when the orphan callers are deleted in batch 57 or their ownership is widened.
- **Removed only the live-service barrel exports.** Source and contract grep found no runtime import outside the owned files, but an active Electron e2e test still asserts the old push behavior. Its owner must update or retire that test; this batch may not edit it.

## Proposed Removals

None beyond the pipeline-only UI named above. The orphan Suggestions and live-service files, their tests, and the external Electron e2e assertion need coordinated ownership before removing their state API and old RPC calls.

## Clarifications Needed

1. How should the remaining G2 state calls be retired while `skill-suggestions-view.component.ts` and `skill-synthesis-live.service.ts` must remain and `tsconfig.lib.json` includes every `src/**/*.ts` file? **(Recommended)** Move their deletion and corresponding state API cut into the same later batch; alternatively widen this batch to the orphan files and tests.
2. Who owns the live `apps/ptah-electron-e2e/src/specs/thoth/message-handlers-eager.spec.ts` assertion after the live service is detached? **(Recommended)** Give it to the E2E cleanup batch; alternatively widen this batch to that spec.