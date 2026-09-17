# B9 Report — TASK_2026_411 Cross-host and performance closure

## Scope

- Batch: B9 — Cross-host and performance closure (final validation of B1-B8).
- Ownership: test fixtures, performance specs, cross-host smoke specs, and task
  reports under `.ptah/specs/TASK_2026_411/` only. No production code touched.
- B3's own gate (256 MB fixture round-trip, injected extraction failure,
  main-thread instrumentation, write amplification) was explicitly deferred to
  B9 by the batch plan and is covered below.
- Host: 16-core AMD Ryzen 7 5800H, 30 GB RAM, Windows 11 (10.0.26200). This is
  a **shared** dev host — a full `nx build ptah-electron`, several
  `nx run-many` test/lint/typecheck jobs, and this session's own tool calls
  were running concurrently at various points while the perf numbers below
  were captured. Every wall-clock figure is honest, none is a clean-room
  measurement; the MECHANISM assertions (byte budgets, cache-hit call counts,
  round-trip exactness, write-amplification ratios) are the load-bearing
  evidence in this report, not the milliseconds.

## 1. Targeted test / typecheck / lint for every touched project

Touched projects derived from `git diff --name-only origin/main...HEAD`
mapped to Nx project names (verified against each `project.json`):
`@ptah-extension/agent-sdk`, `@ptah-extension/auth-providers`,
`@ptah-extension/auth-providers-tokens`, `@ptah-extension/cli-agent-runtime`,
`@ptah-extension/platform-core`, `@ptah-extension/platform-electron`,
`@ptah-extension/rpc-handlers`, `@ptah-extension/vscode-core`,
`@ptah-extension/chat`, `@ptah-extension/chat-streaming`,
`@ptah-extension/dashboard`, `@ptah-extension/shared`, `ptah-electron`,
`ptah-extension-vscode`, `ptah-cli` (15 projects).

### test

Run via `npx nx run-many -t test -p <15 names> --skip-nx-cache` (split across
two invocations to keep output manageable; header line confirmed the correct
project count each time, e.g. `Running target test for 8 projects:` /
`Running target test for 14 projects and 38 tasks they depend on`).

| Project | Suites | Tests |
|---|---|---|
| `@ptah-extension/agent-sdk` | 90/92 (2 skipped — both opt-in perf specs, describe.skip by design) | 1567/1570 passed, 3 skipped |
| `@ptah-extension/auth-providers` | 40/40 | 747/747 passed |
| `@ptah-extension/auth-providers-tokens` | — no `test` target (zero-dep token barrel; expected, confirmed via `project.json`) | — |
| `@ptah-extension/cli-agent-runtime` | 51/51 | 669/670 passed, 1 skipped |
| `@ptah-extension/platform-core` | 31/31 | 550/554 passed, 4 todo |
| `@ptah-extension/platform-electron` | 21/21 with `PTAH_PERF_SPECS=1`, 20/21 without (1 opt-in suite skipped) | 342/345 passed (3 todo) with perf on; 340/345 without |
| `@ptah-extension/rpc-handlers` | 94/94 | 2742/2773 passed, 31 skipped |
| `@ptah-extension/vscode-core` | 33/33 | 530/530 passed |
| `@ptah-extension/chat` | 69/69 | 1054/1056 passed, 2 skipped |
| `@ptah-extension/chat-streaming` | 22/22 | 464/465 passed, 1 skipped |
| `@ptah-extension/dashboard` | 8/8 | 71/71 passed |
| `@ptah-extension/shared` | 56/56 | 1368/1368 passed |
| `ptah-electron` | 37/38 (1 skipped, pre-existing) | 502/506 passed, 4 skipped |
| `ptah-extension-vscode` | 5/5 | 39/39 passed |
| `ptah-cli` | see below — Nx target BLOCKED by an environment gap | see below |

**`@ptah-extension/platform-core` flaky-run note**: the combined run-many pass
reported it failed with "A worker process has failed to exit gracefully" (Nx
flagged it "detected a flaky task"). Rerun in isolation
(`npx nx test @ptah-extension/platform-core --skip-nx-cache`): 31/31 suites,
550/554 tests passed, same numbers as the combined run. This is a Jest worker
teardown warning (leaked timer/handle), not a failing assertion — both runs
produced identical pass counts. Not a regression; not investigated further
(no failing test to chase).

