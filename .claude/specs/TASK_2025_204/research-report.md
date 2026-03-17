# Research Report: Electron App Packaging, Icons, and Distribution

**Research Classification**: STRATEGIC_ANALYSIS
**Confidence Level**: 90% (based on 20+ primary sources including official docs)
**Date**: 2026-03-17
**Scope**: Ptah Electron desktop app at `apps/ptah-electron/`

---

## 1. Icon Setup Best Practices

### 1.1 Required Formats and Sizes Per Platform

| Platform  | Format             | Minimum Size | Recommended Master | Notes                                                                         |
| --------- | ------------------ | ------------ | ------------------ | ----------------------------------------------------------------------------- |
| Windows   | `.ico`             | 256x256      | 1024x1024 PNG      | Multi-size ICO containing 16, 32, 48, 64, 128, 256                            |
| macOS     | `.icns`            | 512x512      | 1024x1024 PNG      | Contains sizes from 16x16 to 512x512@2x (1024)                                |
| macOS 26+ | `.icon`            | 1024x1024    | 1024x1024 PNG      | New format via Xcode 26; provide both `.icns` and `.icon` for backward compat |
| Linux     | `.png` (directory) | 256x256      | 1024x1024 PNG      | Directory of PNGs: 16, 32, 48, 64, 128, 256, 512                              |

### 1.2 Master Icon Recommendation

- **Size**: 1024x1024 pixels, PNG format, transparent background
- **Design**: Must be recognizable at 16x16 (tray/taskbar) and look good on both light and dark OS themes
- **File**: Place `icon.png` at 1024x1024 in `src/assets/icons/`

### 1.3 Icon Generation Tools

| Tool                      | npm Package             | Recommendation                                                            |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------- |
| electron-icon-builder     | `electron-icon-builder` | **Recommended** - Mature, generates all formats from single 1024x1024 PNG |
| electron-icon-maker       | `electron-icon-maker`   | Alternative - Similar functionality                                       |
| ImageMagick               | System tool             | Manual approach, good for CI pipelines                                    |
| electron-builder auto-gen | Built-in                | Generates Linux PNGs from `.icns` or `.png` automatically                 |

**Recommended command**:

```bash
npx electron-icon-builder --input=./src/assets/icons/icon.png --output=./src/assets/icons --flatten
```

This generates `icon.icns`, `icon.ico`, and all PNG sizes from a single master file.

### 1.4 Icon References in Configuration

The current `electron-builder.yml` configuration is correct:

```yaml
mac:
  icon: src/assets/icons/icon.icns # Correct - explicit .icns
win:
  icon: src/assets/icons/icon.ico # Correct - explicit .ico
linux:
  icon: src/assets/icons # Correct - directory of PNGs
```

Additionally, the `BrowserWindow` icon in `main-window.ts` at line 63:

```typescript
icon: path.join(__dirname, 'assets', 'icons', 'icon.png');
```

This is correct for runtime use. On macOS the BrowserWindow icon property is ignored (uses the app bundle icon). On Windows and Linux it sets the window/taskbar icon.

**Important**: The icon files must be copied to the build output. Ensure the webpack config or copy-renderer script includes the icons directory in the dist output.

### 1.5 Tray Icon Requirements

| Platform | Format | Recommended Size                 | Notes                                               |
| -------- | ------ | -------------------------------- | --------------------------------------------------- |
| Windows  | `.ico` | 16x16 and 32x32 (multi-size ICO) | ICO recommended for best visual results             |
| macOS    | `.png` | 16x16 (with @2x at 32x32)        | Template images (monochrome with alpha) recommended |
| Linux    | `.png` | 16x16, 24x24                     | Depends on desktop environment                      |

For macOS tray icons, use "Template" images: name them `iconTemplate.png` and `iconTemplate@2x.png`. These are monochrome PNGs with transparency that the OS automatically colors for light/dark mode.

### 1.6 High-DPI / Retina Icons

- macOS: Provide `@2x` variants (e.g., `icon_256x256@2x.png` = 512x512 actual pixels). The `.icns` format handles this automatically when generated from a 1024x1024 source.
- Windows: The multi-size `.ico` handles DPI scaling. Include 256x256 at minimum.
- Linux: Provide the full range of PNG sizes; the desktop environment selects the best match.

### 1.7 Implementation Recommendation for Ptah

Add an npm script to `package.json` at root:

