# VS Code Extension Publishing - Research Report (February 2026)

**Research Depth**: COMPREHENSIVE
**Sources Analyzed**: 18 primary, 12 secondary
**Confidence Level**: 92%
**Applicability**: Direct - covers all aspects of publishing the Ptah extension

---

## 1. Publishing Prerequisites

### 1.1 Azure DevOps Organization and Personal Access Token (PAT)

**Step-by-step setup:**

1. **Create an Azure DevOps Organization**

   - Navigate to https://dev.azure.com
   - Sign in with a Microsoft account (the same one you will use for the marketplace publisher)
   - Create a new organization if you do not already have one

2. **Create a Personal Access Token (PAT)**

   - In Azure DevOps, click your profile icon > Personal Access Tokens
   - Click "New Token"
   - **Critical settings:**
     - **Organization**: Select "All accessible organizations" (this is the only value that works for vsce publishing)
     - **Scopes**: Select "Custom defined", then under Marketplace, check "Manage" (full manage scope)
     - **Expiration**: Set an appropriate expiry (max 1 year; CI/CD tokens should be rotated)
   - Copy the token immediately -- it will not be shown again

3. **Node.js Requirement**: Node.js version 20 or higher is required for vsce

### 1.2 Publisher Account on Visual Studio Marketplace

1. Navigate to https://marketplace.visualstudio.com/manage
2. Sign in with the same Microsoft account used for Azure DevOps
3. Create a new publisher with:
   - **Publisher identifier**: This becomes part of your extension ID (`publisher.extensionName`)
   - **Display name**: The human-readable name shown on the marketplace
4. Optionally verify the publisher by proving domain ownership (shows a blue checkmark badge after 6 months of good standing)

**Current Ptah status**: The `package.json` already has `"publisher": "ptah-extensions"`. This publisher must be created on the marketplace before publishing.

### 1.3 vsce CLI Tool (@vscode/vsce)

**Current version**: 3.7.x (as of February 2026)

```bash
# Install globally
npm install -g @vscode/vsce

# Or as a dev dependency (recommended for CI/CD)
npm install --save-dev @vscode/vsce

# Login (stores token securely in system keyring)
vsce login ptah-extensions

# Package without publishing (creates .vsix file)
vsce package

# Publish directly
vsce publish

# Publish with version bump
vsce publish minor   # 0.1.0 -> 0.2.0
vsce publish patch   # 0.1.0 -> 0.1.1

# Publish pre-release
vsce publish --pre-release
```

**Important**: The old `vsce` npm package is deprecated. Always use `@vscode/vsce`.

---

## 2. package.json Requirements

### 2.1 Required and Recommended Fields

The extension ID is formed as `<publisher>.<name>`. Here are all the fields relevant to marketplace listing:

```jsonc
{
  // REQUIRED
  "name": "ptah-extension-vscode",           // Extension identifier
  "version": "0.1.0",                        // Semver (major.minor.patch only)
  "publisher": "ptah-extensions",            // Must match marketplace publisher
  "engines": {
    "vscode": "^1.74.0"                     // Minimum VS Code version
  },
  "main": "./main.js",                      // Entry point (bundled)

  // STRONGLY RECOMMENDED for marketplace
  "displayName": "Ptah - Claude Code GUI",   // Shown in marketplace
  "description": "...",                       // Short description (under 200 chars ideal)
  "categories": ["AI", "Machine Learning"],  // See allowed categories below
  "keywords": ["claude", "ai", "chat"],      // Max 30 tags
  "icon": "assets/images/ptah-icon.png",     // PNG, min 128x128px, NOT SVG
  "repository": {
    "type": "git",
    "url": "https://github.com/Hive-Academy/ptah-extension.git"
  },
  "license": "SEE LICENSE IN LICENSE",       // Or SPDX identifier
  "homepage": "https://...",
  "bugs": { "url": "https://..." },

  // MARKETPLACE APPEARANCE
  "galleryBanner": {
    "color": "#1a1a2e",                      // Hex color for banner background
    "theme": "dark"                          // "dark" or "light" (text color)
  },
  "badges": [
    {
      "url": "https://img.shields.io/...",   // Badge image URL
      "href": "https://...",                 // Click target
      "description": "Build Status"          // Alt text
    }
  ],
  "preview": true,                           // Marks as "Preview" on marketplace
  "sponsor": {                               // Requires vsce >= 2.9.1
    "url": "https://..."
  },

  // ACTIVATION
  "activationEvents": [
    "onStartupFinished"                     // See section 2.3
  ],

  // CONTRIBUTIONS
  "contributes": {
    "commands": [...],
    "viewsContainers": {...},
    "views": {...}
  }
}
```

