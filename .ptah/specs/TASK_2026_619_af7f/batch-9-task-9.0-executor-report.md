# Batch 9, Task 9.0: executor report

## Work completed

Task 9.0 (handoff.md "TASK_2026_620 requests" items 1, 2 and 4) is done. Nothing was committed.

1. **Core per-suite schema** (`scorecard.types.ts`). The suite object and its kind-independent
   checks (unique baseline ids, deltas that name known baselines, `naReason` only on `na` suites)
   are now `suiteCoreSchema`. `createSuiteSchema(registry)` is exported and is built as
   `suiteCoreSchema.superRefine(<kind checks>)`. The kind checks are: the kind is registered, and
   `details` parses with that kind's schema, with issue paths prefixed by `details`.
   `createScorecardSchema` uses it as before, and `suiteSchema` is the default-registry instance.
   What validates has not changed. Zod 4 runs chained checks in order, so the kind issues now come
   after the core issues in a failed parse. No existing assertion depends on that order.
2. **`env` option on `launchBenchHost`** (`host-launcher.ts`). `HostLaunchOptions.env` is merged
   into the child environment after `isolatedEnv(tempHome)`. The refused keys are derived as
   `Object.keys(isolatedEnv('', {}))`, so there is no second hand-written list. The check runs
   first in `launchBenchHost`, before the guard is armed, before `mkdtemp`, and before the spawn,
   so a refusal leaves no guard, temp home or process behind. On win32 the comparison ignores
   case. The rejection is a `HostEnvRefusedError` that lists every refused key.
3. **`bench-host-process.ts`** (new). `readWorkspaceArg`, `shutdownRequested`, `describeFailure`
   and `FORCED_EXIT_AFTER_MS` moved here and are exported. The module has no top-level side
   effects.
   - `readWorkspaceArg` now throws `BenchHostArgumentError` instead of calling `process.exit`.
   - `describeFailure` keeps that error's message, as it does for `BenchIsolationError`.
   - The entry imports the helpers. A bad argument rejects `main()` and goes through
     `fail(describeFailure(error))`, so the fatal line (`{"benchHost":"fatal","error":"usage: ..."}`
     or the not-a-directory / unreadable messages) and exit code 1 are byte-identical to before.
   - `main()` and its order of steps stay in the entry: isolation check, then arguments, then
     shutdown.

## Exported API (for TASK_2026_620)

From `tools/mcp-bench/src/scorecard/scorecard.types.ts`:

```ts
export const suiteCoreSchema: z.ZodType<SuiteView<unknown>>;              // no registry, details unparsed
export function createSuiteSchema(registry: SuiteKindRegistry): z.ZodType<SuiteView<unknown>>;
export const suiteSchema: z.ZodType<SuiteView<unknown>>;                  // createSuiteSchema(defaultSuiteKindRegistry)
// unchanged: createScorecardSchema(registry), scorecardSchema, Scorecard, ScorecardSuite, summarizeVerdicts
```

`SuiteView<D>` and `SuiteKindRegistry` stay exported from `./suite-kinds`.

From `tools/mcp-bench/src/transport/host-launcher.ts`:

```ts
interface HostLaunchOptions { /* existing fields */ readonly env?: Readonly<Record<string, string>>; }
export function refusedEnvKeys(env: Readonly<Record<string, string>>, platform?: NodeJS.Platform): string[];
export class HostEnvRefusedError extends Error { readonly refused: readonly string[]; }
// message: "launchBenchHost: env may not set isolation keys: K1, K2"
// launchBenchHost(options) rejects with HostEnvRefusedError before arming the guard, creating a temp home or spawning.
```

