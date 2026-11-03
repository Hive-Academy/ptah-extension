# Code Logic Review — Round 2 (`FIX_PLUGIN_SESSION_ROOT`)

Review family: antigravity (implementer: codex)

## Summary

| Metric              | Value      |
| ------------------- | ---------- |
| Verdict             | APPROVED   |
| Overall score       | 10/10      |
| Assessment          | APPROVED   |
| Blocking issues     | 0          |
| Serious issues      | 0          |
| Moderate issues     | 0          |
| Minor issues        | 0          |
| Failure modes found | 0          |

**Score separation**:
- **Separated from 7–8 (Sound)**: All five check items pass with exact `file:line` verification; `getSessionPluginNotice` is now strictly side-effect-free across all resolution kinds (including `'import'`), all other callers retain their one-time legacy import behavior via default parameters, and both unit specs await macrotask `setImmediate` queue drainage before asserting no home storage write occurred.
- **Why 10/10**: The fix is minimal, surgical, preserves the `IStateStorage` interface contract without leaky abstractions, and directly tests both the negative (read-only view `get` and `keys` do not import) and positive (subsequent normal `get` on the same fixture imports) cases.

---

## Check Items Verification

### 1. The notice path can no longer write anything — **PASS**

- **Evidence**:
  - `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1037-1103` (`getSessionPluginNotice`)
  - `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1181-1232` (`readWorkspaceLayer`)
  - `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:983-1011` (`storageFor`)
  - `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:342-369` (`viewFor`)
  - `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:510-528` (`governingValue`)
- **Trace**:
  1. `getSessionPluginNotice` (`plugin-loader.service.ts:1037-1103`) checks `this.configHome === null` (`:1042-1043`), resolves harness roots via `home.harnessRootFor(...)` (`plugin-config-home.ts:320-333`, which only calls `path.resolve`, `this.options.harnessRootOf`, and `logger.warn` on error) and `canonicalRootKey(...)` (`plugin-config-home.ts:164-173`, which only calls `path.resolve` and `fs.realpathSync.native`).
  2. For each nearer layer in `[sessionFolder, ...ancestorRoots]` (`plugin-loader.service.ts:1058`), line `1067` calls `this.readWorkspaceLayer(layer, true, true)`.
  3. `readWorkspaceLayer(workspaceRoot, requireStorage = false, readOnly = false)` (`plugin-loader.service.ts:1181-1185`) passes `readOnly` (`true`) to `this.storageFor(workspaceRoot, readOnly)` (`:1186`).
  4. In `storageFor(workspaceRoot, readOnly = false)` (`plugin-loader.service.ts:983-996`), when `this.configHome !== null` and `target` is defined (`layer` is always a `string` from `[sessionFolder, ...ancestorRoots]`), it returns `this.configHome.viewFor(this.configHome.harnessRootFor(target), readOnly)` (`:992-995`) with `readOnly = true`.
  5. `readWorkspaceLayer` then calls `storage.get<unknown>(PLUGIN_CONFIG_KEY)` (`:1208`), `emptyPluginConfig()` (`:1221`), and `parsePluginConfig(stored)` (`:1223`). It never calls `storage.update`.
  6. In `PluginConfigHome.viewFor(root, readOnly = false)` (`plugin-config-home.ts:342-369`), both `get` (`:353`) and `keys` (`:367`) call `this.governingValue(root, !readOnly)` with `!readOnly === false` (`queueImport = false`).
  7. In `governingValue(root, queueImport = true)` (`plugin-config-home.ts:510-528`), `this.resolve(harnessRoot)` (`:512` -> `:531-554`) performs read-only lookups (`readRecord` at `:617-621`, `candidatesOf` at `:569-594`, `candidateEquals` at `:557-562`, `governingCandidate` at `:267-275`). On `case 'import':` (`:520-522`), `if (queueImport) this.queueImport(harnessRoot, resolution.candidates)` is skipped when `queueImport === false`.
  8. Back in `getSessionPluginNotice` (`plugin-loader.service.ts:1077-1102`), `pluginConfigLayer(read.config)` (`:1078`) and array sorting (`:1095-1099`) operate purely in memory. No code path in `getSessionPluginNotice` or any helper it invokes can reach `storage.update`, `queueImport`, `writeRecord`, `enqueue`, or `save`.

### 2. Every other caller of `viewFor`, `storageFor`, `readWorkspaceLayer`, and `governingValue` keeps the import behaviour — **PASS**

