# Code Logic Review - TASK_2026_361 Batch 1

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 1              |
| Serious Issues      | 2              |
| Moderate Issues     | 2              |
| Failure Modes Found | 5              |

Scope reviewed: the ten Batch 1 contract files, their direct consumers, the approved Batch 1 contract in `batches.md` and `implementation-plan.md`, and `batch-1.report.md`. No source files were modified during this review. The required `ptah.*` symbol/AST tools were not available in this session, so `rg` and targeted read-only file inspection were used as fallback.

The v3 phase manifest, its failed-phase refinement, the shared single definition of `GenerationAgentOutcome`, the writer/content interface shapes, and registry/runtime-name addition are aligned with the plan. `wizard:` is already present in `ALLOWED_METHOD_PREFIXES`; no redundant guard edit is needed. The batch is nevertheless not safe to hand to later batches until the public options contract and durable checkpoint validation gaps are resolved.

## The 5 Paranoid Questions

### 1. How does this fail silently?

The package's public `OrchestratorGenerationOptions` still resolves to the legacy service-local declaration, not the new type which has `abortSignal` and `onAgentOutcome`. A caller can believe it is using the new public contract while the actual service execution path has neither property. This turns cancellation and checkpoint callbacks into no-ops or forces later code to bypass type safety.

`GenerationCheckpointManifestSchema` labels itself as resume validation but accepts any `analysisData` value. A truncated or malformed persisted analysis object can pass the manifest boundary and fail only later while prompts or generation context are being built.

### 2. What user action causes unexpected behavior?

A user pauses generation and resumes after restart. The handler will need the public options type to pass its abort signal and per-agent checkpoint callback; today its import resolves to the old service type. A workaround cast can make the resume appear accepted while no checkpoint transitions are reported.

A user resumes a run whose checkpoint contains no `analysisDirectory`. The RPC DTO makes this field optional despite the requested resumable-run contract listing it as a field. A UI implementation cannot distinguish an intentionally unavailable directory from an omitted projection and may issue a resume without the context needed to show or validate it.

### 3. What data makes this produce wrong results?

A checkpoint with `input.analysisData: { projectType: 4 }`, a non-object, or a structurally incomplete analysis passes `z.unknown()` at `generation-checkpoint.types.ts:65`. The declared TypeScript type says `ProjectAnalysisResult`, so subsequent code is encouraged to trust data that the persisted-data schema did not validate.

An empty `GeneratedAgent[]` is still required by `GenerationSummary` even when outcomes are authoritative. The current evidence only shows the orchestrator writing the field and its test asserting it; it does not establish a production consumer. This preserves an obsolete, potentially bulky result channel that can disagree with outcomes.

### 4. What happens when dependencies fail?

The multi-phase manifest schema correctly rejects v2 and rejects `failed` phases without a non-blank error, so malformed analysis phase state will be stopped at the storage boundary once Batch 2 consumes it. The generation checkpoint does not provide equivalent validation for the nested analysis payload, so corrupt file I/O is not uniformly contained.

The registry has the compile-time and runtime name entry, and the existing prefix guard accepts `wizard:`. Handler registration and Zod request validation are deliberately Batch 3 work; until then, a registry-only RPC cannot service recovery requests. This is expected sequencing, but it means Batch 1 must present a sound public type surface now.

### 5. What's missing that the requirements didn't mention?

The approved design requires a durable schema for `analysisData` but does not identify a portable Zod schema for the shared `ProjectAnalysisResult` type. A schema cannot be considered a resume safety boundary while a persisted nested object is `unknown`.

The task does not explicitly say how a missing analysis directory should be represented over RPC. The checkpoint permits absence, while the recovery DTO needs a stable field. The wire contract should choose `string | null` (or a clearly documented required string) instead of conflating absence with an omitted property.

## Failure Mode Analysis

### Failure Mode 1: Split public orchestrator options

- **Trigger**: Batch 3 imports `OrchestratorGenerationOptions` from `@ptah-extension/agent-generation` and adds abort/outcome fields.
- **Symptoms**: The handler either fails typecheck, casts around the failure, or invokes an orchestrator whose active options omit both controls.
- **Impact**: Critical. Cancel/resume durability and truthful terminal outcomes are core recovery guarantees.
- **Current Handling**: `core.types.ts:593-608` defines the new fields, but `types/index.ts:10-24` does not export that type and the package root exports the separate service declaration at `src/index.ts:31`.
- **Recommendation**: Establish exactly one exported options interface. Make the service consume/re-export the canonical core type and point the package root at that same symbol; add a compile-time public-import test covering `abortSignal` and `onAgentOutcome`.

### Failure Mode 2: Corrupted checkpoint analysis accepted as valid

