# Implementation Plan - microsoft-store (Microsoft Store / MSIX channel, step A)

## Inputs and constraints

- Requirements used: `.ptah/specs/microsoft-store/context.md` (user decisions, repo map),
  `.ptah/specs/microsoft-store/research-report.md` (Store/appx/msstore research), coordinator
  update of 2026-10-19 (reserved Store identity values; see below).
- Corrections applied: coordinator update overrides the research suggestion of putting identity
  in CI secrets. Identity values are public manifest data and are committed in
  `electron-builder.yml`. Only the Entra client secret is a GitHub secret; tenant ID, client ID,
  seller ID and product ID are repository variables.
- Design handoff used: none (one small UI control, follows the existing turn-action row).
- Missing decision-critical input: no `task-description.md`. Acceptance criteria are taken from
  the coordinator brief (scope items 1-9). No decision is blocked by its absence.

Reserved identity (Partner Center > Product identity, supplied by the coordinator):

| Field | Value | Where it goes |
| --- | --- | --- |
| Store ID / product ID | `9N80K3HFX0JT` | repo variable `MSSTORE_PRODUCT_ID` |
| Package/Identity/Name | `PtahOrchestra.Ptah` | `appx.identityName` (committed) |
| Package/Identity/Publisher | `CN=4E52CB56-1E00-4214-9A22-F65A54BFF522` | `appx.publisher` (committed) |
| PublisherDisplayName | `Ptah Orchestra` | `appx.publisherDisplayName` (committed) |
| Package family name | `PtahOrchestra.Ptah_rwqmhy9dq1amj` | not configured; used in the smoke checklist (virtualized AppData path) |

Rules every executor and lane must follow (from CLAUDE.md; repeat in each handoff):
verify only changed projects (`npx nx test|typecheck|lint <project> --parallel=1`, Jest
`--maxWorkers=2`); never run build/serve/dev/e2e/package targets; one heavy check at a time;
Electron first; keep every host compiling; tsyringe DI and phased composition roots; no `any`;
import libs only via their public index; work only in
`D:/projects/ptah-extension/.claude-worktrees/microsoft-store`.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `buildResources: assets`, output `../../release` | `apps/ptah-electron/electron-builder.yml:6-8` | Store tiles go to `<project>/assets/appx/` |
| `src/assets/**` is copied to `dist/apps/ptah-electron/assets` | `apps/ptah-electron/project.json:92-97` | Commit tiles under `apps/ptah-electron/src/assets/appx/`; no new copy step |
| `win.target: [nsis]`; no `appx:` block | `electron-builder.yml:118-120` | Keep NSIS default; select appx with `--win appx` per invocation |
| appx options = `deepAssign(win options, config.appx)`; asset dir name `appx` via `getResource` | `node_modules/app-builder-lib/out/targets/AppxTarget.js:13,50,83` | Same resolution as above; missing tiles silently fall back to sample art |
| appx artifact name is expandable per target | `AppxTarget.js:60` | Set `appx.artifactName` without spaces |
| appx walks `appOutDir` file list | `AppxTarget.js:57,76` | Works on any prepared dir |
| With `--prepackaged`, `doPack` returns early; targets build from the prepackaged dir | `node_modules/app-builder-lib/out/platformPackager.js:147-150`, `:95` | `--win appx --prepackaged win-unpacked` is plausible by source; still unrun (Assumption A1) |
| Manifest version = `appInfo.getVersionInWeirdWindowsForm()` from metadata version | `AppxTarget.js:192`, `node_modules/app-builder-lib/out/appInfo.js:29,66-78` | Store version is `<package.json version>.0`; major must be >= 1 |
| `extraMetadata` is merged into metadata, but with `--prepackaged` the asar is not rebuilt | `node_modules/app-builder-lib/out/packager.js:284`, `platformPackager.js:149` | A Store-only `extraMetadata.version` would make manifest version differ from `app.getVersion()` -> rejected (Decision D3) |
| unsigned build uses configured `publisher`; `runFullTrust` always added; `publisherDisplayName` falls back to author | research-report.md Evidence row "Installed electron-builder appx target" (AppxTarget.js:182-187, windowsSignToolManager.js:102-106) | Do not configure signing for appx; do not list capabilities |
| version source `apps/ptah-electron/package.json` = `0.1.70` | `apps/ptah-electron/package.json:3` | Must move to >= 1 |
| prepare bumps from committed version; choices patch/minor/major | `.github/workflows/publish-electron.yml:53-61,126-158` | Add `none` choice + monotonic/Store guard |
| bump PR commits package.json unconditionally | `publish-electron.yml:701-736` | `none` needs a "no change -> skip commit/PR" branch |
| release mode resolution; dry-run never signs | `publish-electron.yml:95-114, 498, 657` | Store submission gated on `release_mode == 'publish'` exactly like eSigner |
| Windows phase 1 `--win --dir`, phase 3 NSIS `--prepackaged` absolute path | `publish-electron.yml:380-385, 628-634` | Appx reuses the same prepackaged dir after phase 3 |
| Upload artifact `electron-${{ matrix.os }}` = `dist/release/` minus unpacked dirs | `publish-electron.yml:670-680` | Exclude appx from it; upload appx as its own artifact |
| GitHub Release file globs (`Ptah*.exe`, dmg, zip, AppImage, deb, latest*.yml) | `publish-electron.yml:757-770` | appx never reaches the GitHub Release |
| local `package` target runs `patch-transformers-onnx-dep.js` before and `verify-packed-onnx.js` after electron-builder; CI does not | `apps/ptah-electron/project.json:374-388`; workflow has no such step (grep) | Close the gap in CI for all legs (Decision D6) |
| `verify-packed-onnx.js` scans `dist/release` recursively | `apps/ptah-electron/scripts/verify-packed-onnx.js:30-35` | Runs unchanged in CI |
| `readBuildIdentity` / `isLocalProductionBuild` | `apps/ptah-electron/src/config/build-identity.ts:22-37` | Home for the channel concept |
| `process.windowsStore: boolean` (true in Store/MSIX, else undefined) | `node_modules/electron/electron.d.ts:27442-27445` | Runtime channel detection, no build metadata needed |
| `UpdateManager.start()` gates (local-production, dev, e2e); `triggerCheck()` gate | `apps/ptah-electron/src/services/update/update-manager.ts:129-160, 163-171` | Add a Store gate first in both |
| spec mocks `../../config/build-identity` with a factory | `apps/ptah-electron/src/services/update/update-manager.spec.ts:25-27, 204-227` | Factory must export the new function; copy the local-production gate tests |
| `update:check-now` has no webview caller; dialog hydrates via `update:get-state` | `libs/frontend/chat/src/lib/update-dialog/update-dialog.service.ts:62-74`; grep of `libs/frontend` | Idle state = no UI; no frontend update change |
| dialog renders only when `state === 'available'` | `libs/frontend/chat/src/lib/update-dialog/update-dialog.component.ts:47,105` | Store build shows nothing |
| update RPC is gated by `IAppUpdater` capability | `libs/backend/rpc-handlers/src/lib/handlers/update-rpc.handlers.ts:9-14, 37-56` | No RPC change |
| renderer `target=_blank`/navigation go to `openExternalSafely`; `mailto:` allowed | `apps/ptah-electron/src/windows/main-window.ts:71-84`; `apps/ptah-electron/src/windows/navigation-policy.ts:19,69` | Report control can be a plain `mailto:` anchor |
| turn action row with `ptah-copy-button` | `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:134-155` | Place the report control there |
| text extraction lives privately in CopyButtonComponent | `libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts:67-109`; exported at `libs/frontend/chat-ui/src/index.ts:15` | Extract a pure helper shared by copy + report |
| support email `support@ptah.live` | `apps/ptah-electron/package.json:6-9` | Report recipient |
| single-instance lock | `apps/ptah-electron/src/main.ts:56` | Lock lives under userData, which MSIX virtualizes (see Risks) |
| `npx skills` spawned at runtime | `libs/backend/rpc-handlers/src/lib/utils/skills-sh-cli.ts:106` | Needs Node on PATH; runtime third-party install -> policy 10.2.2/10.2.3 review (Open question Q3) |
| sharp 0.34.5 available transitively (via `@huggingface/transformers`); source icon is 512x512 RGBA | `npm ls sharp`; metadata of `apps/ptah-electron/src/assets/icons/png/1024x1024.png` (actually 512x512) | Generate tiles once with sharp; base (scale-100) names only, no upscaling, no makepri |
| commit scopes include `electron`, `ci`, `release`, `webview`, `scripts` | `.commitlintrc.json` | Scopes per batch below |

