# Batch 8g-2 implementation report

Implemented M-N1, M-N2, M-N3, M2, M5 and M4 in the assigned Electron files. Verification remains with the team leader; no test pass is claimed.

## Task evidence

- **M-N1 ? retry rejected inspections.** `apps/ptah-electron/src/di/codex-runtime-composition.ts:176` evicts a rejected promise while preserving the shared in-flight promise and successful cache keyed by path, size and mtime. The inspection doc comment now describes retry behavior. `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:509` covers concurrent reuse, successful caching and file changes; `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:532` covers retries after failure, timeout and EBUSY errors.
- **M-N2 ? pin before execution.** `apps/ptah-electron/src/di/codex-runtime-composition.ts:149` requires a reviewed platform pin before inspection. `apps/ptah-electron/src/di/codex-runtime-composition.ts:169` compares the computed hash before calling `readVersion`. Missing pins reject with `codex-pin-unavailable`; mismatches reject with `codex-digest-mismatch`. Cache hits are also compared against the requested platform pin. The later runtime registration validation remains intact. `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:545` asserts no version execution on mismatch and recovery after a rejected inspection; `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:561` asserts no execution without a pin.
- **M-N3 ? inactive metadata independent of scope closure.** `apps/ptah-electron/src/di/codex-session-binding.ts:146` wraps the existing identity store inside Electron. It tracks persisted and in-flight identities, refuses further persistence once shutdown begins, and stages all inactive writes immediately. `apps/ptah-electron/src/di/codex-session-binding.ts:215` runs that step before scheduling scope closes. `apps/ptah-electron/src/di/codex-session-binding.ts:168` reuses the staged write when a runtime finally closes, so it does not enqueue another write after SQLite closure. `apps/ptah-electron/src/di/codex-runtime-composition.ts:316` wires the wrapper to every native scope. `apps/ptah-electron/src/activation/shutdown.ts:294` documents the shutdown ordering. `apps/ptah-electron/src/activation/shutdown.spec.ts:222` exercises the real binding handle and registry with two bound sessions, a scope exceeding the disposal budget, SQLite/final-flush order and no late duplicate write. `apps/ptah-electron/src/activation/shutdown.spec.ts:296` covers persistence already in flight and refusal of new writes. No library or registry change was needed.
- **M2 ? explicit shared contracts without a cycle.** `apps/ptah-electron/src/di/codex-binding.types.ts:35`, `apps/ptah-electron/src/di/codex-binding.types.ts:41`, `apps/ptah-electron/src/di/codex-binding.types.ts:52` and `apps/ptah-electron/src/di/codex-binding.types.ts:62` define the shared shapes. Session binding no longer imports composition. Factory-result aliases in both files were replaced with explicit interfaces, including internal binding context, host dependencies and scope ports. The unnecessary identity-lookup forwarding helper was removed.
- **M5 ? internal scope is clear.** `apps/ptah-electron/src/di/codex-runtime-composition.ts:286` and the composition context factory remain unexported. `apps/ptah-electron/src/di/codex-session-binding.ts:190` is also private. Session-binding helpers exported for composition or regression specs are explicitly marked `@internal`; the moved handle has a real importing caller and spec coverage.
- **M4 ? pin platform note only.** `libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts:3` states that the reviewed data is win32/x64 only and all other platforms have no pin and fail closed. Pin values are unchanged.

## Decisions

1. **Keep shutdown staging in the Electron identity-store wrapper.** Options: change shared runtime/registry contracts, or use the existing binding disposal entry point with an Electron wrapper. Selected the wrapper because the batch owns these files and the existing metadata store serializes writes (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:917`); the existing identity store preserves generation/binding checks (`libs/backend/agent-sdk/src/lib/wiring/codex-thread-identity-store.ts:122`). It queues inactive writes before scope-close latency and suppresses repeated late writes. Reversible without a persisted schema or public library change.
2. **Put shared contracts in one small types file.** Options: place them in the session-binding implementation or in the explicitly allowed adjacent types file. Selected the types file to make dependency direction and interface shapes explicit. Reversible; no runtime behavior or compatibility shim was introduced.
3. **Keep the current inspection call compatible through an optional platform argument.** Production passes the binding platform; callers omitting it use the host process platform. Specs can exercise unsupported platforms deterministically without executing a binary. Only the exported reviewed-pin lookup supplies the production pin. Reversible and additive.

## Validation and limitations

- No verify, test, lint, build, Nx, npm, install or git command was executed. No CLI typecheck command was executed. The new/updated specs are authored but **not run**.
- The role-required `ptah_get_diagnostics` call was scoped to the seven changed TypeScript files. It reported **unavailable**, with all seven files unchecked: its TypeScript compiler check was still running after 45 seconds and was **not cancelled**. No result was retrieved or pass inferred, and the tool was not retried. The team leader should be aware that this tool initiated a background compiler check despite no CLI verification command being run.
- AST/source inspection is not a typecheck. The AST tool recovered a parse error in Jest spec syntax, so it is not evidence of passing syntax validation for the specs.
- Shutdown staging is independent of slow process closure. Existing shutdown behavior still bounds waits and reports persistence failures; this change does not promise persistence if the storage dependency itself fails or hangs.
- All changed source/spec files remain below 700 lines. Final line counts: codex-runtime-composition.ts=646, codex-runtime-composition.spec.ts=637, codex-session-binding.ts=242, codex-binding.types.ts=81, shutdown.ts=602, shutdown.spec.ts=322, codex-executable-pin-data.ts=14.
- No direct settings-core import was added to composition or its spec. No new `any`, `as unknown as`, suppression directive or console call was added. Existing casts/console assertions in shutdown.spec.ts were retained.
- No edits were made under rpc-handlers or agent-sdk, to task state documents, or outside the worktree.

## Files written (absolute paths)

- modified: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.ts`
- modified: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts`
- modified: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-session-binding.ts`
- created: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-binding.types.ts`
- modified: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/activation/shutdown.ts`
- modified: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/activation/shutdown.spec.ts`
- modified: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts`
- created: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-2-report.md`

## Unfinished items

No assigned implementation item is left open. Automated verification is pending with the team leader, as requested; the diagnostics tool supplied no usable result.
