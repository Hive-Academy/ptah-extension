# Fix round — code-logic-review.md (TASK_2026_660)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\fix-child-session-permission`
(branch `fix/child-session-permission`, on top of `b5dfd343d`). Nothing committed or pushed;
no state-changing git command was run.

Verdict: all 3 findings fixed; every changed spec passes; eslint reports 0 errors.

## F1 (Blocking) — an unknown parent level escalated a child to the saved `yolo`

Status: DONE.

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
  - `childPermissionLevel` (line 709): `undefined` or `plan` -> `ask`; otherwise the
    parent's level. The child path no longer reads `autopilot.*` config: the
    `savedAutopilotLevel` method and the `parsePermissionLevel` import are removed. The
    doc comment says why the global level must not be used.
  - `AgentChildSessionStartParams.permissionLevel` doc (line 142): absent (unknown
    parent level) -> `ask`.
- The `plan` -> `ask` rule is unchanged: a child is never started in `plan`.
- Covered sources of an unknown level: no lifecycle record, a record that disappears
  between the spawner's guard read (`session-spawner.service.ts:310`) and the host
  adapter's re-read (`child-chat-session-host.adapter.ts:57-59`), and a host that passes
  no level. All three reach the service as `permissionLevel` absent.
- Tests in `chat-session-agent-child.spec.ts`:
  - The test that pinned the escalation ("falls back to the saved autopilot level")
    is replaced by "starts the child at ask when the parent record is missing, even
    with a saved yolo level" (line 363).
  - Added "starts the child at ask when the parent level is unknown and autopilot is
    off" (line 375).
  - Removed "unknown saved level -> ask": it tested the deleted saved-config parsing.

## F2 (Blocking) — a toggle from a tab with no session re-gated another live session

Status: DONE.

- `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts`
  - The toggle handler (line 366) calls the new private `autopilotTargetSession`
    (lines 424-433):
    - a session id -> that session;
    - an explicit `null` -> no live session (the config and the permission-handler
      default are still saved);
    - omitted or `''` -> the most recently active session (unchanged legacy CLI/TUI
      behaviour).
  - Added `type SessionId` import.
- `libs/shared/src/lib/types/rpc/rpc-config.types.ts` (lines 57-64): documents the three
  meanings of `ConfigAutopilotToggleParams.sessionId`. The existing type (`SessionId | null`,
  optional) already allowed the distinction, so the type is unchanged.
- Callers checked:
  - The webview `AutopilotStateService` always sends a session id or `null`.
  - The TUI (`apps/ptah-tui/src/hooks/use-mode.ts:60-63`,
    `components/settings/BehaviorSection.tsx:110,126`) and the CLI
    (`ptah config autopilot`) omit the field, so they keep the fallback.
- On a `null` toggle, `SdkPermissionHandler.setPermissionLevel` is still called. This
  sets the global default that seeds new and resumed sessions
  (`session-query-executor.service.ts:749`). It does not change a live interactive
  session, which gates through its own `levelResolver` (`sdk-permission-handler.ts:569-571`).
- Tests in `config-rpc.handlers.spec.ts`:
  - "changes no live session when the sessionId is explicitly null" (line 578): with
    two live sessions `sess-a` and `sess-b` and a `null` id, `setSessionPermissionLevel`
    is never called, and the config and default are saved.
  - "changes only the named session when two sessions are live" (line 608).
  - The comment on the omitted-id test now names CLI/TUI callers.

## F3 (Serious) — a tab's popover showed the global level, not its own session's live level

Status: DONE. Recorded decision kept: a toggle is not sent to every live session. Only the
display changed.

