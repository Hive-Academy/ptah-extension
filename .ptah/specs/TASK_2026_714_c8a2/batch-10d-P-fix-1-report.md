# Batch 10d.P-fix-1 report

## Changes

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-parity.spec.ts:45-70`: replaced the invalid synthetic path map with real temporary home and working directories, exact resolved snapshot keys, realpaths, and cleanup. This addresses the Windows `Unverified or invalid profile path` fixture failure reported for eight cases.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-parity.spec.ts:306-392`: added a same-home two-lane case with distinct MCP suppression, instructions, cwd, and policy through first turn, queued follow-up, and reopen.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-activation.spec.ts:165-267`: added five manager-boundary Jest cases: cumulative stream usage versus last-request rollout on resume; completed, failed, stopped and unknown-owner ledger behavior; attributed report plus missing, empty and valid deliverables in the manager's exit signal. The new file uses fake handles, a fake rollout reader, a fake chat route and in-memory file metadata. It starts no process or model.
- `.ptah/specs/TASK_2026_714_c8a2/p10-lane-parity-proof.md:3-5,21,62-65,93`: updated the case count to 15 and the four former FAIL rows to provisional static, spec-backed PASS with exact spec locations. The signature remains unsigned.

## Decisions

1. Used a separate activation spec because manager, ledger, router and notifier integration needs a different seam from the adapter profile harness. The two options were expanding the adapter harness or adding the one permitted file; the manager's constructor dependencies and the task's allowance support the latter. Reversible by merging fixtures later.
2. Modeled unknown-owner completion as no shared ledger success. `AgentProcessManager.recordLaneLimits` returns without a run owner and does not infer plan allowance from unknown usage. Reversible if the ledger contract changes.
3. Kept PASS explicitly provisional. The task permits static, spec-backed PASS while forbidding test and live execution; coordinator execution can confirm or reverse these rows.

## Not done

- No tests, diagnostics, verify, typecheck, lint, build, Nx, npm, real Codex process, network or paid model call was run, as required. The five new cases and fixture repair are therefore unexecuted; their observed pass/fail count is unknown. The coordinator must run them.
- No production code was edited. No skill-loading tool was exposed in this lane; skill instructions were unavailable.
- Only the four scoped files were written. The edited files remain UTF-8 without BOM and LF line endings.
