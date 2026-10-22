# Native route evidence

Owner: TASK_2026_714_c8a2 team leader.
Scope: One Codex App Server runtime. Pinned schema: 0.155.1.

## Summary

Production stays disabled. Runs 1–5 used **1 of 8 model turns in total**. No required observation is fully proved. A schema name does not prove runtime behavior.

| Run | Turns used | Stop reason | Evidence |
| --- | --- | --- | --- |
| 1 | 0 | The strict envelope rejected the top-level `emittedAtMs` field. The run recorded only `initialize` and no failure note. The decision log records the probe diagnosis and later envelope correction. | `spike-run.json`, result 1; `decisions.md`, final 20 rows. |
| 2 | 0 | Startup refused `approval_policy = "untrusted"`, although the schema lists it. The run note says `child closed`. The decision log supplies the startup diagnosis. | `spike-run-2.json`, result 1; `decisions.md`, final 20 rows. |
| 3 | 0 | The selected model, `gpt-5.1-codex-mini`, was not offered. The gate reported `Selected model not in first model/list page`. | `spike-run-3.json`, result 1; `decisions.md`, final 20 rows. |
| 4 | 0 | Version 0.155.1 has no `model_max_output_tokens` setting. The runtime ignored it. The effective configuration gate failed. | `spike-run-4.json`, result 1; `decisions.md`, final 20 rows. |
| 5 | 1 | A real `item/commandExecution/requestApproval` arrived under read-only + on-request. The harness declined it as `Unexpected command`. The model's command text differed from the fixed marker command. The command shape was not recorded. | `spike-run-5.json`, result 1; `decisions.md`, final 20 rows. |

Run 5 proves that a command approval request can arrive. It does not prove the required approval-before-effect or deny behavior. Its reported usage was zero because the turn stopped before usage arrived. Zero reported usage is not proof of zero cost.

Evidence paths below are relative to this task folder unless stated otherwise. Result numbers are zero-based JSON array indexes. The manifest path is repository-relative: `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json`. Schema facts come from the recorded schema inventory and `HANDOFF.md`, “In progress / open problems”, item 3. They are not new behavior tests.

## Required observations

The seven observations are currently at `implementation-plan.md:265–271`. The requested line references have shifted.

| # | Required observation | Status | Evidence, file and run | Still needed |
| --- | --- | --- | --- | --- |
| 1 | Exact handshake, method-specific schemas, approval outcomes, and binary/platform manifest match. | partial | Runs 3–5 record `initialize`, `initialized`, and `model/list` in result 1. Run 5 records a command approval request. Runs 1–5 result 0 record schema facts only. See `spike-run-3.json` through `spike-run-5.json` and the manifest. | Prove complete payload validation, approval outcomes, and the resolved binary/platform match. Do not assume experimental settings. |
| 2 | Positive and negative command/file/MCP gates; edited input; scoped Always Allow; all levels including YOLO; questions and plan transitions. | fail | Run 5 result 1 stops at `Unexpected command`. Later behavioral cases did not run. Runs 1–5 result 3 record the schema fact that `modifiedInput` is absent. See all five run JSON files. | Resolve the edited-input contract. Prove marker absence while approval is pending and after denial. Prove allowed effects, remembered scope, all levels, questions, and plan transitions. |
| 3 | Complete effective profile: remote and stdio MCP, skills, instructions, output style, images/files, model/effort including max, and resume roles. | partial | Runs 4–5 record `config/read`. Run 4 fails the bounded profile gate. The final decision rows record the model change and approved substitute bounds. Run 5 reaches `turn/start`. | Prove each profile input has its intended effect. Inspect remote configuration offline only. Remote behavior remains a rollout blocker. Prove stdio behavior, attachments, effort including max, and resume role semantics. |
| 4 | Same-home cross-consumer configuration isolation; different-home auth/usage isolation; no shared-home configuration writes. | unverified | Runs 1–5 stop in result 1. Later cases report `not run: prior gate or usage ceiling`. See all five run JSON files. | Test chat/chat, chat/gateway, gateway/lane, chat/lane, and lane/lane. Prove different-home isolation and absence of shared-home writes. Cleanup alone is not this proof. |
| 5 | Partial/final stream, honest usage, interrupt/follow-up, resume/history/pages/stats, real file rewind, compaction, and subagent controls. | partial | Run 5 records `item/agentMessage/delta` but no `turn/completed` in result 1. Result 9 in every run says compaction was not observed. | Prove final completion, usage reporting, control operations, history, file restoration, compaction, and required subagent controls. Method presence is insufficient. |
| 6 | Lane restrictions, budgets, role resend, headless policy, Windows completion and abort. | unverified | No completed lane proof appears in runs 1–5. The decision log records an observed, not enforced, usage ceiling. | Prove all lane restrictions and lifecycle cases. Separate observed usage from enforced bounds. |
| 7 | Manifest lookup for supported packaged binaries. | unverified | The manifest supplies method names. The permitted run summaries do not establish packaged lookup or binary identity. | Verify lookup and identity for supported packaged binaries. A development digest does not satisfy this gate. |

## Harness capability gaps

This is the table at `implementation-plan.md:279–288`, with spike observations added. The Claude references and candidate measurements are carried from that plan. They were not re-inspected for this report. No native equivalent is certified.

