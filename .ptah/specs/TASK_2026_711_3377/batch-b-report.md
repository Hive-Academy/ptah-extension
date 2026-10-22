# Batch B report — workspace `file://` browser

`validateBrowserUrl` now allows a `file:` URL only when the target exists and its realpath stays inside a host-recorded workspace root. Both browser hosts intercept later `file:` requests and refuse to expose an escaped page.

## Files changed

- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-file-url.ts` (new)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-file-url.spec.ts` (new)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts`
- `libs/backend/vscode-lm-tools/src/index.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.spec.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts`
- `apps/ptah-electron/src/services/electron-browser-capabilities.ts`
- `apps/ptah-electron/src/services/electron-browser-capabilities.spec.ts` (new)

Not touched: `ptah-system-prompt.constant.ts`, `libs/backend/cli-agent-runtime`, `libs/backend/agent-generation`.

## Acceptance

1. **Containment helper.** `browser-file-url.ts` parses the raw URL before the WHATWG parser (that parser collapses `..` and, on Windows, rewrites `file://localhost/...` to an empty host — checked with Node 24). It rejects malformed `%` sequences, raw or decoded `..`, `%2F` / `%5C`, any nonempty authority (UNC, `file://server/...`, `file://localhost/...`), drive-relative paths (`/C:foo`), Windows device segments on drive paths, and backslashes. `evaluateFileUrl` (`browser-file-url.ts:92`) then `fileURLToPath`s, `fs.realpath`s the target and each absolute root, and compares with `path.relative` plus segment boundaries (`canonicalPathInsideRoot`, `browser-file-url.ts:47`). Windows comparison is case-insensitive. A missing file, an unresolvable root, or a symlink/junction whose realpath leaves the root is rejected. Rejection strings do not include a path. `validateBrowserUrl` (`browser-namespace.builder.ts:174-183`) is async, sends only `file:` URLs through that helper, and leaves `http:` / `https:` and the localhost / `ptah.browser.allowLocalhost` rule unchanged (`browser-namespace.builder.ts:184-196`). `javascript:`, `data:`, `chrome:`, and `about:` stay blocked. Neither existing `isInsideRoot` is used.

2. **Host roots.** `BrowserNamespaceDependencies.getWorkspaceRoots` (`browser-namespace.builder.ts:216`) is wired at `ptah-api-builder.service.ts:821` to `getHostWorkspaceRoots()`, which omits the caller-declared MCP URL root. Every navigate calls `configureSession` with that snapshot even when headless and viewport are omitted (`browser-namespace.builder.ts:317-321`). `BrowserSessionOptions.workspaceRoots` is frozen. A different list sets `rootsDirty` and the next `ensureSession` starts a new browser (`chrome-launcher-browser-capabilities.ts:88-99`, `electron-browser-capabilities.ts` configureSession).

3. **Follow-on guard.** Chrome enables CDP `Fetch` with pattern `file:*` before any navigation and fails closed if `Fetch` cannot be installed (`chrome-launcher-browser-capabilities.ts:502-516`, `installFileInterception` at `:684`). A paused `file:` request is continued only when `evaluateFileUrl` allows it; otherwise `Fetch.failRequest` with `BlockedByClient`. The realpath is not cached. Electron does the same through `webContents.debugger` `Fetch.enable` (`electron-browser-capabilities.ts:516-536`), plus synchronous `will-navigate` / `will-redirect` for lexical failures (`handleWillNavigate`). Listeners are removed on close (`electron-browser-capabilities.ts:664`). `content`, `screenshot`, `evaluate`, click/type (via evaluate), and recording re-read the current URL and blank the page when it is a disallowed `file:` URL. Direct navigation to a disallowed `file:` URL is refused before `Page.navigate` / `loadURL`. Network results drop disallowed `file:` URLs. `--allow-file-access-from-files` and `--disable-web-security` are not in the Chrome flag list (`chrome-launcher-browser-capabilities.ts:470-484`). Electron keeps `webSecurity: true` (`electron-browser-capabilities.ts:484`).

