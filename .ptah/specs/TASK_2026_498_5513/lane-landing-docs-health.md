# ptah-landing-page

## serve

- **Verdict**: PASS (Repaired)
- **Evidence**:
  - **Initial failure**: Running `npm run landing` (`npx nx serve ptah-landing-page`) detected `PORT=3000` set by root `.env` (the NestJS license server port) and exited immediately:
    ```
    > nx run ptah-landing-page:serve:development
    Environment variable "PORT" detected. Using port 3000.
    NX   Port 3000 is already in use. Use '--port' to specify a different port.
    Pass --verbose to see the stacktrace.
    ```
  - **Fix**: Root `package.json` script `"landing"` was updated to `cross-env PORT=4200 nx serve ptah-landing-page`, and `"port": 4200` was added to `apps/ptah-landing-page/project.json` under `serve.options`.
  - **Live serve execution**:
    ```
    > nx run ptah-landing-page:serve:development
    Environment variable "PORT" detected. Using port 4200.
    > Building...
    √ Building...
    Application bundle generation complete. [13.489 seconds] - 2026-09-21T10:45:15.557Z
    Watch mode enabled. Watching for file changes...
      ➜  Local:   http://localhost:4200/
    ```
  - **HTTP Verification Probe** (HTTP GET `http://localhost:4200/`):
    ```
    STATUS: 200
    BODY length: 142387
    HAS TITLE: true
    ```

## build

- **Verdict**: PASS
- **Evidence**:
  - **Command**: `npx nx build ptah-landing-page`
  - **Terminal Output**:
    ```
    NX   Running target build for project ptah-landing-page and 1 task it depends on:

    √  nx run @ptah-extension/markdown:build:production  [existing outputs match the cache, left as is]
    > nx run ptah-landing-page:build:production
    > Building...
    √ Building...
    Initial chunk files   | Names                |  Raw size | Estimated transfer size
    main-NZGOQ6UA.js      | main                 | 553.60 kB |               148.47 kB
    chunk-B6_mJJle.js     | -                    | 427.66 kB |                77.98 kB
    chunk-BNAjQS8D.js     | -                    | 261.78 kB |                76.12 kB
    styles-FFF5UY7C.css   | styles               | 172.84 kB |                20.36 kB
    polyfills-LVNOU2XZ.js | polyfills            |  35.88 kB |                11.64 kB
    chunk-7rVoKTlc.js     | -                    |  28.23 kB |                 8.88 kB
                          | Initial total        |   1.48 MB |               343.47 kB
    Lazy chunk files      | Names                |  Raw size | Estimated transfer size
    ...and 70 lazy chunk files.
    Prerendered 6 static routes.
    Application bundle generation complete. [29.650 seconds] - 2026-09-21T10:44:01.228Z
    Output location: D:\projects\ptah-extension\dist\ptah-landing-page

    NX   Successfully ran target build for project ptah-landing-page and 1 task it depends on
    Run duration: 32.1s
    ```
  - **Output directory**: `dist/ptah-landing-page/browser`
  - **Emitted artifacts**:
    - Entry bundles:
      - `dist/ptah-landing-page/browser/main-NZGOQ6UA.js` (553,603 bytes)
      - `dist/ptah-landing-page/browser/polyfills-LVNOU2XZ.js` (35,876 bytes)
      - `dist/ptah-landing-page/browser/styles-FFF5UY7C.css` (172,835 bytes)
    - Prerendered static documents (all verified non-empty, contains `<h1>`, not empty `<app-root></app-root>`):
      - `dist/ptah-landing-page/browser/index.html` (183,077 bytes; contains JSON-LD structured data `application/ld+json`)
      - `dist/ptah-landing-page/browser/download/index.html` (55,143 bytes)
      - `dist/ptah-landing-page/browser/pricing/index.html` (80,343 bytes)
      - `dist/ptah-landing-page/browser/terms-and-conditions/index.html` (82,554 bytes)
      - `dist/ptah-landing-page/browser/privacy/index.html` (85,714 bytes)
      - `dist/ptah-landing-page/browser/refund/index.html` (77,251 bytes)
    - Fallback client-side rendering catchall document:
      - `dist/ptah-landing-page/browser/index.csr.html` (28,275 bytes)