- **Trigger**: A host crash or manual file modification leaves malformed `input.analysisData` in a checkpoint.
- **Symptoms**: Discovery calls the manifest resumable, then generation later produces a wrong prompt or throws while reading assumed analysis fields.
- **Impact**: Serious. It defeats the stated "validate every manifest read through Zod" mitigation and converts a recoverable corrupted checkpoint into a late failure.
- **Current Handling**: `GenerationCheckpointManifestSchema` validates the container but uses `z.unknown()` for `analysisData` at `generation-checkpoint.types.ts:61-66`.
- **Recommendation**: Validate the nested payload with a reusable schema that exactly corresponds to `ProjectAnalysisResult`, or make persisted analysis data a separately validated artifact and reject the entire checkpoint on failure.

### Failure Mode 3: Obsolete agent detail survives beside authoritative outcomes

- **Trigger**: A generation produces a mixture of written, unchanged, and failed agents.
- **Symptoms**: Future code can read `summary.agents` and report only rendered agents while the completion payload correctly reports full outcomes.
- **Impact**: Serious. The UI may regress to successful-only counts and lose partial failures.
- **Current Handling**: `GenerationSummary` retains `agents: GeneratedAgent[]` at `core.types.ts:677-680`. The report cites construction and its own test assertion, but `rg` found no production read of `summary.agents`; the only direct read is `orchestrator.service.spec.ts:576-577`.
- **Recommendation**: Remove `agents` and update its test when Batch 2 changes the orchestrator, unless a concrete production consumer is identified and migrated to outcomes. Do not treat the producer or a legacy test as the required consumer.

### Failure Mode 4: Incomplete resume-location wire shape

- **Trigger**: A checkpoint created from `analysisData` has no persisted analysis directory and is projected to the recovery response.
- **Symptoms**: The frontend receives a structurally valid response whose optional property does not say whether the directory is unavailable, omitted accidentally, or not yet loaded.
- **Impact**: Moderate. Resume UX can choose the wrong action or fail validation without an actionable explanation.
- **Current Handling**: `ResumableGenerationRun.analysisDirectory?: string` at `rpc-setup.types.ts:160-166`; the requested DTO calls for an `analysisDirectory` field.
- **Recommendation**: Specify and enforce a wire representation (`analysisDirectory: string | null` is the clearest option), then map checkpoint absence explicitly in Batch 3.

### Failure Mode 5: Verification evidence conceals still-broken consumers

- **Trigger**: A consumer project typechecks against the new `GenerationCompletePayload` before its owning later batch lands.
- **Symptoms**: Frontend/RPC/CLI compilation fails on removed `generatedCount`; the report's generic wording makes the blast radius difficult to audit.
- **Impact**: Moderate. The breakage is expected by sequencing, but release coordination can miss a consumer.
- **Current Handling**: `batch-1.report.md:57-61` says no relevant consumer remains inside two projects, while direct consumers still include `wizard-generation-rpc.handlers.ts:584,618,648`, `wizard-phase-generation.ts:93`, and CLI wizard command/spec paths. Its first "exact command" is a placeholder at line 65 rather than the actual command.
- **Recommendation**: List every known downstream file with the expected owning batch and record literal commands/outputs. Also write the requested `agent-output-{agentId}.md`; the report's claim that this would violate source scope is not supported by the task's explicit deliverable convention.

## Critical Issues

### Issue 1: The exported options type is not the new contract

- **File**: `libs/backend/agent-generation/src/index.ts:31`, `libs/backend/agent-generation/src/lib/types/core.types.ts:593`
- **Scenario**: RPC handlers import the documented public type then implement pause/cancel checkpointing.
- **Impact**: Cancellation and per-agent persistence can be dropped or require unsafe casts.
- **Evidence**: The root exports from `./lib/services/orchestrator.service`, which declares its own older `OrchestratorGenerationOptions`; the new fields exist only in `core.types.ts` and are absent from `types/index.ts`.
- **Fix**: Unify/re-export one canonical type before Batch 3 depends on it.

## Serious Issues

### Issue 2: The checkpoint schema trusts persisted nested analysis data

- **File**: `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts:65`
- **Scenario**: A partially written or edited checkpoint has invalid analysis data.
- **Impact**: Late runtime failure or incorrect generated content after the system called the manifest resumable.
- **Evidence**: `analysisData: z.unknown().optional()` accepts all values despite the interface declaring `ProjectAnalysisResult`.
- **Fix**: Add a portable `ProjectAnalysisResult` Zod schema and use it here, or reject/omit invalid persisted analysis.

### Issue 3: `GenerationSummary.agents` has no demonstrated production consumer

- **File**: `libs/backend/agent-generation/src/lib/types/core.types.ts:677`
- **Scenario**: Mixed terminal outcomes are mapped by future handler/UI code.
- **Impact**: A parallel legacy detail channel can be selected accidentally and hide failures/unchanged files.
- **Evidence**: The report's cited source only creates the field; the direct read is a test assertion.
- **Fix**: Remove it when Batch 2 updates the orchestrator, or document the actual production consumer and migrate it to outcomes.

