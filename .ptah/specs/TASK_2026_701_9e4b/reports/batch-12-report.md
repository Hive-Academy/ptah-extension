# Backend implementation: `TASK_2026_701_9e4b`, batch 12

**Tasks completed**: 12.1 (B6: run manifest decisions, resume and retry, D18 widening) and
12.2 (B7: post-run Library outcome).

## Files

All paths are under `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\`.

### Task 12.1: B6 and the D18 widening

- MODIFIED `libs\shared\src\lib\types\wizard\phase.ts`
  - `GenerationAgentOutcome.status` is now `FileOutcome`.
  - `GenerationCompletePayload` gains `keptCount?` and `changedSincePreviewCount?`. They are optional on the wire because older hosts do not send them.
- MODIFIED `libs\shared\src\lib\types\rpc\rpc-setup.types.ts`: `ResumableGenerationAgent.status` is now `'pending' | 'running' | FileOutcome`.
- MODIFIED `libs\shared\src\lib\types\rpc\rpc-setup-generation.contract.spec.ts`
  - `_AgentOutcomeNotYetWidened` is replaced by `Equal<GenerationAgentOutcome['status'], FileOutcome>`.
  - New assertion on the `ResumableGenerationAgent` status.
- MODIFIED `libs\frontend\setup-wizard\src\lib\components\completion.component.ts`: type-only change. `AgentOutcomeTile.status` is now `FileOutcome`. Rendering is untouched (Batch 17 owns it).
- MODIFIED `libs\backend\agent-generation\src\lib\types\generation-checkpoint.types.ts`
  - The checkpoint agent status is widened.
  - The manifest gains `target?`, `outputRoot?`, `fileGuards?: Record<id, AgentFileGuard>` and `library?: {pass, diverged}`, each with a Zod schema. The guard schema is a discriminated union, and a replace guard must carry a baseline.
- MODIFIED `libs\backend\agent-generation\src\lib\types\core.types.ts`
  - `KeptAgentOutcome` and `GenerationSummary.keptOutcomes` are deleted.
  - `keptCount` and `changedSincePreviewCount` are now required.
- MODIFIED `libs\backend\agent-generation\src\index.ts`: the `KeptAgentOutcome` export is removed.
- MODIFIED `libs\backend\agent-generation\src\lib\services\orchestrator.service.ts` (+ `.spec.ts`)
  - `kept` and `changed-since-preview` outcomes now go into `outcomes`.
  - `onAgentOutcome` fires for them, so the checkpoint records them.
  - They carry 0 sections.
  - Counts and the "settled" rule are unchanged in meaning.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-checkpoint.service.ts` (+ `.spec.ts`)
  - `FreshGenerationRun` requires `target` and `fileGuards`.
  - `createFresh` writes `{outputRoot}/.claude/agents` and persists `target`, `outputRoot` and one guard for each selected id.
  - New exported `generationOutputRoot` function.
  - `isTrusted`: when `outputRoot` is present it must be the workspace or its harness root, and the output directory must be exactly that root's `.claude/agents`. A legacy manifest keeps the old under-workspace rule.
  - `prepareResume` carries `kept` and `changed-since-preview` agents forward with their own status and clears `library`. It logs `createOnly` for a manifest without guards.
  - `recordPropagation` takes an optional `library` argument.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-binding.ts`
  - The results now carry statuses for files left alone.
  - The counts gain `kept` and `changedSincePreview`.
  - `target`, `libraryPass` and `libraryDiverged` are filled from the manifest.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-run.supervisor.ts`
  - `buildCompletePayload` counts `kept` and `changed-since-preview`, so counts equal rows.
  - The `resultDetails` Pick gains `target`, `libraryPass` and `libraryDiverged`.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.ts` (also Task 12.2)
  - `guardsForRunRoot` is deleted.
  - A fresh submit passes the validated `target` and `guards` to `createFresh`.
  - `buildOptions` and the bound retry take `outputRoot`, `fileGuards` and `onAgentWritten` from the manifest only, through `manifestWriteOptions`. Untabbed retry reuses `lastGenerationOptions` and the new `lastRunScope`.
  - Retry treats `kept` as settled.
  - A retry that ends `changed-since-preview` returns `success:false` with an explicit message.
  - The retry `outputDirectory` comes from the run's output root.

### Task 12.2: B7

- CREATED `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation\generation-library-outcome.ts` (+ `.spec.ts`). It holds pure functions:
  - `libraryPassFor`
  - `writtenAgentIds`
  - `collectLibraryDiverged`: a clone qualifies only if it is `diverged` and `pendingSourceHash` equals the recorded origin hash. A read failure omits the agent with a warning. Own properties only.
- Handler, same file as above:
  - `propagateGeneratedAgents(harnessRoot)` now calls `propagateWithReport` and returns `{propagation, userLayer}`. Consent is granted on the harness root.
  - `postRunFacts`:
    - Nothing written: no pass; the previous propagation is restored for a bound run.
    - Output root is not the harness root: no consent, no pass, `not-attempted` and `not-applicable`.
    - Otherwise: propagate, then map `userLayer` to `libraryPass`. A bound run with an updated Library computes the diverged list.
  - The result is persisted with `recordPropagation(location, propagation, library)` and reloaded into the result facts.
  - `onAgentWritten` records the wizard origin with `hashWrittenFile` and `recordWritten` (B4) only when the run writes under the harness root.
  - The origin store is injected (`AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE`, already registered and stubbed on every host, D27). The mirror is resolved lazily and optionally, as the preview service does.

### Specs updated for the constructor and API change

- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.spec.ts`
  - The propagation mock moves to `propagateWithReport`.
  - The origin fake gains `recordWritten`, and `makeSummary` gains the counts.
  - New block "run manifest decisions and Library outcome" with 10 cases.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation.preview-fidelity.spec.ts`: passes the origin store to the handler constructor.
- MODIFIED `libs\backend\agent-generation\src\lib\types\core.types.spec.ts`, `libs\backend\rpc-handlers\src\lib\handlers\guidance-generation-run.supervisor.spec.ts` and `libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-run.supervisor.spec.ts`: the required counts were added to their `GenerationSummary` literals.

## Stack observed

- Wiring is tsyringe `@inject` with `Symbol.for` tokens. The origin store token is in `agent-generation/src/lib/di/tokens.ts:175`.
- Optional services are resolved lazily through the container (`generation-preview.service.ts:676-683`).
- Persisted manifests are validated with Zod (`generation-checkpoint.types.ts`).
- Logging goes through the injected `Logger`.

## Verification

- Command: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-generation,@ptah-extension/rpc-handlers,@ptah-extension/setup-wizard,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`
  - Run 1: 74 tasks, 72 succeeded, 2 failed. The failures were `agent-generation:test` (TS2345, a string literal in my new `orchestrator.service.spec.ts` assertion; fixed with `as const`) and `ptah-extension-webview:lint`.
  - Run 2: 74 tasks, 73 succeeded, 1 failed. The only failure is `ptah-extension-webview:lint`, the accepted pre-existing D19.
  - My grep filter did not print the "Running target" header line. The task count matches all nine projects across three targets (lint, test and typecheck).
