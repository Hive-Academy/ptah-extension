# Research: how T3 Code handles Codex approvals (TASK_2026_714_c8a2)

Source: github.com/pingdotgg/t3code at commit `d53873b6a4799e87afd63c8d288ef0089f5a3748` (main when read, 2026-10-24).
Citations are `path:line` at that commit. Base URL for permalinks:
`https://github.com/pingdotgg/t3code/blob/d53873b6a4799e87afd63c8d288ef0089f5a3748/<path>#L<line>`.
Main file: `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts` (abbreviated `Adapter` below).
Verified by reading the source; nothing was run. No clone into the Ptah repo (files fetched via `gh api` into %TEMP%).

## Decision this supports

Ptah's Codex "edit proposed command" flow, given: codex 0.155.1, granular approval policy (all true) + read-only sandbox; decline works; `turn/steer` after decline makes the model say the workspace is read-only and request no approval; schema has no `modifiedInput`.

## 1. Transport, approval policy, sandbox, granular/experimentalApi

- Transport: JSON-RPC to `codex app-server` through its own package `packages/effect-codex-app-server` (generated schema `src/_generated/schema.gen.ts`, client `src/client.ts`). Server-initiated requests are handled with `client.handleServerRequest(...)`, e.g. `Adapter:5183` (command), `:5255` (file change), `:5328` (permissions), `:5390` (MCP elicitation), `:5609` (tool user input). Legacy `execCommandApproval` / `applyPatchApproval` are also handled (`:5470-5607`).
- `experimentalApi`: YES. `CODEX_CLIENT_CAPABILITIES = { experimentalApi: true, optOutNotificationMethods: ["turn/diff/updated"], ... }` at `Adapter:232-236`.
- Granular approvals: NO. A grep for "granular" in the adapter finds nothing. T3 only uses plain enum policies.
- Per-access-mode policy, sent on every `turn/start` (`codexRuntimeModeTurnDefaults`, `Adapter:688-729`, applied in `buildCodexTurnStartParams` `:731-817`, `approvalsReviewer` at `:815`):

| T3 runtime mode                  | approvalPolicy | approvalsReviewer | sandboxPolicy               |
| -------------------------------- | -------------- | ----------------- | --------------------------- |
| `approval-required` (Supervised) | `untrusted`    | `user`            | `{type:"readOnly"}`         |
| `auto-accept-edits`              | `on-request`   | `user`            | `{type:"workspaceWrite"}`   |
| `auto`                           | `on-request`   | `auto_review`     | `{type:"workspaceWrite"}`   |
| `full-access`                    | `never`        | `user`            | `{type:"dangerFullAccess"}` |

The same params are also derived for `thread/start` via `codexThreadRuntimeParams` (`Adapter:6692`). A per-run `runtimePolicy.approvalPolicy/sandboxPolicy` override can replace the defaults (`:745-752`).

- So T3's "ask" mode is `untrusted` + `readOnly`, not `on-request`/granular. Under `untrusted`, Codex asks for anything not on its known-safe list; with read-only the approval is the only way a write runs. T3 does not document or work around the "model refuses to ask because it is read-only" behaviour (see section 2).

## 2. Command / file-change approvals: decisions, editing, decline-then-what

