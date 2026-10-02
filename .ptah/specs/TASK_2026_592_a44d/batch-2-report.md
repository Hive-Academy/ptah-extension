## Frontend implementation — `TASK_2026_592_a44d`, batch 2

**Tasks completed**: 2.1 (ClosedTabSessionEnderService and eager instantiation), 2.2 (its spec), 2.3 (canvas `removeTile` cancel guard). I did not edit batches.md and did not add a `services/index.ts` export.

**Files** (10 in total: 6 planned plus 4 spec stubs approved by team-leader as a file-cap deviation). All paths are under `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session`.

Planned files:

- CREATED `libs\frontend\chat\src\lib\services\closed-tab-session-ender.service.ts` — a root singleton whose `effect` on `closedTab` sends `chat:abort` without waiting for it. It acts only when all of these hold:
  - `kind === 'close'`;
  - `sessionId` is a non-empty string;
  - `streamAbortDispatched !== true`;
  - no tab still holds the session (`findTabBySessionId`);
  - no non-tab surface is bound to the session's conversation.

  The call is wrapped in try/catch, the promise gets a `.catch`, and both paths log with `console.warn('[ClosedTabSessionEnder] ...', { tabId, sessionId, error })`.
- CREATED `libs\frontend\chat\src\lib\services\closed-tab-session-ender.service.spec.ts` — 14 tests using a signal-driven fake TabManager and `TestBed.tick()`.
- MODIFIED `libs\frontend\chat\src\lib\components\templates\app-shell.component.ts` — imports the service by relative path and adds `private readonly _closedTabSessionEnder = inject(...)`, with a one-line comment saying it is there for eager instantiation.
- MODIFIED `libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts` — the same change.
- MODIFIED `libs\frontend\canvas\src\lib\canvas.store.ts` — `removeTile` returns early when `tabManager.tabs()` still contains the tab after `await closeTab`. The doc comment is updated. Prettier would also reformat unrelated lines in this file; I kept only the guard edit.
- MODIFIED `libs\frontend\canvas\src\lib\canvas.store.spec.ts` — two tests: a cancelled close keeps the tile and its focus; a confirmed close drops the tile and clears focus.

