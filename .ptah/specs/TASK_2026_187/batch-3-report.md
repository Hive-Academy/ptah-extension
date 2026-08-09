# Batch 3 report — TASK_2026_187 Unit 4

**Status**: COMPLETE, not committed.
**Headline**: initial total **2,996,828 B → 2,702,149 B (−294,679 B / −294.68 kB)**; transfer **597.46 → 552.76 kB**. Gap to 2,500,000 B: **202,149 B**.
**R15 verdict**: `dashboard` **CAN** open at launch → **NOT deferred**. `thoth-shell` **cannot** → deferred.

---

## 1. THE R15 FINDING — evidence first

R15 required me to establish, _before_ deferring anything, whether `dashboard` or `thoth-shell` can be the surface that opens at launch. The answer differs for the two, so Batch 3 shipped **one** `@defer`, not two.

### 1a. `dashboard` (`analytics`) IS a launch surface — NOT DEFERRED

There is a complete, user-reachable path that boots a fresh webview with the analytics view already selected. Every link verified in source:

| #   | Link                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A contributed, palette- and menu-visible VS Code command exists                         | `apps/ptah-extension-vscode/package.json:42` activation event `onCommand:ptah.openDashboard`; `:115` `contributes.commands` entry; `:153` a `menus` entry — so it is reachable from the UI, not just programmatically                                                                                                         |
| 2   | The command creates a **new panel** with `initialView: 'analytics'`                     | `apps/ptah-extension-vscode/src/core/ptah-extension.ts:125-138` → `await provider.createPanel({ initialView: 'analytics' })`                                                                                                                                                                                                  |
| 3   | The provider forwards it into the generated HTML                                        | `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts:160-169` passes `initialView` to `generateAngularWebviewContent`; `:113` even titles the panel _"Ptah - Session Analytics"_                                                                                                                             |
| 4   | `'analytics'` survives host-side validation and is written to the page                  | `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:106-113` `VALID_VIEWS` **includes `'analytics'`**; `:414-415` emits `window.ptahConfig.initialView`                                                                                                                                                        |
| 5   | The webview sets `currentView` from it **at service construction**, before first render | `libs/frontend/core/src/lib/services/app-state.service.ts:324-327` reads `window.initialView ?? window.ptahConfig.initialView`; `:352-354` `normalizeView(...)` then `this._currentView.set(initialView)`. `normalizeView` (`:226-232`) special-cases **only** `'orchestra-canvas'`, so `'analytics'` passes straight through |
| 6   | A startup effect _also_ navigates there                                                 | `apps/ptah-extension-webview/src/app/app.ts:62-68` `ngOnInit` → `handleInitialView()`; `:100-124` `VALID_VIEWS` **includes `'analytics'`** → `navigationService.navigateToView('analytics')`                                                                                                                                  |
| 7   | That view renders the deferral candidate                                                | `app-shell.component.html:40-44` — `@case ('analytics') { <ptah-dashboard-grid /> }`                                                                                                                                                                                                                                          |

That is a from-scratch Angular bootstrap where the dashboard is exactly what the user is waiting for. It is the same shape as the canvas case R15 was written about, so **`ptah-dashboard-grid` was NOT wrapped in `@defer`.**

I want to be explicit about the one way this differs from the canvas, because it is the reason I flagged it rather than treating it as obvious: the analytics panel is a _separate_ webview from the main chat view, so deferring the dashboard would not have moved chat's TTI at all. But R15's instruction is unconditional — _"If either surface can open at launch, do NOT defer it"_ — and for the `ptah.openDashboard` panel the dashboard genuinely is the launch surface with a user waiting on it. I followed the rule. Since I deferred nothing that can open at launch, `startup-tti.spec.ts` was **not** required and was **not** run.

### 1b. `thoth-shell` is NOT a launch surface — DEFERRED

