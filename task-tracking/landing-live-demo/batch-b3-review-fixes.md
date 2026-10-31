# Batch B3 Review Fixes — PtahCode Live Demo Build-Time Copy Step, Smoke Check & Deploy Wiring

## 1. Summary of Files Created and Modified

| File | Action | Purpose |
| --- | --- | --- |
| `scripts/landing/live-demo-cli.mjs` | Created | Shared CLI flag parser (`parseCliFlags`), recursive directory walker (`walkFiles`), and zero-browser artifact/content verifier (`verifyDemoArtifacts`) |
| `scripts/landing/build-live-demo.mjs` | Modified | Content-hashes `replay-bridge.<hash8>.js`, `fonts/s/.../*.<hash8>.woff2`, and `theme-extra.<hash8>.css`; writes `scenarios/index.json` as `{ "version": "<hash8>", "ids": [...] }`; emits `<script src="replay-bridge.<hash8>.js" data-scenario-version="<hash8>">`; rewrites CSS font URLs relative to each CSS file; scans JS chunks in `assertNoExternalUrls`; adds recursion depth guard in `copyWebviewRecursive`; uses shared `parseCliFlags` |
| `scripts/landing/check-live-demo.mjs` | Modified | Uses shared `parseCliFlags` and `verifyDemoArtifacts`; reads `{ version, ids }` from `scenarios/index.json` |
| `scripts/landing/live-demo-static-server.mjs` | Modified | Uses shared `parseCliFlags`; removes duplicate `startServer`/`startLiveDemoServer` aliases (keeps `start`); resolves symlinks via `realpathSync` in `resolveSafeFilePath` |
| `apps/ptah-landing-page/project.json` | Modified | Added explicit `inputs` on `build-demo` target covering `production`, `^production`, `scripts/landing/**`, `libs/web/landing/src/lib/live-demo/**`, and `libs/frontend/webview-e2e-harness/src/lib/fonts/**` |
| `scripts/do-build.sh` | Modified | Extracted shared `build_ptah_live_demo` (with `--output-hashing=all`) and `assert_ptah_live_demo` functions (`--demo-only` / `--assert-demo-only` modes) with full content assertions via `verifyDemoArtifacts` |
| `.github/workflows/deploy-landing.yml` | Modified | Calls `bash scripts/do-build.sh --demo-only` and `bash scripts/do-build.sh --assert-demo-only "$DIST"`, then installs Playwright Chromium (`npx playwright install --with-deps chromium`) and runs `node scripts/landing/check-live-demo.mjs --root dist/ptah-landing-page/browser` |
| `task-tracking/landing-live-demo/batch-b3-review-fixes.md` | Created | Mapping of each review finding to changes, verification evidence, and open/follow-up items |

---

## 2. Finding -> Change Mapping

### 1. CI Smoke Check & DigitalOcean Content Assertions (`review-phase1-b2-b3.md` §5.1)
- **Finding**: `check-live-demo.mjs` was not executed in `.github/workflows/deploy-landing.yml`, and `scripts/do-build.sh` only checked for the existence of three top-level files. Because `.do/app.yaml` uses `catchall_document: index.csr.html`, a missing scenario JSON or font file in production would return HTTP 200 HTML rather than 404.
- **Changes**:
  - **`.github/workflows/deploy-landing.yml`**: Added `Smoke check PtahCode live demo` step after `Assert prerendered content` (and before `doctl` deploy) that runs `npx playwright install --with-deps chromium` followed by `node scripts/landing/check-live-demo.mjs --root dist/ptah-landing-page/browser`, failing the workflow on any non-zero exit.
  - **`scripts/do-build.sh` & `scripts/landing/live-demo-cli.mjs` (`verifyDemoArtifacts`)**: Added zero-browser content assertions verifying that:
    1. `demo/index.html` exists, includes `<base href="/demo/">` and `http-equiv="Content-Security-Policy"`, and contains `<script src="replay-bridge.<hash8>.js" data-scenario-version="<hash8>"></script>`.
    2. The referenced `demo/replay-bridge.<hash8>.js` file exists on disk and is non-empty (`size > 0`).
    3. `demo/scenarios/index.json` has `{ "version": "<hash8>", "ids": [...] }` where `version` matches `data-scenario-version` in `demo/index.html`, and every `id` in `ids` has an existing, non-empty `demo/scenarios/<id>.json` file.
    4. Every font `url(...)` referenced across all `demo/**/*.css` files resolves (relative to that CSS file) to an existing, non-empty font file inside `demo/fonts/`.