- Degradation audit (`node scripts/verify.mjs --exec --task degradation-audit -- npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`): exit 0. Every lib is at or below its baseline. None of the listed sites is in a file this batch touched.
- New catch blocks: `collectLibraryDiverged` (warning plus a `degradation-audit: reported` marker) and the mirror-resolve catch in `libraryDiverged` (same).

## Edge cases and risks

- **Options come from the manifest only.** Fresh, resume and retry all read `fileGuards` and `outputRoot` from the persisted manifest. Spec: "persists the target, the output root and the guards, and launches from them".
- **`isTrusted` accepts the harness root and rejects siblings.** Checkpoint spec "isTrusted accepts the harness root and the opened folder, and rejects a sibling". A real temp tree with `.git` is created and removed by the spec.
- **A pre-change manifest resumes create-only.** No `fileGuards` and no `outputRoot` are passed. Handler spec "a manifest from before runs carried guards resumes create-only".
- **Resume keeps kept files byte-identical.**
  - A `kept` record is terminal: it is not rerun and is carried forward as `kept`.
  - A pending agent with a `keep` guard is skipped by the orchestrator with no render and no write.
  - Specs: handler "a resume applies the manifest guards only and carries a kept file forward as kept", and checkpoint "a resume carries files left alone forward…".
- **Retry never replaces a kept file.**
  - The item's recorded guard is applied: keep means no generation.
  - A replace keeps its baseline check, so a file edited after the confirm ends `changed-since-preview` with `success:false`.
  - Specs: the two retry cases.
