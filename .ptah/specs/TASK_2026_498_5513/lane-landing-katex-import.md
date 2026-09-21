# Landing page optional KaTeX import investigation

## Scope

**Affected surface: development server only. The production build was not broken.**

Confirmed migration state:

- `git diff main...HEAD -- package.json package-lock.json` shows the declared dependency changed from `ngx-markdown: ^21.1.0` to `^22.0.2`; the installed/locked version is `22.0.2`.
- `node_modules/ngx-markdown/package.json` declares `marked-katex-extension: ^5.0.0` and marks it optional in `peerDependenciesMeta`.
- `npm ls ngx-markdown marked-katex-extension --all` reports only `ngx-markdown@22.0.2`; `Test-Path node_modules/marked-katex-extension` is `False`.
- The app root still intentionally configures `provideMarkdownRendering({ extensions: 'basic' })` in `apps/ptah-landing-page/src/app/app.config.ts`; KaTeX is not enabled.

Before the fix, a real Chromium navigation to `http://localhost:4310/` returned the document with HTTP 200 but produced a `vite-error-overlay`. The failing request was:

```text
500 http://localhost:4310/@fs/D:/projects/ptah-extension/.angular/cache/22.1.8/ptah-landing-page/vite/deps/ngx-markdown.js?v=aaab7374
request failure: net::ERR_ABORTED
overlay count: 1
```

This confirms that merely starting `nx serve` is insufficient and reproduces the reported browser-only failure.

The unmodified production build completed successfully before the fix. Inspection of `dist/ptah-landing-page/browser/main-NZGOQ6UA.js` found the retained `import("marked-katex-extension")` inside `extendsRendererForKatex`, behind the runtime `katex` flag and followed by `.catch(() => null)`. No `marked-katex-extension` package or code was included. The initial bundle hashes and sizes were identical before and after the fix, further confirming that production output was already leaving this optional import unresolved and was not the broken surface.

## Root cause

`ngx-markdown@22.0.2` added the optional KaTeX integration as a literal dynamic import. Dependency optimization emits this into `.angular/cache/.../vite/deps/ngx-markdown.js` as:

```js
yield import(
  /* @vite-ignore */
  "marked-katex-extension"
).then((module) => module.default).catch(() => null)
```

The runtime design is sound for the requested `basic` preset: that expression is reached only when KaTeX rendering is requested, and a missing optional module is caught. The failure happens earlier. Vite's import-analysis sees a **literal** module specifier while transforming the optimized dependency and tries to resolve it before the browser can execute the import or its promise catch. The `@vite-ignore` check in the installed Vite import-analysis implementation suppresses warnings/transforms for non-analyzable dynamic expressions; it does not turn a statically readable bare package specifier into an external module. Resolution therefore fails while serving the optimized dependency, causing its HTTP 500 and the overlay.

This is why neither the KaTeX gate nor `.catch(() => null)` can handle the dev-server failure: JavaScript execution never reaches them.

## Fix

Changed only `apps/ptah-landing-page/project.json`:

```json
"externalDependencies": ["marked-katex-extension"]
```

The setting is on the `@angular/build:application` build options, so the corresponding Angular dev server receives it through the build target. This is the mechanism Angular 22 actually supports here:

- `node_modules/@angular/build/src/builders/application/schema.json` defines `externalDependencies`.
- Angular's dev-server `updateExternalMetadata(...)` adds configured values to its explicit browser/server externals.
- Its Vite memory plugin documents and implements the relevant behavior: `Prevent vite from resolving an explicit external dependency (externalDependencies option)`.

This was chosen over `optimizeDeps.exclude` because the Angular builder does not expose arbitrary Vite configuration in this project; `externalDependencies` is its supported public option and directly addresses the failing resolver. It was chosen over installing `marked-katex-extension` because KaTeX is unused, the peer is explicitly optional, and installation would add unnecessary package/dependency weight for a marketing site. No package manifest or lockfile was changed.

The production bundle remains intentionally capable of attempting the bare dynamic import only if a future caller explicitly enables KaTeX. With today's `basic` and `member` presets that path is not executed. Post-fix production output contains the import string in exactly one file (`main-NZGOQ6UA.js`), `marked-katex-extension` remains uninstalled, and the output hashes/sizes are unchanged. Thus this fix adds **zero KaTeX implementation bytes** to the shipped bundle.

## Other consumers

`libs/web/members` uses `MarkdownBlockComponent` from `@ptah-extension/markdown` for forum threads and lesson comments. The `/members` route installs `provideMarkdownRendering({ extensions: 'member' })` at route scope. It does not import `ngx-markdown` directly in production code.

