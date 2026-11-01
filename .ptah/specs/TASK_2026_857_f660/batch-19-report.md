# Batch 19 report — Coordinator wiring into chat turn admission

Executor: backend-developer subagent. Worktree `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing`.
No git was run. `batches.md` and `task.md` were not edited. B18's coordinator was not changed.

## Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/host-routing/register-host-routing.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.host-routing.spec.ts` (D-TL-1)
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/rpc-handlers/src/index.ts`

## Task 19.1 — `registerHostRouting` and barrel export

- `registerHostRouting(container: DependencyContainer): void` calls
  `container.registerSingleton(CHAT_TOKENS.HOST_ROUTING_COORDINATOR, HostRoutingCoordinator)`.
  It follows the `registerChatServices` pattern in `lib/chat/di.ts`, including its bootstrap precondition check.
- Before registering, it checks (with `isRegistered(token, true)`) that every token the coordinator injects without
  `isOptional` is bound: `TOKENS.LOGGER`, `LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING`, `SCOPE_CHECK_SERVICE`,
  `ROUTE_DECIDE_SERVICE`, `DECISION_MODEL_CONFIG`, `SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE` and `TOKENS.PTAH_API_BUILDER`.
  If any are missing it throws and names them. The reason: `ChatSessionService` injects the coordinator as optional,
  but `isOptional` only covers an unbound token. If the token is bound and a required dependency is missing, resolving
  `ChatSessionService` (and so all chat) would fail. The check makes that fail at bootstrap instead.
- Barrel (`src/index.ts`): exports `HostRoutingCoordinator`, `type AdmitUserTurnInput` and `registerHostRouting`.
  This adds no new Nx edges: rpc-handlers already imports `lane-routing`, `agent-sdk`, `vscode-core` and `vscode-lm-tools`.
- Electron-only: nothing in `apps/` was edited. The function is never called on VS Code or the CLI.

## Task 19.2 — admission in `ChatSessionService`

- New last constructor parameter:
  `@inject(CHAT_TOKENS.HOST_ROUTING_COORDINATOR, { isOptional: true }) private readonly hostRouting?: ChatHostRouting`.
  `ChatHostRouting = Pick<HostRoutingCoordinator, 'admitUserTurn'>`. The coordinator module is imported with
  `import type` only, so the service has no new runtime import.
- New private `admitHostRoutingTurn(input)`:
  - It returns immediately when no coordinator is bound (VS Code and CLI).
  - Otherwise it calls `admitUserTurn` synchronously. The call is not awaited and its return value is ignored.
  - A synchronous throw is caught under `// degradation-audit: reported - ...`. The catch logs
    `logger.warn('[RPC] host routing admission failed', new Error('admitUserTurn threw <class>'), { tabId })`.
    The class name comes from `loggableErrorName`, so the error's own message is never logged: it could quote the prompt.
- Call sites:
  - **start:** after `await this.launchSdkSession(...)` resolves in `startSession`, it calls
    `admitUserTurn({ tabId, sessionId: null, prompt })`. This only happens when `prompt` is non-empty and the
    interceptor returned `passthrough`. The early return in the Ptah-CLI branch and the `native` slash early return
    are never reached here. A `new-query` slash command (one that starts a fresh query) is excluded explicitly.
  - **continue:** after `await this.sdkAdapter.sendMessageToSession(...)` returns in `continueSession`, it calls
    `admitUserTurn({ tabId, sessionId, prompt })`, unless `isSlashCommand`. That condition also covers a slash
    command the follow-up router passes through to `sendMessageToSession`. The early returns for Ptah-CLI and for a
    router-handled slash command come before the call.
  - **Not wired:** `resumeSession` (`chat:resume`), `startAgentChildSession` and `startHandoffSession`. The last two
    carry backend-built prompts, not user turns.
- Prompt-text changes: none.

## Spec (`chat-session.host-routing.spec.ts`, 13 tests)

- Start: admission is called once with `{ tabId, sessionId: null, prompt }`. `startChatSession` is called before admission (by invocation order).
- Continue: admission is called once with `{ tabId, sessionId: SESSION_ID, prompt }`. `sendMessageToSession` is called before admission.
- Continue with a deferred `sendMessageToSession`: admission is not called while the send is pending, and is called once after it resolves.
- No admission for:
  - a native slash command on start (`/clear`)
  - a `new-query` slash command on start (the launch still happens)
  - a slash command the router handles on continue
  - a slash command the router passes through on continue (the send still happens)
  - a Ptah-CLI start
  - a Ptah-CLI continue
  - `chat:resume` with `activate: true`
