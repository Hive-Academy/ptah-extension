# Batch 6 implementation report

Implemented account metadata operations, the reserved official-command state machine, fixed safe result copy, and conservative source-certification helpers. Live named commands remain release-held. No existing ambient provider path, DI registration, or package barrel was changed.

## Files changed

Workspace: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`.

Created only these five source/spec files and this report:

- `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts`
- `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`
- `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`
- `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts`
- `libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts`
- `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-06.md`

Each TypeScript file is below 400 lines. Existing Batch 5 sources were read but not edited.

## Public API

These exports are local to their source modules; Batch 7 owns package exports and composition.

### ProviderAccountService

Constructor: `(store: ProviderAccountStore, connection: Pick<SqliteConnectionService, 'db' | 'dbPath'>)`.

- `add(label)` allocates a random profile ID and an empty `provider-accounts/claude/<id>` directory beside the injected profile DB. Checks parent directories against symlinks/junctions, never imports credentials, never selects the new account. Returns a public summary, without paths or physical identity.
- `list()`, `rename(profileId, expectedRevision, label)`, `remove(profileId, expectedRevision)` use the existing store. Removal retains directory content. Summaries contain the active run count and `owner: unknown`.
- `selection(workspaceRoot, scope)` and `select(workspaceRoot, scope, profileIdOrNull, expectedSelectionRevision, expectedProfileRevision?)` keep main and lane independent.
- `setDefault(workspaceRoot, profileIdOrNull, { main, lane }, expectedProfileRevision?)` checks both selection revisions and writes both scopes in one immediate SQLite transaction. A second-scope conflict rolls back the first write. Null selects ambient explicitly.

### ProviderAccountActionsService

Constructor: `(store: ProviderAccountStore, commands: ClaudeAccountCommand)`. Implements the existing `ProviderAccountActionPort`: `readStatus`, `startSignIn`, `cancelSignIn`, `signOut`.

- Status generates a fresh opaque operation ID. Mutating callers must supply a fresh operation ID and current revision, as required by Batch 5's deletion of completed operation rows.
- Cancellation targets the active login operation ID and the current pending profile revision, which is the start revision plus one. It also checks the current auth epoch.
- Reservations use the Batch 5 transactional store. Source/path revalidation happens before spawn, and the spawner receives a launch guard with canonical path and device/inode identity.
- A completed login/logout is followed by official status under the same reservation. Cancellation cannot be overwritten by a successful late result. Cancellation/timeout rechecks status after proved close; a later explicit status may observe a browser flow that completed despite cancellation.
- Only proved child close permits completion after spawn. Unproved termination leaves the persisted operation and pending state held. Restart never reclaims an operation by time, PID, or optimistic status.

### ClaudeAccountCommand and helpers

Constructor: `(detector: Pick<ClaudeCliDetector, 'findExecutable'>, spawner: IProcessSpawner)`. Uses only public cross-library aliases.

- `execute(kind, route, abortSignal)` supports `status`, `login`, and `logout` via `['auth', kind]`. Uses `process.execPath` plus the detector's `cliJsPath` only for descriptors requiring direct execution. WSL and incomplete descriptors refuse.
- `authorization()` returns `release-held` unconditionally. There is no environment, configuration, or constructor bypass flag. Tests replace this method using Jest spies, with a mocked spawner and detector.
- `environment(route)` refuses `unsupported-source` unconditionally until an actual deployed CLI version and effective managed/project/local source resolver are certified. Tests mock this separately from release authorization.
- `certifyClaudeAccountEnvironment(env, effectiveSettings, route)` is a conservative pure helper: requires nonempty complete effective-settings evidence, accepts only empty settings objects, refuses all unknown/nonempty settings and conflicting known/unknown auth selectors, copies a finite OS environment baseline, clears the enumerated selector keys and sets only the selected config directory. It never reads credentials or executes helpers. This helper alone does not certify an installed CLI/version or authorize a launch.
- `parseClaudeAccountStatus(text, directory)` is a fixture-contract parser for exact directory and `claude.ai`/`none` auth methods. Discards optional email/organization fields; refuses unknown fields/sources. It does not assert that a deployed CLI currently supplies this schema.
- `accountActionResult(code)` maps every shared closed result code to a fixed safe sentence. Exceptions, paths, stdout and stderr never supply result copy. Output is bounded to 16 KiB in memory for status; other stdout and all stderr are drained without retention. No logging was introduced.
- Deadlines include detector waiting: status/logout 10 seconds, login 5 minutes. Owned process-tree termination has 2 seconds of close grace. A follow-up status is a separate bounded command. Handles, stream listeners, abort listeners and local timers are released on completion/grace expiry.

## State-machine table

| Trigger | Persisted state | Reservation behavior |
| --- | --- | --- |
| Add | not-signed-in | No operation or selection |
| Start reserved action | pending | Exclusive physical-route auth reservation; epoch/revision advance |
| Status confirms claude.ai / login recheck confirms claude.ai | signed-in | Complete with operation/owner/epoch/revision CAS |
| Initial status confirms none | not-signed-in | Complete with CAS |
| Logout followed by none | signed-out | Complete with CAS |
| Cancel with proved close and bounded recheck | cancelled | Complete with CAS; late success cannot replace cancellation |
| Command/source failure, wrong post-login/logout method, timeout from unsigned state | failed | Complete only if termination is proved |
| Previously signed-in status is lost, unreachable or unsupported | disconnected | Complete only if termination is proved |
| Grace expires without close, including recheck termination failure | pending, unresolved | Retain operation; subsequent actions/status refuse busy |
| Host restart with pending operation | pending, unresolved | No lease stealing and no inferred success |

## Acceptance coverage

Specs were authored but NOT executed. The names below identify intended CI evidence, not passing runtime results.

1. Full state machine: `moves not-signed-in through pending to signed-in and verified signed-out`; `reports failed and disconnected without raw credential-shaped output`; `compares operation ID and auth epoch on cancel and completion`; cancellation and restart tests.
2. CAS and active lease: `rejects stale operation and epoch completions while preserving the current reservation`; `compares operation ID and auth epoch on cancel and completion`; `refuses an active run lease without spawning or advancing the epoch`.
3. Deadlines/cancel/late close/recheck: parameterized `enforces %s deadline and kill grace`; `includes stalled CLI discovery in the status deadline`; `retains unproved termination after two second grace and ignores late success`; `cancellation during the post-login status check cannot become success`; cancellation test also verifies a later explicit status can observe signed-in.
4. Restart pending: `reports restart pending as unresolved and refuses duplicate host copies` and retained-termination test.
5. Duplicate service instances and R1 redaction: duplicate-host test; `maps closed codes to fixed safe sentences even when dependency errors contain secrets`; `reports failed and disconnected without raw credential-shaped output`; `bounds output and drains stderr without returning it`. Existing Batch 5 route/store specs remain the physical-directory uniqueness coverage.
6. Live fail-closed and ambient preservation: `holds live named commands before discovery and leaves ambient selections alone`; `refuses unknown live certification even when release authorization is mocked`. No ambient execution implementation was modified or exercised.

Additional coverage: atomic-default rollback and independent selections; every enumerated selector; helper/managed/project/local overrides; unknown precedence and case variants; unsupported methods and config-directory mismatch; direct Node descriptor argument arrays; launch-time directory replacement.

## Verification

- Scoped `ptah_get_diagnostics` was called for the five changed TypeScript files. Initial check reported unavailable while still running; its completion and the final check after deadline changes both reported **0 errors, 0 warnings, clean coverage**.
- No Nx, Jest, tsc, lint, build, e2e, real provider binary, login/logout, network, paid call or git command was run.
- Process tests use a mock detector, in-memory child streams and a mocked tree reaper; temporary SQLite databases follow the Batch 5 integration-test pattern.

## Decisions

1. **Keep live authorization and version/source certification closed.** Options: infer unsupported vendor behavior, ship a bypass, or refuse until evidence exists. Chosen: unconditional release hold plus a separate unsupported-source resolver. Evidence: implementation plan component 3 and task-description release boundary; no deployed-version certification was supplied. Reversible only through a reviewed implementation with authorization and source evidence, never a runtime flag.
2. **Place atomic default SQL in the owned metadata service.** Options: modify Batch 5 store, issue two independent store selections, or use the same injected connection for one explicit transaction. Chosen: the latter. Evidence: Batch 5 `atomic` is private, `select` starts its own immediate transaction, ownership forbids changing the store, and the plan requires atomicity. Reversible by moving the transaction into the store in a later owned batch.
3. **Use empty-settings certification as a conservative subset.** Options: guess precedence for arbitrary settings, execute helpers, or refuse nonempty/unknown settings. Chosen: refuse. Evidence: unknown helper/cloud/token/Console sources must fail closed; no certified deployed version exists. Future supported settings can be added with evidence and regression coverage.
4. **Retain unproved operations after grace and ignore detached late close.** Options: release on kill request/elapsed time, keep listeners forever, or retain the persisted reservation and release local resources. Chosen: retain the reservation and clean up local listeners/timers. Evidence: Batch 5 completeAuth requires termination proof, plan forbids PID/time stealing, and restart state must remain unresolved. Recovery remains explicit future work.
5. **Constructor composition remains Batch 7 work.** Options: add registrations/decorators/tokens outside ownership or expose explicit constructors for the next composition batch. Chosen: explicit constructors, no registrations/barrel edits. Evidence: batch ownership and the user's express prohibition. Batch 7 can use factory registrations for these constructor dependencies.

## Not done / integration boundaries

- Tests have not been run; CI must execute the authored specs and assess runtime behavior.
- No live CLI version, status schema, effective managed/project/local source precedence, or provider licensing authorization has been certified. Live named commands intentionally cannot execute. The pure environment/parser helpers and mocked state-machine proof are not production certification evidence.
- No `ProviderAccountAdmissionPort` implementation or branded route construction was added; this batch implements the action port and command launch revalidation. Future run admission must not treat a raw canonical route or helper result as authorization.
- No DI registration, package export, Electron UI, TUI, VS Code feature, Codex path, automatic pending recovery, credential persistence or identity inference was added.
- Completion rows are deleted by the existing store. Callers must continue using fresh operation IDs; no historical replay-receipt schema was introduced.
- Runtime/manual verification of unchanged ambient provider execution was not performed; that path was not edited or routed through the new gate.
