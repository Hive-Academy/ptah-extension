# Batch 1 report — TASK_2026_879_f5da

Binary file contract and Electron IPC. Electron is the host that serves the method (`fileViewer: true`). `file:viewContent` is unchanged.

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-file-binary.types.ts` (new contract)
- `libs/shared/src/lib/types/rpc.types.ts` (registry + `RPC_METHOD_ENTRIES`)
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-binary.ts` (magic-byte sniff and caps)
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-binary.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.schema.ts` (`FileViewBinaryParamsSchema`)
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.binary.spec.ts`
- `apps/ptah-electron/src/ipc/ipc-bridge.ts` (`DISPLAY_WINDOW_ALLOWED_METHODS`)
- `apps/ptah-electron/src/ipc/ipc-bridge.display-window.spec.ts`
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` (one expected-absent name; see Decisions)

Not edited, and not required: `container.smoke.spec.ts`, `expected-resolvable.ts`, `surface-composition.spec.ts`, `ALLOWED_METHOD_PREFIXES` (`file:` is already allowed), host-source baseline (the contract only flags host-source-shaped names). No new DI registration. The method is owned by the existing `fileView` manifest entry via `FileViewRpcHandlers.METHODS`.

## Contract

Method: `file:viewBinary`.

Request (`FileViewBinaryParams`, Zod `.strict()`):

- `path: string` (1–4096 chars)
- `workspaceRoot?: string`
- `documentPath?: string`
- No MIME field. A caller-supplied `mime` is `invalid-request` before any filesystem call.

Success (`FileViewBinaryResult`):

- `success: true`
- `absolutePath` — lexical path only, never the realpath
- `workspaceRoot`
- `relativePath` — POSIX slashes
- `mime` — one of `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp`, `application/pdf`
- `kind` — `image` or `pdf`
- `sizeBytes`
- `dataBase64` — standard base64 (RFC 4648), no `data:` prefix

Failure:

- `success: false`
- `reason` — existing `FileViewFailureReason` plus `unsupported-type`
- `error` — one fixed sentence. No `error.message`, errno, or realpath
- `absolutePath?` — lexical path only when the policy already disclosed one. Omitted on a symlink escape
- `sizeBytes?`
- `externalOpenAllowed`

## Why base64

The shared RPC reply is a JSON-safe object. VS Code `postMessage` and the Electron IPC envelope both carry `data` that way. A `Buffer` would not survive the VS Code path. Base64 is what batch 3 turns into a `Blob` and a `blob:` URL. A file at the PDF cap expands by 4/3, about 33 MiB on the wire.

## Size caps

Inclusive ceilings, documented on `FILE_VIEW_BINARY_IMAGE_MAX_BYTES` and `FILE_VIEW_BINARY_PDF_MAX_BYTES`:

- Raster images: 15 MiB
- PDF: 25 MiB

The stat gate uses the PDF ceiling, so a larger file is refused before the body is read. After the magic sniff, an image whose stat size is over 15 MiB is refused without reading the body. A file that grows past the type cap between stat and read is `too-large` (`readBounded` reads one byte past the cap).

## Authorization and signatures

Same `FileLinkRootPolicy.resolveForView` as text, with `maxBytes` set to 25 MiB. That is lexical containment (`isPathWithinRoots`) plus realpath containment, directory refusal, and symlink-escape refusal with no lexical path. Open workspace folders and their worktrees only.

MIME comes only from magic bytes at offset 0:

- PNG `89 50 4E 47 0D 0A 1A 0A`
- JPEG `FF D8 FF`
- GIF `GIF87a` / `GIF89a`
- WebP `RIFF????WEBP`
- BMP `BM` and at least 14 bytes (BITMAPFILEHEADER). A 2-byte `BM` is refused
- PDF `%PDF-`

SVG, XML, RIFF/WAVE, and a `%PDF-` that is not at offset 0 are `unsupported-type` (`This file type cannot be previewed.`). The extension is ignored: `notes.md` with a PNG signature is `image/png`; `photo.png` whose bytes are SVG is refused. `file://` and `https://` are not fetched. On Windows the form gate rejects them as `unsupported-path`.