**`ptah-cli` — BLOCKED by a pre-existing environment gap, not this branch's
diff.** `ptah-cli:test` depends on `build-esbuild`, which depends on
`copy-wasm`, which fails:

```
WASM file not found: .../node_modules/web-tree-sitter/web-tree-sitter.wasm
```

`node_modules/web-tree-sitter` does not exist at all in this worktree (`ls`
confirms) — the whole package is missing from `node_modules`, not just the
`.wasm` asset. This is an `npm install` gap in this local environment
(`workspace-intelligence`'s tree-sitter dependency never got installed here),
unrelated to any file this branch touches — `apps/ptah-cli/scripts/copy-wasm.js`
does not exist on `origin/main` either (this script predates the branch), and
nothing in the B1-B7 diff touches tree-sitter or `web-tree-sitter`. Per the
task's own contingency ("if a build step needs an unavailable native or WASM
asset... state it precisely and check whether origin/main has the same
limitation") — origin/main shares this exact `node_modules`, so it has the
same limitation.

Rather than leave `ptah-cli` entirely unverified, `apps/ptah-cli/jest.config.cjs`
already stubs the tree-sitter/WASM import for CLI unit tests
(`wasm-bundle-dir` → `__mocks__/wasm-bundle-dir.ts`), so it can run directly
through Jest, bypassing the Nx build-dependency chain that `copy-wasm` sits
in:

```
npx jest --config apps/ptah-cli/jest.config.cjs --testPathPatterns="di/container.smoke"
```

Result: 1 suite, 4/4 tests passed — the CLI's DI composition smoke test does
pass. The REST of `ptah-cli`'s suite was not run this way (out of scope to
re-plumb the whole test target around a missing dependency); `ptah-cli:test`
through Nx remains **not executed**, blocked on the node_modules gap.

### typecheck

`npx nx run-many -t typecheck -p <15 names> --skip-nx-cache` →
`Running target typecheck for 15 projects:` / `Successfully ran target
typecheck for 15 projects`. Zero errors across all 15.

### lint

`npx nx run-many -t lint -p <15 names> --skip-nx-cache` → Nx itself reported
`@ptah-extension/auth-providers-tokens` has no `lint` target (expected) and
ran `lint for 14 projects`. Two real errors, both **pre-existing production
code from earlier batches, outside B9's exclusive ownership (test
fixtures/perf specs and task reports only)** — not fixed, recorded here per
the escalation instruction:

1. **FAIL — `libs/backend/auth-providers/package.json:16`** —
   `@nx/dependency-checks`: `"The "@openai/codex" package is not used by
   "@ptah-extension/auth-providers" project"`. The dependency IS declared and
   IS genuinely used (`codex-account-usage.service.ts:71`,
   `require.resolve('@openai/codex/package.json')`), but Nx's static
   dependency checker does not recognize a `require.resolve` subpath call as
   usage. This matches a build-time warning already visible in the same
   project's esbuild output (`"@openai/codex/package.json" should be marked
   as external for use with "require.resolve"`). **Owning batch: B7**
   (introduced in `358fa1a81 feat(auth-providers): show codex subscription
   account usage`). Concrete failure scenario: CI's lint gate fails on this
   project until B7 either marks the import external in the esbuild config or
   adds an eslint override/ignore for this specific `@nx/dependency-checks`
   finding — a one-line config fix, not a logic bug.
2. **FAIL — `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.spec.ts:212,273`**
   — `@typescript-eslint/no-inferrable-types`: `private readonly shouldCrash:
   boolean = true` should not carry the redundant `: boolean` annotation.
   **Owning batch: B2** (file created whole in `122770d90 perf(platform-electron):
   move state storage into a bounded worker`). Concrete failure scenario:
   CI's lint gate fails on this project until B2 removes the two redundant
   type annotations — cosmetic, `--fix`-able, zero behavioral risk.

Every other lint finding across all 14 projects was a pre-existing `warn`-level
finding (max-lines soft ceiling, non-null assertions, unused eslint-disable
comments) that does not fail the gate under this repo's configuration and was
not introduced by this task's own changes.

My own new files (`electron-state-storage-large-profile.perf.spec.ts`,
`session-stats-reader.perf.spec.ts`) lint clean with zero problems.

## 2. Electron worker/build and DI composition smoke

- `npx nx build-state-storage-worker ptah-electron` — **succeeds**, produces
  `dist/apps/ptah-electron/state-storage-worker.mjs` (84,682 bytes), a real
  ESM `worker_threads` entry point. This exact artifact is what the B3-gate
  fixture below spawns with a real `Worker`, not a fake.
- `npx nx build ptah-electron` (the full production app build, which
  transitively depends on `build-state-storage-worker`) — **BLOCKED**, but not
  on anything this task touches: it fails at
  `ptah-extension-webview:build:production` with `Could not resolve
  "node_modules/prismjs/themes/prism-tomorrow.css"` and
  `"node_modules/daisyui/dist/themes.css"`. Confirmed `node_modules/prismjs`
  and `node_modules/daisyui/dist` do not exist in this worktree at all — the
  same `npm install` gap class as the `ptah-cli` WASM issue above, in a
  webview app this branch's diff never touches. The state-storage-worker
  target itself — the piece B1-B3 actually built — compiles and runs cleanly
  standalone.
- `state-storage-readiness-gate.spec.ts` and `esm-bundle-gate.spec.ts` are
  part of `apps/ptah-electron/src` and ran (and passed) as part of the
  `ptah-electron:test` run reported above (502/506).
- DI composition smoke:
  - `apps/ptah-electron/src/di/container.smoke.spec.ts` — passed, part of the
    502/506 `ptah-electron:test` run above.
  - `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` — passed,
    part of the 39/39 `ptah-extension-vscode:test` run above.
  - `apps/ptah-cli/src/di/container.smoke.spec.ts` — passed (4/4), run
    directly via Jest as described in §1 since the Nx `test` target is
    blocked by the unrelated `copy-wasm` gap.

## 3. Opt-in performance fixtures

Both suites are `describe.skip` unless `PTAH_PERF_SPECS=1`, following the
existing `off-thread-process-spawner.perf.spec.ts` pattern (advisory, never a
CI gate; absolute wall-clock numbers measure the host, not the code).

### 3a. 256 MB profile migration (`platform-electron`)

File:
`libs/backend/platform-electron/src/implementations/electron-state-storage-large-profile.perf.spec.ts`

Uses the REAL, esbuild-compiled worker artifact
(`dist/apps/ptah-electron/state-storage-worker.mjs`) via a genuine
`node:worker_threads.Worker` — not the in-process fake used by the ordinary
unit specs. The split-array migration plan is a field-for-field mirror of
`SESSION_METADATA_MIGRATION` (`libs/backend/agent-sdk/.../session-metadata-store.ts`),
duplicated rather than imported because `platform-electron` sits below
`agent-sdk` in the hexagonal layering (an adapter must not depend on the
domain lib that consumes it).

Command: `PTAH_PERF_SPECS=1 npx nx test @ptah-extension/platform-electron --testPathPattern=electron-state-storage-large-profile --skip-nx-cache`
→ 2/2 tests passed.

**Test 1 — 256 MB fixture, round-trip, main-thread instrumentation, write amplification.**
Fixture: 200 parent sessions, 174 CLI-agent output keys, 214,837 stream
events (the exact field measurement named in the implementation plan's
acceptance matrix) — actual generated size **241 MB** (close to but a little
under the named 256 MB; recorded honestly rather than padded to hit the
number exactly).

- Fixture build: 1,386 ms. Migration (`whenReady()`): **8,330 ms**.
- Event-loop heartbeat sampled with `monitorEventLoopDelay` for the whole
  migration: **max 22.2 ms, mean 15.62 ms** — genuinely responsive, not just
  under the advisory 5,000 ms smoke ceiling.
- Main-thread instrumentation (host process = main-thread stand-in):
  - `JSON.parse` was called with a **0-character** maximum input on the host
    for the whole migration — the host process never parsed the legacy file
    at all; that happens inside the worker (`ElectronStateCommitStore.loadLegacy`).
  - Largest `JSON.stringify` result produced on the host: **45,901 characters**
    (~45 KB).
  - Largest host→worker message: **23,005 bytes**. Largest worker→host
    message: **129,266 bytes** (~126 KB).
  - All of the above are inside the worker protocol's 256 KiB budget by a
    wide margin — the mechanism the acceptance criterion actually asks for.
- Round-trip exactness: reading every one of the 174 `ptah.agentOutput:*`
  keys back via `readJsonSequence` and counting `tag: 'streamEvent'` entries
  yields **214,837** — an exact match with zero data loss. The lean index at
  `ptah.sessionMetadata` has exactly 200 items.
- Write amplification: after migration, writing one new session detail key
  plus one index rewrite (2 changed keys) wrote **220,823 bytes** to the v2
  store — about 0.09% of the 241 MB profile, and proportional to the two
  changed keys (each new blob + one small manifest + one small pointer file),
  not to the whole store.

**Test 2 — injected extraction failure.** A parent session record with no
`sessionId` makes `splitArrayValue` throw `"Split source item has no usable
id"` before the split's own commit is reached.

