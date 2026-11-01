## Verdict

REVISE — the architecture and first-run redirect are workable, but the batch schedule contains concrete intermediate compile failures, incomplete verification coverage, and an unapproved loss from the kept prompt-enhancement step.

## Blocking defects

1. **B2 consumes a public export that is not supplied until B4a.**

   Plan: File plan, DetailsLog (`implementation-plan.md:518`); B2 (`:670`); B4a (`:722`). DetailsLog's header uses `BuilderSessionSectionComponent`, but `libs/frontend/harness-builder/src/index.ts:1` through `:18` exports no sidebar sections. The plan schedules those exports with B4a (`implementation-plan.md:570`, `:727`), after B2. A cross-library relative import would violate the required public-entry-point boundary.

   **Required fix:** move the required additive component exports into B1 or B2, with explicit ownership, before DetailsLog imports them. Also stage the onboarding services barrel: B1 must export only already-created first-run services; add the focus exports alongside their B5a implementation, rather than exporting nonexistent B5a files from the B1 scaffold (`implementation-plan.md:91`, `:505`, `:647`, `:764`). Audit each batch's imports against what exists at its start.

2. **B5a narrows an interface while its old implementations still compile.**

   Plan: C2 (`implementation-plan.md:283`), Modify (`:559`), B5a/B5b, L8. B5a changes `SurfaceFocusRouter.kind` to `'onboarding' | 'mcp-apps'`. However, `libs/frontend/setup-wizard/src/lib/services/setup-wizard-focus-router.service.ts:6` implements that interface with `kind = 'setup-wizard'` at line 7; `libs/frontend/harness-builder/src/lib/services/harness-builder-focus-router.service.ts:6` does the same with `'harness-builder'` at line 7. Their services/providers/exports are deleted only in B5b (deletion rows 35–37 and 46–48). Removing their registrations in `app.config.ts` does not make these source files type-correct.

   **Required fix:** add `'onboarding'` to the existing union in B5a and remove the two old kinds in B5b, in the same batch that removes their implementations and exports. Alternatively make cut-over and deletion one atomic batch. Preserve compilation of the old libraries throughout.

3. **The harness navigation cut-over has conflicting timing and no B5a file owner.**

   Plan: A6 (`implementation-plan.md:216`), Modify (`:573`), B4a acceptance (`:735`), B4b (`:740`), B5a file list (`:759`). The Modify table assigns `onboardingHarnessTarget` navigation to B4a, while B4a explicitly says the navigation target switches only in B5a. B4b creates the destination pages later. B5a does not list `harness-workflow-request.service.ts` or its spec at all. The real entry path is `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:351`, which currently navigates to `harness-builder` at line 355; backend-open messages delegate to this service (`harness-workflow-message.handler.ts:77`). Following either contradictory instruction can send users to an unimplemented route or leave the service pointing at the deleted surface.

   **Required fix:** B4a changes only execution/session ownership while retaining the old target; B5a explicitly owns the target change and its tests, after B4b. Update the Modify table accordingly. If batching must be strictly file-disjoint, move the whole request-service migration after B4b or assign its staged edits to one serial integration owner.

