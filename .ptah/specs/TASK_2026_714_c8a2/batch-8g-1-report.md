# Batch 8g-1 implementation report

Implemented the assigned option policy and approval settlement; regression specs are written but not executed. Renderer replay is deferred under the batch's explicit scope rule. **Default Electron chat remains blocked by its unconditional `ptahUiFence: true` input under the assigned rejection policy.** This conflict was reported to the spawning team leader; no frontend or policy expansion was made.

## Task outcomes and evidence

Paths in this section are relative to W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

1. **8g-1.1 / D5 option policy: implemented.**
   - `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts:1` preserves the original supported-key allow-list. `:42` exports the pure classifier: supported values are copied into a new object, stripped/rejected results contain key names only, undefined entries are ignored, and future defined options remain rejected.
   - Host/Claude flags are stripped, empty `mcpServersOverride` is stripped, non-empty overrides and the explicitly unsupported options are rejected. No stripped input reaches profile preparation/building.
   - `codex-chat-profile-options.ts:32` exports `CodexChatOptionError` with readonly `code = 'unsupported-option'`, readonly `key`, and a message naming only the key.
   - `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:148` consumes the classifier, logs `ptah-mcp-not-attached` exactly once per invocation with `mcpServerRunning === true`, and throws the coded error for the first rejected key. No option value is logged.
   - `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.spec.ts:6` covers supported keys, purity, true/false stripped flags, empty/non-empty overrides, defined rejected/future options (including falsy values), undefined values and the exported error.
   - `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:190`, `:208`, `:218` cover secret-free option errors, class/code/key/message, stripping before `ChatRuntimeProfileService.prepare`, and coded MCP logging.