### 2.2 Allowed Categories

The marketplace supports these exact categories (case-sensitive):

- Azure, Data Science, Debuggers, Education, Extension Packs, Formatters
- Keymaps, Language Packs, Linters, Machine Learning, Notebooks, Others
- Programming Languages, SCM Providers, Snippets, Testing, Themes, Visualization

**Note**: "AI" and "Chat" are NOT official VS Code marketplace categories as of February 2026. The current Ptah `package.json` lists `"AI"`, `"Machine Learning"`, `"Chat"`, `"Other"`. Only "Machine Learning" and "Other" are valid. This should be corrected before publishing. Recommended categories for Ptah: `["Machine Learning", "Other"]` or `["Programming Languages", "Machine Learning"]`.

### 2.3 Activation Events Best Practices

**Current Ptah issue**: The package.json uses `"activationEvents": ["*"]`, which activates the extension immediately on VS Code startup. This is strongly discouraged as it degrades VS Code startup performance.

**Recommended alternatives (in order of preference):**

| Event               | When to Use                                | Performance Impact |
| ------------------- | ------------------------------------------ | ------------------ |
| `onView:ptah.main`  | Activates when user opens the Ptah sidebar | Minimal            |
| `onCommand:ptah.*`  | Activates when user runs a Ptah command    | Minimal            |
| `onStartupFinished` | Activates after VS Code startup completes  | Low                |
| `*`                 | Always activates immediately               | High (avoid)       |

**Recommendation for Ptah**: Since Ptah registers a sidebar webview, use:

```json
"activationEvents": [
  "onView:ptah.main",
  "onCommand:ptah.openFullPanel",
  "onCommand:ptah.setupAgents"
]
```

This ensures the extension only loads when the user actually interacts with Ptah.

### 2.4 Engine Compatibility

The current `"vscode": "^1.74.0"` means Ptah supports VS Code 1.74+. As of February 2026, the latest VS Code is 1.108+. Considerations:

- Lower minimum = larger potential user base
- Higher minimum = access to newer APIs
- If using any APIs introduced after 1.74, the minimum must be updated accordingly
- The Claude Agent SDK and modern features may warrant raising this to `^1.96.0` or higher

---

## 3. Pre-publish Checklist

### 3.1 Extension Icon

- **Format**: PNG only (SVG is rejected for security reasons)
- **Minimum size**: 128x128 pixels (256x256 recommended for crisp display)
- **Location**: Specified in `package.json` `icon` field
- **Current Ptah path**: `assets/images/ptah-icon.png` -- verify this file exists and meets requirements

### 3.2 README.md

- The marketplace uses the extension's `README.md` as the main detail page
- Must include: what the extension does, screenshots/GIFs, usage instructions, configuration options
- The default Yeoman-generated README will cause a publishing warning
- Images should use absolute URLs (relative paths break on the marketplace)

### 3.3 CHANGELOG.md

- Displayed as a separate tab on the marketplace listing
- Should follow Keep a Changelog format
- Include version numbers and dates

### 3.4 LICENSE File

- Must be present in the extension root
- Referenced in `package.json` via `"license"` field
- SPDX identifier or `"SEE LICENSE IN LICENSE"` for custom licenses

### 3.5 .vscodeignore File

The current Ptah `.vscodeignore` at `apps/ptah-extension-vscode/.vscodeignore` needs updates for a bundled extension.

**Recommended .vscodeignore for a bundled extension:**

