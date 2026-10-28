# Batch 4 report: user console spawn mode (TASK_2026_719_4f64)

Executor: backend-developer (Claude subagent). Worktree:
`D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`.

## Task 4.1: `ProcessSpawnRequest.userConsole` with `ignore` stdio. Implemented

What was built, against plan "Component specifications § 5" (lines 540-550), handoff row B4
(line 1025) and regression row 884:

- **Port** (`process-spawner.interface.ts`): additive `readonly userConsole?: true` on
  `ProcessSpawnRequest`. The doc comment says: Windows only, a new visible console, three `ignore`
  stdio slots, handle streams `null`, `close` fires on exit, non-win32 gives an `error` event with
  code `ENOTSUP` and no child, and `needsConsole` keeps its meaning.
- **Protocol** (`spawn-worker-pool.ts`): new `StdioMode = 'pipe' | 'ignore'`. The `spawn` variant
  of `HostMessage` now has a required `stdioMode` field.
- **Worker program** (`off-thread-process-spawner-source.ts`): for `stdioMode === 'ignore'` the
  worker passes `stdio: ['ignore','ignore','ignore']` and attaches no stdout listeners. It posts
  `stdout-end` once, right after `spawned`. Any other value, including an absent one, keeps the
  old piped shape. The launch-guard check still runs first, unchanged. `windowsHide` is still an
  explicit key. The header protocol comment is updated.
- **Host spawner** (`off-thread-process-spawner.ts`):
  - `SpawnPlan.stdioMode` (the plan field at `:145`).
  - `spawnProcess` behaviour:
    - When `userConsole` is set and `process.platform !== 'win32'`, it returns a
      `RefusedProcess`. That handle has no child and null streams. `whenSpawned` resolves `null`.
      On the next turn it emits `error` (code `ENOTSUP`) and then `close(null, null)`, the same
      order as a failed worker spawn.
    - Otherwise the plan gets `windowsHide: !userConsole && needsConsole !== true`,
      `stdioMode: 'ignore'` and `stderrMode: 'ignore'`. The `launchGuard` is still forwarded.
  - `WorkerBackedProcess` makes no stdin, stdout or stderr streams for `'ignore'`. Its
    stdout/stderr start as already drained, so `close` follows `exit`. Every use of a stream in
    the class is null-safe.
  - `spawnInline` uses three `ignore` slots for `'ignore'`. `InlineProcess` throws "without stdio
    pipes" only when the plan asked for pipes.
  - Both handle classes now implement `SpawnedProcessHandle`, whose streams can be null.
  - The SDK seam `spawn()` asks for `stdioMode: 'pipe'`. It narrows its result to
    `PtahSpawnedProcess` with a runtime type guard, `hasStdioPipes`, instead of a cast. Its
    behaviour is unchanged.

Acceptance evidence. These are new specs in `off-thread-process-spawner.spec.ts`, describe
`userConsole (TASK_2026_719 Batch 4)`:

| Acceptance | Spec |
| --- | --- |
| Worker mode: null streams, `windowsHide:false`, ignore stdio, launch guard forwarded, close on exit | `worker transport: ignore stdio, null streams, a visible console, and close on exit` |
| Worker program spawns with ignore stdio: no stdout/stderr messages, exactly one `stdout-end`, exit 0 | `the worker program gives an ignore-stdio child no pipe and still ends stdout once` |
| Inline mode: null streams instead of the "without stdio pipes" throw | `inline transport: ignore stdio gives null streams instead of throwing` |
| Non-win32 refuses with an `error` event and no child | `refuses on darwin` / `refuses on linux` (`it.each`): `ENOTSUP`, `close(null)`, `whenSpawned` null, no `spawn` message posted |
| Pipe cases and `needsConsole` unchanged | `needsConsole is unchanged and a plain request still pipes` (`stdioMode:'pipe'`, `stderrMode:'stream'`, `windowsHide:false`, non-null streams), plus every existing case in the file, unedited |

No spec creates a visible console, conhost or claude (rule 7):

- The worker-transport cases answer the `spawn` message from a fake worker
  (`jest.spyOn(Worker.prototype, 'postMessage')`, a prototype spy, not a module namespace, so
  rule 3 holds). No child is created.
- The test of the worker program uses `windowsHide: true`.
- The inline case starts the absolute node binary with a `cwd` under `os.tmpdir()` that does not
  exist. Process creation fails with `ENOENT`, so no process starts. The binary is an `.exe`, so
  cross-spawn does not wrap it in `cmd.exe`.
