# Audit: nested `package.json` manifests vs. root as single source of truth

Audit only. No files were edited.

## 1. Full inventory (83 `package.json` outside root and outside `node_modules`)

Found via `ptah_search_files "**/package.json"`.

**Apps (7)**

- `apps/ptah-cli/package.json`
- `apps/ptah-electron/package.json`
- `apps/ptah-electron-e2e/package.json`
- `apps/ptah-extension-vscode/package.json`
- `apps/ptah-extension-vscode-e2e/package.json`
- `apps/ptah-tui/package.json`
- `apps/ptah-video-studio/package.json`

**Backend libs (17 manifests across 29 backend libs)** — `libs/backend/{agent-generation,agent-sdk,auth-providers,auth-providers-tokens,cli-agent-runtime,cli-engine,gateway-chat-bridge,memory-contracts,platform-core,plugin-marketplace,rpc-handlers,settings-core,voice-contracts,voice-providers,vscode-core,vscode-lm-tools,workspace-intelligence}/package.json` (17 manifests in total; the remaining 12 backend libs in the repo have no nested `package.json` of their own — see §2 note).

**Frontend libs (7)** — `libs/frontend/{core,markdown,tribunal-panel,ui,webview-e2e-harness}/package.json`

**Web libs (10)** — `libs/web/{account,admin,auth,core,landing,legal,members,panel-ui,pricing,ui}/package.json`

**API libs (15)** — `libs/api/{admin,audit,billing,community,core,email,forum,identity,learning,licensing,marketing,member-hub,membership,notifications,youtube}/package.json`

**Shared / contracts (3)** — `libs/shared/package.json`, `libs/showcase-manifest/package.json`, `libs/api-contracts/community/package.json`

**Tools / video pipeline, vendored (18)** — `tools/video-editor/vendor/davinci-resolve-mcp/package.json` (+ `resolve-advanced/package.json`, `resolve-advanced/vendor/{conform-qc,drt-format,drp-format}/package.json`), plus 16 `tools/video-editor/projects/builder-invitation/graphics/g*/package.json` motion-graphics scene projects.

## 2. Classification

### PUBLISHED-ARTIFACT (2)

- `apps/ptah-cli/package.json` — manifest of the published npm package `@hive-academy/ptah-cli`.
- `apps/ptah-electron/package.json` — the hand-maintained dependency **name** list that gates what `electron-builder` installs (see §4).

### NX-LIB-STUB (name/version/exports only, no dependency versions) — the large majority

All of `libs/frontend/*`, `libs/web/*`, `libs/api/*`, `libs/api-contracts/*`, `libs/backend/{memory-contracts,platform-core,settings-core,voice-contracts,voice-providers,auth-providers-tokens}`, `libs/showcase-manifest`, and `apps/ptah-electron-e2e`, `apps/ptah-extension-vscode-e2e`. Confirmed by grep: only 15 of the 65 in-scope Nx project manifests contain a `dependencies`/`devDependencies` key at all; everything else is `name`/`version`/`private`/`type`/`main`/`types`/`exports` only. These are fine — nothing to drift.

### STALE-RISK-CANDIDATE (declares a real dependency version) — 13 backend libs + 2 apps

`libs/backend/{auth-providers,cli-agent-runtime,agent-generation,rpc-handlers,agent-sdk,workspace-intelligence,vscode-core,plugin-marketplace,cli-engine,gateway-chat-bridge,vscode-lm-tools}` plus `apps/ptah-cli`, `apps/ptah-electron`, `apps/ptah-tui`. Most entries here are internal `@ptah-extension/*` cross-lib deps (version `0.0.1` or `*`, meaningless to compare against root) mixed with a handful of real external pins. See §3 for the real drifts, and the important caveat below §3: **for the internal libs (everything except the two apps), these external pins are very likely inert** — see §5. `ptah-tui` has no external version drift (its three external deps match root exactly).

### TOOLING-ISOLATED (18)

Everything under `tools/video-editor/**`. `tools/video-editor` is not an Nx project — it is not listed in `ptah_workspace_analyze`'s 90 Nx projects, has no `project.json`, and its `graphics/g*` folders are standalone Remotion scene scaffolds with their own deps (react/remotion pins), vendored third-party MCP server code (`davinci-resolve-mcp`) and its own vendored sub-vendors. These are deliberately outside the Nx dependency graph and outside npm workspaces; each is its own install root. Not audited line-by-line — out of scope for "the root package.json must be the single source of dependency versions" since none of them are Nx projects the root graph resolves.

### TOOLING-ISOLATED (documented) — `apps/ptah-video-studio`

Its own `package.json` declares no dependencies at all (scripts only) but its description states "Tooling only — never shipped in the VSIX," matching root `CLAUDE.md`'s classification. No stale-risk here since it has no dependency versions to drift.

