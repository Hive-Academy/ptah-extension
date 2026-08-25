# Batch 1 Report — TASK_2026_187

**Batch**: 1 (Unit 1) — editor barrel → services barrel
**Executor**: `frontend-developer`
**Status**: 🔄 IMPLEMENTED — mechanical verification complete, **manual gate OUTSTANDING**
**Branch**: `ak/license-server-validation-pipe` (no commit made — team-leader commits)

**Headline**: measured initial total **3.09 MB / 594.17 kB** — matches the MEASURED target (3.09 MB / 594.19 kB) to within 20 bytes of transfer. `main.js` transfer **353.39 kB** vs the 353.23 kB baseline (**+0.16 kB**, noise, and _below_ the known-good 353.41 kB). All four manual-gate checks are **outstanding**.

---

## 1. Files changed

| File                                                                 | Action                                              | Task |
| -------------------------------------------------------------------- | --------------------------------------------------- | ---- |
| `apps/ptah-extension-webview/src/app/app.config.ts`                  | MODIFY — line 47 import specifier only              | 1.1  |
| `libs/frontend/editor/package.json`                                  | CREATE                                              | 1.2  |
| `apps/ptah-extension-webview/eslint.config.mjs`                      | MODIFY — added `no-restricted-imports`              | 1.3  |
| `apps/ptah-extension-webview/src/app/editor-message-routing.spec.ts` | MODIFY — **unplanned, forced by Task 1.3** (see §7) | 1.3  |

`git status` at end of batch (the `marketing/scripts/…` entry is pre-existing, not mine):

```
 M apps/ptah-extension-webview/eslint.config.mjs
 M apps/ptah-extension-webview/src/app/app.config.ts
 M apps/ptah-extension-webview/src/app/editor-message-routing.spec.ts
 M marketing/scripts/01-open-source-announcement.md     <- pre-existing, untouched
?? libs/frontend/editor/package.json
```

**Invariants honoured**: I-5 (Monaco untouched — no worker shim, `provideMonacoEditor` at `app.config.ts:187-189` unchanged, `project.json:17-32` asset globs unchanged, no `import type * as monaco` converted), I-7 (the three `@xterm/* is not ESM` warnings still present and **not acted on** — no `allowedCommonJsDependencies`, no ESM fork, no `terminal.component.ts` change), I-8 (`libs/shared/src/index.ts`, `app.html`, and everything under `libs/frontend/editor/src/lib/{code-editor,diff-view,terminal}/` untouched).

### Task 1.1 — the one-line change

```diff
  import {
    provideEditorInternalState,
    EditorService,
    GitStatusService,
- } from '@ptah-extension/editor';
+ } from '@ptah-extension/editor/services';
```

No other line in the file changed. All three symbols resolve from `libs/frontend/editor/src/services.ts:15,21,22`.

### Task 1.2 — `libs/frontend/editor/package.json`

Copied the **`libs/frontend/ui/package.json`** shape as instructed (R9): `name` / `version` / `peerDependencies` / `sideEffects`. **No `main`, no `types`, no `exports` map** — an `exports` map omitting `./services` would have broken the subpath Task 1.1 introduced.

```json
{
  "name": "@ptah-extension/editor",
  "version": "0.0.1",
  "peerDependencies": {
    "@angular/core": "21.2.6",
    "@angular/common": "21.2.6"
  },
  "sideEffects": false
}
```

`name` equals the `project.json` name (`libs/frontend/editor/project.json:2`).

### Task 1.3 — the lint guard

Added inside the existing `files: ['**/*.ts']` rules block of `apps/ptah-extension-webview/eslint.config.mjs`, with a comment recording _why_ the `patterns` group is absent:

```js
'no-restricted-imports': [
  'error',
  {
    paths: [
      {
        name: '@ptah-extension/editor',
        message:
          'Static import of the wide @ptah-extension/editor barrel pulls xterm (~380 kB) into the initial bundle. Use @ptah-extension/editor/services for services, or a runtime import() for components. See TASK_2026_187.',
      },
    ],
  },
],
```

