# Backend implementation - `TASK_2026_719`, P5 batch B2 (Ambient probe and reader)

**Tasks completed**: implementation-plan-p5.md §3 (ambient probe on `ClaudeAccountCommand`) and §4
(`ClaudeAmbientLoginStatusReader`), including the P5-D14..P5-D16 behaviour and every listed test.

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`
  - New exported types `ClaudeAmbientStatusProbeRequest` `{ executable, env, signal }` and
    `ClaudeAmbientStatusProbeOutcome` `{ status: ClaudeAccountStatus | null; terminated; timedOut; closeReceipt? }`.
  - New method `ambientStatus(request)`. It calls the existing private `run()` with argv
    `[...prefixArgs, 'auth', 'status', '--json']`, the caller's env object, `cwd: host.tempDir()`,
    `CLAUDE_ACCOUNT_CHILD_LIMITS.statusMs` and `statusOutputBytes`, and no `launchGuard`. It parses only a
    child that closed on its own (the same rule as `status()`), using the env's `CLAUDE_CONFIG_DIR` (or `''`)
    as the directory argument. `timedOut = stopped === 'timeout'`. The close receipt is handed to the
    caller. Stdout never leaves the method.
  - `status()`, `logout()`, `certifyExecutable()` and the route guards are unchanged.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts`
  - Exports: `AMBIENT_STATUS_FRESH_MS` (60 000), `AMBIENT_STATUS_BUDGET_MS` (20 000), `AMBIENT_READ_DEADLINE_MS`
    (25 000), `ambientProbeEnv()`, `ClaudeAmbientStatusHost` + `NODE_AMBIENT_STATUS_HOST` (`process.env`,
    `Date.now`), `ClaudeAmbientStatusLogger`, `ClaudeAmbientStatusCommands`
    (`Pick<ClaudeAccountCommand, 'certifyExecutable' | 'ambientStatus'>`), and the undecorated class
    `ClaudeAmbientLoginStatusReader(commands, host, logger)`.
  - `ambientProbeEnv`: keys that pass `isCertifiedClaudeEnvKey`, plus `CLAUDE_CONFIG_DIR` /
    `CLAUDE_SECURESTORAGE_CONFIG_DIR` when they are set and not blank. Values with a line break are skipped.
    No `ANTHROPIC_*` key, API key or cloud selector is copied. The cache key is
    `certifiedEnvDigest(ambientProbeEnv(host.env()))`, computed at call time.
  - Serial slot: `active` attempt (key, generation, AbortController, callers, obsolete flag), one `followUp`
    caller set, a `retained` receipt set, and `lastAttempt` (only the current key is kept; a key change
    clears the others).
    - A read without `refresh` returns the fresh cache (< 60 s), joins a same-key active attempt, or starts
      an attempt.
    - A refresh during an active attempt queues the single follow-up, and further refreshes share it. The
      follow-up starts only after the active attempt's `run()` returned.
    - A read with a different key marks the active attempt obsolete and aborts it. The new attempt starts
      only when the old one finishes (closed, or after the kill grace with a receipt). An obsolete result is
      not cached or returned, and its callers are moved to the current key's attempt.
    - An unclosed retained receipt blocks spawning. Blocked reads return `lastAttempt` for the key as the
      same object, or a frozen `{unknown, timeout, checkedAt: null}`. The receipt's `onClosed` releases
      the block.
    - Each attempt has a 20 s budget abort. Mapping: certify `unsupported-store` -> `cli-missing`;
      certify `timeout`/`cancelled` -> `timeout`; any other certify refusal -> `unreadable`; probe
      `timedOut` or aborted -> `timeout`; `status: null` -> `unreadable`; `loggedIn` -> `connected` or
      `signed-out`. `checkedAt` is taken only after the attempt completed. An unexpected throw ->
      `unreadable`, plus one fixed-text `logger.warn`.
    - Every caller has its own 25 s deadline timer (`Caller.answer` settles once and clears the timer). A
      timed-out caller gets `{unknown, timeout, checkedAt: null}`. The active attempt, the follow-up and the
      receipts are left alone, and the follow-up still starts later and fills the cache.
    - `dispose()` aborts the active attempt, answers queued callers with the blocked result, and disposes
      every retained receipt. A receipt that arrives after dispose is disposed at once.
  - Results contain only `state`, `checkedAt` and (with `unknown`) `reason`. They are frozen.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-account-command.ambient.spec.ts`
  (7 tests). Uses a fake `IProcessSpawner` and a fake host, with `killProcessTree` mocked as in
  `provider-account-auth-env.spec.ts`. Covers:
  - argv, the passed env object (identity), the temp cwd and no `launchGuard`
  - signed-in (exit 0) -> `loggedIn: true`, with no email, org or path in the result
  - signed-out (exit 1, `authMethod: none`) -> `{ loggedIn: false }`
  - garbage output -> `null`
  - the 10 s limit with fake timers -> `timedOut: true` plus a close receipt that later observes the close
  - no parse after an abort
  - `status()` without a route still refuses with `routeChanged` and does not spawn
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.spec.ts`
  (23 tests). Uses a deferred fake command that counts live children (started minus resolved-with-close,
  with receipts kept live until `close()`), Jest fake timers and the system clock. Covers:
  - every mapping row, including 5 certify codes and the unexpected throw with its fixed-text warn
  - the 20 s budget abort -> `timeout`
  - the probe env: excludes `ANTHROPIC_API_KEY`, keeps `CLAUDE_CONFIG_DIR`, skips line-break values
  - cache hit at 59 999 ms, a new probe at 60 000 ms, and refresh bypassing the cache
  - a stored `connected` never returned for another key (including after switching back)
  - a non-refresh read joining the active attempt (max live 1)
  - two refreshes sharing one follow-up that starts only after the first attempt resolves
  - an environment change: the old attempt is aborted and awaited, max live 1, the new and the obsolete
    caller both get the new key's result, and the obsolete result is not cached
  - an unclosed receipt from an aborted attempt blocking the spawn, with `checkedAt: null`; receipt close
    releasing the block
  - repeated blocked reads returning the same earlier object while the clock advances
  - the P5-D16 regression: the queued caller is not answered at 24 999 ms and is answered at 25 000 ms
    with `unknown/timeout/null`; live children stay at 1; after the slow attempt resolves, the follow-up
    starts and its result is cached and served; the caller settled exactly once
  - `dispose()` disposing retained receipts
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/di/register.ts`
  - Registers `ClaudeAmbientLoginStatusReader` by class with `instanceCachingFactory` in
    `registerProviderAccountServices`, next to `ClaudeAccountCommand`.
  - Arguments: `c.resolve(ClaudeAccountCommand)`, `NODE_AMBIENT_STATUS_HOST` and
    `c.resolve<Logger>(TOKENS.LOGGER)` (the existing `Symbol.for('Logger')`).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/index.ts`
  - Exports the `ClaudeAmbientLoginStatusReader` class only, like `ProviderAccountService`.

