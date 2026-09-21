# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane B. Depends on: TASK_2026_491.

## Candidates

1. `iframe` from a Ptah custom protocol with a unique origin for each server, app and version. `sandbox="allow-scripts allow-same-origin"` is acceptable only because the document is cross-origin.
2. `WebContentsView` with an ephemeral partition and no preload. It is not a DOM element, so resize, z-order, focus and the postMessage bridge need IPC. "No preload" is not sufficient. The spike sets and asserts each setting in "Electron isolation settings" below.

Rejected before the spike: `srcdoc` with `allow-same-origin` (same origin as the parent). `blob:` is not a substitute for a distinct origin.

## Electron isolation settings

For candidate 2, the spike sets each item and a test asserts each item:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- a `will-navigate` block
- a `setWindowOpenHandler` that denies each request
- a denial of each permission for the app origin. This depends on TASK_2026_491_e0da.

For candidate 1, the iframe is in the shell renderer. The spike asserts the same navigation block, window-open denial and permission denial for the app origin.

## Malicious fixtures must fail to

Read preload globals (`window.vscode`, `ptahClipboard`, `ptahDiag`), read the host DOM, read local files or cookies, reach an undeclared network domain, navigate the top frame, open a popup, get a browser permission. A message flood and a renderer crash must have a bounded recovery.

The fixtures verify each control in "Electron isolation settings". One fixture for each control:

- A call to `require` and a read of `process` fail (`nodeIntegration: false`, `sandbox: true`).
- A read of a global from the isolated world fails (`contextIsolation: true`).
- A cross-origin read and a `file:` load fail (`webSecurity: true`).
- A navigation of the app frame or view to an undeclared URL is blocked (`will-navigate`).
- A `window.open` call and a link with `target="_blank"` are denied (`setWindowOpenHandler`).
- A request for camera, microphone, geolocation, clipboard and notifications is denied for the app origin.

## Also decide

The Zod-validated message bridge (method allowlist, `event.source`, origin, view token, byte limit, rate limit), the app CSP (rule below), and resource budgets.

App CSP rule. `_meta.ui.csp` comes from the third-party app. The host owns a baseline CSP that an app cannot relax. App metadata can only add origins, and only for `connect-src` and the resource domains. Each origin must pass a host allowlist check. App metadata can never add `script-src` sources, `unsafe-inline`, `unsafe-eval`, wildcards, `frame-src` or navigation. The host rejects values outside the baseline. The host does not merge them. When the metadata is absent, the baseline applies. See `research-report.md` Revision 6, entry 2.

Fixture requirement: metadata that asks for an extra `script-src` source, a `frame-src` source, a wildcard, or an origin outside the allowlist is rejected. One fixture for each of the four cases. A test reads the effective CSP of the app document and asserts that it equals the baseline plus the approved origins.

## Deliverable

`spike-report.md` in this folder: comparison table, the chosen container, and what a malicious app can still do. Tests use `apps/ptah-electron-e2e`.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 2. `.ptah/specs/TASK_2026_490_583c/research-mcp-apps.md`, host duties checklist.

## Preparation done

Pre-spike comparison criteria, attack fixture corpus (17 files), and isolation settings specification prepared at [containment-comparison.md](./containment-comparison.md).
