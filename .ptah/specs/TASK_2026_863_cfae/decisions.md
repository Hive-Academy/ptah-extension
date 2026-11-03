# Decisions - TASK_2026_863_cfae

| # | Decision | Evidence | Source | Reversible |
|---|----------|----------|--------|------------|
| 1 | Type BUGFIX, depth Partial; flow research -> implement -> code-logic review | Request says "never fires"; plus one small feature | orchestrator rules (no route_decide listed) | yes |
| 2 | Lanes enabled, approval lane-review | No stored preference; user global CLAUDE.md prefers non-Claude lanes; codex + Glm have room | Gate 0.1 | yes |
| 3 | Keep auto hand-off opt-in; older memory "no automatic handoffs" is superseded | Commit 5e7b108d4 + current user request | evidence | yes |
| 5 | Auto hand-off trigger moves to a root per-session coordinator over ALL mounted tabs (all workspace partitions); sessions with no tab are out of scope | research-report.md Decisions row 1; user cases are open tabs | evidence | yes |
| 6 | Skill-probe RPC failure retries; only a confirmed missing skill marks the session | research-report.md Bug 1 #2 | evidence | yes |
| 7 | `sessionBudget.closeSourceAfterAutoHandoff` default false; close only after adoption, only clean/idle source; history kept on disk | user asked to "allow" closing; closeTab can abort work | evidence | yes |
| 8 | Dev overrides via env vars, honoured only in dev (unpackaged) hosts: PTAH_DEV_IDLE_CACHE_TTL_MS, PTAH_DEV_IDLE_MIN_TOKENS, PTAH_DEV_SESSION_BUDGET_TOKENS | settings floors block live test | evidence | yes |
| 9 | Batch A backend+shared on codex, Batch B frontend on Glm, parallel, file-disjoint; cross-review (Glm reviews A, codex reviews B) | lane rows | orchestrator | yes |
| 4 | Research lane: codex (researcher-expert). Review lane planned on a different family (Glm) | ptah_agent_list rows | Gate 0.1 | yes |
