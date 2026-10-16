# Batch 39d report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\agent-sdk\src\lib\helpers\post-tool-use-hook-handler.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\outcome-seam\skill-telemetry-seam.adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\outcome-seam\skill-telemetry-seam.adapter.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\skill-candidate.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\archaeology\session-verdict.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-39d-report.md`

## S2: PostToolUse run-tag logging

Before: `post-tool-use-hook-handler.ts:141-168` logged a debug line for every non-Agent/Task tool and retained session ids indefinitely at `:68`; unresolved session ids logged repeatedly. `subagent-run-tag.ts:21` confirms non-Agent tools and already-tagged subagents return a null tag without a reason.

After: `post-tool-use-hook-handler.ts:127-128,145-166` logs only null-tag Agent/Task results, uses the exported reason type, emits `no reason` when needed, deduplicates unresolved ids by tool name, and caps warning keys at 256 with oldest-first eviction. Non-Agent/Task tools return before logging. No session-end hook exists in this handler: `createHooks` at `:203-208` exposes only PostToolUse.

Spec cases in `post-tool-use-hook-handler.spec.ts`:

- `100 non-Agent PostToolUse calls produce no run-tag logs` (`:178`)
- `logs an Agent skip without reason once per session` (`:205`)
- `deduplicates unresolved Agent skips by tool name` (`:230`)
- `bounds run-tag miss sessions to 256 entries with oldest-first eviction` (`:249`)

## S5: Skill telemetry ownership and row validation

Before: `skill-telemetry-seam.adapter.ts:51-56,100-104,123-126` queried `skill_invocation_events` and `skill_session_verdicts` directly and cast rows without validation. The candidate store owns invocation event writes (`skill-candidate.store.ts:1167-1221` before), and the verdict store owns session verdict writes (`session-verdict.store.ts:105-143` before).

After: `skill-candidate.store.ts:61-78,1618-1682` owns Zod-parsed subagent and batched skill-scope reads; `session-verdict.store.ts:75-78,208-233` owns Zod-parsed evidence reads and checks evidence classes. Invalid rows warn and are skipped. `skill-telemetry-seam.adapter.ts:26-32,42,82,103` delegates all reads to these stores and preserves its three public methods. `skill-trigger.service.spec.ts:2039-2042` updates its direct constructor call. Existing DI class registrations at `di/register.ts:72-73,111` already cover all three dependencies; no DI registration change was required.

Spec cases in `skill-telemetry-seam.adapter.spec.ts`:

- `keeps two same-slug runs separate and reports ambiguous duplicates` (existing case, updated collaborators and parsed-row assertion, `:13-99`)
- `store readers parse rows and skip malformed telemetry with a warning` (`:102`)

## Decisions

- **Warning history:** use a 256-entry FIFO cap and a tool-name fallback for unresolved sessions. Options were a session-end release or a fixed cap. `post-tool-use-hook-handler.ts:203-208` has only a PostToolUse hook, while the review cited the repository's 256-key notifier precedent. Reversible: yes.
- **Store readers:** add two narrow candidate-store reads (subagent runs and batched skill scopes) plus one verdict-store read. Options were SQL in the adapter or owner methods. Ownership is established by the existing writes cited above, and `di/register.ts:72-73,111` already registers both stores. Reversible: yes.
- **Malformed rows:** warn and skip via Zod `safeParse`, including unknown evidence classes. Options were throwing, casting, or skipping; the requested behavior is skipping with a warning. Reversible: yes.

## Verification and outstanding work

Ran `npx prettier --write` on the seven changed source/spec files. Did not run Nx, Jest, TypeScript, ESLint, diagnostics, build, serve, e2e, or package commands because batch rules 3/4/5 reserve verification for the orchestrator. No app DI guard spec needed changing; a text search found no app reference to the adapter. Runtime tests remain for the orchestrator.
