## Frontend implementation — `TASK_2026_701_9e4b`, batch 23

**Tasks completed**: 23.1 (feed-driven refresh, empty Agents copy, model-editor help, plugin-settings pointer)

**Files** (under `libs/frontend/skill-synthesis-ui/src/lib/`):

- MODIFIED `services/skill-clones-state.service.ts`: subscribes to `LibraryChangeFeed`. Each list request gets an epoch. Records the last list `scopeRoot`. Adds the `libraryNotice` signal ("Library updated" / C10), `clearLibraryNotice()`, `libraryUpdatedCopy()` and `LIBRARY_REFRESH_FAILED_COPY`.
- MODIFIED `services/skill-clones-state.service.spec.ts`: adds the `library:changed feed (8.2b, B13)` block (13 cases) and a `libraryUpdatedCopy` case. Mocks now return `{ clones, scopeRoot }`.
- MODIFIED `components/clones/skill-clones-view.component.ts`: new empty Agents copy and "Open setup wizard". Adds the D14 plugin-settings pointer, the feed line, and a list + catalog re-read on workspace switch. Opening a card clears the line.
- MODIFIED `components/clones/skill-clones-view.component.spec.ts`: stubs for `PluginCatalogService` and `AppStateManager`, plus a new `Library alignment (F6)` describe block (13 cases).
- MODIFIED `components/clones/agent-model-editor.component.ts`: Claude-row help, `CLAUDE_MODEL_HELP_COPY`, and `aria-describedby` on the input.
- MODIFIED `components/clones/agent-model-editor.component.spec.ts`: 2 cases.
- MODIFIED `services/skill-synthesis-rpc.service.ts` (**outside the batch file list**, see Plan deviations): `listClones()` now returns `SkillSynthesisListClonesResult` (`{ clones, scopeRoot? }`).
- MODIFIED `services/skill-clones-state.perf.spec.ts` (**outside the batch file list**): mock shape updated and a `LibraryChangeFeed` stub added.

## Quality requirements -> evidence

| Requirement | Evidence |
| --- | --- |
| Refresh on every feed signal | `skill-clones-state.service.ts` constructor effect on `feed.latest()` calls `onLibraryChanged` → `reloadList()`. The feed stamps `at`, so two identical pushes both refresh. Spec: "refreshes on every push, including two identical ones" |
| Request epoch, stale reply dropped | `listEpoch` is bumped per request in `reloadList()`. List, `error` and `loading` are applied only when `epoch === this.listEpoch`. `loadScorecards` / `loadAgentOutcomeSignals` take the epoch and drop stale replies. Specs: "drops an out-of-order list reply", "keeps loading on while a newer request is still in flight", "drops the failure of a superseded request", "drops a scorecard reply from a superseded list request" |
| Toast only from the current list's added clones | `onLibraryChanged` diffs the applied reply against the list on screen when the reply landed. It counts only agents, by `kind:slug`. The origin comes from the added clones' `provenance` (`libraryUpdatedCopy`), not from the push's `reasons`. If there is no earlier list for the same root (`previous === null`), nothing is claimed. Specs: "says what the CURRENT list gained…", "says nothing when the current list gained no agents", "claims no added agents across a harness-root change", `libraryUpdatedCopy` |
| C10 notice only when `workspaceRoot === last scopeRoot` | `onLibraryChanged`, `failed` branch: `lastScopeRoot !== null && change.workspaceRoot === this.lastScopeRoot`. Specs: "shows the C10 failure notice only for the root the list is scoped to", "shows no failure notice when the host sent no scopeRoot" |
| Workspace-switch refresh (view, `:511-525` pattern) | `skill-clones-view.component.ts` has a constructor effect on `config().workspaceRoot`. It skips the first run, then calls `state.refreshClones()` + `pluginCatalog.ensureLoaded()` (`:585-597`). Spec: "a workspace switch re-reads the list and the catalog once each" |
| Pointer shown for `conflict`/`differs`, hidden for null, Electron only, `role=status` | `pluginSettingsNeedChoice` computed (`:570`). Template `:198-213` (`role="status"`, `data-testid="clones-plugin-settings-pointer"`), inside the `@else` of `!isElectron()` (`:171`). The catalog is read only in Electron (`ngOnInit`, `:773`). Specs: `it.each(['conflict','differs'])`, `it.each([null,'home','imported'])`, "the pointer is Electron only, and VS Code reads no catalog" |
| Empty Agents copy per plan / design 3.6 | `EMPTY_COPY.agent` (`:141`), exact text from design-spec:123 / `library.html:163`. "Open setup wizard" button `:357-364`, gated by `showOpenWizard` (Agents tab, not loading, diverged filter off). Specs: "empty Agents tab: new copy…", "offers the wizard only on the empty Agents tab…" |
| Model-editor help (5.4, `aria-describedby`) | `CLAUDE_MODEL_HELP_COPY` (`agent-model-editor.component.ts:103`), text from `library.html:179`. Help `<p [id]="fieldId-help">` `:348-356` (Claude row only). The input's `[attr.aria-describedby]="describedBy(row.provider)"` (`:312`) points to the help (Claude only) and the draft hint (`:360`). Specs: "the Claude row says the wizard writes this model…", "other providers get no wizard help…" |
| A-nav | Wizard: `AppStateManager.setCurrentView('setup-wizard')` (`:781-783`), the same call `setup-hub.component.ts:1494` uses. Skills & Plugins: `AppStateManager.openMarketplace({ page: 'skills' })` (`:789-791`), the cross-library entry point `chat-empty-state-screen.component.ts:236` uses. The `skills` page is labelled "Skills & Plugins" in `marketplace-nav.component.ts:79`. Both calls are gated on `canSwitchViews`. `setup-wizard:launch` (VS Code RPC) is not used, because Electron routes in-app |
| Feed line roles | "Library updated" `<p role="status">`, C10 `<div role="alert">` (design-spec 6.1 / `library.html:59,165`). It clears on the next push, on a harness-root change and when a card is opened (`onOpenDetail` → `clearLibraryNotice`). Specs: "renders the 'Library updated' line as role=status…", "opening a card clears the feed line" |
| Module boundary | `skill-synthesis-ui` is `scope:webview,type:feature`. `marketplace` is `scope:webview,type:feature`. The view already imported `@ptah-extension/marketplace/services` (`HarnessHealthStore`), and `LibraryChangeFeed` comes from that same narrow barrel. Lint for `skill-synthesis-ui` passed |
| Angular rules | standalone/OnPush unchanged. `inject()` in field initialisers. Signals and `computed`. No `@Input`/`@Output`/NgModule. No `any`. The only casts are in specs and follow existing patterns |
| Dark and light | Only theme tokens: `border-warning/60 bg-warning/10 text-base-content` (the same pair as the existing paused notice), DaisyUI `alert-info`/`alert-error`, `btn-primary`, `text-base-content-muted`. State is always carried by text, not by colour alone |
| Initial bundle | No eager change. `skill-synthesis-ui` is lazy. `LibraryChangeFeed` is already eagerly registered (Batch 21). No new dependency |

