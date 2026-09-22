# Code Logic Review — TASK_2026_524_1125

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 4              |
| Moderate issues     | 2              |
| Failure modes found | 6              |

Scope: batch 1, as specified in context.md:234 and context.md:250. The files and navigation paths named in the invocation were reviewed from the working tree. No Git operations were performed: the reviewer-role instructions prohibit them, including the requested diff/status commands. Consequently, this report does not independently establish the complete changed/untracked file set or which pre-existing lines differ from origin/main.

The score reflects working ordinary navigation and host isolation alongside four concrete surface-navigation failures. It is below the sound/minor-improvements band because ordinary close/reopen and workflow-resume paths are affected; it is above the significant foundational-failure band because the route/provider wiring, validated host dispatch, and integer history traversal function in the checks described below.

## Findings

1. **CONFIRMED — Serious, category 3: saving the outgoing surface overwrites another workspace's memory and resurrects closed-workspace state.** libs/frontend/core/src/lib/services/app-state.service.ts:567 unconditionally records the globally settled view, even when the active workspace changed before its navigation landed or its slice was explicitly deleted. Rapid A→B→A makes B remember A's view; closing active A and switching to B recreates A's removed entry, so reopening A restores its old surface.
2. **CONFIRMED — Serious, category 2: the delayed auth redirect cancels a newer user navigation.** libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:297 tests the settled surface, which remains chat while a lazy route loads. If auth completes without credentials during that load, line 299 navigates to Settings and supersedes the user's selection.
3. **CONFIRMED — Serious, category 2: requesting the already-open harness builder produces a false failure alert.** libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:117 treats every false result as a failed open, although Angular resolves an ignored same-URL navigation as false. A duplicate/resume workflow request while the builder is displayed raises “could not be opened.”
4. **CONFIRMED — Serious, category 5, retained scope gap: the host's old allow-list still breaks an existing panel command.** apps/ptah-extension-vscode/src/services/webview-html-generator.ts:115 rejects orchestra-canvas, used by apps/ptah-extension-vscode/src/core/ptah-extension.ts:143. The public generator catches the exception at line 85 and substitutes fallback HTML, losing the requested initial view. This is retained behavior, not an established new regression.
5. **CONFIRMED — Moderate, category 6: matrix parameters make the surface signal disagree with the activated route.** libs/frontend/core/src/lib/routing/surface-routes.ts:89 interprets /settings;panel=auth as an unknown surface and reports chat, while Angular matches the settings route. The outlet wrapper is then hidden despite Settings being activated.
6. **CONFIRMED — Moderate, category 1: a fractional or NaN history offset corrupts the history cursor.** libs/frontend/core/src/lib/routing/memory-platform-location.ts:168 checks bounds but not integer validity. historyGo(-0.5) from cursor 2 assigns cursor 1.5 and throws while reading the target state; subsequent href reads also throw. No current production caller supplying such an offset was located.

All six findings are CONFIRMED by source tracing; findings 1, 3, 5 and 6 also have direct runtime reproductions. Finding 2 has a controlled delayed-route reproduction of the auth callback's condition. No PLAUSIBLE item is promoted to a confirmed finding.

## Five logic questions

### 1. How does this fail silently?

Workspace view memory is rewritten using another workspace's settled surface, without warning (app-state.service.ts:567). Closed state is similarly recreated by updateActiveViewSlice's default-and-set behavior (app-state.service.ts:528). The host generator converts an invalid initialView exception into a returned fallback document (webview-html-generator.ts:85), so its caller can report a successfully opened panel despite the requested view being lost.

### 2. What user action produces unexpected behaviour?

Close and reopen the active workspace, rapidly switch workspaces before route settlement, select a lazy surface while initial authentication is pending, or resume an already-visible harness workflow. Evidence and exact sequences are in findings 1–3. The existing Open Orchestra Canvas command supplies a value absent from the host allow-list (ptah-extension.ts:143; webview-html-generator.ts:106).

### 3. What input data produces a wrong answer?

A valid Angular URL containing matrix parameters, such as /settings;panel=auth, produces currentView() === chat (surface-routes.ts:90). Fractional/NaN offsets invalidate the history cursor rather than leaving a valid entry (memory-platform-location.ts:168). Unknown SWITCH_VIEW names cannot reach either URL path because the receiver validates exact string membership (app-state.service.ts:243).

### 4. What happens when a dependency fails?