## Stack observed

- tsyringe factory registration of undecorated account classes: `register.ts:162-178`.
- The fake spawner pattern and the `killProcessTree` mock: `provider-account-auth-env.spec.ts:12-50`.
- Env helpers come from the `@ptah-extension/agent-sdk` barrel, as `claude-account-status.ts` already uses
  it.
- Shared types from B1: `libs/shared/src/lib/types/provider-account.types.ts:264-293`.
- Logger token: `libs/backend/vscode-core/src/di/tokens.ts:34`, already imported by `register.ts`.

## Verification

- `node scripts/verify.mjs --exec --task b2-jest -- npx jest -c libs/backend/auth-providers/jest.config.ts <ambient-login-status spec> <command.ambient spec> <provider-account-auth-env spec>`:
  - First run (after the type fix): command ambient spec and existing auth-env spec passed (36 tests). The
    reader spec failed to load because it lacked `import 'reflect-metadata'`, which the agent-sdk barrel
    needs.
  - After adding the import, the reader spec run gave `Tests: 23 passed, 23 total`, exit 0.
  - ts-jest type-checks, so the earlier type errors would have been reported.
- `ptah_get_diagnostics` on `register.ts`, `claude-ambient-login-status.ts` and `index.ts`: 0 errors.
- Not run, per the brief: `npm run verify`, lint, nx typecheck and builds. The orchestrator runs the
  batch verify.

## Plan deviations

- Constructor has a third parameter `logger: ClaudeAmbientStatusLogger` (`{ warn(message) }`). The plan
  lists `(commands, host)`, but the brief requires the injected Logger, and the degradation audit needs
  the step-8 swallowed error to be reported. Only one fixed-text line is logged.
- An attempt whose key no longer equals the current env key at completion, even though no read noticed
  the change, is treated as obsolete. Its callers are moved to an attempt for the current key. This is a
  stricter reading of step 7 ("written only when the key is still current").

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Directory keys are copied only when set and not blank | copy any defined value; copy non-blank | plan §4 says "only when present"; a blank `CLAUDE_CONFIG_DIR` names no directory | yes |
| Logger is a local structural port (`warn(message)`), and register passes `TOKENS.LOGGER` | import the `Logger` class type into the reader; structural port | keeps `vscode-core` out of the accounts module (backend architecture rule); `Logger.warn(message, ...args)` satisfies it | yes |
| Follow-up starts even when all its callers already hit the deadline | drop an orphaned follow-up; start it | plan §4 7a and the regression test: "the follow-up starts, its result is cached and served to the next read" | yes |
| A1 (no `CLAUDE_CONFIG_DIR` override in the subscription auth env) holds | include an override in the key | grep for `CLAUDE_CONFIG_DIR` / `CLAUDE_SECURESTORAGE` in `libs/backend/auth-providers/src/lib/auth/` gives 0 matches | yes |

## Out-of-scope observations / open points

- B3 must inject the reader by class in `ProviderAccountRpcHandlers`. The Electron smoke spec needs a stub
  reader (plan §5). Hosts that never resolve the reader start no timers or children: the factory is lazy.
- The `jest.config.ts` ES-module load warning printed by jest is pre-existing and unrelated.
