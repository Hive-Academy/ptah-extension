# Backend implementation — `TASK_2026_701_9e4b`, batch 3

Plugin loader harness-root config home (B15, D14).

**Tasks completed**: 3.1 `PluginConfigHome`, storage routing, descriptors, plugin contents.

**Verdict**: implementation complete; agent-sdk and cli-agent-runtime tests and typecheck pass,
and all host projects pass. The verify run exits 1 on one lint target. Its only 2 errors are in a
file that this batch does not own and that is identical to `main` (see Verification).

## Files

- CREATED `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts`. Holds the
  `PluginConfigHome` class: the home record, the candidate scan, equality, the conflict rule,
  the single-key view, import/adopt/dismiss and the per-key write chain. Also moved here as
  module functions, out of the loader: `PLUGIN_CONFIG_KEY`, `PLUGIN_CONFIG_LIST_FIELDS`,
  `emptyPluginConfig`, `normalizePluginConfig`, `isWellFormedPluginConfig`, `canonicalRootKey`.
  New: `pluginConfigsEqual`.
- CREATED `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.spec.ts`. Covers equality,
  the strict shape check, single-key view guard, malformed-save refusal, `harnessRootOf` throwing,
  a sole unreadable folder record (passed through, never imported), adopt of an unreadable record
  refused, and write order on one record.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`:
  - `initialize(..., options: PluginLoaderInitOptions = {})`. The home is active only when the
    storage is workspace-scoped AND `harnessRootOf` AND `homeStorage` are both given.
  - Routing branch in `storageFor`. `hasWorkspaceState` is unchanged and is therefore true for
    any root when the home is active.
  - New `getConfigHomeStatus`, `adoptFolderConfig` and `dismissFolderConfig`.
  - New `getPluginSourceDescriptors()`.
  - `PluginInfo` now carries `agentCount`, `skillNames`, `agentNames` and `commandNames`.
    `countPluginCommands` is replaced by `pluginContents`/`listMarkdownNames`.
  - The private statics `canonicalRootKey`, `emptyPluginConfig` and `normalizeStoredConfig` and
    the local `isAbsentOrStringList` are deleted, and their call sites now use the module
    functions. `readWorkspaceLayer` uses `isWellFormedPluginConfig`.
  - Exported interfaces `PluginLoaderInitOptions` and `PluginSourceDescriptor`.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.spec.ts`. Adds two
  describes: "harness-root configuration home (D14)" (the full matrix) and "plugin source
  descriptors and contents".
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/capabilities/capability-resolver.service.spec.ts`.
  Agreement case only. No production change.

## Matrix → named spec cases (`plugin-loader.service.spec.ts`)

| Matrix item | Spec case |
| --- | --- |
| home inactive, identical behaviour | `home inactive: a single-scope storage with both options reads and saves exactly as without them`; `home inactive: workspace-scoped storage without options keeps per-folder reads` |
| sole legacy + empty home; idempotent import | `sole legacy config in a sub-folder, empty home: the read returns it and the record is imported once (idempotent)` |
| intentional empty config counts as present | `an intentionally saved empty config is present: it is imported as empty, not treated as absent` |
| home present, sibling differs | `home present and empty, sibling holds a non-empty config: the home governs, state differs, sibling bytes unchanged` |
| `repo/a` + `repo/b` conflict; latest `lastUpdated`; tie → lowest key | `repo/a and repo/b open at once…` › `reports a conflict, reads the later lastUpdated everywhere and writes nothing`; `a tie on lastUpdated goes to the lowest folder key` |
| adopt (no union) | `adopt(repo/b) makes the home equal b exactly (no union) and a then shows as differs` |
| dismiss | `dismiss(repo/a) hides its notice until the lastUpdated of a changes`; `dismiss is refused while the folders conflict…`; `adopt rejects a folder that holds no config under the root` |
| save during conflict | `a save during the conflict creates the record from the payload; the other folders show as differs` |
| concurrent save during import | `a concurrent save during a pending import is serialized after it and wins without losing a list` |
| import write failure | `an import write that fails leaves reads on the folder config and is retried on the next read` |
| save write failure | `a save write that fails throws SdkError and leaves the record unchanged` |
| open/close home, open root, active change | `transitions keep the home: active folder change, an earlier sibling, closing the imported folder, opening the root` |
| malformed home record → strict `error` | `a malformed home record makes the strict read an error and the lenient read the empty default` |
| nested repository never a candidate | `a nested repository (another harness root) is never a candidate` |
| `hasWorkspaceState` | `hasWorkspaceState is true for a sub-folder and for the harness root when the home is active` |
| descriptors, 4 families, 2 externals with one basename | `describes all four families, keeping two externals with one basename apart` |
| agent counts and names | `carries agent, skill and command names and counts listed from disk` |
| A-session agreement (cli-agent-runtime) | `D14 agreement: a toggle saved through the session resolver from repo/a is read back from repo/b and repo` |

## Validation notes

- **A-info.** `skillCount`/`commandCount` are computed at four sites in
  `plugin-loader.service.ts`: bundled in `getAvailablePlugins`, `describeSkillsShPlugins`,
  `describeExternalPlugins` and `describeHarnessPlugins`. All four now set the content fields.
- **A-session holds.** `capability-resolver.service.ts` reads the config on every resolve:
  `effectivePluginConfig` calls `getEffectivePluginConfig` per call, and the toggle path reads
  `getWorkspacePluginConfig(ctx.stateRoot)` (`:646-665`). `stateRootFor` (`:289-305`) returns
  `physicalRoot` because `hasWorkspaceState` is true. The agreement case proves it.
- **A-global-sync holds.** In `libs/backend/platform-electron/src/implementations/electron-state-storage.ts:139-175`,
  the non-worker `update` sets `this.data[key]` synchronously before it awaits persist. The worker
  path refreshes `this.data` from the worker cache in `finally` before it resolves. So `get` sees
  the value once `update` resolves, and no in-memory copy was needed. While a write is in flight,
  `pendingImports` keeps a second import from being queued.

## Stack observed

- tsyringe late-initialized service (`PluginLoaderService.initialize`). `PluginConfigHome` is a
  plain class built in `initialize`, as the plan requires, so there are no DI registration
  changes.
- Storage ports `IStateStorage` and `IWorkspaceScopedStateStorage` /
  `isWorkspaceScopedStateStorage` come from `@ptah-extension/platform-core`
  (`workspace-scoped-state-storage.interface.ts`).
- Shared types `PluginConfigHomeStatus`, `PluginConfigHomeCandidate` and `PluginInfo` (content
  fields) come from Batch 1 (`libs/shared/src/lib/types/rpc/rpc-misc.types.ts:490-614`).
- Errors use `SdkError` (`libs/backend/agent-sdk/src/lib/errors/sdk.error.ts`). Logging uses the
  injected `Logger`.
- Catch blocks follow `tools/degradation-audit/check-degradation.ts`:
  - The moved `canonicalRootKey` empty catch carries an `optional-capability` marker.
  - The new catches either throw (`writeRecord`), return a computed value (`harnessRootFor`, with
    a warn) or assign (`listMarkdownNames`), so none is a flagged sentinel.
  - The old `countPluginCommands` `return 0` sentinel is gone.
  - Net count does not rise.
- No agent-sdk → harness-sync import: `harnessRootOf` is injected.

## Verification

Command (one run; it waited 282 s on the verify lock):
`npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime,ptah-electron,ptah-extension-vscode,ptah-cli`

Result: `NX 61 tasks: 60 succeeded, 19 cached, 1 failed`, lock released with exit code 1.

| Project | lint | test | typecheck |
| --- | --- | --- | --- |
| @ptah-extension/agent-sdk | **failed: 2 errors, both outside this batch (below)** | pass | pass |
| @ptah-extension/cli-agent-runtime | pass | pass | pass |
| ptah-electron | pass | pass | pass |
| ptah-extension-vscode | pass | pass | pass |
| ptah-cli | pass | pass | pass |

The agent-sdk lint failure:

- Both errors are `no-unexpected-multiline`, at
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:174:3`
  and `:183:3`.
