# Batch 8m-6 report — `allowedDecisions` leaves the shared contract

Lane: grok. Task TASK_2026_714_c8a2, round 8m, batch 8m-6 (G5 shared/frontend). Decision D16.

`allowedDecisions` is gone from `PermissionRequest`. Every permission the attention rail offers is answered with Claude's decisions: `allow`, `always_allow`, `deny`, `deny_with_message`. No Codex action set remains in these frontend services.

Tests, lint, and typecheck were not run. This lane is forbidden to verify. The team-leader runs `npm run verify` for `@ptah-extension/shared`, `@ptah-extension/chat-streaming`, and `@ptah-extension/chat`, then typecheck for the hosts.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\shared\src\lib\types\permission.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat-streaming\src\lib\permission-handler.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat-streaming\src\lib\permission-handler.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat\src\lib\services\chat-attention-source.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat\src\lib\services\chat-attention-source.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat\src\lib\services\chat-attention-action-dispatcher.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat\src\lib\services\chat-attention-action-dispatcher.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8m-6-report.md`

No other file was edited. Backend files were not touched.

## What changed

`PermissionRequest` no longer has `allowedDecisions`. The unused `SessionApprovalDecision` import left `permission.types.ts` with it. `SessionApprovalDecision` itself stays in `session-runtime.types.ts` (the backend approval sink still uses that type).

`PermissionHandlerService.handlePermissionResponse` accepts a pending request and posts `SDK_PERMISSION_RESPONSE` with the Claude `PermissionResponse` unchanged, including `modifiedInput` and `reason`. Hard deny is still only `decision === 'deny'`.

`ChatAttentionSourceService` builds the same permission actions for every request: Allow, Always allow, Deny, Deny with message, plus Open / Show in canvas. Questions and lane permissions are unchanged (lane stays allow/deny).

`ChatAttentionActionDispatcherService` sends those four decisions through `AgentPermissionResponder.respondSession`. The stale-pending check lists the same four ids. `cancel` is no longer an attention action.

## Removed symbols and former callers

Grep covered `libs/` and `apps/` (`*.ts`, `*.tsx`, plus `*.json` / `*.html` / `*.js`). Callers outside this batch's files were left in place and are listed here.

| Symbol | Former callers | Disposition |
| --- | --- | --- |
| `PermissionRequest.allowedDecisions` | `permission-handler.service.ts` (pending check ~452 and `handleApprovalDecision`); `chat-attention-source.service.ts` (~206, action filter); `chat-attention-action-dispatcher.service.ts` (~82, native branch); the three `*.spec.ts` files | Removed with those readers. |
| `APPROVAL_RESPONSE_DECISION` (private map: accept/acceptForSession/decline/cancel, including `decline: 'deny_with_message'`) | Only `permission-handler.service.ts` | Removed. No other file imported it. |
| `PermissionHandlerService.handleApprovalDecision` | Definition in `permission-handler.service.ts`. Callers: `chat-attention-action-dispatcher.service.ts` and `chat-attention-action-dispatcher.service.spec.ts`. No `apps/` caller (VS Code webview, TUI, CLI). | Method and both call sites removed. The dispatcher no longer injects `PermissionHandlerService`. |
| `APPROVAL_DECISION_ACTIONS` | Defined and used in `chat-attention-source.service.ts`. Imported by `chat-attention-action-dispatcher.service.ts`. Not re-exported from `libs/frontend/chat/src/lib/services/index.ts` (that barrel exports the class only). | Constant and both uses removed. |
| Attention action id `cancel` | Only produced by `APPROVAL_DECISION_ACTIONS` and accepted in the dispatcher's pending-permission id list. Specs asserted it for native requests. | Removed. It existed only for the native `cancel` decision. Claude deny is unchanged. |

`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts` (~727 and ~745) still has `expect(payload).not.toHaveProperty('allowedDecisions')`. That is an absence check on the host payload, not a read of the removed type member. The host stopped setting the field in batch 8m-3 (`d2f2fb2c5`). Removing the type member does not make those two lines fail to compile. The file was not edited.

`permission.schemas.ts` and `permission.parsers.ts` never declared the field. The parser remains the only renderer wire entry and still drops an extra `allowedDecisions` key. The new specs pass a payload that includes the key and assert the parsed request has no such property.

No reader remains under `apps/` (Electron, VS Code extension, CLI, TUI) or other `libs/` projects. Claude `deny_with_message` on `PermissionResponse`, the permission card, the canvas rail, and the host's Claude-to-native decision map are separate and were left as they are.

## Specs

Deleted, because they only exercised the native path:

- `permission-handler.service.spec.ts` describe `native approval decisions (allowedDecisions)`: wire mapping of accept/acceptForSession/decline/cancel, rejection of a disallowed decision, rejection of edited input or a message, refusal of `handleApprovalDecision` on a Claude request.
- `chat-attention-source.service.spec.ts`: `renders exactly the allowed native decisions and no message control`, `labels all four native decisions`.
- `chat-attention-action-dispatcher.service.spec.ts`: `answers a native %s action with the %s decision`, `refuses a message action and stale native decisions`, and the `codex` live-item fixture.

Kept, same meaning:

- Handler: tab-less allow/deny, missing request, SDK post, hard-deny buckets, `deny_with_message` plus reason is not a hard deny, independent in-flight requests.
- Source: closed-tab permission still offers `allow`, `always_allow`, `deny`, `deny_with_message`, `open`.
- Dispatcher: closed-tab session responder, denial feedback and empty reason, stale `always_allow` / `deny_with_message`, lane and notice routes.

Added one spec per service. Each builds the request with `parsePermissionRequest` and a wire object that still carries `allowedDecisions`, then asserts the parsed value has no such property:

- Handler: posts `allow` (with `modifiedInput`), `always_allow`, `deny_with_message` (with reason), and `deny`, and records a hard deny only for `deny`.
- Source: actions are Allow, Always allow, Deny, Deny with message, Show in canvas.
- Dispatcher: those four decisions call `respondSession` with the parsed request. `deny_with_message` passes the reason.

## Decisions

### D16 stands: the field leaves the contract instead of being parsed

- Decision: delete `allowedDecisions` and the frontend native-decision path. Every request uses Claude's actions and Claude's decision vocabulary.
- Options: (1) remove the field end to end, chosen. (2) teach `parsePermissionRequest` to copy `allowedDecisions` and keep the batch-8c readers. Rejected by D16: the parser never carried the key (`permission.parsers.ts` ~47-107), so those readers were already dead for every live prompt, and option 2 would render Codex prompts differently from Claude.
- Evidence: `decisions.md` P8 D16; `batches.md` Batch 8m-6; batch 8m-3 stopped sending the field; grep showed no remaining assignment.
- Reversible: yes. Restore the optional field and the three readers from the parent of this batch. The parser and schema would still need a separate change before a live prompt could populate the field.

### `cancel` goes away with the native action table

- Decision: do not keep a `cancel` attention action after `APPROVAL_DECISION_ACTIONS` is removed.
- Options: (1) drop it, chosen. (2) map `cancel` onto Claude `deny` as a fifth button. Rejected: the task says the action goes if it exists only for native decisions, and a fifth button would be a Codex special case.
- Evidence: the id was produced only by `APPROVAL_DECISION_ACTIONS` (`decision: 'cancel'`). Canvas and `isPermissionDecision` already listed only the four Claude ids.
- Reversible: yes, by restoring the native table.

### Dispatcher no longer depends on `PermissionHandlerService`

- Decision: delete the inject along with `handleApprovalDecision`. Session answers stay on `AgentPermissionResponder`.
- Options: (1) remove the dependency, chosen. (2) leave an unused inject so the spec provider stays. Rejected: an unused inject fails compilation.
- Evidence: the field was used only by the native branch.
- Reversible: yes.

## Not done

- No verify, test, lint, or typecheck (lane rule). Chat's pre-existing lazy-load import lint errors on main were not touched.
- No commit, push, or other git state change.
- `codex-chat-host-ports.spec.ts` was not edited. It should keep compiling; see the caller table.
- Nothing else in `apps/` or `libs/` had to change for the removal. If a later host typecheck names a caller this grep missed, that file is outside this batch's edit list.
