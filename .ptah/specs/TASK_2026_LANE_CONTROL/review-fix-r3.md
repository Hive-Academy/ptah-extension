# Review fix R3

Locations below are relative to `libs/backend/cli-agent-runtime/src/lib/cli-agents/` unless another library or `wiring/` is named.

## Defects

| Defect | Final status and location | Regression test |
| --- | --- | --- |
| 1 | Fixed R1 — `messaging/agent-message-coordinator.service.ts:168` settles cold-resume receipt by id. | `keeps the original receipt id through cold resume` |
| 2 | Fixed R2 — `parent-delivery/parent-envelope-store.service.ts:40` rekeys tab envelopes. | `holds a tab-id completion until the real parent session resolves`; `queues a tab-id report and delivers it after session resolution` |
| 3 | Fixed R2 — `agent-process-manager.service.ts:2979` restricts successful-exit classification. | `does not classify a successful turn mentioning 429.md or quota` |
| 4 | Fixed R1/R2/R3 — `messaging/agent-message-coordinator.service.ts:33`, `messaging/agent-delivery-receipt-store.service.ts:46`, `agent-process-manager.service.ts:3076` catch and log async failures. | `logs a rejected asynchronous receipt event without rejecting the emitter`; `logs persistence and sink failures while preserving the receipt`; `logs a rejected fire-and-forget enqueue drain` |
| 5 | Fixed R1 — `messaging/agent-delivery-receipt-store.service.ts:151` retains live receipt after storage failure. | `keeps a delivered receipt in memory when persistence fails` |
| 6 | Fixed R1 — `agent-message-router.service.ts:227` holds queue flush during interrupt. | `delivers a consented immediate message before flushing a queued turn` |
| 7 | Fixed R1 — `messaging/agent-message-coordinator.service.ts:141` requires pending queue membership to cancel. | `refuses cancellation after the router has taken the queued message` |
| 8 | Fixed R1/R2/R3 — `messaging/agent-message-coordinator.service.ts:128`, `agent-rpc.handlers.ts:1568,1588` return stable reasons and fixed account refusal copy. | `keeps raw adapter failure text out of receipts and outcomes`; `preserves the account refusal code through cold resume` |
| 9 | Fixed R2 — `parent-delivery/parent-delivery-drainer.service.ts:65` repeats a dirty drain. | `runs another pass for an envelope enqueued while a send is in flight` |
| 10 | Fixed R1 — `messaging/agent-message-coordinator.service.ts:103,162` registers started receipt before awaiting persistence. | `settles when the turn ends during the started receipt transition` |
| 11 | Fixed R2 — `cli-adapters/opencode-cli.adapter.ts:824` binds on step start and requires session id. | `does not bind a first-turn lane to a foreign event before its step start`; `drops stream events with no session id` |
| 12 | Fixed R2 — `lane-completion-notifier.service.ts:754` exempts only a completion claim. | `treats a progress report followed by usage-limit as failed` |
| 13 | Fixed R1 — `messaging/agent-delivery-receipt-store.service.ts:102`, `messaging/agent-message-coordinator.service.ts:121` persist executed mode. | `records the executed mode after the router changes the preview plan` |
| 14 | Fixed R1/R3 — `messaging/agent-message-coordinator.service.ts:55,165`, `agent-message-router.service.ts:412`, `agent-process-manager.service.ts:3380`, `messaging/agent-delivery-receipt-store.service.ts:148` evict ended-agent tracking and bound history. | `evicts per-agent queue tracking when its record expires`; `evicts terminal thread state when an agent record expires`; `bounds terminal receipts globally across many ended agents` |
| 15 | Fixed R1 — `agent-rpc.handlers.ts:1565` marks renderer sends as user. | `marks a renderer continue message as user sent` |
| 16 | Fixed R1/R3 — `agent-message-rpc.handlers.ts:9`, `agent-rpc.handlers.ts:1560,1583`, `rpc-agents.types.ts:652` validate and code bad input without rewriting the body. | `rejects oversized messages with a coded error and preserves message whitespace`; `preserves message whitespace and caps continue input at the RPC boundary` |
| 17 | Fixed R2/R3 — `parent-delivery/parent-envelope-store.service.ts:99`, `../wiring/agent-events.ts:141`, `libs/shared/src/lib/types/messages/schemas.ts:86` push expired state. | `emits an expired state on queue eviction`; `emits an expired state for an aged pending envelope`; `broadcasts receipt and parent-delivery changes on the monitor channel` |
| 18 | Fixed R2 — `parent-delivery/parent-delivery-drainer.service.ts:88` isolates post-send callbacks. | `continues after a post-send callback and sink throw` |
| 19 | Fixed R1/R3 — `messaging/agent-delivery-receipt-store.service.ts:62,78` keeps valid neighbors and logs drop counts. | `restores valid records beside malformed entries`; `logs counts of malformed records dropped during restore` |
| 20 | Fixed R3 — `messaging/agent-delivery-planner.ts:27`, `messaging/agent-lane-resume.service.ts:10`, `agent-process-manager.service.ts:2851` release idle handle before cold resume. | `waits for the old live handle to release before spawning a replacement`; idle live planner fallback spec |
| 21 | Fixed R2 — `cli-adapters/codex/codex-app-server-lane.adapter.ts:171` advertises network denial for plan. | `advertises only denied network for the native read-only plan mode` |
| 22 | Fixed R2 — `agent-report-router.service.ts:360` counts accepted report attempts. | `limits attempted reports while the parent remains inactive` |
| 23 | Fixed R1 — `messaging/agent-lane-resume.service.ts:17` replays effective policy. | `replays effective permission and network restrictions on cold resume` |

## Verification

- `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/shared -- --output-style=static`: lint and typecheck passed for both; shared Jest 141 suites/4117 tests passed. Runtime Jest 136 suites/2934 tests passed; 2 suites/7 tests failed only in the documented `mcp-install` and pinned SDK argv environment cases.
- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-lm-tools,@ptah-extension/agent-sdk -- --output-style=static`: lint and typecheck passed for all three. vscode-lm-tools Jest 100 suites/3351 tests passed. Agent SDK failed only in the documented symlink and pinned SDK cases (219 suites/5411 tests passed). RPC failed in the documented environment suites plus one new R3 test expectation that was corrected and rerun focused (221 suites/6155 tests passed in the full run).
- `npm run verify -- -t lint,typecheck -p ptah-electron,@ptah-extension/cli-engine,@ptah-extension/platform-cli`: first run exposed a missing `invalid_params` member in the shared RPC union; added it at `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:654`. The scoped rerun passed all 6 targets.
- Focused Jest after final edits: runtime messaging/router/wiring 5 suites/79 tests passed; agent RPC 2 suites/136 tests passed.
- Scoped `ptah_get_diagnostics` was invoked after edits but its compiler remained busy past the 45-second tool limit. The downstream Electron and CLI typechecks passed after the last source changes.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0. The scan reported 220 existing unsuppressed sites within baselines; no baseline was changed.

## Decisions

- Preserve terminal receipts for caller polling but bound them per agent and globally; on record expiry, fail pending receipts and discard per-agent routing state. This follows the existing receipt lookup contract and is reversible.
- Continue RPC returns the additive `invalid_params` code for malformed or oversized input and fixed copy for process errors. The RPC already has a coded result contract; this is reversible.
