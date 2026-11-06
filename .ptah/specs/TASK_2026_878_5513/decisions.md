# Decisions - TASK_2026_878_5513

| # | Decision | Evidence | Source |
|---|----------|----------|--------|
| 1 | Task type BUGFIX | ptah_route_decide pre-flight: source model, confidence 0.885, fallbackCause none, modelProposal null; overallConfidence 0.885 | router |
| 2 | Depth Full | Router depth null (fallbackCause low-confidence, modelProposal o1 @0.136); scope unclear across 3 flows -> skill table | skill table |
| 3 | Research first, 3 parallel researcher-expert subagents (one per button) | Three independent flows (skills harvest, code re-index, memory curator run-now) | orchestrator |
| 4 | CLI lanes enabled, approval mode lane-review | No stored preference; codex and grok have confirmed room | Gate 0.1 |
| 6 | Follow-up researcher for curator Codex root cause + skill reconcile gap before planning | Both gaps block "learning works"; root cause unverified in reports | orchestrator |
| 7 | Scope split with decision-model session: it owns lane-routing + lane-outcomes; this task owns memory-curator(-ui), skill-synthesis(-ui), workspace-indexing, related rpc handlers/types, agent-sdk curator LLM path | Peer coordination message; disjoint file sets | peer agreement |
| 8 | Out of scope: 2.4 h census performance, 133 carrier-less spec folders | Separate concerns (perf, data migration); record as follow-ups | orchestrator |
| 9 | Curator on unsupported provider (openai-codex): explicit actionable error, no silent fallback; stop offering openai-codex in curator provider picker | research-root-causes.md A5; user chose "separate task" for Codex support | user |
| 10 | Native Codex one-shot path split to TASK_2026_880_76af | User answer | user |
| 11 | Skill reconciliation fix included: reconcile by task id; success = task done + approving review; failure = cancelled or rejected review; bump MARKER_VERSION | User chose "Include now" | user |
| 12 | Add software-architect phase to BUGFIX flow (plan + Gate 2) | Fix spans 3 frontend libs, 4 backend libs and shared RPC types; plan-free BUGFIX too risky | orchestrator (broader flow) |
| 13 | Gate 2 round 1: codex lane REVISE (3 Serious); architect revises (round 1 of 2) | implementation-plan-review.md | cross-side review |
| 14 | Boot/watcher censuses must show in running state (reject lane-proposed exclusion) | A click joins an active census (research-code-index.md §2.6); excluding it recreates the "nothing happens" symptom | orchestrator |
| 15 | Accept P3 (latest work review by mtime, document reviews excluded) and P4 (same workspace root, no null-task time-window fallback) | Conservative attribution; avoids cross-workspace false matches | orchestrator |
| 16 | Gate 2 round 2: codex REVISE, 1 new Serious (asymmetric census join -> duplicate lastRun/push); findings 1-4 resolved. Final revise round 2 of 2 started | implementation-plan-review.md finding 5 | cross-side review |
| 17 | Migration 0066 confirmed free (peer adds no migration) | Peer message 2026-11-04 | peer |
| 18 | Gate 2 round 3 (final): codex REVISE — F5 resolved; new F6 Serious (registry removal on all-abort), F7 Moderate (missing failure-order test). Revise cap reached -> user | implementation-plan-review.md | cross-side review |
| 19 | User chose 'Amend and proceed': F6/F7 added as binding orchestrator amendments in implementation-plan.md; code-logic review must verify them | AskUserQuestion answer | user |
| 20 | Parallel backend execution in one worktree: codex lane B9-12 (effort high), grok lane B1-5, backend-developer subagent B15-16; tracks verified file-disjoint by script over batches.md; per-batch reports, team-leader Mode 2 commits per batch | batches.md dependency graph; overlap check returned empty | orchestrator |
| 21 | Phase C (subagent, claude family) review goes to a CLI lane; phases A/B (codex/grok) reviews go to claude-family subagents | batches.md review plan | team-leader rule |
| 22 | grok weekly 91% (near limit) at spawn; fallback for later grok work: codex, then same-side subagent with disclosure | ptah_agent_spawn limit state | agent-lanes §5 |
| 23 | Codex lane sandbox cannot write git metadata (fetch failed); orchestrator ran fetch: origin/main 40b6f0192, latest migration 0065, 0066 free; lane resumed with no git commands | reports/batch-9-report.md (first run) | orchestrator |
| 24 | Codex sandbox blocks Nx daemon socket (EPERM /tmp/.nx sockets): codex batches verify with NX_DAEMON=false NX_ISOLATE_PLUGINS=false, else direct tsc/jest/eslint under verify.mjs --exec lock; orchestrator runs official npm run verify per batch before commit | reports/batch-9-report.md | orchestrator |
| 25 | Codex resume fell back to a context-free handoff lane (idle >600 s); stopped it and respawned with a full self-contained brief | agent-lanes §5 | orchestrator |
| 5 | Task folder moved from main checkout to worktree (cp + cmp + rm) | CLAUDE.md worktree rule; ptah_task_create wrote into main | CLAUDE.md |