- The platform is faked with `Object.defineProperty(process, 'platform')` and restored in
  `afterEach`, as other agent-sdk specs already do (`claude-cli-detector.spec.ts`).

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/platform-core/src/interfaces/process-spawner.interface.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner-source.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/spawn-worker-pool.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`
- CREATED this report.

No other file was touched. The Batch 2 and Batch 3 files in `git status` belong to the
developers running in parallel.

## Specs that mock or pin the changed members (rule 5)

I grepped spec files for `ProcessSpawnRequest`, `HostMessage`, `StderrMode`,
`OFF_THREAD_SPAWNER_WORKER_SOURCE` and `OffThreadProcessSpawner`.

- `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`: extended. Its
  existing cases are not edited. The raw-worker launch-guard case at `:1086` posts a `spawn`
  message with no `stdioMode`. It keeps working because an absent value means piped.
- `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.perf.spec.ts`: uses
  `spawn()` and the piped path. Unchanged.
- `libs/backend/agent-sdk/src/lib/detector/windows-hide-spawn.guard.spec.ts`: both edited spawn
  calls still carry an explicit `windowsHide:` key. Unchanged.
- `spawn-worker-pool.spec.ts`: never builds a `spawn` `HostMessage` (grep for `type: 'spawn'`
  found none outside the spawner and its spec). Unchanged.
- These specs only type fake spawners against `ProcessSpawnRequest`, and the new field is
  optional, so they are unaffected:
  - `sdk-model-service*.spec.ts`
  - `sdk-query-runner.service.spec.ts`
  - `provider-account-actions.service.spec.ts`
  - `codex-account-usage.service.spec.ts`
  - `cli-adapter.utils.spec.ts`
  - `register.ptah-cli-registry.smoke.spec.ts`
  - `editor-merge.real.spec.ts`
  - `github-pr-status.reader.spec.ts`
  - the workspace-intelligence checker specs
  - `apps/ptah-electron/src/di/container.smoke.spec.ts`
- Ambient-path pins (plan 943-953): no Claude ambient-path code was touched.

## Verification

- `ptah_get_diagnostics` with `files` set to the 5 changed files: **Errors 0, Warnings 0,
  coverage clean**.
- Rule 12: I did not run `npm run verify` or any Jest suite. The team-leader's scoped command
  for this batch is
  `npm run verify -- -t lint,test,typecheck -p @ptah-extension/platform-core,@ptah-extension/agent-sdk`
  (N = 2). The new specs and the three "unchanged, must pass" specs above have not been run yet.

## Risks and how they were handled

- **Non-win32 console start must be `unavailable` and lead to the fallback (edge case, Tasks 4,
  6, 8).** The spawner refuses with `error` code `ENOTSUP` and then `close`, and creates no
  child. B6's `ClaudeLoginConsole` can map that `error` to `{ kind: 'unavailable' }`.
- **The launch guard stays mandatory.** The guard is forwarded unchanged on both transports,
  and the worker still checks it before anything else. The inline path still throws
  `ELAUNCHGUARD` as before. The worker-mode spec asserts the guard reaches the `spawn` message.
- **The `windows-hide-spawn` guard.** `windowsHide` stays an explicit key in both `spawn` calls.
- **SDK seam regression.** `spawn()` always pipes. The type guard proves this without a cast,
  and the existing stdio, termination, reuse and inline cases are untouched.
- **Ambient expectation drift (HIGH).** No ambient-path file or pin was touched.

## Decisions

- **Refusal code.** Decision: `ENOTSUP` (the standard "operation not supported" errno). Option
  rejected: a new exported constant next to `LAUNCH_GUARD_REFUSED`. Evidence: exporting a
  constant needs `platform-core/src/index.ts`, which is outside this batch's file list. Reversible:
  a constant can be added later without changing the value.
- **Platform source.** Decision: the spawner reads `process.platform` when the call is made,
  rather than taking an injected platform. Options: a new DI injection, or the call-time read.
  Evidence: the batch says "DI guard: none". An injected platform would need a token and
  registrations in every container, which is more than 6 files. B6's `ClaudeLoginConsole` gets
  the injected platform, as the plan states. The spawner check is defence in depth and specs
  override it with `Object.defineProperty`. Reversible.
- **Handle typing.** Decision: both handle classes implement `SpawnedProcessHandle` with
  nullable streams, and the SDK seam narrows with the `hasStdioPipes` type guard. Option
  rejected: a cast or a duplicate stdio-less worker class. Evidence: the repository's rule
  against untyped escape hatches. Reversible.

## Out-of-scope observations

- `HostMessage`'s `spawn` variant does not declare `launchGuard`. The host adds it through a
  conditional spread, so the type does not describe it, although it is sent at runtime. This is
  older than this batch and was left untouched.
