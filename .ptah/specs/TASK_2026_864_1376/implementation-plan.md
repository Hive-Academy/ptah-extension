# Implementation Plan - TASK_2026_864_1376

Provider-aware onboarding readiness for Claude Code and Codex in Electron, plus a real in-app
Codex sign-in (decisions.md rows 7-10). All paths are absolute under the task worktree
`/home/amun/ptah-extension/.claude-worktrees/provider-readiness` (abbreviated `<wt>/` below).

## Inputs and constraints

- Requirements used: `<wt>/.ptah/specs/TASK_2026_864_1376/context.md`, `task-description.md`
  (Gate 1, revisions 1-2), `parity-inventory.md`, `decisions.md` rows 1-11.
- Corrections applied: `design-spec-review.md` (Gate 1.7 round 2, implementation checks: selected
  executable, honest manual row, evidence-gated browser copy, 20 s bound tunable).
- Design handoff used: `design-spec.md` (round 2) and `prototype/` (component names and copy are
  taken from there; sections cited per component).
- Missing decision-critical input: none. Two open questions in `task-description.md` are answered
  under `## Decisions` (D-7, D-8). Codex CLI login output was not observed by running a login (and
  must never be); Revision 1 establishes it from `codex login --help` and the bundled binary's
  strings (A-1, now partly verified).
- Revision 1 inputs: `implementation-plan-review.md` (Gate 2 initial, REVISE, six findings) and
  `decisions.md` row 26 (orchestrator ruling: the default flow opens the URL through
  `shell.openExternal`). Changes are applied in place below and summarised in `## Revision 1`.
- Repository rules applied: `<wt>/CLAUDE.md` (Electron first, scoped `npm run verify -- -p`,
  worktree only, lanes never run git); `eslint.config.mjs:278-392` depConstraints
  (`scope:extension` -> shared/extension, `scope:webview` -> shared/webview, `type:feature` ->
  feature/data-access/ui/util/core); pre-push runs di-lint (`tools/di-lint/check-injects.ts`, every
  `@inject` token needs a `register` call) and the Electron `validate-deps` gate (`.husky/pre-push`).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `auth:codexLogin` reports success after `openTerminal` when the platform has no runner | `libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts:208-215` | The Electron path must stop using this branch (row 7) |
| Electron `openTerminal` only logs a warning | `apps/ptah-electron/src/services/platform/electron-platform-commands.ts:63-68` | No terminal exists in Electron; the in-app runner is the only honest route |
| The only other `openTerminal` implementation is the CLI no-op; there is no VS Code app in `apps/` | `libs/backend/cli-engine/src/lib/platform/cli-platform-commands.ts:87-89`; `apps/` = ptah-docs, ptah-electron, ptah-electron-e2e, ptah-extension-webview, landing | The "terminal hand-off" path (design state 11) has no host that can produce it (D-4) |
| `IAuthCommandRunner` is a structural capability with `{success, exitCode, error?}`; no cancel, no URL open; used by the CLI only | `libs/backend/rpc-handlers/src/lib/handlers/auth-command-runner.ts:23-65`; `cli-platform-commands.ts:69-182` | Left unchanged so the CLI/TUI path and its specs keep working (D-2) |
| In-app Kimi Code sign-in: host-neutral service, fixed argv via `IProcessSpawner`, https URL parse, `IUserInteraction.openExternal`, 10 min timeout, `cancel()`, state pushes, start returns at once | `libs/backend/auth-providers/src/lib/providers/kimi-code/kimi-code-login.service.ts:40,99-135,196-268,398-415`; `libs/backend/rpc-handlers/src/lib/handlers/auth/kimi-code-login-methods.ts:53-139` | Established pattern for the Codex sign-in service and its RPC pair (D-1) |
| Kimi login is built by a DI factory resolving `SDK_TOKENS.SDK_PROCESS_SPAWNER` and `PLATFORM_TOKENS.USER_INTERACTION` | `libs/backend/auth-providers/src/lib/providers/register-providers.ts:141-153` | Same factory shape for Codex, but registered by the Electron composition root (D-3) |
| Kimi push and response types | `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:98-193`; `libs/shared/src/lib/types/messages/message-constants.ts:324-337`; `payload-map.ts:184-217,461-463` | Codex types mirror them in the same files |
| Frontend Kimi start/push/cancel ordering helpers | `libs/frontend/core/src/lib/services/kimi-code-login.ts:37-80`; `providers-connection-setup.service.ts:139-160,316-360` | Codex frontend service mirrors these rules (sticky final phase, latest attempt wins) |
| Push handlers register via `MESSAGE_HANDLERS` `useExisting` | `apps/ptah-extension-webview/src/app/app.config.ts:473-479` | New `CodexSignInService` registered the same way |
| Codex executable selection: installed first, bundled otherwise, `CodexExecutableUnavailableError` | `libs/backend/codex-runtime/src/lib/select-codex-executable.ts:60-118,121-151` | Readiness binary fact and login executable come from one selection (row 8) |
| Electron registers one `CODEX_RUNTIME_TOKENS.SelectionSnapshot` in bootstrap (inside try/catch); Electron lanes resolve the same token | `apps/ptah-electron/src/activation/bootstrap.ts:590-622`; `apps/ptah-electron/src/di/codex-lane-composition.ts:109-110,156`; `apps/ptah-electron/src/di/codex-runtime-composition.ts:146-176` | Resolve the snapshot lazily at call time, never in a constructor (registration may be absent) |
| Lane `detect` returns `installed:false` for the empty-home throw although a binary resolved | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:156-175` | Onboarding cannot take the installed fact from the lane row (AC 1.9); lane untouched (AC 1.8) |
| Empty-home rules: Electron lane `CODEX_HOME === ''`; cli-engine also `HOME === ''` without `USERPROFILE` | `apps/ptah-electron/src/di/codex-lane-composition.ts:111-116`; `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:119-127` | Readiness uses the AC 1.9 union rule in a new pure helper; lane code unchanged |
| `resolveCodexHome` falls back to `~/.codex` for `CODEX_HOME=''` | `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts:51-58` | Readiness must check the empty-home rule before reading the file |
| `getTokenStatus` maps unreadable or missing file both to "not authenticated"; reader swallows every error | `codex-home-auth.service.ts:521-535,785-815,862-871` | New outcome method beside it; booleans untouched (AC 1.13) |
| `ICodexAuthService` implemented by `CodexAuthService` and `HomeAuthState` | `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts:58-79`; `codex-auth.service.ts:19-59`; `codex-home-auth.service.ts:249` | Both gain `getSignInOutcome()`; test fakes too |
| `probeCodex` answers `{false,false}` on 5 s timeout or throw | `libs/backend/rpc-handlers/src/lib/handlers/auth/auth-status-probes.ts:140-168`; `probe-timeout.ts:18,37-50` | Not changed; the five-outcome check is a separate read |
| Ambient Claude reader: unclosed child answered at once with the previous result or `unknown/timeout` | `libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts:172-182,251-253,265` | AC 5.7 needs a non-failure answer there (D-9) |
| Ambient read deadline 25 s, fresh cache 60 s (timeouts are cached too) | `claude-ambient-login-status.ts:6-11,138-145,229-240` | Follow-ups must use `refresh: true` or they replay the cached timeout |
| Ambient params schema is `.strict()` | `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts:127-129` | Adding `trigger` needs the schema and the shared params type (AC 5.8) |
| Frontend ambient owner: latest read wins, never throws, 30 s RPC timeout; RPC timeout resolves `RpcResult(false, ..., 'RPC timeout: <method>')` | `libs/frontend/core/src/lib/services/claude-ambient-status.service.ts:14,71-109`; `libs/frontend/core/src/lib/services/claude-rpc.service.ts:173-186` | A renderer RPC timeout is detectable and counts as a timeout outcome |
| Current readiness derivation and store (no timers, root) | `libs/frontend/onboarding/src/lib/ready/claude-readiness.store.ts:37-137` | Rewritten as a two-provider store; derivation stays pure |
| Persisted selection signals and refresh | `libs/frontend/core/src/lib/services/auth-state.service.ts:205-215,662-664,1273-1356` (`readAuthStatus` returns the newer read's boolean when superseded, `:1282-1283`) | `refreshAuthStatus` can return that boolean with no new state (AC 3.18) |
| `activateConnection` returns `true` after a block; rereads auth only after `saved` | `libs/frontend/core/src/lib/services/providers-connection-setup.service.ts:648-680`; hook type `:90`; bound at `providers-settings-state.service.ts:1019` | Return the reread outcome from the same call (AC 3.18, 3.20) |
| Popover default target rule and session-end copy | `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:345-384,624-645` | Extract the rule into core so stage 1 and the popover cannot diverge (AC 3.7) |
| Drawer write runner reads `commit()` after the write resolves | `libs/frontend/chat/src/lib/settings/providers/connection-drawer/drawer-write.ts:23-45` | Stage 1 copies this ordering |
| Codex sign-in callers | `providers-connection-setup.service.ts:276-279` (`auth:codexLogin`, 310 s); `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:343-347`; `auth-state.service.ts:1206-1210` | Both callers move to the shared sign-in service (row 7) |
| Codex credentials UI on Providers page | `libs/frontend/chat/src/lib/settings/providers/connection-drawer/credentials-tab.component.ts:180-192,203-212` | Codex block gains the shared sign-in block; Kimi block unchanged |
| Onboarding flag `ready` slice is lenient (`z.object`) | `libs/frontend/onboarding/src/lib/first-run/onboarding-flag.service.ts:27-41`; guard `onboarding-first-run.guard.ts:33-36` | A new optional field keeps old records valid (AC 4.6, D-8) |
| Home regions owned by this task | `libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts:28-31,67,77-82,112-116,302-307,326,332-333,419-421` | Exact edit list in Component 13 |
| Optional constructor injection pattern | `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:146-162` | New Codex tokens injected `{ isOptional: true }` |
| Handler family methods come from `AuthRpcHandlers.METHODS` | `auth-rpc.handlers.ts:72-92`; manifest `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:172-175` | New `auth:` methods register on Electron and CLI hosts; `auth:` prefix already allowed |
| Electron DI smoke list | `apps/ptah-electron/src/di/expected-resolvable.ts:22-53` | New tokens added there |
| Replay read-only method list includes readiness reads | `apps/ptah-electron/src/replay/scenario-sanitizer.ts:149-180` | Add `auth:getCodexReadiness` |
| External links in the renderer use `<a target="_blank" rel="noopener noreferrer">` | `libs/frontend/chat/src/lib/settings/providers/connection-drawer/kimi-code-login-progress.component.ts:51,77`; `ready-claude-step.page.ts:321-326` | "Open sign-in page" uses the same element |
| Analysis and generation run through `InternalQueryService` | `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:171,772`; `content-generation.service.ts:153,423` | Open question 1 is not settled by source here; banner stays claim-free (D-7) |

## Architecture decision

- Chosen approach:
  1. Backend: a host-neutral `CodexLoginService` and `CodexReadinessReader` in `auth-providers`,
     both following the Kimi login pattern (fixed argv, `IProcessSpawner`, `IUserInteraction`,
     deps object with test seams, DI factory). The Electron composition root registers both under
     new `AUTH_PROVIDERS_TOKENS`; the factories resolve `CODEX_RUNTIME_TOKENS.SelectionSnapshot`
     lazily per call. `AuthRpcHandlers` injects both optionally. `auth:codexLogin` gains the
     Kimi-style contract on hosts with the service (start returns at once, progress pushed as
     `auth:codexLoginStatus`, `auth:codexLoginCancel` stops it). The CLI runner path stays
     unchanged. The optimistic `openTerminal` success is removed.
  2. A new read `auth:getCodexReadiness` returns two independent facts (binary from the selection
     snapshot; sign-in outcome from a new five-outcome check). The lane row and the
     `auth:getAuthStatus` booleans are not changed.
  3. Frontend: core gets `CodexReadinessService` (owner of the new read, mirrors
     `ClaudeAmbientStatusService`) and `CodexSignInService` (owner of the sign-in state, push
     handler, 20 s "nothing seen" bound). Onboarding replaces `ClaudeReadinessStore` with
     `ProviderReadinessStore`, which derives both providers and the chosen connection from the
     persisted `authMethod`/`anthropicProviderId` pair and runs bounded follow-ups. Stage 1 saves
     through `ProvidersSettingsStateService.activateConnection` at the popover's default target,
     using a shared target helper in core. One `CodexSignInBlockComponent` in the chat lib is
     used by stage 1, the Providers credentials tab and the chat re-auth banner.
- Rationale: the Kimi pattern already solves the same problem (an interactive CLI login in
  Electron with cancel, timeout, URL open, safe pushes) and its frontend ordering rules are tested.
  Reusing `activateConnection` and the popover's target rule meets AC 3.7 and the "same save
  path" risk row. Separate facts keep AC 1.8, 1.13 and the lane and `cli-engine` behaviour intact.
- Rejected alternatives:
  - Implement `runAuthCommand` on `ElectronPlatformCommands` and extend `AuthCommandResult`
    with cancel and timeout. Rejected: the capability is a command string split on whitespace
    (`cli-platform-commands.ts:122`), so a bundled path with spaces breaks. It has no cancel route
    and no URL open, and it blocks the RPC for the full login. Extending it changes the CLI
    contract and the specs at `cli-platform-commands.spec.ts:133-290`.
  - Await the whole login inside `auth:codexLogin` (up to 10 min). Rejected: the Providers page
    already gives up at 310 s (`providers-connection-setup.service.ts:278`). A webview reload loses
    the result, and the Kimi contract shows the reload-safe shape (`rpc-auth.types.ts:168-185`).
  - Take the Codex installed fact from `agent:detectClis`. Rejected: the empty-home case reports
    `installed:false` (AC 1.9), and changing the row breaks AC 1.8.
  - Put the five outcomes into `auth:getAuthStatus`. Rejected: that read is shared by Providers,
    chat and `auth:checkConnection`, and its 5 s probe fallback would still mask timeouts. A
    separate read keeps AC 1.13 trivially true.
- Assumptions (each needs an implementation check):
  - A-1 (Revision 1, partly verified): the bundled Codex 0.165.0 binary
    (`node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`) contains
    the browser-mode lines "Starting local login server on http://localhost:" and "If your browser
    did not open, navigate to this URL to authenticate:", and the device-mode lines "Follow these
    steps to sign in with ChatGPT using device code authorization:" and "Enter this one-time code".
    It opens the browser through the Rust `webbrowser` 1.2.4 crate. `codex login --help`
    (installed 0.164.0) lists `--device-auth` and no flag that suppresses the browser. What stays
    unverified is the line order and the stream (stdout or stderr); the parser reads both streams
    and does not depend on order. Check: none that runs a login. Parser behaviour is fixed by
    fake-spawner transcripts built from these strings (Component 3); real browser behaviour is
    an Electron manual/visual check (Component 15). Never start `codex login` to record output.
  - A-2: the Electron renderer opens `target="_blank"` https links in the system browser, as the
    Kimi progress link does. Check: one manual click in Electron during visual review.
  - A-3: `openai-codex` is always a row in `ProvidersSettingsStateService.connections()` once
    loaded, so `activateConnection('openai-codex', ...)` is not blocked. Check: read `auth:listConnections`
    handler / catalogue source; if not guaranteed, stage 1 shows the AC 3.12 "not saved" notice
    (no extra code).
  - A-4: official Codex install commands and docs URL (`npm install -g @openai/codex`,
    `brew install --cask codex`, `https://developers.openai.com/codex/cli`). Check: confirm in the
    official docs at implementation (AC 2.5).
  - A-5: `provider-account-rpc.handlers.ts` can log the ambient outcome with its existing logger
    (`:234`). Verified field exists; the log format is new.
  - A-6: resolved in Revision 1 (quit hook named and wired, Component 6).
  - A-7: on Linux and the BSDs the `webbrowser` crate tries `$BROWSER` first and stops at the
    first entry that runs successfully, without a shell (webbrowser `unix.rs`,
    `try_with_browser_env`); on macOS and Windows it ignores `$BROWSER` (webbrowser crate docs).
    Check: Electron manual check on Linux that a sign-in opens exactly one tab; if a second tab
    still appears, the cost is a duplicate tab, not a failure.
  - A-8: `ConnectionSettingsMethods` can be built in a spec from a plain deps object
    (`connection-settings-methods.ts:27-42`, verified), and its `writeAuthSettings` write can be
    observed through fakes shared with the chat resolver stub. Check: read
    `connection-settings-methods.ts:156` onwards before writing the AC 3.11 spec.
  - A-9: `registerCliCodexLaneFactory(container, logger, { env, platform })`
    (`codex-lane-runtime-composition.ts:98`) lets a spec reach the composed lane `detect()` with a
    fake binary. Check: `codex-lane-runtime-composition.spec.ts:8-23`; if the factory needs a real
    binary, assert the composed `home()` rule (`:119-123`) through `resolveCliCodexLaneRuntime`
    (`:90`) instead.
  - A-10 (Revision 1): the real `ChatRuntimeProfileService.prepare` runs in one spec with the
    fakes listed in Revision 1 "New spec: AC 3.11" for both a Claude and a Codex start, as
    `chat-session.native.spec.ts:164-200` and `:576-627` show for each alone. Check: if the Codex
    start needs more native fakes, copy only what `:175-199` sets.
