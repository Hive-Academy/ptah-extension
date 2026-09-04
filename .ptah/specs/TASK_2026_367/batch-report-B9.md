# Batch B9 — off-thread spawn for `spawnCli` and `probeCliVersion`

Executor: backend-developer. Date: 2026-09-03. Branch: `fix/log-defects-367`.
Machine: Windows 11, Node 24.15.0. Work done in place, nothing committed.

---

## 1. Files created

| File                                                                     | What it is                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/platform-core/src/interfaces/process-spawner.interface.ts` | The type-only port: `ProcessSpawnRequest`, `SpawnedProcessHandle`, `IProcessSpawner`, plus the two listener aliases. No DI token, no dependency on `agent-sdk`, on `cross-spawn` or on `child_process`. |

## 2. Files modified

| File                                                                          | Change                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/platform-core/src/index.ts`                                     | One `export type { ... }` block for the new port.                                                                                                                                                 |
| `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`        | `implements IProcessSpawner`; new `spawnProcess(request)`; internal `SpawnPlan` that both seams normalise into; `stderr` stream, `pid`, `whenSpawned` and a `close` event on both handle classes. |
| `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner-source.ts` | Additive worker-protocol fields (see section 3).                                                                                                                                                  |
| `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`   | New `describe('spawnProcess - the IProcessSpawner port')` with 7 cases.                                                                                                                           |
| `libs/backend/cli-agent-runtime/.../cli-adapter.utils.ts`                     | `spawnCli` gains `options.spawner?` and returns a `SpawnedProcessHandle`; new `ChildProcessHandle` wrapper for the no-spawner path; `probeCliVersion` gains a 4th `spawner?` parameter.           |
| `libs/backend/cli-agent-runtime/.../cli-adapter.utils.spec.ts`                | New `describe('spawnCli')` (4 cases) and 2 new `probeCliVersion` cases.                                                                                                                           |
| `libs/backend/cli-agent-runtime/.../antigravity-cli.adapter.ts`               | Constructor takes `spawner?`; forwarded to `probeCliVersion`, `probeModels` and the run spawn; tree kill awaits `whenSpawned`.                                                                    |
| `.../opencode-cli.adapter.ts`                                                 | Same.                                                                                                                                                                                             |
| `.../pi-cli.adapter.ts`                                                       | Same (`killChild` awaits `whenSpawned`).                                                                                                                                                          |
| `.../copilot-sdk.adapter.ts`                                                  | Same, with `spawner?` appended after `permissionBridge`.                                                                                                                                          |
| `.../cli-detection.service.ts`                                                | Injects `SDK_TOKENS.SDK_PROCESS_SPAWNER`, typed as `IProcessSpawner`, and passes it to the four adapters.                                                                                         |
| The four adapter spec files + `antigravity-cli.adapter.mcp.spec.ts`           | Fake children gained `whenSpawned`; three copilot assertions updated (see section 6).                                                                                                             |
| `libs/backend/agent-sdk/CLAUDE.md`                                            | New bullet on the two seams and the protocol additions.                                                                                                                                           |
| `libs/backend/cli-agent-runtime/CLAUDE.md`                                    | New bullet: rival-CLI spawns go through the injected spawner.                                                                                                                                     |

**Codex is untouched.** `codex-cli.adapter.ts` runs `@openai/codex-sdk` in
process and never calls `spawnCli`. Cursor is untouched for the same reason.
No composition root, no `register.ts`, no `expected-resolvable.ts`, no new token.

## 3. Worker-protocol additions

All additive. The SDK seam sends the same values it always did, so its
behaviour does not change.

**host to worker, on the `spawn` message:**

- `stderrMode: 'stream' | 'callback' | 'ignore'` — replaces the boolean
  `wantStderr`. `'callback'` is the SDK seam (decode in the worker, post
  `stderr` text). `'stream'` posts raw bytes so the host can expose a real
  `Readable`; decoding in the worker would split a multi-byte character across
  two chunks, and the adapters call `setEncoding('utf8')` on the stream.
- `detached: boolean` — was hardcoded absent.
- `windowsHide: boolean` — was hardcoded `true`.
- `windowsVerbatimArguments: boolean` — was hardcoded absent.

**worker to host:**

- `{ type: 'stderr-chunk', chunk: Uint8Array }` — stream mode only.
- `{ type: 'stderr-end' }` — stream mode only.

**Exposed on the host, from the existing `spawned` message:** `pid` (synchronous
read, `undefined` until the worker reports) and `whenSpawned: Promise<number |
null>`. `whenSpawned` also settles on failure and on `forceTerminate`, so an
awaiting tree kill can never hang.

**`close` is new on both handle classes.** It fires once the child settled AND
stdout (and, in stream mode, stderr) drained. Every rival-CLI adapter parses its
last JSONL line inside `close`; `exit` alone can arrive with output still in
flight. The SDK reads only `exit`, so this is additive for that seam.

## 4. How R1, R2 and R3 are closed

### R1 — Windows `.cmd` wrapper resolution

