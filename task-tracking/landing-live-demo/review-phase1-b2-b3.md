# Review: Phase 1 B2 (scenario contract) and B3 (build copy step, smoke check, deploy)

Verdict: APPROVE WITH CHANGES. No blockers. The contract is followed closely. The drift guard works for the cases asked about. The main gaps are the deploy assertions (a missing /demo/ file is not caught on App Platform), Nx cache inputs, and privacy-scan coverage.

Scope read: all of B2 and B3 scripts in full, the diffs of project.json, do-build.sh and deploy-landing.yml, the built webview `index.html` in `dist/`, and `.do/app.yaml`. `generate-live-demo-types.mjs --check` exits 0. I did not build or run Jest.

## 1. Contract conformance

All items conform:
- CSP string is exact (`build-live-demo.mjs:buildDemoCsp`). The hashes are computed after the base, font and bridge rewrites and before the meta is inserted (`rewriteIndexHtml`). The meta is inserted right after `<base>`.
- Base href is `/demo/`. The bridge is the first `<script>` in head, ahead of the inline theme script. `scenarios/index.json` is a sorted array of ids.
- Fonts are self-hosted from the harness gstatic folder, and the OFL notices are copied.
- The `build-demo` Nx target depends on landing `build` and webview `build`. Both default to `production` (project.json:12 in each project).
- The scenario JSON has `bootMessages` with `switchView` and `$activeTabId` limited to timeline `chat:chunk` (`scenario-contract.spec.ts`).

## 2. Drift guard

| Case | Result |
| --- | --- |
| Unknown RPC method in `rpc`, `rpcCases` or `rpcErrors` | Caught at runtime by the spec (`Object.keys` against `RPC_METHOD_NAMES`) and by `satisfies` (mapped type). |
| Wrong result shape | Caught only by the `typecheck` target of `tsconfig.lib.json`, which includes `src/**/*.ts` and so the generated `.ts`. Jest does not import the generated file, so `test` alone will not catch it. Acceptable, because `npm run verify` runs typecheck. |
| Unknown message type | Caught by the spec (`MESSAGE_TYPES`, including nested batch events and boot messages) and by the type union. |
| Unordered `at` | Caught by the spec. Equal values are allowed. |
| Freshness check from Jest's cwd | Works. The root comes from `__dirname` (7 levels up, correct), and `cwd` is passed to `execFileSync`. It does not depend on Jest's cwd. |

Gaps:
- **minor** `generate-live-demo-types.mjs:12-22`: `--check` does not flag orphan `*.scenario.generated.ts` files whose JSON was deleted. Fix: list `*.scenario.generated.ts` and fail on any without a matching JSON.
- **minor** `scenario-contract.spec.ts`: ordering of `at` is not enforced inside nested batches. This is moot, since batches share one `at`.
- **minor** `scenario-contract.spec.ts:22-23`: `scenario.rpc['session:list']?.sessions.map(...)` throws a TypeError, not a clear assertion, if `session:list` is missing. Add `expect(scenario.rpc['session:list']).toBeDefined()`.

## 3. Privacy scan (`privacy-scan.ts`)

Bypasses and gaps (fail-open):
- **major** `privacy-scan.ts:9`: credential detection only looks at key names and a few token shapes (line 17). Plain text such as `password=hunter2`, `API_KEY=abc123`, a 40-char hex token, `github_pat_...`, `glpat-...` or `AIza...` passes. Tool results containing `.env` content are the likely leak vector. Fix: add `(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+` to the string scan, add those prefixes to `secretShape`, and flag hex or base64url runs of 32 or more characters.
- **minor** `privacy-scan.ts:11`: `home` misses `C:/Users/` (forward slashes), `~/`, `/root` (caught by `absolutePath`), `/var/home` and UNC paths. `absolutePath` (line 19) only matches after whitespace, a quote, `=`, `:` or `(`. `x,/etc/passwd` and `[/tmp/x]` slip through. Fix: widen the lookbehind class to `[\s"'=:(,\[{>]` and add `~/`.
- **minor** `privacy-scan.ts:12-13`: the hostname TLD list is closed (com, net, org, io, dev, live, app, co, ai, xyz, edu, gov). `host.local`, `corp.internal`, `x.me`, `x.sh` and `x.test` pass. Fix: flag any dotted hostname that is not in an allowlist, or at least add `local|internal|lan|me|sh|test|cloud|tech|dev`.
- **minor** There is no detection of encoded strings: percent-encoded (`%2Fhome%2F`), HTML entities, or base64 under 200 characters. This is partly inherent. A `decodeURIComponent` pass before scanning would be cheap.
- **minor** There is no detector for personal names or org names. The scan is purely syntactic. This is a documented limitation at best and needs a human review gate for new scenarios.
- Exemption scope: `demo@example.invalid` is exempt in any string and any key (line 31), not just `authorEmail`. An exact-match test on a match of the email regex limits it to the exact address, which is fine. The canary for `other@example.invalid` exists. Optional hardening: restrict the exemption to the `authorEmail` key.

