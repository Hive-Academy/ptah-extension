# Batch B3 Notes — PtahCode Live Demo Build-Time Copy Step, Smoke Check & Deploy Wiring

## 1. Files Created and Modified

| File | Status | Purpose |
| --- | --- | --- |
| `scripts/landing/build-live-demo.mjs` | Created | Idempotent build-time copy, font self-hosting, HTML/CSP rewriter, `esbuild` bridge bundler, scenario bundler, and size reporter for `/demo/` |
| `scripts/landing/live-demo-static-server.mjs` | Created | Zero-dependency `node:http` static file server with path-traversal protection, SPA-less 404 handling, and complete MIME map (`.webm`, `.woff2`, `.json`, `.wasm`, etc.) |
| `scripts/landing/check-live-demo.mjs` | Created | Playwright (Chromium, `1440×900`, dark `colorScheme`) smoke test asserting zero misses, console errors, console warnings, page errors, external requests, HTTP errors, and CSP violations |
| `apps/ptah-landing-page/project.json` | Modified | Added `build-demo` target (`nx:run-commands`) depending on `build` and `{ "projects": ["ptah-extension-webview"], "target": "build" }` |
| `scripts/do-build.sh` | Modified | Added production webview build, `build-live-demo.mjs` execution, and post-build artifact assertions for DigitalOcean App Platform deploys |
| `.github/workflows/deploy-landing.yml` | Modified | Added `Build PtahCode live demo` step and `/demo/` artifact/base/CSP assertions before `doctl` deployment |
| `.do/app.yaml` | Unchanged | Static site `output_dir: dist/ptah-landing-page/browser` already serves `/demo/*`; documented catchall and header behavior below |
| `task-tracking/landing-live-demo/batch-b3-notes.md` | Created | Batch B3 deliverable notes and verification evidence |

---

## 2. Script CLI Options & Exports

### `scripts/landing/build-live-demo.mjs`
- `--webview-dist <dir>` — default: `dist/apps/ptah-extension-webview/browser`
- `--out <dir>` — default: `dist/ptah-landing-page/browser/demo`
- `--scenarios-dir <dir>` — default: `libs/web/landing/src/lib/live-demo/scenarios`
- `--bridge-entry <file>` — default: `libs/web/landing/src/lib/live-demo/runtime/replay-bridge.entry.ts`
- Programmatic exports: `buildLiveDemo(options)`, `rewriteIndexHtml(rawHtml, referencedFontPaths)`, `buildDemoCsp(inlineScriptHashes)`, `parseArgs(argv)`

### `scripts/landing/live-demo-static-server.mjs`
- `--root <dir>` — default: `dist/ptah-landing-page/browser`
- `--port <port>` (or positional `<port>` / `PORT` env) — default: `4873` (CLI) or `0` (programmatic)
- Programmatic exports: `start(options)`, `startServer(options)`, `startLiveDemoServer(options)`, `resolveSafeFilePath(rootDir, urlPathname)`, `MIME_TYPES`

### `scripts/landing/check-live-demo.mjs`
- `--root <dir>` — default: `dist/ptah-landing-page/browser`
- `--scenario <id>` — repeatable; default: all IDs from `<root>/demo/scenarios/index.json`
- `--json <out file>` — optional path to write full JSON summary
- `--timeout <ms>` — default: `60000`
- Programmatic exports: `checkLiveDemo(options)`, `parseArgs(argv)`

---

## 3. Final CSP Value & `<head>` Rewriting

`build-live-demo.mjs` normalizes CRLF to LF, strips any pre-existing `Content-Security-Policy` / `Content-Security-Policy-Report-Only` `<meta>` tags, rewrites `<base href="/">` to `<base href="/demo/">`, injects `<script src="replay-bridge.js"></script>` as the first `<script>` in `<head>` (before the inline theme bootstrap script), and computes SHA-256 hashes over the UTF-8 body of every remaining inline `<script>` after all rewrites.

Against the production `ptah-extension-webview` build (which has 1 inline pre-paint theme bootstrap script), the final CSP meta content is:

```text
default-src 'none'; script-src 'self' 'sha256-gHz7LDZOCz2dRmxOvlm6gmf+SFHZ2StKEpmXOyAkzSU='; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; base-uri 'self'; form-action 'none'
```

Ordering in `demo/index.html` `<head>`:
1. `<meta charset="utf-8"/>`
2. `<title>Ptah - Coding Orchestra</title>`
3. `<base href="/demo/">`
4. `<meta http-equiv="Content-Security-Policy" content="...">`
5. `<meta name="viewport" .../>`
6. `<link rel="icon" .../>`
7. `<link id="ptah-theme-extra" rel="ptah-deferred-stylesheet" href="theme-extra.css"/>`
8. `<script src="replay-bridge.js"></script>`
9. `<script>/* pre-paint theme boot */</script>`
10. `<link rel="stylesheet" href="styles.css">`