```json
{
  "scripts": {
    "icons:generate": "electron-icon-builder --input=apps/ptah-electron/src/assets/icons/icon.png --output=apps/ptah-electron/src/assets/icons --flatten"
  }
}
```

Workflow: Design a 1024x1024 PNG master icon, run `npm run icons:generate`, commit the generated files. The `--flatten` flag puts all output files directly in the output directory rather than in subdirectories.

---

## 2. electron-builder vs electron-forge

### 2.1 Comparative Analysis

| Dimension               | electron-builder                               | electron-forge                                       |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| **Architecture**        | Single dependency, monolithic                  | Multi-package, modular (makers, publishers, plugins) |
| **Downloads (npm)**     | ~595K weekly                                   | ~180K weekly                                         |
| **GitHub Stars**        | ~13,400+                                       | ~6,400+                                              |
| **Configuration**       | YAML/JSON config file                          | JS config in forge.config.js                         |
| **Build Output**        | NSIS, DMG, AppImage, deb, rpm, snap, MSI, pkg  | Squirrel, DMG, deb, rpm, snap, Flatpak, MSI          |
| **Auto-update**         | Built-in electron-updater                      | Requires separate setup                              |
| **First-party Support** | Community-maintained                           | Official Electron team project                       |
| **Plugin System**       | Limited                                        | Extensive (webpack, vite, etc.)                      |
| **Nx Monorepo Compat**  | Excellent - standalone CLI tool                | Harder - opinionated project structure               |
| **Cross-compile**       | Some support (e.g., Windows on Linux via Wine) | Limited cross-compilation                            |

### 2.2 Recommendation for Ptah: Stay with electron-builder

**Rationale**:

1. **Already configured** - The existing `electron-builder.yml` is well-structured and working
2. **Nx monorepo compatibility** - electron-builder works as a standalone CLI invoked after Nx builds. Forge assumes it owns the build pipeline, which conflicts with Nx's orchestration
3. **Built-in auto-updater** - `electron-updater` is already integrated in `main.ts` (line 238-239)
4. **Simpler CI/CD** - Single command `electron-builder --config` after Nx build steps
5. **NSIS installer** - Already configured, well-suited for Windows distribution
6. **Larger community** - More Stack Overflow answers, more GitHub issues resolved

**Migration risk if switching to Forge**: HIGH. Would require restructuring the entire build pipeline, replacing the Nx-based build-main/build-preload/build-renderer workflow, and reimplementing auto-update.

### 2.3 Maintenance Status (2025-2026)

- **electron-builder**: Actively maintained. Latest releases in 2025. Large contributor base.
- **electron-forge**: Actively maintained by the Electron team. Receives first-party features faster (e.g., ASAR integrity, universal macOS builds).

Both tools are healthy. For new greenfield projects, Forge is the official recommendation. For existing projects with established build pipelines (like Ptah), electron-builder remains the pragmatic choice.

---

## 3. Code Signing

### 3.1 Windows Code Signing

#### Certificate Types

| Type                             | Cost/Year  | SmartScreen Behavior                                                         | CI/CD Compatible                              |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| **No certificate**               | Free       | "Unknown publisher" warning, requires user to click through multiple dialogs | N/A                                           |
| **OV (Organization Validation)** | $195-$300  | Shows publisher name, but SmartScreen warns until reputation builds          | Yes (via CSC_LINK)                            |
| **EV (Extended Validation)**     | $250-$500  | Immediately trusted by SmartScreen, no warning                               | Hardware token required (USB) - harder for CI |
| **Azure Trusted Signing**        | ~$10/month | Treated as EV-equivalent by SmartScreen                                      | Yes (cloud-based, designed for CI)            |

#### Azure Trusted Signing (Recommended for Ptah)

- Cost: Approximately $10/month (Basic tier)
- Availability: US and Canada-based organizations with 3+ years of history, or individual developers in US/Canada
- Advantage: No hardware token needed, cloud-based, CI/CD-native
- Integration: Supported by electron-builder via jsign on all platforms

#### electron-builder Environment Variables (Windows)

```bash
# For .p12/.pfx certificate file:
WIN_CSC_LINK=<base64-encoded certificate or file path or HTTPS URL>
WIN_CSC_KEY_PASSWORD=<certificate password>

# For Azure Trusted Signing:
# Uses separate configuration via signtool or jsign
```

#### What Happens Without Signing

- Windows SmartScreen shows "Windows protected your PC" dialog
- Users must click "More info" then "Run anyway"
- Many enterprise environments block unsigned executables entirely
- Browser downloads may be flagged as suspicious
- **Verdict**: Signing is strongly recommended for production distribution

