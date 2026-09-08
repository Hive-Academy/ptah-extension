# Batch 11 — Track C backend remedies

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-383`
Branch: `task/383-degradation-audit`
Executed in the re-scoped order: **11.3 → 11.1 → 11.2**. Nothing committed.

---

## Task 11.3 — route `git:info` through `IProcessSpawner`

Confirmed unimplemented before starting: no `IProcessSpawner`, `SDK_PROCESS_SPAWNER`
or `OffThreadProcessSpawner` reference anywhere under `libs/backend/vscode-core/src`,
and `exec-git.ts` spawned inline via `crossSpawn` at the line the batch names.

**R-9 done first.** Read
`libs/backend/platform-core/src/interfaces/process-spawner.interface.ts` before
writing anything. The port already carries everything `exec-git` needs — `stdin`,
`stdout`, `stderr`, `on('close')`, `on('error')`, `kill(signal)`, `killed`, and
`whenSpawned: Promise<number | null>` for the tree kill. **The port was NOT
extended and NOT bypassed.**

### Changes

- **MODIFIED** `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/backend/vscode-core/src/utils/exec-git.ts`
  - `:4` — type-only import of `IProcessSpawner` from `@ptah-extension/platform-core`
    (port, not adapter; dependency direction intact).
  - `:110-125` — new optional `spawner?: IProcessSpawner` field on `ExecGitOptions`,
    documented with the TASK_2026_341 measurement that justifies it.
  - `:131-155` — new internal `GitChildHandle` interface: the slice of a spawned git
    child this module uses. Written out explicitly rather than relying on
    `ChildProcess` and `SpawnedProcessHandle` being structurally compatible — their
    `on` overload sets differ and an assignability accident there would be silent.
  - `:157-231` — `spawnGitChild(args, cwd, env, spawner)`: two adapters onto that
    handle, port-backed when a spawner is present, inline `crossSpawn` when it is
    not. This is the whole branch; the run loop below it is unchanged and written
    once.
  - `:275-284` — the timeout path now awaits `whenSpawned` before `killProcessTree`,
    because off-thread the pid does not exist when the handle is returned. `killed`
    is read through `isKilled()`. The SIGTERM-then-SIGKILL sequencing is byte-for-byte
    the previous behaviour, deliberately not "fixed".
- **MODIFIED** `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/backend/vscode-core/src/services/git-info.service.ts`
  - `:3` — type-only `IProcessSpawner` import.
  - `:245-258` — `GitInfoService` constructor takes an optional second parameter
    `spawner?: IProcessSpawner`. Not a decorator: this service is constructed by hand
    in all three hosts.
  - `:2311/:2321` — the two private `execGit` / `execGitBuffer` seams now pass options
    through `withSpawner(...)`.
  - `:2327-2337` — `withSpawner`: threads the host's spawner onto every one of the
    ~30 call sites without touching any of them, since those two seams are the only
    places this service reaches `exec-git`.
- **MODIFIED** `D:/projects/ptah-extension/.claude-worktrees/task-383/apps/ptah-electron/src/di/phase-4-handlers.ts`
  - `:16-20` — imports `IProcessSpawner` (platform-core) and `SDK_TOKENS` (agent-sdk).
  - `:106-115` — resolves `SDK_TOKENS.SDK_PROCESS_SPAWNER` behind
    `container.isRegistered(...)` and hands it to `new GitInfoService(logger, gitSpawner)`.
- **MODIFIED (specs)** `libs/backend/vscode-core/src/utils/exec-git.spec.ts` (+149),
  `libs/backend/vscode-core/src/services/git-info.service.spec.ts` (+73).

### DI registration touched

`apps/ptah-electron/src/di/phase-4-handlers.ts` only. **No new token, no new
binding** — the existing `SDK_TOKENS.SDK_PROCESS_SPAWNER` singleton (bound in
`libs/backend/agent-sdk/src/lib/di/register.ts:316`, registered into the Electron
container by `registerSdkServices` in `phase-2-libraries.ts:191`) is _resolved_, not
re-registered. Nothing to add to `expected-resolvable.ts`: no token became newly
resolvable. The VS Code extension (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:56`)
and the CLI (`libs/backend/cli-engine/src/lib/container.ts:405`) construct
`GitInfoService` with one argument and are unmodified — they keep the inline path,
which is the batch's stated design.

