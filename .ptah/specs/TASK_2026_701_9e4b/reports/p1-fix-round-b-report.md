# P1 fix round B report — `TASK_2026_701_9e4b`

**Verdict**: all five findings and the in-scope minor are fixed, and each has a regression test. Verification passes for my projects. The exceptions are one accepted lint failure (D21) and one failure in another developer's in-progress rpc-handlers file (see Verification).

Worktree: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment`. No git commands were run, and `batches.md` was not edited.

## Findings

### S1 (Blocking): the persisted plugin-config predicate is replaced by Zod schemas

Changes in `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts`:
- `StoredPluginConfigSchema` (`:85`) is the strict persisted shape:
  - `enabledPluginIds` is required.
  - The other four lists are optional, but a list that is present must contain only strings.
  - `lastUpdated` is metadata. A value that is not a string is discarded (`.catch(undefined)`) and does not fail the config. This follows the review's "explicitly discard invalid metadata" option.
- `LenientPluginConfigSchema` (`:98`) is used for the display read. Its only difference: an unusable optional list reads as absent.
- `parsePluginConfig(unknown): PluginConfigState | null` (`:138`) is the strict read, and replaces the type-lying `isWellFormedPluginConfig` (deleted). `normalizePluginConfig(unknown)` (`:148`) is the lenient read and now takes `unknown`, not a falsely typed `PluginConfigState`.
- `PluginConfigHomeRecordSchema` (`:183`) is used by `parseHomeRecord` (`:246`). The `Partial<...>` / `as PluginConfigHomeOrigin` casts and `HOME_ORIGINS` are gone, and `PluginConfigHomeOrigin` is now inferred from the schema.
- Callers updated:
  - `viewFor().update` (`parsePluginConfig`, then save)
  - `candidatesOf`
  - In `plugin-loader.service.ts`: `readWorkspaceLayer`, `getWorkspacePluginConfig` and the save path now read `get<unknown>`.

Tests in `plugin-config-home.spec.ts`:
- `parsePluginConfig (strict persisted shape)` (`:139`ff): legacy missing arrays are accepted and normalized; a non-string `lastUpdated` is discarded (`:159`); seven rejection cases.
- `normalizePluginConfig (lenient display read)`.
- A home record read through its schema (`:236`): a bad id list is malformed, a bad `origin` is malformed, and a bad timestamp is dropped.

### S2 (Serious): `PluginLoaderInitOptions` is now one complete optional object

- `plugin-loader.service.ts:90`: both fields are required.
- `initialize(..., options?: PluginLoaderInitOptions)` (`:552`):
  - Omitting the options keeps the per-folder config.
  - The existing workspace-scoped storage check is kept. When options are given but the storage is not workspace-scoped, the loader now logs a warning (`:567`) instead of ignoring them silently.
- Callers:
  - Electron `apps/ptah-electron/src/activation/plugin-activation.ts` already passed both fields, so it needed no change.
  - VS Code and the CLI (`cli-engine/container.ts:931`) pass no options, which still compiles.
  - The two loader-spec fixtures changed `{}` to `undefined`.
  - `cli-agent-runtime`'s spec passes both fields.
  - `libs/agent-sdk/src/index.ts` exports the type unchanged. `rpc-misc.types.ts` needed no change.
- Test: `plugin-loader.service.spec.ts:1798`. Two `@ts-expect-error` lines pin that each half alone does not compile; `vscode-core:typecheck`/ts-jest fail if they ever compile again. A runtime assertion covers the warning for a non-scoped storage.

### B1 (Serious): an interrupted plugin-agent publication is now recoverable

In `user-layer-plugin-agents.ts`:
- `publish` (`:408`):
  1. Reads the source text once and hashes it (new `contentSourceHash`, `source-hash.ts:74`, which uses the same formula as `computeSourceHash` on a file).
  2. Writes a Zod-validated intent record `<slug>.ptah-origin-pending.json` (`PendingPublicationSchema`, `:209`) with slug, pluginId, sourceFile, sourceRef and the content hash.
  3. Writes the body, then the sidecar, then removes the intent.
- `mirrorExisting` (`:342`) → `resumePublication` (`:442`): when a body has no sidecar, the pass resumes only if the intent belongs to this exact source and the body's current hash equals the recorded hash. In that case it writes the sidecar and counts `agentsMirrored`.
  - If the body was edited since, it stays user-authored and the intent is dropped, so it can never be adopted later.
  - Another source's intent is left alone.
- Where the owned path still finds an intent, it clears it.
- The intent suffix ends in neither `.ptah-origin.json` nor `.md`, so `listClones`, the reaper, the seed and harness listings never see it.

Tests in `user-layer-plugin-agents.spec.ts`. Fault injection uses a directory at the sidecar path, so the sidecar's atomic rename fails after the body has landed:
- `:238`: a new instance (simulating a restart) resumes; the sidecar hash matches the content and the reconcile reaches the clone.
- `:273`: a user edit made after the interruption stays user-authored and the intent is dropped.
- `:294`: a same-basename source with a different path never resumes another source's intent.

### B2 (Serious): legacy sidecars without `sourceRef` cannot be adopted on an ambiguous basename

- `ownsSourcedClone` is replaced by `sourceOwnership(sidecar, pluginId, descriptor, basenameShared)`, which returns `'owned' | 'foreign' | 'ambiguous'` (`user-layer-plugin-agents.ts:174`). The new `sharedPluginBasenames(pluginPaths)` is at `:188`.
- When either side lacks `sourceRef` and another plugin root in the pass has the same basename, the result is `ambiguous`. The clone is then kept untouched: no fast-forward, no identity backfill, no `conflictsWith`. A warning is logged.
- Where the flag is applied:
  - `user-layer-mirror.service.ts`: `reconcile()` computes the flag once (`:646`) and passes it through `reconcilePluginSkills`/`reconcilePluginCommands` into `reconcileDirClone`/`reconcileFileClone`, which now take an explicit `descriptor, basenameShared` instead of an optional `descriptor?`. `ownsForReconcile` (`:1885`) logs the ambiguous case.
  - Plugin agents compute the same flag from `pass.pluginPaths`, in both `mirror` and `reconcile`. The callback args carry `basenameShared`.
- Tests:
  - Unit: `user-layer-plugin-agents.spec.ts:92`.
  - Service level: `user-layer-mirror.service.plugin-agents.spec.ts:524`. Two external `toolkit` plugins are used, the sidecars are aged into legacy ones, both upstreams change, and the test runs in **both orders** for an agent (file clone) and a skill (directory clone). Neither plugin fast-forwards or acquires the identity. With only one candidate left, the basename decides again and the ref is recorded.

### B3 (Moderate): per-file mirror and reconcile errors no longer report success

- New `userLayerPassFailures(result)` = `errors + retiredSkills.errors` (`user-layer-mirror.service.ts:208`), exported from `@ptah-extension/agent-generation` (`index.ts`).
- Electron, `plugin-activation.ts`:
  - `mirrorUserLayer` (`:414`) returns `failed` on counted failures and does not stamp the first backfill.
  - `reconcileUserLayer` (`:550`) records divergence first, then returns `failed`.
  - Since the pass already aggregates any `failed` step, the pass returns `failed`, `library:changed` carries `status: 'failed'`, and the refresher returns `failed`. The catalog sync still runs, so partial results are still shown.
- VS Code has the same code path, so it got the minimal equivalent in `apps/ptah-extension-vscode/src/activation/plugin-activation.ts`: mirror returns `null` (`:158`) and reconcile returns `false` (`:225`) on counted failures. The refresher's existing logic then reports `failed`.
- Tests:
  - `apps/ptah-electron/src/activation/plugin-activation.spec.ts:383` (step level, including no backfill stamp and retirement errors) and `:712` (pass level: requester, refresher and push all say `failed`, and the catalog still syncs). The spec's mirror mocks now include `retiredSkills`, matching the real type.
  - New `apps/ptah-extension-vscode/src/activation/plugin-activation.user-layer.spec.ts`, 4 tests.
  - `userLayerPassFailures` unit test at `user-layer-mirror.service.plugin-agents.spec.ts:631`.

### Minors

- The stale doc on `discoverSkillsShPluginPaths` (`plugin-loader.service.ts:~1459`) is rewritten. Skills.sh roots now reach `buildMirrorSources`, minus the ones switched off in `disabledPluginIds`, and uninstall cleanup relies on the deleted-upstream sweep.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:508` was **not changed**. That assertion checks `CLI_AGENT_RUNTIME_TOKENS.MCP_ATTACHMENT_PROBE` registration text in `phase-2-libraries.ts` and is unrelated to my changes, so the brief's "only if related" condition does not apply.