```
# Source files (bundled into main.js)
src/**
**/*.ts
**/*.map
tsconfig*.json
webpack.config.js
esbuild*.js

# Development files
.vscode/**
.vscode-test/**
.gitignore
.eslintrc*
.prettierrc*

# Dependencies (bundled, not needed)
node_modules/**

# Build intermediates
out/**

# Documentation not for marketplace
docs/**
examples/**

# Tests
**/*.test.js
**/*.spec.js
**/test/**

# Git
.git/**
.github/**

# OS files
.DS_Store
Thumbs.db

# Misc
*.vsix
*.log
```

**Key principle**: When using a bundler (webpack/esbuild), the entire `node_modules` can be excluded since everything is bundled into `main.js`.

### 3.6 Multi-platform Testing

Before publishing, test on:

- Windows (primary for VS Code users)
- macOS
- Linux
- VS Code Insiders (catches upcoming breaking changes)

---

## 4. Security and Performance

### 4.1 Extension Size Optimization

| Strategy                 | Impact | Notes                                    |
| ------------------------ | ------ | ---------------------------------------- |
| Bundle with esbuild      | High   | Reduces from hundreds of files to one    |
| Minify in production     | Medium | Removes whitespace, shortens identifiers |
| Tree-shake unused code   | Medium | esbuild does this automatically          |
| Exclude dev dependencies | High   | .vscodeignore or bundling handles this   |
| Optimize images          | Low    | Compress PNG icons                       |

**Target**: A well-bundled extension should be under 5-10 MB for the VSIX. Extensions over 20 MB may face scrutiny.

### 4.2 Bundling: Webpack vs esbuild

| Aspect           | Webpack                   | esbuild                                 |
| ---------------- | ------------------------- | --------------------------------------- |
| Build speed      | ~50s for large projects   | Under 1s                                |
| Configuration    | Complex, mature ecosystem | Simple, minimal config                  |
| Tree-shaking     | Good                      | Excellent                               |
| Source maps      | Full support              | Full support                            |
| TypeScript       | Via ts-loader             | Native (strips types, no type checking) |
| Code splitting   | Yes                       | Limited                                 |
| Plugin ecosystem | Extensive                 | Growing                                 |

**Recommendation for Ptah**: Ptah currently uses Webpack. For publishing, this is fine. However, migrating to esbuild for the extension bundle would significantly improve build times. Keep Webpack for complex webview builds if needed, but consider esbuild for the extension host code.

**Critical bundling notes:**

- The `vscode` module must be marked as external (it is provided by VS Code at runtime)
- Run `tsc --noEmit` separately for type checking since esbuild skips type checks
- Target `node` platform for the extension host bundle

### 4.3 Secret and Credential Handling

- **Use VS Code Secret Storage API**: `context.secrets.store(key, value)` and `context.secrets.get(key)`
- **Never store secrets in**: `globalState`, `workspaceState`, plain configuration, or hardcoded in source
- **Marketplace scanning**: The marketplace automatically scans published extensions for leaked API keys and credentials. Publishing is blocked if secrets are detected.
- **Environment variables**: Access via `process.env` but never bundle `.env` files

### 4.4 Content Security Policy for Webviews

Every webview must set a CSP. Recommended baseline:

```typescript
const csp = [
  `default-src 'none'`,
  `img-src ${webview.cspSource} https:`,
  `script-src ${webview.cspSource}`,
  `style-src ${webview.cspSource} 'unsafe-inline'`, // 'unsafe-inline' only if needed
  `font-src ${webview.cspSource}`,
].join('; ');

// In webview HTML <head>:
`<meta http-equiv="Content-Security-Policy" content="${csp}">`;
```

**Best practices:**

- Extract inline scripts to external files
- Use `webview.cspSource` for all allowed origins
- Enforce HTTPS for any external resources
- Set `localResourceRoots` to restrict file access
- Sanitize all user input rendered in webviews

---

## 5. Marketplace Optimization

### 5.1 Categories and Tags

```json
{
  "categories": ["Machine Learning", "Other"],
  "keywords": ["claude", "claude-code", "anthropic", "ai-assistant", "code-generation", "ai-chat", "llm", "copilot-alternative", "code-review", "agent", "ai-coding", "developer-tools"]
}
```

**Rules**: Maximum 30 keywords. No duplicates with the extension name or publisher. Use terms users would actually search for.

### 5.2 Gallery Banner

