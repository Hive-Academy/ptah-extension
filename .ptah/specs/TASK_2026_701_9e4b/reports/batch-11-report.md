# Backend implementation — `TASK_2026_701_9e4b`, batch 11

**Tasks completed**: 11.1 `GenerationPreviewService` (B5): preview extraction, target choice, file
states with HMAC revisions, model/Library/origin decorations, and token-bound keep/replace decisions
on `wizard:submit-selection`.

## Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/libs/backend/rpc-handlers/src/lib/`.

- CREATED `handlers/wizard-generation/generation-preview.service.ts` — `@injectable` service.
  - `previewRivals`, `previewAgent`, `previewFile` and `previewSignature` moved here from the
    handler.
  - **Target:** `resolveGenerationTarget(opened, choice)` defaults to `harness-root`.
    `opened-folder` applies only when it differs from the harness root; otherwise the choice
    collapses to `harness-root` and `openedIsHarnessRoot: true`.
  - **Rival status (R1-5):** checked in this order: `harness-unavailable` (no rows) →
    `opened-folder-elsewhere` (only for the opened-folder target, no rows, sub-folder warning) →
    `cli-detection-failed` (verify threw, no rows) → `listed`. A harness-root target in a
    sub-folder now verifies at the harness root and lists rival rows.
  - **Claude file probe:** `readFile` → `exists` + `hashContent` baseline; `ENOENT` → `new`; any
    other error → `unreadable` (warned).
    - `revision = HMAC-SHA256(per-process randomBytes(32), absPath\0state\0hash)`.
    - `relPath` stays relative to the opened folder (`../../.claude/...` above it).
  - **Decorations**, each best-effort: a failure omits the field and logs a warn.
    - `agentModel`: `resolveClaudeAgentModel` with the template from `TEMPLATE_STORAGE_SERVICE` and
      layers from `AGENT_MODEL_SETTINGS.layersForPath(harnessRoot)`.
    - `libraryCopyEdited`: `USER_LAYER_MIRROR_SERVICE.readCloneEditState('agent', id, harnessRoot)`.
    - `unchangedSinceWizardWrite` (D10): origin store hash compared with `hashWrittenFile`.
  - **Token record:** `{token (randomUUID), canonicalWorkspace, target, agentIds (sorted), signature, baselines}`.
    - Records are keyed `tab:<tabId>` / `untabbed`, in a bounded map of 64. The oldest record is
      evicted first. A new preview for the same key supersedes the old one.
  - **`validateDecisions`** returns `{ok, guards, target, tokenBound}` or `{ok:false, reason:'preview-required'}`.
  - **`release(key)`** drops the record after a launch.
- CREATED `handlers/wizard-generation/generation-preview.service.spec.ts` — 37 cases. It uses a
  real child container, the real origin store and a temp folder under `os.tmpdir()`.
  - Preview cases: `resolveGenerationTarget`; the three file states; revision stable / changed /
    per-process; the four rival statuses; model origins (template, workspace, machine, ignored
    override, unreadable settings, missing template); Library flag; D10 label; read-only.
  - `validateDecisions` cases: no-token create-only without re-preview; tab mandatory preview;
    keep / create-only / replace guards; unreadable forced keep; replace on new or unreadable;
    missing or stale revision; superseded token, both with and without replace; per-key records;
    stray decision key; selection, target and workspace mismatch; changed signature; release; the
    64-record eviction.
- MODIFIED `handlers/wizard-generation-rpc.handlers.ts`:
  - Injects `GenerationPreviewService`. `wizard:preview-generation` delegates to it.
  - Removed the moved methods, `RivalPreview`, the preview constants, `confirmedPreviews` and
    their imports.
  - A fresh submit calls `validateDecisions`, with `requirePreview` set for a tab-bound submit.
    That keeps the mandatory preview; untabbed submits are token-bound only for replace.
    `preview-required` → `previewRequiredSubmit()`.
  - On acceptance the record is released (tab-bound, or when a token bound the decisions).
  - Guards flow `launchSubmittedRun` → `buildOptions(..., fileGuards)`.
  - A resume ignores request decisions and logs a warn (A1).
  - New `guardsForRunRoot` (see Decisions).