### Plan deviation (11.3)

The batch says the Electron registration lives "under `apps/ptah-electron/src/services/`".
It does not. `TOKENS.GIT_INFO_SERVICE` is registered in
`apps/ptah-electron/src/di/phase-4-handlers.ts:103`, and there is no git-spawner file
under `src/services/`. I made the change where the registration actually is and did
not create a new file to match the batch's path. This is a path discrepancy only —
the remedy itself is exactly the one specified.

---

## Task 11.1 — persist the SDK model catalog

- **MODIFIED** `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`
  - `:15-22` — `zod` + `PLATFORM_TOKENS` / `IStateStorage` imports.
  - `:186-196` — `MODEL_CATALOG_STATE_KEY = 'ptah.sdk.modelCatalog'`.
  - `:198-206` — `MAX_PERSISTED_CATALOGS = 8`. The in-memory map dies with the
    process; this one does not, so per the lib's own "token AND a bound" rule it gets
    a bound as well as a validity token. Least-recently-written is evicted.
  - `:208-243` — `persistedCatalogSchema` (one catalog) and `persistedStoreSchema`
    (`Record<string, unknown>`). The store's values are kept `unknown` on purpose:
    validating the whole store at once would let one corrupt provider entry discard
    every other provider's catalog.
  - `:337-346` — constructor gains
    `@inject(PLATFORM_TOKENS.STATE_STORAGE, { isOptional: true }) stateStorage?: IStateStorage`.
    Optional so a stripped container resolves the service and simply runs without the
    memo.
  - `:404-416` — `getSupportedModels()` consults the persisted store after the
    in-memory map misses **and only when no fetch is in flight** for that key.
  - `:494-499` — `getNativeClaudeModels()` does the same for `NATIVE_MODELS_CACHE_KEY`.
  - `:462-467` — `cacheModels()` (the single write funnel for both fetch paths) now
    also calls `persistCatalog`.
  - `:469-580` — `restorePersistedCatalog` / `readPersistedEntry` / `readPersistedStore`
    / `persistCatalog` / `clearPersistedCatalogs`.
  - `:1053-1062` — `hasCachedModels()` consults the persisted copy too. A persisted
    hit is as free as an in-memory one, and answering `false` beside one would send
    `SdkQueryOptionsBuilder`'s pre-flight into a spawn it does not need.
  - `:1082-1087` — `clearCache()` drops the persisted copy.

**The fingerprint is carried, as required**: the persisted map is keyed by the same
`authFingerprint()` string the in-memory map uses (secrets already hashed by
`hashSecret`), so a changed credential, base URL, tier mapping or provider id misses
by construction. A corrupt entry is **ignored, not repaired** — the entry is left on
disk and the next successful fetch for that key overwrites it.

**No DI registration change.** `SdkModelService` is registered `{ useClass: ... }` in
`libs/backend/agent-sdk/src/lib/di/register.ts`; tsyringe supplies the new optional
parameter from `@injectable()` metadata. `PLATFORM_TOKENS.STATE_STORAGE` is bound in
Electron phase 0 (resolved already at `phase-1-infra.ts:90`), in the CLI
(`cli-engine/src/lib/container.ts:564`) and in the VS Code host, all before this
service is ever resolved.

### Plan deviation (11.1) — READ THIS ONE

The batch says "`clearCache()` / `invalidateForAuthChange()` clear the persisted copy
too." **I implemented `clearCache()` only. `invalidateForAuthChange()` deliberately
does not clear it.**