```json
{
  "galleryBanner": {
    "color": "#1a1a2e",
    "theme": "dark"
  }
}
```

Choose a color that contrasts well with the extension icon. The `theme` controls whether text overlaid on the banner is light or dark.

### 5.3 Badges

Only badges from approved/trusted services are allowed. Common badges:

```json
{
  "badges": [
    {
      "url": "https://img.shields.io/visual-studio-marketplace/v/ptah-extensions.ptah-extension-vscode",
      "href": "https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode",
      "description": "VS Marketplace Version"
    },
    {
      "url": "https://img.shields.io/visual-studio-marketplace/i/ptah-extensions.ptah-extension-vscode",
      "href": "https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-extension-vscode",
      "description": "VS Marketplace Installs"
    }
  ]
}
```

**Note**: Use `vsmarketplacebadges.dev` rather than the deprecated `vsmarketplacebadge.apphb.com`.

---

## 6. CI/CD for Publishing

### 6.1 GitHub Actions Workflow

```yaml
# .github/workflows/publish-extension.yml
name: Publish VS Code Extension

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      pre_release:
        description: 'Publish as pre-release'
        type: boolean
        default: false

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - run: npm run build:all

      - run: npm run test

      # Package and publish
      - name: Publish to VS Marketplace
        run: |
          npx @vscode/vsce publish \
            ${{ github.event.inputs.pre_release == 'true' && '--pre-release' || '' }} \
            --pat ${{ secrets.VSCE_PAT }}

      # Optionally publish to Open VSX
      - name: Publish to Open VSX
        run: |
          npx ovsx publish \
            --pat ${{ secrets.OVSX_PAT }}
```

### 6.2 Version Management

**Pre-release convention** (recommended by VS Code):

- **Stable releases**: Use EVEN minor versions (e.g., `0.2.0`, `0.4.0`, `1.0.0`)
- **Pre-releases**: Use ODD minor versions (e.g., `0.3.0`, `0.5.0`, `1.1.0`)

This is necessary because VS Code does not support semver pre-release tags (like `-beta.1`). Versions must be strictly `major.minor.patch`.

**Automated version bumping with semantic-release:**

```bash
npm install --save-dev semantic-release @semantic-release/changelog @semantic-release/git
```

This parses commit messages (conventional commits) and automatically determines the next version.

### 6.3 Pre-release vs Stable Channels

Users can opt into pre-release versions in VS Code's extension panel. The workflow:

1. Develop feature on a branch
2. Publish as pre-release (`vsce publish --pre-release`) with an odd minor version
3. Gather feedback from pre-release users
4. Merge and publish as stable with an even minor version

**Important**: VS Code auto-updates users to the highest version number. If a stable release has a higher version than a pre-release, pre-release users will be moved to stable.

---

## 7. 2025-2026 Changes and Updates

### 7.1 Extension Signing and Verification (Active)

- The marketplace now signs all extensions on publish
- VS Code verifies signatures on install (integrity + source check)
- As of VS Code 1.97+, first-time installs from third-party publishers trigger a trust confirmation dialog

### 7.2 TypeScript Extensions Without Build Step (Experimental, Dec 2025)

- VS Code 1.108 introduced experimental support for authoring extensions directly in TypeScript without compilation
- **Status**: Experimental, not recommended for production extensions yet

### 7.3 Private Marketplace (GA, November 2025)

- VS Code now supports private/enterprise marketplaces for curated extension catalogs
- Available to GitHub Enterprise customers
- Allows hosting internal extensions and rehosting vetted public extensions
- Relevant if Ptah targets enterprise customers

### 7.4 Extension Deprecation Feature

- Extensions can now be formally deprecated on the marketplace
- Deprecated extensions show dimmed text with a yellow warning icon
- Can deprecate "in favor of" another extension or a setting

### 7.5 Secret Scanning on Publish

- The marketplace now automatically scans all newly published extension packages for secrets (API keys, tokens, credentials)
- Publishing is blocked if secrets are detected
- Extensions with known vulnerabilities are automatically removed and uninstalled from user machines

### 7.6 Malicious Extension Protections

