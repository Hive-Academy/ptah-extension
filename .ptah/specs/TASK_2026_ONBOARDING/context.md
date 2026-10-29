# TASK_2026_ONBOARDING — Context

Worktree: `.claude-worktrees/onboarding-module` (branch `feat/onboarding-module`)

## User request (2026-10-27)

The setup-wizard UX is confusing. Rebuild it as an onboarding module that starts on first install
(localStorage flag plus an Angular route guard). The big refactor is the setup steps themselves.
Each workflow currently runs as a streaming chat with a narrow sidebar. The backend works but the
UI is flawed. The workflows need dedicated UI/UX instead of streaming everything.

## User decisions (user-requested)

- Onboarding home shows **3 cards**, each on its own route: New project, Analyze current
  project, AI team builder.
- **Re-entry**: a localStorage flag plus a route guard shows onboarding on first install. A
  menu/settings action reopens it at any time.
- **Live output**: the main view is a step UI (stepper, per-item status cards, results review).
  The raw agent stream is only a collapsed "details" log.
- **Old surfaces**: setup-wizard and setup-hub are replaced and deleted. Every capability is
  mapped in `parity-inventory.md`. Anything dropped goes under Proposed Removals for user
  approval.

## Design gate (user, 2026-10-27)

- The design is approved, and the orchestrator applied the §1.2 redirect-cancel fix
  (NavigationCancellationCode.Redirect keeps the pending record).
- Approved removals: duplicate Welcome/Scan; separate gen/guidance hub cards (the secondary
  Home links stay); unused facade methods. **Rejected:** the legacy prompt-enhancement step
  and Manual adjust are both KEPT (spec §7 updated).
- Audience: everyone sees onboarding once per version (`ptah.onboarding.v1`), including users
  who upgrade.

## Scope addition: "Get ready" pre-steps (user, 2026-10-28, after #832 merged)

- Before the 3 cards, onboarding adds initial steps:
  1. **Claude Code check.** Claude Code is a system requirement. Detect it with the existing
     RPCs (`agent:detectClis` and `provider:getAmbientClaudeStatus`, whose `reason` may be
     `cli-missing`). Also show its sign-in state.
  2. **Main settings.** Providers and other CLI tools.
- D10 (user): the install is **guided, with no backend**. Show the official install command
  per OS with a copy button and a docs link, plus a "Re-check" button. The no-backend-changes
  rule stays.
- D11 (user): **warn, but allow skip.** If Claude Code is missing or signed out, show a
  persistent warning. The user can still continue to settings and the cards.

- **Design gate for Get ready (user, 2026-10-28): approve all.** Approved: design-spec §12,
  including the lane items L1–L7 and decisions D1–D9 in §12.10–12.11. This covers aligning
  `credentials-tab.component.ts` with the shared install and sign-in command constant.

- **Visual revision (user, 2026-10-28):** more icons, especially for providers and the main
  steps. Design for glassmorphism, using the existing `ptah-glass` and `ptah-glass-light`
  themes; this applies across the whole onboarding module. It goes into design-spec §13.
  Screenshots are needed in the glass themes as well as plain dark and light.

- **Prereqs addendum review r0 (codex): REVISE.** Orchestrator decisions, both reversible:
  1. The approved Accounts-drawer destination wins over the self-imposed "reuse settings
     unchanged" constraint. B1b adds a minimal public drawer input to `providers-settings`.
  2. No screenshot waivers. Every state in all 4 themes is captured with mocked-RPC fixtures.
- **Prereqs addendum review r1 (codex lane 10195ca7…): REVISE.** Both r0 findings resolved. Open:
  stage-2 checking and error captures missing; error-local fixture must use a resolver for
  `rpcError`; the screenshot command must match the harness e2e target. Revise r2 is the last round.
- **Prereqs addendum review r2 (codex lane 1b23ce47…): APPROVED.** One minor wording fix (stage-1
  readiness ids exclude `checking-ambient`) applied by the orchestrator. r1 kept as
  `implementation-plan.addendum-prereqs-review.r1.md`. Plan gate complete; implementation starts
  with B1.
- **§13 visual gate (user, 2026-10-28): APPROVED.** `design-spec.md` §13 and the 66
  `prototype/screenshots/v2-*` captures are the visual target. Plain themes are `anubis` and
  `anubis-light`. Reuse the vendored `ptah-provider-mark` / `ptah-monogram-tile`; vendor no logos.
- **Screenshot build/e2e (user, 2026-10-28): ALLOWED** for screenshot steps only: a webview build
  plus the `webview-e2e-harness` e2e capture, run under `node scripts/verify.mjs --exec`. Never
  part of `npm run verify`, and no other build, serve or e2e use.
- **Contrast scope (user, 2026-10-28):** the other glass scenes and the rose/moonstone accents
  are measured at the implementation visual gate, not now.