- MODIFIED `handlers/wizard-generation-rpc.schema.ts`:
  - `GenerationTargetChoiceSchema` and `FileDecisionEntrySchema` (`revision` ≤ 128).
  - `FileDecisionsSchema`: `z.record(WizardAgentIdSchema, …)`, at most 200 entries.
  - Submit gains `previewToken` (uuid), `fileDecisions` and `target`. Preview gains `target`.
- MODIFIED `handlers/wizard-generation-rpc.schema.spec.ts` — token/decisions/target accept and
  reject cases, the 200 cap, and the preview target.
- MODIFIED `handlers/wizard-generation-binding.ts` — removed `consumeConfirmedPreview`, which now
  has no caller. Added `previewRequiredSubmit()`, which keeps the existing error text.
- MODIFIED `handlers/wizard-generation-rpc.handlers.spec.ts`:
  - The harness builds the preview service with a fake origin reader. The `logger`/`container`
    casts are now shared once, so the spec has fewer `as unknown as` casts than before.
  - Two exact-object assertions now expect `localState` and `revision`.
  - The nested-folder test is split: the opened-folder target gets the warning; the harness-root
    default gets `../../` rows.
  - New `token-bound decisions on submit` block covering: state/token/revision in the response;
    no token → create-only; replace guard; stale token + replace; replace without a token;
    replace on unreadable; exists(A)→exists(B) with old revision refused and new one accepted;
    resume ignores decisions.
- MODIFIED `handlers/wizard-generation.preview-fidelity.spec.ts` — builds the production preview
  service over the registered `AGENT_ORIGIN_STORE`. Its assertions are unchanged and still pass.
- MODIFIED `register-shared-rpc-handlers.ts` — `container.registerSingleton(GenerationPreviewService)`
  next to `GenerationRunSupervisor`.

## Stack observed

- tsyringe with `@inject` tokens. Class tokens follow the existing precedent
  (`@inject(GenerationCheckpointService)`, `wizard-generation-rpc.handlers.ts`). Optional
  collaborators are looked up at call time through `PLATFORM_TOKENS.DI_CONTAINER`, the same way
  the handler does it.
- Zod 4.6.5 at the RPC boundary (`wizard-generation-rpc.schema.ts`).
- `hashContent` from `@ptah-extension/harness-sync` is the same hash the guarded writer
  compares (`file-writer.service.ts` `blockedByGuard`).
- `AGENT_ORIGIN_STORE` is registered in `agent-generation/src/lib/di/register.ts:181`.
- `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS` follows the precedent in `skills-synthesis-rpc.handlers.ts`.
- A-dir: the `handlers/auth/` subfolder already exists, so the `wizard-generation/` subfolder is
  used.

## Verification

- `npm run verify -- -p @ptah-extension/rpc-handlers` → **"3 tasks: 3 succeeded"**, exit code 0
  (lint, test, typecheck).
  - Earlier runs failed on my code and were fixed:
    1. `template.value` was possibly undefined (typecheck).
    2. `errnoCode` used `instanceof Error`, which is false for fs errors from another realm under
       jest, so a missing file read as `unreadable`. It now checks the error structurally.
    3. The signature depended on the order of agent ids; it is now sorted.
    4. One more exact-object assertion needed the two new fields.
- `node scripts/verify.mjs --exec --task di-lint -- npx nx run di-lint:lint` → 1 task succeeded.
- Degradation audit (`tools/degradation-audit/check-degradation.ts`):
  `libs/backend/rpc-handlers: 1 ok (baseline 1)`. The new optional-decoration catches carry
  `optional-capability` markers.
  - The run exits 1 only because of `libs/backend/agent-sdk: 8 FAIL (baseline 4)`, a lib being
    edited in parallel by another developer and not in this batch.
  - Also reported: `ipc-bridge.ts:324` floating-promise, and the pre-existing orphaned marker at
    `session-importer.service.ts:993`.
- **Not run**, per the spawner's instruction to verify only rpc-handlers:
  - the Batch 11 line `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli`;
  - the three `container.smoke.spec.ts` / `EXPECTED_RESOLVABLE` host checks (A33).
  - These hosts resolve `WizardGenerationRpcHandlers` → `GenerationPreviewService` →
    `AGENT_ORIGIN_STORE`. The team-leader should run them.