- **A failed refresher after writes leaves the outcomes intact and sets `libraryPass: 'failed'`.** Spec "a failed Library refresh…".
- **A skipped pass reports `not-applicable` even after an earlier success.** Spec "a skipped refresh is not-applicable even after an earlier pass updated the Library" (submit refreshed, then a retry skipped).
- **A kept agent is never listed as diverged; counts equal rows.** The list is built from `written` outcomes only. Specs: the handler "lists only written agents…" case and pure spec cases. `keptCount` and `counts.kept` were checked against the rows.
- **Opened-folder target means no consent grant, no pass and `not-applicable`.** Spec "the opened-folder target records no origin, grants no consent and runs no Library pass".
- **The sub-folder workspace now writes under the harness root.** This removes Batch 11's temporary create-only rule, so preview paths and the run agree. Spec "a folder below the harness root writes under the harness root and records origins there". The bound lookup still trusts that checkpoint.
- **DI host guards.** No new resolvable service is added. The handler now injects `AGENT_ORIGIN_STORE`, which every host registers and every smoke spec stubs (D27). The host test targets passed in the verify run.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| D18 widening is done here. | here; Batch 17 | The batches.md Task 12.1 D18 carry-over names this batch, which is the first to edit the checkpoint service. | yes |
| `keptOutcomes` is merged into `outcomes`; `KeptAgentOutcome` is deleted; the summary counts are required. | keep a separate list | Batch 10 report notes, plus the orchestrator's instruction. This required the three summary-literal spec fixes listed above. | yes |
| Guards are persisted as `AgentFileGuard` (`mode` key), not `{decision; baseline}`. | the plan's `{decision; baseline}` | It is the type the orchestrator consumes, so no mapping layer is needed and the Zod schema mirrors it exactly. | yes |
| The Library outcome is persisted as manifest `library?: {pass, diverged}`. | in-memory only | The recovery lookup (`generationRunState`) reads result facts from the manifest, the same as `propagation`. | yes |
| A carried-over `written` agent still reports `unchanged`; a carried-over `kept` or `changed-since-preview` agent keeps its status. | everything `unchanged` | Counts must equal rows, and a kept file was not written. | yes |
| The output root keeps the caller's spelling when the opened folder is the chosen root or is the harness root (`generationOutputRoot`). | always use `target.harnessRoot` | Existing manifests and payload paths stay identical for the common case. | yes |
| The origin record is written in `onAgentWritten` (harness-root runs only). | none (B4 records nothing today) | B7's diverged check needs B4's hash; no earlier batch wired `recordWritten`. | yes |
| A retry ending `kept` counts as success; `changed-since-preview` does not and returns a message. | treat both as failure | The kept result follows the user's decision. A changed file needs a fresh preview to replace it. | yes |
| The origin store is injected into the handler instead of resolved lazily. | lazy resolve | The token is always registered (D27) and the preview service already injects it. | yes |

## Plan deviations

These files are outside the Batch 12 list and had to change for the batch to compile or follow the orchestrator's instructions:

- `core.types.ts`, `orchestrator.service.ts` (+ spec) and the agent-generation `index.ts`: the `keptOutcomes` merge and required counts.
- `wizard-generation-binding.ts`: compile break from the widened checkpoint status.
- The handler spec, `wizard-generation.preview-fidelity.spec.ts` (constructor argument), `core.types.spec.ts`, `guidance-generation-run.supervisor.spec.ts` and `wizard-generation-run.supervisor.spec.ts` (required counts).

## Out-of-scope observations

- `libs\frontend\setup-wizard\src\lib\services\wizard-analysis-runner.service.ts:38`: `toProgressItem` marks only `written` and `unchanged` as complete. A `kept` or `changed-since-preview` agent in a resumable run now shows as pending, although resume will not rerun it. Not edited because it is outside the batch; suggested for Batch 15 or 17.
- The working tree also holds uncommitted changes that are not from this batch. Do not attribute them to Batch 12 when staging:
  - `libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.ts`
  - `libs\backend\agent-generation\src\lib\services\user-layer\user-layer-plugin-agents.ts` (+ spec)
  - `libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.plugin-agents.spec.ts`
  - `decisions.md`
  - the untracked p1-b2 report and reviews

  They appear to come from the parallel P1-B2 correction (see `reports\p1-b2-correction-report.md`).
