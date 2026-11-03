# Batch 4 report: carry-over launch pin and `ChatCarryOverService`

Executor: backend-developer subagent. Worktree:
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765`.
I ran no git commands that change state. I did not edit `batches.md`, `task.md` or anything under
`libs/frontend`.

## Verification status: NOT CONFIRMED locally (CI is the gate, decisions.md row 51)

- Following row 51, I did not run `npm run verify`, nx, jest or tsc.
- I ran `ptah_get_diagnostics` three times, with `files` set to the 5 changed files and severity
  `error`. All three returned "Unavailable: TypeScript check still running after 45s", so it
  produced no diagnostics, clean or otherwise.
- By hand, I checked every import and symbol against source: tokens, `ResolvedChatExecution`,
  `CodexProfileSeed.providerId`, `ICodexAuthService.isAuthenticated`,
  `ActiveProviderResolver.resolveActiveAuthForPath`, `getAnthropicProvider` and
  `loggableErrorName` from `@ptah-extension/shared`, `CarryOverReadOptions` (`tailBytes`,
  `signal`) and the all-optional `AISessionConfig` fields. The CI typecheck, test and lint jobs
  for `@ptah-extension/rpc-handlers` on PR #914 are the real check.
- The `degradation-audit` markers are on the four fail-closed `catch { … return null }` sites in
  the service. No marker is orphaned.

## Files

- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`: carry-over
  launch option, provider pin, safe failure branch.
- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.host-routing.spec.ts`:
  optional `activeProvider` harness argument (positional slot 5 of the optional tail) and 1 case.
- CREATED `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.carry-over-launch.spec.ts`
- CREATED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts`
- CREATED `libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts`

Not touched: `continueSession`, `autoResumeIfInactive`, the refusal helper, the existing
`chat:start` catch branch, `chat-slash-command-router.service.ts`,
`workspace-provider-profile-resolver.ts`, the chat RPC handler, tokens, `di.ts` and the session
barrel (the last four belong to Batch 5).

## Task 4.1: `startSession` carry-over launch option (F1, F4)

What changed:

- New exports: `CarryOverLaunch { readonly expectedProviderId: string }`,
  `CARRY_OVER_PROVIDER_CHANGED` and `CARRY_OVER_START_FAILED`, both fixed text. There is also a
  module-private `CarryOverProviderChangedError`.
- `SdkSessionLaunch` gains `expectedProviderId?`.
- `startSession(params, launch?)` passes `expectedProviderId` to `launchSdkSession` only when
  `launch` is set. The `chat:start` handler passes nothing, so its behaviour does not change.
- Host routing admission now has the guard `!launch && prompt && passthrough` (AC 8.1).
- **F1 pin:** `assertCarryOverProvider(execution, workspaceId, expected)` runs once
  `withinNamedAdmissionDeadline(...)` returns `{config, execution}`. This covers both the
  `runtimeProfile.prepare` branch and the `resolveClaudeExecution` branch, and both runtimes. It
  runs before `pendingLineage.set`, before `withCodexStartLineage` and before any `sdkAdapter`
  call. No `await` separates the pin from the adapter call.
  - The pin re-reads `this.activeProvider?.resolveActiveAuthForPath(workspaceId).providerId`
    every time.
  - It throws when the resolver is not bound (`undefined`) or when the provider differs.
  - The served provider is `seed.providerId` for Codex, and
    `providerProfile?.providerId ?? activeNow` for Claude. If that differs from the expected
    provider, the pin also throws.
