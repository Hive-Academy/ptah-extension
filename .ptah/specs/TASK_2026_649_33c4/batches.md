# Batches — TASK_2026_649_33c4

Total batches: 11 | Complete: 0/11 | Executor for every batch: codex | Status: all pending

## Plan validation

Status: PASSED WITH RISKS. Gate 2 approved `implementation-plan.md`; `decisions.md` D12 resolves (a1), (b1), (c1). Gate 1.7 amendments at `design-spec.md:5-9` govern. The 60 rows in `parity-inventory.md:19-78` are the preserve list. The chosen split keeps the approved B1 → B3 and B2/B3 → B4 dependency order, with B1 and B2 starting independently.

- Existing plan files were checked against the worktree. New paths are the turn-attribution service/spec; embed chrome token; builder records, hydration, helper, sidebar and leave-dialog files/specs; preview spec; and route spec. `rpc-harness.schemas.spec.ts` does **not** exist: extend existing `rpc-harness.types.spec.ts` for shared schema coverage. No other listed production path is missing. Source: `implementation-plan.md:48-60`.
- `HarnessWorkflowService` imports are confined to builder production files, its tests and two builder barrels; `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:54` has a comment only. `apps/ptah-electron-e2e/src/specs/harness/new-project.spec.ts:29-30,349-381` asserts the obsolete localStorage key and belongs to B4c. `registerWorkflowSurface` is called by the old workflow service at `harness-workflow.service.ts:317,610` and by its state spec; the operation stream methods are confined to the state service/spec. The shared `WorkflowSessionClaimService` and `StreamingSurfaceRegistry` still have Chat, Tribunal and Apps callers; CLI still consumes `harness:flat-stream` (`apps/ptah-cli/src/cli/output/event-pipe.ts:41-42`). Preserve all three. Source: `implementation-plan.md:14,55-60`, `parity-inventory.md:73-74`.
- **Integration risk:** removing state stream methods before deleting `HarnessWorkflowService` would fail typecheck. B3 builds the new services and UI as additive, independently compilable units. B4c is the sole owner of the state refactor, old transport deletion, page conversion and barrel removal. This moves the plan's B3 state edit to the final integration seam while preserving the architecture and file-disjoint ownership. Source: `harness-builder-state.service.ts:64-75,471-567`, `harness-workflow.service.ts:316-317,609-610`, `implementation-plan.md:56,60`.
- `apps/ptah-electron-e2e` has typecheck and lint targets but no unit `test` target. B4c updates its stale spec and checks typecheck/lint only; no e2e run is authorized in this mode. A later visual reviewer must take the dark/light, docked/sheet and 480px-height screenshots required by `implementation-plan.md:60`; jsdom structure tests cannot prove pixel scroll.
- D8 token and chat barrel text must match `decisions.md:18-35` byte for byte and coexist with task 677. B2 owns those files alone. No batch touches `app.config.ts`, ChatView, app-shell, shared launcher, shared claim/stream registries or backend flat-stream. Source: `implementation-plan.md:28,52,60`.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep every batch pending for orchestrator spawn | Explicit task instruction overrides the generic Mode 1 first-batch-in-progress template. | Yes |
| Put state cleanup and old transport deletion in B4c | Earlier B3 deletion would break the still-live old workflow caller; `harness-workflow.service.ts:317,610`. B3 builds additive dependencies; B4c removes old path atomically. | Yes |
| Put the old Electron e2e localStorage assertion in B4c | `new-project.spec.ts:29-30,349-381` depends on the deleted key. It is a test update, without running e2e. | Yes |
| Use one backend provenance phase, one embed phase and one builder phase | B1a-d share a contract, B2 is independent, B3/B4 form one combined frontend diff. The plan's B1/B2/B3/B4 edges and the file ownership below support this order. | Yes |

## Schedule and review

