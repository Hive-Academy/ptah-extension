# Fix report — autopilot toggle targets the active tab's session (TASK_2026_660 follow-up)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-child-session-permission`
(branch `fix/child-session-permission`). Paths below are relative to it. Nothing was
committed; the previous agent's uncommitted changes (rpc-handlers, cli-agent-runtime, docs)
were not touched.

## 1. Root cause

- `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts:231-250`
  (before the fix) called `setPermissionLevel(level)` and `toggleAutopilot()` with no
  session id, although both `AutopilotStateService` methods already take one
  (`libs/frontend/core/src/lib/services/autopilot-state.service.ts:147,195-198`, sent as
  `sessionId: sessionId ?? null` at `:160-164,210-214`). The typed contract already carries it:
  `ConfigAutopilotToggleParams.sessionId?: SessionId | null`
  (`libs/shared/src/lib/types/rpc/rpc-config.types.ts:57-58`).
- With no id, `config:autopilot-toggle` falls back to the most recently active session
  (`libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:369-371`) and only
  that session's `SessionRecord.permissionLevel` changes
  (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:494-512`).
  When the user had last used a different tab (for example a child tab), the tab they are
  looking at kept its old level, the UI showed the new one, and a child started from that
  tab inherited the old level (`chat-session.service.ts` `childPermissionLevel` reads the
  parent's record first).

## 2. Changes

- `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts`
  - `:3-10` imports `input` and `type SessionId`.
  - `:194-200` new input `sessionId = input<SessionId | null>(null)`, the SDK session id of
    the composer's tab.
  - `:240-245` `enableAutopilot()` passes it to `setPermissionLevel(level, sessionId)` and
    `toggleAutopilot(sessionId)`.
  - `:263` `disableAutopilot()` passes it to `toggleAutopilot(sessionId)`.
  - The component stays presentational. It still uses only `@ptah-extension/core`,
    `@ptah-extension/shared` and `@ptah-extension/ui`, and it does not import the `chat` lib.
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`
  (the smart parent)
  - `:410-413` binds `[sessionId]="tabSessionId()"` on `<ptah-autopilot-popover>`.
  - `:418` the MCP status chip binds the same computed.
  - `:565-582` renamed `mcpSessionId` to `tabSessionId` because two consumers now use it,
    and updated its doc comment. The resolution is unchanged and follows the existing
    pattern: a canvas tile uses its own tab's `claudeSessionId` through SESSION_CONTEXT, and
    the main panel uses `chatStore.currentSessionId()` (= `tabManager.activeTabSessionId`).
    No other file referenced `mcpSessionId`.
- CREATED `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.spec.ts`
  with 4 tests:
  - enable sends the tab's session id to both calls
  - disable sends it
  - `null` is sent while the tab has no session
  - the popover follows a changed input
- No backend change, and no change to the shared contract (the param already exists).

## 3. Nx projects

- `chat-ui` (popover and new spec)
- `chat` (chat-input binding)

## 4. Specs and results

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.spec.ts --coverage=false --maxWorkers=1`
  → `Tests: 4 passed, 4 total`. Before the fix, `toggleAutopilot` was called with no
  argument, so the first two tests could not pass.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts --coverage=false --maxWorkers=1`
  → `Tests: 68 passed, 68 total`. The stack traces in the output are console noise from
  existing tests.
- `npx eslint` on the 3 changed or created files → 0 errors. There is 1 warning:
  `chat-input.component.ts` max-lines 1140/700, which was already over the limit before
  this change (+7 lines here). `@nx/enforce-module-boundaries` was skipped ("No cached
  ProjectGraph"). The boundary was checked by hand: the popover imports no new lib.
- Not run, per the task's memory-safe rules: nx project-wide test, typecheck and lint.

## Decisions

1. **The toggle re-gates the active tab's session only. It is not sent to every live
   session.** `AutopilotStateService` is one root store, so the ideal is "what the UI shows
   = what every session enforces". Sending the level to all of
   `getActiveSessionIds()` would break three rules the backend relies on:
   - **Gateway security gate (TASK_2026_192).** Gateway (Telegram/Discord/Slack) sessions
     live in the same registry. Their level is seeded from `ptah.gateway.permissionLevel`,
     and the code says it is "seeded at start/resume, never flipped post-hoc"
     (`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:10-20`). A broadcast
     would let a webview toggle to `yolo` auto-approve Write/Bash on a remote,
     non-interactive path.
   - **Per-session / per-workspace scoping is deliberate.** "a tool call in one
     workspace's session never sees another workspace's level"
     (`session-registry.service.ts:84-90`, `session-query-executor.service.ts:750-757`).
   - **Child-session levels are derived.** A child is never started in `plan` (fix-report
     Decision 2). A broadcast of `plan` would push live children into SDK plan mode, which
     the unattended policy denies (`sdk-permission-handler.ts:689-695`).

   Excluding gateway and child sessions from a broadcast would need new origin metadata on
   `SessionRecord` across agent-sdk and rpc-handlers. That is not a small change.
2. **How UI and enforcement agree after this fix.**
   - The session of the tab the user toggles on enforces the new level immediately.
   - Every session started afterwards, in any tab, is seeded from the global default the
     toggle sets: `permissionHandler.setPermissionLevel`, `config-rpc.handlers.ts:357-360`,
     read at `session-query-executor.service.ts:748-749`.
   - A child spawned from the toggled tab inherits the new level. This was the reported
     bug.

   Remaining gap: another tab that already had a live session keeps its own level until the
   user toggles from that tab, and its popover shows the global value. Closing that gap
   properly means making the UI show each session's own level (per-session autopilot state
   in the webview). That should be a separate task.
3. **The backend no-id fallback stays.** The TUI and CLI call `config:autopilot-toggle`
   without a `sessionId` and rely on `getActiveSessionIds()[0]`:
   - `apps/ptah-tui/src/hooks/use-mode.ts:68`
   - `apps/ptah-tui/src/components/settings/BehaviorSection.tsx:110,126`
   - `apps/ptah-tui/src/hooks/use-agent-config.ts:139`
   - `apps/ptah-cli/src/cli/commands/config.ts:472`

   For that reason rpc-handlers is not changed and no backend spec is needed.

## Out-of-scope observations

- A webview tab with no live session yet still sends `sessionId: null`. The backend then
  falls back to `getActiveSessionIds()[0]` and re-gates whichever session was most recently
  active. In the webview that write is at least consistent with the global UI. The fallback
  can also pick a **gateway** session, though, and change its level after the fact, which
  goes against the TASK_2026_192 invariant above. This was already true before this change
  and also affects the TUI and CLI.

  Possible fix (backend, rpc-handlers): skip the fallback when the target is a gateway tab
  (`GATEWAY_TAB_PREFIX`), or let the webview mark "no session" explicitly. It needs its own
  decision because the CLI and TUI depend on the fallback.
- `chat-input.component.ts` is 1140 lines against the 700-line `max-lines` limit. This was
  already the case before this change.