Because `<base href="/demo/">` and `<meta http-equiv="Content-Security-Policy">` precede `<script src="replay-bridge.js"></script>`, `document.baseURI` is already `.../demo/` when `replay-bridge.js` synchronously resolves `new URL('scenarios/<id>.json', document.baseURI)` at script evaluation time, and the CSP governs every script and stylesheet load in the document.

---

## 4. Self-Hosted Fonts Mapping

`build-live-demo.mjs` rewrites all `https://fonts.gstatic.com/` URLs in `styles.css` (and any other `*.css` or `index.html`, plus replaces any un-inlined `@import url('https://fonts.googleapis.com/...')` with local `@font-face` declarations) to relative `fonts/s/...` paths, verifies every referenced `.woff2` file exists in `libs/frontend/webview-e2e-harness/src/lib/fonts/gstatic/s/...`, copies them into `<out>/fonts/s/...`, copies the 3 SIL Open Font License notices (`OFL-cinzel.txt`, `OFL-inter.txt`, `OFL-jetbrainsmono.txt`) into `<out>/fonts/`, and fails loudly if any `https://` URL (or non-SVG-namespace `http://` URL) remains in `index.html` or `*.css`.

Copied font files (15 `.woff2` files + 3 `OFL-*.txt` files):
- **Cinzel v26** (2 files):
  - `fonts/s/cinzel/v26/8vIJ7ww63mVu7gt7-GT7LEc.woff2`
  - `fonts/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2`
- **Inter v20** (7 files):
  - `fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2`
  - `fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2`
  - `fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2`
  - `fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2`
  - `fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2`
  - `fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7SUc.woff2`
  - `fonts/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7SUc.woff2`
- **JetBrains Mono v24** (6 files):
  - `fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx3cwhsk.woff2`
  - `fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2`
  - `fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2`
  - `fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxPcwhsk.woff2`
  - `fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxTcwhsk.woff2`
  - `fonts/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx_cwhsk.woff2`

---

## 5. Measured Output Sizes

From `node scripts/landing/build-live-demo.mjs --out /tmp/ptah-live-demo-test/demo`:

| Metric | Value |
| --- | ---: |
| Total files in `/demo/` (no `.map` files) | 780 files |
| JS + CSS files (including `replay-bridge.js`) | 756 files |
| JS + CSS raw total | 22.26 MB (23,337,559 B) |
| JS + CSS gzip total | 5.29 MB (5,548,493 B) |
| JS + CSS brotli (q=4) total | 5.25 MB (5,501,683 B) |

---

## 6. Nx Target & Deploy Wiring

- **`apps/ptah-landing-page/project.json`**:
  - Added `build-demo` target (`nx:run-commands`) with `command: "node scripts/landing/build-live-demo.mjs"`, `outputs: ["{workspaceRoot}/dist/ptah-landing-page/browser/demo"]`, and `dependsOn: ["build", { "projects": ["ptah-extension-webview"], "target": "build" }]`. Both `ptah-landing-page:build` and `ptah-extension-webview:build` specify `"defaultConfiguration": "production"`.
- **`scripts/do-build.sh`**:
  - After `npx nx build ptah-landing-page --configuration=production --skip-nx-cache`, runs `npx nx build ptah-extension-webview --configuration=production --skip-nx-cache` and `node scripts/landing/build-live-demo.mjs`, then asserts `demo/index.html`, `demo/replay-bridge.js`, `demo/scenarios/index.json`, `<base href="/demo/">`, and the `Content-Security-Policy` `<meta>` tag exist.
- **`.github/workflows/deploy-landing.yml`**:
  - Added `Build PtahCode live demo` step (`npx nx build ptah-extension-webview --configuration=production` + `node scripts/landing/build-live-demo.mjs`) after `Build landing page`, and extended `Assert prerendered content` to assert `demo/index.html`, `demo/replay-bridge.js`, `demo/scenarios/index.json`, `<base href="/demo/">`, and the CSP `<meta>` tag.
- **`.do/app.yaml` analysis**:
  - No edit needed in `.do/app.yaml`. The single `static_sites` entry (`name: landing`, `output_dir: dist/ptah-landing-page/browser`, `build_command: bash scripts/do-build.sh`) serves `/demo/index.html` at `/demo/` and all static assets under `/demo/**` directly.
  - **Catchall behavior note**: Because `.do/app.yaml` sets `catchall_document: index.csr.html` for Angular CSR routes, any request to a **non-existent** file under `/demo/` (e.g., a missing scenario JSON or missing chunk) in production on DigitalOcean App Platform will return `200 OK` with `index.csr.html` (HTML) rather than `404`. `scenario-loader.ts` in B1 parses the response as JSON (`response.json()`) and validates `value.id === query.id`, so a catchall HTML fallback fails closed with a `SyntaxError` / `scenario-load` miss. In local/CI testing, `live-demo-static-server.mjs` is strictly SPA-less and returns `404 Not Found`.

---

## 7. Verification Evidence & Cross-Lane Findings for Coordinator

