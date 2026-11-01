## Verdict

**REVISE** — The four original residual blockers are resolved, but the new first-run commit rule clears its own redirect marker before it can save `shownAt`.

Final review, round 2 of 2. References are worktree-relative unless absolute. **S** = `.ptah/specs/TASK_2026_ONBOARDING/design-spec.md`; **R** = `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`; **H** = `libs/shared/src/lib/types/rpc/rpc-harness.types.ts`.

## Residual blockers

| # | status | evidence file:line |
|---|---|---|
| 1 — Default Electron boot bypasses first run | Resolved; new refinement defect below | S:33 and S:35 put the Electron-only guard on chat without changing boot/preload. `apps/ptah-electron/src/preload.ts:47` supplies chat; `libs/frontend/core/src/lib/routing/boot-navigation.ts:58` selects it; `apps/ptah-extension-webview/src/app/app.routes.ts:90` is the appropriate interception point. `apps/ptah-extension-webview/src/app/app.ts:90` establishes connection before initial navigation; `libs/frontend/core/src/lib/services/app-state.service.ts:710` supplies the readiness gate. Upgrading users and other-surface deep links are covered at S:48. |
| 2 — Legacy migration and tab validation | Resolved | S:63 explicitly normalises before the shared host allow-list, S:64 before renderer message validation, S:65 maps old bases and children to Home, and S:66 moves generation binding into query parameters. These address `libs/shared/src/lib/types/webview-surface.types.ts:95`, `libs/frontend/core/src/lib/services/app-state.service.ts:362`, and `libs/frontend/core/src/lib/routing/surface-routes.ts:44`. S:67 names Electron/VS Code launchers and S:68 the HTML generator; launchers open Home without a child-path promise. |
| 3 — Unsupported reload sources | Resolved | S:168 uses terminal `result.agentOutcomes/counts`, matching R:75 and R:106. S:171 omits guidance sections after reload/lost response; R:473 has status/stack only, while R:540 supplies the final summary. S:174 loads a validated analysis filename or selects from saved analyses, separately from unfinished discovery at S:175. Existing reads are implemented in `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts:822` and :858. S:215 limits banner discovery to the latest eligible pair and known local bindings. |
| 4 — Proposal fields conflated with intake/helper output | Resolved | S:131 and S:211 separate folded configuration revisions, intake facts and generated document; S:144 excludes intake facts from team builder. H:25 defines configuration, `libs/shared/src/lib/types/rpc/rpc-harness-proposal.types.ts:7` defines partial revisions, H:518 supplies new-project intake/plugin/toolchain facts, and H:377 supplies helper document output. Retention/absence and config-only diffs are explicit at S:131 and S:141. |

## New blocking defects