## deploy path

- **Verdict**: PASS
- **Evidence**:
  - **Workflow file**: `.github/workflows/deploy-landing.yml`
  - **Trigger**: Push to branch `release/landing` or `workflow_dispatch`.
  - **Environment & Commands**:
    - `NODE_VERSION: 24` matches workspace Node pin (`24.x` in `package.json` engines).
    - Dependencies install: `npm ci || npm install --no-audit --no-fund` followed by optional native rollup binary `npm install @rollup/rollup-linux-x64-gnu --no-save --force`.
    - Build step: `npx nx run-many -t build --projects=ptah-landing-page` resolves cleanly under Nx 23.
    - Post-build assertion step: Exact shell script checks all 6 prerendered route files, `<h1>` presence, absence of raw `<app-root></app-root>`, existence of `index.csr.html`, and presence of `application/ld+json`. These assertions executed and passed against the emitted output.
    - DigitalOcean spec (`.do/app.yaml`): Sets `output_dir: dist/ptah-landing-page/browser`, `catchall_document: index.csr.html`, and `build_command: bash scripts/do-build.sh`.
    - `scripts/do-build.sh` runs `npx nx build ptah-landing-page --configuration=production --skip-nx-cache` targeting the verified output directory.
    - No hardcoded `node_modules/nx/bin/nx.js` references exist in the landing page deploy path.

## tests

- **Verdict**: PASS
- **Real counts**: 3 test suites passed, 36 tests passed (0 failed).
- **Evidence**:
  - **Command**: `npx nx test ptah-landing-page`
  - **Terminal Output**:
    ```
    > nx run ptah-landing-page:test

    The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
    PASS ptah-landing-page apps/ptah-landing-page/src/app/no-alpha-base-content.spec.ts
    PASS ptah-landing-page apps/ptah-landing-page/src/app/app.routes.spec.ts
    PASS ptah-landing-page apps/ptah-landing-page/src/app/base-content-muted.spec.ts

    Test Suites: 3 passed, 3 total
    Tests:       36 passed, 36 total
    Snapshots:   0 total
    Time:        6.066 s
    Ran all test suites.

     NX   Successfully ran target test for project ptah-landing-page
    ```

## Fixed

- Fixed port collision on local serve: Root `.env` defines `PORT=3000` for the license server, causing `@angular/build:dev-server` to attempt binding port 3000 and failing when port 3000 is in use. Updated root `package.json` script `"landing"` to `cross-env PORT=4200 nx serve ptah-landing-page`, and added `"port": 4200` to `apps/ptah-landing-page/project.json` under `serve.options`.

---

# ptah-docs

## serve

- **Verdict**: PASS (Repaired)
- **Evidence**:
  - **Issue**: In Astro 7, the CLI checks `isRunByAgent()` via `am-i-vibing`. When detected without `ASTRO_DEV_BACKGROUND`, `astro dev` automatically detaches into a background daemon and prints a JSON message, which caused the Nx `dev` / `serve` target (`continuous: true`) to complete and exit immediately rather than maintaining the persistent dev server.
  - **Fix**: Added `"env": { "ASTRO_DEV_BACKGROUND": "false" }` to both `"dev"` and `"serve"` targets in `apps/ptah-docs/project.json`. This forces `astro dev` to run in interactive foreground mode, keeping the process open for file watching as expected by `npx nx dev ptah-docs` / `npm run docs`.
  - **Live serve execution**:
    ```
    > nx run ptah-docs:dev
    > astro dev
    13:50:33 [vite] connected.
    13:50:33 [types] Generated 1ms
    13:50:34 [vite] connected.
    13:50:34 [content] Syncing content
    13:50:35 [content] Synced content
     astro  v7.3.3 ready in 3049 ms
    ┃ Local    http://localhost:4321/
    ┃ Network  use --host to expose
    13:50:35 watching for file changes...
    ```
  - **HTTP Verification Probe** (HTTP GET `http://localhost:4321/`):
    ```
    STATUS: 200
    BODY length: 141127
    TITLE: Ptah Documentation | Ptah Documentation
    ```