**No `patterns: ['@ptah-extension/editor/*']` group** (R8) — `@ptah-extension/editor/services` stays legal, confirmed by the passing lint run below.

---

## 2. Build measurement

Both builds run with `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache`. The **baseline was re-measured on the clean tree in this session**, not copied from the plan — it reproduced the plan's numbers exactly (3.63 MB / 694.00 kB), so the comparison below is apples-to-apples on this machine.

### Initial chunk files (AFTER)

| File                |         Raw |   Raw (bytes) |      Transfer |
| ------------------- | ----------: | ------------: | ------------: |
| `main.js`           |     1.90 MB |     1,904,251 | **353.39 kB** |
| `chunk-IAAJME6G.js` |   677.31 kB |       677,312 |     143.72 kB |
| `styles.css`        |   276.07 kB |       276,070 |      34.60 kB |
| `chunk-3HAERZ22.js` |   146.94 kB |       146,938 |      36.26 kB |
| `scripts.js`        |    48.20 kB |        48,202 |      14.01 kB |
| `polyfills.js`      |    35.73 kB |        35,726 |      11.58 kB |
| `chunk-6F4HVVOU.js` |     1.38 kB |         1,378 |         601 B |
| `chunk-JXTWWDFB.js` |     0 bytes |             0 |       0 bytes |
| **Initial total**   | **3.09 MB** | **3,089,877** | **594.17 kB** |

### Lazy chunk files (AFTER)

| File                | Name     |           Raw | Raw (bytes) |      Transfer |
| ------------------- | -------- | ------------: | ----------: | ------------: |
| `chunk-TZPGF4YO.js` | index    | **539.36 kB** |     539,356 | **101.00 kB** |
| `chunk-HG3P62SC.js` | index    |       6.60 kB |       6,599 |       2.29 kB |
| `chunk-3SQ5YAYV.js` | services |     320 bytes |         320 |     320 bytes |

### Baseline (BEFORE) — re-measured this session, clean tree

| File                       |                       Raw |      Transfer |
| -------------------------- | ------------------------: | ------------: |
| `main.js`                  |                   1.90 MB |     353.23 kB |
| `chunk-HAMQW4KR.js`        |                 685.72 kB |     136.22 kB |
| `chunk-GZKAFEM7.js`        |                 677.31 kB |     143.75 kB |
| `styles.css`               |                 276.07 kB |      34.60 kB |
| `scripts.js`               |                  48.20 kB |      14.01 kB |
| `polyfills.js`             |                  35.73 kB |      11.58 kB |
| `chunk-6F4HVVOU.js`        |                   1.38 kB |         601 B |
| **Initial total**          | **3.63 MB** (3,628,659 B) | **694.00 kB** |
| _lazy_ `chunk-HG3P62SC.js` |                   6.60 kB |       2.29 kB |
| _lazy_ `chunk-EVUY35PO.js` |                   1.13 kB |         420 B |
| _lazy_ `chunk-FWCFY4EX.js` |                     292 B |         292 B |

### Delta

| Metric             |                Before |                 After |                       Delta |
| ------------------ | --------------------: | --------------------: | --------------------------: |
| Initial raw        | 3,628,659 B (3.63 MB) | 3,089,877 B (3.09 MB) | **−538,782 B (−538.78 kB)** |
| Initial transfer   |             694.00 kB |             594.17 kB |               **−99.83 kB** |
| Largest lazy chunk |               6.60 kB |         **539.36 kB** |                  +532.76 kB |

**Expected (MEASURED by the architect): −540 kB initial / −99.81 kB transfer → 3.09 MB / 594.19 kB.
Actual: −538.78 kB / −99.83 kB → 3.09 MB / 594.17 kB.** Target hit; the 20-byte transfer difference and the 2-byte `main.js` difference are gzip-estimate noise. **No improvisation was needed and none was performed.**

