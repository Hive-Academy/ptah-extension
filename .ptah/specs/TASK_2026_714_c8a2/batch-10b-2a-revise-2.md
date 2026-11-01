# Batch 10b-2a revise 2

## Branch

Branch 1. `codexProfileFingerprint` hashes only `permissionLevel`, `sandboxPolicy`, and `approvalPolicy` (`libs/backend/codex-runtime/src/lib/codex-execution-profile.ts:220-228,328-344`). The essential retry rebuilds the profile from the same permission level and paths, changing only optional lane settings (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts:253-270`). The fingerprint and resume identity therefore stay compatible. No adapter or runtime change was needed.

## Files changed

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts`
- This report.

## Spec cases

- `keeps the execution fingerprint when building an essential lane profile` (`codex-app-server-lane.adapter.spec.ts:397`): calls `buildCodexExecutionProfile` with the full and essential sessions and compares their fingerprints.
- `retries a resumed pre-turn config rejection with the same identity and fingerprint` (`codex-app-server-lane.adapter.spec.ts:415`): persists a full matching identity, rejects the first resumed `runtime.open` with `CodexPreTurnConfigRejectedError('thread/resume')`, verifies both opens receive that identity and have matching fingerprints, checks one notice, and completes the turn. It awaits both context closes.

## Evidence

Source inspection confirms the retry passes `previous?.identity ?? resume` to the second open (`codex-app-server-lane.adapter.ts:270`); an open-level rejection leaves `context` unset, so it passes the stored `resume`. The fingerprint test pins the policy-only rule independently of the adapter mock. Per lane rules, no tests, typecheck, lint, build, Nx, npm, diagnostics, or verification command was run. The CLI exposed no native skill loader; I read the local `.claude/skills/agent-lanes/SKILL.md` as the fallback.

## Clarifications Needed

None.
