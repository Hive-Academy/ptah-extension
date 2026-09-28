# Lazy-load gate — TASK_2026_494, Batch 19 / Task 19.1

Plan reference: implementation-plan.md:278-302 (D7). Validation notes: A3 (stats-json
verification), R8 (zod/new-lib leak risk).

## Environment note (report of what was done)

Neither worktree ships a populated `node_modules/` — both have only an (empty or
near-empty) `node_modules` directory, relying on Node's ancestor-directory module
resolution to reach `D:\projects\ptah-extension\node_modules` for ordinary bare-specifier
imports (this is what makes `nx`, the Angular build executor, jest and tsc run at all from
inside a worktree). That resolution does **not** cover the literal
`"node_modules/prismjs/..."`, `"node_modules/daisyui/..."` and `"node_modules/monaco-editor/..."`
path strings that `apps/ptah-extension-webview/project.json` uses in its `styles`, `scripts`
and `assets` arrays — esbuild resolves those relative to the workspace root it is invoked
from, i.e. the worktree root, and fails with `Could not resolve` when that root has no real
`node_modules`. This reproduced identically with `NX_DAEMON=false` (ruled out the nx daemon
as the cause) in both worktrees.

Fix applied (no source, spec or config file touched): created Windows directory junctions
for the specific packages the build/test targets need, pointing at the real
`D:\projects\ptah-extension\node_modules` packages:
- Both worktrees: `node_modules/prismjs`, `node_modules/daisyui`, `node_modules/monaco-editor`
  (needed by the webview production build).
- Feature worktree only: `node_modules/electron`, `node_modules/better-sqlite3` (needed by
  `ptah-electron`'s `shell-csp.spec.ts` and `better-sqlite3-packaging.spec.ts`, which read
  `node_modules/electron/package.json` / `path.txt` and spawn the real Electron binary).

These are junctions to existing packages already installed at the repo root, not new
dependencies, and nothing under `dist/` or these junctions was committed. No `.ts`, `.json`
(config) or spec file was edited in either worktree.

## Builds

Command (both trees, both `--stats-json` since `apps/ptah-extension-webview/project.json`
has no `statsJson` build option — A3 fallback, confirmed by reading the project.json build
target before running):

```
npx nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json
```

Both builds succeeded on the first attempt once the package junctions above existed (no
`NX_DAEMON=false` retry was needed for either tree after that).

### Feature branch (`feat/task-494-apps-page`, HEAD `9cc979b0660ca24b7b09a00955ad8a7d4eca102f`)

`dist/apps/ptah-extension-webview/stats.json` produced (1.3 MB).

| Initial chunk file | Names | Raw size | Transfer size |
| --- | --- | --- | --- |
| main.js | main | 1.60 MB (1,597,026 B) | 307.39 kB |
| chunk-BQRBkKFl.js | - | 696.92 kB (696,917 B) | 174.52 kB |
| chunk-B4tGni_2.js | - | 428.87 kB (428,869 B) | 78.40 kB |
| chunk-qPSlMJlB.js | - | 302.56 kB (302,557 B) | 61.49 kB |
| styles.css | styles | 263.21 kB (263,207 B) | 30.23 kB |
| scripts.js | scripts | 48.20 kB (48,202 B) | 14.01 kB |
| polyfills.js | polyfills | 35.88 kB (35,876 B) | 11.64 kB |
| chunk-DzLJzyTe.js | - | 18.45 kB (18,453 B) | 6.59 kB |
| chunk-ErSovfji.js | - | 5.03 kB (5,033 B) | 1.80 kB |
| chunk-DuSQkNq6.js | - | 3.35 kB (3,349 B) | 1.35 kB |
| **Initial total** | | **3.40 MB (3,399,489 B)** | **687.43 kB** |

Budget warning (pre-existing, unrelated to this gate — see base build below, which exceeds
the same budget): "bundle initial exceeded maximum budget. Budget 2.50 MB was not met by
899.49 kB with a total of 3.40 MB."

### Base (`main` throwaway checkout at `9afac1aa273c35d9b010d9dfa4dc7896b77b6289`, per Correction 5 — task-description.md 9.3 names `34dd972f8`, superseded by this explicit commit)

`dist/apps/ptah-extension-webview/stats.json` produced (1.3 MB).

