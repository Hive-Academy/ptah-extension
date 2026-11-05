# Context — TASK_2026_858_f7b9

## User request (2026-11-01)
Continue the Ptah remote-workers / mobile-first PWA effort. One interface controls Ptah on several
LAN machines (Horus, Anubis, Chappie) and, as a product feature, an installable mobile-first PWA
beside Ptah that users reach from anywhere. Gatsby serves only the `d3:4b` decision model through an
SSH tunnel. Full workflow: project-manager, then software-architect. Present the plan for user
approval before any code changes.

## Inputs
- `../council-remote-machines/HANDOFF.md` — goal, user decisions, fleet state, code gaps, reuse.
- `../council-remote-machines/P1-answer.md`, `P2-answer.md`, `P1-critique.md`, `P2-critique.md`.
- Reference product: https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md

## Worktree
`/home/amun/ptah-extension/.claude-worktrees/remote-workers`, branch `chore/remote-workers`,
rebased on `origin/main` `12a482782` on 2026-11-01. `node_modules` is a symlink to the main checkout.

## Strategy
- Type FEATURE, depth Full (pre-flight `ptah_route_decide` returned null values,
  fallbackCause `provider-error`; skill table used). User also asked for Full.
- Sequence: project-manager (subagent) → cross-side document review (CLI lane) → Gate 1 →
  [ui-ux-designer for the first UI surfaces → Gate 1.7] → software-architect (subagent) →
  cross-side review (CLI lane) → Gate 2 (user) → team-leader → implementation.

## Gate 0.1 — CLI lanes
- Preference source: current user instruction ("start the agent-lane orchestration"). Memory
  search timed out (preference unknown from memory).
- Mode: `enabled`.
- Approval mode: `lane-review` for Gates 1 and 1.7. Gate 2 goes to the user, because the user asked
  to approve the plan before code changes.
- `ptah_agent_list` (2026-11-01 ~01:32 UTC):
  - codex — cli, installed, confirmed room (weekly 79%, resets 2026-11-04 07:03 UTC).
  - kimi code — ptah-cli `pc-7594dcab-a859-41a0-8e8b-e8df5dba7d25`, available, limits not tracked.
  - grok — cli, installed, limits unknown (API key).
  - antigravity — cli, installed, no windows reported.
  - Ollama Code — ptah-cli, AT LIMIT (weekly 100%, resets 2026-11-02 00:00 UTC). Skip.
  - copilot, claude — disabled. cursor, opencode, pi — not installed.

## Fleet benchmark (2026-11-01)
`d3:4b`, `POST /v1/systemone`, `/tmp/s1.json` (280 input tokens), CPU only, 7.1 GB RAM.
- Gatsby (4c): cold 22–28 s, warm ~11.2 s.
- Chappie (i5-9500, 6c): cold 11.8 s, warm 5.5 s and 5.9 s. Same answer (o1, p=0.9994).

## Gate 2 user answers (2026-11-01)
- Final codex re-review of round 2: REVISE (0 Blocking, 3 Serious, 1 Minor), past the cap → user.
- User: architect fixes the 3 Serious + numbering; orchestrator verifies; no new lane round.
- U1 1, U2 1, U3 1, U4 1, U5 1 (decide before Phase 3; build ungated). Q5 not applicable.
- Q1 (a) watch-only in Phase 1; designer revises design 4.9 + screen 9, reviewed before C10.
- Q2 show remaining attempts over SSH only. Q3 lock enforced on every host. Q4 Node 22 + CLI on Horus.
- Q6 raise `apps/ptah-cli/package.json` `engines.node` to `>=22`. B1-B5 approved as written.
- Gate 2 passes only on the user's `APPROVED` after the fixes are verified.
- O1-O6 fleet operations: still unanswered.
