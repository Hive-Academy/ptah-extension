# Fix round B2fix-B3-B4: backend (host side) report

Source review: `code-logic-review-B2fix-B3-B4.md`. Scope: the 2026-10-14 entry in `decisions.md`.
Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-skill`.
Status: DONE. All three host-side items are fixed. Nothing was committed, and no frontend file was touched.

## A. safeErrorKind: finite code allowlist (earlier B2 Blocking, PARTIAL)

- **Change.** `libs/backend/cli-agent-runtime/src/lib/session-children/safe-error-kind.ts:26-54`.
  - The regex `^E[A-Z0-9_]{1,30}$` is gone. In its place is the finite set `KNOWN_ERROR_CODES`, grouped by where a handoff can fail:
    - file system: ENOENT, EACCES, EPERM, EEXIST, EBUSY, ENOTDIR, EISDIR, EMFILE, ENOSPC
    - network: ETIMEDOUT, ECONNRESET, ECONNREFUSED, EAI_AGAIN
    - process and stream I/O: EPIPE, ERR_STREAM_DESTROYED
    - Node runtime: ABORT_ERR, ERR_INVALID_ARG_TYPE
  - A code that is not in the set is dropped. The name allowlist is unchanged.
  - The doc comment explains why a pattern is not enough (`ESECRET`).
- **Spec.** `safe-error-kind.spec.ts`:
  - The keep-list now covers ENOENT, EACCES, ECONNRESET, ABORT_ERR and ERR_STREAM_DESTROYED.
  - These codes are now dropped: `ESECRET`, `EFINISHBATCH3`, `ERR_SECRET` and `'ECONNRESET '` (trailing space), along with the earlier cases.
- **Consumers re-run.** Existing specs pass only codes from the list (`chat-session-agent-child.spec.ts:564` uses ENOENT):
  - `session-handoff.service.spec.ts`
  - `chat-session-agent-child.spec.ts`
  - `child-chat-session-host.adapter.spec.ts`
- **Result.** `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts .../safe-error-kind.spec.ts --coverage=false --maxWorkers=2` gives 27/27 passed. The `session-handoff.service.spec.ts` run gives 35/35 passed.

## B. The VS Code sender returns the real postMessage boolean (earlier B2 Serious, PARTIAL)

- **Change.** `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:219-222`. The method now does `return result;` (the value `postMessage` resolved to) instead of `return true`. The JSDoc `@returns` is updated. The raw error logging in the catch block is untouched, because that is deferred.
- **Spec.** `webview-manager.spec.ts` has two new tests:
  - A panel whose `postMessage` resolves false makes `sendMessage` resolve false, and `logger.error` is not called.
  - A registered view whose `postMessage` resolves false also makes it resolve false.
- **Caller audit.** I grepped `.sendMessage(` across `libs/backend` and `apps`.
  - `child-chat-session-host.adapter.ts:204` gets the intended fix: it now reports `uiAnnounced:false`.
  - `dashboard-namespace.builder.ts:167` now reports a surface that is not live as failed, which is correct. Its spec, which uses a real WebviewManager, passes.
  - `sdk-permission-handler.ts:270` and `:346`, and `ask-user-question.service.ts:91`, already branch on `delivered`. A false result now triggers their existing "not delivered" fallback (deny or auto-pick) at once, instead of hanging until the timeout. This is a behaviour change for a hidden webview that has no retained context. The message was never delivered in that case, so the fallback is the documented intent.
  - `approval-prompt.handler.ts:71` and `broadcastMessage` (`webview-manager.ts:300`) ignore the value.
  - The Electron and CLI adapters have their own implementations; the Electron one already returns the real result.
- **Result.** The `webview-manager.spec.ts` run gives 27/27 passed. `dashboard-namespace.builder.spec.ts` passes; it ran in the item C run below.

## C. B3 tool error handler leaks a thrown prompt (new Blocking 1)

- **Change.** `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts`:
  - `:451-460`: new `failureText(name, error)`. For `ptah_session_handoff`, only the namespace's own fixed `SESSION_HANDOFF_UNAVAILABLE_MESSAGE` passes through, matched by exact equality. Any other error becomes `unexpected error (<safeErrorKind>)`. Other session tools keep their current message, because the scope covers the handoff tool only.
  - `:499-504`: the main catch builds the cause once, and both `logger.warn` and the agent-facing `isError` text use it.
  - `:469-482`: the `takeHeld` catch now logs `safeErrorKind(error)` instead of the raw message, for every tool.
- **Boundary.** The new imports are value imports of `safeErrorKind`, from `@ptah-extension/cli-agent-runtime` (the barrel export is at `session-children/index.ts:49`), and of `SESSION_HANDOFF_UNAVAILABLE_MESSAGE`, from `../namespace-builders/session-namespace.builder`. vscode-lm-tools already depends on cli-agent-runtime at runtime:
  - `package.json:16`
  - `mcp-core/session-tools.ts:12-15`
  - `mcp-core/protocol-dispatcher.ts:42-45`
  - `mcp-core/session-tool-args.schema.ts:17`

  So this adds no new edge, and eslint reports no `@nx/enforce-module-boundaries` error.
- **Spec.** `session-tools.spec.ts`:
  - The "unavailable" test now uses the real constant. It checks the exact reply and the exact warn line.
  - New: an Error whose message, `name` and `code` all contain the prompt gives exactly `ptah_session_handoff failed: unexpected error (unknown)`, and no warn call contains `SECRET-CONTINUATION`.
  - New: a code on the allowlist (ENOENT) inside a message that quotes the prompt is reported as `unexpected error (Error (ENOENT))`, with no prompt in any log.
  - New: a held-completion take that throws with the prompt after a handoff leaves the prompt out of the reply and the logs.
  - Updated: the earlier held-take test expected the raw text `registry gone` in the log. It now expects exactly `[MCP] could not collect held session completions: Error` and no prompt.
- **Result.** `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts session-tools.spec.ts dashboard-namespace.builder.spec.ts session-namespace.builder.spec.ts --coverage=false --maxWorkers=2` gives 3 suites and 126/126 tests passed.

## Verification summary

- Jest:
  - safe-error-kind: 27/27
  - webview-manager: 27/27
  - vscode-lm-tools (3 suites): 126/126
  - rpc-handlers `chat-session-agent-child` and `child-chat-session-host.adapter`: 54/54
  - `session-handoff.service`: 35/35
- `npx prettier --write` on the 6 changed files: it reformatted the 3 specs; the source files were already formatted.
- `npx eslint` on the 6 changed files: 0 errors. There are 4 warnings in `webview-manager.ts` (`any` at :195, :299, :379, and a non-null assertion at :99). All of them were there before and none are on lines I changed.
- `ptah_get_diagnostics` was unavailable: twice it reported "TypeScript check still running after 45s". The project typecheck is left to the orchestrator. ts-jest compiled all the changed specs and sources without error.

## Changed files

- `libs/backend/cli-agent-runtime/src/lib/session-children/safe-error-kind.ts`
- `libs/backend/cli-agent-runtime/src/lib/session-children/safe-error-kind.spec.ts`
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tools.spec.ts`

## Decisions

- **Allowlist contents.** I kept `ERR_STREAM_DESTROYED`, which was not on the suggested list, because the earlier spec asserted it and stream teardown is a real handoff failure mode. All other entries come from the suggested list.
- **Handoff-only mapping in the main catch.** `ptah_session_start`, `send`, `status`, `read` and `stop` still return the thrown message. Their documented useful causes, such as "Agent sessions are unavailable", are existing behaviour with tests, and the review and the decision entry name only the handoff tool.
- **`SESSION_HANDOFF_UNAVAILABLE_MESSAGE` passes through by exact equality.** It is a constant that contains no prompt, and it tells the agent what to fix.
- **`takeHeld` reduces the error to its kind for every tool, not just the handoff.** The catch runs after a handoff, and a kind-only warn line costs the other tools nothing.

## Out-of-scope observations (not touched)

- `ptah_session_send` carries an agent `message`, and the main catch still copies the raw thrown message for that tool into the log and the reply. If the send path can throw an error that quotes the message, the same leak class applies. This needs a follow-up decision.
- Deferred as agreed: the raw error logging in `webview-manager.ts` (the catch at :223-228 and `broadcastMessage` at :306-310) and in `chat-stream-broadcaster.service.ts`.
- Deferred as agreed: Moderate 4 (bounds on the namespace handoff input).