| Check                                                           | Result                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can `initialView` be `'thoth'`?                                 | **No.** `'thoth'` is absent from **both** allow-lists: `app.ts:100-109` and `webview-html-generator.ts:106-113`. The host generator rejects it; `app.ts:116-122` warns and falls back to `'chat'`                                                                                              |
| Any producer that requests it?                                  | **None.** Repo-wide, the only `createPanel({ initialView: … })` call sites are `'analytics'` (`ptah-extension.ts:129`) and `'orchestra-canvas'` (`:143`). No `'thoth'` anywhere                                                                                                                |
| Electron launch view?                                           | **Always chat.** `apps/ptah-electron/src/activation/post-window.ts:94` sets `initialView: null`; `apps/ptah-electron/src/preload.ts:46` defaults to `'chat'`. `license-watcher.spec.ts:75-76` asserts this ("Open-access boot: initialView is always the chat default")                        |
| Does `ElectronShellComponent` force it, the way it forces grid? | **No.** It calls `setLayoutMode('grid')` (`:299`, `:328`) and `setCurrentView('chat')` (`:329`) / `setCurrentView('settings')` (`:333`). Never `'thoth'`, never `'analytics'`                                                                                                                  |
| Is `currentView` persisted and restored?                        | **No.** `localStorage` in `app-state.service.ts` holds only `ptah-layout-mode` (`:330`, `:475`) and the Thoth first-run-dismissed flag (`:337-344`). `getStateSnapshot()` (`:461`) is never fed back at bootstrap                                                                              |
| `window.ptahPreviousState`?                                     | **Not used for view.** `vscode.service.ts:127-139` `initializeFromGlobals()` reads only `window.vscode` and `window.ptahConfig`                                                                                                                                                                |
| `handleInitialData({ currentView })` (`:410-420`)?              | **Dead path** — zero call sites repo-wide                                                                                                                                                                                                                                                      |
| The auth-redirect effect (`app-shell.component.ts:308-340`)     | Navigates to `'settings'`, and only when `currentView() === 'chat'`. Never to `'thoth'` or `'analytics'`                                                                                                                                                                                       |
| Runtime `switchView` push message                               | Its allow-list (`app-state.service.ts:141-155`) _does_ include `'thoth'`, but the only broadcaster is `apps/ptah-electron/src/services/electron-setup-wizard.service.ts`, which sends `'setup-wizard'` / `'chat'`. This is post-bootstrap explicit navigation regardless, not a launch surface |

`'thoth'` is reachable **only** by an explicit user click on the Thoth tab pill. Deferring it cannot regress startup TTI.

---

## 2. What the plan did not know — the third import edge (the real story of this batch)

The plan modelled two edges into the four Thoth tab libs: the `ThothShellComponent` template edge (cut by `@defer`) and four service imports in `app.config.ts` (cut by narrow barrels). **There is a third**, and it is the one that mattered:

```
libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:16-19
  import { MemoryRpcService }        from '@ptah-extension/memory-curator-ui';    // WIDE
  import { SkillSynthesisRpcService} from '@ptah-extension/skill-synthesis-ui';   // WIDE
  import { CronRpcService }          from '@ptah-extension/cron-scheduler-ui';    // WIDE
  import { GatewayRpcService }       from '@ptah-extension/messaging-gateway-ui'; // WIDE
```

`ThothStatusService` is eager (a `MESSAGE_HANDLERS` entry) and lives in `dashboard`, which R15 forbids deferring. So this single file pinned **all four** Thoth libs into the initial bundle regardless of anything done in `app.config.ts` or the template.

I measured this rather than assuming it. **Step A — `@defer` applied, no barrels:**

|                           |                                              Initial total |
| ------------------------- | ---------------------------------------------------------: |
| Before (source-map build) |                         3.03 MB (over budget by 533.89 kB) |
| Step A: `@defer` alone    | **3.04 MB** (over by 535.24 kB) — **+1.35 kB, i.e. WORSE** |

The `@defer` on its own moved **nothing** and cost a little chunk overhead. That is the empirical proof of the third edge, and it also corrects a stated assumption in the plan and in `tasks.md:65`/`:694` — _"`cron-scheduler-ui` reaches the bundle only through `ThothShellComponent`"_ is **false**; it also reaches it through `ThothStatusService` → `CronRpcService`.