**Mechanism.** `OffThreadProcessSpawner.spawnProcess` calls `cross-spawn`'s
parser on the HOST thread, through its published `_parse` export, and sends the
already-resolved `command`, `args` and `windowsVerbatimArguments` to the worker.
The worker still spawns with plain `node:child_process.spawn` and contains no
`require` of `cross-spawn`. The worker source header now says so explicitly.

**Deviation from the plan, and why.** The plan wrote
`require('cross-spawn/lib/parse')`. `crossSpawn._parse` is the same function
reached through the package's own entry point, so a static `import crossSpawn
from 'cross-spawn'` is enough and esbuild has no deep subpath to resolve in a
bundled Electron app. The parse lives in `agent-sdk`, not in `spawnCli`, so
`ProcessSpawnRequest` carries no `windowsVerbatimArguments` field: resolving the
command is the implementation's job, and a caller passes the same `command` on
every platform.

**Proved on this machine by** `off-thread-process-spawner.spec.ts`:

- `runs a .cmd wrapper and matches inline cross-spawn byte for byte` — writes a
  real `.cmd` into a temp directory, runs it through `spawnProcess`, and asserts
  its stdout equals what inline `crossSpawn` produces for the same wrapper and
  args. Argument quoting included, which is where a hand-rolled rewrite would
  differ. **Ran green (not skipped) on this Windows machine.**
- `sends cmd.exe and windowsVerbatimArguments to the worker` — asserts the spawn
  message carries a `cmd.exe` command, `windowsVerbatimArguments: true`, and the
  wrapper path inside the `/c` argument.

Both are gated by `process.platform === 'win32'` and both executed here.

### R2 — `killProcessTree` and the pid

**Mechanism.** `SpawnedProcessHandle.whenSpawned`. Every tree-kill site in the
four adapters now reads the pid from it instead of from `handle.pid`.
`handle.kill()` itself was already safe: `WorkerBackedProcess` queues a kill
that arrives before the pid lands.

**Proved on this machine by:**

- `off-thread-process-spawner.spec.ts` → `resolves whenSpawned with the CHILD
process pid`: the child prints `process.pid` on stdout and the spec asserts
  `await whenSpawned` equals it. This proves the pid crossing the port is the
  CHILD's, not the worker's or the host's — the exact thing `taskkill /T` walks
  from.
- `antigravity-cli.adapter.spec.ts` → `tree-kills with the pid whenSpawned
reports, not the synchronous one`: the fake child has `pid: undefined` and a
  `whenSpawned` resolving to `7777`, and the spec asserts `killProcessTree` was
  called with `7777`. Under the old code this call would not have happened at
  all.
- The four adapters' existing tree-kill specs still assert the same pid.

### R3 — ConPTY console

**Mechanism.** `needsConsole` travels on `ProcessSpawnRequest` and maps to
`windowsHide: false` on the spawn message. Default stays `windowsHide: true`.

**Proved on this machine by:**

- `off-thread-process-spawner.spec.ts` → `gives the child its own console when
needsConsole is set` (asserts `windowsHide === false` on the spawn message)
  and `forwards detached to the worker and hides the console by default`
  (asserts `windowsHide === true`, `detached === true`).
- `cli-adapter.utils.spec.ts` → `forwards needsConsole and detached to the
spawner on POSIX` — proves `spawnCli` puts both on the request.

`windowsHide` has no effect a spec can read back off a child process, so the
assertion is on the message that crosses the port. It is read with
`jest.spyOn(Worker.prototype, 'postMessage')`, which keeps the real
implementation, so the child still runs in the same test.

## 5. Spec assertions added

`off-thread-process-spawner.spec.ts` (7 new, all green here):

1. `whenSpawned` resolves with the child's own pid, and `pid` matches it.
2. stderr arrives as a `Readable`, separate from stdout, with
   `stderrMode: 'stream'` on the wire.
3. `close` fires only after a 100 KB stdout has drained.
4. `detached: true` reaches the worker; `windowsHide` defaults to `true`.
5. `needsConsole: true` maps to `windowsHide: false`.
6. A real `.cmd` wrapper runs and matches inline `cross-spawn` exactly (Windows).
7. The spawn message carries `cmd.exe` and `windowsVerbatimArguments` (Windows).

`cli-adapter.utils.spec.ts` (6 new):

1. No spawner: `cross-spawn` is called once with the same binary, args, `cwd` and
   `stdio` as before, and the handle exposes that child's stdout. The
   no-regression assertion.
2. With a spawner: `cross-spawn` is NOT called; the request carries command,
   args, `cwd`, and the `CLI_CLEAN_ENV` defaults with the caller's env winning.
3. `needsConsole` and `detached` are forwarded on POSIX.
4. `detached` is never requested on Windows, where `taskkill /T` walks the tree.
5. `probeCliVersion` returns the first stdout line through a fake spawner.
6. `probeCliVersion` kills the child and returns `undefined` on timeout.

`antigravity-cli.adapter.spec.ts` (1 new): the R2 deferred tree kill.

## 6. Existing specs that had to change

- The four adapter specs plus `antigravity-cli.adapter.mcp.spec.ts`: their fake
  children gained `whenSpawned`, because `spawnCli` now returns a
  `SpawnedProcessHandle`.
- `copilot-sdk.adapter.spec.ts`: `forwards the resolved binary path to
probeCliVersion` now expects the probe's trailing default arguments and the
  spawner slot. Its two abort specs await one microtask turn before asserting
  `killProcessTree`, because the tree kill now goes through `whenSpawned`.

No production behaviour was weakened to make a spec pass.

## 7. Verification

```
npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime
```

Header read: `Running target test for 3 projects` — confirmed 3.

| Project             | Suites                         | Tests                                   |
| ------------------- | ------------------------------ | --------------------------------------- |
| `platform-core`     | 29 passed, 1 failed, 30 total  | 539 passed, 4 todo, 1 failed, 544 total |
| `agent-sdk`         | 84 passed, 1 skipped, 85 total | 1381 passed, 2 skipped, 1383 total      |
| `cli-agent-runtime` | 45 passed, 45 total            | 550 passed, 550 total                   |

**The one `platform-core` failure is a timing benchmark, not a regression.**
`file-settings-manager.bench.spec.ts` asserts that per-write cost stays flat over
1000 sequential `set()` calls. It failed only while three projects ran in
parallel on this box. Re-run alone it passes:
`[bench] 1000 sequential set() calls: total=983.9 ms, avg=0.98 ms/write,
head=251.7 ms, tail=289.5 ms, ratio=1.15` — `2 passed, 2 total`. This batch's
whole `platform-core` change is one type-only file and one barrel `export type`
line, neither of which is reachable from that benchmark.

```
npx nx run-many -t lint -p @ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime
```

`Successfully ran target lint for 3 projects`. 0 errors. Warnings only, all
pre-existing: platform-core 8, agent-sdk 38, cli-agent-runtime 36. No new
`max-lines` warning — `off-thread-process-spawner.ts` is 743 raw lines but the
rule uses `skipBlankLines` and `skipComments`.

```
npm run typecheck:all
```

`Successfully ran target typecheck for 70 projects`.

No specs under `ptah-cli/` or `message-transform/` failed, so there is nothing
to report back to the other executors.

## 8. Deviations from the plan

1. **`SpawnedProcessHandle` also declares a `close` event.** The plan's shape
   had `exit` and `error` only. All four adapters listen on `close` and none on
   `exit`, and `close` is the correct one: it means "the child ended AND stdout
   drained". Shipping the plan's literal shape would have forced the adapters
   onto `exit` and silently dropped trailing output. Pinned by `emits close only
