# Code Logic Review — Batch 19 (Lazy-load gate), `TASK_2026_494_ca38`

Evidence review of `lazy-load-gate.md`, produced by a senior-tester. This review does not
edit the gate file or any source; it independently re-derives the numbers from
`dist/apps/ptah-extension-webview/stats.json` in both worktrees and checks the gate's
claims against that ground truth.

## Summary

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | **NEEDS_REVISION** |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Minor issues | 2 |

The gate's protective conclusions (no forbidden lib leaked, no new zod input, production
config genuinely applied, Req 9.2 honestly left open) all independently verify as correct.
But the gate's central Req 9.3 claim — "every eager byte of the +4,216 B raw delta is
attributed to named additions" — does not reconcile against `stats.json`: the named table
oversums the actual delta by 582 B, a real +46 B code change from a different, completed
batch is mischaracterized as unrelated "minifier noise," and several other files exceed the
noise range the gate itself states. That is a false attribution, which per this review's
brief is itself grounds for NEEDS_REVISION even though no forbidden import or wrong build
config was found.

## Check table

| # | Check | Ruling | Evidence |
| --- | --- | --- | --- |
| 1 | `_debug_node-chunk.mjs` +1,787 B attribution | **(a) EXPECTED, but mislabeled** | See "Check 1" below |
| 2 | B20's +501 B `electron-layout.service.ts` | **CONFIRMED, correctly flagged and accepted** | `libs/frontend/core/src/lib/services/electron-layout.service.ts:75,89,217,623,645,667-668` all contain `appsSplitWidth`/`setAppsSplitWidth` code, matching the gate's grep citations (line numbers 215/224 in the gate vs. 217 found here — a 2-line drift, immaterial). Delta of 501 B independently reproduced from `stats.json` (see Check 4 table). Coordinator ruling in `batches.md:1169-1170` accepts it as expected because core is eager. |
| 3 | R8/9.1 forbidden-path and zod spot check | **PASS on substance; zod count cited is wrong (81 vs actual 95)** | See "Check 3" below |
| 4 | Req 9.3 — every eager byte named | **FAIL — does not reconcile** | See "Check 4" below |
| 5 | Req 9.2 honestly OPEN | **CONFIRMED, no fabrication** | `lazy-load-gate.md:191-205` states "OPEN MANUAL QA ITEM — not executed by this agent," gives 5 concrete numbered steps (build, open DevTools Network tab, reload, click Apps tab, screenshot both states) and does not claim a screenshot exists. The PASS/FAIL table at `:241` correctly marks it OPEN, not PASS. |
| 6 | Verification tails plausible | **CONFIRMED, strongly corroborated for 2 of 3 figures** | See "Check 6" below |
| 7 | Environment workaround (node_modules junctions) valid and non-distorting | **CONFIRMED** | See "Check 7" below |

## Check 1 — `_debug_node-chunk.mjs` +1,787 B

Independently queried both `stats.json` files for every output whose `inputs` contains
`../../node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs`:

- Feature: `chunk-BQRBkKFl.js` ← `_debug_node-chunk.mjs`, `bytesInOutput = 143238`
- Base: `chunk-BxyngMj8.js` ← `_debug_node-chunk.mjs`, `bytesInOutput = 141451`
- Delta = 143238 − 141451 = **1787**, exactly matching the gate's number.

