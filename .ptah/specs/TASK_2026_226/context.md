# Electron e2e tests a stale renderer

## How it was found

While verifying the glyph-margin markers for `TASK_2026_222`, a theme fix in
`libs/frontend/editor/src/lib/diff-view/diff-view.component.ts` refused to
appear in the running Electron app across three rebuild cycles.

Both of these reported success:

```
npx nx build-dev ptah-electron
npx nx copy-renderer ptah-electron
```

Yet `dist/apps/ptah-electron/renderer/` still contained chunks timestamped
before the edit, while `dist/apps/ptah-extension-webview/browser/` contained
fresh ones. Running the copy script directly fixed it immediately:

```
node apps/ptah-electron/scripts/copy-renderer.js
```

## Mechanism

Verified against `apps/ptah-electron/project.json` and
`apps/ptah-electron-e2e/project.json` at commit `833d4bdc7`:

- `apps/ptah-electron/project.json` has **no `implicitDependencies`** key.
- `ptah-electron` has no import-derived graph edge to
  `ptah-extension-webview` — the renderer is copied as a build artifact, not
  imported as code.
- `copy-renderer` declares `dependsOn: ["ptah-extension-webview:build"]` and
  `outputs: ["{workspaceRoot}/dist/apps/ptah-electron/renderer"]`, but
  **declares no `inputs`**. `dependsOn` orders the tasks; it does not by
  itself put the dependency's output into this task's cache key, because
  the default `^default` input only traverses real project-graph edges.

Net effect: `copy-renderer`'s hash is computed over `ptah-electron`'s own
source files. A change confined to `libs/frontend/**` leaves that hash
unchanged, so Nx restores the cached `renderer` directory — overwriting or
leaving in place the stale chunks — and prints a cache-hit success.

`apps/ptah-electron-e2e/project.json` chains both targets:

```json
"e2e":         [{"target": "build-dev",     "projects": ["ptah-electron"]},
                {"target": "copy-renderer", "projects": ["ptah-electron"]}]
"showcase":    [ ...same... ]
"e2e:nightly": [ ...same... ]
```

so `nx e2e ptah-electron-e2e` inherits the staleness on all three targets.

## Why this matters beyond one debugging session

`apps/ptah-electron-e2e` is the only harness in the repo that exercises the
real renderer in a real Electron host. `TASK_2026_218` existed specifically
because no live host had ever been reached, and `TASK_2026_221` /
`TASK_2026_222` were both gated on that harness. A harness that can silently
run yesterday's UI undermines every claim made through it.

Note that this failure mode is **silent and green**. There is no error, no
warning, and no timestamp shown. The suite passes against the old renderer.

## Scope

1. Make a `libs/frontend/**` change invalidate `ptah-electron`'s
   `copy-renderer`. Either `implicitDependencies: ["ptah-extension-webview"]`
   on `ptah-electron`, or explicit `inputs` on `copy-renderer` naming the
   webview's output — decide which is correct for this graph rather than
   applying both.
2. Prove the fix the way the bug was found: edit a file under
   `libs/frontend/**`, run `nx copy-renderer ptah-electron`, and confirm the
   emitted chunk contains the edit. A cache-miss log line alone is not proof.
3. Add a guard so this cannot silently regress.

## Out of scope

- The `perf-m1-diff-redisplay.spec.ts` failure. It was confirmed pre-existing
  during `TASK_2026_222` by reverting both changed lib files to `HEAD`,
  rebuilding, and reproducing the identical failure. Do not fold it in here.
