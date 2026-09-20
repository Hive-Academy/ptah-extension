# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4 and Revision 5 first. They replace the earlier revisions
where they disagree.

Lane B. Depends on: TASK_2026_491.

## Candidates

1. `iframe` from a Ptah custom protocol with a unique origin for each server, app and version. `sandbox="allow-scripts allow-same-origin"` is acceptable only because the document is cross-origin.
2. `WebContentsView` with an ephemeral partition and no preload. It is not a DOM element, so resize, z-order, focus and the postMessage bridge need IPC.

Rejected before the spike: `srcdoc` with `allow-same-origin` (same origin as the parent). `blob:` is not a substitute for a distinct origin.

## Malicious fixtures must fail to

Read preload globals (`window.vscode`, `ptahClipboard`, `ptahDiag`), read the host DOM, read local files or cookies, reach an undeclared network domain, navigate the top frame, open a popup, get a browser permission. A message flood and a renderer crash must have a bounded recovery.

## Also decide

The Zod-validated message bridge (method allowlist, `event.source`, origin, view token, byte limit, rate limit), the CSP built from `_meta.ui.csp` with a restrictive default, and resource budgets.

## Deliverable

`spike-report.md` in this folder: comparison table, the chosen container, and what a malicious app can still do. Tests use `apps/ptah-electron-e2e`.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 2. `.ptah/specs/TASK_2026_490_583c/research-mcp-apps.md`, host duties checklist.
