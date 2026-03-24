# Implementation Plan - TASK_2025_205: Electron Icons & CI/CD Pipeline

## Codebase Investigation Summary

### Build Pipeline Discovery

- **Webpack config**: `apps/ptah-electron/webpack.config.js` -- bundles `main.js` and `preload.js` only, NO asset copying (no CopyWebpackPlugin)
- **Dist output**: `dist/apps/ptah-electron/` contains `main.js`, `preload.js`, `renderer/` -- no `assets/` directory
- **copy-renderer script**: `apps/ptah-electron/scripts/copy-renderer.js` -- copies Angular webview output to `dist/apps/ptah-electron/renderer/`, patches base href
- **project.json targets**: `build-main`, `build-preload`, `build`, `copy-renderer`, `serve`, `package` (line 97-103)
- **Package target** (project.json:97-103): `electron-builder --config apps/ptah-electron/electron-builder.yml --project dist/apps/ptah-electron`

### Icon Path Resolution (Critical)

**Runtime icon reference** (main-window.ts:63):

```typescript
icon: path.join(__dirname, 'assets', 'icons', 'icon.png');
```

- `__dirname` at runtime = `dist/apps/ptah-electron/` (webpack output directory)
- Therefore needs: `dist/apps/ptah-electron/assets/icons/icon.png`

**electron-builder icon paths** (electron-builder.yml):

```yaml
directories:
  buildResources: src/assets # relative to --config file location
mac:
  icon: src/assets/icons/icon.icns # relative to --config file location
win:
  icon: src/assets/icons/icon.ico # relative to --config file location
linux:
  icon: src/assets/icons # directory, relative to --config file location
```

- `--config apps/ptah-electron/electron-builder.yml` means paths resolve from workspace root
- `src/assets/icons/icon.icns` resolves to `apps/ptah-electron/src/assets/icons/icon.icns` (from config file directory)
- **Important**: electron-builder resolves icon paths relative to the directory containing the config file (`apps/ptah-electron/`), NOT the `--project` directory

### Existing CI Patterns

- **ci.yml**: `ubuntu-latest`, Node 20, npm cache via `actions/setup-node`, `nx affected -t lint typecheck build`
- **publish-extension.yml**: tag/branch trigger + `workflow_dispatch`, quality gates then build+publish
- **deploy-landing.yml**, **deploy-server.yml**: exist but not relevant

### Dependencies

- `electron-builder: ^25.0.0` is installed (package.json:184)
- `electron-icon-builder` is NOT installed -- needs to be added as devDependency

---

## Part 1: Icons Setup

### Component 1: Placeholder Icon Generation

**Purpose**: Provide a 1024x1024 PNG master icon so the build pipeline works immediately.

**Approach**: Create a simple Node.js script that generates a placeholder PNG using pure JavaScript (no native dependencies). The script uses the `pngjs` library (zero native deps) to create a 1024x1024 icon with the Ptah "P" branding colors.

**Alternative (simpler)**: Since electron-icon-builder needs a source PNG, and we want zero friction, provide a pre-generated placeholder. The simplest approach: use a tiny Node script that creates a colored square PNG with text. However, generating text in a PNG without canvas dependencies is complex.

**Recommended approach**: Create the placeholder as a documented manual step. The developer should:

1. Create a 1024x1024 PNG (even a solid color square works for Phase 1)
2. Place it at `apps/ptah-electron/src/assets/icons/icon.png`
3. Run the icon generation script

For an immediate unblocking approach, we can include a script `scripts/generate-placeholder-icon.js` that uses the `sharp` package (already commonly available, or install as devDep) to create a simple branded placeholder. But since the focus is on the pipeline, not the icon design, the plan should treat the master PNG as a prerequisite input.

**Decision**: Create a simple script using Node.js built-in `Buffer` to generate a minimal valid 1024x1024 PNG. This avoids adding any dependencies just for a placeholder. Alternatively, add the placeholder PNG to the repo directly (it can be replaced later with proper branding).

**Files**:

- `apps/ptah-electron/src/assets/icons/icon.png` (CREATE) -- placeholder master icon

### Component 2: Icon Generation Script

**Purpose**: Convert master `icon.png` into platform-specific formats (.ico, .icns, sized PNGs).

**Pattern**: npm script using `electron-icon-builder` CLI tool.

**Evidence**: The README at `apps/ptah-electron/src/assets/icons/README.md` already documents the expected output files (icon.png, icon.icns, icon.ico).

