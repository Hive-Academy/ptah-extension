# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4 and Revision 5 first. They replace the earlier revisions
where they disagree.

Lane B. Depends on: none.

## Evidence

- `apps/ptah-electron/src/windows/main-window.ts:136-143` - `setPermissionRequestHandler` and `setPermissionCheckHandler` compare only `contents.id`.
- `apps/ptah-electron/src/preload.ts:23,48,60` - the preload exposes `vscode` (generic RPC), `ptahClipboard` and `ptahDiag`.
- The code survey found no `onHeadersReceived` and no CSP for the app shell in `apps/ptah-electron/src`.

## Acceptance criteria

1. A permission request is approved only for the trusted shell origin in the main frame. Each other origin or subframe gets a denial. Unit tests cover the policy.
2. The shell document has a restrictive CSP. `frame-src` starts as `'none'`. No `unsafe-eval`.
3. No regression: the Electron e2e suite passes (`apps/ptah-electron-e2e`), including voice or clipboard flows that need a permission.
4. The VS Code webview CSP does not change.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 2. `.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4, correction 3.