## Decisions

- **`listClones()` returns the whole result.** Options were to add a second RPC method or to change the return type. Evidence: B13 / plan 1284 need `scopeRoot`. The state service is the only caller (grep). Following "replace, do not accumulate", I changed the type. Reversible.
- **Feed pushes before the Library was opened are ignored, and so is the value the feed held at construction** (the effect skips its first run). Opening the Library reads the list anyway. Acting on a held push would refresh twice and diff the first list against `[]`, which would produce a false "N agents added". Reversible.
- **The "added" line counts agents only.** Design-spec 5 has only the agents string. Skills and commands added by a push refresh silently. Reversible.
- **The origin wording comes from provenance, not from `reasons`.** One shared label gives "by the setup wizard" or "by plugin <name>". Mixed or no provenance gives "Library updated: N agents added." This keeps the line tied to the current list's own items.
- **Accessible label of the model input left as "<Provider> model for <slug>".** Design 3.8 suggests "Model for this agent". The existing label is more specific per provider row, and the help carries the wizard sentence. Reversible.

## Verification

Command: `npm run verify -- -p @ptah-extension/skill-synthesis-ui,ptah-extension-webview` (run once; an earlier run was stopped before it finished, after a self-review fix).

Result: `NX 6 tasks: 5 succeeded, 1 failed`. The only failure is `✖ nx run ptah-extension-webview:lint`: `224:7 Circular dependency between "ptah-extension-webview" and "@ptah-extension/command-center"`, the accepted pre-existing failure. `skill-synthesis-ui` lint, test and typecheck passed, as did webview test (23 suites, 661 tests) and webview typecheck. The filtered log has no "Running target" header line (Nx printed only the summary).

`ptah_get_diagnostics` found 0 errors in the changed sources. The 5 sibling errors are the pre-existing BigInt-target errors in `libs/shared`.

**Plan deviations**: two files outside the batch list, `skill-synthesis-rpc.service.ts` and `skill-clones-state.perf.spec.ts`. They were needed to carry `scopeRoot` (B13) into the state service. No backend, shared, or setup-wizard file was touched (D34).

**Out-of-scope observations**:
- The Skills and Commands empty copy still says "your library" in lower case. Only the Agents string was specified.
- The prototype drawer's "written to <path>" origin is still unavailable (Batch 22 note).
- Visual review in Electron, dark and light, is still due for the D14 pointer (D15).
