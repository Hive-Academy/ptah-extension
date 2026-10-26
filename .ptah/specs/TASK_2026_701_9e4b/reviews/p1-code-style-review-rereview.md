# P1 code-style re-review

One-round static re-review of the two findings in `p1-code-style-review.md`, using the current files and fix-round A, B and follow-up reports. Paths below are relative to the worktree root. The reported commit is `16042c885`; revision identity was not independently verified because Git is prohibited.

| Finding | Status | Evidence file:line |
| --- | --- | --- |
| S1 / earlier finding 1 — Blocking: persisted-config predicate promises an unvalidated type | FIXED | `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:95` defines the persisted Zod schema; `:115` infers the accepted stored shape; `:122` normalizes missing legacy lists into the required output fields. `:77` and `:87` explicitly discard invalid timestamp metadata. Strict and lenient reads parse unknown input at `:148` and `:158`. The versioned home schema at `:193` is parsed without the earlier assertions at `:256`. The normalized output interface remains explicit, but the persisted input no longer relies on a false type predicate. Focused cases exist in `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.spec.ts:139`, `:159` and `:236` (inspected, not executed). |
| S2 / earlier finding 2 — Serious: loader options allow a half-configured state | FIXED | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:90` requires both `harnessRootOf` and `homeStorage`; `:549` makes the complete options argument optional. `:557` branches on the options object, `:558` retains the workspace-storage capability check, and `:566` warns when that capability is absent. Omission still selects legacy behavior. |

## New defects

1. None found at Blocking or Serious severity in the inspected changed code.

## Supporting structure checks

- **DI:** `libs/backend/harness-sync/src/lib/repair/blocked-repair.service.ts:122` accepts the manifest store through its constructor. `libs/backend/harness-sync/src/lib/di/register.ts:212` supplies that dependency in the matching fourth position. No new service-locator dependency is introduced into repair.
- **Import boundaries:** the fingerprint and retirement helpers use Node APIs and local harness-sync modules (`libs/backend/harness-sync/src/lib/health/approval-fingerprint.ts:45`; `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:36`). The loader receives a root resolver rather than importing harness-sync (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:91`). `userLayerPassFailures` is exported through `libs/backend/agent-generation/src/index.ts:119` and consumed through the package API by Electron (`apps/ptah-electron/src/activation/plugin-activation.ts:28`), VS Code (`apps/ptah-extension-vscode/src/activation/plugin-activation.ts:15`) and CLI (`libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:153`).
- **Type precision:** retirement and overwrite results are discriminated unions (`libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:82`, `:95`, `:191`). The failure aggregator takes a precise `Pick` of actual result types (`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:208`). Pending publication data has a schema-derived type (`libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts:209`, `:217`).
- **New-file size and responsibility:** `approval-fingerprint.ts` is 125 lines and implements one traversal/fingerprint operation (`libs/backend/harness-sync/src/lib/health/approval-fingerprint.ts:56`). `artifact-retirement.ts` is 550 lines, organized around detachment, restoration, retirement and supporting filesystem operations. Its shared overwrite gate (`libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts:201`) is consumed by both targets (`libs/backend/harness-sync/src/lib/targets/claude-target.ts:428`; `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:939`). Its size alone does not establish a Serious structure defect; the extraction centralizes the common lifecycle.

No source files were modified. No tests, builds, diagnostics, workspace-wide commands or Git commands were run. Fixer-reported verification is not claimed as independently reproduced. This verdict covers the earlier style findings and the requested focused structure checks, not complete runtime correctness or unread portions of large existing files.

Verdict: APPROVED
