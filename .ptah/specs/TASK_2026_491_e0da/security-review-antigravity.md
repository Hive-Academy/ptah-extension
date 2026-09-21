## Verdict
REJECT
The proposed implementation completely breaks clipboard write functionality across the Electron application shell because Chromium issues permission requests for `clipboard-read` rather than `clipboard-sanitized-write`. Additionally, same-document media permission status queries fail closed due to an invalid requirement that `securityOrigin` be defined on check handlers, and the shell CSP breaks remote marketplace card icons and external markdown images. The new unit tests fail to catch these defects because they rely on artificial mock fixtures that do not reflect Chromium's runtime contract.

## Defects

1. `apps/ptah-electron/src/windows/permission-policy.ts:12`
   **What is wrong**: The permission allowlist schema restricts allowed permissions to only `media` and `clipboard-sanitized-write` (`z.enum(['media', 'clipboard-sanitized-write'])`). However, for `file:///` origins in Chromium/Electron, `navigator.clipboard.writeText()` dispatches a permission request with `permission: 'clipboard-read'`, not `clipboard-sanitized-write`.
   **Concrete input/condition**: Any renderer component invoking `navigator.clipboard.writeText(...)` from the shell window (e.g. `libs/frontend/marketplace/src/lib/oauth-surface.component.ts:625`, `libs/frontend/memory-curator-ui/src/lib/services/vec-embedder-recovery.service.ts:245`, and `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.ts:143`).
   **Consequence**: The permission request handler fails validation at line 51 and returns `false`. Chromium rejects the promise with `NotAllowedError: Failed to execute 'writeText' on 'Clipboard': Write permission denied.`. All clipboard writing in the Electron app is broken, directly violating Acceptance Criterion 3.
   **Severity**: `BLOCKING`

2. `apps/ptah-electron/src/windows/permission-policy.ts:78-82`
   **What is wrong**: The media check handler branch requires `subject.securityOrigin !== undefined` (`return permission !== 'media' || (subject.securityOrigin !== undefined && ...)`). In Chromium and Electron, `PermissionCheckHandlerHandlerDetails` does not provide `securityOrigin` for same-document permission queries from the top-level frame (it provides `embeddingOrigin`, `isMainFrame`, `mediaType`, and `requestingUrl`).
   **Concrete input/condition**: The renderer executing `navigator.permissions.query({ name: 'microphone' })`, or Chromium performing internal permission checks on microphone access.
   **Consequence**: Because `subject.securityOrigin` is `undefined`, line 78 evaluates to `false`. Media permission checks are denied, reporting the microphone permission state as `'denied'` even when audio capture should be permitted.
   **Severity**: `BLOCKING`

3. `apps/ptah-electron/scripts/copy-renderer.js:105`
   **What is wrong**: The generated Content-Security-Policy restricts images to `"img-src 'self' data: blob:"`, omitting `https:`.
   **Concrete input/condition**: The marketplace UI loading card icons from external MCP registry / Smithery endpoints via `<img [attr.src]="src" (error)="onIconError(src)"/>` (`libs/frontend/marketplace/src/lib/smithery-surface.component.ts:417-423`, `:1128-1132`), or chat messages rendering assistant/user markdown containing remote images (`![diagram](https://...)`) permitted by DOMPurify (`libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:158-159`).
   **Consequence**: The browser CSP blocks network loading of all remote marketplace icons and external markdown images. Marketplace cards trigger `(error)` and degrade to lettered avatars, while chat markdown diagrams fail to render.
   **Severity**: `BLOCKING`

