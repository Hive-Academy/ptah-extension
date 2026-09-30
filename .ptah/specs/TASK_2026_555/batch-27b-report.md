# Batch 27b: host-correct scope layers and Save-to targets

The root-cause step changed the fix. The batch assumed the VS Code host offers an App target it cannot use. It can:

- VS Code builds its scope resolver with an App layer of its own, `app.vscode`.
- The resolver writes and reads `app.vscode.<key>` for the four main-agent keys.
- The chat model and effort pickers already write to it by default.

So the backend and RPC contract are correct, and there was nothing to stop and report. The defect was in the webview: four hard-coded "Desktop app" labels.

The App layer is now named after the running host, from one helper (`app-scope-label.ts`):

- **VS Code:** "VS Code", in the scope popover, every Save-to list and the save toast.
- **Electron:** "Desktop app", unchanged.

The App target stays offered in both hosts, because removing it in VS Code would hide a layer that is in effect.

Verification:

- typecheck/test/lint are green for 5 projects.
- Gate G: `--repeat-each=3`, both hosts, **27 passed**.
- Build: no budget error; the initial bundle grew by 1.13 kB.
- Captures: 4 visual runs passed.

Nothing is committed; the working tree is dirty for the team-leader.

## Root cause (file:line)

All paths are in the worktree. The finding is that the App layer is real in every host, so it is not a Desktop-only layer.

| Step | Evidence |
| --- | --- |
| The allowlist gives the four main-agent keys `supportedTargets: ['global','app','workspace']`, the same for every host | `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:315-330` |
| `config:getScopes` passes that list through unchanged | `libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.ts:193` |
| The VS Code host builds its resolver with an App prefix | `libs/backend/platform-vscode/src/settings/vscode-settings-registration.ts:112-123` (`appPrefix = resolveAppPrefix(container)`) |
| — `resolveAppPrefix` returns `appScopePrefixFor(info.type)` unless the type is `web` | `:177-187` |
| — `appScopePrefixFor(type)` builds `app.<type>` | `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:12-14` |
| VS Code's `PLATFORM_INFO.type` is `PlatformType.VSCode` = `'vscode'` | `libs/backend/platform-vscode/src/registration.ts:49-56`; `libs/backend/platform-core/src/types/platform.types.ts:140-142` |
| It is registered before the settings registration runs | `apps/ptah-extension-vscode/src/di/container.ts:51` (`DIContainer.setup` → `registerPhase0Platform`) at `apps/ptah-extension-vscode/src/activation/bootstrap.ts:123`, before `registerVscodeSettings` at `:136` |
| The resolver then reads `app.vscode.<key>` for app-scopable keys: workspace-in-app, then app, then workspace, then global | `workspace-scope-resolver.ts:85-101` |
| — `write(…, 'app', true)` writes `app.vscode.<key>` | `workspace-scope-resolver.ts:187-194` |
| Electron does the same with `app.electron` | `libs/backend/platform-electron/src/settings/electron-settings-registration.ts:84-93, 149-159` |
| The backend documents `app` as per-runtime | `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.schema.ts:44-47`: "a picker change is scoped to the current runtime (Electron / VS Code / CLI)" |
| **The defect: the webview hard-coded "Desktop app" for `app` in four places, whatever the host** | `setting-scope-row.component.ts:269, 290` (HEAD); `main-agent-reassign-popover.component.ts:19` (HEAD); `provider-setup-wizard.component.ts:211` (HEAD); `settings-save-feedback.service.ts:28` (HEAD) |

**Why this is not a backend stop:** the stop condition was "the host returns `app` as a supported target where it cannot be written or read". In VS Code, `app` is written (`auth-rpc.handlers.ts:962-1006`, `config-rpc.handlers.ts:188-197, 671-677`) and read (`model-settings.ts:33-39`, `reasoning-settings.ts:33-39`, `computed-setting-handle.ts:49-68`, `auth-rpc.handlers.ts:982`). The condition does not hold, so I made no backend edit.

**Why the target is kept, not removed (the "which would change the fix" clause, batches.md:1607-1608):**

