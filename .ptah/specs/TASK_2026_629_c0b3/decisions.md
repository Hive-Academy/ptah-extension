# Decisions — TASK_2026_629_c0b3

Decisions taken by evidence or peer (decision ladder steps 1-2). The user can overturn any row.

| # | Batch | Decision | Evidence | Reversible |
|---|---|---|---|---|
| 1 | B2b | Responder posts `AGENT_MONITOR_PERMISSION_RESPONSE` and always clears with `requestId`; no clear when the post throws | D3; `tile-agent-mini-panel.component.ts:125-143`; spec `agent-permission-responder.spec.ts` | yes |
| 2 | B2b | Lane key prefixes `cli:` / `sub:` / `bg:` | D4 (key builder lives in chat); `compact-lane-rows.spec.ts` | yes (before B7a uses it) |
| 3 | B2c | Card branch and elapsed come from `TabState.agentOrigin` (child tabs only); other sessions show placeholders | `lane-B2c-report.md` Decisions; summary is 628-owned | yes |
| 4 | B2c | New `contextPercent` input on chat-ui `CompactSessionActivityComponent`, fed from `liveModelStats.contextPercent` when `contextKnown` (file-list change, reported to the parent) | `lane-B2c-report.md` Decisions | yes |
| 5 | B2c | Error callout has no Retry (`canRetry: false`): no session error retry action exists today (A8) | `lane-B2c-report.md` Decisions | yes |
| 6 | B2c | Todos and git +/- metrics are NOT shown: no public card-level source exists. Left as an open gap for the Phase A review | `lane-B2c-report.md` Open items | yes |
| 7 | B2b/B2c | Prettier applied to the touched files; this reformatted the B2a chat-ui template (whitespace only) | `git diff -w --stat` | yes |
| 9 | Phase A review | Fix round = all Serious + Moderate items that touch B7a API (named `SessionCardActions`, lane-key constants/parser) or can send a wrong answer (double post, wrong-session callout). Split into Fix-1 (chat-streaming + chat logic) and Fix-2 (chat-ui structure + visual) | orchestration lean rule 4; reviews | yes |
| 10 | Phase A review | DEFERRED (later task): pulse target list deleted before the router reads it (`code-logic-review-B0-B1.md` #2). Pre-existing: B0 did not change that deletion (`git show 5e843c69f`) | B0 diff | yes |
| 11 | Phase A review | RECORDED (Minor): 100-event sampler spec does not mutate events (B0-B1 #3); Retry not bound because no session retry action exists (logic #6, see row 5) | reviews | yes |
| 12 | Phase A review | USER DECISION NEEDED (scope): todos and git +/- in the metrics zone have no frontend source; adding them needs a new host data path. Not blocking Phase B | logic review #7, visual gap 2 | yes |
| 13 | Phase A visual | Real-card screenshots BLOCKED: browser tool refuses `file:` URLs and no app instance runs; the prototype is dark-only. User takes them before merge (steps in `visual-review.md`) | visual-review.md | n/a |
| 8 | Phase A | Visual review must not start build/serve (CLAUDE.md). It uses a running instance if one exists, else the static prototype plus a template comparison, and lists rendered screenshots as blocked for the user | CLAUDE.md STRICT rules; user rule 7 | yes |