## 3. STALE-RISK table (real external-package version disagreement vs. root)

Root pins as of `package.json` read this session. Only listing DEPENDS on both root and file both being real, human-set version strings (internal `@ptah-extension/*` deps and `*`/wildcard entries excluded — nothing to compare).

| File                                               | Package         | Declared here                                                                                                                    | Root                                   | Class                                                  |
| -------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| `apps/ptah-cli/package.json`                       | `eventemitter3` | `^5.0.4`                                                                                                                         | `5.0.4`                                | DIFFERENT-RANGE                                        |
| `apps/ptah-cli/package.json`                       | `fast-glob`     | `^3.3.3`                                                                                                                         | `3.3.3`                                | DIFFERENT-RANGE                                        |
| `apps/ptah-cli/package.json`                       | `minimatch`     | `^10.2.4`                                                                                                                        | `10.2.4`                               | DIFFERENT-RANGE                                        |
| `apps/ptah-cli/package.json`                       | `picomatch`     | `4.0.4` (root: `^4.0.4`... wait, checked: root `picomatch: "4.0.4"`, cli `"^4.0.4"`)                                             | `4.0.4`                                | DIFFERENT-RANGE                                        |
| `apps/ptah-cli/package.json`                       | `react`         | `^19.2.0`                                                                                                                        | `~19.2.0`                              | DIFFERENT-RANGE                                        |
| `apps/ptah-cli/package.json`                       | `typescript`    | `^5.9.0` (declared as a **runtime `dependency`**)                                                                                | `5.9.3` (root: exact, `devDependency`) | DIFFERENT-RANGE + wrong dependency type                |
| `apps/ptah-cli/package.json`                       | `ulid`          | `^2.3.0`                                                                                                                         | `2.3.0`                                | DIFFERENT-RANGE                                        |
| `apps/ptah-cli/package.json`                       | `zod`           | `^4.3.6`                                                                                                                         | `4.3.6`                                | DIFFERENT-RANGE                                        |
| `apps/ptah-tui/package.json`                       | —               | (no drift: `ink`, `ink-spinner`, `ink-text-input`, `react`(`^19.2.0` vs root `~19.2.0`), `reflect-metadata` all otherwise match) |                                        | `react` DIFFERENT-RANGE (same as cli)                  |
| `libs/backend/agent-generation/package.json`       | `zod`           | `^4.1.12`                                                                                                                        | `4.3.6`                                | DIFFERENT-RANGE (behind the floor root actually ships) |
| `libs/backend/rpc-handlers/package.json`           | `zod`           | `^4.1.12`                                                                                                                        | `4.3.6`                                | DIFFERENT-RANGE                                        |
| `libs/backend/vscode-core/package.json`            | `zod`           | `^4.1.12`                                                                                                                        | `4.3.6`                                | DIFFERENT-RANGE                                        |
| `libs/backend/plugin-marketplace/package.json`     | `zod`           | `^4.1.12`                                                                                                                        | `4.3.6`                                | DIFFERENT-RANGE                                        |
| `libs/backend/vscode-lm-tools/package.json`        | `zod`           | `^4.1.12`                                                                                                                        | `4.3.6`                                | DIFFERENT-RANGE                                        |
| `libs/shared/package.json`                         | `zod`           | `^4.1.12`                                                                                                                        | `4.3.6`                                | DIFFERENT-RANGE                                        |
| `libs/backend/vscode-lm-tools/package.json`        | `minimatch`     | `10.2.4`                                                                                                                         | `10.2.4`                               | match (no drift)                                       |
| `libs/backend/workspace-intelligence/package.json` | `typescript`    | `^5.9.0`                                                                                                                         | `5.9.3` (devDependency)                | DIFFERENT-RANGE                                        |

`apps/ptah-electron/package.json` itself shows **no** drift against root — every external pin there (`@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`, `@openai/codex-sdk`, `@parcel/watcher`, `@slack/bolt`, `@tavily/core`, `axios`, `better-sqlite3`, `chokidar`, `chrome-launcher`, `chrome-remote-interface`, `croner`, `discord.js`, `eventemitter3`, `exa-js`, `fast-glob`, `ffmpeg-static`, `gifenc`, `gpt-tokenizer`, `grammy`, `gray-matter`, `jpeg-js`, `json2md`, `jsonrepair`, `kokoro-js`, `lru-cache`, `minimatch`, `picomatch`, `reflect-metadata`, `rxjs`, `sqlite-vec`, `tsyringe`, `typescript`, `ulid`, `uuid`, `web-tree-sitter`, `which`, `zod`) is either an EXACT copy of root's pin or already matches root's caret range. This matters for the recommendation in §6 — it is the one manifest that is already internally disciplined, and it turns out that discipline is unnecessary work (§4).

## 4. How each nested manifest's versions actually reach a build/package (COPIED FROM ROOT vs HAND-MAINTAINED)