- VS Code **does** read the App layer, and it is the default write target of `config:model-switch` and `config:effort-set` (`config-rpc.handlers.ts:188, 671`: `parseApplyTo(…, 'app')`). Many VS Code users therefore already hold `app.vscode.provider.<authKey>.selectedModel` / `.reasoningEffort` values.
- Removing the App target in VS Code would leave that layer in effect and shadowing Global, with no Save-to that can edit it in place.
- So the fix names the layer after the host, and keeps it.

## Changed files

| Change | Path | Lines | What |
| --- | --- | --- | --- |
| CREATED | `libs/frontend/chat/src/lib/settings/providers/app-scope-label.ts` | 32 | `appScopeName(isElectron)` returns "VS Code", or "Desktop app" / "the Desktop app"; `injectAppScopeName()` reads `VSCodeService.isElectron`; `saveTargetLabels(app)`. The doc comment cites the backend evidence. |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/setting-scope-row.component.ts` | 297 | The App layer label and the clear preview ("Will use X from VS Code.") come from the host |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/setting-scope-row.component.spec.ts` | | Per-host `describe.each` (3 specs × 2 hosts): layer labels, an App-stored value stays visible, clear preview |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts` | 389 | `SCOPE_LABEL` constant replaced by host-aware `scopeLabels` (Save-to options, rescope offer, confirm "Saved to: …") |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.spec.ts` | | Per-host `describe.each` (2 specs × 2 hosts), described below |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.ts` | 2388 (was 2390; pre-existing over 700) | `SAVE_TARGET_LABELS` constant replaced by host-aware `saveTargetLabels` |
| MODIFIED | `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts` | | Per-host Save-to label spec (2) |
| MODIFIED | `libs/frontend/chat/src/lib/settings/feedback/settings-save-feedback.service.ts` | 124 | Toast "Saved X to {VS Code \| Desktop app}." |
| MODIFIED | `libs/frontend/chat/src/lib/settings/feedback/settings-save-feedback.service.spec.ts` | | The scope-label spec is now per host (2) |
| MODIFIED | `libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts` | | Per-host spec (2), described below |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-drawer.reach.ts` | 235 | `expectHostAppScope(page, container, appEntry)`, described below |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts` | 985 (700 counted, no `max-lines` warning) | #18 checks the scope popover's App layer per host. RUX-5 checks that the options are exactly `['Global · all apps', <host>, 'This workspace']` and that the other host's name is absent. #16 keeps 3 options (right in both hosts). |
| MODIFIED | `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts` | 206 | New capture `main-agent-save-to`, described below |

Details for the longer rows:

- **Popover spec:** the Save-to options are exactly `Global · all apps | {host} | This workspace`, and the other host's name never appears. The App target re-saves the provider "to {host}", the model saves with `applyTo: 'app'`, and the toast is "Saved main agent model to {host}."
- **State service spec:** `writeScopes` keeps the host-reported `app` target in both hosts, and an App-stored `authMethod` keeps `scope: 'app'`.
- **`expectHostAppScope`:** it detects the host from `ptah-electron-shell`, asserts the App entry reads the host's name and the container never shows the other host's, and returns the name.
- **`main-agent-save-to` capture:** it chooses the App target and captures the provider confirm "Saved to: {host}.", after asserting the option list and logging it.

`providers-settings-state.service.ts` itself is **unchanged** (see Deviations 1). `providers-settings.component.ts`, `settings.fixtures.ts` and every backend file are unchanged. The fixture's `supportedTargets: ['global','app','workspace']` (`settings.fixtures.ts:409`) already matches the real backend in both hosts.

## Acceptance → evidence

| Requirement (batches.md:1595-1605) | Result | Proven by |
| --- | --- | --- |
| **VS Code: no "Desktop app" layer in the scope popover** | The layer now reads "VS Code" | Scope-row spec (VS Code case); Gate G #18 (vscode); capture `current-scope-popover-vscode-*` |
| **VS Code: no "Desktop app" in any Save-to list** | Every list uses "VS Code": the popover's provider, model and effort Save-to, the wizard Save-to, the provider rescope confirm, and the save toast | Popover spec, wizard spec, feedback spec (VS Code cases); Gate G RUX-5 (vscode); capture `current-main-agent-save-to-vscode-*` |
| — Grep: the only non-spec "Desktop app" literal left is the Electron branch of `app-scope-label.ts:20` | | |
| **Electron: the App layer and target are unchanged** | Still "Desktop app" and "the Desktop app" | Electron cases of every spec above; Gate G #18 and RUX-5 (electron); captures `current-*-electron-*` |
| **A spec per host on the state service** | `providers-settings-state.service.spec.ts`, "keeps the App target the host reports ($host host)" × 2 | core 1085/1085 |
| **A component spec for the popover layers** | `setting-scope-row.component.spec.ts`, "App layer in the $host host" × 3 specs | chat 1989 passed |
| **An existing App-layer value never disappears** | See the next section | Scope-row spec "a value stored at App stays visible…"; state spec (`scope: 'app'` kept) |
| **Harness RUX-5 and #16 are host-aware** | RUX-5 checks the exact options per host plus the absence of the other host's name. #16 keeps 3 options, because the App target is the host's own layer in both hosts. | Gate G 27/27 |

## How an existing VS Code App-layer value is shown

Take a VS Code user with `app.vscode.provider.claudeCli.selectedModel = X`, which is the chat picker's default write:

1. **Read.** `config:getScopes` returns `scope: 'app'` and `hasOverride: true` for the key, because `effectiveKey` resolves to `app.vscode.…` (`config-scope-rpc.handlers.ts:179-191`). `writeScopes` still offers `app` (state spec).
2. **Badge.** The Main Agent node shows "Model · App" (`setting-scope-row.component.ts:209-211`, unchanged).
3. **Popover.** It lists "Global · all Ptah apps", "**VS Code** — In use", and the workspace. The clear preview reads "Will use {global value} from Global.", or "…from VS Code." when App is the fallback. Clear override removes exactly that App key (`config:clearScopeOverride` → `clearOverride`, `workspace-scope-resolver.ts:215-224`).
4. **Save-to.** It defaults to the model's source scope (`main-agent-reassign-popover.component.ts:216-219`), so a model or effort change saves back to "VS Code", the layer in effect. Choosing "Global · all apps" writes global and clears the more specific App key (`clearMoreSpecific('global')`, `workspace-scope-resolver.ts:240-268`), so the user's choice takes effect.

Nothing is hidden, and every existing value stays editable at the layer that holds it.

## Write-path trace (control → state method → RPC → store key / scope → runtime reader)

Every target is kept in both hosts. `<p>` is `app.vscode` in VS Code and `app.electron` in Electron. `ws` is `workspace.<sha256(path)[0:16]>`.

| Control, Save-to target | State method → RPC | Store key written | Runtime reader |
| --- | --- | --- | --- |
| **Popover provider "Use for main agent"**, target T | `state.activateConnection(id, T, ctx)` → `auth:saveSettings {authMethod, anthropicProviderId, applyTo: T}` (`auth-rpc.handlers.ts:960-1008`) | `scopeResolver.write('authMethod'…, T, true)` and the same for `anthropicProviderId`, then `clearMoreSpecific(…, T, true)` | `resolver.read('authMethod', true)` / `('anthropicProviderId', true)` (`model-settings.ts:33-39`, `reasoning-settings.ts:33-39`, `auth-rpc.handlers.ts:982`), then `sdkAdapter.reset()` |
| — T = `global` | | `authMethod` (bare) | Bare key, last candidate |
| — T = `app` | | `<p>.authMethod` | Read first after `<p>.ws.*` (`workspace-scope-resolver.ts:88-93`). **VS Code reads `app.vscode.authMethod`.** |
| — T = `workspace` | | `<p>.ws.authMethod` | First candidate |
| **Popover provider rescope** ("Save provider to {T}…"), target T | Same path as above: `activateConnection(currentId, T)` | Same keys | Same readers |
| **Popover model**, target T | `feedback.save` → `state.saveSettings({model:{model, applyTo:T}})` → `config:model-switch {model, applyTo:T}` (`providers-commit.service.ts:89`; `config-rpc.handlers.ts:188-197`) | `modelSettings.selectedModel.set(model, T)` → `resolver.write('provider.<authKey>.selectedModel', …, T, true)` (`computed-setting-handle.ts:63-68`) | Read back through `config:model-get` (`providers-commit.service.ts:93`). The SDK reads `ModelSettings.selectedModel`, which resolves `effectiveKey(…, true)` (`computed-setting-handle.ts:49-50`). **VS Code reads `app.vscode.provider.<authKey>.selectedModel`.** |
| **Popover effort**, target T | `feedback.save` → `state.saveSettings({effort:{effort, applyTo:T}})` → `config:effort-set` (`providers-commit.service.ts:101`; `config-rpc.handlers.ts:667-677`) | `reasoningSettings.effort.set(effort, T)` → `…reasoningEffort`, at the same key per scope | Read back through `config:effort-get`. The runtime reads `ReasoningSettings.effort` through the same resolver. |
| **Wizard Save to** ("Use for main agent" or connect-only), target T | `commitRequested` → `state.connectProvider(draft, ctx)` → `ProvidersConnectionSetupService` → `activateConnection` (`auth:saveSettings`, `applyTo: T`), gated by `writeScopes` | Same keys as the popover provider row | Same readers |
| **Scope badge → Clear override** (no target) | `state.clearScopeOverride(key, 'nearest')` → `config:clearScopeOverride` → `clearOverride(key, true)` | Deletes the winning override, which may be `<p>.<key>` | Same readers, now falling through |

**Conclusion:** the VS Code runtime **does** read the App layer that was being offered, so the fix keeps the target and corrects its name. It does not remove it.

## Verification

1. **typecheck, test and lint.** `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat @ptah-extension/core @ptah-extension/ui @ptah-extension/webview-e2e-harness ptah-extension-webview --parallel=2` exited 0 ("Successfully ran targets typecheck, test, lint for 5 projects"). Logs: `%TEMP%\b27b-verify.log`, and `%TEMP%\b27b-verify-counts.log` (a cache replay with `--output-style=static`, for the counts).

   | Project | Tests | Change from Batch 27 |
   | --- | --- | --- |
   | core | 1085/1085 | +2 |
   | ui | 610/610 | 0 |
   | chat | **1989 passed + 2 skipped** (1991) | +13 |
   | webview | 224/224 | 0 |

   - Lint: 0 errors. Warnings: core 11, chat 30 (unchanged).
   - Harness lint first rose to 42 warnings: the table reached 709 counted lines (`max-lines` skips comments and blanks; the Batch 27 base was 698). I moved the host check into the helper `expectHostAppScope` in `settings-drawer.reach.ts` and folded the entries. A re-run of `nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness` exited 0 with **41 warnings**, the same as Batch 27, and no warning in `scenarios/settings` (`%TEMP%\b27b-harness-lint.log`).
   - `ptah_get_diagnostics` on the 5 changed non-spec chat files: none. The sibling errors it lists are the known spec type-check gap in untouched specs.
2. **Build.** `npx nx build ptah-extension-webview --skip-nx-cache` exited 0 with **no budget error** (`%TEMP%\b27b-build.log`).
   - Initial total: **3.47 MB**, 973.12 kB over the 2.5 MB warning budget. Batch 27 was 971.99 kB over, so this is **+1.13 kB eager**: the helper, and `VSCodeService` injected into the eager scope row, wizard and feedback service.
   - Lazy chunks: `main-agent-reassign-popover-component` 16.48 kB; `provider-catalog-modal-component` 8.78 kB.
3. **Gate G.** `settings-reachability.e2e.spec.ts --reporter=list --repeat-each=3` gave **27 passed (1.5m)**, exit 0, both hosts, on the first run (`%TEMP%\b27b-gateG.log`). There were no red runs and no worker crash. It ran after the final harness edit and the build, with nothing else writing `dist/`.
4. **Captures.** `settings-visual.e2e.spec.ts --reporter=list` gave **4 passed (15.1s)**, exit 0 (`%TEMP%\b27b-visual.log`). Logged Save-to options:
   - `vscode/anubis`, `vscode/anubis-light`: `Global · all apps | VS Code | This workspace`
   - `electron/anubis`, `electron/anubis-light`: `Global · all apps | Desktop app | This workspace`
5. **Baselines.** `git status --short -- .ptah/specs/TASK_2026_555/screenshots/angular/ | grep -c baseline` gives **0**. Nothing is staged.

## Captures (all `current-*`, in `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\screenshots\angular\`)

- Smoke, both tabs:
  - `current-providers-vscode-anubis-1024x768.png`, `current-providers-vscode-anubis-light-1024x768.png`
  - `current-orchestration-vscode-anubis-1024x768.png`, `current-orchestration-vscode-anubis-light-1024x768.png`
  - Electron copies of the same four.
- Scope popover, both hosts:
  - `current-scope-popover-vscode-anubis-1024x768.png`, `current-scope-popover-vscode-anubis-light-1024x768.png`: layers "Global · all Ptah apps / **VS Code** / Workspace · ptah-e2e-ws-a (In use)".
  - `current-scope-popover-electron-anubis-1024x768.png`, `current-scope-popover-electron-anubis-light-1024x768.png`: "… / **Desktop app** / …".
- Save-to list, both hosts:
  - `current-main-agent-save-to-vscode-anubis-1024x768.png`, `current-main-agent-save-to-vscode-anubis-light-1024x768.png`: Save to "**VS Code**", confirm "Saved to: VS Code."
  - `current-main-agent-save-to-electron-anubis-1024x768.png`, `current-main-agent-save-to-electron-anubis-light-1024x768.png`: "**Desktop app**", "Saved to: Desktop app."
  - The unchanged `current-main-agent-popover-*` captures were refreshed too.

I looked at `current-scope-popover-vscode-anubis`, `current-scope-popover-electron-anubis-light`, `current-main-agent-save-to-vscode-anubis-light` and `current-main-agent-save-to-electron-anubis`. The labels are as stated, and the header "App: VS Code" / "App: Desktop" now agrees with the layer name.

## Deviations and notes

1. **The fix differs from the batch's expected fix.** The batch expected a `writeScopes` filter in the state service. It got host-aware naming, and the App target is kept in both hosts. The reason is the root cause above: the VS Code runtime reads the App layer, and batches.md:1607-1608 anticipates that this "would change the fix".
   - `providers-settings-state.service.ts` is unchanged. Only its spec gained the per-host test, which pins that `app` is not filtered.
   - RUX-5 in VS Code now expects `['Global · all apps', 'VS Code', 'This workspace']`, not two options. **If the orchestrator or user instead wants VS Code to hide its own App layer, that is a product decision.** It would need a plan for the existing `app.vscode.*` values, for example migrating them or showing them read-only, and it would change the default write target of `config:model-switch` and `config:effort-set` (backend).
2. **Batch size.** 13 paths (1 created, 12 modified) across 3 libs, above the 6-file / 2-lib default (execution default 1).
   - Chat, 9 files: the requirement "no Desktop app in any Save-to list" forces every label site to change. There are four, plus the new shared helper.
   - Core, 1 file: spec only.
   - Harness, 3 files: the table, the helper file (moved there to keep the table under `max-lines`), and the visual spec for the Save-to capture.
3. **Where the host label lives.** It is a chat-side pure helper plus `inject(VSCodeService)`, not a new member on `ProvidersSettingsStateService`, for two reasons:
   - The state service is at 698 lines.
   - About ten consumer specs use partial state doubles (`{ commit }` and so on). A new state member called on the save path would have broken unrelated specs.

   Specs that do not provide `VSCodeService` get the real root service (`isElectron` false), so they see the VS Code wording. Two existing expectations were updated for that: scope-row `:196` now uses a Global fallback, and the feedback spec became per host.
4. **The badge text stays "{short} · App" in both hosts** (D16, plan :620-622). The host name appears in the popover it opens.
5. **Global label wording is unchanged and still inconsistent** across the surfaces: "Global · all Ptah apps" (popover layer), "Global · all apps" (Save-to), "All Ptah apps" (toast). This is pre-existing, and I left it for Gate V 28.
6. **Out of scope, observed and not touched:** in `current-scope-popover-electron-anubis-light-1024x768.png`, the CLI node's "4 enabled" badge paints **over** the open scope popover, on the workspace row. This is a stacking-order issue between the routing-map node badge (Batch 25) and `NativePopoverComponent`. It is for Gate V 28.
7. **`provider-setup-wizard.component.ts` is 2388 lines,** pre-existing and far over 700. This batch made it 2 lines shorter.
