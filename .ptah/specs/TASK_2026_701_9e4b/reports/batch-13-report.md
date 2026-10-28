# Backend implementation: `TASK_2026_701_9e4b`, batch 13

**Tasks completed**: Task 13.1. It adds `wizard:plan-pack-install`, a guarded `installFiles`, and the concurrency fix (B8).

**Verdict**: complete. The scoped verify passes: `67 tasks: 67 succeeded`.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\backend\platform-core\src\agent-pack-download.service.ts`
  - `planDownload(manifestUrl, agentFiles, targetDir)` downloads into memory and writes nothing. It returns one row per file: `fetched: true` with `state` (`new` / `identical` / `differs` / `unreadable`), `content`, `baselineHash?` and `localText?`, or `fetched: false` with an `error` for that file.
  - `installFiles(targetDir, items)` takes `{file, content, guard}` items, with `guard` = `create-only` | `keep` | `replace{baselineHash}`. These are the B2 rules, written again in platform-core:
    - unreadable → `kept`
    - equal bytes → `unchanged`
    - create-only on an existing file → `kept`
    - keep → `kept`
    - replace when the hash still matches the baseline, or the file has been deleted → `written`
    - replace otherwise → `changed-since-preview`
    - a write error → `failed`
  - Installs are queued per canonical target directory (resolved, and lower-cased on win32). Each install writes through a temp file with a unique name, then renames it.
  - Deduplication now applies to network fetches only, keyed by URL (`inFlightFetches`).
  - Deleted: `downloadAgents`, `doDownloadAgents`, the target-blind `inFlightPromises` mutation dedup, the shortcut that skipped the download when the files already existed, and all cache metadata (`getCacheEntry`, `loadCacheMetadata`, `persistCacheMetadata`, `~/.ptah/.agent-pack-cache.json`, `buildCacheKey`, `AgentPackDownloadResult`, the progress callback).
  - Exports `hashPackContent`, which is SHA-256 of the UTF-8 text.
- MODIFIED `...\libs\backend\platform-core\src\agent-pack-download.service.spec.ts` — rewritten (30 tests). It covers plan states and that planning writes nothing, single-file scope, a per-file fetch failure, validation, fetch dedup, every guard outcome, an unreadable file kept under replace, the cached-pack plus hand-edited-file case (Keep stays byte-identical, Replace writes), concurrent installs into different roots, and serialized installs into one root.
- MODIFIED `...\libs\backend\platform-core\src\index.ts` — **deviation** (not on the batch list, but needed to compile). It exported the deleted `AgentPackDownloadService` result type. It now exports the new plan and install types and `hashPackContent`.
- CREATED `...\libs\backend\rpc-handlers\src\lib\handlers\setup\pack-install.service.ts` — `@injectable PackInstallService`:
  - `listPacks`, `plan` and `install`.
  - Checks the curated-source allowlist and authorizes the workspace (`findOpenWorkspaceRoot`; with no `workspacePath`, the active root).
  - Resolves the target with `resolveGenerationTarget`. The default is the harness root, even when the open folder is a sub-folder.
  - Keeps plan tokens in a map capped at 64 entries (oldest evicted first). Each row's revision is an HMAC under a per-process secret.
  - Caps the diff texts at 256 KiB.
  - Builds the per-file guards, and after a harness-root install runs consent → `forget` → `propagateWithReport`.
- CREATED `...\libs\backend\rpc-handlers\src\lib\handlers\setup\pack-install.service.spec.ts` — 26 tests. They use the real download service with `https` mocked, on temp-dir workspaces.
- MODIFIED `...\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.handlers.ts` (+ spec)
  - Adds `'wizard:plan-pack-install'` to `METHODS` and to `register()`.
  - Injects `@inject(PackInstallService)`, typed as `PackInstaller` (a `Pick` of the service).
  - The list, plan and install methods now only parse their params and delegate.
  - Removes the in-handler `new AgentPackDownloadService()` singleton and the inline install logic.
  - The spec now tests delegation, param parsing (`INVALID_PARAMS`), and that a refused install comes back as a failed RPC.
- MODIFIED `...\libs\backend\rpc-handlers\src\lib\handlers\setup-rpc.schema.ts` (+ spec)
  - Adds `WizardPlanPackInstallParamsSchema` and `PackFileDecisionsSchema` (at most 200).
  - `WizardInstallPackAgentsParamsSchema` gains `planToken` (uuid), `decisions` and `target`. These reuse `FileDecisionEntrySchema` and `GenerationTargetChoiceSchema` from `wizard-generation-rpc.schema.ts`.
  - The spec gets the same `workspace-intelligence` jest guard as its sibling schema spec, because it now pulls in the agent-generation barrel through that import.
- MODIFIED `...\libs\shared\src\lib\types\rpc.types.ts` — registry entries only: one method-map entry and one true-map entry for `wizard:plan-pack-install`.
- MODIFIED `...\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts` (ledger order 11 → 13) — adds `registerSingleton(AgentPackDownloadService)` and `registerSingleton(PackInstallService)`.
- MODIFIED `...\libs\backend\rpc-handlers\src\lib\rpc-allowlist.spec.ts` — new describe block in the style of lines 134-152: the method is in the registry, owned by `setup` only, and covered by the `wizard:` prefix.
- MODIFIED `...\apps\ptah-electron\src\di\rpc-surface.spec.ts`, `...\apps\ptah-extension-vscode\src\di\rpc-surface.spec.ts` and `...\libs\backend\cli-engine\src\lib\rpc\rpc-surface.spec.ts` — each gets an explicit `arrayContaining(['wizard:plan-pack-install', 'wizard:install-pack-agents'])` and a check that the method is not excluded.
- MODIFIED `...\apps\ptah-extension-vscode\src\integration\wizard-seed-noop.spec.ts` — **deviation** (not on the batch list, but needed to compile). It builds `SetupRpcHandlers` with 6 arguments, which failed with TS2554 in the first verify. It now passes an inline `{listPacks, plan, install}` stub for the new 7th parameter. No behaviour change.

## Stack observed

- tsyringe with explicit `@inject` on every parameter, in the style of `generation-preview.service.ts`. Class tokens follow the precedent of `@inject(GenerationCheckpointService)`.
- Singletons are registered in `register-shared-rpc-handlers.ts`.
- Zod parses params at the RPC boundary through `SetupRpcHandlers.parse`; a parse failure is `RpcUserError('INVALID_PARAMS')`.
- The service logs through the injected `Logger`.
- platform-core can depend only on `@ptah-extension/shared`, so its download service keeps its existing `console.warn` in `fetchPackInfo` and adds no new console calls.

## Verification

- First run of `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/rpc-handlers,@ptah-extension/shared,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli`:
  - Result: `67 tasks: 65 succeeded, 2 failed`.
  - `rpc-handlers:test` failed: `setup-rpc.schema.spec.ts` hit the ESM load error from `workspace-intelligence`. Fixed with the jest guard.
  - `ptah-extension-vscode:test` failed: `wizard-seed-noop.spec.ts` TS2554. Fixed as described above.
- Second run of the same command: `NX 67 tasks: 67 succeeded, 49 cached`. My filter did not print a "Running target" header line; 67 tasks matches lint, test and typecheck across the 7 projects.
- Degradation audit, run through `node scripts/verify.mjs --exec --task degradation-audit -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0.
  - `libs/backend/platform-core: 6 ok (baseline 7)` — down by one, because the cache-metadata catch was deleted.
  - `libs/backend/rpc-handlers: 1 ok (baseline 1)`.
  - The new catch in `runLibraryPass` has a `degradation-audit: reported` marker that attaches correctly; it is not reported as orphaned.
