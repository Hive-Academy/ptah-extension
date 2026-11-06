# R1 messaging and RPC review fixes

## Defects

| Defect | Fix and location | Regression |
| --- | --- | --- |
| 1 | Cold-resume settlement looks up receipt by id while preserving the original caller-visible agent id; records the spawned turn sequence (`agent-message-coordinator.service.ts:83-86,169`, `agent-delivery-receipt-store.service.ts:115`). | `keeps the original receipt id through cold resume` now uses `AgentLaneResumeService` and emits settlement for the spawned id. |
| 5 | Receipt persistence is best effort after in-memory commit (`agent-delivery-receipt-store.service.ts:135`). | `keeps a delivered receipt in memory when persistence fails`. |
| 6 | Router holds queue flushing during interrupt and delivers the immediate message first (`agent-message-router.service.ts:227-249,328`). | `delivers a consented immediate message before flushing a queued turn`. |
| 7 | Cancellation requires the entry to still be present in pending messages before changing the receipt (`agent-message-coordinator.service.ts:124-136`). | `refuses cancellation after the router has taken the queued message`. |
| 8 | Coordinator stores stable failure reasons and omits raw router detail from outcomes; continue RPC returns fixed refusal text (`agent-message-coordinator.service.ts:80-104`, `agent-rpc.handlers.ts:1565-1570`). | Dedicated secret-text and account refusal regressions still needed. |
| 10 | Started map insertion precedes awaited receipt transition (`agent-message-coordinator.service.ts:83,103,162`). | `settles when the turn ends during the started receipt transition`. |
| 13 | Receipt transition can update mode; coordinator writes executed mode (`agent-delivery-receipt-store.service.ts:88`, `agent-message-coordinator.service.ts:93-105`). | `records the executed mode after the router changes the preview plan`. |
| 14 | Empty coordinator map entries are deleted (`agent-message-coordinator.service.ts:151-155`). | Map-eviction regression still needed. |
| 15 | Continue RPC passes `sender: 'user'` (`agent-rpc.handlers.ts:1564`). | `marks a renderer continue message as user sent`. |
| 16 | Message RPC parses invalid params into `INVALID_PARAMS`, caps message length, and preserves body whitespace; MCP validates ids before conversion (`agent-message-rpc.handlers.ts:9-43`, `agent-namespace.builder.ts:518-530`). | `rejects oversized messages with a coded error and preserves message whitespace`. |
| 19 | Restore validates each record independently and keeps valid neighbors (`agent-delivery-receipt-store.service.ts:58-72`). | `restores valid records beside malformed entries`. |
| 20 | Still open: the planner must release the old live handle before cold resume. Existing manager release method is private; a planner-only fallback would start a second live process. | No regression retained for an incomplete implementation. |
| 23 | Cold resume replays effective permission and network (`agent-lane-resume.service.ts:17-18`). | `replays effective permission and network restrictions on cold resume`. |

## Verification

- `npm run verify -- -p @ptah-extension/cli-agent-runtime -- --output-style=static`: lint and typecheck passed; full Jest failed (9 suites, 27 tests), including known environment and R2-owned OpenCode failures. This run began before the last edits.
- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools -- --output-style=static`: lint and typecheck passed; vscode-lm-tools Jest failed (28 suites, chiefly concurrent `reportClaimsCompletion` type error in R2-owned manager, plus one invalid-id test since updated); rpc-handlers Jest failed (13 suites, 36 tests, including known environment failures). The run began before the last edits.
- Focused Jest: messaging 5 suites/27 tests, router 1/17, agent-message RPC 1/3, agent RPC 2/135, agent namespace 1/94; all passed.
- Scoped `ptah_get_diagnostics` after edits was unavailable: the TypeScript check remained running past 45 seconds amid concurrent verification jobs. Full verify typecheck passed before the last edits; focused Jest compiled the changed suites.

## Decisions

- Keep the receipt keyed to its original agent id for caller lookup, and use id-only lookup for settlement of the replacement agent. Alternative was to rebind the public agent id; existing lookup contract favors the original. Reversible.
- Preserve the raw message body after validating it. Alternative was trimming it; the RPC and MCP contracts treat the body as user content. Reversible.

## Needs from R2

- The queue-updated event from `agent-process-manager.service.ts` needs to carry the failed message id and reason, so receipt settlement does not depend on the router's globally capped terminal map. R2 owns manager edits.
- Expose a safe manager operation to release an idle live handle before cold resume (defect 20); R1 cannot call its private `releaseTracked` from the planner.
- Exit classification and OpenCode adapter failures from the full test run remain in R2's scope.
- Concurrent R2 edit currently adds `reportClaimsCompletion` to manager without the matching `LaneCompletionContext` field; this blocked vscode-lm-tools test compilation.

## Incomplete R1 work

- Defect 4: event callbacks now catch rejections and receipt restore/persist/sink degrade without throwing, but the receipt store has no injected logger in its current registration. The failures are not yet logged.
- Defect 14: terminal status eviction and agent-end cleanup remain unresolved.
- Defect 19: dropped-record counts are not logged yet.
- Defect 20: requires a public release operation in the manager's non-receipt region, outside R1 ownership.
- Defect 8: further tests for raw adapter text and account refusal are pending.
- No matching skill was available in the host catalogue for this lane.