Reason, from source: `sdk-model-service.ts:1090-1112` documents — and
`libs/backend/agent-sdk/CLAUDE.md` records as a judge round-1 finding of
TASK*2026_353 — that `invalidateForAuthChange` must NOT wipe the per-identity
catalogs, because they are already isolated by fingerprint, so wiping them is not
protection but a guaranteed extra multi-second SDK-bridge spawn on every switch back
(A → B → A paid three spawns for two providers). The persisted copy is keyed by the
\_same* fingerprint, so the batch's own safety requirement — "a stale catalog must
never outlive an auth change" — is already satisfied by the key. Clearing it on every
provider switch would reproduce the exact defect that task removed, one boot further
out, and would make the cross-boot memo close to worthless: a provider switch is the
commonest thing a user does between two launches.

I documented the decision in the code at `sdk-model-service.ts:1104-1111` and pinned
it with a spec ("keeps the persisted copy across an auth change"). **If the batch
author intended the literal behaviour, this is the one line to reverse** — it is a
single `this.clearPersistedCatalogs();` call in `invalidateForAuthChange`.

---

## Task 11.2 — persist the CLI health verdict

- **MODIFIED** `D:/projects/ptah-extension/.claude-worktrees/task-383/libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts`
  - `:24-31` — `zod`, `inject`, `PLATFORM_TOKENS` / `IStateStorage` imports.
  - `:78-87` — `CLI_VERDICT_STATE_KEY = 'ptah.sdk.claudeCliVerdict'`.
  - `:89-118` — `persistedVerdictSchema`: `{ path, mtimeMs, size, installation }`.
    The `(resolved executable path, mtimeMs, size)` triple is the validity token the
    batch specifies — a CLI upgrade rewrites the binary and changes at least one, so
    invalidation is exact and **no TTL is guessed at**.
  - `:155-164` — constructor gains the optional injected `IStateStorage`.
    `new ClaudeCliDetector()` (every existing spec) still compiles and runs.
  - `:213` — `findExecutable()` now calls `restoreOrDetect()` inside the single-flight
    promise.
  - `:225-241` — `restoreOrDetect`: memo first, then the strategy chain. Placed
    **inside** the `detectionInFlight` promise deliberately — the restore does file
    I/O, so checking it in front of the single-flight would let all four boot-time
    consumers pass the check and start four detections, re-opening the exact fan-out
    `detectionInFlight` exists to absorb.
  - `:243-291` — `restorePersistedVerdict`. Returns `null` (i.e. today's full
    detection) for every uncertain case: no storage, no entry, malformed entry,
    `path`/`installation.path` disagreement, a **configured path that disagrees with
    the memo**, a failed `fs.promises.stat`, or a moved `mtimeMs`/`size`.
  - `:293-325` — `persistVerdict` (fire-and-forget, stats the binary then writes) and
    `clearPersistedVerdict`.
  - `:342/:346` — both `cachedInstallation` write sites in `runDetection` persist.
  - `:452-456` — `clearCache()` drops the persisted verdict alongside the in-memory
    one and the `--version` results.

`fs.promises.stat` is used rather than `statSync` so the memo's own check does not put
synchronous I/O back on the boot path.

**No DI registration change.** `ClaudeCliDetector` is registered
`{ useClass: ClaudeCliDetector }` under `SDK_TOKENS.SDK_CLI_DETECTOR` at
`libs/backend/agent-sdk/src/lib/di/register.ts:164-168`; the optional injection
resolves through `@injectable()` metadata with no registration edit. The batch's file
list anticipated a registration change here; none was needed.

- **MODIFIED (specs)** `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.spec.ts`
  (+136; also added a `fs.promises.stat` mock to the existing module mock so no spec
  can touch a real binary), `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.spec.ts`
  (+139; the harness now supplies an in-memory `IStateStorage` whose backing `Map` can
  be shared between two harnesses to model a reboot).

---

## Verification

All run from `D:/projects/ptah-extension/.claude-worktrees/task-383`.
`npx nx reset` was **not** run — Batch 10 is live in this worktree.

### Tests

```
npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/agent-sdk ptah-electron
```

Header read back: `NX  Running target test for 3 projects` (and 4 tasks they depend
on). Result:

| Project                       | Suites               | Tests                      |
| ----------------------------- | -------------------- | -------------------------- |
| `@ptah-extension/vscode-core` | 31 passed, 31 total  | 512 passed (was 490 — +22) |
| `@ptah-extension/agent-sdk`   | 86 passed, 1 skipped | 1450 passed, 2 skipped     |
| `ptah-electron`               | 35 passed, 1 skipped | 480 passed, 4 skipped      |

`NX  Successfully ran target test for 3 projects and 4 tasks they depend on`.

### Lint

```
npx nx run-many -t lint -p @ptah-extension/vscode-core @ptah-extension/agent-sdk ptah-electron
```

`✖ 38 problems (0 errors, 38 warnings)` — every warning pre-existing
(`no-non-null-assertion` in existing specs, `max-lines` on `sdk-agent-adapter.ts` and
`sdk-permission-handler.ts`, neither touched here).
`NX  Successfully ran target lint for 3 projects`.

### Degradation audit

```
npx nx run degradation-audit:lint
```

`degradation-audit: TOTAL 312 unsuppressed site(s)`, every directory `ok (baseline N)`,
target succeeded. The eight new fallback `catch`/`.catch` sites I added all carry a
`// degradation-audit: optional-capability — <reason>` marker, so no baseline moved.

### Typecheck

```
npx nx run-many -t typecheck -p @ptah-extension/vscode-core @ptah-extension/agent-sdk
```

`NX  Successfully ran target typecheck for 2 projects` — zero errors.

```
npx nx affected -t typecheck
```

Fails for 17 projects. **None of the failures are in a file this batch touched.** Two
pre-existing failure classes, both reproducible without my changes:

1. `api-*` / `ptah-license-server` — the generated Prisma client is gitignored and not
   generated in this worktree.
2. `ptah-electron` and `ptah-tui` — `apps/ptah-electron/src/config/build-artifact-gate.ts`
   and `apps/ptah-tui/src/build-artifact-gate.ts` reference `describe` / `it` / `jest`
   from a tsconfig without jest types (`TS2503`/`TS2593`). Neither file is in this
   batch's diff, and the electron typecheck reports **no** error in
   `phase-4-handlers.ts`.

I did not fix either — both are outside this batch's file ownership.

---

## Deliberately not done

- **No settled cache for `getGitInfo`.** Its exclusion at
  `git-info.service.ts:253-257` is documented and deliberate; 11.3 is about _where_
  the spawn runs, not _whether_ it runs.
- **`IProcessSpawner` was not extended.** The port already had every field
  `exec-git` needs.
- **No change to the VS Code or CLI `GitInfoService` construction.** Both keep the
  inline `crossSpawn` path, per the batch ("a host that binds nothing keeps today's
  inline `crossSpawn`"), and neither file is in this batch's ownership.
- **No `expected-resolvable.ts` change** — no token became newly resolvable.
- **No commit, no staging, no branch, no hook bypass.** The working tree is dirty and
  also carries Batch 10's frontend edits (`libs/frontend/chat-ui/...`,
  `libs/frontend/chat/...`) from the parallel executor — file-disjoint from mine, as
  planned.

## Out-of-scope observations

- `apps/ptah-electron/src/config/build-artifact-gate.ts` and
  `apps/ptah-tui/src/build-artifact-gate.ts` break `nx affected -t typecheck` on this
  branch for a reason unrelated to any batch: they are production-path files using
  jest globals. Worth a `types: ["jest"]` in the owning tsconfig or a move into a
  test-only path. Not touched.
- `nx affected -t typecheck` cannot be a clean gate in a fresh worktree while the
  `api-*` projects need a generated Prisma client that is gitignored. Batch 12's
  after-measurement should scope its typecheck to the affected non-api projects, or
  run `npm run prisma:generate` first.
- The `1502.6 ms` lag maximum remains a **hypothesis** attached to 11.3, not a
  measurement. Nothing here proves the spike is closed; Task 12.2 still has to
  attribute the spikes as the batch text requires.
