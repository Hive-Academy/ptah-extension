# Batch 10b-1 report

## Files created

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts` — native lane adapter, narrow ports, lifecycle, resume and approval decline.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane-startup.ts` — 30 second startup watchdog with timer cleanup.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts` — focused adapter cases.
- `.ptah/specs/TASK_2026_714_c8a2/batch-10b-1-report.md` — this report.

## Preserve-list mapping

| Capability | Status |
| --- | --- |
| Detection and actual native binary | 10b-2 |
| Credential check and account home | 10b-2 |
| Model selection and catalog | 10b-2 |
| Reasoning effort | 10b-2 |
| Token budgets, web search, and timeout | done in 10b-1 (opens one lane context with exact settings; advertises queue only and closes the context on abort). The 30 second watchdog has no elapsed-time spec yet. |
| Config rejection handling | 10b-2 |
| Model rejection | 10b-2 |
| Ptah MCP and user MCP | done in 10b-1 (opens one lane context with exact settings, projects text, tool and usage once, and reports Ptah MCP URL). Trusted user-server discovery stays with the resolver and needs 10b-2 proof. |
| Role, preambles and lane policy | done in 10b-1 (awaits account binding before the prompt and continues on the same context with role resend) |
| File context and plain output parsing | done in 10b-1 (keeps file context in the prompt, strips ANSI, and replays early output) |
| PTAH_LANE_POLICY canary | done in 10b-1 (awaits account binding before the prompt and continues on the same context with role resend) |
| Structured events, output, errors and usage | done in 10b-1 (opens one lane context with exact settings, projects text, tool and usage once, and reports Ptah MCP URL) |
| Rollout usage for resume gate | later batch |
| Resume by session id and account binding | done in 10b-1 (refuses resume without a full matching identity and resumes with one; awaits account binding before the prompt and continues on the same context with role resend) |
| Messaging flags and queue | done in 10b-1 (advertises queue only and closes the context on abort; awaits account binding before the prompt and continues on the same context with role resend) |
| Abort and stop | done in 10b-1 (advertises queue only and closes the context on abort) |
| Windows hidden spawn | later batch |
| Approval and sandbox selection | done in 10b-1 (declines each command, fileChange, permissions and mcpElicitation request once with one safe output line and continues; opens one lane context with exact settings) |
| Native subagents, plugins, apps and skill instructions disabled | done in 10b-1 (opens one lane context with exact settings, projects text, tool and usage once, and reports Ptah MCP URL) |
| Plan-limit signals | later batch |
| Report and deliverable contract | later batch |

## 10b-2 seams

- `detect()` and `listModels()` throw `CodexLaneCapabilityPendingError` until native binary discovery and model catalog behavior are implemented.
- `assertDeferredInputs()` refuses explicit effort and binary paths until validation and pin checks exist. The injected profile resolver owns credential freshness, selected home, trusted user MCP names and model source resolution; those need 10b-2 implementation and proof before host selection.
- `surfaceConfigRejection()` preserves the typed `CodexPreTurnConfigRejectedError` and fails visibly. The one essential-config retry and `onLaneConfigRejected` notice belong to 10b-2.
- `surfaceModelRejection()` fails with a typed pending-capability error when a terminal model error is identified. Source-aware advice belongs to 10b-2.

## Decisions

- The runtime provider accepts an approval sink and opens exactly one context per run. The sink immediately declines all four App Server approval kinds. Its output includes only the kind and a syntactically safe tool name; request message, command, path, cwd and details are ignored.
- Resume requires a stored full thread identity that matches the requested id and newly built profile. The opened context identity is checked again before persistence or prompt delivery.
- `onAccountBinding` is awaited after identity persistence and before `startTurn`. A missing binding on a requested checkpoint is an error.
- Completed turns leave the context open for queued continuation. Abort, failed/interrupted terminal status, startup failure and event-stream failure close it. The startup timer is cleared when each open or turn-start race settles.
- The first role and lane policy ride developer instructions. With the current resend rule, continuation repeats the role in the task text because the already-open context has no developer-instruction update API; `getRoleDelivery()` then reports `task-prompt`. The lane policy canary remains in the context instructions.
- The legacy adapter was not changed or selected. No Codex SDK import was added.

## Not done / verification

- 10b-2 capabilities listed above, host wiring, process-manager integration, rollout reader, Windows spawn proof, plan-limit ledger and report-deliverable end-to-end proof remain outstanding.
- No tests, lint, typecheck, build, serve, Nx, npm or diagnostics were run, per lane rules. Ptah AST inspection found all three new TypeScript files parse cleanly; this is syntax evidence only.
- Local `agent-lanes` skill instructions were read. No UI work was involved.