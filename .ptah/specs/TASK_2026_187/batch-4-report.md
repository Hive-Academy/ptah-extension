# Batch 4 report — TASK_2026_187 Unit 5

**Status**: COMPLETE, not committed.
**Headline**: initial total **2,702,149 B → 2,536,716 B (−165,433 B / −165.43 kB)**; transfer **552.76 → 523.59 kB**.
**2,500,000 B target: NOT MET. Exact shortfall: 36,716 B.**
**R15 verdict**: `setup-wizard` **CAN** open at launch → **NOT deferred**. `tasks-ui`, `harness-builder`, `setup-hub` **cannot** → deferred.

Unit 6 (Batch 5 reserve) **activates**. See §11.

---

## 1. THE R15 VERDICT — evidence first, per surface

R15 required me to establish, _before_ writing any code, whether each of the four surfaces can be the surface that opens at launch. The answer differs, so Batch 4 shipped **three** deferrals, not four — and the one it did not ship is the largest single item in the batch's estimate.

### 1a. `setup-wizard` IS a launch surface — **NOT DEFERRED**

This is the Batch 3 lesson repeating almost exactly: **the disqualifying evidence was not visible from anywhere inside the webview.** It lives in the extension-host manifest and in a backend lib.

`tasks.md:822` predicted the wizard would be caught by the _auth-redirect_ effect. **That prediction is wrong** (see §1e) — but the wizard is disqualified anyway, by a stronger and completely independent path that no prior document in this task had identified:

| #   | Link                                                                                    | Evidence                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A VS Code **activation event** exists for it                                            | `apps/ptah-extension-vscode/package.json:41` — `"onCommand:ptah.setupAgents"`                                                                                                                                                    |
| 2   | It is a contributed, palette- and menu-visible command                                  | `package.json:91-92` `contributes.commands` (_"Setup Ptah Agents"_); `package.json:141` `contributes.menus` — reachable from the UI, not just programmatically                                                                   |
| 3   | The command handler launches the wizard                                                 | `apps/ptah-extension-vscode/src/commands/setup-agents-command.ts:31-51` — resolves `AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE`, calls `launchWizard(workspaceFolder.uri.fsPath)`                                              |
| 4   | That creates a **brand-new webview panel**                                              | `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts:79-96` — `createWizardPanel('Ptah Setup Wizard', 'ptah.setupWizard', …)`                                                                                 |
| 5   | The panel's HTML **hardcodes the initial view**                                         | `libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts:149-156` — `panel.webview.html = generateAngularWebviewContent(panel.webview, { workspaceInfo, initialView: 'setup-wizard', …initialData })` |
| 6   | `'setup-wizard'` survives host-side validation                                          | `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:106-113` — `VALID_VIEWS` **includes `'setup-wizard'`**; `:414` emits `window.ptahConfig.initialView`                                                          |
| 7   | …and the webview's own allow-list                                                       | `apps/ptah-extension-webview/src/app/app.ts:100-109` — **includes `'setup-wizard'`**                                                                                                                                             |
| 8   | The webview sets `currentView` from it **at service construction**, before first render | `libs/frontend/core/src/lib/services/app-state.service.ts:324-327` reads `window.initialView ?? window.ptahConfig.initialView`; `:352-354` `normalizeView(...)` → `this._currentView.set(initialView)`                           |
| 9   | That view renders the deferral candidate                                                | `app-shell.component.html:20-29` — `@case ('setup-wizard')` → the `WIZARD_VIEW_COMPONENT` outlet                                                                                                                                 |

That is a from-scratch Angular bootstrap in a **dedicated panel whose entire purpose is this one component**, with a user who just clicked "Setup Ptah Agents" waiting on it. It is a stronger case than the dashboard: the dashboard rode a generic `createPanel({initialView:'analytics'})`, whereas the wizard has a **purpose-built panel factory that hardcodes the view**.

**`WIZARD_VIEW_COMPONENT` was therefore left eager**, with its `InjectionToken<Type<unknown>>` generic unchanged. This costs the batch **109.0 kB** — the single largest item in the estimate — and is the direct cause of the shortfall in §4e. I did not compensate for it elsewhere.

### 1b. `tasks-ui` is NOT a launch surface — **DEFERRED**