**Implementation**:

1. Install `electron-icon-builder` as devDependency
2. Add npm script in `package.json`:

   ```json
   "electron:icons": "electron-icon-builder --input=apps/ptah-electron/src/assets/icons/icon.png --output=apps/ptah-electron/src/assets/"
   ```

   - `electron-icon-builder` outputs to `<output>/icons/` subdirectory
   - Generates: `icon.ico`, `icon.icns`, and PNG sizes (16x16 through 512x512) in `icons/` subdir

3. The generated files land in `apps/ptah-electron/src/assets/icons/` (source directory)
4. These generated files should be git-committed (they are build artifacts but electron-builder needs them at packaging time from the source tree)

**Files**:

- `package.json` (MODIFY) -- add `electron:icons` script and `electron-icon-builder` devDependency

### Component 3: Asset Copy Pipeline (Critical)

**Purpose**: Copy `apps/ptah-electron/src/assets/` to `dist/apps/ptah-electron/assets/` during build so runtime icon references work.

**Pattern**: Follow the established `copy-renderer.js` script pattern (evidence: `apps/ptah-electron/scripts/copy-renderer.js`).

**Why this approach over alternatives**:

- **CopyWebpackPlugin in webpack.config.js**: Would work but the webpack config is specifically for JS bundling (evidence: webpack.config.js has no plugins array). Adding a plugin changes the webpack paradigm. Also, `@nx/webpack:webpack` executor may have opinions about plugins.
- **electron-builder extraFiles/extraResources**: These copy files into the packaged app, but do NOT help with the dev/serve workflow where we run from `dist/` directly. The runtime `path.join(__dirname, 'assets', ...)` needs files in `dist/` BEFORE electron-builder runs.
- **Nx project.json copy target**: Best approach -- mirrors the existing `copy-renderer` pattern exactly.

**Implementation**:

1. Create `apps/ptah-electron/scripts/copy-assets.js`:

   ```javascript
   const fs = require('fs');
   const path = require('path');

   const SOURCE = path.resolve(__dirname, '../src/assets');
   const DEST = path.resolve(__dirname, '../../../dist/apps/ptah-electron/assets');

   if (fs.existsSync(DEST)) {
     fs.rmSync(DEST, { recursive: true, force: true });
   }

   if (!fs.existsSync(SOURCE)) {
     console.error(`[copy-assets] Source not found: ${SOURCE}`);
     process.exit(1);
   }

   fs.cpSync(SOURCE, DEST, { recursive: true });
   console.log(`[copy-assets] Copied ${SOURCE} -> ${DEST}`);
   ```

2. Add `copy-assets` target in `project.json`:

   ```json
   "copy-assets": {
     "executor": "nx:run-commands",
     "options": {
       "commands": [
         { "command": "node apps/ptah-electron/scripts/copy-assets.js" }
       ]
     }
   }
   ```

3. Wire into build pipeline -- update `package` target to depend on `copy-assets`:

   ```json
   "package": {
     "executor": "nx:run-commands",
     "dependsOn": ["build", "copy-renderer", "copy-assets"],
     "options": {
       "command": "electron-builder --config apps/ptah-electron/electron-builder.yml --project dist/apps/ptah-electron"
     }
   }
   ```

4. Also wire into `serve` target so dev workflow has icons:
   ```json
   "serve": {
     "executor": "nx:run-commands",
     "options": {
       "commands": [
         "nx build-dev ptah-electron",
         "nx copy-renderer ptah-electron",
         "nx copy-assets ptah-electron",
         "node apps/ptah-electron/scripts/launch.js"
       ],
       "parallel": false
     }
   }
   ```

**Files**:

- `apps/ptah-electron/scripts/copy-assets.js` (CREATE)
- `apps/ptah-electron/project.json` (MODIFY) -- add `copy-assets` target, update `package` and `serve` dependsOn/commands

### Component 4: electron-builder.yml Path Verification

**Purpose**: Ensure electron-builder icon paths resolve correctly given the `--config` and `--project` flags.

**Analysis of current paths**:

The `package` target runs:

```
electron-builder --config apps/ptah-electron/electron-builder.yml --project dist/apps/ptah-electron
```

electron-builder resolves paths as follows:

