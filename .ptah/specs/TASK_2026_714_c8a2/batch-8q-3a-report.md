# Batch 8q-3a report

## Changes

- 8q-3a.1: `codex-execution-profile.ts:167` exports `resolveCodexLevelPolicy` for the existing consumer-aware approval and sandbox mapping. `:202` exports `codexProfileFingerprint` with the existing canonical SHA-256 encoding. The builder calls both at `:291` and `:324`.
- 8q-3a.2: `codex-context.ts:86` stores the current level policy; `:206` exposes `turnPermissionLevel`; `:273` makes the approval bridge read it. `start()` at `:499` sends the current policy and snapshots the running level. `updateNextTurn()` at `:775` validates the patch, persists a new identity and fingerprint before committing the level, policy, settings, or identity. A rejected persist leaves those values unchanged. The open-time thread start/resume policy remains as it was (`:228`). `codex-runtime.types.ts:294` exposes the getter to the adapter through `CodexContext`.

## Specs

- `codex-execution-profile.spec.ts:43` — `resolves %s %s policy and preserves its fingerprint` covers four levels for chat and lane, including fingerprint equality with the builder. Existing profile specs cover gateway and usage mappings. No literal digest was already present in the existing specs, so this uses the task's requested relational fingerprint assertion.
- `codex-runtime.spec.ts:1444` — `stages revisioned model/effort settings and validates permission levels` retains model/effort coverage and checks invalid level rejection.
- `codex-runtime.spec.ts:1469` — `sends the %s policy after changing the next turn level` covers each level, wire policy, identity fingerprint and persist.
- `codex-runtime.spec.ts:1521` — `holds the active turn level for the bridge and restores the original policy on rollback` checks mid-turn approval behavior, plan to ask resending, and original fingerprint restoration.
- `codex-runtime.spec.ts:1575` — `keeps level, fingerprint, model and next frame unchanged when re-persist fails` checks atomic failure.

The mid-turn race is prevented by copying the level when `turn/start` is admitted. The bridge and adapter-facing getter read this snapshot throughout the running turn, while updates change the stored level only after identity persistence succeeds. The snapshot is cleared on terminal notification or rejected start.

## Modified absolute paths

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-execution-profile.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-context.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8q-3a-report.md`

## Deviation and handoff

`codex-runtime.types.ts` was edited because it owns the `CodexContext` interface. `index.ts` needed no new export because `CodexContext` is already exported and the adapter only needs its getter. Required getter typing means existing `jest.Mocked<CodexContext>` fixtures in agent-sdk specs and `gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts` need a `turnPermissionLevel` property in a later authorized lane; those files were outside this batch's edit list.

No verification ran, per the task's hard rule. No git write command ran.