| Check                                                           | Result                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can `initialView` be `'tasks'`?                                 | **No.** Absent from **both** allow-lists — `app.ts:100-109` and `webview-html-generator.ts:106-113`. The host generator **throws** on it (`:115-121`); `app.ts:116-122` warns and falls back to `'chat'`                                                                                                                           |
| Any producer that requests it?                                  | **None.** Repo-wide, every `initialView` assignment site is: `'analytics'` (`ptah-extension.ts:129`), `'orchestra-canvas'` (`:143`), `'setup-wizard'` (`webview-lifecycle.service.ts:153`), and Electron's `null`/`'chat'` (`post-window.ts:94`, `preload.ts:46`). No `'tasks'` anywhere                                           |
| Electron launch view?                                           | **Always chat.** `apps/ptah-electron/src/activation/post-window.ts:94` `initialView: null`; `apps/ptah-electron/src/preload.ts:46` defaults to `'chat'`                                                                                                                                                                            |
| Does `ElectronShellComponent` force it, the way it forces grid? | **No.** Its constructor (`electron-shell.component.ts:295-311`) calls **only** `setLayoutMode('grid')` — no `setCurrentView`. `openTasks()` (`:359-361`) is a **click handler**, not constructor code                                                                                                                              |
| `currentView` persisted / restored?                             | **No** — re-confirmed on this tree. `localStorage` in `app-state.service.ts` holds only `ptah-layout-mode` (`:330`, `:475`) and the Thoth first-run flag (`:337-344`, `:458`). Bootstrap view resolution (`:324-327`) reads **only** `window.initialView` / `window.ptahConfig.initialView`                                        |
| `window.ptahPreviousState` / `vscodeService.getState()`?        | **Not used for view.** `getState()` (`vscode.service.ts:214-225`) is keyed access only and is never fed into view resolution                                                                                                                                                                                                       |
| `onUri` deep link?                                              | **No view path.** `"onUri"` is in `activationEvents` (`package.json:43`), but the only `registerUriHandler` in the repo is `libs/backend/platform-vscode/src/implementations/vscode-uri-oauth-callback-listener.ts:44` — an **OAuth callback** listener. It resolves a pending auth flow; it does not create a panel or set a view |
| Auth-redirect effect                                            | Targets `'settings'` only — see §1e                                                                                                                                                                                                                                                                                                |

### 1c. `harness-builder` and `setup-hub` are NOT launch surfaces — **DEFERRED**

Every row in §1b holds identically for `'harness-builder'` and `'setup-hub'` (both absent from both allow-lists; `openSetupHub()` at `electron-shell.component.ts:347-349` is a click handler).

**One extra path checked, because it is the only one that navigates by push:** `HarnessWorkflowMessageHandler.handleOpenWorkflow` calls `navigation.navigateToView('harness-builder')` (`harness-workflow-message.handler.ts:52`). Its sole broadcaster is `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts:651-653`, inside the **`harness:start-new-project` RPC handler**. That is post-bootstrap by construction — the webview must already exist and be running to have issued the RPC. Not a launch path.

`SETUP_HUB_COMPONENT` and `HARNESS_BUILDER_COMPONENT` resolve out of the **same library**, so **one** lazy chunk serves both. Expected; not restructured.

### 1d. Summary

| Surface           | Startup-reachable?                                                     | Action       | Cost/benefit                             |
| ----------------- | ---------------------------------------------------------------------- | ------------ | ---------------------------------------- |
| `setup-wizard`    | **YES** — activation event → dedicated panel → hardcoded `initialView` | **EAGER**    | 109.0 kB left on the table, deliberately |
| `tasks-ui`        | No                                                                     | **DEFERRED** | −118.8 kB initial                        |
| `harness-builder` | No                                                                     | **DEFERRED** | −39.3 kB initial                         |
| `setup-hub`       | No                                                                     | **DEFERRED** | shares the harness chunk                 |

### 1e. Correction to a stated assumption — the auth-redirect targets `'settings'`, NOT `'setup-wizard'`

The brief and `tasks.md:832` / risk row R15 describe the auth-redirect effect as making "`setup-wizard`/`settings`" the first-run launch surface. **Precisely: it targets `'settings'` and only `'settings'`.**

`app-shell.component.ts:328-360`: the effect returns early unless `currentView() === 'chat'` (`:330`), latches on `authCheckDone` so it runs once (`:318`, `:333`), calls `auth:getAuthStatus`, re-checks `currentView() !== 'chat'` after the await (`:338`), and on `!hasAnyAuth` calls **`this.appState.setCurrentView('settings')`** (`:355-357`). There is no branch to `'setup-wizard'`.

This matters for **Batch 5 Task 5.1**: the reserve `@defer` of the settings view is the one that this effect makes a first-run launch surface. The plan (§10 Unit 6, `tasks.md:944`) already states this and accepts one module hop via `@defer (on immediate)` — that judgement stands, and it is now confirmed to be the _only_ view this effect touches.

### 1f. Was a startup-TTI run required? **No.**

Per the brief, a `startup-tti.spec.ts` before/after pairing is required only if I defer something that survives the check but **might** be startup-reachable in some configuration. Nothing I deferred qualifies: all three are rejected by the host generator (it throws), fall back to `'chat'` in the webview, are not persisted, are not forced by Electron, and are reached only by click or by a push that presupposes a running webview. So there is no startup-TTI hypothesis to test, and the spec was **not** run — the same call Batch 3 made, on the same grounds.

**If a reviewer disagrees with the §1a call and wants the wizard deferred after all, that decision must be paired with a before/after run of `startup-tti.spec.ts` in a single session.** The initial-bundle budget passes either way, so it is not a gate for this.

