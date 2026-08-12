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

---

# 2026-08-11 — Reproduced. Nx skips restoring cache-hit outputs and replays the log.

Outcome 1: reproduced and explained, with a fix landed. Two independent
findings; the second is the cause, the first invalidates the evidence the
original diagnosis rested on.

## Finding A — mtime is not a freshness signal anywhere in this pipeline

Both writers into `dist/apps/ptah-electron/renderer/` preserve the source
file's mtime on Windows, so a renderer file's timestamp is **inherited from
its source**, never stamped at copy time:

- `fs.copyFileSync` — what `copy-renderer.js` uses. Node maps it to
  `CopyFileExW`, which copies the last-write time. Measured:
  `src 2026-08-01T01:26:00Z -> dest 2026-08-01T01:26:00Z` at wall-clock
  `2026-08-11T14:08:00Z`.
- Nx's native `copy` — what cache restoration uses
  (`node_modules/nx/src/tasks-runner/cache.js` `copyFilesFromCache`). Same
  measurement, same result.

Confirmed on real artifacts: after a `copy-renderer-dev` run, the same chunk
in source and renderer was identical **to the nanosecond** —
`2026-08-11 17:15:06.587282100` in both. Not "close"; the same value.

Consequence: "`dist/apps/ptah-electron/renderer/` held chunks timestamped
before the edit" is fully consistent with a copy that ran correctly seconds
earlier from an Nx-cache-restored source. It was the primary evidence for
"stale" in TASK_2026_222 and for the `01:26` observation in TASK_2026_226, and
it cannot carry that inference. Do not diagnose this pipeline by timestamp.

## Finding B — the cause: `local-cache-kept-existing`

`node_modules/nx/src/tasks-runner/task-orchestrator.js` `applyCachedResult`
restores a cache hit's outputs **only if** `shouldCopyOutputsFromCache` is
true, which delegates to the daemon's `outputsHashesMatch`. That is not a
content hash. Per `node_modules/nx/src/daemon/server/outputs-tracking.js` it
is an in-memory `recordedHashes[outputPath] = taskHash` map in the daemon
process, invalidated only by the outputs file-watcher, and
`processFileChangesInOutputs` **ignores any change event arriving within
2000 ms of the record** (`now - timestamps[output] > 2000`). When the map
still says "matches", Nx skips the copy entirely and replays the cached
terminal output verbatim.

Reproduced live on this Nx 22.6.5, in an isolated probe workspace with a
target of exactly `copy-renderer`'s shape (`cache: true` + `outputs`). After
externally overwriting the output directory, a re-run printed:

    > nx run probe:copy  [existing outputs match the cache, left as is]
    > node apps/probe/scripts/copy.js
    [copy] Cleaned old out directory
    [copy] Copied D:\tmp\nxprobe\apps\probe\src -> D:\tmp\nxprobe\out
    [copy] Done
    NX   Successfully ran target copy for project probe

`out/chunk.js` still read `CORRUPT` while the source read `MTIME-PROOF-v3`.
None of those three `[copy]` lines happened. This maps onto every element of
the TASK_2026_222 report: both commands report success; the destination keeps
pre-edit content and pre-edit timestamps; the source is fresh; and running
`node apps/ptah-electron/scripts/copy-renderer.js` directly fixes it
instantly, because that bypasses Nx and therefore always really runs.

It is nondeterministic — the same corruption invalidated _correctly_ on two
earlier attempts in the same session — because it is a watcher-timing race
around that 2000 ms window. That matches a symptom that resisted three rebuild
cycles and then vanished.

## Relationship to the two prior tasks

Neither prior task was wrong; both were looking at a different mechanism.

- TASK_2026_226 reproduced the symptom via a **missing hash input** (no graph
  edge, so a `libs/frontend/**` edit never entered the hash). `RI-1` closes
  that. Finding B fires when the hash is entirely **correct**, so RI-1 does
  not touch it.