4. `apps/ptah-electron/src/services/electron-browser-capabilities.ts:382-392` & `apps/ptah-electron/src/windows/main-window.ts:136-139`
   **What is wrong**: `ElectronBrowserCapabilities` creates a secondary `BrowserWindow` for CDP automation without defining a `partition` in `webPreferences`. Consequently, this window shares `session.defaultSession` with `mainWindow`. `installPermissionPolicy` registers its permission handlers on `shellContents.session` (`session.defaultSession`).
   **Concrete input/condition**: Any page navigated to by the CDP browser automation service that requests or checks web permissions.
   **Consequence**: In `permission-policy.ts:49`, `allows` checks `contents !== shellContents`. Because `contents` is the CDP window's `webContents` and `shellContents` is `mainWindow.webContents`, all permission requests and checks from the secondary window are unconditionally denied. Furthermore, sharing `session.defaultSession` between the trusted application shell and untrusted CDP web targets creates a shared-state security risk (shared cookies, local storage, HTTP cache, and credentials).
   **Severity**: `NON-BLOCKING`

5. `apps/ptah-electron/scripts/copy-renderer.js:74-122`
   **What is wrong**: `secureRendererHtml` is not idempotent and inline script hash computation is fragile. It uses `normalized.replace(/<head\s*>/i, ...)` without checking if a CSP `<meta>` tag already exists. Script hashes are computed from the raw matched text within `<script>` tags.
   **Concrete input/condition**: Running `copy-renderer.js` against an already patched HTML file, or any subsequent build step, formatter, linter, or Git line-ending conversion (`core.autocrlf`) altering whitespace inside the inline `<script>` block in `dist/apps/ptah-electron/renderer/index.html`.
   **Consequence**: Running copy twice produces duplicate, conflicting `<meta http-equiv="Content-Security-Policy">` tags. Any post-copy whitespace modification invalidates the SHA-256 hash, causing Chromium to block the theme bootstrap script on startup.
   **Severity**: `NON-BLOCKING`

6. `apps/ptah-electron/src/windows/permission-policy.ts:22-33,60-63`
   **What is wrong**: `parseTrustedUrl` and path comparison rely on exact string equality of `URL.pathname` (`requesting?.pathname !== renderer.pathname`). On Windows, drive letters in `file:` URLs are case-insensitive on the filesystem, but `URL.pathname` does not normalize case (`/C:/app/...` vs `/c:/app/...`).
   **Concrete input/condition**: A permission request where Electron provides a URL with differing drive-letter casing (e.g. lowercase `file:///c:/...` vs uppercase `file:///C:/...`).
   **Consequence**: The check fails closed, rejecting permission requests for legitimate local renderer documents due to drive letter case mismatch.
   **Severity**: `NON-BLOCKING`

7. `apps/ptah-electron/src/windows/shell-csp.spec.ts:121-151` & `apps/ptah-electron/src/windows/permission-policy.spec.ts:177-210`
   **What is wrong**: Low test fidelity. `shell-csp.spec.ts` verifies only that the string content of the `<meta>` tag matches an expected dictionary; it does not test browser enforcement of `img-src`, `connect-src`, `font-src`, or `frame-src`. In `permission-policy.spec.ts:54-61`, the test harness supplies artificial details (`securityOrigin: 'file:///'`, `mediaTypes: ['audio']`, `mediaType: 'audio'`) to every test case, concealing the runtime absence of `securityOrigin` on check handlers.
   **Concrete input/condition**: Executing the unit test suite against flawed permission logic.
   **Consequence**: The tests pass green despite critical functional regressions in real Electron execution.
   **Severity**: `NON-BLOCKING`

## Matrix conformance