## Data Flow Analysis

```text
checkpoint.json (untrusted file)
  -> GenerationCheckpointManifestSchema
     -> input.analysisData = z.unknown()  [GAP: malformed data passes]
     -> Batch 2 storage / Batch 3 recovery DTO
        -> public OrchestratorGenerationOptions
           -> package root exports service-local type [GAP: abort/callback fields absent]
           -> orchestrator
              -> GenerationSummary.outcomes (authoritative)
              -> GenerationSummary.agents (legacy parallel channel) [GAP: divergence]
                 -> GenerationCompletePayload
                    -> RPC/frontend/CLI consumers still using generatedCount [expected later-batch breaks]
```

### Gap Points Identified:

1. Persisted analysis data crosses a Zod boundary without structural validation.
2. The public type barrel and service implementation expose different orchestrator option contracts.
3. Legacy summary and completion consumers can conceal partial outcomes until their later-batch migrations land.

## Requirements Fulfillment

| Requirement                                                           | Status   | Concern                                                                                                              |
| --------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| v3 manifest, full phase statuses, failed-error refinement, no v2 shim | COMPLETE | `MultiPhaseManifestSchema` correctly uses `z.literal(3)` and rejects blank failed errors.                            |
| Versioned generation checkpoint and type-only/value exports           | PARTIAL  | Shape/export mechanism is correct, but nested persisted `analysisData` is not validated.                             |
| Single shared `GenerationAgentOutcome`                                | COMPLETE | Defined once in shared; backend imports/re-exports type only.                                                        |
| New completion payload / remove `generatedCount`                      | PARTIAL  | Shared contract is correct; all direct later-batch consumers are not fully enumerated in the report.                 |
| Abort/outcome orchestrator contract                                   | PARTIAL  | New core declaration exists but is not the package's active public/service declaration.                              |
| Resumable-run RPC registry and DTO                                    | PARTIAL  | Registry/name entries are correct; `analysisDirectory` optionality is under-specified.                               |
| Batch report and verification evidence                                | PARTIAL  | Commands are not all literal, downstream files are incomplete, and the requested agent-output deliverable is absent. |

### Implicit Requirements NOT Addressed:

1. Every checkpoint field that is trusted after resume needs a real schema, including nested analysis context.
2. A public type added for downstream handlers must be the actual package export and implementation input type.

## Edge Case Analysis

| Edge Case                              | Handled | How                                               | Concern                                 |
| -------------------------------------- | ------- | ------------------------------------------------- | --------------------------------------- |
| Failed analysis phase with blank error | YES     | Per-phase Zod refinement rejects it.              | Good.                                   |
| Historical v2 manifest                 | YES     | `version: z.literal(3)` rejects it.               | Good.                                   |
| Malformed checkpoint analysisData      | NO      | `z.unknown()` accepts it.                         | Late failure after resumable discovery. |
| Cancel signal from RPC handler         | NO      | Active public/service options omit the new field. | May require unsafe cast or be ignored.  |
| Mixed written/unchanged/failed output  | PARTIAL | Shared outcome payload supports it.               | Legacy `agents` channel can diverge.    |
| Missing analysis directory on resume   | PARTIAL | Optional field is allowed.                        | Wire semantics are ambiguous.           |
| GeneratedCount consumer compiled early | NO      | Later batches have not migrated it.               | Expected but must be tracked precisely. |

## Integration Risk Assessment

| Integration                                    | Failure Probability  | Impact                                       | Mitigation                             |
| ---------------------------------------------- | -------------------- | -------------------------------------------- | -------------------------------------- |
| RPC handler -> public agent-generation options | HIGH                 | Cancel/checkpoint callbacks unavailable      | Unify exported and service input type. |
| Checkpoint file -> storage resume              | MEDIUM               | Late malformed-data failure                  | Validate nested analysis payload.      |
| Orchestrator summary -> completion broadcast   | HIGH until Batch 3/4 | Incorrect/compile-failing completion mapping | Migrate to `outcomes` only.            |
| Resume DTO -> frontend action                  | MEDIUM               | Ambiguous absent analysis context            | Use required or nullable field.        |

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Top Risk**: The package exports a legacy `OrchestratorGenerationOptions`, so the new abort and outcome callback contract is not actually reachable by its primary RPC consumer.

## What Robust Implementation Would Include

- One canonical `OrchestratorGenerationOptions` type, used by the service and exported from the package root.
- A structural Zod validator for every persisted checkpoint member, especially `analysisData`.
- Outcomes as the sole terminal detail channel, with legacy successful-agent detail removed unless a production read is proven.
- A stable nullable/required analysis-directory recovery DTO and exact downstream consumer migration ledger.
- Literal verification commands and the required agent-output artifact in addition to the batch report.
