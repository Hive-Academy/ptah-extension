# Fix round B2 — TASK_2026_655 handoff (review: code-logic-review-fix-B2.md)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-skill`
(branch `feat/session-handoff-skill`, base HEAD `cb01a5f16`). Nothing committed or pushed.

## Finding 1 (BLOCKING): prompt can reach logs, Sentry and error text

### 1a. `errorKind` copied untrusted `Error.name` / `error.code`

- CREATED `libs/backend/cli-agent-runtime/src/lib/session-children/safe-error-kind.ts:22`.
  `safeErrorKind(error)` returns only allowlisted values. The name must be one of `Error`,
  `TypeError`, `RangeError`, `AbortError` or `TimeoutError`, otherwise it is `unknown`. A
  string code is appended only when it matches `/^E[A-Z0-9_]{1,30}$/`, e.g. `Error (ENOENT)`.
  A non-Error value gives `unknown`. The function never reads the message.
- Exported from `session-children/index.ts:49`, so it is part of the package barrel. That
  makes it one shared helper. `rpc-handlers` already imports values from
  `@ptah-extension/cli-agent-runtime` (`chat-session.service.ts:30-41`, `chat/di.ts:43`),
  so the import adds no new boundary edge.
- `session-handoff.service.ts:119,187,247`: these log lines now call `safeErrorKind`. The
  local `errorKind` that sat near the end of the file (old 424-431) is deleted.
- `chat-session.service.ts:745`: `startHandoffSession` now uses `safeErrorKind`, so the
  log, the Sentry `Error` message and the returned `error` text all carry only the
  allowlisted kind. The local `errorKind` that sat near the end of the file (old 1666-1673)
  is deleted.
- `child-chat-session-host.adapter.ts:165`: when the start throws, the adapter now reports
  `the session launch threw (${safeErrorKind(error_)}).`. Before, it used the raw
  `error_.name`. The same text is used for the outcome, the warn log and the `chat:error`.

### 1b. Handoff-path logs owned by B2

- `child-chat-session-host.adapter.ts:188-232` (`announce`): the old log contained the raw
  `error.message`. Now there is one fixed warn, `"<type> reached no webview; starting
  without a tab"`, with `{ tabId, surfaces, failureKinds }`. Each entry in `failureKinds`
  is a `safeErrorKind` value.
- `child-chat-session-host.adapter.ts:247-251` (`reportStartFailure` catch): logs
  `{ tabId, errorKind: safeErrorKind(error) }` in place of the raw message.
- The `chat:error` text for a handoff is built only from fixed refusal texts and
  allowlisted kinds (`chat-session.service.ts:745-755`, adapter `:165`).

### Specs (prompt in message, name AND code)

- `safe-error-kind.spec.ts` (new): allowlisted names and codes are kept; a quoting name
  gives `unknown`. Codes such as `E_<prompt>`, `<prompt>`, `ESECRET-CONTINUATION`, an
  over-long code, a lower-case code and a number are dropped. A non-Error gives `unknown`.
  When the name, code and message all hold the prompt, the result has no prompt text.
- `session-handoff.service.spec.ts`: a new `it.each` row `throws (prompt in message, name
  and code)`. The result and every output line are free of the prompt.
- `chat-session-agent-child.spec.ts`: new test `never copies an error name or code that
  quotes the prompt`. The result is `the session launch failed (unknown).`, and the
  Sentry message, the Sentry name and all logger calls are free of the prompt.
- `child-chat-session-host.adapter.spec.ts`: two new tests.
  - `a send that throws the prompt in its message, name and code logs none of it`
  - `a thrown start whose name and code quote the prompt reports only "unknown"`. Here
    the outcome, the `chat:error` payload and the logs are checked.

## Finding 2 (SERIOUS): `uiAnnounced` / `tabOpened` true without a recipient

