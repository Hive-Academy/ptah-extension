# Continuation decisions — 2026-10-29

- Resume existing approved task at B1c; no requirements/design/architecture gates repeated. Evidence: HANDOFF.md and context.md. Reversible.
- Pre-flight routing: FEATURE, source model, confidence 0.5795; depth null, source skill-table, fallbackCause low-confidence, modelProposal o2/0.3413. Adopt Partial for the known remaining batch. Overall confidence 0.5795. Usage 1 request, 407 input tokens, 0 output tokens, cost unknown.
- Gate 0.1: lanes enabled; Approval lane-review. Preference source: user requested CLI implementation; existing task requires Ollama review. Codex selected for bounded capture fixes, lane-default model, source pin, confidence null. Ollama pc-f3384f72-a556-4ab4-b2b1-7e1e028f22cb selected for review, configured glm-5.3:cloud, source pin, confidence null. Overall source ranking, confidence null; no routing requests. Both have confirmed room. No new scope or capability removals.
- Missing task.md is a legacy carrier gap, not an invalid user-supplied ID: user invoked continue, and HANDOFF/context/approved plans establish task identity. Do not recreate requirements or task identity during capture repair.
- User requested Kimi Code as well (2026-10-29). Added one bounded read-only chat-timeout investigation on available kimi-code lane pc-7594dcab-a859-41a0-8e8b-e8df5dba7d25, sonnet tier, source pin; quota untracked/unknown, not assumed room. Agent 43231626-adba-4327-a6ba-334e409778ff. No duplicate test run, code edits, or replacement of pinned Ollama review. Deliverable b1c-chat-timeout-investigation.md. Reversible staffing choice.
- Capture failures are not proven production defects. Delegate root-cause inspection before editing. Existing headless harness captures are implementation evidence with Electron configuration, not evidence of a running Electron dev process. No Electron serve/dev authorization inferred.

## 2026-10-30 — B1c narrow capture and provider-card a11y

- **400px clipping root cause** (in-process frontend-developer, verified by coordinator):
  `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:445` holds the
  content area at `min-w-[400px]` between two 32px rail tabs; Electron `minWidth: 800`
  (`apps/ptah-electron/src/windows/main-window.ts:124`). A 400px *window* cannot occur in
  Electron, so the old capture clipped a state the product cannot reach.
- **Decision:** keep production unchanged; the narrow capture uses a 464px viewport so the
  onboarding content area is the design's 400px (design-spec §12.8). Options: change the
  shared shell min-width (wider blast radius, unneeded for Electron), or keep 400px window
  (tests an impossible state). Reversible: yes (one harness constant).
- **Kimi lane** blocked twice: no saved plugin config for this worktree root in
  `~/.config/Ptah/global-state.json`; only the main root enables `ptah-angular`. Work moved to an
  in-process subagent governed by the main-root config, where the user enabled the skill.
- **Provider card nested-interactive:** Codex implemented diagnosis Option A (non-interactive
  frame, full-surface details trigger, sibling inline controls). Coordinator updated harness
  selectors from `[role="button"]` / provider-name clicks to `provider-card-details-trigger`.
- **Visual re-review** (visual-reviewer subagent): APPROVED 7/10. Follow-ups handled:
  connections grid `minmax(min(22rem,100%),1fr)` (narrow card overflowed its panel — pre-existing
  Settings bug exposed by onboarding stage 2); harness fixture for `setup-status:get-status` and
  `wizard:list-analyses` (Home showed skeletons only because the harness never answered).
  Recaptured: 116/116 passed, 116 axe reports with 0 violations. Stale `*-400x800` captures removed.
- **Recorded residuals (not blocking B1c):** provider card row is cramped at a 400px content area
  (name breaks mid-word) — Settings card polish; old span titles on card-subtitle/used-for are now
  unreachable duplicates of the trigger title (review b1c-c LOW); Enter/Space on the trigger has no
  e2e coverage (native button); harness logo renders as a broken image and the OS tab preselects
  Windows because the harness user agent reports Windows; programmatic focus on the page h1 shows a
  focus ring in headless captures; narrow stage-1 captures are viewport-only (command row wrapping
  below the fold not captured); settings-providers/settings-visual e2e specs with updated
  selectors were typechecked and linted but not run. No live Electron runtime validation.

## B2 (shared presentational components)
- Implementers: Codex (part A: stepper, run chip/panel, step meter, recovery screen, owner conflict
  banner, resume banner), Grok (part B: item status card/grid, details log). Review family:
  in-process Claude `code-logic-reviewer`. Initial review REVISE 7.5/10 (findings 1–9); revise
  round 1 by both lanes; re-review APPROVED 8.5/10.
- **Coordinator bounded correction** (after the re-review, Low items): resume banner reuses
  `ptah-run-status-chip state="resumable"` (finding 3 residual); details-log mount key is
  `tab:<id>` so a tab id `analysis`/`unavailable` cannot hit the wrong branch (new 2). Reviewed by
  an in-process Claude subagent — same family as the coordinator; weaker evidence; reason: a
  six-line correction of Low items, a CLI lane round costs more than the risk.
- **Carry to B3a/B3b:** `RunPanel` offers Retry / Start over for `stop-unconfirmed` and
  `stop-unknown` only when the page passes `[viewState]`; pages must pass it (re-review new 1).
- Kept: `ItemStatusCard` pending uses `Clock`, the chip idle uses `CircleDashed` (different
  concepts, reviewer accepted).

## B3a
- **Match % range (coordinator, source over spec):** design-spec A2 says `round(score*100)`,
  hidden outside 0..1, but the backend sends `relevanceScore` as 0–100
  (`libs/shared/src/lib/types/wizard/recommendations.ts:37` example 92;
  `agent-recommendation.service.ts:217` and `orchestrator.service.ts:716` send 100). A 0..1 rule
  would hide the match % for every real row. Decision: show `round(score)%`, hide outside 0..100
  or non-finite. Intent of the approved spec (show a match %, hide invalid values) is kept.
  Reversible: one pure function.
- **Review rounds:** implementers Codex (L1, L3) and Grok (L2, L4); reviewer in-process Claude
  `code-logic-reviewer` (different family). Initial REVISE 6.5, round 1 REVISE 7.5 (N1–N4),
  round 2 (final) Codex for N1–N3.
- **Carry N4 (E2E pass):** Retry from the A1 stop-unconfirmed panel resumes a run that may still
  be live host-side. Matches the RunPanel contract; reviewer marked it not a defect against this
  plan. Re-check in the B5 E2E pass.
- **Capture flake:** round-1 capture 70/72; the two failures (ptah-glass-light analyze-failed,
  analyze-completed) were `route.fetch: read ECONNRESET` on static chunks, not assertions.
- **Visual fix batch:** Codex fixed visual-review D1–D9, landmarks, N5/N6; logic review REVISE 7
  (V1 row Preview narrowed selection, V2 row label) → revise 1 → APPROVED 9/10. Captures 72/72;
  visual re-check APPROVED. Carry: host acceptance of a single-id row start (tests mock stores)
  → E2E pass. Narrow stepper hides non-current labels visually (sr-only kept), per spec line 78.
- **Elapsed "-1s" (coordinator correction):** `now` was set at construction and `openedAt` at
  run start. startClock now sets both to the same time, and elapsedSeconds clamps at 0.
  Regression test added. Reviewed by Grok (a different family from the coordinator).