- Effect on existing code: replaces `ClaudeReadinessStore`, `ClaudeReadinessBannerComponent` and
  `ReadyClaudeStepPage` (renamed and rewritten). It removes `AuthStateService.codexLogin()` (single
  caller) and the optimistic terminal branch of `auth:codexLogin`. It leaves alone the CLI
  runner, `CliPlatformCommands`, the lane adapter, `agent:detectClis`, `probeCodex`,
  `getTokenStatus`, Kimi login behaviour and the stage 2 embedded pages.

## Decisions

| # | Decision | Options | Evidence | Reversible | Tag |
| --- | --- | --- | --- | --- | --- |
| D-1 | Codex in-app sign-in follows the Kimi contract: `auth:codexLogin` returns once the login is launched (or fails to launch); phases pushed as `auth:codexLoginStatus`; `auth:codexLoginCancel` stops it | Await completion in the RPC; extend `IAuthCommandRunner`; Kimi start/push/cancel | `kimi-code-login.service.ts:99-135`, `kimi-code-login-methods.ts:53-91`, Providers 310 s ceiling `providers-connection-setup.service.ts:278` | Yes | lane-proposed |
| D-2 | The CLI runner path and `AuthCommandResult` stay unchanged; the new service is preferred when present | Change the runner for all hosts | `cli-platform-commands.ts:119-182` and its specs; CLAUDE.md "keep cli-engine working" | Yes | project-rule |
| D-3 | `CodexLoginService` and `CodexReadinessReader` are registered only by the Electron composition root, under new `AUTH_PROVIDERS_TOKENS`, with lazy snapshot resolution | Register in `register-providers.ts` for all hosts | Snapshot registered only in Electron bootstrap inside try/catch (`bootstrap.ts:590-622`); CLI keeps its runner | Yes | lane-proposed |
| D-4 | With neither the service nor a runner, `auth:codexLogin` returns `{ success:false }` with fixed copy and does not call `openTerminal`; design state 11 is not built | Keep optimistic terminal success; build state 11 | No host has a working `openTerminal` (`electron-platform-commands.ts:63-68`, `cli-platform-commands.ts:87-89`, no VS Code app in `apps/`); row 7 forbids success without a login | Yes | user-requested (row 7) |
| D-5 | SUPERSEDED by Revision 1 R1-1 and R1-2. Default mode stays `browser` (`<selected> login`), but in both modes Ptah parses, validates and opens the first https sign-in URL with `openExternal` and reports `browserOpened`. "Use a device code" (state 4b) still restarts in device mode | (see R1-1) | design-spec.md:193-196; decisions.md row 26 | Yes | user-requested (design contract, row 26) |
| D-6 | No CLI output line reaches the webview or the log from the Electron sign-in; state 8 "Show details" shows the exit code and fixed reason only | Forward output lines (CLI path does) | NFR security (task-description.md); Kimi drops output (`kimi-code-login.service.ts:15-17`) | Yes | lane-proposed |
| D-7 | Open question 1: source does not show which onboarding flows need Claude Code when Codex is chosen; the banner body stays without a dependency sentence (design provisional copy becomes final) | Claim analysis and generation need Claude Code; no claim | `multi-phase-analysis.service.ts:171,772`, `content-generation.service.ts:153,423` run through `InternalQueryService`; requester saved a team builder draft on Codex (context.md) | Yes | lane-proposed |
| D-8 | Open question 2: Continue writes a new provider-neutral `ready.connectionAt`; `claudeAt` stays readable and is no longer written; the guard honours `claudeAt`, `connectionAt` or `skippedAt` | Rename `claudeAt`; keep writing `claudeAt` | Lenient slice `onboarding-flag.service.ts:27-31`; guard `onboarding-first-run.guard.ts:33-36`; AC 4.6 | Yes | lane-proposed |
| D-9 | AC 5.7 host fix: when an unclosed earlier child forces an immediate answer, the ambient reader returns the earlier result only if it is `connected` or `signed-out`, otherwise `unknown/timeout` | Leave as is; always `unknown/timeout` | `claude-ambient-login-status.ts:179-182,251-253`; AC 5.7 forbids a failure answer there | Yes | lane-proposed |
| D-10 | Follow-ups: at most 2 per provider per mount read, 5 s apart, each with `refresh: true`; Codex host deadline 20 s and renderer RPC timeout 25 s; Claude keeps 25 s / 30 s. Worst case 3x30 s + 2x5 s = 100 s exceeds 90 s only when the renderer RPC itself times out three times, so a renderer RPC timeout on a follow-up counts as terminal | Fewer follow-ups; longer spacing | AC 5.2 bound; host deadline `claude-ambient-login-status.ts:11`; renderer timeout `claude-ambient-status.service.ts:14`; cached timeouts `:138-145` | Yes (count may only go down) | lane-proposed |
| D-11 | A renderer-side RPC timeout (`'RPC timeout: '` prefix) is a timeout outcome, not a local failure, for both providers | Treat as local failure (today) | `claude-rpc.service.ts:173-186`; observed 10.2 s RPCs under lag (context.md) | Yes | lane-proposed |
| D-12 | Stage 1 target = popover default with no "Save to" choice, through a new core helper `defaultMainConnectionTarget` that the popover also uses | Copy the rule into onboarding | `main-agent-reassign-popover.component.ts:345-364`; task-description.md Decisions row "popover default" | Yes | user-requested (AC 3.7) |
| D-13 | `AuthStateService.refreshAuthStatus()` returns `Promise<boolean>` (true = this or the newer read succeeded); `activateConnection` returns `{ started, selectionReread }` | New signal; callback parameter | `auth-state.service.ts:662-664,1273-1283`; AC 3.18 leaves the mechanism to the architect | Yes | lane-proposed |
| D-14 | Bundled-only manual row: POSIX `"<path>" login` (device mode adds `--device-auth` only in the button); on Windows, or when the path contains `"`, the no-command sentence | Quote for PowerShell with `&` | Design 5.4 and rule 1b; PowerShell needs `&` before a quoted path, cmd does not, so no single row is correct for both | Yes | lane-proposed |
| D-15 | When the Codex sign-in fact is `unreadable` because the home is empty or unusable, no sign-in button is shown (a login cannot fix the environment); facts and Re-check stay | Show the button | AC 1.9; empty-home rule; the CLI would write to a different home than readiness reads | Yes | lane-proposed |
| D-16 | 20 s "nothing seen" bound kept at 20 s, owned by `CodexSignInService` (one timer) | Tune | design-spec-review.md decision 2 | Yes | lane-proposed |
| D-17 | Codex login success keeps today's side effects: `codexAuth.clearCache()`, `invalidateAuthStatusCache()`, `sdkAdapter.reset()` | Kimi's conditional reset | Parity with `interactive-login-methods.ts:233-235` | Yes | project-rule |

## Clarifications Needed

D-4 removes a branch that has no working host (no capability lost), D-6 tightens security, and
the RPC contract changes are internal between the host and its own renderer, with every caller
updated in this task. Revision 1 asked two questions; the user answered both (`## Revision 1`,
"User answers"). Q1 needs no change. Q2 asked for a carry-over by compaction; the user then
moved the carry-over to a separate task (branch `feat/provider-switch-carryover`, decision rows
37-38). This plan therefore ships the full four-step AC 3.11 host spec (`## Revision 1`, R1-6):
step 4 asserts `AUTH_REQUIRED` naming the stored provider for continuing a pre-switch
conversation, and that `resumeSession` is not called. No open question blocks any batch.

## Component specifications

### 1. Shared contracts (`libs/shared`)

- Purpose: one typed contract for the Codex sign-in, the Codex readiness read and the readiness
  trigger.
- Responsibilities (all in existing files):
  - `rpc-auth.types.ts`, next to the Kimi block:
    - `CodexLoginMode = 'browser' | 'device'`.
    - `CodexLoginStatus = 'starting' | 'running' | 'awaiting-user' | 'succeeded' | 'failed' | 'cancelled'`.
      `starting` is before a pid exists (design state 2). `running` means the process runs and
      nothing has been seen (state 4). `awaiting-user` means a URL or code was seen (states 3/5).
      The last three are final.
    - `CodexLoginErrorCode = 'unavailable' | 'spawn-failed' | 'exited' | 'timeout' | 'no-credentials'`.
    - `CodexLoginState { attemptId: string; status; mode; executableSource?: 'installed'|'bundled';
      verificationUrl?: string /* https only */; userCode?: string; browserOpened?: boolean
      /* set only after Ptah's openExternal returned or threw, in either mode (R1-1) */;
      errorCode?; exitCode?: number|null; error?: string /* fixed copy */ }`.
    - `AuthCodexLoginParams { mode?: CodexLoginMode; restart?: boolean }`. Replaces
      `Record<string, never>`; an empty object stays valid.
    - `AuthCodexLoginResponse { success: boolean; error?: string; state?: CodexLoginState }`.
      Additive: CLI responses keep `{success, error?}` with no `state`. Revision 1 (R1-4) fixes
      what `success` means when `state` is present. `success` is `true` only when
      `state.status` is `starting`, `running`, `awaiting-user` (the attempt is live) or
      `succeeded`. It is `false` for `failed` (with `error` set to fixed copy) and for
      `cancelled` (with no `error`). `state` is the authority: the renderer drives the UI from
      `state` and never from `success` alone. A `cancelled` start is therefore never
      success-looking, and it is never shown as a failure either.
    - `AuthCodexLoginCancelParams = Record<string, never>`, `AuthCodexLoginCancelResponse { cancelled: boolean }`.
    - `ReadinessTrigger = 'mount' | 'follow-up' | 'recheck'`.
    - `CodexSignInOutcome = 'signed-in' | 'stale' | 'signed-out' | 'unreadable' | 'timeout'`
      (the five outcomes of the AC 1 contract table).
    - `CodexReadinessBinary = { state: 'found'; path; version; source: 'installed'|'bundled' } |
      { state: 'missing' } | { state: 'unknown'; reason: 'timeout'|'local' }`.
    - `CodexReadinessSignIn = { outcome: CodexSignInOutcome; unreadable?: 'auth-file'|'home' }`.
    - `AuthGetCodexReadinessParams { refresh?: boolean; trigger?: ReadinessTrigger }`,
      `AuthGetCodexReadinessResponse { binary: CodexReadinessBinary; signIn: CodexReadinessSignIn; checkedAt: string }`.
  - `rpc.types.ts`: registry entries for `auth:codexLogin` (new param/result types),
    `auth:codexLoginCancel`, `auth:getCodexReadiness` (near `:1247`) and the method map (near
    `:3451`).
  - `message-constants.ts`: `AUTH_CODEX_LOGIN_STATUS: 'auth:codexLoginStatus'` (after `:337`).
    `payload-map.ts`: `AuthCodexLoginStatusPayload = CodexLoginState` and the map entry.
  - `rpc/rpc-provider-accounts.types.ts:265-268`: `ProviderGetAmbientClaudeStatusParams.trigger?: ReadinessTrigger`.
- Verified contracts: `rpc-auth.types.ts:90-193`; `rpc.types.ts:1247-1250,3451`;
  `message-constants.ts:324-337`; `payload-map.ts:184-217,461-463`; `rpc-provider-accounts.types.ts:265-271`.
- Dependencies: none new (`scope:shared`).
- Integration points: every component below.
- Failure behaviour: types only. Paths, tokens and output lines never appear in these payloads. The
  readiness `path` is the executable path, which the readiness UI already shows today.
- Quality requirements: no `any`; all new unions exported.
- Verification seam: typecheck of `@ptah-extension/shared` and every dependent project.
  `host-source-registry.contract.spec.ts` must still pass; the baseline is frozen and Kimi
  methods are not in it either.
- Files: MODIFY `<wt>/libs/shared/src/lib/types/rpc/rpc-auth.types.ts`,
  `<wt>/libs/shared/src/lib/types/rpc.types.ts`,
  `<wt>/libs/shared/src/lib/types/messages/message-constants.ts`,
  `<wt>/libs/shared/src/lib/types/messages/payload-map.ts`,
  `<wt>/libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`.

### 2. Codex sign-in outcome check (`auth-providers`, codex)

- Purpose: answer the five-outcome sign-in check without changing `getTokenStatus`.
- Responsibilities:
  - `HomeAuthState.getSignInOutcome(): Promise<Exclude<CodexSignInOutcome,'timeout'> | 'unreadable-home'>`.
    It reads `auth.json` from disk, bypassing the cache. While a rotation is pending, it
    classifies the pending auth (as `readAuthFile` does at `:785-800`). `ENOENT`/`ENOTDIR` give
    `signed-out`. Other read errors, invalid JSON or a schema failure give `unreadable`. With an
    API key it returns `signed-in`. With no access token it returns `signed-out`. Otherwise
    `isCodexAccessTokenStale` decides between `stale` and `signed-in`.
  - New pure helper `isCodexHomeExplicitlyEmpty(env)`: `CODEX_HOME === ''`, or `CODEX_HOME`
    undefined with `HOME === ''` and no `USERPROFILE`. This is the AC 1.9 rule. It sits beside
    `resolveCodexHome` and is exported.
  - `CodexAuthService.getSignInOutcome()` delegates; `ICodexAuthService` gains the method.
- Verified contracts: `codex-home-auth.service.ts:51-58,249,521-535,785-815,862-871,877-890`;
  `codex-auth.service.ts:19-59`; `codex-provider.types.ts:58-79`.
- Dependencies: `@ptah-extension/shared` (`isCodexAccessTokenStale`, already imported `:18`).
- Integration points: Component 4.
- Failure behaviour: never throws; any unexpected error maps to `unreadable`. It logs a fixed
  message with the error class only, never content.
