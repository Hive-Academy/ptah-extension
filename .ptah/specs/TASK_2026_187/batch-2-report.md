# Batch 2 Report — TASK_2026_187

**Batch**: 2 (Units 2 + 3) — `LazyViewService` scaffolding + canvas / marketplace / tribunal → lazy tokens
**Executor**: `frontend-developer`
**Date**: 2026-08-09
**Tree at start**: `0be02e214` | **Tree at end**: `000d0593f` (see §7 — the tree moved under me; the delta is still clean)
**No commit made.** Team-leader verifies and commits.

> ## ⚠️ READ §14 FIRST — the canvas was reverted to eager
>
> **Final state: `ORCHESTRA_CANVAS_COMPONENT` is EAGER. `MARKETPLACE_COMPONENT` and `TRIBUNAL_COMPONENT` are lazy. `LazyViewService` stays.**
>
> **Final initial total: 2,996,828 B / 3.00 MB / 597.46 kB. Final Batch 2 delta: −92,901 B.** Every other total in this document is superseded.
>
> This report is written as a running log across four stages, and the earlier measurements are deliberately preserved because they are the evidence that drove each decision:
>
> | §       | Stage                                                                       |   Initial total |
> | ------- | --------------------------------------------------------------------------- | --------------: |
> | §1–§11  | Canvas + marketplace + tribunal all deferred                                |     2,879,881 B |
> | §12     | `shouldLoadCanvas` extracted and unit-tested (+112 B)                       |     2,879,993 B |
> | §13     | Canvas trigger rule fixed after e2e found a +100 ms TTI regression (−210 B) |     2,879,783 B |
> | **§14** | **Canvas reverted to eager after ~70 ms residual regression**               | **2,996,828 B** |
>
> §1, §6 and §8 describe shipped code as of §12 and are **stale for canvas** — §8's trigger rule was superseded by §13 and then deleted entirely in §14. §2–§5 and §7 are the original measurements, left exactly as taken. **For the code and numbers that actually ship, read §14.**

**Headline**: initial total **3,089,729 B → 2,879,881 B**, a measured **−209,848 B (−209.85 kB)** against my own baseline. That is at the **top of** the 115–204 kB ESTIMATED band, because **`gridstack` did leave** — R10 resolved in the good direction. Initial transfer 594.17 kB → **570.55 kB (−23.62 kB)**.

---

## 1. Files changed

| File                                                              | Change                                                                                    | Unit / Task   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------- |
| `libs/frontend/core/src/lib/tokens/lazy-view-components.token.ts` | MODIFY — add `LazyViewLoader`; flip 3 generics; correct the now-misleading header example | 2.1, 2.4      |
| `libs/frontend/core/src/lib/services/lazy-view.service.ts`        | **CREATE** — `LazyViewService.resolveWhen`                                                | 2.2           |
| `libs/frontend/core/src/lib/services/lazy-view.service.spec.ts`   | **CREATE** — 6 assertions                                                                 | 2.3           |
| `libs/frontend/core/src/lib/services/canvas-load-trigger.ts`      | **CREATE** — pure `shouldLoadCanvas` helper                                               | §12 hardening |
| `libs/frontend/core/src/lib/services/canvas-load-trigger.spec.ts` | **CREATE** — 22 truth-table assertions                                                    | §12 hardening |
| `libs/frontend/core/src/lib/services/index.ts`                    | MODIFY — export `LazyViewService`, `shouldLoadCanvas`, `CanvasRequestState`               | 2.2, §12      |
| `libs/frontend/core/src/index.ts`                                 | MODIFY — export `type LazyViewLoader`                                                     | 2.1           |
| `apps/ptah-extension-webview/src/app/app.config.ts`               | MODIFY — delete 3 static component imports, rewrite 3 providers                           | 2.4           |
| `libs/frontend/chat/.../templates/app-shell.component.ts`         | MODIFY — `lazyViews` field + canvas trigger + 3 rewired fields                            | 2.5           |
| `libs/frontend/chat/.../templates/app-shell.component.html`       | MODIFY — 3 outlet sites; canvas gains its missing `@else` spinner                         | 2.5           |

Nothing else. No `project.json` edit, so no `nx reset` was needed (R12a not exercised).

**I-1 / R2 — honoured.** All three providers are `useValue` with an arrow function. `grep useFactory app.config.ts` returns exactly one hit and it is inside the warning comment.

**I-8 — all five DO-NOT-TOUCH paths clean.** `git status` shows no diff in `libs/shared/src/index.ts`, `app.html`, `app.config.ts:187-189` (`provideMonacoEditor`), `project.json`, `libs/frontend/editor/src/lib/{code-editor,diff-view}/`, or `terminal.component.ts`.
**I-5 / I-7 — untouched.** The three `@xterm/* is not ESM` warnings are still emitted and were not acted on.

---

## 2. Measurement

Both builds: `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache`.
**The before-table below was measured on the tree I actually started from**, per the batch prompt — Batch 1's 3,089,877 B was _not_ used as the starting number. My own baseline came out **148 bytes** below it (one shared chunk, 677,164 vs 677,312), which is consistent with the concurrent session's `libs/shared` edits having already landed before my baseline ran. See §7.

### 2a. BEFORE — initial chunks (my own baseline, 2026-08-09 17:07:17 UTC)

| File                |   Raw (bytes) |         Raw |      Transfer |
| ------------------- | ------------: | ----------: | ------------: |
| `main.js`           |     1,904,251 |     1.90 MB |     353.51 kB |
| `chunk-5XUKD426.js` |       677,164 |   677.16 kB |     143.62 kB |
| `styles.css`        |       276,070 |   276.07 kB |      34.60 kB |
| `chunk-DVG7W4Z4.js` |       146,938 |   146.94 kB |      36.25 kB |
| `scripts.js`        |        48,202 |    48.20 kB |      14.01 kB |
| `polyfills.js`      |        35,726 |    35.73 kB |      11.58 kB |
| `chunk-6F4HVVOU.js` |         1,378 |     1.38 kB |         601 B |
| `chunk-JXTWWDFB.js` |             0 |     0 bytes |       0 bytes |
| **Initial total**   | **3,089,729** | **3.09 MB** | **594.17 kB** |

### 2b. BEFORE — lazy chunks

| File                | Name     | Raw (bytes) |  Transfer | Contents                            |
| ------------------- | -------- | ----------: | --------: | ----------------------------------- |
| `chunk-QLY7YMOB.js` | index    |     539,356 | 101.27 kB | editor components + xterm (Batch 1) |
| `chunk-HG3P62SC.js` | index    |       6,599 |   2.29 kB | `jsonrepair`                        |
| `chunk-6GSFEXD5.js` | services |         320 |     320 B | editor services facade              |

### 2c. AFTER — initial chunks

| File                |   Raw (bytes) |         Raw |      Transfer |
| ------------------- | ------------: | ----------: | ------------: |
| `chunk-WLROVXVZ.js` |     1,067,560 |     1.07 MB |     193.07 kB |
| `chunk-4Y4UWMYX.js` |       637,889 |   637.89 kB |     136.30 kB |
| `main.js`           |       353,475 |   353.48 kB |  **76.22 kB** |
| `styles.css`        |       276,070 |   276.07 kB |      34.60 kB |
| `chunk-3APN2FM4.js` |       272,906 |   272.91 kB |      59.42 kB |
| `chunk-NGG3WE3K.js` |       146,813 |   146.81 kB |      36.17 kB |
| `scripts.js`        |        48,202 |    48.20 kB |      14.01 kB |
| `chunk-P5CAUUS6.js` |        39,700 |    39.70 kB |       8.41 kB |
| `polyfills.js`      |        35,726 |    35.73 kB |      11.58 kB |
| `chunk-6F4HVVOU.js` |         1,378 |     1.38 kB |         601 B |
| `chunk-EPZG6DLQ.js` |           162 |   162 bytes |         162 B |
| `chunk-JXTWWDFB.js` |             0 |     0 bytes |       0 bytes |
| **Initial total**   | **2,879,881** | **2.88 MB** | **570.55 kB** |

