# Batch 1 — Pin + Spike — Implementation Report

**Task**: TASK_2026_VOICE_PROVIDERS · **Batch**: 1 (FR-3) · **Executor**: backend-developer
**Outcome**: ✅ IMPLEMENTED — all verification gates green, R1 spike passed (no API regression). No behavior changes.

---

## Files Changed

### MODIFY

- `package.json` (root) — added `"onnxruntime-node": "1.20.1"` to the `overrides` block (after the `tar` entry).
- `apps/ptah-electron/package.json` — added a top-level `"overrides": { "onnxruntime-node": "1.20.1" }` block (hand-maintained dependency manifest that flows into the electron-builder `generatePackageJson` output).
- `apps/ptah-electron/project.json` —
  - `build` target command list: inserted `node apps/ptah-electron/scripts/patch-dist-overrides.js` immediately after `patch-sqlite3-tar.js` (before `copy-wasm.js`).
  - `package` target command list: appended `node apps/ptah-electron/scripts/verify-packed-onnx.js` after `verify-packed-wasm.js` (post electron-builder).

### CREATE

- `apps/ptah-electron/scripts/patch-dist-overrides.js` — build-time gate. Asserts/injects `overrides["onnxruntime-node"] = "1.20.1"` into the generated `dist/apps/ptah-electron/package.json`. Exits non-zero if the manifest is missing (build-main must have run first). Idempotent: no-op log when the pin is already present. Style mirrors `patch-sqlite3-tar.js` (plain Node, `'use strict'`, no new deps, `ROOT = resolve(__dirname, '../../..')`, trailing-newline preservation).
- `apps/ptah-electron/scripts/verify-packed-onnx.js` — post-pack verifier. Recursively finds every `app.asar.unpacked/node_modules/**/onnxruntime-node/package.json` under `dist/release`, fails (exit 1) unless `version === '1.20.1'`. Throws if no packaged output / no unpacked onnxruntime-node manifest is found. Style mirrors `verify-packed-native.js` / `verify-packed-wasm.js` (same `RELEASE_DIR`, recursive `app.asar.unpacked` walk, `[verify] OK` / `❌` loud-fail convention).

---

## Verification Command Outputs (all green)

### Task 1.1 — `npm ls onnxruntime-node`

```
@ptah-extension/source@0.0.0 D:\projects\ptah-extension
`-- @huggingface/transformers@3.8.1
  `-- onnxruntime-node@1.20.1 overridden
```

The override supersedes `@huggingface/transformers@3.8.1`'s pinned 1.21.0 everywhere (single resolved instance, `overridden`). `npm install` completed clean; postinstall native rebuild reported `better-sqlite3 already built for Electron ABI 143` (no ABI churn from the downgrade).

### `npx nx typecheck ptah-electron`

```
> tsc --noEmit --project apps/ptah-electron/tsconfig.app.json
NX   Successfully ran target typecheck for project ptah-electron
```

### `npx nx lint ptah-electron`

```
✖ 4 problems (0 errors, 4 warnings)
NX   Successfully ran target lint for project ptah-electron
```

0 errors. The 4 warnings are pre-existing (`electron-adapters.ts:253`, `electron-browser-capabilities.ts:498/605`, `update-rpc.handlers.spec.ts:54`) and untouched by this batch. The two new `scripts/*.js` files are plain Node build scripts outside the lint `source` glob (consistent with the existing `patch-*`/`verify-*` scripts); both pass `node --check`.

### Task 1.4 — R1 regression spike (against the 1.20.1 downgrade)

`npx nx test memory-curator`:

```
Test Suites: 3 skipped, 19 passed, 19 of 22 total
Tests:       40 skipped, 293 passed, 333 total
NX   Successfully ran target test for project @ptah-extension/memory-curator
```

`npx nx test messaging-gateway`:

```
Test Suites: 1 skipped, 15 passed, 15 of 16 total
Tests:       32 skipped, 221 passed, 253 total
NX   Successfully ran target test for project @ptah-extension/messaging-gateway
```

(The "worker process failed to exit gracefully" lines are pre-existing Jest teardown-leak notices, not failures — every suite reports passed.)

---

## Spike Outcome (R1 gate)

**No genuine API incompatibility surfaced.** The embedder suite (`memory-curator`, which drives `@huggingface/transformers` ASR/embedding via onnxruntime-node) and the voice suite (`messaging-gateway`, current home of Whisper/Kokoro/ffmpeg) both pass unmodified against onnxruntime-node@1.20.1 under `@huggingface/transformers@3.8.1`. This confirms the plan's §6(3) assumption that the transformers 3.8.1 API surface is unchanged between ORT 1.20.1/1.21.0. **No BLOCKER — safe to proceed to Batch 2.**

---

## Deviations / Notes

- **No `nx rebuild-native` / Electron rebuild triggered by the pin** — onnxruntime-node ships N-API prebuilts (confirmed: postinstall skipped better-sqlite3 rebuild, no onnx compile step), matching plan §6(1).
- **Two-layer defense as specified**: the `overrides` field lives in both the root manifest (dev tree) and the hand-maintained `apps/ptah-electron/package.json` (flows into the generated dist manifest via Nx field-merge); `patch-dist-overrides.js` is the belt-and-braces assertion that it reached `dist/apps/ptah-electron/package.json`; `verify-packed-onnx.js` is the post-pack proof it survived electron-builder's production install. The packaged-app assertions (Batch 7 / Task 7.2) will exercise `verify-packed-onnx.js` end-to-end on a real package — not run in this batch (no packaging performed here).
- **No electron-builder.yml change** — onnxruntime-node is already `asarUnpack`ed (native `.node` binding), so the verifier's `app.asar.unpacked` search path is valid.
- No voice code touched; scope held to FR-3 exactly.

```

```