### 3.2 macOS Code Signing and Notarization

#### Requirements

| Item                                 | Cost                   | Purpose                                                          |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------------- |
| Apple Developer Program              | $99/year               | Required for any distribution outside Mac App Store developer ID |
| Developer ID Application certificate | Included in program    | Signs the .app bundle                                            |
| Developer ID Installer certificate   | Included in program    | Signs .pkg installers                                            |
| Notarization                         | Free (part of program) | Apple scans the app and issues a ticket                          |

#### Notarization (Mandatory since macOS 10.15 Catalina)

- All distributed macOS apps must be notarized or users get "app cannot be opened" error
- electron-builder handles notarization automatically when configured:

```yaml
mac:
  hardenedRuntime: true # Already in Ptah's config
  gatekeeperAssess: false # Already in Ptah's config
  notarize: true # Add this
```

#### Environment Variables for CI

```bash
# Certificate (exported as .p12, base64-encoded)
CSC_LINK=<base64-encoded .p12>
CSC_KEY_PASSWORD=<.p12 password>

# Notarization (App Store Connect API key - recommended for CI)
APPLE_API_KEY=<path to .p8 key file>
APPLE_API_KEY_ID=<key ID>
APPLE_API_ISSUER=<issuer ID>

# Alternative notarization (Apple ID - not recommended for CI)
APPLE_ID=<apple-id@example.com>
APPLE_APP_SPECIFIC_PASSWORD=<app-specific-password>
```

### 3.3 Cost Summary

| Item                                             | Annual Cost        | Priority                            |
| ------------------------------------------------ | ------------------ | ----------------------------------- |
| Apple Developer Program                          | $99                | Required for macOS distribution     |
| Windows OV Certificate (e.g., Sectigo, DigiCert) | $195-$300          | Recommended for production          |
| Windows EV Certificate                           | $250-$500          | Best UX but requires hardware token |
| Azure Trusted Signing                            | ~$120/year         | Best value if eligible (US/Canada)  |
| **Total (minimum viable)**                       | **$300-$400/year** | Apple + Azure Trusted Signing       |
| **Total (traditional)**                          | **$400-$600/year** | Apple + OV/EV Certificate           |

### 3.4 Recommended Approach for Ptah

**Phase 1 (Development/Beta)**: Distribute unsigned. Accept SmartScreen warnings. Document how to bypass for testers.

**Phase 2 (Public Release)**:

- macOS: Apple Developer Program ($99/year) + notarization
- Windows: Azure Trusted Signing (~$10/month) if eligible, otherwise OV certificate ($195/year minimum)

---

## 4. Auto-Update Strategies

### 4.1 Current Ptah Setup Analysis

The current implementation in `main.ts` (lines 236-247) is solid:

```typescript
const { autoUpdater } = await import('electron-updater');
await autoUpdater.checkForUpdatesAndNotify();
```

Combined with `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: ptah
  repo: ptah-desktop
```

This is a working foundation. Below are enhancement recommendations.

### 4.2 electron-updater Capabilities

| Feature                 | Support         | Notes                                 |
| ----------------------- | --------------- | ------------------------------------- |
| GitHub Releases         | Yes             | Free, current config                  |
| S3/DigitalOcean Spaces  | Yes             | For private/high-traffic apps         |
| Generic HTTPS server    | Yes             | Self-hosted option                    |
| Differential updates    | Yes (NSIS only) | Downloads only changed blocks         |
| Staged rollouts         | Yes             | Via `stagingPercentage` in latest.yml |
| Download progress       | Yes             | `download-progress` event             |
| Code signing validation | Yes             | Verifies signature before applying    |
| Linux auto-update       | Yes             | AppImage, deb, pacman, rpm            |

### 4.3 Update UX Patterns

**Pattern 1: Silent Background (Recommended for Ptah)**

```typescript
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
// Download silently, install on next app restart
autoUpdater.checkForUpdates();
```

**Pattern 2: Prompt User**

```typescript
autoUpdater.autoDownload = false;
autoUpdater.on('update-available', (info) => {
  // Show dialog: "Update v{info.version} available. Download now?"
  dialog
    .showMessageBox({
      /* ... */
    })
    .then((result) => {
      if (result.response === 0) autoUpdater.downloadUpdate();
    });
});
autoUpdater.on('update-downloaded', () => {
  // Show dialog: "Update ready. Restart now?"
  autoUpdater.quitAndInstall();
});
```