- `--project dist/apps/ptah-electron` sets the project directory (where `package.json` and app files are)
- `--config apps/ptah-electron/electron-builder.yml` -- icon paths in this file are resolved relative to the **project directory** (the `--project` flag)
- So `win.icon: src/assets/icons/icon.ico` resolves to `dist/apps/ptah-electron/src/assets/icons/icon.ico` -- WRONG

**Fix required**: Change electron-builder.yml icon paths to be correct relative to how electron-builder resolves them. Since `--project` is `dist/apps/ptah-electron/` and our copy-assets script puts icons at `dist/apps/ptah-electron/assets/icons/`, the paths in the config should change.

However, there is a subtlety: electron-builder with `--config <path>` resolves paths relative to the config file's directory when the config is outside the project directory. The actual behavior depends on electron-builder version.

**Safest approach**: Change electron-builder.yml to use paths relative to the workspace root (where the command is executed from), since Nx runs commands from the workspace root:

```yaml
directories:
  buildResources: apps/ptah-electron/src/assets

mac:
  icon: apps/ptah-electron/src/assets/icons/icon.icns

win:
  icon: apps/ptah-electron/src/assets/icons/icon.ico

linux:
  icon: apps/ptah-electron/src/assets/icons
```

This way, electron-builder finds icons from the source tree (where `electron-icon-builder` generates them). The `buildResources` directive tells electron-builder where to find additional build resources. Since electron-builder runs the actual icon embedding during packaging (not at runtime), it reads from the source location -- which is correct.

The runtime `icon.png` used by `BrowserWindow` comes from the dist copy (via `copy-assets`). These are two separate concerns:

1. **Build time** (electron-builder packaging): reads from source tree via config paths
2. **Runtime** (BrowserWindow icon): reads from dist via `__dirname` + `assets/icons/icon.png`

**Files**:

- `apps/ptah-electron/electron-builder.yml` (MODIFY) -- fix path resolution

### Component 5: .gitignore for Generated Icons

**Purpose**: The master `icon.png` should be committed. Generated `.ico` and `.icns` files should also be committed (they are needed by electron-builder at build time on CI where we may not want to run icon generation). However, if we choose to regenerate on CI, we can gitignore them.

**Decision**: Commit all generated icon files. Running `electron-icon-builder` requires platform-specific tools for `.icns` generation (macOS only for proper icns). Committing the generated files avoids CI complexity.

**Files**:

- No .gitignore changes needed -- commit the generated icons

---

## Part 2: CI/CD Pipeline

### Component 6: GitHub Actions Workflow - `publish-electron.yml`

**Purpose**: Cross-platform Electron builds triggered by tags or manual dispatch, producing unsigned installers uploaded as GitHub Release artifacts.

**Pattern**: Follows existing `publish-extension.yml` structure (evidence: `.github/workflows/publish-extension.yml`) with matrix strategy addition.

**Trigger Strategy**:

```yaml
on:
  push:
    tags:
      - 'v*' # Triggered by version tags like v1.0.0, v0.1.0-beta.1
  workflow_dispatch:
    inputs:
      draft:
        description: 'Create as draft release'
        required: false
        type: boolean
        default: true
```

Using `v*` tags (not `v*-electron`) because:

- This is simpler and more conventional
- The VS Code extension uses branch-based triggering (`release/extension`), not tags
- No tag collision between the two publish workflows

**Matrix Strategy**:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: windows-latest
        build-args: --win
      - os: macos-latest
        build-args: --mac
      - os: ubuntu-latest
        build-args: --linux
```

`fail-fast: false` ensures a failure on one platform does not cancel the others.

**Build Steps** (per matrix runner):

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: actions/setup-node@v4
    with:
      node-version: 20
      cache: 'npm'

  - run: npm ci

  - name: Build Electron app
    run: npx nx build ptah-electron

  - name: Copy renderer
    run: npx nx copy-renderer ptah-electron

  - name: Copy assets
    run: npx nx copy-assets ptah-electron

  - name: Package for platform
    run: npx electron-builder --config apps/ptah-electron/electron-builder.yml --project dist/apps/ptah-electron ${{ matrix.build-args }}
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Upload artifacts
    uses: actions/upload-artifact@v4
    with:
      name: electron-${{ matrix.os }}
      path: release/*
      retention-days: 30
```

**Key design decisions**:

1. **No code signing (Phase 1)**: No `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID` secrets. Users will see "unidentified developer" warnings. This is acceptable for Phase 1 per task requirements.

