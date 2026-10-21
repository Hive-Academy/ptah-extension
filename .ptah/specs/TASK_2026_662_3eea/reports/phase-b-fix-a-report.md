# Phase B fix round — Lane A

## Changed files

- Visual Serious 1: `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts:46` explicitly injects the registered `SkillInvocationEventStore` class token.
- M2: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2379` catches a failed per-clone stats lookup, warns with the Error, and returns 0 uses plus a null rate for that clone.
- S1: `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:1096` reads `skills.telemetry.enabled` first, uses the old trigger key only when the new key is absent, and defaults to true.
- S2: `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:198`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:475`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1498`, `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts:571`, and `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:813` carry an optional `origin: 'enhancement'`. A committed enhancement save stamps the registry with a hash of the committed clone and requests repropagation with `userInitiated: true`. Manual saves retain their behavior. The hash helper at `skills-synthesis-rpc.handlers.ts:3247` matches the mirror's file/tree hash format within the assigned file scope.
- S4: `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:63,238`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:496`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1811`, and `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts:596` restore `total` to telemetry invocation count, add `graded`, `passed`, and nullable `successRate`, and accept an optional clone kind defaulting to skill. The Electron e2e helper still reads `total`; no e2e type change was needed.

## Specs added

- `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.spec.ts:44`: resolves the service through tsyringe and exercises its injected event store.
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.spec.ts:1451`: asserts the Library writer key is read first and a new-key false overrides an old-key true. The existing frontend state spec asserts its writer uses `skills.telemetry.enabled`.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:1025,1499,1531,2040`: covers one throwing clone lookup, enhancement and manual save origins, stale enhancement refusal, telemetry total and graded fields, and agent kind.
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.spec.ts:579` and `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.spec.ts:599`: cover the origin sent by explicit draft Save.

No Nx, Jest, lint, typecheck, build, or e2e command was run, per the lane instructions. Tree-sitter parsing reported no syntax errors in the changed handler and its spec. `ptah_get_diagnostics` was attempted after edits, but the TypeScript compiler service stayed unavailable after its 45-second timeout, so type results are unverified.

## Projects touched

- `@ptah-extension/skill-synthesis`
- `@ptah-extension/rpc-handlers`
- `@ptah-extension/shared`
- `@ptah-extension/skill-synthesis-ui`

## Decisions

- Used the registered `SkillInvocationEventStore` class as the injection token. A new symbol would add a second registration without benefit; reversible.
- Enhancement origin is explicit at the RPC boundary. Manual edits do not stamp enhancement metadata or trigger repropagation; follows O14 and the Phase B review; reversible.
- Reused the mirror's hash format in the assigned handler file because its hash function is not exported by the agent-generation package and the lane may not edit that package. This avoids a cross-project relative import prohibited by Nx module boundaries; reversible by a later package export.
- Post-commit registry or repropagation failures warn and return `metadataIncomplete: true` while preserving the successful body write. This follows the existing committed-write response contract; reversible.
- Kept `succeeded` and `failed` for compatibility while adding explicitly named graded fields. `total` again means telemetry uses; follows O18; reversible.

## Proposed Removals

- Remove the old telemetry key fallback in Phase C batch 44 after settings migration is complete.
- When agent-generation exposes the mirror's source-hash function through its public package entry point, replace the local handler hash helper with that export.
- Remove `applyProposal` from the frontend RPC facade in batch 58, as already planned.

## Clarifications Needed

None.