- Decisions the T3 contract offers: `accept | acceptForSession | acceptAlways | decline | cancel` (`packages/contracts/src/providerPolicy.ts:50-56`). UI default option list is Cancel, Decline, "Always allow this session", Approve (`apps/web/src/components/chat/ComposerPendingApprovalActions.tsx:~20-26`); Decline and Approve are buttons, the rest sit in an overflow menu. Options may carry a `warning`.
- Mapping to Codex (`Adapter:5246-5252`, `:5319-5325`): the T3 decision string is returned directly as the `CommandExecutionRequestApprovalResponse.decision` / `FileChangeRequestApprovalResponse.decision`; `acceptAlways` is downgraded to `acceptForSession`. So Codex-native `accept`, `acceptForSession`, `decline`, `cancel` are used as-is. No `acceptWithExecpolicyAmendment`, no network-policy amendment, no available-decisions handling.
- Session allowance is reimplemented client-side: Codex's `acceptForSession` only covers the exact command/patch, so T3 remembers per native thread that "command" or "file-change" kinds were allowed and auto-answers later requests with `acceptForSession` (`Adapter:5191-5197`, `:5246-5248`; rationale comment `:1903-1906`; PR/issue #19635 "Always allow this session stops Codex asking for every command"). The allowance ends on a runtime mode change (`endSessionApprovalsOnModeChange`, `:1910+`) or thread unload (`:6918`). Permissions requests are deliberately excluded.
- Editing a proposed command: NONE. No edited-input / modified-command field exists in the T3 approval UI, in `ProviderApprovalOption`, or in the adapter. The only approval payload from the user is the decision enum. File-change approvals only get a better description (`codexFileChangeApprovalPrompt`, PR #8669 / #18248), not editability.
- Decline with feedback: NONE on the approval card. Legacy decline sends `{ denied: { rejection: "User declined the request." } }` (`Adapter:576-577`), a fixed string, not user text. Cancel maps to `abort`.
- How T3 delivers new instructions after a decline: it does not special-case it. The user types a normal composer message, which T3's dispatch policy routes as:
  - `steer_active` when the provider has `supportsActiveSteering` -> `turn/steer` with `expectedTurnId` (`Adapter:6873-6899`; policy in `apps/server/src/orchestration-v2/CommandPolicy.ts:~156-200`), or
  - `restart_active` (interrupt the turn, start a replacement turn) when a "restart" delivery intent is chosen or the provider only supports interrupt-restart (`CommandPolicy.ts:165-167`, `:195-197`, `:467-492`). Codex advertises BOTH `supportsActiveSteering: true` and `supportsSteeringByInterruptRestart: true` (`Adapter:259-261`); the interrupt path is `turn/interrupt` (`Adapter:2589`, `:4550`, `interruptTurn` at `:6940-6990`).
  - Doc: `docs/orchestration-v2/provider-capability-system.md` ("`supportsSteeringByInterruptRestart` means V2 can implement app-level steering by interrupting the active turn and starting a replacement attempt").
- Issues/PRs about the model refusing to re-request approval after decline, or read-only escalation: none found. Searches over `pingdotgg/t3code` issues for "granular", "requestApproval", "decline", "sandbox read-only", "steer approval" returned nothing on this. Closest items:
  - #12248 "Full Access rejects repository inspection commands that Auto permits": `approvalPolicy: never` + exec-policy `prompt` rules yields `"approval required by policy, but AskForApproval is set to Never"`. Shows Codex rejects (rather than asks) when the policy forbids asking; same family as our "cannot request approval" symptom, but a different mode.
  - #19635, #8669, #18248, #7825/#7861 (app permission requests), #24257 (glob permission requests shown as command approvals), #13703 (subagent approvals shown in parent thread).

## 3. MCP tool approvals and user input

- `mcpServer/elicitation/request` (`Adapter:5390-5467`, helper `apps/server/src/provider/CodexMcpElicitation.ts`): turned into a T3 approval of kind `mcp-elicitation` (card label "App access approval"). Unsupported elicitations (anything `toMcpElicitationResponse(..., "accept")` cannot satisfy, e.g. `mode: "url"` or required fields it cannot fill) are auto-declined with a warning (`Adapter:5392-5400`); no active turn also auto-declines (`:5407-5412`).
- Options built by `describeMcpElicitation` (`CodexMcpElicitation.ts:~112-170`): Cancel, Decline, optional "Always allow this session" (`acceptForSession`), optional "Always allow" (`acceptAlways`), Approve. Persistence options are detected heuristically from `_meta.persist`, `_meta.allowPersistentApproval`, and form enum/boolean fields whose text contains session/always/permanent/forever/persistent.
- Response (`toMcpElicitationResponse`, `CodexMcpElicitation.ts:~172-220`): `decline`/`cancel` -> `{action: decline|cancel}`; accept -> `{action:"accept", content: <form fields auto-filled from enum option "once/accept/approve/allow" or defaults>, _meta:{persist:"session"|"always"}}`; if a required field cannot be filled -> `{action:"decline"}`. Users never fill MCP form fields themselves; T3 picks them.
- `item/tool/requestUserInput` (`Adapter:5609-5667`): questions are rendered as a user-input request; answers go back as `{ answers: { [questionId]: { answers: string[] } } }`, filtered to the allowed question ids (`toCodexUserInputAnswers`, `Adapter:~627-642`). Pending questions do not survive a server restart (`pendingRequestsSurviveRestart: false`, `Adapter:~245`; PR #23614 touches this).
- `item/permissions/requestApproval` (`Adapter:5328-5388`): accept -> grants the requested permissions with `scope: "turn"`, acceptForSession -> `scope: "session"`; anything else -> `{permissions:{}, scope:"turn"}` (`Adapter:596-609`).

## 4. Decline with feedback ("tell Codex what to do instead")

T3 has no dedicated feature. The approval card has only enum decisions. The workflow is: Decline (fixed rejection text), then the user sends an ordinary message, which T3 delivers as `turn/steer` (default for Codex since it supports active steering) or as interrupt + new turn when the user chooses restart delivery. I found no code that pairs a decline with the user's text, and no wording in `CodexDeveloperInstructions.ts` about approvals, read-only sandboxes or escalation (grep for read-only/escalat/granular returned nothing relevant).

## What T3 does about "edit"

It has none. There is no edited-command path. Anything "edit-like" is the user declining and typing a follow-up message that T3 steers or restarts. This is the same constraint Ptah has (no `modifiedInput` in the schema), and T3 does not address the model-refuses-to-escalate symptom.

## Recommendation for Ptah (options a-d)

Reasoned from T3's design plus your evidence; the final choice stays with the architect.

- (c) as the baseline, always: edit = decline (with Ptah storing the user's edited text as a message/feedback), because that is the only behaviour T3 itself ships and it needs no assumption about model behaviour. It is the only option that cannot regress.
- (a) decline + `turn/interrupt` + new `turn/start` carrying the edited command is the best "real edit" path. Evidence for it: T3 ships `restart_active` for exactly this shape and Codex declares `supportsSteeringByInterruptRestart: true` (`Adapter:261`); a fresh `turn/start` re-sends `approvalPolicy`/`sandboxPolicy` (`Adapter:731-817`), so the new turn re-derives its context from the policy rather than from the declined turn's "I was refused in a read-only sandbox" reasoning. This avoids the steer failure you saw, which is the model carrying the read-only conclusion within the same turn. Not proven (see Unknown 1).
- (b) decline + steer with wording naming escalation is cheap to try and keeps one turn, but it is the path T3 uses by default and your run 6j shows it failing; wording alone is a prompt-level mitigation with no protocol guarantee. Treat as a fallback to experiment with, not the primary design.
- (d) Something T3 does that you did not consider: not an edit mechanism, but two adjacent behaviours worth copying. (1) T3 chose `untrusted` + `readOnly` for its ask mode, not `on-request`/granular. With `untrusted`, writes are always approval-gated by Codex rather than left to model judgment about whether to escalate; whether that avoids the "can't request approval in read-only" refusal is untested here. (2) T3 uses Codex `approvalsReviewer: user`/`auto_review` per mode (`Adapter:692,815`). Neither is an edit feature.

Suggested order of experiment for run 6k: (a) with the edited command as the first user message of the new `turn/start`; then (b) variant with "request escalated approval (sandbox_permissions) for this write" wording; then, if still refused, ask whether the ask level should be `untrusted` (T3's choice) instead of granular.

## Unknown

1. Whether interrupt + new `turn/start` gets Codex to request approval for a write under read-only + granular. T3 evidence shows the mechanism exists, not that it produces an approval request in this configuration.
2. Whether `untrusted` + readOnly (T3's mode) vs granular-all-true changes the model's willingness to request approval. T3 has no test or issue on it; it was not examined in the Codex source.
3. Whether any T3 issue/PR discusses the refusal. Only GitHub search over titles/bodies was used (issue search API); closed or PR-comment discussions with different vocabulary may exist.
4. Whether codex 0.155.1 behaves like the Codex version T3's fixtures were recorded with (fixtures reference 0.156.1, PR #13533); not diffed.
5. T3's `Adapter:1910-1950` mode-change handling and `:6940+` interrupt details were read only in outline; exact pending-approval cleanup on interrupt was not traced.