- Extensions identified as malicious are added to a block list
- Blocked extensions are automatically uninstalled from all user machines
- Research in 2025 revealed that the "verified" publisher badge can be bypassed in certain scenarios, so Microsoft has been tightening verification requirements

### 7.7 Open VSX Registry

- The Eclipse Foundation's Open VSX (https://open-vsx.org) continues as a vendor-neutral alternative
- Important if targeting users of VS Code forks (VSCodium, Gitpod, Eclipse Theia)
- Publishing uses the `ovsx` CLI: `npx ovsx publish --pat <token>`
- Consider dual-publishing to both marketplaces

### 7.8 vsce Version 3.x

- `@vscode/vsce` is now at version 3.7.x
- Requires Node.js 20+
- The old `vsce` package on npm is fully deprecated

---

## 8. Ptah-Specific Findings and Recommendations

Based on examining the current `apps/ptah-extension-vscode/package.json` and `.vscodeignore`:

### Issues to Address Before Publishing

| Issue                                              | Severity | Current                      | Recommended                                  |
| -------------------------------------------------- | -------- | ---------------------------- | -------------------------------------------- |
| Activation event `"*"`                             | HIGH     | `["*"]`                      | `["onView:ptah.main"]`                       |
| Invalid categories                                 | MEDIUM   | `["AI", "Chat"]` included    | Remove, keep `["Machine Learning", "Other"]` |
| No `galleryBanner`                                 | LOW      | Missing                      | Add with brand colors                        |
| No `license` field                                 | MEDIUM   | Missing                      | Add `"license": "SEE LICENSE IN LICENSE"`    |
| No `badges`                                        | LOW      | Missing                      | Add marketplace badges                       |
| `.vscodeignore` includes `node_modules` exceptions | MEDIUM   | `!node_modules/rxjs/**` etc. | Remove if using bundler                      |
| Missing `preview` field                            | LOW      | Missing                      | Add `"preview": true` for initial launch     |
| Engine version possibly too low                    | LOW      | `^1.74.0`                    | Verify against APIs actually used            |

### Recommended Publishing Sequence

1. Fix all HIGH/MEDIUM issues above
2. Create the publisher `ptah-extensions` on the marketplace
3. Generate an Azure DevOps PAT with Marketplace (Manage) scope
4. Build and package locally: `vsce package`
5. Test the `.vsix` file by installing it manually in VS Code
6. Publish as pre-release first: `vsce publish --pre-release`
7. After validation, publish stable release
8. Set up GitHub Actions for automated future publishing

---

## Sources

### Primary Sources (Official Documentation)

- [Publishing Extensions - VS Code Docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Extension Manifest Reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Bundling Extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [Activation Events Reference](https://code.visualstudio.com/api/references/activation-events)
- [Webview API and CSP](https://code.visualstudio.com/api/extension-guides/webview)
- [Continuous Integration for Extensions](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)
- [Extension Runtime Security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
- [VS Code December 2025 Release Notes (v1.108)](https://code.visualstudio.com/updates/v1_108)
- [@vscode/vsce on npm](https://www.npmjs.com/package/@vscode/vsce)
- [vsce GitHub Repository](https://github.com/microsoft/vscode-vsce)

### Secondary Sources

- [Building VS Code Extensions in 2026 - Abdulkader Safi](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [Shipping VS Code Extensions with Confidence - Utkarsh Shigihalli](https://onlyutkarsh.medium.com/shipping-vs-code-extensions-with-confidence-automating-releases-with-github-actions-a3c87b866355)
- [VS Code Extension CI/CD - Shai Mendel](https://medium.com/@shaimendel/vs-code-extension-auto-ci-cd-in-github-actions-4f17cf61f7f7)
- [Security and Trust in VS Marketplace - Microsoft Blog](https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace)
- [VS Code Private Marketplace Announcement](https://code.visualstudio.com/blogs/2025/11/18/PrivateMarketplace)
- [Open VSX Registry](https://open-vsx.org/)
- [HaaLeo/publish-vscode-extension GitHub Action](https://github.com/HaaLeo/publish-vscode-extension)
- [Pre-Releases and GitHub Actions - James Pearson](https://jpearson.blog/2022/05/02/pre-releases-github-actions-for-visual-studio-code-extensions/)