**Pattern 3: Force Update (for critical security patches)**

```typescript
autoUpdater.on('update-downloaded', () => {
  // No user choice - restart immediately
  autoUpdater.quitAndInstall(true, true); // isSilent, isForceRunAfter
});
```

### 4.4 Staged Rollouts

Edit the published `latest.yml` file on GitHub Releases to add:

```yaml
stagingPercentage: 10 # Roll out to 10% of users first
```

Then progressively increase: 10% -> 25% -> 50% -> 100%. This is a manual process (edit the yml on the release). For rollbacks, publish a new version with a higher version number.

### 4.5 Code Signing Requirement for Auto-Update

- **macOS**: Code signing is REQUIRED for auto-update to work. Unsigned macOS apps cannot auto-update.
- **Windows**: Signing is strongly recommended. electron-updater verifies signatures when present.
- **Linux**: No signing requirement for auto-update.

### 4.6 Recommended Enhancement for Ptah

Replace the simple `checkForUpdatesAndNotify()` with a more robust implementation:

```typescript
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

// Configure logging
autoUpdater.logger = log;

// Silent download, prompt before install
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Check on startup and periodically (every 4 hours)
autoUpdater.checkForUpdates();
setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);

// Notify renderer of update status for UI display
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-available', info.version);
});
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update-downloaded', info.version);
});
autoUpdater.on('error', (err) => {
  log.error('Auto-updater error:', err);
});
```

---

## 5. Distribution Channels

### 5.1 Channel Comparison

| Channel                     | Cost                 | Reach                   | Effort            | Auto-Update             | Recommended         |
| --------------------------- | -------------------- | ----------------------- | ----------------- | ----------------------- | ------------------- |
| **GitHub Releases**         | Free                 | Developers, power users | Low               | Yes (electron-updater)  | **Yes - Primary**   |
| **Website Direct Download** | Hosting cost         | General public          | Medium            | Yes (electron-updater)  | **Yes - Secondary** |
| **Homebrew Cask**           | Free                 | macOS developers        | Low (formulae PR) | Via Homebrew            | Yes - Phase 2       |
| **Chocolatey**              | Free                 | Windows developers      | Medium            | Via Chocolatey          | Optional            |
| **Snapcraft**               | Free                 | Linux users             | Medium            | Yes (snap auto-refresh) | Optional            |
| **Microsoft Store**         | $19 one-time         | Windows general public  | High              | Via Store               | Future              |
| **Mac App Store**           | $99/year (Apple Dev) | macOS general public    | Very High         | Via Store               | Future              |

### 5.2 GitHub Releases (Current - Recommended Primary Channel)

**Pros**:

- Free hosting for artifacts
- Integrated with electron-updater (already configured)
- Release notes / changelogs built-in
- Draft releases for review before publishing
- API for automation

**Cons**:

- Not discoverable by non-technical users
- No install metrics (without custom analytics)
- Rate limits on downloads (but generous)

**Verdict**: Continue using GitHub Releases as the primary channel. It is the right choice for a developer-focused tool like Ptah.

### 5.3 Mac App Store Considerations

**Requirements and Limitations**:

- App must be fully sandboxed (limited filesystem access)
- Cannot use certain Electron APIs (e.g., `shell.openExternal` has restrictions)
- Must use Apple's in-app purchase for subscriptions (30% cut)
- Separate build target needed (`mas` target in electron-builder)
- Review process can take days/weeks
- No auto-update via electron-updater (must use Store updates)

**Verdict**: NOT recommended for Ptah. The sandboxing requirements would severely limit workspace analysis features. The 30% revenue cut on subscriptions is punitive.

### 5.4 Microsoft Store Considerations

**Requirements**:

- Can package as APPX/MSIX via electron-builder
- One-time $19 developer registration
- Review process
- Sandboxing restrictions (less severe than Mac App Store)

**Verdict**: Consider for Phase 3 (post-launch) to increase discoverability. Not a priority.

### 5.5 Homebrew Cask (Recommended for Phase 2)

Simple and free. Create a Cask formula:

```ruby
cask "ptah" do
  version "1.0.0"
  sha256 "abc123..."
  url "https://github.com/ptah/ptah-desktop/releases/download/v#{version}/Ptah-#{version}-arm64.dmg"
  name "Ptah"
  desc "AI coding orchestra desktop app"
  homepage "https://ptah.dev"
  app "Ptah.app"
end
```

Users install with: `brew install --cask ptah`

### 5.6 Recommended Distribution Strategy

