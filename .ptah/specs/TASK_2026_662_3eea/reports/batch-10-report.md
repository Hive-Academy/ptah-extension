# Batch 10 report

Implemented Phase A manual draft preview and explicit save. Preview returns the original body, proposed body, bounded evidence, diff, model and body hash in memory. It calls neither `enhanceNow` nor `applyProposal` and writes no file. Provider failure returns a skip with no draft or write. The batch 9 pause check remains: a paused enhancer returns `skipReason: 'paused'`.

## Files changed

- `libs/backend/skill-synthesis/src/lib/types.ts:437-449`: draft shape.
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:192-205,385-565,811-876,1236-1256`: capture draft, bound evidence and diff, hash the exact clone body, and suppress raw provider errors in generation logs.
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.spec.ts:1397-1464`: draft contents, no-write preview, and provider-failure regression.
- `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:116-135,195-202`: additive optional draft result and optional `expectedSourceHash` save param.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:475-487`: validate the optional SHA-256 hash at the RPC boundary.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1143-1190,1437-1485`: return the draft, pass the optional hash through, and turn a mirror stale result into a clear RPC error.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:1366-1437,3537-3630`: absent hash preserves the old call, supplied hash reaches the mirror, stale result is refused, preview writes nothing, and provider failure remains unsaved.
- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:186-202,664-727,781-823`: optional hash check inside the existing slug lock, before either history snapshot or body write.
- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.spec.ts:708-882`: absent hash keeps the prior save behavior; stale skill and flat-file saves write nothing; matching skill hash saves and snapshots the prior body.

## Save write path and reader

1. Preview reads the current user-layer body through `SkillEnhancerService.readBody` (`skill-enhancer.service.ts:400-404,1223-1227`) and hashes the exact string in its draft (`:459-470`). The RPC handler returns that draft (`skills-synthesis-rpc.handlers.ts:1146-1190`).
2. `saveCloneBody` validates an optional `expectedSourceHash` against `sha256:<64 lowercase hex>` (`skills-synthesis-rpc.schema.ts:475-487`). The handler forwards it to the mirror (`skills-synthesis-rpc.handlers.ts:1437-1473`). An omitted hash retains the old save behavior.
3. `UserLayerMirrorService.saveCloneBody` acquires its existing kind/slug lock (`user-layer-mirror.service.ts:664-683`). Inside that lock, skill saves read `SKILL.md` and compare its hash at `:705-723`; agent and command saves read `<slug>.md` and compare at `:800-818`. A mismatch returns `stale-source` before snapshot or write. The handler maps it to an `INVALID_PARAMS` error asking for a new preview.
4. On a match or omitted hash, the mirror snapshots the prior body and then writes the clone (`user-layer-mirror.service.ts:725-727,820-823`). Skill snapshots live at `<skills>/<slug>/.history/<ts>/`; flat-file snapshots live at `<root>/.history/<slug>/<ts>/`. `listHistory` reads those snapshots; the saved body is subsequently rehashed for sidecar reconciliation. The existing `getClone` RPC uses `readCloneBody` (`skills-synthesis-rpc.handlers.ts:1072,2529-2550`) to read the current clone.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Apply O5 additively to the shared RPC contract. | Replace old fields; add optional draft/hash fields. | `.ptah/specs/TASK_2026_662_3eea/decisions.md` O5 requires Phase A compatibility and owns the shared type file. | Yes |
| Apply O6 by validating in the owned schema and comparing inside the mirror's slug lock. | Handler-only comparison; mirror comparison under lock. | O6 expands ownership to the schema and mirror save API; the existing mirror lock encloses snapshots and writes. | Yes |
| Hash the exact current user-layer body. | Compare registry origin hash; compare clone body hash. | Preview reads the clone body; save overwrites that same clone body. | Yes |
| Keep provider failures as skips without a draft or write. | Throw an RPC exception; return a skip. | Existing enhancer and RPC flow carries `skipReason`; the provider-unreachable path produces no candidate. | Yes |

## Verification

No tests, typecheck, lint, Nx, build, or e2e were run, as instructed. Tree-sitter parsed the edited mirror service, mirror spec and handler spec with zero syntax errors. The orchestrator owns `npx nx run-many -t test typecheck -p @ptah-extension/rpc-handlers @ptah-extension/skill-synthesis @ptah-extension/shared @ptah-extension/agent-generation --parallel=1`.