1. **§1.2: distinguish the guard's redirect cancellation from an abandoned navigation.** S:37 records a pending redirect, but S:40 says to clear it on `NavigationCancel` and commit only on a subsequent onboarding `NavigationEnd`. Angular emits `NavigationCancel` for the guard's own successful UrlTree redirect, before starting the replacement navigation. Local installed framework evidence: `/home/amun/ptah-extension/node_modules/@angular/router/fesm2022/_router-chunk.mjs:3942` converts the guard result into a redirect error; :4064 emits the cancellation; :4068 requests the redirect. The cancellation codes distinguish `Redirect` from `SupersededByNewNavigation` at :1879. The official [Angular cancellation-code contract](https://angular.dev/api/router/NavigationCancellationCode) confirms that distinction. Implemented literally, this rule loses the marker, never writes `shownAt`, and redirects again when the user selects Skip/Back to chat. That violates once-only automatic entry.

   **Required fix:** retain the pending marker across the guard's own `NavigationCancellationCode.Redirect`, associate it with the replacement onboarding navigation, and commit only on that navigation's successful `NavigationEnd`. Clear it on actual supersession, terminal cancellation/error, or unrelated navigation. Do not commit on an unrelated manual visit to onboarding. This is a frontend event-rule correction; the binding chat-guard ruling, boot navigation and preload remain unchanged.

## Non-blocking suggestions

1. Clarify S:41's storage-write failure wording. A write made on `NavigationEnd` cannot retroactively make the earlier guard return `true`. Specify a storage-availability check before redirect and an in-memory suppression fallback if the later commit fails, so chat remains reachable. Keep the successful-arrival commit intent.
2. The prototype hash bootstrap accepts only `views` (`prototype/index.html:421`, :466), excluding the special `teamproposal` name handled at :425. Accept that alias for direct links/narrow-harness previews; the existing button handler can still demonstrate the mode. This is prototype navigation polish, not an application architecture blocker.
3. Keep §3.6/§4 absence rules authoritative when implementing the shorter A3/A4 descriptions: missing terminal item details yield a summary; a reloaded guidance result does not reconstruct section metadata. Keep completed `fileName` distinct from live checkpoint `filePath` (R:76).

## Lane-proposed rules

The four round-2 rulings and proposal-centric/no-backend-change direction are binding orchestrator decisions, not lane-proposed. The following additional design choices are lane-proposed.

| rule | section | sound? | note |
|---|---|---|---|
| Commit shownAt on successful automatic arrival | 1.2, 10 | Intent yes; mechanics no | Fix the redirect-cancellation distinction above. |
| Versioned timestamps, dismissal/completion triggers, storage fallback | 1.2 | Yes with clarification | Define late write failure as suggested; do not treat shown as completed. |
| Manual menu/Settings re-entry and stable Setup selector | 1.2 | Yes | Preserves access and launcher selector. |
| Lazy child routes, merged focus router, query identity | 1.1, 1.3, 5 | Yes | Retain workflow/workspace validation and session ownership. |
| One-release legacy alias retirement | 1.3 | Yes | Separate future removal from this migration; retain the existing orchestra-canvas alias. |
| Furthest valid step, respecting explicit backward navigation | 10 | Yes | Requires validated analysis/catalog context. |
| Restrained tokens, larger Analyze tile, width cap and breakpoints | 2, 3.1, 8 | Yes | Presentation choices compatible with the three-card requirement. |
| Skeletons, usable launch after status failure, bounded resume banners | 3.1, 4 | Yes | Do not confuse unavailable metadata with no workspace. |
| Heading focus, polite status region, labelled progress and textual states | 2, 8 | Yes | Keep log/proposal outside broad live regions. |
| Vertical stepper, narrow strip, native controls, minimum targets | 2, 8 | Yes | Preserve keyboard access to completed steps. |
| Motion timings, reduced motion, contrast and per-step axe gate | 2, 8 | Yes | Implementation acceptance criteria, not claimed verified here. |
| Phase-count analysis UI and session-local elapsed timer | 3.2, 4 | Yes | Hide unavailable facts; no fabricated percentage or duration. |
| Match formatting, overwrite labels, per-agent cards and collapsed counters | 3.2 | Yes | Use actual returned ranges/outcomes and preview facts. |
| Pause handoff countdown while Details is focused | 3.2, 10 | Yes | Optional frontend refinement; preserve Start now/Skip. |
| Intake validation and Advanced provider picker | 3.3 | Yes | Keeps existing intake capabilities. |
| Latest-message generic composer and modal narrow answer dock | 3.3 | Yes | No question inference; focus trap, inert background and focus return specified. |
| Revision history/tags, folded snapshots and explicit overrides | 3.3, 4 | Yes | Stable internal revision identity avoids partial-payload diffs. |
| Separate Review/Apply; advisory completeness; stale-review banner | 3.3 | Yes | Apply uses the reviewed snapshot and existing eligibility checks. |
| Revision-only and last-applied-revision comparison | 3.3, 3.4 | Yes | Requires no unsupported installed-file baseline. |
| Team intent textarea with optional preset | 3.4 | Yes | Uses the existing seeded workflow. |
| Headless controller, persistent binding/receipt, send reconciliation | 3.5 | Yes | Frontend work; preserves session execution outside a mounted transcript. |
| Same-mode reuse and confirmed cross-mode stop/save/discard | 3.5 | Yes | Uncertain stop must not launch a competing workflow. |
| Lifecycle visuals, recovery screen and limited resume actions | 3.6, 3.7 | Yes | Authoritative state remains the source, with explicit absent-data handling. |
| Component retirement and scoped facade removal | 5, 7 | Yes | Preserve migrated capabilities; exported caller audit remains required. |
| Section-based revision mapping | 11 | Yes | Sufficient for the final re-review. |

## Decisions

- Accept all four binding rulings and their revised source/migration contracts. Do not reopen the boot-owner choice, upgrade eligibility, Home-only launchers, reload omission policy or field-source split.
- Accept committing `shownAt` on arrival in principle. Require the single navigation-event correction above before implementation planning; this is behavior correctness, not polish.
- No new backend API is needed. No new parity/removal blocker was found in the revised contract. Shared-type/host migration remains implementation work, not evidence that current hosts were compiled during this review.
- Visually inspected Ptah browser screenshots of desktop Home and a 360px iframe Home/proposal against the three-card layout, stacked narrow presentation, textual New/Changed tags, step UI and collapsed bottom reply bar. The proposal remained the main pane. Source inspection confirms team mode hides intake-only sections. Cross-frame evaluation was blocked by file-origin security; team-mode interaction, focus trapping, other widths/themes and axe were not verified. No tests, builds or verify ran.
- Tool/skill availability: Ptah workspace and browser tools were available. No native skill discovery/loader was exposed; read `.claude/skills/ui-ux-designer/SKILL.md` and `.claude/skills/angular-frontend-patterns/SKILL.md` directly. Used native targeted reads/rg for source evidence and the installed Angular package after the worktree-local node_modules lookup failed. Only this review file was written; no Git mutations.