SurfaceRouterService catches rejected navigations, logs, and resolves false (surface-router.service.ts:68). The settled surface does not change because it follows NavigationEnd only (surface-router.service.ts:40).

Workspace switching has already changed its active key before discarding this result (app-state.service.ts:569, :593); if a restore navigation fails, the new workspace remains active with the previous surface and no corrective branch. A subsequent switch can save that surface into the wrong slice, the same ownership defect as finding 1. No natural packaged-host constructor/chunk failure during workspace restoration was reproduced.

Initial navigation also logs false and returns normally (apps/ptah-extension-webview/src/app/app.ts:139), after which ngOnInit marks the app ready at line 93. Conversely, the workflow handler displays an error for false even when it means “already there” (finding 3).

### 5. What is missing that the requirements never mentioned?

Settled route ownership must remain associated with a workspace while a different workspace's navigation is pending; closing a workspace must invalidate subsequent writes to its removed slice (app-state.service.ts:350, :567, :604). “Navigation returned false” needs a distinction between already-at-destination and failure (surface-router.service.ts:69). Surface parsing needs to agree with Angular's URL grammar (surface-routes.ts:89). These are behavioral contracts, not proposals to change the fixed batch structure or CSS retention pattern.

## Failure modes

### F1. Workspace surface saved under the wrong identity

- Trigger: Seed A=settings and B=analytics; return to A; call switchWorkspace(B), then switchWorkspace(A) before B's navigation settles; later visit B. Alternatively, close active A while on analytics, remove its state, switch to B, and reopen A.
- Symptom: The first sequence restores B to settings instead of analytics. The second restores reopened A to analytics instead of the default chat.
- Evidence: libs/frontend/core/src/lib/services/app-state.service.ts:567, :569, :593, :604; updateActiveViewSlice at :525. The real close flow calls cleanup before switching at libs/frontend/core/src/lib/services/electron-layout.service.ts:371 and :374; the coordinator removes the slice at libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:290.
- Current handling: The synchronous stamp always writes currentView() to the current active key. Deleting a slice does not clear that key, and updateActiveViewSlice recreates missing slices. The constructor effect likewise reads whichever workspace is active when it runs, without tracking which workspace initiated the settled navigation.
- Recommendation: Associate settlement/stamping with the workspace and navigation generation that owns it; do not stamp a workspace whose restore has not settled, and invalidate writes for a removed workspace.
- Runtime evidence: Real AppStateManager and Angular Router printed “B ... expected analytics; actual settings” and “closed A ... expected chat; actual analytics.” The direct rapid-switch reproduction establishes the service defect; Electron's 100 ms click debounce at electron-layout.service.ts:432 can reduce its UI frequency, but does not fix the close/reopen path.

### F2. Authentication completion overrides an in-flight user selection

- Trigger: Start on chat with loadAuthStatus pending; click Thoth before its first lazy import completes; auth resolves successfully with no configured credentials before the import settles.
- Symptom: The user lands on Settings; the requested Thoth navigation is canceled.
- Evidence: libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:293, :297, :299, :336; libs/frontend/core/src/lib/routing/surface-router.service.ts:40; apps/ptah-extension-webview/src/app/app.routes.ts:90.
- Current handling: The post-auth guard reads the previously settled chat surface, not whether a newer navigation has started.
- Recommendation: Suppress the startup redirect when a newer user navigation is pending or has superseded the auth check. Preserve the Router as the surface owner.
- Runtime evidence: With a controlled unresolved Thoth loader, Router.currentNavigation targeted /thoth while currentView() was chat. Applying the callback's condition navigated to settings; the Thoth request resolved false. This used the real routing/state services, not a rendered AppShell fixture.

### F3. Same-URL navigation is mistaken for failure

- Trigger: Receive HARNESS_OPEN_WORKFLOW for an already-active workflow of the same mode while /harness-builder is displayed.
- Symptom: The resume path displays “The harness builder could not be opened” despite the builder already being open.
- Evidence: libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:52, :60, :115, :117, :121; libs/frontend/core/src/lib/routing/surface-router.service.ts:69; node_modules/@angular/router/fesm2022/_router-chunk.mjs:3838 and :3841.
- Current handling: Angular's default same-URL policy ignores the navigation and resolves false; the wrapper forwards that value unchanged. HarnessWorkflowService.setError writes the displayed error at libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts:245; the template consumes it at libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:242.
- Recommendation: Treat an already-settled requested destination as a successful open, while distinguishing genuinely canceled or failed navigations.
- Runtime evidence: Two awaited navigateToSurface('harness-builder') calls returned true then false under the production Router options.