### 2d. AFTER — lazy chunks

| File                | Name     | Raw (bytes) |  Transfer | Attributed contents                                         |
| ------------------- | -------- | ----------: | --------: | ----------------------------------------------------------- |
| `chunk-W73NM6G4.js` | index    |     539,414 | 101.23 kB | editor + xterm (Batch 1, unchanged)                         |
| `chunk-NQTWLGP5.js` | —        |  **89,863** |  22.21 kB | **`gridstack` 87.5 kB — NEW** (shared by canvas + tribunal) |
| `chunk-GRPN22JW.js` | index    |  **52,169** |  11.22 kB | **`marketplace` 45.3 + `ui` 5.0 — NEW**                     |
| `chunk-R5PTTUF7.js` | index    |  **46,164** |  11.67 kB | **`tribunal-panel` 44.4 — NEW**                             |
| `chunk-ROENETQZ.js` | index    |  **28,392** |   7.49 kB | **`canvas` 27.0 — NEW**                                     |
| `chunk-HG3P62SC.js` | index    |       6,599 |   2.29 kB | `jsonrepair`                                                |
| `chunk-22G2M2XW.js` | services |         336 |     336 B | editor services facade                                      |

### 2e. Delta

| Metric                      |         Before (mine) |                     After |                       Delta |
| --------------------------- | --------------------: | ------------------------: | --------------------------: |
| **Initial raw**             | 3,089,729 B (3.09 MB) | **2,879,881 B (2.88 MB)** | **−209,848 B (−209.85 kB)** |
| **Initial transfer**        |             594.17 kB |             **570.55 kB** |               **−23.62 kB** |
| Total lazy raw              |             546,275 B |                 762,937 B |                  +216,662 B |
| Budget shortfall vs 2.50 MB |  not met by 589.73 kB |  not met by **379.88 kB** |                  −209.85 kB |

**Expected: ~115–204 kB — ESTIMATED. Actual: −209.85 kB.** Above the top of the band, and the reason is exactly R10: `gridstack` had both of its consumers removed in the same batch, so all 87.5 kB of it left with them. The estimate band's upper bound (204 kB) was canvas 26.8 + marketplace 45.2 + tribunal 44.3 + gridstack 87.8 = 204.1; the extra ~5.7 kB comes from `lib:frontend/editor` in the initial chunks dropping 42.8 → 38.8 kB and from chunk-boundary bookkeeping shifting under the new partition.

**Cumulative**: 3.63 MB (task baseline) → 2.88 MB. **Remaining gap to the 2.50 MB warning threshold: 379,881 B (379.88 kB).**

---

## 3. `main.js` transfer (I-4) — read this section, the metric changed meaning

|                            | `main.js` raw | `main.js` transfer |
| -------------------------- | ------------: | -----------------: |
| Task baseline (pre-Unit-1) |   1,904,251 B |          353.23 kB |
| Batch 1                    |   1,904,251 B |          353.39 kB |
| **My own before**          |   1,904,251 B |      **353.51 kB** |
| **After this batch**       | **353,475 B** |       **76.22 kB** |

**Literally: `main.js` transfer did not grow. It fell by 277.29 kB vs my before and by 277.01 kB vs the 353.23 kB original baseline. I-4 is satisfied on its stated terms.**

**But I am not going to let that number stand as a win, because it is mostly a re-partition, not a reduction.** Removing the three static component imports changed the module graph enough that esbuild re-split the whole eager set. Attribution (§4) shows what moved:

- **Before**, `main.js` was the eager grab-bag: chat 534.9, chat-ui 207.7, skill-synthesis 137.8, tasks-ui 134.4, setup-wizard 108.9, memory-curator 108.8, gridstack 87.8, …
- **After**, `main.js` holds only tasks-ui 134.5 + setup-wizard 108.9 + harness-builder 55.0 + zone.js 35.7 + app 6.3. Everything else moved into `chunk-WLROVXVZ.js` (1.07 MB) and `chunk-3APN2FM4.js` (272.9 kB) — both **initial** and both `modulepreload`ed.

So `main.js` is no longer an apples-to-apples proxy for chat's critical path across the Batch-1/Batch-2 boundary. **The honest comparable is the initial total transfer: 594.17 kB → 570.55 kB, −23.62 kB.** Chat's eager payload genuinely got smaller; it did not merely move. Later batches should track initial-total transfer alongside `main.js`, because `main.js` can now shrink or grow for partitioning reasons that have nothing to do with what the browser actually downloads before chat is interactive.

---

## 4. `modulepreload` diff (R7) — NOT "no new entries"

Batch 1's 4-entry list was the baseline. Chunk hashes are unstable, so entries are identified by size and attributed contents, per the Batch-1 note.

| Before (4 entries)  |    Size | After (8 entries)                                                           |      Size |
| ------------------- | ------: | --------------------------------------------------------------------------- | --------: |
| `chunk-DVG7W4Z4.js` | 146,938 | `chunk-NGG3WE3K.js` — same contents (forms/marked/common)                   |   146,813 |
| `chunk-JXTWWDFB.js` |       0 | `chunk-JXTWWDFB.js` — unchanged                                             |         0 |
| `chunk-5XUKD426.js` | 677,164 | `chunk-4Y4UWMYX.js` — same contents (zod/@angular/core/shared/core)         |   637,889 |
| `chunk-6F4HVVOU.js` |   1,378 | `chunk-6F4HVVOU.js` — unchanged                                             |     1,378 |
| —                   |         | `chunk-WLROVXVZ.js` — **NEW** (chat + thoth libs, split out of `main.js`)   | 1,067,560 |
| —                   |         | `chunk-3APN2FM4.js` — **NEW** (chat-ui + dompurify, split out of `main.js`) |   272,906 |
| —                   |         | `chunk-P5CAUUS6.js` — **NEW** (editor _services_, eager by design, I-3)     |    39,700 |
| —                   |         | `chunk-EPZG6DLQ.js` — **NEW** (162 bytes)                                   |       162 |

**There ARE four new `modulepreload` entries. Stating it plainly rather than claiming "no new entries", because the discipline exists to catch exactly this.** Assessment:

- **All four new entries are `initial` chunks** — every one appears in the §2c table and is already inside the 2,879,881 B total. They are re-partitioned pieces of the old `main.js`, not new work pulled forward.
- Preloaded bytes rose 825,480 → 2,166,408. That is **not** new download: `main.js` ships via `<script src="main.js" type="module">`, which is never `modulepreload`ed. Preload coverage went from 27% of the eager set to 75% of a _smaller_ eager set. Total eager bytes fell by 209,848.
- **The check R7 actually protects passes: none of the five lazy chunks is preloaded.** `chunk-W73NM6G4` (539,414), `chunk-NQTWLGP5` (89,863 — gridstack), `chunk-GRPN22JW` (52,169 — marketplace), `chunk-R5PTTUF7` (46,164 — tribunal), `chunk-ROENETQZ` (28,392 — canvas) all appear in the lazy table and none appears in `index.html`.

**R7 verdict: PASS in substance.** **The `modulepreload` baseline for Batch 3 is now an 8-entry list**, identified by size: 1,067,560 / 637,889 / 272,906 / 146,813 / 39,700 / 1,378 / 162 / 0.

---

## 5. Source-map attribution (Task 2.6 / R10)