- Quality requirements: one disk read per call; no cache mutation.
- Verification seam: `codex-home-auth.service.spec.ts`, with five cases (AC 1.12: absent ->
  `signed-out`, invalid JSON and `EACCES` -> `unreadable` per AC 1.11, stale, signed-in, API
  key). It also asserts that `getTokenStatus` is unchanged for the same fixtures (AC 1.13).
  Every test fake implementing `ICodexAuthService` gains the method (find with
  `grep -rn "ICodexAuthService" libs --include=*.spec.ts` and `libs/backend/rpc-handlers/src/test-utils`).
- Files: MODIFY `<wt>/libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts`,
  `codex-auth.service.ts`, `codex-provider.types.ts`, `codex-home-auth.service.spec.ts`,
  `codex/index.ts`.

### 3. `CodexLoginService` (`auth-providers`, codex)

- Purpose: run one Codex sign-in process in the host and report each phase.
- Responsibilities (mirror `KimiCodeLoginService`):
  - `start({ mode, restart }, onState): Promise<CodexLoginState>`. It resolves once launched or
    failed. While a sign-in runs and `restart` is false, it returns the running state. With
    `restart: true`, it stops the running one first and awaits its final `cancelled` before
    launching; that keeps one child at most. Each launch gets a new `attemptId` (monotonic
    counter, string).
  - Executable: `selection()` (deps function), which calls
    `CodexSelectionSnapshotPort.selectForOpen()` and uses `selected.path` and `selected.source`.
    `CodexExecutableUnavailableError` or an absent snapshot gives `failed/unavailable`. There is
    no retry on another binary (row 8).
  - Spawn: `spawner.spawnProcess({ command: selected.path, args: mode === 'device' ? ['login','--device-auth'] : ['login'], env })`.
    The env is the host env without `ANTHROPIC_*`, with `NO_COLOR=1`; `CODEX_HOME` is untouched
    so the login writes the home that readiness reads. stdin is ended at once.
  - CLI browser suppression (R1-2): on every platform except `darwin` and `win32`, the child env
    gets `BROWSER=<no-op>`, where `<no-op>` is the first of `/usr/bin/true` and `/bin/true` that
    exists (a deps `fileExists` seam). If neither exists, `BROWSER` is left as the host has it.
    On `darwin` and `win32` nothing is set, because the CLI's opener ignores `BROWSER` there (A-7).
    The value is an absolute path to a program that runs nothing, so no shell is involved and no
    user input reaches it. `platform` is a deps field (default `process.platform`) so tests cover
    each branch.
  - Status `starting` until `whenSpawned` resolves a pid, then `running`. A `null` pid or
    `error` gives `spawn-failed` (`not-installed` is not used; the executable was selected).
  - Output (both streams): each line goes through `stripAnsi`.
    - The first URL that `extractSignInUrl` returns (it passes `validateSignInUrl`) moves the state to `awaiting-user` and is
      kept as `verificationUrl` (R1-3).
    - The first code matching `/\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+\b/` (same shape as
      `cli-platform-commands.ts:66`) does the same and is kept as `userCode`.
    - `validateSignInUrl(raw)` accepts a string only when all of these hold: `new URL(raw)`
      parses, the protocol is `https:`, there is no username or password, and the length is at
      most 4096. The `http://localhost:` line of browser mode therefore never qualifies.
      Invalid candidates are dropped and the parser keeps looking, both later on the same line
      and on later lines.
    - URL extraction contract (round 2, decision row 40). The shared helper is split so that
      Kimi keeps its current behaviour exactly and Codex adds no second regex. All of it lives
      in `providers/cli-login-output.ts`:
      - `httpsUrlCandidates(line: string): string[]` returns every match of
        `/https:\/\/[^\s"'<>`]+/g` on the line, in order, each with the trailing-punctuation trim
        `/[).,;:!?\]]+$/` that Kimi applies today (`kimi-code-login.service.ts:404-406`). It does
        not validate.
      - `parseHttpsUrl(candidate: string, maxLength: number): string | undefined` does today's
        check unchanged: reject when `candidate.length > maxLength`, else `new URL`, `https:`
        only, return `url.toString()`, and `undefined` on a parse throw (`:407-414`, keeping its
        degradation-audit comment).
      - `extractHttpsUrl(line: string): string | undefined` keeps its signature and result:
        `const first = httpsUrlCandidates(line)[0]; return first === undefined ? undefined :
        parseHttpsUrl(first, 2048);` (first candidate only, 2048 max). A line with no
        candidate returns `undefined` before `parseHttpsUrl` runs, as today
        (`kimi-code-login.service.ts:403-405`); the existing `extractHttpsUrl('nothing here')`
        case (`kimi-code-login.service.spec.ts:306-313`) stays, and the same no-URL case is added
        to `cli-login-output.spec.ts` (review r2 finding 1, decision row 42).
        Kimi's two call sites (`kimi-code-login.service.ts:236,255`) are unchanged.
      - Codex-only, in `codex-login.service.ts`: `CODEX_SIGN_IN_URL_MAX = 4096`;
        `validateSignInUrl(raw: string): string | undefined` = `parseHttpsUrl(raw, 4096)`, then
        reject when the parsed URL has a username or password or when the normalised string is
        longer than 4096 (so the re-check before `openExternal` gives the same answer);
        `extractSignInUrl(line: string): string | undefined` returns the first candidate of
        `httpsUrlCandidates(line)` for which `validateSignInUrl` returns a value.
      - A 4096-character URL fits the 8 KiB line cap of `LineSplitter`.
    - In BOTH modes Ptah opens the accepted URL once per attempt with
      `userInteraction.openExternal`, after `validateSignInUrl` passes again right before the
      call (R1-1). `true` sets `browserOpened: true`. `false` sets `browserOpened: false`. A
      throw also sets `browserOpened: false` and logs the error class only. Neither outcome
      fails the attempt: the CLI's local login server is still waiting, so the block offers Open
      sign-in page and Copy link (design rule 6 failure copy). Later URLs in the same attempt
      are ignored.
    - Lines are dropped after parsing (D-6).
  - Exit 0 gives `codexAuth.clearCache()` then `getSignInOutcome()`: `signed-in` -> `succeeded`,
    otherwise `failed/no-credentials`. A non-zero exit gives `failed/exited` with `exitCode`.
  - Timeout of 10 min (`CODEX_LOGIN_TIMEOUT_MS`) gives a process tree kill (`killProcessTree(pid,
    'SIGKILL')`, as Kimi `kimi-code-login.service.ts:96`) and then `failed/timeout`. `cancel()`
    gives a tree kill and then `cancelled`; cancel during `starting` stops before the spawn.
  - `start` resolves with the state current at the moment it resolves, never a state captured
    before an await. So a cancel that lands between `whenSpawned` and the resolve returns
    `cancelled`, not a stale `running` (R1-4).
  - Lifecycle for app quit (R1-5):
    - `isActive(): boolean` is true while an attempt is `starting`, `running` or
      `awaiting-user`.
    - `dispose(): Promise<void>` sets `disposed`, cancels the startup or the child, and settles
      the attempt to exactly one final `cancelled`. It resolves once the tree kill has settled
      and never rejects. A later child `close` or `exit` emits nothing more, and `start()` after
      dispose resolves `cancelled` without spawning (as Kimi `:103`).
    - The `onState` callback is best-effort during quit: a throwing broadcast is caught and
      logged.
  - Move `stripAnsi`, `extractHttpsUrl` and `LineSplitter` from `kimi-code-login.service.ts:390-454`
    into `providers/cli-login-output.ts`, splitting `extractHttpsUrl` into the
    `httpsUrlCandidates` / `parseHttpsUrl` pair above, and import them in both services. Codex
    imports `httpsUrlCandidates`, `parseHttpsUrl`, `stripAnsi` and `LineSplitter`; Kimi imports
    `extractHttpsUrl`, `stripAnsi` and `LineSplitter`. `extractUserCode` stays in Kimi (Codex
    uses its own code regex). No re-export is left in `kimi-code-login.service.ts`; the Kimi spec
    import (`kimi-code-login.service.spec.ts:15-20`) is split so `extractHttpsUrl` and
    `stripAnsi` come from `../cli-login-output`. This is the third parser of the same output
    kind; `cli-platform-commands.ts` stays as is.
- Verified contracts: `kimi-code-login.service.ts:40-454`; `IProcessSpawner`
  `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts:63-120`; `killProcessTree`
  (imported by Kimi `:22-27`); `IUserInteraction.openExternal(url): Promise<boolean>`
  `libs/backend/platform-core/src/interfaces/user-interaction.interface.ts:73-77`;
  `CodexSelectionSnapshotPort` `select-codex-executable.ts:29-34`.
- Dependencies: platform-core (ports), codex-runtime (types; already a dependency per
  `codex-home-auth.service.ts:10-15`), shared, vscode-core `Logger` (as Kimi). Direction:
  `auth-providers` -> lower libs only.
- Integration points: Component 5 (RPC), Component 6 (registration).
- Failure behaviour: never throws from `start`; every path ends in exactly one final state;
  `settle` is idempotent; the timer is `unref`'d and cleared on settle; listeners are removed on
  close (as Kimi `:203-214`). It logs fixed messages with error class, exit code and outcome, and
  never output or paths.
- Quality requirements: at most one child; no output buffering beyond one line (8 KiB cap as Kimi).
- Verification seam: new `codex-login.service.spec.ts`, modelled on `kimi-code-login.service.spec.ts`,
  with a fake spawner, user interaction, selection and auth plus fake timers.
  - Transcripts (Revision 1, R1-8): fixtures are fake-spawner line sequences built from the
    strings verified in A-1. Browser mode: "Starting local login server on
    http://localhost:1455.", then "If your browser did not open, navigate to this URL to
    authenticate:", then a synthetic `https://auth.example.test/oauth/authorize?...` line. Device
    mode: "Follow these steps...", then a synthetic https URL, then "Enter this one-time code",
    then `ABCD-12345`. Each fixture is fed once on stdout and once on stderr. No fixture is
    recorded from a real login, and none contains a real token or account.
  - Cases: spawn error; null pid; no URL ever (stays `running`, no `openExternal`); the
    `http://localhost` line is not opened.
  - Default mode `openExternal` (R1-1): browser mode calls `openExternal` exactly once with the
    parsed URL and sets `browserOpened: true`. Device mode does the same.
  - Invalid URL rejection (R1-3): `javascript:`, `http:`, `file:`, `https://user:pw@host/`, an
    unparseable string and a URL longer than 4096 characters are each never opened and never
    set as `verificationUrl`. A valid https URL after an invalid one is opened.
  - URL extraction (round 2): a valid https URL of 2049 characters and one of exactly 4096
    characters are each accepted, set as `verificationUrl` and opened. A 4097-character URL is
    rejected. On ONE line, `https://user:pw@host/x https://auth.example.test/ok` yields the
    second URL. On one line, a 4097-character https URL followed by a valid one yields the valid
    one.
  - New `cli-login-output.spec.ts` (same folder as `cli-login-output.ts`): `httpsUrlCandidates`
    returns all matches in order with trailing punctuation trimmed; `parseHttpsUrl` honours the
    `maxLength` it is given (2048 and 4096 boundaries, each side); `extractHttpsUrl` still
    returns `undefined` for a 2049-character URL and still looks at the first candidate only
    (a line with an invalid then a valid URL gives `undefined`), which pins Kimi's behaviour.
  - `openExternal` outcomes (R1-1): resolving `false` gives `browserOpened: false` with the status
    still `awaiting-user`. Throwing does the same and logs no URL. A second URL never triggers a
    second open.
  - `BROWSER` suppression (R1-2): on `linux` the child env has `BROWSER` set to the first existing
    no-op path. On `linux` with neither path present, the host value is kept. On `darwin` and
    `win32` the host value is kept. The `ANTHROPIC_*` keys are always stripped.
  - Code parsed; cancel in `starting` (no spawn); cancel while running; timeout; exit 1; exit 0
    signed in; exit 0 without credentials; `restart` waits for the old attempt to end; selection
    unavailable; bundled path used verbatim in argv.
  - Race (R1-4): a cancel issued synchronously right after `whenSpawned` resolves, before
    `start` resolves, makes `start` resolve `cancelled`. `onState` then emits no `running` after
    `cancelled`.
  - Quit while active (R1-5): `dispose()` on a running child kills the tree once with that pid
    and emits exactly one final `cancelled`. A later `close(1)` emits nothing. `isActive()` is
    false afterwards, and `start()` resolves `cancelled` without spawning. `dispose()` during
    `starting` never spawns. `dispose()` resolves even when `killTree` rejects.
  - Kimi specs stay green after the helper move, with their cases unchanged
    (`kimi-code-login.service.spec.ts:307-325`); only the import line moves.
- Files: CREATE `<wt>/libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.ts`,
  `codex-login.service.spec.ts`, `<wt>/libs/backend/auth-providers/src/lib/providers/cli-login-output.ts`,
  `cli-login-output.spec.ts`;
  MODIFY `kimi-code/kimi-code-login.service.ts` (import moved helpers),
  `kimi-code/kimi-code-login.service.spec.ts` (import path only), `codex/codex-provider.types.ts`
  (`ICodexLoginService`), `codex/index.ts`, `<wt>/libs/backend/auth-providers/src/index.ts` (exports).

### 4. `CodexReadinessReader` (`auth-providers`, codex)

- Purpose: the onboarding Codex facts. Binary and sign-in are reported apart, each with its own
  failure.
- Responsibilities:
  - `read({ refresh, trigger }): Promise<AuthGetCodexReadinessResponse>`. Binary and sign-in run
    in parallel under a 20 s deadline (`CODEX_READINESS_DEADLINE_MS`). Binary:
    `selection()` -> `found`; `CodexExecutableUnavailableError` -> `missing`; deadline ->
    `unknown/timeout`; other error -> `unknown/local`. Sign-in: if `isCodexHomeExplicitlyEmpty(env)`
    -> `unreadable/home`; else `getSignInOutcome()`; deadline -> `timeout`.
  - Single flight: a read joins the running one; `refresh:true` while one runs queues one
    follow-up (the Claude reader pattern, `claude-ambient-login-status.ts:155-175`). A
    non-timeout result younger than 60 s answers `refresh:false`. Timeout results are never
    cached.
  - Log once per answered read (AC 5.8):
    `logger.info('[readiness] codex', { binary: state|reason, signIn: outcome, unreadable, trigger })`,
    with no path, token or env.
- Verified contracts: as Component 3; `select-codex-executable.ts:60-65,67-118`.
- Dependencies: same as Component 3.
- Integration points: Component 5.
- Failure behaviour: never throws; each fact fails alone (AC 1.7, 1.9). The deadline timer is
  cleared and `unref`'d, and late results are dropped.
- Quality requirements: at most one in-flight probe set (AC 5.9).
- Verification seam: new `codex-readiness.reader.spec.ts`. Cases: bundled only -> found/bundled
  (AC 1.2); binary found with no `auth.json` -> found plus `signed-out` (AC 1.3); stale (AC 1.4);
  empty home with binary found -> found plus `unreadable/home` (AC 1.9 onboarding half; the lane
  half is a new case in `cli-agent-runtime` and `cli-engine`, see Revision 1 R1-7); sign-in
  deadline -> `timeout`, not `signed-out` (AC 1.10); binary unavailable -> missing; join and
  queue behaviour; timeout not cached; log line has no path.