4. **Per-batch verification lists do not cover the dependent projects, and the commands do not encode their stated target restrictions.**

   Plan: B1–B5b Verify lines (`implementation-plan.md:656`, `:675`, `:692`, `:712`, `:730`, `:746`, `:769`, `:788`). `scripts/verify.mjs:79`–`:85` constructs `nx run-many` for the explicitly listed projects and defaults to `lint,test,typecheck`; it does not expand that list to reverse dependents.

   Concrete omissions:

   - B1 and B5a change `shared` but omit `ptah-tui`, a direct consumer (`apps/ptah-tui/src/components/settings/provider-form.ts:29`). They also omit `ptah-cli` and other shared consumers. B5a additionally changes backend `agent-generation`, used by CLI/TUI/backend host paths.
   - B2, B3a, B3b and B4b omit even `ptah-extension-webview`, which consumes the new library from B1 onward. B4a includes the webview but omits its dependent Electron app (`apps/ptah-electron/project.json:7`, `implicitDependencies`). The reused library entry points are real dependencies of the webview (`apps/ptah-extension-webview/src/app/app.config.ts:90`, `app.routes.ts:9`).
   - B5a changes the focus-router contract without including the old `setup-wizard` and `harness-builder` projects that still implement it, hiding defect 2.
   - B5b's parenthetical “e2e project: lint/typecheck only” is not represented in its single default-target command. Adding TUI to a default command also schedules its test prerequisite `build` (`apps/ptah-tui/project.json:110`–`:120`), contrary to this task's no-build restriction.

   A read-only static import/implicit-dependency traversal found these app dependents: `shared` → `ptah-extension-webview`, `ptah-electron`, `ptah-extension-vscode`, `ptah-tui`, `ptah-cli`, `ptah-video-studio`, `ptah-electron-e2e`, `ptah-extension-vscode-e2e`; `core`, `setup-wizard`, `harness-builder` → webview, Electron, video studio, Electron e2e. This is evidence for correcting the lists, not a claim that runtime tests ran or that this replaces Nx's full inferred graph.

   **Required fix:** specify a per-batch dependent-project matrix, including the renderer and every affected host, and exact target-specific `npm run verify` commands. Separate lint/typecheck-only projects from unit-test runs. Inspect target prerequisites and prevent forbidden build/e2e targets rather than merely adding a parenthetical. Include TUI/CLI for shared/backend changes; do not run workspace-wide checks.

5. **The plan is not file-disjoint and supplies no explicit shared-file ownership schedule.**

   Plan: Batches (`implementation-plan.md:637`). `onboarding.routes.ts` is edited in B1, B3a, B3b and B4b (`:647`, `:689`, `:707`, `:743`); `setup-wizard/src/index.ts` in B3a, B3b and B5b; `app.config.ts`, `initial-navigation.ts`, surface types, and router service in B1 and B5a. The onboarding barrel's focus exports also require a later edit, absent from B5a's file list. These are serial incremental edits, not disjoint lane assignments.

   **Required fix:** state an explicit dependency/order and ownership table. Either assign shared routing/barrels to one serial integration lane, with additive exports/routes delivered before consumers, or partition tasks so concurrent lanes never edit the same files. Serial overlap is acceptable; do not dispatch the current lists as file-disjoint work. Coordinate the fixes in defects 1–3 in that schedule.

6. **D9 makes an unapproved parity reduction and presents a false two-option tradeoff.**

   Plan: Inputs correction 4 (`implementation-plan.md:19`), A5 (`:203`), C6 (`:459`), B3b (`:717`), deletion row 29–30 (`:608`), Decision D9. `context.md` explicitly keeps the legacy enhancement step; the inventory includes its detected-stack/summary capability (`parity-inventory.md`, “Legacy enhancement auto-generate…”). The current component awaits the unbound response and retains `result.summary` (`libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts:305`, `:321`). Under the plan's bound-only rule, `retainGuidanceResult()` has no identified producer of a summary and section counts disappear even without a reload. Marking D9 “needs user confirmation” does not authorize implementing that removal by default.

   The handler evidence is substantively correct but incomplete: `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts:262` delegates to `startBoundGuidance`; its accepted response is at `:624`. The cited `:255`–`:262` alone mainly shows validation/delegation. A bound start returns an acknowledgement, not a final summary.

   There is a missed frontend-only option: after confirmed completion, use the existing `enhancedPrompts:getPromptContent` RPC (`enhanced-prompts-rpc.handlers.ts:914`–`:940`), isolate the generated `## Project-Specific Guidance` region and its canonical section headings, and count actual returned section text using the same whitespace rule as `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:1407`–`:1429`. `buildCombinedPrompt` writes the four section headings at `:1465`–`:1482`; the content RPC prepends the core prompt (`:891`–`:900`), which must be excluded. This can preserve content-derived counts for Project Context, Framework Guidelines, Coding Standards and Architecture Notes while retaining bound ownership/Stop/reload.

   This is **not** a replacement for the complete original summary: the combined prompt omits the optional Quality Guidance section, and cannot recover `totalTokens`, `qualityScore` or `usedFallback` (`rpc-setup.types.ts:516`–`:524`; service `:1434`–`:1446`). Disabled/missing content returns null; counts must not be fabricated or attributed to a stale/different run. Arbitrary headings inside generated markdown also require careful parsing. The approved spec's retained-final-response-only source rule must be explicitly reconciled if content-derived counts are chosen.

   **Required fix:** give A4 a concrete, authorized parity-preserving path before deleting the old component. Retain its awaited legacy path where the full summary is required, or document the frontend content-derived alternative and obtain approval for any remaining summary-field/source-rule change. Do not treat full-summary loss as an approved absence rule. Manual adjust is correctly preserved and is not a blocker.

