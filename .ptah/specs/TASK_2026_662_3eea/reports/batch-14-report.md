# Batch 14 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.types.ts:63-82`: added a positive evidence predicate and exact attribution keys.
- `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.types.spec.ts:22-42`: checks that `unverified`, `no-correction`, and null are not positive.
- `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.store.ts:50-58,239-266`: added a parameterized read lookup through `lane_outcome_records`, with null for unverified, degraded, malformed, or unmatched evidence. The store imports no archaeology writer module.
- `libs/backend/skill-synthesis/src/lib/archaeology/session-verdict.store.spec.ts:45,90-92,171-205`: covers the exact match, each mismatched key, empty workspace, and unverified evidence.
- `libs/backend/skill-synthesis/src/lib/outcome-seam/skill-telemetry-seam.adapter.ts:26-34`: narrows the adapter's verdict dependency to its existing read method.
- `libs/backend/skill-synthesis/src/lib/di/register.ts:112-113,229-231`: registers the store separately from the archaeologist; its constructor needs only Logger and SQLite.

## Join keys and behavior

`positiveEvidenceForRun` requires nonempty `runId`, `sessionId`, `taskId`, and `workspaceRoot`. It matches `lane_outcome_records.run_id`, `subagent_session_id`, `task_id`, and `workspace_root` exactly, then joins `skill_session_verdicts.session_id` and `workspace_root`. It rejects degraded rows and returns only `tests-green`, `user-accepted`, or `explicit-confirmation`. Historical evidence remains context; this lookup does not write a task grade. The existing `sessionEvidence(sessionIds)` port cannot carry the four join keys, so its published contract remains unchanged for the later consumer cut.

## Remaining imports and consumers

The requested `rg -n "SessionVerdictStore|SESSION_VERDICT" libs apps` inventory still includes the retained writer and its callers. Direct store imports: `skill-synthesis/src/lib/archaeology/session-archaeologist.service.ts:113`, `archaeology/session-archaeologist.service.spec.ts:57`, `archaeology/session-archaeologist.degraded.spec.ts:64`, `archaeology/regex-demotion.spec.ts:62`, `archaeology/session-verdict.store.spec.ts:36`, `cleanup/skill-backlog-cleanup.service.ts:8` and its specs, `skill-synthesis.service.ts:81`, `outcome-seam/skill-telemetry-seam.adapter.ts:11` and its spec, `gates/replay-validator.service.ts:86` and its specs, `gates/verdict-fallback.spec.ts:50`, `digest/skill-gap-curator.service.ts:105` and its spec, `triggers/skill-trigger.service.spec.ts:39`, and `di/register.ts:60`. `skill-synthesis/src/index.ts:303` exports the store. The DI token is in `di/tokens.ts:142-143` and registered at `di/register.ts:229-231`. `rpc-handlers/src/lib/handlers/skills-synthesis-rpc.digest.spec.ts` consumes the package export. Other `SESSION_VERDICT` hits are the retained types/schema, migration references, and comments in the same projects; no app source imports the store directly.

## Decisions

- **Add an exact read method to the store.** Options were changing the lane outcome port or adding a store lookup. The published port accepts session IDs only, while plan row 14 requires an additive retained read store and leaves consumers until phase C. Adding the lookup preserves that contract and is reversible.
- **Require a known workspace.** Options were treating the empty workspace sentinel as a match or returning null. Existing schema comments describe `''` as unresolved/cross-project; returning null avoids attributing evidence across workspaces. Reversible.
- **Keep the archaeology writer registered.** Batch 14 explicitly retains it until batch 61. The store registration itself has no dependency on writer registration. Reversible when the later batch removes the writer.

## Verification

Tests, Nx, build, lint, and standalone typecheck were not run as instructed. Scoped `ptah_get_diagnostics` was attempted after edits and reported TypeScript compiler unavailable after 45 seconds; all six changed files were unchecked. The orchestrator owns the scheduled test and typecheck gate.