| Matrix Cell | Code Result | Deciding Line | Test Coverage |
| :--- | :--- | :--- | :--- |
| **Request**: Trusted shell origin, main frame \| Allowed permission | Approve | `permission-policy.ts:77` (`clipboard-sanitized-write`); `lines 77-82` (`media` audio) | `permission-policy.spec.ts:101-107` |
| **Request**: Trusted shell origin, main frame \| Denied permission | Deny | `permission-policy.ts:51` (`!permissionSchema.safeParse().success`) | `permission-policy.spec.ts:109-116` |
| **Request**: Trusted shell origin, subframe \| Allowed permission | Deny | `permission-policy.ts:51` (`!parsed.success` via line 14 `isMainFrame: z.literal(true)`) | `permission-policy.spec.ts:101-107` |
| **Request**: Trusted shell origin, subframe \| Denied permission | Deny | `permission-policy.ts:51` (`!permissionSchema.safeParse().success \|\| !parsed.success`) | `permission-policy.spec.ts:109-116` |
| **Request**: Other origin, main/subframe \| Allowed permission | Deny | `permission-policy.ts:60-63` (`requesting?.pathname !== renderer.pathname`) | `permission-policy.spec.ts:101-107` |
| **Request**: Other origin, main/subframe \| Denied permission | Deny | `permission-policy.ts:51` (`!permissionSchema.safeParse().success`) | `permission-policy.spec.ts:109-116` |
| **Request**: `contents === null` \| Allowed permission | Deny | `permission-policy.ts:49` (`!contents`) | `permission-policy.spec.ts:101-107` |
| **Request**: `contents === null` \| Denied permission | Deny | `permission-policy.ts:49` (`!contents`) | `permission-policy.spec.ts:109-116` |
| **Check**: Trusted shell origin, main frame \| Allowed permission | Deny in real runtime (`media` query); Approve in mock test | `permission-policy.ts:78` (denies due to missing `securityOrigin`); `line 77` (`clipboard-sanitized-write`) | `UNCOVERED` for real Electron details; covered only by synthetic mock `permission-policy.spec.ts:101-107` |
| **Check**: Trusted shell origin, main frame \| Denied permission | Deny | `permission-policy.ts:51` (`!permissionSchema.safeParse().success`) | `permission-policy.spec.ts:109-116` |
| **Check**: Trusted shell origin, subframe \| Allowed permission | Deny | `permission-policy.ts:51` (`!parsed.success` via line 14) | `permission-policy.spec.ts:101-107` |
| **Check**: Trusted shell origin, subframe \| Denied permission | Deny | `permission-policy.ts:51` | `permission-policy.spec.ts:109-116` |
| **Check**: Other origin, main/subframe \| Allowed permission | Deny | `permission-policy.ts:64-66` (`!parseTrustedUrl(requestingOrigin)`) & `lines 60-63` | `permission-policy.spec.ts:101-107` |
| **Check**: Other origin, main/subframe \| Denied permission | Deny | `permission-policy.ts:51` | `permission-policy.spec.ts:109-116` |
| **Check**: `contents === null` \| Allowed permission | Deny | `permission-policy.ts:49` (`!contents`) | `permission-policy.spec.ts:101-107` |
| **Check**: `contents === null` \| Denied permission | Deny | `permission-policy.ts:49` (`!contents`) | `permission-policy.spec.ts:109-116` |

*Note on Matrix coverage*: The decision matrix in `permission-policy.spec.ts:85-118` supplies artificial defaults (`securityOrigin: 'file:///'`, `mediaTypes: ['audio']`, `mediaType: 'audio'`) to every test case. Real check details where `securityOrigin` is omitted by Electron are `UNCOVERED` in the positive allow test suite.

## CSP source inventory

| Directive | Value | Anything in the shell that needs a source it now denies |
| :--- | :--- | :--- |
| `default-src` | `'none'` | none found |
| `script-src` | `'self' ${hashes.join(' ')}` | none found |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | none found |
| `img-src` | `'self' data: blob:` | Remote MCP marketplace card icons (`libs/frontend/marketplace/src/lib/smithery-surface.component.ts:417-423`, `:1128-1132`) and remote markdown images in chat messages (`libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:158-159`) |
| `font-src` | `'self' https://fonts.gstatic.com data:` | none found |
| `connect-src` | `'self'` | none found |
| `media-src` | `'self' blob:` | none found |
| `worker-src` | `'self' blob:` | none found |
| `object-src` | `'none'` | none found |
| `base-uri` | `'self'` | none found |
| `frame-src` | `'none'` | none found |
| `form-action` | `'none'` | none found |

