# Codex version contract report - TASK_2026_714_c8a2

Scope: compare pinned codex 0.155.1 with the user's global codex 0.163.0 for the Codex App Server contract.
No model call, no auth.json, no real CODEX_HOME. Both runs used an empty temp CODEX_HOME. Temp dirs deleted.

## 1. Method (facts)

| Item | Value |
| --- | --- |
| Export command (from `libs/backend/codex-runtime/tools/generate-protocol-manifest.mjs:122`) | `codex app-server generate-json-schema --out <dir>` |
| 0.155.1 binary | `D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` |
| 0.163.0 binary | `C:\Users\abdal\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe` |
| Compared files | pinned `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json` vs 0.163.0 `codex_app_server_protocol.schemas.json` (same aggregate file; top-level plus `definitions.v2.*` flattened) |
| Definitions | 710 (0.155.1) vs 736 (0.163.0) |

## 2. Schema comparison (schema facts)

### 2.1 Approval and user-input types: NO change

None of these definitions differ between the versions (byte-equal JSON after parse):
`CommandExecutionRequestApprovalParams/Response`, `CommandExecutionApprovalDecision`, `FileChangeRequestApprovalParams/Response`, `FileChangeApprovalDecision`, `PermissionsRequestApprovalParams/Response`, `McpServerElicitationRequestParams/Response`, `McpServerElicitationAction`, `ToolRequestUserInputParams/Response/Answer/Question`, `AskForApproval`, `ApprovalsReviewer`, `ServerRequest` (10 methods both).

So moving the pin to 0.163.0 gives no edited-input approval.

### 2.2 Decision shapes (identical in both versions)

| Request | Response field | Allowed values |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | `decision` | `accept`, `acceptForSession`, `{acceptWithExecpolicyAmendment:{execpolicy_amendment:string[]}}`, `{applyNetworkPolicyAmendment:{network_policy_amendment}}`, `decline` (turn continues), `cancel` (turn interrupted) |
| `item/fileChange/requestApproval` | `decision` | `accept`, `acceptForSession`, `decline`, `cancel` |
| `item/permissions/requestApproval` | `permissions` (GrantedPermissionProfile), `scope` (default `turn`), `strictAutoReview` | no decline value; grant less or nothing |
| `mcpServer/elicitation/request` | `action` (`accept`/`decline`/`cancel`), `content` (structured input, null on decline/cancel), `_meta` | content is the only user-edited payload |
| `item/tool/requestUserInput` | `answers` (per question id -> `ToolRequestUserInputAnswer.answers`) | free text via `isOther` |
| legacy `execCommandApproval` / `applyPatchApproval` | `decision` (`ReviewDecision`: `approved`, `approved_for_session`, `approved_execpolicy_amendment`, `approved_mcp_policy_amendment`, `network_policy_amendment`, ...) | legacy, not for new code |

Search across both schemas for `modifiedInput`, `editedCommand`, `updatedInput`: zero hits. The only `modif*` names are `modified` and `modifiedAtMs` (file metadata). Amend-type names are only: `acceptWithExecpolicyAmendment`, `applyNetworkPolicyAmendment`, `proposedExecpolicyAmendment`, `proposedNetworkPolicyAmendments`, `approved_execpolicy_amendment`, `approved_mcp_policy_amendment`.

### 2.3 AskForApproval (identical)

Path: `definitions.AskForApproval` (0.155.1 schema).

| Variant | Schema |
| --- | --- |
| string enum | `untrusted`, `on-request`, `never` (no `on-failure`) |
| `granular` object | `mcp_elicitations` (bool, required), `rules` (bool, required), `sandbox_approval` (bool, required), `request_permissions` (bool, default false), `skill_approval` (bool, default false) |

The schema has NO `description` text for any granular field. Meaning of `true` is NOT in the schema. It is inferred only: `true` = that class of prompt is shown to the user; `false` = auto-handled without prompt. This is an inference from codex Rust docs knowledge and must be proven by the spike (see section 5).

### 2.4 Output / token limit keys