---

## 2. Files changed

**Created**

- `libs/frontend/tasks-ui/src/services.ts` — `TasksStore` (+ its types)
- `libs/frontend/harness-builder/src/services.ts` — `HarnessWorkflowMessageHandler`, `HarnessBuilderStateService`, `HarnessRpcService`, `HarnessWorkflowService`
- `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts` — the R4 gate

**Modified**

- `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts` — 3 generics → `InjectionToken<LazyViewLoader>`; `WIZARD_VIEW_COMPONENT` left `Type<unknown>` with the R15 finding recorded in its doc comment
- `apps/ptah-extension-webview/src/app/app.config.ts` — 3 providers → `useValue` arrows; 2 imports → `/services`; wizard import + provider annotated with the R15 reason
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` — 3 fields → `lazyViews.resolveWhen(...)`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` — 3 sites → `@if (x(); as cmp)`
- `tsconfig.base.json` — 2 new `/services` paths
- `eslint.config.mjs` — `checkDynamicDependenciesExceptions` (see §7)

**Deliberately NOT changed**

- `WIZARD_VIEW_COMPONENT` token generic, provider, field and template site — §1a
- No `libs/frontend/setup-wizard/src/services.ts` — §6
- I-8 DO-NOT-TOUCH list — all six paths verified clean. TASK_2026_196 not touched.

---

## 3. Invariant compliance

| Invariant                                        | Status                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I-1 / R2** `useValue`, never `useFactory`      | ✅ All three new providers are `useValue` with arrow functions (`app.config.ts:143-156`, `:171-175`). The only `useFactory` token in the file remains the warning comment at `:137-140` |
| **I-2 / R3** `resolveWhen` trigger-gated         | ✅ Reused unchanged from Batch 2; its 6 regression assertions still pass                                                                                                                |
| **I-3 / R4** services eager, components not      | ✅ §8. All three services eager and receiving, asserted by dispatch                                                                                                                     |
| **I-4** chat critical path                       | ✅ initial transfer 552.76 → **523.59 kB**. `main.js` **fell** 381,133 → 186,827 B (§4f)                                                                                                |
| **I-5** Monaco untouched                         | ✅ `provideMonacoEditor` intact at `app.config.ts:237-239`; asset globs and `editor/src/lib/{code-editor,diff-view}/` clean                                                             |
| **I-6** `nx reset` before budget check           | N/A — no `project.json` edit this batch                                                                                                                                                 |
| **I-7** xterm CJS warnings unactioned            | ✅ all three still emitted; no `allowedCommonJsDependencies`                                                                                                                            |
| **I-8** DO-NOT-TOUCH                             | ✅ all clean                                                                                                                                                                            |
| **I-9** restore `maximumError`                   | Batch 5                                                                                                                                                                                 |
| **R11** `lazyViews` declared above its consumers | ✅ `app-shell.component.ts:159`, above all seven fields                                                                                                                                 |

---

## 4. Measurement

### 4a. BEFORE — my own baseline (`--skip-nx-cache`, 2026-08-09T20:26:16Z)

| File                |       Raw (B) |      Transfer |
| ------------------- | ------------: | ------------: |
| `chunk-XOTFZ7YS.js` |       725,948 |     140.97 kB |
| `chunk-3AJTUKQV.js` |       643,865 |     138.21 kB |
| `main.js`           |       381,133 |      81.89 kB |
| `styles.css`        |       276,070 |      34.60 kB |
| `chunk-WNZMNKTK.js` |       241,768 |      49.30 kB |
| `chunk-OW4MB5WX.js` |       146,813 |      36.19 kB |
| `chunk-5H5O23XF.js` |       109,959 |      20.63 kB |
| `scripts.js`        |        48,202 |      14.01 kB |
| `chunk-3RGT2QIX.js` |        39,700 |       8.42 kB |
| `polyfills.js`      |        35,726 |      11.58 kB |
| `chunk-C6VKIUHV.js` |        30,767 |      10.65 kB |
| `chunk-AAZHQEUL.js` |        20,658 |       5.54 kB |
| `chunk-6F4HVVOU.js` |         1,378 |         601 B |
| `chunk-LW5LSEOG.js` |           162 |         162 B |
| `chunk-JXTWWDFB.js` |             0 |           0 B |
| **Initial total**   | **2,702,149** | **552.76 kB** |

**Byte-identical to Batch 3's closing number**, and Angular's own budget line agreed: _"not met by 202.15 kB"_. Lazy total 947,258 B.

### 4b. AFTER — initial

