# The 222 stale-content symptom is still unexplained

## Why this carrier exists

Two tasks have chased this and both landed real fixes that turned out **not**
to explain what was actually seen. Neither overclaimed — both recorded the gap
honestly. This carrier exists so that honesty does not decay into the record
looking closed.

It is filed as RESEARCH, not BUGFIX, because the deliverable is an explanation.
"Cannot reproduce, here is what was eliminated" is a valid and useful outcome.

## The original observation

From `TASK_2026_222`, working in a live Electron host:

- A theme fix in `libs/frontend/editor/src/lib/diff-view/diff-view.component.ts`
  refused to appear across three rebuild cycles.
- `nx build-dev ptah-electron` and `nx copy-renderer ptah-electron` **both
  reported success**.
- `dist/apps/ptah-extension-webview/browser/` held **fresh** chunks.
- `dist/apps/ptah-electron/renderer/` held chunks **timestamped before the
  edit**.
- `node apps/ptah-electron/scripts/copy-renderer.js` fixed it **instantly**.

The last point is the sharpest clue and the hardest to explain: the copy
script, run directly, did the right thing immediately. So the inputs were
correct and available on disk at that moment. Something about invoking it
_through Nx_ did not.

## What has been eliminated

**`copy-renderer`'s own cache — ruled out by `TASK_2026_226` (`26da9b83e`).**
The target had no `cache` field, and `isCacheableTask` requires `cache === true`
(this workspace defines no `cacheableOperations` fallback). It was never
cached, so it could not have restored a stale directory. That task had to add
`cache: true` before it could even reproduce the failure mode it was filed
about. It then fixed the real hole it found — a missing project-graph edge —
and said plainly that this did not account for the original symptom.

**`ptah-extension-webview:build`'s cache — ruled out by `TASK_2026_229`
(`fe70fd689`).** It seeded a genuine pre-edit production cache entry, edited a
marked file, and re-ran bare `copy-renderer` twice without busting the cache.
Nx correctly detected the invalidation both times and rebuilt fresh:
content-correct, wrong configuration, never stale.

**What `TASK_2026_229` did prove**, and what is now fixed: `copy-renderer`
resolved the webview to **production** while `build-dev` built it as
**development**, into the same directory. Deterministic, demonstrated live
(101 `.map` files → 0, unminified → minified), and it also meant every
`nx serve ptah-electron` session shipped a production renderer. Real bug, real
fix — but a wrong-_configuration_ bug, not a wrong-_content_ one.

## The gap, stated precisely

The observed symptom was **stale content**: chunks predating the edit. Every
mechanism investigated so far produces **fresh content in the wrong
configuration**. Those are different failures and the second cannot
masquerade as the first — a production bundle built after the edit still
contains the edit.

## Angles not yet tried

- **The copy script itself.** `apps/ptah-electron/scripts/copy-renderer.js`
  has been treated as config-agnostic and correct by both prior tasks; neither
  audited it. Does it skip on timestamp, mtime, or size? Does it fail
  partially and exit 0? A script that no-ops under some condition and reports
  success would explain the symptom exactly, including why running it directly
  worked once conditions changed.
- **Nx output restoration.** `copy-renderer` declares
  `outputs: ["{workspaceRoot}/dist/apps/ptah-electron/renderer"]`. Consider
  whether output _restoration_ from a prior task's recorded outputs could
  overwrite the directory after the copy ran, independent of whether
  `copy-renderer` itself was cacheable.
- **Ordering under the pre-`fe70fd689` sibling `dependsOn`.** The two targets
  were unordered siblings writing the same directory. A production build
  landing _after_ the copy would leave a directory that matches neither
  expectation. This is closest to the symptom and is now unreproducible on
  HEAD, which may mean it is already fixed — establishing that is a valid
  outcome.
- **The environment.** Windows, and `TASK_2026_226` observed the specific
  timestamp `01:26` on the stale chunks. Filesystem timestamp granularity or a
  file lock holding a directory during a copy is worth one look before
  concluding it was a graph problem at all.

## Acceptable outcomes

1. Reproduced and explained — then fix it or file the fix.
2. Proven already fixed by `fe70fd689` — say which mechanism did it and how
   that was established.
3. Not reproducible, with the elimination list extended. Then close it and
   note that a future recurrence should reopen this rather than start over.

Outcome 3 is a real result. Do not manufacture a story to avoid it. The
failure mode this whole thread has been about is a plausible explanation
displacing a verified one.
