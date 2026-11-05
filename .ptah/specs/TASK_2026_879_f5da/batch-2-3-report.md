# Batch 2–3 report

## Implemented

- Added per-tab file metadata and stable namespaced file keys to `display-dock.state.ts`; repeated direct clicks select the existing item even when pinned. Closing a chat tab releases its items.
- Added Electron extension routing for Markdown, raster image, and PDF links through the dock registry. Other files retain git review; hosts without a registered dock retain existing navigation. Relative links retain workspace and source-document context for secure backend resolution.
- Added file metadata to the detached display wire (version 3), selection conversion, sync snapshot, and both panel hosts. Snapshot contains no bytes. The child window now permits `file:viewContent` for Markdown, as well as `file:viewBinary`.
- Added a standalone active-file viewer: sanitized existing Markdown renderer, image blob URL, and Chromium PDF iframe blob URL. The URL is revoked on item change and destroy; read failures show a retry control in the item.
- Electron shell CSP `frame-src` changed from `ptah-artifact:` to `ptah-artifact: blob:` for built-in PDF preview. `img-src` already allowed `blob:`; `object-src` remains `'none'`. The VS Code renderer CSP was not changed.

## Specs and verification

- Added extension routing cases (`file-link-router.display.spec.ts`) and dock/no-dock behavior (`file-link-router.service.spec.ts`). Added repeated-click, pin, and tab-release coverage (`display-dock.state.spec.ts`). Added active-viewer URL revoke and retryable-error coverage (`display-file-viewer.component.spec.ts`). Updated detached wire round-trip, child IPC allowlist, and shell CSP specs.
- Unit test execution, Nx, npm, build, serve, and e2e were intentionally not run per sandbox instruction. Ptah scoped diagnostics were requested but the TypeScript service was still running after 45 seconds.

## Open risks

- Built-in Chromium PDF rendering requires visual review on Windows, macOS, and Linux. Confirm frame CSP behavior, PDF toolbar, zoom, and URL cleanup in each host.
- The markdown renderer uses the existing sanitizer, but its existing link and image policy should be inspected for remote fetch behavior before calling the no-remote-load requirement fully verified.
- The requested specs were written but could not be executed in this sandbox; orchestrator verification may expose integration errors.

## Decisions

- Used the existing per-tab dock through a root-level registry so the root-provided link router can find the component-owned dock. Reversible.
- Allowed only the existing bounded text-read RPC from the detached child to render Markdown. The main process still validates sender and the backend enforces workspace roots. Reversible.
