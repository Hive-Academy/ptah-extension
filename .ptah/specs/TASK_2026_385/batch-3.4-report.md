# Batch 3.4 report — git-ui lazy-chunk budget

## File touched

`D:\projects\ptah-extension\apps\ptah-extension-webview\project.json` — only file modified, as required.

## What was measured (build BEFORE the change)

`nx build ptah-extension-webview` (production config, default) run first, before any edit.

Relevant excerpt of the emitted-chunks table:

```
Lazy chunk files   | Names                     | Raw size | Estimated transfer size
chunk-4MUHSYEE.js  | index                     | 329.37 kB|  63.66 kB
chunk-U6RTEN5M.js  | -                         | 311.18 kB|  51.56 kB
chunk-QO5YXBZW.js  | index                     | 157.05 kB|  32.52 kB
chunk-NVQ5BYOU.js  | index                     | 125.83 kB|  24.34 kB
chunk-PEJEWTK6.js  | index                     |  93.92 kB|  22.55 kB
chunk-6TEOBJ7A.js  | index                     |  62.01 kB|  13.86 kB
theme-extra.css    | theme-extra               |  52.97 kB|   6.06 kB
chunk-KDZAUEAT.js  | -                         |  17.15 kB|   3.01 kB
chunk-PKHAW5SX.js  | index                     |   6.60 kB|   2.28 kB
chunk-PWQQWAAE.js  | -                         |   5.00 kB|   1.78 kB
chunk-A6CXOPAW.js  | -                         |    815 B |    815 B
chunk-TWYWCHSJ.js  | index                     |    559 B |    559 B   <-- git-ui
chunk-V6FGJGQE.js  | services                  |    210 B |    210 B
chunk-ACNA3VYU.js  | metadata-patch-schema-lazy|    185 B |    185 B
```

I identified the git-ui chunk by content, not by guessing at the size-ordered list: I grepped every JS output file for `GitDockComponent` / `git-ui`. Only `chunk-TWYWCHSJ.js` (559 bytes) contains the actual re-export barrel produced by
`import('@ptah-extension/git-ui')` in `electron-shell.component.ts` (landed in batch 3.1, commit `239f8013e`):

```
export{j as DiffTabsService,k as DiffViewComponent,b as GitBranchesService,
p as GitDockComponent,o as GitDockHeaderComponent,a as GitStatusService,
l as SourceControlFileComponent,n as SourceControlPanelComponent,
e as SourceControlService,c as WORKTREE_CHANGED_MESSAGE_TYPE,
m as WorktreeSectionComponent,d as WorktreeService, ...}
```

**Measured git-ui lazy chunk size: 559 bytes.**

## Important caveat — read before trusting the budget's precision

`GitDockComponent`'s actual implementation code is NOT in this 559-byte chunk. It also matched `chunk-KAUG6AKV.js` (78.16 kB), but that chunk is listed under **Initial chunk files**, not lazy — it is `import`ed directly by `main.js`, confirmed by grepping every emitted file for `chunk-KAUG6AKV` (`main.js`, `chunk-SKUSIUB4.js`, `chunk-V6FGJGQE.js`, `chunk-TWYWCHSJ.js`). Something else in the eagerly-loaded graph already pulls in git-ui's real payload, so esbuild's chunk splitter hoisted the shared code to an initial chunk and left only a thin barrel re-export (559 B) as the lazy artifact created by the batch-3.1 dynamic import. That out-of-scope finding (git-ui's actual weight already sits in the initial bundle, not lazy) is worth a separate task — not something I can or should fix from `project.json`.

Second caveat, this one affects the budget's precision directly: Angular's `@angular/build:application` esbuild budget checker (`node_modules/@angular/build/src/utils/bundle-calculator.js`, `BundleCalculator.calculate()`) matches a `"type": "bundle"` budget by `chunk.names.includes(budget.name)`. The chunk `name` itself is derived in `budget-stats.js` / `utils.js` (`getChunkNameFromMetafile` → `getEntryPointName`) from the **basename of the resolved entry-point file**, not from any config in `project.json` and not from a webpack-style `/* webpackChunkName */` comment (esbuild-based Angular does not honor those). Because git-ui's built entry file resolves to something literally named `index`, the emitted chunk name is `"index"` — the same generic name shared by six other, unrelated lazy chunks in this table (chat, canvas, harness-builder, etc.).