- **Evidence**:
  - **`PluginConfigHome.governingValue(root: string, queueImport = true)`** (`plugin-config-home.ts:510`):
    - Default `queueImport = true`.
    - Called at `plugin-config-home.ts:353` (`viewFor.get`: `this.governingValue(root, !readOnly)`) and `plugin-config-home.ts:367` (`viewFor.keys`: `this.governingValue(root, !readOnly)`).
  - **`PluginConfigHome.viewFor(root: string, readOnly = false)`** (`plugin-config-home.ts:342`):
    - Default `readOnly = false` (so `!readOnly` is `true` -> `queueImport = true`).
    - Production caller: `PluginLoaderService.storageFor` (`plugin-loader.service.ts:992-995`), which forwards its `readOnly` parameter (default `false`).
    - Spec callers in `plugin-config-home.spec.ts`: line `219` passes `true` to test the read-only view; lines `226`, `237`, `250`, `270`, `281`, `286`, `306` omit `readOnly` and keep `readOnly = false`.
  - **`PluginLoaderService.storageFor(workspaceRoot?: string, readOnly = false)`** (`plugin-loader.service.ts:983-986`):
    - Default `readOnly = false`.
    - Callers:
      - `hasWorkspaceState` (`:1020`): `this.storageFor(workspaceRoot)` -> `readOnly = false` (only checks `!== null`, does not call `.get()`).
      - `getWorkspacePluginConfig` (`:1156`): `this.storageFor(workspaceRoot)` -> `readOnly = false` (preserves import on read).
      - `readWorkspaceLayer` (`:1186`): `this.storageFor(workspaceRoot, readOnly)` -> threads `readOnly`.
      - `saveWorkspacePluginConfig` (`:1375`): `this.storageFor(workspaceRoot)` -> `readOnly = false` (preserves import/save behavior).
  - **`PluginLoaderService.readWorkspaceLayer(workspaceRoot?: string, requireStorage = false, readOnly = false)`** (`plugin-loader.service.ts:1181-1185`):
    - Default `readOnly = false`.
    - Callers:
      - `getSessionPluginNotice` (`:1067`): `this.readWorkspaceLayer(layer, true, true)` — the sole read-only caller.
      - `getEffectivePluginConfig` local read (`:1283`): `this.readWorkspaceLayer(localRoot)` -> `readOnly = false`.
      - `getEffectivePluginConfig` ancestor loop (`:1289`): `this.readWorkspaceLayer(root, true)` -> `readOnly = false`.
      - `getDisabledSkillIds` (`:1566`): `this.readWorkspaceLayer(workspaceRoot)` -> `readOnly = false`.
      - `resolveCurrentPluginPaths` (`:1835`): `this.readWorkspaceLayer(workspaceRoot)` -> `readOnly = false`.

### 3. Read-only value equals normal value for every resolution kind — **PASS**

- **Evidence**: `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:510-528` (`governingValue`) and `:351-368` (`viewFor`).
- **Per-resolution verification**:
  - `this.resolve(harnessRoot)` (`:512`) is independent of `queueImport`.
  - `case 'record'` (`:514-515`): returns `resolution.record.config` for both `queueImport = true` and `queueImport = false`.
  - `case 'malformed'` (`:516-517`): returns `MALFORMED_HOME_VALUE` for both.
  - `case 'empty'` (`:518-519`): returns `undefined` for both.
  - `case 'import'` (`:520-522`): returns `resolution.candidates[0].raw` for both; `queueImport` only gates `this.queueImport(harnessRoot, resolution.candidates)` (`:521`), which schedules an asynchronous write without mutating `resolution.candidates[0].raw`.
  - `case 'unreadable'` (`:523-524`): returns `resolution.candidate.raw` for both.
  - `case 'conflict'` (`:525-526`): returns `resolution.governing.raw` for both.

### 4. New specs prove no write happens after awaiting the queue — **PASS**

- **Evidence**:
  - `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.spec.ts:62-63, 216-233`
  - `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.session-notice.spec.ts:38-66, 95-97, 136-152`