| File                |       Raw (B) |      Transfer |
| ------------------- | ------------: | ------------: |
| `chunk-3AJTUKQV.js` |       643,865 |             — |
| `chunk-GSXVN24C.js` |       636,224 |             — |
| `styles.css`        |       276,070 |      34.60 kB |
| `chunk-UWKWCTKO.js` |       223,137 |             — |
| `main.js`           |       186,827 |      44.09 kB |
| `chunk-OW4MB5WX.js` |       146,813 |             — |
| `chunk-7V2KZ4E5.js` |       109,959 |             — |
| `chunk-CTJANIJZ.js` |        89,863 |             — |
| `scripts.js`        |        48,202 |      14.01 kB |
| `chunk-3RGT2QIX.js` |        39,700 |             — |
| `polyfills.js`      |        35,726 |      11.58 kB |
| `chunk-SULELTWL.js` |        30,767 |             — |
| `chunk-B63YIMHG.js` |        18,423 |             — |
| `chunk-LJZR7JKA.js` |        17,463 |             — |
| `chunk-S62IZLL7.js` |        16,400 |             — |
| `chunk-PSKPQPYR.js` |        15,737 |             — |
| `chunk-6F4HVVOU.js` |         1,378 |         601 B |
| `chunk-LW5LSEOG.js` |           162 |         162 B |
| `chunk-JXTWWDFB.js` |             0 |           0 B |
| **Initial total**   | **2,536,716** | **523.59 kB** |

Angular's budget line: _"not met by 36.72 kB with a total of 2.54 MB"_ — 2,500,000 + 36,716 = 2,536,716, an exact match to the summed filesystem bytes.

### 4c. AFTER — lazy

| File                |       Raw (B) |  Transfer | Identity                                                      |
| ------------------- | ------------: | --------: | ------------------------------------------------------------- |
| `chunk-U5HE5I7E.js` |       539,414 | 101.25 kB | editor (Batch 1)                                              |
| `chunk-5HE5VJMV.js` |       302,548 |  57.87 kB | Thoth group (Batch 3)                                         |
| `chunk-VEOBSVJC.js` |       122,867 |  26.68 kB | **NEW — tasks-ui board**                                      |
| `chunk-T3MZ64YU.js` |        52,230 |  11.26 kB | marketplace                                                   |
| `chunk-KG6DKXWH.js` |        46,253 |  11.68 kB | tribunal                                                      |
| `chunk-PGYZHVXX.js` |        41,190 |   9.55 kB | **NEW — harness-builder + setup-hub (one chunk, both views)** |
| `chunk-HG3P62SC.js` |         6,599 |   2.29 kB |                                                               |
| `chunk-HJXROB6D.js` |         5,000 |   1.77 kB | **NEW**                                                       |
| `chunk-B6GDESL2.js` |           336 |     336 B |                                                               |
| **Lazy total**      | **1,116,437** |           |                                                               |

### 4d. Delta

| Metric                       |      Before |           After |                           Δ |
| ---------------------------- | ----------: | --------------: | --------------------------: |
| **Initial total (raw)**      | 2,702,149 B | **2,536,716 B** | **−165,433 B (−165.43 kB)** |
| **Initial total (transfer)** |   552.76 kB |   **523.59 kB** |               **−29.17 kB** |
| `main.js` (raw)              |   381,133 B |       186,827 B |                  −194,306 B |
| Lazy total (raw)             |   947,258 B |     1,116,437 B |                  +169,179 B |
| **Gap to 2,500,000 B**       |     202,149 |      **36,716** |                    −165,433 |

Build **green**, reproduced twice with identical hashes and byte sizes.

### 4e. Actual vs expected — and the whole of the shortfall

**Expected: ~298 kB (ESTIMATED)** — tasks-ui 134.4 + setup-wizard 108.9 + harness-builder 55.0.
**Actual: −165.43 kB.**

The ~133 kB difference is **fully accounted for and was not a miss**:

| Item                                     |         kB | Why                                               |
| ---------------------------------------- | ---------: | ------------------------------------------------- |
| `setup-wizard` never available           | **−109.0** | R15, §1a — it is a launch surface                 |
| Eager `TasksStore` residue retained      |  **−16.8** | I-3 requires it; it is a `MESSAGE_HANDLERS` entry |
| Eager harness services residue retained  |  **−15.8** | I-3, same reason                                  |
| Shared deps following the components out |   **+8.6** | net favourable                                    |

Removing the estimate's `setup-wizard` line gives an adjusted expectation of ~189 kB against the ~155 kB of genuinely movable component code, and the measured −165.43 kB sits between them.

**The 202,149 B gap was always larger than what Batch 4 could legitimately move once R15 was applied.** The estimate's ~96 kB of margin was entirely `setup-wizard`'s 108.9 kB.

### 4f. `main.js` — meaningful for once

|        |            Raw |      Transfer |
| ------ | -------------: | ------------: |
| Before |      381,133 B |      81.89 kB |
| After  |      186,827 B |      44.09 kB |
| Δ      | **−194,306 B** | **−37.80 kB** |

