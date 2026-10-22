# TASK_2026_707 — Analytics dashboard redesign

- Branch: feat/analytics-dashboard (worktree .claude-worktrees/analytics-dashboard)
- Type: FEATURE, Full workflow. Electron first.
- Executor mode: CLI lanes first (temporary user rule until 2026-10-24).

## User request (2026-10-20)
1. Plan limits section: buggy, not uniform across providers, too tall.
   - Grok: why does it not work? Where to put an API key if one is needed?
   - Ollama: shows "requests"; the ollama.com page shows session % and weekly % with resets.
   - Antigravity: usage unknown; see https://antigravity.google/docs/cli/commands/usage/
2. Session stats: basic cards. Wanted: a T3 Code style usage dashboard — usage per provider
   today, tokens burned per provider, cost per model, stats and charts.

## Phase 1 — research lanes
- codex 8f846a45 → code-audit.md
- Glm 0f2abc95 → provider-usage-sources.md (Ollama /api/balance verified: docs + 401 unauth)

## User decisions
- Two PRs: PR 1 plan-limits strip + readers, PR 2 usage dashboard.
- Charts: in-house SVG. Pricing: existing OpenRouter pricing service + bundled fallback.
- Grok: local CLI session spend, no new key in PR 1 (management key = future).
- Ollama: /api/balance for %, never compute % from requests.

## Phase 2 — architecture
- codex 4a313c87 → implementation-plan.md (reviewer: orchestrator, in-process). User APPROVED,
  PR 1 and PR 2 in parallel.

## Phase 3 — implementation
- PR 1 worktree: .claude-worktrees/plan-limit-tiles (feat/plan-limit-tiles)
  - antigravity 93bad859 → batch-pr1-backend.md (auth-providers quota + plan-limit.types.ts)
  - Glm 47802dc2 → batch-pr1-frontend.md (dashboard tiles)
