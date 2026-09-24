# PR 586 documentation fixes — TASK_2026_540_0940

Date: 2026-09-24. Worktree branch `feat-task-540-global-config-menu`. Files edited: `batches.md` and `implementation-plan.md` (this folder). No other file touched; nothing committed, pushed or stashed. Line numbers below are the pre-edit line numbers from the findings; the Decision 2 replacements are shorter, so content after line ~322 sits ~25 lines higher in the edited file.

## Finding 1 — batches.md lines 38-40 (sequential vs parallel contradiction)

**Was:** "Batches run one at a time, in order … Every batch depends on the one before it" — contradicted by lines 20-30, which allow Batches 2-3 to start together and Batches 6-7 to run as two parallel lanes.

**Now (lines 38-43):** sequential one-at-a-time, in-order execution is stated as the DEFAULT (each batch committed on its own after both verdicts, each depending on the one before it: core exports → remount API → menu component → shell `data-test` hooks/labels → e2e helper), and the two permitted parallel exceptions are listed explicitly with their recorded conditions: Batches 2 and 3 started together before Batch 1's commit (both depend only on Batch 1's verified exports; commits stay in batch order), and Batches 6 and 7 may run as two parallel `codex` lanes (disjoint file lists; commits in order: Batch 6, then Batch 7). Wording mirrors the existing entries ("Batches 2 and 3", "Batches 6 and 7", "commits stay in order").

## Finding 2 — implementation-plan.md line 88 (MD056: table row split by unescaped pipes)

**Was:** the evidence-table row for Setup hub contained `` `setCurrentView('setup-wizard' | 'harness-builder' | 'tribunal')` `` — the three `|` characters split the row into 5 cells where the table has 3 columns.

**Now:** each pipe is escaped inside the backticks as `\|` (`` `setCurrentView('setup-wizard' \| 'harness-builder' \| 'tribunal')` ``), giving exactly 3 cells. Every other table row in the file was checked: the only other pipe-in-backticks occurrence (`Extract<… 'thoth' | 'setup-hub' | …>` at line 110) is inside a fenced code block, where pipes are literal — no other row is affected.

## Finding 3 — stale keyed-host / unconditional-focus / "cannot fail" passages

The binding "Revision 3 overrides" block (lines 3-36) was left untouched, as was the Revision log (lines 552-566, kept as the historical record of revision 2). Every body passage that still described the superseded keyed `@for` remount, the unconditional `queueMicrotask` focus, or claimed the remount "cannot fail" was updated to what shipped, verified by reading the code first:

- `libs/frontend/core/src/lib/routing/surface-router.service.ts:165-173` — `remountActiveSurface()`: reads `ChildrenOutletContexts.getContext(PRIMARY_OUTLET)`; early return when `!ctx?.outlet?.isActivated || !ctx.route`; captures `route`/`injector` BEFORE `ctx.outlet.deactivate()`; then `ctx.outlet.activateWith(route, injector)`; no error handling in the method.
- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:331-353` — the effect: `lastHandledTick` captured at construction; reacts only to a tick change; skips `0`; inside `untracked` returns while `pendingSurface() !== null` (this tick's remount is skipped, not deferred); records `document.activeElement` and `host.contains(active)` before the remount; calls `remountActiveSurface()`; `afterNextRender` re-reads the host and focuses it ONLY when the pre-remount focus was `document.body`, disconnected, or inside the host. Host markup (`:241-248`): `#configurationSurfaceHost`, `data-test="configuration-surface-host"`, `tabindex="-1"`, `outline-none`, un-keyed `ptah-app-shell`.
- `libs/frontend/core/src/lib/services/app-state.service.ts` — no `recordSettledView`, no `updateConfigurationSurfaceSlot` (grep: zero hits); typed `ConfigurationSurfaceSlots` at `:83`; constructor-effect write of `openSurface` first and unconditionally (with the unchanged-value skip) at `:484-492`; `configurationSurfaceRemountTick` at `:604-605`.

Lines changed in implementation-plan.md:

| Pre-edit line | Section | New text (summary) |
| --- | --- | --- |
| 43 | Summary item 2 | "keyed remount" → `SurfaceRouterService.remountActiveSurface()` outlet deactivate + re-activate at the same URL (Revision 3 override 1). |
| 86 | Evidence table | "The keyed remount host wraps :264" → the focus-effect host wraps `:264`; the remount effect joins the existing constructor effect. |
| 88 | Evidence table | Finding 2 pipe escapes (above). |
| 258-264 | Decision 1, `_configurationSurfaceRemountTick` JSDoc | "The Electron shell keys its `<ptah-app-shell>` host on this value…" → the shell's effect on this value calls `remountActiveSurface()`, which deactivates and re-activates the primary outlet's stored route — only the routed component is re-created, same URL, no navigation; "the key never changes" → "no remount is triggered". |
| 273 | Decision 1, "What the user sees" | "(Decision 2's keyed remount)" → "(Decision 2's outlet remount, Revision 3 override 1)". |
| 288 | Decision 2 heading | "the keyed remount" → "the surface remount". |
| 316 | Decision 2 item 2 (first folder) | "(inside the keyed host below)" → "(in the center-panel host below)"; the harmless-tick-bump clause now describes at most one extra outlet re-activation (churn, not breakage — risk RB). |
| 322-338 | Decision 2 item 5 | The keyed `@for` host block replaced by a short paragraph marked "superseded by Revision 3 overrides, override 1": un-keyed `ptah-app-shell` in the `tabindex="-1"` `outline-none` host; the tick effect (`lastHandledTick`, skip `0`, skip-not-defer while `pendingSurface()` non-null); `remountActiveSurface()`'s capture-before-deactivate + `activateWith` (new routed-component instance, same URL, child contexts retained, component-less no-op); CanvasStore-survival / auth-redirect-not-re-armed rationale. The old "remount also destroys the canvas tiles" bullet — inverted under the shipped mechanism — replaced by the re-reads-workspace-state fact. |
| 340-358 | Decision 2 item 6 | The `queueMicrotask` unconditional-focus code block replaced by a short paragraph marked "superseded by Revision 3 overrides, override 3": focus is conditional — pre-remount `document.activeElement` recorded, host re-read and focused in `afterNextRender` only when that focus was `document.body`, disconnected, or inside the host. |
| 360 | Decision 2, rejected alternatives | Header now notes the list evaluated the keyed-host design that override 1 then replaced with the outlet remount. |
| 367 | Decision 2, rationale | "The keyed remount is Angular-native…" → "The outlet remount is Router-native (public `RouterOutlet` API)…". |
| 439 | Component 3, purpose | "the keyed remount host and focus effect" → "the remount effect and conditional post-remount focus". |
| 440 | Component 3, responsibilities | "keyed remount host, focus effect" → the remount effect (`remountActiveSurface()` on a tick change, with conditional post-remount focus), per Decision 2 items 5-6 as superseded by overrides 1 and 3. |
| 442 | Component 3, failure behaviour | "A remount cannot 'fail': the keyed block is pure template semantics…" → a remount CAN fail: the re-created component's constructor or `ngOnInit` can throw; the method does not catch it and the shell's effect adds no handler, so the error propagates out of the effect and surfaces through Angular's `ErrorHandler`, like any route activation. |
| 457-458 | Data flow items 4-5 | "the keyed remount host" → the remount effect; step 5 now reads: stay-branch → tick bump → effect skips while `pendingSurface()` is non-null, otherwise calls `remountActiveSurface()` → outlet deactivate + `activateWith` (new routed-component instance, same URL, child contexts retained) → conditional after-next-render focus. |
| 465 | Failure behaviour (switch-while-open) | "the keyed remount re-creates the surface … the remount itself cannot fail" → `remountActiveSurface()` re-creates the surface; it is not guaranteed error-free — constructor/`ngOnInit` can throw, uncaught, surfacing through Angular's `ErrorHandler` like any route activation. |
| 485 | Test plan, config-gate spec | "a tick change re-creates `ptah-app-shell` … focus lands on the host" → the shipped cases: exactly one (stubbed) `remountActiveSurface()` call per bump, never at tick `0`, on a repeat value, or from a construction-time non-zero tick; a bump while `pendingSurface()` is non-null skips (not defers); focus conditional on the three pre-remount conditions. |
| 508 | TASK_2026_533 handoff, item 3 | "`ElectronShellComponent` keys its `ptah-app-shell` host on the remount tick…" → the effect on the remount tick calls `remountActiveSurface()` (override 1; skipped while `pendingSurface()` is non-null), which captures the outlet's stored `route`/`injector`, deactivates and calls `activateWith` — only the routed component is re-created, child outlets re-activate from retained contexts, child-route URL preserved. |
| 510 | TASK_2026_524 note | "it works through keyed block destruction plus the Router's own outlet re-activation" → it works through the Router's own outlet re-activation (`remountActiveSurface()`, override 1) — no keyed blocks. |
| 550 | Criterion 21 coverage row | "keyed `@for` remount instead" → "outlet remount via `SurfaceRouterService.remountActiveSurface()` instead". |

TASK_2026_533 handoff items 1, 2, 4 and the extension-points intro (pre-edit lines 504-507, 509) already matched the shipped code — no `recordSettledView`, no `updateConfigurationSurfaceSlot`, constructor-effect write of `openSurface`, typed `ConfigurationSurfaceSlots`, `setCurrentView` byte-identical — and were left unchanged.

## Verification

- `npx -y markdownlint-cli2 .ptah/specs/TASK_2026_540_0940/implementation-plan.md .ptah/specs/TASK_2026_540_0940/batches.md` — ran successfully (markdownlint-cli2 v0.23.3 / markdownlint v0.41.1, downloaded by npx on demand). **MD056 (table column count): 0 findings in both files** — the line-88 row was the only MD056 and is fixed. The run reports 157 other issues, all pre-existing style findings untouched by this change (MD007 list indentation, MD013 line length > 450, MD029 ordered-list prefix, MD040 missing code-fence language, MD047 trailing newline); these rules were already violated throughout both long-form spec docs and were out of scope.
- `git diff --stat` (both files): `batches.md` 9 lines changed; `implementation-plan.md` 84 lines changed — 34 insertions(+), 59 deletions(-) total across the two files (net −25: the replaced keyed-host and focus code blocks were longer than the short correct paragraphs).