The repository already has a delivery signal, so the port does not change.
`createDashboardBroadcast` (`vscode-lm-tools/.../dashboard-namespace.builder.ts:110-121`)
calls `getActiveWebviews()` and then `sendMessage()` for each surface. All three bound
`TOKENS.WEBVIEW_MANAGER` implementations already have both methods with a delivery answer:

| Host | `getActiveWebviews` | `sendMessage` → boolean |
| --- | --- | --- |
| VS Code `WebviewManager` | `vscode-core/src/api-wrappers/webview-manager.ts:280-284` (panels + views) | `:191-227`: `false` when the webview is missing or `postMessage` throws |
| Electron `ElectronWebviewManagerAdapter` | `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:74-76` (`hasLiveRenderer`) | `:47-62`: the `sendToRenderer` result, or `false` on a throw |
| CLI `CliWebviewManagerAdapter` | `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:51-53` always returns `[]` (no tabs; nothing in the CLI consumes `sessionHandoff:opened`) | `:25-32` |

Changes:

- `child-chat-session-host.adapter.ts:51-66`: a new exported `TabAnnouncementHost`
  structural type for the `TOKENS.WEBVIEW_MANAGER` slice the adapter uses
  (`getActiveWebviews`, `sendMessage(): Promise<boolean>`, `broadcastMessage`). It replaces
  the local `WebviewManager` type, whose `sendMessage` returned `void`. DI wiring and the
  token are unchanged.
- `announce` (`:188-232`): lists the surfaces, then sends to each through a deferred
  `sendMessage`, so a synchronous throw also counts as a failed send. It returns `true`
  only when at least one send resolved `true`. These cases all return `false`: zero
  surfaces, every send `false`, every send throwing, or the enumeration throwing. The
  session still starts in each case.
- `chat:error` after a failed start still goes through `broadcastMessage` (unchanged). It
  is sent only when `uiAnnounced` was true.
- Specs in `child-chat-session-host.adapter.spec.ts`:
  - zero recipients gives `false` and no send: `still starts with no open webview`
  - every send `false` gives `false`: `every webview refuses the send`
  - one of two delivered gives `true`
  - a throwing enumeration gives `false`
  - a throwing send gives `false`
  - the existing happy path gives `true`, and now asserts
    `sendMessage('ptah.main', type, descriptor)` and the order `send:` → `start`.
  - The harness gains `getActiveWebviews` and `sendMessage` mocks. Old "announcement
    failed" cases that modelled absence as a rejected `broadcastMessage` now model it as
    `getActiveWebviews → []`, which is how the concrete manager behaves. The "failing
    `chat:error` broadcast" cases now reject the first `broadcastMessage`, because the
    announcement no longer uses it.
  - The spec stubs `@ptah-extension/agent-generation` the same way `chat/di.spec.ts:23-28`
    does. The adapter now imports a value from the `cli-agent-runtime` barrel, and that
    barrel reaches TreeSitter (`import.meta.url`).

## Verification (from the worktree root)

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts .../safe-error-kind.spec.ts .../session-handoff.service.spec.ts --coverage=false --maxWorkers=1`
  → `Test Suites: 2 passed, 2 total; Tests: 56 passed, 56 total`.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts .../chat-session-agent-child.spec.ts .../chat/di.spec.ts .../child-chat-session-host.adapter.spec.ts --coverage=false --maxWorkers=1`
  - First run: 2 suites passed and 37 tests passed. The adapter suite failed to load
    (ESM TreeSitter through the barrel).
  - After adding the stub: the adapter spec alone gave `1 passed; Tests: 28 passed`.
  - The rpc-handlers jest config runs ts-jest with diagnostics on, so these suites also
    type-check the files they import.
- `npx eslint <the 9 changed files>`: 0 errors and 1 warning. The warning is the existing
  `max-lines` on `chat-session.service.ts` (1209 lines, limit 700). This round made that
  file about 8 lines shorter.
