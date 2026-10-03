# B-5b executor report — TASK_2026_609_c495

Executor: backend-developer. Batch B-5b, Task B-5b.1. No git operations run. batches.md and task.md not edited.

## Task B-5b.1 — COMPLETE

### Files (all absolute)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\settings-core\src\scope\workspace-scope-resolver.ts`. Adds `inspectForPath` (:189), `writeForPath` (:206) and the private `requireWorkspaceKey` (:215).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\settings-core\src\scope\workspace-scope-resolver.spec.ts`. Adds the new `describe` at :708 (9 cases).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\settings-core\src\repositories\agent-model-settings.ts`. Contains `AgentModelSettings`, `AGENT_MODEL_SETTINGS_KEY = 'agentGeneration.models'` and `AgentModelScope`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\settings-core\src\repositories\agent-model-settings.spec.ts` (20 cases).
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\settings-core\src\di\tokens.ts`. Adds `AGENT_MODEL_SETTINGS: Symbol.for('AgentModelSettings')`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\settings-core\src\index.ts`. Exports `AgentModelSettings`, `AGENT_MODEL_SETTINGS_KEY` and the `AgentModelScope` type.

The types `AgentModelLayers`, `AgentModelSettingsValue`, `AgentModelProvider` and `AGENT_MODEL_PROVIDERS` are imported from `@ptah-extension/shared`. None are redefined.

### Contract (for 3b, B-5f1..4, B-5g)

- `WorkspaceScopeResolver.inspectForPath<T>(globalKey, workspacePath): { key, value: T | undefined }`
  - Returns the physical `workspace.<hash>.<globalKey>` key and the raw value stored there.
  - It never falls back to the app key, the global key or a default.
  - It throws when the path is empty, blank, non-string or cannot be normalized.
- `WorkspaceScopeResolver.writeForPath<T>(globalKey, workspacePath, value): Promise<void>`
  - Writes to the same physical key as an active-path `write(…, 'workspace')`; a spec asserts this.
  - Writing `undefined` drops the key.
  - It throws on a missing path before touching the store; it never writes the global key.
  - Workspace keys are not app-scoped, per plan C6 ("appScopable=false").
- `AgentModelSettings(store: ISettingsStore, resolver: WorkspaceScopeResolver)`
  - `layersForPath(ws): AgentModelLayers` returns `{ workspace, machine }` as stored. The values feed `resolveAgentModel`, which tolerates any shape. It throws on an empty path.
  - `update(ws, slug, provider, value: string | null, scope: 'machine' | 'workspace'): Promise<void>`
    - `null` or a blank value clears the leaf. An emptied slug entry is removed, and an emptied map drops the key.
    - Workspace scope resolves its key, and so throws, before anything is queued.
    - An empty slug or an unknown provider throws before any write.

### Edge cases and how each is held

| Edge case | Implementation | Spec evidence |
| --- | --- | --- |
| `writeForPath('')` / missing path throws; global key unchanged | `requireWorkspaceKey` throws when `normalizeActivePath` returns undefined (no fallback, unlike `write` :197-201 legacy branch) | resolver spec `it.each(['', '   '])`, non-string path case, `inspectForPath('')` case; repo spec "workspace scope with path '' / '   ' throws and changes nothing, global key included" |
| Per-physical-key promise queue | `enqueue` keeps a `Map<physicalKey, tail>`. The stored tail never rejects, so a failed task rejects only its own caller. The entry is deleted when the last queued task settles (release path). | "two concurrent updates on different providers of one slug both persist". "concurrent updates on different slugs and on the machine key all persist" runs 4 parallel updates over 2 keys. The test store commits only after a `setTimeout` gap, so an unqueued read-modify-write would lose an update. |
| Read-modify-write preserves unrelated slugs and providers | Re-reads the raw physical key inside the queue turn. `applyLeaf` copies the top map and the one slug entry, then sets or deletes only `[slug][provider]`. | "preserves unrelated slugs and providers"; "clearing a leaf keeps siblings…"; "clearing an absent leaf…" |
| Two workspaces isolated (AC6) | Each path hashes to its own physical key and queue | resolver "keeps two workspaces isolated"; repo "keeps two workspaces isolated (AC6)"; "reads the requested workspace, not the active one" |
| Write failure keeps prior bytes | Nothing that was read is mutated in place; the new value is a fresh object. This matters because `PtahFileSettingsManager.get` returns its cached object (`file-settings-manager.ts:103-105`). On a failed write, `set` restores the previous in-memory value (:136-152) and persists with tmp + rename (:257-258, :592), so the disk bytes stay unchanged. | "a failed write keeps the prior value, unmutated, and the queue keeps working". The store hands back its cached object, and the test asserts the JSON is unchanged and that the following queued update still lands. "a failed workspace write leaves the workspace and machine keys unchanged" |
| Hand-edited garbage | A non-object stored map or slug entry is replaced, not thrown on. A non-object carries nothing a reader would use (`resolveAgentModel` ignores it), and replacing it is the only way the UI can recover. | "replaces a hand-edited non-object value instead of throwing" |
| `__proto__` slug | `defineOwn` uses `Object.defineProperty`, so the slug becomes an own key and no prototype is replaced | "stores a `__proto__` slug as an own key without touching prototypes" |

