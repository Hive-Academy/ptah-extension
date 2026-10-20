# Phase A fix C report

| Defect | Status | File:line evidence |
| --- | --- | --- |
| 1. `formatSourceHash` loads agent-generation at Jest runtime | Fixed | `libs/backend/platform-core/src/utils/source-hash.ts:4` hashes the exact UTF-8 body; `libs/backend/platform-core/src/index.ts:304` exports it; `libs/backend/platform-core/src/utils/source-hash.spec.ts:5-9` retains the original assertion. `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:6` and `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:11` import it from platform-core. `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:485` names the new owner. The agent-generation export, function, and old spec were removed. |
| 2. Concurrent attribution expects grade-derived `is_error` | Fixed | `libs/backend/skill-synthesis/src/lib/spec-harvester.concurrent-attribution.spec.ts:144` seeds `isError: false`; lines 267-268 explain preservation and expect `0`. |

## Decisions

- Kept `sha256Hex` private in agent-generation because its file and manifest hashing still use it.
- Found no `formatSourceHash` Jest mock in the four scoped libraries.
- Did not run tests, typecheck, lint, build, or Nx/Jest commands, as instructed.
