# Backend implementation: `TASK_2026_655_handoff`, batch B2 (Component 3)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-session-handoff-skill`, branch
`feat/session-handoff-skill`. Commit `cb01a5f16`, "feat(rpc-handlers): start handoff sessions
through the chat host". It was committed in the foreground and the lint-staged hook passed. It is
not pushed.

Verdict: done. rpc-handlers compiles again, and every check passes.

## Files changed

All paths are under `libs/backend/rpc-handlers/src/lib/chat/session/`.

- MODIFIED `chat-session.service.ts`
  - `:143` adds `HandoffSessionStartParams`: `{ tabId; workspaceRoot; cwd; prompt; sessionName;
    model?; permissionLevel? }`.
  - `:159` adds the private type `AgentSessionPathLabels`.
  - `:639` `startAgentChildSession` now calls the extracted helper. Its behaviour and its returned
    texts are the same as before.
  - `:705` adds `startHandoffSession`.
  - `:764` adds `authorizeAgentSessionPaths(tabId, root, cwd, labels)`. It checks that the root
    and the cwd are both inside an open folder (`isAuthorizedWorkspace`), then runs
    `rejectIfUnsafeWorkspace(cwd)`.
  - `:1667` adds the module function `errorKind`.
  - Two doc comments were updated: on `launchSdkSession`, and the permission-level comment inside
    it.
- MODIFIED `child-chat-session-host.adapter.ts`
  - `:115` adds `startHandoffSession`.
  - `:166` `announce(type, descriptor)` is generalised to cover both message types. The tab id
    comes from the descriptor.
  - `:195` `reportStartFailure(tabId, message)` is generalised to take the full message text.
  - The file header now describes both kinds of session.
- MODIFIED `child-chat-session-host.adapter.spec.ts`
  - `:288` adds a new describe block with 12 tests. The harness gains an optional lifecycle fake
    and a logger handle.
- MODIFIED `chat-session-agent-child.spec.ts`
  - `:444` adds a new describe block with 10 tests. The harness gains a logger handle, and the
    header contract is updated.

## Design notes

- **Adapter order.**
  1. Broadcast `MESSAGE_TYPES.SESSION_HANDOFF_OPENED` with `input.descriptor`. A failed broadcast
     gives `uiAnnounced: false` and the start still goes ahead.
  2. Call `session.startHandoffSession(...)` exactly once. There are no retries.
  3. If the start fails after a successful announce, send one `chat:error`
     `{ tabId, sessionId: tabId, error: 'Handoff session could not start: <reason>' }`.
  4. Return `{ started, uiAnnounced }` or `{ started: false, error }`. The adapter never throws.
- **One session per call, so a retry cannot double-start.** The adapter does not retry and keeps
  no state. The runtime service (B1) mints a fresh tab id for every attempt. It also holds its
  in-flight reservation until a late start settles. So a retry after the 30 s deadline is refused
  by the service and never reaches the host.
- **The prompt is never logged or sent to Sentry.**
  - `ChatSessionService.startHandoffSession` returns fixed refusal texts, or
    `the session launch failed (<name> (<code>)).`. A thrown launch error is logged only as its
    kind. Sentry receives a new `Error` that carries only that kind, not the original error.
  - If the service throws (which breaks its own contract), the adapter reduces the error to its
    `name`.
  - Specs assert that the prompt marker never appears in any logger call, the Sentry error, the
    outcome or the `chat:error`.
- **The new session is an ordinary top-level session.**
  - `launchSdkSession` gets `workspaceId = workspaceRoot` and `projectPath = cwd`.
  - There is no worktree and no parent link.
  - `mcpServerRunning` comes from the server port alone, so the new session can hand off again.
  - The slash-command intercept and the Ptah-CLI branch are skipped.
  - `surfaceMode` is undefined.
  - Nothing revives the old automatic coordinator.

## Permission level / autopilot inheritance (requirement added mid-batch)

- **Source of truth.** The UI autopilot toggle is `config:autopilot-toggle` in
  `handlers/config-rpc.handlers.ts:322-414`. It writes:
  - the global config keys `autopilot.enabled` and `autopilot.permissionLevel`;
  - the global `permissionHandler`;
  - the session itself, through `sdkAdapter.setSessionPermissionLevel`. That call ends at
    `session-control.service.ts:509` and sets `session.permissionLevel` on the lifecycle
    `SessionRecord`.

  `session-registry.service.ts:84-90` documents that record field as "the per-session source of
  truth read by the canUseTool callback".
