# Implementation notes — TASK_2026_491_e0da

## The trusted origin

The shell loads the same way in development and in production. `main-window.ts`
and `post-window.ts` both call `mainWindow.loadFile(path.join(__dirname,
'renderer', 'index.html'))`. Neither calls `loadURL`, and
`permission-policy.spec.ts` pins that by reading `post-window.ts` and asserting
`loadURL(` does not appear. There is no development server and no second
origin.

The resulting origin is a `file:` URL with an empty host. Its `URL.origin` is
the string `"null"`, which is why the policy never uses `origin` as an
identity — every `file:` document, and every `data:` document, shares it.

The trusted subject is therefore matched on three things, all of which must
hold:

1. `protocol === 'file:'` and `host === ''` — exact, no prefix and no substring
   match. `file://evil/...` fails, because the empty host is a prefix of every
   host and a prefix match would admit it.
2. `pathname` equal to the renderer document's own `pathname`. `file:` alone
   would grant every local file the same standing, including the
   `preparing-workspace.html` recovery page.
3. The **top-level** document (`contents.getURL()`) must satisfy the same test,
   not only the requesting frame.

### Drive-letter case

`pathname` is compared after one normalisation: a leading `/<letter>:` drive
prefix is upper-cased. Windows treats the drive letter case-insensitively but
`URL.pathname` preserves whatever case it was given, so `/c:/app` and `/C:/app`
name one document. Nothing after that prefix is normalised, so
`/C:/app/renderer/Index.html` and `/C:/app/renderer/index.html.bak` both still
fail against `index.html`.

## The permission allowlist

`z.enum(['media', 'clipboard-sanitized-write'])`. Everything else is denied,
including `contents === null`, for which no exception was found to be necessary.

| Permission | Why it is here | Extra restriction |
| --- | --- | --- |
| `media` | `VoiceInputService` calls `getUserMedia({ audio: true })` for voice input. | Audio only. A request must carry `mediaTypes`, and the schema admits only `'audio'`. A check may carry `mediaType: 'audio'` or omit it; `'video'` and `'unknown'` are rejected. |
| `clipboard-sanitized-write` | `navigator.clipboard.writeText()` in `oauth-surface.component.ts`, `vec-embedder-recovery.service.ts` and `workspace-indexing.component.ts`. | None beyond origin and frame. |

Not added, deliberately:

- `clipboard-read` and `deprecated-sync-clipboard-read`. No caller needs them.
  Clipboard **reads** go through the preload `ptahClipboard` IPC bridge, and
  pasted images arrive on `ClipboardEvent.clipboardData`. Neither path asks the
  browser for a clipboard grant. Granting `clipboard-read` would give the
  renderer read access to the user's entire clipboard for no caller at all.
- `speaker-selection`. Chromium raises a check for it around audio capture.
  Capture works without it, measured.
- `geolocation`, `notifications`, `display-capture`, `midiSysex` and the rest.
  No caller.

## What Electron actually sends

Measured in this worktree against `node_modules/electron` 44.4.3. A throwaway
main process installed handlers that granted everything and logged each
`(permission, details)` pair, then loaded a `file:` document that exercised
`clipboard.writeText()`, `permissions.query()` and `getUserMedia()`. The
fixtures in `permission-policy.spec.ts` are built from these shapes.

Request handler — `PermissionRequest` / `MediaAccessPermissionRequest`
(`electron.d.ts:10885,9479`):

```json
{ "kind": "request", "permission": "media",
  "details": { "isMainFrame": true,
               "requestingUrl": "file:///…/index.html",
               "mediaTypes": ["audio"],
               "securityOrigin": "file:///" } }
```

Check handler — `PermissionCheckHandlerHandlerDetails` (`electron.d.ts:23372`).
Three distinct shapes were observed, and the differences are the whole point:

```json
{ "kind": "check", "permission": "clipboard-sanitized-write",
  "requestingOrigin": "file:///",
  "details": { "embeddingOrigin": "file:///", "isMainFrame": true,
               "requestingUrl": "file:///…/index.html" } }

{ "kind": "check", "permission": "media",
  "requestingOrigin": "file:///",
  "details": { "embeddingOrigin": "file:///", "isMainFrame": true,
               "mediaType": "audio",
               "requestingUrl": "file:///…/index.html" } }

{ "kind": "check", "permission": "media",
  "requestingOrigin": "file:///",
  "details": { "embeddingOrigin": "file:///", "isMainFrame": true,
               "requestingUrl": "file:///…/index.html" } }
```

Three facts follow, and all three contradict the first implementation:

1. `securityOrigin` is **absent** on the check raised for
   `navigator.permissions.query({ name: 'microphone' })`.