| Batch | Phase | Depends on | May run with | Status | New public API | Only types/tests/docs |
| --- | --- | --- | --- | --- | --- | --- |
| B1a | backend | none | B1d, B2 | pending | yes | no |
| B1b | backend | B1a | B1d, B2 | pending | no | no |
| B1c | backend | B1b | B1d, B2 | pending | no | no |
| B1d | backend | none | B1a, B1b, B1c, B2 | pending | no | no |
| B2 | embed | none | B1a-d | pending | yes | no |
| B3a | builder | B1c, B1d | B3b, B2 | pending | no | no |
| B3b | builder | B1c, B1d | B3a, B2 | pending | no | no |
| B3c | builder | B3a, B3b, B2 | none | pending | no | no |
| B4a | builder | B3c, B1d | B4b | pending | no | no |
| B4b | builder | B3c, B2 | B4a | pending | no | no |
| B4c | builder | B4a, B4b | none | pending | yes | no |

Every parallel pair is file-disjoint and has no dependency edge. Run only **one heavy Nx/Jest check at a time across all lanes**, even when edits run in parallel. All batches change runtime code; none qualifies for the types/tests/docs-only review exemption. No per-batch code review. Request one code-logic review of the combined backend diff after B1c and B1d, one of the embed diff after B2, and one of the combined builder diff after B4c. Request a style review for the new public API in B1a, B2 and B4c. The orchestrator records implementer/reviewer families and uses a different family when available.

### B1a — proposal wire contract — pending

Depends on: none. Executor: codex. Suggested plan B1; `implementation-plan.md:13,27,35,46-48`. Four production files across two projects.

Files:

- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\shared\src\lib\types\rpc\rpc-harness-proposal.types.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\shared\src\lib\types\rpc\rpc-harness.schemas.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\shared\src\lib\types\messages\payload-map.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\platform-core\src\interfaces\harness-proposal-store.interface.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\shared\src\lib\types\rpc\rpc-harness.types.spec.ts`

Tasks:

1. Add backward-compatible revision and optional `turnStartedAt` shape to the proposal record, parser and push payload. Old merged-only records parse as one unattributed revision; keep legacy merged projection. Follow `implementation-plan.md:13,27,34-35,48`, `rpc-harness.schemas.ts:465-477`, `payload-map.ts:218-223`.
2. Extend the existing proposal-store interface with explicit captured turn input and synchronous capture/release capability, without importing rpc-handlers. Follow `implementation-plan.md:13,25,35,48`, `harness-proposal-store.interface.ts:4`.

Acceptance: old/new schemas parse; malformed revision data is rejected; types expose the saved revision on the push path; no write-time timestamp is substituted for a missing turn start. Parity: 35-38. Tests: extend the existing shared spec for old/new records, optional attribution and push payload. Nx projects: `@ptah-extension/shared`, `@ptah-extension/platform-core`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/platform-core --parallel=1
npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/platform-core --parallel=1
npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/platform-core --parallel=1 --maxWorkers=2
```

### B1b — captured turns and durable revisions — pending

Depends on: B1a. Executor: codex. Suggested plan B1; `implementation-plan.md:13,25,34-35,48`. Three production files in one project.

Files:

- new `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\harness\config\harness-proposal-turn-attribution.service.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\harness\config\harness-proposal-turn-attribution.service.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\harness\config\harness-proposal-store.service.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\harness\config\harness-proposal-store.service.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\harness\di.ts`

Tasks:

1. Register one SDK `UserPromptSubmit` subscriber and retain bounded session/workspace callback history with invocation references. Capture only a uniquely attributable start; overlapping callbacks yield absent attribution. Existing fan-out pattern: `turn-change-set-recorder.service.ts:140-151,171-183`; plan `implementation-plan.md:25,35,48`.
2. Accept the frozen start as a save argument; atomically persist revision, completion and legacy merged view; return exactly the saved revision for broadcast. Preserve old records as unattributed and protect in-flight captures across abort/terminal events. Existing store `harness-proposal-store.service.ts:53-99,141-157`; plan `implementation-plan.md:34-35,48`.

Acceptance: T1 capture survives T3 callback before T1 save; ambiguous or absent capture stays absent; abort/terminal does not erase an in-flight frozen value; old records remain readable; one save yields one durable revision. Parity: 35, 37-38. Tests: new attribution spec plus store persistence/ordering/legacy spec. Nx project: `@ptah-extension/rpc-handlers`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers --parallel=1
npx nx run-many -t lint -p @ptah-extension/rpc-handlers --parallel=1
npx nx run-many -t test -p @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2
```

### B1c — tool invocation provenance — pending

Depends on: B1b. Executor: codex. Suggested plan B1; `implementation-plan.md:25,35,48`. Two production files in one project.

Files:

- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\harness-namespace.builder.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\harness-namespace.builder.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.spec.ts`