### A. Static Server & Build Artifact Verification
Verified with `node scripts/landing/build-live-demo.mjs --out /tmp/ptah-live-demo-test/demo` and `live-demo-static-server.mjs`:
- `/demo/` -> `200 OK` (`text/html; charset=utf-8`), contains `<base href="/demo/">`, `<meta http-equiv="Content-Security-Policy" ...>`, and `<script src="replay-bridge.js"></script>` before the inline theme script.
- `/demo/scenarios/index.json` -> `200 OK` (`application/json; charset=utf-8`), returns `["chat-tool-call"]`.
- `/demo/fonts/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2` -> `200 OK` (`font/woff2`).
- `/demo/nonexistent-spa-route` -> `404 Not Found` (SPA-less).
- `resolveSafeFilePath('/tmp/ptah-live-demo-test', '/../../etc/passwd')` -> `null` (path-traversal blocked).
- MIME map verified for `.webm` (`video/webm`), `.woff2` (`font/woff2`), `.json` (`application/json; charset=utf-8`), `.wasm` (`application/wasm`).

### B. Playwright Smoke Test (`check-live-demo.mjs`) Results
1. **Unmodified B1 + B2 run** (`node scripts/landing/check-live-demo.mjs --root /tmp/ptah-live-demo-test`):
   - `firstPaint`: `1328 ms`, `readyAt`: `3482 ms`, `complete`: `6329 ms`
   - `Misses`: `0`, `Console Errors`: `0`, `Page Errors`: `0`, `External Requests`: `0`
   - Caught **3 cross-lane integration issues** between B1 (`replay-bridge.entry.ts`) and B2 (`chat-tool-call.json`):
     1. **CSP `eval` probe in Zod v4 (`chunk-D_LofA3R.js:1:14332`)**: Zod v4 runs `try { return new Function(''), !0 } catch { return !1 }` on first schema validation (`attention:getSnapshot`) unless `z.globalConfig.jitless` is set. Our strict CSP (`script-src 'self' 'sha256-...'`) blocks `new Function('')` as intended and Zod catches the `EvalError` (so there is no `console.error`), **but** Chromium still fires a DOM `securitypolicyviolation` event (`blockedURI: "eval"`, `violatedDirective: "script-src"`).
        - *Fix for B1*: In `replay-bridge.entry.ts`, wrap `window.Function` in a `Proxy` (`new Proxy(window.Function, { construct() { throw new EvalError('Eval disabled'); }, apply() { throw new EvalError('Eval disabled'); } })`) so `new Function('')` throws `EvalError` in JS before Blink dispatches a `securitypolicyviolation` event, while preserving `Function.prototype` and `instanceof Function` for Angular DI (`NG0204`).
     2. **Unopened session tab in `chat-tool-call.json`**: With `localStorage` unseeded and `initialSessionId` omitted (per B2 fix), the webview boots to the empty workspace state (`"1 previous session"` in the sidebar) with no active tab in `ptah.canvas-layout.*` / `ptah.tabs.*`. When `chat-tool-call.json` emits `chat:chunk` events for `tabId: "22222222-2222-4222-8222-222222222222"`, `StreamingHandlerService` and `ChatStore` log `console.warn` (`No target tab for event ...` and `handleTurnEnded: no tab bound to sessionId`).
        - *Fix for B1/B2*: Open the session at `ready` (e.g., clicking the `"1 previous session"` -> `"Explore the project"` row or triggering session open) and map `$activeTabId` / the scenario `tabId` to the active canvas tile `tabId` in `ptah.canvas-layout.*`.
     3. **`git:lastCommit` in `rpcErrors` (`chat-tool-call.json:433-438`)**: Returning an RPC error for `git:lastCommit` causes `GitBranchesService` to log `console.warn("[GitBranchesService] git:lastCommit returned error: No commits in the demo workspace")`.
        - *Fix for B2*: Move `git:lastCommit` from `rpcErrors` to `rpc` with a synthetic commit object (`{ hash, shortHash, subject, author, date }`).
2. **End-to-end verification run with those 3 fixes applied in `/tmp/ptah-live-demo-test-src`**:
   ```text
   Scenario       | Status | firstPaint(ms) | readyAt(ms) | complete(ms) | Misses | Errors | Warns | CSP | ExtReq
   ---------------+--------+----------------+-------------+--------------+--------+--------+-------+-----+-------
   chat-tool-call | PASS   | 1284           | 3406        | 8162         | 0      | 0      | 0     | 0   | 0     
   ```
   Exited `0` with `0` misses, `0` errors, `0` warnings, `0` CSP violations, and `0` external requests.

---

## 8. Open Questions
1. **DigitalOcean App Platform HTTP Headers**: App Platform's `static_sites` spec does not support custom per-route HTTP response headers (`frame-ancestors 'self'` or custom `Cache-Control` per path). If `frame-ancestors 'self'` or `X-Frame-Options: SAMEORIGIN` is desired at the HTTP header level in production, it would need to be set in the Cloudflare / CDN layer in front of `ptah.live`.
2. **Cache invalidation for `/demo/` chunks**: Because `ptah-extension-webview` builds with `outputHashing: "none"`, CDN caching on `ptah.live/demo/*.js` should use revalidation (`Cache-Control: no-cache` or short TTL) so deploys immediately serve matching chunks.