## build

- **Verdict**: PASS (Repaired)
- **Evidence**:
  - **Initial failure**: Astro 7 and `@astrojs/starlight` ^0.42.2 broke on the deprecated Starlight sidebar configuration. Top-level autogenerated sidebar groups using `{ label: '...', autogenerate: { directory: '...' } }` were removed in Starlight v0.39.0 and resulted in `[AstroUserError] Invalid config passed to starlight integration: Found an autogenerate object with a label. Support for autogenerated sidebar groups was removed in Starlight v0.39.0. You should instead create a group with the desired label and an items array containing the autogenerate config`.
  - **Fix**: Updated 7 sidebar sections in `apps/ptah-docs/astro.config.mjs` (`Getting Started`, `Chat`, `Providers`, `Agents`, `Sessions`, `Workspace`, `Git & Version Control`) to use the modern syntax `{ label: '...', items: [{ autogenerate: { directory: '...' } }] }`.
  - **Command**: `npx nx build ptah-docs`
  - **Terminal Output**:
    ```
    > nx run ptah-docs:build

    > node scripts/check-screenshot-refs.mjs

    [screenshots] 1 unreferenced file(s): file-tree-panel.png
    [screenshots] 32 reference(s) across the docs all resolve.
    > astro build --outDir ../../dist/apps/ptah-docs

    13:47:20 [vite] Re-optimizing dependencies because lockfile has changed
    13:47:21 [content] Syncing content
    13:47:23 [content] Synced content
    13:47:23 [types] Generated 3.01s
    13:47:23 [build] output: "static"
    13:47:23 [build] mode: "static"
    13:47:23 [build] directory: D:\projects\ptah-extension\dist\apps\ptah-docs\
    13:47:23 [build] Collecting build info...
    13:47:23 [build] ✓ Completed in 3.61s.
    13:47:23 [build] Building static entrypoints...
    ...
    13:47:26 ✓ Completed in 1.43s.
    13:47:26 [build] ✓ Completed in 2.99s.
    13:47:26 [starlight:pagefind] Building search index with Pagefind...
    13:47:28 [starlight:pagefind] Found 158 HTML files.
    13:47:28 [starlight:pagefind] Finished building search index in 2.36s.
    13:47:28 [@astrojs/sitemap] `sitemap-index.xml` created at `..\..\dist\apps\ptah-docs`
    13:47:28 [build] 156 page(s) built in 9.09s
    13:47:28 [build] Complete!

     NX   Successfully ran target build for project ptah-docs
    ```
  - **Output directory**: `dist/apps/ptah-docs`
  - **Emitted artifacts**:
    - Static pages: 156 generated HTML documents, including root `dist/apps/ptah-docs/index.html` (70 KB), section indexes, and topic pages across 19 subdirectories (`chat`, `setup`, `tribunal`, `skill-synthesis`, `workspace`, `automation`, `marketplace`, etc.).
    - Search index: `dist/apps/ptah-docs/pagefind/` containing `pagefind.js`, `pagefind-entry.json`, and search index shards indexing all 158 HTML files.
    - SEO & Assets: `sitemap-index.xml`, `sitemap-0.xml`, `favicon.svg`, `_astro/` bundled scripts/styles (`common.3tFGr250.css`, `ec.w36nc.css`, `page.DA3SwssI.js`, etc.).
  - **Typecheck verification**: `npx tsc -p apps/ptah-docs/tsconfig.json --noEmit` executed with exit code 0 and 0 errors.

## deploy path