Tasks:

1. Resolve caller SDK session and pinned workspace synchronously at `proposeConfig` invocation, freeze the unambiguous timestamp before `await`, pass it explicitly through the namespace dependency and release its capture in `finally`. Do not read a mutable latest-turn slot during save. Follow `implementation-plan.md:25,35,48`, `harness-namespace.builder.ts:1084-1114`.
2. Wire the platform-core interface/token to the saved-revision broadcaster and keep call-site context boundaries; follow `implementation-plan.md:13,25,48`, `ptah-api-builder.service.ts:862-887,1048-1075`.

Acceptance: T1 invocation then T3 callback then T1 save persists T1; ambiguous call persists no start; push payload matches saved revision; failure releases capture. Parity: 35, 38, 48. Tests: update both focused specs for ordering, ambiguity and failure. Nx project: `@ptah-extension/vscode-lm-tools`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/vscode-lm-tools --parallel=1
npx nx run-many -t lint -p @ptah-extension/vscode-lm-tools --parallel=1
npx nx run-many -t test -p @ptah-extension/vscode-lm-tools --parallel=1 --maxWorkers=2
```

### B1d — context-only Configure preamble — pending

Depends on: none. Executor: codex. Suggested plan B1; `implementation-plan.md:26,33,48`. Three production files in one project.

Files:

- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\handlers\harness-rpc.schema.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\handlers\harness-rpc.schema.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\handlers\harness-rpc.handlers.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\handlers\harness-rpc.handlers.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\harness\ai\harness-workflow-prompt.service.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\backend\rpc-handlers\src\lib\harness\ai\harness-workflow-prompt.service.spec.ts`

Tasks:

1. Add an additive context-only workflow-prompt request form while retaining nonempty-intent validation for old callers. Follow `implementation-plan.md:26,33,48`, `harness-rpc.schema.ts:88-91`, `harness-workflow-prompt.service.ts:17-125`.
2. Wire the handler to compose a hidden Configure context preamble, including empty-workspace context, without sending it as a visible message. Preserve New Project backend seed/plugin/toolchain behavior. Follow `implementation-plan.md:26,33,48`, `harness-rpc.handlers.ts:815-909`.

Acceptance: old prompt callers pass; context-only Configure branch works with empty workspace; New Project result remains complete. Parity: 6, 16-17, 55. Tests: schema, handler and composer specs, including retained `harness-llm-runner.service.spec.ts` through the project test command. Nx project: `@ptah-extension/rpc-handlers`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers --parallel=1
npx nx run-many -t lint -p @ptah-extension/rpc-handlers --parallel=1
npx nx run-many -t test -p @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2
```

### B2 — session embed chrome — pending

Depends on: none. Executor: codex. Suggested plan B2; `implementation-plan.md:16,28,50-52`. Three production files in one project.

Files:

- new `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\chat\src\lib\tokens\session-embed-chrome.token.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\chat\src\index.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\chat\src\lib\components\templates\session-embed.component.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\chat\src\lib\components\templates\session-embed.component.spec.ts`

Tasks:

1. Write the D8 token file and barrel line **byte-identically** to `decisions.md:18-35`; if 677 has already added them, verify exact equality and avoid duplicate export. Follow `implementation-plan.md:28,52`.
2. Add `chrome` input with `full` default and provide its value beside `SESSION_CONTEXT` in the embed's child injector. Keep projection and visible-tab registration/cleanup intact. Follow `implementation-plan.md:16,52`, `session-embed.component.ts:32-45,55-63,76-124`.

Acceptance: bare child injector for builder, full for canvas, registration preserved. Parity: 20-24, 30-31, 58. Tests: focused embed spec plus existing chat tests. Nx project: `@ptah-extension/chat`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/chat --parallel=1
npx nx run-many -t lint -p @ptah-extension/chat --parallel=1
npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2
```

