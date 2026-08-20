# P3 Pre-Move Baseline — Layout / Terminal / Update Handler Families

TASK_2026_171, Phase P3 (Handler unification, Electron-first). This document
is the PRE-MOVE snapshot for the three handler families about to move from
`apps/ptah-electron/src/services/rpc/handlers/` into
`libs/backend/rpc-handlers/`. Diff the post-move state against this file to
satisfy acceptance criteria #4 ("per-host registered-method snapshots
identical to pre-refactor") and #5 ("Electron test suite identical to
baseline at every phase gate").

Recorded 2026-08-03 on branch `ak/license-server-validation-pipe`, repo
`D:/projects/ptah-extension`. Read-only investigation — no production source
was modified to produce this baseline.

## 1. Existing test inventory

| Family            | Handler file                                                                       | Spec file(s)                  | Status          |
| ----------------- | ---------------------------------------------------------------------------------- | ----------------------------- | --------------- |
| Layout            | `apps/ptah-electron/src/services/rpc/handlers/layout-rpc.handlers.ts` (81 lines)   | **none**                      | **NO COVERAGE** |
| Terminal          | `apps/ptah-electron/src/services/rpc/handlers/terminal-rpc.handlers.ts` (99 lines) | **none**                      | **NO COVERAGE** |
| Update (handlers) | `apps/ptah-electron/src/services/rpc/handlers/update-rpc.handlers.ts` (66 lines)   | `update-rpc.handlers.spec.ts` | Covered         |
| Update (schema)   | `apps/ptah-electron/src/services/rpc/handlers/update-rpc.schema.ts` (19 lines)     | `update-rpc.schema.spec.ts`   | Covered         |

Confirmed via `Glob('apps/ptah-electron/src/services/rpc/handlers/layout*')` and
`Glob('.../terminal*')` — each returns only the handler `.ts` file, no
`.spec.ts` sibling. Confirmed at runtime: `npx nx test ptah-electron
--testPathPatterns="layout-rpc|terminal-rpc"` (Jest 30 flag, see §2 note)
prints `No tests found, exiting with code 0`. **Layout and Terminal have
zero automated coverage today.** Any regression introduced by the move
would currently be caught by nothing except manual QA — this is the gap
§4 addresses.

### What the existing Update specs assert (verbatim inventory)

`update-rpc.handlers.spec.ts` — constructs `UpdateRpcHandlers` directly (no
DI container) with `createMockRpcHandler()` / `createMockLogger()` and a
hand-rolled `MockUpdateManager`, then drives it through
`rpcHandler.handleMessage()`:

- `describe('update:get-state')`
  - `returns the current lifecycle state from updateManager` — asserts
    `raw.success === true`, the returned `data.state` deep-equals a full
    `available` lifecycle object (`currentVersion`, `newVersion`,
    `downloadUrl`, `releaseUrl`), and `updateManager.getCurrentState()` was
    called exactly once.
  - `returns { state: "idle" } when no update activity has occurred` —
    asserts `data.state` equals `{ state: 'idle' }`.
- `describe('update:check-now')`
  - `calls updateManager.triggerCheck() and returns { success: true }` —
    happy path, asserts `data.success === true` and
    `triggerCheck` called once.
  - `returns { success: false, error } inside data when triggerCheck
throws` — asserts the rejection is swallowed into
    `{ success: false, error: 'Network unreachable' }` (never thrown to the
    RPC boundary), and `logger.error` was called with a message containing
    `'[UpdateRpcHandlers] update:check-now failed'` plus an `Error` instance.
  - `does not throw to the RPC boundary when triggerCheck rejects` —
    asserts `rpcHandler.handleMessage(...)` resolves (`.resolves.not.toThrow()`)
    even when `triggerCheck` rejects with a generic `Error('timeout')`.

`update-rpc.schema.spec.ts` — pure Zod schema tests, no handler instantiation:

- `describe('UpdateGetStateSchema')`
  - `parses an empty object successfully`
  - `strips unknown extra fields (no .strict())`
- `describe('UpdateCheckNowSchema')`
  - `parses an empty object successfully`
  - `returns an empty object on success`
  - `strips unknown extra fields (no .strict())`

Both schemas are `z.object({})` — every method accepts an empty payload;
nothing to validate structurally beyond "extra keys are stripped, not
rejected."

## 2. Recorded baseline test run (real output)