False positives for legitimate code text (these block content, not safety):
- **minor** The hostname regex flags code like `ctx.co`, `self.app`, `foo.org` and `x.io`.
- **minor** The IPv4 regex (line 15) flags version strings like `1.2.3.4`.
- **minor** `file:///workspace/acme-app/x.ts` is flagged as 'URL host' (empty host) at line 36.
- **minor** Slash commands such as ` /help` or ` /clear` in prose are flagged as 'absolute path'.
- The scan has no per-path allowlist. Authors must rewrite the content. This is consistent with fail-closed, but note it for the scenario authors.
- Key-name false positives: `camelCredentialField` flags a singular `...Token` key (for example `cacheToken`). Plural usage keys such as `inputTokens` are fine.

## 4. Security of the scripts

- **minor** `live-demo-static-server.mjs:35-51`: the traversal check is correct. It decodes, rejects NUL, resolves, and uses a `root + sep` prefix check. Encoded `..%2f` is handled by the decode step. Symlinks are not resolved: `statSync` follows a symlink inside the root that points outside it. The server is only a test server bound to 127.0.0.1 and serves build output, so the risk is low. Fix, if wanted: `realpathSync(candidate)` and re-check the prefix.
- Good: only GET and HEAD, `no-store`, no SPA fallback. The local 404 behaviour means the smoke check would catch a missing file.
- **minor** `build-live-demo.mjs:assertNoExternalUrls` (called at the CSS and index.html sites): only `.css` and `index.html` are scanned. External URLs in JS chunks are not. The runtime network guard and `connect-src 'self'` cover this, and the smoke check records external requests. The remaining risk is a doc link in JS, which is harmless.
- **minor** `build-live-demo.mjs:copyWebviewRecursive` follows symlinks without a depth guard. Low risk, since the input is a build output.
- **minor** `GOOGLE_FONT_LINK_RE` and the CSS URL rewrite replace `https://fonts.gstatic.com/` with the relative `fonts/`. This works only for CSS files at the demo root (the bundle is flat). A CSS file in a subfolder would resolve its fonts incorrectly. Make the prefix `/demo/fonts/` or compute it per file.
- **minor** `build-live-demo.mjs:rewriteIndexHtml` finds inline scripts with a regex. This is fine for the Angular output but fragile: an inline event-handler attribute such as the `onload="this.media='all'"` that Angular's critical-CSS inlining emits would be blocked by `script-src`. The webview build uses `inject:false` and has none today, and the smoke check would report the violation. Keep the check in the pipeline (see section 5).
- check-live-demo: it treats console errors, console warnings, page errors, HTTP >= 400, external requests (aborted and recorded), CSP violation events and misses as failures. It runs against the real CSP (meta). WebSocket connects are not seen by the route handler. They are covered by `connect-src` and the violation event. Good.
- **minor** `check-live-demo.mjs:waitForScenarioCompletion` only fast-fails on `scenario-load` misses. Other misses are reported only after completion or the 60 s timeout. This is acceptable.

## 5. Deploy