| Check | 0.155.1 | 0.163.0 |
| --- | --- | --- |
| `model_max_output_tokens` or any `max_output*` key | none | none |
| `Config` token keys | `model_auto_compact_token_limit`, `model_auto_compact_token_limit_scope`, `model_context_window` | same |
| `TurnStartParams` properties | approvalPolicy, approvalsReviewer, clientUserMessageId, cwd, effort, input, model, outputSchema, personality, sandboxPolicy, serviceTier, serviceTierForTurn, summary, threadId, toolOutput, turnTrigger | adds `disabledPluginIds`, `parentTurnId`, `rootTurnId` only |

No per-turn output token cap in either version. `tokenBudget`/`tokensUsed` exist in goal-related types, not as a turn cap (not examined further).

### 2.5 Method delta (count)

| Group | 0.155.1 | 0.163.0 | Removed | Added |
| --- | --- | --- | --- | --- |
| ClientRequest | 102 | 105 | `thread/rollback` | `thread/attachmentOwner/list`, `account/gatewayOAuth/read`, `account/gatewayOAuth/login`, `account/gatewayOAuth/cancel` |
| ServerRequest | 10 | 10 | none | none |
| ClientNotification | 1 | 1 | none | none |
| ServerNotification | 82 | 85 | none | `thread/readState/changed`, `thread/prediction/updated`, `account/gatewayOAuth/changed` |

Other changed definitions (not approval related): `Thread`, `ThreadItem`, `Turn`, `TurnStartParams` (3 added fields), `ThreadStartResponse`, `ThreadResumeParams`, `InitializeCapabilities` (adds `explicitGatewayOauth`), `UserInput`, skills, models, plugins, MCP status. Removal of `thread/rollback` is a breaking change if Ptah uses it (grep not done here; open question).

## 3. Native stand-ins for "edit the command, then approve" (0.155.1 schema only)

| # | Mechanism | Exact schema path | What it does | Gap to Claude `updatedInput` |
| --- | --- | --- | --- | --- |
| A | Decline, then steer with new text | `CommandExecutionApprovalDecision` = `decline` (turn continues) + `TurnSteerParams` {threadId, expectedTurnId, input, clientUserMessageId} (method `turn/steer`) | Model is told the edited command and asked to run it. The model then issues a NEW command and a NEW approval request. | Not exact: model may rephrase or refuse. Needs a second approval. Closest in effect. |
| B | Decline with injected item | `ThreadInjectItemsParams` {threadId, items} (method `thread/inject_items`) after `decline` | Puts a raw response item (for example a function-call output or user message) in history. | Same gap as A; more control, but raw ResponseItem format is unstable. |
| C | Decline, then follow-up turn | `decline` + `TurnStartParams.input` (new `turn/start`) | Plain new turn with edited instruction. | Weakest: new turn, not same tool call. |
| D | `accept` + execpolicy amendment | `CommandExecutionApprovalDecision.acceptWithExecpolicyAmendment.execpolicy_amendment: string[]` (proposal comes from `CommandExecutionRequestApprovalParams.proposedExecpolicyAmendment`) | Runs the ORIGINAL command and adds an allow-prefix rule. | Does not edit the command. It is a policy grant, not an edit. Not a stand-in. |
| E | Network policy amendment | `applyNetworkPolicyAmendment.network_policy_amendment` | Persistent host allow/deny. | Network only. Not a stand-in. |
| F | MCP elicitation content | `McpServerElicitationRequestResponse.content` | User edits structured form data. | Only for MCP elicitation, not for shell or file tools. |
| G | Request-user-input answers | `ToolRequestUserInputResponse.answers` | User gives free text to a tool-initiated question. | Only when the model asks. Not for command approval. |
| H | Permissions response narrowing | `PermissionsRequestApprovalResponse.permissions` / `scope` | User grants a smaller permission set. | Edits the grant, not the command. |
| I | `item/fileChange` | `FileChangeApprovalDecision` has only accept/acceptForSession/decline/cancel | No edit field at all. | Only A-C possible. |

Closest to Claude edited-input semantics: **A (decline + `turn/steer` with the edited command)**. It is a model-mediated retry, not a replay of the same tool call.