## Architecture decision

### D1. Packaging: appx target, Store-only, unsigned, built from the existing prepackaged dir

- Chosen: add an `appx:` block to `electron-builder.yml` with committed identity values. Keep
  `win.target: [nsis]`. In CI, after the NSIS phase (L628-644), run
  `npx electron-builder --config electron-builder.yml --project dist/apps/ptah-electron --publish never --win appx --prepackaged "${{ github.workspace }}/dist/release/win-unpacked"`
  with no signing env. The appx carries the same bits the NSIS installer carries (already verified
  by verify-packed-native/wasm, and, after D6, onnx).
- Rationale: one packaged tree, verified once, two distributables; identical to how NSIS is
  produced today; no second asar pack.
- Rejected: (a) own full `--win appx` invocation from `dist/apps/ptah-electron` - repacks the
  asar and native modules a second time (minutes, and a second unverified tree); kept only as
  fallback. (b) `msstore package` - unknown fit with the Nx dist layout (research Option C).
  (c) Identity via `-c.appx.*` CLI flags from variables - values are public and reserved, so a
  committed config is reproducible locally and reviewable.
- Assumption A1: `--prepackaged` + `appx` works on 26.16.1. Check: the user's local recipe step 2
  (below) or the first dry-run. Fallback F1 (documented in the workflow comment, applied only if
  A1 fails): replace `--prepackaged ...` with a plain
  `npx electron-builder --config electron-builder.yml --project dist/apps/ptah-electron --publish never --win appx`
  and re-run `verify-packed-native.js`, `verify-packed-wasm.js`, `verify-packed-onnx.js` after it.
- The inner `Ptah.exe` is eSigner-signed in publish mode (step A); the appx container is not
  signed. Microsoft signs the package after certification (research Evidence row 1). The inner
  Authenticode signature does not conflict with package identity (Assumption A2, research
  "Local consequences": inference; resolved by the first upload).

### D2. Store tiles: committed PNGs, generated once by a committed script

- Chosen: `apps/ptah-electron/scripts/generate-appx-assets.mjs` (sharp, transitive dependency)
  reads `apps/ptah-electron/src/assets/icons/icon.png` and writes
  `apps/ptah-electron/src/assets/appx/{StoreLogo 50x50, Square44x44Logo 44x44,
  Square150x150Logo 150x150, Wide310x150Logo 310x150}.png`. Square tiles: icon fit `contain`
  with ~12% transparent padding; wide tile: icon height 120 px centred on a transparent
  310x150 canvas. Run once by the executor: `node apps/ptah-electron/scripts/generate-appx-assets.mjs`;
  PNGs committed.
- Rationale: deterministic, reviewable, no CI dependency on a transitive package; the script makes
  regeneration reproducible when the icon changes.
- Rejected: CI generation (adds a step that depends on a transitive sharp on every run);
  scale-200/400 variants (source is 512 px; 400% Wide needs 1240 px -> upscaling; scale names
  trigger makepri, more moving parts). Base names are valid (research "Local consequences").
- Assumption A3: `require('sharp')` resolves from the repo root (verified now via `npm ls`); if a
  future lockfile drops it, the script fails loudly - PNGs already committed are unaffected.

### D3. Version: bump the app to 2.0.0 for all platforms