- **F4 safe failure:** in the `startSession` catch, `if (launch) return
  this.carryOverStartFailure(error, params.tabId)` runs first.
  - `CarryOverProviderChangedError` returns `{ success:false, error: CARRY_OVER_PROVIDER_CHANGED }`.
    It logs at debug only and does not call Sentry.
  - `codexFailure` and `mainSessionAccountFailure` keep their fixed results.
  - Any other error logs `logger.warn('[carry-over] start failed', new Error('carry-over start
    threw <loggableErrorName>'), { tabId })` and sends that same safe `Error` to
    `captureException` with `errorSource: 'ChatSessionService.carryOverStart'`. The result is
    `{ success:false, error: CARRY_OVER_START_FAILED, ...authErrorFields(error) }`.
  - The original `chat:start` branch below it is byte-identical.
  - P9: `authErrorFields` was re-located. It is now at `chat-session.service.ts:875-886`, not
    `:876-888`, and it is reused unchanged.

Specs and the ACs they prove:

- `chat-session.host-routing.spec.ts`: a carry-over launch does not call `admitUserTurn`, and a
  plain `chat:start` on the same harness still calls it once (AC 8.1).
- `chat-session.carry-over-launch.spec.ts`:
  - Pin holds, starting once: Claude with a matching profile, Claude with an `undefined`
    profile, Codex with a matching `seed.providerId`, and the no-runtime-profile
    (`resolveClaudeExecution`) branch.
  - F1 race on 4 branches: Claude with a profile, Claude with an `undefined` profile, Codex, and
    no runtime profile. The active fake switches inside `prepare` (or inside
    `resolveProviderProfileForWorkspace`) before it resolves. Each case asserts 0
    `startChatSession`, 0 `resumeSession`, 0 metadata-store calls other than reads (a Proxy
    records every method, including `withCodexStartLineage`), 0 `pendingLineage.set` and no
    stream. The result is `{ success:false, error: CARRY_OVER_PROVIDER_CHANGED }`, with no warn,
    no error and no Sentry call (AC 2.3, 2.5).
  - Refused: a Claude profile that serves another provider, a Codex execution under an
    `'anthropic'` pin, and no resolver bound.
  - F4: a sentinel in the message and stack of a throw from `prepare`, and separately from
    `startChatSession`, does not appear in any logger call, any `captureException` argument or
    the result (AC 8.5).
  - Regression pin: without `launch`, the same throw takes today's branch (`RPC: chat:start
    failed`, raw error, `ChatRpcHandlers.registerChatStart`). A provider switch during `prepare`
    does not refuse a plain `chat:start`.

## Task 4.2: `ChatCarryOverService`

What changed (`@injectable()`, every parameter has `@inject`; the optional dependencies come
last):

- Dependencies: `TOKENS.LOGGER`, `CHAT_TOKENS.SESSION`, `CHAT_TOKENS.HISTORY_READ`,
  `SDK_TOKENS.SDK_SESSION_METADATA_STORE`, `SDK_TOKENS.SESSION_HISTORY_ROUTER`,
  `AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER` and
  `SETTINGS_TOKENS.MODEL_SETTINGS`. Optional: `SDK_ACTIVE_PROVIDER_RESOLVER`,
  `CHAT_TOKENS.RUNTIME_PROFILE` and `SDK_CODEX_AUTH`. Each one is typed as a narrow `Pick`.
- `evaluate` runs its steps in this order (K22):
  1. Folder: `resolveSessionFolder`, then `realpath(folder) === realpath(resolve(workspacePath))`.
  2. Identity: `storedChatRuntimeIdentity`. Only `claude-sdk` with a provider other than
     `openai-codex` is eligible. A native `codex-app-server` identity is refused here, before any
     router call (T2).
  3. Cheap comparison: compare against the synchronous
     `resolveActiveAuthForPath(folder).providerId`. A missing resolver means not eligible.
  4. Probe: `runtimeProfile.prepare({tabId, workspaceId, projectPath, model}, undefined, true)`,
     or `resolveClaudeExecution(resolver, folder, model, true)`. A Codex result also needs
     `codexAuth.isAuthenticated() === true`. A missing `codexAuth` means not eligible.

  `evaluate` returns `null` when the session is not eligible and never throws.
- `providerName`: `openai-codex` gives Codex, `anthropic` gives Claude, any other id gives
  `getAnthropicProvider(id)?.name ?? id`.
- `check` returns `{eligible:true, providerId, providerName}` or `{eligible:false}` and never
  throws.
- `carryOver` steps:
  1. `inFlight` guard on the session id, cleared in `finally`.
  2. `evaluate`.
  3. Router read with `{ tailBytes: CARRY_OVER_READ_TAIL_BYTES, signal:
     AbortSignal.timeout(CARRY_OVER_READ_TIMEOUT_MS) }` and no `nativeBound` (T4).
  4. `renderCarryOverPrompt`. A `null` result or a read throw gives `HISTORY_UNREADABLE`.
  5. Re-read of the active id. A difference gives `NOT_ELIGIBLE`.
  6. `startSession({tabId, workspacePath: folder, prompt, name?, ptahUiFence?},
     {expectedProviderId: pin})`, with no `options` and no model.
     - `CARRY_OVER_PROVIDER_CHANGED` maps to `NOT_ELIGIBLE`.
     - Any other `!success`, including `cancelled`, gives `START_FAILED` with the fixed text
       `"Couldn't start a new chat with <providerName>."` plus the start's `errorCode` and
       `providerId`.
     - A throw from the start is also caught and gives `START_FAILED`.
- Result shape (batch-6-report "Risk for Batch 5"): every host refusal is a data result. The
  service never throws, so the Batch 5 handler can return it inside a `success:true` envelope.
  Only invalid params should raise `INVALID_PARAMS`.
- Logs: info `[carry-over] started { sessionId, tabId, providerId, source: 'claude-jsonl',
  keptTurns, omittedTurns }`. Warn `[carry-over] <step> failed { sessionId, error:
  loggableErrorName }`, or warn `[carry-over] start failed { sessionId, tabId, errorCode?,
  cancelled? }`. There is no text, no message and no Sentry.

Specs in `chat-carry-over.service.spec.ts` and the ACs they prove:

- Eligible mismatch: Claude to Codex, OpenRouter to Claude, and a third-party name taken from the
  registry (AC 1.1).
- Same provider is not eligible, and neither `prepare` nor the Claude profile fake is called
  (AC 2.5, K22).
- A probe throw for Codex, for Claude, and for the no-runtime-profile branch. Codex not signed
  in, Codex auth not bound, and no resolver are each not eligible (AC 1.3).
- A proxy-era Codex Claude SDK identity is not eligible (AC 1.2).
- A native `codex-app-server` identity is not eligible in `check` and gives `NOT_ELIGIBLE` in
  `carryOver`. The router fake is called 0 times and `prepare` 0 times (T2).
- A folder mismatch and an unknown session (`SESSION_NOT_FOUND`) are refused without a read
  (AC 2.6).
- `prepare` is called once with `undefined` identity and `modelIsStored=true`.
  `resumeSession` and `continueSession` are called 0 times, with 0 metadata writes (AC 2.3).
- `startSession` is called once. `workspacePath === folder`, there is no `options`, the prompt
  starts with `CARRY_OVER_INSTRUCTION`, and the launch is `{ expectedProviderId }`
  (AC 2.1, 2.2, 2.4).
- The router receives exactly `{tailBytes: CARRY_OVER_READ_TAIL_BYTES, signal: AbortSignal}`,
  with no other key (AC 3.10, Claude half).
- A deferred read with a provider switch gives `NOT_ELIGIBLE`. There is no start, `prepare` runs
  only once (none after the read), and there are 0 metadata writes (AC 1.7, 2.5).
  `CARRY_OVER_PROVIDER_CHANGED` maps to `NOT_ELIGIBLE`.
- A transcript sentinel in a start error does not appear in the result or the logs (AC 8.5).
- A concurrent second call gets `IN_FLIGHT` and there is one start. The guard is released after
  success and after failure (AC 5.4).
- An empty history, a blank history and an unreadable history each give `HISTORY_UNREADABLE`
  with no start (AC 5.1).
- `AUTH_REQUIRED` (with `providerId`) and `CODEX_UNAVAILABLE` pass through. A cancelled start
  gives `START_FAILED` (AC 5.2).
- A secret in a transcript turn and in a compaction summary is redacted in the prompt. It does
  not appear in the logs or the result, on success or on a forced start failure (AC 8.3, 8.5).
- A throwing `startSession` gives `START_FAILED` with no sentinel.

## A3 note for the PR (readiness probe side effects)

I read `workspace-provider-profile-resolver.ts:484-530` (`buildProfile`) and `:689-727`
(`buildProxyProviderProfile`):

- `claudeCli`, `apiKey` and direct third-party providers build an in-memory profile only. They
  have no lasting side effect.
- A provider with `requiresProxy: true` calls `proxyPool.acquire(workspacePath, providerId,
  provider)` on the probe. That can **start or reserve a per-workspace proxy**, which stays in
  the pool after `check` or `carryOver` returns. The real launch then reuses it, so a
  carry-over that is started costs nothing extra. A `check` that is never followed by a click
  leaves the proxy warm until the pool reclaims it.
- An unknown provider logs a warn and returns `undefined`.
- A Codex target (`openai-codex`) on the Claude branch hits `rejectLegacyCodexProfile` (a throw,
  not eligible). On the native branch it returns a `codex-app-server` seed with no process
  started. The adapter port starts the process, and the probe never reaches the adapter.

The probe never receives a stored identity, so it never reaches `rejectStoredProviderMismatch`.
Recommendation for the phase review: accept the proxy warm-up as the cost of an honest readiness
check. The alternative, a probe that skips proxy acquisition, would need a resolver change, and
the hard rules forbid that.

## Decisions

| Decision | Options | Evidence | Reversible |
| -------- | ------- | -------- | ---------- |
| The pin runs right after `withinNamedAdmissionDeadline` returns, not inside its callback. | Inside the callback right after `prepare`. | This position covers both `prepare` branches with one call, and no `await` separates it from the adapter call. A carry-over has no named selection, so the wrapper adds no await. | Yes |
| The folder check compares `realpath` of both sides. | Compare the raw `resolveSessionFolder` result with `realpath(requested)`. | `resolveSessionFolder` returns the metadata candidate, not its realpath (`session-folder.ts:61-80`), so a stored symlink path would be refused falsely. | Yes |
| `check` passes the session id as the probe's `tabId`. | Use a random id. | `AgentSessionStartConfig.tabId` is required, but `prepare` reads only the workspace, path and model (`chat-runtime-profile.service.ts:120-140`). The check has no tab. | Yes |
| `carryOverStartFailure` checks the codex and account failures after the provider-changed error and before the generic branch. | Generic text for everything. | Plan Component 5. Both helpers return fixed text and never echo the error message. | Yes |
| The service returns `NOT_ELIGIBLE` when the active-provider re-read throws. | Let it throw. | Every refusal must be a result (batch-6-report risk). Failing closed starts nothing. | Yes |

## Plan deviations

- None in contract or scope.
- Extra cases beyond the list: the F1 race on the no-runtime-profile branch (4 branches, not 3),
  release of the guard after a failure, a blank history, a cancelled start, and a throwing start.
- The `[carry-over] start failed` warn from a `!success` start carries `errorCode` and
  `cancelled` only, never the error text.

## Out-of-scope observations

- Batch 5 has to export `ChatCarryOverService`, `CarryOverLaunch` and the two constants from
  `chat/session/index.ts` if the handler imports them through the barrel. Batch 5 also adds
  `CHAT_TOKENS.CARRY_OVER` and registers the service after `SESSION`.
- `ptah_get_diagnostics` cannot finish a scoped check on this machine under the current load
  (3 of 3 attempts unavailable).
