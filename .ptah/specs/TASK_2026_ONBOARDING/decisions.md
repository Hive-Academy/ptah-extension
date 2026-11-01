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

## B3b
- **Phase 1 (state layer):** implementer Codex; reviewer in-process Claude code-logic-reviewer
  (different family). Initial REVISE 6/10 → revise 1 REVISE 8/10 (new: transient lookup failure
  latched as mismatch) → revise 2 APPROVED 9/10.
- **Carry to Phase 2 pages:** (a) review finding 5: A4 rebind order `?run` → handoff `started()`
  (compare `started().tabId` with the page tab) → authoritative run; no second `runWizard`;
  auto-start only when no run exists and outcome is not `manual-recovery`. (b) Re-review rev 1
  N3: a cleared `started()` while `manualContinue` is in flight is not "no run". (c) Re-review
  rev 2 Moderate: after 3 failed expected-run lookups the store goes silent. Phase 2 adds a
  `lookupExhausted` signal (store, with a spec for the fourth failure) and the page shows an
  error with Retry.

## B3b Phase 2
- Logic review REVISE 6.5 → round 1 fixes → APPROVE 8/10. Carries (a)(c) met; (b) met after
  round 1 (lookup-error panel, in-flight Start guard, late `started()` rebind effect).
- Coordinator fixed TS18047 null guard in A3 `startNow` (one line) found by own verify.
- A5 "Tribunal" link opens chat (Tribunal view retired); label changed, wording revisited in
  visual fixes.
- Deferred minors: A5 marks completion on deep link; `lookupExhausted` not cleared on destroy;
  A3 Start now after manual recovery silent; A4 no Start while another tab's handoff pending.
- Capture gap: A3 countdown not capturable from restored-run fixtures.
- Visual review REVISE 7/10 (5 serious) → separate visual-fix batch.

## B3b visual fixes
- Codex lane fixed serious 1–5, minors 6, 7, 9, 10 and the axe `aria-allowed-role` violation.
  Visual re-check APPROVE 8/10 (88 generate + 72 analyze captures, all axe `violations: []`,
  no analyze stepper regression). Logic review APPROVE 7.5/10.
- Deferred: `border-state-err/70` renders near-white (opacity modifier on the `state-err`
  token does not resolve; also used on B3a pages) — fix lib-wide later; guidance-completed
  full-page capture still viewport-sized (shell scrolls an inner container), so summary rows
  3–4 stay unverified in captures; logic M1 (`quiet`/`starting` generic copy), M2 (A5 failed
  link renders without `gen`), M3 (no-op `destroyed` guards in A4).