2. A `media` check with **no `mediaType` at all** is raised around capture.
3. `navigator.clipboard.writeText()` from a `file:` origin is dispatched as
   `clipboard-sanitized-write`, through the **check** handler, and never as
   `clipboard-read`. Chromium raises no clipboard **request** for it.

The policy therefore validates an origin field only when Electron sent it, and
never fails closed on an absence Electron itself created.

Two further measurements, against the committed code and against a deny-all
control:

```
committed policy : { "qMicrophone": "denied", "mic": true }    ← the defect
committed policy : CLIP_CALL:ok                                 ← writeText works
deny-all control : DENY_CLIP_CALL:NotAllowedError: … Write permission denied.
```

`navigator.permissions.query({ name: 'camera' })` is dispatched as `media` with
`mediaType: 'video'`, which is how camera stays denied without a second
permission name.

## The CSP and how it is delivered

**Delivery: a `<meta http-equiv="Content-Security-Policy">` tag**, injected by
`apps/ptah-electron/scripts/copy-renderer.js` into the copied
`dist/apps/ptah-electron/renderer/index.html`.

A response header was not available. The shell is loaded with `loadFile()` over
the `file:` scheme, which delivers no HTTP headers, and there is no custom
protocol handler in this app — the security-surface sweep found none. A meta
tag is parsed before any resource or script in the document, so it is in force
for everything the document loads.

The cost is `frame-ancestors`, which browsers ignore in a meta tag. It is
deliberately absent rather than present and inert. Embedding protection is
instead carried by `frame-src 'none'`, which blocks the shell from creating
children, and by `installNavigationGuard`, which is unchanged.

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'none'` | Fallback for anything not named. |
| `script-src` | `'self'` | Every inline script is lifted to its own file, so no hash and no nonce is needed. |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | Angular component styles and UI style attributes need inline CSS. `styles.css` imports `fonts.googleapis.com`. |
| `img-src` | `'self' https: data: blob:` | Attachments use `data:` and `blob:`. `https:` keeps marketplace icons and remote markdown images loading. See `context.md` rule 5. |
| `font-src` | `'self' https://fonts.gstatic.com data:` | The Google font sheet serves its files from `fonts.gstatic.com`. |
| `connect-src` | `'self'` | Renderer network calls go over the preload RPC bridge, never direct. |
| `media-src` | `'self' blob:` | `local-tts-panel` plays blob audio. |
| `worker-src` | `'self' blob:` | Monaco creates workers. |
| `object-src` | `'none'` | No plugin content. |
| `base-uri` | `'self'` | The base href is build-owned. |
| `frame-src` | `'none'` | The shell creates no frames. |
| `form-action` | `'none'` | The shell submits no forms. |

### Inline script handling

`secureRendererHtml` lifts every inline `<script>` to
`inline-<16 hex chars>.js` beside `index.html` and rewrites the tag to
`<script src="./inline-….js">`, in place. The tag position is preserved because
the pre-paint theme bootstrap has an ordering contract with the build's
`styles.css` link, and an external classic script in `<head>` still blocks the
parser.

A CSP hash was the first approach and was removed. The hash was computed from
the matched text, so any later whitespace change to the built document would
have invalidated it and silently blocked the theme bootstrap. A build-time
nonce was rejected too: a nonce baked into a shipped static file is a constant
that an injected script can read back out of the DOM.

`secureRendererHtml` is idempotent. It strips any existing CSP meta tag before
inserting its own, and the strip pattern consumes the newline the insertion
puts before the tag, so a second pass is byte-identical. Previously lifted
files are pruned only when the current pass lifted something, so a second pass
over an already-patched directory does not delete the file the document points
at.

## What I could not verify

1. **The e2e suite** (`apps/ptah-electron-e2e`, acceptance criterion 3). It
   needs a packaged desktop build and was not run. The two commands this task
   names were run and their real output is in `review-response.md`.
2. **Platforms other than Windows.** Every measurement here is Windows 11 with
   `node_modules/electron` 44.4.3. The drive-letter normalisation is
   Windows-specific by construction and is inert on a POSIX path, but the
   permission detail shapes were not re-measured on macOS or Linux. They come
   from Chromium, not from the platform layer, so they are expected to hold.
3. **Real microphone hardware.** Capture was measured with Chromium's
   `--use-fake-device-for-media-stream`.
4. **`navigator.clipboard.writeText()` inside the Jest fixture.** It needs a
   focused document, which the hidden probe window does not have. The spec
   asserts the permission query instead, which reaches the same handler under
   the same permission name. The write itself was measured separately in a
   shown, focused window and is recorded above.
5. **Electron version drift.** Every shape here is measured against Electron
   44. Electron does not treat these detail objects as a stable contract, so an
   Electron upgrade should re-run the measurement. The root `CLAUDE.md` claim
   of Electron 40 is already out of date against `node_modules`.