## Non-blocking suggestions

- Correct stale source line references. In this worktree, restored-route verification is `apps/ptah-extension-webview/src/app/initial-navigation.ts:117`–`:125`, not `:78`–`:89`; the latter is host-surface fallback. The intended plan change is clear, but implementers should edit the actual restored-route comparison.
- The deletion ledger numbers 1–51 cover 48 library files and 3 e2e specs; the prose saying “40 production/spec files” (`implementation-plan.md:621`) is an arithmetic typo. All 51 entries have a named replacement or approved consolidation. The enhancement-summary reduction above is the identified exception to capability preservation, not a missing ledger row.
- D4's choice of `canActivate` is sound, but its explanation overstates the alternative: `canMatch` returning **false** falls through, whereas returning a redirect `UrlTree` also redirects. No need to change the chosen guard.
- Explicitly make handoff arrival rebind an already-started guidance run before considering auto-start. `libs/frontend/setup-wizard/src/lib/services/generation-handoff.store.ts:122` already starts guidance; A4 should not infer that arriving from handoff always means a fresh idle run.
- Clarify the blanket route-query copy rule when crossing agent→guidance ownership: replace `tab/run` with the guidance binding and retain the agent tab as `gen`. A5's binding table and B3b acceptance imply this correctly; the generic “merge” helper must not carry an agent run ID into a guidance lookup.

## Lane-introduced constraints

Rules added by this plan beyond the approved design/user decisions, including implementation choices outside its own L1–L10 list:

| Rule | Plan section | Sound? | Note |
| --- | --- | --- | --- |
| New onboarding feature lib with a routes-only main barrel and eager services entry | A1, D1 | Yes | Real tag/path/lint precedent; eager barrel must remain component-free. |
| No reverse imports from setup-wizard/harness-builder into onboarding; route builders in core | A1/A6 | Yes | Keeps dependency direction acyclic. |
| Headless controller placed in harness-builder | A1/A4, D2 | Yes | Avoids a reverse edge through the existing workflow request service. |
| `canActivate` specifically, rather than `canMatch` | A2/A3, D4 | Yes | Redirect behavior is suitable; rationale caveat above. |
| Storage availability probe and in-memory suppression after a failed write | A3, C3 | Yes | Prevents repeated guard redirects when persistence fails. |
| Strict optional-ISO flag schema; invalid JSON treated as absent | C3, D14 | Yes | Distinguish invalid data from a storage access failure; B1 wording “unreadable” should retain that distinction. |
| Navigation-ID origin/replacement tracker | C3, D5 | Yes | Implements the approved redirect-cancel rule; commit only on matching replacement end. |
| Accept restored chat→onboarding settlement | A3, L3 | Yes | Necessary integration correction without changing boot-plan ownership. |
| Keep legacy IDs wire-legal and map them through a shared alias table | C1, D3 | Yes | Implements approved legacy compatibility with existing types. |
| Treat onboarding as a configuration surface | C2, D6 | Yes | Fits existing menu typing and workspace-independent configuration slots. |
| Place onboarding immediately after chat in route ID ordering | C1, L2 | Yes | Keep route table and registry tests consistent; no functional dependency on that exact position. |
| A2 accepts `tab`, launcher enters A2 and forwards active runs to A3 | A5, D7, L1 | Yes | Preserves workflow identity when launcher does not know run state. |
| `state.explicitBack` suppresses automatic forward navigation | A5 | Yes | Reasonable mechanism for the specified backward-navigation behavior. |
| URL identity restricted to nonempty ≤256 characters without slash/backslash/colon | C2 | Conditional | Appropriate for tab IDs; do not apply blindly to saved filenames or unrelated RPC identifiers without checking their real producer. |
| Two lazy mode-session instances in a root controller; strict persisted record schema | A4, C4 | Yes | Matches the two existing modes; canonical workspace remains part of identity. |
| First-send readiness timeout of 10 seconds, reconcile before retry, per-tab/intake-hash idempotence | A4, B4a | Conditional | Reasonable UI failure policy; an existing SDK session alone must not prove that this particular intake was accepted. |
| View registration only while proposal page mounts; sending independent of it | A4 | Yes | Removes the existing first-turn visibility dependency. |
| Team intent is a visible first message with context-only hidden preamble | C4, D10 | Yes | Matches the real discriminated RPC request. |
| Read-only SessionEmbed mounted only while Details is open; finalized message dock | D8, B2 | Yes | Reuses rendering; analysis correctly keeps its separate AnalysisTranscript mode. |
| Proposal store scoped to a flow route; generated helper document lost on leaving | C6, L4 | Yes | Declared transient behavior; no durable document source is claimed. |
| Restore old revision via existing user snapshot overrides | C6, D12 | Conditional | Must produce the selected folded config, including clearing fields introduced later; no backend revert is invented. |
| Optional apply config input and applied output | C6, L5 | Yes | Lets Apply use the reviewed revision; existing fallback keeps old surface usable. |
| Reuse existing leave dialog and add uncertain-stop state | D11, L6 | Yes | Implementation choice for an already-required behavior. |
| A5 Open chat emits SETUP_WIZARD_COMPLETE | L7 | Yes | Preserves existing VS Code panel behavior. |
| Replace focus-router kinds while leaving wire surfaceKind unchanged | C2, L8 | Conditional | Final contract is sound; timing is blocked by defect 2. |
| Guidance always bound; summary only if retained despite no bound producer | D9 | No | Unapproved parity loss; defect 6. |
| Delete only WizardRpcService.launchWizard, retain RPC and setup-status caller | D13 | Yes | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status.store.ts:117` still calls the RPC. |
| Keep unused-candidate formatter and unsurfaced skill facades | Delete, D13 | Yes | Conservative removal boundary; no unsupported dead-code claim. |
| Old surfaces retained through cut-over; additive batches before deletion | Batches | Conditional | Good objective, but defects 1–5 must be fixed. |
| Author Electron e2e, execute only on explicit request | L9 | Yes | Honors execution restrictions; writing specs is not evidence that the visual/a11y gate passed. |
| Optional provider-connection hint on Home | L10 | Yes, as deferred only | New UI remains a proposal, not authorized implementation. |

## Decisions

- **Library placement passes the structural review.** `tsconfig.base.json:202`–`:206` maps harness-builder and its services entry to separate files; `:230`–`:231` maps setup-wizard. Both existing project files have `scope:webview,type:feature` (`libs/frontend/harness-builder/project.json:7`, `libs/frontend/setup-wizard/project.json:7`). The exact dynamic-import exemption is **`eslint.config.mjs:281`**; its rationale is at `:258`–`:270`. Webview dependency scope is permitted at `:298`–`:299`. Native static-import inspection found core depending on shared, and neither existing feature library importing onboarding or the other feature library. Adding app→onboarding→existing libraries introduces no reverse cycle if the plan's direction is respected. The controller placement is justified: `harness-workflow-message.handler.ts:77`–`:82` resolves the request service from the eager handler, and that service needs the controller. Putting the controller in onboarding would require harness-builder→onboarding while onboarding imports harness-builder.

- **Boot/guard sequencing passes at the plan level.** Fresh Electron boot starts with `initialView` defaulting to chat (`apps/ptah-electron/src/preload.ts:47`). Guard records origin ID, returns UrlTree; Redirect cancellation preserves pending state; replacement start binds its ID; replacement end commits shownAt. The shared navigation promise resolves successfully after that replacement. Restored `/chat` needs the plan's explicit acceptance of onboarding at the actual comparison (`initial-navigation.ts:120`), otherwise the fallback would return to chat after shownAt was set. A SWITCH_VIEW that supersedes origin/replacement before arrival cancels that navigation and clears the pending tracker; initial navigation already avoids fallback while a newer navigation is pending (`initial-navigation.ts:56`, `:110`). An ordinary manual visit has no pending record and does not commit shownAt. A switch after a completed onboarding NavigationEnd is not an interrupted arrival and should not undo the flag.

  Angular source was unavailable under this worktree's `node_modules`; the installed parent workspace source was inspected at `/home/amun/ptah-extension/node_modules/@angular/router/fesm2022/_router-chunk.mjs:4063`–`:4068` (Redirect emits cancellation then RedirectRequest without resolving false), `:4606`–`:4609` (replacement inherits the original promise), `:4032` (NavigationEnd), and `:4045`–`:4047` (superseded cancellation). This is source-level evidence, not a runtime race test.

- **Shared contract shapes are consistent, subject to the migration defects above.** Phase statuses match `libs/shared/src/lib/types/wizard/phase.ts:71`–`:74`; phase totals remain optional. Apply receipt paths/warnings match `rpc-harness.types.ts:328`; intake matches `:490`; context-only team start matches `:533`–`:546`. Proposal revision ID/config/time are real (`rpc-harness-proposal.types.ts:4`), with session ID coming from the enclosing proposal (`:19`), not fabricated from a tab. C5's ordinal is a display derivation. Guidance summary and detected-stack are optional as declared by `rpc-setup.types.ts:528`; optional typing does not authorize removing a kept capability. Existing `ViewType` and accepted aliases support C1's compatibility approach (`webview-surface.types.ts:44`, `:93`, `:103`). No backend protocol addition is necessary. The launcher literal change in the backend-host service is the approved migration exception, not new backend behavior.

- **Deletion/parity accounting:** reviewed all numbered deletion groups 1–51 against the inventory and replacement table. Rows 1–15 map analysis, saved results, recommendations, preview and Manual adjust to A1/A2; 16–28 map bound execution, stop/rebind, outcomes and guidance to A3/A4/stores/Details; 29–32 map enhancement/completion to A4/A5 with defect 6 outstanding; 33–37 map landing cards/focus to tiles/new router; 38–48 map hub/intake, proposal, helpers, drafts, apply, leave and focus to the proposal pages/controller/reused sections; 49–51 map e2e files to new/migrated specs. Manual adjust's coming-soon modal is explicitly retained (`implementation-plan.md:523`, `:696`). Analysis transcript, model pickers, packs, helpers, saved guidance view/download/toggle, apply paths/warnings/health refresh and host completion message all have named owners. The next deletion batch still must perform the specified reference audit; this review is not a claim that nonexistent replacement files compile.

- **Review limits and tooling:** no application files changed, no Git mutation, tests, verification, builds, UI rendering or screenshots performed. There is no new rendered UI to assess in this plan-only task. No CLI-native skill discovery/invocation interface was exposed; I read `.claude/skills/nx-workspace-architect/SKILL.md` and its module-boundaries reference directly and applied the repository's real lint rules where the generic guidance differed. Ptah workspace/AST/dependent tools were consulted; the dependency index initially reported building, so native targeted `rg`, line reads and a read-only static import/project traversal supplied evidence. Full Nx inferred-graph completeness and actual per-batch compilation remain unverified. The only file written is this deliverable.