### 2. Cache Safety & Content Hashing (`review-phase1-b2-b3.md` §5.2)
- **Finding**: `/demo/` files (`replay-bridge.js`, `fonts/*`, `scenarios/*.json`, `theme-extra.css`, and webview chunks when built with `outputHashing: "none"`) were un-hashed, risking stale cached assets pairing with a newly deployed `index.html`.
- **Changes**:
  - **Webview chunks (`scripts/do-build.sh` & `.github/workflows/deploy-landing.yml`)**: `ptah-extension-webview` is now built for the demo with `npx nx build ptah-extension-webview --configuration=production --output-hashing=all`.
  - **Bridge bundle (`scripts/landing/build-live-demo.mjs`)**: `bundleReplayBridge` builds the bridge with `esbuild` (`write: false`), computes an 8-hex-character SHA-256 hash (`<hash8>`), and writes `replay-bridge.<hash8>.js` (e.g., `replay-bridge.ebca5e33.js`).
  - **Self-hosted fonts (`scripts/landing/build-live-demo.mjs`)**: `copySelfHostedFonts` computes the 8-char SHA-256 content hash of each `.woff2` file, writes `fonts/s/.../<name>.<hash8>.woff2`, and rewrites all CSS/HTML font URLs to the hashed filenames.
  - **Deferred theme sheet (`scripts/landing/build-live-demo.mjs`)**: `resolveOrHashThemeExtraCss` hashes unhashed `theme-extra.css` into `theme-extra.<hash8>.css` (or detects Angular's `theme-extra-<hash>.css` when `--output-hashing=all` is active) and updates `<link id="ptah-theme-extra" ... href="...">` in `demo/index.html`.
  - **Scenario index & version attribute (`scripts/landing/build-live-demo.mjs`)**: `copyScenarios` computes an 8-char SHA-256 hash over all sorted scenario `<id>.json` files, writes `scenarios/index.json` as `{ "version": "<hash8>", "ids": [...] }`, and `rewriteIndexHtml` emits `<script src="replay-bridge.<hash8>.js" data-scenario-version="<hash8>"></script>`. Individual `scenarios/<id>.json` files keep their `<id>.json` filenames on disk so fetches both with and without `?v=<hash8>` succeed.
  - **Entry HTML**: `demo/index.html` remains un-hashed as the `/demo/` entry document.
  - **Updated deploy assertions**: Updated `scripts/do-build.sh`, `.github/workflows/deploy-landing.yml`, and `scripts/landing/check-live-demo.mjs` to assert the hashed `replay-bridge.<hash8>.js` filename and `{ version, ids }` schema instead of a static `replay-bridge.js` or bare array.

### 3. Nx Cache Inputs for `build-demo` (`review-phase1-b2-b3.md` §5.6)
- **Finding**: `apps/ptah-landing-page/project.json` (`build-demo` target) did not declare `inputs`, so edits to `scripts/landing/**`, `libs/web/landing/src/lib/live-demo/**`, or `libs/frontend/webview-e2e-harness/src/lib/fonts/**` could return a stale Nx cache hit.
- **Changes**:
  - Added explicit `inputs` to `apps/ptah-landing-page/project.json` (`build-demo`):
    ```json
    "inputs": [
      "production",
      "^production",
      "{workspaceRoot}/scripts/landing/**",
      "{workspaceRoot}/libs/web/landing/src/lib/live-demo/**",
      "{workspaceRoot}/libs/frontend/webview-e2e-harness/src/lib/fonts/**"
    ]
    ```

### 4. DigitalOcean App Platform Response Headers & `frame-ancestors` (`review-phase1-b1.md` m10 & `review-phase1-b2-b3.md` §5.2)
- **Research & Finding**:
  - DigitalOcean App Platform's `static_sites` specification in `.do/app.yaml` supports `catchall_document`, `error_document`, `index_document`, `routes`/`ingress`, and `cors`, but **does not support custom HTTP response headers** (`headers:` is not a valid field in the App Platform `static_sites` spec and `doctl apps update` rejects unknown fields).
  - Furthermore, W3C CSP Level 2/3 forbids `frame-ancestors` in `<meta http-equiv="Content-Security-Policy">` (browsers ignore it in `<meta>` and emit a console warning, which would also trip our zero-warning Playwright check).
- **Changes & Documented Fallbacks**:
  - `.do/app.yaml` was left unchanged so `doctl apps update` continues to validate cleanly.
  - **Cache-Control fallback**: Implemented full content hashing across all `/demo/` subresources (`replay-bridge.<hash8>.js`, `fonts/s/.../*.<hash8>.woff2`, `theme-extra.<hash8>.css`, `--output-hashing=all` webview chunks, and `data-scenario-version="<hash8>"`).
  - **`frame-ancestors` & `/demo/index.html` header fallback**: See Section 4 (Open Items) below for CDN/Cloudflare response header rules and optional runtime capturing-listener hardening.

### 5. Minor Security & Code Quality Fixes (`review-phase1-b2-b3.md` §4, §5.7, §6)
- **CSS font URL rewriting for CSS files in subfolders (§4.5)**:
  - `build-live-demo.mjs` now computes `relFontsPrefix = relative(dirname(cssFile), join(outDir, 'fonts')).split(sep).join('/')` per CSS file and rewrites both `https://fonts.gstatic.com/s/...` and `@import` fallback `fonts/s/...` URLs to `${relFontsPrefix}/${hashedSubpath}` (e.g. `fonts/s/...` at the root and `../../fonts/s/...` in nested subfolders).
- **`assertNoExternalUrls` scanning JS chunks (§4.2)**:
  - `build-live-demo.mjs` now runs `assertNoExternalUrls` across all `.js`/`.mjs`/`.cjs` files in `outDir` in addition to `.css` and `index.html`.
  - **Documented JS rule**: In `.js` files, `assertNoExternalUrls` rejects any external font, stylesheet, or script load — specifically:
    1. Any URL on `fonts.googleapis.com`, `fonts.gstatic.com`, `use.fontawesome.com`, `ka-f.fontawesome.com`, `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com`, `esm.sh`, or `ga.jspm.io`.
    2. Any `https?://` URL whose pathname ends with `.woff2`, `.woff`, `.ttf`, `.otf`, `.eot`, `.css`, `.js`, `.mjs`, `.cjs`, or `.wasm` (with optional query/hash).
    3. Any `https?://` URL inside `@import`, `url(...)`, `import(...)`, or `importScripts(...)`.
    Plain non-loaded strings in JS (such as W3C XML/SVG/MathML/JSON-Schema namespace URIs, `<a href target="_blank">` documentation links, MCP/provider catalog metadata URLs, and library error-reporting links in Marked/Mermaid/Chevrotain/Langium/Angular/UUID/Prism) are allow-listed.
- **Shared `parseArgs` helper (§6.1)**:
  - Extracted `parseCliFlags` into `scripts/landing/live-demo-cli.mjs` and refactored `build-live-demo.mjs`, `check-live-demo.mjs`, and `live-demo-static-server.mjs` to delegate argument parsing to it.
- **Static server cleanup & symlink containment (§4.1, §6.2)**:
  - Removed duplicate `startServer` and `startLiveDemoServer` exports from `scripts/landing/live-demo-static-server.mjs`, keeping `start`.
  - Added `realpathSync` verification in `resolveSafeFilePath` so symlinks inside `rootDir` pointing outside `rootDir` return `null` (`404 Not Found`).
  - Added recursion depth guard (`depth > 16`) in `copyWebviewRecursive` in `scripts/landing/build-live-demo.mjs`.
- **Shared build & assertion sequence between `do-build.sh` and workflow (§5.7)**:
  - `scripts/do-build.sh` defines `build_ptah_live_demo` and `assert_ptah_live_demo` and exposes `--demo-only` and `--assert-demo-only` flags. `.github/workflows/deploy-landing.yml` calls `bash scripts/do-build.sh --demo-only` and `bash scripts/do-build.sh --assert-demo-only "$DIST"`, avoiding duplicate build commands while not double-building `ptah-landing-page`.

---

## 3. Test Evidence (Without Nx Builds)

### A. Build & Artifact Verification (`/tmp/ptah-b3fix/demo`)
Command:
```bash
node scripts/landing/build-live-demo.mjs --out /tmp/ptah-b3fix/demo
bash scripts/do-build.sh --assert-demo-only /tmp/ptah-b3fix
```
Output:
```text
[build-live-demo] Output: /tmp/ptah-b3fix/demo (783 files, 15 hashed fonts, bridge=replay-bridge.ebca5e33.js, scenarioVersion=22d46c86, 4 scenario(s): chat-tool-call, command-center, multi-agent, tribunal-council)
[build-live-demo] JS+CSS (756 files): raw=22.26 MB (23,341,031 B) | gzip=5.29 MB (5,549,584 B) | brotli=5.25 MB (5,502,814 B)
[do-build] Verified PtahCode live demo: bridge=replay-bridge.ebca5e33.js, scenarioVersion=22d46c86, scenarios=chat-tool-call,command-center,multi-agent,tribunal-council, fonts=15
```

### B. Playwright Smoke Check (`check-live-demo.mjs`)
Command:
```bash
node scripts/landing/check-live-demo.mjs --root /tmp/ptah-b3fix --json /tmp/ptah-b3fix/check-live-demo.json
```
Output:
```text
Scenario         | Status | firstPaint(ms) | readyAt(ms) | complete(ms) | Misses | Errors | Warns | CSP | ExtReq
-----------------+--------+----------------+-------------+--------------+--------+--------+-------+-----+-------
chat-tool-call   | PASS   | 3136           | 8582        | 13767        | 0      | 0      | 0     | 0   | 0     
command-center   | PASS   | 3044           | 6163        | 37643        | 0      | 0      | 0     | 0   | 0     
multi-agent      | PASS   | 3188           | 7437        | 45571        | 0      | 0      | 0     | 0   | 0     
tribunal-council | PASS   | 2388           | 5715        | 42773        | 0      | 0      | 0     | 0   | 0     
```
All 4 scenarios (`chat-tool-call`, `command-center`, `multi-agent`, `tribunal-council`) completed with `0` misses, `0` console/page/HTTP errors, `0` console warnings, `0` CSP violations, and `0` external requests (confirming un-queried `scenarios/<id>.json` fetches continue to work with the existing runtime).

### C. Unit Assertions for Edge Cases
Verified via Node assertion script:
1. Subfolder CSS font rewrite (`relFontsPrefix: '../../fonts'`) rewrites `https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2` to `url(../../fonts/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.<hash8>.woff2)`.
2. `assertNoExternalUrls` on `.js` files allows plain doc/namespace URLs (`https://github.com/Hive-Academy/ptah-extension/releases`, `http://www.w3.org/2000/svg`) and throws on external font (`https://fonts.gstatic.com/...`), script (`https://cdn.example.com/bundle.js`), and dynamic `import("https://...")` loads.
3. `resolveSafeFilePath` blocks symlink traversal outside `rootDir` (`null`).
4. `parseArgs` across `build-live-demo.mjs`, `check-live-demo.mjs`, and `live-demo-static-server.mjs` parses `--flag value`, `--flag=value`, repeatable `--scenario`, and positional port arguments accurately.

---

## 4. Open / Follow-Up Items for Other Lanes

1. **B1 Runtime Follow-Up (`data-scenario-version` cache-busting query)**:
   - `demo/index.html` now emits `<script src="replay-bridge.<hash8>.js" data-scenario-version="<hash8>"></script>`, and `demo/scenarios/index.json` is written as `{ "version": "<hash8>", "ids": [...] }`.
   - **Action for B1 lane (`libs/web/landing/src/lib/live-demo/runtime/`)**: Capture `const scenarioVersion = (document.currentScript as HTMLScriptElement | null)?.dataset?.['scenarioVersion']` at synchronous bridge bootstrap time and pass it into `loadScenario`, appending `?v=${encodeURIComponent(scenarioVersion)}` to `new URL(\`scenarios/\${query.id}.json\`, baseURI)` when present. Ensure `network-guard.ts` continues to allow same-origin `/demo/scenarios/<id>.json?v=<hash8>` URLs (`parsed.pathname.startsWith('/demo/')` already permits query strings).
2. **DigitalOcean App Platform HTTP Headers (`frame-ancestors 'self'` and `Cache-Control: no-cache`)**:
   - DigitalOcean App Platform `static_sites` in `.do/app.yaml` does not support custom per-route HTTP response headers, and HTML `<meta http-equiv="Content-Security-Policy">` cannot set `frame-ancestors`.
   - **Ops / CDN Follow-Up**: Configure Cloudflare Transform Rules (Modify Response Header) on `ptah.live` for `http.request.uri.path starts_with "/demo"` to set `Content-Security-Policy: frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`, and (for `/demo/` and `/demo/index.html`) `Cache-Control: no-cache`.
   - **Optional B1 Runtime Hardening (`review-phase1-b1.md` m10)**: In `replay-bridge.entry.ts`, register a capturing `window.addEventListener('message', ..., true)` before Angular boots that calls `event.stopImmediatePropagation()` when `event.isTrusted && event.source !== window && !(window.parent !== window && event.source === window.parent && event.origin === window.location.origin)`. This blocks cross-origin framing pages from injecting synthetic host messages into `MessageRouterService` even without an HTTP `frame-ancestors` header.