- That file is not in Batch 3. `git diff main -- <file>` is empty, and it was last changed by
  `d9bb1c0b9` ("add Claude account admission matrix"). The errors are already on `main`.
- Per the batch rules I did not edit it and did not rerun.
- The batch files have no lint errors. `plugin-loader.service.ts` carries the existing
  `max-lines` warning; the file was already 1736 lines and is now 1274 lines by the rule's count.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Move the pure config helpers (`normalize`, strict shape check, `canonicalRootKey`, key constants) into `plugin-config-home.ts`, and have the loader import them | duplicate them; pass them as callbacks; move them | Both files belong to the batch. A17 asks to keep the 1736-line loader from growing, and replace-in-place forbids copies | yes |
| `dismissFolderConfig` with no home record (a conflict) throws `SdkError` | create a record from the governing folder; throw | The F7i `conflict` copy offers only "Use settings from <folder>" (implementation-plan.md:1344-1346). Without a record there is nowhere to store `dismissed` | yes |
| The `imported` notice is dismissed by `dismissFolderConfig(R, importedFolder)`; state `imported` lasts while some source folder is present and not dismissed | separate flag; reuse `dismissed` | The plan's record has no separate flag. The F7i `imported` notice has one "Dismiss" button that sends a folder | yes |
| `getConfigHomeStatus` reports `imported` while an import is queued or in flight, or once the record has `origin: 'imported'`. It never queues an import itself | report only after the write; status triggers the import | The plan says no `imported` state after a failed import. A failure clears the pending flag, so status is null until a read retries | yes |
| A malformed home record → status `null`. The strict read reports `error` and the lenient read returns empty. `adopt` and a save overwrite (repair) it | report `differs`; block writes | The plan names only the strict and lenient read outcomes. Repair through adopt/save keeps the user unblocked | yes |
| A malformed folder record equals nothing. Alone it is passed through to the strict reader (`error`, no import). Among others it makes a conflict | import it as empty; ignore it | Importing it would turn "policy unknown" into "nothing off" (fail-open) | yes |
| The external `sourceRef` is `record.pluginId` itself (already `external:<owner>/<repo>/<plugin>`) | prefix it again | The sidecar contract documents `external:<owner>/<repo>/<plugin>` (`origin-sidecar.types.ts:152-158`) | yes |
| A downloaded bundled plugin now reports `commandCount` from disk; before download, catalogue placeholders stand and no name lists are set | keep the catalogue count | It matches the existing "disk wins once downloaded" rule for `skillCount`, so the count and the names cannot disagree | yes |
| With the home active, a call with no root and no active folder answers with the injected storage (as today) | null | Keeps today's behaviour for "no folder open" | yes |

## Plan deviations

None in contract. The plan lists `getPluginSourceDescriptors(): Record<pluginPath, {sourceRef, label}>`.
This batch implements it with a named `PluginSourceDescriptor` interface exported from the loader
file.

## Out-of-scope observations

- `libs/backend/agent-sdk/src/index.ts` (not in this batch) does not re-export
  `PluginLoaderInitOptions`, `PluginSourceDescriptor` or the `plugin-config-home` helpers. Hosts
  and later batches (B11/B12) may want `PluginLoaderInitOptions` and `PluginSourceDescriptor`
  from the barrel. Structural typing works without them, so nothing here needs that change to
  compile.
- `session-query-executor.accounts.spec.ts:174,183` `no-unexpected-multiline` lint errors already
  exist on `main` and make `@ptah-extension/agent-sdk:lint` fail for every batch that lists
  agent-sdk.
- No Batch 4 (agent-generation) file was touched, and no host typecheck failed.