- `npx prettier --check <the 9 changed files>`: all formatted.
- `ptah_get_diagnostics` scoped to the adapter, its spec and `safe-error-kind.ts`: 0 errors.
- Not run, as instructed: Nx project targets, typecheck targets, build, serve and e2e.

## Changed files (Nx project)

- CREATED `libs/backend/cli-agent-runtime/src/lib/session-children/safe-error-kind.ts` (cli-agent-runtime)
- CREATED `libs/backend/cli-agent-runtime/src/lib/session-children/safe-error-kind.spec.ts` (cli-agent-runtime)
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/session-children/index.ts` (cli-agent-runtime)
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts` (cli-agent-runtime)
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.spec.ts` (cli-agent-runtime)
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts` (rpc-handlers)
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.spec.ts` (rpc-handlers)
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (rpc-handlers)
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts` (rpc-handlers)

Before committing, the orchestrator should run
`npx nx run-many -t test -p cli-agent-runtime rpc-handlers --parallel=1`.

## Decisions

- **One shared helper, in `cli-agent-runtime`.** `rpc-handlers` already depends on that
  barrel for values, so there is no new boundary edge. `@ptah-extension/shared` is a
  types-first library that the frontend also uses, so it was not used for a backend-only
  sanitizer.
- **No port change for delivery.** The existing `getActiveWebviews` + `sendMessage` pair
  from `createDashboardBroadcast` is the signal. All three bound managers already implement
  it, so no adapter in vscode, electron or cli was edited. `ptah_lsp_references` was not
  needed because no port signature changed. Grep shows no other constructor of
  `ChildChatSessionHostAdapter` (only DI in `chat/di.ts:110` and its spec).
- **"Any webview accepted" counts as announced.** VS Code can have a panel and a sidebar
  view open at once, and one live Angular instance is enough to adopt the tab.
- **CLI always reports `uiAnnounced: false`.** The CLI and TUI render no tabs and nothing
  there listens for `sessionHandoff:opened`, so `tabOpened: false` is the honest answer.
  The skill already handles it (`SKILL.md:51-56`).
- **The child path (`startChildSession`) still uses its raw thrown message.** It shares
  `announce` and `reportStartFailure`, so it gets the sanitized announce log and the honest
  delivery result. Its own thrown-message handling (`adapter.ts:107-110`) is TASK_2026_584
  behaviour outside this handoff-specific round, and it was left unchanged.
- **Residual in VS Code's own delivery answer, out of scope.** In
  `vscode-core/src/api-wrappers/webview-manager.ts:217-219`, `sendMessage` returns `true`
  whenever `postMessage` resolves, even when it resolves `false` (message dropped). Both
  VS Code surfaces set `retainContextWhenHidden: true`
  (`apps/ptah-extension-vscode/src/core/ptah-extension.ts:126`,
  `providers/angular-webview.provider.ts:177`), so a drop needs a disposal race. Changing
  this return value would change behaviour for every `sendMessage` caller, including
  dashboard delivery. It should be a separate task.
- **Out of scope for a separate task: shared paths that apply to every chat session.**
  These were not changed:
  - `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:221-224`: `sendMessage`
    logs the raw `postMessage` error object.
  - `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts:306-309`:
    `broadcastMessage` logs the raw per-view broadcast error object.
  - `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:314-335,347-369`:
    a stream error log and Sentry capture, plus the `chat:error` text taken from the raw
    stream error. After launch this can carry the initial prompt of any session, not only
    a handoff.

  Fixing them needs a cross-session policy, for example sanitizing every stream error or
  marking sessions as prompt-sensitive. That is not a handoff-local change.
- **No test against the concrete VS Code `WebviewManager` in `rpc-handlers`.** Doing so
  would mean mocking `vscode` inside `rpc-handlers`. The adapter specs pin the contract of
  the pair (zero surfaces, a `false` send, a throwing send), and the concrete answers are
  cited in the table above.
