# Development Tasks — TASK_2026_171 P3 (partial): Layout / Terminal / Update

**Scope**: move `LayoutRpcHandlers`, `TerminalRpcHandlers`, `UpdateRpcHandlers` (+ `update-rpc.schema.ts` and its two specs) out of `apps/ptah-electron` into `libs/backend/rpc-handlers`.

**Source of truth for the architecture** (do NOT re-derive — these are approved):

- `D:/projects/ptah-extension/.ptah/specs/TASK_2026_171/implementation-plan-p3-layout-terminal-update.md` — §5 batches, §6 risk register, §7 eslint list state
- `D:/projects/ptah-extension/.ptah/specs/TASK_2026_171/baseline-p3-layout-terminal-update.md` — §4 characterization test spec, §5 verification commands, lint/test baselines
- `D:/projects/ptah-extension/.ptah/specs/TASK_2026_171/task.md` — parent task + acceptance criteria

**Total batches**: 6 (Batch 0 amendment + the architect's 5) | **Status**: ✅ 6/6 COMPLETE

| Batch | Title                                        | Executor            | Status      | Commit      |
| ----- | -------------------------------------------- | ------------------- | ----------- | ----------- |
| 0     | Characterization tests for Layout + Terminal | `senior-tester`     | ✅ COMPLETE | `4a98034d1` |
| 1     | Layout handler move (pure relocation)        | `backend-developer` | ✅ COMPLETE | `ed2778e7c` |
| 2     | PTY port + token (no handler move)           | `backend-developer` | ✅ COMPLETE | `56a34153d` |
| 3     | Terminal handler move                        | `backend-developer` | ✅ COMPLETE | `7780261de` |
| 4     | App-updater port + token (no handler move)   | `backend-developer` | ✅ COMPLETE | `f64e7e0e2` |
| 5     | Update handler move (+ schema + both specs)  | `backend-developer` | ✅ COMPLETE | `397132d52` |

**Final verified state** (orchestrator-verified, not agent-reported): `ptah-electron` 139 tests / `rpc-handlers` 1412 — cross-project total **1551**, unchanged from the post-Batch-4 figure. Lint 0 errors across all three projects. `apps/ptah-electron/src/services/rpc/handlers/` contains only `editor-rpc.handlers.ts` + `index.ts`. `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` is down to the three TASK_2026_173 paths. `host.layout` / `host.terminal` / `host.update` no longer appear anywhere in the repo.

**R4 boot smoke — PASSED 2026-08-03.** `nx serve ptah-electron` run manually by the user; log at `tmp/logs/log.log`. Evidence:

- `log.log:61` — `[Electron DI] Capability-gated RPC handler classes registered: {"handlers":[…,"LayoutRpcHandlers","TerminalRpcHandlers","UpdateRpcHandlers"]}`. All three moved classes resolve from the lib and register under capability gating, not as host-owned entries.
- `log.log:459-465` — all six methods bound at runtime: `layout:persist`, `layout:restore`, `terminal:create`, `terminal:kill`, `update:get-state`, `update:check-now`.
- Zero drift assertions (`grep -icE "drift|RPC surface mismatch|is enabled but no handler"` → `0`). With `assertOnDrift: true` on the Electron profile and R3 having converted resolve failures from warnings to throws, a registration mistake in any of the three families would have failed the boot. It did not.
- Errors present in the log are unrelated to this task: `SessionImporter` JSONL parse failures against `property-hub` session files, and a gateway discord-token decrypt warning.

**All gates green. This slice is complete — no open items.**

---

## Accepted deviation from acceptance criterion #5 — READ THIS BEFORE ANY GATE CHECK

Parent acceptance criterion #5 reads: _"Electron test suite identical to baseline at every phase gate."_
Baseline (`baseline-p3…md` §2): `Test Suites: 1 skipped, 14 passed, 14 of 15 total` / `Tests: 4 skipped, 143 passed, 147 total`.

**This task deliberately breaks that number, once, in Batch 0.**

**Rationale**: `baseline-p3…md` §1 establishes that `layout-rpc.handlers.ts` and `terminal-rpc.handlers.ts` have **zero** automated coverage today — `npx nx test ptah-electron --testPathPatterns="layout-rpc|terminal-rpc"` prints `No tests found, exiting with code 0`. For those two families the architect's "test suite stays green" gate is **vacuous**: a behaviour-changing relocation would pass every gate in §5 while silently breaking `layout:persist` or `terminal:create`. Freezing a test count that measures nothing is worse than moving it. Batch 0 adds the 15 characterization cases specced in `baseline-p3…md` §4 (7 Layout + 8 Terminal), written against the **current app-local classes**, so the move becomes provably behaviour-preserving rather than merely compiling.

**The delta is therefore: +15 tests, +2 suites, added once in Batch 0, pinning existing behaviour and changing no production code.** It is an accepted, documented addition — **not** a regression. AC #5 is reinterpreted for this task as: _no test may change its assertions or disappear; the only permitted movement of the count is (a) this documented +15 and (b) tests relocating from `ptah-electron` to `rpc-handlers` alongside the class they cover._

### Test-count ledger — the number each gate must actually match

`ptah-electron` (`npx nx test ptah-electron --skip-nx-cache`):

| After    | Suites                         | Tests                          | Why it moved                                |
| -------- | ------------------------------ | ------------------------------ | ------------------------------------------- |
| baseline | 1 skipped, 14 passed, 14 of 15 | 4 skipped, 143 passed, **147** | —                                           |
| Batch 0  | 1 skipped, 16 passed, 16 of 17 | 4 skipped, 158 passed, **162** | +15 characterization (accepted delta above) |
| Batch 1  | 1 skipped, 15 passed, 15 of 16 | 4 skipped, 151 passed, **155** | layout spec (7) relocates to `rpc-handlers` |
| Batch 2  | unchanged                      | **155** or **156**             | see note ▼                                  |
| Batch 3  | 1 skipped, 14 passed, 14 of 15 | **147** or **148**             | terminal spec (8) relocates                 |
| Batch 4  | unchanged                      | **147**–**149**                | see note ▼                                  |
| Batch 5  | 1 skipped, 12 passed, 12 of 13 | **137**–**139**                | update handlers+schema specs (10) relocate  |

▼ **Batches 2 and 4 note**: each adds a DI-identity assertion to `apps/ptah-electron/src/di/container.smoke.spec.ts`. If the executor writes it as a new `it()` the count rises by 1; if it is an added `expect()` inside an existing `it()` the count is unchanged. **Either is acceptable — the executor MUST state in its report which form it used and the exact resulting number**, so the next batch's gate has an unambiguous target. Do not let this ambiguity absorb an unnoticed test loss.

`rpc-handlers` (`npx nx test rpc-handlers`): baseline is **not yet recorded**. **Batch 1's first action is to run `npx nx test rpc-handlers --skip-nx-cache` on a clean tree and write the numbers into its report.** Thereafter: +7 tests / +1 suite after Batch 1, +8 / +1 after Batch 3, +10 / +2 after Batch 5 (net +25 tests / +4 suites across the task).

**Cross-project invariant that must hold at every gate**: `electron_tests + rpc_handlers_tests` never decreases. A test that vanishes from Electron without appearing in `rpc-handlers` is a regression regardless of what the individual numbers say.

---

## Pre-commit blocker — RESOLVED, no `--no-verify` anywhere in this task

The previously-reported pre-commit blocker (`@ptah-extension/rpc-handlers` failing to resolve `memory-contracts`) is **RESOLVED** by commit `afe36afbf` — _"fix(deps): declare memory-contracts so rpc-handlers resolves at runtime"_. `nx lint rpc-handlers` was verified passing at **0 errors / 8 warnings**.

**Consequence**: every commit in this task runs the pre-commit hook normally. **`--no-verify` is not authorised for any batch.** If a hook fails, that is a real finding — stop and report it, do not bypass it.

---

## Do Not Touch

These belong to **TASK_2026_173** and are explicitly out of scope (`implementation-plan-p3…md` line 4, §7):

- `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts`
- `D:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts`
- `D:/projects/ptah-extension/apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts`

The corresponding three entries in `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` (`D:/projects/ptah-extension/eslint.config.mjs:32-39`) **survive this task and must be left alone**. The final state of that array after Batch 5 is exactly those three paths and nothing else. The comment block at `eslint.config.mjs:23-31` also stays as-is — the list is non-empty, so the eslint exception cannot be removed yet.

Additionally out of scope by architect decision:

- `D:/projects/ptah-extension/apps/ptah-electron/src/services/pty-manager.service.ts` and `.../src/services/update/update-manager.ts` do **not** move to `platform-electron` (§3.1). They gain an `implements` clause and nothing else.
- No token deletions. `ELECTRON_TOKENS.PTY_MANAGER_SERVICE` and `UPDATE_MANAGER_TOKEN` both stay (§2.5).
- `layout:` / `terminal:` / `update:` are already in `ALLOWED_METHOD_PREFIXES` — do **not** re-add them (§8 item 5).

---

## Universal verification gate (run before EVERY commit)

From `implementation-plan-p3…md` §5 gate + `baseline-p3…md` §5. Run from `D:/projects/ptah-extension`.

```bash
# 1. Typecheck — 0 errors
npx nx run-many -t typecheck -p platform-core rpc-handlers ptah-electron
# Expected: "Successfully ran target typecheck for 3 projects"
#
# CORRECTED IN BATCH 1 — do NOT use the bare `npx nx typecheck a b c` form that
# was originally written here. Nx forwards the trailing project names to tsc as
# source files, producing "error TS5042: Option 'project' cannot be mixed with
# source files on a command line". Only the first project is targeted and the
# task fails. That is a FALSE failure, not a code defect. Verified by
# reproduction on 2026-08-03. Always use `run-many -t <target> -p <projects>`.

# 2. Lint — no NEW problems
npx nx run-many -t lint -p platform-core rpc-handlers ptah-electron
# Expected ptah-electron: "4 problems (0 errors, 4 warnings)" — the exact 4 listed in
#   baseline-p3…md §5 (2x electron-browser-capabilities empty arrow, 1x electron-adapters
#   empty dispose, 1x update-rpc.handlers.spec.ts unused eslint-disable).
#   Do NOT "fix" these — they are pre-existing and unrelated.
#   Batch 5 EXCEPTION: the 4th warning disappears with the spec it lives in →
#   "3 problems (0 errors, 3 warnings)" is the expected post-Batch-5 number.
# Expected rpc-handlers: 0 errors, 8 warnings (verified post-afe36afbf).

# 3. Lib tests
npx nx test rpc-handlers --skip-nx-cache
# Expected: the ledger number for this batch (see Accepted Deviation section).

# 4. Full Electron suite — the AC#5 gate
npx nx test ptah-electron --skip-nx-cache
# Expected: the ledger number for this batch. NOT the raw 147.

# 5. Build
npx nx build ptah-electron
# Expected: success.

# 6. Boot smoke (Risk R4 — assertOnDrift:true makes drift a hard boot failure)
npx nx serve ptah-electron
# Expected: window opens, no RPC drift assertion in the console. Kill it after.
```

**Jest 30 flag warning** (`baseline-p3…md` §5): this workspace runs Jest 30 — the flag is `--testPathPatterns` (**plural**). `@nx/jest:jest` silently ignores the old singular `--testPathPattern` and runs the FULL suite instead of filtering. A "filtered" run that reports 147 tests did not filter.

**The single decisive assertion** at every boundary is `D:/projects/ptah-extension/apps/ptah-electron/src/di/rpc-surface.spec.ts` — "excludes nothing" + "serves every method in the RPC registry". If it is green, the six method strings are still served identically on Electron and still absent on VS Code / CLI / TUI.

---

## Batch 0 — Characterization tests for Layout + Terminal 🔄 IN PROGRESS

**Recommended Executor**: `senior-tester`
**Justification for deviating from `backend-developer`**: this batch writes **zero production code** and touches **zero** DI / port / Nx-boundary surface. It is pure test authoring against existing classes, with the specific hazard of accidentally "fixing" the odd behaviours it is supposed to pin. `senior-tester` is the right specialist; `backend-developer` is the wrong instinct here because a developer's reflex on seeing `layout:persist` return `{success:true}` after a storage failure is to fix it.
**Execution Mode**: sequential — blocks Batch 1 (layout) and Batch 3 (terminal).
**Status**: already dispatched by the orchestrator. **Do not re-assign.**

### Files

| File                                                                                                    | Action                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `D:/projects/ptah-extension/apps/ptah-electron/src/services/rpc/handlers/layout-rpc.handlers.spec.ts`   | CREATE — 7 cases per `baseline-p3…md` §4 |
| `D:/projects/ptah-extension/apps/ptah-electron/src/services/rpc/handlers/terminal-rpc.handlers.spec.ts` | CREATE — 8 cases per `baseline-p3…md` §4 |

No production file may be modified by this batch.

### Required cases (verbatim from `baseline-p3…md` §4)

Layout (7): (1) persist happy path → `stateStorage.update('electron.layout.state', {...})` once, result `{success:true}`; (2) empty/undefined params → `update` NEVER called yet `{success:true}` — a real branch at `layout-rpc.handlers.ts:43`; (3) **pin the swallow-to-success**: `update` throws → no throw to the RPC boundary, result still `{success:true}` (NOT `false`) + `logger.error` containing `'[Electron RPC] layout:persist failed'`; (4) restore happy path → fields **spread at top level**, `{success:true, sidebarWidth:280, editorWidth:600}`, not nested under `data`; (5) no saved state → exactly `{success:true}`; (6) **pin swallow-to-success on restore** + `'[Electron RPC] layout:restore failed'`; (7) `register()` registers exactly `'layout:persist'` and `'layout:restore'`.

Terminal (8): (1) workspace root used as `cwd` when no explicit param; (2) explicit `params.cwd` wins; (3) **pin the lazy `require('os').homedir()` fallback** at `terminal-rpc.handlers.ts:53` — this is precisely what Batch 3 changes, so this test is the one that validates R6; (4) `ptyManager.create` throws → **re-thrown**, message preserved; (5) non-`Error` throw → `Error.message === String(error)`; (6) `terminal:kill` with missing `id` → `{success:false, error:'id is required'}` and `kill` NEVER called; (7) kill happy path → result returned **verbatim**, unwrapped; (8) `register()` registers exactly `'terminal:create'` and `'terminal:kill'`.

**The asymmetry is the point**: layout and `update:check-now` swallow errors; `terminal:create` re-throws. All three shapes must be pinned as-is.

Pattern to follow: `D:/projects/ptah-extension/apps/ptah-electron/src/services/rpc/handlers/update-rpc.handlers.spec.ts` — construct the class directly with `createMockLogger()` / `createMockRpcHandler()`, no DI container, drive via `rpcHandler.handleMessage()`.

### Verification gate

```bash
npx nx test ptah-electron --testPathPatterns="layout-rpc|terminal-rpc" --skip-nx-cache
# Expected: 2 suites, 15 tests, 15 passed. (Baseline for this command was "No tests found".)
npx nx test ptah-electron --skip-nx-cache
# Expected: Test Suites: 1 skipped, 16 passed, 16 of 17 total / Tests: 4 skipped, 158 passed, 162 total
npx nx lint ptah-electron
# Expected: still "4 problems (0 errors, 4 warnings)" — new specs must add none.
```

### Blocking risks

- **The tests must fail if the behaviour changes.** A test that asserts `{success:true}` without also asserting `logger.error` was called cannot distinguish "swallowed correctly" from "never ran". Cases 3 and 6 must assert both halves.
- **Do not fix what you are pinning.** Every odd behaviour above ships today and must survive this task unchanged (parent constraint: _"Electron … behavior and test baseline must not change at any phase boundary"_).

### Commit message (draft)

```
test(electron): pin layout and terminal RPC behaviour before it moves to a lib

Layout and Terminal RPC handlers had zero coverage, which made the P3
"test suite stays green" gate vacuous for both families. Add 15
characterization cases against the current app-local classes so the
upcoming relocation is provably behaviour-preserving.

Pins the odd bits deliberately: layout swallows storage failures and
still reports success on both persist and restore; terminal:create
re-throws instead; terminal falls back to a lazy require('os').homedir().

Electron suite: 147 -> 162 tests. Documented accepted delta to
acceptance criterion #5, recorded in tasks.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Batch 1 — Layout (pure relocation, zero ports, zero tokens) ⏸️ PENDING

**Recommended Executor**: `backend-developer` — tsyringe DI registration, Nx module boundaries, the manifest key-union change. No UI work. Matches `implementation-plan-p3…md` §8.
**Execution Mode**: **sequential**. Depends on Batch 0 (the layout characterization spec must exist and be green before the class moves — that spec is the only thing that can prove the move preserved behaviour).
**Dependencies**: Batch 0.

### Files (copied verbatim from `implementation-plan-p3…md` §5 Batch 1)

| File                                                                  | Action                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/rpc-handlers/src/lib/handlers/layout-rpc.handlers.ts`   | CREATE — verbatim body + `static readonly METHODS`; imports unchanged (`TOKENS.LOGGER/RPC_HANDLER`, `PLATFORM_TOKENS.STATE_STORAGE` are already lib-visible) |
| `libs/backend/rpc-handlers/src/lib/handlers/index.ts`                 | MODIFY — export                                                                                                                                              |
| `libs/backend/rpc-handlers/src/index.ts`                              | MODIFY — export                                                                                                                                              |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`          | MODIFY — import + `host.layout` → lib-owned `layout`                                                                                                         |
| `apps/ptah-electron/src/rpc-host-profile.ts`                          | MODIFY — drop `LayoutRpcHandlers` import + `'host.layout'`                                                                                                   |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                       | MODIFY — import `LayoutRpcHandlers` from the lib                                                                                                             |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`               | MODIFY — drop export                                                                                                                                         |
| `apps/ptah-electron/src/services/rpc/handlers/layout-rpc.handlers.ts` | DELETE                                                                                                                                                       |
| `eslint.config.mjs`                                                   | MODIFY — drop the layout entry                                                                                                                               |

**AMENDMENT (Batch 0 consequence — not in the architect's table, because the file did not exist when §5 was written):**

| File                                                                       | Action                                                                                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/layout-rpc.handlers.spec.ts`   | CREATE (move) — relocate Batch 0's spec verbatim; adjust the import path only. All 7 cases keep identical names and identical assertions. |
| `apps/ptah-electron/src/services/rpc/handlers/layout-rpc.handlers.spec.ts` | DELETE                                                                                                                                    |

Absolute paths: prefix every row above with `D:/projects/ptah-extension/`.

### Implementation notes

- `static readonly METHODS = ['layout:persist', 'layout:restore'] as const satisfies readonly RpcMethodName[]` — pattern at `command-rpc.handlers.ts:43-46`.
- The manifest entry moves from the `// --- host-owned (unification pending) ---` block into `// --- library-owned, capability-gated ---` (`manifest.ts:257`) with `requires: ['layoutPersistence']` and `handler: LayoutRpcHandlers`.
- **The `host.` prefix drop is load-bearing.** `HostOwnedRpcHandlerKey = Extract<RpcHandlerKey, \`host.${string}\`>` (`manifest.ts:382`) types `HostProfile.hostHandlers`. Renaming the key makes a leftover `'host.layout'` in the Electron profile a **compile error** rather than a review-checklist item.
- Keep the `'[Electron RPC] …'` log prefixes **verbatim** (R8). Renaming them is a separate concern and would break the Batch 0 assertions.
- `eslint.config.mjs` after this batch = the 5-entry array in `implementation-plan-p3…md` §7 "After Batch 1". Copy it exactly.

### Verification gate

Universal gate above, plus:

```bash
npx nx test ptah-electron --skip-nx-cache
# Expected: 1 skipped, 15 passed, 15 of 16 suites / 4 skipped, 151 passed, 155 total
npx nx test rpc-handlers --skip-nx-cache
# Expected: recorded baseline +7 tests, +1 suite. The 7 layout case NAMES must be
# byte-identical to Batch 0's. Diff them.
```

### Blocking risks

- **R5 (manifest key rename ripple)** — LOW, compile-checked. Only consumer is `HostProfile.hostHandlers` (`host-profile.ts:56-58`); `deriveRpcSurface` partitions by `methods` not keys. Any leftover is a compile error.
- **R8 (log-shape churn)** — do not "clean up" logging in a relocation commit.
- **R9 (circular import)** — `manifest.ts` imports the handlers barrel; handlers do not import the manifest. Follows the existing 38-entry pattern. No new cycle.
- **R3 (warn → throw)** — after the flip, a resolve failure throws during `registerRpcSurface` instead of degrading to a drift warning. Intentional, recorded, not mitigated. Combined with **R4** (`assertOnDrift: true`, `rpc-host-profile.ts:81`) this means `nx serve ptah-electron` is a real gate, not a formality.

### Commit message (draft)

```
refactor: move the layout RPC handlers into rpc-handlers

Pure relocation — no port, no token, no behaviour change. The manifest
entry flips from host-owned 'host.layout' to library-owned 'layout',
which shrinks HostOwnedRpcHandlerKey and turns a leftover hostHandlers
entry into a compile error instead of a review catch.

Log prefixes and the swallow-to-success semantics move verbatim; the
characterization spec moves with the class and keeps identical
assertions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Batch 2 — PTY port + token (no handler move; zero runtime delta) ⏸️ PENDING

**Recommended Executor**: `backend-developer` — this is the `platform-core` ports layer plus a tsyringe `useToken` alias. Squarely hexagonal-DI work.
**Execution Mode**: **sequential**. Shares `apps/ptah-electron/src/di/phase-4-handlers.ts` with every other batch, so it cannot run alongside any of them. Strictly ordered **before** Batch 3 — the port must exist before the handler that injects it.
**Dependencies**: Batch 1 (shared-file ordering only).

### Files (verbatim from `implementation-plan-p3…md` §5 Batch 2)

| File                                                              | Action                                                                                                         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `libs/backend/platform-core/src/interfaces/pty-host.interface.ts` | CREATE (§1.1)                                                                                                  |
| `libs/backend/platform-core/src/di/tokens.ts`                     | MODIFY — `PTY_HOST`                                                                                            |
| `libs/backend/platform-core/src/index.ts`                         | MODIFY — export the four types                                                                                 |
| `apps/ptah-electron/src/services/pty-manager.service.ts`          | MODIFY — `implements IPtyHost` (no body change)                                                                |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                   | MODIFY — `useToken` alias (§2.2)                                                                               |
| `apps/ptah-electron/src/di/container.smoke.spec.ts`               | MODIFY — assert `resolve(PLATFORM_TOKENS.PTY_HOST) === resolve(ELECTRON_TOKENS.PTY_MANAGER_SERVICE)` (Risk R2) |

Absolute paths: prefix with `D:/projects/ptah-extension/`.

### Implementation notes

- Port body is fully specified in `implementation-plan-p3…md` §1.1 — copy it, including the doc comment explaining why `write`/`resize`/`onData`/`onExit`/`disposeAll` are deliberately excluded (they are the binary-IPC path owned by `IpcBridge`, never RPC).
- `create` stays **synchronous**. `PtyManagerService.create` is sync today (`pty-manager.service.ts:64`) and the handler awaits nothing. Making it async is a gratuitous behaviour change.
- Token: `PTY_HOST: Symbol.for('PlatformPtyHost')` — matches the convention stated at `tokens.ts:5-9`.
- `implements IPtyHost` must compile with **zero body changes**. Per §8 item 2: _if it needs a body change, the port is wrong — stop and re-derive it._
- Batch is green on its own: nothing resolves `PTY_HOST` yet and `useToken` registration is lazy.

### 🚨 R2 — MANDATORY PRE-COMMIT CHECK (HIGH, silent)

**Duplicate `PtyManagerService` instance.** If `PTY_HOST` is wired as a second `registerSingleton` instead of an alias, tsyringe constructs a **second** `PtyManagerService` owning a **separate `sessions` Map**. `terminal:create` would then return an id that `IpcBridge.write`/`resize` — bound to instance A via `bootstrap.ts:225` → `ipc-bridge.ts:437` — cannot find. Terminals would open and accept no input, and `disposeAll` would leak the real PTYs on quit. **No existing test catches this.**

Required shape (§2.2) — note the existing registration is `useValue` with an explicitly constructed instance (`phase-4-handlers.ts:163`), which makes the alias the **only** correct form:

```ts
const ptyManagerService = new PtyManagerService(logger);
container.register(ELECTRON_TOKENS.PTY_MANAGER_SERVICE, {
  useValue: ptyManagerService,
});
// Alias: the RPC handler depends on the port, IpcBridge on the concrete class.
// Same instance — a second PtyManagerService would own a separate session map.
container.register(PLATFORM_TOKENS.PTY_HOST, {
  useToken: ELECTRON_TOKENS.PTY_MANAGER_SERVICE,
});
```

**Pre-commit checklist — the executor must confirm all three in its report:**

1. `grep` the diff for `registerSingleton(PLATFORM_TOKENS.PTY_HOST` → must return **nothing**.
2. The alias uses `{ useToken: ELECTRON_TOKENS.PTY_MANAGER_SERVICE }`, the repo's established aliasing provider (precedent: `memory-curator/src/lib/di/register.ts:93,107,110`).
3. `container.smoke.spec.ts` asserts **reference identity** (`toBe`, not `toEqual`) between the two resolutions, and that assertion **fails** if the alias is replaced with a second registration — verify by temporarily breaking it.

### Verification gate

Universal gate above. Test counts unchanged from Batch 1 except the smoke-spec assertion — **report whether it added an `it()` (155 → 156) or not (155)**.

### Commit message (draft)

```
refactor(platform-core): add an IPtyHost port and alias it onto the Electron pty manager

Two methods only — create and kill. Data flow (write/resize/onData/
onExit) and shutdown run over binary IPC in the host, never over JSON
RPC, so putting them behind a port would serve no consumer.

The token is an alias, not a second registration: IpcBridge holds the
concrete PtyManagerService and owns the session map, so a second
instance would hand out ids that the binary channel cannot resolve.
Pinned with a reference-identity assertion in the container smoke spec.

No handler moves here and nothing resolves the port yet — zero runtime
delta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Batch 3 — Terminal handler move ⏸️ PENDING

**Recommended Executor**: `backend-developer`.
**Execution Mode**: **sequential**. Strictly after Batch 2 (injects `PLATFORM_TOKENS.PTY_HOST`, which Batch 2 creates) and after Batch 0 (needs the terminal characterization spec).
**Dependencies**: Batch 0, Batch 2.

### Files (verbatim from `implementation-plan-p3…md` §5 Batch 3)

| File                                                                    | Action                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts`   | CREATE — inject `PLATFORM_TOKENS.PTY_HOST: IPtyHost`; `static readonly METHODS`; replace `require('os').homedir()` (`terminal-rpc.handlers.ts:53`) with a top-level `import { homedir } from 'node:os'` |
| `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `src/index.ts`   | MODIFY — export                                                                                                                                                                                         |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`            | MODIFY — `host.terminal` → lib-owned `terminal`                                                                                                                                                         |
| `apps/ptah-electron/src/rpc-host-profile.ts`                            | MODIFY — drop import + `'host.terminal'`                                                                                                                                                                |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                         | MODIFY — import from the lib                                                                                                                                                                            |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`                 | MODIFY — drop export                                                                                                                                                                                    |
| `apps/ptah-electron/src/services/rpc/handlers/terminal-rpc.handlers.ts` | DELETE                                                                                                                                                                                                  |
| `eslint.config.mjs`                                                     | MODIFY — drop the terminal entry                                                                                                                                                                        |

**AMENDMENT (Batch 0 consequence):**

| File                                                                         | Action                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.spec.ts`   | CREATE (move) — relocate Batch 0's spec; retype the pty mock as `IPtyHost`; **case 3 must now assert against the top-level `homedir()` import rather than the lazy `require`**, which is exactly the R6 verification. All 8 case names and assertions otherwise identical. |
| `apps/ptah-electron/src/services/rpc/handlers/terminal-rpc.handlers.spec.ts` | DELETE                                                                                                                                                                                                                                                                     |

Absolute paths: prefix with `D:/projects/ptah-extension/`.

### Implementation notes

- `METHODS = ['terminal:create', 'terminal:kill']`.
- **The `require('os')` swap is mandatory, not optional**: `@typescript-eslint/no-require-imports` is clean across `libs/backend/rpc-handlers/src` today. Importing a Node builtin at module top level is behaviourally identical.
- Keep the `as unknown as Error` log-argument casts **verbatim** (`terminal-rpc.handlers.ts:59, 73, 93`). Ugly, but they are the current logging shape and changing them changes log output. Follow-up, not this batch.
- `PtySpawnResult`/`PtyKillResult` satisfy `TerminalCreateResult`/`TerminalKillResult` structurally (`readonly` does not affect assignability).
- `eslint.config.mjs` after this batch = the 4-entry array in §7 "After Batch 3".

### Verification gate

Universal gate above, plus:

```bash
npx nx test ptah-electron --skip-nx-cache
# Expected: 147 (or 148 if Batch 2 added an it()). NOTE: this coincidentally equals
# the original baseline number — that is a coincidence of arithmetic, NOT evidence
# of correctness. Confirm via the cross-project invariant instead.
npx nx test rpc-handlers --skip-nx-cache
# Expected: +8 tests, +1 suite vs Batch 1's recorded number.
npx nx build ptah-electron   # R6: esbuild must still leave the node builtin alone
```

**R6 manual check**: with no workspace open and no `cwd` param, `terminal:create` must still land in the home directory. The relocated case 3 covers this in unit form; confirm once in `nx serve ptah-electron`.

### Blocking risks

- **R6** (`require('os')` → `import { homedir } from 'node:os'`) — LOW. `os` is a Node builtin; esbuild leaves builtins alone for the CJS/node output both projects produce. Verified by `nx build` + the homedir fallback test.
- **R3 / R4 / R5 / R8 / R9** — as Batch 1.
- **R7 — pre-existing security gap, NOT introduced here, NOT fixed here (MEDIUM).** `terminal-rpc.handlers.ts:53-66` passes a webview-supplied `params.shell` straight into `PtyManagerService.create` → `pty.spawn(shell, …)` (`pty-manager.service.ts:81, 89`) — **arbitrary executable spawn from the renderer**. This ships today; the move does not change it. Flagged so the reviewer knows it was seen and consciously left alone. Fixing it means adding validation, which §5 "Deliberately NOT in any batch" excludes on baseline-preservation grounds. **Filed as a follow-up below — do not let it disappear.**

### Commit message (draft)

```
refactor: move the terminal RPC handlers behind an IPtyHost port

The handler now injects PLATFORM_TOKENS.PTY_HOST instead of the
Electron-local PtyManagerService, and the manifest entry flips from
'host.terminal' to library-owned 'terminal'.

One deliberate change beyond relocation: the lazy require('os') inside
the cwd fallback becomes a top-level import from node:os, because
no-require-imports is clean across rpc-handlers. Behaviour is identical
and the homedir fallback is pinned by test.

Error semantics move verbatim — terminal:create still re-throws rather
than swallowing, unlike layout and update:check-now.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Batch 4 — App-updater port + token (no handler move; zero runtime delta) ⏸️ PENDING

**Recommended Executor**: `backend-developer`.
**Execution Mode**: **sequential**. Shares `phase-4-handlers.ts` and `container.smoke.spec.ts` with Batch 2 and `phase-4-handlers.ts` with every other batch. Strictly **before** Batch 5 — port before the handler that injects it.
**Dependencies**: Batch 3 (shared-file ordering).

### Files (verbatim from `implementation-plan-p3…md` §5 Batch 4)

| File                                                                 | Action                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `libs/backend/platform-core/src/interfaces/app-updater.interface.ts` | CREATE (§1.2)                                                                                      |
| `libs/backend/platform-core/src/di/tokens.ts`                        | MODIFY — `APP_UPDATER`                                                                             |
| `libs/backend/platform-core/src/index.ts`                            | MODIFY — export `IAppUpdater`, `AppUpdateState`                                                    |
| `apps/ptah-electron/src/services/update/update-manager.ts`           | MODIFY — `implements IAppUpdater` (no body change)                                                 |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                      | MODIFY — `useToken` alias (§2.3)                                                                   |
| `apps/ptah-electron/src/di/container.smoke.spec.ts`                  | MODIFY — assert `resolve(PLATFORM_TOKENS.APP_UPDATER) === resolve(UPDATE_MANAGER_TOKEN)` (Risk R1) |

Absolute paths: prefix with `D:/projects/ptah-extension/`.

### Implementation notes

- Port body is fully specified in §1.2 — two members only. `start()` / `dispose()` / `getCheckInterval()` are deliberately excluded; their only callers (`activation/post-window.ts:197-199`, `main.ts:185`) keep resolving the concrete class through `UPDATE_MANAGER_TOKEN`.
- `AppUpdateState` is **redeclared, not imported** from `@ptah-extension/shared`. This is deliberate and precedented: `platform-core` has zero production imports from `@ptah-extension/*`, and the invariant is stated in code at `libs/backend/platform-core/src/settings-auth-key.ts:9-10`. Copy the doc comment from §1.2 explaining it.
- **Drift is compile-checked in both directions, so no drift test is required**: `UpdateLifecycleState → AppUpdateState` via `class UpdateManager implements IAppUpdater`; `AppUpdateState → UpdateLifecycleState` via the handler's typed `registerMethod<_, UpdateGetStateResult>` return site. An explicit bidirectional `const _a: X = null as unknown as Y` pair in the spec is optional and recommended for legibility.
- Token: `APP_UPDATER: Symbol.for('PlatformAppUpdater')`.
- `implements IAppUpdater` must compile with **zero body changes** — same stop-and-re-derive rule as Batch 2.

### 🚨 R1 — MANDATORY PRE-COMMIT CHECK (HIGH, silent, user-visible) — _"the single most important line in the plan"_

**Duplicate `UpdateManager` instance.** If `APP_UPDATER` is wired as `container.registerSingleton(PLATFORM_TOKENS.APP_UPDATER, UpdateManager)` instead of an alias, tsyringe constructs a **second** `UpdateManager`. `post-window.ts:197` starts instance A — which performs the GitHub check and mutates `_currentState` — while `update:get-state` reads instance B, permanently `{state:'idle'}`. **The update banner would never appear and no test would fail.**

Required shape (§2.3):

```ts
container.registerSingleton(UPDATE_MANAGER_TOKEN, UpdateManager);
// Alias, NOT a second registerSingleton — see Risk R1.
container.register(PLATFORM_TOKENS.APP_UPDATER, {
  useToken: UPDATE_MANAGER_TOKEN,
});
```

**Pre-commit checklist — the executor must confirm all three in its report:**

1. `grep` the diff for `registerSingleton(PLATFORM_TOKENS.APP_UPDATER` → must return **nothing**.
2. The alias uses `{ useToken: UPDATE_MANAGER_TOKEN }`.
3. `container.smoke.spec.ts` asserts **reference identity** (`toBe`) between the two resolutions, and that assertion **fails** when the alias is replaced by a second `registerSingleton` — verify by temporarily breaking it. An assertion that passes under both wirings is worthless against R1.

### Verification gate

Universal gate above. Counts unchanged from Batch 3 except the smoke-spec assertion — **report the exact resulting number and whether an `it()` was added**.

### Commit message (draft)

```
refactor: add an IAppUpdater port and alias it onto UpdateManager

Read-and-trigger only: getCurrentState and triggerCheck. Start, dispose
and interval management stay on the concrete class because their only
callers are Electron activation lifecycle, not RPC.

The token is an alias, not a second registerSingleton. A second
UpdateManager would be started by post-window while update:get-state
read the other one — a permanently idle update banner that no test
would catch. Pinned with a reference-identity assertion.

AppUpdateState mirrors UpdateLifecycleState rather than importing it,
keeping platform-core free of inter-lib dependencies as
settings-auth-key.ts already does. Drift is a compile error in both
directions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Batch 5 — Update handler move (+ schema + both specs) ⏸️ PENDING

**Recommended Executor**: `backend-developer`.
**Execution Mode**: **sequential**. Strictly after Batch 4 (injects `PLATFORM_TOKENS.APP_UPDATER`). Final batch.
**Dependencies**: Batch 4.

### Files (verbatim from `implementation-plan-p3…md` §5 Batch 5)

| File                                                                                                                                                  | Action                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.handlers.ts`                                                                                   | CREATE — inject `PLATFORM_TOKENS.APP_UPDATER: IAppUpdater`; `static readonly METHODS`; **delete the stale header lines 8-9** (§0.3) and replace with the `requires: ['appUpdater']` note                         |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.schema.ts`                                                                                     | CREATE — verbatim from `apps/…/update-rpc.schema.ts`                                                                                                                                                             |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.handlers.spec.ts`                                                                              | CREATE (move) — replace the `require('./update-rpc.handlers')` shim + `as never` cast (`spec:54-61, 83`) with a normal `import` and a mock typed as `IAppUpdater`; all five test cases keep identical assertions |
| `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.schema.spec.ts`                                                                                | CREATE (move) — verbatim                                                                                                                                                                                         |
| `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `src/index.ts`                                                                                 | MODIFY — export                                                                                                                                                                                                  |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`                                                                                          | MODIFY — `host.update` → lib-owned `update`                                                                                                                                                                      |
| `apps/ptah-electron/src/rpc-host-profile.ts`                                                                                                          | MODIFY — drop import + `'host.update'`; the `hostHandlers` map is now `{ 'host.fileOpen', 'host.editorRevert', 'host.editorPane' }` (all `EditorRpcHandlers`, TASK_2026_173's problem)                           |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                                                                                                       | MODIFY — import from the lib; refresh the two stale log payload arrays (`:123-145`, `:174-183`) which already list handlers that no longer live where they claim                                                 |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`                                                                                               | MODIFY — drop export + the `SHARED_HANDLERS` fossil paragraph (§0.3)                                                                                                                                             |
| `apps/ptah-electron/src/services/rpc/handlers/{update-rpc.handlers.ts, update-rpc.schema.ts, update-rpc.handlers.spec.ts, update-rpc.schema.spec.ts}` | DELETE                                                                                                                                                                                                           |
| `eslint.config.mjs`                                                                                                                                   | MODIFY — drop the update entry                                                                                                                                                                                   |

Absolute paths: prefix with `D:/projects/ptah-extension/`.

### Implementation notes

- **Delete the stale header at `update-rpc.handlers.ts:8-9`** — _"This handler is Electron-local and must NOT appear in libs/backend/rpc-handlers/ or the SHARED_HANDLERS list."_ §0.3 establishes it is a fossil of the pre-manifest world: host gating is now expressed as data via `requires: ['appUpdater']`. Replace with that note. The half that is still true (_not_ in `registerSharedRpcHandlers`) remains enforced — see §4.1.
- Also drop the matching fossil paragraph from `apps/ptah-electron/src/services/rpc/handlers/index.ts:8-10`; `SHARED_HANDLERS` is not a symbol that exists anywhere in the repo any more.
- **NOT `registerSharedRpcHandlers`** (§4.1): that function runs on all three hosts and exists for the four handlers every host serves unconditionally. Keep the existing per-host `container.registerSingleton` at `phase-4-handlers.ts:162, 167, 169`; only the **import source** changes.
- `METHODS = ['update:get-state', 'update:check-now']`.
- Keep `'[UpdateRpcHandlers] update:check-now failed'` **verbatim** — `update-rpc.handlers.spec.ts:165` asserts on that exact string (R8).
- `eslint.config.mjs` final state = the 3-entry array in §7 "After Batch 5". **Those three are the Do Not Touch set.** The list is non-empty, so the exception block at `eslint.config.mjs:23-31` stays.

### Verification gate

Universal gate above, plus:

```bash
npx nx test ptah-electron --skip-nx-cache
# Expected: 1 skipped, 12 passed, 12 of 13 suites / 137-139 tests (see ledger).
npx nx test rpc-handlers --skip-nx-cache
# Expected: +10 tests, +2 suites vs Batch 3's number, i.e. +25 / +4 vs the Batch 1 baseline.
npx nx lint ptah-electron
# Expected: "3 problems (0 errors, 3 warnings)" — the 4th baseline warning
# (unused eslint-disable at update-rpc.handlers.spec.ts:54) leaves with its file.
# This is an expected reduction, not a new finding.
```

**Final-state assertions for the whole task:**

1. `rg -l "@injectable" apps/ptah-electron/src/services/rpc/handlers/` returns only `editor-rpc.handlers.ts`.
2. `eslint.config.mjs` `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` contains exactly the three TASK_2026_173 paths.
3. `apps/ptah-electron/src/di/rpc-surface.spec.ts` green — Electron still serves all six methods.
4. VS Code and CLI/TUI negative tests green — all six still absent (`expected-absent.ts`).

### Blocking risks

- **R10 — spec relocation changes the DI story (LOW).** The app spec uses `require()` + `as never` to dodge typing `UpdateManager` (`spec:54-61, 83`); in the lib it becomes a plain import with the mock typed as `IAppUpdater` — strictly better, but it must still produce **five** passing cases with unchanged assertions. **Diff the test names before/after.** A renamed or dropped case here is invisible in the summary count if the schema spec compensates.
- **R8** — the `'[UpdateRpcHandlers] update:check-now failed'` string is asserted on. Do not touch it.
- **R3 / R4 / R5 / R9** — as Batch 1.

### Commit message (draft)

```
refactor: move the update RPC handlers behind an IAppUpdater port

Last of the three families in this P3 slice. The handler injects
PLATFORM_TOKENS.APP_UPDATER, the schema and both specs move with it, and
the manifest entry flips to library-owned 'update'.

Deletes two fossils while passing: the header claiming this handler must
never live in rpc-handlers (host gating is data now — requires:
['appUpdater'] plus appUpdater:false on the other profiles), and the
barrel's reference to SHARED_HANDLERS, a symbol that no longer exists.

Electron's hostHandlers map is down to the three EditorRpcHandlers keys,
and the eslint pending-migration list is down to the three files owned by
TASK_2026_173.

The relocated handler spec drops its require()/as-never shim for a real
import and an IAppUpdater-typed mock; all five cases keep identical
assertions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

## Why this is sequential — no batch can run in parallel

Stated plainly, because recommending parallelism that cannot work wastes a round trip:

**1. Hard dependency ordering (port before consumer).** Batch 2 → 3 and Batch 4 → 5 are strictly ordered: the handler injects a token that the preceding batch creates. Running them together means the handler batch cannot compile.

**2. Shared-file conflicts across every pair.** File-disjointness fails on all ten pairings:

| Shared file                                                            | Touched by batches              |
| ---------------------------------------------------------------------- | ------------------------------- |
| `apps/ptah-electron/src/di/phase-4-handlers.ts`                        | **1, 2, 3, 4, 5 — all of them** |
| `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`           | 1, 3, 5                         |
| `eslint.config.mjs`                                                    | 1, 3, 5                         |
| `apps/ptah-electron/src/rpc-host-profile.ts`                           | 1, 3, 5                         |
| `libs/backend/rpc-handlers/src/lib/handlers/index.ts` + `src/index.ts` | 1, 3, 5                         |
| `apps/ptah-electron/src/services/rpc/handlers/index.ts`                | 1, 3, 5                         |
| `libs/backend/platform-core/src/di/tokens.ts` + `src/index.ts`         | 2, 4                            |
| `apps/ptah-electron/src/di/container.smoke.spec.ts`                    | 2, 4                            |

`phase-4-handlers.ts` alone rules out every combination. Two agents editing the same DI phase file concurrently produce either a merge conflict or — worse, given R1/R2 — a silently half-applied alias.

**3. Batch 0 gates 1 and 3.** The characterization tests are the only mechanism that can prove the layout/terminal moves were behaviour-preserving. Moving either class before its spec exists forfeits the entire point of Batch 0.

**Conclusion**: `Execution Mode: sequential` for all six batches. **The parallel-eligible checklist fails on file-disjointness for every pair and on dependency ordering for two pairs.** Recommend one `backend-developer` sub-agent per batch, invoked in order, each gated on the previous batch's commit.

**Squash option** (§5, architect-sanctioned): batches 2+3 and 4+5 may be squashed into single commits if the reviewer prefers fewer commits. The split exists so a port/token addition is never reviewed alongside a behavioural move. **Batch 1 must stay standalone.** Batch 0 must stay standalone — it is the reference point everything else is diffed against.

---

## Follow-ups (do NOT do these in this task — file as new tasks)

From `implementation-plan-p3…md` §5 "Deliberately NOT in any batch", §6 R7, and §8.

1. **🔒 SECURITY — unvalidated `params.shell` reaches `pty.spawn` (R7, MEDIUM).**
   `terminal-rpc.handlers.ts:53-66` passes a webview-supplied `shell` string straight into `PtyManagerService.create` → `pty.spawn(shell, …)` (`pty-manager.service.ts:81, 89`). **This is arbitrary-executable spawn driven from the renderer process.** It ships today and this task does not change it — it is called out here so it is on the record as _seen and consciously deferred_, not overlooked. Fixing it requires adding validation, which the baseline-preservation constraint (AC #5) excludes from a relocation commit. **This warrants its own task with a security framing and an explicit accepted-input-narrowing delta, not a line item in a refactor.**

2. **Zod schemas for `terminal:*` (and the `layout:*` gap).**
   `libs/backend/rpc-handlers/CLAUDE.md` says "Zod schemas mandatory"; `TerminalRpcHandlers` and `LayoutRpcHandlers` ship none. Adding `.parse()` during the move would newly **reject** malformed payloads the Electron build accepts today — a direct AC #5 violation. Note also that `layout:persist` genuinely has no schema to write: its contract is "an arbitrary bag persisted to `IStateStorage`" (`layout-rpc.handlers.ts:43-44`), so any schema would be either a lie or a no-op passthrough. File with an explicit accepted-behaviour delta. (`update:*` already ships schemas and keeps them.)

3. **`as unknown as Error` logger-argument casts.**
   `terminal-rpc.handlers.ts:59, 73, 93`. Ugly but load-bearing: they are the current logging shape and changing them changes log output, which `update-rpc.handlers.spec.ts:165` and possibly E2E log-scraping depend on. Clean up in a dedicated logging-shape task with its own test updates.

4. **Log-prefix normalisation.** `'[Electron RPC] …'` prefixes moving into a lib are now misleading, as is the `'[TerminalRpc]'` / `'[UpdateRpcHandlers]'` inconsistency. Deliberately preserved verbatim here (R8). A rename pass across all lib handlers is a separate, mechanical, test-visible change.

5. **TASK_2026_173** picks up the three surviving `EditorRpcHandlers` / VS Code `FileRpcHandlers` entries and finally empties `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION`, at which point the eslint exception block at `eslint.config.mjs:23-31` can be deleted and acceptance criterion #1 is met.

---

## Plan validation summary

**Status**: PASSED WITH RISKS. The architect's plan was validated against the codebase, not re-derived. No BLOCKERs.

**Assumptions verified by the architect and accepted here**: capabilities/manifest/profile scaffolding already exists for all six methods (§0.1), so the dual-registration rule needs no work; `ALLOWED_METHOD_PREFIXES` already carries all three prefixes; VS Code and CLI/TUI already assert all three capabilities absent.

**Gap found during decomposition and amended into this file** (the only material change to the architect's §5): the Batch 1/3 file tables omit the relocation of the Layout and Terminal characterization specs, because those files did not exist when §5 was written. Left unamended, Batch 1 would delete `layout-rpc.handlers.ts` while its spec — sitting in `apps/ptah-electron` and importing a now-deleted sibling — fails to compile, taking the whole Electron suite down. Both tables now carry an explicitly-marked AMENDMENT block.

| Risk                                       | Severity                   | Attached to    | Mitigation                                                                         |
| ------------------------------------------ | -------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| R1 duplicate `UpdateManager`               | HIGH, silent, user-visible | **Batch 4**    | `useToken` alias + reference-identity assertion + 3-point pre-commit checklist     |
| R2 duplicate `PtyManagerService`           | HIGH, silent               | **Batch 2**    | same shape; existing `useValue` registration makes the alias the only correct form |
| R3 warn → throw on resolve failure         | MEDIUM, intentional        | 1, 3, 5        | recorded, not mitigated — correct direction                                        |
| R4 `assertOnDrift: true` hard boot failure | LOW                        | all            | `nx serve ptah-electron` promoted to a per-batch gate                              |
| R5 manifest key rename ripple              | LOW                        | 1, 3, 5        | compile-checked via `HostOwnedRpcHandlerKey`                                       |
| R6 `require('os')` → `node:os`             | LOW                        | 3              | homedir-fallback test (Batch 0 case 3) + `nx build`                                |
| R7 unvalidated `shell` → `pty.spawn`       | MEDIUM, pre-existing       | 3 (do NOT fix) | follow-up #1, security framing                                                     |
| R8 log-shape churn                         | LOW                        | 1, 3, 5        | move all log strings verbatim                                                      |
| R9 manifest circular-import shape          | LOW                        | 1, 3, 5        | follows the existing 38-entry pattern                                              |
| R10 update spec DI rewrite                 | LOW                        | 5              | diff the five test names before/after                                              |
| **Vacuous test gate on Layout/Terminal**   | **HIGH**                   | **Batch 0**    | **15 characterization tests — the accepted AC#5 delta above**                      |

---

## Status legend

| Icon           | Meaning                              | Who sets it |
| -------------- | ------------------------------------ | ----------- |
| ⏸️ PENDING     | Not started                          | team-leader |
| 🔄 IN PROGRESS | Assigned to an executor              | team-leader |
| 🔄 IMPLEMENTED | Executor done, awaiting verification | executor    |
| ✅ COMPLETE    | Verified, reviewed, committed        | team-leader |
| ❌ FAILED      | Verification failed                  | team-leader |
