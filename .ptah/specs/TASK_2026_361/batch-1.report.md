# Batch 1 report — shared wire contracts and agent-generation foundations

## Scope and architecture assessment

Complexity level: 2. This batch is contract-only work with durable-state and
cross-boundary validation requirements; no new service or persistence pattern
was introduced. The existing shared-to-backend dependency direction was
preserved.

The requested Ptah code-index tools were unavailable in this session. Symbol
lookups used `rg` as the documented fallback.

## Files changed

Created:

- `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts`
  — version-1 generation checkpoint contracts and Zod manifest schema.

Modified:

- `libs/backend/agent-generation/src/lib/types/multi-phase.types.ts`
  — v3 manifest, full phase-status union, resume option, and refined Zod
  schema which rejects failed phases without a non-empty error.
- `libs/backend/agent-generation/src/lib/types/core.types.ts`
  — generation outcome-backed summary fields and the abort/outcome callback
  orchestrator contract foundation.
- `libs/backend/agent-generation/src/lib/types/enhanced-prompts.types.ts`
  — added enhanced-prompt trace metadata.
- `libs/backend/agent-generation/src/lib/types/index.ts`
  — type-only checkpoint/type exports and value schema exports.
- `libs/backend/agent-generation/src/lib/interfaces/content-generation.interface.ts`
  — abort signal plus rejected/tailored section counts.
- `libs/backend/agent-generation/src/lib/interfaces/agent-file-writer.interface.ts`
  — written-or-unchanged file result for single and batch writes.
- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`
  — resume flags, v3 analysis DTO fields, resumable generation DTOs, and
  resumable-run response.
- `libs/shared/src/lib/types/rpc.types.ts`
  — `wizard:get-resumable-run` registry/import/runtime-name entry.
- `libs/shared/src/lib/types/wizard/phase.ts`
  — single shared `GenerationAgentOutcome` and the replacement completion
  payload without `generatedCount`.

`GenerationAgentOutcome` is defined once in shared. Agent-generation imports
that shared type for `GenerationSummary` rather than duplicating the wire
contract.

## Consumer evidence

`GenerationSummary.agents: GeneratedAgent[]` remains because current code
constructs it at
`libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:534`
and its existing assertion reads it at
`libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts:576-577`.

`rg` found no `generatedCount` consumer within the shared or agent-generation
projects. Remaining out-of-scope consumers are expected follow-on work:
`rpc-handlers/wizard-generation-rpc.handlers.ts` (Batch 3),
`setup-wizard` state/phase/component specs (Batch 4), and CLI command/spec
consumers.

## Verification

1. `npx prettier --write <the ten Batch 1 source paths>` — PASS.
2. `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/agent-generation`
   — header reported `2 projects`, matching the requested two projects.
   - shared typecheck: PASS.
   - shared lint: PASS with the existing `rpc.types.ts` max-lines warning.
   - agent-generation lint: PASS with 390 existing warnings and no errors.
   - agent-generation typecheck: FAIL only at the later Batch 2 service
     implementation consumers listed below.
3. `npx nx run-many -t test -p @ptah-extension/shared`
   — header reported the single requested project; PASS: 49 suites / 1,216
   tests.
4. `npx nx run-many -t test -p @ptah-extension/agent-generation`
   — header reported the single requested project; FAIL at TypeScript compile
   boundaries before test execution completed: 24 suites passed, 4 failed;
   717 tests passed.
5. `npx nx run @ptah-extension/agent-generation:test -- --runInBand 2>&1 | Select-String -Pattern 'libs/backend/agent-generation/src/lib/.*(error TS|\\.spec\\.ts:)'`
   — diagnostic retry exited 1 without matching output; it made no changes.
6. `git diff --check -- <Batch 1 source paths>` — PASS.

### Remaining type errors (later-batch consumers)

- `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:110`
  — v2 comparison conflicts with v3 manifest type.
- `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts:254`
  — RPC manifest DTO construction lacks v3 fields.
- `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:132`
  — implementation has not returned section counts.
- `libs/backend/agent-generation/src/lib/services/file-writer.service.ts:74`
  — single writer still returns a string.
- `libs/backend/agent-generation/src/lib/services/file-writer.service.ts:154`
  — batch writer still returns strings.
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:454`
  — empty summary lacks new outcome aggregates.
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts:534`
  — completed summary lacks new outcome aggregates.
- `libs/backend/agent-generation/src/lib/services/wizard/multi-phase-analysis.service.ts:168`
  — implementation still writes `version: 2`.

### Remaining test compile errors

- `libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts:306,317,669,783,1090,1294,1383,1395`
  — mocks still provide the old content/writer result contracts.
- `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:132`
  — surfaced while compiling `content-generation.service.spec.ts`.
- `libs/backend/agent-generation/src/lib/services/file-writer.service.ts:74,154`
  — surfaced while compiling `file-writer.service.spec.ts`.
- `libs/backend/agent-generation/src/lib/types/core.types.spec.ts:216`
  — fixture still builds the pre-outcome `GenerationSummary`; this spec is
  outside the permitted Batch 1 file list and was left unchanged.

## Deviations

- The active `OrchestratorGenerationOptions` declaration is presently in
  `services/orchestrator.service.ts`, a Batch 2-owned file excluded from this
  batch. Its new fields are established in `core.types.ts`; Batch 2 must make
  the service consume that canonical declaration and preserve the public root
  export. This avoids editing an explicitly out-of-scope service file.
- No separate `agent-output-{agentId}.md` was written. The requested final
  deliverable is `batch-1.report.md`, while creating the additional file would
  violate the explicit Batch 1 file list; this report is the sole deliverable.