- TASK*2026_229 correctly showed the webview's cache invalidates on edits.
  Finding B needs no failed invalidation — it needs an \_unchanged* hash plus
  an external write to the output directory.

The elimination list in this carrier was accurate; the gap it described was
real. What both tasks missed is that Nx has a code path where a cache hit
produces **no output write at all**, which is a third thing beyond "fresh
content" and "stale restored content".

Also relevant: TASK*2026_226 added `cache: true` to `copy-renderer` (it was
scaffolding for its own repro and stayed in the final diff). At TASK_2026_222
this target was uncacheable, so Finding B was not reachable \_for
`copy-renderer`* then — it was reachable for the upstream, always-cacheable
`ptah-extension-webview:build`, whose kept-as-is output the copy would then
faithfully propagate. On HEAD before this task it was reachable for both.

## Angles closed

- **The copy script (angle 1).** Audited. No timestamp, mtime or size skip; it
  `rmSync`s the destination and does a full recursive copy every time. It
  cannot silently no-op. One real, unrelated hole worth recording: in
  `copyRecursive`, a `readdirSync` failure with `ENOENT`/`ENOTDIR` is warned
  and **skipped**, so if the source tree is rewritten mid-walk the copy can be
  partial and still `exit 0`. Not the cause here; left as-is (it exists to
  survive broken symlinks) but it should not grow.
- **Nx output restoration (angle 2).** This was the right neighbourhood, but
  the failure is the _absence_ of restoration, not a late one.
- **Ordering under the pre-`fe70fd689` sibling `dependsOn` (angle 3).** Not
  needed; Finding B needs no race between the two writers.
- **Environment / filesystem granularity (angle 4).** Not granularity — but
  the Windows `CopyFileExW` mtime semantics in Finding A are why the
  timestamps looked the way they did.

## Fix landed

Removed `cache: true` from `copy-renderer` in
`apps/ptah-electron/project.json`. A target whose entire job is "make this
directory match" must not be allowed to skip on an unverified belief about
that directory.

TASK_2026_226's stated reason for caching it — that the alternative makes
"every e2e run pay a full copy every time" — is obsolete: TASK_2026_229 moved
`e2e`/`showcase`/`e2e:nightly` onto `copy-renderer-dev`, which is uncacheable
and pays the full copy anyway. Plain `copy-renderer`'s only remaining consumer
is `package`, where one file copy is noise against `electron-builder`. So the
saving was ~zero and the exposure included **shipping whatever happened to be
in the renderer directory into a packaged app**.

`renderer-cache-key.spec.ts`: RI-2 inverted (now asserts NOT cacheable) with
the mechanism documented in the header. Proved non-vacuous by reinstating
`cache: true` and watching only RI-2 fail (1 failed / 14 passed), then
restoring (15/15). RI-1 kept — the graph edge is still correct and still
matters for `nx affected`.

## Verdict for other lanes

`nx copy-renderer-dev ptah-electron` **can be trusted**. It is not cacheable
(no `cache` field, no `outputs`, and this workspace defines no
`cacheableOperations` fallback), so `isCacheableTask` is false and it always
executes both of its commands. Verified live across three cycles with markers
in `libs/frontend/dashboard`: ALPHA landed, BRAVO replaced it with zero ALPHA
residue, ALPHA came back on revert — each time in development configuration
(101 `.map` files).

Residual risk, unchanged: `ptah-extension-webview:build` is still cacheable
with `outputs`, so Finding B still applies to
`dist/apps/ptah-extension-webview/` if something outside Nx writes there.
Nothing routinely does. Left alone deliberately — that build is expensive and
caching it is correct.

If this recurs: the tell is the dim `[existing outputs match the cache, left
as is]` annotation on the `> nx run` line. It scrolls past above the replayed
script output and is easy to miss. Do not diagnose by timestamp (Finding A).