- **B1 (2026-10-29): committed 7afaad78b.** First implementer was stopped by the budget monitor;
  a fresh frontend-developer finished it. Codex review lanes stopped twice without a deliverable
  (not a limit), so review fell back to the ollama-cloud lane: REVISE (route persistence saved
  `/onboarding` as the restore target) → orchestrator fixed 3 defects → r1 APPROVED.
- **B1b grep gate (orchestrator, 2026-10-29):** the e2e harness
  (`settings-reachability.table.ts:1546-1553`) asserts the visible npm command text. The harness
  may not import app libs, so harness assertions are exempt from the command-string gate.
- **Branch behind main (2026-10-29):** chat lint errors in `attention-context.util.ts` and
  `chat-attention-source.service.ts` are fixed on main; merge main after the B1b commit. Still
  failing on main itself: webview lint (circular dep via command-center `scene-contrast.spec.ts`)
  and ptah-electron-e2e lint (`git-watcher.spec.ts` fs.watch).
- **B1b screenshots (orchestrator, 2026-10-29):** the 4 Credentials-drawer captures (Claude
  (Subscription) → Credentials, 4 themes) are taken in the B1c capture run (one webview build
  for both). The B1b visual gate stays UNMET until that run; B1c must include them.

## Project rules (project-rule)

- Electron first. Keep the VS Code host and the TUI compiling.
- Verify with `npm run verify -- -p <projects>` only.

## Lanes

| Phase | Lane | Family | Deliverable |
| --- | --- | --- | --- |
| Discovery | codex | codex | parity-inventory.md |
| Discovery | Ollama Code (opus tier) | ollama-cloud | backend-contract.md |
| Design | ui-ux-designer subagent (in-process) | claude | design-spec.md + prototype/ |
| Design review | codex lane (opposite side) | codex | design-spec-review.md |

- New project and AI team builder use a proposal-centric workspace with no backend change
  (orchestrator decision, reversible). A backend step contract would be a separate task if
  the user asks for one.
- Design review round 0: codex verdict REVISE, 8 blockers. #1 (boot navigation bypasses the
  root guard) and #4 (4 phases, not 9) were confirmed in the code. Revise round 1 was sent to
  ui-ux-designer. The codex review session to resume for the re-review is
  01a17e57-5326-7f42-888c-5e45cca24e2d.
- Design review round 1: a fresh codex lane (the resume exceeded 60k, so it got a handoff
  brief) returned REVISE with 4 residual blockers. #1 was verified (`preload.ts:47` defaults to
  `chat`, `boot-navigation.ts:58`) and so was #3 (`analysis-storage.service.ts:503` skips
  completed analyses). Round 2 (FINAL) went to the designer with orchestrator rulings:
  - **lane-proposed / orchestrator, needs user confirmation:** a first-run guard on the chat
    route.
  - **orchestrator, needs user confirmation:** upgrading users see onboarding once.
  - Legacy view-id normalization; launchers open Onboarding Home only.
- Codex parity inventory accepted after spot-checks (`setup-hub.component.ts:1524`, `:1539`;
  `harness-workflow-request.service.ts:400`; shell `:169` 336px).

### Lane notes

- Ollama Code discovery: terminal status `stopped` (3m16s, 0 reports). The deliverable was
  already complete (all 5 sections, 32 KB). Not a limit failure. I accepted it after spot-checks:
  `seedPrompt` at `rpc-harness.types.ts:521` (the lane said 518); `phase.ts:67-71`
  `currentPhaseNumber`, `totalPhaseCount` and `phaseStatuses`; `phase.ts:191` `percentComplete`;
  no backend emitter for `analysis-complete`. All confirmed.

## Key discovery findings

- The backend is ready for a step UI for analysis, agent recommendation, agent generation and
  the bounded harness helpers. These already have structured progress, per-item status,
  results, cancel and resume.
- Project guidance: the run lifecycle is structured. Per-section progress exists only in the
  text stream, and the final `summary.sections[]` is structured.
- New project and agent-driven team configure have **no backend step contract**. Each is a
  seeded chat session; only `proposeConfig` revisions are structured. A non-chat UI for these
  is a new backend feature, not a re-skin.
- Analysis completion has no push event. After a reload the UI must call
  `get-resumable-run` / `analysis-status`.
- Round-1 review saved as design-spec-review.r1.md; codex session 01a17e60-9856-7b13-ba35-ef22bdf21c10.
- Round 2 (final) review: REVISE. All 4 residual blockers resolved; 1 new blocker: a NavigationCancel with code Redirect (the guard's own UrlTree) clears the pending record, so shownAt is never set. Verified in @angular/router _router-chunk.mjs:1879 and _router_module-chunk.mjs:1339. The revise cap is exhausted, so the design goes to the user.

## Plan gate

- Plan review r0 (codex lane 73e39fcf…, session 01a17e7b-ae65-7592-80f9-fd227197faf9): REVISE, 6 blockers.
  Saved as implementation-plan-review.r0.md. Orchestrator verified #1 (harness-builder index exports no
  sidebar sections), #2 (old focus routers keep kinds 'setup-wizard'/'harness-builder'), #3
  (harness-workflow-request.service.ts:355 navigates to 'harness-builder'), #4 (verify.mjs -p adds no
  dependents; ptah-tui test dependsOn build), #6 (prompt-enhancement.component.ts:305-321 awaits summary;
  getPromptContent RPC at enhanced-prompts-rpc.handlers.ts:918). Revise round 1 of max 2.