`tasks.md:837` flagged that Batch 4's targets were still in `main.js`, so a `main.js` delta would be meaningful here. It is, and it moved the right way: **I-4 satisfied with room to spare** — this is a decrease, not merely "not grown". (Attribution confirms `main.js` still carries `setup-wizard` 109.0 kB and `canvas` 26.9 kB, both eager by design.)

---

## 5. `modulepreload` diff (R7) — identified by size and attributed contents, not hash

Baseline is Batch 3's closing 10-entry list; the after list also has 10 entries.

| Before           |    Size | After                      |    Size | Identity                                                                      |
| ---------------- | ------: | -------------------------- | ------: | ----------------------------------------------------------------------------- |
| `chunk-XOTFZ7YS` | 725,948 | `chunk-GSXVN24C`           | 636,224 | same role, shrunk by the tasks/harness split                                  |
| `chunk-3AJTUKQV` | 643,865 | _(present, not preloaded)_ | 643,865 | zod / @angular/core / shared / core — **dropped from preload**, still initial |
| `chunk-WNZMNKTK` | 241,768 | `chunk-UWKWCTKO`           | 223,137 | chat-ui                                                                       |
| `chunk-OW4MB5WX` | 146,813 | _(present, not preloaded)_ | 146,813 | forms / marked / common — **dropped from preload**, still initial             |
| `chunk-5H5O23XF` | 109,959 | `chunk-7V2KZ4E5`           | 109,959 | dashboard + chat-state + eager Thoth residue — unchanged                      |
| —                |         | `chunk-CTJANIJZ`           |  89,863 | **NEW** — re-partitioned eager set                                            |
| `chunk-3RGT2QIX` |  39,700 | `chunk-3RGT2QIX`           |  39,700 | editor _services_, eager by design (I-3) — unchanged                          |
| `chunk-C6VKIUHV` |  30,767 | _(present, not preloaded)_ |  30,767 | dompurify + markdown — **dropped from preload**, still initial                |
| `chunk-AAZHQEUL` |  20,658 | —                          |       — | re-partitioned away                                                           |
| —                |         | `chunk-LJZR7JKA`           |  17,463 | **NEW** — initial                                                             |
| —                |         | `chunk-S62IZLL7`           |  16,400 | **NEW** — initial                                                             |
| —                |         | `chunk-PSKPQPYR`           |  15,737 | **NEW** — initial                                                             |
| `chunk-LW5LSEOG` |     162 | `chunk-LW5LSEOG`           |     162 | unchanged                                                                     |
| `chunk-JXTWWDFB` |       0 | `chunk-JXTWWDFB`           |       0 | unchanged                                                                     |

**There ARE four new `modulepreload` entries. Stating it plainly rather than claiming "no new entries."** All four (89,863 / 17,463 / 16,400 / 15,737) are **initial** chunks — each appears in the §4b table and is already inside the 2,536,716 B total. They are re-partitioned pieces of the old eager set, not new work pulled forward.

**The check R7 actually protects: PASS.** Verified per file: **none of the nine lazy chunks appears in `index.html`.** In particular the new 122,867 B tasks-ui chunk and the new 41,190 B harness-builder chunk are **not** preloaded — they are genuinely deferred.

Total preloaded bytes fell **1,959,640 → 1,148,645 (−810,995 B)**.

---

## 6. Per-lib attribution and the R6 keep/drop calls

Source-map attribution, initial set vs lazy set.

| Lib               | Initial BEFORE | Initial AFTER |  Δ initial | Where it went                                                                    |
| ----------------- | -------------: | ------------: | ---------: | -------------------------------------------------------------------------------- |
| `tasks-ui`        |       135.6 kB |   **16.8 kB** | **−118.8** | 118.8 kB → lazy `chunk-UNV5KZLJ`; 16.8 kB residue = `TasksStore` (I-3)           |
| `harness-builder` |        55.1 kB |   **15.8 kB** |  **−39.3** | 39.4 kB → lazy `chunk-DZVLDDUZ`; 15.8 kB residue = the four eager services (I-3) |
| `setup-wizard`    |       109.0 kB |  **109.0 kB** |      **0** | stays in `main.js` — **not deferred** (R15, §1a)                                 |

The residues are exactly what I-3 **requires** stay eager, and they are the _services only_ — the attribution shows the components are wholly in the lazy chunks. That is the clean indicator the task asked for.

### R6 — both barrels KEPT, each measured independently

I did not assume the barrels were load-bearing; I probed each by reverting it to the wide specifier and rebuilding.

| Barrel                                     | Probe (wide barrel) initial total | Shipped (narrow) initial total | **Barrel is worth** | Verdict  |
| ------------------------------------------ | --------------------------------: | -----------------------------: | ------------------: | -------- |
| `@ptah-extension/tasks-ui/services`        |                       2,663,550 B |                    2,536,716 B |       **126,834 B** | **KEEP** |
| `@ptah-extension/harness-builder/services` |                       2,577,410 B |                    2,536,716 B |        **40,694 B** | **KEEP** |

