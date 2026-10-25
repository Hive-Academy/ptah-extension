# Batch 2d report

Implemented App Server process lifecycle and JSONL transport. Production routing remains disabled; no exports, registrations, existing contracts, task state, or parallel-lane files were changed. No git operations or real Codex executions were performed.

## Files

- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-2d-report.md`

All paths are relative to `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`.

## Design and evidence

- `codex-app-server-process.ts:69`: constructor receives the platform spawner, 2a executable source, measured binary identity, immutable execution profile, and notification/server-request handlers. Composition supplies measured identity; this transport does not resolve binaries or enable consumers.
- `codex-app-server-process.ts:78`: one cached startup promise and one child per instance. A new generation requires a new instance; there is no retry or restart path.
- `codex-app-server-process.ts:83`: verify 2b's binary pin before spawning/handshake, require the identity path to match the executable source, and pass a digest launch guard for a second check at actual process creation. Spawn arguments are exactly `['app-server']`. Environment is a fresh host-environment copy with only CODEX_HOME overridden by the profile. Stderr is drained without retention. Initialize has a 10-second deadline, followed by initialized.
- `codex-app-server-process.ts:137`: typed request API uses existing 2b parameter/result contracts. Ordinary RPC deadlines are 30 seconds. A turn's notifications do not inherit a request timer after its RPC response resolves.
- `codex-app-server-process.ts:147`: pending request map is capped at 128. Invalid caller frames are rejected before sending; request timeouts close the generation and reject all pending requests. Responses are correlated only after complete frame/method validation.
- `codex-app-server-process.ts:172`: incremental byte framing uses fixed 1 MiB storage, strict UTF-8 decoding, JSON parsing, and the 2b frame validator. A fixed buffer bounds allocation overhead even for one-byte chunks. Multiple frames in one chunk are processed in order; invalid or unknown frames fail closed.
- `codex-app-server-process.ts:200`: outbound-only request methods are rejected when received from the server. Notifications and server requests reach callbacks only after validation. Remote error messages/data are never copied into local errors.
- `codex-app-server-process.ts:231`: at most 128 pending server requests, each with a five-minute deadline and AbortSignal. Replies are validated before writing. Closing aborts all pending presentations; late responses are ignored.
- `codex-app-server-process.ts:255`: outbound frames are validated and capped at 1 MiB; queued writes are capped at 4 MiB, accounting until stream write callbacks complete. No protocol payload logging.
- `codex-app-server-process.ts:298`: close is idempotent, stops sends immediately, rejects pending requests, invalidates approvals, ends stdin, waits one second, then requests SIGKILL and continues waiting for child close. Exit/error/abort paths converge here. A kill request is never treated as proof of exit. Cleanup at `:347` removes lifecycle/stream listeners and cancels the kill timer.

Repository contracts were checked in `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts:64` (complete environment/launch guard), `:99` (process handle), `:126` (spawner); existing runtime contracts in `codex-runtime-ports.ts` and `codex-runtime.types.ts`; validator/manifest implementations and validator specs; and `tools/evidence-harness.ts:574` and `:676` onward for framing, pending requests, failure and cleanup. Harness code is not imported. Root CLAUDE.md, CONTRIBUTING.md and README.md were consulted. The ptah symbol search returned zero hits for IProcessSpawner; a targeted native search located its definition.

## Specs

`codex-app-server-process.spec.ts`: 23 passing cases (including the seven-case malformed-input table):

- Pin mismatch before spawn; one handshake; isolated child environment; granular capability.
- UTF-8 fragmentation at every byte and multiple frames in one chunk.
- Oversize, malformed JSON, invalid UTF-8, unknown method, invalid result, unknown response ID, wrong method direction.
- Ten-second handshake and thirty-second ordinary RPC timeouts without retry.
- Crash mid-request, sanitized child errors, and listener cleanup.
- Out-of-order response correlation and sanitized remote errors.
- 128-request limit and blocked-pipe queued-byte limit.
- Five-minute approval deadline, validated approval response, invalid handler response, abort invalidation and ignored late response.
- Double close/dispose, one-second grace, single kill and waiting for actual stdio close.
- Terminal notification before exit and active/pre-aborted signals.

## Verification

Commands ran in the assigned worktree. PowerShell `Select-Object -Last` and `Select-String` are the equivalents of the requested tail/grep filters.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20`
   - Final exit code 0: **1 suite passed; 23 tests passed; 0 snapshots; 8.008 seconds**.
   - Earlier runs exposed a Jest mock generic mismatch (suite did not run), then insufficient microtask flushing in one spec (22 passed, 1 failed). Fixed the mock type and used Jest's async zero-time timer advance; reran the changed spec successfully.
   - Node emitted a warning about loading the existing TypeScript Jest configuration as an ES module; the final suite still passed.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 10`
   - Exit code 0: **NX Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime**.
   - Lint summary: **4 problems (0 errors, 4 warnings)**. The filtered output included `1737:7 warning There is no cause attached to the symptom error being thrown preserve-caught-error`; this filter did not retain its filename. No errors from parallel lanes required intervention.
3. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-app-server-process.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`
   - Exit code 0; both files formatted.