- **D9 (user, 2026-10-27):** guidance runs bound (Stop/reload/conflict kept). After confirmed completion
  the UI reads `enhancedPrompts:getPromptContent`, isolates the Project-Specific Guidance region and
  counts words in the 4 canonical sections (Project Context, Framework Guidelines, Coding Standards,
  Architecture Notes) with the backend's whitespace rule. Accepted losses: totalTokens, usedFallback
  badge, Quality Guidance row. No fabricated counts on null/stale content.
- Revise r1: fresh software-architect subagent (claude, in-process) revised implementation-plan.md in place;
  "## Revision log (r1)" maps all 6 defects + non-blocking items. Re-review r1: codex lane
  3d91a492-04e4-4b96-9c31-ed255382f798 (codex weekly 77% used, resets 2026-11-02), writes
  implementation-plan-review.md.
- Re-review r1 (codex 3d91a492…): REVISE — defects 1-5 fixed; 1 residual D9 blocker: content capture
  lacks authoritative run attribution (another tab's run B can be credited to run A). Verified against
  guidance-generation-run.supervisor.ts:94-95,153-160. Saved as implementation-plan-review.r1.md.
  Revise r2 (FINAL) sent to the same software-architect subagent: bracket getPromptContent with
  getRunState lookups. After r2 one codex re-review, then the plan goes to the user regardless.
- Revise r2 done (same architect subagent): run-ID-less getRunState bracket around getPromptContent;
  orchestrator verified supervisor.ts:139-180 semantics. Residual R12 (out-of-process writer, e.g. ptah-cli)
  documented. Final re-review r2: codex lane 1e5f463a-f65d-40d8-9bd6-10d8166f34f9 (fresh lane with
  handoff brief; resume exceeded 60k). After it, the plan goes to the user (cap reached).
- Re-review r2 (codex 1e5f463a…): APPROVED. Two non-blocking R12 wording fixes applied by orchestrator
  (no timing bound; documented residual, not user-accepted). Saved as implementation-plan-review.r2.md.
- **PR 832 overlap (2026-10-27):** draft PR #832 (feat/wizard-library-alignment, head 65499f2c, another
  machine) modifies setup-wizard components this plan deletes (agent-selection, agent-selection-list,
  completion) and adds 16 setup-wizard files (preview-decisions/*, generation-preview modal/store,
  pack-install prompt/store, completion/*, safe-failure-copy), plus rpc-setup*.ts and shared index.
  Parity inventory predates it. Implementation blocked until resolved; user asked whether to write a
  plan addendum against 832's head now or after it merges.
- **Gate 2 (user, 2026-10-27): plan APPROVED**, on the condition that a PR 832 addendum is written
  before any code. Addendum written NOW against PR 832 head (ref refs/remotes/pr/832, 65499f2c).
  Implementation starts after 832 merges and this branch is rebased onto main.
- **Gate 2 (user, 2026-10-27): plan APPROVED**, on the condition that a PR 832 addendum is written
  before any code. Addendum written NOW against PR 832 head (ref refs/remotes/pr/832, 65499f2c).
  Implementation starts after 832 merges and this branch is rebased onto main.
- PR 832 addendum (software-architect subagent): parity-inventory.pr832.md (P1-P29: 27 Reuse, 1 Move,
  1 Proposed Removal PR-R1 "Generate without preview") + implementation-plan.addendum-pr832.md
  (deletions 51→53, batches B2/B3a/B3b/B5b affected, order unchanged, D9 unaffected). Orchestrator
  spot-checked: 31 added setup-wizard files, none exported from barrel; PR-R1 at
  generation-preview-modal.component.ts:322 (create-only fallback). Codex review r0: lane
  01976ddd-160c-462e-9eb4-fd64ed138041 → implementation-plan.addendum-pr832-review.md.
  PR-R1 needs a user decision before B3a.
- Addendum review r0 (codex 01976ddd…): APPROVED, no blockers. **PR-R1 (user, 2026-10-27): remove
  "Generate without preview"; A2 retries only.** Orchestrator applied the 3 non-blocking items to the
  addendum. Plan gate complete (base plan + addendum). Implementation is blocked until PR 832 merges;
  then rebase feat/onboarding-module onto main and run the addendum's "## Rebase notes" check before B1.