The gate's label, "Angular dev-mode component/directive debug metadata," is **inaccurate**.
Reading the real source at
`D:\projects\ptah-extension\node_modules\@angular\core\fesm2022\_debug_node-chunk.mjs`
(747 KB unminified), its `export` statement (line 19599) lists ~350 symbols including
`ɵɵelementStart`, `ɵɵproperty`, `ɵɵdefineComponent`, `NodeInjector`, `compileComponent`,
`ApplicationRef`, `Testability`, template interpolation helpers, and dozens of other
production-critical rendering/DI/compiler internals — this is the primary shared
`@angular/core` runtime chunk (as produced by Angular's own package build/rollup), not a
dev-only debug payload. Its name is an artifact of `DebugNode`/`DebugElement` being the
chunk's nominal entry point in Angular's upstream build, not a description of what code it
carries. 141–143 KB of it surviving into a production initial chunk is expected — that is
most of Angular's rendering engine.

That said, the gate's underlying **conclusion is correct and independently verified**:

- Confirmed present in **both** trees at similar magnitude (141,451 B base vs. 143,238 B
  feature, ≈+1.3%), not a file that only appears in the feature build — this rules out a
  configuration difference producing new dev-mode residue.
- Grepped every feature- and base-initial output file (`main.js`, all initial `chunk-*.js`,
  `scripts.js`, `polyfills.js`) for the literal strings `ngDevMode`, `setClassMetadata`, and
  `setClassDebugInfo`: **zero occurrences in any initial file in either tree.** The
  `(typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(...)` guards visible
  in the unminified source (e.g. lines 10440, 11532, 12748, 19171, 19220) are confirmed
  eliminated from both builds' actual output.
- `apps/ptah-extension-webview/project.json` `targets.build` is **byte-identical** between
  the feature and base commits (`diff` of the parsed JSON produced no output) — confirms the
  same `optimization`, `outputHashing: none`, `fileReplacements` (production environment),
  and no `extractLicenses: false` override in either tree.
- `3rdpartylicenses.txt` (49,142 B) is present and identical-sized in both
  `dist/apps/ptah-extension-webview/` outputs — this file is only emitted when
  `extractLicenses` ran, direct evidence both builds executed the production path, not a
  dev/default build mislabeled as production.

Ruling: **(a) EXPECTED** — proportional growth tied to genuinely production-optimized
output, not a wrong build config. The gate does **not** need to be re-run over this item.
The label is wrong and should be corrected (Moderate finding below), but it does not change
the PASS verdict for this specific check.

## Check 3 — forbidden paths and zod

Independently unioned every `inputs` key across the ten feature-initial outputs
(`main.js`, `chunk-BQRBkKFl.js`, `chunk-B4tGni_2.js`, `chunk-qPSlMJlB.js`, `styles.css`,
`scripts.js`, `polyfills.js`, `chunk-DzLJzyTe.js`, `chunk-ErSovfji.js`,
`chunk-DuSQkNq6.js` — 717 unique inputs total) and tested against the six forbidden
patterns from `implementation-plan.md:286-290` (`libs/frontend/mcp-apps-page/`,
`libs/frontend/declarative-dashboard/`, `libs/shared/src/mcp-apps-contracts/surface*.ts`,
`dashboard-spec.schemas.ts`, `dashboard-spec.validator.ts`, `dashboard-text-fallback.ts`):
**0 hits**, confirming the gate's claim at `lazy-load-gate.md:111`.

For zod: collected every `node_modules/zod` input across the ten initial outputs in each
tree. Actual counts: **95 files in each tree**, and the sets are set-equal (no file present
in one tree's zod set and absent from the other's). This confirms the substantive R8 claim
("no new zod input entered the initial bundle," `lazy-load-gate.md:129`) as **true**.

However, the gate states "81 zod files in each tree" (`lazy-load-gate.md:126-127`). The
actual count from `stats.json` is **95**, not 81 — an unexplained 14-file (≈17%)
undercount. All 95 matched files genuinely belong to the `zod` package (verified: every
match has `node_modules/zod/` as its package-root segment, not a look-alike package like
`zod-to-json-schema`). This is a Moderate accuracy defect: the cited count is wrong, though
the conclusion it supports ("identical, no new input") independently holds.

## Check 4 — Req 9.3 byte accounting

This is the substantive problem. Summed the gate's own two tables
(`lazy-load-gate.md:136-157`):

- New eager files: 717 + 36 = 753 B
- Named growth: 508 + 501 + 198 + 233 + 48 + 9 + 1,787 + 760 + 1 = 4,045 B
- **Named total = 4,798 B**

The gate reports the raw delta as **4,216 B** (`lazy-load-gate.md:91`, independently
reproduced: feature Initial total 3,399,489 − base Initial total 3,395,273 = 4,216,
confirmed against the actual `dist/` file sizes on disk in both trees). The named table
**already exceeds the total delta by 582 B**, yet the gate's closing sentence
(`:165-167`) asserts the two new files plus the eight named changes "account for the rest,"
implying the remainder is a small positive residual — the arithmetic instead requires the
unnamed "~140 files" bucket to sum to **−582 B**, which is never stated, computed, or
reconciled anywhere in the document.

Independently re-derived the full picture directly from `stats.json` (union of all input
keys across the ten initial outputs per tree, `bytesInOutput` diffed per file):

- Sum of **all** per-input `bytesInOutput` deltas: **5,030 B** (not 4,216 B — a further,
  separate gap of 814 B between the sum of per-file attribution and the actual output-size
  delta; this is normal esbuild bundler/wrapper overhead not attributed to any single input,
  but the gate never mentions or accounts for it, despite claiming a complete accounting).
- 140 changed input files total, matching the gate's file count.
- 15 files with |Δ| > 10 B, summing to **+4,899 B**; 125 files with |Δ| ≤ 10 B, summing to
  **+131 B**.
- The 15 "large" files are the gate's 9 named items **plus one the gate omits**:

  `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts`: **+46 B**

  This file is not minifier noise unrelated to the Apps feature. It is the file modified by
  Batch 18 ("Harness prompt isolation," `batches.md:1112-1114`: "MODIFY
  `.../harness-workflow.service.ts`..."), which added `readonly surfaceId =
  this._surfaceId.asReadonly()` and replaced the `hasSurfaceTargets`/
  `hasSurfaceQuestionTargets` filters (`batches.md:1114-1116`) — real code added by a
  different, already-completed batch on this same branch, not symbol-table churn. The gate's
  claim that the remaining ~140 files "shifted by +1 to -3 bytes each, with no consistent
  sign, across files with no relationship to the Apps feature" (`:159-164`) is **false** for
  this file on both counts: the delta is +46 B (over 15× the stated ±3 B range), and it does
  have a relationship to work on this branch (just not to the Apps/lazy-load slice
  specifically, the same category B20's `electron-layout.service.ts` was correctly
  flagged under rather than silently folded in).
- Several further files also exceed the gate's stated "+1 to -3 bytes" range:
  `tab-manager.service.ts` +15, `compact-session-activity.component.ts` +14,
  `session-stats-summary.component.ts` +12, `mcp-directory-browser.component.ts` +12,
  `plugin-catalog-panel.component.ts` +12, `skill-sh-browser.component.ts` +10,
  `diff-view.component.ts` −10. None of these is independently large enough to be alarming
  on its own (plausibly genuine minifier churn from other batches' unrelated edits earlier
  in the branch), but the gate's stated bound for "everything else" is demonstrably not what
  the data shows.

Net effect: the requirement text the gate is graded against is "every eager byte of the
+4,216 B raw delta is attributed to named additions" (`batches.md:1151`,
`implementation-plan.md:296-300`). The named table overshoots the true delta by 582 B, one
real +46 B change is misfiled as noise, the stated noise range is wrong, and an 814 B
bundler-overhead gap is never surfaced. The PASS verdict recorded for Req 9.3
(`lazy-load-gate.md:242`) is not supported by the numbers in the same document.

This does **not** change the substantive PASS on 9.1/R8 (no forbidden import, no new zod
input — independently confirmed clean above); it means the precision claim central to this
specific gate's purpose is inaccurate.

## Check 6 — verification tails

- Webview `225 passed, 225 total`: independently corroborated by
  `batch-16-report.md:126,138` ("`ptah-extension-webview:test` | 11 suites, 225 passed" /
  "Tests: 225 passed, 225 total"), a document written by a different batch's executor
  earlier in the task. Strong corroboration.
- `tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit` "exactly 8 baseline
  errors" (`mock-rpc-service.ts` 54/60/66/69, `monaco-loader.service.ts` 113/151/171/187):
  this exact figure and file pair recurs verbatim across at least 8 other locations in
  `batches.md` (lines 826, 841, 873, 941, 943, 976, 1021 [labelled 9 there — a different,
  temporary count during a mid-batch state, not a contradiction of the settled 8-error
  baseline used everywhere else], 1167) going back to a named coordinator ruling on
  2026-09-25 (`batches.md:826`). Strong, repeated corroboration.
- Electron `841 passed, 3 skipped, 844 total`: no other document in the task folder states
  this specific figure (searched all `*.md` in the task folder for "841 passed"; only
  `lazy-load-gate.md` itself contains it), so this number has no independent corroboration
  within the task's paper trail. It is internally plausible (3 skipped matches the
  established `shell-csp.spec.ts`/`better-sqlite3-packaging.spec.ts` pattern that needed the
  junction fix) and nothing found contradicts it, but it is the one tail figure this review
  could not cross-check against a second source. Minor finding, not a defect.

## Check 7 — environment workaround (node_modules junctions)

Verified directly against the filesystem, not just the gate's narrative:

- Feature worktree `node_modules/{prismjs,daisyui,monaco-editor,electron,better-sqlite3}`
  are all real Windows junctions (confirmed via `lstatSync(...).isSymbolicLink() === true`
  for each), each pointing at
  `D:\projects\ptah-extension\node_modules\<package>`, matching the gate's claim.
- Base worktree has `prismjs`, `daisyui`, `monaco-editor` present but **not**
  `electron`/`better-sqlite3` — matching the gate's claim that the latter two are
  feature-worktree-only (needed only for `ptah-electron` specs, irrelevant to the webview
  build/stats comparison).
- `git status --porcelain --ignored=matching -- node_modules` in the feature worktree shows
  only `!! node_modules/` (ignored, untracked) — confirms the junctions do not appear in
  git status, as the gate and the coordinator's note (`batches.md:1174`) both require.
- Critically, `apps/ptah-extension-webview/project.json`'s `targets.build` block is
  byte-identical between the base and feature commits (empty `diff` output, see Check 1) —
  the workaround is symmetric and does not itself explain or contaminate any part of the
  4,216 B delta; both builds resolve the same three packages (`prismjs`, `daisyui`,
  `monaco-editor`) the webview build genuinely needs via the same mechanism.

No defect found. The workaround is real, necessary (esbuild resolves the project.json's
literal `"node_modules/prismjs/..."` style/script/asset paths against the invoking
workspace root, which has no populated `node_modules` in either throwaway worktree), applied
symmetrically to both trees where needed, and does not affect comparison validity.

## Findings

### Serious — Req 9.3 byte accounting does not reconcile and misattributes a real code change as noise

- File: `lazy-load-gate.md:136-167` (attribution tables and closing paragraph)
- Scenario: a reviewer or a later engineer trusts the gate's claim that "every eager byte...
  is attributed to named additions" and uses this document as the authoritative record of
  what the Apps feature cost the initial bundle.
- Impact: the named table oversums the actual delta by 582 B with no reconciliation shown;
  a genuine +46 B change from Batch 18 (`harness-workflow.service.ts`,
  `batches.md:1112-1116`) is mischaracterized as unrelated "minifier noise... no consistent
  sign... no relationship to the Apps feature," which is factually wrong on both the
  magnitude and the relationship claim; the stated noise bound ("+1 to -3 bytes each") is
  contradicted by at least 7 other files in the same bucket (up to +15 B); an 814 B gap
  between the sum of per-file `bytesInOutput` deltas (5,030 B) and the actual output-size
  delta (4,216 B) is never surfaced.
- Fix: redo the attribution section directly against the existing `stats.json` files (no
  rebuild needed — see "Re-run" below): recompute the per-input delta set, name
  `harness-workflow.service.ts` under its real batch (Batch 18) the way `electron-layout.
  service.ts` was correctly named under B20, correct or drop the "+1 to -3 bytes" range
  claim, and either explain the 814 B glue-code gap (e.g., bundler module-wrapper overhead
  not attributable per-input) or fold it explicitly into the accounting instead of silently
  omitting it.

### Moderate — `_debug_node-chunk.mjs` mislabeled as "dev-mode debug metadata"

- File: `lazy-load-gate.md:155`
- Scenario: a future reader takes the label at face value and concludes this chunk is
  dev-only residue that should shrink to near-zero in a correct production build.
- Impact: the label is inaccurate — the file is the primary shared `@angular/core` runtime
  chunk (rendering engine, DI, compiler helpers), of which 141–143 KB is genuinely needed in
  production in both trees. The underlying PASS conclusion (proportional, expected growth,
  not a wrong build config) is independently confirmed correct by this review, so this
  finding is about the description, not the verdict.
- Fix: rename the attribution to something like "shared `@angular/core` fesm2022 runtime
  chunk (upstream-named `_debug_node-chunk.mjs`; contains general rendering/DI internals,
  not dev-only code)," and keep the "proportional to new components/guard" reasoning, which
  is plausible and unfalsified but was not itself proven (no direct evidence ties the +1,787
  B to specific new symbols rather than general code-path growth).

### Moderate — zod file count cited as 81, actual is 95

- File: `lazy-load-gate.md:126`
- Scenario: someone re-derives the zod input count later and gets a different number than
  the gate reports, and cannot tell whether the gate or their own re-derivation is wrong.
- Impact: the cited count (81) does not match `stats.json` (95, confirmed in both trees, all
  genuinely under `node_modules/zod/`). The conclusion drawn from it (identical sets between
  trees, no new zod input) is independently confirmed true regardless of the count error, so
  this does not change the R8 verdict.
- Fix: recount and correct the figure, or state the exact methodology (e.g., a narrower glob)
  that produced 81 if that was intentional.

### Minor — electron-layout.service.ts line citations drift by ~2 lines

- File: `lazy-load-gate.md:150` cites lines 215, 224; actual `appsSplitWidth`-related code in
  `libs/frontend/core/src/lib/services/electron-layout.service.ts` sits at 217 (assignment)
  and the surrounding method. Immaterial (the feature claim itself is correct) but worth a
  quick correction for anyone using these citations to jump to code.

### Minor — electron test count (841 passed, 3 skipped) not independently corroborated

- File: `lazy-load-gate.md:219`
- No other document in the task folder states this figure, unlike the webview 225 count and
  the 8-baseline-tsc-errors count, both of which recur across multiple prior batch reports.
  Not contradicted by anything found; flagged only because this review could not
  cross-verify it the way it could the other two tail numbers.

## Whether the gate must be re-run

**The build does not need to be re-run.** Both `stats.json` files are valid: the production
configuration is confirmed byte-identical between the two commits, `3rdpartylicenses.txt`
confirms both ran the real production path, and the forbidden-path/zod-set/lazy-chunk
claims all independently verify as correct against the existing artifacts.

**The Req 9.3 attribution analysis in `lazy-load-gate.md` must be redone**, using the
`stats.json` files already on disk in both worktrees — no new `nx build` invocation is
required. The corrected analysis should reproduce and fix the numbers this review derived
with:

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
for (const [k,d] of changes) console.log(d, k);
"
```

This reproduces the exact per-file delta list used in this review; redo the attribution
table from that output, reconciling the named sum against the true 4,216 B total.

## One-line summary

The gate's protective conclusions (no forbidden import, no new zod input, genuine
production build, Req 9.2 honestly open) all hold under independent verification, but its
Req 9.3 byte-accounting contains a real false attribution and an unreconciled 582 B/814 B
gap, so the write-up — not the underlying build — needs revision.
