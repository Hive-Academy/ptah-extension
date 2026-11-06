# Backend review fixes, round 2

The appended re-review defines N2–N10. It has no N1 entry.

| Defect | Fix (file:line) | Regression test |
| --- | --- | --- |
| N2 | Stable `reasonCode` on outcomes (`libs/shared/src/lib/types/agent-process.types.ts:562`); router refusal codes (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:166-309`); receipt stores code (`messaging/agent-message-coordinator.service.ts:117`). | `returns typed queue-full and no-session refusal codes`; `persists the router queue-full reason code` |
| N3 | Report prose no longer sets completion claims (`agent-report-router.service.ts:365,402`); `lane-completion-notifier.service.ts` keeps usage/auth verdict failed. | `does not infer completion from report prose`; `keeps a usage-limit stop failed despite a report completion flag` |
| N4 | Startup OpenCode errors without binding or session id pass through; foreign errors after binding are filtered (`cli-adapters/opencode-cli.adapter.ts:829`). | `maps a top-level error event to an error segment`; `surfaces a startup error without a session id`; `ignores a foreign-session error after binding`; manager's provider 429 error-segment test |
| N5 | Check spawned lane after receipt registration and settle a fast terminal result (`messaging/agent-message-coordinator.service.ts:107-108`). | `settles a cold-resume receipt when the new lane fails before registration` |
| N6 | Clear interrupt guard and flush queue after failed Send-now resubmission (`agent-message-router.service.ts:243-254`). | `flushes a queued turn after the Send-now resubmit fails` |
| N7 | Exit-zero limit requires provider-shaped error; structured auth is recognized (`agent-process-manager.service.ts:131-132,2997-3009`). Kimi wording uses the repository fixture, not a live provider call. | `ignores a tool error line about rate limit tests on exit 0`; `classifies a structured authentication error on exit 0`; `recognizes the recorded Kimi Code provider error wording on exit 0` |
| N8 | Clear active drain inside the task and recheck late dirty state (`parent-delivery/parent-delivery-drainer.service.ts:64-74`). | `runs another pass when an envelope arrives in the final drain microtask` |
| N9 | Skip release for restored records (`agent-process-manager.service.ts:2853-2855`). | `does not emit a subprocess release for a restored record on cold resume` |
| N10 | Invalid MCP ids throw coded `AgentMessageError` (`namespace-builders/agent-namespace.builder.ts:520,529`); re-key enforces destination cap and emits expired state (`parent-delivery/parent-envelope-store.service.ts:41-58`). | `returns a coded not-found error for invalid message agent ids`; `keeps the resolved parent at 32 pending envelopes after tab re-key` |

## Verification

- Required `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers -- --output-style=static`: lint and typecheck passed for both projects. Test phase exited 1. cli-agent-runtime: 136 suites passed, 2 known environment suites failed (`mcp-install.service`, `ptah-cli-registry-auto-compact-argv`); 2946 tests passed, 7 failed, 1 skipped. The rpc-handlers test phase failed; its individual failure output was not retained by the filtered tool response.
- Focused `agent-namespace.builder.spec.ts`: 1 suite and 95 tests passed.
- Ptah scoped diagnostics after edits remained unavailable at its 45-second timeout; the required project's typecheck passed in the verify run.

## Degradation audit

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0. It scanned 3896 files and reported 220 unsuppressed sites within baseline. No baseline changed.

## Decisions

- The report MCP argument has no structured completion claim. I removed the exemption as requested instead of adding a public argument. This is reversible if the public contract later adds an explicit field.
- Exit-zero classification uses provider-shaped error lines and the repository's recorded Kimi fixture. This is reversible if a live provider fixture establishes a different structured format.