## Second window
The secondary `BrowserWindow` is instantiated at [`apps/ptah-electron/src/services/electron-browser-capabilities.ts:382-392`](apps/ptah-electron/src/services/electron-browser-capabilities.ts#L382-L392).

- **Does the new policy affect it?** Yes. The window does not configure a custom `partition`, attaching by default to `session.defaultSession`. In [`apps/ptah-electron/src/windows/main-window.ts:136-139`](apps/ptah-electron/src/windows/main-window.ts#L136-L139), `installPermissionPolicy` sets permission handlers directly on `mainWindow.webContents.session` (`session.defaultSession`), which intercepts requests across all windows sharing that session.
- **Does it leave it unprotected?** Unprotected in terms of session isolation. While permission requests from this window are denied (due to the `contents !== shellContents` check at [`apps/ptah-electron/src/windows/permission-policy.ts:49`](apps/ptah-electron/src/windows/permission-policy.ts#L49)), the automated browser window shares cookies, localStorage, HTTP cache, and credentials with the trusted app shell.
- **Does it break it?** Yes, for any CDP automation workflow requiring browser permissions (e.g. automating pages that require clipboard, geolocation, camera/microphone, or notifications). `allows()` evaluates `contents !== shellContents` as `true` and unconditionally rejects every permission request and check without fallback.

## Test quality
- **Re-stating the implementation**:
  - [`apps/ptah-electron/src/windows/permission-policy.spec.ts:177-193`](apps/ptah-electron/src/windows/permission-policy.spec.ts#L177-L193) reads `post-window.ts` source text and checks `new URL(RENDERER).protocol === 'file:'`, testing only Node's URL parser on the test file's own constant `RENDERER`.
  - [`apps/ptah-electron/src/windows/permission-policy.spec.ts:195-210`](apps/ptah-electron/src/windows/permission-policy.spec.ts#L195-L210) performs static string containment checks on `main-window.ts` (`toContain('installPermissionPolicy(')`, `toContain('contextIsolation: true')`), providing no behavioral verification.
  - [`apps/ptah-electron/src/windows/shell-csp.spec.ts:121-151`](apps/ptah-electron/src/windows/shell-csp.spec.ts#L121-L151) parses the `<meta>` tag string and asserts equality with an object, proving only that the tag was written, not that Chromium enforces the directives.
  - The probe at [`apps/ptah-electron/src/windows/fixtures/shell-probe.js:24`](apps/ptah-electron/src/windows/fixtures/shell-probe.js#L24) tests `inlineBlocked: window.inlineExecuted !== true`, which evaluates to `true` if the inline script fails for reasons other than CSP (e.g. syntax or DOM insertion errors).
  - Synthetic test data at [`apps/ptah-electron/src/windows/permission-policy.spec.ts:54-61`](apps/ptah-electron/src/windows/permission-policy.spec.ts#L54-L61) automatically injects `securityOrigin: 'file:///'` into all tests, directly concealing Defect 2.
- **Tests passing if the policy were inverted**:
  - Over 94% of tests in `permission-policy.spec.ts` (120 of 127 tests) assert negative expectations (`toBe(false)`). If `allows()` were replaced with an inverted stub that always returns `false`, 120 tests would still pass.
  - In `shell-csp.spec.ts`, if the inline test probe script in `shell-probe.js` had a syntax error preventing execution, `inlineBlocked` would still pass `expect(result.inlineBlocked).toBe(true)`.

## What I could not check
1. Full end-to-end execution of the complete `apps/ptah-electron-e2e` Playwright test suite against packaged production binary artifacts (`electron-builder`), as this requires a packaged desktop distribution and dedicated virtual display/audio services.
2. Physical hardware microphone audio capture across diverse external OS drivers; behavior was validated using Chromium's `--use-fake-device-for-media-stream` switch in Electron.
3. Native Linux X11/Wayland and macOS display server interaction quirks; testing was performed in the Windows development environment.