- Dispatch resolves before admission settles: `admitUserTurn` returns a promise that never settles, and both start
  and continue still resolve. If the service awaited it, this test would hit the Jest timeout.
- A thrown admission (`TypeError` whose message contains the prompt) does not reject the turn:
  - both start and continue return success;
  - `warn` is called with a real `Error` reading `admitUserTurn threw TypeError` and `{ tabId }`;
  - no logger call at any level contains the prompt text (an `Error` argument is serialised with its message).
- No coordinator bound: start and continue succeed and no warning is logged.
- The spec does not load the coordinator module at runtime (type-only import), so it needs no
  `jest.mock('@ptah-extension/vscode-lm-tools')`. It does mock `workspace-intelligence`, like the sibling chat-session specs.

## R6 (admission on the reply hot path)

- No await: the call is a synchronous `void` method invoked after dispatch completes. It cannot delay the dispatch
  and adds one function call to the reply path. The coordinator's own scope check runs in the background (B18).
- Two specs pin this: the never-settling admission, and the deferred-send ordering test.
- A throwing admission is contained by the guard and cannot fail a turn that has already been dispatched.

## Verification

- `npm run verify -- -p @ptah-extension/rpc-handlers`
  - First run: exit 1. The new spec failed to compile (TS2322: mock tuple typing; TS2493: logger mock tuple).
    The spec was fixed; production code needed no change.
  - Spec-only run (`-t test ... -- --testPathPatterns=chat-session.host-routing`): 1 suite, 13 passed.
  - Re-run: "3 tasks: 3 succeeded", exit 0. Tests: 193 suites passed of 193; 5122 passed, 7 skipped, 5129 total.
- `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli`: "3 tasks: 3 succeeded", exit 0.
- `npm run verify -- -t lint -p degradation-audit`: "1 task: 1 succeeded", exit 0.
- `npx prettier --write` then `npx prettier --check` on all four files: "All matched files use Prettier code style!", exit 0.
  The committed `chat-session.service.ts` was already not Prettier-clean (for example the `startSession` signature
  and the `SDK_ACTIVE_PROVIDER_RESOLVER` inject line). `--write` normalised those lines too, so the diff of that file
  contains some formatting-only hunks. lint-staged would apply the same reformatting at commit.

## Decisions

- **D-B19-1: guard the call (try/catch) instead of the bare call.**
  - Options: a bare call (B18 hand-off: "do not wrap"), or a guarded call.
  - Evidence: the B19 brief requires that a thrown admission never rejects the turn, and asks for a spec that proves
    it. Without the guard, a throw would land in `startSession`/`continueSession`'s catch and return `success: false`
    for a turn that was already dispatched.
  - Reversible: yes.
- **D-B19-2: precondition check in `registerHostRouting`.**
  - Evidence: `di.ts` precedent (`assertOutputStyleServicesRegistered`), and the `isOptional` semantics described in Task 19.1.
  - Reversible: yes.
- **D-B19-3: exclude a `new-query` slash command on start and a passed-through slash command on continue.**
  - Evidence: brief "exclude the slash-command branch". The coordinator also ignores `/`-prefixed prompts, so this is
    defence in depth.
  - Reversible: yes.

## Hand-off for B21

- In the Electron composition root, call `registerHostRouting(container)` **after**:
  - `registerSdkServices`: reminder queue, plus adapter events and the session-id registry. Those two are optional to
    the coordinator but needed for assistant-reply tracking and alias re-keying.
  - `registerLaneRoutingServices`: setting, scope check, route decide, decision model config, reuse cache.
  - the `TOKENS.PTAH_API_BUILDER` binding.
- Call it **before** `ChatSessionService` is first resolved. That service is a singleton: if it is resolved before the
  coordinator token is bound, it caches `hostRouting = undefined` and routing stays off for the process.
- If a required token is missing, the function throws and names the missing tokens.
- Add `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` to Electron's `expected-resolvable.ts` only. Do not add it to VS Code or the CLI.
- `HostRoutingCoordinator.dispose()` releases its two subscriptions. Call it on Electron shutdown, or rely on process exit.

## Out-of-scope observations

- None blocking. The intermittent Jest message "A worker process has failed to exit gracefully" appeared in the first
  rpc-handlers run. It also appears with this batch's suite excluded (its suite failed to compile in that run), so it
  is pre-existing.
