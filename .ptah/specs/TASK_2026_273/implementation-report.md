---
id: TASK_2026_273
status: in_review
type: bugfix
title: >-
  ptah-cli and ptah-tui register AST services but never ship the tree-sitter
  grammars, so AST init aborts on every file
---

# Implementation Report — TASK_2026_273

## Root cause (confirmed)

`resolveWasmPath()` (`libs/backend/workspace-intelligence/src/ast/wasm-bundle-dir.ts`)
resolves grammars relative to `BUNDLE_DIR`, the directory of the currently
executing bundle (`import.meta.url` of `main.mjs` / `tui.mjs`). Both
`ptah-cli` and `ptah-tui` bundle `workspace-intelligence` inline (`bundle:
true`, not externalized), so `BUNDLE_DIR` for both is `dist/apps/ptah-cli`.
`scripts/copy-wasm.js` was never wired into either app's build, so
`dist/apps/ptah-cli/wasm/` never existed and `Parser.init({ locateFile })`
aborted for every file, for all five grammars. Separately,
`apps/ptah-cli/package.json` `files` never listed `wasm`, so even a
dist-only fix would still have published a grammar-less npm package.

## Fix

### 1. Copy step — one target covers both `ptah-cli` and `ptah-tui`

`apps/ptah-tui:build` outputs `tui.mjs` into `dist/apps/ptah-cli/` (declared
`outputPath`, `deleteOutputPath: false`, `dependsOn` ptah-cli's `build`) — the
**same directory** as `ptah-cli`'s `main.mjs`. Since `BUNDLE_DIR` is computed
per-bundle from its own file location, and both bundles live in the same
directory, a single `wasm/` copy into `dist/apps/ptah-cli/wasm/` satisfies
`resolveWasmPath` for both `main.mjs` and `tui.mjs`. **`ptah-tui` needs no
copy step of its own** — confirmed by inspecting `apps/ptah-tui/project.json`
(`outputPath: "dist/apps/ptah-cli"`) and its `CLAUDE.md` ("Build & Run":
"lands beside `main.mjs`").

`apps/ptah-cli/project.json` changes:

- Renamed the esbuild `build` target to `build-esbuild` (options unchanged).
- New `build`: `nx:noop`, `dependsOn: ["build-esbuild", "copy-wasm"]` — mirrors
  the existing `ptah-extension-vscode` pattern (`build` → noop wrapping
  `build-esbuild` + `post-build-copy`), so every existing caller of the
  `build` target (direct `nx build ptah-cli` in both GitHub workflows,
  `build-embedder-worker`'s `dependsOn: ["build"]`, `ptah-tui`'s
  cross-project `dependsOn`) gets the copy for free with no caller changes.
- New `copy-wasm`: `nx:run-commands`, `dependsOn: ["build-esbuild"]`
  (must run after `build-esbuild`, which has `deleteOutputPath: true` and
  would otherwise wipe it), runs `node scripts/copy-wasm.js dist/apps/ptah-cli`.

### 2. Publish step — widened `files`

`apps/ptah-cli/package.json` `files` now includes `"wasm"` alongside the
existing `.mjs` bundles. This is the half that makes the fix real — the copy
step alone only fixes local dev/dist; `files` gates what `npm pack`/`npm
publish` actually ships.

### 3. `resolveWasmPath` — verified against the published layout, not just dist

`BUNDLE_DIR` is `path.dirname(fileURLToPath(import.meta.url))` of the
executing bundle. In the published package, `main.mjs` sits at the package
root (unchanged, already true), and `wasm/` is now a sibling directory of it
(same as `dist/apps/ptah-cli/`). So once installed into
`node_modules/@hive-academy/ptah-cli/`, `main.mjs`'s `BUNDLE_DIR` is that
package root and `resolveWasmPath('tree-sitter-c-sharp.wasm')` resolves to
`node_modules/@hive-academy/ptah-cli/wasm/tree-sitter-c-sharp.wasm` — a real
sibling, confirmed to exist by the actual `npm pack` tarball listing below
(`package/main.mjs` and `package/wasm/*.wasm` are both top-level entries next
to each other). **No code change was needed in `resolveWasmPath` /
`wasm-bundle-dir.ts`** — the existing algorithm is layout-agnostic as long as
`wasm/` is a sibling of the bundle, which is now true in both dist and the
published tarball.

### 4. Packed-artifact guard extended (CLI side)

New `apps/ptah-cli/scripts/verify-packed-wasm.cjs` — the CLI-package sibling
of `apps/ptah-electron/scripts/verify-packed-wasm.js`. Unlike the Electron
script (inspects an already-built asar), this one runs a **real `npm pack`**
against `dist/apps/ptah-cli`, lists the tarball with `tar -tzf`, and extracts
each required `wasm/*.wasm` entry with `tar -xzf ... -O` to assert
non-empty size. `.cjs` extension is deliberate: `apps/ptah-cli/package.json`
declares `"type": "module"`, so a `.js` file there is ESM by default and
`require()` throws; `.cjs` forces CommonJS regardless of the nearest
`package.json`.

Wired in as a new `verify-packed-wasm` nx target
(`dependsOn: ["restore-cli-manifest"]`), added to `publish:dry-run` and
`publish`'s `dependsOn`.

**This alone would NOT have caught the original bug in CI**, because
`.github/workflows/publish-cli.yml`'s `publish` job never calls
`nx run ptah-cli:publish*` — it runs `npm publish` directly from
`dist/apps/ptah-cli` via a raw `working-directory` step, bypassing the Nx
target graph entirely. Fixed that gap too: added a
**"Verify packed WASM assets (real npm pack)"** step to `publish-cli.yml`,
running `node apps/ptah-cli/scripts/verify-packed-wasm.cjs` right before
"Publish dry-run", and extended the existing "Verify dist contents" step's
file list with the six `wasm/*.wasm` paths (cheap dist-level check, doesn't
replace the tarball-level one — dist existing is necessary but not sufficient,
which is the entire bug class here).

### 5. `ptah-tui` — no separate CLAUDE.md/wiring changes needed

Confirmed via `apps/ptah-tui/CLAUDE.md` and `project.json`: it depends on
`ptah-cli:build` (now the noop wrapping `copy-wasm`), builds into the same
directory, and has `deleteOutputPath: false`, so it never disturbs `wasm/`.

## Verification gate — real output

### Build produces wasm in dist

```
$ npx nx build ptah-cli --skip-nx-cache
> nx run ptah-cli:copy-wasm
> node scripts/copy-wasm.js dist/apps/ptah-cli
  Copied web-tree-sitter.wasm (195.6 KB)
  Copied tree-sitter-javascript.wasm (402.1 KB)
  Copied tree-sitter-typescript.wasm (1380.7 KB)
  Copied tree-sitter-python.wasm (447.2 KB)
  Copied tree-sitter-go.wasm (212.1 KB)
  Copied tree-sitter-c-sharp.wasm (4983.7 KB)
WASM assets copied to D:\projects\ptah-extension\dist\apps\ptah-cli\wasm
NX   Successfully ran target build for project ptah-cli and 27 tasks it depends on
```

`ls dist/apps/ptah-cli/wasm/` — all 6 files present with correct non-zero
sizes (`tree-sitter-c-sharp.wasm` 5,103,332 bytes, matching source).

`npx nx run ptah-cli:restore-cli-manifest --skip-nx-cache` — also succeeded
(builds `tui.mjs`, `embedder-worker.mjs`, restores `package.json`); exit 0.

### `npm pack` — real tarball, real listing (not dry-run)

```
$ node apps/ptah-cli/scripts/verify-packed-wasm.cjs
npm notice Tarball Contents
npm notice 1.1kB   LICENSE.md
npm notice 47.2kB  README.md
npm notice 60.9kB  docs/jsonrpc-schema.md
npm notice 7.1kB   docs/migration.md
npm notice 5.5kB   embedder-worker.mjs
npm notice 2.8MB   main.mjs
npm notice 2.2kB   package.json
npm notice 2.6MB   tui.mjs
npm notice 5.1MB   wasm/tree-sitter-c-sharp.wasm
npm notice 217.2kB wasm/tree-sitter-go.wasm
npm notice 411.8kB wasm/tree-sitter-javascript.wasm
npm notice 457.9kB wasm/tree-sitter-python.wasm
npm notice 1.4MB   wasm/tree-sitter-typescript.wasm
npm notice 200.3kB wasm/web-tree-sitter.wasm
npm notice package size: 2.2 MB
npm notice unpacked size: 13.3 MB
npm notice total files: 14

[verify-packed-wasm] Full tarball listing:
package/package.json
package/docs/jsonrpc-schema.md
package/LICENSE.md
package/docs/migration.md
package/README.md
package/embedder-worker.mjs
package/main.mjs
package/tui.mjs
package/wasm/tree-sitter-c-sharp.wasm
package/wasm/tree-sitter-go.wasm
package/wasm/tree-sitter-javascript.wasm
package/wasm/tree-sitter-python.wasm
package/wasm/tree-sitter-typescript.wasm
package/wasm/web-tree-sitter.wasm

[verify] OK  wasm/web-tree-sitter.wasm (195.6 KB)
[verify] OK  wasm/tree-sitter-javascript.wasm (402.1 KB)
[verify] OK  wasm/tree-sitter-typescript.wasm (1380.7 KB)
[verify] OK  wasm/tree-sitter-python.wasm (447.2 KB)
[verify] OK  wasm/tree-sitter-go.wasm (212.1 KB)
[verify] OK  wasm/tree-sitter-c-sharp.wasm (4983.7 KB)

✅ Packed npm tarball (@hive-academy/ptah-cli) contains the tree-sitter WASM runtime + grammars.
```

This is the actual `.tgz` produced by `npm pack` in `dist/apps/ptah-cli`
(not `--dry-run`), listed and read back with `tar`, deleted after
verification. This is the decisive evidence the bug is fixed: before this
change, `files` excluded `wasm`, so this same command would have shown
`package/wasm/*.wasm` entries **missing** from the listing.

Two portability bugs were found and fixed while getting this real (not
dry-run) verification working, both Windows-specific:

- `execFileSync('npm', ...)` → `ENOENT` (`npm` is `npm.cmd` on Windows, not
  directly executable without a shell). Fixed with `shell: true` on the
  `npm pack` call only.
- `tar -tzf <absolute D:\... path>` → `tar (child): Cannot connect to D:
resolve failed` (GNU/MSYS `tar` parses a leading drive-letter colon as
  `host:path` remote-shell syntax). Fixed by running `tar` with
  `cwd: DIST_DIR` and a bare relative filename.
- Extracting the 5 MB C# grammar via `execFileSync` also needed
  `maxBuffer: 20 * 1024 * 1024` (default 1 MB `maxBuffer` truncated with
  `ENOBUFS`).

### Typecheck / lint / test

```
$ npx nx run ptah-cli:typecheck --skip-nx-cache
NX   Successfully ran target typecheck for project ptah-cli   (exit 0)

$ npx nx run ptah-cli:test --skip-nx-cache
Test Suites: 1 skipped, 64 passed, 64 of 65 total
Tests:       3 skipped, 961 passed, 964 total
NX   Successfully ran target test for project ptah-cli   (exit 0)

$ npx nx run-many -t typecheck,lint,test -p ptah-cli,ptah-tui --skip-nx-cache
ptah-cli:lint    → 0 errors, 125 warnings (pre-existing @typescript-eslint/no-non-null-assertion
                   in e2e spec files, unrelated to this change — not introduced by it)
ptah-tui:lint    → All files pass linting
ptah-tui:typecheck → clean
ptah-tui:test    → Test Suites: 25 passed, 25 total; Tests: 326 passed, 326 total
NX   Successfully ran targets typecheck, lint, test for 2 projects   (exit 0)
```

All targets exit 0. The 125 lint warnings are pre-existing non-null-assertion
warnings in `apps/ptah-cli/tests/e2e/**` spec files, unrelated to this
change (verified: none point at any file touched here).

## Not verified — stated plainly, not silently assumed covered

**The Electron asar C# grammar entry (`apps/ptah-electron/scripts/verify-packed-wasm.js`'s
`wasm/tree-sitter-c-sharp.wasm` check) was NOT run against a real packaged
asar in this session.** `nx run ptah-electron:package` requires
`rebuild-native` (a from-source `better-sqlite3` compile for the Electron
ABI, needs a C++ toolchain) plus a full `electron-builder` installer build —
not cheap by the task's own bar, and out of scope for what this session
touched (only `ptah-cli`/`ptah-tui`). This remains exactly as unverified as
the carrier described it going in. Do not read anything above as having
covered it.