- **Verification**:
  1. In `PluginConfigHome.queueImport` (`plugin-config-home.ts:653-667`) and `enqueue` (`:689-703`), `const previous = this.writeChains.get(recordKey) ?? Promise.resolve(); const run = previous.then(task);` schedules `task` on the microtask queue. Inside `task`, `this.readRecord(harnessRoot)` is synchronous and `await this.writeRecord(...)` -> `this.options.homeStorage.update(...)` is called on that microtask turn.
  2. In `plugin-config-home.spec.ts:216-233` (`'a read-only view returns legacy config without import while a normal get imports it'`):
     - Creates a fixture with legacy folder config `{ a: legacy }` (`:218`), where `resolve(repo)` produces `{ kind: 'import' }`.
     - Calls `view.get(PLUGIN_CONFIG_KEY)` and `view.keys()` on `home.viewFor(repo, true)` (`:219-222`).
     - Awaits `await flush()` (`:223`, defined at `:62-63` as `new Promise((resolve) => setImmediate(resolve))`, which runs in the macrotask check phase after all microtasks complete).
     - Asserts `expect(homeStorage.raw.size).toBe(0)` (`:224`).
     - Then calls `home.viewFor(repo).get(PLUGIN_CONFIG_KEY)` (`:226`), awaits `await flush()` (`:227`), and asserts `expect(homeStorage.raw.size).toBe(1)` with `origin: 'imported'` (`:228-232`), proving `flush()` catches queued imports on the exact same fixture.
  3. In `plugin-loader.service.session-notice.spec.ts:136-152` (`'reads an importable legacy layer without writing its home record'`):
     - `setup()` wires `scopedStorage.getStorageForWorkspace(root)` and `getAllWorkspacePaths()` (`:55-66`) to serve `legacyConfigs` and wires `homeStorage.update` to `homeWrites` (`:41-47`), which populates `records`.
     - Line `138` registers an importable legacy config on `h.child` (`h.setLegacyConfig(h.child, config({ enabledPluginIds: ['legacy-plugin'] }))`) with no home record in `h.records`.
     - Lines `140-147` assert `h.service.getSessionPluginNotice(h.child, [h.project], h.project)` returns the `'legacy-plugin'` override from the legacy layer.
     - Line `149` awaits `await new Promise<void>((resolve) => setImmediate(resolve))` to drain any queued microtasks before asserting `expect(h.homeWrites).not.toHaveBeenCalled()` (`:150`) and `expect(h.records.has(h.recordKey(h.child))).toBe(false)` (`:151`).

### 5. Any new defect — **PASS (None found)**

- No new defects introduced. Additionally, because `governingValue(root, false)` does not call `queueImport`, `this.pendingImports` (`plugin-config-home.ts:312, 388, 649`) is not touched during a read-only view read, preventing `PluginConfigHome.status(root)` (`:385-396`) from transiently reporting `state: 'imported'` when no import was queued.

---

## Five Logic Questions

1. **How does this fail silently — where does a failure produce a success-looking result?**
   - It does not. In `getSessionPluginNotice` (`plugin-loader.service.ts:1067-1075`), `readWorkspaceLayer(layer, true, true)` still passes `requireStorage = true` and uses the strict `parsePluginConfig` reader (`:1223`), setting `incomplete = true` and logging a warning on any unreadable or malformed layer while suppressing only the side-effecting legacy import write.
2. **What user action produces unexpected behaviour?**
   - None. Switching chat tabs in Electron triggers `plugins:get-config` with `{ sessionId }`, which now inspects the session's nearer harness-root layers without mutating `homeStorage` or importing un-opened legacy folder configs as a side effect of viewing a tab.
3. **What input data makes this produce a wrong answer rather than an error?**
   - None. All six `HomeResolution` variants (`record`, `malformed`, `empty`, `import`, `unreadable`, `conflict` in `plugin-config-home.ts:513-527`) return the exact same value whether `queueImport` is `true` or `false`.
4. **What happens when a dependency fails, times out, or returns a shape it should not?**
   - If `folderStorage.getStorageForWorkspace(folder)?.get(...)` or `homeStorage.get(...)` throws inside `governingValue`, `readWorkspaceLayer` catches the throw (`plugin-loader.service.ts:1207-1218`) and returns `{ status: 'error', reason }`, which `getSessionPluginNotice` marks as `incomplete: true` (`:1068-1074`).
5. **What is missing that the requirements never mentioned?**
   - Nothing. Both `get` and `keys` on the `IStateStorage` returned by `viewFor(root, readOnly)` (`plugin-config-home.ts:353, 367`) thread `!readOnly`, so neither method on a read-only view can trigger a background import.

---

## New Defects

None.

---

## Tooling & Skill Notes

- `ptah_code_search_symbols`: returned 0 hits (`symbolCount: 0`, index empty).
- `ptah_lsp_references`: returned workspace text-scan matches for `storageFor` and `readWorkspaceLayer`; fell back once to `grep -rnE` on `libs/backend/agent-sdk` after `ptah_code_search_symbols` returned 0 hits.
- `ptah_get_diagnostics`: timed out after 45s (`typescript-compiler — Unavailable: TypeScript check still running after 45s`). Per task instructions, no shell verification checks were run from this review lane.