Mechanism: a host read. `config:autopilot-get` takes an optional `sessionId` and also
returns that session's live level. I first considered a frontend-only per-tab record and
rejected it. New and resumed sessions both start at the saved default at that moment, and
the webview cannot tell when `chat:continue` resumes a session that was not live. A
frontend snapshot would therefore drift for history tabs, agent-child tabs (which start at
the parent's level) and after a webview reload. The host lifecycle record is the source of
truth.

- `libs/shared/src/lib/types/rpc/rpc-config.types.ts`
  - New `ConfigAutopilotGetParams { sessionId?: SessionId | null }` (line 74).
  - `ConfigAutopilotGetResult.sessionPermissionLevel?: PermissionLevel | null` (line 89):
    `null` means the session is not live; absent means no session was requested.
- `libs/shared/src/lib/types/rpc.types.ts`: imports the params type (line 153);
  `'config:autopilot-get'.params` changes from `Record<string, never>` to
  `ConfigAutopilotGetParams` (line 911). The existing `{}` callers still type-check.
- `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts`
  - Optional injection of `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER` as the last
    constructor parameter (line 97). This is the same pattern
    `child-chat-session-host.adapter.ts:47-48` uses.
  - `registerAutopilotGet` (line 438): with a session id it returns
    `sessionPermissionLevel = lifecycle.find(id)?.permissionLevel ?? null` (line 461).
    Without one, the response is unchanged.
- `libs/frontend/core/src/lib/services/autopilot-state.service.ts`
  - New `AutopilotTabState` type, exported through `services/index.ts`.
  - `_sessionLevels` map (line 88), holding each session's live level as read from the
    host or set by a toggle in that tab.
  - `stateFor(sessionId)` (line 144): the live level if known (`ask` shows as disabled),
    otherwise the saved default.
  - `statusTextFor(state)` (line 157); the global `statusText` now delegates to it.
  - `refreshSession(id)` (line 172): reads the host. A session that is not live drops
    its entry. A read overtaken by a toggle is discarded through `writeEpoch`.
  - `toggleAutopilot` and `setPermissionLevel` (lines 204, 236) now act on the tab's
    own state. They share `persist` (line 257): one RPC, an optimistic update of both
    the default and the tab's session, and a rollback of both on failure.
  - When enabling, the level comes from the remembered default, so the earlier
    "preserve level for next enable" behaviour is unchanged.
- `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts`
  - New `tabState`, `tabEnabled` and `tabStatusText` computeds (lines 205-211).
  - The template only swaps `autopilotState.enabled()` for `tabEnabled()` and
    `autopilotState.statusText()` for `tabStatusText()`. No markup, class or style
    changed.
  - An `effect` reads the tab's live level whenever the session id input changes
    (line 213). Opening the dropdown re-reads it (line 243).
  - The `sessionId` input doc now describes what `null` means.
- Tests:
  - `autopilot-state.service.spec.ts` `describe('per-tab state')` (line 350), 7 tests:
    - host read of a tab's level;
    - a toggle in A leaves B's live level alone, and the default follows A;
    - a toggle with a `null` session changes no tab;
    - disabling shows Manual and keeps the level;
    - a session that is not live shows the default;
    - rollback on failure;
    - a stale host read is discarded.
  - `autopilot-popover.component.spec.ts`:
    - The existing fake now has the new service surface.
    - Added "re-reads the tab's live level when the dropdown opens" (line 95). The
      session-change test also asserts the read.
    - New `describe('AutopilotPopoverComponent across tabs')` (line 111) uses the real
      service over an RPC fake that keeps per-session levels like the host.
    - "toggling in tab A leaves tab B's popover on B's own level" (line 191): A goes
      from Manual to Full Auto while B's rendered label stays Auto-edit, before and
      after B's dropdown re-reads the host.
    - "a fresh tab shows the saved default, which follows the last toggle" (line 212).

## Verification (worktree, targeted only)

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts config-rpc.handlers.spec.ts
  chat-session-agent-child.spec.ts child-chat-session-host.adapter.spec.ts
  --coverage=false --maxWorkers=2`: 3 suites, 70 passed, 1 skipped (a pre-existing
  `it.skip` at `config-rpc.handlers.spec.ts:257`), 71 total.
- `npx jest -c libs/frontend/core/jest.config.ts autopilot-state.service.spec.ts`:
  23 passed (16 existing unchanged, 7 new).
- `npx jest -c libs/frontend/chat-ui/jest.config.ts autopilot-popover.component.spec.ts`:
  7 passed.
- `npx jest -c libs/frontend/chat/jest.config.ts chat-input.component.spec.ts`: 68 passed.
  This spec mocks `AutopilotStateService`; I ran it to confirm the new service surface
  does not break it. The file is unchanged.
- `npx prettier --write` on all changed files reformatted `config-rpc.handlers.ts` and
  `autopilot-popover.component.ts`.
- `npx eslint` on all changed files: 0 errors and 3 warnings, all of them already there:
  `max-lines` in `chat-session.service.ts` and `rpc.types.ts`, and an unused `EffortLevel`
  import in `config-rpc.handlers.ts`.
- Not run, per the task rules: `nx typecheck`, `nx lint`, `nx test`, build, and
  `ptah_get_diagnostics`. The orchestrator should run project typecheck for
  `shared`, `rpc-handlers`, `core` and `chat-ui`. `config:autopilot-get`'s params type
  changed in `shared`, and the only typed caller is `AutopilotStateService`. The jest
  runs compiled the changed files through ts-jest / jest-preset-angular.

## Changed files (this round)

1. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (F1)
2. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts` (F1)
3. `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts` (F2, F3)
4. `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.spec.ts` (F2, F3)
5. `libs/shared/src/lib/types/rpc/rpc-config.types.ts` (F2 doc, F3 types)
6. `libs/shared/src/lib/types/rpc.types.ts` (F3)
7. `libs/frontend/core/src/lib/services/autopilot-state.service.ts` (F3)
8. `libs/frontend/core/src/lib/services/autopilot-state.service.spec.ts` (F3)
9. `libs/frontend/core/src/lib/services/index.ts` (F3, type export)
10. `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts` (F3)
11. `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.spec.ts` (F3)

## Decisions

- **F1: an unknown parent level falls back to `ask`, never to the saved config.** This
  follows decisions.md 2026-10-14. The fallback lives in one place,
  `ChatSessionService.childPermissionLevel`, because every unknown-level path reaches the
  service as an absent `permissionLevel`. Refusing to create the child was the reviewer's
  alternative. It was not chosen because `ask` is safe and keeps delegation working.
- **F2: the distinction is made at the RPC boundary on `null` vs omitted.** The shared
  type already had `SessionId | null`, so no wire change was needed. An empty string
  keeps its earlier meaning of omitted, so TASK_2026_295's test still holds.
- **F2: the permission-handler default is still updated on a `null` toggle.** It is the
  default for new and resumed sessions, which is the "save the default" the decision
  asks for, not a live session.
- **F3: a host read, not a frontend snapshot.** A frontend snapshot cannot be correct for
  sessions resumed by `chat:continue`, for agent-child tabs, or after a webview reload.
  The read reuses the existing `config:autopilot-get` method with one optional param, so
  there is no new RPC method and no registry or allowlist entries.
- **F3: no broadcast.** A toggle still re-gates only its own tab's session; the recorded
  decision is kept. The saved default still follows the last toggle, because the backend
  saves config on every toggle. Fresh tabs show that default, which is the level their
  session will start at.
- **F3: when the live level is re-read.** The popover re-reads when its tab's session id
  changes and when its dropdown opens. A level changed outside the popover (for example a
  legacy CLI toggle that falls back to this session) shows after the next dropdown open,
  not instantly. A push channel was out of scope for "smallest correct mechanism".
- **F3: how a live level maps to the display.** A live `ask` shows as disabled
  ("Manual"), because a disabled toggle re-gates the session to SDK `default`, which is
  `ask`. When the user enables from that state, the remembered default level is used.
- **Out of scope, observed:** `chat-session.service.ts` logs the first 80 characters of a
  prompt in the `chat:continue` stop-intent path (~line 922-925). This code predates this
  task; it is reported here and not changed.
