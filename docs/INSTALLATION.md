# Ptah - Coding Orchestra | Installation Guide

> Install and configure Ptah for staging/testing or production use on any machine.

---

## Table of Contents

- [System Requirements](#system-requirements)
- [Installation Methods](#installation-methods)
  - [Method 1: Install from VSIX (Staging / Pre-release)](#method-1-install-from-vsix-staging--pre-release)
  - [Method 2: VS Code Marketplace (Production)](#method-2-vs-code-marketplace-production)
- [Initial Setup](#initial-setup)
  - [1. Open Ptah](#1-open-ptah)
  - [2. Configure Authentication](#2-configure-authentication)
  - [3. Set Up Agents](#3-set-up-agents)
  - [4. Enter License Key (Optional)](#4-enter-license-key-optional)
- [Configuration Reference](#configuration-reference)
  - [Authentication](#authentication)
  - [Model Selection](#model-selection)
  - [Autopilot Mode](#autopilot-mode)
  - [Agent Orchestration](#agent-orchestration)
  - [Context & Performance](#context--performance)
  - [LLM Tools](#llm-tools)
- [Building a Staging VSIX](#building-a-staging-vsix)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

---

## System Requirements

| Requirement | Minimum                   | Recommended              |
| ----------- | ------------------------- | ------------------------ |
| **VS Code** | 1.74.0                    | Latest stable            |
| **OS**      | Windows 10+, macOS, Linux | Windows 11, macOS 14+    |
| **Node.js** | 20.x (for CLI agents)     | 22.x LTS                 |
| **RAM**     | 4 GB                      | 8 GB+                    |
| **Disk**    | 50 MB (extension)         | 200 MB (with CLI agents) |

**Optional dependencies** (for specific features):

| Tool           | Required For                     |
| -------------- | -------------------------------- |
| Gemini CLI     | Gemini agent orchestration       |
| GitHub Copilot | Copilot agent orchestration      |
| Docker         | Local license server development |

---

## Installation Methods

### Method 1: Install from VSIX (Staging / Pre-release)

Use this method to test a pre-release build on any machine before publishing to the marketplace.

**Step 1 — Obtain the `.vsix` file**

Copy the packaged file to the target machine:

```
ptah-extension-vscode-0.1.0.vsix  (~2.5 MB)
```

> See [Building a Staging VSIX](#building-a-staging-vsix) to create this file from source.

**Step 2 — Install via VS Code UI**

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Type **"Extensions: Install from VSIX..."** and select it
4. Browse to and select the `.vsix` file
5. Click **Install** when prompted
6. Reload VS Code when prompted

**Step 2 (alternative) — Install via terminal**

```bash
code --install-extension ptah-extension-vscode-0.1.0.vsix
```

> If `code` is not in your PATH, use the full VS Code path:
>
> - **Windows**: `"C:\Users\<user>\AppData\Local\Programs\Microsoft VS Code\bin\code" --install-extension ptah-extension-vscode-0.1.0.vsix`
> - **macOS**: `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code --install-extension ptah-extension-vscode-0.1.0.vsix`

**Step 3 — Verify installation**

- Look for the **Ptah icon** in the Activity Bar (left sidebar)
- Open the Command Palette (`Ctrl+Shift+P`) and type "Ptah" — you should see Ptah commands listed

---

### Method 2: VS Code Marketplace (Production)

> _Available once the extension is published to the marketplace._

1. Open VS Code
2. Click the **Extensions** icon in the Activity Bar (or press `Ctrl+Shift+X`)
3. Search for **"Ptah - Coding Orchestra"**
4. Click **Install**

---

## Initial Setup

### 1. Open Ptah

Click the **Ptah icon** in the Activity Bar to open the chat sidebar. You can also run:

- `Ctrl+Shift+P` → **"Ptah: Open Full Ptah Panel"** — opens Ptah in an editor panel for a larger workspace

### 2. Configure Authentication

Ptah supports multiple authentication methods. Configure via VS Code Settings (`Ctrl+,`) → search "ptah":

| Method         | Setting Value | How to Set Up                                |
| -------------- | ------------- | -------------------------------------------- |
| **Auto**       | `auto`        | Tries OpenRouter → OAuth → API Key (default) |
| **OpenRouter** | `openrouter`  | Enter your OpenRouter API key when prompted  |
| **OAuth**      | `oauth`       | Authenticates via browser-based OAuth flow   |
| **API Key**    | `apiKey`      | Direct Anthropic/provider API key            |

Set the method:

```
Settings → ptah.authMethod → select your preferred method
```

To change the Anthropic-compatible provider:

```
Settings → ptah.anthropicProviderId → openrouter | moonshot | z-ai
```

### 3. Set Up Agents

Run the agent setup wizard:

1. `Ctrl+Shift+P` → **"Ptah: Setup Ptah Agents"**
2. Follow the 6-step wizard:
   - Codebase scanning
   - Project analysis
   - Agent selection
   - Rule generation
   - Configuration review
   - Confirmation

This generates project-adaptive AI agents tailored to your workspace.

### 4. Enter License Key (Optional)

For Pro features (enhanced prompts, advanced analytics):

1. `Ctrl+Shift+P` → **"Ptah: Enter License Key"**
2. Paste your license key
3. Verify with **"Ptah: Check License Status"**

---

## Configuration Reference

All settings are accessible via `Ctrl+,` → search **"ptah"**.

### Authentication

| Setting                    | Type   | Default      | Description                                          |
| -------------------------- | ------ | ------------ | ---------------------------------------------------- |
| `ptah.authMethod`          | enum   | `auto`       | Authentication method (auto/oauth/apiKey/openrouter) |
| `ptah.anthropicProviderId` | enum   | `openrouter` | Anthropic-compatible provider                        |
| `ptah.apiUrl`              | string | `null`       | Override license server URL (for dev)                |

### Model Selection

| Setting                                                | Type   | Default                    | Description                     |
| ------------------------------------------------------ | ------ | -------------------------- | ------------------------------- |
| `ptah.model.selected`                                  | string | `claude-sonnet-4-20250514` | Default Claude model            |
| `ptah.provider.openrouter.modelTier.sonnet`            | string | `null`                     | OpenRouter Sonnet tier override |
| `ptah.provider.openrouter.modelTier.opus`              | string | `null`                     | OpenRouter Opus tier override   |
| `ptah.provider.openrouter.modelTier.haiku`             | string | `null`                     | OpenRouter Haiku tier override  |
| `ptah.provider.moonshot.modelTier.[sonnet/opus/haiku]` | string | `null`                     | Moonshot model tier overrides   |
| `ptah.provider.z-ai.modelTier.[sonnet/opus/haiku]`     | string | `null`                     | Z.AI model tier overrides       |

### Autopilot Mode

| Setting                          | Type    | Default | Description                                  |
| -------------------------------- | ------- | ------- | -------------------------------------------- |
| `ptah.autopilot.enabled`         | boolean | `false` | Enable autopilot for automatic file edits    |
| `ptah.autopilot.permissionLevel` | enum    | `ask`   | Permission level: `ask`, `auto-edit`, `yolo` |

### Agent Orchestration

| Setting                                       | Type   | Default | Description                           |
| --------------------------------------------- | ------ | ------- | ------------------------------------- |
| `ptah.agentOrchestration.preferredAgentOrder` | array  | `[]`    | Preferred agent spawn order           |
| `ptah.agentOrchestration.maxConcurrentAgents` | number | `5`     | Max concurrent agent processes (1-10) |
| `ptah.agentOrchestration.geminiModel`         | string | `""`    | Gemini model override                 |
| `ptah.agentOrchestration.copilotModel`        | enum   | `""`    | Copilot model override                |
| `ptah.ptahCliAgents`                          | array  | `[]`    | Custom Ptah CLI agent configurations  |

### Context & Performance

| Setting                        | Type    | Default  | Description                                     |
| ------------------------------ | ------- | -------- | ----------------------------------------------- |
| `ptah.compaction.enabled`      | boolean | `true`   | Auto-compact long conversations                 |
| `ptah.compaction.threshold`    | number  | `100000` | Token threshold for compaction (50k-500k)       |
| `ptah.enhancedPrompts.enabled` | boolean | `true`   | Project-specific enhanced prompts (Pro license) |

### LLM Tools

| Setting                    | Type   | Default          | Description                        |
| -------------------------- | ------ | ---------------- | ---------------------------------- |
| `ptah.llm.defaultProvider` | enum   | `vscode-lm`      | Default LLM provider for MCP tools |
| `ptah.llm.vscode.model`    | string | `copilot/gpt-4o` | Default VS Code LM model           |

---

## Building a Staging VSIX

Build a `.vsix` package from source for staging/testing.

### Prerequisites

```bash
# Clone the repository
git clone https://github.com/Hive-Academy/ptah-extension.git
cd ptah-extension

# Install dependencies
npm install
```

### Build and Package

```bash
# Option 1: Full automated pipeline (build + package)
npx nx run ptah-extension-vscode:package

# Option 2: Step-by-step
npm run build                                    # Build extension + webview + libs
cd dist/apps/ptah-extension-vscode
npm install --omit=dev --ignore-scripts          # Install runtime deps
npx @vscode/vsce package --no-dependencies       # Create .vsix
```

The `.vsix` file is created at:

```
dist/apps/ptah-extension-vscode/ptah-extension-vscode-<version>.vsix
```

### Distributing the VSIX

Transfer the `.vsix` file to the target machine via:

- File share / USB drive
- Cloud storage (OneDrive, Google Drive, etc.)
- Internal artifact repository
- Email (if under 25 MB)

Then follow [Method 1](#method-1-install-from-vsix-staging--pre-release) to install.

---

## Uninstalling

**Via VS Code UI:**

1. Open Extensions (`Ctrl+Shift+X`)
2. Find "Ptah - Coding Orchestra"
3. Click the gear icon → **Uninstall**
4. Reload VS Code

**Via terminal:**

```bash
code --uninstall-extension ptah-extensions.ptah-coding-orchestra
```

---

## Troubleshooting

### Extension not appearing in Activity Bar

- Verify installation: `Ctrl+Shift+X` → search "Ptah" under Installed
- Check VS Code version: Ptah requires VS Code 1.74.0+
- Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"

### Webview shows blank or fails to load

- Open DevTools: `Ctrl+Shift+P` → "Developer: Toggle Developer Tools"
- Check the Console tab for errors
- Ensure the extension was built correctly (webview files should be bundled in the `.vsix`)
- Try reinstalling from the `.vsix`

### Authentication issues

- **OpenRouter**: Verify your API key is valid at [openrouter.ai](https://openrouter.ai)
- **OAuth**: Ensure your browser allows pop-ups from VS Code
- **API Key**: Check the key has appropriate permissions for the selected provider
- Reset auth: `Ctrl+Shift+P` → "Ptah: Remove License Key", then re-enter

### CLI agents not detected

- Verify the CLI tool is installed and in your system PATH:
  ```bash
  gemini --version     # For Gemini CLI
  copilot --version    # For GitHub Copilot CLI
  ```
- On Windows, CLI tools installed via npm are `.cmd` wrappers — Ptah handles this automatically
- Check `ptah.agentOrchestration.preferredAgentOrder` in settings

### Extension crashes or errors on activation

- Check the Output panel: `Ctrl+Shift+U` → select "Ptah" from the dropdown
- Check the Extension Host log: `Ctrl+Shift+U` → select "Extension Host"
- If installed from VSIX, ensure the package was built with all dependencies

### VSIX packaging fails

- Ensure `@vscode/vsce` is installed: `npm install --save-dev @vscode/vsce`
- Ensure Node.js 20+ is installed: `node --version`
- Run `npm run build` before packaging to ensure all outputs exist
- Check that `dist/apps/ptah-extension-vscode/` contains `main.js`, `package.json`, and the `webview/` directory
