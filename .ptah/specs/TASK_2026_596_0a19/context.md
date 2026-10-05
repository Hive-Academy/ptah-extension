# Task Context - TASK_2026_596_0a19

## User Request

> we utilize claude , codex , agy , opencode and ollama cloud each one of those has a weekly and daily
> reset limit mostly ( weekly after 6 days and daily reset each 5 hours ) is there away for us to
> display that and integrate into our agent spawn workflows and ui

> i would like to show it in the stats grid for each session as well
> also remove the work `main` from `main context`
> i would like as well to check cli tools stats and check how can we show stats for them as well
> ( I recall we had already filed a task for that , check please )
> the overall experience i want is making sure that our application can have a predictable way to
> detect resets for main agent and cli tools , and have a clear way for showing that ( also we are
> working on huge refactor for the settings page and we have a smi-finished PR for it and live
> session already named `ptah-ptah-extension-settings-last-round-pr-review` or something if you
> needed to know about that. i would like you to work on a separate worktree for this task

## Task Type

FEATURE

## Complexity

Complex

## Strategy

FEATURE, Full: project-manager → researcher-expert (provider quota endpoints) → ui-ux-designer →
prototype → Gate 1.7 → software-architect → team-leader → developers → QA.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`, branch
`feat/task-596-quota-resets`, based on `origin/main` at 4ad10d856. `node_modules` is a junction to
the main checkout.

## Existing foundation (orchestrator findings)

- `provider:getAccountUsage` RPC with `quota.primary` / `quota.secondary`
  (`libs/shared/src/lib/types/rpc/rpc-providers.types.ts:154`). Only Codex is implemented
  (`provider-rpc.handlers.ts:160`, `codex-account-usage.service.ts:158`, `account/rateLimits/read`).
- Dashboard `provider-account-card.component.ts` shows primary/secondary percentages.
- Claude Agent SDK emits `rate_limit_event` (`resetsAt`, `rateLimitType`: `five_hour`, `seven_day`,
  `seven_day_opus`, `seven_day_sonnet`, …). `isRateLimitEvent` exists in
  `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:400` but nothing consumes it.
  The SDK also exposes an EXPERIMENTAL `/usage` query with 5h and 7d windows.
- Antigravity: undocumented local language server `GetUserStatus` (port + CSRF token from process args).
- Ollama Cloud: 5h session + weekly limits; official API unconfirmed (third parties cite
  `ollama.com/api/usage` with an API key).
- OpenCode Go: 5h / weekly / monthly dollar limits; web console only.
- Memory rule: usage telemetry is not quota. Never present it as authoritative availability.

## Related tasks

- TASK_2026_535 (backlog): lane model discovery + `lane_runs` ledger with `failure_kind: quota`.
- TASK_2026_441_7825 (backlog): lanes first, quota/limit detection with ordered fallback.
- TASK_2026_575_74a4 (done): CLI lane cost explicitly out of scope ("no usage/model data recorded").
- TASK_2026_513_a7c2: spawned CLI agent usage leaked into the session header.

## Coordination

The settings page refactor is in a separate PR and live session
`ptah-ptah-extension-settings-last-round-df90180000eo82pxnz8p901`. Do not edit settings page files
in this task without first checking that PR.

## CLI Lanes

Gate 0.1 (2026-10-03): subagents write spec, plan and code. CLI lanes do cross-side reviews:
codex preferred, then Glm (ptah-cli pc-355b645d-35af-4974-84cf-9cf961ea0164) or antigravity.
Available: codex, antigravity, opencode, Glm (Ollama Cloud).
UPDATE (2026-10-03, user): use ONLY codex and Claude subagents. Antigravity, opencode and Glm are
at their quota limits — do not spawn them. If codex is unavailable, the cross-side review falls
back to a same-side subagent review with this recorded reason.

UPDATE (2026-10-04, user): "continue on a worktree of latest main branch and utilize your subagent
along with codex and opencode". Allowed lanes: codex and opencode (opencode has no messaging, so read
its output with ptah_agent_read). Antigravity and Glm stay excluded.

UPDATE (2026-10-04, user, during Phase 2): "u can utilize codex and opencode as well in this session".
Orchestrator use: codex and opencode may also execute batches, mainly the file-disjoint concurrent
pairs (10 with 11, 14 with 15). A lane-authored batch gets a Claude subagent reviewer (cross-side).
Claude subagent batches keep a codex or opencode phase review. Codex: never pass `model`.

Rebase (2026-10-04): branch `feat/task-596-quota-resets` moved to origin/main 5bb19f9fb (uncommitted
work carried over, upstream unset). TASK_2026_597 PR 1 (#634) is merged, but only its savings subset.
Still DEFERRED to 597 follow-ups (worktree `task-597-followups`): Batch 11 lane capture entries,
Batch 13 OpenCode config + Codex/OpenCode usage split, Batch 12 Responses translator, Batches 26-27
A8 compaction coordinator, Batch 22 usage displays. Architect rule: 596 must not re-implement these.
596 reads the 597 usage split fields when they exist and shows "not reported" otherwise, and the
rollout reader is one shared module (whichever task lands first owns it, the other extends it).

Codex review lane for task-description.md: CLI Session ID 01a1014e-2c8e-7ab2-9040-e061e0303712
(revision 1 REVISE, revision 2 REVISE, revision 3 APPROVED — rounds 2 of 2).

Codex review lane for design-spec.md: CLI Session ID 01a10168-38dd-7810-b50e-a56ba6ef881c
(revision 1 REVISE, 9 findings, 5 blocking). Resume this session for the design re-review.

## User Decisions

- Lane stats scope: quota windows for each lane AND per-lane tokens/cost/model in the stats grid.
  TASK_2026_535 keeps the full `lane_runs` ledger and model discovery.
- Spawn rule: warn and list alternatives. The spawn still runs. `ptah_agent_list` and the spawn
  result show the window, the reset time and the lanes with room. Estimated data never blocks.

- Gate 1 (2026-10-03): user replied "approved" to task-description.md Revision 3 (Codex review
  APPROVED, rounds 2 of 2). No answers given on P1-P9, the agent picker or live checks, so:
  P1-P9 defaults carry to Gate 1.7 for confirmation; agent picker stays OUT of scope (default);
  read-only live checks of Ollama / Antigravity / Codex rollout are NOT authorized — do not run them.

- Gate 1.7 (2026-10-03): user replied "approved with one small caveat" to design-spec.md
  Revision 3 (Codex APPROVED, rounds 2 of 2). P1-P9, T1 (local zone + abbreviation) and
  T2 (short source labels) accepted at their defaults. CAVEAT (user-requested design change):
  > why don't we include the reset in the stats as tiles and allow for their own expansion ? same
  > for cli tools rather repeating the titles like so we can convert the second title with stats
  > cards and show the cli as a tile inside as well
  Interpretation: in the expanded stats grid, plan-limit windows become stat tiles in the same
  card grid as Model/Context/Tokens/Cost/Duration/Agents, each tile expandable for its detail;
  CLI lane runs also become tiles (one per lane) instead of a separate "Lane runs" section with
  repeated row titles. Requirement 8 still binds: lane usage stays visibly outside the session
  totals. Design Revision 4 covers only this change; the user sees the result before architecture.

- Gate 1.7 FINAL (2026-10-04): user replied "approved" to design-spec.md Revision 5 + binding
  amendments A1 (owner identity), A2 (no hidden windows), A3 (expansion retention) in §3.3.
  Codex N1/N2 are closed by A1/A2; prototype not regenerated (amendments override it).

Codex review lane for implementation-plan.md: CLI Session ID 01a106cd-ea14-79b2-a97c-c73348e1cc53
(revision 1 REVISE: 6 blocking, 3 non-blocking). Resume this session for the re-review.
Orchestrator decisions for plan revision 2: defer Claude `utilization` (Req 2.1 amendment PENDING
USER APPROVAL at Gate 2); Component 8 (Antigravity/Ollama readers) mandatory; minimal edit of
translation-proxy-base.ts allowed to carry an owner key on 429s.

Plan review: revision 2 REVISE (5 new blocking), revision 3 REVISE (rounds 2 of 2, cap reached).
Open at Gate 2: (a) Req 2.1 amendment (defer Claude `utilization`); (b) native-Claude account-change
invalidation has no production signal; (c) restored run owner key cannot be rehydrated without
ledger evidence. Orchestrator-proposed fixes for (b)/(c) are presented to the user at Gate 2.

- Gate 2 (2026-10-04): user replied "approved" to implementation-plan.md Revision 3 with the
  recommended Req 2.1 amendment (defer `utilization`) and orchestrator fixes G2 (per-query Claude
  account re-read) and G3 (persist full non-secret owner ref per run). Recorded as "Gate 2 amendments"
  at the top of implementation-plan.md.

- Commits (2026-10-04, user): "commit per batch". The team-leader commits each batch on
  `feat/task-596-quota-resets` after its scoped checks pass. Local only; never push without the user.
- Codex lane model (2026-10-04): resolved from `~/.ptah/settings.json` `agentOrchestration.codexModel`
  (now `gpt-5.6-terra`, effort `medium`). Do not pass `model` on Codex spawns.
- Session handoff (2026-10-04): continue from `handoff.md` in this folder.

- Completion (2026-10-05, user): push the branch and open a DRAFT PR against main; no extra QA;
  owner label: add a short non-secret suffix from the hashed owner key (e.g. "Claude account · a1b2")
  as a follow-up task (FU-PHASE6), not in this PR.

## Conversation Summary

- DONE: stats label "Main context" renamed to "Context" (labels + tooltip,
  `session-stats-summary.component.ts`; spec updated, 11/11 pass).
- Show quota windows in the per-session stats grid.
- CLI lane stats: decide scope against TASK_2026_535 / TASK_2026_441.