| Initial chunk file | Names | Raw size | Transfer size |
| --- | --- | --- | --- |
| main.js | main | 1.60 MB (1,595,809 B) | 306.94 kB |
| chunk-BxyngMj8.js | - | 694.87 kB (694,865 B) | 173.91 kB |
| chunk-B4tGni_2.js | - | 428.87 kB (428,869 B) | 78.40 kB |
| chunk-BHkLjAGl.js | - | 302.37 kB (302,365 B) | 61.52 kB |
| styles.css | styles | 262.45 kB (262,447 B) | 30.14 kB |
| scripts.js | scripts | 48.20 kB (48,202 B) | 14.01 kB |
| polyfills.js | polyfills | 35.88 kB (35,876 B) | 11.64 kB |
| chunk-AefUReSu.js | - | 18.45 kB (18,453 B) | 6.59 kB |
| chunk-De7cdet6.js | - | 5.04 kB (5,036 B) | 1.81 kB |
| chunk-CXPOtLSn.js | - | 3.35 kB (3,351 B) | 1.34 kB |
| **Initial total** | | **3.40 MB (3,395,273 B)** | **686.30 kB** |

Budget warning: "bundle initial exceeded maximum budget. Budget 2.50 MB was not met by
895.27 kB with a total of 3.40 MB." (pre-existing on `main`, not introduced by this task).

### Delta

- Raw: **+4,216 bytes** (3,399,489 − 3,395,273; ≈ +0.12%).
- Estimated transfer: **+1.13 kB** (687.43 − 686.30 kB).
- `chunk-B4tGni_2.js` is byte-identical in both trees (428,869 B, same content-derived
  bundler-assigned name) — confirms this chunk is untouched by the task.

## Stats-JSON attribution

Method: for every JS/CSS file in each tree's "Initial chunk files" table above, read
`stats.json`'s `outputs[<file>].inputs` (esbuild metafile format — no `entryPoint`/`isEntry`
flag distinguishes initial vs lazy; the distinguishing set is exactly the files the build's
own console table prints as "Initial" vs "Lazy"), union the input keys per tree, then diff.

### Forbidden-path check (feature initial chunks)

Checked every input key across all 10 feature-initial outputs against:
- `^libs/frontend/mcp-apps-page/`
- `^libs/frontend/declarative-dashboard/`
- `^libs/shared/src/mcp-apps-contracts/surface.*\.ts$`
- `dashboard-spec\.schemas\.ts$`, `dashboard-spec\.validator\.ts$`, `dashboard-text-fallback\.ts$`

**Result: 0 hits.** None of these libs/files are inputs to any initial output.

Where they *do* appear: a single lazy chunk, **`chunk-CJCaMDSn.js`** (`entryPoint:
libs/frontend/mcp-apps-page/src/index.ts`, 179,319 B raw / 40.53 kB transfer, printed under
"Lazy chunk files" as `index`). Its `inputs` contain files from `libs/frontend/mcp-apps-page/`,
`libs/frontend/declarative-dashboard/`, and the `surface*`/`dashboard-spec.*`/
`dashboard-text-fallback.ts` contract files together — all three restricted areas are bundled
into this one lazy chunk, not split further. `main.js` reaches it only via
`loadComponent:()=>import('./chunk-CJCaMDSn.js').then(i=>i.AppsPageComponent)` inside the
`apps` route definition (confirmed by direct inspection of `main.js`, see fallback
string-search section below) — a property access on the dynamic-import namespace, not
inlined code.

### zod check

**Corrected (fix round 1, continued).** Collected every `stats.json` input key matching
`node_modules/zod/` across all ten initial outputs in each tree: **95 zod files in each
tree** (not 81 as originally stated — the earlier count under-matched; the corrected method
is a plain substring test for `node_modules/zod/` against every input key unioned across the
ten initial outputs per tree, with no narrower filter). **The two sorted 95-file lists are
identical, file for file** (`v4/classic/*`, `v4/core/*`, `v4/locales/*`, `index.js` — the
pre-existing zod-through-three-barrels path the handoff "Open items" already documented).
**No new zod input entered the initial bundle.** The identical-set conclusion is unchanged by
the count correction.

### Every eager byte of difference, attributed — REVISED (fix round 1)

