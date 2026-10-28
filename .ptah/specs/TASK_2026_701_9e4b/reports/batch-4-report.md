# Batch 4 report: Wizard agent-origin store (B4)

Task 4.1, `WizardAgentOriginStore` and the `AGENT_ORIGIN_STORE` token, is implemented.

## Files

- CREATED `libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts`
  - Writes `{harnessRoot}/.ptah/setup-wizard/agent-origins.json`, shaped `{version:1, agents:{[slug]:{hash, writtenAt}}}`.
  - Validates with Zod. The hash must match `^sha256:<64 hex>$` and `writtenAt` is in epoch milliseconds.
  - API:
    - `read(harnessRoot)`
    - `recordWritten(harnessRoot, slug, hash): Promise<boolean>`
    - `forget(harnessRoot, slug): Promise<boolean>`
    - `originsPath(harnessRoot)`
    - `hashWrittenFile(filePath)`, which delegates to `computeSourceHash`.
  - A missing file reads as `{}`. An unreadable or corrupt file reads as `{}` with a `logger.warn`.
  - `recordWritten` never throws. A failed write, an invalid hash or an empty slug logs a warning and returns `false`.
  - `forget` on a slug with no record writes nothing.
  - Read-modify-write is serialized per origins path, so concurrent `recordWritten` calls in one batch do not lose entries.
  - Writes are atomic and retried through `atomicWriteWithRetry`, and keys are sorted so the output is deterministic.
- CREATED `libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.spec.ts` (12 tests):
  - the file path
  - a missing file reads as empty with no warning
  - a concurrent round-trip keeps both entries, with version and sorted keys checked
  - writing a slug again overwrites it
  - a legacy agent with no record is absent
  - corrupt JSON reads as empty, warns, and the next write replaces it
  - a schema mismatch (version 2) reads as empty and warns
  - `forget` keeps the other slugs
  - `forget` of an unrecorded slug leaves no file
  - an invalid hash or empty slug is refused
  - a failed write (a regular file in place of `.ptah`) returns `false` and logs no error
  - the store hash equals the `pendingSourceHash` from `UserLayerMirrorService.reconcile` for the same agent bytes, including CRLF content (agent clone diverged)
- MODIFIED `libs/backend/agent-generation/src/lib/di/tokens.ts`: adds `AGENT_ORIGIN_STORE = Symbol.for('WizardAgentOriginStore')` and the matching `AGENT_GENERATION_TOKENS` entry. The symbol description is unique in the repo (grepped).
- MODIFIED `libs/backend/agent-generation/src/lib/di/register.ts`: registers the store as a `Lifecycle.Singleton` `useClass` and adds it to the log list.
- MODIFIED `libs/backend/agent-generation/src/index.ts`: exports `WizardAgentOriginStore` and the types `AgentOriginEntry` and `AgentOrigins`.

## Stack observed

- DI is tsyringe: `@injectable()` plus `@inject(TOKENS.LOGGER)`, as in `analysis-storage.service.ts`.
- Tokens use `Symbol.for`, as in `di/tokens.ts`. Validation uses Zod, as in `managed-manifest.ts`.
- The hash comes from `user-layer/source-hash.ts:69-75`.
- `isErrnoCode` is reused from the same file. The lib already depends on `@ptah-extension/harness-sync` (`orchestrator.service.ts:32`).

## Verification

1. `npm run verify -- -p @ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli`: 58 tasks, 49 succeeded (26 from cache), 2 failed, 7 skipped.
   - Failed: `@ptah-extension/thoth-runtime:build` and `@ptah-extension/gateway-chat-bridge:build`. These are dependency builds that the host typechecks pull in.
   - Both fail on `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`:
     - TS2304 `isAbsentOrStringList` not found (:1000)
     - TS2339 `countPluginCommands` missing on `PluginLoaderService` (:681, :748)
   - That file belongs to Batch 3, which was in progress at the same time. It is not a Batch 4 file and I did not touch it.
   - The lock reported exit code 130. The run was also moved to the background at the 600 s tool limit.
   - Result: the host results (ptah-electron, ptah-extension-vscode, ptah-cli) **are not confirmed** for this batch. They need a re-run after Batch 3 lands.
2. The one allowed re-run was `npm run verify -- -p @ptah-extension/agent-generation -- --output-style=static`. It reported "Running targets lint, test, typecheck for project @ptah-extension/agent-generation" and passed:
   - test: 39/39 suites passed (39 spec files, including the new one); 1327 tests passed, 1 skipped.
   - typecheck: passed.
   - lint: 0 errors, 427 warnings. None of the warnings are in the Batch 4 files.
   - My first attempt at this re-run was stopped by the tool's 600 s background limit while it waited for the lock. I stopped its leftover node process (my own, pid 11092) and ran it again with a longer limit.
3. `ptah_get_diagnostics` on the new and changed files: 0 errors.
4. Host guard specs (container.smoke, expected-resolvable, surface-composition) were not edited. Per plan A33, resolution is proven transitively in Batch 11. Their pass/fail state in this batch is not confirmed, for the reason in item 1.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Atomic write uses `atomicWriteWithRetry` from `@ptah-extension/harness-sync`, not the `IFileSystemProvider` port | FS port; node `fs` by hand; harness-sync helper | The port has no rename (`file-system-provider.interface.ts`), so tmp+rename cannot go through it. The cited pattern `managed-manifest.ts:177-203` uses exactly this helper. agent-generation already imports harness-sync. `computeSourceHash` already uses node `fs` directly. | yes |
| A missing file reads as empty with no warning; a corrupt or unreadable file warns | warn on both | A missing file is the normal state for every legacy or fresh workspace ("legacy unmarked → absent"), so a warning on each read would be noise. `managed-manifest.ts:142-164` handles it the same way. | yes |
| Add `hashWrittenFile(filePath)` next to the planned API | callers import `computeSourceHash` themselves | Gives B5 and B10 one hash entry point that is guaranteed to match the mirror. The spec pins the equality through it. | yes |
| `recordWritten` and `forget` return `Promise<boolean>` and serialize per file | void fire-and-forget | Non-fatal by contract, but the caller can tell the record did not land, as with `ManagedManifestStore.save`. Serialization stops a batch of writes from losing entries. | yes |
| `writtenAt` is epoch milliseconds | ISO string | Matches the sibling `OriginSidecar.clonedAt` (`Date.now()`) | yes |

## Plan deviations

None in scope. The FS-port wording in the plan (:393) cannot be met because the port has no rename. See Decisions.

## Out-of-scope observations

- Batch 3's `plugin-loader.service.ts` does not compile at the moment I ran verify (see Verification item 1). It blocks host typecheck evidence for this batch.
