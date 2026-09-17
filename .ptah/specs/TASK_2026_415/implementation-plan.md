# TASK_2026_415 — Implementation plan: fix repeated `boot:getReadiness` timeouts and initial-load freeze

Read `research-report.md` first. This plan follows findings 1–3.
No change increases a timeout, suppresses a diagnostic, or fakes readiness.

---

## Fix 1 (primary): per-key persistence in `ElectronStateStorage`

**File**: `libs/backend/platform-electron/src/implementations/electron-state-storage.ts`
(the only production file that changes for Fix 1).

### The defect

The adapter keeps every key in one object. Every `update` writes the whole
store: `JSON.stringify(this.data, null, 2)` at line 70 serializes the whole
255.67 MB on the main thread, for one key. Every `loadSync` parses the whole
file. See research report §4.

### The change

Split the store into one JSON file per key:

1. **Layout.** Replace the single `workspace-state.json` with a directory
   `workspace-state/` next to it. Each key becomes one file inside it:
   - File name = `encodeURIComponent(key) + '.json'`. This is safe on
     Windows: `encodeURIComponent` escapes `:` (illegal in Windows file names)
     and `/`, `\`, `?`, `*`, and other reserved characters.
   - File body = `JSON.stringify(value)` — the value only, not the map.
2. **Construction.** Do not read any key file at construction. Build the key
   list from the directory listing (`readdirSync`, one call, names only). Parse
   a key's file only on the first `get` of that key, then cache the value in
   memory. This removes the whole-store `JSON.parse` from `loadSync`.
   - `update(key, value)` still puts the value in memory immediately. The
     first `get` after a restart pays one small parse, not a 255 MB parse.
3. **Write path.** `persist(key)` writes only that key's file: serialize the
   one value, `writeFile` to a temp file, `rename` over the target. Same
   atomicity guarantee the adapter has today, at one-key cost.
   - Keep the `writePromise` chain per instance so writes still serialize.
   - A write of key B must not touch key A's file. The regression spec below
     asserts this.
4. **Sync variants.** Keep `updateSync`/`persistSync` as sync writes of the one
   key file. They keep their current callers and their semantics. Their cost
   drops from whole-store to one key.
5. **`keys()`** returns the decoded names from the directory listing. Remove
   the in-memory whole-map dependency.
6. **Migration.** At construction, if `workspace-state.json` exists and the
   split directory does not:
   - Parse the legacy file once (this is the last whole-store parse).
   - Write one file per key into the split directory, with the temp+rename
     atomic write.
   - After all key files are in place, rename the legacy file to
     `workspace-state.json.migrated` (do not delete it; it is the rollback).
   - If migration fails partway, the next start retries it: the directory
     exists without the marker, so re-run from the legacy file. The write is
     idempotent per key.
   - Migration cost is one deliberate multi-second block at the first start
     after the update. State this in the release note. Every later start is
     cheap.
7. **Port contract unchanged.** `IStateStorage` (`platform-core`) keeps its
   method set. No consumer changes. No token changes.

### What this does not fix

`ptah.sessionMetadata` is one key of 127.10 MB. Each flush of that key now
serializes only its own value, not all 190 keys. That is a large improvement,
but the single value is still large. Moving session metadata to
`persistence-sqlite` is a separate data-model task. Record it, do not do it here.

### Host impact

- **Electron**: fixed. This adapter is Electron-only.
- **VS Code host**: untouched. It uses the real `vscode.ExtensionContext`
  storage, not `ElectronStateStorage` (see `register-storage-shims.ts` header).
- **CLI host**: untouched. It uses `CliStateStorage`
  (`libs/backend/platform-cli`).
- The hexagonal rule holds: the change is inside one adapter, behind
  `IStateStorage`. `vscode-core` (`WorkspaceAwareStateStorage`,
  `registerStateStorageAdapters`) has no knowledge of the on-disk format. The
  factory type comment in `workspace-aware-state-storage.ts:23-28` mentions the
  Electron file name; update that comment only.

---

## Fix 2: single-flight the readiness watchdog pull

**File**: `libs/frontend/core/src/lib/services/boot-status.service.ts`

**The defect**: `startWatchdog` (lines 196-201) runs
`setInterval(() => { void this.pullReadiness(); }, 2000)` with no in-flight
flag. A pull can take the full 5 s timeout while the main process is starved, so
ticks stack: up to 3 concurrent pulls, ~78 queued RPC calls over the observed
2 min 36 s window (research report §6). This breaks the acceptance "bound
polling/inflight".

**The change**:

1. Add one private field: `private pullInFlight = false;`
2. In `pullReadiness` (line 162): at the start, `if (this.pullInFlight) return;`
   then set `this.pullInFlight = true;`. In a `finally` block, set it back to
   `false`. The existing `try/catch` already covers all exit paths; wrap the
   reset in `finally` so a throw cannot strand the guard.
3. Change nothing else. Same timeout (5000 ms). Same interval (2000 ms). Same
   monotonic adoption rule. Same ready default for the VS Code host. A skipped
   tick is safe: the next tick in 2 s asks the same question, and the push path
   stays authoritative.

**Result**: at most one `boot:getReadiness` call in flight at any time. The
watchdog keeps its recovery role (a lost push cannot strand the boot screen).

---

## Fix 3 (gated): async target-side reads in the harness reconcile pass

**Gate**: do this only after a CPU profile confirms the attribution (Step 0
below). The source walk is already async (TASK_2026_323); these are the
remaining synchronous reads on the target side.

**Files and changes**:

1. `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:411` —
   the copy-plan `content: readFileSync(sourceFile, 'utf-8')`. Make the plan
   step async and read with `fs/promises`. The plan builder is already async up
   the call chain (it awaits source hashes).
2. `workspace-target.ts:919` — same change in apply:
   `content: readFileSync(write.source, 'utf-8')` → `await readFile(...)` from
   `fs/promises`.
3. `hashTransformedDirSync` (same file) — replace its use with the existing
   async fold. `targets/copy-engine.ts` already holds an async
   `hashTransformedDir` over the same file map (`digestFileMap` in
   `content-hash.ts`). Both folds must stay byte-identical: the digest is a
   compared value, not a diagnostic. Add a spec that hashes one fixture
   directory with both folds and asserts equal digests, then delete the sync
   fold only after that spec is green.
4. `libs/backend/harness-sync/src/lib/targets/claude-target.ts:493,551,566,610,614`
   — `lstatSync`/`readdirSync`/`readFileSync` → the matching `fs/promises`
   calls.
5. `harness-manifest.builder.ts:389,529` — leave alone. These are documented
   deliberate one-level exceptions (see harness-sync CLAUDE.md).

**Digest stability**: the async source walk (TASK_2026_323) kept a byte-for-byte
stable digest. Follow the same pattern: same fold order, same chunk boundaries
(`HASH_BATCH_SIZE`), same `setImmediate` yields, same commit-point cancellation
via `pass-abort.ts`.

---

## Step 0 (evidence, non-blocking): capture a CPU profile

Fixes 1 and 2 stand on source arithmetic and stand alone. Fix 3 needs profile
confirmation before it is done. Per `libs/backend/vscode-core/CLAUDE.md`
("Diagnosing a hang"), the lag run proves a block; the profile names the owner.

1. On the next slow boot (no restart needed to arm it — the next natural start
   counts), run from the renderer devtools:
   `window.ptahDiag.captureCpuProfile(10000)` during the lag run.
   Alternative: set `PTAH_PROFILE_ON_LAG_MS=3000` before start, which captures
   automatically on the first lag over 3 s.
2. Read the profile for `JSON.stringify` frames (Fix 1 owner) versus
   `readFileSync`/hash frames (Fix 3 owner).
3. If the profile shows neither, do not proceed to Fix 3. Record the actual
   owner and stop.

**Fixture harness (no live profile)**: adapt `measure-boot-rpcs.mjs` from
`.ptah/specs/TASK_2026_380/` into an isolated slow-boot fixture: a temp
`workspace-state.json` seeded with a large `ptah.agentOutput:*` key set, a
small key updated in a loop, and an event-loop lag probe. This reproduces the
write amplification in a unit test without the production profile. Inspect the
380 harness first; do not run anything against the live profile.

---

## Regression tests

All specs sit beside their target file, per repo convention.

### Fix 1 — `electron-state-storage.spec.ts` (extend the existing spec)

1. **Write amplification**: seed a storage with a large key A (several MB of
   filler) and a small key B. Update B. Assert: B's key file changed, A's key
   file did not (compare `mtime` or bytes). Under the old adapter this fails:
   the whole store is one file.
2. **Lazy load**: construct the storage with two keys on disk. Assert the
   construction did not read key file bodies (spy on `readFile`/`readFileSync`:
   only the directory listing ran). Assert `get` of one key parses only that
   key's file.
3. **Migration round-trip**: write a legacy `workspace-state.json` with two
   keys. Construct the storage. Assert: both keys readable with the same
   values; the split directory holds one file per key; the legacy file was
   renamed to `.migrated`. Construct again: assert no re-migration (the
   presence check works) and the same values.
4. **Atomicity**: update a key while its file exists. Assert no partial file
   at any observable point: after `update` resolves, the file parses as JSON.
   (The temp+rename pattern gives this; the spec pins it.)
5. **Windows name safety**: write a key containing `:` and `/`
   (`ptah.agentOutput:123/a`). Assert the key file name encodes both, and
   `keys()` returns the original key unchanged.

### Fix 2 — `boot-status.service.spec.ts` (extend the existing spec)

1. **Single-flight**: put the RPC into a state where a pull stays unsettled
   (a `boot:getReadiness` promise the test controls). Fire the watchdog tick
   twice. Assert the RPC call count is 1, not 2. Resolve the pull. Advance
   time. Assert the next tick fires a new pull.
2. **Guard resets on failure**: make the pull reject. Assert the next tick
   still issues a new pull (the `finally` reset works; the service cannot
   wedge after one failure).
3. **Existing behavior unchanged**: the current spec already covers the pull,
   the push, the monotonic rule, and the ready default. Do not change those
   tests. They must stay green without edits.

### Fix 3 — harness-sync digest-stability and call-count specs

1. **Digest equality**: hash one fixture directory with the sync fold and the
   async fold. Assert identical digests. (Write this spec BEFORE deleting the
   sync fold; it is the gate.)
2. **No sync fs in the apply path**: follow the marker-spec pattern the repo
   already uses (`skill-md-migration` marker spec): after the change, grep the
   compiled apply-path modules for `readFileSync` and assert zero matches,
   with the manifest builder's documented exception listed explicitly.

---

## Commands

Project names come from each lib's `project.json` (verified):

```bash
npx nx run-many -t test -p @ptah-extension/platform-electron @ptah-extension/core @ptah-extension/harness-sync @ptah-extension/vscode-core
```

- Read the `Running target test for 4 projects` header. The number must equal
  the number of projects asked for. A misspelled name is dropped silently.
- Never `npx nx test projA projB` — Nx runs the first project only and the
  rest become Jest path filters (root CLAUDE.md).
- No `project.json` is edited by this plan, so no `nx reset` is needed. If a
  batch later edits one, reset before the first command of that batch, never
  while another executor runs in the same worktree.
- Type check after the edits:
  `npx nx affected -t typecheck` or the scoped
  `npx nx run-many -t typecheck -p @ptah-extension/platform-electron @ptah-extension/core`.

---

## Acceptance mapping

| Requirement (task)                                    | How this plan meets it                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Readiness RPC available promptly, answer truthful     | Fix 1 and Fix 3 remove the loop blocks that starve the handler. The handler itself is unchanged and stays truthful.                                                |
| Bound polling/inflight                                | Fix 2: one pull in flight at most.                                                                                                                                 |
| Clean teardown                                        | Fix 2 keeps the existing `DestroyRef` cleanup (`boot-status.service.ts:138`). The in-flight flag needs no teardown: a pending pull resolves into an inert service. |
| Fix demonstrates blocking work                        | Fix 1 by arithmetic (255.67 MB stringify per key write, research report §4); Fix 3 by CPU profile (Step 0).                                                        |
| Preserve all three hosts                              | Fix 1 is inside the Electron adapter only. VS Code and CLI adapters untouched. Port contract unchanged.                                                            |
| Preserve hexagonal boundaries                         | No backend lib imports an adapter. No new port. No token change.                                                                                                   |
| Report installed-bundle vs source mismatch if present | Research report §9: not checked, stated as unverified.                                                                                                             |
| No broad startup redesign                             | Three targeted fixes; no phase reordering, no new subsystem.                                                                                                       |

---

## Out of scope (recorded, not planned here)

1. Move `ptah.sessionMetadata` (127.10 MB) from JSON state to
   `persistence-sqlite`. This is the data-model follow-up after Fix 1.
2. Pruning the 186 `ptah.agentOutput:*` keys (83.8 MB) — a retention policy
   question, not a boot fix.
3. `harness-manifest.builder.ts` `readdirSync` one-level listings — documented
   deliberate exception.
4. VS Code webview boot behavior — already correct; the `ready` default stays.