### B3a — tab records and proposal hydration — pending

Depends on: B1c, B1d. Executor: codex. Suggested plan B3; `implementation-plan.md:12,34-36,40,54-56`. Three production files in one project. Keep current state/old workflow APIs untouched for B4c.

Files:

- new `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-builder-records.service.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-builder-records.service.spec.ts`
- new `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-proposal-hydration.service.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-proposal-hydration.service.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-rpc.service.ts`

Tasks:

1. Store Zod-validated, versioned user snapshot, one draft pointer per canonical workspace and tab, and stack profile. Invalid key/version/shape clears only that record; tab close/delete and replace-draft purge local records. Follow `implementation-plan.md:12,35-36,40,56`, `harness-builder-state.service.ts:75-103`.
2. Hydrate only the bound SDK session's proposal revisions; order by attributed turn then stable revision ID, apply unattributed revisions before attributed ones, and never override newer per-field user choices. Buffer live pushes, de-duplicate, guard stale async generation and omit workspace-latest fallback. Follow `implementation-plan.md:34-35,56`, `harness-rpc.service.ts:301`.
3. Add only missing typed RPC wrappers needed by these services, preserving existing helper methods. Follow `implementation-plan.md:56`, `harness-rpc.service.ts:64,301`.

Acceptance: live and reload agree; T1 late write cannot replace T3; foreign push ignored; invalid storage removed; no cross-tab resurrection. Parity: 7, 11-13, 34-38, 43, 59. Tests: new records and hydration specs, including invalid keys/version, overlapping reads, buffered push and user-choice precedence. Nx project: `@ptah-extension/harness-builder`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t lint -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t test -p @ptah-extension/harness-builder --parallel=1 --maxWorkers=2
```

### B3b — helper results and preview — pending

Depends on: B1c, B1d. Executor: codex. Suggested plan B3; `implementation-plan.md:35-36,40,54-56`. Two production files in one project. Make preview inputs compatible with the old view until B4c; no old state-file edit here.

Files:

- new `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-helper.service.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-helper.service.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-config-preview.component.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-config-preview.component.spec.ts`

Tasks:

1. Run helper requests serially through existing typed RPC methods, exposing busy/result/error and an explicit Add operation. Cover suggest-config, design-agents, generate-skills, generate-document, analyze-intent, discover-mcp, generate-prompt and generate-claude-md; leave search/create-skill to agent tools. Follow `implementation-plan.md:40,56`, `harness-rpc.service.ts:80-94,128-169,216-280`, `decisions.md:11`.
2. Refactor preview presentation for persona/goals, agents/skills, prompt/MCP and document viewer/copy/add without binding it to obsolete stream transport. Maintain compatibility with the existing view until B4c. Follow `implementation-plan.md:35-36,56`, `harness-config-preview.component.ts:17,189`, `design-spec.md:159-215`.

Acceptance: helper output is not applied before Add; one helper at a time; errors are scoped; document can be copied and explicitly added; preview renders empty/populated values. Parity: 34, 49-54, 56. Tests: new helper and preview specs. Nx project: `@ptah-extension/harness-builder`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t lint -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t test -p @ptah-extension/harness-builder --parallel=1 --maxWorkers=2
```

### B3c — sidebar and leave choice — pending

Depends on: B3a, B3b, B2. Executor: codex. Suggested plan B3; `implementation-plan.md:10-12,35-36,40,54-56`. Two production files in one project. Build standalone components without editing public barrels or the old page.

Files:

- new `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-builder-sidebar.component.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-builder-sidebar.component.spec.ts`
- new `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-builder-leave-dialog.component.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-builder-leave-dialog.component.spec.ts`

Tasks:

1. Build OnPush sidebar with required `tabId`, fixed strip and sole bounded `flex-1 min-h-0 overflow-y-auto` body for docked and sheet layouts. Include preview, stack profile fallback, presets, helpers, health, stats, one Apply button, actual paths/warnings and dismissible inline error. Use existing records/hydration/helper services and RPC; the page owns tab binding. Follow `implementation-plan.md:10-12,35-36,40,56,60`, `design-spec.md:104-238`, D11.
2. Build builder-only Save as draft / Discard / Cancel dialog with focus trap, Escape=Cancel and focus return; emit choice and leave orchestration to B4c. Follow `implementation-plan.md:32-33,36,56,60`, `design-spec.md:253-289`.