The original version of this subsection did not reconcile: it summed a subset of named
files to 4,798 B against a 4,216 B actual delta (an unexplained +582 B overshoot),
mislabelled a real code change as "minifier noise," and stated a noise band the data did not
support. Redone below directly from the existing `dist/apps/ptah-extension-webview/stats.json`
in both worktrees — **no rebuild was performed**; both stats.json files are unchanged from
the original run (feature build at `9cc979b0660ca24b7b09a00955ad8a7d4eca102f`, base at
`9afac1aa273c35d9b010d9dfa4dc7896b77b6289`).

Reproduction script run (the evidence review's reproduction script, extended to split the
per-input `bytesInOutput` deltas into a large-delta bucket and a noise bucket):

```
node -e "
const fs = require('fs');
const feat = JSON.parse(fs.readFileSync('D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/dist/apps/ptah-extension-webview/stats.json','utf8'));
const base = JSON.parse(fs.readFileSync('D:/projects/ptah-extension/.claude-worktrees/tmp-494-lazy-gate-base/dist/apps/ptah-extension-webview/stats.json','utf8'));
const featInitial = ['main.js','chunk-BQRBkKFl.js','chunk-B4tGni_2.js','chunk-qPSlMJlB.js','styles.css','scripts.js','polyfills.js','chunk-DzLJzyTe.js','chunk-ErSovfji.js','chunk-DuSQkNq6.js'];
const baseInitial = ['main.js','chunk-BxyngMj8.js','chunk-B4tGni_2.js','chunk-BHkLjAGl.js','styles.css','scripts.js','polyfills.js','chunk-AefUReSu.js','chunk-De7cdet6.js','chunk-CXPOtLSn.js'];
function collect(stats, files) {
  const map = new Map();
  for (const f of files) {
    const key = Object.keys(stats.outputs).find(k => k.endsWith(f));
    for (const [inFile, inMeta] of Object.entries(stats.outputs[key].inputs || {})) {
      map.set(inFile, (map.get(inFile)||0) + inMeta.bytesInOutput);
    }
  }
  return map;
}
const featMap = collect(feat, featInitial), baseMap = collect(base, baseInitial);
const allKeys = new Set([...featMap.keys(), ...baseMap.keys()]);
const changes = [];
for (const k of allKeys) { const d = (featMap.get(k)||0) - (baseMap.get(k)||0); if (d !== 0) changes.push([k, d]); }
changes.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
const large = changes.filter(([,d])=>Math.abs(d)>10), small = changes.filter(([,d])=>Math.abs(d)<=10);
large.forEach(([k,d])=>console.log(d,k));
console.log('---');
console.log('total changed files:', changes.length, '| large(|d|>10):', large.length, 'sum', large.reduce((a,[,d])=>a+d,0));
console.log('small(|d|<=10):', small.length, 'sum', small.reduce((a,[,d])=>a+d,0), 'range', Math.min(...small.map(x=>x[1])), 'to', Math.max(...small.map(x=>x[1])));
console.log('grand total (net signed sum, all changed inputs):', changes.reduce((a,[,d])=>a+d,0));
"
```

Output tail:

```
1787 ../../node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs
760 apps/ptah-extension-webview/src/styles.css
717 libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts
508 libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts
501 libs/frontend/core/src/lib/services/electron-layout.service.ts
233 ../../node_modules/lucide-angular/fesm2020/lucide-angular.mjs
198 apps/ptah-extension-webview/src/app/app.routes.ts
48 apps/ptah-extension-webview/src/app/app.config.ts
46 libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts
36 apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts
15 libs/frontend/chat-state/src/lib/tab-manager.service.ts
14 libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts
12 libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts
12 libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts
12 libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts
---
total changed files: 140 | large(|d|>10): 15 sum 4899
small(|d|<=10): 125 sum 131 range -10 to 10
grand total (net signed sum, all changed inputs): 5030
```

Named attribution (all 15 files with |Δ| > 10 B — this is now the complete large-item list,
not a subset):