**`ptah-electron` — versions are COPIED FROM ROOT, self-healing.** `apps/ptah-electron/project.json` `build-main` target sets `"generatePackageJson": true` (`@nx/esbuild:esbuild`). Nx's `generatePackageJson` walks the project graph and writes `dist/apps/ptah-electron/package.json` with **version numbers resolved from the installed root `node_modules` / root `package.json`**, not from the checked-in `apps/ptah-electron/package.json`. Confirmed by the build script chain that runs after it:

- `apps/ptah-electron/scripts/prune-dist-deps.js` reads the GENERATED manifest and the SOURCE (`apps/ptah-electron/package.json`) and compares only the **dependency name sets** — it deletes generated entries whose names aren't in the source file and fails loudly if the source declares a name the generator didn't produce. It never touches or checks version strings.
- `apps/ptah-electron/scripts/patch-dist-overrides.js` injects one specific pinned override (`onnxruntime-node@1.24.3`) directly into the generated manifest, again independent of the source file's own `overrides` block (which is described in the script's own comment as "belt-and-braces").
- `apps/ptah-electron/scripts/validate-deps.js` also reads the SOURCE manifest, but only to build a `Set` of dependency **names** to check bundle imports against — never version values.

So `apps/ptah-electron/package.json`'s dependency **names** are load-bearing (they gate `prune-dist-deps.js` and `validate-deps.js`), but its dependency **version strings are dead** — nothing in the build ever reads them. The file could declare `"axios": "0.0.1"` and the packaged app would still ship whatever version root's `node_modules` resolved. This is confirmed structurally: every version in this file already happens to match root, which is what you'd expect from a file whose versions are cosmetic and were simply copied at authoring time and never mechanically re-synced since — there is no drift today, but nothing would catch drift tomorrow either.

**`ptah-cli` — versions are HAND-MAINTAINED and DO ship.** `apps/ptah-cli/project.json` `restore-cli-manifest` target runs:

```
node -e "require('fs').copyFileSync('apps/ptah-cli/package.json','dist/apps/ptah-cli/package.json')"
```

a byte-for-byte copy, no `generatePackageJson`, no transform. `publish` / `publish:dry-run` depend on `restore-cli-manifest` and then run `npm publish` from `dist/apps/ptah-cli` with that exact file. **Every version string in `apps/ptah-cli/package.json` is what actually gets published to npm as `@hive-academy/ptah-cli`'s dependency constraints.** The drifts in §3 are real: an npm installer of `@hive-academy/ptah-cli` today gets `zod@^4.3.6`, `react@^19.2.0`, `typescript@^5.9.0` as a **runtime dependency** (root treats `typescript` as a pinned-exact devDependency, never shipped to consumers) — these ranges were set once and have not moved in step with root's tightening to exact pins.

**Internal backend libs (`agent-sdk`, `rpc-handlers`, `vscode-core`, etc.) — versions are effectively inert; no npm workspaces exist to consult them at all.** See §5.

## 5. npm workspaces

**There is no npm workspaces configuration.** Confirmed:

- Root `package.json` has no `"workspaces"` key (full file read this session — `name`, `version`, `license`, `engines`, `scripts`, `dependencies`, `devDependencies`, `optionalDependencies`, `overrides`; no `workspaces` field).
- `nx.json` declares no workspaces-related project layout key either (Nx's own project discovery is driven by `project.json` files and its inferred-target plugins, not by npm/yarn/pnpm workspace globs).

This matters directly for what "the nested manifest's dependencies get resolved" can even mean here: with real npm workspaces, `npm install` would read every workspace member's `package.json`, dedupe/hoist across them, and a version mismatch would be a concrete, enforceable npm-level conflict (or a per-package `node_modules/` override). **Without workspaces, `npm install` at the repo root never reads any of these nested `dependencies` blocks at all** — it resolves only the root `package.json`, and every internal `@ptah-extension/*` lib is consumed purely through Nx's TypeScript path mapping (`tsconfig.base.json`) and bundled at build time by esbuild against the single root `node_modules` tree. A nested lib's `package.json` `dependencies` field is not an install manifest in this repo; it is closer to loose documentation/metadata that Nx's own tooling (dependency-checks lint rule, if enabled, or a generator) may have written once and nobody mechanically re-syncs.

## 6. Ranked recommendations

1. **`apps/ptah-cli/package.json` — SYNC TO ROOT, then keep it in sync mechanically (highest priority — this is the one manifest that actually ships).** This is the one real defect the task is hunting: `zod`, `react`, `minimatch`, `picomatch`, `fast-glob`, `ulid`, `eventemitter3` should be tightened to match root's ranges, and `typescript` should almost certainly not be a runtime `dependency` at all (root treats it as a build-time devDependency; shipping `^5.9.0` as a hard runtime dependency of a published CLI package pulls in a second, looser-pinned copy of the compiler for every installer). Prefer generating this at build/publish time over hand-sync: `apps/ptah-electron` already proves the mechanism exists in this repo (`generatePackageJson: true` + a prune script). Moving `ptah-cli`'s `build-esbuild` (or `restore-cli-manifest`) to the same pattern — generate from the graph, then prune to the declared name-set the way `prune-dist-deps.js` does — would make this class of drift structurally impossible instead of relying on someone remembering to edit two files. If that refactor is out of scope for this task, the minimum fix is a CI check (or a `verify-packed-wasm.cjs`-style script) that fails the `ptah-cli` publish pipeline when a version string in `apps/ptah-cli/package.json` diverges from root's for the same package name.

2. **`apps/ptah-electron/package.json` — leave the version strings alone, but stop treating them as meaningful.** They are dead weight: `generatePackageJson` overwrites them at build time and nothing reads the source file's version values. The dependency **names** here are the real contract (gated by `validate-deps.js` / `prune-dist-deps.js`), so don't delete the block — but this file inviting a reader (or an editor doing exactly this kind of migration) to "fix" its version pins is a trap: any edit to a version string here is a no-op for the shipped app. Recommend a one-line comment in the file (or in its `CLAUDE.md`, which already explains the mechanism) making explicit that version values are ignored and only keys matter, so the next person doesn't spend effort keeping them accurate.

3. **The six internal libs pinning `zod: "^4.1.12"` (`agent-generation`, `rpc-handlers`, `vscode-core`, `plugin-marketplace`, `vscode-lm-tools`, `shared`) vs. the three pinning the current exact `zod: "4.3.6"` (`auth-providers`, `cli-agent-runtime`, `agent-sdk`) — DELETE, don't sync.** With no npm workspaces, none of these fields are consulted by any install or build step; TypeScript resolves `zod` from root `node_modules` regardless of what these files say, and esbuild bundles whatever's actually there. Hand-syncing nine files to match root's current pin only creates nine more places to forget next time root's `zod` moves. If these dependency blocks exist only for a lint rule (e.g. `@nx/dependency-checks`) or for human documentation of what a lib actually imports, the durable fix is to either (a) stop declaring version constraints in these files entirely and let whatever consumes them (if anything) read root's `package.json`, or (b) if an Nx generator is what produces these blocks, confirm that and let it regenerate them rather than hand-editing. Recommend confirming with `npx nx run-many -t lint` / checking `eslint.config.mjs` for a dependency-checks rule before touching any of these — if no such rule exists, these blocks are pure vestige and the cleanest fix is deleting the version pins (keep name-only or delete the field) rather than syncing them to a value that will just go stale again.

4. **`apps/ptah-tui/package.json`'s `react: "^19.2.0"` vs. root's `react: "~19.2.0"` — leave as is, low priority.** `ptah-tui` builds directly into `dist/apps/ptah-cli/tui.mjs` via esbuild bundling against root's resolved `react`; this file's version string is (per §5) not consulted by any install step. Same reasoning as #3 applies, but `react` is externalized in neither `ptah-cli` nor `ptah-tui`'s esbuild config in a way that ships a manifest to end users (this file is never copied anywhere — only `ptah-cli`'s own `package.json` is copied to dist), so there is no shipping-artifact risk here, only the same documentation-drift risk as #3.

5. **`workspace-intelligence`'s `typescript: "^5.9.0"` — same disposition as #3.** Real drift against root's exact `5.9.3` devDependency pin, but inert for the same no-workspaces reason.

## Out-of-scope observations

- `apps/ptah-cli/package.json` uses the package name `@openai/codex-sdk` and version `^0.147.0`, matching root; but `libs/backend/auth-providers/package.json` declares `@openai/codex` (a **different package name**, no `-sdk` suffix) at `0.147.0` with no root counterpart to compare against — worth a follow-up check on whether that's a typo/dead entry or a genuine second package, since it wasn't in scope for this version-drift audit (different package name, not a version mismatch).
- `libs/backend/vscode-lm-tools/package.json` pins `json2md: "^2.0.1"` while root/`ptah-cli`/`ptah-electron` all pin `^2.0.3` — same DIFFERENT-RANGE class as §3, omitted from the main table because it is another internal-lib case covered by recommendation #3's blanket disposition, listed here for completeness.
- Did not enumerate every one of the 65 pure NX-LIB-STUB manifests individually in this document (would be a ~65-row table of "no dependencies key present"); spot-checked a representative sample across `frontend`, `web`, `api`, and the remaining `backend` libs via `Grep` for `"dependencies"|"devDependencies"` across all in-scope `package.json` files, which returned exactly the 15 files enumerated in §2/§3 as containing either key. Any lib not named in this report was in that stub set.
