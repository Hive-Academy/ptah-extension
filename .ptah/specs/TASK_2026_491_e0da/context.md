# Context

Parent research: `.ptah/specs/TASK_2026_490_583c/research-report.md`. Read Revision 4, Revision 5 and Revision 6 first. They replace the earlier revisions
where they disagree.

Lane B. Depends on: none.

## Evidence

- `apps/ptah-electron/src/windows/main-window.ts:136-143` - `setPermissionRequestHandler` and `setPermissionCheckHandler` compare only `contents.id`.
- `apps/ptah-electron/src/preload.ts:23,48,60` - the preload exposes `vscode` (generic RPC), `ptahClipboard` and `ptahDiag`.
- The code survey found no `onHeadersReceived` and no CSP for the app shell in `apps/ptah-electron/src`.

## Acceptance criteria

1. The two permission handlers follow the decision matrix in "Permission decision matrix" below. Unit tests cover each cell.
2. The shell document has the CSP in "Shell CSP" below. A test reads the effective policy.
3. No regression: the Electron e2e suite passes (`apps/ptah-electron-e2e`), including voice or clipboard flows that need a permission.
4. The VS Code webview CSP does not change.

## Permission decision matrix

Current behavior (`apps/ptah-electron/src/windows/main-window.ts:136-143`): the request handler ignores the permission value. The check handler approves `contents === null`. The two handlers compare only `contents.id`, so a subframe in the shell `webContents` gets the same approval as the main frame.

The matrix applies to `setPermissionRequestHandler` and to `setPermissionCheckHandler`.

| Requester                                     | Permission in the allowlist | Permission not in the allowlist |
| --------------------------------------------- | --------------------------- | ------------------------------- |
| Trusted shell origin, main frame              | approve                     | deny                            |
| Trusted shell origin, subframe                | deny                        | deny                            |
| Any other origin, main frame or subframe      | deny                        | deny                            |
| `contents === null` (no requester identified) | deny (see rule 4)           | deny                            |

Rules:

1. Trusted origin. The match is exact on scheme and host. No prefix match and no substring match. The implementer must determine which origin the shell loads in development and which origin it loads in production. This document does not state them. The task records the two values and pins them in a test.
2. Frame. Use the request details from Electron (the requesting origin and the main-frame flag). Do not use `contents.id` alone.
3. Permission allowlist. The allowlist holds only the permissions that existing flows use. The implementer must enumerate them from the code. Examples to check: microphone for voice, and clipboard. The task records the list. Each other permission gets a denial.
4. `contents === null`. The default is a denial. An exception is possible only when the implementer proves that a necessary Electron-internal check depends on it. In that case, allowlist that exact permission and record the proof. Do not approve `null` for other permissions.
5. The default for each case that the matrix does not name is a denial.

Tests: one unit test for each cell of the matrix, for each of the two handlers. One test for each permission in the allowlist. One test for a near-match origin (same host with a different scheme, and a host that has the trusted host as a prefix).

## Shell CSP

The model is the VS Code policy at `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:269-278`.

| Directive     | Value                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| `default-src` | `'none'`. This is the fallback for each directive that the policy does not name         |
| `script-src`  | explicit. The shell origin. Inline script only with a nonce or a hash. No `unsafe-eval` |
| `style-src`   | explicit. The shell origin plus the sources that the shell uses now                     |
| `img-src`     | explicit                                                                                |
| `font-src`    | explicit                                                                                |
| `connect-src` | explicit. Only the endpoints that the shell calls now                                   |
| `object-src`  | `'none'`                                                                                |
| `base-uri`    | explicit. The shell origin or `'none'`                                                  |
| `frame-src`   | `'none'`                                                                                |
| `form-action` | explicit. The shell origin or `'none'`                                                  |

Rules:

1. The implementer enumerates the sources for each explicit directive from the code and records them in the task. No wildcard sources.
2. No `unsafe-eval`. No `unsafe-inline` for scripts.
3. Delivery. The implementer must decide and document the delivery method. The first option is a response header, set through `session.webRequest.onHeadersReceived` or through the custom protocol handler. The second option is a `<meta>` tag in the shell document. `frame-ancestors` does not work in a `<meta>` tag. If the policy needs `frame-ancestors`, use a response header.
4. A test reads the effective policy from the loaded shell document or from the response and asserts each directive in the table. A second test asserts that an `eval` call and an inline script without a nonce fail.

## Source

`.ptah/specs/TASK_2026_490_583c/critique-engineering.md` section 2. `.ptah/specs/TASK_2026_490_583c/research-report.md` Revision 4, correction 3.
