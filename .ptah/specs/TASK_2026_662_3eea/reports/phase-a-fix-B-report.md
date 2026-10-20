# Phase A fix round — Lane B

| Item | Status | Implementation | Spec |
| --- | --- | --- | --- |
| 9 | Fixed | `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:639,663`: settings RPC also writes the corresponding `skills.enhancement.*` key for `judgeProvider`, `judgeModel`, and `enhanceTimeoutMs`, preserving each parsed value. Other settings retain a single write. | Added three mapping cases and an unrelated-key case in `skills-synthesis-rpc.handlers.spec.ts:5069-5104`. |
| 10 | Fixed | `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:2314`: rate is null if any event remains ungraded. | Added ungraded case in `skills-synthesis-rpc.handlers.spec.ts:1004`. |
| 11 | Fixed | `libs/backend/agent-generation/src/lib/services/user-layer/source-hash.ts:33` defines `formatSourceHash`; `src/index.ts:106` exports it; `user-layer-mirror.service.ts:709,801` and `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:483` use it; `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:485` documents the contract. | Added `source-hash.spec.ts:4`. |
| 12 | Fixed | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:830` centralizes the stale-source check. Both save branches retain their previous result and write order. | Existing stale-source cases in `user-layer-mirror.service.spec.ts:830,873`; no new spec. |
| 13 | Fixed | `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:219,585,1006` logs the error name and sanitized message at the proposal and candidate warning sites. Auth resolution warning remains unchanged. | Added proposal diagnostic case in `skill-enhancer.service.spec.ts:1437`. |
| 14 | Fixed | `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:7-8` exports version and prefix constants; `migration-runner.ts:117,340,360` uses a private archive method and options object for vec catch-up. The one-time archive guard and preflight order remain unchanged. | Extended `skill-pipeline-archive.spec.ts:52`. Existing migration runner specs cover archive failure. |
| 15 | Fixed | `libs/backend/platform-core/src/file-settings-manager.ts:542` queues the one-time migration through the existing `persist()` path, including its unique temp file and rename retry. | Updated migration cases in `file-settings-manager.spec.ts:377,413` to wait for serialized persistence. |

Changed projects: `@ptah-extension/rpc-handlers`, `@ptah-extension/agent-generation`, `@ptah-extension/skill-synthesis`, `@ptah-extension/persistence-sqlite`, `@ptah-extension/platform-core`.

Verification: AST parse returned no syntax errors for the edited enhancer, migration runner, settings manager, and mirror service. No tests, typecheck, lint, Nx, build, or e2e were run, as instructed. `ptah_get_diagnostics` was not called because it invokes TypeScript checking, which this lane was expressly told not to run.

Additional item 9 verification: AST parse returned no syntax errors for the edited RPC handler and its spec. Checks remain delegated to the orchestrator.

## Decisions

- Kept the hash helper in agent-generation. Skill-synthesis already imports `@ptah-extension/agent-generation` in its enhancer and registry catalog, and both projects carry compatible extension scope tags. Reversible by moving the helper to shared if module boundaries change.
- Kept the legacy setting write first and added the matching enhancement write immediately after it. This preserves the existing RPC path while batch 17 still reads the old keys. Reversible when the legacy reader is retired.
- Queued the settings migration write through `writePromise` and `persist()`. The prior constructor rewrite ran synchronously but bypassed the serialized atomic path; the new write completes asynchronously and subsequent `set()` calls wait behind it. Reversible by introducing a synchronous locked persist path if synchronous completion becomes a contract.