The same dev-server failure affected member panel routes because they are built and served by the same `ptah-landing-page` application target, and the shared optimized `ngx-markdown.js` request was already broken at the application level before any KaTeX code ran. The app-level `externalDependencies` setting covers all eager and lazy routes, including the member chunks; no `libs/web/**` change is necessary.

Two post-fix browser checks support that conclusion:

1. An unauthenticated navigation to `/members/community/topics/test` had no Vite overlay and correctly redirected after the real entitlement endpoint returned 401.
2. A Playwright navigation to `/members/search` stubbed only the entitlement (`{ entitled: true, cohorts: [], isAdmin: false }`) and unread-count (`{ unreadCount: 0 }`) HTTP boundaries. It loaded the real lazy member panel and observed `ptah-member-layout` once, HTTP 200, final URL `/members/search`, zero overlays, zero failed requests, zero responses >= 400, and no console or page errors.

The second check proves the lazy member library loads under the fix rather than merely proving that the guard redirects safely.

## Chokepoint

The single markdown/XSS path is intact.

- No file under `libs/frontend/markdown/**` or `libs/web/**` was modified.
- `apps/ptah-landing-page/src/app/app.config.ts` still uses `provideMarkdownRendering({ extensions: 'basic' })`.
- `apps/ptah-landing-page/src/app/app.routes.ts` still scopes `provideMarkdownRendering({ extensions: 'member' })` to `/members`.
- Member-authored bodies still render through `MarkdownBlockComponent` / `<ptah-markdown-block>` from `@ptah-extension/markdown`.
- No `[innerHTML]`, second sanitizer, direct member production import from `ngx-markdown`, or alternate parser path was introduced.
- The `web-members` test run includes the repository's `markdown-chokepoint.spec.ts` enforcement and passed.

The only source/config change is dependency externalization in the landing application's builder configuration.

## Verification

### Loaded development pages

The available interactive computer-use inventory contained no apps or browsers (`{"apps":[],"browsers":[]}`), so the installed system Chrome was driven with the repository's Playwright library. This is a real browser navigation, not an HTTP-only probe.

Landing page after the fix:

```text
URL: http://localhost:4310/
HTTP status: 200
Title: Ptah — It Knows Your Architecture. It Ships the SaaS.
Rendered text begins: Product / Pricing / Docs / Community / ... / IT SHIPS THE SAAS.
vite-error-overlay count: 0
Failed requests: 0
HTTP responses >= 400: 0
pageerror events: 0
Console errors: 0
```

Member panel after the fix:

```text
URL: http://localhost:4310/members/search
HTTP status: 200
Final URL: http://localhost:4310/members/search
Rendered shell: ptah-member-layout count = 1
Rendered heading/content: Ptah Builders / Search / Search the community.
vite-error-overlay count: 0
Failed requests: 0
HTTP responses >= 400: 0
pageerror events: 0
Console errors: 0
```

Screenshots were captured for the baseline, fixed landing page, and fixed member panel, and the two fixed images were opened and visually inspected: the landing page hero/content and the member search panel both render, with no overlay. The generated PNGs were removed after inspection because the task explicitly forbids leaving anything under `.ptah/` except this deliverable.

### Production build output

Command:

```text
$env:NX_DAEMON='false'; npx nx build ptah-landing-page --configuration=production --skip-nx-cache --output-style=static
```

Output:

```text
NX Running target build for project ptah-landing-page and 1 task it depends on

> nx run @ptah-extension/markdown:build:production
Built @ptah-extension/markdown

> nx run ptah-landing-page:build:production
Initial chunk files   | Names     | Raw size | Estimated transfer size
main-NZGOQ6UA.js      | main      | 553.60 kB | 148.47 kB
chunk-B6_mJJle.js     | -         | 427.66 kB | 77.98 kB
chunk-BNAjQS8D.js     | -         | 261.78 kB | 76.12 kB
styles-FFF5UY7C.css   | styles    | 172.84 kB | 20.36 kB
polyfills-LVNOU2XZ.js | polyfills | 35.88 kB  | 11.64 kB
chunk-7rVoKTlc.js     | -         | 28.23 kB  | 8.88 kB
Initial total                     | 1.48 MB   | 343.47 kB

Lazy chunk files      | Names                | Raw size | Estimated transfer size
chunk-CnYtH-Oy2.js    | sessions-list        | 392.47 kB | 95.47 kB
chunk-B-j_gme-.js     | index                | 54.68 kB  | 12.26 kB
chunk-LhQ-UXT22.js    | waitlist-pipeline    | 49.98 kB  | 12.15 kB
chunk-qGUKZJCR.js     | course-detail        | 43.10 kB  | 8.97 kB
chunk-C0W2A7bF.js     | index                | 39.36 kB  | 9.31 kB
chunk-sqfnptgM2.js    | community-moderation | 37.86 kB  | 8.56 kB
chunk-BDuZtRFx.js     | index                | 36.42 kB  | 7.93 kB
chunk-1cac1hYf.js     | index                | 26.53 kB  | 7.15 kB
chunk-B_OGqYsH.js     | packs-list           | 23.87 kB  | 5.87 kB
chunk-x8LZkEkb2.js    | groups-list          | 23.20 kB  | 5.65 kB
chunk-B7vIx1sV.js     | lesson-page          | 22.35 kB  | 6.11 kB
chunk-DSJkm3Ht2.js    | courses-list         | 20.17 kB  | 5.52 kB
chunk-SW2NVJLK.js     | lenis                | 18.66 kB  | 4.90 kB
chunk-D24pybK82.js    | thread-page          | 18.64 kB  | 5.32 kB
chunk-GGdDopdw.js     | hub-page             | 18.07 kB  | 4.99 kB
...and 55 more lazy chunk files.

Prerendered 6 static routes.
Application bundle generation complete. [10.994 seconds]
Output location: D:\projects\ptah-extension\dist\ptah-landing-page
NX Successfully ran target build for project ptah-landing-page and 1 task it depends on
Run duration: 14.3s
Cache: Skipped (--skip-nx-cache)

Warnings (pre-existing/non-fatal): initial bundle budget exceeded by 479.99 kB;
@fullcalendar/angular/skeleton.css exceeded its 4 kB component-style warning budget.
```

Emitted artifact listing by extension (recursive under `dist/ptah-landing-page`):

```text
.css      count=  1 bytes=172835
.html     count=  7 bytes=592305
.ico      count=  1 bytes=180638
.jpg      count=  1 bytes=342705
.js       count= 75 bytes=2531774
.json     count=  1 bytes=146
.png      count= 20 bytes=21861145
.svg      count=  4 bytes=1908
.txt      count=  3 bytes=77695
.webp     count=  8 bytes=579616
.xml      count=  1 bytes=842
```

Top-level emitted browser artifacts (the 75 JavaScript artifacts are `main-NZGOQ6UA.js`, `polyfills-LVNOU2XZ.js`, and 73 `chunk-*.js` files):

```text
favicon.ico             180638
index.csr.html           28275
index.html              183077
llms.txt                  2661
main-NZGOQ6UA.js        553603
polyfills-LVNOU2XZ.js    35876
robots.txt                  63
sitemap.xml                842
styles-FFF5UY7C.css     172835
download/index.html      55143
pricing/index.html       80343
privacy/index.html       85599
refund/index.html        77210
terms-and-conditions/index.html 82590
3rdpartylicenses.txt     74971
prerendered-routes.json    146
```

Bundle inspection:

```text
files containing "marked-katex-extension": 1
dist/ptah-landing-page/browser/main-NZGOQ6UA.js
installed node_modules/marked-katex-extension: False
```

### Tests

Required command (the daemon was disabled to honor the edited `project.json` without using the prohibited shared-worktree `nx reset`):

```text
$env:NX_DAEMON='false'; npx nx run-many -t test -p ptah-landing-page web-members --skip-nx-cache --runInBand --output-style=static
```

Output with real counts:

```text
NX Running target test for 2 projects:
- ptah-landing-page
- web-members

> nx run ptah-landing-page:test --runInBand
Test Suites: 3 passed, 3 total
Tests:       36 passed, 36 total
Snapshots:   0 total
Time:        2.578 s

> nx run web-members:test --runInBand
Test Suites: 45 passed, 45 total
Tests:       933 passed, 933 total
Snapshots:   0 total
Time:        22.712 s

NX Successfully ran target test for 2 projects
Run duration: 23.4s
Cache: Skipped (--skip-nx-cache)
```

## Residual risk

- The production build succeeds and its artifacts were inspected, but it was not deployed to the production hosting platform in this lane.
- The member browser check uses narrowly stubbed entitlement and unread-count responses because no authenticated member credentials/session were provided. It proves the actual lazy member UI and shared markdown dependency load without the Vite failure; it does not exercise live authenticated backend data.
- If KaTeX is intentionally enabled later, `marked-katex-extension` and its KaTeX dependencies must then be installed or otherwise supplied at runtime. The current externalization is correct only while the supported presets remain `basic`/`member` without KaTeX.