- **Verdict**: PASS
- **Evidence**:
  - **Workflow file**: `.github/workflows/deploy-docs.yml`
  - **Trigger**: Push to branch `release/docs` or `workflow_dispatch`.
  - **Environment & Commands**:
    - `NODE_VERSION: 24` matches root workspace Node 24 requirement.
    - Dependencies install: `npm ci || npm install --no-audit --no-fund; npm install @rollup/rollup-linux-x64-gnu --no-save --force`.
    - Sanity build: `npx nx build ptah-docs` runs `check-screenshot-refs.mjs` and `astro build --outDir ../../dist/apps/ptah-docs`, which now succeeds cleanly.
    - DigitalOcean App Spec: `.do/docs-app.yaml` specifies `output_dir: dist/apps/ptah-docs`, `catchall_document: index.html`, and `build_command: bash scripts/do-docs-build.sh`.
    - No hardcoded `node_modules/nx/bin/nx.js` references exist in the docs deploy path.

## tests

- **Verdict**: PASS (No test target configured)
- **Real counts**: 0 test targets, 0 test files in `apps/ptah-docs`.
- **Evidence**:
  - `apps/ptah-docs/project.json` targets: `build`, `check-screenshots`, `screenshots`, `dev`, `serve`, `preview`.
  - Attempting `npx nx test ptah-docs` reports:
    ```
    NX   Cannot find configuration for task ptah-docs:test
    ```
  - Substantive static validation targets available for `ptah-docs`:
    1. `npx nx run ptah-docs:check-screenshots`: verified 32 screenshot references resolve without errors (`[screenshots] 32 reference(s) across the docs all resolve.`).
    2. `npx tsc -p apps/ptah-docs/tsconfig.json --noEmit`: strict TypeScript typechecking passed with exit code 0 and zero errors.

## Fixed

1. **Repaired Starlight v0.39+ sidebar configuration in `apps/ptah-docs/astro.config.mjs`**: Replaced 7 deprecated `{ label: '...', autogenerate: { directory: '...' } }` definitions with `{ label: '...', items: [{ autogenerate: { directory: '...' } }] }`. This fixed the fatal `[AstroUserError]` during `astro build`.
2. **Prevented premature dev server exit in `apps/ptah-docs/project.json`**: Added `"env": { "ASTRO_DEV_BACKGROUND": "false" }` to `dev` and `serve` targets to ensure Astro 7 does not background/detach when run under agentic CLI environments, keeping the server alive for continuous development.

---

## Residual risk

1. **DigitalOcean App Platform Remote Deploy Execution**:
   - Both `.github/workflows/deploy-landing.yml` and `.github/workflows/deploy-docs.yml` deploy via `doctl apps update ...` and `doctl apps create-deployment ... --wait` using repository secrets (`DIGITALOCEAN_ACCESS_TOKEN`, `DO_APP_ID`, `DO_DOCS_APP_ID`). While the local build commands and outputs match the DO spec, end-to-end deployment can only be confirmed by a live run on GitHub Actions pushing to `release/landing` or `release/docs`.
2. **Hardcoded Rollup Version in `scripts/do-docs-build.sh`**:
   - `scripts/do-docs-build.sh` contains:
     ```bash
     npm install --no-save --no-audit --no-fund @rollup/rollup-linux-x64-gnu@4.60.0
     ```
   - Rollup is currently resolved at `4.63.4` in the workspace. While `deploy-docs.yml` installs `@rollup/rollup-linux-x64-gnu --no-save --force` without a version pin, `scripts/do-docs-build.sh` pins `@4.60.0`. Modifying `scripts/` was outside task scope; if DigitalOcean runs `scripts/do-docs-build.sh` on fresh deploys, the version skew could potentially trigger binary mismatch errors on Linux. It should be updated to omit the `@4.60.0` version pin, matching `scripts/do-build.sh`.
3. **Optional `@astrojs/check` Dependency**:
   - `astro check` prompts for `@astrojs/check` which is not currently present in `package.json` dependencies. TypeScript typecheck was verified directly via `tsc -p apps/ptah-docs/tsconfig.json --noEmit`, which exited with code 0.
