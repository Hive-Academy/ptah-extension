# Backend implementation — `TASK_2026_719_4f64`, batch 8 WP-b

**Tasks completed**: Task 8.1 WP-b (4 files). Batch 8 is complete with WP-a. Batch state is not
edited; the team-leader runs the one B8 verify (N = 6).

**Files** (all under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/`):

- REWRITTEN `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`: the only
  owner of account child processes. It implements `ClaudeCliProbe` (`certifyExecutable`,
  `status`, `logout`, `queryRegistry`).
- REWRITTEN `libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts`:
  now the command/process-owner spec (17 tests).
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`:
  4-token constructor, owned-child ledger, common completion gate, polling, `onStateChanged`.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts`:
  3-arg service constructor, no `store.admit`, the moved disposal coverage restored.

**Stack observed**:

- tsyringe class tokens. `register.ts:163-176` registers the command, certifier and console as
  factories, and the actions service with `useClass`.
- zod validation lives in the store and service (unchanged).
- Spawning goes through `IProcessSpawner` (`platform-core/src/interfaces/process-spawner.interface.ts:64-135`).
- Certified env: `buildCertifiedClaudeEnv` (`agent-sdk/src/lib/helpers/claude-certified-launch.ts:198`).
- Probe contract: `claude-route-certifier.ts:29-76`.
- Status parser with 4 arguments: `claude-account-status.ts:88`.

## Acceptance evidence (Batch 8 bullets owned by WP-b)

| Acceptance bullet | Evidence (spec : test) |
| --- | --- |
| `reg.exe` argv: absolute path, `/reg:64` | auth-env spec "runs absolute reg.exe with /reg:64…". Command `C:\Windows\System32\reg.exe` (SYSTEMROOT from the certified env), args `['query', path, '/reg:64']`. "never spawns for argument …" covers `/f`, `/?`, `HKCR`, NUL. "never spawns off win32" |
| 5 s kill | "kills after 5 s…": no kill at 4999 ms, `killProcessTree(1234,'SIGKILL')` at 5000 ms, `terminated:false, timedOut:true` after the 2 s grace |
| Output bound | "bounds stdout at 64 KiB and discards it": `overflow:true`, `stdout:''`, child killed. Status output is bounded at 16 KiB: "returns no status for overflowing output…" |
| Close proof | "treats only an observed close as termination proof after a kill". Stderr is drained and never returned ("private" text absent) |
| Version cache: same fingerprint, one spawn | "reuses the cache…": 1 spawn, 3 stats for 2 calls |
| Version cache: mtime change re-probes | "re-probes after an in-place update…": 2 spawns, new version and new fingerprint |
| Version cache: stat `ENOENT` -> `unsupported-store` | "refuses unsupported-store on stat ENOENT…": no spawn, the cache is dropped, and the next call spawns again |
| Coverage refusal makes zero `status`/`logout`/console calls (sign-in, `readStatus`, sign-out) | actions spec "coverage refusal … for sign-in, readStatus and sign-out" |
| Refusal between polls stops polling | "…between two polls, stopping the polling": `status` is called once and no timer is left |
| Fallback mode: unproved child blocks `completeAuth` on success | "an unproved status child, then a success status: no completeAuth, pending, busy" |
| Fallback mode: unproved child blocks `completeAuth` on cancel, deadline and disposal | "an unproved child, then cancel/deadline/disposal: no completeAuth" |
| Fallback mode with every child closed: success, cancel and deadline complete | "returns the generated script… completes…" and "completes on cancel/deadline…" |
| Console mode: an unclosed console blocks, and a late close allows completion | "an unclosed console blocks completion and a late close then allows it". Listeners are removed afterwards |
| `fallback.script` returned | `{ ...ok, fallback: { platform: 'win32', script } }`. `fallbackScript` is called with one argument (`context`) |
| Class O sign-in completes `signed-in` | "completes a class O account as signed-in" |
| No accessor exposes the console handle | the console-mode result keys are exactly `['code','summary']`. No public member returns the ledger or the child |
| Deleted members have no remaining references | grep over `libs/` and `apps/`: no code reference. One string literal remains (see Out-of-scope) |
| Moved WP-a disposal coverage (1-4) | "waits for a bounded status, retains an unproved operation and refuses every new action"; "aborts an in-flight sign-in status poll and retains…"; "stops a pending console sign-in (close proved: true/false)…" checks no listener and no timer; "releases a never-spawned console sign-in at once, without the grace or a tree kill" |

Other coverage:

- `readStatus` records `signed-in` with the identity reference, `signed-out` with the reference
  cleared, and `disconnected`.
- An unproved status retains its exclusion.
- Sign-out reports `signed-out` only when status proves `loggedIn:false`, and clears
  `identity_ref`.
- An unproved logout keeps the reservation and starts no status child.
- A run lease makes sign-in `busy` with no auth context.
- Cancel compares the operation id, revision and epoch.
- `onStateChanged` sends a snapshot, and unsubscribe works.
- Summaries are safe.

## Verification

- `ptah_get_diagnostics` was not used because it timed out in WP-a. The fallback from the brief
  was used instead:
  - `npx tsc --noEmit -p tsconfig.lib.json` in `libs/backend/auth-providers`: exit 0, no
    errors. This clears `register.ts(171,7)`.
  - `npx tsc --noEmit -p tsconfig.spec.json`: exit 0, no errors. This clears
    `actions.spec:66` and `:266`.
- `npx eslint` on the 4 files: no output, so 0 errors and 0 warnings.
- `npx jest -c libs/backend/auth-providers/jest.config.ts <auth-env spec> <actions spec> <register.spec.ts> --maxWorkers=2`:
  **3 suites passed, 56 tests passed, 0 failed.**
- Not run, per the brief: `npm run verify` (the team-leader's B8 verify, N = 6), the host smokes,
  and the rpc-handlers typecheck.

## Specs that mock or pin changed members (rule 5, grep)

- `provider-account-auth-env.spec.ts` pinned all the deleted members. It is rewritten.
- `provider-account-actions.service.spec.ts` spied on `commands.authorization`, `environment`
  and `execute`, used the 2-arg actions and service constructors, and called `store.admit`. It
  is rewritten. It uses instance fakes only: `Object.create(<Class>.prototype)` for the command,
  certifier and console, and `jest.spyOn(store,'completeAuth')` on the instance.
- `register.spec.ts` constructs no command or actions member directly. It passes unchanged.
- `register.ts:15,163-176,220-224`: the imports and factories are unchanged.
  `accountActionResult` and `ClaudeAccountCommand` are still exported.
- `provider-account.service.ts:11` imports `accountActionResult`, which is unchanged.
- No ambient-path pin (plan 943-953) is touched. agent-sdk `release-held` pins
  (`session-query-executor.accounts.spec.ts`) use their own fakes and do not depend on the COPY
  text.

## Risks and how they were handled

- **D14 note 1, version cache.** The cache key is `[command, prefixArgs, sdkExecutablePath]`
  plus a `stat` `{ size, mtimeMs }` read before every reuse. The file is stat-ed again after
  `--version`, and a fingerprint that changed during the probe gives `identity-unproved`. A stat
  error drops the cache and gives `unsupported-store`.
- **Unproved children.**
  - Close is the only proof. A failed tree kill is swallowed, with a `degradation-audit` comment.
  - The gate calls `completeAuth` only when `allClosed()`. Otherwise the reservation stays and
    the result is `busy`.
  - A blocked sign-in keeps its console listeners until disposal, so a late close completes it.
- **A collaborator that throws.** In sign-in startup, a poll or sign-out, the error is treated
  as an unproved child: fail closed and keep the reservation. There are no unhandled rejections
  from timers.
- **Disposal.**
  - It aborts every operation and runs the gate as `cancelled` for a pending sign-in.
  - It waits for the bounded probe or console grace.
  - It then releases the listeners of blocked operations and clears all timers. New actions get
    `unavailable-storage`.
- **Security (rule 11).**
  - No `process.env` mutation.
  - Child output is never logged or returned, except as parsed status facts and as registry text
    for the scan.
  - stderr is drained and discarded.
  - Argument arrays only. The registry path is allowlisted by a regex before it reaches `reg.exe`.
- **Rules 2 and 3.**
  - No `process.cwd()`.
  - Host facts are injected through `ClaudeAccountCommandHost`: platform, env, `tempDir`, `stat`.
  - No `jest.spyOn` on a module namespace.
  - `killProcessTree` is replaced with a `jest.mock` module factory, as the previous actions spec
    did, so no spec can kill a real pid. No real `claude`, `conhost.exe` or `reg.exe` runs.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Optional 3rd constructor parameter `host` (default `NODE_COMMAND_HOST`). The factory call stays `(detector, spawner)` | inject `stat`, env and platform vs. a module spy (banned by rule 3) | rules 2 and 3; `register.ts:164` is unchanged | yes |
| A probe child (status, logout) whose close was not seen stays unproved for the life of the operation. Only console entries can close late | expose a late-close promise from the command vs. keep the `ClaudeStatusProbeResult` contract | `ClaudeStatusProbeResult` in `claude-route-certifier.ts:47-50` (B6, not a WP-b file) has only `terminated` | yes (needs a contract field) |
| `startSignIn` returns `ProviderAccountSignInStart` (`ProviderAccountActionResult & { fallback? }`), with the `fallback` shape of `rpc-provider-accounts.types.ts:201-204`. It is still assignable to the port | change the port (`auth-providers-tokens`, not a WP-b file) vs. a structural extension | plan 165, 621; B17 consumes it | yes |
| Deadline state is `failed` (or `disconnected` if the account was signed in), code `timeout` | there is no `timeout` profile state | `PROVIDER_ACCOUNT_STATES` (`provider-account.types.ts:22-30`) | yes |
| An unparseable `--version` output or a non-zero exit gives `identity-unproved`. Below 2.1.301 gives `unsupported-store` | — | matches the certifier's own parse refusal (`claude-route-certifier.ts:182`) | yes |
| A logged-in status with `configDirectoryMatches:false` is a failure (`identity-mismatch`) | keep polling vs. fail | the B5 parser contract | yes |

**Plan deviations**:

- `ClaudeAccountCommand` gains the optional `host` parameter (see Decisions).
- The old `launchGuard` (file identity of the account directory) is not set on probe children.
  Each auth context is built after route revalidation (certifier `prepare`), and the run
  boundary uses `checkLaunch`.
- Direct execution still uses `process.execPath` with `cliJsPath` as the prefix argument,
  exactly as before.

**Out-of-scope observations**:

- `libs/backend/auth-providers/src/lib/di/register.spec.ts:145` still names
  `'certifyClaudeAccountEnvironment'` as a string literal. The list asserts that the name is NOT
  exported. The assertion still passes, but the literal names a deleted member. The team-leader
  can remove it from the list (it is a WP-a file, not edited here).
- `libs/backend/agent-sdk/src/lib/di/register.ts:215` has a comment saying named Claude accounts
  "stay release-held". It is stale text for a later batch, with no code effect.
- In Electron, direct execution runs the Electron binary as `process.execPath`. This behaviour
  is unchanged from before the rewrite. E4's live test should confirm `--version` works through
  that path on the target install.