## B4a
- Codex lane implemented; logic review REVISE 5/10 (B1 saved draft counted as active, S1 stale
  record, S2 no start guard, S3 thrown send read as accepted) → round 1 → APPROVE 8/10.
  Verify 8/9 (only the webview lint cycle, fixed separately in PR #866), electron 2/2.
- Deferred to B5b: old view leave handler ignores abort failure; leave dialog `stopUncertain`
  has no consumer yet.
- Deferred moderates: a throw before the `try` in `startInternal` rejects every waiting
  `start` (add `.catch` on the awaited pending); stop skips abort on a `loaded` tab that still
  has background agents; a cancelled navigation discards a just-started session (confirm in
  B4b UX).

## B4b
- Codex lane implemented; logic review REVISE 5/10 (1 blocking: raw vs canonical workspace
  root; majors: apply attributed at response time, restore wiped overrides, Save draft left
  the session out of conflict detection, unreported cancelled stop) → round 1 (Codex) →
  REVISE 7/10 (N2 stale override on restore; N1 apply start by button text; N3 no Save draft
  result) → round 2 (Codex) → APPROVE 8/10. Review in code-logic-review.b4b.md.
- `canonicalHarnessRoot` is now exported from `@ptah-extension/harness-builder`.
  `BuilderApplySectionComponent` gained `applyStarted` / `applyFailed` outputs.
- Save draft stops the session first, then saves and navigates to `/onboarding`.
  A failed cancelled stop is published through `NotificationService` (the route store can be
  destroyed by then).
- Coordinator ran Prettier on the lane files before round 3 (format only).
- Deferred minors: N5 restoring a nested field (persona, agents, skills, prompt, mcp) that
  already has an override deep-merges instead of replacing it; N6 no apply-section spec asserts
  `applyFailed` emission.
- Visual review (visual-review.b4b.md): REVISE (3 major: duplicate stack chips, apply result
  out of frame in captures, New/Changed badge contrast in anubis themes) → Codex fix →
  APPROVE; axe 0 violations in 76/76 captures (was 12 color-contrast nodes).
- Deferred visual minors: 6/N1 disabled Review pill keeps the primary fill in ptah-glass dark;
  8 narrow stepper trailing circle (shared stepper component); N2 "Applied revision" card
  spacing (~2 px vs ~20 px). Minor 7 is the known deferred heading focus box (item 11).

## B5a
- Codex lane implemented (39 files); it stopped at 37 min while its verify waited in the lock
  queue. Coordinator stopped its orphan verify and changed the electron-shell.apps-tab.spec.ts
  label expectation "Setup hub" → "Setup" (the B5a menu label).
- Logic review APPROVE 8/10 (code-logic-review.b5a.md), 7 minors.
- Coordinator verify: core:test failed (surface-router "has no route" warning) → fix lane;
  `ptah-electron-e2e:lint` fails on `src/specs/git-watcher.spec.ts` (4 `fs.watch` errors,
  TASK_2026_437 INV-1). That file and the rule are identical to main, so the failure predates
  this task; it is reported, not fixed here. Electron and VS Code host specs pass.
- Lane limits on 2026-10-31: Grok weekly 100% (resets 2026-11-03 17:40 UTC); Ollama weekly 100%.
- Fix round 1 (Codex): core warning restored; minors 2, 4, 6, 7 fixed → review APPROVE 8.5/10.
  New minors R1-2 (warn condition readability) and R1-3 (hardcoded flow regex) deferred.
- Restore target (review minor 1): B5a made Home and /onboarding/ready restore targets again.
  The B1 review recorded that as a defect (context.md B1 entry), and the B5a plan asks only for the
  binding parser swap. Coordinator decision: persist only onboarding URLs with a validated
  identity binding; Home, ready and unbound pages keep the previous route. Fix round 2 (Codex),
  together with the missing cancel-path spec (R1-1).
- Fix round 2 (Codex) → review APPROVE 9/10. Harness proposal URLs are not persisted (no identity
  validator exists for them); legacy saved routes keep landing on Home. Open by decision: minors 3
  (resume store reads the first tab per workflow), 5 (resume uses raw Router.navigate), R1-2, R1-3.
- Final verify: 29/30 (webview lint cycle only) and host lint/typecheck 11/12 (the pre-existing
  ptah-electron-e2e lint only); Electron and VS Code host specs 7/7 and 33/33.

## B5b
- Codex lane deleted 51 ledger files, narrowed the focus-router union, updated barrels, routes,
  specs and e2e migrations, and authored onboarding.spec.ts (not run). Verify 17/18 and 7/8
  (accepted webview lint cycle and pre-existing e2e git-watcher lint only).
- Parity gap found by the lane: P22 moved the legacy completion page to A5, but A5 does not render
  P17-P19 from CompletionData.result (a B3b gap). The lane kept completion.component.ts(+spec)
  under the preserve rule. Coordinator decision: close the gap inside this task (it is in the
  plan, not a new scope): Codex lane renders P17-P19 on A5, adds specs and the done-state capture
  fixture, then deletes the two files. Needs its own logic review and a visual pass of analyze-done.
- B5b logic review: round 1 REVISE 6/10 (F1-F10); Codex fix r1 (b5b-fix-r1-report.md); round 2
  APPROVE 8/10. F7 kept as a source-text guard over app.config.ts and app.routes.ts (accepted).
- Coordinator fixed R2-3 directly (setup-wizard-tour.scene.ts spotlight targets now match the 13
  narration lines: 3 analyze, 4-6 new project, 7 team builder, 8-11 home).
- Deferred minors: R2-1 onboarding.spec.ts:21-22 re-seeds setup the fixture already did and relies
  on RPC mocks surviving reload; R2-2 (F10) stale comments in Electron, core, mcp-apps-page,
  setup-wizard and message-handlers-eager.spec.ts. Electron e2e specs authored, not run.
- A5 logic review: round 1 REVISE 7/10; Codex fix r1 (b5b-a5-fix-r1-report.md); round 2 APPROVE
  8/10 with R2-1 (cancelled/timed-out runs show success) and R2-2 (old completion page sections
  dropped without approval: agent count, result.errors list, workflow types, pro tips, example
  commands). Not approved for removal in context.md, so the coordinator restores them. Codex fix r2
  (last revise round, lane 23e32487) fixes R2-1..R2-6; R2-7 (Enhanced badge keyed on
  enhancedPromptsUsed) accepted. Webview build after r1: exit 0 (4/4).
- A5 final review (round 3) APPROVE 8.5/10. Coordinator bounded correction for R3-1 (skipped
  agent generation now shows "You're ready to work") and R3-2 (cancelled/timed-out note precedes
  the failure note); same-family review (weaker evidence, revise cap reached): APPROVE.
- Deferred minors: R3-3 completion-payload error fallback matches runs by shape, not identity
  (safe copy only, no length cap); 'missing' from no workspace path reads as ready; no spec that
  running/failed-lookup keep the ready heading absent.
- Captures after B5b: 0/76 generate captures landed; boot restored chat. Root cause (B5a
  01f9f88c8): navigateToUrl validates onboarding ?tab= routes against workspace tabs, but the boot
  restore ran before Electron's workspace sync loaded them, so the restore failed and fell back to
  chat. Real Electron users were affected (Generate/Guidance never restored after restart).
- Fix (Codex lane 616e1a54, b5b-restore-fix-report.md): initial-navigation.ts waits for
  ElectronLayoutService.workspaceResolved before restoring an onboarding ?tab= route, and yields to
  a newer navigation. Claude logic review: APPROVE 8/10 (code-logic-review.b5b.md). Deferred
  hardening: no own wait cap (worst case two sequential 30 s RPC timeouts); returning 'cancelled'
  after a failed in-wait navigation could leave an empty outlet; skip the await when already
  resolved; no spec for "resolved but tab missing" or the VS Code already-resolved case.
- Coordinator updated stale done-facts capture assertions: the inline "1 written" sentence is
  intentionally dropped when per-file outcomes render (A5 F2); the fixture's opened-folder target
  never reaches the Library, so the stale notice is asserted absent (unit spec still covers it).
- Captures: onboarding-generate-visual 88/88 passed (80 full run + 8 done-facts re-run).
- Visual review (visual-review.b5b-a5.md): REVISE 6/10. Coordinator fixed #2 (focusable example
  <pre>) and #4 ("Agents: needs attention" for a completed run with failures); re-capture 8/8,
  axe scrollable-region-focusable gone. Deferred: #1 anubis error-token contrast 3.87:1
  (pre-existing on main, reused outcome-summary), #3 state-colour treatments, #5 Guidance stepper
  length, #6 narrow orphan tile. Same-family follow-up, evidence: axe JSON re-check.