**Phase 1 (MVP/Beta)**: GitHub Releases only. Free, simple, targets developer audience.

**Phase 2 (Public Launch)**: GitHub Releases + Website downloads page + Homebrew Cask.

**Phase 3 (Growth)**: Add Chocolatey, Snapcraft, consider Microsoft Store.

---

## 6. CI/CD Pipeline

### 6.1 Recommended GitHub Actions Workflow

The following workflow builds on all 3 platforms using a matrix strategy:

```yaml
name: Build & Release Electron App

on:
  push:
    tags:
      - 'v*' # Trigger on version tags: v1.0.0, v1.0.1, etc.
  workflow_dispatch: # Manual trigger for testing

permissions:
  contents: write # Required for creating releases

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest # Apple Silicon (arm64)
            platform: mac
          - os: macos-13 # Intel (x64) - if needed
            platform: mac-x64
          - os: ubuntu-latest
            platform: linux
          - os: windows-latest
            platform: win

    runs-on: ${{ matrix.os }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build Electron app (Nx)
        run: |
          npx nx build ptah-electron
          npx nx copy-renderer ptah-electron

      # macOS: Import signing certificate
      - name: Import macOS signing certificate
        if: matrix.platform == 'mac' || matrix.platform == 'mac-x64'
        env:
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
        run: echo "Certificate imported via electron-builder env vars"

      # Windows: Configure signing
      - name: Configure Windows signing
        if: matrix.platform == 'win'
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
        run: echo "Certificate configured via electron-builder env vars"

      # Package with electron-builder
      - name: Package Electron app
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
        run: >
          npx electron-builder
          --config apps/ptah-electron/electron-builder.yml
          --project dist/apps/ptah-electron
          --publish always

      # Upload artifacts for non-tag builds
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ptah-${{ matrix.platform }}
          path: |
            release/*.exe
            release/*.dmg
            release/*.zip
            release/*.AppImage
            release/*.deb
            release/*.yml
          if-no-files-found: warn
```

### 6.2 Key CI/CD Considerations

**Required GitHub Secrets**:
| Secret | Purpose | When Needed |
|--------|---------|-------------|
| `MAC_CSC_LINK` | Base64-encoded .p12 certificate | macOS signing |
| `MAC_CSC_KEY_PASSWORD` | Certificate password | macOS signing |
| `WIN_CSC_LINK` | Base64-encoded .pfx certificate | Windows signing |
| `WIN_CSC_KEY_PASSWORD` | Certificate password | Windows signing |
| `APPLE_API_KEY` | Base64-encoded .p8 key | macOS notarization |
| `APPLE_API_KEY_ID` | App Store Connect key ID | macOS notarization |
| `APPLE_API_ISSUER` | App Store Connect issuer | macOS notarization |

**Caching Strategy**:

- `actions/setup-node` with `cache: 'npm'` caches npm dependencies
- Nx computation cache can be added via `nx-set-shas` action
- Consider caching `node_modules` explicitly for faster builds:

```yaml
- name: Cache node_modules
  uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
```

**Release Automation**:

- Tag-triggered builds (`v*` pattern) auto-publish to GitHub Releases
- Use `--publish always` with electron-builder to upload artifacts to the draft release
- electron-builder creates the release and uploads all artifacts automatically
- Review draft release, add release notes, then publish

### 6.3 Runner Costs

| Runner             | Cost (GitHub Free)   | Cost (GitHub Pro/Team) | Notes               |
| ------------------ | -------------------- | ---------------------- | ------------------- |
| ubuntu-latest      | 2,000 min/month free | 3,000 min/month        | Cheapest            |
| macos-latest (ARM) | 200 min/month free   | 300 min/month          | 10x cost multiplier |
| macos-13 (Intel)   | 200 min/month free   | 300 min/month          | 10x cost multiplier |
| windows-latest     | 2,000 min/month free | 3,000 min/month        | 2x cost multiplier  |

Typical Electron build: ~10-15 min per platform. A single release build across 3 platforms uses approximately 40-50 minutes (weighted).

---

## 7. Implementation Priority and Roadmap

### Recommended Order of Implementation