## Decisions

- **S1, a non-string `lastUpdated`**: discard it rather than reject the config. Evidence: it is display and tie-break metadata and never policy, so rejecting would turn a sound denylist into "policy unknown". Reversible.
- **S1, keep two read strengths**: strict for policy and the home, lenient for display. This preserves the existing lenient semantics of `getWorkspacePluginConfig`. One small difference: a list holding non-strings is now dropped rather than passed through. Reversible.
- **B1, intent record vs. trusting identical bytes**: the review asked for proof of the interrupted creation, so I used a durable intent record with the content hash. Byte-equality alone would adopt a user's hand copy.
- **B1, text instead of a byte copy**: the body is now written as the UTF-8 text that was hashed (`writeTextAtomic`) instead of a raw byte copy. This keeps the hash in the sidecar and the intent exactly equal to the published body. Agent files are Markdown, and the existing hash already decodes them as UTF-8.
- **B2 limitation**: ambiguity is judged over the plugin roots in the current pass. If plugin A is disabled and left out of the sources while B (same basename) is present, B can still adopt A's legacy clone. That would need persisted prior provenance, which does not exist for legacy sidecars.

## Verification

- `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli`: 61 tasks, 45 succeeded, 6 failed, 10 skipped.
  - `@ptah-extension/agent-sdk:lint` failed: only the accepted D21 errors (`session-query-executor.accounts.spec.ts:174,183`).
  - Not mine: `rpc-handlers:build`, `ptah-electron:typecheck`, `ptah-extension-vscode:typecheck`, `ptah-cli:typecheck` and `ptah-electron:test` all fail on one source only: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-preview.service.ts:714-715` (TS18048, `template.value` possibly undefined). That file is in the parallel rpc-handlers developer's working set. The typecheck logs contain no other errors.
  - In `ptah-electron:test`: 12 suites failed to compile on that same import (including `container.smoke.spec.ts`), 59 passed including `plugin-activation.spec.ts`, and 1128 tests passed.
  - The 10 skipped tasks depend on the failed rpc-handlers build, which includes the VS Code and CLI test targets.
- `npm run verify -- -t test,typecheck,lint -p @ptah-extension/agent-sdk,@ptah-extension/agent-generation`: 5 of 6 passed (agent-sdk test and typecheck; agent-generation lint, test and typecheck). The only failure is the accepted D21 agent-sdk lint.
- The new VS Code spec, run directly under the lock (`node scripts/verify.mjs --exec --task fixb-vscode-spec -- npx jest -c apps/ptah-extension-vscode/jest.config.ts --maxWorkers=2 .../plugin-activation.user-layer.spec.ts`): 4 of 4 passed. An earlier run caught a spec typing error, which is fixed.
- **Not yet run green**: `ptah-electron:typecheck/test`, `ptah-extension-vscode:typecheck/test` and `ptah-cli:typecheck/test` need a re-run once the rpc-handlers file compiles.

## Out-of-scope observations

- The CLI has the same unconditional `refreshed` at `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:146` (B3). It is outside my ownership. `userLayerPassFailures` is now exported for its fix.
- `reconcileMissingSidecar` / `reconcileMissingFileSidecar` still mint a sidecar from whichever same-basename plugin reaches a sidecar-less skill or command clone first. This is a similar ambiguity, but for the missing-sidecar path rather than the legacy-sidecar path. It was not part of B2.
