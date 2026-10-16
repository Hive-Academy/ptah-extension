# Final Code Logic Review — `TASK_2026_646_136a`, Batch 38c

**Verdict: NEEDS_REVISION — 6/10.** One Moderate failure path remains in the corrected drain. The route gate and store-resolution changes close their targeted defects. This score is above 5 because the ordinary and tested failure paths are sound, and below 7 because a warning-sink failure can skip Electron's remaining teardown.

**Review family:** reviewer: codex/OpenAI; implementer: Anthropic subagent.

| 38c item | Status | Evidence |
| --- | --- | --- |
| Logic N-1: route character and token gate | **CLOSED** | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts:90-93,116-126` checks both limits; `tool-result-budget.ts:87-105` supplies the same budget; `libs/backend/tool-output-reducers/src/lib/output-budget/apply-output-budget.ts:159-171` uses the same checks before returning whole text. |
| Logic N-2: store-resolution failure is a tool error on HTTP and stdio | **CLOSED** | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.handler.ts:45-66` invokes the resolver inside `try`; `protocol-dispatcher.ts:2806-2813` and `mcp-stdio/agent-tool.dispatcher.ts:345-357` pass the resolver and map failure to tool errors. |
| Style N1: one self-bounded, non-rejecting drain | **PARTIAL** | The common registration and timeout are at `libs/backend/lane-outcomes/src/lib/di/start.ts:118-165`; all three hosts call the registered disposer (`apps/ptah-extension-vscode/src/main.ts:206-218`, `apps/ptah-electron/src/activation/shutdown.ts:278-285`, `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts:138-147`). The warning calls at `start.ts:112-114,134-138` can throw, violating the non-rejecting contract; see defect 1. |
| Style N2: generic teardown verb | **CLOSED** | `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts:62-64,78-92,138-147` uses only `disposeAll` and `dispose`. |
| Style N3 and S3: load-bearing shutdown comments | **CLOSED** | `apps/ptah-electron/src/activation/shutdown.ts:238-285,401-413,561-577` explains the guarded reap, drain and synchronous path; `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:431-442` restores the child-process, proxy and SQLite order rationale. |
| Comment Minors M-a, M-b, M-c, M-e | **CLOSED** | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.ts:44-48`, `tool-result-budget.ts:77-104`, `libs/backend/lane-outcomes/src/lib/di/tokens.ts:14-18`, and `apps/ptah-electron/src/activation/shutdown.ts:103` have corrected descriptions; the VS Code alias is absent at `apps/ptah-extension-vscode/src/main.ts:206-213`. |
| Comment Minor M-d: duplicated cleanup rationale | **CLOSED** | `libs/backend/lane-outcomes/src/lib/di/start.ts:38-40,55-66,92-101` centralizes error conversion and callback unsubscribe. The separate public-export question was outside the comment-only 38c item. |

## Defects

1. **Moderate — a failing warning sink rejects the drain and skips Electron teardown.** `libs/backend/lane-outcomes/src/lib/di/start.ts:109-115,129-142` catches a drain rejection but calls `logger.warn` inside that catch; it also calls `logger.warn` after a timeout without guarding the call. If the output channel fails while a pending journal write rejects or times out, the warning throws and the promised `dispose()` rejects, contrary to `start.ts:29-35`. Electron awaits it at `apps/ptah-electron/src/activation/shutdown.ts:282-287`; the rejection prevents the subsequent SQLite close, CLI registry disposal and diagnostics disposal (`:287-295`). `runDeferredDisposal` catches the rejection and still quits (`:494-512`), so the omitted cleanup is not retried. The new tests at `libs/backend/lane-outcomes/src/lib/di/start.spec.ts:95-132` use a warning stub that never throws, leaving this boundary unexercised.

## Five logic questions

1. **Silent failure:** on the defect 1 path, `runDeferredDisposal` catches the rejection and reissues quit (`apps/ptah-electron/src/activation/shutdown.ts:494-512`), although its SQLite and registry steps were skipped (`:282-295`). The ordinary over-budget route result now reports an error (`route-tool-handlers.ts:119-126`).
2. **User action:** quitting Electron while a lane-outcome drain fails, with a warning sink that also fails, triggers defect 1 (`start.ts:109-142`; `shutdown.ts:282-295`).
3. **Wrong-answer input:** a token-dense routing roster under 64,000 characters but over 25,600 tokens now returns a tool error (`route-tool-handlers.ts:90-93,119-126`), rather than a successful cut JSON prefix; no new wrong-answer data case was established in 38c.
4. **Dependency failure:** a throwing outcome-store resolver becomes `isError: true` inside `handleOutcomeReportToolCall` (`outcome-report.handler.ts:50-66`) and reaches HTTP and stdio as a tool error (`protocol-dispatcher.ts:2806-2813`; `agent-tool.dispatcher.ts:345-357`). A throwing warning dependency during drain remains defect 1.
5. **Unspecified requirement:** shutdown still needs to complete cleanup when logging itself fails. The drain's explicit non-rejecting contract (`start.ts:29-35`) already implies this; no new product scope is proposed.

## Scope and verification

Reviewed `86c2954a7..f4cd90768`, the 38c report, prior P6 logic and style findings, the targeted handlers, budget engine, drain and host shutdown paths. The caller's already-run Nx, Jest, TypeScript, lint and degradation results are accepted as given; none were rerun. A scoped `ptah_get_diagnostics` call returned **unavailable** because its TypeScript check was still running after 45 seconds, so it supplies no additional pass evidence. Existing queued follow-ups LT-P6-8 and LT-P6-9 and non-comment Minors were not reopened as 38c defects.