Acceptance: Apply targets pinned root and preserves preview on failure; presets overlay IDs and retain others; all helper actions exposed; tab statistics and health display; short-height structural scroll assertions pass; dialog keyboard/focus behavior passes. Parity: 7, 12-13, 25, 33-34, 39-47, 49-54, 57. Tests: two new component specs with structural 360/400/720/960-width and 480px-height cases; no jsdom pixel-scroll claim. Nx project: `@ptah-extension/harness-builder`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t lint -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t test -p @ptah-extension/harness-builder --parallel=1 --maxWorkers=2
```

### B4a — entry handoff and Hub behavior — pending

Depends on: B3c, B1d. Executor: codex. Suggested plan B4; `implementation-plan.md:9,30-33,36,38-40,58-60,170`. Three production files in one project. Do not change Hub layout/cards/styles; D12 permits only existing-pattern warning/error lines and copy.

Files:

- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-workflow-request.service.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-workflow-request.service.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-workflow-message.handler.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-workflow-message.handler.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\setup-hub.component.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\setup-hub.component.spec.ts`

Tasks:

1. Replace AppState handoff with builder-local tab entry using `TabManagerService.createTab/setWorkflow`, pinned root, first-message preamble, route mode/tab ID and explicit landed/cancelled/failed. Same-mode running tab or draft resumes without duplicate send. Store one cross-mode pending intent in adapter, with synchronous duplicate-click guard. Copy validated intake to entry arguments **before** clearing intent, then start New Project only after old leave settles; seed remains hidden and visible summary sends once. Follow `implementation-plan.md:9,19-21,30-33,58-60,170`, `harness-workflow-request.service.ts:21-63`.
2. Keep Hub cards/intake and existing confirm, changing only its copy to say it opens leave choices. New Project over Configure goes through that confirm then the running builder leave dialog; Configure over New Project goes directly there. Cancel preserves run, no early abort/start. Show a dismissible persistent Hub warning after abort failure using existing alert style (a1). Follow `implementation-plan.md:32-33,58-60,155-159`, `setup-hub.component.ts:1107-1131,1298-1317,1397-1467`, D12.
3. Relay validates mode/workspace and calls the adapter; malformed relay remaining on Hub shows a minimal existing-style error line (c1), while landed-route errors use builder notice. Follow `implementation-plan.md:22,40,58-60,155,161`, `harness-workflow-message.handler.ts:49-86`, D12.

