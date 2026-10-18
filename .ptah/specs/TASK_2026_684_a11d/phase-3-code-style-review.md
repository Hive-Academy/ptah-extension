# Phase 3 Code Style Review — TASK_2026_684_a11d

Review family: codex (implementer: Claude)

## Summary

**Score: 6/10 · Verdict: REVISE.** Two MAJOR findings, no BLOCKER, MINOR, or NIT findings. The DI registration, manifest entry, and three host guards follow the established shapes (`libs/backend/lane-routing/src/lib/di/register.ts:101`, `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:136`, `apps/ptah-cli/src/di/container.smoke.spec.ts:480`). The score stays above the needs-another-pass band because those boundaries are coherent; it stays below the sound band because the new public contract has two concrete sources of drift.

## Findings

1. **MAJOR — Duplicate public catalog contract.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.catalog.ts:47` and `:53` redeclare `DecisionModelCatalogSource` and `DecisionModelCatalogFilter`, already defined by the wire contract in `libs/shared/src/lib/types/rpc/rpc-decision-model-catalog.types.ts:18` and `:31`. The handler adds a third manually maintained source list at `libs/backend/rpc-handlers/src/lib/handlers/decision-model-catalog-rpc.handlers.ts:29`. Its `satisfies` clause checks members but does not require every union member, so a future source can be added to the public RPC type while the handler still rejects it. This breaks the repository's single typed RPC contract pattern and makes a public API change require synchronized edits in three places. **Fix:** Import the source and filter types from `@ptah-extension/shared` into the catalog, re-export them from the lane-routing barrel if needed, and give the handler's source tuple an exhaustive type check or derive the schema from a shared runtime constant.

2. **MAJOR — An internal lane-routing error helper became cross-library API while an older copy remains.** `libs/backend/lane-routing/src/index.ts:26` exports `errorName` and `LoggableErrorName` from `decision-model.detail.ts` so `libs/backend/rpc-handlers/src/lib/handlers/decision-model-catalog-rpc.handlers.ts:17` can use it. The barrel describes its surface as host-facing at `libs/backend/lane-routing/src/index.ts:6`; error classification is unrelated to lane routing's host contract. Meanwhile the new writer still has its own `errorTypeOf` at `libs/backend/rpc-handlers/src/lib/handlers/decision-model-writer.ts:78`, used at `:197` and `:218`. The two classifiers already have different return contracts (`libs/backend/lane-routing/src/lib/decision-model/decision-model.detail.ts:64`), so maintaining safe log metadata requires keeping both in step. **Fix:** Put the common classifier in a neutral shared utility with a narrow export, use it from both RPC paths and the catalog, and remove the lane-routing barrel export and writer-local copy. If sharing is intentionally avoided, keep the classifier local to each library and document why its contracts differ.

## Five style questions

1. **What breaks when requirements change in six months?** A new catalog source or filter value can diverge between `rpc-decision-model-catalog.types.ts:18`, `decision-model.catalog.ts:47`, and `decision-model-catalog-rpc.handlers.ts:29`.
2. **What would a new team member misread?** `lane-routing/src/index.ts:26` makes an error logging helper look like part of the lane-routing host API, even though the only new outside consumer is the RPC handler at `decision-model-catalog-rpc.handlers.ts:17`.
3. **What does this cost to maintain?** The duplicated contract and two error classifiers (`decision-model-writer.ts:78`; `decision-model.detail.ts:64`) require coordinated edits and review across libraries.
4. **Where is this inconsistent with sibling code?** The RPC result types already live in the shared domain file (`rpc-decision-model-catalog.types.ts:18-39`), while the new catalog redefines their source and filter unions (`decision-model.catalog.ts:47-60`). The neighboring `agent-outcome-rpc.handlers.ts:23-31` consumes shared wire types directly.
5. **What would I do differently?** Keep the catalog's public type names as re-exports of the shared contract and give error classification one neutral owner. This removes real synchronization points while retaining the current registration and handler structure.

## Scope and verification

Reviewed the Phase 3 commit diffs for Batches 11–16, the new catalog, schema, writer and handler files, the changed barrel/DI/registry/manifest/guard portions, the task plan and batch instructions, root `CLAUDE.md`, and neighboring `agent-outcome-rpc.handlers.ts` and shared contract. AST analysis found no parse errors in the five principal source files. `ptah_get_diagnostics` returned **unavailable** after its TypeScript check exceeded 45 seconds; no Nx, Jest, TSC, build, or lint command was run under the task's restriction. Runtime failure behavior was outside this style review.

## Decisions

- **Treat the shared wire unions as the canonical contract.** Options were shared ownership or separate internal unions. Evidence: `rpc-decision-model-catalog.types.ts:18-39` already defines the public method, and `rpc.types.ts:1408` registers it. Reversible: yes.
- **Keep DI and host guard structure.** Options were current factory/singleton pattern or a new registration layer. Evidence: `libs/backend/lane-routing/src/lib/di/register.ts:101`, `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts:88`, and the CLI smoke assertion at `apps/ptah-cli/src/di/container.smoke.spec.ts:480`. Reversible: yes.