4. **Tool text.** `tool-description.builder.ts:1128-1140` says `file://` URLs of files inside the workspace are allowed, for both the tool description and the `url` schema. `mcp-contract.sweep.spec.ts:2403` raises the description pin from 384 to 440 (measured 390 characters; `ceil(390 * 1.1) + 10` is 439) and `:2467` asserts the sentence. `ptah-system-prompt.constant.ts` was not edited.

## What a `file://` page can read

Evidence is the launch configuration plus Node's URL parser, not a live Chrome session (this lane was told not to run the browser).

- Chrome flags (`chrome-launcher-browser-capabilities.ts:470-484`) are `--disable-gpu`, `--no-first-run`, `--no-default-browser-check`, `--disable-extensions`, `--disable-translate`, `--disable-background-networking`, a window size, and `--headless` only when requested. `--allow-file-access-from-files` and `--disable-web-security` are absent. The new spec asserts that absence.
- Without `--allow-file-access-from-files`, Chromium gives each `file:` document an opaque origin. `fetch` / XHR from that page to another file fails. Electron's window sets `webSecurity: true`, `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`, and it does not pass those switches either.
- That opaque origin does **not** stop a top-level navigation (link, `location`, meta refresh, redirect) to another `file:` URL, and it does not stop no-cors subresource loads (`script`, `img`, `link`) of other files. Those are the holes `Fetch` closes: every `file:` document, frame, and subresource is paused and allowed only when its realpath is inside the snapshotted roots. If the guard cannot be installed, the session is torn down and navigation does not start.
- `content`, `screenshot`, `evaluate`, click, type, and recording check the current URL again and do not return page bytes when it is an outside `file:` URL.

## Specs

- `browser-namespace.builder.spec.ts` — inside root, outside root (error omits the path), missing file, `..`, `%2e%2e`/`%2F`, UNC and `file://localhost`, opposite drive-letter case on Windows (`it.skip` elsewhere), `data:`/`javascript:`/`chrome:`/`about:`, localhost rule unchanged, navigate snapshots roots.
- `browser-file-url.spec.ts` — `path.win32` case and prefix escape, POSIX case, lexical rejects, realpath allow/deny, symlink then Windows junction. If both `fs.symlink` forms return `EPERM` / `EACCES` / `ENOTSUP`, that one test returns without asserting containment. The source states that reason. It is not a proof of the escape check.
- `chrome-launcher-browser-capabilities.spec.ts` — flag absence, `Fetch.enable` before `Page.navigate`, outside `file:` `failRequest` vs inside `continueRequest`, guard install failure does not navigate, screenshot/evaluate withheld, root change starts a new session.
- `electron-browser-capabilities.spec.ts` — `webSecurity: true`, unsafe flags absent from window options, `Fetch.enable` before `loadURL`, `will-navigate` blocks `file://server/...`, outside request `failRequest`, listener removal and debugger detach on close, screenshot withheld, guard install failure does not load.

## Diagnostics

`ptah_get_diagnostics` is not available in this session (`search_tool` returned no `ptah_*` tools). No `nx`, Jest, `tsc`, lint, or build was run, per the lane brief.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Inspect the raw `file:` string, then realpath | Trust `new URL()`; lexical `isInsideRoot` | Node 24 collapses `file:///C:/foo/../secret.html` and `file:///C:/foo/%2e%2e/secret.html` to `file:///C:/secret.html`, and rewrites `file://localhost/C:/foo` to an empty host | Yes |
| CDP `Fetch` on both hosts, plus Electron `will-navigate` / `will-redirect` | `session.webRequest` on the default session | A default-session `webRequest` filter would cancel `file:` loads for the whole Electron app. The tool window uses partition `ptah-browser-tool`. Lexical navigations are cancelled synchronously; realpath stays on `Fetch` | Yes |
| Reject every `..` segment, even one that would normalize back inside the root | Allow `..` after normalization if the result is inside | The batch text says reject raw or decoded `..` | Yes |
| Raise the `ptah_browser_navigate` description pin 384 → 440 | Shorten below 384 and drop the required sentence | Measured description length is 390. The sweep fails when length exceeds the pin. This is the description pin, not a degradation-audit baseline | Yes |
| Device-name rejection on Windows-shaped paths | Reject those names on every POSIX path too | `CON` / `NUL` / `COM1` are Windows devices. A Unix file named `aux` stays allowed | Yes |