- No build/serve/e2e targets were run. Nothing was written outside temp dirs; the service spec
  uses `os.tmpdir()` folders with their own `.ptah` marker.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Guards apply only when the chosen target root is where this run writes (`opened-folder`, or opened == harness root). Otherwise the run is create-only, with a warn when a token bound decisions. | apply always; create-only on mismatch; also move the output root now | Until B6 (Batch 12) persists `outputRoot`, the run writes under `outputDirectoryFor(effectiveWorkspace)`. A `keep` guard recorded for the harness-root file would then silently skip creating the opened-folder file. Create-only can only keep files. | yes — Batch 12 removes `guardsForRunRoot` |
| `keep` (or no decision) on `exists`/`unreadable` → `{mode:'keep'}`; on `new` → `create-only`. | create-only everywhere; keep | D7: kept agents are not regenerated. `AgentFileGuard` includes `{mode:'keep'}` (`core.types.ts:595`). | yes |
| Without a valid token every agent is `create-only`, even with keep decisions. | apply keep decisions untokened | A2: no token = create-only. A keep decision on a superseded record could skip an agent whose file has been deleted since. | yes |
| A superseded or unknown token with no replace is accepted as create-only, not refused. | refuse any stale token | Plan :435 refuses an unknown/superseded token "with any replace". Create-only is safe. | yes |
| A valid token also requires the same selection set and target, and an unchanged signature. A tab-bound submit without a token keeps the previous signature-only mandatory check. | — | Plan :434-437; previous behaviour at `:480-501` kept. | yes |
| The signature is `[chosenTarget, ...sorted definite (target, relPath, willOverwrite)]`. | include the revision | Including the revision would force a re-preview after any keep-only edit. The writer's baseline hash already catches post-preview edits (`changed-since-preview`). | yes |
| The revision HMAC covers `absPath`, as well as state and hash. | state+hash only | It binds a revision to its file, so a target change yields new revisions (A26 "a target change resets every choice"). | yes |
| Untabbed previews also get a token, under the shared `untabbed` key. | tab only | "untabbed submits are still token-bound" (batch quality requirement). The legacy wizard and CLI can bind replaces. | yes |
| `libraryCopyEdited` and `unchangedSinceWizardWrite` are omitted for the opened-folder target. | always compute | Both records describe the harness root; an opened-folder write reaches neither. | yes |
| `unchangedSinceWizardWrite` is `false` (not omitted) when a record exists but the hash differs. | omit | It tells the UI the file was edited after the wizard wrote it. Absent still means no record. | yes |
| The origin store is injected as `Pick<WizardAgentOriginStore,'read'|'hashWrittenFile'>`. | concrete class | The preview never records. A narrow type lets the handler spec pass a fake without a cast. | yes |
| `isRegistered(token, true)` (recursive) for optional collaborators. | non-recursive, as the old handler did | The fidelity spec and hosts may resolve through child containers. The mock containers ignore the flag. | yes |

## Plan deviations

- The shared outcome unions are not widened (D18 note respected).
- The batch-level host verify was not run (see Verification). This follows the spawner's
  instruction.

## Notes for later batches

- **Batch 12 (B6):**
  - Persist `validateDecisions(...).guards` and `.target` into the manifest (`fileGuards`,
    `target`, `outputRoot`).
  - Then delete `guardsForRunRoot` and pass guards from the manifest only in `buildOptions`.
    Today they arrive as a `buildOptions` argument for fresh submits; resume gets none.
  - `lastGenerationOptions` (untabbed retry) currently carries the fresh run's `fileGuards`. Retry
    therefore honours keep/replace for untabbed runs, but tab-bound retry has none until the
    manifest holds them.
- **Frontend batches:**
  - Send `previewToken`, `fileDecisions{decision, revision}` and `target` on submit.
  - Preview accepts `target`.
  - The response carries `previewToken`, `target`, `rivalStatus`, the per-claude-row `localState`
    and `revision`, and per-agent `agentModel`, `libraryCopyEdited` and
    `unchangedSinceWizardWrite`.
- **Behaviour change:**
  - In a sub-folder workspace the default preview now lists harness-root paths (`../../…`) and
    rival rows.
  - The run still writes under the opened folder until Batch 12, so the preview and the run
    disagree there for now.

## Out-of-scope observations

- The degradation audit fails on `libs/backend/agent-sdk: 8 (baseline 4)` and an
  `apps/ptah-electron/src/ipc/ipc-bridge.ts:324` floating-promise. Neither is in this batch's
  files; they are likely from the parallel lanes.