- `ElectronStateStorage.whenReady()` rejects with
  `StateStorageRecoveryRequiredError`; `getReadinessState().status` becomes
  `'recovery-required'`.
- The v1 legacy file is proven byte-identical before and after the failed
  attempt (`Buffer.compare` on the raw bytes).
- One nuance worth recording precisely, discovered while building this
  fixture: `ElectronStateCommitStore.initialize()` durably commits the FAT
  (unsplit) legacy values as v2 **generation 1** *before* the split-array
  migration loop runs. So a CURRENT pointer and a generation-1 manifest DO
  exist after the failed attempt — but the manifest's `values` map has
  exactly one entry (`ptah.sessionMetadata`, still holding the raw
  `cliSessions` array embedded), never the split index/detail/agent-output
  keys. Verified directly by reading `CURRENT` (`generation: 1,
  mutationEpoch: 0`) and `manifests/manifest.1.json`
  (`Object.keys(manifest.values) === ['ptah.sessionMetadata']`). That fat
  blob — not literally the original v1 file, though that also survives
  untouched — is what "authoritative" means operationally: every subsequent
  attempt starts from a value that is provably never a partial split.
- Retryable: clearing the v2 directory (the actual recovery path this store
  supports — safe specifically because v1 was never touched) and fixing the
  broken record, then constructing a fresh `ElectronStateStorage` against the
  same files, reaches `status: 'ready'` and reads back all 3 sessions
  correctly.

### 3b. 200-session / 20-id-page analytics fixture (`agent-sdk`)

File: `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.perf.spec.ts`

200 real parent transcripts + 37 nested subagent transcripts on a real
temp-dir filesystem, driven through `SessionStatsReaderService.readStats` in
10 pages of the production `SESSION_STATS_BATCH_MAX_IDS` (20).

Command: `PTAH_PERF_SPECS=1 npx nx test @ptah-extension/agent-sdk --testPathPattern=session-stats-reader.perf --skip-nx-cache`
→ 1/1 test passed. (Note: the `--testPathPattern` flag was accepted by the Nx
wrapper but did not actually filter — the full 92-suite agent-sdk run
executed instead of just this file. Confirmed via `--verbose` output that the
fixture's own `console.log` line did fire with real numbers, so the fixture
ran and is not a false pass; the filter simply had no effect through this
project's Jest wrapper, which is a pre-existing quirk of the wrapper, not a
fixture defect.)

- 10 pages of 20 ids: first page **180 ms**, whole 10-page pass **404 ms**
  (per-page range 18-180 ms — the first page absorbs one-time module/JIT
  warm-up, consistent with the mechanism claim rather than contradicting it:
  page one is served, painted, and returned before any later page starts,
  by construction of the page loop).
- Event-loop heartbeat for the whole run: **max 118.4 ms, mean 14.36 ms**.
- Repeat pass over the same 200 ids: `JsonlReaderService.projectJsonlLines`
  was called **237 times** on the first pass and **zero times** on the
  second — proof the `(size, mtimeMs)`-keyed ledger cache served the entire
  repeat load without re-parsing a single transcript. Repeat-pass wall clock:
  **112 ms**.

## 4. Upstream-latency uncertainty (inherited from B6, unchanged here)

B6's proxy phase timing (`translation-proxy-base.ts`) records metadata-only
phase boundaries around the Codex Responses proxy. B9 changed nothing here
and re-confirms the same caveat B6 already documented: those timings measure
**proxy phases** (request received → upstream call issued → response
streamed back), not actual provider-side latency, and carry no claim about
what the upstream API itself spent. No live Codex/Anthropic account, token,
or network request was made anywhere in this batch's fixtures — the B3/B4
fixtures above are 100% local filesystem and worker-thread work with no
network calls at all.

## Suites

### `electron-state-storage-large-profile.perf.spec.ts` — fixture/integration (opt-in)