2. **8g-1.2 / real configs: implemented in the existing `chat-session.native.spec.ts`, following the team-leader correction.**
   - The originally named `chat-session.service.spec.ts` did not exist. After the team leader explicitly authorized the existing native spec first, the regression was added to its existing `harness` (`:72`). The standalone service spec created before that answer arrived has been removed. No fallback focused spec was necessary, and no other existing spec was edited during this correction.
   - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:118` adds the regression using the existing service and adapter mocks. `:142` drives the public `startSession` entry used by `chat:start` and the real `launchSdkSession`. `:145` captures the config actually received by `startChatSession`; the test does not assemble the config. The existing empty MCP-override mock is retained.
   - `:157` drives the real `autoResumeIfInactive` path; `:163` captures the config actually passed to `resumeSession`.
   - Both captures assert `mcpServerRunning: true`, `workflowsDisabled: false`, absent `thinking`/`outputStyleName`, and an empty classifier rejection list. Start also asserts absent MCP overrides. Defaults come from the mock workspace provider's default-value behavior and no selected output style.
   - This proves the backend default configuration contract once executed; it does **not** claim Electron's additional `ptahUiFence` field is accepted.

3. **8g-1.3 / M-N4, S3: implemented.**
   - `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:344` retains successful settlement. Rejected/throwing owned responses retain coded warnings (`:349`, `:356`), settle and release the notice, send `PERMISSION_AUTO_RESOLVED` (`:360`), and return true. The first owned response cannot fall through into Claude; a later stale/unknown id returns false as before.
   - The misleading retry comment is replaced with the renderer-dismissal explanation. The swallowed response catch retains its `degradation-audit: reported` marker; the delivery-decline catch also has a coded-report marker.
   - `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts:297` covers both false and throwing sinks, exact attention key/timestamp release, auto-resolution payload, consumed response, one router attempt, and removal of the pending entry.

4. **8g-1.4 / M3 resolved-but-undelivered broadcast and M-N7 reload replay: deferred, as permitted.**
   - Codex's dependency exposes only `broadcastMessage` (`codex-chat-host-ports.ts:46`); the shared `WebviewManager` contract at `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:71` returns `Promise<void>` and exposes neither a delivery receipt nor a renderer-ready subscription.
   - Electron already has delivery information: `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:103` calls `sendToRenderer` but discards its boolean and resolves. The adapter's `getActiveWebviews` at `:88` is not part of the injected Codex port; merely checking a live window would still not establish Angular handler readiness after reload.
   - Electron readiness exists in `apps/ptah-electron/src/activation/bootstrap.ts:212`: `createAttentionRendererReadiness` watches `attention:getSnapshot` and loading events, with one-shot ready listeners. It is wired into host notification capabilities, not the Codex host ports. Connecting it requires composition/bootstrap changes outside ownership and a defined listener lifecycle.
   - Claude's existing recovery is `chat:pending-questions`, `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:317`, calling `SdkPermissionHandler.listPendingQuestions` at `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:1216`. It returns `AskUserQuestion` requests, not pending native approval entries. Reusing it requires changing RPC ownership/contracts beyond these files.
   - VS Code's ready callback (`libs/backend/vscode-core/src/services/webview-message-handler.service.ts:214`) also does not supply an injected Codex hook and does not solve Electron readiness.
   - Therefore a reliable implementation is not a <=40-line change confined to the declared files. Existing rejected-broadcast decline behavior remains; successful-but-undelivered broadcasts and reload recovery are not claimed fixed.

## Renderer findings

- `libs/frontend/chat/src/lib/services/message-sender.service.ts:465` invokes `chat:start`. Its default options at `:477` contain model/files/images/effort/systemPrompt, not `thinking` or `outputStyleName`.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:925` reads optional `options.thinking`; resume reads optional `params.thinking` at `:1688`. With default requests these remain undefined.
- Output-style fields are resolved by the backend (`chat-session.service.ts:907`). `libs/backend/output-styles/src/lib/output-style-session-activation.service.ts:157` returns no fields when no style is selected, while `:216` can produce `outputStyleName` for a selected flag-tier style. Such an explicit selection remains rejected by policy.
- **Additional blocker:** `message-sender.service.ts:476` always supplies `ptahUiFence: true` for Electron. `chat-session.service.ts:645` forwards it to launch, and `:939` puts it in the adapter config. The batch requires rejecting that key. The default renderer send therefore still fails this policy even though the default backend-config regression contains no rejected keys. Resolving this needs a coordinated runtime-aware frontend/host change or an explicit policy revision; both are outside this lane's assigned scope. Reported immediately to the leader.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Use the existing native-session spec | The team leader authorized the existing native spec first, with a focused new spec only if its mocks were insufficient. Its harness supports real public start and inactive-session resume, so the regression now resides there. The prematurely created service spec was removed. | Yes |
| Strip empty MCP override maps | Forward vs strip vs reject. The plan rejects only non-empty maps; stripping avoids claiming native attachment support. Invalid defined non-object values still fail closed. | Yes |
| Keep rejecting `ptahUiFence` and escalate the Electron conflict | Silently weaken explicit policy vs change undeclared renderer code vs report the conflict. The batch explicitly chooses rejection; renderer source proves a remaining blocker. No broader design decision was assumed. | Yes, after coordinator direction |
| Defer M3 remainder/M-N7 | Local replay hack vs extending host delivery/readiness/RPC boundaries vs defer. Existing lifecycle signals are outside the injected boundary and declared files. The batch explicitly permits deferral in this case. | Yes |

## Verification and limitations

- No verify, test, lint, typecheck, build, Nx, npm, install, or git **shell command** was run. Team-leader verification is required; no passing test result is claimed.
- The backend role mandates `ptah_get_diagnostics` after edits. The initial call, scoped to the original five changed TypeScript files, selected `typescript-compiler` and returned **Unavailable** after 45 seconds, reporting all five files unchecked and compiler work still running/not cancelled. After the team-leader correction, one new call scoped only to `chat-session.native.spec.ts` also returned **Unavailable** after 45 seconds, with that file unchecked and compilation still running/not cancelled. Neither unavailable result was retried; neither is a passing verification result.
- All five retained source/spec files are below 700 lines: host ports 386, host spec 482, classifier 67, classifier spec 94, native session spec 353.
- `ptah_code_search_symbols` returned an empty index; targeted native searches were used for the missing symbol information. No production files beyond the declared set were modified.
- No settings files, machine-owned task documents, task states, or batch statuses were edited.

## Every file written (absolute paths)

Modified:

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts`

Created:

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-profile-options.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-1-report.md`

Created before the team-leader answer, then removed in compliance with that answer (not retained):

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.spec.ts`

No other files were written by this lane. `chat-session.codex-profile-config.spec.ts` was not needed or created.