Command used (note: this Nx workspace runs **Jest 30**, which renamed the
CLI flag from `--testPathPattern` to `--testPathPatterns`; the task
instructions' suggested `--testPathPattern` is silently ignored by the
`@nx/jest:jest` executor on this version — it ran the FULL suite (147
tests across 15 files) instead of filtering, which is itself worth noting
so nobody trusts a `--testPathPattern` filter that silently didn't filter):

```
cd D:/projects/ptah-extension
npx nx test ptah-electron --testPathPatterns="update-rpc" --skip-nx-cache
```

Real output:

```
> nx run ptah-electron:test --testPathPatterns=update-rpc

Test Suites: 2 passed, 2 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        6.464 s, estimated 32 s
Ran all test suites matching update-rpc.

 NX   Successfully ran target test for project ptah-electron
```

Breakdown (from the spec source, since this workspace's Jest reporter does
not print per-test names even with `--verbose` — confirmed by running both
`nx test ... --verbose` and `npx jest --config apps/ptah-electron/jest.config.ts
--testPathPatterns="update-rpc" --verbose` directly; both print only the
summary, no `✓`/`✗` per-test lines):

- `update-rpc.handlers.spec.ts` → 5 tests (2 in `update:get-state`, 3 in
  `update:check-now`)
- `update-rpc.schema.spec.ts` → 5 tests (2 in `UpdateGetStateSchema`, 3 in
  `UpdateCheckNowSchema`)
- Total: **2 suites, 10 tests, 10 passed, 0 failed, 0 skipped**

Negative-control confirmation (Layout/Terminal have no specs to run):

```
cd D:/projects/ptah-extension
npx nx test ptah-electron --testPathPatterns="layout-rpc|terminal-rpc" --skip-nx-cache
```

```
> nx run ptah-electron:test --testPathPatterns=layout-rpc|terminal-rpc

No tests found, exiting with code 0

 NX   Successfully ran target test for project ptah-electron
```

Full-suite baseline (for the "Electron test suite identical to baseline at
every phase gate" acceptance criterion — this is the number a post-move
`nx test ptah-electron` run must match exactly):

```
cd D:/projects/ptah-extension
npx nx test ptah-electron --testPathPatterns="update-rpc" --skip-nx-cache
```

also incidentally exercised via the mis-flagged full-suite run:

```
Test Suites: 1 skipped, 14 passed, 14 of 15 total
Tests:       4 skipped, 143 passed, 147 total
Snapshots:   0 total
```

**Recommended full baseline command** for future phase gates (this is the
one to snapshot before/after each P3 batch):

```
cd D:/projects/ptah-extension
npx nx test ptah-electron --skip-nx-cache
```

Expected: `Test Suites: 1 skipped, 14 passed, 14 of 15 total` /
`Tests: 4 skipped, 143 passed, 147 total`. (The 1 skipped suite / 4 skipped
tests predate this investigation and are unrelated to Layout/Terminal/
Update — do not assume they are related to this task without separately
verifying which suite is skipped.)

No errors, no broken baseline — the Update family's existing coverage runs
clean.

## 3. Registered-method snapshot (pre-move, to diff post-move against)

Concrete method strings each class registers at runtime (from `register()`
in each handler file):

| Method             | Registering class     | File                          |
| ------------------ | --------------------- | ----------------------------- |
| `layout:persist`   | `LayoutRpcHandlers`   | `layout-rpc.handlers.ts:39`   |
| `layout:restore`   | `LayoutRpcHandlers`   | `layout-rpc.handlers.ts:62`   |
| `terminal:create`  | `TerminalRpcHandlers` | `terminal-rpc.handlers.ts:49` |
| `terminal:kill`    | `TerminalRpcHandlers` | `terminal-rpc.handlers.ts:84` |
| `update:get-state` | `UpdateRpcHandlers`   | `update-rpc.handlers.ts:36`   |
| `update:check-now` | `UpdateRpcHandlers`   | `update-rpc.handlers.ts:46`   |

All six are already declared in the manifest at
`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:361-375` as
**host-owned** entries (implementation still lives in the app, per the
manifest's own doc comment at lines 6-12):

```ts
{ key: 'host.layout', methods: ['layout:persist', 'layout:restore'], requires: ['layoutPersistence'] },
{ key: 'host.terminal', methods: ['terminal:create', 'terminal:kill'], requires: ['pty'] },
{ key: 'host.update', methods: ['update:get-state', 'update:check-now'], requires: ['appUpdater'] },
```

Capability vocabulary source: `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`
— `layoutPersistence` (line 56), `pty` (line 58), `appUpdater` (line 60),
all three tagged "host UI surfaces."

### Per-host capability answers (from each app's `HostProfile`)

| Capability          | Electron (`apps/ptah-electron/src/rpc-host-profile.ts`) | VS Code (`apps/ptah-extension-vscode/src/rpc-host-profile.ts`) | CLI (`libs/backend/cli-engine/.../cli-host-profile.ts`, `host: 'cli'`) | TUI (same file, `host: 'tui'`) |
| ------------------- | ------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| `layoutPersistence` | **true**                                                | false (omitted → default)                                      | false (omitted → default)                                              | false (omitted → default)      |
| `pty`               | **true**                                                | false (omitted → default)                                      | false (omitted → default)                                              | false (omitted → default)      |
| `appUpdater`        | **true**                                                | false (omitted → default)                                      | false (omitted → default)                                              | false (omitted → default)      |

Electron's profile (`rpc-host-profile.ts:29-47`) turns on all three and
supplies the implementations via `hostHandlers`:

```ts
hostHandlers: {
  'host.fileOpen': EditorRpcHandlers,
  'host.editorRevert': EditorRpcHandlers,
  'host.editorPane': EditorRpcHandlers,
  'host.layout': LayoutRpcHandlers,
  'host.terminal': TerminalRpcHandlers,
  'host.update': UpdateRpcHandlers,
},
```

VS Code's profile explicitly omits `layoutPersistence`/`pty`/`appUpdater`
from `capabilities({...})` (`rpc-host-profile.ts:24-30`, only `fileOpen`,
`filePicker`, `filePickerImages`, `editorRevert`, `commandExecution` are
on) — the doc comment at the top of the file states the reasoning: "the IDE
already owns the file tree, settings, search, terminal and updates, so
those surfaces stay off." This is corroborated by
`apps/ptah-extension-vscode/src/di/expected-absent.ts:50-63`, which lists
`layoutPersistence`, `pty`, `appUpdater` in `EXPECTED_ABSENT_CAPABILITIES` —
a negative container smoke test that would fail if VS Code ever resolved
these.

CLI/TUI's shared profile (`cli-host-profile.ts:26-35`) turns on backend
subsystems (`memory`, `skillSynthesis`, `cron`, `gateway`, `voice`,
`persistence`, `workspaceLifecycle`) plus `filePicker` for the TUI only,
but never touches `layoutPersistence`/`pty`/`appUpdater` — they stay at the
`ALL_DISABLED` default. Corroborated by
`libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:19-29`, which lists
all three in the headless `EXPECTED_ABSENT_CAPABILITIES` (shared by both
`cli` and `tui`).

**Conclusion — the snapshot to preserve**: `layout:persist`,
`layout:restore`, `terminal:create`, `terminal:kill`, `update:get-state`,
`update:check-now` are registered on **Electron only**. VS Code, CLI, and
TUI must continue to resolve none of these six methods after the move.
Post-move, the manifest entries' `handler` field should be populated (moving
these from "host-owned" to "library-owned, capability-gated" — the same
shape as e.g. the `layoutPersistence`-free `command`/`fileSystem` entries
already are), and Electron's `hostHandlers` map should drop the three keys
since the library now owns them directly — but the **method-to-capability
mapping and the true/false answer per host must not change**.

Also confirmed elsewhere in the codebase that these six method names are
correctly declared for the RPC dual-registration rule (both halves already
exist and are not part of what's moving):

- Compile-time: `libs/shared/src/lib/types/rpc.types.ts` — type entries at
  lines 1070/1074 (layout), 1278/1282 (terminal), 1767/1771 (update); the
  `RPC_METHOD_NAMES` registry booleans at lines 2741-2742, 2787-2788,
  2932-2933.
- Runtime: `libs/backend/vscode-core/src/messaging/rpc-handler.ts` —
  `ALLOWED_METHOD_PREFIXES` already contains `'layout:'` (line 64),
  `'terminal:'` (line 68), `'update:'` (line 83). No change needed here for
  the move itself.

## 4. Characterization-test recommendations (Layout + Terminal, pre-move)

Layout and Terminal have zero tests today. Before moving either family,
add characterization tests that pin CURRENT behavior — including the odd
bits — so the move is provably behavior-preserving. Suggested file
locations, following the exact pattern already used by
`update-rpc.handlers.spec.ts` (construct the class directly with mocks, no
DI container, drive it via `createMockRpcHandler()` + `handleMessage()`):

### `layout-rpc.handlers.spec.ts` (new, mirrors `update-rpc.handlers.spec.ts`)

Mocks needed: `createMockLogger()`, `createMockRpcHandler()`, and a hand-rolled
`MockStateStorage` satisfying `IStateStorage` (`get<T>(key, default)`,
`update(key, value)`).

`describe('layout:persist')`:

1. **Happy path — persists and returns success.** Call with a non-empty
   params object (e.g. `{ sidebarWidth: 280 }`); assert
   `stateStorage.update` was called once with
   `('electron.layout.state', { sidebarWidth: 280 })` and the RPC result is
   `{ success: true }`.
2. **Empty/undefined params — no-op, still returns success.** Call with
   `params: undefined` and separately `params: {}`; assert
   `stateStorage.update` is NEVER called (guarded by
   `Object.keys(params).length > 0` at layout-rpc.handlers.ts:43) yet the
   result is still `{ success: true }` — this is a real behavioral branch,
   not just an edge case.
3. **Pin the error-swallowing behavior (layout-rpc.handlers.ts:50-56).**
   Make `stateStorage.update` reject/throw; assert the handler does NOT
   throw to the RPC boundary and still returns `{ success: true }` (NOT
   `{ success: false }` — this is the "odd bit" called out in the task: a
   persistence failure is silently reported as success to the caller).
   Also assert `logger.error` was called with a message containing
   `'[Electron RPC] layout:persist failed'`.

`describe('layout:restore')`: 4. **Happy path — returns success plus saved data spread at top level.**
Mock `stateStorage.get` to return `{ sidebarWidth: 280, editorWidth: 600 }`;
assert the result is `{ success: true, sidebarWidth: 280, editorWidth: 600 }`
(note: fields are spread onto the result object, not nested under a
`data` key — pin this shape exactly). 5. **No saved state — returns bare `{ success: true }`.** Mock
`stateStorage.get` to return `{}` (the actual default per
`layout-rpc.handlers.ts:64-67`); assert result is exactly
`{ success: true }`. 6. **Pin the error-swallowing behavior on restore.** Make
`stateStorage.get` throw; assert the handler returns `{ success: true }`
(not `{ success: false }` — same odd swallow-and-succeed pattern as
persist) and `logger.error` was called with
`'[Electron RPC] layout:restore failed'`.

7. **`register()` registers exactly two methods.** Assert
   `rpcHandler.registerMethod` was called with `'layout:persist'` and
   `'layout:restore'` (guards against a silent method-name typo surviving
   the move).

### `terminal-rpc.handlers.spec.ts` (new)

Mocks needed: `createMockLogger()`, `createMockRpcHandler()`, a mock
`IWorkspaceProvider` (`getWorkspaceRoot()`), and a mock `PtyManagerService`
(`create(opts)`, `kill(id)`).

`describe('terminal:create')`:

1. **Uses workspace root as cwd when provided and no explicit cwd param.**
   Mock `workspace.getWorkspaceRoot()` to return `/ws/root`; call with
   `params: { shell: 'bash', name: 'main' }` (no `cwd`); assert
   `ptyManager.create` was called with `{ cwd: '/ws/root', shell: 'bash',
name: 'main' }`.
2. **Explicit `params.cwd` wins over workspace root.** Call with
   `{ cwd: '/explicit', shell: 'bash' }` while `getWorkspaceRoot()` also
   returns something non-null; assert `cwd: '/explicit'` was used
   (`params?.cwd || wsRoot || ...` short-circuits on the first truthy value
   at terminal-rpc.handlers.ts:53).
3. **Pin the `require('os').homedir()` fallback (terminal-rpc.handlers.ts:53).**
   Mock `workspace.getWorkspaceRoot()` to return `undefined`/`null` and
   don't pass `params.cwd`; assert `ptyManager.create` was called with
   `cwd` equal to `os.homedir()` (import `os` in the test and compare
   against the real value, since the handler does a lazy inline
   `require('os')` rather than a top-level import — this is exactly the
   kind of thing that silently breaks if the move changes module
   resolution or bundling, e.g. moving into a lib that gets bundled
   differently or tree-shaken).
4. **Propagates `ptyManager.create` failure as a thrown `Error` with the
   original message.** Make `ptyManager.create` throw
   `new Error('spawn failed')`; assert the RPC call rejects/throws with
   message `'spawn failed'` (terminal-rpc.handlers.ts:68-75 catches, logs,
   then re-throws `new Error(message)` — note this one does NOT swallow,
   unlike Layout and Update's check-now; pin that asymmetry).
5. **Non-Error throw is stringified.** Make `ptyManager.create` throw a
   plain string or object; assert the re-thrown `Error.message` equals
   `String(error)`.

`describe('terminal:kill')`: 6. **Missing `id` returns `{ success: false, error: 'id is required' }`
without calling `ptyManager.kill`.** Call with `params: undefined` and
separately `{}`; assert `ptyManager.kill` was never called. 7. **Happy path delegates directly to `ptyManager.kill(id)` and returns
its result verbatim.** Mock `ptyManager.kill` to return
`{ success: true }`; call with `{ id: 'term-1' }`; assert
`ptyManager.kill` was called with `'term-1'` and the RPC result equals
exactly what `kill` returned (the handler does not wrap or transform it
— `return this.ptyManager.kill(params.id)` at line 95).

8. **`register()` registers exactly two methods.** Assert both
   `'terminal:create'` and `'terminal:kill'` were registered.

These 15 new test cases (7 Layout + 8 Terminal) are the minimum needed to
characterize both files' current behavior, including every branch and the
two "odd bits" called out in the task brief (layout's
swallow-to-success on both persist and restore; terminal's lazy
`require('os')` homedir fallback) plus one additional asymmetry worth
pinning (terminal:create does NOT swallow errors, unlike layout and
update:check-now — it re-throws). Write and land these BEFORE moving either
class so the move can be validated by diffing this exact pass/fail count,
not just "it still compiles."

## 5. Verification command list (run after each P3 batch)

All four verified working on this checkout (2026-08-03,
branch `ak/license-server-validation-pipe`):

```bash
# 1. Typecheck — must stay clean (0 errors)
cd D:/projects/ptah-extension
npx nx typecheck ptah-electron
# Verified output: "Successfully ran target typecheck for project ptah-electron"

# 2. Lint — must stay at today's baseline (0 errors, 4 warnings, none new)
npx nx lint ptah-electron
# Verified output: "4 problems (0 errors, 4 warnings)" — see exact list below

# 3. Targeted test — the two families under active migration
npx nx test ptah-electron --testPathPatterns="update-rpc" --skip-nx-cache
# Verified: 2 suites, 10 tests, 10 passed today.
# After adding the Layout/Terminal characterization specs from §4, extend
# the pattern:
npx nx test ptah-electron --testPathPatterns="layout-rpc|terminal-rpc|update-rpc" --skip-nx-cache

# 4. Full Electron suite — the acceptance-criterion #5 gate
npx nx test ptah-electron --skip-nx-cache
# Baseline today: "Test Suites: 1 skipped, 14 passed, 14 of 15 total" /
# "Tests: 4 skipped, 143 passed, 147 total". Any deviation from these
# exact numbers (beyond an intentional, documented test addition) is a
# regression per acceptance criterion #5.
```

**Jest 30 flag warning** (recorded so it doesn't silently waste a future
gate check): this workspace runs Jest 30, which renamed
`--testPathPattern` to `--testPathPatterns`. The `@nx/jest:jest` executor
does not error on the old flag name — it silently ignores it and runs the
FULL suite instead of filtering. Always use `--testPathPatterns` (plural)
scoped to `ptah-electron`.

### Today's lint baseline (pre-existing, unrelated to this task — do not

"fix" these as part of the P3 move; recorded here only so new warnings
introduced by the move are distinguishable)

```
apps/ptah-electron/src/di/electron-adapters.ts:253:19
  warning  Unexpected empty method 'dispose'  @typescript-eslint/no-empty-function

apps/ptah-electron/src/services/electron-browser-capabilities.ts:498:33
  warning  Unexpected empty arrow function  @typescript-eslint/no-empty-function
apps/ptah-electron/src/services/electron-browser-capabilities.ts:605:36
  warning  Unexpected empty arrow function  @typescript-eslint/no-empty-function

apps/ptah-electron/src/services/rpc/handlers/update-rpc.handlers.spec.ts:54:1
  warning  Unused eslint-disable directive (no problems were reported from '@typescript-eslint/no-require-imports')

4 problems (0 errors, 4 warnings)
```