2. **`GH_TOKEN`**: electron-builder uses this for GitHub Releases publishing. `secrets.GITHUB_TOKEN` is auto-provided by Actions.

3. **Artifact upload**: Each platform uploads to a named artifact (`electron-windows-latest`, etc.) so all builds are retrievable even if release publishing fails.

4. **Release output directory**: electron-builder.yml has `directories.output: ../../release`. With `--project dist/apps/ptah-electron`, output goes to `release/` at workspace root.

**GitHub Release Job** (runs after all matrix builds complete):

```yaml
release:
  needs: build
  runs-on: ubuntu-latest
  if: startsWith(github.ref, 'refs/tags/')
  permissions:
    contents: write
  steps:
    - uses: actions/download-artifact@v4
      with:
        path: artifacts
        merge-multiple: true

    - name: Create GitHub Release
      uses: softprops/action-gh-release@v2
      with:
        draft: ${{ github.event.inputs.draft || true }}
        generate_release_notes: true
        files: |
          artifacts/**/*.exe
          artifacts/**/*.dmg
          artifacts/**/*.zip
          artifacts/**/*.AppImage
          artifacts/**/*.deb
          artifacts/**/latest*.yml
```

This creates a draft release with auto-generated release notes and attaches all platform installers.

**Permissions**:

```yaml
permissions:
  contents: write # Needed for creating releases and uploading assets
```

**macOS-specific considerations for Phase 1 (unsigned)**:

- No notarization -- skip `afterSign` hook
- `hardenedRuntime: true` in electron-builder.yml is fine even without signing (electron-builder skips it when no identity is available)
- `gatekeeperAssess: false` -- already set, correct for unsigned builds

**Files**:

- `.github/workflows/publish-electron.yml` (CREATE)

---

## Files Affected Summary

**CREATE**:

- `apps/ptah-electron/src/assets/icons/icon.png` -- placeholder 1024x1024 master icon
- `apps/ptah-electron/scripts/copy-assets.js` -- asset copy script (mirrors copy-renderer.js pattern)
- `.github/workflows/publish-electron.yml` -- cross-platform CI/CD workflow

**MODIFY**:

- `package.json` -- add `electron-icon-builder` devDependency, add `electron:icons` script
- `apps/ptah-electron/project.json` -- add `copy-assets` target, update `package` dependsOn, update `serve` commands
- `apps/ptah-electron/electron-builder.yml` -- fix icon path resolution for build-time vs runtime separation

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (DevOps focus)

**Rationale**:

- This is infrastructure/build tooling work, not UI development
- Involves Node.js scripts, YAML configuration, webpack awareness
- GitHub Actions workflow authoring
- No Angular or frontend code changes

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 3-5 hours

**Breakdown**:

- Placeholder icon + electron-icon-builder setup: 30 min
- copy-assets.js script: 30 min
- project.json wiring: 30 min
- electron-builder.yml path fixes + verification: 1 hour (path resolution needs testing)
- publish-electron.yml workflow: 1-2 hours
- End-to-end testing (local package run): 30 min

### Critical Verification Points

**Before implementation, the developer MUST verify**:

1. **electron-builder path resolution**: Run `npx nx package ptah-electron` locally after changes and verify electron-builder finds icons. Check the console output for icon-related warnings.

2. **copy-assets output**: After running `npx nx copy-assets ptah-electron`, verify `dist/apps/ptah-electron/assets/icons/icon.png` exists.

3. **Runtime icon loading**: Run `npx nx serve ptah-electron` and verify the window icon appears in the taskbar/dock.

4. **electron-builder.yml paths**: The path resolution behavior depends on whether paths are resolved relative to the config file directory or the `--project` directory. Test empirically:

   - Run `npx electron-builder --config apps/ptah-electron/electron-builder.yml --project dist/apps/ptah-electron --win --dir` (quick dir-only build, no installer)
   - Check if it picks up the icon or errors

5. **CI workflow syntax**: Validate with `actionlint` if available, or at minimum review the YAML structure matches the existing `publish-extension.yml` patterns.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (copy-renderer.js pattern, publish-extension.yml pattern)
- [x] Quality requirements defined (path resolution verification, runtime icon loading)
- [x] Integration points documented (project.json targets, electron-builder config)
- [x] Files affected list complete
- [x] Developer type recommended (backend-developer / DevOps)
- [x] Complexity assessed (MEDIUM, 3-5 hours)
- [x] No step-by-step implementation details (developer implements from specs)