- Chosen: set `apps/ptah-electron/package.json` `version` to `2.0.0` in this PR, add a
  `none` choice to the `bump` input ("release the committed version"), and make prepare enforce
  (all modes): version is `X.Y.Z` integers, `X >= 1`, every segment `<= 65535`, and strictly
  greater than the highest existing `electron-v*` tag. The first v2 release is a dispatch with
  `bump: none` -> tag `electron-v2.0.0`, Store package `2.0.0.0`. Later releases use
  patch/minor as today. The bump-PR step skips commit/push/PR when package.json already equals
  the version on `origin/main`.
- Rationale: user calls the Store release v2; one version everywhere (`app.getVersion()` ==
  manifest version == tag), so the Store's "must increase" rule is the same rule as today's tag
  uniqueness; NSIS users get a normal upgrade prompt to 2.0.0 (higher than 0.1.70,
  `update-manager.ts` compareVersions). No version code in the app.
- Rejected: Store-only mapped version via `extraMetadata.version` - with `--prepackaged` the
  asar is not rebuilt (`platformPackager.js:149`), so the app would report 0.1.x while the
  manifest says 1.x/2.x; two version lines must both stay monotonic forever. Rejected `1.0.0` +
  `bump: major` trick - relies on the operator choosing major on the first run and leaves a
  misleading committed version.
- Effect: macOS/Linux also become 2.0.0 (out of scope work, but harmless). Push-triggered runs
  still bump patch (2.0.1) - the operator must run the first release as dispatch `bump: none`
  (checklist item).

### D4. Distribution channel + update check

- Chosen: in `build-identity.ts` add
  `export type DistributionChannel = 'microsoft-store' | 'direct';`
  `export function readDistributionChannel(runtime: { readonly windowsStore?: boolean } = process): DistributionChannel`
  (returns `'microsoft-store'` only when `runtime.windowsStore === true`) and
  `export function isMicrosoftStoreBuild(): boolean`. `UpdateManager.start()` and
  `triggerCheck()` return first when `isMicrosoftStoreBuild()`, logging
  `[UpdateManager] Skipped — Microsoft Store build (updates come from the Store)`. State stays
  `{ state: 'idle' }`; the dialog never opens (component gate `state === 'available'`).
- Rationale: `process.windowsStore` is package-identity based and set by Electron itself; it
  cannot be faked by env, needs no build metadata (which `--prepackaged` could not inject anyway),
  and is also true for the sideloaded test package (Assumption A4: verify in smoke step S2).
- Rejected: build-time `extraMetadata.ptahDistributionChannel` (same `--prepackaged` problem;
  duplicates a runtime fact). Rejected hiding the dialog in the webview (the webview never gets an
  `available` state, so a frontend change would be dead code).
- Effect: no RPC, shared type or frontend change for updates. `IAppUpdater` contract unchanged.

### D5. CI: MSIX in the Windows leg (both modes), separate `store` job for submission (publish only)

- Chosen: build + verify + upload the appx in every Windows run (dry-run included). A new
  `store` job (`needs: [prepare, build, release]`, `runs-on: windows-latest`) submits only in
  publish mode, controlled by a new dispatch input `store-submission`
  (`commit` default | `no-commit` | `skip`). Push-triggered runs behave as `commit`.
  Missing configuration -> job succeeds with a `::notice::` and does nothing.
- Rationale: dry-run proves the MSIX builds without touching Partner Center; submission after the
  GitHub Release keeps both channels on the same version; a separate job makes a Store failure
  re-runnable without rebuilding and never blocks the GitHub Release.
- Rejected: submitting from inside the Windows matrix leg (would submit before the other legs and
  the release succeed; mixes outward action into build). Rejected long `msstore submission poll`
  (certification takes up to 3 business days, beyond job limits) - use one `submission status`.

### D6. ONNX patch/verify gap

- Chosen: add `node apps/ptah-electron/scripts/patch-transformers-onnx-dep.js` before the
  pre-pack prune step (all legs, same order as `project.json:378-381`), and
  `node apps/ptah-electron/scripts/verify-packed-onnx.js` after the existing post-pack verify
  steps (macOS/Linux after L373-375; Windows after phase-1 verify L399-401). The Store build does
  not run them separately: it packs the already-verified `win-unpacked`.
- Rationale: the Store package ships the embedder/voice runtime; the gate the local package target
  relies on must also guard CI artifacts.
- Assumption A5: CI currently ships the pinned onnxruntime 1.24.3; if `verify-packed-onnx.js`
  fails on the first dry-run, that is a real existing defect, not a regression of this task -
  report it and fix in the same PR.

### D7. AI report-content control (policy 11.16) - small UI addition

- Chosen: a `ptah-report-response-button` atom in chat-ui rendered in the turn action row next to
  copy, for assistant messages only. It is a plain anchor:
  `mailto:support@ptah.live?subject=<enc "Report AI response">&body=<enc template>` with
  `target="_blank"`; the body holds the message id, an ISO timestamp, and the first 1,000
  characters of the response text (extracted by a new pure helper shared with copy). No backend.
- Rationale: Electron already routes `mailto:` through `openExternalSafely`
  (`navigation-policy.ts:19`); the user's mail client shows the report before anything is sent
  (no silent data transfer). The practitioner account was rejected under 11.16 without such a
  control (research Evidence row "Practitioner account").
- Rejected: in-app report form posting to the license server (new endpoint, storage, privacy
  surface - not justified for a listing requirement). Rejected gating by `isElectron`: the
  control is harmless on other hosts and gating adds a branch; if VS Code webviews ignore
  `mailto:`, the control is inert there (no feature work for VS Code per CLAUDE.md).

### Step B (later, separate small PR) - eSigner/NSIS retirement

Not batched in step A. Putting it behind a workflow input was considered and rejected: the eSigner
steps hold four secrets and ~250 lines (L413-668) that would stay dead but live; an input that
silently drops the .exe from the GitHub Release would also break `UpdateManager.platformInstallerUrl`
(`update-manager.ts:342-362`) for every remaining NSIS user, which is a product decision, not a
toggle. Step B, precisely:

1. Preconditions: Store listing live; the user has emailed NSIS users; at least one CI Store
   submission succeeded.
2. `publish-electron.yml`: delete steps "Stage main app executable for signing" through "Copy
   signed binaries back into win-unpacked" (L413-626), "Find Windows installer" (L646-654) and
   "Sign Windows installer with SSL.com eSigner" (L656-668); delete the NSIS repack step
   (L628-634) and its post-repack verifies (L638-644); change the appx step's `--prepackaged`
   to the phase-1 `win-unpacked` (unchanged path); delete `artifacts/**/Ptah*.exe` from the
   release `files:` (L765) and the "Rename installer files" step (L746-755); rewrite the header
   comment (L7-8, L24-43) and the eSigner cost notes.
3. Repo settings: delete secrets `SSL_COM_USERNAME`, `SSL_COM_PASSWORD`, `SSL_COM_CREDENTIAL_ID`,
   `SSL_COM_TOTP_SECRET`; then cancel the eSigner subscription.
4. `electron-builder.yml`: set `win.target: [appx]` and delete the `nsis:` block (L156-165),
   unless the user still wants local NSIS builds (ask in step B). With `[appx]` as the default
   target, the CI appx step can drop `--prepackaged` and package directly from phase 1.
5. `update-manager.ts`: on Windows non-Store builds (old NSIS installs), `platformInstallerUrl`
   finds no .exe and falls back to `releaseUrl`; change the Windows branch to point to the Store
   page `ms-windows-store://pdp/?productid=9N80K3HFX0JT` (or `https://apps.microsoft.com/detail/9N80K3HFX0JT`)
   so remaining NSIS users are sent to the Store. Spec update in `update-manager.spec.ts`.
6. Checks: `npx nx test ptah-electron --parallel=1`, `npx nx typecheck ptah-electron --parallel=1`,
   one dry-run dispatch.

## Component specifications

### 1. Store packaging config + tiles

- Purpose: make `electron-builder --win appx` produce a Store-valid unsigned `.appx`.
- Responsibilities: `appx:` block; tile assets; generator script.
- Verified contracts: `AppxTarget.js:50,60,83,182-275` (options merge, artifactName, asset dir,
  manifest fields); `electron-builder.yml:6-8,118-120`; `project.json:92-97`.
- Config (exact keys; values committed):
  ```yaml
  appx:
    identityName: PtahOrchestra.Ptah
    publisher: CN=4E52CB56-1E00-4214-9A22-F65A54BFF522
    publisherDisplayName: Ptah Orchestra
    applicationId: Ptah
    displayName: Ptah
    backgroundColor: transparent
    languages:
      - en-US
    artifactName: ${productName}-${version}-store.${ext}
  ```
  Place after `win:` with a comment: Store-only (Microsoft re-signs; never sign the appx; values
  from Partner Center > Product identity, case-sensitive); `runFullTrust` is added by
  electron-builder; select with `--win appx`. Do not add `capabilities`, `protocols`,
  `addAutoLaunchExtension` (none used: no protocol/login-item code per context.md).
- Dependencies: electron-builder 26.16.1 (installed); sharp (script only).
- Integration: CI step (component 4), local recipe.
- Failure behaviour: invalid identity/applicationId -> electron-builder throws
  `InvalidConfigurationError` (AppxTarget.js:226-247) -> CI step fails. Missing tiles -> sample art
  (silent): guarded by a CI check that the 4 PNGs exist in `dist/apps/ptah-electron/assets/appx`.
- Quality: tile PNG dimensions exact; RGBA.
- Verification seam: `node -e` dimension check in the batch (sharp metadata of the 4 files);
  `npx nx lint ptah-electron --parallel=1` is not affected by yml; YAML validity checked by
  `node -e "require('js-yaml')..."` only if js-yaml resolves, else by the first dry-run.
- Files: MODIFY `apps/ptah-electron/electron-builder.yml`; CREATE
  `apps/ptah-electron/scripts/generate-appx-assets.mjs`, CREATE
  `apps/ptah-electron/src/assets/appx/StoreLogo.png`, `Square44x44Logo.png`,
  `Square150x150Logo.png`, `Wide310x150Logo.png`; MODIFY
  `apps/ptah-electron/src/assets/icons/README.md` (one section: Store tiles + regenerate command).

### 2. Distribution channel

- Purpose: one place that answers "is this the Microsoft Store build".
- Responsibilities: `DistributionChannel` type, `readDistributionChannel(runtime)`,
  `isMicrosoftStoreBuild()`.
- Verified contracts: `build-identity.ts:22-37` (existing style: pure reader + boolean wrapper);
  `electron.d.ts:27445` (`process.windowsStore`).
- Dependencies: none beyond Node `process` (no Electron import needed for this part).
- Integration: `UpdateManager` (component 3). No DI token: a pure module function, same as
  `isLocalProductionBuild` (no new port - single host, single consumer).