- PR 2 worktree: .claude-worktrees/analytics-dashboard (feat/analytics-dashboard)
  - codex 5f37484c → batch-pr2-backend-a.md (contract, ledger scan, usage-analytics lib)
  - batch A delivered with gaps (CLI sources unavailable, TS2339) → codex defc8448 batch A2
    (Codex jsonl, OpenCode opencode.db, Grok updates.jsonl sources; per-file cache; fixtures)
  - antigravity e202a1f9 → batch B (RPC handler + host DI + guard specs)
  - PR 1 backend (antigravity 93bad859) delivered: statusReason + PlanLocalUsage.models fields
  - PR 1 frontend (Glm 47802dc2) delivered. Orchestrator checks: typecheck dashboard/auth-providers/
    shared PASS; dashboard tests PASS (173); auth-providers: plan-usage.service.spec failed under load,
    passes alone (40/40); translation-proxy.sdk.integration.spec failed (190 s, untouched) → re-run idle.
    Spec provider-account-card 1717→451 lines: reviewer must check coverage loss.
  - Glm 65d8ee6e → batch C (usage dashboard UI + SVG chart)
  - Machine queue: told skills-epic session "go"; wait for its "checks: free" before heavy checks.
  - PR 2 batch A2 (codex defc8448) delivered: Codex/OpenCode/Grok dated sources, per-file cache.
  - PR 2 batch B (antigravity e202a1f9) delivered (agy exit 1 again; 503-retry correlation).
    Open: smoke specs do not resolve AnalyticsRpcHandlers/usage-analytics token; scope = workspace.
  - PR 1 review (codex 66326263): REVISE 5/10, 0 blocking / 3 major / 3 minor + coverage loss.
    Fix round 1/2: antigravity 939ec1ba (backend, new statusReason literals set by orchestrator),
    Glm 2f2bb1b9 (frontend reason priority, models tooltip, restored coverage).
  - LIMIT: antigravity (family antigravity) RESOURCE_EXHAUSTED 429 "Individual quota reached",
    reset ~2026-10-20 05:11 UTC (in 4h20m from 00:51 UTC). Skip until then. Note: agy -p /usage
    showed 100% remaining at 00:08 UTC — /usage windows do not reflect this individual quota.
    ptah_agent_list still says "reader failed" for antigravity, not AT LIMIT.
  - Backend fix1 moved to codex 3a468bbd (finishes partial antigravity edits).
  - Re-review families: backend fix by codex → re-review by Glm (ptah-cli Ollama) or opencode;
    frontend fix by Glm → re-review by codex.
  - PR 2 batch C (Glm 65d8ee6e) delivered: Usage tab, 48 tests, typecheck dashboard pass.
    Gap: cache savings "—" (contract lacks per-class rates) → backend fix (codex, queued).
  - PR 2 backend review: Glm 27b9cbc1 → code-logic-review-pr2-backend.md
  - Queue: codex after PR1 backend fix → PR 2 backend fix (cacheSavingsUsd + smoke guards +
    review defects); codex → PR 2 frontend review; codex → PR 1 frontend re-review.
  - PR 1 fix1: Glm frontend 2f2bb1b9 delivered (60 tests); codex backend 3a468bbd delivered (70 tests,
    typecheck auth-providers pass). Re-reviews: codex 88072f74 (frontend r2), Glm 4e48bb12 (backend r2).
  - PR 2 backend review (Glm 27b9cbc1): APPROVE WITH FIXES 6/10, 0/5 major/4 moderate/9 minor.
    Fix round 1: codex f343062e (dedup identity, OpenCode normalization, partial on budget, lazy
    better-sqlite3 + externals, DI guards, cacheSavingsUsd contract).
  - PR 1 re-reviews: frontend r2 (codex) APPROVE WITH FIXES — orchestrator removed stray `percent`
    in plan-tile-view.model.spec.ts; card spec :310 TS error still to check at typecheck.
    Backend r2 (Glm) APPROVE WITH FIXES — orchestrator fixed mojibake label (·) and candidate
    loop (continue on non-timeout spawn failure) + 2 tests; adapter spec 35/35. Deferred minors:
    stale no-oauth/no-local-server docstring, FIFO owner eviction.
  - PR 1 DONE: checks pass (translation-proxy integration spec fails on main too), commit c1ec75cea,
    PR #784 https://github.com/Hive-Academy/ptah-extension/pull/784. Remaining: Electron visual review.
  - PR 2: backend fix1 codex f343062e delivered; Glm 2b2a7015 C2 (cache savings UI);
    Glm ab4d0434 backend re-review r2 → APPROVE WITH FIXES 8/10; N1 (fact-limit drops later source
    statuses) + N2 (duplicated source-id literal) fixed by orchestrator in usage-summary.service.ts
    (SOURCE_IDS + skippedSources); spec 2/2. Typecheck usage-analytics pending (machine queue).
    Deferred: item 8 perf memo/benchmark, item 11 qualified bundled pricing lookup, legacy Claude
    null-id dedup, pricing asOf, Ollama/Antigravity dashboard sources. usage-summary.service.ts has
    very long one-line statements — prettier at commit; flag for code-style review.
    C2 (Glm 2b2a7015) delivered: cache savings UI with lower-bound rules, 53 tests.
    PR 2 frontend review (codex 3bf88b4f): REVISE 5/10, 6 major / 2 minor → fix round 1 Glm a4c6767e.
    Fix1 Glm a4c6767e (65 tests). Re-review r2 codex 1fbad883: REVISE 6/10 (share denominator,
    chart readout, console.warn, file size) → FINAL fix round 2 Glm ab9e2457. After it: cap reached;
    orchestrator verifies; any remaining defect = one bounded correction + independent check.
  - PR #784 CI: degradation ratchet (ollama-cloud-usage.parsers.ts:44,:90), e2e plan-limits-visual
    (old testids), + 4 CodeRabbit comments (1 major Antigravity identity) → codex ac6ba777.
  - Visual review: user has NOT seen changes. Electron queue: notification-final → 662 → 708 → me.
    Then build-dev from worktrees, screenshots dark+light, show user before merge.
    Then: codex re-review (resume CLI session 01a156f3-2b6f-7990-85a3-3f416d571f52), PR 2 checks, commit, PR, visual review.
  - Then: Glm resumes batch C session to render cacheSavingsUsd; PR 2 frontend review by codex.
  - Machine queue: skills-epic (593-702, 662) → voice-canvas TASK_2026_708 → me. Wait for "checks: free".
  - Next: PR 2 review after batch C;  (RPC handler + host DI + guard specs), batch C (dashboard UI + SVG charts)
- Reviews: code by a different family than the implementer; visual review in Electron.
- node_modules: junctions to main checkout in both worktrees.

## Lane limit (2026-10-20 ~18:35 UTC)
- Glm (ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164, family Ollama Cloud): usage limit hit, reset unknown. Skip for the rest of this run. Fallback: codex for the PR 784 revise round 1; re-review by a non-codex family (opencode).