Proof the spike needs (all need a real model run, so a user-approved run):
1. Run a turn that triggers a command approval. Reply `decline`. Check the turn stays alive (schema says it does).
2. Call `turn/steer` with `expectedTurnId` and the edited command text. Check the accepted/rejected result and that the model issues a new `commandExecution` request whose `command` equals the edited text byte for byte in at least N of M trials.
3. Measure failure rate: model changes the command, adds flags, or refuses. Record the rate.
4. Check the UI trail: the declined item and the new item must both be visible and ordered.
5. Check the same for `item/fileChange` (no command text to compare; compare resulting patch).
6. Pass criterion to decide: define the minimum match rate with the product owner before the run.

Decision already taken by the user: block edited-input parity for Codex. The table above is only the investigation record.

## 4. Runtime observations (startup probes, empty temp CODEX_HOME, stdin = one `initialize` line, no auth, no model)

| Policy passed with `-c` | 0.155.1 | 0.163.0 |
| --- | --- | --- |
| `approval_policy="untrusted"` | exit; stderr `Error: approval_policy = "untrusted" is no longer supported; remove this setting` | same exact line |
| `approval_policy={granular={sandbox_approval=true,rules=true,mcp_elicitations=true,request_permissions=true,skill_approval=true}}` | starts; `initialize` result returned (`userAgent` `probe/0.155.1 ...`) | starts; `initialize` result returned (`probe/0.163.0 ...`) |
| `approval_policy="on-request"` | no stderr error (one probe printed no stdout, probably because stdin closed fast; not repeated) | not probed |

Notes:
- `AskForApproval` in the schema still lists `untrusted`, but both runtimes refuse it. The schema is not a reliable guide for accepted values. Moving to 0.163.0 does not fix it.
- Startup acceptance of `granular` proves only that the config parses. It does not prove prompt behaviour per flag.
- Both binaries print a harmless WARNING about PATH aliases because CODEX_HOME was under the temp dir.

## 5. Granular policy test plan for Ptah "ask" level

Needed proof (runtime, needs model, so user must approve a run with a throw-away CODEX_HOME and test auth):

| Flag | Test | Expected if `true` = prompt user |
| --- | --- | --- |
| `sandbox_approval` | command that needs sandbox escape | `item/commandExecution/requestApproval` arrives |
| `rules` | command hitting an execpolicy `prompt` rule | approval request arrives |
| `mcp_elicitations` | MCP tool that elicits | `mcpServer/elicitation/request` arrives |
| `request_permissions` | model calls request-permissions tool | `item/permissions/requestApproval` arrives |
| `skill_approval` | skill script run | approval request arrives |
| each `false` | same trigger | no request; auto-decision (accept or reject?) must be recorded |

Also test: file change in `workspace-write` without escalation (does `item/fileChange/requestApproval` fire at all under granular?), and `approvalsReviewer: "user"`.

## 6. Recommendation

| Option | Verdict |
| --- | --- |
| Stay on 0.155.1 | **Recommended.** Approval, elicitation, user-input and `AskForApproval` contracts are identical in 0.163.0. No gain for this task. Pinned schema, manifest and binary hash stay valid. |
| Move pin to 0.163.0 | Not now. No approval-edit, no output-token cap, `untrusted` still refused. Cost: re-export schema and manifest, rework `thread/rollback` users, new `Thread`/`ThreadItem`/`Turn` shape changes. Revisit when a release changes section 2.2 or 2.4. |

Ptah consequences (for the architect, who decides):
- Do not map Ptah "ask" to `untrusted`. Use `on-request` or `granular` after the spike in section 5.
- Show "edited input" as unsupported for Codex. Offer decline + steer (mechanism A) only after the section 3 spike passes.
- Do not promise an output token cap for Codex. Only `model_auto_compact_token_limit` and `model_context_window` exist.

## 7. Open questions

1. What does each `granular` flag do when `false`: auto-accept, auto-reject, or sandbox default? Not in the schema.
2. Does `item/fileChange/requestApproval` fire under `granular`, and which flag controls it?
3. Does `turn/steer` after `decline` work while the declined item is still in progress, and what match rate does the model keep for an edited command (section 3)?
4. Does Ptah use `thread/rollback` (removed in 0.163.0)? Not checked in this task.
5. Does the 0.155.1 `on-request` startup produce an `initialize` response? One probe printed nothing; likely a stdin timing effect. Repeat with a held-open stdin.
6. The bundled 0.155.1 runtime is not the only supported install path? If users bring their own codex, version checks must tolerate 0.163.0 differences in section 2.5.