after stdout has drained`.
2. **`stdin` and `stdout` on the handle are nullable.** `ChildProcess` types
   both as nullable, so a non-null port would have needed a throw on the
   no-spawner path — new failure behaviour on the path that must not change.
   The adapters already use `child.stdin?.` and `child.stdout?.`, so nullable
   costs them nothing.
3. **The `cross-spawn` parse lives in `agent-sdk`, not in `spawnCli`**, and is
   reached as `crossSpawn._parse` rather than `require('cross-spawn/lib/parse')`.
   Reasons in section 4 (R1).
4. **`wantStderr` was replaced by `stderrMode` rather than kept beside it.** Both
   halves of the protocol change together and nothing else speaks it, so a
   legacy field would have been dead weight in a body that is neither
   type-checked nor linted.
5. **The adapters' `spawner` is an optional constructor parameter.** That keeps
   every existing `new XCliAdapter()` in the specs valid and makes the injected
   path the only thing under test that is new.

## 9. Left undone

- **Nothing in scope.** All four adapters, the version probe,
  `CliDetectionService`, both CLAUDE.md files and every listed spec are done.
- **Not attempted, and out of scope by the plan:** Codex CLI spawn latency
  (section 0.2 item 3 — `@openai/codex-sdk` runs in process) and Cursor.
- **One pre-existing type error is NOT mine and I did not touch it:**
  `libs/backend/cli-agent-runtime/src/lib/ptah-cli/testing/fake-sdk-process-spawner.ts`
  reports `Cannot find name 'jest'` under
  `tsc -p libs/backend/cli-agent-runtime/tsconfig.lib.json` (9 errors). The file
  is another executor's uncommitted work under `ptah-cli/**`, which this batch
  must not touch. It does not affect `npm run typecheck:all`, which passes, but
  the owning executor should either move the file under a `*.spec` glob or add
  the jest types to the lib tsconfig.
- **`cross-spawn`'s ENOENT hook is not replicated on the worker path.**
  `crossSpawn()` wraps the child so that a missing `.cmd` target reports ENOENT
  instead of a bare `cmd.exe` exit 1. `spawnProcess` uses the parser only, so on
  that one path a missing wrapper surfaces as a non-zero exit rather than an
  `error` event. No caller is affected today: `detect()` resolves the binary with
  `which` before spawning, and `probeCliVersion` returns `undefined` on either
  signal. Worth knowing before a caller starts reading `error.code`.

DONE: B9 — rival-CLI spawns and the `--version` probe now run on a worker thread; `.cmd` resolution, the tree-kill pid and the ConPTY console are each pinned by a spec that ran green on Windows.