Acceptance: both handoff directions wait for Save/Discard, Cancel never calls start, pending intent survives Hub unmount but clears before destination navigation, failure rolls back only new state, one visible intake send, same-mode resume works, warning/error lines dismiss, Hub design remains. Parity: 1-10, 16-18, 27-29, 43, 59. Tests: update three existing specs for same-mode, both cross-mode directions, duplicate click, abort failure, malformed relay and intake preservation. Nx project: `@ptah-extension/harness-builder`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t lint -p @ptah-extension/harness-builder --parallel=1
npx nx run-many -t test -p @ptah-extension/harness-builder --parallel=1 --maxWorkers=2
```

### B4b — route and host height contract — pending

Depends on: B3c, B2. Executor: codex. Suggested plan B4; `implementation-plan.md:21,23,58-60`. Two production files across two projects.

Files:

- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\apps\ptah-extension-webview\src\app\app.routes.ts`
- new test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\apps\ptah-extension-webview\src\app\app.routes.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts`

Tasks:

1. Add parameterized `harness-builder/:mode/:tabId` lazy route while retaining Setup Hub route and settled-route persistence; preserve route restore after reload and invalid-parameter safe handling by the page. Follow `implementation-plan.md:21,58-60`, `app.routes.ts:118-138`.
2. Add `min-h-0` to Electron outer row and configuration host only; retain the rest of the shell. Follow `implementation-plan.md:23,60`, `electron-shell.component.ts:276,303-310`.

Acceptance: parameterized URL resolves builder, route restoration retains mode/tab ID; ancestors bound height; no changes to ChatView/app-shell. Parity: 11, 29, 33, 60. Tests: new route spec for parameter route/lazy chunk and existing chat host specs. Nx projects: `ptah-extension-webview`, `@ptah-extension/chat`.

Verify:

```sh
npx nx run-many -t typecheck -p ptah-extension-webview @ptah-extension/chat --parallel=1
npx nx run-many -t lint -p ptah-extension-webview @ptah-extension/chat --parallel=1
npx nx run-many -t test -p ptah-extension-webview @ptah-extension/chat --parallel=1 --maxWorkers=2
```

### B4c — page integration and private transport removal — pending

Depends on: B4a, B4b. Executor: codex. Suggested plan B3/B4 integration; `implementation-plan.md:10-14,32-36,40,54-60`. Five production files in one library plus a stale e2e spec. This is the **only** owner of both `libs/frontend/harness-builder/src/index.ts` and `services.ts`.

Files:

- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-builder-state.service.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-builder-state.service.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-builder-view.component.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-builder-view.component.spec.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\components\harness-builder-view.prompt-isolation.spec.ts`
- delete `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-workflow.service.ts`
- delete test `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\lib\services\harness-workflow.service.spec.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\index.ts`
- modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\libs\frontend\harness-builder\src\services.ts`
- test modify `D:\projects\ptah-extension\.claude-worktrees\task-647-setup-hub-chat-sessions\apps\ptah-electron-e2e\src\specs\harness\new-project.spec.ts`

Tasks:

1. Refactor state in place around tab-keyed signals, records/hydration and user-choice precedence, Apply to pinned root, presets, health and stats. Remove `HarnessSurfaceFacade`, builder-only `registerWorkflowSurface`, operation stream routing and old localStorage path now that old workflow is deleted. Follow `implementation-plan.md:12,34-36,40,54-60`, `harness-builder-state.service.ts:64-75,471-567`.
2. Replace old builder composer/transcript with `ptah-session-embed chrome="bare"` and new sidebar/leave dialog. Bind route tab once, validate workflow tag and pinned root, ignore unrelated active-tab switches, show safe missing/wrong-tag and Retry cards, wire Save/Discard/Cancel, Stop, X/open-chat and dismissible notices. Constrain host `height:100%; min-height:0; overflow:hidden`; docked/sheet body owns scroll. Follow `implementation-plan.md:10,16,23,32-36,38-40,58-60`, `harness-builder-view.component.ts:68,82-88,194-198,385-397,470-502`.
3. Delete only builder-private workflow transport and obsolete spec; remove its exports and expose new page/sidebar/services from the two barrels. Update the old Electron spec's localStorage/replay assumptions to normal tab/session restore assertions. Keep shared claims/registry and CLI flat-stream. Follow `implementation-plan.md:14,55-60`, `src/index.ts:1-16`, `src/services.ts:21-27`, `new-project.spec.ts:29-30,349-381`.

Acceptance: ordinary chat stream/cards/composer/model/effort/Stop/reload work; own-session proposal hydration and Apply remain pinned; no duplicate run; both leave choices and abort warning behave; route rejects wrong tag; all 60 parity rows have either the scoped proof above or a retained test named in `implementation-plan.md:68-129`; no builder-private claim/stream caller or old storage key remains. Tests: update state/view/prompt-isolation specs and stale Electron spec; include 360/400/720/960-width plus 480px-height structural assertions, while visual reviewer later proves pixel scrolling. Nx projects: `@ptah-extension/harness-builder`, `ptah-electron-e2e` (typecheck/lint); unit-test project: `@ptah-extension/harness-builder`.

Verify:

```sh
npx nx run-many -t typecheck -p @ptah-extension/harness-builder ptah-electron-e2e --parallel=1
npx nx run-many -t lint -p @ptah-extension/harness-builder ptah-electron-e2e --parallel=1
npx nx run-many -t test -p @ptah-extension/harness-builder --parallel=1 --maxWorkers=2
```

### Next action: spawn B1a, B1d, B2 on codex