| File | Δ bytes | Attribution |
| --- | --- | --- |
| `../../node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs` | +1,787 | **Relabelled.** This is the shared `@angular/core` fesm2022 runtime chunk (upstream-named `_debug_node-chunk.mjs` because `DebugNode`/`DebugElement` is its nominal entry point in Angular's own package build, not because it carries dev-only code) — production rendering/DI/compiler internals (`ɵɵelementStart`, `ɵɵdefineComponent`, `NodeInjector`, `compileComponent`, etc.), present at similar magnitude in both trees (141,451 B base vs 143,238 B feature). Proportional growth from the new components/guard/route registered app-wide, not a build-config or dev-mode defect. |
| `apps/ptah-extension-webview/src/styles.css` (compiled output, not source) | +760 | Source file is byte-identical between trees (`diff` confirmed no changes) — Tailwind's JIT content-scan picking up new utility classes used by the Apps tab markup in `electron-shell.component.ts` (B17); no new source file, no new dependency |
| `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts` | +717 (new file) | Expected: eager `SurfaceUpdateInbox` (B1) |
| `apps/ptah-extension-webview/src/app/electron-shell.component.ts` | +508 | Expected: the Apps tab button, `openApps()`, `AppWindow` icon (B17 shell tab) |
| `libs/frontend/core/src/lib/services/electron-layout.service.ts` | +501 | Not on the D7-named list verbatim. Contains `appsSplitWidth` signal + `setAppsSplitWidth`/`commitAppsSplitWidth` + the persisted `LAYOUT_STATE_KEY.appsSplitWidth` round-trip (B20's write-path addition per `batches.md` "Completion prerequisites"). Imports no new package, touches no forbidden path. **Citations re-derived from the current file (fix round 1, continued):** signal declaration `:75`; readonly exposure + min/max `:89-91`; `setAppsSplitWidth()` method `:215-222` (the clamped assignment itself is `:217-221`); `commitAppsSplitWidth()` method `:224-226`; write into `persistLayout()`'s state object `:623`, `setState` call `:625`; `restoreLayout()`'s typed read shape `:645`, the guarded restore call `:667-668`. |
| `../../node_modules/lucide-angular/fesm2020/lucide-angular.mjs` | +233 | Expected: `AppWindow` icon registration (B17) |
| `apps/ptah-extension-webview/src/app/app.routes.ts` | +198 | Expected: the `'apps'` route entry (B16) |
| `apps/ptah-extension-webview/src/app/app.config.ts` | +48 | Expected: `SurfaceUpdateInbox` provider (B1) |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts` | +46 | **Corrected — not noise.** Attributed to Batch 18 ("Harness prompt isolation," commit `a3dbaceea`, `batches.md:1112-1116`), which added `readonly surfaceId = this._surfaceId.asReadonly()` and replaced the `hasSurfaceTargets`/`hasSurfaceQuestionTargets` filters. Real code from a different, already-completed batch on this same branch — unrelated to the Apps lazy-load slice specifically, same category as the B20 `electron-layout.service.ts` row above, not "unrelated churn with no consistent sign." |
| `apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts` | +36 (new file) | Expected: `electronOnlySurface` guard (B16) |
| `libs/frontend/chat-state/src/lib/tab-manager.service.ts` | +15 | Not independently investigated; small enough to be plausible pre-existing-branch churn (other batches on this branch touch this file), flagged rather than asserted as Apps-related |
| `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` | +14 | Same as above |
| `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` | +12 | Same as above |
| `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts` | +12 | Same as above |
| `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts` | +12 | Same as above |

**Sum of the 15 named large-delta files: 4,899 B.**

Remaining noise bucket (125 files, **real measured range −10 B to +10 B**, not the
previously-claimed "+1 to -3 B" — includes, among others, `webview-surface.types.ts` (+9,
the `'apps'` id literal, B16), `surface-router.service.ts` (+1, the `'apps'` id literal, B16),
`skill-sh-browser.component.ts` (+10), `diff-view.component.ts` (−10)): **net sum +131 B.**
This is esbuild's global minifier re-running its whole-bundle short-identifier allocation
whenever any new top-level binding is added anywhere in the bundle — genuine but immaterial
per-file movement, not code growth in those specific files.

**Reconciliation (exact arithmetic, no unexplained residual):**

```
Large-file sum (15 files, |Δ|>10 B) ........... +4,899 B
Noise-bucket sum (125 files, |Δ|≤10 B) .........   +131 B
                                               ----------
Sum of ALL 140 changed initial-chunk inputs ...  +5,030 B   (script's "grand total")

Unattributed bundler/minifier-overhead gap ....    −814 B
                                               ----------
Actual initial-output-size delta ..............  +4,216 B   (= 3,399,489 − 3,395,273, matches
                                                              the "Initial total" tables above)
```

The 814 B gap is real and is now explained rather than omitted: for every initial output
file, `stats.json`'s `output.bytes` (the actual emitted file size) is smaller than
`sum(inputs[*].bytesInOutput)` (the per-input attribution esbuild's metafile reports) in
*both* trees, by a large and roughly proportional margin in each (feature: −730,058 B total
across the 10 initial outputs; base: −729,244 B). This is expected — `bytesInOutput` is
measured per input before esbuild's single whole-bundle minification pass collapses
cross-module duplication and shared helper code, so it does not equal the final post-minify
output size in either tree. What reconciles exactly is the **change** in that gap between the
two builds: −730,058 − (−729,244) = **−814 B**. That 814 B is bundler/minifier overhead that
shifted between the two builds as a whole-bundle side effect of the same code changes already
named above (more top-level bindings → marginally more effective cross-file minification) —
it is not attributable to any single input file, and it is fully accounted for here rather
than silently dropped.

**Verdict: the +4,216 B raw delta reconciles exactly to (a) two new eager files
(SurfaceUpdateInbox B1, electron-only guard B16 — 753 B), (b) eight named/attributed
existing-file changes (the `@angular/core` runtime chunk, Tailwind-JIT CSS growth, shell tab
B17, B20's `appsSplitWidth`, `AppWindow` icon B17, apps route B16, SurfaceUpdateInbox provider
B1, and B18's `harness-workflow.service.ts` change — 4,081 B), (c) five further large-bucket
files (+15/+14/+12/+12/+12 B, `tab-manager.service.ts` and four `chat-ui` components) not
independently traced to a specific batch but individually too small to represent a leaked
dependency — 65 B, (d) 125 files of immaterial minifier churn in the −10..+10 B range (+131 B
net, including the `'apps'` id literal's own +9/+1), minus (e) an explained 814 B
bundler-overhead gap:**

```
753 (a) + 4,081 (b) + 65 (c) + 131 (d) − 814 (e) = 4,216 B  ✓ matches the Initial-total delta
```

No forbidden lib, no new zod input, no unattributed import, and no false "everything accounted
for" claim — the one previously-hidden number (814 B) is now shown.

### Fallback string search (A3 corroboration, run even though stats-json worked)

Searched every feature-initial JS/CSS file for `AppsPageComponent`, `SurfaceRendererComponent`,
`validateSurfaceDocument`, `ptah-apps-page`, `ptah-surface-renderer`, `dashboard-catalog/2`,
`applySurfaceOps`.

- Only `AppsPageComponent` matched, in `main.js`, in exactly one place:
  `` loadComponent:()=>import(`./chunk-CJCaMDSn.js`).then(i=>i.AppsPageComponent) `` — the
  dynamic-import property reference required for lazy routing, not the component's code.
- `SurfaceRendererComponent`, `validateSurfaceDocument`, `ptah-apps-page`,
  `ptah-surface-renderer`, `dashboard-catalog/2`, `applySurfaceOps` — **0 matches** in any
  initial file.
- `AppsPageComponent` (the actual class) confirmed present in the lazy chunk
  `chunk-CJCaMDSn.js`.

Consistent with the stats-json result.

## Req 9.2 — Electron DevTools no-preload evidence

**OPEN MANUAL QA ITEM — not executed by this agent.** This agent cannot drive the packaged
Electron app; no browser/Electron driver was available in this run. Steps for whoever runs
this manually:

1. Build and launch the Electron app from this branch (`npx nx build-main ptah-electron` /
   the project's normal Electron launch target).
2. Open Electron DevTools on the main window, go to the **Network** tab, and clear it.
3. Reload/cold-start the app and let it settle on the default (chat) view. Confirm the
   Network tab shows **no** `chunk-CJCaMDSn.js`-equivalent request (the Apps lazy chunk;
   filename will differ per build since `outputHashing` is content-derived).
4. Click the Apps tab. Confirm the Apps chunk request **now appears** for the first time.
5. Screenshot both states (before click: absent; after click: present) and attach to the
   task folder.

## Batch 19 verification (feature worktree only)

### `npx nx run-many -t test -p ptah-electron ptah-extension-webview --skip-nx-cache`

Command run twice: first attempt failed for the environmental reason above (missing
`node_modules/electron`, `node_modules/better-sqlite3` junctions — ENOENT on
`node_modules/electron/path.txt` and `node_modules/electron/package.json` in
`shell-csp.spec.ts` and `better-sqlite3-packaging.spec.ts`); after creating those two
junctions (see Environment note), re-run was fully green.

- `ptah-extension-webview:test` — **Test Suites: 11 passed, 11 total. Tests: 225 passed, 225
  total.** Includes `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`.
- `ptah-electron:test` — **Test Suites: 54 passed, 1 skipped, 55 total. Tests: 841 passed, 3
  skipped, 844 total.** Includes `apps/ptah-electron/src/windows/shell-csp.spec.ts`
  (unchanged, as the plan requires) and `better-sqlite3-packaging.spec.ts`, both passing on
  the re-run.
- Overall `nx run-many` exit code: 0 (second run).

### `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit`

Exit code 2, **exactly 8 errors**, matching the documented baseline gate precisely:

- `libs/frontend/core/src/testing/mock-rpc-service.ts` — lines **54, 60, 66, 69** (TS2352,
  pre-existing mock-type-narrowing errors unrelated to this task).
- `libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts` — lines **113, 151, 171,
  187** (TS2352, pre-existing `WindowWithMonaco` cast errors unrelated to this task).

No error outside these 8 lines. Gate matches exactly.

## PASS/FAIL verdict per requirement

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| 9.1 — no module from the two new libs (or `mcp-apps-contracts`, zod through it, or a chart lib) in the initial chunk set; Apps loads only through the `apps` route's lazy `loadComponent` | **PASS** | Stats-JSON forbidden-path check: 0 hits; zod sets identical; fallback string search corroborates; `chunk-CJCaMDSn.js` confirmed lazy and is the sole location of `AppsPageComponent`'s code, `mcp-apps-page`, `declarative-dashboard` and the `surface*`/`dashboard-spec.*` contract files |
| 9.2 — no Apps-chunk network/file request until the Apps tab is clicked | **OPEN — MANUAL QA REQUIRED** | Cannot be executed by this agent (no Electron driver). Steps recorded above |
| 9.3 — report both "Initial total" figures (this branch vs. base) with every eager byte named | **PASS (revised, fix round 1)** | Both tables and totals above; delta (+4,216 B raw / +1.13 kB transfer) now reconciles exactly: 2 new eager files (753 B) + 8 named/attributed existing-file changes (4,081 B, including B18's `harness-workflow.service.ts` +46 B and B20's `appsSplitWidth` +501 B) + 5 untraced-but-immaterial large-bucket files (65 B) + 125-file noise bucket in the real measured −10..+10 B range (+131 B net) − an explained 814 B bundler/minifier-overhead gap = 4,216 B. Original version overshot the delta by 582 B, mislabelled the B18 change as unrelated noise, and omitted the 814 B gap — see "Every eager byte of difference, attributed — REVISED" above for the reproduction script, full output and arithmetic |
| R8 — zod or a new lib leaks into the initial bundle | **PASS** | zod initial input sets identical between trees (95 files each); no forbidden lib input in any initial output |
| Batch 19 verification — webview + electron tests green, including `shell-csp.spec.ts` and `no-alpha-base-content.spec.ts` | **PASS** | 225/225 (webview), 841/844 + 3 skipped (electron), both suites include the named specs passing |
| Batch 19 verification — `tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit` gate is exactly the 8 baseline errors | **PASS** | 8/8 errors match exactly (mock-rpc-service 54/60/66/69, monaco-loader 113/151/171/187), no others |

## Not executed / deliberately out of scope

- Req 9.2 Electron DevTools screenshot — open manual QA item, see above.
- No source, spec, or config file was modified in either worktree. The only filesystem
  changes made were `node_modules` package junctions (build/test prerequisite, not
  committable, not part of the repository).
- `dist/` build outputs were left in place in both worktrees per the task's constraints (not
  committed).