## Decisions

- **Separate method, not a wider `file:viewContent`.** The text method still refuses binary. Evidence: `file-view-rpc.handlers.ts` and the plan. Reversible.
- **Base64 rather than raw bytes.** Shared transport is JSON-safe. Reversible if a host-only binary channel is added later.
- **Reuse `resolveForView` with a higher `maxBytes`.** No second root policy. Reversible.
- **15 MiB images / 25 MiB PDF.** The task's suggested caps. The stat gate is the larger one so a legal PDF is not refused as an image. Reversible.
- **CLI expected-absent list includes `file:viewBinary`.** `fileViewer` is off on CLI and TUI, so the method is excluded. `rpc-surface.spec.ts` compares that sorted list exactly. The file is outside this batch's exclusive list; the one-line update keeps the next CLI verify from failing. Not executed in this batch's verify. Reversible.

## Verify

Command:

`npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,ptah-electron`

Header:

```
NX   Running targets lint, test, typecheck for 3 projects and 6 tasks they depend on:

- @ptah-extension/shared
- @ptah-extension/rpc-handlers
- ptah-electron
```

Result: **fail** (exit code 1). Failed task: `@ptah-extension/rpc-handlers:test` — 10 suites, 33 tests, none in the file-view specs. Those suites are install-scope cleanup (`ENOTEMPTY`), Windows path-separator mismatches, `D:\tmp` vs `/tmp`, and `EPERM` on directory symlinks. This run shared the machine with another `rpc-handlers` verify in the same worktree.

Passed:

- `@ptah-extension/shared` lint, test, typecheck
- `@ptah-extension/rpc-handlers` lint, typecheck
- `ptah-electron` lint, test, typecheck
- `file-view-binary.spec.ts`
- `file-view-rpc.handlers.spec.ts`
- `file-view-rpc.handlers.binary.spec.ts`

```
Test Suites: 10 failed, 217 passed, 227 total
Tests:       33 failed, 8 skipped, 6014 passed, 6055 total
Failed tasks:
- @ptah-extension/rpc-handlers:test
```

The real-symlink case in the binary handler spec is `it.skip` when this process cannot create a file symlink. Other suites in this run hit `EPERM` on `symlink`, so that case should be treated as not executed here. The handler test still asserts that a policy refusal with no lexical path omits `absolutePath` and does not call external open. Policy-level symlink coverage stays in `file-link-root-policy.spec.ts`.

## What batch 3 must know

Decode (browser):

```ts
const bytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
```

Revoke `url` on item change, close, and destroy. Fetch only the active item. Do not put `dataBase64` or the object URL on the dock snapshot or the detached-window wire.

- `kind: 'image'` → `<img src={url}>`. Shell CSP already allows `img-src` `blob:` (`apps/ptah-electron/src/windows/shell-csp.spec.ts`).
- `kind: 'pdf'` is the D1 branch. Chromium's built-in viewer needs an iframe or embed pointed at the blob URL. Current shell CSP blocks that: `frame-src` is only `ptah-artifact:`, and `object-src` is `'none'`. An iframe `blob:` or an `<embed>`/`<object>` will violate CSP. `worker-src` already allows `'self'` and `blob:`, which is what a same-origin pdf.js worker needs. There is no `pdfjs-dist` in `package.json`. Try the built-in viewer only after `frame-src` includes `blob:` (that is a CSP widening). If that cannot ship on Windows, macOS, and Linux, use pdf.js with a locally bundled worker and do not fetch remote PDF content.
- SVG stays refused. Do not special-case the extension.
- `unsupported-type`, `too-large`, `not-found`, and `unreadable` are retryable panel errors. Branch on `reason`, not on `error` (display copy).
- `externalOpenAllowed` is the existing Open In affordance. A symlink escape sets it false and omits `absolutePath`.
- The detached display window may call `file:viewBinary` only. `file:viewContent` from that child is an RPC error. The main window is unrestricted.
- Skill load: this session had no skill-loading tool. The handler follows `file:viewContent` and `FileLinkRootPolicy`.
