# Batch 1 report

## Task 1.1

Completed the additive shared contracts. `rpc-auth.types.ts` now exports Codex sign-in mode, status, error, state, cancel, readiness, and trigger types. The existing `auth:codexLogin` params accept `{}` plus optional `mode` and `restart`; its result retains `success` and optional `error` and adds optional `state`. The state documents that cancelled attempts have `success: false` without `error`, while `state` is authoritative. The status push and its payload are registered, and the ambient Claude status request accepts the trigger union. No runtime implementation or tests were added in this types-only batch.

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/shared/src/lib/types/rpc/rpc-auth.types.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/shared/src/lib/types/rpc.types.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/shared/src/lib/types/messages/message-constants.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/shared/src/lib/types/messages/payload-map.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`
- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-1-report.md`

## Risks and validation

- Existing CLI callers: the Codex request remains valid as `{}` and `state` is optional in the response. Dependent-host typechecks belong to later batches; they were not run here.
- Frozen host source registry: left unchanged; its test could not complete because the scoped verify command was blocked by Nx socket permissions.
- Cancel race: the contract defines a cancelled state as `success: false` with no error. Lifecycle and race tests belong to Batches 5, 7 and 13.
- Browser-open state: `browserOpened` is optional and documents that it is set only after the host open attempt returns or throws. URL parsing and validation belong to Batch 5.
- Credential and output exposure: the state carries a validated HTTPS URL and fixed display-safe error copy; it has no CLI-output or token field. Runtime filtering belongs to later batches.
- Kimi behaviour: no Kimi contract or implementation was changed.
- No changes outside the five listed source files and this required deliverable were made.

## Verification

Ran the one required foreground command from the worktree root: `npm run verify -- -p @ptah-extension/shared 2>&1 | tail -40` with `pipefail`.

Header: `verify lint,test,typecheck (@ptah-extension/shared)` — 1 project. Summary: lock slot 1 acquired; Nx daemon socket connection failed with `EPERM` under `/tmp/.nx/1000/sockets/.../d.sock`; plugin worker socket was also denied; lock released after 9.1s, exit code 1. No lint, test, or typecheck result was produced. Scoped `ptah_get_diagnostics` also returned unavailable after its 45-second timeout, with all five files unchecked.

## Decisions

- Kept `state` optional on `AuthCodexLoginResponse` and the new request fields optional. Evidence: the implementation plan explicitly requires existing CLI callers to keep compiling. Reversible: yes.
- Used the existing Kimi RPC and push placement for Codex entries. Evidence: adjacent registry, method-map, constant, and payload-map patterns. Reversible: yes.
