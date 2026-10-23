# Microsoft Store (MSIX) channel — context

## User decisions (2026-10-19)
- Windows distribution moves to the Microsoft Store (MSIX, Microsoft re-signs). Goal: cancel the
  SSL.com eSigner subscription ($20/month) once the Store channel is live.
- The Store release is "v2". The user updates the landing page / download links and emails existing
  users personally — landing page, docs and user migration are OUT of scope.
- macOS (Developer ID + notarization) and Linux are OUT of scope for this task.
- Publisher: individual account (Abdallah Khalil, Egypt). The user does the Partner Center steps and
  provides credentials (Entra tenant/client/secret, seller ID, product ID) as GitHub secrets.
- The first Store submission is manual (Partner Center). CI automates later submissions.

## Partner Center product identity (reserved 2026-10-19, submit before ~2027-01-19)
- Store ID / product ID: 9N80K3HFX0JT (https://apps.microsoft.com/detail/9N80K3HFX0JT)
- Package/Identity/Name (appx.identityName): PtahOrchestra.Ptah
- Package/Identity/Publisher (appx.publisher): CN=4E52CB56-1E00-4214-9A22-F65A54BFF522
- Package/Properties/PublisherDisplayName: Ptah Orchestra
- Package Family Name: PtahOrchestra.Ptah_rwqmhy9dq1amj
These values are public (they are in every package manifest), so they can be committed in
electron-builder config. Only the Entra client secret is a secret.

## Inputs
- research-report.md (this folder): appx target, Partner Center, msstore CLI, policies, gotchas.
- Repository map (Explore agent) — key facts:

### publish-electron.yml (770 lines)
- Triggers: push to release/electron, or workflow_dispatch (bump, dry-run). Jobs: prepare (version
  bump L126-158 from apps/ptah-electron/package.json, tag electron-v<ver>), build (matrix win/mac/linux,
  L196-680), release (publish only, L682-770: tag, chore/bump PR, softprops/action-gh-release uploads
  Ptah*.exe, *.dmg, *.zip, *.AppImage, *.deb, latest*.yml).
- Windows leg: phase 1 `electron-builder --win --dir` (L380-384); verify-packed-native/wasm
  (L395-403); phase 2 eSigner stage/sign/retry/copy-back of Ptah.exe (L413-618); phase 3 NSIS via
  `--prepackaged win-unpacked` (L628-634); installer eSigner sign (L646-668); upload artifacts
  (L670-680).
- Secrets: RELEASE_TOKEN, GITHUB_TOKEN, SSL_COM_USERNAME/PASSWORD/CREDENTIAL_ID/TOTP_SECRET.
- Gap: workflow does not run patch-transformers-onnx-dep.js / verify-packed-onnx.js that the local
  `package` target runs (project.json:379-385).

### Packaging
- apps/ptah-electron/electron-builder.yml: appId com.ptah.desktop, productName Ptah, buildResources
  `assets`, asar true, asarUnpack L52-99 (codex, copilot, better-sqlite3, sqlite-vec, ffmpeg-static,
  transformers, onnxruntime-node, @parcel/watcher...), extraResources L101-121, icon
  assets/icons/icon.png, win target nsis (L150-166), nsis L188-197, publish github. No appx config,
  no hooks. electron-builder.local-production.cjs extends it (extraMetadata.ptahBuildIdentity).
- Icons: src/assets/icons/{icon.png, win/icon.ico, png/16-1024}. No Store tiles.

### Update mechanism
- apps/ptah-electron/src/services/update/update-manager.ts: GitHub Releases API (L23), start()
  L129-160 skips local-production/dev/e2e, checkViaGitHub L188-260, platformInstallerUrl L342-362.
  Started in src/activation/post-window.ts:183-186. RPC: libs/backend/rpc-handlers/.../update-rpc.handlers.ts.
- Webview: libs/frontend/chat/src/lib/update-dialog/update-dialog.{component,service}.ts.
- Natural channel hook: apps/ptah-electron/src/config/build-identity.ts:22-37 (readBuildIdentity),
  or process.windowsStore.

### Runtime
- Most state in ~/.ptah via os.homedir() (sqlite db-path.ts:54-65, models, vault .machine-uuid,
  plugins...) — not AppData, so MSIX AppData virtualization mostly does not apply. Logs/crash dumps
  under userData (main.ts:100,103,289).
- Writes ~/.claude.json, ~/.codex/config.toml, .mcp.json.
- ~20 backend files spawn processes (cross-spawn/child_process); utility processes forked
  (electron-utility-worker-process.ts). ffmpeg from resourcesPath/app.asar.unpacked. node-pty is
  NOT a dependency. CLIs are not auto-installed (only hints).
- No protocol handlers, no login item, no setAppUserModelId. Single-instance lock main.ts:56.