- Files: CREATE `<wt>/libs/backend/auth-providers/src/lib/providers/codex/codex-readiness.reader.ts`,
  `codex-readiness.reader.spec.ts`; MODIFY `codex/codex-provider.types.ts` (`ICodexReadinessReader`),
  `codex/index.ts`.

### 5. Auth RPC surface (`rpc-handlers`)

- Purpose: expose Components 3 and 4 and make `auth:codexLogin` honest.
- Responsibilities:
  - `AUTH_PROVIDERS_TOKENS.SDK_CODEX_LOGIN = Symbol.for('SdkCodexLogin')` and
    `SDK_CODEX_READINESS = Symbol.for('SdkCodexReadiness')` in
    `libs/backend/auth-providers-tokens/src/lib/tokens.ts` (next to `:45`).
  - `AuthRpcHandlers`: inject both with `{ isOptional: true }` (pattern `:152-162`); add
    `'auth:codexLoginCancel'` and `'auth:getCodexReadiness'` to `METHODS` and to the
    `register()` debug list; pass the services into `InteractiveLoginMethods` and a new
    `CodexReadinessMethod`.
  - `InteractiveLoginMethods.registerCodexLogin` order:
    1. With `codexLogin` present, validate params at the boundary (`mode` is `'device'` else
       `'browser'`; `restart === true`) and call `start`. The state-change callback broadcasts
       `AUTH_CODEX_LOGIN_STATUS` (best effort, as Kimi `:127-139`). On `succeeded` it runs
       today's side effects (D-17), with errors logged and never thrown. The response comes
       from the state `start` resolved with (R1-4):
       - a live state (`starting`, `running`, `awaiting-user`) or `succeeded` gives
         `{ success: true, state }`;
       - `failed` gives `{ success: false, error: <fixed copy for errorCode>, state }`;
       - `cancelled` gives `{ success: false, state }` with no `error`.
       The `state.status !== 'failed'` rule is removed.
    2. Else, with a runner present (CLI), today's code at `:213-243` is unchanged.
    3. Else `{ success:false, error:'Codex sign-in cannot run here. Run codex login in a terminal, then check again.' }`
       with no `openTerminal` call (D-4).
  - `registerCodexLoginCancel`: `{ cancelled: codexLogin?.cancel() ?? false }`.
  - New `auth/codex-readiness-method.ts`: `auth:getCodexReadiness`. It validates `refresh` as a
    boolean and `trigger` against the three literals (unknown values are dropped), then calls
    `reader.read`. With no reader it returns `{ binary:{state:'unknown',reason:'local'}, signIn:{outcome:'unreadable'} ... }`;
    the frontend never calls it outside Electron.
  - `provider-account-rpc.schema.ts:127-129`: add `trigger: z.enum(['mount','follow-up','recheck']).optional()`.
    `getAmbientClaudeStatus` (`provider-account-rpc.handlers.ts:391-404`) logs
    `[readiness] claude {state, reason, trigger}` (AC 5.8).
  - Test utils: add `createFakeCodexLogin()` and `createFakeCodexReadiness()` beside
    `libs/backend/rpc-handlers/src/test-utils/kimi-code-fakes.ts`.
- Verified contracts: `interactive-login-methods.ts:25-37,201-248`; `auth-rpc.handlers.ts:72-92,108-162,166-262`;
  `kimi-code-login-methods.ts:53-139`; `provider-account-rpc.schema.ts:127-151`;
  `provider-account-rpc.handlers.ts:234,391-404`.
- Dependencies: rpc-handlers -> auth-providers, auth-providers-tokens, shared (existing directions).
- Integration points: webview `ClaudeRpcService`; Electron DI (Component 6); CLI container
  (tokens absent, so the runner path runs).
- Failure behaviour: no handler throws to the transport for an expected outcome; unexpected
  errors go to Sentry with fixed copy as today (`:236-247`).
- Quality requirements: no output, path or token in any log line added here.
- Verification seam: `auth-rpc.handlers.spec.ts`, Codex section (around `:300-430`, `:2084`):
  - service present -> start called with validated params, `state` returned, push broadcast;
  - success mapping (R1-4), one case each: `running`, `awaiting-user` and `succeeded` give
    `success:true`; `failed` gives `success:false` with fixed `error`; `cancelled` gives
    `success:false` with no `error`;
  - cancel during start (R1-4), with a fake service whose `start` stays pending. Calling
    `auth:codexLoginCancel` before `start` resolves makes the `auth:codexLogin` response
    `{ success:false, state:{ status:'cancelled' } }`;
  - cancel instantly after spawn (R1-4), with the real `CodexLoginService` over a fake spawner.
    A cancel issued in the same tick as pid resolution makes the response `cancelled`, not
    `running` or `success:true`, and the pushes end with exactly one `cancelled`;
  - succeeded -> clearCache, reset and invalidate;
  - runner present and no service -> existing specs unchanged;
  - neither -> `success:false` and `openTerminal` not called (replaces the old optimistic-success
    expectation);
  - cancel with and without the service.
  New `codex-readiness-method.spec.ts` covers param validation and absent reader.
  `provider-account-rpc.handlers` spec covers strict-schema acceptance of `trigger` and the log.
  `auth-rpc.handlers.key-hint.spec.ts:169-198` constructs the handler, so its argument list
  must still type-check.
- Files: MODIFY `<wt>/libs/backend/auth-providers-tokens/src/lib/tokens.ts`,
  `<wt>/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`,
  `<wt>/libs/backend/rpc-handlers/src/lib/handlers/auth/interactive-login-methods.ts`,
  `<wt>/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`,
  `<wt>/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`,
  `<wt>/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts`,
  `<wt>/libs/backend/rpc-handlers/src/test-utils/kimi-code-fakes.ts` (or a sibling `codex-fakes.ts`);
  CREATE `<wt>/libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.ts`,
  `codex-readiness-method.spec.ts`.

### 6. Electron composition (`apps/ptah-electron`)