**Fix, same mechanism, one extra application site**: the RPC services were added to the narrow barrels and `thoth-status.service.ts:16-19` repointed to the `/services` subpaths. This also required a **fifth** barrel the plan did not list — `cron-scheduler-ui/src/services.ts` — because `CronRpcService` had no narrow entry point. All four RPC services were verified component-free first (each imports only `@angular/core`, `@ptah-extension/core`, and type-only `@ptah-extension/shared`).

---

## 3. Files changed

**Created**

- `libs/frontend/messaging-gateway-ui/src/services.ts` — `GatewayStateService`, `GatewayRpcService`
- `libs/frontend/skill-synthesis-ui/src/services.ts` — `SkillSynthesisLiveService`, `SkillSynthesisRpcService`
- `libs/frontend/memory-curator-ui/src/services.ts` — `VecEmbedderRecoveryService`, `RecoveryToast`, `MemoryRpcService`
- `libs/frontend/cron-scheduler-ui/src/services.ts` — `CronRpcService` **(not in the plan; required, see §2)**
- `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts` — the R4 gate

**Modified**

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` — `@defer (on immediate)` + spinner `@placeholder` around `<ptah-thoth-shell />` only
- `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts` — 4 imports → `/services` subpaths
- `apps/ptah-extension-webview/src/app/app.config.ts` — 3 imports → `/services` subpaths (gateway, skill-synthesis, memory-curator)
- `tsconfig.base.json` — 4 new `/services` paths

**Deliberately NOT changed**

- `app-shell.component.ts` `imports:` — `DashboardGridComponent` and `ThothShellComponent` both left in place at `:111-112`, as instructed (`@defer` requires the import)
- `ptah-dashboard-grid` in the template — left eager (§1a)
- I-8 DO-NOT-TOUCH list — all five paths clean. TASK_2026_196 not touched.

---

## 4. Measurement

### 4a. BEFORE — initial (my own baseline, `--skip-nx-cache`, 2026-08-09T19:23:42Z)

| File                |       Raw (B) |      Transfer |
| ------------------- | ------------: | ------------: |
| `chunk-YOAZIIF6.js` |     1,156,948 |     214.25 kB |
| `chunk-4Y4UWMYX.js` |       637,889 |     136.30 kB |
| `main.js`           |       381,034 |      81.87 kB |
| `styles.css`        |       276,070 |      34.60 kB |
| `chunk-PR3632ML.js` |       272,906 |      59.50 kB |
| `chunk-NGG3WE3K.js` |       146,813 |      36.17 kB |
| `scripts.js`        |        48,202 |      14.01 kB |
| `chunk-P5CAUUS6.js` |        39,700 |       8.41 kB |
| `polyfills.js`      |        35,726 |      11.58 kB |
| `chunk-6F4HVVOU.js` |         1,378 |         601 B |
| `chunk-EPZG6DLQ.js` |           162 |         162 B |
| `chunk-JXTWWDFB.js` |             0 |           0 B |
| **Initial total**   | **2,996,828** | **597.46 kB** |

**This is byte-identical to Batch 2's closing number (2,996,828 B).** The tree had not moved under the webview.

### 4b. BEFORE — lazy

| File                |     Raw (B) |  Transfer |
| ------------------- | ----------: | --------: |
| `chunk-W73NM6G4.js` |     539,414 | 101.23 kB |
| `chunk-FTTTGHXO.js` |      52,169 |  11.20 kB |
| `chunk-YZHQIXUW.js` |      46,131 |  11.65 kB |
| `chunk-HG3P62SC.js` |       6,599 |   2.29 kB |
| `chunk-22G2M2XW.js` |         336 |     336 B |
| **Lazy total**      | **644,649** |           |

### 4c. AFTER — initial

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

### 4d. AFTER — lazy

| File                |     Raw (B) |  Transfer |                           |
| ------------------- | ----------: | --------: | ------------------------- |
| `chunk-U5HE5I7E.js` |     539,414 | 101.25 kB | editor (Batch 1)          |
| `chunk-EFFTIVBS.js` |     302,515 |  57.86 kB | **NEW — the Thoth group** |
| `chunk-HE2KTRIK.js` |      52,202 |  11.24 kB | marketplace               |
| `chunk-JCHRN5TN.js` |      46,192 |  11.68 kB | tribunal                  |
| `chunk-HG3P62SC.js` |       6,599 |   2.29 kB |                           |
| `chunk-B6GDESL2.js` |         336 |     336 B |                           |
| **Lazy total**      | **947,258** |           |                           |

### 4e. Delta

| Metric                                        |      Before |           After |                           Δ |
| --------------------------------------------- | ----------: | --------------: | --------------------------: |
| **Initial total (raw)**                       | 2,996,828 B | **2,702,149 B** | **−294,679 B (−294.68 kB)** |
| **Initial total (transfer)** — primary signal |   597.46 kB |   **552.76 kB** |               **−44.70 kB** |
| Lazy total (raw)                              |   644,649 B |       947,258 B |                  +302,609 B |
| Gap to 2,500,000 B                            |     496,828 |     **202,149** |                    −294,679 |

**Actual vs expected**: expected **~365 kB (ESTIMATED)**; actual **−294.68 kB**. The ~70 kB shortfall is fully accounted for and was a deliberate, evidence-backed choice, not a miss:

- **−35.7 kB** never available: `dashboard` was not deferred (R15, §1a).
- **~−19.8 / −9.7 / −9.0 kB** deliberately retained: the eager `MESSAGE_HANDLERS` + RPC service residue that I-3 _requires_ stay in the initial bundle.
- **+5.8 kB**: `@angular/core` grew (the `@defer` runtime machinery).

Build is **green**. Budget warning is now _"not met by 202.15 kB"_, down from _"not met by 496.83 kB"_. Reproduced twice with identical hashes and byte sizes.

### 4f. `main.js` — recorded, NOT interpreted as TTI

|        |       Raw |     Transfer |
| ------ | --------: | -----------: |
| Before | 381,034 B |     81.87 kB |
| After  | 381,133 B |     81.89 kB |
| Δ      | **+99 B** | **+0.02 kB** |

Noise. Per the brief, `main.js` is no longer a valid I-4 proxy — Batch 3's targets never lived in it (they were in the 1.16 MB `chunk-YOAZIIF6.js`, which is now gone, replaced by the 725.9 kB `chunk-XOTFZ7YS.js`). **Initial-total transfer, 597.46 → 552.76 kB, is the signal, and it fell.**

---

## 5. `modulepreload` diff (R7) — identified by size and attributed contents, not hash

Baseline is my own 8-entry BEFORE list (Batch 2 §11's sizes were pre-canvas-revert and no longer match).

| Before (8)       |      Size | After (10)       |    Size | Identity                                                                                                           |
| ---------------- | --------: | ---------------- | ------: | ------------------------------------------------------------------------------------------------------------------ |
| `chunk-YOAZIIF6` | 1,156,948 | `chunk-XOTFZ7YS` | 725,948 | same role, shrunk by the Thoth split                                                                               |
| `chunk-4Y4UWMYX` |   637,889 | `chunk-3AJTUKQV` | 643,865 | zod / @angular/core / shared / core                                                                                |
| `chunk-PR3632ML` |   272,906 | `chunk-WNZMNKTK` | 241,768 | chat-ui                                                                                                            |
| `chunk-NGG3WE3K` |   146,813 | `chunk-OW4MB5WX` | 146,813 | forms / marked / common — unchanged                                                                                |
| `chunk-P5CAUUS6` |    39,700 | `chunk-3RGT2QIX` |  39,700 | editor _services_, eager by design (I-3)                                                                           |
| `chunk-6F4HVVOU` |     1,378 | —                |       — | **dropped from preload** (still an initial chunk)                                                                  |
| `chunk-EPZG6DLQ` |       162 | `chunk-LW5LSEOG` |     162 | unchanged                                                                                                          |
| `chunk-JXTWWDFB` |         0 | `chunk-JXTWWDFB` |       0 | unchanged                                                                                                          |
| —                |           | `chunk-5H5O23XF` | 109,959 | **NEW** — dashboard 35.8 + chat-state 31.0 + the eager Thoth service residue (skill 19.8, gateway 9.7, memory 9.0) |
| —                |           | `chunk-C6VKIUHV` |  30,767 | **NEW** — dompurify 24.6 + markdown 4.9                                                                            |
| —                |           | `chunk-AAZHQEUL` |  20,658 | **NEW** — workspace-indexing 15.2 + ui 4.5                                                                         |

**There ARE three new `modulepreload` entries. Stating it plainly rather than claiming "no new entries."** All three are **initial** chunks — each appears in the §4c table and is already inside the 2,702,149 B total. They are re-partitioned pieces of the old eager set, not new work pulled forward.

**The check R7 actually protects: PASS.** None of the six lazy chunks (539,414 / 302,515 / 52,202 / 46,192 / 6,599 / 336) appears in `index.html`. In particular **the new 302,515 B Thoth chunk is not preloaded** — it is genuinely deferred.

Total preloaded bytes fell **2,255,796 → 1,959,640 (−296,156 B)**.

---

## 6. Per-lib attribution (Task 3.3) and the R6 keep/drop calls

Source-map attribution over the full initial set, before vs after.

| Lib                    | BEFORE (initial) | AFTER (initial) |          Δ | Verdict                          |
| ---------------------- | ---------------: | --------------: | ---------: | -------------------------------- |
| `skill-synthesis-ui`   |         137.8 kB |         19.8 kB | **−118.0** | barrel **KEEP**                  |
| `memory-curator-ui`    |         108.9 kB |          9.0 kB |  **−99.9** | barrel **KEEP**                  |
| `messaging-gateway-ui` |          43.9 kB |          9.7 kB |  **−34.2** | barrel **KEEP**                  |
| `cron-scheduler-ui`    |          33.0 kB |      **absent** |  **−33.0** | barrel **KEEP** (new, unplanned) |
| `thoth-shell`          |           5.3 kB |      **absent** |   **−5.3** | `@defer`                         |
| `dashboard`            |          35.7 kB |         35.8 kB |   **+0.1** | barrel **DROP**                  |
| `ui` (bonus)           |          25.0 kB |         18.1 kB |       −6.9 | follows the Thoth components out |
| `@angular/core`        |         142.5 kB |        148.3 kB |       +5.8 | `@defer` runtime                 |

**`cron-scheduler-ui` and `thoth-shell` are absent from every initial chunk** — the clean indicator Task 3.3 asked for. Both are in the new lazy chunk, which attributes to exactly the expected set:

```
=== chunk-EFFTIVBS.js (296.6 kB) ===
   117.8 kB  skill-synthesis-ui
    99.9 kB  memory-curator-ui
    34.2 kB  messaging-gateway-ui
    31.1 kB  cron-scheduler-ui
     6.7 kB  ui
     5.3 kB  thoth-shell