### F4. Retained host allow-list routes a valid panel request into broken fallback handling

- Trigger: Invoke ptah.openOrchestraCanvas, or call createPanel with initialView tasks, tribunal, marketplace, thoth, setup-hub or harness-builder.
- Symptom: Normal Angular HTML generation is skipped. The returned fallback loses the initial view; its root is app-root rather than the ptah-root selector used by the app.
- Evidence: apps/ptah-extension-vscode/src/core/ptah-extension.ts:143; apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts:160; apps/ptah-extension-vscode/src/services/webview-html-generator.ts:106, :115, :85, :320, :324; apps/ptah-extension-webview/src/app/app.ts:29.
- Current handling: _getHtmlForWebview throws at line 116, but generateAngularWebviewContent catches it and returns generateFallbackHtml. The integration-script markup that would carry initialView is commented out in that fallback, and the call at line 324 does not pass initialView anyway. Thus the author's statement that the generator “throws” needs this qualification: the internal method throws; the public boundary normally returns fallback HTML.
- Recommendation: Complete the specified host-side allow-list consolidation using a contract that the Node host can consume without importing the Angular library; preserve normalization of the legacy canvas alias.
- Scope distinction: The implementation note explicitly says this host file was left unchanged. This is an outstanding batch-1 requirement at context.md:237 and :307, not a demonstrated regression introduced by the new router. The two deleted ids survive as allow-list entries at lines 108/110; no remaining production caller emitting those two view strings was found. The command-builder.types imports are filenames/types, not navigation producers.

### F5. Router URL and visibility disagree for matrix parameters

- Trigger: Router.navigateByUrl('/settings;panel=auth').
- Symptom: Router.url is /settings;panel=auth and the activated route path is settings, but currentView() is chat. The settings outlet is hidden and the chat chrome is shown.
- Evidence: libs/frontend/core/src/lib/routing/surface-routes.ts:89; libs/frontend/core/src/lib/routing/surface-router.service.ts:47; apps/ptah-extension-webview/src/app/app.routes.ts:70; libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:156; libs/frontend/chat/src/lib/components/templates/app-shell.component.html:41.
- Current handling: The parser removes query and fragment delimiters but compares the remaining settings;panel=auth string directly against the id list. Angular instead recognizes a settings UrlSegment with a matrix parameter.
- Recommendation: Read the primary UrlSegment path through Angular URL parsing, or derive the id from the matched route.
- Runtime evidence: “matrix URL /settings;panel=auth matched settings surface chat.”
- Reachability limit: Current menu and SWITCH_VIEW entry points emit bare validated ids, so they do not generate this URL. This is a router/API edge case, not a demonstrated hostile-host validation bypass.

### F6. Invalid numeric offset leaves the memory history unusable

- Trigger: Push /settings and /chat, then call historyGo(-0.5). NaN also bypasses every comparison.
- Symptom: Reading to.state throws immediately; subsequent href/path/state reads throw because the cursor no longer indexes an entry.
- Evidence: libs/frontend/core/src/lib/routing/memory-platform-location.ts:143, :160, :168, :172, :175.
- Current handling: Only bounds and equality are checked before cursor assignment.
- Recommendation: Validate/normalize the delta to a finite integer before assigning the cursor; reject unsupported offsets without mutating state.
- Runtime evidence: “Cannot read properties of undefined (reading 'state')”, followed by “Cannot read properties of undefined (reading 'url')”.
- Reachability limit: No current app caller providing fractional/NaN offsets was found. Ordinary Router traversal uses integer offsets.

## Blocking issues

None demonstrated within this review's scope. Findings concern navigation, transient history integrity and surface memory; no persisted user-content loss or security-boundary bypass was established.

## Serious issues

- F1 — app-state.service.ts:567. Users lose per-workspace navigation memory and closed-workspace cleanup is undone. Fix workspace ownership/invalidation of surface stamps.
- F2 — app-shell.component.ts:297. A delayed auth response cancels an explicit newer navigation. Guard against navigation intent superseding the auth check.
- F3 — harness-workflow-message.handler.ts:117. Resuming an already-open workflow raises a false failure alert. Distinguish same-destination skips.
- F4 — webview-html-generator.ts:115. An existing canvas command enters fallback HTML instead of its requested launch surface. Complete the host validation portion of batch 1.