Approved deviation, all in `libs\frontend\chat\src\lib\components\templates\`. Each file gets one provider line, `{ provide: ClosedTabSessionEnderService, useValue: {} }`, with a comment, plus the import that line needs:

- MODIFIED `electron-shell.config-gate.spec.ts`
- MODIFIED `app-shell.auth-redirect.spec.ts`
- MODIFIED `electron-shell.apps-tab.spec.ts`
- MODIFIED `electron-shell.activity-placement.spec.ts`

Without these lines the 4 suites (26 tests) failed with `TypeError: this.tabManager.closedTab is not a function`, because their partial TabManager mocks do not provide `closedTab`. Team-leader chose stubbing over widening those mocks so the real RPC side effect does not run in unrelated shell suites.

**Stack observed**:
- Angular 22.1.7 (`package.json:94`).
- Signals plus `effect`/`untracked`, following `transcript-retention.service.ts:79-86`.
- RPC fire-and-forget, following `message-sender.service.ts:217-237`.
- Tests use Jest with TestBed and `TestBed.tick()`, the dominant form in chat: 45 uses against 2 of `flushEffects`.

**Design fidelity**: there is no UI change in this batch.

### Non-tab surface check (explicit finding)

- **`WorkflowSessionClaimService`** (`chat-routing/src/lib/workflow-session-claim.service.ts`) maps a correlation id to a `SurfaceId` and holds no session ids, so it cannot answer "is this session displayed". It was not used in the guard.
- **`StreamingSurfaceRegistry`** (`chat-routing/src/lib/streaming-surface-registry.service.ts`) maps a `SurfaceId` to a state adapter and holds no session ids either. It was not used in the guard.
- **Surfaces do bind to sessions** through chat-state:
  - `StreamRouter.onSurfaceCreated(surfaceId, existingSessionId)` calls `binding.bindSurface(surfaceId, conv.id)` where `conv = registry.findContainingSession(existingSessionId)` (`stream-router.service.ts:226-250`).
  - `routeStreamEventForSurface` appends session ids to the surface's conversation (`:318-342`).
  - So a setup-wizard or harness surface can show the same session as a user tab.
- **Guard added**: `ConversationRegistry.findContainingSession(sessionId)` followed by `TabSessionBinding.surfacesFor(record.id).length > 0` means skip. Both are root services exported from `@ptah-extension/chat-state`.
- **The guard does not depend on effect order relative to `StreamRouter`**. On tab close, StreamRouter removes the conversation record only when no tabs and no surfaces remain (`stream-router.service.ts:265-303` and its tab-close sibling). If a surface remains, the record and its binding survive and the ender sees them. If none remains, the record either survives with zero surfaces or is gone; both end the session.

### Task evidence

- **2.1**: the service file above. Typecheck passes for chat. Both shells inject it, and it is a root singleton, so the double injection on Electron (ElectronShell embeds AppShell) creates a single instance.
- **2.2**: each case is a separate `it`, all passing:
  - idle close sends exactly one `chat:abort` with the session id;
  - `streamAbortDispatched: true` sends no RPC; `false` still sends one;
  - `forceClose` sends none;
  - `reset` sends none;
  - a null sessionId sends none, and so does `''`;
  - another tab holding the session sends none;
  - a bound non-tab surface sends none, while a record with zero surfaces still ends the session;
  - an RPC rejection is logged with `{tabId, sessionId, error}`, does not throw, and the next close still sends;
  - a synchronous RPC throw behaves the same way;
  - two sequential closes send two RPCs in order.
- **2.3**: canvas spec `describe('removeTile')`, 2 tests, passing.

### Hard requirements

| Requirement | How it is met | Proof |
| --- | --- | --- |
| Workspace switch sends no chat:abort | A switch never emits `closedTab` (Batch 1 real-partition test), and the ender reacts only to `closedTab` | `tab-manager.cross-workspace.spec.ts` (Batch 1), together with the ender being driven only by `closedTab` |
| forceClose and reset send no chat:abort | `kind !== 'close'` returns early | ender spec: `forceClose` and `reset` cases |
| Streaming close sends exactly one chat:abort | The MessageSender listener sends it, `closeTab` sets `streamAbortDispatched: true`, and the ender skips | Batch 1 lifecycle test (flag true when a live stream is aborted) plus the ender spec's `streamAbortDispatched: true` case |
| An RPC rejection never throws out of close | The ender's effect is decoupled from `closeTab` (effects flush later), with try/catch and `.catch` | ender spec: rejection and synchronous-throw cases, each followed by a working close |
| A session still shown by another tab or surface sends no chat:abort | `findTabBySessionId` covers active and background partitions, including canvas tiles, which are tabs; the surface binding check covers wizard and harness | ender spec: shared-tab and surface cases |

### Risks and edge cases (validation section)

- **Double abort**: handled through the flag. One residual stays as accepted in the plan: a registered but already-aborted controller gives a flag of false, so one extra harmless abort can go out.
- **Two closes coalescing**: every caller awaits one close per tick. The sequential-close test proves one RPC per close when effects flush between closes.
- **Shared session or non-tab surface**: both are guarded; see the finding above.
- **Cross-webview twin** (VS Code sidebar and panel showing the same session): out of reach from one TabManager. This is accepted residual risk, as recorded in batches.md.
- **Null or temporary session id**: the guard requires a non-empty string. The ender casts with `as SessionId`, which re-brands the value: `ClosedTabEvent.sessionId` comes from `TabState.claudeSessionId: SessionId | null`.
- **Cancelled tile close (Task 2.3)**: the tile and focus are kept. Tested.
- **App-shell second prompt after a delete** (Batch 1 review, Moderate 2): no change, as the review recommended. If that close goes through, the ender's `chat:abort` returns `already-ended`.

### Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas` passes for both projects. Lint reports 0 errors and 31 warnings in chat.
- I linted the touched files on their own. Every warning is outside the lines I changed:
  - `app-shell.component.ts:327` no-empty-function;
  - non-null assertions in `electron-shell.apps-tab.spec.ts` and `electron-shell.config-gate.spec.ts`.

  The new service and its spec lint clean.