## PR9 handling

PR9 is "C6 settings write falls back to the global key / clobbers unrelated entries" (HIGH). Two mechanisms close it:

- **No global fallback.** `writeForPath` and `inspectForPath` throw on a missing path, and `update` always goes through them for workspace scope. Both the resolver spec and the repository spec assert zero writes and an unchanged global key.
- **No clobbering.** Every update re-reads the raw key and changes only the targeted leaf inside the per-physical-key queue. The concurrency and preservation specs cover this.

## A-1 — VERIFIED

A-1: VS Code's settings store persists arbitrary `workspace.<hash>.*` keys. The evidence chain:

- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\platform-vscode\src\settings\vscode-settings-registration.ts`
  - :105-111 build `VscodeSettingsAdapter` and wrap it in `ReactiveSettingsStore`.
  - :113-128 build `WorkspaceScopeResolver` over that store and register it, guarded by `isRegistered(ACTIVE_WORKSPACE_SOURCE)`.
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\platform-vscode\src\settings\vscode-settings-adapter.ts`
  - :70-75 `readGlobal` and :77-85 `writeGlobal` route a key to `workspaceProvider.fileSettings` (`~/.ptah/settings.json`) when `isFileBasedSettingKey(key)` is true.
  - Otherwise the key goes to `vscode.workspace.getConfiguration('ptah').update`, which silently drops unregistered keys.
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\platform-core\src\file-settings-keys.ts`
  - :742 defines `SCOPED_SETTING_PREFIX_PATTERN = /^(app|workspace)\./`.
  - :755 has `isFileBasedSettingKey` return true for any key that matches it, so `workspace.<hash>.agentGeneration.models` is file-routed.
  - :176-179 register the machine key `agentGeneration.models` (Batch 3a) in `FILE_BASED_SETTINGS_KEYS`, with a comment that the workspace override is covered by the prefix pattern.
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\platform-core\src\file-settings-manager.ts`
  - :121-157 `set` stores any key with no allow-list.
  - :257-258 and :592 persist atomically with tmp + rename.

A-1 holds for both layers. No change was needed outside this batch.

## Verification

1. `npx nx run-many -t typecheck,lint -p @ptah-extension/settings-core | tail -40`: typecheck passed.
   - The project has no target named `lint`; its inferred lint target is `eslint:lint` (`nx show project`), so `-t lint` ran nothing.
   - I therefore also ran `npx nx run-many -t typecheck,lint,eslint:lint -p @ptah-extension/settings-core --skip-nx-cache`: "Successfully ran targets typecheck, eslint:lint". None of the eslint warnings are in the changed files.
2. `npx nx run-many -t test -p @ptah-extension/settings-core --maxWorkers=2 --skip-nx-cache --output-style=static`: Test Suites 8 passed of 8; Tests 195 passed of 195.
3. `npx prettier --check` on the six files: clean after `--write`. The 3 remaining prettier warnings in `libs/backend/settings-core/src` are in files I did not touch: `migration-edge-cases.spec.ts`, `v1-migration.ts`, `settings-core.spec.ts`.
4. Typecheck covers `tsconfig.lib.json` only, so specs are not typechecked by it; ts-jest compiled both new spec files during the test run.

## Plan deviations

- **Argument order.**
  - `writeForPath(globalKey, workspacePath, value)` follows plan C6 :118 and the existing `readForPath(globalKey, workspacePath)` convention. The batch text's `writeForPath(path, key, value)` reads as shorthand.
  - `update(ws, slug, provider, value | null, scope)` follows batches.md B-5b.1, the more recent text. Plan :122 orders it `(workspacePath, scope, slug, provider, value)`. B-5g should call it in the batches.md order.
- **`inspectForPath` returns `{ key, value }` for the workspace key only.** The existing `inspect` returns the defined candidate list. Read-modify-write and the queue need the physical key and the raw (not merged) value, so this shape serves them without exposing hashing.
- **Machine-scope `update` does not validate `workspacePath`**, because it writes no workspace key. Requiring and checking `workspaceRoot` at entry is the `setAgentModel` handler's job (plan :121, B-5g).

## Out-of-scope observations

- The registrations (B-5f2..4) must register ONE `AgentModelSettings` instance per process: `useValue: new AgentModelSettings(reactiveStore, scopeResolver)`, only inside the existing `if (scopeResolver)` guard (vscode registration :113-128). A second instance would have its own queue, and the two would not serialise each other.
- `git diff --stat` also shows `libs/backend/rpc-handlers/src/lib/services/cli-model-list.service{,.spec}.ts` modified. Those are B-5c2's files; I did not touch them.