## Moderate and minor issues

- F5 — surface-routes.ts:89. Matrix-parameter URLs create disagreement between the route and the visible surface.
- F6 — memory-platform-location.ts:168. Non-integer/NaN traversal poisons the cursor.
- No style or test-preference findings are included.

## Data flow

1. Host focusChat broadcasts SWITCH_VIEW with view chat — OK, apps/ptah-electron/src/services/platform/electron-platform-commands.ts:72.
2. The message router dispatches to registered handlers — OK, message-router.service.ts:125 and :242; app.config.ts:164 registers AppStateManager.
3. Exact id validation and canvas-alias normalization — OK, app-state.service.ts:243 and :361. Invalid names remain on the existing surface.
4. SurfaceRouterService converts the id to an absolute URL and awaits Router navigation — OK for ordinary navigation; F3 concerns result interpretation at surface-router.service.ts:69.
5. Routes resolve eager/lazy components — ids match surface-routes.ts:53 and app.routes.ts:57. Unknown paths redirect to chat at app.routes.ts:117.
6. Angular Location writes through the overridden PlatformLocation — OK, app.config.ts:144; memory-platform-location.ts:119 and :125 keep writes in memory.
7. NavigationEnd becomes currentView and controls the retained shell — F5 parser gap at surface-routes.ts:89; outlet and retained content remain separate at app-shell.component.html:43 and :600.
8. Settled views are saved for workspace restoration — F1 ownership gap at app-state.service.ts:350 and :567; F2 is a stale-view consumer at app-shell.component.ts:297.

## Requirements fulfilment

| Requirement                                              | Status                                  | Gap                                                             |
| -------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| In-memory PlatformLocation; no direct History API calls  | COMPLETE for reviewed source            | Live-host validation not performed; F6 numeric edge             |
| Disabled automatic initial navigation, host-seeded route | COMPLETE for normal initial navigation  | Failed initial navigation only warns, app.ts:139                |
| One surface id contract, deleted obsolete ids            | PARTIAL                                 | Host allow-list retained; F4                                    |
| Preserve SWITCH_VIEW and reject unknown ids              | COMPLETE in checked path                | No new defect found in category 4                               |
| Replace lazy-view tokens with route loading              | COMPLETE structurally                   | Real packaged chunks not executed here                          |
| Per-workspace surface restoration and removal            | PARTIAL                                 | F1                                                              |
| Chat/canvas stay outside outlet and mounted              | COMPLETE structurally                   | Browser/store lifetime not exercised here                       |
| Back/forward within one session                          | COMPLETE for checked normal traversal   | F6 is outside normal integer traversal                          |
| Persistence, serializer, activity contract, route reuse  | MISSING from this batch by design       | Explicitly deferred by context.md:240 and :246                  |
| All touched-project verification passes                  | PARTIAL / not independently established | No complete diff or full-suite rerun; diagnostic evidence below |

Implicit requirements not addressed: workspace identity during navigation settlement, same-URL result semantics, and URL parser agreement (F1/F3/F5).

## Edge cases

| Case                                              | Handled                  | How                                                                 | Concern                                                                             |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Push after back                                   | YES                      | splice(cursor + 1), memory-platform-location.ts:120                 | Forward history discarded                                                           |
| Pop payload and destination state                 | YES                      | type/state payload, memory-platform-location.ts:175                 | Matches Angular LocationChangeEvent; actual DOM PopStateEvent instance not required |
| historyGo(0)                                      | YES                      | Same-cursor no-op, memory-platform-location.ts:168                  | Agrees with Angular Location documentation, _common_module-chunk.d.ts:264           |
| Integer out-of-range history move                 | YES                      | Ignored at memory-platform-location.ts:168                          | Not clamped                                                                         |
| Base href and ordinary URL parts                  | YES                      | Base / at :79, splitUrl at :21                                      | Location strips base's trailing slash, _location-chunk.mjs:242                      |
| Missing pathname setter                           | YES for Angular contract | Abstract API declares getter only, _platform_location-chunk.d.ts:47 | No production assignment located; not a defect finding                              |
| Unknown/hostile host view id                      | YES                      | app-state.service.ts:243                                            | Exact id membership blocks URL injection                                            |
| Unknown router URL                                | YES                      | app.routes.ts:117                                                   | Reproduction landed /chat                                                           |
| Same destination                                  | NO at workflow consumer  | Angular legitimately skips                                          | F3                                                                                  |
| Rapid workspace switch / active workspace removal | NO                       | Unconditional global-surface stamp                                  | F1                                                                                  |
| Matrix parameter on known route                   | NO                       | Manual segment parsing                                              | F5                                                                                  |
| Fractional/NaN history move                       | NO                       | Invalid cursor accepted                                             | F6                                                                                  |