- **major** The smoke check is not run anywhere in deploy: `do-build.sh` and `deploy-landing.yml` only assert that three files exist plus `<base>` and the CSP meta. The App Platform `catchall_document: index.csr.html` (`.do/app.yaml`) serves a missing `/demo/x` as HTTP 200 HTML. A missing font, chunk or scenario JSON in production would therefore not produce a 404. Fix: add a CI step, after `npx playwright install chromium`, that runs `node scripts/landing/check-live-demo.mjs --json dist/check-live-demo.json` before `doctl`. In `do-build.sh`, add content assertions: `scenarios/chat-tool-call.json` exists, and every id in `index.json` has its JSON file. Also assert that `replay-bridge.js` is non-empty and that `grep -q "replay-bridge.js"` matches in `demo/index.html`.
- **major** `.do/app.yaml` has no cache headers. The `/demo/` files are un-hashed: `index.html`, `replay-bridge.js`, `scenarios/*.json`, `theme-extra.css`, `fonts/*`. Only the webview chunks are hashed. If the platform serves them with long-lived caching, a stale `replay-bridge.js` or scenario can pair with a new index.html and break the runtime. Fix: add a short TTL or `no-cache` for `/demo/index.html`, `/demo/replay-bridge.js` and `/demo/scenarios/*`, or hash those filenames. If the platform cannot set headers, a `?v=<build hash>` query on the bridge script and scenario fetches avoids the mismatch.
- **minor** `scripts/do-build.sh:22-34`: with `set -e`, a failed webview build or copy step fails the whole deploy, which is the safe behaviour. Cost: the second Angular build (the full webview, production, `--skip-nx-cache`) adds a few minutes and memory on the 4 GB heap builder. `NODE_OPTIONS` is already set at the app level. Consider building the webview before the landing so the heaps are not both live. `esbuild` is a devDependency, and `NODE_ENV=development` keeps it installed. Fine.
- **minor** `scripts/do-build.sh`: the `--skip-nx-cache` flag is correct, and `NX_SKIP_NX_CACHE` is already exported. The `node scripts/landing/build-live-demo.mjs` call after the build is not wrapped in Nx. The landing build wipes `dist/ptah-landing-page` (the Angular builder cleans its output path), so the copy step must come after it, which it does.
- **minor** `deploy-landing.yml`: the order is correct. The "Build PtahCode live demo" step runs after the landing build and before the assertions. The assertions run before `doctl`. Missing: `npx playwright install` and the smoke check (above). The `grep -qi 'http-equiv="Content-Security-Policy"'` matches the exact generated form. It would not match single-quoted attributes, but the generator controls the output.
- **minor** `apps/ptah-landing-page/project.json:69-81` (the `build-demo` target): the `outputs` path is inside the landing `build` output (`{options.outputPath}`). Nx hash inputs are `default` (project files only), so `scripts/landing/**` and the fonts folder `libs/frontend/webview-e2e-harness/src/lib/fonts` are not inputs. A change to the copy script alone returns a stale cache hit. Fix: add `"inputs": ["default", "^default", "{workspaceRoot}/scripts/landing/**", "{workspaceRoot}/libs/frontend/webview-e2e-harness/src/lib/fonts/**", "{workspaceRoot}/libs/web/landing/src/lib/live-demo/**"]`. The webview build is a dependent task, so its hash is included.
- **minor** The workflow and `do-build.sh` duplicate the build sequence instead of calling `nx run ptah-landing-page:build-demo`. The `build-demo` target is unused by either. Prefer one entry point so they cannot drift.

## 6. Code quality vs repo conventions

- **minor** The `.mjs` scripts hand-roll the same `parseArgs` loop three times (build, check, server). A shared helper in `scripts/landing/` would remove the copy-paste.
- **minor** `live-demo-static-server.mjs` exports three aliases for `start` (`start`, `startServer`, `startLiveDemoServer`). Keep one.
- **minor** `build-live-demo.mjs` embeds about 15 hard-coded font-face lines (FALLBACK_GOOGLE_FONTS_CSS) with Google font version paths (`v26`, `v20`, `v24`). If the harness fonts are refreshed, these silently go stale. The build does throw on a missing font file, so it fails loudly. Acceptable.
- **minor** `scenario/replay-scenario.types.ts` and `privacy-scan.ts` use dense one-line statements (for example lines 28-50 of privacy-scan.ts). That is a style matter for code-style-reviewer.
- Good: pure and testable functions, fail-closed scanner, canaries in the privacy spec, `execFileSync` with an argv array (no shell).

## Required changes before merge

1. Run the smoke check in the deploy workflow, and add content assertions for the scenarios in `do-build.sh` (section 5, first item).
2. Add cache control, or a version query, for the un-hashed demo files (section 5).
3. Add the missing credential text patterns to the privacy scan (section 3, first item).
4. Add `inputs` to the `build-demo` Nx target (section 5).