```

The 19.8 / 9.7 / 9.0 kB left behind in the initial set are the services I-3 **requires** stay eager (the `MESSAGE_HANDLERS` entries plus the RPC services `ThothStatusService` calls). That residue is correct, not a leak.

### R6 — `dashboard` barrel DROPPED, with the numbers

I built `libs/frontend/dashboard/src/services.ts`, added its `tsconfig.base.json` path, repointed `app.config.ts`, and measured: **dashboard 35.7 kB → 35.8 kB. Zero benefit.** The cause is structural, not tree-shaking: because R15 forbids deferring the analytics view, `DashboardGridComponent` stays a static template dependency via `AppShellComponent.imports`, so the whole lib is eager no matter which specifier `app.config.ts` uses.

Per R6 I did not carry dead scaffolding. **Deleted** `libs/frontend/dashboard/src/services.ts`, **removed** the `@ptah-extension/dashboard/services` tsconfig path, and **reverted** the `app.config.ts` import to the wide barrel, with a comment recording the measurement so the next person does not re-derive it. Confirmed a true no-op: the build after the drop is byte-for-byte the same over-budget figure (238.19 kB, source-map build) as the build with it.

The other four barrels are demonstrably load-bearing — this is not the `/*@__PURE__*/` no-op case R6 warned might occur.

---

## 7. R4 — the `MESSAGE_HANDLERS` assertions (BLOCKING gate)

New spec: **`apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts`** — **14 tests, all passing**, modelled on the `editor-message-routing.spec.ts` precedent.

**Method.** It wires the **real** `MessageRouterService` to the **real** services through the **same `useExisting` `MESSAGE_HANDLERS` registrations `app.config.ts` uses**, imports each service through the **same narrow-barrel specifier production now takes**, then dispatches genuine `window` `MessageEvent`s carrying hard-coded literal wire strings and asserts an observable state change. It never instantiates `ThothShellComponent` or any Thoth tab component — reproducing exactly R4's condition: **app on chat, Thoth never opened**.

Two structural properties make it a real gate rather than a restatement of the provider list:

1. If a narrow barrel ever stops exporting one of the four, the spec **fails to compile**.
2. `MessageRouterService` builds its handler map in its constructor by reading `handledMessageTypes` off every registered handler, so a dropped or unresolvable registration **throws at `TestBed.inject`**.

| Service                      | Message dispatched (literal wire string)      | Observable effect asserted                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GatewayStateService`        | `gateway:bindingsChanged`                     | `bindings()` goes `[]` → length 1 with `id === 'binding-delivered'`                                                                                                                                |
| `SkillSynthesisLiveService`  | `skillSynthesis:event` (`curator-pass-start`) | `activity()` goes `null` → `'Curator analyzing candidates…'`                                                                                                                                       |
| `VecEmbedderRecoveryService` | `db:vecStatusChanged`                         | `vecDiagnostic()` goes `null` → `{ok:true,…}`, and `vecAvailable()` → `true`                                                                                                                       |
| `VecEmbedderRecoveryService` | `embedder:statusChanged`                      | `embedderReady()` → `true`, `embedderDownloading()` → `false`                                                                                                                                      |
| `ThothStatusService`         | `gateway:statusChanged`                       | `summary().gateway.available` goes `false` → `true` with a non-empty `platforms` array                                                                                                             |
| **fan-out**                  | one `gateway:statusChanged`                   | reaches **both** subscribers in one dispatch: `ThothStatusService.summary().gateway.available === true` **and** `GatewayStateService.platforms()['telegram'].state` goes `'stopped'` → `'running'` |