The refused keys come from `isolatedEnv`: `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `PTAH_BENCH_ISOLATED_HOME`,
`PTAH_CONFIG_PATH` and `PTAH_DB_PATH`. On win32 they are compared case-insensitively.

From `tools/mcp-bench/src/transport/bench-host-process.ts`:

```ts
export const FORCED_EXIT_AFTER_MS = 20_000;
export class BenchHostArgumentError extends Error {}
export function readWorkspaceArg(argv: readonly string[]): string;        // throws BenchHostArgumentError
export function shutdownRequested(
  stdin?: NodeJS.ReadableStream,                     // default process.stdin
  signals?: Pick<NodeJS.EventEmitter, 'once'>,       // default process
): Promise<string>;                                   // 'stdin-eof' | 'SIGTERM' | 'SIGINT'
export function describeFailure(error: unknown): string;
```

## Files written

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts (now 600 lines; the max-lines limit is 700)
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-process.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-process.spec.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-9-task-9.0-executor-report.md

## Spec cases

- `scorecard.types.spec.ts`:
  - The core schema parses a minimal suite of an unregistered kind.
  - It keeps the kind-independent checks and rejects a missing field.
  - `suiteSchema` rejects that unknown kind.
  - Core and kind issues are reported together.
  - A custom registry parses `details`, with `details`-prefixed paths.
- `host-launcher.spec.ts`:
  - An extra `env` key reaches the fixture child, and the child still sees the temp home.
  - Every isolation key is refused before spawning: the marker host script never ran and no temp
    home was left. On win32 two case variants (`home`, `Ptah_Db_Path`) are refused the same way.
  - Pure `refusedEnvKeys` cases: the order is kept, the refused set is derived from `isolatedEnv`,
    and case variants are refused on win32 only.
- `bench-host-process.spec.ts`:
  - Importing the module (`jest.isolateModules` + `require`) calls no `process.on`/`once`/`exit`,
    no stdout write and no stdin resume, and adds no SIGTERM listener.
  - `readWorkspaceArg`: success and every error message.
  - `shutdownRequested`: stdin end, stdin close, SIGTERM and SIGINT.
  - `describeFailure`: each branch, including the stderr cause stack.
  - `FORCED_EXIT_AFTER_MS` is still 20 s.
- The scorecard-writers and suite-kinds specs pass unchanged.

## Verification

- `npx prettier --write <7 changed files>` reformatted 4 of the files.
- `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache --parallel=2` with
  `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe` exited 0, with
  `√ mcp-bench:typecheck`, `√ mcp-bench:lint` and `√ mcp-bench:test`, then "Successfully ran
  targets typecheck, lint, test for project mcp-bench".
  - The first run had 1 failure: the unreadable-path assertion. Inside jest the fs error comes from
    another realm, so it is stringified as `Error: ENOENT ...`. The helper code is unchanged from
    the old entry, so I loosened the assertion and re-ran.
- `npx nx run mcp-bench:test --skip-nx-cache --output-style=stream -- --maxWorkers=2` exited 0:
  `Test Suites: 14 passed, 14 total`, `Tests: 215 passed, 215 total`.
- `npx nx run mcp-bench:build-host` exited 0: "Successfully ran target build-host for project
  mcp-bench and 32 tasks it depends on". `dist/tools/mcp-bench/bench-host.mjs` was rebuilt.
- I did not launch a real bench host run, as instructed.

## Deviations

- **Two new spec files.** `scorecard.types.spec.ts` and `bench-host-process.spec.ts` are added
  beyond the 5 files Task 9.0 lists, for the spec cases the dispatcher asked for. Both sit next to
  the files they test, in the allowed directories.
- **New `HostEnvRefusedError` class.** The refusal is a typed error so TASK_2026_620 can tell it
  apart from `HostLaunchError` (a failed boot). It is not a `HostLaunchError`, because no host was
  started and no exit exists to classify.
- **Injectable `shutdownRequested` parameters.** It takes optional `stdin` and `signals` arguments
  (defaulting to `process.stdin` and `process`) so the spec can drive it without touching the real
  process. With no arguments it behaves exactly as before.
- **Refused-key check runs before the guard is armed**, not only before the spawn. That is a
  stricter reading of "rejects before spawning ... no temp home is left behind".