- **Resolved at handoff time.** B1's `SessionHandoffService` calls `lifecycle.find(caller)` while
  handling the tool call and passes `record.permissionLevel` to the host.
- **Host.** At `adapter.ts:126` the adapter uses `input.permissionLevel`. If that is absent, it
  falls back to `lifecycle.find(descriptor.fromTabId)?.permissionLevel`, the same record. Neither
  path hard-codes a default. When both are absent, the field is omitted, and the SDK seeds the
  session from the global `permissionHandler.getPermissionLevel()` (the effective autopilot level,
  `session-query-executor.service.ts:748-757`).
- **The child-path drop is not repeated.** `HandoffSessionStartParams` declares
  `permissionLevel`, and `startHandoffSession` passes it straight to `launchSdkSession`. The level
  then reaches `sdkAdapter.startChatSession` (`sdk-agent-adapter.ts:901,915,983`) and is seeded
  on the new record. The level is never forced to `auto-edit`.
- **Child path left untouched,** as instructed. That defect is being fixed on another branch.
- **Specs.**
  - Service: `it.each(['yolo','plan','ask','auto-edit'])` checks that the `startChatSession`
    config's `permissionLevel` equals the caller's level. A separate test checks that an absent
    level is omitted, not forced to `auto-edit`.
  - Adapter: `it.each` over the same four levels.
  - Adapter fallback: with full autopilot `yolo` on the caller record, the record level is passed
    through.
  - Adapter precedence: the runtime-read level wins over the record.

## Checks (cwd = worktree, run one at a time)

- Changed specs: `npx jest -c libs/backend/rpc-handlers/jest.config.ts
  .../child-chat-session-host.adapter.spec.ts .../chat-session-agent-child.spec.ts
  --coverage=false --maxWorkers=2` gave 2 suites, 48 tests passed.
- `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1` printed "Successfully ran target
  typecheck". Before this batch the project did not compile.
- `npx nx test @ptah-extension/rpc-handlers --parallel=1` gave 150 of 150 suites passed: 4368
  tests passed and 7 skipped. The "worker process has failed to exit gracefully" notice also
  appeared on the two-spec run. I did not prove whether it is older than this batch.
- `npx nx lint @ptah-extension/rpc-handlers --parallel=1` printed "Successfully ran target lint",
  with 0 errors and 50 warnings. On the four changed files, `npx eslint` reports one warning:
  `max-lines` on `chat-session.service.ts` (1215 counted lines, limit 700). The file was already
  1556 physical lines at HEAD, so the warning is older than this batch. This batch adds about 95
  lines.
- I ran `prettier --write` on three files before committing. It changed formatting only.
- No other project was changed, so no other project was checked. No build, serve, e2e or package
  target was run.

## Decisions

- The service spec is extended in place in `chat-session-agent-child.spec.ts`. It is the existing
  launch-identity spec for agent-started sessions, and its harness already covers
  `launchSdkSession`. No new spec file was added.
- `authorizeAgentSessionPaths` takes `{ logLabel, cwdNoun }`. The child's returned texts stay
  byte-identical (`worktree path`), and the handoff uses `working directory`. One child log line
  changed wording, from "worktree is not inside" to "worktree path is not inside". No spec
  asserts that line.
- `errorKind` is a private module function in `chat-session.service.ts`. It mirrors the private
  one in cli-agent-runtime. It is not exported from a shared place, because each library keeps
  its own copy and no third use exists. The adapter reduces a throw inline, to `error.name`
  only.
- The handoff's `startHandoffSession` still spreads `authErrorFields(error)`, so an
  `AuthRequiredError` keeps `errorCode`/`providerId` on the result. Neither field can hold the
  prompt.
- The adapter does not hold a duplicate-tab guard. The runtime already guarantees one host call
  per minted tab id, and a set kept only for a hypothetical caller would be unused state.

## Plan deviations

None in substance. The plan's helper signature was `authorizeAgentSessionPaths(root, cwd, label)`.
The helper also takes `tabId`, for the existing refusal log fields, and a `cwdNoun`, to keep the
child texts unchanged.

## Out-of-scope observations

- The known defect, which another agent is fixing. `AgentChildSessionStartParams`
  (`chat-session.service.ts:129-140`) has no `permissionLevel`, and `startAgentChildSession`
  forces `'auto-edit'`. So the parent level that the adapter spreads in (`adapter.ts:71-84`) is
  dropped silently. TypeScript does not flag it because spread properties skip excess-property
  checks. The adapter spec test "uses the captured parent level" only checks the mock call, so it
  passes despite the drop.