## Constraints honored

- Did not touch `libs/backend/workspace-intelligence/**`.
- Did not touch `libs/frontend/dashboard/**` or `libs/frontend/chat-ui/**`.
- No git commit made.
- No npm publish attempted (the real `npm pack` tarball produced during
  verification was deleted by the script after inspection, never uploaded).

## Files changed

- `D:\projects\ptah-extension\apps\ptah-cli\project.json` — split `build`
  into `build-esbuild` + noop `build` (`dependsOn: build-esbuild, copy-wasm`);
  added `copy-wasm` and `verify-packed-wasm` targets; wired
  `verify-packed-wasm` into `publish:dry-run`/`publish`.
- `D:\projects\ptah-extension\apps\ptah-cli\package.json` — added `"wasm"`
  to `files`.
- `D:\projects\ptah-extension\apps\ptah-cli\scripts\verify-packed-wasm.cjs`
  (new) — real `npm pack` + tarball inspection gate.
- `D:\projects\ptah-extension\.github\workflows\publish-cli.yml` — extended
  "Verify dist contents" file list with the 6 wasm paths; added a "Verify
  packed WASM assets (real npm pack)" step before "Publish dry-run" (the
  publish job runs raw `npm publish`, not the Nx `publish` target, so the
  Nx-level `dependsOn` wiring alone would not have gated this workflow).

## Decision deferred to the user (not made unilaterally)

`context.md` posed a real tradeoff (ship all five grammars vs. a subset vs.
lazy-download) with a concrete size cost: **+7.4 MB raw / ~0.66 MB compressed**
per `npm install`. This implementation ships all five (matching the existing
Electron/VS Code behavior, the smallest possible diff, and the option the
carrier itself did not rule out) rather than silently picking the
lazy-download alternative, which would add a new network dependency to a
previously offline CLI path — a product decision, not a bugfix detail. If a
subset or lazy-download is preferred, that is a follow-up, not a blocker to
this fix landing.