- The container smoke and surface-composition specs are green inside the host test targets. No change to `expected-resolvable` was needed: `SetupRpcHandlers` already resolves, and `PackInstallService` is registered.

## Validation notes, and the spec that covers each

- **A-cache.** The cache metadata methods were private and `.agent-pack-cache.json` has no other reader in `libs` or `apps` (checked by grep). All of it is deleted.
- **D13 unreadable file.** A Replace on an unreadable row becomes `keep`, is never written, and is not refused. Covered by `pack-install …forces Keep for an unreadable file` and `platform-core …never replaces an unreadable destination`.
- **D13 bulk.** A whole-pack Replace writes every `differs` file, keeps unreadable files, and creates new ones. Covered by `…whole-pack Replace … (D13 bulk)`.
- **Cached pack with a hand-edited file.** Keep leaves it byte-identical; Replace with the matching baseline writes it. Covered in both specs.
- **Concurrency.** Two installs into different roots with different decisions each get their own outcome. Two installs into one root, even when the path is spelled differently, are serialized: the second ends `changed-since-preview`, and no temp files are left behind.
- **Identical file** → `unchanged`.
- **Sub-folder default** → the harness root.
- **Opened-folder target** → no consent grant, no pass, no `forget`, and `libraryPass: 'not-applicable'`.
- **Replace without a token** → rejected with `INVALID_PARAMS`, and nothing is written.
- **Revision from an earlier plan** (differs A → B): rejected.
- **File edited after the plan** → `changed-since-preview`.
- **Completions that write nothing.** All-unchanged, all-kept and a re-install each run the pass and return `updated`.
- **Refresh failure.** Either a `failed` status or a thrown error gives `libraryPass: 'failed'`, and the per-file outcomes are unchanged.
- **Every file failed** → `success: false`, no consent grant, no pass.
- **Partial failure** → `success: true` and the pass still runs.
- **Single-file plan scope.** Only that file is downloaded.
- **Workspace path that is not an open folder** → `UNAUTHORIZED_WORKSPACE`.
- **Token planned for another target** → ignored, so its Replace is refused.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| A plan that cannot download one of its files throws, and the plan RPC fails | throw; return a partial plan | `PackFileState` has no failed state in the shared contract, and only registry entries may change in `rpc.types.ts` this batch | yes |
| A Replace on a `new` or `identical` row is create-only, with no revision check. A Replace on an `unreadable` row is Keep. Only a `differs` row is checked against its revision | refuse every non-differs Replace | D13 says a bulk Replace must skip unreadable files instead of failing | yes |
| A decision for a file that was not requested, or a Replace whose token does not match the source, opened folder or target, is refused with `INVALID_PARAMS` | ignore silently | Matches the wizard's `validateDecisions` behaviour (refuses unselected ids) | yes |
| Plan bytes are reused for 10 minutes (`PACK_PLAN_CONTENT_TTL_MS`). An older plan downloads the bytes again but keeps its guards. Rows that reach a non-failed outcome are consumed; failed rows stay in the token so the file can be retried | single-use token; no TTL | Plan text: "a token's bytes are used when the token is fresh; otherwise re-fetched with guards intact" | yes |
| A diff text over 256 KiB is left out of the plan row (`incomingText`/`localText` absent), not cut short | truncate | A truncated diff would misstate the file; both fields are optional in the shared type and the UI reads them as optional | yes |
| `agentsDownloaded` counts files that did not fail. `fromCache` is true only when every file used the plan's in-memory bytes | always false; count only written files | The on-disk cache is gone; the fields stay in the shared result type | yes |
| `libraryPassFor` is reused with `writtenCount` set to the non-failed count, so any non-failed completion runs the pass (A25) | a separate mapping | Same status mapping as the wizard | yes |
| `forget` runs only for files with outcome `written`, before the pass. A rejected or `false` forget is logged as a warning and does not fail the install | fail the install | B4 contract: "a community pack replaced the file" | yes |

## Plan deviations

- Edited `platform-core/src/index.ts`, which is not on the batch list, because the old export of a deleted type would not compile.
- Edited `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts`, which is not on the batch list, because the new constructor parameter broke it (TS2554).
- No change to `container.smoke`, `expected-resolvable` or `surface-composition` specs was needed.

## Out-of-scope observations

- Frontend (Batch 15): `wizard:install-pack-agents` now refuses any Replace that is not backed by a plan token. The UI must call `wizard:plan-pack-install` first and send back `planToken`, `decisions` (with each row's `revision`) and `target`.
- The working tree also contains changes to `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts` (+ spec). I did not make them.
