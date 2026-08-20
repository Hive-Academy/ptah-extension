# copy-renderer and build-dev disagree about which webview to build

## Origin

Found while fixing `TASK_2026_226` (commit `26da9b83e`). That task added the
missing project-graph edge from `ptah-electron` to `ptah-extension-webview`
and made `copy-renderer` genuinely cacheable. This is the separate problem the
same investigation turned up, deliberately left unfixed there.

## The mismatch

`apps/ptah-electron/project.json`:

```json
"copy-renderer": {
  "dependsOn": ["ptah-extension-webview:build"],
  ...
}
```

No configuration is pinned, so Nx resolves it to the target's
`defaultConfiguration`, which is **production**.

`build-dev` builds the same project explicitly with
`--configuration=development`.

Both write to `dist/apps/ptah-extension-webview/browser/`, and
`copy-renderer` then copies that directory into
`dist/apps/ptah-electron/renderer/`.

## Why the e2e path is unsafe

`apps/ptah-electron-e2e/project.json` — the `e2e`, `showcase` and
`e2e:nightly` targets each declare:

```json
[
  { "target": "build-dev", "projects": ["ptah-electron"] },
  { "target": "copy-renderer", "projects": ["ptah-electron"] }
]
```

These are **sibling `dependsOn` entries**. Confirmed against
`node_modules/nx/src/tasks-runner/create-task-graph.js` during the
`TASK_2026_226` investigation: siblings carry no ordering relative to each
other, and because the two resolve to _different_ task IDs (development vs
production) there is no deduplication to accidentally synchronize them.

So which configuration's bundle ends up in the Electron renderer depends on
task scheduling. The e2e suite may exercise a production bundle, a
development bundle, or one overwritten mid-copy by the other.

## Why `package` is safe, and why that is misleading

On the `package` path, `build` and `copy-renderer` both resolve
`ptah-extension-webview:build` to the same **production** task ID, so Nx
deduplicates them into one task and the two are trivially synchronized.

That is an accident of both paths wanting production, not a design. It also
means the failure mode is invisible in the release pipeline and only appears
in e2e — the harness whose entire purpose is to be trusted.

## Relationship to TASK_2026_222 and TASK_2026_226

`TASK_2026_226` was filed on the theory that a false Nx cache hit was serving
a stale renderer. That theory turned out to be **wrong as stated**: at the
time `TASK_2026_222` hit the symptom, `copy-renderer` had no `cache` field at
all, and `isCacheableTask` requires `cache === true` (this workspace has no
`cacheableOperations` fallback). The target was never cached, so it could not
have served a cached stale directory.

`TASK_2026_226` reproduced the described failure only after first adding
`cache: true`, then fixed the cache key properly. That work is correct and
worth having. But it does **not** explain the original observation: fresh
chunks in `dist/apps/ptah-extension-webview/browser/` beside stale chunks in
`dist/apps/ptah-electron/renderer/`, with a manual
`node apps/ptah-electron/scripts/copy-renderer.js` fixing it instantly.

This configuration race is the leading candidate for that. It is not proven.
Proving or eliminating it is part of this task.

## Scope

1. Decide the configuration contract deliberately. The four call sites have
   genuinely conflicting needs — `e2e`, `showcase` and `e2e:nightly` want
   development; `package` wants production. A single hardcoded configuration
   on `copy-renderer` cannot serve both.
2. Guarantee ordering between the webview build and the copy on every path,
   rather than relying on task-ID deduplication to do it by accident.
3. Determine whether this actually produced the `TASK_2026_222` symptom. If it
   did, say so in the closing note — `TASK_2026_226`'s carrier currently
   records an explanation that its own investigation disproved, and the record
   should not be left implying the staleness is fully accounted for.

## Out of scope

- `build-dev`'s own cacheability. `TASK_2026_226` deliberately left it
  uncacheable: it declares no `outputs`, and its five nested `nx <target>`
  shell-outs are each already correctly cached independently. A cache hit on
  the wrapper would skip invoking all five children with nothing to restore.
  There is a guard asserting it stays uncacheable
  (`apps/ptah-electron/src/config/renderer-cache-key.spec.ts`). Do not
  reverse it.
