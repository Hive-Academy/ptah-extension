## Root cause

ProviderModelPickerComponent requires PROVIDER_MODELS_LOADER. Decision 9 removed the old consumer components' provider registrations along with their picker mounts, but ProvidersSettingsComponent supplied no replacement. Its descendants therefore threw NG0201 during member initialization. Existing component tests hid the defect by providing the token in TestBed; the coordinator test even used a loadModels-shaped double although the real port requires listModels.

The fix is consumer-side only. No changes were made to the picker, its port, UI library, core state service, application configuration or the webview-e2e-harness lane.

## Every picker mount

Source audit command:

```text
rg -n '<ptah-provider-model-picker' apps libs/frontend -g '*.ts' -g '*.html' -g '!*.spec.ts'
```

Five production template sites were found (the two additional UI-library matches are documentation examples):

| Site | Resolution path | Verification |
| --- | --- | --- |
| providers-settings.component.ts:143 - main agent model | Picker -> ProvidersSettingsComponent element injector | New real-provider regression test; real bundle main-model editor constructed |
| provider-consumer-assignments.component.ts:283 - shared background assignment editor | Picker -> consumer child -> ProvidersSettingsComponent | Existing real-bundle lane scenario passed for pinned synthesis and inherited judge; same template site renders all background rows |
| provider-setup-wizard.component.ts:1112 - repeated wizard tier picker | Picker -> wizard content projected through NativeDrawer -> ProvidersSettingsComponent | All three tier pickers constructed in the real bundle; zero missing-token errors |
| ptah-cli-config.component.ts:45 - instance model | Picker -> CLI manager -> ProvidersSettingsComponent | Real bundle opened a configured instance editor and constructed its picker |
| ptah-cli-config.component.ts:92 - delegated CLI model | Picker -> CLI manager -> ProvidersSettingsComponent | Real bundle opened delegated Codex model editor and constructed its picker |

The consumer child, CLI manager and wizard are declared directly in the page template. NativeDrawer uses ng-content (native-drawer.component.ts:90,109,113), not a detached portal/component injector. No other production mount was found. The real-bundle smoke constructed eight picker instances across all five sites and asserted no NG0201, NullInjector or PROVIDER_MODELS_LOADER console/page errors.

## Shape chosen

**Page-level provider.** ProvidersSettingsComponent.providers binds PROVIDER_MODELS_LOADER to ProvidersModelsLoader via useClass. This matches the existing per-consumer convention while placing the registration at the common ancestor of every current picker. It works regardless of which host mounts the page and does not put a UI port in application configuration.

ProvidersSettingsStateService has connection metadata and stored tier/configuration reads, but no model-catalogue listing method. The new small adapter calls ClaudeRpcService.call('provider:listModels', { providerId }) and returns the existing ProviderListModelsResult. It adds no catalogue cache, persistence path, backend import or alternate endpoint. RPC failure produces a fixed retry message. Future picker mounts outside this page must provide the port at their own consumer boundary.

Files written:

- libs/frontend/chat/src/lib/settings/providers/providers-models-loader.service.ts - new page-scoped port adapter.
- libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts - production element-injector registration.
- libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts - remove TestBed token provision and test the real loader/picker boundary.
- .ptah/specs/TASK_2026_523_c3df/ci-fix-models-loader-report.md - this report.

## Regression test

`renders the real main model picker using only the page-owned loader provider` renders the actual page component and actual main-model picker. TestBed stubs the state and RPC transport, **not PROVIDER_MODELS_LOADER**. The test opens Edit model, checks that the picker resolves the page's loader instance, checks provider:listModels receives the current provider id, and checks returned catalogue text appears.

Removing the production provider makes the actual picker construction throw NG0201; the test cannot silently pass through a TestBed replacement. The two unrelated consumer/wizard children remain stubs in this coordinator unit suite; all real child templates and the drawer were separately exercised against the compiled bundle below.

## Verification

Every Nx command used:

```powershell
$env:NX_DAEMON='false'
$env:NX_CACHE_DIRECTORY='D:\projects\ptah-extension\.nx\verify-ci-loader'
$env:NX_ISOLATE_PLUGINS='false'
```