- Failure behaviour: anything other than `windowsStore === true` -> `'direct'` (fail open to
  today's behaviour).
- Verification seam: `apps/ptah-electron/src/config/build-identity.spec.ts` - add cases:
  `{ windowsStore: true }` -> `'microsoft-store'`; `{}` / `{ windowsStore: false }` -> `'direct'`.
- Files: MODIFY `apps/ptah-electron/src/config/build-identity.ts`,
  `apps/ptah-electron/src/config/build-identity.spec.ts`.

### 3. UpdateManager Store gate

- Purpose: never query GitHub or offer an .exe in a Store install.
- Responsibilities: early return in `start()` (before the local-production gate) and in
  `triggerCheck()`; update the class header comment (L1-10) to mention the Store gate.
- Verified contracts: `update-manager.ts:129-171`; `IAppUpdater` unchanged
  (`update-rpc.handlers.ts:48-49`); dialog gate `update-dialog.component.ts:105`.
- Integration: `post-window.ts:182-193` unchanged (start() returns; `getCheckInterval()` null).
- Failure behaviour: none new; `update:get-state` returns `idle`; `update:check-now` returns
  `{ success: true }` with no broadcast.
- Verification seam: `update-manager.spec.ts` - extend the `jest.mock('../../config/build-identity')`
  factory with `isMicrosoftStoreBuild: jest.fn(() => false)`; add `describe('Microsoft Store gate')`
  mirroring L204-227: no interval, no `net.fetch`, log contains `Microsoft Store`; manual check no
  fetch and state `idle`. Reset the mock in the existing `beforeEach`/`afterEach` pattern.
- Files: MODIFY `apps/ptah-electron/src/services/update/update-manager.ts`,
  `apps/ptah-electron/src/services/update/update-manager.spec.ts`.

### 4. CI workflow (publish-electron.yml) + app version

- Purpose: build the MSIX on every Windows run; submit it on publish; enforce Store-valid,
  monotonic versions; close the onnx gap.
- Responsibilities and exact changes:
  1. `on.workflow_dispatch.inputs`: `bump` options add `none` (description: release the committed
     version unchanged). New input `store-submission`: choice `commit` (default), `no-commit`,
     `skip`; description "Microsoft Store: commit the submission, upload as draft only, or skip.
     Ignored in dry-run."
  2. prepare "Bump version" (L126-158): `none` keeps the version. After computing NEW_VERSION add
     a guard (node): integers, `major >= 1`, each segment `<= 65535`, and greater than every
     `git tag -l 'electron-v*'` version (numeric compare). Error message names the rule.
  3. Pre-pack (all legs, before "Prune renderer-only deps", L337): new step
     "Reconcile onnxruntime-node declared version (pre-pack)" running `patch-transformers-onnx-dep.js`.
     Post-pack: "Verify packed onnxruntime-node (macOS/Linux)" after L373-375 and
     "Verify packed onnxruntime-node (win-unpacked, pre-sign)" after L399-401.
  4. Windows, after "Sign Windows installer with SSL.com eSigner" (L656-668), new steps (all
     `if: runner.os == 'Windows'`):
     - "Check Store tile assets" (pwsh): the 4 PNGs exist under
       `dist/apps/ptah-electron/assets/appx`; throw otherwise.
     - "Package Microsoft Store MSIX (appx, unsigned, from win-unpacked)": command in D1; env
       `GH_TOKEN` only; comment states A1 + fallback F1 and "never sign; Microsoft re-signs".
     - "Find Store package" (pwsh, id `find-appx`): exactly one `dist\release\*-store.appx`;
       output `appx_path`, `appx_name`; write name + size to `$GITHUB_STEP_SUMMARY`.
     - "Upload Store package": `actions/upload-artifact@v4`, name
       `ptah-msstore-${{ needs.prepare.outputs.version }}`, path the appx, `if-no-files-found: error`,
       retention same expression as L680.
  5. "Upload artifacts" (L670-680): add `!dist/release/*.appx` and `!dist/release/__appx-*/`
     (stage dir; Assumption A6: name `__appx-x64`, confirm in the first dry-run listing).
  6. Release job "Create git tag and version bump PR to main" (L701-736): after writing
     package.json on the fresh branch, if `git diff --quiet -- apps/ptah-electron/package.json`
     then echo a notice and skip commit/push/PR (tag still pushed).
  7. New job `store` (after `release`):
     ```yaml
     store:
       needs: [prepare, build, release]
       if: needs.prepare.outputs.release_mode == 'publish' && (github.event.inputs.store-submission || 'commit') != 'skip'
       runs-on: windows-latest
       timeout-minutes: 30
     ```
     Steps: (a) "Refuse unless publishing" (copy of L687-694). (b) "Check Store configuration"
     (id `cfg`): env `MSSTORE_CLIENT_SECRET: ${{ secrets.MSSTORE_CLIENT_SECRET }}`,
     `MSSTORE_TENANT_ID: ${{ vars.MSSTORE_TENANT_ID }}`, `MSSTORE_CLIENT_ID: ${{ vars.MSSTORE_CLIENT_ID }}`,
     `MSSTORE_SELLER_ID: ${{ vars.MSSTORE_SELLER_ID }}`, `MSSTORE_PRODUCT_ID: ${{ vars.MSSTORE_PRODUCT_ID }}`;
     if any is empty -> `::notice::Microsoft Store submission skipped: missing <names>. The MSIX is
     in artifact ptah-msstore-<version>.` and output `configured=false`; else `true`. Never echo
     values. (c) `actions/download-artifact@v4` name `ptah-msstore-${{ needs.prepare.outputs.version }}`
     to `store-pkg` (if configured). (d) `microsoft/microsoft-store-apppublisher@v1.1` (if configured).
     (e) "Configure msstore": `msstore reconfigure --tenantId "$env:MSSTORE_TENANT_ID"
     --sellerId "$env:MSSTORE_SELLER_ID" --clientId "$env:MSSTORE_CLIENT_ID"
     --clientSecret "$env:MSSTORE_CLIENT_SECRET"` (env mapping as in b). (f) "Submit to Microsoft
     Store": `msstore publish "<appx>" -id "$env:MSSTORE_PRODUCT_ID"` plus `--noCommit` when
     `store-submission == 'no-commit'`; write mode to the step summary. (g) "Submission status"
     (only when committed): `msstore submission status "$env:MSSTORE_PRODUCT_ID"` into the step
     summary; `continue-on-error: true` (informational).
  8. Header comment: add a "Microsoft Store" paragraph (what is built in each mode, secrets/vars,
     first submission is manual).
  9. `apps/ptah-electron/package.json` version `0.1.70` -> `2.0.0`.
- Verified contracts: workflow lines cited above; msstore commands and action version from
  research-report.md Evidence rows "CI flow" and "`msstore publish` options" (external, Learn
  2026-08-30 / 2026-10-06) - Assumption A7: `msstore publish` accepts an `.appx` path as the
  positional input for an "MSIX or PWA app" product; resolved by the first CI submission.
- Failure behaviour: appx build failure fails the Windows leg (dry-run and publish) -> no release,
  no store job. Missing config -> `store` job green with notice. `msstore` failure (e.g. first
  submission not yet published, auth) -> `store` job red; GitHub Release already published; fix
  and "Re-run failed jobs". `--noCommit` leaves a draft; the next `publish` deletes and replaces
  it (research "Publishing when a draft exists deletes the draft"). Version guard failure fails
  prepare before any build.
- Security: client secret only via `secrets`, passed through env, never printed; Store job has
  the workflow default `contents: write` - acceptable (no checkout needed); optional: job-level
  `permissions: contents: read`.
- Verification seam: YAML lint via `npx --yes actionlint`? Not installed - instead
  `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/publish-electron.yml','utf8'))"`
  if `yaml` resolves (Assumption A8), plus a user-run dry-run dispatch (`dry-run: true`,
  `bump: none`) as the integration check: Windows leg green, artifact `ptah-msstore-2.0.0`
  present, no `store`/`release` job run.
- Files: MODIFY `.github/workflows/publish-electron.yml`, `apps/ptah-electron/package.json`.

### 5. Report AI response control

- Purpose: visible way to report inappropriate AI output (policy 11.16).
- Responsibilities: (a) pure helper `extractMessageText(message: ExecutionChatMessage): string`
  (logic moved verbatim from `copy-button.component.ts:67-109`); CopyButtonComponent uses it (no
  behaviour change). (b) `ReportResponseButtonComponent` (`selector: 'ptah-report-response-button'`,
  standalone, OnPush, inputs `message: ExecutionChatMessage` required, `turnActionSize: boolean`);
  a computed `href` building the `mailto:` with `encodeURIComponent`; body excerpt = first 1,000
  chars of `extractMessageText`, message id, `new Date().toISOString()` at render; lucide `Flag`
  icon (Assumption A9: confirm `Flag` export in installed `lucide-angular`, else `FlagTriangleRight`);
  `aria-label="Report this response"`, `title="Report response"`, same 28 px classes as copy.
  (c) export both from `libs/frontend/chat-ui/src/index.ts`. (d) render in
  `message-bubble.component.html:136` after copy, only when `message().role === 'assistant'`.
- Verified contracts: `copy-button.component.ts:24-110`; `chat-ui/src/index.ts:15`;
  `message-bubble.component.html:134-136`; `message-bubble.component.ts:36,113-120` (imports).
- Failure behaviour: no mail client -> OS shows its handler prompt; nothing thrown. Empty text ->
  body without excerpt.
- Quality: keyboard focusable anchor, visible focus ring as copy; mailto length bounded (excerpt
  1,000 chars before encoding).
- Verification seam: `report-response-button.component.spec.ts` (href starts with
  `mailto:support@ptah.live`, subject encoded, excerpt truncated to 1,000, `target="_blank"`);
  `message-text.spec.ts` (text/message node extraction, rawContent fallback); existing
  `copy-button.component.spec.ts` still passes; message-bubble spec: report button present for
  assistant, absent for user (extend existing spec if one exists, Assumption A10).
- Files: CREATE `libs/frontend/chat-ui/src/lib/atoms/message-text.ts`,
  `libs/frontend/chat-ui/src/lib/atoms/message-text.spec.ts`,
  `libs/frontend/chat-ui/src/lib/atoms/report-response-button.component.ts`,
  `libs/frontend/chat-ui/src/lib/atoms/report-response-button.component.spec.ts`; MODIFY
  `libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts`,
  `libs/frontend/chat-ui/src/index.ts`,
  `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.ts`,
  `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`
  (+ its spec if present).

## Integration architecture

- Data flow (publish): dispatch/push -> prepare (version 2.0.0 + guards, `release_mode`) ->
  Windows leg: nx build -> rebuild-native -> copy-wasm -> onnx patch -> prune -> phase 1
  `--win --dir` -> verify native/wasm/onnx -> eSigner Ptah.exe -> NSIS `--prepackaged` -> verify
  -> eSigner installer -> appx `--win appx --prepackaged` -> artifact `ptah-msstore-<v>` -> release
  job (tag, GitHub Release without appx, bump PR) -> store job (config check -> download artifact
  -> msstore reconfigure -> publish [--noCommit] -> status) -> Partner Center certification
  (1-3 business days) -> Microsoft signs and publishes -> Store delivers updates.
- Dry-run: same Windows leg without eSigner; appx built and uploaded; release and store jobs do
  not run.
- Runtime: Store-installed app -> `process.windowsStore === true` -> UpdateManager inert -> no
  GitHub calls, no dialog. All state stays in `~/.ptah` (not virtualized); logs/crash dumps under
  userData are redirected to `%LOCALAPPDATA%\Packages\PtahOrchestra.Ptah_rwqmhy9dq1amj\LocalCache\Roaming\Ptah`.
- External boundaries: Partner Center via msstore with Entra app (Manager role); secret only in
  `secrets.MSSTORE_CLIENT_SECRET`.
- Failure and rollback: Store submission cannot roll back a published GitHub Release and vice
  versa; a failed store job is re-run. A bad Store release is fixed by a higher version (Store
  never accepts a lower one). `--noCommit` gives a manual review gate in Partner Center.
- Observability: step summaries (appx name/size, store mode, submission status); notice when
  skipped; app log line `[UpdateManager] Skipped — Microsoft Store build`.

## Risks to surface

- R1 Both installs side by side: MSIX virtualizes userData, so the single-instance lock
  (`main.ts:56`) of an NSIS install and a Store install do not see each other, while both open the
  same `~/.ptah` SQLite DB. Users must uninstall the NSIS build first (migration email - user's
  scope). Smoke test S9 checks it.
- R2 `npx skills` (`skills-sh-cli.ts:106`) needs Node/npx on PATH and installs third-party code at
  runtime (10.2.2/10.2.3). Disclose in listing, or disable in the Store build (Q3).
- R3 Unsigned appx acceptance (research Unknown 1) - decided by the first manual upload.

## Store compliance

Needs code (this task): AI report control (component 5, policy 11.16); no self-update in Store
builds (component 3, Store policy 10.8.x / research "Updates"); package identity + tiles
(component 1). Already satisfied by source: no protocol handlers / login items (context.md).

Listing / Partner Center only (user): dependency disclosure at the start of the description
(10.2.4); generative-AI disclosure in description and in Partner Center's AI question (11.16);
`runFullTrust` justification; privacy policy URL; certification notes about CLIs and helper
downloads (10.2.2/10.2.3); age rating questionnaire; screenshots.

Draft description opening (paste as the first paragraph):

> Requires separately installed tools: Ptah is a desktop workspace for AI coding agents. To run
> agents you need at least one of the Claude Code CLI, the OpenAI Codex CLI or another supported
> agent CLI, plus Git, installed and signed in on your PC. Some optional features (installing
> skills) also need Node.js. Ptah does not install these tools for you.
>
> AI-generated content: Ptah sends your prompts and selected workspace files to the AI providers
> you connect (for example Anthropic or OpenAI) and shows their live generated responses. AI
> output can be inaccurate or inappropriate; review it before use. Use the flag button under any
> response to report it to us.

`runFullTrust` justification (keep short; the box truncates):

> Ptah is a developer tool. It must start and talk to command-line programs the user installed
> (git, Claude Code, Codex) and its bundled ffmpeg and native SQLite/ONNX modules, read and write
> the user's project folders, and run background worker processes. This requires a full-trust
> desktop process.

Certification notes (draft):

> Ptah needs an AI agent CLI to be useful (Claude Code or Codex), which the reviewer may not
> have; without one the app opens and shows setup hints. Ptah does not download or execute code
> outside its described function; agent CLIs it starts are user-installed. Report AI output: flag
> icon under each assistant response (opens an e-mail to support@ptah.live).

## Local verification recipe (user, Windows, elevated PowerShell where noted)

1. Package once (user-run; agents must not run package targets):
   `npx nx run ptah-electron:package` (produces `dist/release/win-unpacked` + NSIS and runs the
   onnx/native/wasm verifiers).
2. Build the Store package from it:
   `npx electron-builder --config electron-builder.yml --project dist/apps/ptah-electron --publish never --win appx --prepackaged "$PWD/dist/release/win-unpacked"`
   -> `dist/release/Ptah-2.0.0-store.appx` (resolves A1).
3. Test certificate (once):
   `$c = New-SelfSignedCertificate -Type Custom -Subject "CN=4E52CB56-1E00-4214-9A22-F65A54BFF522" -KeyUsage DigitalSignature -FriendlyName "Ptah MSIX test" -CertStoreLocation Cert:\CurrentUser\My -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3","2.5.29.19={text}")`
   `$pw = ConvertTo-SecureString -String "ptah-test" -Force -AsPlainText; Export-PfxCertificate -Cert $c -FilePath $env:TEMP\ptah-test.pfx -Password $pw`
   (elevated) `Import-PfxCertificate -FilePath $env:TEMP\ptah-test.pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw`
4. Sign a COPY (never upload it): `Copy-Item dist\release\Ptah-2.0.0-store.appx $env:TEMP\Ptah-test.appx`;
   `& "C:\Program Files (x86)\Windows Kits\10\bin\<sdk>\x64\signtool.exe" sign /fd SHA256 /f $env:TEMP\ptah-test.pfx /p ptah-test $env:TEMP\Ptah-test.appx`
5. Uninstall the NSIS Ptah first (R1), then `Add-AppxPackage $env:TEMP\Ptah-test.appx`.
6. WACK (elevated, interactive session): `cd "C:\Program Files (x86)\Windows Kits\10\App Certification Kit"`;
   `.\appcert.exe reset`; `.\appcert.exe test -appxpackagepath <abs>\dist\release\Ptah-2.0.0-store.appx -reportoutputpath $env:TEMP\ptah-wack.xml`.
7. Remove after testing: `Get-AppxPackage PtahOrchestra.Ptah | Remove-AppxPackage`.

Smoke checklist (sideloaded package):
- S1 Launch from Start; tile and taskbar icons show the Ptah art (not sample tiles).
- S2 Log shows `[UpdateManager] Skipped — Microsoft Store build`; no update dialog (A4).
- S3 `~/.ptah` DB opens: create a session, restart, it is still there.
- S4 Spawn from PATH: a Claude/Codex session starts; git status in the workspace works.
- S5 Voice note decodes (ffmpeg from `app.asar.unpacked`).
- S6 Utility workers: embedder/indexing runs; onnx/transformers models load from `~/.ptah/models`.
- S7 Single instance: launching again focuses the existing window.
- S8 Logs/crash dumps under `%LOCALAPPDATA%\Packages\PtahOrchestra.Ptah_rwqmhy9dq1amj\LocalCache\Roaming\Ptah`.
- S9 With the NSIS build still installed, start both: record whether two instances run (R1).
- S10 Report flag opens a mail draft to help@ptah.live with "Response time" in the body.
- S11 Uninstall removes the package; `~/.ptah` remains (expected).

## Manual one-time checklist (user)

1. Partner Center: name reserved (done). Product identity values copied (done, committed here).
2. Account settings > Tenants: associate or create an Entra tenant.
3. Entra: register app "ptah-msstore-ci", create a client secret (calendar its expiry), note
   tenant ID and client ID. Partner Center > Account settings > User management > Microsoft Entra
   applications: add it with the Manager role. Note the Seller ID (Account settings > Legal info /
   Developer settings).
4. GitHub repo: secret `MSSTORE_CLIENT_SECRET`; variables `MSSTORE_TENANT_ID`,
   `MSSTORE_CLIENT_ID`, `MSSTORE_SELLER_ID`, `MSSTORE_PRODUCT_ID=9N80K3HFX0JT`. Leave the secret
   unset until step 7 is done, so CI skips submission with a notice.
5. Merge step A; dispatch Publish Electron with `dry-run: true` (any bump) -> download artifact
   `ptah-msstore-<v>`; run the local recipe on it.
6. Dispatch with `bump: none`, `store-submission: skip` -> GitHub Release v2.0.0 + artifact.
7. First submission in Partner Center: pricing (free), properties/category, age rating (all
   questions), upload `Ptah-2.0.0-store.appx` from the artifact, listing (description with the
   disclosures above, screenshots, privacy policy URL), Submission options: `runFullTrust`
   justification + certification notes; submit; wait until live.
8. Set `MSSTORE_CLIENT_SECRET`; later releases submit automatically (`commit`), or use
   `no-commit` to review in Partner Center before submitting.

## Architecture-level quality requirements

- Functional: dry-run produces `Ptah-<v>-store.appx` artifact and never runs `store`/`release`;
  publish submits unless `skip` or config missing; Store install performs zero GitHub update
  requests; every new version is `X.Y.Z` with X >= 1 and greater than all previous tags.
- Performance: Windows leg grows by one appx pack (no second asar pack); no runtime cost.
- Security: only the client secret is secret, passed via env, never logged; report control sends
  nothing without the user's mail client confirmation.
- Maintainability: NSIS path untouched in step A; identity values in one committed block; channel
  logic in `build-identity.ts` only.
- Testability: unit tests for channel detection, UpdateManager Store gate, mailto builder and text
  helper; workflow verified by a dry-run dispatch (user).

## Team-leader handoff

- Recommended executors:
  - Component 1 (packaging config + tiles): devops-engineer - build config and assets.
  - Components 2+3 (channel + UpdateManager gate): backend-developer - Electron main-process code.
  - Component 4 (workflow + version): devops-engineer - CI.
  - Component 5 (report control): frontend-developer - Angular atoms.
- Complexity: MEDIUM - small code, but CI integration with two unverified external behaviours
  (A1 prepackaged appx, A7 msstore appx upload) that only a dry-run/first submission resolves.
- Dependencies and ordering: component 4 references the artifact name from component 1
  (`artifactName` pattern `*-store.appx`) and the tile check path - keep the two consistent;
  2 before 3 (3 imports 2). Components 1, 2+3, 5 are independent.
- Parallel-safe work: {1}, {2,3}, {4}, {5} are file-disjoint.
- Files affected:
  - CREATE: `apps/ptah-electron/scripts/generate-appx-assets.mjs`;
    `apps/ptah-electron/src/assets/appx/{StoreLogo,Square44x44Logo,Square150x150Logo,Wide310x150Logo}.png`;
    `libs/frontend/chat-ui/src/lib/atoms/message-text.ts` (+ `.spec.ts`);
    `libs/frontend/chat-ui/src/lib/atoms/report-response-button.component.ts` (+ `.spec.ts`).
  - MODIFY: `apps/ptah-electron/electron-builder.yml`; `apps/ptah-electron/src/assets/icons/README.md`;
    `apps/ptah-electron/src/config/build-identity.ts` (+ `.spec.ts`);
    `apps/ptah-electron/src/services/update/update-manager.ts` (+ `.spec.ts`);
    `.github/workflows/publish-electron.yml`; `apps/ptah-electron/package.json`;
    `libs/frontend/chat-ui/src/lib/atoms/copy-button.component.ts`; `libs/frontend/chat-ui/src/index.ts`;
    `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.{ts,html}` (+ spec if present).
- Verification points per batch (one heavy check at a time, `--parallel=1`, Jest `--maxWorkers=2`):
  - Component 1: run the generator once; check the 4 PNG sizes with a sharp metadata one-liner;
    no nx target (yml/assets only). Commit scope `electron`.
  - Components 2+3: `npx nx test ptah-electron --parallel=1` (or Jest on
    `apps/ptah-electron/src/config/build-identity.spec.ts` and
    `apps/ptah-electron/src/services/update/update-manager.spec.ts` with `--maxWorkers=2`), then
    `npx nx typecheck ptah-electron --parallel=1`, `npx nx lint ptah-electron --parallel=1`. Scope `electron`.
  - Component 4: YAML parse one-liner; diff review against the cited line ranges; no nx target;
    the user runs the dry-run dispatch after merge. Scope `ci` (package.json version: `release`
    scope may be used in the same commit as `ci,release`).
  - Component 5: `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --parallel=1`
    (confirm "Running target test for 2 projects"), then typecheck and lint for both projects one at
    a time. Because chat-ui/chat are shared webview libs, also `npx nx typecheck ptah-electron --parallel=1`
    (host compile). Scope `webview`.
- Assumptions to resolve: A1 (local recipe step 2 / dry-run), A2/A7 (first submission), A4 (S2),
  A5 (first dry-run), A6 (dry-run artifact listing), A8 (`yaml` resolves), A9 (lucide icon name),
  A10 (message-bubble spec location).

## User answers (2026-10-19) - these OVERRIDE the plan text above

- Q1: exactly `2.0.0` - add the `bump: none` choice.
- Q2: privacy policy URL `https://ptah.live/privacy` (route exists in apps/ptah-landing-page).
- Q3: keep skill installation; disclose the Node.js dependency in the listing.
- Q4: report recipient is **help@ptah.live** (NOT support@ptah.live). Use help@ptah.live in the
  report button, its spec and the listing text.
- Q5: push-triggered releases upload as draft: the default for `store-submission` on push is
  `no-commit`. `commit` happens only when a dispatch selects it explicitly.

## Open questions for the user (answered above)

- Q1 Version: release v2 as exactly `2.0.0` (needs the new `bump: none` choice; recommended) or
  accept `2.0.1` from a normal patch bump (no `none` choice)?
- Q2 Privacy policy URL: which URL goes into the listing (for example `https://ptah.live/privacy`)?
  It must exist before the first submission.
- Q3 `npx skills` install flow in the Store build: keep it and disclose Node.js in the listing
  (recommended, drafted above), or hide skill installation in Store builds?
- Q4 Report recipient: is `support@ptah.live` monitored and the right address for AI-content
  reports?
- Q5 Push-triggered releases (release/electron): submit to the Store automatically (`commit`,
  as designed) or always upload as draft (`no-commit`) until you trust the pipeline?