Both are decisively load-bearing — this is not the `/*@__PURE__*/` no-op case R6 warned might occur. Without the narrow barrel the eager `MESSAGE_HANDLERS` import re-pins the whole lib and the `import()` collapses back into the initial chunk, exactly as §8.5 predicted.

### R6 — `setup-wizard` barrel NOT created

Task 4.3 asked for a third barrel exporting `SetupWizardStateService` **and** `provideWizardInternalState`. **I did not create it**, because R15 forced `WizardViewComponent` to stay eagerly imported in `app.config.ts` — which keeps the wide `@ptah-extension/setup-wizard` barrel in the eager graph _no matter which specifier the two services use_. The barrel could not move a byte; it would be dead scaffolding of exactly the kind R6 says to drop.

This is the **same structural no-op** Batch 3 measured and dropped for `dashboard` (35.7 → 35.8 kB), and the attribution confirms the prediction: `setup-wizard` is unchanged at 109.0 kB in `main.js`. The reasoning is recorded in a comment at the import site so the next person does not re-derive it. `provideWizardInternalState()` continues to resolve from the wide barrel and is still spread at `app.config.ts:178`.

---

## 7. Unplanned change — an Nx module-boundary exception, and why it was necessary

**This is a new structural finding; it is not in the plan and Batches 1–3 never hit it.**

Batch 4 is the first time a single library is **both** dynamically imported **and** statically imported from the _same_ project — which is precisely what invariant I-3 mandates (components lazy, `MESSAGE_HANDLERS` services eager). Nx's `@nx/enforce-module-boundaries` rule is **project-granular**: it cannot see that `@ptah-extension/tasks-ui/services` is a separate entry point, so it raised four errors:

```
Static imports of lazy-loaded libraries are forbidden.
  app.config.ts:69, :70   unit5-message-routing.spec.ts:53, :54
```

Batch 2 never collided (marketplace/tribunal had no service import at all). Batch 3 never collided (its dynamic edge was a template `@defer` in `libs/frontend/chat`, a _different_ project from the webview app that holds the static `/services` imports).

**Fix**: `eslint.config.mjs` — `checkDynamicDependenciesExceptions`, listing **only the two `/services` subpath specifiers**. The rule matches against the _import specifier_, so this is precise:

```js
checkDynamicDependenciesExceptions: [
  '@ptah-extension/tasks-ui/services',
  '@ptah-extension/harness-builder/services',
],
```

Two things make this the right call rather than a rule-silencing:

1. **It is factually correct.** The exemption asserts "these subpaths do not defeat the split" — and that is _measured_, at 126,834 B and 40,694 B (§6), not assumed.
2. **The bare specifiers stay banned, and I proved the guard still bites.** I re-pointed `app.config.ts` to the wide `@ptah-extension/tasks-ui` barrel and re-ran lint: it errored, then I reverted. So the rule now enforces exactly the invariant Batch 3's §2 lesson wanted — an eager consumer reaching for a **wide** barrel of a deferred lib is a lint error. Batch 3's closing note suggested adding such a guard in Batch 5; this delivers it for these two libs as a side effect, and respects R8 (subpath stays legal).

**Recommended follow-up, out of scope here**: the architecturally clean answer is to split the eager services into their own Nx libs (the shape the repo already uses for `memory-contracts`, `voice-contracts`, `auth-providers-tokens`), which removes the tension entirely. That is a redesign of the plan's prescribed `src/services.ts` approach and **was not attempted** — recorded for the backlog.

---

## 8. R4 — the `MESSAGE_HANDLERS` assertions (BLOCKING gate)

New spec: **`apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts`** — **6 tests, all passing**, modelled on `editor-message-routing.spec.ts` (Batch 1) and `thoth-message-routing.spec.ts` (Batch 3).

**Method.** It wires the **real** `MessageRouterService` to the **real** services through the **same `useExisting` `MESSAGE_HANDLERS` registrations `app.config.ts` uses**, imports each service through the **same specifier production now takes**, then dispatches genuine `window` `MessageEvent`s carrying hard-coded literal wire strings and asserts an observable effect. It never instantiates `TasksViewComponent`, `HarnessBuilderViewComponent`, `SetupHubComponent` or `WizardViewComponent` — reproducing exactly R4's condition: **app on chat, those views never opened.**

Two structural properties make it a gate rather than a restatement of the provider list:

1. If a narrow barrel stops exporting one of them, the spec **fails to compile**.
2. `MessageRouterService` builds its handler map in its constructor by reading `handledMessageTypes` off every registered handler, so a dropped or unresolvable registration **throws at `TestBed.inject`**.

