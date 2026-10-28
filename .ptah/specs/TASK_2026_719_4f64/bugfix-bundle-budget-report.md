# Bugfix — webview initial bundle over budget (D71)

## Frontend implementation — `TASK_2026_719_4f64`, bundle-budget fix

**Tasks completed**: moved the Providers settings page out of the webview's initial bundle. That page holds this branch's named-accounts UI. The budget stays at 4 MB (D71).

### What was actually eager

I traced the branch's frontend diff (`git diff --numstat 543971d2b...72fe980e1`) from the eager `settings` route (`SettingsComponent`, eager per its own doc comment and `app.routes.ts`):

- The accounts tab, account detail view, add form, ambient row and remove flow are **already lazy**. `AccountsTabComponent` is imported only by `ConnectionDetailDrawerComponent`. `providers-settings.component.ts` renders that drawer inside `@defer (on immediate)` at :449.
- `MainAgentReassignPopoverComponent` (+243 lines on this branch) is **already lazy**: `@defer (on immediate)` at providers-settings :110.
- `ClaudeLaneAccountCellComponent` is **already lazy**: it is reached only through the deferred Orchestration tab.
- I checked whether the inline `type` specifiers next to deferred classes (for example `type MainAgentFocus`) force those imports to stay eager. They do not. Angular 22.2.3 `DeferredSymbolTracker.extractImportedSymbols` skips `element.isTypeOnly` (`node_modules/@angular/compiler-cli/bundles/chunk-GY2QRHJA.js:1995`).
- **Eager**: `ProvidersSettingsComponent` itself. `settings.component.html` rendered it directly while tabs 2–4 were already deferred. It carries this branch's account wiring (+63 lines: account count, ambient and accounts injection, the sign-in hand-off). It also pulled `account-presentation.ts` into the initial graph through `connectedAccountCount`, along with the page's own eager-only modules.
- These stay eager because chat rows and the agent monitor need them at runtime: the core services `ProviderAccountsStateService` and `ClaudeAmbientStatusService`, plus the small additions to `agent-monitor.store`, `session-list-row`, `agent-card-header` and `settings-toast`.

### Change

The Providers tab now loads the same way tabs 2–4 already do: `@defer (on immediate)` with an `aria-busy` `min-h-24` placeholder. That placeholder is the one the harness `waitForSettled` already waits on.

**Files** (3 changed):

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/settings.component.html:162-172`
  - `<ptah-providers-settings>` is wrapped in `@defer (on immediate) { … } @placeholder { <div class="min-h-24" aria-busy="true"> }`.
  - The inputs and output are unchanged (`focusTarget`, `requestedProviderId`, `requestedProviderConsumed`).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/settings.component.ts:20-23,98-101`
  - The value import of `ProvidersSettingsComponent` is now a separate declaration from `import type { ProvidersSettingsFocusTarget }`. This follows the file's existing "two declarations on purpose" convention.
  - The class now sits in the defer-only group of `imports`. Nothing else in the file references it.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/settings.component.spec.ts` (deep-linked provider request suite)
  - The `ProvidersPageStub` now emits from `ngOnInit` instead of its constructor. A deferred view is created before its inputs are bound, so the constructor microtask read `''`.
  - The test waits one more `whenStable()`/`detectChanges()` so the deferred page can render and consume the request.
  - The test still asserts the same behaviour: the wizard opens once and does not open again on return.

### Estimated size moved out of the initial graph

I measured source bytes with `wc -c` on each module. I counted only modules whose sole non-deferred importer was `providers-settings.component.ts`; I found importers with grep over `libs/frontend/chat/src/lib/settings`, excluding specs.

| Module | Bytes |
| --- | ---: |
| `providers/providers-settings.component.ts` (class + inline template) | 56,335 |
| `providers/provider-connection-card.component.ts` | 16,380 |
| `providers/provider-connection-card.state.ts` | 10,531 |
| `providers/connection-usage.ts` | 5,192 |
| `providers/connection-drawer/connection-kind.ts` | 2,693 |
| `providers/connection-drawer/drawer-write.ts` | 1,979 |
| **Total** | **≈ 93.1 kB** |

The eager-side use of `account-presentation.ts` (`connectedAccountCount`, 16.7 kB file) also leaves the initial graph. I excluded it from the total because tree-shaking already dropped most of that file.

`busy-disabled.directive.ts` stays eager because `settings-toast` uses it. Minified output is typically 30–45 % of source for this code, so I expect roughly 28–40 kB less in `initial`. That is well over the 8.74 kB overrun. I did not run the production build (project rule); CI measures it.

**Stack observed**: Angular 22.2.3 (`node_modules/@angular/core/package.json`), standalone OnPush components with signals. I followed the existing `@defer (on immediate)` + `aria-busy` placeholder pattern in `settings.component.html:176-206` and its spec pattern (`settings.component.spec.ts`, "deferred tabs" suite).

**Design fidelity**: no visual change after load. The page shows the same placeholder as tabs 2–4 for one tick while its chunk loads.

**States covered**: the placeholder is `aria-busy="true"`. After load, focus and deep-link behaviour are unchanged: the page reads `focusTarget` and `requestedProviderId` when it renders, as the Orchestration tab already does.

### Verification

- `node scripts/verify.mjs -t lint,test,typecheck -p chat,ptah-extension-webview,ptah-electron`: `NX 15 tasks: 13 succeeded, 10 cached, 2 failed`.
  - Typecheck passes for `chat`, `ptah-extension-webview` and `ptah-electron`.
  - All tests pass. On the first run, the `chat` suite showed 292 suites with 1 failure, which was the settings deep-link spec fixed above. The re-run passed.
  - **The 2 lint failures were not introduced by this branch.**
    - `@ptah-extension/chat:lint` reports 2 errors, both in `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts` (`no-useless-escape`, `no-control-regex`). They come from commit `04fd8e12d`, which is on `origin/main`. No lint finding mentions the settings files.
    - `ptah-extension-webview:lint` reports `Circular dependency between "ptah-extension-webview" and "@ptah-extension/command-center"`, also from main. This branch's diff touches no `command-center` file.
- `node scripts/verify.mjs -t test -p chat -- --testPathPatterns=settings/settings.component.spec`: `1 task: 1 succeeded`.
- Not run: `build` (project rule). CI measures the bundle after push.

### Behaviour risk

- Low. The Providers page now mounts one microtask after Settings opens, behind an `aria-busy` placeholder. It previously mounted synchronously.
- Deep links (`focusTarget`, `requestedProviderId`) are signals bound as inputs. They apply once the page renders, the same way the deferred Orchestration tab already handles them.
- The boot auth check that navigates to Settings (no credential) now shows the placeholder briefly.
- If the chunk fails to load, the placeholder stays. There is no `@error` block, matching tabs 2–4.

### Decisions

- **Decision**: defer the whole Providers page at its single import site, rather than splitting account pieces inside it.
  - **Options**: (a) defer the page; (b) refactor `providers-settings.component.ts` to lazy-load `connectedAccountCount` and the account wiring.
  - **Evidence**: (b) would save only about 3–5 kB, because the account dialogs and popover are already deferred. That may not clear 8.74 kB reliably. (a) reuses the file's existing pattern for tabs 2–4.
  - **Reversible**: yes, by unwrapping the `@defer`.

### Out-of-scope observations

The `chat` lint errors in `chat-attention-source.service.ts` and the webview↔command-center circular dependency are failures on `main`. CI `checks` will report them independently of this fix.