Workdir for all commands: `D:\projects\ptah-extension\.claude-worktrees\task-523-group-d`.

```powershell
npx nx run-many --projects=@ptah-extension/chat --targets=typecheck,lint,test --parallel=2 --outputStyle=static
```

Final relevant output:

```text
> nx run @ptah-extension/chat:test
Test Suites: 95 passed, 95 total
Tests:       2 skipped, 1478 passed, 1480 total
Snapshots:   0 total
Time:        34.292 s
Ran all test suites.
> nx run @ptah-extension/chat:typecheck
> npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json
> nx run @ptah-extension/chat:lint
 NX   Successfully ran targets typecheck, lint, test for project @ptah-extension/chat
```

```powershell
npx nx build ptah-extension-webview --configuration=development --outputStyle=static
```

```text
Application bundle generation complete. [42.025 seconds] - 2026-09-22T16:46:46.198Z
Output location: D:\projects\ptah-extension\.claude-worktrees\task-523-group-d\dist\apps\ptah-extension-webview
 NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
Nx read the output from the cache instead of running the command for 1 out of 4 tasks.
```

The application bundle was rebuilt; the cache hit was a dependency. It was served from dist/apps/ptah-extension-webview/browser by the existing real-build fixture, not the placeholder fixture.

Unmodified lane scenario:

```powershell
node node_modules/@playwright/test/cli.js test --config=libs/frontend/webview-e2e-harness/playwright.config.ts skills-lane-pickers.e2e.spec.ts --workers=1 --reporter=list --output=.nx/loader-playwright-results
```

```text
  ok 1 [chromium] › libs\frontend\webview-e2e-harness\src\lib\scenarios\thoth\skills-lane-pickers.e2e.spec.ts:359:3 › webview > settings > providers > background model pickers › lane deep-link opens the Providers page where the shared picker enumerates providers and renders pinned lanes (3.8s)
  1 passed (21.3s)
```

Additional all-site smoke, in ignored .nx scratch files (no harness files edited):

```powershell
$env:NODE_NO_WARNINGS='1'
node node_modules/@playwright/test/cli.js test --config=.nx/loader-smoke/playwright.config.ts
```

```text
Running 1 test using 1 worker

PASS main model picker: real bundle, inherited page provider
PASS CLI instance model picker: real bundle, inherited page provider
PASS delegated CLI model picker: real bundle, inherited page provider
PASS background assignments: pinned synthesis and inherit judge pickers
PASS wizard Models drawer: all three real picker components constructed
PASS all five template sites: zero NG0201/NullInjector/provider-token errors
  ok 1 .nx\loader-smoke\models.e2e.spec.ts:359:3 › webview > settings > providers > background model pickers › lane deep-link opens the Providers page where the shared picker enumerates providers and renders pinned lanes (2.9s)

  1 passed (4.1s)
Playwright exit code: 0
```

## Deviations

- Used the development webview build, still the real Angular application bundle. The supplemental DI smoke uses Angular's development getComponent API only to select the wizard's Models step without running external authentication. All three actual wizard picker templates are rendered inside the real drawer; this does not claim to test the credential/probe flow.
- The supplemental smoke reuses a scratch copy of the existing lane scenario and its RPC fixtures, adds a CLI instance fixture, opens main/CLI editors with real clicks, and asserts all five sites construct without injector errors. It is not a modification to the other lane's harness.
- An initial compile/test attempt caught an accidental token entry in the standalone imports list; it was corrected before the successful final checks and bundle build. One initial Playwright worker exited before the test (code 3221226505); the direct installed runner passed. The scratch smoke initially needed an ESM package marker; after that correction it passed. These failed attempts are not counted as successful verification.
- Existing lint/template and runner deprecation warnings remain; final typecheck/lint/tests and the real bundle checks passed.

## Not done

- No live provider credentials, external network catalogue, native Electron IPC or VS Code activation was exercised. The real frontend bundle ran with the repository's host-RPC fixtures, which is sufficient to verify this missing consumer-injector registration.
- No changes to libs/frontend/webview-e2e-harness/**, unrelated application source, package installation, git history, index or branch state. No clarification remains pending.