That last case is the one I'd point at: `gateway:statusChanged` has two independent subscribers, so a half-dropped registration would still look fine from one side. It is asserted from both.

Also pinned: the five `MESSAGE_TYPES` constants are asserted against hard-coded literals, so an edit to a shared constant fails the spec rather than silently agreeing with itself.

**All four services ticked, each by dispatch-and-observe, not by provider-list inspection.**

- [x] `GatewayStateService`
- [x] `SkillSynthesisLiveService`
- [x] `VecEmbedderRecoveryService`
- [x] `ThothStatusService`

---

## 8. Did the tree shift mid-batch? — YES at HEAD, NO in the webview graph

**It shifted.** `HEAD` moved during the batch: `05ec1ed50` → **`5e5b82e61`** (_"fix: replace stderr-pattern provider-error abort with a no-activity watchdog"_), and `libs/backend/agent-sdk/.../session-query-executor.service.ts` still shows `MM` — the concurrent session is still working.

**It did not touch anything Batch 3 measures.** Checked by mtime, not by the `git status` letter:

- `git show --stat 5e5b82e61` — **all 12 files are under `libs/backend/agent-sdk/`**. Zero frontend, zero shared, zero webview.
- mtimes under `libs/shared`, `libs/frontend`, `apps/ptah-extension-webview`: the newest non-mine are **21:44 and 21:21 local**, both Batch 2's committed work. My baseline build ran at 19:23 UTC = **22:23 local**, and every file newer than that is one of my own six edits (22:27–22:39). **Nothing in the measured graph changed between my before-build and my after-build.**
- Strongest evidence: my independently measured before-baseline came out **byte-identical to Batch 2's closing 2,996,828 B**.
- `libs/frontend` never imports `@ptah-extension/agent-sdk` — the only two grep hits are prose in code comments.