- Purpose: bind Components 3 and 4 in the priority host.
- Responsibilities:
  - New `src/di/codex-login-composition.ts` exports `registerElectronCodexReadinessAndLogin(container, logger)`.
    It registers `SDK_CODEX_LOGIN` and `SDK_CODEX_READINESS` with `instanceCachingFactory`
    (pattern `register-providers.ts:141-153`). The deps are: `spawner` =
    `SDK_TOKENS.SDK_PROCESS_SPAWNER`; `userInteraction` = `PLATFORM_TOKENS.USER_INTERACTION`;
    `codexAuth` = `AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH`; and `selection` is an async function
    that checks `container.isRegistered(CODEX_RUNTIME_TOKENS.SelectionSnapshot, true)` on every
    call, resolving and calling `selectForOpen()`, or throwing `CodexExecutableUnavailableError`
    when the token is absent. Nothing resolves at registration time.
  - Call it from `phase-2-libraries.ts` right after `registerSdkServices` (`:222`), so the
    spawner exists before any resolve.
  - Add both tokens to `EXPECTED_RESOLVABLE_TOKENS` (`expected-resolvable.ts:40-53`).
  - Add `'auth:getCodexReadiness'` to the read-only list in `replay/scenario-sanitizer.ts` (near `:149-156`).
  - Quit cleanup (Revision 1, R1-5; replaces A-6). The quit hook is `app.on('will-quit')` in
    `apps/ptah-electron/src/main.ts:457-498`. It delegates to `handleWillQuit(deps)` in
    `apps/ptah-electron/src/activation/shutdown.ts:609-660` with explicit callbacks; there is no
    disposer registry. (Kimi's login is not disposed on quit today; `grep SDK_KIMI_CODE_LOGIN
    apps/ptah-electron/src` has no match. That gap is out of scope and is not copied.) Changes:
    - `codex-login-composition.ts` keeps the instance its `SDK_CODEX_LOGIN` factory creates in a
      module-scoped variable. It exports `codexSignInQuitHandle: { isActive(): boolean;
      stop(): Promise<void> }`. `isActive` returns `created?.isActive() ?? false`, and `stop`
      returns `created?.dispose() ?? Promise.resolve()`. The handle never resolves from the
      container, so a quit never constructs the service.
    - `shutdown.ts`: `QuitSequenceDeps` gains a REQUIRED `codexSignIn: { isActive(): boolean;
      stop(): Promise<void> }` and an optional `codexSignInStopBudgetMs`. `DisposalDeps` picks
      both. Making the field required turns a missing wire-up in `main.ts` into a typecheck error.
    - `handleWillQuit` (`:636`) takes the synchronous path only when
      `!bootRunning && !requiresDeferredDisposal(deps.refs) && !deps.codexSignIn.isActive()`.
      `requiresDeferredDisposal(refs)` keeps its signature, so existing callers and specs are
      unchanged. An active sign-in therefore always defers the quit (`deferQuit()`), the same way
      a running check does (`:492-506`).
    - `disposeBeforePersistence` (`:233-266`) starts `deps.codexSignIn.stop()` right after
      `killRunningChecks()` (`:250`). Both are child-process kills that write nothing, which is
      the head-of-chain position this file reserves for kills. The call is wrapped like
      `nonFatal`, so a sync throw becomes a resolved promise. The function returns
      `{ checksKilled, codexSignInStopped }`.
    - `disposeBootRefs` (`:518-557`) wraps `codexSignInStopped` in
      `withBudget('Codex sign-in stop', ..., deps.codexSignInStopBudgetMs ??
      CODEX_SIGN_IN_STOP_BUDGET_MS, 'quitting with the sign-in process possibly still alive.')`
      and awaits it beside `checksKilled`. `CODEX_SIGN_IN_STOP_BUDGET_MS = 2000` follows the
      sibling budgets (`:57-141`). The SIGKILL tree kill needs no grace period. On win32 the
      `taskkill` dynamic import is the only await (`process-tree-reaper.ts:59-73`). The
      synchronous path calls `void` on it, as it does for the check kill.
    - `main.ts:460-497` passes `codexSignIn: codexSignInQuitHandle` into `handleWillQuit`. That
      is the only `main.ts` edit, and it keeps the file branch-free.
    - Single final state: `CodexLoginService.dispose()` settles `cancelled` exactly once
      (Component 3). The push to a closing window is best-effort, and no other final state can
      follow.
- Verified contracts: `phase-2-libraries.ts:190-222`; `bootstrap.ts:590-622`; `expected-resolvable.ts:22-53,124-133`;
  `container.smoke.spec.ts:919-940` (spawner resolvable after phase 2); `main.ts:457-498`;
  `shutdown.ts:143-196,233-266,498-507,518-557,609-660`; `killProcessTree`
  `libs/backend/platform-core/src/utils/process-tree-reaper.ts:54-73`.
- Dependencies: Electron app -> auth-providers, auth-providers-tokens, codex-runtime, agent-sdk,
  platform-core (all already imported by the app).
- Integration points: `AuthRpcHandlers` (phase 4, `phase-4-handlers.ts:103`).
- Failure behaviour: if the bootstrap snapshot binding failed (`bootstrap.ts:615-620`), sign-in
  reports `failed/unavailable` and readiness reports binary `missing`. No crash and no false
  success.
- Quality requirements: no resolve at import or registration time (validate-deps and smoke
  tests).
- Verification seam:
  - `container.smoke.spec.ts`: both tokens resolvable.
  - New `codex-login-composition.spec.ts`: the selection function reads the snapshot token
    lazily and maps an absent token to unavailable. The quit handle reports `isActive() ===
    false` and `stop()` resolves without the service ever being resolved. After a resolve, the
    handle delegates to that instance.
  - `shutdown.spec.ts`, new cases (R1-5). The `quitDeps` factory (`:78`) gains an inactive
    `codexSignIn` fake.
    - Quit while a login is active: with every ref null and `isActive()` true, `handleWillQuit`
      returns `false` and calls `deferQuit` once. `stop` is called once, before `SQLite close`
      in the recorded order, and `quit` is called once after `stop` settles.
    - Hung stop: with `stop` never settling (fake timers), `quit` is still called after
      `CODEX_SIGN_IN_STOP_BUDGET_MS`.
    - Inactive: nothing changes on the synchronous path (existing order cases stay green).
  - A spec that drives the real `CodexLoginService` with a fake spawner as `codexSignIn` (handle
    built from it): a quit during `running` observes one tree kill for the child pid and exactly
    one final `cancelled` state.
  - `main.quit-path.spec.ts` (`:253-370`) builds `handleWillQuit` deps, so it gains the inactive
    fake; its assertions do not change.
  - di-lint passes on push.
- Files: CREATE `<wt>/apps/ptah-electron/src/di/codex-login-composition.ts`, `codex-login-composition.spec.ts`;
  MODIFY `<wt>/apps/ptah-electron/src/di/phase-2-libraries.ts`, `expected-resolvable.ts`,
  `<wt>/apps/ptah-electron/src/replay/scenario-sanitizer.ts`,
  `<wt>/apps/ptah-electron/src/activation/shutdown.ts`, `shutdown.spec.ts`,
  `<wt>/apps/ptah-electron/src/main.ts` (the one `codexSignIn` line),
  `<wt>/apps/ptah-electron/src/main.quit-path.spec.ts`.

### 7. Ambient Claude reader AC 5.7 fix (`auth-providers`, accounts)

- Purpose: an answer forced by an unclosed earlier child is never a failure.
- Responsibilities: in `start()` (`claude-ambient-login-status.ts:179-182`) use a new
  `blockedByUnclosedChild(key)`. It returns the last result when its state is `connected` or
  `signed-out`, otherwise `{ state:'unknown', reason:'timeout', checkedAt: last?.checkedAt ?? null }`.
  `blocked()` for `dispose` stays as is.
- Verified contracts: `claude-ambient-login-status.ts:110-270`.
- Dependencies: none new.
- Integration points: `provider:getAmbientClaudeStatus`, so the Providers accounts views see the
  same change. It is only visible when the earlier result was an `unknown` failure.
- Failure behaviour: unchanged otherwise.
- Verification seam: `claude-ambient-login-status.spec.ts`, with a case for an earlier
  `unknown/unreadable` plus an unclosed receipt -> `unknown/timeout`, and a case for an earlier
  `connected` plus an unclosed receipt -> `connected`. Existing cases stay green.
- Files: MODIFY `<wt>/libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`,
  `claude-ambient-login-status.spec.ts`.

### 8. Frontend core readiness sources (`@ptah-extension/core`)

- Purpose: the root owners of the two provider reads.
- Responsibilities:
  - `ClaudeAmbientStatusService.read(refresh, trigger?)` passes `trigger` to the RPC. The view
    gains `transportTimeout: boolean`, true when the failure is `RpcResult.error` starting with
    `'RPC timeout:'` (D-11). The `FAILED` view keeps `localFailure: true`, so existing consumers
    are unchanged.
  - New `CodexReadinessService` (root) is the same shape as `ClaudeAmbientStatusService`. It is
    inert unless `VSCodeService.isElectron`; its view is `{ status: 'inert'|'idle'|'checking'|'ready',
    result: AuthGetCodexReadinessResponse | null, localFailure, transportTimeout }`. `read(refresh, trigger)`
    applies only the latest reply. The boundary validates every field: `path`/`version` are
    strings, `verificationUrl` does not occur here, and enums are checked against the shared
    literals. The RPC timeout is 25 s (D-10).
  - New `codex-commands.ts` (data only, mirrors `claude-code-commands.ts`):
    `CODEX_INSTALL_COMMANDS` (tabs `npm`, `brew`), `CODEX_SETUP_DOCS_URL`,
    `CODEX_SIGN_IN_COMMAND = 'codex login'`, and
    `codexTerminalLoginCommand(binary: {path, source}, platform): string | null` (D-14). Values
    per A-4.
  - `AuthStateService.refreshAuthStatus(): Promise<boolean>` returns `this.fetchAndPopulateAuthStatus()`
    (D-13). `codexLogin()` is removed.
  - New `main-connection-target.ts`: `defaultMainConnectionTarget(state, chosen?)` is the popover
    rule from `:358-363`, moved verbatim. `mainConnectionTargetWritable(state, target)` is
    `writeScopes('authMethod').includes(target)` (`:341,382`). `sessionsEndedCopy(target)`
    returns "in this workspace" or "in every workspace".
  - `ProvidersConnectionSetupService`:
    - The hook type `refreshAuthStatus(): Promise<boolean>` (`:90`).
    - `activateConnection` returns `Promise<{ started: boolean; selectionReread: 'ok'|'failed'|'not-run' }>`.
      `started:false` keeps today's "another save" meaning. A blocked connection returns
      `started:true` with `'not-run'`; `saved` runs the reread and maps its boolean. The other
      `refreshAuthStatus` callers (`:418`, `:639`) ignore the boolean (AC 3.20).
    - The Codex branch of `externalAction` (`:276-279`) delegates `sign-in` to
      `CodexSignInService.start()` and `sign-in-cancel` to `.cancel()`. `externalAuth` shows
      `in-flight` while the sign-in runs and settles from the service's final state, followed by
      the existing `auth:getAuthStatus` reread (`:280-300`).
  - `ProvidersSettingsStateService.activateConnection` returns the same result type (`:558-569`).
  - New `codex-login.ts` (mirrors `kimi-code-login.ts`) provides `parseCodexLoginState` (https-only
    URL, enum checks, host `error` text dropped), `isFinalCodexLogin`, and `acceptsCodexLogin`
    (same `attemptId` required; final is sticky; rank order).
  - New `CodexSignInService` (root, `MessageHandler` for `AUTH_CODEX_LOGIN_STATUS`):
    - `state: Signal<CodexLoginState | null>`, `nothingSeen: Signal<boolean>`.
    - `start(mode = 'browser')` and `restart(mode)` call `auth:codexLogin { mode, restart }`
      with a 15 s RPC timeout (the RPC returns at launch). Response handling (R1-4):
      - a response `state` goes through `parseCodexLoginState` and `acceptsCodexLogin`, exactly
        like a push;
      - `success` is never read on its own;
      - a response with no `state` and `success:false` gives a local `failed`;
      - a `cancelled` state shows state 9 (information), never state 8.
    - `cancel()` calls `auth:codexLoginCancel`.
    - One 20 s timer runs while the status is `starting` or `running` with no URL or code. It
      sets `nothingSeen` (state 4b), and it is cleared on any accepted state change, on a final
      state and on `DestroyRef`.
    - On `succeeded` it calls `authState.refreshAuthStatus()`.
    - It never stores output; it is inert outside Electron.
  - Export every new symbol from `libs/frontend/core/src/index.ts`.
- Verified contracts: `claude-ambient-status.service.ts:10-125`; `claude-rpc.service.ts:150-190`;
  `auth-state.service.ts:662-664,1206-1210,1273-1317`; `providers-connection-setup.service.ts:80-91,139-160,240-360,636-680`;
  `providers-settings-state.service.ts:168-182,558-569,836-850,1012-1020`; `kimi-code-login.ts:1-80`;
  `claude-code-commands.ts`.
- Dependencies: core -> shared only (`type:core`, `scope:webview`).
- Integration points: onboarding (Components 9-12), chat (Component 14), app config (Component 15).
- Failure behaviour: no service throws. RPC failure gives `localFailure` (or `transportTimeout`).
  A sign-in start failure gives a local `failed` state with no `errorCode`, so the UI uses its
  generic copy. A cancel RPC failure keeps the state; the final push or a later start corrects it.
- Quality requirements: one timer total in `CodexSignInService`, with a release path; no polling.
- Verification seam:
  - `claude-ambient-status.service.spec.ts`: trigger forwarded; RPC timeout gives `transportTimeout`.
  - New `codex-readiness.service.spec.ts`: inert outside Electron; latest wins; malformed reply
    gives a local failure; timeout flag.
  - New `codex-login.spec.ts` and `codex-sign-in.service.spec.ts`: push ordering, stale
    `attemptId` dropped, sticky final, 20 s timer set and cleared (fake timers), cancel route,
    success rereads auth. Revision 1 (R1-4) cases:
    - a start response `{success:false, state:cancelled}` gives state 9 and no failure copy;
    - a push `cancelled` followed by a late start response `running` for the same attempt stays
      `cancelled`;
    - a start response `running` followed by a push `cancelled` ends `cancelled`;
    - a response with no `state` and `success:false` gives a local `failed`.
  - New `main-connection-target.spec.ts`: the rule cases from the popover.
  - `auth-state.service.spec.ts`: `refreshAuthStatus` resolves true, false, and the newer read's
    value when superseded (AC 3.18). The `codexLogin` case at `:938` is removed.
  - `providers-connection-setup.service.spec.ts`: the activate result per status; specs at
    `:124,184` keep `refreshAuthStatus` mocks resolving `undefined` except on the activate path
    (AC 3.20); Codex sign-in delegates.
  - `providers-settings-state.service.spec.ts`: the `codexLogin` usage is updated.
- Files: MODIFY `<wt>/libs/frontend/core/src/lib/services/claude-ambient-status.service.ts` (+spec),
  `auth-state.service.ts` (+spec), `providers-connection-setup.service.ts` (+spec),
  `providers-settings-state.service.ts` (+spec), `<wt>/libs/frontend/core/src/index.ts`;
  CREATE `<wt>/libs/frontend/core/src/lib/services/codex-readiness.service.ts` (+spec),
  `codex-sign-in.service.ts` (+spec), `codex-login.ts` (+spec), `codex-commands.ts`,
  `main-connection-target.ts` (+spec).

### 9. `ProviderReadinessStore` and derivation (onboarding, `ready/`)

- Purpose: the single provider-aware readiness for Home, stage 1, stage 2, the banner and the
  strip. It replaces `ClaudeReadinessStore`.
- Responsibilities:
  - Pure derivation (`provider-readiness.derive.ts`):
    - `deriveClaudeReadiness`: today's first-match order (`claude-readiness.store.ts:56-89`),
      kept, plus `slow`. An ambient `unknown/timeout`, or `transportTimeout`, during a mount or
      follow-up cycle that has not settled gives `slow`. The path and version of an installed
      row stay on every auth-only failure (design 5.3).
    - `deriveCodexReadiness`: the binary fact gives `missing` (or `unknown` for "Unknown/Not
      available"); the sign-in outcome gives `ready`, `signed-out`, `stale` or `error` (causes
      `timeout`, `unreadable`, `home`, `local`). `failedFact: 'binary'|'sign-in'`.
    - `deriveSelection(authState)`:
      - `loading` while `isLoading()` and not yet loaded;
      - `unreadable` when not loaded and not loading;
      - `claude-cli` for `claudeCli`;
      - `openai-codex` for `thirdParty` with `openai-codex`;
      - otherwise `{ kind:'other', name }`. The name comes from `availableProviders()` by id,
        falling back to the id; `apiKey` gives "Anthropic API key".
    - The store overrides this with `not-confirmed` (AC 3.19).
    - `deriveChosen(selection, claude, codex)` returns `ChosenConnectionView` for the banner and
      strip.
  - Shared view type (both providers):
    `ProviderReadinessView { provider: 'claude-cli'|'openai-codex'; state: 'checking'|'slow'|'ready'|'missing'|'signed-out'|'stale'|'error'; errorCause: 'timeout'|'unreadable'|'home'|'local'|null; failedFact; path; version; source: 'installed'|'bundled'|null }`.
  - Store (`provider-readiness.store.ts`, root):
    - `available` (Electron), `claude`, `codex`, `selection`, `chosen`, `rechecking`.
    - `refresh(kind: 'mount'|'recheck'): Promise<void>` starts one cycle per provider.
    - A mount cycle reads with `refresh:false` and `trigger:'mount'`. While the outcome is a
      timeout and fewer than 2 follow-ups have run, the store marks the provider `slow`, waits
      5 s (one timer per provider), and reads again with `refresh:true` and
      `trigger:'follow-up'`. After the last timeout the provider is terminal `error/timeout`
      (AC 5.1-5.3). A non-timeout result settles at once (AC 5.4).
    - A recheck cycle cancels the provider's pending follow-up timer and reads once with
      `refresh:true`, `trigger:'recheck'`; a timeout settles to `error/timeout` at once (AC 5.6).
    - A mount refresh while a cycle runs for that provider joins it (AC 5.9).
    - Claude reads both `redetectClis()` and the ambient read on the first read of a cycle;
      follow-ups re-run only the ambient read.
    - `recheckCodex()`: a Codex-only recheck cycle, used after sign-in success (design rule 3).
    - `retrySelection(): Promise<boolean>` calls `authState.refreshAuthStatus()` and clears
      `not-confirmed` on true (AC 3.19 retry, no write). `markSelectionNotConfirmed()` is used
      by Component 11.
    - A recheck also calls `retrySelection()` when the selection is `unreadable` or
      `not-confirmed`.
    - Timers are released on `DestroyRef`.
  - `announce` messages are left to the pages; the store exposes a `slowStarted` event signal
    (provider plus mount id) for the "taking longer" announcement (design 10).
- Verified contracts: `claude-readiness.store.ts:17-137`; `auth-state.service.ts:205-215,266,299,351`;
  `ProvidersSettingsStateService.cliDetection/redetectClis` (`:168-169,836-850`).
- Dependencies: onboarding -> core (allowed: `type:feature` -> `type:core`).
- Integration points: Components 10-13.
- Failure behaviour: never throws; each provider settles independently (AC 1.7); no state stays
  in `checking` or `slow` past about 90 s (D-10).
- Quality requirements: at most one timer per provider; no polling after a terminal state.
- Verification seam: `provider-readiness.derive.spec.ts`, which ports every
  `claude-readiness.store.spec.ts:61-170` case (parity rows 1-3) and adds Codex cases (AC 1.2-1.4,
  1.9, 1.11) and selection cases (AC 3.1-3.4, 3.15). `provider-readiness.store.spec.ts`, with
  fake timers, covers:
  - two timeouts, then connected -> ready (AC 5.5 lag simulation: the first read resolves after
    6 s with `unknown/timeout`);
  - three timeouts -> terminal, with no fourth read even after 120 s (AC 5.3);
  - follow-ups use `refresh:true`;
  - recheck timeout is terminal at once (AC 5.6);
  - repeated mounts start no extra probes (AC 5.9);
  - a Claude failure leaves Codex untouched (AC 1.7);
  - no call outside Electron (AC 6.2);
  - `rechecking` only on recheck (parity).
- Files: CREATE `<wt>/libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.ts` (+spec),
  `provider-readiness.store.ts` (+spec); DELETE `claude-readiness.store.ts`, `claude-readiness.store.spec.ts`.

### 10. Banner and strip (onboarding, `ready/`)

- Purpose: show the chosen connection only (AC 4.1-4.5).
- Responsibilities:
  - `ConnectionReadinessBannerComponent` (`ptah-connection-readiness-banner`) replaces
    `ClaudeReadinessBannerComponent`. Inputs: `chosen: ChosenConnectionView` and `placement`.
    It is shown only when the chosen provider is `missing`, `signed-out`, `stale` or terminal
    `error`. It is never shown for checking, slow, loading, unreadable, not-confirmed or other.
    Copy and actions follow design section 8, with today's Claude copy unchanged and the body
    without a dependency claim (D-7). The box uses the explicit `color-mix` classes of design
    section 3 in place of `border-state-need/70 bg-state-need/10`.
  - `ReadyStripComponent`: the input `claude` is replaced by `connection: ChosenConnectionView`.
    Item 1 label, icon, word and marker follow design section 9 ("Taking longer" uses the
    `checking` marker; other or not-confirmed use `idle`). Items 2 and 3 are unchanged.
- Verified contracts: `claude-readiness-banner.component.ts:30-131`; `ready-strip.component.ts:25-192`.
- Dependencies: Component 9 types.
- Integration points: Home, stage 1, stage 2.
- Failure behaviour: presentational only.
- Quality requirements: `role="status"` kept; status never relies on colour alone; AA contrast
  per design section 4.
- Verification seam: `connection-readiness-banner.component.spec.ts`, which ports today's it.each
  cases (`claude-readiness-banner.component.spec.ts:28-62`) and adds Codex chosen, Codex ready
  with Claude missing showing no banner (AC 4.1), Claude ready with Codex missing showing no
  banner (AC 4.2), and slow/loading/other showing no banner. `ready-strip.component.spec.ts`
  updates the item 1 cases (`:38`) for both providers, other, loading, not-confirmed and slow,
  with the provider not chosen never setting `need` (AC 4.4).
- Files: CREATE `<wt>/libs/frontend/onboarding/src/lib/ready/connection-readiness-banner.component.ts` (+spec);
  DELETE `claude-readiness-banner.component.ts` (+spec); MODIFY `ready-strip.component.ts` (+spec).

### 11. Connection choice (onboarding, `ready/`)

- Purpose: choose and save the main connection on stage 1 (AC 3.1-3.19).
- Responsibilities:
  - `ConnectionChoiceStore` (provided by the stage 1 page, not root) holds `pending`, `phase`
    and `notice`.
    - Choosing the other card calls `ProvidersSettingsStateService.open()` once (lazy; it loads
      the write targets and connections).
    - The target is `defaultMainConnectionTarget`. Confirm is unavailable while the target is
      `null`, `reviewContext()` is `null`, or the target is not writable (AC 3.8).
    - Confirm calls `activateConnection(id, target, context)` and then reads `commit()` (drawer
      ordering), with these outcomes:
      - `started:false` -> notice 8;
      - `blocked`, `failed` or `partial` -> notice 9 (AC 3.12);
      - `unconfirmed` -> `authState.refreshAuthStatus()` and notice 10 (AC 3.13);
      - `saved` with reread `ok` -> notice 6 or 7 (AC 3.10, 3.14);
      - `saved` with reread `failed` -> `readiness.markSelectionNotConfirmed()` and notice 11
        (AC 3.19).
    - A thrown write gives notice 9.
    - Nothing is written unless confirm is pressed (AC 3.6, 3.16).
  - `ConnectionChoiceComponent` (`ptah-connection-choice`): the radiogroup, confirm block and
    notices per design section 6. Focus rules per design section 10.
- Verified contracts: `providers-connection-setup.service.ts:648-680`; `drawer-write.ts:23-45`;
  `main-agent-reassign-popover.component.ts:345-384`; `providers-settings-state.service.ts:217-222,894`.
- Dependencies: core (Component 8), Component 9.
- Integration points: stage 1 page.
- Failure behaviour: every outcome leaves the stage usable; the persisted values are unchanged on
  any not-saved outcome (the host writes nothing).
- Quality requirements: keyboard radiogroup, selected state exposed natively, live region
  politeness per design section 10.
- Verification seam: `connection-choice.store.spec.ts` with a mocked `ClaudeRpcService` behind
  the real `ProvidersSettingsStateService` and `AuthStateService`:
  - AC 3.7: target `workspace` vs global, plus session copy;
  - AC 3.8: no target;
  - AC 3.9: `false`;
  - AC 3.12: persisted values unchanged after `failed`;
  - AC 3.13: `auth:saveSettings` rejects after the write;
  - AC 3.19: save ok, sections ok, `auth:getAuthStatus` fails; then a retry calls only
    `auth:getAuthStatus` and preselects the new value;
  - AC 3.10: after a save, the persisted signals and `ProvidersSettingsStateService` show
    `openai-codex`.
  - AC 3.11 renderer half (R1-6): the `auth:saveSettings` params sent by a stage 1 confirm equal
    the params the popover path sends for the same target. The host half is the new chat
    routing spec in Revision 1 R1-6 (steps 1-4; step 4 asserts the `AUTH_REQUIRED` refusal for a
    continued pre-switch conversation, decision row 37).
  `connection-choice.component.spec.ts` covers states 1-13 rendering and focus.
- Files: CREATE `<wt>/libs/frontend/onboarding/src/lib/ready/connection-choice.store.ts` (+spec),
  `connection-choice.component.ts` (+spec).

### 12. Stage 1 page, provider panel and stage 2 edits (onboarding, `ready/`)

- Purpose: the two-provider stage 1 and the stage 2 text changes.
- Responsibilities:
  - `ProviderPanelComponent` (`ptah-provider-panel`) takes the inputs `view`, `role:
    'main'|'information'|'neutral'` and `platform`. It renders the chip, the facts and the help
    blocks per design sections 5.1-5.4.
    - The Claude install, sign-in and error help blocks move verbatim from
      `ready-claude-step.page.ts:259-403`.
    - Codex install help is driven by `CODEX_INSTALL_COMMANDS` through
      `ptah-command-copy-row`, plus a PATH hint and a docs link.
    - The Codex sign-in help hosts `<ptah-codex-sign-in-block layout="panel">` (Component 14)
      with `terminalCommand` from `codexTerminalLoginCommand`. It is hidden for
      `unreadable/home` (D-15) and for any non-signed-out or non-stale state.
    - For an information-only role, help sits inside a closed `<details>`.
  - `ReadyConnectionStepPage` replaces `ReadyClaudeStepPage` (same route `''` under `ready`). It
    holds the title, lead, choice, two panels in fixed order, the footer with one primary per
    design section 7, and Re-check of both providers. Announcements are made per provider
    (Claude first). On mount it calls `store.refresh('mount')`. When the Codex sign-in state
    becomes `succeeded`, it calls `store.recheckCodex()` (state 6 to 7 or 7b). Continue writes
    `markReady('connectionAt')` (D-8); Continue anyway writes `skippedAt`. Focus moves to
    Continue when the chosen connection becomes ready after a Re-check or a sign-in.
  - `ReadySettingsStepPage`: the banner swaps to the new component, the strip input changes, and
    the lead becomes "Choose what Ptah can use besides <chosen name>." with a neutral form when
    nothing is chosen. The tabs and embedded pages are unchanged.
  - `onboarding.routes.ts`: the component reference is renamed.
  - `OnboardingFlagService`: `ready.connectionAt` is added to the schema and type, and
    `markReady` accepts it. `onboardingFirstRunGuard` honours `claudeAt || connectionAt || skippedAt`.
- Verified contracts: `ready-claude-step.page.ts:46-581`; `ready-settings-step.page.ts:29-32,76,83-119,268`;
  `onboarding.routes.ts:38-49`; `onboarding-flag.service.ts:17-41`; `onboarding-first-run.guard.ts:22-37`.
- Dependencies: core, chat (block component; onboarding already imports `@ptah-extension/chat`,
  e.g. `proposal/new-project-intake.page.ts:11`), Components 9-11.
- Integration points: router, announcer, flag service.
- Failure behaviour: every surface shows a state word; no spinner beyond about 90 s.
- Quality requirements: 400 px layout, reduced motion, AA contrast; the panels are not live
  regions.
- Verification seam:
  - `ready-connection-step.page.spec.ts` ports every `ready-claude-step.page.spec.ts` case named
    in parity rows 20-38, and adds:
    - two panels and facts (AC 1.1);
    - bundled Codex with no install help (AC 1.2);
    - Codex install rows and docs link (AC 2.1);
    - sign-in button plus manual row, both installed and bundled (AC 2.2);
    - sign-in failed or cancelled keeps not-signed-in and Re-check (AC 2.3);
    - ready provider shows no help (AC 2.4);
    - information-only styling (AC 4.5);
    - Re-check announcements per provider;
    - Continue writes `connectionAt`.
  - `provider-panel.component.spec.ts` covers each design 5.3 row.
  - `ready-settings-step.page.spec.ts` updates the lead and banner cases (`:287`).
  - `onboarding-first-run.guard.spec.ts` adds `connectionAt` and keeps `claudeAt` (AC 4.6).
  - `onboarding-flag.service.spec.ts` covers an old record staying valid.
  - `onboarding-ready-host.guard.spec.ts` stays unchanged (AC 6.2).
- Files: CREATE `<wt>/libs/frontend/onboarding/src/lib/ready/provider-panel.component.ts` (+spec),
  `ready-connection-step.page.ts` (+spec); DELETE `ready-claude-step.page.ts` (+spec); MODIFY
  `ready-settings-step.page.ts` (+spec), `<wt>/libs/frontend/onboarding/src/lib/onboarding.routes.ts`
  (+`onboarding.routes.spec.ts` if it names the class), `first-run/onboarding-flag.service.ts` (+spec),
  `first-run/onboarding-first-run.guard.ts` (+spec).

### 13. Home edits (onboarding, `home/onboarding-home.component.ts`) - coordinated file

- Purpose: switch Home's readiness wiring with the smallest diff (design section 13). This file
  is also edited by TASK_2026_863_3855.
- Exact regions touched. Nothing else changes: no wrapper, spacing, order, h1, lead, workspace
  header, analysis card, resume banners, tiles, no-workspace block or Skip.
  1. Imports `:28-29` -> `ConnectionReadinessBannerComponent` and `ProviderReadinessStore`
     (`:30-31` unchanged).
  2. `imports` array entry `:67` -> `ConnectionReadinessBannerComponent`.
  3. Strip `:77-82`: only `[claude]="readiness().state"` (`:80`) becomes `[connection]="chosen()"`.
  4. Banner `:112-116`: the tag name becomes `ptah-connection-readiness-banner`, and
     `[state]="readiness().state"` becomes `[chosen]="chosen()"`. `class="mt-5"`,
     `placement="home"` and the position are kept.
  5. Footer link text `:306` becomes `Review your connection and settings`; `routerLink` and
     `data-testid` are unchanged.
  6. Field `:326` type becomes `ProviderReadinessStore`; `:333` becomes
     `protected readonly chosen = this.readinessStore.chosen;`.
  7. Constructor `:419-421`: the comment is updated and the call becomes
     `this.readinessStore.refresh('mount')`.
- Verification seam: `onboarding-home.component.spec.ts`, with these cases:
  - the strip before the h1 and readiness read on mount (renamed store);
  - banner before resume banners;
  - banner clears without a flag write once a reread returns ready;
  - a new timeout case: one mount timeout shows no banner and the strip says "Taking longer"
    (AC 5.1);
  - footer link text;
  - VS Code renders nothing and reads nothing (AC 6.2).
- Files: MODIFY `<wt>/libs/frontend/onboarding/src/lib/home/onboarding-home.component.ts`,
  `onboarding-home.component.spec.ts` (only the cases above).

### 14. Shared Codex sign-in block and its two other callers (`@ptah-extension/chat`)

- Purpose: one presentation of the in-app Codex sign-in for stage 1, Providers and chat
  (design 5.5).
- Responsibilities:
  - `CodexSignInBlockComponent` (`ptah-codex-sign-in-block`) injects `CodexSignInService`. Its
    inputs are:
    - `role: 'chosen'|'information'`;
    - `layout: 'panel'|'compact'`;
    - `terminalCommand: string|null`, plus a bundled note flag (panel only);
    - `executablePath: string|null` (failure copy only).
  - It renders design states 1, 1b, 2, 3, 4, 4b, 5, 6, 8, 9 and 10. States 7 and 7b are owned by
    the page, which knows the readiness. `compact` drops the hint, the terminal row and the
    footer line. The actions are Sign in, Cancel sign-in, Try again (`restart`), Use a device
    code (`restart('device')`), Open sign-in page (`<a target="_blank">`, https only, A-2),
    Copy link and Copy code.
  - A browser claim is shown only when `browserOpened === true` (success sentence) or `false`
    (failure sentence) (rule 6).
  - Exported from `libs/frontend/chat/src/index.ts`.
  - `credentials-tab.component.ts` Codex case (`:180-192`): render
    `<ptah-codex-sign-in-block layout="compact" role="chosen">`. The existing "Open login" button
    emits `sign-in` and becomes "Sign in with Codex", and `sign-in-cancel` is offered while the
    sign-in runs (the Kimi pattern `:203-212`).
  - `main-agent-reassign-popover.component.ts`: `target` uses `defaultMainConnectionTarget`. The
    `activateConnection` call becomes `.then((r) => r.started)` inside `runDrawerWrite`
    (`:625`). The visible behaviour is unchanged (AC 3.20).
  - `chat-view.component.ts:343-347`: for `openai-codex`, call `codexSignIn.start()` and render
    the compact block inside the existing auth-required banner. On `succeeded`, call
    `authState.refreshAuthStatus()` then `clearAuthRequiredBanner()`.
- Verified contracts: `credentials-tab.component.ts:180-212,399-487`; `main-agent-reassign-popover.component.ts:345-384,615-645`;
  `chat-view.component.ts:336-352`; `kimi-code-login-progress.component.ts:36-80`.
- Dependencies: chat -> core (existing).
- Integration points: onboarding (Component 12), Providers drawer, chat view.
- Failure behaviour: every final state has its copy and a recovery action; cancel is information
  styled.
- Quality requirements: `role="alert"` only for chosen failures; the device code is spelled for
  screen readers; reduced motion is honoured.
- Verification seam:
  - new `codex-sign-in-block.component.spec.ts`, one case per state and per role, with no
    browser claim in state 4 and the 4b actions calling `restart`;
  - `credentials-tab.component.spec.ts` (Codex case);
  - `main-agent-reassign-popover.component.spec.ts` (target cases unchanged);
  - `chat-view.component.spec.ts` (the re-auth case now starts the in-app sign-in, replacing the
    `codexLogin` expectation).
- Files: CREATE `<wt>/libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.ts` (+spec);
  MODIFY `<wt>/libs/frontend/chat/src/index.ts`, `credentials-tab.component.ts` (+spec),
  `<wt>/libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts` (+spec),
  `<wt>/libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (+spec).

### 15. Renderer wiring and visual fixtures

- Purpose: register the push handler and keep the Electron visual scenarios current.
- Responsibilities:
  - `app.config.ts`: add `{ provide: MESSAGE_HANDLERS, useExisting: CodexSignInService, multi: true }`
    beside `:473-479`.
  - `onboarding-ready.fixtures.ts`: fixtures for `auth:getCodexReadiness`, the persisted
    selection in `auth:getAuthStatus`, and Codex sign-in pushes.
  - `onboarding-ready-visual.e2e.spec.ts:225-502`: update the scenarios and add Codex chosen,
    bundled, signed out, slow and sign-in states. These run in Electron by the visual reviewer
    only.
  - Electron manual check (Revision 1, A-1/A-7). This is the only place a real login runs, and a
    human starts it. On Linux, one click on Sign in opens exactly one browser tab, through Ptah,
    and the block shows "Ptah opened the sign-in page in your browser." Cancel closes the
    attempt (state 9). Quitting the app during a sign-in leaves no `codex login` process (check
    with `pgrep -f "codex login"`). Lanes never run this check.
- Verified contracts: `app.config.ts:473-479`; `onboarding-ready.fixtures.ts:7,80`.
- Files: MODIFY `<wt>/apps/ptah-extension-webview/src/app/app.config.ts` (and
  `review-shell-message-handlers.spec.ts` only if it enumerates handlers),
  `<wt>/libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-ready.fixtures.ts`,
  `onboarding-ready-visual.e2e.spec.ts`.

## Integration architecture

- Data flow, readiness:
  1. Home, stage 1 or stage 2 mount calls `ProviderReadinessStore.refresh('mount')`.
  2. Claude: `agent:detectClis` (unchanged) and `provider:getAmbientClaudeStatus {refresh, trigger}`.
  3. Codex: `auth:getCodexReadiness {refresh, trigger}`, which runs `CodexReadinessReader`
     (selection snapshot plus `getSignInOutcome`).
  4. Selection: `AuthStateService` persisted pair, loaded by the app as today.
  5. Pure derivation feeds `chosen`, then the banner, the strip and the panels.
- Data flow, sign-in:
  1. The block calls `CodexSignInService.start(mode)`, which sends `auth:codexLogin {mode, restart}`.
  2. The handler calls `CodexLoginService.start`, which selects the executable and spawns
     `<path> login [--device-auth]` with `BROWSER` set to a no-op where the CLI honours it. It
     parses the first valid https URL and opens it once with `openExternal`, in either mode
     (R1-1 to R1-3).
  3. The `onState` broadcast sends `auth:codexLoginStatus` to the service through
     `MESSAGE_HANDLERS`.
  4. A final `succeeded` triggers host clearCache, reset and invalidate. The webview rereads
     `auth:getAuthStatus`, and the page calls `recheckCodex()`.
  5. Cancel goes through `auth:codexLoginCancel`, which kills the tree and pushes `cancelled`.
- Data flow, save: stage 1 confirm calls `activateConnection` (the existing commit pipeline and
  `auth:saveSettings`), then reads `commit()`, then rereads the selection, then shows the notice
  and updates the store.
- State or persistence: the host owns one login child and the readiness cache (60 s, non-timeout
  only). The webview owns the readiness views, the sign-in state (root), the choice phase
  (page-scoped) and `localStorage` `ready.connectionAt`. No new persisted host setting.
- External boundaries:
  - The RPC params of `auth:codexLogin` and `auth:getCodexReadiness` are validated in the
    handler, and the ambient `trigger` by zod.
  - Pushes and replies are validated in the webview (`parseCodexLoginState` and the readiness
    boundary check).
  - Only `https:` URLs are opened or linked, and the scheme is re-checked right before
    `openExternal`.
  - argv is an array; there is no shell.
  - No token, auth file content, environment value or CLI output line reaches a payload or a log.
- Failure and rollback:

  | Case | Host result | UI |
  | --- | --- | --- |
  | Selection unavailable | `failed/unavailable` | Install state (button hidden) or state 8 |
  | Spawn error or null pid | `failed/spawn-failed` | State 8 "Ptah could not start Codex at <path>." with Try again; no binary switch |
  | No URL or code seen | stays `running` | State 4b after 20 s (Try again, Use a device code, Cancel) |
  | Invalid or non-https URL | ignored, stays `running` | Same as above |
  | `openExternal` false or throws (either mode) | `browserOpened:false`, still `awaiting-user` | "Ptah could not open your browser..." plus Open link and Copy link |
  | Cancel (including during start) | `cancelled` after tree kill; start response `success:false`, no `error` | State 9 |
  | App quit during a sign-in | `dispose()`: one tree kill, one final `cancelled`; quit deferred at most 2 s for it | Window closes |
  | 10 min timeout | `failed/timeout` | State 10 |
  | Non-zero exit | `failed/exited` + `exitCode` | State 8 with the exit code |
  | Exit 0 without a sign-in | `failed/no-credentials` | State 8 |
  | Readiness recheck after success fails | not applicable | State 7b with Re-check |
  | Readiness probe timeout | `timeout` outcome | Slow, then follow-ups, then terminal (AC 5.1-5.3) |
  | Local failure | per fact | "Could not check" for that provider only |

  A save failure writes nothing more, and the reread shows the persisted truth (AC 3.12, 3.13).
- Observability: host log lines `[readiness] claude|codex {outcome, reason, trigger}` (AC 5.8).
  The sign-in logs phase, error code and exit code. The existing Codex executable selection log
  is in `codex-runtime-composition.ts:150-160`.

## Architecture-level quality requirements

- Functional: every AC in task-description.md sections 1-6 maps to a test in the components
  above. The parity rows map as follows:
  - store rows -> Component 9;
  - banner and strip rows -> Component 10;
  - stage 1 rows -> Component 12;
  - Home rows -> Component 13;
  - guard and flag rows -> Component 12;
  - visual row -> Component 15.
- Performance: one probe set per provider at a time; at most 2 follow-ups per mount read; no
  timers after a terminal state; one sign-in timer; the 8 KiB line cap in the login parser.
- Security: as in External boundaries; `ICodexAuthService.getSignInOutcome` returns an enum only.
- Maintainability:
  - no new `vscode-core` import in host-neutral code beyond the `Logger` type the Kimi service
    already uses;
  - no change to `IPlatformCommands`, `IAuthCommandRunner`, `CliDetectionResult`,
    `CodexAppServerLaneAdapter.detect`, `probeCodex` or `getTokenStatus`;
  - depConstraints respected: auth-providers stays extension/feature, core stays core, and
    onboarding imports chat as it does today.
- Testability: behaviour coverage as listed per component. AC 3.11 is covered by two specs
  (Revision 1, R1-6):
  - a host spec in `@ptah-extension/rpc-handlers`,
    `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.connection-switch.spec.ts`.
    It starts a chat, switches through the real `auth:saveSettings` handler, sends the next
    message and asserts which runtime and provider served it (steps 1-3). Step 4 continues the
    pre-switch conversation and asserts `AUTH_REQUIRED` naming the stored provider, with
    `resumeSession` not called (decision rows 37-38). The carry-over is a separate task;
  - the renderer params-equality case in Component 11.
  An Electron visual check is extra evidence, not the proof.

## Team-leader handoff

- Recommended executors:
  - Components 1-7: backend-developer (host services, RPC, DI, process lifecycle).
  - Components 8-14: frontend-developer (Angular signals, components, focus and live regions).
  - Component 15 fixtures: senior-tester, then visual-reviewer in Electron.
- Complexity: HIGH. The work crosses shared, three backend libs, the Electron composition root,
  three frontend libs and the renderer app. It adds a new child-process lifecycle and a save
  flow with five outcomes.
- Dependencies and ordering (component level only):
  - Component 1 before everything else.
  - Component 2 before 4.
  - Components 3 and 4 before 5.
  - Component 5 before 6.
  - Component 8 before 9-14.
  - Component 9 before 10-13.
  - Component 14's block before 12's Codex sign-in help.
  - Component 13 last, rebased on TASK_2026_863_3855.
  - Component 7 is independent.
- Parallel-safe work (file-disjoint), suggested batches:
  - A, backend-developer: Component 1 (shared types).
  - B, backend-developer: Components 2, 3, 4 and 7 (auth-providers files only, including the
    `cli-login-output.ts` move and the Kimi import edit).
  - C, backend-developer: Components 5 and 6 (auth-providers-tokens, rpc-handlers auth handlers,
    Electron app including `activation/shutdown.ts` (+spec), `main.ts` and
    `main.quit-path.spec.ts`). Depends on A and B.
  - D, frontend-developer: Component 8 (core). Depends on A.
  - E, frontend-developer: Component 14 (chat) plus the `app.config.ts` part of Component 15.
    Depends on D.
  - F, frontend-developer: Components 9, 10, 11 and 12 (onboarding `ready/`, `first-run/`,
    routes). Depends on D and E.
  - G, frontend-developer: Component 13 (Home only). Depends on F; coordinate with
    TASK_2026_863_3855.
  - H, senior-tester: Component 15 fixtures and visual spec, plus the Revision 1 AC tests:
    - the AC 3.11 host spec `chat-session.connection-switch.spec.ts` (rpc-handlers
      `chat/session/`; no file overlaps batch C, which edits only `handlers/`);
    - the AC 1.9 lane cases in `codex-app-server-lane.adapter.spec.ts` (cli-agent-runtime) and
      `codex-lane-runtime-composition.spec.ts` (cli-engine).
    These three spec files test existing host behaviour, so H may start them as soon as A
    lands. The fixtures part still depends on F and G.
  - B and D can run in parallel once A lands; C and E can run in parallel.
- Files affected:
  - CREATE:
    - `libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.ts` (+spec)
    - `libs/backend/auth-providers/src/lib/providers/codex/codex-readiness.reader.ts` (+spec)
    - `libs/backend/auth-providers/src/lib/providers/cli-login-output.ts` (+spec)
    - `libs/backend/rpc-handlers/src/lib/handlers/auth/codex-readiness-method.ts` (+spec)
    - `apps/ptah-electron/src/di/codex-login-composition.ts` (+spec)
    - `libs/frontend/core/src/lib/services/codex-readiness.service.ts` (+spec)
    - `libs/frontend/core/src/lib/services/codex-sign-in.service.ts` (+spec)
    - `libs/frontend/core/src/lib/services/codex-login.ts` (+spec)
    - `libs/frontend/core/src/lib/services/codex-commands.ts`
    - `libs/frontend/core/src/lib/services/main-connection-target.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/provider-readiness.derive.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/provider-readiness.store.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/connection-readiness-banner.component.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/connection-choice.store.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/connection-choice.component.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/provider-panel.component.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/ready-connection-step.page.ts` (+spec)
    - `libs/frontend/chat/src/lib/settings/providers/connection-drawer/codex-sign-in-block.component.ts` (+spec)
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.connection-switch.spec.ts` (R1-6)
  - MODIFY:
    - shared: the five type files listed in Component 1;
    - `libs/backend/auth-providers-tokens/src/lib/tokens.ts`;
    - auth-providers: `codex-home-auth.service.ts` (+spec), `codex-auth.service.ts`,
      `codex-provider.types.ts`, `codex/index.ts`, `src/index.ts`,
      `kimi-code/kimi-code-login.service.ts` (+spec, import path only), `accounts/claude-ambient-login-status.ts` (+spec);
    - rpc-handlers: `auth-rpc.handlers.ts` (+spec), `auth/interactive-login-methods.ts`,
      `provider-account-rpc.schema.ts`, `provider-account-rpc.handlers.ts` (+spec), test-utils
      fakes;
    - Electron: `phase-2-libraries.ts`, `expected-resolvable.ts`,
      `replay/scenario-sanitizer.ts`, `activation/shutdown.ts` (+spec), `main.ts` (one line),
      `main.quit-path.spec.ts`;
    - lane tests (R1-7, specs only):
      `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts`,
      `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts`;
    - core: `claude-ambient-status.service.ts` (+spec), `auth-state.service.ts` (+spec),
      `providers-connection-setup.service.ts` (+spec), `providers-settings-state.service.ts`
      (+spec), `index.ts`;
    - chat: `index.ts`, `credentials-tab.component.ts` (+spec),
      `main-agent-reassign-popover.component.ts` (+spec), `chat-view.component.ts` (+spec);
    - onboarding: `ready-strip.component.ts` (+spec), `ready-settings-step.page.ts` (+spec),
      `onboarding.routes.ts`, `first-run/onboarding-flag.service.ts` (+spec),
      `first-run/onboarding-first-run.guard.ts` (+spec), `home/onboarding-home.component.ts`
      (+spec, regions in Component 13);
    - webview app: `app.config.ts`;
    - e2e harness: `onboarding-ready.fixtures.ts`, `onboarding-ready-visual.e2e.spec.ts`.
  - DELETE (replaced in place):
    - `libs/frontend/onboarding/src/lib/ready/claude-readiness.store.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/claude-readiness-banner.component.ts` (+spec)
    - `libs/frontend/onboarding/src/lib/ready/ready-claude-step.page.ts` (+spec)
- Provider CLI lanes, `platform-cli` and `cli-engine` impact:
  - `CliPlatformCommands.runAuthCommand`, `IAuthCommandRunner` and the `auth:codexLogin` runner
    branch are unchanged.
  - `AuthRpcHandlers` in the CLI container gets the two optional tokens as absent. The CLI then
    also registers `auth:codexLoginCancel` (returns `{cancelled:false}`) and
    `auth:getCodexReadiness` (absent-reader answer).
  - `CodexAppServerLaneAdapter.detect` and `agent:detectClis` are untouched (AC 1.8).
  - `platform-cli` has no change.
  - Proof: the existing cli-engine, cli-agent-runtime and platform-cli tests pass unchanged.
    The only additions are the two AC 1.9 empty-home cases (R1-7), which pin today's
    behaviour.
- Verification points:
  - Confirm the assumptions before or during the batches that depend on them: A-1 parser fixtures
    in B, A-3 in F, A-4 in D, A-7 in the Electron manual check, A-8, A-9 and A-10 in H. A-6 is
    resolved.
    No lane runs `codex login` (interactive or not) to learn output; `codex login --help` is the
    only permitted invocation.
  - Honour AC 1.8, 1.13 and 3.20: those existing specs must pass without edits, except where
    listed.
  - Keep di-lint clean: every new `@inject` token is registered in
    `codex-login-composition.ts`.
  - Commands (from the worktree; each lane repeats the CLAUDE.md memory rules):
    - per batch: `npm run verify -- -p <projects of that batch>`. Revision 1 makes two of them
      explicit:
      - C: `npm run verify -- -p @ptah-extension/auth-providers-tokens,@ptah-extension/rpc-handlers,ptah-electron`;
      - H (AC tests):
        `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/cli-agent-runtime,@ptah-extension/cli-engine`;
    - final:
      `npm run verify -- -p @ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/auth-providers-tokens,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/cli-agent-runtime,@ptah-extension/platform-cli,@ptah-extension/core,@ptah-extension/chat,@ptah-extension/onboarding,@ptah-extension/webview-e2e-harness,ptah-electron,ptah-extension-webview`.
  - The `onboarding-ready-visual` e2e scenarios and the visual review run in Electron only, by
    the visual-reviewer. No build, serve or e2e target is run by implementation lanes.

## Revision 1

Gate 2 initial review (`implementation-plan-review.md`, REVISE) listed six findings. Each one is
fixed in place in the sections above. This section records the resolutions, the new decisions,
the two new specs in full, and the re-checks. It does not change anything above it.

### Finding resolutions

| # | Finding | Resolution | Where it is fixed above |
| --- | --- | --- | --- |
| 1 | Blocking: the default flow never opens a validated URL through `shell.openExternal` | In both modes the host parses the first valid https URL from the CLI output and opens it once with `IUserInteraction.openExternal`. It reports `browserOpened` as true or false and handles a throw. `BROWSER` is set to a no-op where the CLI honours it, so the CLI does not open a second tab. Default stays plain `codex login`, because device login is an opt-in ChatGPT setting. Design rows 8-10 are kept. | D-5 (superseded); Component 1 `browserOpened`; Component 3 output, suppression and tests; Data flow sign-in 2; failure table |
| 2 | Serious: a cancel can come back as success | `success` is true only for a live attempt or `succeeded`. `cancelled` gives `success:false` with no `error`. `start` resolves with the current state. The renderer drives the UI from `state` only. Race tests are added. | Component 1 response type; Component 3 `start`; Component 5 response mapping and tests; Component 8 response handling and tests |
| 3 | Serious: quit cleanup is left conditional | The real hook is named: `main.ts:457-498` calls `handleWillQuit` (`shutdown.ts:609`). It gets a required `codexSignIn` handle. An active sign-in defers the quit. The stop runs at the kill position of `disposeBeforePersistence` and is awaited under a 2 s budget. `dispose()` settles exactly one `cancelled`. A-6 is removed. | Component 3 lifecycle; Component 6 quit cleanup and tests; failure table; batch C |
| 4 | Serious: AC 3.11 has no test | New host spec in `@ptah-extension/rpc-handlers`: chat started, switched through the real `auth:saveSettings`, next message sent, serving runtime and provider asserted (R1-6). There is also a renderer params-equality case. | Testability; Component 11 seam; batch H; Files |
| 5 | Moderate: no test for AC 1.9's lane half | New empty-home cases in `cli-agent-runtime` and `cli-engine` specs, both in the H verify (R1-7). | Component 4 seam; batch H; Files; lane proof |
| 6 | Moderate: interactive logins used to learn CLI output | A-1 is now based on `codex login --help` and strings from the bundled binary. Parser tests use fake-spawner transcripts. Real browser behaviour is checked only in the Electron manual check. No lane runs a login. | A-1; Component 3 seam; Component 15; Verification points |

### Decisions

| # | Decision | Options | Evidence | Reversible | Tag |
| --- | --- | --- | --- | --- | --- |
| R1-1 | Default sign-in stays `<selected> login` (browser mode). In BOTH modes the host opens the first URL that passes validation, once per attempt, through `IUserInteraction.openExternal` (Electron `shell.openExternal`). `true` or `false` sets `browserOpened`. A throw sets `false`. The attempt keeps running in every case | Device-auth as default; no Ptah open in browser mode (rejected at Gate 2) | design-spec.md:193-196 (open the first https URL with `shell.openExternal`); decisions.md row 26; `user-interaction.interface.ts:73-77`; Electron adapter calls `shell.openExternal` (`electron-user-interaction.ts:88-91`). Device code login is beta and must be turned on in ChatGPT security settings or by a workspace admin (OpenAI Codex auth docs), so a device default would fail for users who have not turned it on | Yes | user-requested (design contract, row 26) |
| R1-2 | Duplicate-tab prevention: on platforms other than `darwin` and `win32`, the login child env sets `BROWSER` to the first existing of `/usr/bin/true` and `/bin/true`. On macOS and Windows nothing can suppress the CLI's own open, so a second tab with the same URL is possible there. The user accepted this (User answers, Q1) | A CLI flag (none exists); device default; skip Ptah's open on macOS/Windows | `codex login --help` (0.164.0) lists only `-c`, `--with-api-key`, `--enable`, `--with-access-token`, `--disable`, `--device-auth`. The bundled 0.165.0 binary links `webbrowser-1.2.4`. That crate tries `$BROWSER` first on Linux/BSD, runs it without a shell, and stops when it succeeds; macOS and Windows ignore it (crate docs) | Yes | lane-proposed |
| R1-3 | URL validation `validateSignInUrl`: parses with `URL`, `https:` only, no username or password, at most 4096 characters. Checked when parsed and again right before `openExternal`. Invalid candidates are dropped and parsing continues | Host allowlist (`auth.openai.com`) | design-spec.md:194 says "https only". A host allowlist would break `-c` issuer overrides and gains nothing over the fixed argv of a selected binary | Yes | lane-proposed |
| R1-4 | `auth:codexLogin` success is `true` only for `starting`, `running`, `awaiting-user` or `succeeded`. `failed` gives `false` plus fixed `error`. `cancelled` gives `false` with no `error`. `start` resolves with the state current at resolve time. The renderer reads `state` only | A new discriminant field | Kimi response shape `rpc-auth.types.ts:168-185`; review finding 2; decision 7 requires cancel to be distinct | Yes | lane-proposed |
| R1-5 | Quit cleanup goes through a required `QuitSequenceDeps.codexSignIn` `{isActive, stop}`. Its source is a module-scoped instance holder in `codex-login-composition.ts`. An active sign-in defers the quit. `stop()` starts beside `killRunningChecks()` and is awaited under `CODEX_SIGN_IN_STOP_BUDGET_MS = 2000` | A disposer registry (none exists); resolve from the container at quit (would construct the service) | `main.ts:457-498`; `shutdown.ts:143-196,233-266,498-507,518-557,609-660`; the binding-registry precedent `di/codex-binding-registry.ts:5-24` | Yes | project-rule (the LIFO quit contract in `shutdown.ts`) |
| R1-6 | AC 3.11 is proved by a host spec at the chat-session boundary. That boundary routes by prepared runtime (`routing-agent-adapter.ts:96-123`). "Next main-agent message" is a message that starts a chat after the save: it runs on `codex-app-server` / `openai-codex`. A message that continues the pre-switch Claude conversation must never be served by the old connection. Step 4 asserts `AUTH_REQUIRED` naming the stored provider and that `resumeSession` is not called (decision rows 37-38). The compaction carry-over is a separate task (`feat/provider-switch-carryover`). Superseded text: an earlier version held step 4 for the carry-over (User answers, Q2) | Manual-only proof (rejected at Gate 2); migrate old conversations across runtimes (no migration exists: `routing-agent-adapter.spec.ts:161`) | task-description.md:318-321 ("as for a Providers page save"); `chat-session.native.spec.ts:576-627` (stored Claude session refused after a switch to Codex); `connection-settings-methods.ts:83-154` (save resets the adapter) | Yes | user-requested (AC 3.11) |
| R1-7 | AC 1.9 lane half: new empty-home cases in `codex-app-server-lane.adapter.spec.ts` (cli-agent-runtime) and `codex-lane-runtime-composition.spec.ts` (cli-engine). They pin `installed:false` while a binary resolves | Rely on existing specs (none cover it) | `codex-app-server-lane.adapter.ts:156-175`; `codex-lane-runtime-composition.ts:119-123`; parity-inventory.md:70 | Yes | user-requested (AC 1.9) |
| R1-8 | No lane starts `codex login` to learn output. Parser fixtures are synthetic transcripts built from the binary's own strings. Real browser behaviour is checked only by a human in the Electron manual check | Record real login output | Review finding 6; the output can contain session data and changes with CLI version | Yes | project-rule (security NFR) |

### New spec: AC 3.11 (R1-6)

- File: CREATE
  `<wt>/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.connection-switch.spec.ts`,
  project `@ptah-extension/rpc-handlers`. It has its own small harness. The harness in
  `chat-session.native.spec.ts` is local to that file, and this is only its second use, so it
  is not extracted.
- Wiring (all in-process, no SDK, no Codex process):
  - An in-memory auth store `{ authMethod, anthropicProviderId }` that starts on `claudeCli`.
  - A real `ConnectionSettingsMethods` (`connection-settings-methods.ts:27-42`) with a fake
    `rpcHandler` that captures `auth:saveSettings` (`:83-154`). Its write fakes update the
    store (A-8). The `sdkAdapter` fake records `reset()`, and its `applyWorkspaceAuthChange(path,
    write)` awaits `write()`.
  - A real `ChatRuntimeProfileService` (`chat-runtime-profile.service.ts:89`), built as in
    `chat-session.native.spec.ts:593-599` with `{ nativeCodex: true }`. Its
    `WorkspaceProviderProfileResolver` stub (pattern `:582-591`) answers
    `resolveActiveAuthForPath` and `resolveActiveAuthWithDefault` from the store.
  - The chat session service under test with a fake adapter `startChatSession` and
    `resumeSession` (pattern `:414-446`).
- Sequence and assertions:
  1. Start a chat on `tab` (`launchSdkSession`, `logLabel:'chat:start'`).
     `startChatSession` gets a non-native runtime (`claude-sdk`).
  2. Switch as stage 1 does: call the captured `auth:saveSettings` with `{ authMethod:'thirdParty',
     anthropicProviderId:'openai-codex', applyTo }`, using `it.each` over `'global'` (expect
     `reset` once) and `'workspace'` (expect `applyWorkspaceAuthChange` with the workspace path).
     The store now holds `openai-codex`.
  3. Send the next message as a new chat on `tab`. `startChatSession` is called with
     `runtime:'codex-app-server'` and provider `openai-codex`, and the `claude-sdk` start count
     stays 1.
  4. Continue the pre-switch session (`autoResumeIfInactive`, pattern `:611-618`). The result is
     `AUTH_REQUIRED` naming the stored provider, and `resumeSession` is not called (Claude never
     serves it). Decision row 37: the carry-over runs as a separate task (branch
     `feat/provider-switch-carryover`) that keeps this refusal as its banner trigger, so this
     assertion stays valid after that task lands.
- A-10 (check): listed under the Architecture decision assumptions.

### New spec cases: AC 1.9 lane half (R1-7)

- `codex-app-server-lane.adapter.spec.ts` (`@ptah-extension/cli-agent-runtime`), next to the
  detect cases at `:850-882`. In "explicitly empty Codex home reports not installed even though a
  binary resolves", `binary.resolve` returns a binary and the `home` dependency rejects with
  `Error('Codex home is empty')`. The test asserts:
  - `detect()` resolves to exactly `{ cli:'codex', installed:false, messagingMode }`, with no
    `path`, `version` or `codexSource`;
  - `logger.warn` is called with "Codex home is empty";
  - `runtime.open` is not called.
- `codex-lane-runtime-composition.spec.ts` (`@ptah-extension/cli-engine`), next to `:8-23`. It
  uses `it.each` over `{ CODEX_HOME:'' }` and `{ HOME:'' }` (with no `CODEX_HOME` or
  `USERPROFILE`). `registerCliCodexLaneFactory(container, logger, { env, platform })` with a fake
  resolvable binary gives a lane whose `detect()` returns `installed:false` (A-9 has the
  fallback). A non-empty `HOME` with the same binary still gives `installed:true`.
- The existing cases are not edited.

### User answers

The two Revision 1 questions went to the user. Answers, recorded as given:

1. Q1 (macOS and Windows duplicate tab): option (a). Keep Ptah's `shell.openExternal` on every
   platform and accept that a second identical tab may appear on macOS and Windows. Sign-in
   works from either tab. No change to the plan's build: R1-1 and R1-2 stand as written, and the
   Electron manual check records a second tab on macOS or Windows as expected, not as a defect.
2. Q2 (AC 3.11, continuing a pre-switch Claude conversation after a switch to Codex): the user
   rejected both (a) refuse with `AUTH_REQUIRED` and (b) a silent fresh conversation. The
   user's words: "doing a compaction with the new provider always worked for me". The required
   behaviour is that continuing a pre-switch conversation carries it over to the new provider by
   compaction: a summary of the old conversation becomes the start of the new-provider
   conversation. It is not refused, and Claude never serves it. The search for an existing path
   found none that works today (scope note below), so this half of AC 3.11 is not designed here.

   **Superseded by decision rows 37-38 (kept as history).** The user later moved the carry-over
   to its own task (branch `feat/provider-switch-carryover`). This task keeps the
   `AUTH_REQUIRED` refusal, and AC 3.11 step 4 asserts it (R1-6 spec above).

### Scope note for the orchestrator

Status (current, decision rows 37-38): AC 3.11 steps 1-4 are designed and stay in batch H.
Steps 1-3: a new message after a stage 1 switch runs on Codex. Step 4: continuing the
pre-switch conversation gives `AUTH_REQUIRED` naming the stored provider, and `resumeSession`
is not called. The carry-over by compaction is not in this task. It needs a new backend
contract and a cross-provider transcript transfer, and runs as its own task
(`feat/provider-switch-carryover`). The evidence and sizing below are kept as history.

Evidence that no working path exists today:

- Verified: a stored session keeps its own provider. When the workspace's active provider
  differs, the resolver throws `AuthRequiredError` ("Cannot resume this session: its provider
  ... differs from the workspace's active provider"):
  `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:268-284`,
  `:375-378`, `:542-553`.
- Verified: every continue path goes through that resolver, including `/compact`. The resume in
  `chat:continue` calls `runtimeProfile.prepare(config, identity, ...)`
  (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:2409`) and maps the
  throw to `AUTH_REQUIRED` (`:2493`, helper `:876-886`). The `/compact` slash path calls the same
  `prepare` with the stored identity (`chat-slash-command-router.service.ts:334`) and maps the
  same throw to `AUTH_REQUIRED` (`:463-468`). So after a switch to Codex, `/compact` on the old
  Claude conversation is refused too.
