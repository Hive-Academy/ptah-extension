# Batch 41j code logic re-review

**Verdict: APPROVED. Score: 8/10.** The batch 41i Moderate finding is closed. The generic `settings:set` handler now refuses the decision-model key before persistence and returns `success: false` for valid or malformed values (`libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:172-199`). This is a scoped, exact-key change; the Decision model row retains its validating save path. The score is above 7 because the defect is closed with direct negative and unrelated-key tests, and below 9 because those tests mock the workspace provider and scoped TypeScript diagnostics were unavailable.

## Findings by severity

- **Critical:** None in this change.
- **Serious:** None in this change.
- **Moderate:** None in this change. The prior false-success path is closed (`settings-rpc.handlers.ts:76-78,178-183`; `settings-rpc.handlers.spec.ts:353-387`).
- **Minor, known and out of scope:** `settings:import` writes config entries directly through `workspaceProvider.setConfiguration` without this deny set (`settings-rpc.handlers.ts:385-395`). A crafted export can therefore still store a malformed decision-model value. This path predates commit `578885dc2`; it is not a regression in the `settings:set` fix.

## Five logic questions

1. **Silent success:** The previously reported generic save no longer returns success: the exact-key guard returns `success: false` before the writer (`settings-rpc.handlers.ts:178-199`). The known import path above remains separate.
2. **Unexpected user action:** Calling `settings:set` with either a valid or invalid decision-model selection is now refused with an explanatory error and no write (`settings-rpc.handlers.spec.ts:353-373`). The row saves through `agent:setConfig` (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:629-657`).
3. **Wrong input data:** The dedicated selection writer validates with `DecisionModelSelectionSchema` before calling the workspace provider (`libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:153-167`). An invalid draft cannot take the generic save path; an invalid stored value still reads as unset with a warning (`decision-model.config.ts:129-145`).
4. **Dependency failure:** The guard has no storage dependency. For other keys, persistence remains inside the existing `try`/`catch`, which returns `success: false` on rejection (`settings-rpc.handlers.ts:193-208`). A failed `agent:setConfig` call is presented as a failed row save (`decision-model-row.component.ts:633-655`).
5. **Unstated case:** `settings:get` still reads the key through the workspace provider because the deny applies only in `registerSet` (`settings-rpc.handlers.ts:127-149,166-183`). Import can still write it as noted above.

## Scope and verification

The deny set contains only `agentOrchestration.decisionModel` (`settings-rpc.handlers.ts:76-78`). The existing file-based allow-list still precedes it, and all other keys continue into advanced-setting validation and the same writer (`settings-rpc.handlers.ts:172-199`). The added spec checks refusal of both valid and unusable selections, no provider call, and successful writing of an unrelated file-based key (`settings-rpc.handlers.spec.ts:353-387`). The row calls `agent:setConfig` (`decision-model-row.component.ts:629-657`), whose decision-model path invokes `setSelection` (`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:856-875,881-885`). No new silent failure was found in the changed path.

The one permitted scoped Jest run passed: 1 suite, 38 tests. `ptah_get_diagnostics` twice reported TypeScript checking unavailable after its timeout for the two changed files; it did not report a pass or a diagnostic. No build, e2e, or other project test was run.

## Decisions

- Keep `settings:import` outside this revision's verdict. Options were expanding the fix or reviewing only the `settings:set` regression. The task expressly identifies import as a pre-existing, out-of-scope path, and this commit changes only `registerSet` plus its spec (`settings-rpc.handlers.ts:166-210,385-395`). Reversible: yes.