So the −294,679 B is attributable to this batch alone.

---

## 9. Test / typecheck / lint gates

| Gate                            | Command                                                                                                                                                                    | Result                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`                          | `npx nx test core`                                                                                                                                                         | ✅ **23 suites, 471 tests** (matches the post-canvas-revert count; Batch 2's 24/493 included `canvas-load-trigger.spec.ts`, deleted in the §13 revert) |
| `chat`                          | `npx nx test chat`                                                                                                                                                         | ✅ **50 suites, 658 passed / 2 skipped** — unchanged                                                                                                   |
| webview (incl. the new R4 spec) | `npx nx test ptah-extension-webview`                                                                                                                                       | ✅ **3 suites, 14 tests**                                                                                                                              |
| Typecheck                       | `nx run-many -t typecheck` over core, chat, dashboard, memory-curator-ui, skill-synthesis-ui, cron-scheduler-ui, messaging-gateway-ui, thoth-shell, ptah-extension-webview | ✅ **9/9**                                                                                                                                             |
| Lint                            | `nx run-many -t lint` over the 7 touched projects                                                                                                                          | ✅ **7/7, 0 errors** (pre-existing `explicit-member-accessibility` warnings only)                                                                      |
| Build                           | `nx build … --configuration=production --skip-nx-cache`                                                                                                                    | ✅ green, reproduced twice with identical hashes                                                                                                       |

One lint error was introduced and fixed during the batch (an unused `AppStateManager` import in my new spec).

`npx nx reset` was **not** run — I made no `project.json` edit, so I-6/R13 does not apply to this batch. Unit 8 (Batch 5) still needs it, and R12a's Windows sequence still stands.

---

## 10. Invariant compliance

| Invariant                          | Status                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| I-1 `useValue` not `useFactory`    | N/A — Batch 3 introduced no token providers                                                        |
| I-2 `resolveWhen` trigger-gated    | N/A — untouched                                                                                    |
| I-3 services eager, components not | ✅ §7. All four services eager and receiving; residue visible in the initial attribution           |
| I-4 chat critical path             | ✅ initial transfer 597.46 → 552.76 kB. `main.js` +99 B (noise), recorded not interpreted          |
| I-5 Monaco untouched               | ✅ no change to `app.config.ts:187-189`, asset globs, or `editor/src/lib/{code-editor,diff-view}/` |
| I-6 `nx reset` before budget check | N/A — no `project.json` edit                                                                       |
| I-7 xterm CJS warnings unactioned  | ✅ all three still emitted; no `allowedCommonJsDependencies`                                       |
| I-8 DO-NOT-TOUCH                   | ✅ all five paths clean; TASK_2026_196 not touched                                                 |
| I-9 restore `maximumError`         | Batch 5, not this batch                                                                            |

---

## 11. OUTSTANDING — HUMAN GATE / tester

I did not run the e2e suite; the tester owns it. **Specs I expect to cover these changes:**

| Spec                                                           | Why it covers this batch                                                                                                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-electron-e2e/src/specs/thoth/memory.spec.ts`        | **Primary gate for Task 3.1.** Opening the Thoth tab now triggers a real dynamic import behind a spinner. If the `@defer` chunk fails to resolve, this fails                                                                            |
| `.../thoth/skills.spec.ts`                                     | Same, for the Skills tab — the largest lib in the deferred chunk (117.8 kB)                                                                                                                                                             |
| `.../thoth/cron.spec.ts`                                       | **The sharpest single indicator.** `cron-scheduler-ui` now reaches the app _only_ through the deferred chunk. If the `@defer` edge or the `CronRpcService` barrel is wrong, this is where it shows                                      |
| `.../thoth/gateway.spec.ts`                                    | Gateway tab through the deferred chunk, plus `GatewayStateService`/`GatewayRpcService` across the barrel split                                                                                                                          |
| `.../thoth/skill-telemetry.spec.ts`                            | Live skill-synthesis push events — the runtime counterpart to my `SkillSynthesisLiveService` unit assertion                                                                                                                             |
| `apps/ptah-electron-e2e/src/specs/dashboard/dashboard.spec.ts` | **Regression guard for the §2 repoint.** `ThothStatusService` now imports all four RPC services through new subpaths; the dashboard status card is what breaks if one resolves wrong. Also confirms analytics still renders **eagerly** |