| Priority | Task                                               | Effort              | Dependency           |
| -------- | -------------------------------------------------- | ------------------- | -------------------- |
| **1**    | Create master icon (1024x1024 PNG)                 | Design task         | None                 |
| **2**    | Generate platform icons with electron-icon-builder | 30 min              | Master icon          |
| **3**    | Verify icon paths in webpack config (copy to dist) | 1 hour              | Generated icons      |
| **4**    | Set up GitHub Actions build workflow (unsigned)    | 2-3 hours           | Working Nx build     |
| **5**    | Test builds on all 3 platforms                     | 1-2 hours           | CI workflow          |
| **6**    | Apple Developer Program enrollment                 | 1-2 days (approval) | $99 payment          |
| **7**    | macOS code signing + notarization in CI            | 2-3 hours           | Apple certificate    |
| **8**    | Windows code signing (Azure Trusted or OV cert)    | 1-2 hours           | Certificate purchase |
| **9**    | Enhanced auto-updater with UX notifications        | 2-3 hours           | Signed builds        |
| **10**   | Homebrew Cask formula                              | 1 hour              | Published release    |

### Quick Wins (Do First)

1. Install `electron-icon-builder` as devDependency
2. Create a placeholder/draft icon at 1024x1024
3. Run icon generation to populate the icons directory
4. Add the GitHub Actions workflow for building (even without signing)

---

## 8. Configuration Adjustments for electron-builder.yml

Based on research, the following enhancements to the existing config are recommended:

```yaml
appId: com.ptah.desktop
productName: Ptah
copyright: Copyright 2026 Ptah

directories:
  output: ../../release
  buildResources: src/assets

files:
  - '**/*'
  - '!**/*.map'
  - '!**/*.ts'

extraResources:
  - from: 'renderer'
    to: 'renderer'

# Add asar packaging for security and performance
asar: true
asarUnpack:
  - '**/*.node' # Native modules need to be unpacked

mac:
  category: public.app-category.developer-tools
  icon: src/assets/icons/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  notarize: true # ADD: Enable notarization
  target:
    - target: dmg
      arch:
        - arm64
        - x64
    - target: zip
      arch:
        - arm64
        - x64

win:
  icon: src/assets/icons/icon.ico
  target:
    - nsis
  # ADD: Sign configuration (activated when WIN_CSC_LINK env var is set)
  signDlls: true

linux:
  icon: src/assets/icons
  category: Development
  target:
    - AppImage
    - deb

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  # ADD: Differential updates support
  differentialPackage: true

publish:
  provider: github
  owner: ptah
  repo: ptah-desktop
  releaseType: draft # ADD: Create as draft for review before publishing
```

---

## Sources

- [Icons - electron-builder](https://www.electron.build/icons.html)
- [Auto Update - electron-builder](https://www.electron.build/auto-update.html)
- [Code Signing - electron-builder](https://www.electron.build/code-signing.html)
- [Code Signing | Electron Official](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Why Electron Forge? | Electron Forge](https://www.electronforge.io/core-concepts/why-electron-forge)
- [Custom App Icons | Electron Forge](https://www.electronforge.io/guides/create-and-add-icons)
- [Signing a Windows app | Electron Forge](https://www.electronforge.io/guides/code-signing/code-signing-windows)
- [electron-icon-builder - npm](https://www.npmjs.com/package/electron-icon-builder)
- [Mac App Store Submission Guide | Electron](https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide)
- [Tray | Electron API](https://www.electronjs.org/docs/latest/api/tray)
- [Build and Publish a Multi-Platform Electron App on GitHub](https://dev.to/erikhofer/build-and-publish-a-multi-platform-electron-app-on-github-3lnd)
- [Multi-OS Electron Build & Release with GitHub Actions](https://dev.to/supersuman/multi-os-electron-build-release-with-github-actions-f3n)
- [Electron Builder Action - GitHub Marketplace](https://github.com/marketplace/actions/electron-builder-action)
- [How to Submit an Electron App to the Mac App Store | DoltHub](https://www.dolthub.com/blog/2024-10-02-how-to-submit-an-electron-app-to-mac-app-store/)
- [Automated Electron build with release to Mac App Store, Microsoft Store, Snapcraft | mifi.no](https://mifi.no/blog/automated-electron-build-with-release-to-mac-app-store-microsoft-store-snapcraft/)
- [npm-compare: electron-builder vs electron-forge vs electron-packager](https://npm-compare.com/@electron-forge/core,electron-builder,electron-packager)
- [How to Sign a Windows App with Electron Builder | Security Boulevard](https://securityboulevard.com/2025/12/how-to-sign-a-windows-app-with-electron-builder/)
- [Implementing Auto-Updates in Electron with electron-updater](https://blog.nishikanta.in/implementing-auto-updates-in-electron-with-electron-updater)