| Capability | Claude mechanism file:line | Codex App Server equivalent or none | Candidate Ptah-native mechanism / measurement | Spike observation |
| --- | --- | --- | --- | --- |
| Plan entry/read-only planning | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:534`; `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:772` | None verified; read-only sandbox alone insufficient. | Existing plan-mode UI/message flow; future neutral tool candidate, not an asserted ptah_plan API. Measure entry/edit prohibition. | Unverified. Schema fact: `item/plan/delta` and `turn/plan/updated` exist and are in the manifest. Neither proves plan entry or edit prohibition. |
| AskUserQuestion | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:557`; `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:540` | None verified; inspect pinned schema's user-input requests. | Existing question service/presentation could back a future MCP tool. Measure answers and cancel. | Unverified. Schema fact: `item/tool/requestUserInput` exists and is in the manifest. No answer or cancel behavior was observed. |
| ExitPlanMode | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:570` | None verified. | Existing exit-plan presentation/service; measure actual transition, not acknowledgement. | Unverified. Schema fact: the two plan notification methods are in the manifest. They do not establish an exit transition. |
| Subagent spawn/list/background | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1372`, `:1020` | Native controls unverified. | ptah_agent_spawn/list transports tested at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-limits.transport.spec.ts:245`, `:513`; candidate, not parity proof. | Unverified. Runs 1–5 contain no completed subagent control proof. |
| Agent reporting/interrupted context | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1020` | None verified for injected/background context. | ptah_agent_report described at `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.ts:70`; measure ownership/lifecycle differences. | Unverified. No reporting, ownership, or interrupted-context proof was recorded. |
| Edited input/remembered permissions | `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:637`; `apps/ptah-electron/src/ipc/ipc-bridge.ts:425` | Wire outcomes unverified. | Existing permission UI/storage through this task's approval port; broader neutral harness is follow-up. | Edited-input parity fails as specified: schema fact, `modifiedInput` is absent. Schema fact: `acceptForSession` is a candidate outcome; it is not a method in the manifest. Its scope is unverified. Schema facts: `item/permissions/requestApproval` and `mcpServer/elicitation/request` are in the manifest; neither was observed. Run 5 observed `item/commandExecution/requestApproval`, also in the manifest, then stopped. |
| Compact/file rewind | `libs/shared/src/lib/types/agent-adapter.types.ts:360`; `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1481` | Research candidates thread/compact/start and thread/rollback; not file-restore proof. | Existing session RPC front doors; measure boundaries and file contents separately. | Unverified. Schema facts: `thread/compact/start` and `thread/rollback` are in the manifest. All runs say compaction was not observed. Rollback is not proof of file restoration. |
| Skills/instruction harness | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:327`, `:1100`, `:1301` | Research candidates skills/config and instruction fields only. | Existing profile/MCP sources; measure each source's actual effect. | Unverified. Schema facts: `skills/config/write`, `skills/extraRoots/set`, and `skills/list` appear in the run inventories and manifest. No instruction or skill effect was proved. |

## Capability reductions for user decision

Only the substitute spend bounds have recorded user approval. Other reductions remain open. A visible unsupported error does not satisfy parity.

| Reduction | Impact on Claude parity | Options and decision state |
| --- | --- | --- |
| No `modifiedInput` in the 0.155.1 schema. | Edited-input approval parity cannot be built as specified on this wire contract. Denial followed by another command is not proven equivalent. | Keep affected rollout blocked and investigate a verified native alternative (recommended). Or obtain explicit approval to remove edited-input approval. Any alternative needs proof before it can claim parity. |
| No per-turn output token cap in 0.155.1. | A hard output cap cannot be preserved through `model_max_output_tokens`. Substitute settings do not impose the same bound. | User approved spike substitutes: reasoning effort `low`, verbosity `low`, tool output limit `2000`, 8 total turns, 60-second case deadline plus interrupt, and a 12000 observed cumulative ceiling. Keep these bounds for the authorized spike. For production, prove an enforceable alternative or obtain an explicit reduction decision. |
| `approval_policy = "untrusted"` is refused at startup. | Ptah's “ask” level changes. Asking before every non-trusted command is not established by on-request. Commands allowed by the sandbox can run without approval. | Keep exact ask parity blocked and test a supported policy mapping (recommended). Or obtain approval for changed ask semantics. The startup probe recorded in `decisions.md` leaves on-request, never, and granular as the remaining policies. Granular parity is unverified. Never removes interactive approval. |
| Usage is observed, not enforced mid-turn. | A usage threshold cannot guarantee an immediate budget stop. Reported zero usage before a usage event cannot establish cost. | Keep enforcement parity blocked until a reliable stop bound is proved (recommended). Or obtain approval for an observed threshold with possible overshoot. The approved spike substitutes do not prove mid-turn enforcement. |

## Next spike step

Before run 6, update the harness to record a sanitized command shape when it rejects an unexpected command. Replace the experiment root with `<EXPERIMENT_ROOT>`. Replace the Node executable path with `<NODE_PATH>`. Exclude auth, environment values, and other secrets. Preserve enough command structure to explain the mismatch. Keep unexpected commands declined until the shape has been reviewed against the harmless marker case.

This report does not change the harness or authorize a new run. **7 of 8 turns remain, but the cases need 8.** Do not reset the budget or retry automatically. Reconcile the case plan with the remaining allowance before execution. If complete proof needs more turns, obtain a separately approved scope. Incomplete proofs keep production disabled.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the named capability table at its current location. | Use current heading and content; or copy unrelated content at the old line range. | The required observations are at lines 265–271. The capability table is at lines 279–288. Lines 307–333 contain acceptance text and the audit register. | Yes. Documentation only. |
| Keep runtime conclusions separate from schema facts. | Treat method presence as inventory; or infer behavior from method names. | Runs 1–5 stop before complete proofs. Run 2 rejects a policy still listed in the schema. | Yes. New evidence can update each status. |

Verification scope: Only the requested evidence inputs were used. No runtime, build, test, lint, or git write was performed. No public-facing capability claim is made.
