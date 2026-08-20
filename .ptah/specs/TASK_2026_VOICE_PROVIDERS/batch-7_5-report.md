# Batch 7.5 Report — Packaging Fix (electron-builder traversal-collector defect)

**Verdict: PACKAGING FIXED (PASS on the actual defect; PARTIAL only on a pre-existing, unrelated local Windows environment limitation)**

---

## 1. Root cause recap

`npx nx package ptah-electron` failed **before** electron-builder even began copying files:

```
• using manual traversal of node_modules to build dependency tree
⨯ production dependency not found  parent=@huggingface/transformers dependency=onnxruntime-node version=1.21.0
⨯ Production dependency onnxruntime-node not found for package @huggingface/transformers
    at node_modules/app-builder-lib/src/node-module-collector/traversalNodeModulesCollector.ts:119
```

Chain of causes (confirmed by reading `app-builder-lib`'s source, not guesswork):

1. The USER-DECIDED `overrides.onnxruntime-node = "1.20.1"` pin (root `package.json:268` + `apps/ptah-electron/package.json:54-56`) rewrites the _resolved_ onnxruntime-node install everywhere. `npm ls onnxruntime-node` understands this correctly (npm's own resolver honors `overrides`).
2. npm `overrides` never rewrites a **dependent's own manifest text**. `node_modules/@huggingface/transformers/package.json` still literally declares `"dependencies": { "onnxruntime-node": "1.21.0" }` — this is expected, correct npm behavior, not a bug in our install.
3. Only `1.20.1` physically exists on disk (`node_modules/@huggingface/transformers/node_modules/onnxruntime-node`) — nothing satisfies `1.21.0` anywhere in the tree.
4. electron-builder's `collectNodeModulesWithLogging` (`app-builder-lib/out/util/appFileCopier.js:173-208`) tries the detected package manager first (`pm=npm`, `npm list -a --json` against `dist/apps/ptah-electron`), but that directory has no physical `node_modules` of its own (Nx hoists everything to the workspace root) — the search comes back with **zero** modules, so it falls through to `PM.TRAVERSAL`.
5. `TraversalNodeModulesCollector.buildNodeModulesTreeManually` (`app-builder-lib/out/node-module-collector/traversalNodeModulesCollector.js:63-119`) resolves each dependency by walking the literal `dependencies` field of each package's own `package.json` and requires a version that satisfies that literal string on disk (`locatePackageWithVersion`). It has **zero concept of npm `overrides`** — it never consults the root manifest. Since it wants something satisfying `"1.21.0"` and only `1.20.1` exists, it throws `Production dependency onnxruntime-node not found for package @huggingface/transformers`, which propagates uncaught and aborts the whole `package` target before `verify-packed-onnx.js` ever runs.

This is a deterministic mismatch between (a) the intentionally-overridden physical install and (b) electron-builder's literal-version traversal algorithm — reproduces every time, not flaky.

## 2. Investigated alternative (no viable built-in electron-builder option)

Before writing a patch script, checked whether electron-builder exposes a cleaner built-in escape hatch (`nodeModulesCollector`/`pm` config, an explicit dependency list, etc.):

- `getCollectorByPackageManager` only supports `pnpm | yarn | yarn-berry | bun | npm | traversal` — no override/allowlist mechanism, and no way to force `pm: npm` to be used even when it finds zero local `node_modules` (the npm collector's own zero-result fallback to traversal is unconditional and not configurable).
- Even forcing the npm path would not help here: `dist/apps/ptah-electron` (the `--project` dir passed to electron-builder) has no local `node_modules`, so the npm collector legitimately finds nothing there regardless of the override problem — traversal (which walks via literal manifest text, climbing to the real root `node_modules`) is the path that actually reaches the real install, and it's precisely the one that can't understand `overrides`.
- There is no config knob to tell the traversal collector "trust this version instead." The only two viable fixes are (a) reconcile the declared text so the literal check passes, or (b) physically duplicate a `1.21.0`-labeled copy on disk (rejected — reintroduces the very version whose native binding carries the crash bug, defeating the point of the pin).

Conclusion: the reconcile-script approach is not a workaround of convenience — it is the only fix that satisfies both constraints (keep 1.20.1 physically installed, make electron-builder's traversal walk succeed). Proceeded as recommended.

## 3. The fix

### New file: `apps/ptah-electron/scripts/patch-transformers-onnx-dep.js`

Rewrites the **declared** `dependencies.onnxruntime-node` string inside `node_modules/@huggingface/transformers/package.json` (and, defensively, a nested `node_modules/kokoro-js/node_modules/@huggingface/transformers/package.json` copy if one ever exists — verified today it does not; kokoro-js has no nested `node_modules` and hoists to the same single root install) to match the pin.

Key properties (mirrors `patch-dist-overrides.js`/`patch-sqlite3-tar.js` conventions — plain Node, `'use strict'`, no new deps):

- **Single source of truth**: reads `overrides.onnxruntime-node` from root `package.json` at runtime; falls back to a hardcoded `1.20.1` (commented, kept in sync) only if the root manifest can't be read/parsed.
- **Idempotent**: no-op (logs "already reconciled") when the declared version already matches the pin — verified by running it twice back-to-back.
- **Fails loudly**: exits non-zero with a clear message if the required `@huggingface/transformers` manifest is missing (build/install prerequisite not met). The optional nested `kokoro-js` copy is skipped silently if absent (not an error).
- **Does not touch the physical install**: only rewrites manifest text, never the resolved on-disk version. Verified `npm ls onnxruntime-node` resolves the pin identically before and after.

### Wiring

1. `apps/ptah-electron/project.json` `package` target — added as a new command immediately before the `electron-builder` invocation (electron-builder reads the SOURCE `node_modules` tree at package time, not the generated dist manifest, so it must run here, not just in `build`):

   ```
   "node scripts/copy-wasm.js dist/apps/ptah-electron",
   "node apps/ptah-electron/scripts/patch-transformers-onnx-dep.js",   <-- new
   "electron-builder --config electron-builder.yml --project dist/apps/ptah-electron",
   "node apps/ptah-electron/scripts/verify-packed-native.js",
   ...
   ```

2. Root `package.json` `postinstall` — appended so a fresh `npm install` self-heals without a manual step (low-risk: `@huggingface/transformers` is a normal dependency in this single-node_modules monorepo, always present after `npm install`; the script is a pure JSON text rewrite with no native/compile risk, unlike `rebuild-native.js`'s native compile step):

   ```
   "postinstall": "node apps/ptah-electron/scripts/rebuild-native.js && node apps/ptah-electron/scripts/patch-transformers-onnx-dep.js"
   ```

This composes with the existing `patch-dist-overrides.js`: that script patches the **generated** `dist/apps/ptah-electron/package.json`'s `overrides` block (consumed by the packaged app's own runtime `overrides` resolution), while the new script patches the **source** `@huggingface/transformers` manifest that electron-builder's traversal collector reads during packaging. The two are complementary, not overlapping.

## 4. Verification performed

- **Idempotency**: ran `node apps/ptah-electron/scripts/patch-transformers-onnx-dep.js` twice. First run: `dependencies.onnxruntime-node "1.21.0" -> "1.20.1"`. Second run: `already reconciled`.
- **Pin unaffected**: `npm ls onnxruntime-node` → `@huggingface/transformers@3.8.1 └─ onnxruntime-node@1.20.1 overridden`, identical before and after the patch. Confirmed directly: `require('.../transformers/package.json').dependencies['onnxruntime-node']` reads `1.20.1` post-patch, `1.21.0` was the value it replaced.
- **`npx nx run ptah-electron:package`** — ran to completion of the failure point. Log confirms:
  - `pm=npm` attempted first, found zero local modules in `dist/apps/ptah-electron`, fell back to `pm=traversal` (pre-existing, unrelated to our fix — this fallback happens regardless).
  - `using manual traversal of node_modules to build dependency tree` — **no longer throws**. It proceeded straight through to `updating asar integrity executable resource` (i.e. asar packing, unpacking, and integrity signing completed) — this is well past the point that previously aborted the entire target.
  - `dist/release/win-unpacked/resources/app.asar` (270 MB) and `app.asar.unpacked/node_modules/onnxruntime-node` were both produced.
  - The run then failed later, at a **completely different, later stage**: extracting `winCodeSign-2.6.0.7z` (macOS codesign helper binaries electron-builder downloads by default) via `7za.exe`, with `ERROR: Cannot create symbolic link : A required privilege is not held by the client.` This is a well-known Windows-specific electron-builder limitation — 7z-extracting archives containing symlinks requires either Windows Developer Mode enabled or an elevated/admin process; it is **unrelated to onnxruntime-node, to `@huggingface/transformers`, or to anything touched in this batch**. It is a pure local-machine capability gap.
- **Ran the post-pack verifiers directly against the real (partial) packaged output** (`dist/release/win-unpacked`), since the overall target still exited non-zero on the unrelated winCodeSign step:
  - `node apps/ptah-electron/scripts/verify-packed-onnx.js` → **PASS**: `OK win-unpacked\resources\app.asar.unpacked\node_modules\onnxruntime-node\package.json → onnxruntime-node 1.20.1` / exit 0. This is the exact check that could never run before this fix — it now runs and passes.
  - `node apps/ptah-electron/scripts/verify-packed-native.js` → PASS (better-sqlite3 ABI 143 matches).
  - `node apps/ptah-electron/scripts/verify-packed-wasm.js` → PASS (tree-sitter WASM present).
- **`npx nx typecheck ptah-electron`** → PASS (green).
- **`npx nx lint ptah-electron`** → PASS (0 errors; 4 pre-existing warnings, all unrelated files/rules — `no-empty-function` in `electron-adapters.ts`/`electron-browser-capabilities.ts`, one unused eslint-disable in `update-rpc.handlers.spec.ts` — none touched by this batch).
- **`npx nx typecheck messaging-gateway`** and **`npx nx lint messaging-gateway`** → PASS (0 errors) after the externals cleanup.
- **`npx nx build messaging-gateway --skip-nx-cache`** → PASS, confirming the removed esbuild externals don't break the build.

**How far packaging got**: past the defect this batch targets, through asar assembly + native/WASM/ONNX unpacking + integrity signing, all the way to the NSIS/codesign preparation stage. The one remaining failure is orthogonal and pre-existing (see residual step below).

## 5. USER-MUST-RUN residual step (unrelated to this fix)

Full installer generation on this machine additionally requires Windows Developer Mode (enables unprivileged symlink creation) or running the packaging command elevated, so electron-builder can extract `winCodeSign-2.6.0.7z` (used for downstream macOS-adjacent codesign tooling electron-builder bundles by default). This is **not** part of the onnxruntime-node/traversal-collector defect this batch fixes — it is a separate, standard Windows electron-builder prerequisite. To get a fully signed installer:

1. Enable Developer Mode: Windows Settings → Privacy & Security → For developers → Developer Mode → On (or run the packaging shell as Administrator).
2. Re-run `npx nx run ptah-electron:package`.
3. This should also unblock the `.ptah/specs/TASK_2026_VOICE_PROVIDERS/test-report.md` §7 manual FR-2.4 crash-regression protocol, which needed a real packaged/installed build to test against.

CI/release environments (GitHub Actions Windows runners) typically have Developer Mode-equivalent symlink privileges already, so this is expected to be a local-dev-only caveat, not a release blocker.

## 6. Files created / modified

- **Created**: `apps/ptah-electron/scripts/patch-transformers-onnx-dep.js` — the reconcile script.
- **Modified**: `apps/ptah-electron/project.json` — wired the new script into the `package` target, immediately before the `electron-builder` command.
- **Modified**: `package.json` (root) — appended the new script to `postinstall` (after `rebuild-native.js`).

## 7. Two QA cleanups folded in (Batch 3.5 reroute leftovers)

1. **`libs/backend/messaging-gateway/CLAUDE.md`** — removed all stale `FfmpegDecoder`/`WhisperTranscriber` references (Purpose, Belongs-here, Public API, Internal Structure, Dependencies, Guidelines sections). Added a one-line note that voice moved to `@ptah-extension/voice-providers` for provenance.
2. **`libs/backend/messaging-gateway/project.json`** — verified via `grep -rn` across `libs/backend/messaging-gateway/src` that zero references to `ffmpeg-static`, `@huggingface/transformers`, `onnxruntime-node`, `FfmpegDecoder`, `WhisperTranscriber` remain (confirmed: no matches). Removed all three now-unused externals (`ffmpeg-static`, `@huggingface/transformers`, `onnxruntime-node`) from the esbuild `external` list. Confirmed `nx build messaging-gateway --skip-nx-cache`, `nx typecheck`, and `nx lint` all still pass clean.

## Summary

| Item                                                                       | Result                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| electron-builder traversal-collector abort                                 | **FIXED** — packaging proceeds past it (asar + unpacking + integrity signing all succeed)           |
| `verify-packed-onnx.js` runs and passes against real packaged output       | **PASS** (1.20.1, exit 0)                                                                           |
| `npm ls onnxruntime-node` still resolves 1.20.1                            | **PASS** — unchanged by the fix                                                                     |
| `nx typecheck`/`nx lint` ptah-electron                                     | **PASS**                                                                                            |
| `nx typecheck`/`nx lint`/`nx build` messaging-gateway                      | **PASS**                                                                                            |
| Full signed installer in this sandbox                                      | **PARTIAL** — blocked by an unrelated Windows Developer Mode/symlink-privilege prerequisite; see §5 |
| Doc/config cleanups (messaging-gateway CLAUDE.md + project.json externals) | **DONE**                                                                                            |
