# Review fix R2

## Fixes

| Defect | Fix and location | Regression |
| --- | --- | --- |
| 2 | Tab IDs are queued by `lane-completion-notifier.service.ts:379` and `agent-report-router.service.ts:305`, then re-keyed by `parent-envelope-store.service.ts:40` and drained on resolution. | `holds a tab-id completion until the real parent session resolves`; `queues a tab-id report and delivers it after session resolution` |
| 3 | `agent-process-manager.service.ts:130,2979` limits exit-0 classification to structured provider errors and avoids success ledger poisoning; failed exits retain bounded failure text. | `does not classify a successful turn mentioning 429.md or quota`; `does not classify a successful turn discussing rate limit guidance` (failed before fix) |
| 4 | Fire-and-forget paths catch and log in `parent-delivery-drainer.service.ts:32,55`, `lane-completion-notifier.service.ts:398`, and `agent-process-manager.service.ts:3023,3327`. | `logs a rejected fire-and-forget enqueue drain` |
| 8 | `parent-delivery-drainer.service.ts:95`, `lane-completion-notifier.service.ts:476`, and `agent-report-router.service.ts:395` use stable failure codes instead of raw exception messages. | `keeps a failed send pending for the next activity` now asserts the raw token text is absent; `reports unsupported (not interrupt-resume) when interrupt rejects` asserts sanitized detail. |
| 9 | `parent-delivery-drainer.service.ts:65` marks a running drain dirty and loops for another pass. | `runs another pass for an envelope enqueued while a send is in flight` |
| 11 | `opencode-cli.adapter.ts:824` binds a first turn at `step_start` and drops unbound or unidentified events; manager and shared stop-reason type expose `session-mismatch`. | `does not bind a first-turn lane to a foreign event before its step start`; `drops stream events with no session id`; `surfaces an OpenCode session mismatch as a typed stop reason` |
| 12 | `agent-process-manager.service.ts:1994,3293`, `agent-report-router.service.ts:366`, and `lane-completion-notifier.service.ts:754` carry `reportClaimsCompletion`; only an explicit WROTE/COMPLETED/FINISHED claim exempts a usage or auth stop. | `treats a progress report followed by usage-limit as failed`; `recognizes an explicit completion claim on a usage-limit stop` |
| 17 | `parent-envelope-store.service.ts:99,106` logs and emits expired envelopes; notifier and report router return `delivery-failed` for terminal expiry. | `emits an expired state on queue eviction`; `emits an expired state for an aged pending envelope` |
| 18 | Post-send acceptance and sink callbacks are isolated from send failures in `parent-delivery-drainer.service.ts:88`. | `continues after a post-send callback and sink throw` |
| 21 | Codex plan manifest at `codex-app-server-lane.adapter.ts:171` advertises network denial only. | `advertises only denied network for the native read-only plan mode` |
| 22 | `agent-report-router.service.ts:360` records accepted enqueues against the burst window. | `limits attempted reports while the parent remains inactive` |

## Verification

`npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/agent-sdk -- --output-style=static`: lint and typecheck passed for both projects; the test phase failed. The run included the documented environment failures in cli-agent-runtime (claude-approval.reader, mcp-install, registry auto-compact argv, child-worktree provisioner) and agent-sdk (off-thread process spawner, plugin loader, SDK query options). Two R2 spec expectations from that run were corrected afterward.

Focused Jest reruns passed the two affected notifier/router suites (107 tests), manager suite (219 tests), and drainer suite (8 tests); the OpenCode and Codex suites passed in the earlier focused six-suite run. The new rate-limit-guidance test failed before its source fix, then passed. `ptah_get_diagnostics` subsequently reported 0 errors and 0 warnings for the scoped changed files.

## Decisions

- Completion claims: infer from a report whose summary or body begins a line with WROTE, COMPLETED, or FINISHED. This uses the existing report contract and is reversible; progress reports cannot exempt a stopped lane.
- Expiry visibility: retain expired entries for a bounded second age window so callers can read their terminal state; the push sink still needs R1 wiring.

## Needs from R1

- `wiring/agent-events.ts` must forward `expired` parent envelope pushes to the renderer; it currently skips them (defect 17).
- Defects 4, 8, 16, and 19 in R1-owned receipt/coordinator/RPC files still need their assigned fixes and regression tests. Check the manager's receipt-region `flushPending` fire-and-forget path at `agent-process-manager.service.ts:3076` for defect 4. The drainer/notifier/report-router portions are covered here.