- Requirement: B3's deferred gate — 256 MB v1→v2 migration round-trip, an
  injected extraction failure leaving the fat source authoritative and
  retryable, main-thread/structured-clone budget enforcement, and
  proportional write amplification.
- Cases: full 241 MB / 174-key / 214,837-event migration and read-back;
  missing top-level item id causing a mid-migration throw and recovery.
- Files: `D:/projects/ptah-extension/.claude-worktrees/task-411-profile-performance/libs/backend/platform-electron/src/implementations/electron-state-storage-large-profile.perf.spec.ts`

### `session-stats-reader.perf.spec.ts` — fixture/integration (opt-in)

- Requirement: 200-session/20-id-page timing, concurrency/yield mechanism,
  and cache-hit behavior on a repeat load.
- Cases: 10 sequential 20-id pages over 200 sessions (37 with a nested
  subagent); a full repeat pass over the same ids.
- Files: `D:/projects/ptah-extension/.claude-worktrees/task-411-profile-performance/libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.perf.spec.ts`

## Execution summary

- Commands run: see §1-3 above (verbatim, per section).
- Result: 15 projects tested (14 with a test target); 0 typecheck errors
  across 15 projects; 2 pre-existing lint errors across 14 projects (both
  outside B9 ownership, routed to B2 and B7 above); both opt-in perf fixtures
  passed with real, honestly-recorded numbers.
- Failures:
  - `@ptah-extension/auth-providers` lint: `@nx/dependency-checks` on
    `@openai/codex` — product/config defect, routed to B7 (not fixed).
  - `@ptah-extension/platform-electron` lint: two
    `@typescript-eslint/no-inferrable-types` errors in a B2 spec file —
    cosmetic defect, routed to B2 (not fixed).
- Not executed:
  - `ptah-cli:test` through Nx — blocked by a pre-existing `node_modules`
    gap (`web-tree-sitter` package entirely absent), unrelated to this
    branch's diff and present on `origin/main`'s `node_modules` too. Its DI
    composition smoke test was verified directly via Jest instead (4/4
    passed).
  - `nx build ptah-electron` (full app) — blocked by a pre-existing
    `node_modules` gap (`prismjs`, `daisyui` entirely absent) in
    `ptah-extension-webview`, an app this branch never touches. The
    state-storage-worker build target this task actually cares about was
    built and verified standalone.

## Verdict

- Criteria proven: B1-B7's targeted test/typecheck suites are green (subject
  to the two pre-existing lint findings above); the state-storage worker
  artifact builds and runs for real; VS Code, Electron and CLI DI composition
  all resolve cleanly; the deferred B3 gate — 256 MB migration exactness, an
  injected extraction failure leaving a provably-fat, retryable authoritative
  state, a 256 KiB main-thread/message budget, and proportional write
  amplification — is proven with real numbers against the real production
  worker artifact; the 200-session/20-id-page analytics gate is proven with
  real numbers and an exact cache-hit mechanism check.
- Criteria not proven: `ptah-cli`'s full test suite could not be run through
  its normal Nx target (environment gap, not a code issue); the full
  `ptah-electron` production app build could not be verified end-to-end
  (same class of environment gap, in an unrelated app).
- Risks a reader should know about:
  - Both blocking gaps are `node_modules` install gaps in this specific
    worktree, not defects introduced by B1-B7. They should disappear after a
    clean `npm install`, but that was not attempted here (out of B9's
    fixtures-only scope, and risky/slow to run unsupervised).
  - The two lint failures are real and belong to B2 and B7 respectively; both
    are small, mechanical fixes (an esbuild-external marker or eslint
    override for B7; two redundant type annotations for B2), not logic bugs,
    but they are real gate failures until fixed.
  - All perf numbers were captured on a shared, loaded host (see header) —
    the wall-clock figures are honestly reported, not a clean benchmark; the
    mechanism assertions are what should be trusted for regression detection.
  - `session-stats-reader.perf.spec.ts`'s `--testPathPattern` note above: the
    flag did not filter under this project's Jest wrapper. Anyone re-running
    just this file should either accept the full agent-sdk run or invoke
    Jest directly against the file, mirroring the `ptah-cli` workaround in
    §1.

Given the two real (if small) lint failures and the two blocked-by-environment
gates above, this batch's own new work (fixtures, specs, docs) is complete,
but the aggregate gate is **not** fully green — see `batches.md` for the
resulting B9 status.