- Verified: native Codex compaction works only on a Codex thread
  (`chat-slash-command-router.service.ts:369-385`, `runtimeControls.compact(sessionId)` when
  `execution.runtime === 'codex-app-server'`). A Claude SDK transcript is not migrated to the
  native runtime (`libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.spec.ts:161`,
  "admits new native chats ... without migrating old history").
- Verified: the renderer only shows the re-auth banner for `AUTH_REQUIRED`
  (`libs/frontend/chat/src/lib/services/message-sender.service.ts:143-157`,
  `libs/frontend/core/src/lib/services/auth-state.service.ts:1217-1222`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:344`). It has no
  "carry over" or "continue with the new provider" action. The PostCompact and compact-session
  code in `@ptah-extension/chat` (`compaction-lifecycle.service.ts`,
  `compaction-advisory-correlator.service.ts`) tracks compaction inside one session and has no
  provider switch.
- Why it "always worked" for the user: until commit `a9497540e` (2026-11-02, "refuse retired
  Codex proxy routes", Removal A step A3, already on `main`) a stored Claude session resumed on
  the Claude SDK runtime with the newly active provider's profile, and Codex was served through
  the translation proxy. `/compact` then summarised the old transcript with the new provider.
  That commit retired the proxy and added the stored-provider refusal on purpose. Its message
  says: "A stored Claude session whose workspace now selects Codex is refused with
  AUTH_REQUIRED instead of a silent provider mismatch (intended behavior change)." The path the
  user remembers was removed one day before this plan, and it cannot be restored without
  bringing back the retired proxy.

Smallest viable design (not part of this plan; sized for the decision):

- Trigger: in `chat:continue`, when `prepare` throws the stored-provider mismatch and the
  active connection resolves to a different provider, the host does not return `AUTH_REQUIRED`.
  Either it carries over automatically, or `AUTH_REQUIRED` gains one action "Continue with
  <provider>" on the existing banner. The banner action is the smaller UI change and reuses the
  existing banner (`chat-view.component.ts:344`). Automatic carry-over matches the user's words
  more closely. This choice is the user's.
- Carry-over: the host reads the old Claude transcript with the existing
  `SessionHistoryReaderService.readSessionHistory`
  (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:350`), renders it to bounded
  plain text (a fixed token budget, newest turns kept), and starts a NEW chat on the active
  provider (`codex-app-server` for Codex) whose first turn asks the new provider to summarise
  the prior conversation, then answers the user's message. Claude is never called.