## Categories with no findings

- **4 — SWITCH_VIEW:** No defect found in the navigation/validation path. Direct receiver checks rejected ../settings, https://evil.test, settings;panel=auth, the two removed ids, a number and null; settings landed on /settings. The message registration/dispatch path was traced through app.config.ts:164 and message-router.service.ts:242. A full host process was not run.
- **7 — Lazy-library boundaries:** No defect found. There are six lazy route entries over five libraries; harness-builder/setup-hub intentionally share one module (app.routes.ts:78 and :85). Production static consumers use narrow /services or marketplace/harness entry points; all four are explicitly exempted at eslint.config.mjs:248. No forbidden bare static import of the five lazy surface libraries was found in the production TypeScript scan.

Categories 1, 2, 3, 5 and 6 have findings above. Separately, the ten route ids agree with the ten route entries, and the component-less chat route is correct for the always-mounted chat/canvas structure (app.routes.ts:62; app-shell.component.html:600).

## Verification and what I could not check

- Read in full: the three routing implementation files, app.routes.ts, AppStateManager, app.ts, app.config.ts, AppShellComponent and its template, HarnessWorkflowMessageHandler, the routing testing provider, SurfaceRouterService specs and webview-routing specs. Read relevant host/coordinator/auth/ESLint paths and installed Angular PlatformLocation, Location and Router implementation sections. No source was edited.
- Independent runtime checks ran the actual routing/state source bundled in memory with esbuild write:false, Angular 22 TestBed and jsdom. The shared boundary was stubbed only for MESSAGE_TYPES.SWITCH_VIEW and unused SessionId parsing; surface and workspace implementations were unmodified. The test Router used the repository's component-less testing routes. The harness-result test exercised the real router result; its alert consequence was traced in the handler.
- The controlled auth race held a loadComponent promise and applied the exact post-auth view condition. It did not instantiate the full shell or real auth RPC service.
- Normal history truncation, pop payload/state, base URL parts, zero/out-of-range moves, valid host navigation, invalid host ids, wildcard redirect, workspace races/removal, same-URL navigation, matrix parsing and fractional traversal were checked independently of the author's test run.
- ptah_get_diagnostics initially reported a 45-second timeout. A later completed response reported 100 errors, including base-content-muted.spec.ts:109, monaco-loader.service.ts:112 and numerous mock/spec typing errors. These are not classified as regressions: no baseline comparison was possible, and this provider's results are not equivalent evidence to the author's Nx target run.
- The reviewer-role prohibition on Git prevented git diff origin/main and git status --porcelain. The invocation and implementation note supplied the file scope; deleted files and the complete uncommitted delta were not independently audited.
- No live VS Code/Electron rendering, Playwright run, full Nx suite, production bundle comparison, packaged lazy-import failure, or complete canvas lifetime test was performed. Outlet overflow, actual cold-load latency and real host SecurityError behavior remain unmeasured.
- The task folder contained task.md, context.md and the author's implementation note, but no task-description.md, implementation-plan.md, batches.md or existing code-style-review.md at discovery.
- The higher-priority reviewer output contract requires code-logic-review.md and forbids filenames outside its recognized deliverables. Therefore the requested code-review-codex.md was not created; this is the only review file written.

## Verdict

**ship after fixes** — ordinary routing and the memory-backed location work in the checked paths, but workspace restoration, auth completion and same-URL workflow navigation have confirmed behavioral defects. Fix those and resolve the retained host validation gap before treating batch 1 as complete.

- Recommendation: REVISE
- Confidence: HIGH for the reproduced service defects; MEDIUM for packaged-host behavior and complete change coverage.
- Top risk: surface settlement is associated with whichever workspace is active when a write runs, rather than the workspace that owns that navigation.
- What a robust implementation would add: workspace/generation-aware stamping and removal invalidation; auth redirect supersession checks; explicit same-destination success semantics; unified host id validation; Angular-consistent URL parsing; numeric history-offset validation.