| Service                         | Imported from                              | Message dispatched (literal wire string) | Observable effect asserted                                                                       |
| ------------------------------- | ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `TasksStore`                    | `@ptah-extension/tasks-ui/services`        | `tasks:changed` (no `workspaceRoot`)     | a `tasks:board` RPC is issued on the stubbed `ClaudeRpcService`                                  |
| `HarnessWorkflowMessageHandler` | `@ptah-extension/harness-builder/services` | `harness:open-workflow`                  | `appState.harnessWorkflowRequest()` goes `null` → `{mode:'new-project', seedPrompt:'delivered'}` |
| `SetupWizardStateService`       | `@ptah-extension/setup-wizard`             | `setup-wizard:scan-progress`             | `wizard.scanProgress()` goes `null` → `{filesScanned:7, totalFiles:42, detections:['angular']}`  |

Notes on method, since the brief was explicit that "it is still in the providers array" is not an assertion:

- **`TasksStore` has no directly observable signal for this push** — `handleMessage` reacts by firing a refresh RPC. So the RPC service is stubbed and the assertion is that a **`tasks:board`** call appears. The payload deliberately omits `workspaceRoot` to take the store's unconditional "refresh active, best effort" branch (`tasks-store.service.ts:894-900`), so the test asserts _message delivery_ rather than incidentally asserting workspace state. The filter is on the `tasks:board` method specifically, because other root services issue unrelated RPCs at construction.
- `MESSAGE_TYPES.HARNESS_OPEN_WORKFLOW` / `HARNESS_CONFIG_PROPOSED` are pinned against hard-coded literals, so an edit to a shared constant fails the spec rather than silently agreeing with itself.
- A final test re-dispatches all three types to confirm the registrations stay live.

- [x] `TasksStore` — dispatch-and-observe
- [x] `HarnessWorkflowMessageHandler` — dispatch-and-observe
- [x] `SetupWizardStateService` — dispatch-and-observe

---

## 9. Did the tree shift mid-batch? — NO

**`HEAD` did not move**: `4508df433` at both ends, identical to Batch 3's closing commit.

Checked by **mtime**, not by the `git status` letter, across `libs/shared`, `libs/frontend` and `apps/ptah-extension-webview`:

- My baseline build ran at **20:26 UTC = 23:26 local**. Every file in those three trees with an mtime **after** 23:26 is one of my own seven edits (23:27–23:42). The newest non-mine file is `thoth-message-routing.spec.ts` at **23:17** — Batch 3's committed work, before my baseline.
- The concurrent session's two dirty files (`apps/ptah-cli/README.md`, `libs/backend/agent-sdk/.../session-query-executor.service.ts`) are **outside** the webview graph; `libs/frontend` never imports `@ptah-extension/agent-sdk`.
- Strongest evidence: my independently measured baseline came out **byte-identical to Batch 3's closing 2,702,149 B**, and Angular's budget line agreed to the byte.

So the −165,433 B is attributable to this batch alone.

---

## 10. Test / typecheck / lint gates

| Gate                            | Command                                                                                   | Result                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| webview (incl. the new R4 spec) | `nx test ptah-extension-webview`                                                          | ✅ **4 suites, 20 tests**                            |
| `core`                          | `nx test core`                                                                            | ✅ 23 suites, 471 tests                              |
| `chat`                          | `nx test chat`                                                                            | ✅ 50 suites, 658 passed / 2 skipped                 |
| `tasks-ui`                      | `nx test tasks-ui`                                                                        | ✅ 10 suites, 271 tests                              |
| `harness-builder`               | `nx test harness-builder`                                                                 | ✅ 17 suites, 470 tests                              |
| `setup-wizard`                  | `nx test setup-wizard`                                                                    | ✅ 2 suites, 40 tests                                |
| Typecheck                       | `run-many -t typecheck` over webview, core, chat, tasks-ui, harness-builder, setup-wizard | ✅ **6/6**                                           |
| Lint                            | `run-many -t lint` over the same six, `--skip-nx-cache`                                   | ✅ **6/6, 0 errors** (43 warnings, all pre-existing) |
| Build                           | `nx build … --configuration=production --skip-nx-cache`                                   | ✅ green, reproduced twice                           |

One transient failure was seen and dismissed on evidence: a `jest: failed to read cache file` transform-cache error in `harness-builder` (0 tests failed, 422 passed). A clean re-run gave 17/17 suites and 470/470 tests. Infrastructure flake, not a code failure.

`npx nx reset` was **not** run — no `project.json` edit, so I-6/R13 does not apply. Unit 8 (Batch 5) still needs it, and R12a's Windows sequence still stands.

---

## 11. THE TARGET IS NOT MET — Unit 6 activates

|                                 |                               Bytes |
| ------------------------------- | ----------------------------------: |
| Initial total after Batch 4     |                       **2,536,716** |
| Budget (`maximumWarning` 2.5mb) |                           2,500,000 |
| **Remaining gap**               | **36,716 B (35.86 KiB / 36.72 kB)** |

Per Task 4.5, **Batch 5 Task 5.1 (Unit 6 — `@defer` the settings view) is now REQUIRED, not conditional.** Its ~150 kB estimate clears 36,716 B with wide margin.

Two things Batch 5 must carry from here:

1. **Settings is the first-run launch surface** — §1e confirms `app-shell.component.ts:355-357` navigates there and only there. The plan's `@defer (on immediate)` inside the `@case` keeps that path correct at the cost of one module hop; that is accepted (plan §10 Unit 6) but must be stated in the Batch 5 report, and it is the one Unit 6 decision worth pairing with a `startup-tti.spec.ts` run.
2. **`message-bubble.component.css` (Task 5.2) is still 977 bytes over** and will still warn. Per `tasks.md:958` that does not block I-9, which concerns the **initial-bundle** budget.

I did **not** improvise additional deferrals to reach the number, did not touch `libs/shared`/`zod` (plan §7), and did not raise any budget.

---

## 12. OUTSTANDING — HUMAN GATE / tester

I did not run the e2e suite; the tester owns it. **Specs I expect to cover these changes:**

| Spec                                                  | Why it covers this batch                                                                                                                                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-electron-e2e/src/specs/setup-wizard/**`    | **Highest-value regression guard.** The wizard is the one surface Batch 4 deliberately left eager. These must still pass unchanged — and they also exercise `SetupWizardStateService` across the (unchanged) wide barrel                      |
| `apps/ptah-electron-e2e/src/specs/settings/**`        | Settings is untouched here but is Unit 6's target next batch — a clean run now is the baseline Batch 5 will be compared against                                                                                                               |
| e2e covering the **tasks board**                      | **Primary gate for Tasks 4.1/4.2/4.4.** Opening the tasks view now triggers a real dynamic import behind the existing spinner. If the 122,867 B chunk fails to resolve, this is where it shows                                                |
| e2e covering **harness builder** and **setup hub**    | **The sharpest single indicator.** Both views resolve from _one_ 41,190 B chunk — if either loader is wrong, or the `/services` barrel dropped a symbol, exactly one of the two will break while the other looks fine. Both must be exercised |
| any spec asserting `harness:open-workflow` navigation | Runtime counterpart to my `HarnessWorkflowMessageHandler` unit assertion, and the one push path that navigates to a now-deferred view                                                                                                         |

**Not required, deliberately**: `specs/perf/startup-tti.spec.ts` — §1f explains why (nothing deferred is startup-reachable). If the reviewer overrides the §1a call and defers the wizard, that decision **must** be paired with a before/after run of that spec in a single session.

**Genuinely outstanding, needs a GUI:**

1. **Manual: tasks board loads and the Kanban populates** (Task 4.5 checklist).
2. **Manual: setup wizard still runs end-to-end** — it is eager, so this is a no-change confirmation, but it is the surface R15 protected.
3. **Manual: harness builder _and_ setup hub both open** — both, because they share one chunk.
4. **DevTools Network confirmation** that the 122,867 B and 41,190 B chunks are **not** fetched on the chat launch path. Static analysis says they cannot be (not preloaded, trigger-gated `resolveWhen`), but that is inference, and R7/R15 both exist because inference is what fails silently here.
5. **Visual check of the `@else` spinner** on the three deferred views. The e2e specs assert settled state; catching a sub-100 ms local-disk spinner reliably needs artificial throttling. Same limitation Batches 2 and 3 recorded.

---

## 13. Notes for Batch 5

- **Start from 2,536,716 B / 523.59 kB. Gap to 2,500,000 B: 36,716 B.** Unit 6 is **required**. Re-measure your own baseline — the concurrent session is still committing (though it did not touch the webview graph this batch).
- **The `modulepreload` baseline for Batch 5 is a 10-entry list**, by size: 636,224 / 223,137 / 109,959 / 89,863 / 39,700 / 17,463 / 16,400 / 15,737 / 162 / 0.
- **All seven lazy-view tokens are now settled**: four deferred (`MARKETPLACE`, `TRIBUNAL`, `HARNESS_BUILDER`, `SETUP_HUB`, `TASKS_VIEW` — five, in fact), and **two deliberately eager on measured/structural R15 grounds** (`ORCHESTRA_CANVAS`, `WIZARD_VIEW`). Both eager ones carry doc comments explaining why. **Do not "finish the job" by deferring them.**
- **The two new narrow barrels are additive-safe.** If Batch 5 needs another service out of `tasks-ui` or `harness-builder`, add it to `services.ts` rather than reaching for the wide barrel — which is now a **lint error** from the webview app (§7), by design.
- **If Batch 5 defers a new lib that also has an eager service, expect the §7 Nx collision** and extend `checkDynamicDependenciesExceptions` with that lib's `/services` specifier only.
- **R15 has now caught three surfaces across three batches** (canvas by measurement, dashboard and setup-wizard by static evidence). For Unit 6 the answer is already known and documented in the plan: settings **is** a launch surface for an unconfigured user. Unit 6 proceeds anyway with `@defer (on immediate)` — that is a deliberate, plan-level exception, not an oversight, and it is the one place in this task where a launch surface is deferred on purpose.