## Not done

- Scoped tests and typecheck were left for the orchestrator. Revise round 1 below records the Jest lines from this round.
- No live Chrome or Electron process was opened, so the opaque-origin note is from the flag list and Chromium's documented file-origin behavior.
- `ptah_agent_report` is not connected here; delivery is recorded in the lane reply.

## Revise round 1

This section supersedes the earlier `Fetch.continueRequest` behavior. A paused `file:` request is served from the canonical path. Chromium is not told to open the original URL.

| Finding | Fix | Spec |
| --- | --- | --- |
| 1. Major — check/open race | `readContainedWorkspaceFile` opens the canonical realpath, re-checks that realpath, and returns base64 (`browser-file-url.ts:159`, cap `MAX_CONTAINED_FILE_BYTES` at `:26`). Chrome `Fetch.fulfillRequest` at `chrome-launcher-browser-capabilities.ts:822`. Electron `Fetch.fulfillRequest` at `electron-browser-capabilities.ts:781`. Any doubt calls `failRequest`. | `returns canonical bytes and fails when the body exceeds the cap`; `fulfills canonical bytes for an inside file and fails an outside file`; Electron `blocks a lexically unsafe file navigation and an outside-root file request` |
| 2. Major — popup / new targets | Electron `setWindowOpenHandler(() => ({ action: 'deny' }))` at `electron-browser-capabilities.ts:523` and `will-attach-webview` preventDefault at `:535`. Chrome `installPopupDenial` at `chrome-launcher-browser-capabilities.ts:746` uses `Target.setAutoAttach` (`waitForDebuggerOnStart`) and `closeTarget` for a page target with an `openerId`. | `denies window.open and webview attach`; `closes a page target opened by the tool tab` |
| 3. Minor — follow-on schemes | `toolMayReadPage` (`browser-file-url.ts:125`) allows http(s) under the existing localhost rule, in-root `file:`, and `about:blank`. `rejectIfPageEscaped` uses it and blanks the page (`chrome-launcher-browser-capabilities.ts:658`, `electron-browser-capabilities.ts:729`) before content, screenshot, evaluate, click, type, and recording. | `withholds a data: or javascript: follow-on and blanks the page` (both hosts); `toolMayReadPage` `allows about:blank and https, and refuses data: and javascript:` |
| 4. Minor — roots reconfigure race | `ensureSession` rechecks after an in-flight create (`chrome-launcher-browser-capabilities.ts:444`, `electron-browser-capabilities.ts:453`). Roots are copied from `_pendingOptions` after the launch awaits (`:587` and `:566`) and only then cleared. `cleanup` no longer wipes a configure that arrived during that await. | `keeps roots configured while the browser session is starting`; `keeps roots configured while the window is being created` |
| 5. Minor — `..preview.html` | `canonicalPathInsideRoot` rejects only `relative === '..'`, a `..` + separator prefix, an absolute relative, or a `..` segment (`browser-file-url.ts:73`). | `allows a child named ..preview.html and still rejects a .. segment`; `allows a real file whose name is ..preview.html` |
| 6. Minor — `?` / `#` in authority | `fileUrlPath` tests the raw authority and rejects `?`, `#`, `@`, and `:` before the path (`browser-file-url.ts:345`). | `rejects hosts, dot segments...` (lexical cases); `rejects file URLs whose authority contains ? # @ or :` |
| 7. Minor — sync spec | `SHARED_TOOL_NAMES` lists all twelve policy tools (`lane-policy-sync.spec.ts:17`) and expects each in `PTAH_LANE_POLICY` and `PTAH_SYSTEM_PROMPT` (`:89`). `unconditionalModeSentences` (`:40`) rejects a sentence that says steer/interrupt/queue/messaging "is available" or "always works" unless that sentence also states a capability condition (`:111`). The parent prompt already named every tool, so `ptah-system-prompt.constant.ts` was not edited. | `names the same tools in the policy and the parent prompt`; `does not describe a messaging mode as always available` |

### Jest

`npx jest -c libs/backend/vscode-lm-tools/jest.config.ts` on `browser-file-url.spec.ts`, `browser-namespace.builder.spec.ts`, `chrome-launcher-browser-capabilities.spec.ts`, and `lane-policy-sync.spec.ts`:

`Tests:       90 passed, 90 total`

`npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/services/electron-browser-capabilities.spec.ts`:

`Tests:       8 passed, 8 total`

### Residual risk

The paused handler reads an `fs` descriptor opened on the canonical path and answers with those bytes. Chromium is not asked to open the URL, so a symlink or junction swap after the check cannot change which file the browser opens for that request. The host fails the request when the path's realpath is no longer that canonical path, when it is outside every root, when the body is larger than 25 MiB, or when the read fails.

What remains: the read is not an exclusive file lock, so an in-place write to the same in-root inode can change bytes between `fstat` and `read`. That is a content change of an allowed file, not a path escape. The response is synthetic (status 200 and one `Content-Type` from the extension, or `application/octet-stream`). Range requests are not implemented. Chrome closes only page targets that carry an `openerId`; a new target without one is resumed, not closed. Electron denies `window.open` and `<webview>` attach on the tool window. Those denials were not exercised in a live browser. `data:` and `javascript:` are refused when they are the top-level URL before content, screenshot, evaluate, click, type, or recording. A subresource of an allowed http(s) page is not blanked by that check. `file:` subresources still go through the fulfill path. Windows 8.3 names, trailing dots, and alternate data streams still depend on `realpath` and were not probed live.

## Revise round 2

| Finding | Fix | Spec |
| --- | --- | --- |
| 1. Major — descriptor not bound to the contained path | `readContainedWorkspaceFile` `lstat`s the canonical path with bigint stats (`browser-file-url.ts:204`), opens it (`containedOpenFlags` at `:259` adds `O_NOFOLLOW` and `O_NONBLOCK` on non-Windows when those constants are numbers), then requires `handle.stat({ bigint: true })` to be a regular file with the same `dev` and `ino` (`:211-212`) before the realpath re-check. A mismatch returns no body. | `refuses a descriptor whose dev/ino differ from the checked path` |
| 2. Major — attached non-popup targets stay paused | `handleAttachedTarget` (`chrome-launcher-browser-capabilities.ts:803`) still closes a page target with an `openerId`. Every other waiting target gets `Fetch.enable` on that flattened `sessionId` (`enableFetchOnSession` at `:838`) and then `Runtime.runIfWaitingForDebugger({}, sessionId)` (`:858`). `Target.runIfWaitingForDebugger` is not used. A paused `file:` event that carries `sessionId` is fulfilled or failed on that session. If the guard or the resume call cannot be sent, the target is closed. | `resumes an attached worker or iframe with Runtime.runIfWaitingForDebugger`; `closes a page target opened by the tool tab` |
| 3. Minor — status and network bypass | `currentPageAllowed` applies `toolMayReadPage` before `status()` and `getNetworkRequests()` (`chrome-launcher-browser-capabilities.ts:366,415,686`; `electron-browser-capabilities.ts:391,440,451`). A refused page returns connected session metadata only: no URL, no title, and no network entries. | `omits url, title, and network entries when the page scheme is refused` (Chrome and Electron) |
| 4. Minor — FIFO/device hang | The same `lstat` runs before `open` and refuses anything that is not a regular file (`browser-file-url.ts:205`), including a FIFO. The non-blocking flag from finding 1 stays on POSIX opens. | `refuses a FIFO before open` |

Jest was not run in this round. The orchestrator has a scoped run in flight.

### Residual risk

The descriptor is accepted only when its bigint `dev` and `ino` match the pre-open `lstat` and the path still realpath-contains inside a root. A symlink swap that changes the inode is refused, and a FIFO is refused before `open`. What remains is inode reuse: if the kernel recycles the same `dev`/`ino` for a different file between `lstat` and `fstat`, and the pathname is restored so the later realpath check still passes, the bytes could be from that other inode. An in-place write to the same inode can still change bytes between `fstat` and `read`. Windows opens do not set `O_NOFOLLOW` or `O_NONBLOCK`; the type check and the `dev`/`ino` compare are what reject a swapped target there. Child-session `file:` responses are routed only when the paused event includes `sessionId`. `status()` reads the title only after the page check passes, so a navigation in that gap can still change what the title evaluate observes. No live browser or FIFO was opened.