- Contract: `ChatContinueResult` (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:209-223`)
  gains a field such as `carriedOver?: { fromSessionId; sessionId }`. The renderer rebinds the
  tab's conversation to the new session (the conversation registry already appends sessions
  under one conversation) and shows a one-line notice.
- Size: about 8-10 files in 4-5 projects: `@ptah-extension/shared` (result type),
  `@ptah-extension/agent-sdk` (transcript-to-text export, if no export exists),
  `@ptah-extension/rpc-handlers` (continue branch, a carry-over helper and its spec, the AC 3.11
  carry-over case), `@ptah-extension/chat` (result handling, tab rebinding, notice) and possibly
  `@ptah-extension/chat-state`. It also needs decisions on the transcript budget, tool-call and
  attachment handling, and whether the Providers page switch gets the same behaviour (it shares
  the same resume path, so it would).

**Settled (decision rows 37-38):** the user moved the carry-over to a parallel task (child
session, branch `feat/provider-switch-carryover`) with a "Continue with <provider>" button on
the existing banner. This plan ships AC 3.11 steps 1-4, with step 4 asserting `AUTH_REQUIRED`.

Recommendation (applied): the carry-over is its own task, because it changes chat resume
behaviour for every provider switch, not only stage 1. In this task, ship all four AC 3.11
steps, with step 4 asserting today's `AUTH_REQUIRED` refusal. That task keeps the same
`AUTH_REQUIRED` contract as its banner trigger (row 38), so step 4 here stays valid after it
lands, and Claude never serves the old conversation.

### Re-checks

- Component 13 still touches only the seven listed regions of
  `onboarding-home.component.ts` (imports `:28-29`, `imports` `:67`, strip `:80`, banner
  `:112-116`, footer text `:306`, fields `:326,:333`, constructor `:419-421`). Revision 1 adds no
  Home edit. TASK_2026_863_3855 owns the rest of the file.
- Batches stay file-disjoint:
  - C adds `apps/ptah-electron/src/activation/shutdown.ts` (+spec), `main.ts` and
    `main.quit-path.spec.ts`. No other batch touches them.
  - B keeps every auth-providers file, including the `CodexLoginService` lifecycle.
  - H adds three spec files that no other batch edits: one CREATE in rpc-handlers
    `chat/session/`, which is disjoint from C's `handlers/` files, and two MODIFY specs in
    cli-agent-runtime and cli-engine.
- Verification stays scoped. The per-batch commands for C and H are spelled out under
  Verification points. The final command already lists `@ptah-extension/rpc-handlers`,
  `@ptah-extension/cli-agent-runtime`, `@ptah-extension/cli-engine` and `ptah-electron`. No
  workspace-wide, build, serve, e2e or package target is added.
- Finding-resolution audit (Revision 1 completion pass): every "Where it is fixed above" entry
  for findings 1-6 was checked against the body and is present (D-5 superseded; Component 1
  `browserOpened` and success rule; Component 3 suppression, validation, `openExternal`
  outcomes, race and quit cases; Component 5 mapping and race tests; Component 6 quit hook and
  tests; Component 8 response handling; Component 11 renderer half; Testability; batch H;
  Files; A-1, A-6 and R1-8 in the assumptions and Verification points). Gaps fixed in this pass:
  A-10 was defined only inside the AC 3.11 spec and is now listed with the other assumptions and
  in Verification points; the body `## Clarifications Needed`, Component 11, Testability, R1-2,
  R1-6 and AC 3.11 step 4 now reflect the user answers.

### Revision 1 round 2 fixes

Fixes for `implementation-plan-review-r1.md` (decision rows 40-41):

1. Serious, AC 3.11 step 4: every section now assigns the four-step host spec, with step 4
   asserting `AUTH_REQUIRED` naming the stored provider and `resumeSession` not called (rows
   37-38). Changed: `## Clarifications Needed`, Testability, "User answers" Q2 (marked
   superseded, kept as history), the scope note status and its recommendation. The carry-over
   stays in its own task (`feat/provider-switch-carryover`).
2. Moderate, URL extraction: Component 3 now splits the shared helper into
   `httpsUrlCandidates` (all matches per line) and `parseHttpsUrl(candidate, maxLength)`.
   `extractHttpsUrl` keeps Kimi's first-candidate, 2048-character behaviour unchanged; Codex
   adds `validateSignInUrl` (4096, no credentials) and `extractSignInUrl` (first valid
   candidate). New cases: 2049 and 4096 characters accepted for Codex, 4097 rejected, a valid
   URL after an invalid one on the same line found, and a new `cli-login-output.spec.ts` that
   pins Kimi's behaviour. Files lists add `cli-login-output.spec.ts` and the Kimi spec import
   edit.
