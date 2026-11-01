# Batch 8r-2 report

G7: a Codex execution-profile refusal now returns the fixed safe text with no `CODEX_RUNTIME_FAILED` code. Real Codex runtime failures still return that code.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.native.spec.ts`

## What changed

- `chat-session.service.ts:628-640` — `codexFailure` returns `{ success: false, error: CODEX_RESUME_PROFILE_CHANGED_MESSAGE }` when the adapter code is `resume-profile-changed` or its cause is `CodexResumeProfileChangedError`. The result has no `errorCode`.
- `chat-session.service.ts:657-665` — every other Codex adapter failure, including a genuine runtime failure, still returns `errorCode: 'CODEX_RUNTIME_FAILED'` (or the existing busy / unavailable / unsupported-option code).
- The same helper feeds every refusal return in this file: `startSession` (`:792`), `startAgentChildSession` (`:868`), `startHandoffSession` (`:964`), `continueSession` (`:1294`), `resumeSession` (`:1502`, including `activate: true` via `activationError` / omitted `activationErrorCode`), and `autoResumeIfInactive` (`:1958`, wrapped as `{ error: codexFailure }` for continue).

## Specs added

No new spec file. The path was already covered by `chat-session.native.spec.ts`.

- `:680-713` — shared assertion: exact refusal text, and no `errorCode` / `activationErrorCode` / `CODEX_RUNTIME_FAILED`.
- `:715-724` — adapter code `resume-profile-changed` on chat:start, chat:resume (`activate: true`), and chat:continue.
- `:726-734` — typed `CodexResumeProfileChangedError` cause on those same three paths.
- `:736-762` — an unclassified launch error (Claude-style) stays uncoded and keeps its own message on those three paths.
- Existing `failures` cases (`:764-790`) still require `CODEX_RUNTIME_FAILED` for a real runtime failure, and the other Codex codes are unchanged.

## Decisions

- Omit `errorCode` instead of inventing a new code. An uncoded `error` is how a specific Claude start refusal reaches the chat UI; `message-sender.service.ts` replaces `CODEX_RUNTIME_FAILED` with "Codex chat could not start."
- One classifier covers start, continue, and resume, including resume activation and continue auto-resume. Child and handoff starts share that helper, so they omit the code for this refusal too.
- No frontend edit. No matching skill for this RPC mapping (listed skills are UI, Nest, video, and workspace workflow). Ptah MCP `ptah_*` tools were not in the connected tool list; search for `ptah_agent_report` returned no server. Native file edits were used.

## Not done

- Tests, typecheck, and lint were not run. This lane forbids verify, build, test, lint, and typecheck.
- `ptah_agent_report` could not be called: no connected MCP server named `ptah`.
- Frontend `message-sender.service.ts` was left unchanged in the first pass. Revise 1 exports the shared failure-text helper from that file.

## Revise 1

Review item 1 asked to throw the profile refusal out of `chat:resume`. That throw is rejected: `ChatResumeResult` stays `success: true` with the loaded history, and callers branch on `activated === false` plus `activationError`. The backend contract and the 8r-2 `codexFailure` change are unchanged.

### Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\frontend\chat\src\lib\services\message-sender.service.ts` (mapping export only)

### What changed

- `session-loader.service.ts:1142-1147` — after a successful history replay, `showResumeActivationFailure` runs. A failed replay still throws and does not append a second error.
- `session-loader.service.ts:1327-1354` — when this resume asked to activate (`activate: true` and no target tab), `activated === false`, and `activationError` is a non-empty string, append one assistant bubble through `tabManager.setMessages`, the same channel `message-dispatch.service.ts` `showSendFailure` uses (`Message delivery failed. …`). History messages already on the tab stay in front of that bubble.
- `message-sender.service.ts:92-106` — exported `mapChatSendFailureText`. `sendFailureMessage` (`:176-185`) delegates to it, so start, continue, and resume activation share one code-to-text switch.
- A known code uses that switch. `CODEX_RUNTIME_FAILED` and `CODEX_UNAVAILABLE` still become "Codex chat could not start." An uncoded `activationError`, including the execution-profile refusal, is shown as that text. No provider check.

### Specs

In `session-loader.service.spec.ts`, inside chunked history replay:

- `:2669` — uncoded `activationError`: history replay runs first, the bubble is appended once, and the loaded message stays.
- `:2696` — `activated: true` appends nothing and still marks the session active.
- `:2713` — `activated: false` with no `activationError` appends nothing.
- `:2727` — a resume that did not ask to activate appends nothing.
- `:2743` — `activationErrorCode: 'CODEX_RUNTIME_FAILED'` uses `mapChatSendFailureText`, the same helper as start and continue.

### Decisions

- Do not throw. The shared contract keeps the transcript when activation fails.
- Show the failure only after the replay that loads history, and only once.
- Reuse `mapChatSendFailureText` instead of copying the Codex strings. The export is a function, not a one-token `export`, because the switch lived on a private method.
- Copy the `Message delivery failed.` prefix from `showSendFailure`. That method stays private on `MessageDispatchService`, which this lane cannot edit.
- No Angular component API change. `angular-frontend-patterns` is not in the available skill list.
- Ptah MCP is not connected (`ptah_agent_report` search returned no server). Native file edits were used. Tests, typecheck, and lint were not run.

### Not done (revise 1)

- Tests, typecheck, and lint were not run.
- `ptah_agent_report` was not called: no connected MCP server named `ptah`.