**Not required, deliberately**: `specs/perf/startup-tti.spec.ts`. Batch 3 deferred nothing that can open at launch (§1), so there is no startup-TTI hypothesis to test. If the reviewer disagrees with the §1a call and wants the dashboard deferred after all, that decision **must** be paired with a before/after run of that spec in a single session.

**Genuinely outstanding, needs a GUI:**

1. **Visual check of the new `@placeholder` spinner** on the Thoth tab. The e2e specs assert settled state, not the transient spinner frame; catching a sub-100 ms local-disk spinner reliably needs artificial throttling. Same limitation Batch 2 recorded.
2. **DevTools Network confirmation** that the 302,515 B Thoth chunk is **not** fetched on the chat launch path. Static analysis says it cannot be (not preloaded, `@defer` inside an inactive `@case`), but that is inference, and R7/R15 both exist because inference is what fails silently here.

---

## 12. Notes for Batch 4

- **Start from 2,702,149 B / 552.76 kB. Gap to 2,500,000 B: 202,149 B.** Batch 4's ~298 kB estimate (tasks-ui 134.5 + setup-wizard 108.9 + harness-builder 55.0) clears it with ~96 kB of margin. Re-measure your own baseline — the concurrent session is still committing.
- **Batch 4's targets are still in `main.js`**, so a `main.js` delta _will_ be meaningful there — the one case where it is.
- **Apply the §2 lesson before estimating.** A wide-barrel import in `app.config.ts` is not necessarily the only edge. Before assuming a narrow barrel will shed a lib, grep for **every** external importer of that wide barrel (`grep -rn "from '@ptah-extension/<lib>'"`, excluding the lib's own internals and `dist`). For Batch 4's three targets, any eager consumer — `AppShellComponent`, dashboard, chat — will pin the lib exactly as `ThothStatusService` did here.
- **Run the R15 check for `tasks-ui`, `setup-wizard`, `harness-builder`.** Two of them are known launch-reachable: `'setup-wizard'` is in **both** `initialView` allow-lists (`app.ts:106`, `webview-html-generator.ts:112`), and `settings`/`setup-wizard` is the first-run surface via the auth-redirect effect. `'tasks'` and `'harness-builder'` are **not** in either allow-list. Note the two lists are **not identical** — `app.ts` also permits `'orchestra-canvas'` and `'tribunal'`; the host generator does not. Check the one that matters for the path you care about.
- **The `modulepreload` baseline for Batch 4 is a 10-entry list**, by size: 725,948 / 643,865 / 241,768 / 146,813 / 109,959 / 39,700 / 30,767 / 20,658 / 162 / 0.
- **The four narrow barrels are additive-safe.** If Batch 4 needs another service out of these libs, add it to `services.ts` rather than reaching for the wide barrel.
- **Consider an eslint guard.** Batch 1 added a `no-restricted-imports` rule for `@ptah-extension/editor`. There is now no guard stopping someone from re-adding a wide-barrel import of any of these four libs from eager code — which is precisely the §2 regression, and it would be silent. Out of Batch 3's scope; worth a line in Batch 5. If added, ban only the **bare** specifier (R8) — the `/services` subpaths must stay legal.
