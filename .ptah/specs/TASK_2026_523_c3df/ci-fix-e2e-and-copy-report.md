# CI fix: e2e scenario, corrupted character, report links — `TASK_2026_523_c3df`

## E2E scenario

**Decision: MOVE the scenario to the Providers page.** Not narrowed, not deleted.

`skills-lane-pickers.e2e.spec.ts:256` failed because the four lane picker mounts
were deliberately removed from `SkillSettingsPanelComponent` (Decision 9 row 6,
`implementation-plan.md:313`: "REMOVE the four picker mounts. Unrelated
synthesis policy stays."). The equivalent behaviour fully exists on the
Providers settings page:

- `ProviderConsumerAssignmentsComponent` (Background models section) mounts the
  same `ProviderModelPickerComponent` (extracted into `libs/frontend/ui`,
  batches B1.9/B1.10) — the component the old scenario always really tested.
- The harness CAN reach the page through the real user path the skills panel
  itself now exposes: each lane renders a "Manage <lane> in Providers" button
  that calls `AppStateManager.requestSettingsTab({ tab: 'providers', section })`
  + `setCurrentView('settings')`. `'settings'` is in `SURFACE_ROUTE_IDS`
  (`libs/shared/src/lib/types/webview-surface.types.ts:63`), and the settings
  deep-link chain (`SettingsComponent.ngOnInit` → `providersTarget` →
  `initialEditingConsumerId` → one-shot `toggleEdit`) opens the row editor.

The rewritten scenario (`libs/frontend/webview-e2e-harness/src/lib/scenarios/
thoth/skills-lane-pickers.e2e.spec.ts`) keeps the thoth → Skills → Settings
leg, asserts the panel no longer mounts any picker (`toHaveCount(0)` — a guard
against a half-removal) and offers the deep-link, then drives the real
deep-link into the Providers page and asserts there:

- all six `consumer-row-*` cards render with the synthesis row loaded;
- the shared picker enumerates the merged registry (`option[value="moonshot"]`
  → `Moonshot (Kimi)`);
- the pinned synthesis lane shows its own provider/model (`moonshot` /
  `kimi-k2`) — the regressed case of commit 9e42f9c81;
- an untouched lane (judge) shows the documented inherit default (`''`).

The RPC fixture set was extended to answer every method
`ProvidersSettingsStateService.refresh()` fans out over
(`auth:getEffectiveRoute`, `config:getScopes`, `config:model-get`,
`config:effort-get`, `memory:getTriggers`, `ptahCli:list`, `settings:get`,
`agent:getConfig`, `auth:getApiKeyStatus`, `auth:getAuthStatus`,
`provider:listCustomEntries`, plus in-page resolvers for
`llm:getProviderBaseUrl`, `provider:getModelTiers`, `provider:listModels`),
so no section is stuck in the not-loaded state (`toggleEdit` refuses a
not-loaded row).

**Run result: the moved scenario runs locally and fails — for a REAL defect,
not an obsolete assertion.** See `## Clarifications Needed`.

### The failure, diagnosed

The deep-link opens the synthesis editor (the row renders
"Cancel editing Synthesis lane"), but the editor block never mounts. Console
capture during the run shows the bundle dying with:

```
console.error: Angular Error: I: NG0201
    at ko.get (…/chunk-B141FGi7.js:4:7225)
    …
    at <instance_members_initializer> (…/main.js:8:20823)
```

`NG0201` is `NullInjectorError`. The throwing frame is a class member
initializer in `main.js` — `ProviderModelPickerComponent`'s
`private readonly loader = inject(PROVIDER_MODELS_LOADER);`
(`libs/frontend/ui/src/lib/native/provider-model-picker/
provider-model-picker.component.ts:299`).

`PROVIDER_MODELS_LOADER` is an `InjectionToken` with no default factory
(`libs/frontend/ui/src/lib/native/provider-model-picker/
provider-models-loader.port.ts:48`), whose own doc says: "Provide this
wherever a `<ptah-provider-model-picker>` is rendered." A tree-wide search
(`grep -rn PROVIDER_MODELS_LOADER --include=*.ts`, excluding `node_modules`)
finds the token referenced ONLY by:

- the port file and the picker itself (`libs/frontend/ui/src/lib/native/
  provider-model-picker/`), and
- test specs (`*.spec.ts`) — which all satisfy it in `TestBed`.

No production code provides it: not `app.config.ts` of the webview
(`apps/ptah-extension-webview/src/app/app.config.ts`, read in full), not the
Electron host, not any of the components that mount the picker
(`providers-settings.component.ts`, `provider-consumer-assignments.component.ts`,
`provider-setup-wizard.component.ts`, `ptah-cli-config.component.ts`), not
`provideModelRefreshControl()` / `provideWizardInternalState()`.

Consequence in the real bundle: the row's editor `@if` block
(`provider-consumer-assignments.component.ts:281-…`) creates an embedded view
whose first child is the picker; the injector error aborts that embedded view,
so `consumer-editor-synthesis` never renders, while sibling blocks (the Cancel
button, the scope strips) survive. The same applies to every picker mount on
the Providers page and the setup wizard. The unit specs pass because
`TestBed` provides the token; the bundled app cannot.

## Character fix

`libs/frontend/memory-curator-ui/src/lib/components/diagnostics/
memory-diagnostics-accordion.component.ts:142` — the literal `?` between
provider and model was restored to `→` (U+2192), matching
`providers-settings.component.ts` and
`provider-consumer-assignments.component.ts`.

Verification of the file after the edit: the arrow is bytes `E2 86 92` (UTF-8,
U+2192), the file begins `imp` (no BOM), and `file` reports
`UTF-8 text, with CRLF line terminators`; the whole file decodes as valid
UTF-8. Only this one file was touched for the character fix.

## Report links

All seven `file:///D:/…` links in `.ptah/specs/TASK_2026_523_c3df/
code-style-review.md` were replaced with repository-relative paths; the
existing portable line anchors were kept unchanged (file and line references
intact).

| Line | Before (`file:///D:/…` prefix on link target) | After |
|---|---|---|
| 41 | `[auth-rpc.handlers.ts:228-274](file:///…/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L228-L274)` | `[auth-rpc.handlers.ts:228-274](libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L228-L274)` |
| 47 | `[config-scope-rpc.handlers.ts:73, 143](file:///…/libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts#L73)` | `[config-scope-rpc.handlers.ts:73, 143](libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts#L73)` |
| 58 | `[provider-setup-wizard.component.ts:1-2254](file:///…/libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts#L1-L2254)` | `[provider-setup-wizard.component.ts:1-2254](libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts#L1-L2254)` |
| 64 | `[providers-settings-state.service.ts:1-1134](file:///…/libs/frontend/core/src/lib/services/providers-settings-state.service.ts#L1-L1134)` | `[providers-settings-state.service.ts:1-1134](libs/frontend/core/src/lib/services/providers-settings-state.service.ts#L1-L1134)` |
| 74 | `[draft-verification.service.ts:41, 131](file:///…/libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts#L41)` | `[draft-verification.service.ts:41, 131](libs/backend/auth-providers/src/lib/auth/draft-verification.service.ts#L41)` |
| 80 | `[provider-connection-card.component.ts:90-429](file:///…/libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts#L90-L429)` | `[provider-connection-card.component.ts:90-429](libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts#L90-L429)` |
| 86 | `[skills-synthesis-rpc.handlers.ts:40, 1979](file:///…/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts#L40)` | `[skills-synthesis-rpc.handlers.ts:40, 1979](libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts#L40)` |

`grep -c 'file:///'` over the file now returns 0 matches.

## Verification

Environment: worktree `D:\projects\ptah-extension\.claude-worktrees\
task-523-group-d`; every command ran with
`NX_DAEMON=false NX_CACHE_DIRECTORY="D:\projects\ptah-extension\.nx\verify-ci-e2e"`.
No `npm install` (junction untouched); Playwright browsers for the installed
runner were missing (`chromium_headless_shell-1243`), so
`node node_modules/playwright/cli.js install chromium` downloaded them
(`Chrome for Testing 153.0.8010.12 … downloaded to …chromium-1243`).

| Check | Command | Result |
|---|---|---|
| e2e scenario | `node <repo>\node_modules\@playwright\test\cli.js test --config=playwright.config.ts src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts` (cwd `libs/frontend/webview-e2e-harness`) | **1 failed** — `TimeoutError: locator.waitFor … [data-testid="consumer-editor-synthesis"] to be visible`, root cause `NG0201` (see `## Clarifications Needed`) |
| harness lint | `npx nx run @ptah-extension/webview-e2e-harness:lint` | success — `25 problems (0 errors, 25 warnings)` |
| harness typecheck | `npx nx run @ptah-extension/webview-e2e-harness:typecheck` | success — `npx tsc --noEmit …` clean |
| curator typecheck | `npx nx run @ptah-extension/memory-curator-ui:typecheck` | success |
| curator lint | `npx nx run @ptah-extension/memory-curator-ui:lint` | success — `27 problems (0 errors, 27 warnings)` |
| curator tests | `npx nx test @ptah-extension/memory-curator-ui` | success — `17 passed, 17 total` suites, `193 passed, 193 total` tests |

The e2e scenario DID run locally (real Angular bundle served from
`dist/apps/ptah-extension-webview/browser`, built earlier with
`npx nx build ptah-extension-webview`, exit 0). It is not a "could not run"
case — it ran and found a genuine regression.

## Deviations

- The scenario was moved rather than narrowed — this is the documented choice
  the task asked me to make and justify; see `## E2E scenario`.
- The rewritten spec keeps `test.use({ useAppBuild: true })` and the existing
  Electron-host-config rationale (the skills tab gates its template on
  `isElectron()`), documented in the file's header comment.
- One navigation detail differs from the original plan: the deep-link effect
  DID open the editor (no fallback click needed in the happy path), but the
  editor block never renders because of the missing DI provider. The
  race-fallback click was kept (it is harmless and covers the documented
  one-shot race).

## Not done

- The e2e scenario is not green, and cannot be made green from files I own:
  making the editor render requires providing `PROVIDER_MODELS_LOADER` in
  production DI — see `## Clarifications Needed`.
- Nothing else from the three assigned fixes is outstanding: Fix 2 and Fix 3
  are complete and verified.

## Clarifications Needed

The moved scenario is correct, and it now fails because of a production DI
defect on this PR — the shared `ProviderModelPickerComponent` injects
`PROVIDER_MODELS_LOADER`, which no production code provides. All files that
could carry the fix are owned by another lane, so I did not touch them.

**Q1 — Who provides `PROVIDER_MODELS_LOADER` in production, and where?**

Options:

1. `(Recommended)` Provide the token once at each host's application injector
   (`apps/ptah-extension-webview/src/app/app.config.ts` and the Electron app
   config), with a thin implementation that calls `provider:listModels` through
   `ClaudeRpcService`. One wiring covers every mount: the Background models
   editors, the setup wizard, and the CLI agents editor. The port's own doc
   says "provide this wherever a picker is rendered", but a single app-level
   provider satisfies that for all hosts and cannot be forgotten by the next
   consumer.
2. Provide it per consumer component (`providers-settings.component.ts`,
   `provider-setup-wizard.component.ts`, `ptah-cli-config.component.ts`) —
   matches the current per-tab pattern (the Skills tab provides its own RPC
   service), but three wirings instead of one, and each new consumer must
   remember it.

Until one of these lands, `skills-lane-pickers.e2e.spec.ts` stays red by
design: it asserts real bundle behaviour, and the bundle is broken. Deleting or
loosening the assertions would silently drop the coverage the task forbids
dropping.

**Q2 — Should the fix land inside this PR (recommended) before CI merges?**
The Providers page's inline editors (and the setup wizard's picker) fail in
every real host today, not only in the harness: any user opening a lane
editor on the Providers page hits a dead editor row with a `NG0201` in the
console. The e2e scenario as written will turn green exactly when the DI
provider lands; no further spec change is needed.