`npx nx build … --configuration=production --source-map --skip-nx-cache`, then `node attribute.js` in `dist/apps/ptah-extension-webview/browser`. The source-map build reports a slightly larger initial total (2.92 MB / 579.17 kB) because of the emitted `sourceMappingURL` comments; the canonical measurement is §2. Chunks map 1:1 by size between the two builds.

### Initial chunks AFTER — the four targets are absent from every one

- `chunk-QHNR4HL2.js` (1046.7 kB) — chat 535.8, skill-synthesis-ui 137.8, memory-curator-ui 108.8, chat-streaming 54.8, messaging-gateway-ui 43.9, dashboard 35.7, cron-scheduler-ui 33.0, chat-state 31.0, ui 16.0, workspace-indexing 15.1, chat-routing 9.1, chat-execution-tree 8.9, thoth-shell 5.3
- `chunk-PJ5OWJ4W.js` (653.7 kB) — zod 304.1, @angular/core 141.6, shared 86.6, frontend/core 56.6, lucide-angular 40.8, rxjs 19.4
- `main.js` (343.4 kB) — tasks-ui 134.5, setup-wizard 108.9, harness-builder 55.0, zone.js 35.7, app 6.3
- `chunk-YPKT3PWL.js` (268.7 kB) — chat-ui 208.1, dompurify 25.0, ui 9.0, @floating-ui/\* 16.1, markdown 4.9
- `chunk-OQV5YORX.js` (143.4 kB) — @angular/forms 45.0, marked 40.2, @angular/common 31.8, ngx-markdown 12.5, platform-browser 12.1
- `chunk-RMVFZMZQ.js` (39.0 kB) — frontend/editor **services** 38.8 (eager by design, I-3)

**Zero bytes of `gridstack`, `canvas`, `marketplace` or `tribunal-panel` in any initial chunk.**

### Per-lib verdict

| Owner                                            | Before (Batch 1 attribution) | After                                        | Verdict                               |
| ------------------------------------------------ | ---------------------------- | -------------------------------------------- | ------------------------------------- |
| `lib:frontend/canvas` 26.8 → **27.0 kB**         | initial `main.js`            | **lazy `chunk-AN7MV7BX` / `chunk-ROENETQZ`** | ✅ LEFT the initial chunks            |
| `lib:frontend/marketplace` 45.2 → **45.3 kB**    | initial `main.js`            | **lazy `chunk-STJBGZNT` / `chunk-GRPN22JW`** | ✅ LEFT                               |
| `lib:frontend/tribunal-panel` 44.3 → **44.4 kB** | initial `main.js`            | **lazy `chunk-54HXNWZK` / `chunk-R5PTTUF7`** | ✅ LEFT                               |
| **`npm:gridstack` 87.8 → 87.5 kB**               | initial `main.js`            | **lazy `chunk-KNKUGCZY` / `chunk-NQTWLGP5`** | ✅ **LEFT — R10 resolved favourably** |

`gridstack` landed in its **own** shared lazy chunk rather than being duplicated into the canvas and tribunal chunks — esbuild hoisted the common dependency of the two dynamic imports. That is the ideal outcome: it is downloaded once, by whichever of the two surfaces opens first, and never on the chat launch path. **Verified via the attribution script, not by arithmetic**, as R10 requires.

`lib:frontend/editor` split is unchanged from Batch 1 (144.0 lazy / 38.8 eager — the eager half is `EditorService` + `GitStatusService`, `MESSAGE_HANDLERS` entries that must stay eager per I-3).

---

## 6. Tests

### `npx nx test core`

```
Test Suites: 24 passed, 24 total
Tests:       493 passed, 493 total
```

_(Counts are post-§12-hardening. Before the `shouldLoadCanvas` extraction they were 23 suites / 471 tests.)_

The new `lazy-view.service.spec.ts` is one of the 24. Verified independently with a targeted run so the result is not inferred from an aggregate:

```
npx jest --config libs/frontend/core/jest.config.ts --rootDir libs/frontend/core lazy-view.service.spec --verbose
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

The six assertions, mapped to Task 2.3's required list:

| #   | Assertion                                                                                                                                        | Task 2.3 item                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1   | **does not invoke the loader before the trigger is true** — reads the signal _and_ runs `TestBed.tick()`, then asserts `loader` was never called | **1 — the R3 regression test** |
| 2   | loads exactly once after the trigger goes true                                                                                                   | 2                              |
| 3   | does not load again if the trigger flips true → false → true                                                                                     | 3                              |
| 4   | stays null and does not throw when the token has no provider                                                                                     | 4                              |
| 5   | exposes the resolved `Type<unknown>` once the promise settles (asserts `null` while in flight, i.e. the `@else` spinner is up)                   | 5                              |
| 6   | keeps the signal null and does not throw when the import rejects                                                                                 | extra — failure path           |

Assertion 1 is the one that bites: it reads the returned signal _before_ flushing effects and again after, so a read-gated `computed()` implementation would fail it on the very first `expect(loader).not.toHaveBeenCalled()`.

### `npx nx test chat` (not requested, run because `AppShellComponent` changed)

```
Test Suites: 50 passed, 50 total
Tests:       2 skipped, 658 passed, 660 total
```

### Typecheck and lint

`npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat ptah-extension-webview` — green (3/3).
`npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/chat ptah-extension-webview` — green, **0 errors**, 13 warnings, all pre-existing and none in code I wrote.

---

## 7. Did the tree shift mid-batch? — YES, but not where it matters

`git status --porcelain` was captured before the baseline build and again after the after-build. It differs, and **`HEAD` moved**:

|        | Start       | End             |
| ------ | ----------- | --------------- |
| `HEAD` | `0be02e214` | **`000d0593f`** |

The concurrent session landed one commit during my batch:

```
000d0593f  fix: gate gateway inbound sessions behind configurable permission level
  libs/backend/gateway-chat-bridge/CLAUDE.md
  libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts
  libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts
```

It also staged a batch of `libs/api/**` and `libs/backend/vscode-lm-tools/**` working-tree changes that had previously been unstaged.

**None of that is in the webview bundle.** `libs/backend/**` and `libs/api/**` are backend/license-server code; the frontend↔backend isolation rule in `CLAUDE.md` means they cannot reach `ptah-extension-webview`. Confirmed empirically too — neither appears anywhere in the §5 attribution.

**The one thing that could have contaminated the delta is `libs/shared`, which _is_ eager (86.6 kB in an initial chunk).** I checked file mtimes rather than trusting the `git status` letter (a file can be re-edited and still show ` M`):

| File                                               | Last modified | vs my builds                         |
| -------------------------------------------------- | ------------- | ------------------------------------ |
| `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` | 19:29:56      | **before** my baseline build (20:06) |
| `libs/shared/src/lib/types/task-spec.contract.ts`  | 19:46:53      | **before** my baseline build (20:06) |

No file under `libs/shared`, `libs/frontend` or `apps/ptah-extension-webview` was modified between 20:07 (baseline build finished) and 20:15 (after-build finished) except my own eight files. **The −209,848 B delta is uncontaminated and does not need re-measuring.**

For the record: my own baseline (3,089,729 B) came in 148 bytes under Batch 1's 3,089,877 B, entirely in one shared chunk — consistent with the `libs/shared` edits having already landed before I started. This is exactly why the batch prompt required a fresh baseline; using Batch 1's number would have overstated my delta by 148 bytes.

---

## 8. The canvas trigger (R14) — what I implemented and why it cannot fire during the initial render pass

### The code

`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`

```ts
// Declared BEFORE every field that references this.lazyViews (R11).
private readonly lazyViews = inject(LazyViewService);

private readonly canvasBootstrapLayoutMode = untracked(() =>
  this.appState.layoutMode(),
);

private readonly canvasPastFirstPaint = signal(false);

// Thin delegate — the rule itself is the pure shouldLoadCanvas helper (§12).
private readonly canvasWanted = (): boolean =>
  shouldLoadCanvas(
    {
      session: this.appState.canvasSessionRequest(),
      newSession: this.appState.newCanvasSessionRequest(),
      tab: this.appState.canvasTabRequest(),
    },
    this.layoutMode(),
    this.canvasBootstrapLayoutMode,
    this.canvasPastFirstPaint(),
  );

readonly orchestraCanvasComponent = this.lazyViews.resolveWhen(
  ORCHESTRA_CANVAS_COMPONENT,
  this.canvasWanted,
);
```

`libs/frontend/core/src/lib/services/canvas-load-trigger.ts`

```ts
export function shouldLoadCanvas(requests: CanvasRequestState, layoutMode: LayoutMode, bootstrapLayoutMode: LayoutMode, pastFirstPaint: boolean): boolean {
  if (requests.session !== null || requests.newSession !== null || requests.tab !== null) {
    return true; // (1) explicit request
  }
  if (layoutMode !== 'grid') {
    return false;
  }
  if (bootstrapLayoutMode !== 'grid') {
    return true; // (1) toggled INTO grid
  }
  return pastFirstPaint; // (2) persisted grid, deferred
}
```

and in the constructor:

```ts
afterNextRender(() => {
  const markPainted = (): void => this.canvasPastFirstPaint.set(true);
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(markPainted, { timeout: 2000 });
  } else {
    setTimeout(markPainted, 0);
  }
});
```

### Why it cannot fire during the initial render pass

`canvasBootstrapLayoutMode` is captured in a **field initialiser**, which runs during `AppShellComponent` construction — after `AppStateManager.initializeState()` has already applied the `localStorage` value (`app-state.service.ts:330-335`) and long before any effect runs. For the default and grid-persisted user it is therefore `'grid'`, and the `canvasBootstrapLayoutMode !== 'grid'` branch is dead for exactly the population R14 is about.

That leaves them on `canvasPastFirstPaint()`, which is `signal(false)` and is only ever set from inside an idle callback that is itself scheduled from `afterNextRender`. Two barriers, both structural rather than conventional:

1. `afterNextRender` callbacks run **after** the DOM for the first render has been committed — they cannot run during it, by definition of the hook.
2. The idle callback then yields to the browser, so the signal set (and therefore the `effect` re-run, and therefore `import('@ptah-extension/canvas')`) lands in a **later task** than the one that produced the first paint. The `timeout: 2000` bounds the worst case so a permanently busy main thread cannot starve a grid user of their canvas.

`untracked()` on the bootstrap read matters: without it, a future refactor that moves this into a reactive context would make the constant track `layoutMode` and silently collapse condition 1 into "always true in grid".

**Condition 2 is present and is not optional** — a grid-persisted user gets the canvas with no toggle and no interaction, just after first paint instead of during it. A toggle-only trigger would have stranded them on a permanently empty grid, since grid is already their mode.

Condition 1 covers the paths where the user is demonstrably looking at the canvas: an explicit toggle into grid from a non-grid bootstrap, and the three request signals (`canvasSessionRequest` / `newCanvasSessionRequest` / `canvasTabRequest`, `app-state.service.ts:173,243-247`) that the Tasks board and the sidebar use to push a session into a tile. Those load immediately — no idle wait.

Note on the toggle path: if a **grid**-bootstrap user toggles to single and back to grid, condition 1's branch does not fire (bootstrap _was_ grid), but by then `canvasPastFirstPaint` is long true, so the component is already loaded. There is no hole.

### `[class.hidden]` kept, `@if` NOT introduced

The canvas container still uses `[class.hidden]="layoutMode() !== 'grid'"`. It was **not** converted to `@if (layoutMode() === 'grid')`. `CanvasStore` is `@Injectable()` scoped per `OrchestraCanvasComponent` instance (`canvas.store.ts:41,53`), so an `@if` on layout mode would destroy and rebuild the store — and the user's tiles — on every layout toggle. The `@if` that _is_ there is on the resolved component signal, which is a one-way latch: once `resolveWhen` sets it, it never returns to null, so the component mounts exactly once and then persists across toggles exactly as before.

The canvas outlet gained the `@else` spinner it was missing — it was the only one of the seven without one, and it now needs one for real.

### Second-order behaviour change, stated as the amendment requires

`CanvasStore`'s construction moves from **shell init** to **first canvas activation**. Its construction order relative to `TabManagerService` and to a workspace switch therefore changes. This is the known consequence recorded in the amendment and filed as **TASK_2026_195**; nothing here attempts to address it.

One knock-on worth flagging for the human gate: `AppStateManager.requestCanvasSession()` returns a promise with a **5-second safety timeout** (`app-state.service.ts:495-520`). Previously the canvas was already mounted (hidden) in single mode, so it adopted the tile immediately. Now, on a cold single-mode session, that request triggers a chunk fetch first. From a local `file://` / webview origin this is milliseconds, so the 5s budget is not close to being at risk — but it is a new dependency on chunk-fetch latency that did not exist before, and it is worth watching during the manual pass.

---

## 9. Batch 2 verification checklist (Task 2.6)

| Check                                                                          | Result                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Build green                                                                    | ✅ exit 0                                                                                                                            |
| Initial total in the 2.89–2.98 MB band                                         | ✅ **2.88 MB (2,879,881 B)** — marginally _below_ the band's floor, i.e. better than planned, because gridstack left                 |
| Full initial + lazy chunk table recorded                                       | ✅ §2                                                                                                                                |
| `main.js` transfer not grown (I-4)                                             | ✅ 353.51 → 76.22 kB — but see §3, the metric was re-partitioned; initial-total transfer 594.17 → 570.55 kB is the honest comparable |
| `modulepreload` diff recorded (R7)                                             | ✅ §4 — four new entries, **all initial**; no lazy chunk preloaded                                                                   |
| **`gridstack` absent from every initial chunk, verified by attribution** (R10) | ✅ §5 — it is 87.5 kB of its own shared lazy chunk                                                                                   |
| canvas / marketplace / tribunal left the initial chunks                        | ✅ §5                                                                                                                                |
| `npx nx test core` passes with the new spec                                    | ✅ §6 — 471 tests, and 6/6 in the new spec verified in isolation                                                                     |
| `useValue` arrow, never `useFactory` (I-1/R2)                                  | ✅ §1                                                                                                                                |
| `lazyViews` declared before the fields that use it (R11)                       | ✅ `app-shell.component.ts:161`, first of the token fields at `:223`                                                                 |
| `[class.hidden]` preserved on the canvas container                             | ✅ §8                                                                                                                                |
| Canvas outlet gained its missing `@else` spinner                               | ✅                                                                                                                                   |
| Manual: three surfaces render after a spinner                                  | ❌ **§10**                                                                                                                           |
| Manual: launch-path check in **both** layout modes                             | ❌ **§10**                                                                                                                           |
| Manual: DevTools Performance TTI recording                                     | ❌ **§10**                                                                                                                           |

---

## 10. OUTSTANDING — HUMAN GATE

**None of the manual checks below were performed. Do not read anything above as covering them.** They need a running app with a visible UI and DevTools Network/Performance panels; I have no GUI session. This batch cannot be marked ✅ COMPLETE until a human ticks these.

Run `npm run electron:serve`, then:

1. **[ ] Marketplace renders after a brief spinner.** Open the marketplace view. The `@else` spinner should appear for the duration of the 52 kB chunk fetch, then the hub renders. A permanently spinning surface means `resolveWhen` resolved to null — check the console for the `[LazyViewService] Failed to load` line.
2. **[ ] Tribunal renders after a brief spinner.** Same, 46 kB chunk. Tribunal also pulls the shared 90 kB `gridstack` chunk, so expect **two** network requests here.
3. **[ ] Canvas grid mode renders after a brief spinner**, and **tiles survive a grid → single → grid toggle**. That second half is the `[class.hidden]` guarantee and the thing an `@if` conversion would have broken; it is worth an explicit check because `CanvasStore`'s construction point moved.
4. **[ ] `layoutMode = 'single'` — the real R7 / launch-path gate.** Set `localStorage['ptah-layout-mode'] = 'single'`, reload with DevTools Network open, and confirm **none** of the four new lazy chunks (~90 kB gridstack, ~52 kB marketplace, ~46 kB tribunal, ~28 kB canvas) is fetched on the chat launch path. This is the direct proof that I-1 and I-2 were honoured; per R14 it is only meaningful in single mode.
5. **[ ] `layoutMode = 'grid'` (R14) — the check that a bare trigger would have passed and this one must too.** Set `localStorage['ptah-layout-mode'] = 'grid'`, reload with Network open, and confirm **both**: (a) canvas loads **without any toggle** — a grid user must not be stranded on an empty grid; and (b) the canvas + gridstack chunks are fetched **after** first paint, not during it. Use the Network waterfall against the Performance panel's First Paint marker. Record **time-to-interactive-canvas** for this profile alongside the chat TTI number.
6. **[ ] DevTools Performance TTI recording — still never captured.** Task 1.4 asked for it, Batch 1 did not take it, and I could not. **It is the reference for Task 5.3 and every remaining batch has nothing to compare against until it exists.** Take it on the current tree and name that tree in the file. Note that it can no longer be a "pre-Unit-1" recording — that ship sailed — but §3's numbers mean chat's eager payload has only _decreased_ since the original baseline (initial transfer 694.00 → 570.55 kB), so a recording taken now is a conservative reference.
7. **[ ] Sidebar "open session in tile" from single mode.** Exercises condition 1 of the canvas trigger via `requestCanvasSession`, which now waits on a chunk fetch before the canvas can adopt the tile (see the 5s-timeout note in §8).

### Automated coverage — gap CLOSED (see §12)

The gap flagged here in the first draft — `canvasWanted` (the R14 trigger) having zero CI coverage — **was closed on team-leader instruction before the human gate**, so the checks above test the final code. `shouldLoadCanvas` is now a pure exported helper with 22 truth-table assertions. Full detail, including the two R14-critical named cases and the +112-byte build consequence, is in **§12**.

R14 no longer rests on manual checks 4 and 5 alone. Those checks are still required — a unit test proves the _rule_ is right, not that `afterNextRender` + `requestIdleCallback` actually lands the fetch after paint in a real renderer, which only the DevTools waterfall can show.

---

## 11. Notes for Batch 3

- **`modulepreload` baseline is now an 8-entry list**, identified by size: `1,067,560 / 637,889 / 272,906 / 146,813 / 39,700 / 1,378 / 162 / 0`. Diff against that, not Batch 1's 4-entry list.
- **`main.js` is no longer a stable proxy.** Trace: 353.23 kB (baseline) → 353.39 (Batch 1) → 353.51 (my before) → **76.22 kB** (now), because the eager set was re-partitioned. Track **initial-total transfer** as the primary I-4 signal: 694.00 → 594.17 → **570.55 kB**. Record `main.js` too, but do not read a change in it as a TTI signal without checking where its contents went.
- **Initial total to beat: 2,879,881 B / 570.55 kB. Gap to 2.50 MB: 379,881 B.** Batch 3's ~365 kB estimate would land at ~2.51 MB — i.e. **Batch 3 alone is unlikely to clear the threshold**, and Batch 4 is still needed, exactly as planned.
- **Batch 3's targets are all in `chunk-WLROVXVZ.js` now, not `main.js`**: skill-synthesis-ui 137.8, memory-curator-ui 108.8, messaging-gateway-ui 43.9, dashboard 35.7, cron-scheduler-ui 33.0, thoth-shell 5.3 — 364.5 kB, all in that one 1.07 MB initial chunk. That chunk is the one to watch shrink.
- **Batch 4's targets are what is left in `main.js`**: tasks-ui 134.5, setup-wizard 108.9, harness-builder 55.0 = 298.4 kB. Batch 4 will therefore show up as `main.js` shrinking, which is the one case where a `main.js` delta _is_ meaningful.
- **The lazy-token mechanism is now proven with a measured −209.85 kB behind it.** `LazyViewService` + `useValue` arrow + trigger-gated `resolveWhen` works; Batch 4 can reuse it for the remaining four tokens without re-litigating the design. `LazyViewLoader` is already exported from `@ptah-extension/core`.
- **`gridstack` is gone from the initial bundle and will stay gone** as long as neither canvas nor tribunal is re-imported statically. It has no other consumers.
- `libs/frontend/ui` contributed 5.0 kB into the marketplace lazy chunk — expected duplication of a shared UI primitive across a chunk boundary, not a leak.
- ~~**Final initial total after the §12 hardening is 2,879,993 B**~~ — **superseded by §13.** The final number is **2,879,783 B / 570.57 kB**. Batch 3 measures against that. Gap to 2.50 MB: **379,783 B**.

---

## 12. Post-report hardening — `shouldLoadCanvas` extracted and tested

Done on team-leader instruction after the report was accepted, before the human gate, so the gate exercises the final code.

### What changed

`canvasWanted` in `AppShellComponent` was a private arrow containing the R14 rule inline. The rule is now the pure exported helper **`shouldLoadCanvas`** in `libs/frontend/core/src/lib/services/canvas-load-trigger.ts`, and `canvasWanted` is a thin arrow that reads the four signal values and delegates. Both forms are shown in §8.

**Placement**: `libs/frontend/core/src/lib/services/`, exported from the services barrel. This follows the existing precedent — `idempotent-setters.ts` is already a pure, signal-free helper living in that folder and exported the same way. `LayoutMode`, `CanvasSessionRequest` and `CanvasTabRequest` are all declared in `core`'s `app-state.service.ts`, so the helper types cleanly with no new cross-lib edge; `AppShellComponent` already imports from `@ptah-extension/core`.

**Behaviour-preserving.** The branch order is byte-for-byte the same logic, including the detail that the three requests are checked **before** layout mode — so a canvas request in `single` layout still forces a load, which is what lets the canvas mount and adopt the tile on the sidebar / Tasks-board path. Nothing was "improved" while it was open.

### New test file

`libs/frontend/core/src/lib/services/canvas-load-trigger.spec.ts` — **22 assertions**, all passing.

| Group                               | Cases | Covers                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R14-critical: grid at bootstrap** |     2 | **`(no requests, grid, grid, pastFirstPaint=false) → false`** — the regression test. If the trigger ever collapses back to a bare `layoutMode === 'grid'`, this is the assertion that fails. And **`(…, pastFirstPaint=true) → true`** — the grid-persisted user is never stranded on an empty grid. |
| **R14-critical: toggled into grid** |     2 | `(no requests, grid, single, false) → true` — loads immediately, without waiting for first paint — and stays true afterwards.                                                                                                                                                                        |
| Explicit request forces true        |     6 | Each of `session` / `newSession` / `tab` non-null → true in **both** `single` and `grid` layout, with `pastFirstPaint=false`. The single-layout half is the one that protects the tile-adoption path.                                                                                                |
| Single layout never loads           |     4 | `single` + no request → false for both bootstrap modes and both paint states.                                                                                                                                                                                                                        |
| Full truth table                    |     8 | All 2×2×2 combinations of `layoutMode` × `bootstrapLayoutMode` × `pastFirstPaint` with no requests pending, asserted exhaustively.                                                                                                                                                                   |

The two R14-critical groups are named in the `describe` strings so the intent survives a future edit rather than living only in this report.

### Verification

| Check                                                                                              | Result                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `npx nx test core`                                                                                 | ✅ **24 suites, 493 tests** (was 23 / 471)           |
| `npx nx test chat`                                                                                 | ✅ **50 suites, 658 passed / 2 skipped** — unchanged |
| `npx jest … canvas-load-trigger --verbose`                                                         | ✅ 1 suite, **22 passed**                            |
| `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat ptah-extension-webview` | ✅ 3/3                                               |
| `npx nx run-many -t lint -p …` (same three)                                                        | ✅ 3/3, 0 errors                                     |
| Production build                                                                                   | ✅ green                                             |

### Build re-measurement — NOT byte-identical, +112 B. Reporting it because you asked to be told.

|                          |   Initial total (raw) | Initial transfer |
| ------------------------ | --------------------: | ---------------: |
| Batch 2 as reported      |           2,879,881 B |        570.55 kB |
| **After the extraction** |       **2,879,993 B** |    **570.62 kB** |
| **Delta**                | **+112 B (+0.0039%)** |         +0.07 kB |

**Where the 112 bytes went**, chunk by chunk — only two initial chunks moved at all:

| Chunk (by contents)                              |    Before |     After |                    Delta |
| ------------------------------------------------ | --------: | --------: | -----------------------: |
| chat + thoth libs                                | 1,067,560 | 1,067,548 |                **−12 B** |
| zod / @angular/core / shared / **frontend-core** |   637,889 |   638,013 |               **+124 B** |
| all ten other initial files                      |         — |         — | **0 B** (byte-identical) |

**This is the cost of crossing a chunk boundary, not an import-graph change.** The rule used to be inlined at its single call site inside the chat chunk; it is now a named export in the core chunk, which pays for an export binding, the exported identifier, and the loss of single-call-site inlining. The chat chunk gave back 12 bytes; the core chunk took 124.

Three pieces of evidence that nothing structural moved:

1. **All seven lazy chunks are byte-identical** to the pre-refactor build: 539,414 / 89,863 / 52,169 / 46,164 / 28,392 / 6,599 / 336. Canvas, marketplace, tribunal and gridstack are untouched to the byte — the deferral is exactly as measured in §2 and §5.
2. **`modulepreload` is unchanged**: still the same 8 initial entries at the same sizes, and still no lazy chunk preloaded (R7 holds).
3. **No new library entered the initial set** — the only initial chunk that grew is the one that already contained `lib:frontend/core` (56.6 kB of it), and it grew by 124 B, which is the helper.

I could have kept the total at exactly 2,879,881 B by co-locating the helper next to the component in the chat lib instead. I did not, because the +112 B buys the helper a home in the lib that owns `LayoutMode` and the canvas request types, in the test suite that has the coverage floor, and out of a component file that has no spec — and 112 bytes against a 379,993 B remaining gap is not a trade worth losing that for. Flagging it so the call is yours, not mine by omission: if you want it byte-neutral, moving `canvas-load-trigger.ts` + its spec into `libs/frontend/chat` alongside `app-shell.component.ts` would do it, at the cost of putting the test in the chat suite.

**Net batch delta after §12: 3,089,729 B → 2,879,993 B = −209,736 B (−209.74 kB).** Still above the 115–204 kB estimated band. Every conclusion in §1–§11 stands; only the last three digits of the total changed. _(Superseded again by §13.)_

---

## 13. TTI regression fix — R14 condition 2 replaced

Found by e2e (`apps/ptah-electron-e2e/src/specs/perf/startup-tti.spec.ts`) after §12 landed. **The regression was in the specification, not the implementation** — Batch 2 built R14 condition 2 exactly as the amendment wrote it, and that condition was wrong for one of its two cases.

### The measurement that caught it

Same machine, same session, reload → canvas interactive:

|              |             Median | Runs                                   |
| ------------ | -----------------: | -------------------------------------- |
| Pre-Batch-2  |         **306 ms** | 289, 299, 306, 370, 392                |
| Post-Batch-2 |         **406 ms** | 335, 499, 353, 360, 385, 432, 450, 427 |
|              | **+100 ms (~33%)** |                                        |

Not noise. The three confirmation runs after a full tree restore and rebuild (432, 450, 427) all sit **above the entire pre-change range**, and the paint-timing control metric moved _down_ (404 → 342 ms median), which rules out generic machine load from the concurrent session.

### Root cause — verified in source, not accepted on report

`ElectronShellComponent` calls `setLayoutMode('grid')` **unconditionally** in its constructor (`electron-shell.component.ts:296-299`): _"Electron uses the canvas as its sole chat surface — the single-chat layout was removed."_

The chain, confirmed by reading the files:

1. `app.html:19` renders `<ptah-electron-shell>` in Electron.
2. `ElectronShellComponent` **embeds `<ptah-app-shell>`** (`electron-shell.component.ts:248`, imported at `:48,61`).
3. A parent constructs **before** its child's field initialisers run, so by the time `AppShellComponent` captured `canvasBootstrapLayoutMode`, layout mode was already `'grid'`.
4. Therefore **every Electron launch** took R14 condition 2 — `afterNextRender` → `requestIdleCallback` → _then_ fetch the canvas chunk.

In Electron the canvas **is** the chat surface. There is no chat launch path to protect, so condition 2 was not moving work off the critical path — it was inserting two scheduling hops in front of the only thing the user was waiting for. `context.md`: _"A deferred surface that the user opens immediately is a loss, not a win."_

R14's premise — _"for a grid-persisted user canvas is the launch surface, so deferring it cannot make them faster; the goal for that path is only that it not be worse"_ — was right about the framing and wrong about the conclusion. Deferring did make them worse, by 100 ms.

### The new rule

`shouldLoadCanvas` now branches on **which surface actually opens**, and `pastFirstPaint` is gone from the signature entirely:

```ts
export function shouldLoadCanvas(requests: CanvasRequestState, layoutMode: LayoutMode, bootstrapLayoutMode: LayoutMode): boolean {
  if (requests.session !== null || requests.newSession !== null || requests.tab !== null) {
    return true; // explicit intent, any layout
  }
  if (bootstrapLayoutMode === 'grid') {
    return true; // canvas IS the launch surface — fetch alongside boot
  }
  return layoutMode === 'grid'; // chat launched; only a toggle pulls canvas in
}
```

| `bootstrapLayoutMode` | Launch surface | Canvas behaviour                                                                                                                                                         |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'single'`            | chat           | **Unchanged from Batch 2.** Loads on explicit intent only. This is the half R14 got right, and it is what keeps canvas + `gridstack` (~115 kB) off the chat launch path. |
| `'grid'`              | canvas         | **Changed.** The loader starts immediately at construction, in parallel with the rest of bootstrap. No `afterNextRender`, no `requestIdleCallback`.                      |

The loader still runs through the trigger-gated `resolveWhen` effect, which flushes on the first `ApplicationRef` tick — during bootstrap, before first paint — so the fetch overlaps boot rather than following it.

### Dead code deleted, not left wired to nothing

- `canvasPastFirstPaint` signal — **deleted**
- the `afterNextRender(() => requestIdleCallback(...))` block in the constructor — **deleted**
- the `afterNextRender` import — **deleted** (`untracked` stays; it still guards the bootstrap-mode capture)
- the `pastFirstPaint` parameter of `shouldLoadCanvas` — **deleted**, so no caller can pass a value that no longer means anything

### Unchanged, deliberately

`useValue` arrows (I-1/R2), the trigger-gated `resolveWhen` (I-2/R3), `[class.hidden]` on the canvas container, and condition 1 firing immediately for all three canvas requests in any layout mode.

### Spec rewritten — both critical cases renamed, not edited under old names

`canvas-load-trigger.spec.ts`, **15 assertions** (was 22; the `pastFirstPaint` dimension collapsed, halving the truth table).

| `describe` group                                                             | Cases | Intent preserved in the name                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **grid at bootstrap: canvas IS the launch surface, so it loads immediately** |     2 | The TTI regression test. Named _"is TRUE with no request and no toggle — do NOT delay this, it regresses Electron startup"_, with the 306→406 ms measurement in the doc comment, so the next person cannot re-derive the old behaviour thinking it is an optimisation. |
| **single at bootstrap: chat IS the launch surface, so canvas stays off it**  |     2 | The surviving half of R14. Named _"is FALSE with no request and no toggle — this is what keeps ~115 kB off the chat launch path"_. Fails loudly if anyone makes canvas eager again.                                                                                    |
| explicit request forces TRUE regardless of layout mode                       |     6 | Includes the single-layout half, which protects tile adoption via `requestCanvasSession`.                                                                                                                                                                              |
| full truth table + exhaustive check                                          |     5 | All 2×2 combinations, plus an assertion that `single`/`single` is **the only** non-loading combination.                                                                                                                                                                |

### Verification

| Check                                                                                              | Result                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `npx nx test core`                                                                                 | ✅ **24 suites, 486 tests**              |
| `npx nx test chat`                                                                                 | ✅ **50 suites, 658 passed / 2 skipped** |
| `npx jest … canvas-load-trigger --verbose`                                                         | ✅ 1 suite, **15 passed**                |
| `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat ptah-extension-webview` | ✅ 3/3                                   |
| `npx nx run-many -t lint -p …` (same three)                                                        | ✅ 3/3, **0 errors**                     |
| Production build                                                                                   | ✅ green                                 |

### Build — 2,879,783 B, i.e. **210 bytes smaller**, not unchanged

|                     | Initial total (raw) | Initial transfer |
| ------------------- | ------------------: | ---------------: |
| After §12 hardening |         2,879,993 B |        570.62 kB |
| **After this fix**  |     **2,879,783 B** |    **570.57 kB** |
| **Delta**           |          **−210 B** |         −0.05 kB |

You expected it unchanged and asked to be told if it moved, so: **it moved, downward, and the cause is the deleted plumbing rather than anything structural.** Only two initial chunks changed:

| Chunk (by contents)                          | After §12 | After §13 |                                                                        Delta |
| -------------------------------------------- | --------: | --------: | ---------------------------------------------------------------------------: |
| chat + thoth libs                            | 1,067,548 | 1,067,347 | **−201 B** — `afterNextRender` + `requestIdleCallback` + the signal are gone |
| zod / @angular/core / shared / frontend-core |   638,013 |   638,004 |                      **−9 B** — one fewer parameter and branch in the helper |
| all ten other initial files                  |         — |         — |                                                     **0 B** (byte-identical) |

Evidence nothing structural changed:

1. **All seven lazy chunks are byte-identical** to both prior builds: 539,414 / 89,863 / 52,169 / 46,164 / 28,392 / 6,599 / 336. Canvas, marketplace, tribunal and `gridstack` are still deferred exactly as measured in §2 and §5 — this changed **when** the canvas chunk is fetched, not **whether** it is a chunk.
2. **`modulepreload` unchanged**: still the same 8 initial entries, and still **no lazy chunk preloaded** (R7 holds).
3. No library entered or left the initial set.

**Net batch delta, final: 3,089,729 B → 2,879,783 B = −209,946 B (−209.95 kB).** Still above the 115–204 kB estimated band, and within 98 bytes of the original §2e figure.

### Consequences for the human gate in §10

- **Check 5 is now materially different and must be re-read before it is run.** It previously asked the tester to confirm the canvas chunk is fetched _after_ first paint in grid mode. **That is now the failure condition, not the pass condition.** In grid mode the fetch should start during bootstrap; the tester should be looking for canvas-interactive time back at the ~306 ms pre-Batch-2 median, not for a post-paint fetch.
- **Check 4 is unchanged and is now the load-bearing one.** `layoutMode = 'single'` → none of the four lazy chunks fetched on the chat launch path. That is the batch's actual win and the only case this fix did not touch.
- Checks 1, 2, 3, 6 and 7 are unaffected.
- Per instruction I did not run the e2e suite; the tester re-measures TTI.

---

## 14. CLOSING — canvas reverted to eager; marketplace and tribunal keep the mechanism

The §13 fix recovered only part of the regression. Re-measurement came back at **376.5 ms median** against a 306 ms pre-Batch-2 baseline — a **residual ~50–70 ms (~15–23%) on every Electron launch**. The user weighed the trade with those numbers and decided the canvas comes out of the lazy set.

| Stage                                                        | Electron startup TTI (median) |                 vs pre-Batch-2 |
| ------------------------------------------------------------ | ----------------------------: | -----------------------------: |
| Pre-Batch-2 (canvas eager)                                   |                    **306 ms** |                              — |
| Batch 2 as shipped (R14 condition 2: defer past first paint) |                    **406 ms** |                        +100 ms |
| §13 fix (load immediately when grid is the bootstrap mode)   |                  **376.5 ms** | **+70.5 ms — still regressed** |
| This revert (canvas eager again)                             |          _tester re-measures_ |              expected ≈ 306 ms |

**Why the §13 fix could not fully recover it.** Starting the loader "immediately at construction" still routes the component through a dynamic `import()` — a separate chunk request, module instantiation, and an extra effect/CD round-trip before `*ngComponentOutlet` gets a class. Eager binding has none of that: the class is already in the graph when the field initialiser runs. On the launch path that difference is irreducible, no matter how early the trigger fires. **The conclusion is narrow and worth stating precisely: the launch surface is never a good deferral candidate, and in Electron the canvas is unconditionally the launch surface.**

### What was reverted

| Item                                                     | State                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ORCHESTRA_CANVAS_COMPONENT` generic                     | back to `InjectionToken<Type<unknown>>`                                                                                                    |
| `app.config.ts`                                          | static `import { OrchestraCanvasComponent } from '@ptah-extension/canvas'` restored; provider back to `useValue: OrchestraCanvasComponent` |
| `AppShellComponent.orchestraCanvasComponent`             | back to `inject(ORCHESTRA_CANVAS_COMPONENT, { optional: true }) ?? null`                                                                   |
| Canvas template site                                     | back to `@if (orchestraCanvasComponent)` with the direct outlet                                                                            |
| `canvas-load-trigger.ts` + `canvas-load-trigger.spec.ts` | **deleted**                                                                                                                                |
| `canvasBootstrapLayoutMode`, `canvasWanted`              | **deleted**, along with the now-unused `untracked` and `shouldLoadCanvas` imports                                                          |

Both eager-canvas sites carry a comment recording _why_ they are eager and pointing at the TTI evidence, so the next person does not re-defer it as an obvious win.

### What was kept — deliberately

- **`LazyViewService` + `lazy-view.service.spec.ts` (6 tests)** and the `LazyViewLoader` type. Marketplace and tribunal depend on them, and Batches 4–5 will extend their use to the remaining four tokens.
- **`MARKETPLACE_COMPONENT` and `TRIBUNAL_COMPONENT`** — still `InjectionToken<LazyViewLoader>`, still `useValue` arrows, still resolved through `resolveWhen`. Untouched.
- **The `@else` spinner at the canvas site.** It was missing before this task and is a genuine improvement independent of laziness — it now covers the case where the token is unprovided rather than rendering nothing.
- **`[class.hidden]` on the canvas container**, exactly as it always was.
- The token doc block was corrected to use `MARKETPLACE_COMPONENT` as its deferred-form example (canvas is no longer a valid one) and now states the rule the evidence produced: _only defer a surface the user is not already waiting for._

### Final build

Raw byte sizes are filesystem-measured; transfer figures are esbuild's own estimates.

**Initial chunks**

| File                |   Raw (bytes) |         Raw |      Transfer |
| ------------------- | ------------: | ----------: | ------------: |
| `chunk-YOAZIIF6.js` |     1,156,948 |     1.16 MB |     214.25 kB |
| `chunk-4Y4UWMYX.js` |       637,889 |   637.89 kB |     136.30 kB |
| `main.js`           |       381,034 |   381.03 kB |      81.87 kB |
| `styles.css`        |       276,070 |   276.07 kB |      34.60 kB |
| `chunk-PR3632ML.js` |       272,906 |   272.91 kB |      59.50 kB |
| `chunk-NGG3WE3K.js` |       146,813 |   146.81 kB |      36.17 kB |
| `scripts.js`        |        48,202 |    48.20 kB |      14.01 kB |
| `chunk-P5CAUUS6.js` |        39,700 |    39.70 kB |       8.41 kB |
| `polyfills.js`      |        35,726 |    35.73 kB |      11.58 kB |
| `chunk-6F4HVVOU.js` |         1,378 |     1.38 kB |         601 B |
| `chunk-EPZG6DLQ.js` |           162 |   162 bytes |         162 B |
| `chunk-JXTWWDFB.js` |             0 |     0 bytes |       0 bytes |
| **Initial total**   | **2,996,828** | **3.00 MB** | **597.46 kB** |

**Lazy chunks**

| File                | Name     | Raw (bytes) |  Transfer | Attributed contents                               |
| ------------------- | -------- | ----------: | --------: | ------------------------------------------------- |
| `chunk-W73NM6G4.js` | index    |     539,414 | 101.23 kB | editor components + xterm + addon-webgl (Batch 1) |
| `chunk-FTTTGHXO.js` | index    |      52,169 |  11.20 kB | **marketplace 45.3 + ui 5.0**                     |
| `chunk-YZHQIXUW.js` | index    |      46,131 |  11.65 kB | **tribunal-panel 44.4**                           |
| `chunk-HG3P62SC.js` | index    |       6,599 |   2.29 kB | `jsonrepair`                                      |
| `chunk-22G2M2XW.js` | services |         336 |     336 B | editor services facade                            |

The `gridstack` (89,863 B) and canvas (28,392 B) lazy chunks from §2d are **gone** — their contents returned to the initial set, as expected.

**`modulepreload`** — 8 entries, unchanged in count and composition, **all initial**, and **no lazy chunk preloaded** (R7 still holds):
`chunk-EPZG6DLQ.js` (162) · `chunk-JXTWWDFB.js` (0) · `chunk-P5CAUUS6.js` (39,700) · `chunk-YOAZIIF6.js` (1,156,948) · `chunk-PR3632ML.js` (272,906) · `chunk-NGG3WE3K.js` (146,813) · `chunk-4Y4UWMYX.js` (637,889) · `chunk-6F4HVVOU.js` (1,378)

### Attribution — the confirmation that matters

Run on a `--source-map` build of this exact tree.

| Owner                                             | Location                     | Verdict                                                |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| `npm:gridstack` **88.0 kB**                       | initial `chunk-EGHEALOT.js`  | **BACK in the initial chunks — expected and accepted** |
| `lib:frontend/canvas` **26.8 kB**                 | initial `main.js`            | **BACK in the initial chunks — expected and accepted** |
| `lib:frontend/marketplace` **45.3 kB**            | **lazy** `chunk-YN7QMQBL.js` | ✅ **still absent from every initial chunk**           |
| `lib:frontend/tribunal-panel` **44.4 kB**         | **lazy** `chunk-CBNIDW24.js` | ✅ **still absent from every initial chunk**           |
| `npm:@xterm/*` + `lib:frontend/editor` components | **lazy** `chunk-64KLQV36.js` | ✅ Batch 1's win intact                                |

`gridstack` returning is the R10 mechanic playing out in reverse: it has exactly two consumers, canvas and tribunal, so it only leaves when **both** do. Tribunal alone cannot shed it.

### Final Batch 2 numbers

| Metric                           |                                                       Value |
| -------------------------------- | ----------------------------------------------------------: |
| Batch 2 baseline (my own, §2a)   |                                                 3,089,729 B |
| **Final initial total**          |                       **2,996,828 B (3.00 MB / 597.46 kB)** |
| **Final Batch 2 delta**          |                                   **−92,901 B (−92.90 kB)** |
| Cost of the canvas revert vs §13 |                                                  +117,045 B |
| Predicted by the coordinator     |                                               ≈ 2,997,783 B |
| **Variance vs prediction**       | **−955 B** — within expectation, no investigation warranted |

The −955 B variance is the canvas + gridstack bytes re-merging into existing initial chunks rather than carrying their own chunk-boundary overhead, which the ~118,000 B estimate (derived from standalone lazy-chunk sizes) necessarily included.

**Remaining gap to the 2.50 MB warning threshold: 496,828 B.** Batch 3's ~365 kB estimate no longer clears it alone; Batch 4's ~298 kB is now required to land under, and the two together (~663 kB estimated) still carry margin.

### Verification

| Check                                                                                              | Result                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx test core`                                                                                 | ✅ **23 suites, 471 tests** (was 24/486 — the deleted `canvas-load-trigger.spec.ts` accounted for 1 suite / 15 tests)                                                                                                                                                                                                  |
| `npx nx test chat`                                                                                 | ✅ **50 suites, 658 passed / 2 skipped**                                                                                                                                                                                                                                                                               |
| `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat ptah-extension-webview` | ✅ 3/3                                                                                                                                                                                                                                                                                                                 |
| `npx nx run-many -t lint -p …` (same three)                                                        | ✅ 3/3, **0 errors**                                                                                                                                                                                                                                                                                                   |
| Production build                                                                                   | ✅ green                                                                                                                                                                                                                                                                                                               |
| No dangling references to the deleted helper                                                       | ✅ `grep` for `shouldLoadCanvas` / `CanvasRequestState` / `canvasWanted` / `canvasPastFirstPaint` / `canvasBootstrapLayoutMode` returns nothing in `libs/` or `apps/` **except** `apps/ptah-electron-e2e/src/specs/canvas/canvas-lazy-load.spec.ts`, which is the tester's file and was left untouched per instruction |

### Net effect of Batch 2

**Kept**: the lazy-view mechanism (`LazyViewService`, `LazyViewLoader`, trigger-gated `resolveWhen`, `useValue` arrows), proven and unit-tested, with marketplace and tribunal deferred behind it — **−92,901 B off the initial bundle** and no measured TTI cost, because neither is a launch surface. Batches 4–5 reuse it directly.

**Reverted**: canvas, on measured evidence.

**Learned, and worth carrying into Batch 3**: `@defer`ring or lazy-loading a surface only pays when the user is not already waiting for it. Batch 3's targets (thoth-shell and its four tab libs, dashboard) are reached by explicit navigation and are **not** launch surfaces in either host, so the finding does not threaten them — but Batch 3 should confirm that before assuming it, in the same way this batch had to.

### Human gate — §10 supersedes as follows

- **Check 3** (canvas renders after a spinner) — the spinner no longer appears for a chunk fetch, since there is none. Verify the canvas renders and that tiles survive a grid ↔ single toggle.
- **Check 5** (grid-mode launch-path timing) — **obsolete**, and it is the tester's e2e TTI re-measurement that replaces it.
- **Check 4** is now the single load-bearing network check, narrowed: with the app on chat, confirm the **marketplace and tribunal** chunks are not fetched until those views are opened. Canvas and gridstack are expected in the initial bundle.
- Checks 1, 2, 6 and 7 are unaffected.
