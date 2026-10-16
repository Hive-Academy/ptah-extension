# Batch R — webview initial bundle growth

## Builds

| Revision | Command | Result | Initial raw | Estimated transfer | Wall time |
| --- | --- | --- | ---: | ---: | ---: |
| Baseline `c57a9a1e7` (PR #730) | `npx nx run ptah-extension-webview:build --configuration=production --statsJson --skip-nx-cache --parallel=1` in `bundle-baseline` | success | 3,490,969 B (3.49 MB) | 749.73 kB | 198.77 s |
| Current `fix/chat-transcript-followups` (HEAD `b40330387` plus local changes) | same command in `chat-transcript-followups` | success | 3,688,519 B (3.69 MB) | 777.07 kB | 104.85 s |

**Measured increase:** 197,550 B raw (197.55 decimal kB, 5.66%) and 27.34 kB estimated transfer. The current build is slightly above the earlier “~3.68 MB” description. Both runs used the production Angular application builder and emitted `stats.json`; production already had `statsJson: true`. The baseline warning budget was 3.5 MB and the current error budget is 3.7 MB. Build time is recorded for reproducibility, not a performance comparison: the runs had different warm state.

Build logs: `D:/projects/ptah-extension/.claude-worktrees/bundle-baseline/.bundle-build.log` and `.ptah/tmp/bundle-current-build.log`. Copied metafiles: `.ptah/tmp/bundle-baseline-stats.json` and `.ptah/tmp/bundle-current-stats.json`.

## Method

`.ptah/tmp/bundle-diff.mjs` parses each Angular build log from `Initial chunk files` through `Initial total`, selects those output names in the esbuild metafile, and sums each output's `inputs[*].bytesInOutput` by module and by `node_modules/<package>` or `libs/<group>/<lib>`. Lazy output files are excluded. It reports new eager modules where baseline attribution is zero.

**Attribution limit:** esbuild's summed `bytesInOutput` exceeds the actual output bytes (baseline 4,207,891 attributed versus 3,490,969 emitted; current 4,456,139 versus 3,688,519). For example, current `main.js` has 1,839,081 attributed versus 1,476,366 emitted bytes. The module and group figures below are directional attribution, not additive savings or exact shares of the 197.55 kB emitted increase. The build-log total is authoritative for actual growth. Current uncommitted source changes are included in this measurement.

## Growth table

Decimal kB of summed `bytesInOutput` over **initial outputs only**:

| Group / module | Baseline | Current | Delta | Introduced by commit/task |
| --- | ---: | ---: | ---: | --- |
| `libs/frontend/chat` | 973.68 | 1,119.45 | +145.77 | Inspector tree `e0a8d7fdb`, chat shell `b387012fb`, later fixes; TASK_2026_677 / PR #734 |
| `libs/frontend/chat-ui` | 436.83 | 479.47 | +42.64 | Inspector stats `7887cc846`; TASK_2026_677 / PR #734; `47664b6a1` in TASK_2026_681 / PR #737 |
| `libs/frontend/canvas` | 136.11 | 165.49 | +29.38 | Agent dock `8ef9bbe26`, Rail inspector `58d2084dc`, wide mount `5594828d3`; TASK_2026_677 / PR #734 |
| `apps/ptah-extension-webview` | 272.46 | 284.07 | +11.61 | Theme status ink additions `358c95c90`; TASK_2026_677 / PR #734 |
| `node_modules/lucide-angular` | 54.82 | 59.35 | +4.53 | Distributed new icon use in inspector/dock; exact import contribution not isolated |
| `libs/frontend/chat-state` | 61.16 | 64.73 | +3.58 | Related session state additions; exact commit contribution not isolated |
| Inspector stats component (`chat-ui`) | 0 | 18.25 | +18.25 | `7887cc846` |
| Inspector agents section (`chat`) | 0 | 17.50 | +17.50 | `e0a8d7fdb`; later `47664b6a1` |
| Inspector request panel (`chat`) | 0 | 17.04 | +17.04 | `e0a8d7fdb` |
| Global `styles.css` input | 260.12 | 271.60 | +11.48 | `358c95c90`; other style changes may contribute |
| Inspector task section (`chat`) | 0 | 10.11 | +10.11 | `e0a8d7fdb` |
| Agent dock menu (`canvas`) | 0 | 9.16 | +9.16 | `8ef9bbe26` |
| Chat view component | 51.00 | 60.00 | +9.00 | `b387012fb`, `833914b34`; TASK_2026_677 |

Commit assignments are from `git log c57a9a1e7..HEAD -- <path>`, `git log -S`, and commit bodies. They locate introduction or subsequent changes; the two-build experiment cannot assign exact bytes to individual commits.

## New eager modules

The largest modules absent from the baseline initial output are inspector stats (18.25 kB), agents (17.50 kB), request panel (17.04 kB), task section (10.11 kB), Canvas agent dock menu (9.16 kB), session header (8.30 kB), agent avatar (8.20 kB), todos (7.78 kB), inspector shell (6.71 kB), and limits/lanes (6.51 kB), all measured as attributed decimal kB. The full ranked list is reproducible with `node .ptah/tmp/bundle-diff.mjs`.

The inspector's `@defer` blocks in `chat-view.component.html:287` and the Canvas rail's small/split/sheet layouts do not keep it wholly lazy: `canvas-rail-board.component.ts:245` mounts it directly in the wide Rail. Commit `0cf3936f6` had made the inspector a separate import entry for deferred Rail usage, but `5594828d3` later added this direct mount. This is the strongest code-level explanation for inspector modules moving into initial outputs; exact causal byte saving still requires a later isolated experiment.

## Lazy-load candidates

| Site | Expected saving | Risk / requirement |
| --- | --- | --- |
| `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:245` — wide Rail inspector | Potentially a substantial part of the +145.77 kB chat attribution and +42.64 kB chat-ui attribution; **not additive or guaranteed**. | The wide Rail currently shows details immediately. A plain `@defer` could briefly show a placeholder and change focus/visible timing. Preserve immediate details behavior with an acceptable prefetch/placeholder strategy and verify in a future isolated build and UI check. Other eager references must also be checked. |
| `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:164` — overflow menu | At most the 9.16 kB attributed menu module, with possible shared dependencies. | Defer only when overflow is first needed, while preserving first-open latency and keyboard/focus behavior. The menu is currently mounted even when hidden count is zero. |

The global theme CSS is not a suitable lazy target: styles must be available before the initial render. `chat-view.component.html:287` already defers the inspector; changing that block alone would not remove the Canvas eager reference.

## Recommendation

Open a focused follow-up under TASK_2026_677 / PR #734 to remove the wide Rail's eager inspector reference while preserving its immediately visible details and focus behavior. Measure a single isolated production build against this report before claiming savings. A separate lower-priority follow-up can conditionally load the dock overflow menu if its first-open behavior remains sound. TASK_2026_681 / PR #737 refinements add to the same modules but are not the principal cause.

## Decisions

- Compared the named baseline worktree with the present worktree, including local changes, because these are the two authorized build states. This is reversible; a clean-commit comparison would require another build outside this approval.
- Used Angular's initial table rather than all metafile outputs. Including lazy chunks would answer a different question. Reversible by rerunning the script with a different output filter.
- Treat `bytesInOutput` as directional attribution and build-log totals as actual bundle sizes because summed attribution exceeds emitted bytes. Reversible if a later isolated build provides exact delta savings.

## Open

- Exact bytes saved by deferring the wide Rail inspector, and whether other eager references retain parts of it, remain unmeasured; the two approved builds are exhausted.
- Transfer size is Angular's estimate, not a measured network download.
- The current tree has unrelated uncommitted changes; this experiment cannot distinguish their contribution from committed TASK_2026_677/681 changes.