Consequence: a `"bundle"` budget named `"git-ui"` cannot match anything today — `chunk.names` never contains the literal string `"git-ui"` for any chunk, so `BundleCalculator` returns `size: 0`, which always passes. I could not make this budget key on the true chunk without either (a) renaming git-ui's build entry file, or (b) changing the import site to a named lazy Angular route — both outside `libs/frontend/git-ui/**` and `libs/frontend/chat/**`, which are explicitly out of scope for this batch. I also could not use `"any"`/`"anyScript"` instead, because those apply the same threshold to every chunk individually, including the unrelated 329 kB / 745 kB chunks already in the build — any error threshold low enough to matter for git-ui would fail the build immediately on unrelated chunks.

Given the constraint (touch only `project.json`), I wrote the budget exactly as instructed — `"type": "bundle"`, `"name": "git-ui"` — with `maximumError` derived from the 559-byte measurement plus headroom (559 B measured; 2 kB warning ≈ 3.6x headroom, 5 kB error ≈ 9x headroom, chosen so a reasonable future addition to the git-ui barrel — e.g. one more re-exported service — trips the warning long before the error, while leaving enough room that adding one or two new component exports doesn't spuriously fail CI). **This budget is currently inert** (matches zero chunks, always passes) because of the naming mismatch above — it will start doing real work only once something gives the git-ui lazy chunk a stable, distinguishable name, which is a follow-up outside this batch's file scope. I am flagging this explicitly rather than silently shipping a budget that looks meaningful but isn't.

## Diff written

```json
{
  "type": "bundle",
  "name": "git-ui",
  "maximumWarning": "2kb",
  "maximumError": "5kb"
}
```

Added after the existing `anyComponentStyle` entry in the `production.budgets` array (`:62-73` pattern preserved — `initial` and `anyComponentStyle` untouched).

## Verification — build AFTER the change

`nx build ptah-extension-webview` re-run with the budget in place:

```
Application bundle generation complete. [23.789 seconds] - 2026-09-07T08:40:02.927Z
Output location: D:\projects\ptah-extension\dist\apps\ptah-extension-webview

 NX   Successfully ran target build for project ptah-extension-webview and 3 tasks it depends on
```

No budget warning/error printed. Emitted chunk table unchanged from the baseline (`chunk-TWYWCHSJ.js | index | 559 bytes | 559 bytes` still present) — confirms 559 B is under the 5 kB `maximumError` (trivially, since the budget doesn't match the chunk today per the caveat above, but the number itself is correct against the real measurement).

## Post-edit file-revert check

Per the stated hazard on this branch (in-place edits reverting to HEAD mid-run), I re-read `project.json` lines 55-84 after finishing all edits and after the final build. The `"bundle"`/`"git-ui"` budget entry is present and unchanged from what I wrote. No revert occurred during this session.

## Rollback

Remove the one budget object (`type: "bundle", name: "git-ui", ...`) from `apps/ptah-extension-webview/project.json`'s `production.budgets` array; the other two budget entries are untouched and need no changes.

## Secrets or variables required

None.

## Out-of-scope observations

- git-ui's real implementation weight (~78 kB raw, the `GitDockComponent`/`SourceControlPanelComponent`/etc. code in `chunk-KAUG6AKV.js`) is already part of the **initial** bundle, not the lazy chunk created by batch 3.1's `import('@ptah-extension/git-ui')`. Something else in the eagerly-loaded graph imports git-ui synchronously, defeating the intent of lazy-loading it. Worth its own investigation (likely in `libs/frontend/chat` or wherever else git-ui is consumed) — not something `project.json` can fix.
- The `"bundle"` budget type in esbuild-based `@angular/build:application` has no way to target an anonymous dynamic import by a custom name from `project.json` alone; Angular does not honor webpack-style `webpackChunkName` magic comments in esbuild mode. A future task that wants this budget to actually fire should either give git-ui's package entry a distinctive output filename, or convert the git-ui mount point to a named lazy Angular route.
