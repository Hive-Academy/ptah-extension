# PTAH PROJECT SPECIFICS

## Project Overview

**Ptah** is an AI coding orchestra for VS Code, powered by Claude Agent SDK. Built with TypeScript and Angular webviews, it provides intelligent workspace analysis, project-adaptive AI agents, and a built-in MCP server — all natively integrated into VS Code.

---

## VS Code Marketplace Publishing Rules (BLOCKING — READ BEFORE ANY PUBLISH WORK)

The VS Code Marketplace has an automated "suspicious content" scanner that rejects extensions. These rules were learned through extensive trial-and-error (TASK_2025_245, TASK_2025_247, TASK_2025_248) and are **non-negotiable**.

### Extension Identity

- **Publisher**: `ptah-extensions`
- **Extension ID**: `ptah-coding-orchestra`
- **Display Name**: `Ptah - The Coding Orchestra`
- **Marketplace URL**: `https://marketplace.visualstudio.com/items?itemName=ptah-extensions.ptah-coding-orchestra`

### What the Scanner Flags (Confirmed)

1. **Trademarked AI product names in text files** — The scanner pattern-matches ALL non-JS text files (README, LICENSE, markdown, JSON metadata). Terms that trigger rejection: `copilot`, `codex`, `claude`, `openai`, `anthropic`, and likely others like `GitHub Copilot`, `OpenAI Codex`. **The scanner does NOT check JS bundles** — main.mjs can contain these terms safely.

2. **LICENSE.md** — Our FSL license file triggers the scanner. It is excluded from the VSIX via `.vscodeignore` and the copy step is removed from `project.json`. **Never re-add LICENSE.md to the VSIX build.**

3. **Plugin/Template markdown files** — The 197 plugin files and 14 template files contain hundreds of trademarked terms. They are **never bundled in the VSIX** — they are downloaded from GitHub at runtime via `ContentDownloadService` (TASK_2025_248). **Never re-add plugins or templates to the VSIX build assets.**

4. **README with external links or product names** — Even a "clean" README can fail if it contains marketplace URLs, GitHub links, or mentions products by name. The current README is intentionally minimal. **Do not add external URLs, product names, or detailed feature descriptions to the README without incremental marketplace testing.**

### What Passes Safely

- **main.mjs** (JS bundle) — The scanner ignores JS content. 600+ trademarked strings in the bundle are fine.
- **package.json settings** — Configuration properties with `gemini`, `google` references pass. Properties with `copilot`, `codex`, `claude`, `openai` were moved to file-based settings (`~/.ptah/settings.json`) in TASK_2025_247.
- **Webview JS chunks** — Angular SPA build output passes even with trademarked strings.
- **WASM files** — Tree-sitter WASM binaries pass.
- **Basic README** — Short markdown without links or product names passes.

### ID Blocklist Rule

**Once an extension ID fails marketplace validation, that ID is permanently burned.** All subsequent version uploads under that ID will be auto-rejected regardless of content. Always test with a throwaway ID first before publishing under the real ID.

### Pre-Publish Checklist

Before ANY marketplace publish:

1. `grep -ric "copilot\|codex\|claude\|openai\|anthropic" dist/apps/ptah-extension-vscode/README.md` → must be **0**
2. `ls dist/apps/ptah-extension-vscode/LICENSE*` → must be **not found**
3. `ls dist/apps/ptah-extension-vscode/assets/plugins/` → must be **not found**
4. `ls dist/apps/ptah-extension-vscode/templates/` → must be **not found**
5. `npx @vscode/vsce ls` in dist → verify no `.md` files except README, no `.py` files
6. **Test with a throwaway extension ID first** — never risk the real ID on untested content

### VSIX Exclusions (.vscodeignore)

These exclusions are critical and must never be removed:

```
**/assets/plugins/**    # Plugins downloaded from GitHub at runtime
**/templates/**         # Templates downloaded from GitHub at runtime
LICENSE.md              # FSL license triggers scanner
**/*.py                 # Python scripts flagged by scanner
**/assets/monaco/**     # Monaco eval() patterns
```

### File-Based Settings (TASK_2025_247)

Provider settings with trademarked names were moved from `package.json contributes.configuration` to `~/.ptah/settings.json`. The routing is transparent — `IWorkspaceProvider.getConfiguration()` checks `FILE_BASED_SETTINGS_KEYS` and routes to `PtahFileSettingsManager` automatically. **Never add settings with copilot/codex/claude/openai in their keys back to package.json.**

### Plugin/Template GitHub Download (TASK_2025_248)

Plugins and templates are downloaded from the public GitHub repo to `~/.ptah/plugins/` and `~/.ptah/templates/` via `ContentDownloadService`. The `content-manifest.json` at the repo root lists all files. Run `node scripts/generate-content-manifest.js` before releases to update the manifest. **Never re-add plugin or template asset copies to project.json.**

---

## Development Commands

### Core Extension Development

```bash
# Install dependencies
npm install

# Compile TypeScript (main extension)
npm run compile

# Watch mode for development
npm run watch

# Lint TypeScript code
npm run lint

# Run tests
npm run test

# Build everything (extension + webview)
npm run build:all

# Quality gates (linting & typechecking)
npm run lint:all
npm run typecheck:all
```

### License Server & Database

```bash
# Start database services (PostgreSQL + Redis)
npm run docker:db:start

# Run Prisma migrations
npm run prisma:migrate:dev

# Open Prisma Studio
npm run prisma:studio

# Start license server
nx serve ptah-license-server
```

## Library Documentation

Each library has a dedicated `CLAUDE.md` with architecture details. Navigate to `libs/<category>/<library>/CLAUDE.md` or `apps/<app>/CLAUDE.md`.

> **Note**: Tech stack, architecture layers, dependency rules, design decisions, import aliases, testing strategy, and build system details are already provided in the system prompt — not duplicated here.

## **IMPORTANT**: There's a file modification bug in Claude Code. The workaround is: always use complete absolute Windows paths with drive letters and backslashes for ALL file operations. Always use full paths for all of our Read/Write/Modify operations

## Orchestration

Orchestration workflow details are provided in the system prompt. Skill: `.claude/skills/orchestration/SKILL.md`, Command: `/orchestrate [task]`.