- `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas -- --maxWorkers=2`, tail:

```
> nx run @ptah-extension/canvas:test --maxWorkers=2
Test Suites: 9 passed, 9 total
Tests:       221 passed, 221 total
> nx run @ptah-extension/chat:test --maxWorkers=2
Test Suites: 110 passed, 110 total
Tests:       2 skipped, 1685 passed, 1687 total
 NX   Successfully ran target test for 2 projects
```

Notes on the test run:

- The 2 skipped tests are not in this batch's files.
- Before the spec stubs, the same run printed `4 failed, 106 passed` suites and 26 failed tests.
- Prettier also flags `electron-shell.apps-tab.spec.ts` in its HEAD form, so I did not reformat it.

**Plan deviations**: 4 extra spec files with provider stubs, approved by team-leader. Apart from that, none.

**Out-of-scope observations**:
- Batch 1 review, Failure mode 2: a close during the first stream, before `chat:start` returns, has no session id, so nothing ends the backend session `chat:start` later creates. This is pre-existing and is not fixed here.
- `canvas.store.ts` and `electron-shell.apps-tab.spec.ts` are not Prettier-clean at HEAD.

## Review fixes

Source: batch-2-code-logic-review.md (APPROVED 7/10). All changes are in the chat lib only; chat-state and canvas are unchanged in this pass. Paths are under `D:\projects\ptah-extension\.claude-worktrees\fix-close-tab-session`.

1. **Switch safety with the real TabManagerService.**
   - File: `libs\frontend\chat\src\lib\services\closed-tab-session-ender.service.spec.ts`, new `describe('ClosedTabSessionEnderService with the real TabManagerService')`.
   - Real services: TabManagerService, TabWorkspacePartitionService, ConversationRegistry, TabSessionBinding, ConfirmationDialogService and the session ender. Only ClaudeRpcService is mocked.
   - Steps: two session tabs in WS_A, switch to WS_B and add a session tab there, switch back to WS_A.
   - Result: no `chat:abort` call during the switches. Closing the idle tab in A then sends exactly one `chat:abort` with that tab's session id, and the other tab remains.
2. **Shell wiring is now provable.**
   - Files: `libs\frontend\chat\src\lib\components\templates\app-shell.auth-redirect.spec.ts` and `electron-shell.config-gate.spec.ts`.
   - The `{}` stub is now a recording `useFactory` (`closedTabSessionEnderFactory`), and each spec gains a test that the factory runs exactly once when the shell is created.
   - Mutation check: I temporarily replaced `inject(ClosedTabSessionEnderService)` with a no-op in both shells and ran the two specs. Result: `Tests: 2 failed, 18 passed`, and the failures were exactly the two new tests. I then restored both shells from a file copy; they again contain `_closedTabSessionEnder = inject(`.
   - The other two shell specs (apps-tab, activity-placement) keep the plain `useValue: {}` stub.
3. **Close events recorded before the service existed are ignored.**
   - File: `libs\frontend\chat\src\lib\services\closed-tab-session-ender.service.ts`.
   - The constructor reads `closedTab()` once inside `untracked`, and the effect skips that exact event object (identity check). Every later close is a new object, so it is still processed.
   - New spec test: an event present at construction sends no RPC, and the next close sends exactly one.
   - Item 7 (two closes in one tick) is not changed. A code comment at the effect records the single-value-signal limitation as a follow-up.

Verify (tail):

```
npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/canvas
> nx run @ptah-extension/chat:lint        (0 errors, 31 warnings; none on lines this batch changed)
> nx run @ptah-extension/chat:typecheck
> nx run @ptah-extension/canvas:lint
> nx run @ptah-extension/canvas:typecheck
 NX   Successfully ran targets typecheck, lint for 2 projects

npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas -- --maxWorkers=2
> nx run @ptah-extension/canvas:test --maxWorkers=2
Test Suites: 9 passed, 9 total
Tests:       221 passed, 221 total
> nx run @ptah-extension/chat:test --maxWorkers=2
Test Suites: 110 passed, 110 total
Tests:       2 skipped, 1689 passed, 1691 total
 NX   Successfully ran target test for 2 projects
```