The `sideEffects: false` from Task 1.2 produced **no measurable additional delta** (the architect's pre-measured table was taken without it and the totals agree to within noise). That is expected — it is a regression _guard_, not a size lever, and it is worth keeping on those terms.

### I-4 — `main.js` transfer (the chat-TTI proxy)

|                            |                  Transfer |
| -------------------------- | ------------------------: |
| Baseline                   |                 353.23 kB |
| Known-good measured target |                 353.41 kB |
| **Actual this batch**      |             **353.39 kB** |
| **Growth vs baseline**     | **+0.16 kB (+160 bytes)** |

Within noise, and **below** the known-good measured result. `main.js` raw is byte-identical to baseline (1,904,251 B both). **I-4 satisfied.**

### Build diagnostics (AFTER)

- `bundle initial exceeded maximum budget. Budget 2.50 MB was not met by 589.88 kB with a total of 3.09 MB.` — expected, budget work is Unit 8.
- `message-bubble.component.css … not met by 977 bytes with a total of 10.98 kB` — unchanged from baseline, Task 5.2 owns it.
- `Module '@xterm/xterm' … is not ESM` + `@xterm/addon-fit` + `@xterm/addon-webgl` — **still present, exactly as I-7 predicts. Not acted on.**

---

## 3. `modulepreload` diff (R7) — NOT "no new entries"; read this section

`dist/apps/ptah-extension-webview/browser/index.html`:

| Baseline                        | After                                                  |
| ------------------------------- | ------------------------------------------------------ |
| `chunk-HAMQW4KR.js` (685.72 kB) | — **REMOVED**                                          |
| `chunk-GZKAFEM7.js` (677.31 kB) | `chunk-IAAJME6G.js` (677.31 kB) — same chunk, new hash |
| `chunk-6F4HVVOU.js` (1.38 kB)   | `chunk-6F4HVVOU.js` (1.38 kB) — unchanged              |
| —                               | `chunk-3HAERZ22.js` (146.94 kB) — **NEW**              |
| —                               | `chunk-JXTWWDFB.js` (0 bytes) — **NEW**                |

**There ARE two new `modulepreload` entries.** Stating this plainly rather than claiming "no new entries", because the discipline exists to catch exactly this. Assessment:

- Both new entries are **initial** chunks (they appear in the Initial-chunk table above and are already inside the 3.09 MB total). They are the split remains of the old 685.72 kB `chunk-HAMQW4KR.js`, not new work being pulled forward.
- Net preloaded bytes: **1,364,410 B → 825,628 B, i.e. −538,782 B** — precisely equal to the initial-total delta. Preload got strictly cheaper.
- `chunk-JXTWWDFB.js` is **0 bytes**. It costs one request in dev and is inlined/no-op in practice.
- **The 539.36 kB lazy chunk `chunk-TZPGF4YO.js` is NOT preloaded.** That is the check R7 actually protects, and it passes.

**R7 verdict: PASS in substance.** Flagging the two new entries as a fact for later batches to diff against, since Batch 2's baseline is now a 4-entry list, not a 3-entry list.

---

## 4. Source-map attribution (§2 method, `attribute.js`)

Run: `npx nx build ptah-extension-webview --configuration=production --source-map --skip-nx-cache`, then `node attribute.js *.js.map` in `dist/apps/ptah-extension-webview/browser`.

> Note: the `--source-map` build reports a slightly larger initial total (3.13 MB / 603.06 kB) because of the emitted `sourceMappingURL` comments. The canonical measurement is the non-source-map production build in §2. The source-map build is used **only** for attribution and for the initial/lazy classification below, which it reports itself.

**`chunk-DEXCOL4L.js` — classified LAZY by the build (540.20 kB raw / 101.32 kB transfer):**

| Owner                              |        Bytes |
| ---------------------------------- | -----------: |
| `npm:@xterm/xterm`                 | **281.5 kB** |
| `lib:frontend/editor` (components) | **144.0 kB** |
| `npm:@xterm/addon-webgl`           |  **99.0 kB** |

**Initial chunks after the change:**

- `main.js` (1865.3 kB) — chat 534.9, chat-ui 207.7, skill-synthesis-ui 137.8, tasks-ui 134.4, setup-wizard 108.9, memory-curator-ui 108.8, gridstack 87.8, harness-builder 55.0, chat-streaming 54.9, marketplace 45.2, tribunal-panel 44.3, messaging-gateway-ui 43.9, zone.js 36.5, dashboard 35.7, cron-scheduler-ui 33.0, chat-state 31.0, ui 30.2, canvas 26.8, dompurify 25.3 … **zero xterm bytes**.
- `chunk-QHFYNUAS.js` (692.0 kB) — zod 304.1, @angular/core 141.6, lib:shared 86.4, frontend/core 52.2, **`lib:frontend/editor` 42.8**, lucide-angular 40.8, rxjs 19.4.
- `chunk-BGOMTX5D.js` (143.5 kB) — @angular/forms 44.7, marked 40.2, @angular/common 31.8, ngx-markdown 12.5, @angular/platform-browser 12.1. **zero xterm bytes.**

### Confirmation demanded by the batch prompt

| Owner                                                 | Baseline location           | After                        | Verdict                                                                                                                                                    |
| ----------------------------------------------------- | --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm:@xterm/xterm` (281.5 kB)                         | initial `chunk-HAMQW4KR.js` | **lazy `chunk-DEXCOL4L.js`** | ✅ LEFT the initial chunks                                                                                                                                 |
| `npm:@xterm/addon-webgl` (99.0 kB)                    | initial `chunk-HAMQW4KR.js` | **lazy `chunk-DEXCOL4L.js`** | ✅ LEFT the initial chunks                                                                                                                                 |
| `lib:frontend/editor` — components (143.7 → 144.0 kB) | initial `chunk-HAMQW4KR.js` | **lazy `chunk-DEXCOL4L.js`** | ✅ LEFT the initial chunks                                                                                                                                 |
| `lib:frontend/editor` — services (42.8 kB)            | initial `chunk-GZKAFEM7.js` | initial `chunk-QHFYNUAS.js`  | ✅ **stays eager BY DESIGN (I-3)** — `EditorService` / `GitStatusService` are `MESSAGE_HANDLERS` entries constructed at bootstrap to receive push messages |

Total `lib:frontend/editor` across all chunks is 186.9 kB (baseline 186.5 kB) — the lib did not grow, it split 144.0 lazy / 42.8 eager.

**`@xterm/addon-fit` does not appear at the ≥2 kB reporting threshold in any chunk** — it is small, and it lives with the terminal component in the lazy chunk.

The three pre-existing runtime import sites are intact and now resolve to a real chunk instead of a ~1 kB facade over eager code:

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:306`
- `libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts:91`
- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/lazy-diff-view.component.ts:166`

Corroborating evidence in the lazy table: baseline's two facade chunks (`chunk-EVUY35PO.js` 1.13 kB and `chunk-FWCFY4EX.js` 292 B) collapsed into the single genuine 539.36 kB `chunk-TZPGF4YO.js` plus a 320 B `services` chunk.

---

## 5. Lint (Task 1.3) — and the proof the guard bites

**Final state**: `npx nx lint ptah-extension-webview` → `✔ All files pass linting`.

**Proof the guard bites** (I re-introduced the wide barrel in `app.config.ts`, ran lint, then reverted):

```
D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts
  43:1  error  '@ptah-extension/editor' import is restricted from being used.
               Static import of the wide @ptah-extension/editor barrel pulls xterm
               (~380 kB) into the initial bundle. Use @ptah-extension/editor/services
               for services, or a runtime import() for components. See TASK_2026_187
               no-restricted-imports

✖ 1 problem (1 error, 0 warnings)
NX   Running target lint for project ptah-extension-webview failed
```

Reverted immediately; lint green again. **The narrow subpath `@ptah-extension/editor/services` produces no lint error** — R8 avoided, confirmed by the green run with Task 1.1's import in place.

Additional gate run: `npx nx run-many -t typecheck -p ptah-extension-webview,@ptah-extension/editor` → **green**.

---

## 6. Task 1.2 — `npx nx show projects` confirmation

```
total projects: 93
editor entries: ["@ptah-extension/editor"]
```

`@ptah-extension/editor` resolves and appears **exactly once**. The new `package.json` `name` matches `project.json`, so Nx merged the inferred package into the existing project rather than creating a second one (the R9 failure mode did not occur).

---

## 7. Unplanned change forced by Task 1.3 — flagging for review

The new lint rule immediately caught a **second, pre-existing** static import of the wide barrel that neither the plan nor `tasks.md` knew about:

```
apps/ptah-extension-webview/src/app/editor-message-routing.spec.ts:32
import { EditorService, GitStatusService } from '@ptah-extension/editor';
```

Lint failed on it. I repointed it to `@ptah-extension/editor/services` (both symbols are exported there) rather than adding a spec-file `ignores` exemption, because:

1. The spec's own docblock states its purpose is to wire "the REAL `MessageRouterService` to the REAL `EditorService` and `GitStatusService` **through the same `MESSAGE_HANDLERS` multi-provider registrations `app.config.ts` uses**". After Task 1.1 the faithful mirror of `app.config.ts` **is** the narrow barrel — an `ignores` exemption would have let the spec drift away from the thing it exists to mirror.
2. It keeps the guard maximally strict with no exemptions to erode later.

**This does not affect the measurement** — spec files never enter the production bundle, and the plan's "sole static importer" claim holds for the build graph (the measured −538.78 kB proves it).

**Verified**: `npx jest --config apps/ptah-extension-webview/jest.config.ts --testPathPatterns editor-message-routing` → **5 passed, 1 suite passed**.

That test run is also a useful _mechanical_ (not visual) I-3 data point for this lib: with the narrow barrel in place, the real `MessageRouterService` still instantiates the real `EditorService` and `GitStatusService` from `MESSAGE_HANDLERS` at construction time, and genuine `window` `MessageEvent`s carrying the literal wire strings (`git:status-update`, `file:tree-changed`, `file:content-changed`) still reach their handlers. The narrow barrel did **not** drop a registration for the editor lib.

---

## 8. Remaining gap to 2.50 MB

|                             |                         Bytes |
| --------------------------- | ----------------------------: |
| Initial total after Batch 1 |                     3,089,877 |
| Budget (`2.5mb`, decimal)   |                     2,500,000 |
| **Remaining gap**           | **589,877 bytes (589.88 kB)** |

Matches the plan's projected 589.88 kB exactly. Batch 2's estimated 115–204 kB, Batch 3's ~365 kB and Batch 4's ~298 kB remain sufficient with margin.

---

## 9. Batch 1 verification checklist

| Check                                                                 | Result                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npx nx build … --configuration=production --skip-nx-cache` green     | ✅ exit 0                                                                                                    |
| Initial total 3.09 MB, matching the MEASURED target                   | ✅ 3.09 MB / 594.17 kB vs 3.09 MB / 594.19 kB                                                                |
| Full chunk table recorded (initial + lazy, raw + transfer)            | ✅ §2                                                                                                        |
| `main.js` transfer recorded, not grown beyond noise (I-4)             | ✅ 353.39 kB, +0.16 kB                                                                                       |
| `modulepreload` diff recorded                                         | ✅ §3 — two new entries, both initial, net −538,782 B preloaded, lazy chunk not preloaded                    |
| ~539 kB genuine lazy chunk appeared                                   | ✅ `chunk-TZPGF4YO.js` 539.36 kB / 101.00 kB                                                                 |
| Attribution: xterm + addon-webgl + editor components left initial     | ✅ §4                                                                                                        |
| `npx nx lint ptah-extension-webview` passes                           | ✅                                                                                                           |
| Guard bites on the wide barrel                                        | ✅ §5, error reproduced then reverted                                                                        |
| `npx nx show projects` resolves `@ptah-extension/editor` exactly once | ✅ §6                                                                                                        |
| `@xterm/* is not ESM` warnings still present, not acted on (I-7)      | ✅                                                                                                           |
| Monaco untouched (I-5)                                                | ✅ no diff in `app.config.ts:187-189`, `project.json`, or `editor/src/lib/{code-editor,diff-view,terminal}/` |
| **Manual gate: all four boxes**                                       | ❌ **OUTSTANDING — see §10**                                                                                 |

---

## 10. OUTSTANDING — HUMAN GATE

**None of the four manual checks in Task 1.4 were performed. Do not read anything above as covering them.** They require a running Electron app with a visible UI and DevTools; I have no GUI session, and **the Monaco failure mode is silent** — the diff view renders text normally while add/remove highlighting is gone, so it is not inferable from a green build, a passing test, or an attribution table. This batch **cannot be marked ✅ COMPLETE** until a human ticks these.

Run `npm run electron:serve`, then:

1. **[ ] Monaco diff view shows green/red add-remove highlighting — must be SEEN.**
   Blocking (R1). Unit 1 relocated `DiffViewComponent` and `MonacoLoaderService` into `chunk-TZPGF4YO.js`. Behaviour _should_ be unchanged (Monaco contributes zero bundled bytes and nothing Monaco-related was touched), but "the diff renders text" is **not** a pass — that is precisely the documented failure signature (`apps/ptah-extension-webview/CLAUDE.md:47`). Reach it via a Skills-tab enhance preview (`skill-synthesis-ui` `lazy-diff-view.component.ts`) or the editor panel's diff/split view.
2. **[ ] Terminal opens and is interactive.**
   xterm is CJS and now constructs from a lazy chunk for the first time. Type a command and see output — do not stop at "the panel appears".
3. **[ ] `file-path-link` "open in editor" works.**
   `libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts:91` — one of the three `await import('@ptah-extension/editor')` sites that this unit finally activates for real. Click a file path in a chat message.
4. **[ ] Chat opens and accepts input — AND capture the DevTools Performance TTI baseline recording.**
   **This recording is the reference every later batch is compared against (plan §9.3). If it is not taken now, Batches 2–5 have nothing to compare against and Task 5.3's TTI gate cannot be evaluated.** Save it with the task folder.

**What I _did_ do toward these, stated precisely so it is not mistaken for the gate:**

- Ran `editor-message-routing.spec.ts` (5 tests, pass) — proves the editor **services** still register into `MESSAGE_HANDLERS` and receive real `window` push messages through the narrow barrel. Says **nothing** about Monaco rendering, terminal interactivity, or TTI.
- Confirmed via source-map attribution that the editor components and xterm are in a genuinely lazy chunk that is **not** `modulepreload`ed — which is what makes checks 1–3 necessary, not what satisfies them.
- Confirmed the three runtime `import('@ptah-extension/editor')` call sites are unmodified and structurally intact.

---

## 11. Notes for Batch 2

- **`modulepreload` baseline for Batch 2 is now a 4-entry list**: `chunk-3HAERZ22.js`, `chunk-JXTWWDFB.js`, `chunk-IAAJME6G.js`, `chunk-6F4HVVOU.js`. Diff against that, not the 3-entry Batch-0 list.
- **`main.js` trace so far**: 353.23 kB (baseline) → **353.39 kB** (Batch 1). Batch 2 must not exceed this.
- **`gridstack` (87.8 kB) is still in `main.js`** — confirmed by attribution, as expected. R10 is Batch 2's problem, and canvas (26.8) + tribunal (44.3) + marketplace (45.2) are all still in `main.js` too, so Batch 2's estimate band is unchanged.
- Chunk hashes are unstable across builds (`outputHashing: "none"` but content-derived chunk names). Identify chunks by **size and attributed contents**, not by hash.
- `libs/frontend/editor/services.ts` + `tsconfig.base.json:81-83` is the working template for the narrow barrels in Batches 3 and 4 — it is now proven, with a measured −538.78 kB behind it.

**No commit made.** Team-leader verifies and commits.
