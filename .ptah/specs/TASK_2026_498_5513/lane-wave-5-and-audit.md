# Part A: Electron 44

## A1. Latest stable Electron 44

`npm view electron dist-tags` reports `latest: '44.4.3'` and `'44-x-y': '44.4.3'`.
`npm view electron versions` confirms `44.4.3` is the newest 44.x (44.0.0 → 44.4.3 listed; 45.x is alpha-only).

**Latest stable: 44.4.3.**

## A2. True Node ABI embedded in Electron 44

Evidence (verified, not assumed):

- `npm view node-abi version` → `4.35.0` (latest). That exact version is installed at `D:\projects\ptah-extension\node_modules\node-abi` (transitive, hoisted to the root — `package.json` does not declare it directly).
- `node_modules\node-abi\abi_registry.json` lines 446-452:

  ```json
  {
    "abi": "149",
    "future": false,
    "lts": false,
    "runtime": "electron",
    "target": "44.0.0-alpha.1"
  }
  ```

- Live run of the installed library:

  ```
  node --input-type=module -e "import(.../node-abi/index.js)"
  getAbi('44.4.3','electron') -> 149
  getAbi('40.10.6','electron') -> 143
  ```

- Cross-check of the embedded Node: the official Electron 44 release notes state Electron 44 bundles **Node v24.18.1** (Chromium 152.0.7977.54, V8 15.2). `npm view electron@44.4.3 dependencies` shows `'@types/node': '^24.9.0'`, consistent with Node 24 headers. (Node 24's own ABI is 137; Electron keeps a separate ABI numbering — 149 for Electron 44.)

**Electron 44 ABI = 149. The expected value 149 is correct.**

## A3. electron-builder.yml pin

`D:\projects\ptah-extension\apps\ptah-electron\electron-builder.yml` line 4:

```yaml
electronVersion: 40.8.5
```

Replacement:

```yaml
electronVersion: 44.4.3
```

Drift note: the installed `electron` is 40.10.6 (`package.json` declares `^40.9.3`), while the builder pins the older 40.8.5. The pin, not the installed version, is what electron-builder packages with — this must change with the migration.

## A4. ELECTRON_ABI_FALLBACK in both scripts

### rebuild-native.js

`D:\projects\ptah-extension\apps\ptah-electron\scripts\rebuild-native.js` lines 40-55:

```js
const ELECTRON_ABI_FALLBACK = {
  30: 123,
  31: 125,
  32: 128,
  33: 130,
  34: 132,
  35: 133,
  36: 135,
  37: 136,
  38: 139,
  39: 140,
  40: 143,
  41: 145,
  42: 146,
  43: 148,
};
```

(Ends at `43: 148,` on line 54, `};` on line 55. No `44` entry.)

### verify-packed-native.js

`D:\projects\ptah-extension\apps\ptah-electron\scripts\verify-packed-native.js` lines 49-64:

```js
const ELECTRON_ABI_FALLBACK = {
  30: 123,
  31: 125,
  32: 128,
  33: 130,
  34: 132,
  35: 133,
  36: 135,
  37: 136,
  38: 139,
  39: 140,
  40: 143,
  41: 145,
  42: 146,
  43: 148,
};
```

(Lines 63-64: `43: 148,` then `};`. No `44` entry.)

### Silent-failure hazard: CONFIRMED TRUE

The map is a fallback used only when the dynamic `import` of `node-abi` fails. When it is consulted and the major is missing, `getElectronAbi` returns `null`:

verify-packed-native.js:78-81:

```js
  } catch {
    const major = Number(String(electronVersion).split('.')[0]);
    return ELECTRON_ABI_FALLBACK[major] ?? null;
  }
```

With `expectedAbi === null`, the ABI half of the gate is silently dead:

verify-packed-native.js:247:

```js
const abiMatch = expectedAbi != null && abi === expectedAbi;
```

`abiMatch` is always `false` when `expectedAbi` is `null` — the ABI comparison can never pass, and crucially nothing fails because of it:

verify-packed-native.js:249:

```js
    if (hashMatch || abiMatch) {
```

A hash match alone prints OK and moves on (verify-packed-native.js:251-253, `'[verify] OK ... matches rebuilt binary'`). The script exits 0 without ever asserting the packed binary's ABI. **So yes: a missing fallback entry makes the verification script silently skip the ABI check instead of failing.**

The residual hash check is weaker than it looks: `rebuild-native.js` swallows every failure during postinstall (rebuild-native.js:190-198, `process.exit(0)` inside the `IS_POSTINSTALL` branch), so the root `node_modules` binary can be the Node-ABI prebuilt — electron-builder packs from that same tree, hash matches root, and the gate ships a wrong-ABI installer with a green log.

In `rebuild-native.js` itself the same `?? null` exists (line 101). There the effect is milder but real: the skip optimization at line 157 (`if (expectedAbi && presentAbi === expectedAbi)`) never fires (safe — it always rebuilds), but the post-rebuild ABI assertion at line 174 (`if (expectedAbi && afterAbi !== null && afterAbi !== expectedAbi)`) is silently skipped, so a wrong-ABI compile would go unchallenged.

Primary path note: when `node-abi` imports successfully (normal case), the maps are not consulted. The hazard fires only when the import fails — exactly the degraded mode the fallback exists for, which is when the guard is most needed.

## A5. better-sqlite3 compatibility with ABI 149

- `npm view better-sqlite3 versions` → latest is **13.0.3** (`dist-tags.latest: '13.0.3'`).
- The repo pins `^13.0.3` (package.json line 141) and 13.0.3 is installed. **Already the newest version — no newer better-sqlite3 is required.**
- `npm view better-sqlite3@13.0.3 engines` → `{ node: '>=22' }`. Electron 44 embeds Node v24.18.1, so the headers satisfy this.
- The repo does not rely on prebuilts for Electron: `rebuild-native.js` compiles from source via `@electron/rebuild --build-from-source` (installed @electron/rebuild 4.2.0), because better-sqlite3 publishes no prebuilt for Electron 38+ ABIs. ABI 149 keeps that same path; nothing changes except the target.
- `npm view better-sqlite3@13.0.3` publishes no electron-v149 prebuilt (prebuilts stop around electron-v136, per the script's own header, rebuild-native.js:11-14). Source compile remains the designed path — not a blocker.

## A6. Electron 44 engines vs the repo's Node 24

`npm view electron@44.4.3 engines` → `{ node: '>= 22.12.0' }`.

`.nvmrc` contains `24`. Node 24 >= 22.12, so the install requirement is satisfied. Electron 44 embeds Node v24.18.1, which matches the repo's Node 24 toolchain and `@types/node ^24.9.0`.

## Verdict

VERDICT: NEEDS CODE CHANGE

The migration is technically safe (ABI 149 confirmed, better-sqlite3 13.0.3 needs no bump, Node 24 satisfies engines), but three files pin the old world and one is the silent-failure hazard above:

1. `D:\projects\ptah-extension\apps\ptah-electron\electron-builder.yml` line 4
   - Current: `electronVersion: 40.8.5`
   - Replacement: `electronVersion: 44.4.3`
2. `D:\projects\ptah-extension\apps\ptah-electron\scripts\rebuild-native.js` line 54
   - Current:
     ```js
       43: 148,
     };
     ```
   - Replacement:
     ```js
       43: 148,
       44: 149,
     };
     ```
   (Insert `44: 149,` as the last map entry, lines 54-55.)
3. `D:\projects\ptah-extension\apps\ptah-electron\scripts\verify-packed-native.js` line 63
   - Current:
     ```js
       43: 148,
     };
     ```
   - Replacement:
     ```js
       43: 148,
       44: 149,
     };
     ```
   (Insert `44: 149,` as the last map entry, lines 63-64.)
4. `D:\projects\ptah-extension\package.json` line 255
   - Current: `"electron": "^40.9.3",`
   - Replacement: `"electron": "^44.4.3",`
     (Required for the migration itself: this drives the installed dev/serve runtime; the builder pin in edit 1 alone does not change it.)
5. Optional (comment only, no behavior): `D:\projects\ptah-extension\apps\ptah-electron\scripts\rebuild-native.js` lines 12-14 still say "This app targets Electron 40 (ABI 143)" and "NODE_MODULE_VERSION 143" — update to 44 / 149 when editing the file so the comment does not mislead.

After the bump, run `nx rebuild-native ptah-electron` (per the app's deployment notes) and then `nx package ptah-electron` so the verify gate runs against the new binary.

---

# Part B: Vulnerability triage

`npm audit --json` at the repo root reports **56 findings** (the task brief said ~88; the measured count is 56): **1 critical, 29 high, 25 moderate, 1 low**. `npm audit fix` (non-breaking) resolves only 9 of them; the rest need a semver-major bump or have no fix at all.

"Shipped" below = packaged into the Electron installer or the VS Code VSIX. A devDependency vulnerability never ships to users and is lower priority — each such row says so explicitly.

## CRITICAL (1)

| Package | Installed | Advisory                                                                                                            | Dep path                                                                   | `npm audit fix`?                                           | Ships to users?                                                                                                                |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| astro   | 6.4.8     | GHSA-26w7-cxv4-gfx2 — RCE through AVIF image optimization (plus 4 lower-severity astro advisories: XSS/auth-bypass) | `dependencies` (root) — but used only by `apps/ptah-docs` (docs.ptah.live) | NO — fix is astro@7.3.3, semver-major (repo is on Astro 6) | NO. Deployed docs site, not the extension/installers. Production-facing web server — the highest-priority non-shipped finding. |

Reachability: the RCE fires through Astro's image-optimization endpoint with a crafted AVIF input. Whether `apps/ptah-docs` serves optimized images was not verified here (say so when scoping the fix). Treat as actionable on the deployed site.

## HIGH — production paths (shipped in the Electron app, or the deployed license server)

| Package                   | Installed           | Advisory (worst)                                                                                                              | Dep path                                                            | `npm audit fix`?                              | Ships to users?                                                                                                                                                                                    |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| electron                  | 40.10.6             | GHSA-9f4c-93c8-jc8g — sandboxed iframe bypasses `allow-popups`                                                                | `devDependencies` at root, but IS the shipped app runtime           | NO — fix is 44.4.3, semver-major              | YES (the runtime itself). Resolved by Part A's upgrade.                                                                                                                                            |
| @huggingface/transformers | 3.8.1               | via onnxruntime-node + sharp (no advisory on the package itself)                                                              | `dependencies` (memory embedder, voice ASR)                         | NO (`fixAvailable: false`)                    | YES — asarUnpack'd in the Electron app.                                                                                                                                                            |
| sharp                     | 0.34.5              | GHSA-f88m-g3jw-g9cj / GHSA-rgj7-g3m4-5g8c — libvips and libheif image-decoder CVEs                                            | transitive of @huggingface/transformers (also pulled by astro, dev) | NO (`fixAvailable: false`)                    | YES — packed in the Electron app via transformers. Decodes images at runtime.                                                                                                                      |
| onnxruntime-node          | 1.24.3 (overridden) | via adm-zip — crafted ZIP triggers 4 GB allocation                                                                            | transitive of @huggingface/transformers                             | NO (`fixAvailable: false`)                    | YES — asarUnpack'd. Mitigating: the bundled adm-zip runs during package install/extraction, not on app input.                                                                                      |
| kokoro-js                 | 1.2.1               | via @huggingface/transformers                                                                                                 | `dependencies` (voice)                                              | NO (`fixAvailable: false`)                    | YES — Electron voice stack.                                                                                                                                                                        |
| undici                    | 5.29.0              | 3 HIGH WebSocket DoS advisories (GHSA-vrm6-8vpv-qv8q, GHSA-v9p9-hfj2-hcw8, GHSA-vxpw-j846-p89q) + 8 moderate                  | transitive: @cursor/sdk → @connectrpc/connect-node → undici         | NO (`fixAvailable: false`)                    | YES — @cursor/sdk is the shipped cursor adapter (`libs/backend/cli-agent-runtime`). Other undici copies (6.28.1 discord.js, 7.29.1 @slack/bolt, 8.10.2 astro/jsdom) are outside the flagged range. |
| @nestjs/core              | 11.x                | via @nestjs/platform-express → multer — 3 HIGH DoS advisories (GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4) | `dependencies` — license server only                                | NO — fix is @nestjs/core@12.0.3, semver-major | NO — deployed server, not shipped. Production server code, so highest priority of the non-shipped group.                                                                                           |
| @nestjs/platform-express  | 12.0.1 range        | same multer chain                                                                                                             | `dependencies` — license server                                     | NO — @12.0.3 major                            | NO — deployed server.                                                                                                                                                                              |
| @nestjs/event-emitter     | 3.x                 | via @nestjs/core                                                                                                              | `dependencies` — license server                                     | NO — @12.0.1 major                            | NO — deployed server.                                                                                                                                                                              |
| @nestjs/schedule          | 6.x                 | via @nestjs/core                                                                                                              | `dependencies` — license server                                     | NO — @12.0.2 major                            | NO — deployed server.                                                                                                                                                                              |
| @sentry/nestjs            | <=11 range          | via @nestjs/core + @sentry/node                                                                                               | `dependencies` — license server                                     | NO — @10.75.0 major                           | NO — deployed server.                                                                                                                                                                              |

## HIGH — dev-only (never ships to users; lower priority)

| Package                                                                                                                                               | Path                                                                                         | Advisory                                                                                                            | Fix without breaking?                                                                                         | Notes                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| nx + @nx/* (11 findings: @nx/angular, @nx/esbuild, @nx/eslint, @nx/eslint-plugin, @nx/jest, @nx/js, @nx/node, @nx/web, @nx/workspace, nx) + smol-toml | devDependencies / transitive                                                                 | smol-toml GHSA-7w5x-hrqm-74c2 DoS via malformed TOML (nx ships smol-toml 1.6.1; vulnerable <=1.7.0)                 | NO — npm's only fix is a downgrade to 22.6.4; the repo just migrated to Nx 23.2.1. No forward fix exists yet. | Build tooling reading TOML files from the workspace itself. Not attacker-reachable in CI without a hostile commit. Low practical risk. |
| prisma + @prisma/config + deepmerge-ts + mysql2                                                                                                       | devDependencies / transitive (prisma CLI only — the generated runtime client is not flagged) | deepmerge-ts GHSA-ggr8-5vv4-36mx stack exhaustion; mysql2 GHSA-3f6p-5ww8-9rcr auth-plugin downgrade + zlib-bomb DoS | NO — npm's suggested fix is prisma@6.19.3, a downgrade from the repo's Prisma 7.10. Do not apply.             | Dev-time DB tooling. mysql2 only engages when the CLI talks to MySQL; the repo's database is PostgreSQL. Low practical risk.           |
| adm-zip                                                                                                                                               | devDependencies (direct, ^0.6.1) + 0.5.18 inside onnxruntime-node                            | GHSA-xcpc-8h2w-3j85 / GHSA-7q85-xj36-vmfc crafted-ZIP memory DoS                                                    | NO (`fixAvailable: false`)                                                                                    | Direct use is confined to `tools/video-editor/vendor/**` (tooling). The onnxruntime copy is install-time only. Lower priority.         |
| @nestjs/testing                                                                                                                                       | devDependencies                                                                              | via @nestjs/core chain                                                                                              | NO — @12.0.3 major                                                                                            | Test tooling.                                                                                                                          |

## MODERATE (25) — grouped

**Fixable by `npm audit fix` without a breaking change (9 findings total across moderate+low):**

- sanitize-html 2.17.5 → 2.17.7 (in-range; GHSA-jxwj-j7wr-gfrw, GHSA-g8qq-57p8-ggw5 mutation/stored XSS). `dependencies`, used by `libs/api/marketing` email template rendering — license server, deployed, not shipped. **The one clean `npm audit fix` win.**
- @opentelemetry/instrumentation-connect, -express, -hapi, -koa, -mongoose, -mysql2, @opentelemetry/resources, @opentelemetry/sdk-trace-base — in-range bumps, license-server observability chain, not shipped.

**Not fixable without a major bump (16 findings):**

- @sentry/node + @opentelemetry/core and the instrumentation/fs/http/pg/undici/sql-common entries — fix is @sentry/node@10.75.0, semver-major. License server, deployed.
- @astrojs/starlight 0.38.5 (+ @astrojs/mdx, astro-expressive-code) — fix is starlight@0.42.2, semver-major. Docs site, deployed. Rides with the astro 7.x major from the critical finding.
- @connectrpc/connect-node (via @cursor/sdk) — no independent fix; blocked on the same upstream as undici above. Ships in the Electron app / cursor adapter.
- @nx-tools/nx-prisma + @nx-tools/core + csv-parse — devDependency, Prisma tooling plugin, dev-only, fix is a major downgrade.

## LOW (1)

- esbuild 0.27.7 (one nested copy; the root 0.28.2 is clean) — GHSA-g7r4-m6w7-qqqr, arbitrary file read when the dev server runs on Windows. devDependency path, dev server only, does not ship. Rides with the astro 7.x upgrade.

## Summary counts

- 56 total: 1 critical, 29 high, 25 moderate, 1 low (measured; brief said ~88).
- Ships to users (Electron/VSIX): 7 findings (electron, transformers, sharp, onnxruntime-node, kokoro-js, undici, @connectrpc/connect-node) — all but electron have **no fix available**; electron's fix is Part A itself.
- Deployed server (license server): ~26 findings (NestJS/multer/sentry/opentelemetry/sanitize-html) — sanitize-html is the only non-breaking fix.
- Deployed docs site: astro critical + 4 more astro-chain findings — needs the astro 7 major.
- Dev-only, never shipped: ~19 findings (@nx/*, smol-toml, prisma chain, @nestjs/testing, adm-zip, @nx-tools, csv-parse, esbuild-low). Lower priority. Say so explicitly: none of these reaches a user machine.
- `npm audit fix` (no breaking change) resolves: 9 findings (sanitize-html + 8 opentelemetry entries).
