# Batch 12 report

## Files written

- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/claude-ambient-status.service.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/claude-ambient-status.service.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/codex-readiness.service.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/codex-readiness.service.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/main-connection-target.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/frontend/core/src/lib/services/main-connection-target.spec.ts
- /home/amun/ptah-extension/.claude-worktrees/provider-readiness/.ptah/specs/TASK_2026_864_1376/batch-12-report.md

## Tests per file

- `claude-ambient-status.service.spec.ts`: existing inert, ordering, failure, validation, and disposal cases updated for `transportTimeout`; added trigger forwarding and RPC timeout distinction.
- `codex-readiness.service.spec.ts`: Electron gating, idle state, RPC parameters and 25 s timeout, latest reply, malformed fields, extra-field removal, timeout recovery, rejected promise, and disposal.
- `main-connection-target.spec.ts`: chosen, workspace, source, first offered, unavailable targets, auth scope writability (including a null target), and session copy.
- No Jest, Nx, verify, build, or application command was run, per the executor instruction. Scoped `ptah_get_diagnostics` was called three times for all six changed files; the first two calls timed out after 45 s and the third reported a terminated diagnostics worker. All six files remained unchecked. The orchestrator must run `npm run verify -- -p @ptah-extension/core`.

## Decisions

- Optional `trigger` is omitted from the RPC payload when absent; explicit values are forwarded. Evidence: the shared RPC parameter types mark `trigger` optional, and existing ambient calls contain only provider and refresh. Reversible.
- `transportTimeout` is true only for a failed RPC result whose `error` starts with `RPC timeout:`; host refusal, malformed reply, and rejected promise remain local failures without the timeout flag. Evidence: D-11 and `ClaudeRpcService` timeout error construction. Reversible.
- Codex readiness accepts the literal values in the shared Batch 1 unions, validates each known field, and copies only contract fields. Evidence: `AuthGetCodexReadinessResponse`, `CodexReadinessBinary`, and `CodexReadinessSignIn` in shared RPC types; ambient service boundary pattern. Reversible.
- The target helper takes the existing settings state methods as a typed contract and reproduces the popover's model/effort scope intersection and preference order. Evidence: popover lines 341 and 358-363. Reversible.
- Session copy returns the scope phrase without surrounding sentence text, matching the two phrases in popover line 382. Reversible.

## Risks

- TypeScript diagnostics did not complete, and tests were intentionally not run in this lane. The orchestrator's scoped verify is required to establish compilation and behavior.
- Batch 13 must export new core symbols before consumers import them from the core barrel.

## Fix round 1

- Updated `codex-readiness.service.ts` so `isCodexReadiness` reads fields from `Record<string, unknown>` with bracket access. The existing record, string, and shared-literal checks remain in the same order and accept the same reply shapes.
- No spec change was needed because validation behavior did not change.
- Scoped `ptah_get_diagnostics` was attempted after the edit but timed out after 45 seconds with the TypeScript file unchecked. Per the fix-round instruction, no Nx, npm verify, Jest, tsc, or git command was run; the orchestrator will rerun verification.