4. Required scoped `ptah_get_diagnostics` after edits and again after formatting: **0 errors, 0 warnings; clean coverage**. No further test/build/installation commands were run after formatting.

## Decisions

| Decision                                                                                                                                        | Options                                                                          | Evidence                                                                                                                                                                                      | Reversible                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Use `CodexExecutableManifestRow` consistently through 2a's `CodexExecutableSource.expectedManifestRow`; pass it structurally to 2b verification | 2a executable row; duplicate 2b manifest type                                    | Batch explicitly builds on the executable-source contract; `verifyCodexBinary` needs only its compatible pin fields. Neither existing type was changed; 2k owns reconciliation.               | Yes, in 2k                                                 |
| Send experimentalApi=true for every profile                                                                                                     | Granular only; every profile                                                     | The pinned validator's initialize schema requires literal true (`codex-protocol-validator.ts:539`); this includes the mandated granular case.                                                 | Yes, with a reviewed validator change                      |
| Composition supplies measured binary identity; the transport verifies it and uses the spawner digest launch guard                               | Measure identity again inside transport; use measured identity plus launch guard | Existing 2b verifier accepts identity, 2a supplies resolved executable source, platform port guarantees guard enforcement at creation. Avoids executing a version subprocess here.            | Yes                                                        |
| Clone host environment and override only CODEX_HOME                                                                                             | Replace entire environment with one key; copy environment with one override      | Plan :124 calls for a fresh child environment; platform spawner requires a complete environment; batch prohibits host mutation.                                                               | Yes                                                        |
| Fixed 1 MiB incoming frame buffer, 4 MiB outbound queue, 128 pending RPCs and 128 server requests                                               | Unbounded collections; explicit finite limits                                    | Batch requires bounded frame bytes, queued bytes and pending requests. Fixed storage also avoids growing allocation overhead under byte fragmentation.                                        | Yes, local constants                                       |
| Approval timeout or malformed protocol closes the generation; no request retry                                                                  | Continue after ambiguous state; fail closed                                      | Plan :128 forbids retry after ambiguous acceptance and requires safe disposal. Approval signal invalidation prevents late authorization.                                                      | Yes, only with an explicit reviewed recovery policy        |
| Wait for handle close after requesting kill                                                                                                     | Resolve at kill/exit; wait for drained stdio close                               | Platform handle contract requires close for stdout consumers; kill is not exit confirmation. A broken spawner that never emits close keeps teardown pending rather than claiming termination. | Yes, with a separately specified teardown-failure contract |

## Remaining integration

No batch-owned implementation or mandatory verification remains outstanding. Batch 2k owns exports/registration and manifest-type reconciliation. Composition must provide a trusted measured binary identity and handlers; production routing remains disabled. No real-binary or distribution behavior was claimed from these fake-spawner tests.
