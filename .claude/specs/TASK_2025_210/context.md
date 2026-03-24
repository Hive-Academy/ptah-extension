# TASK_2025_210: Settings Export/Import + Session Auto-Discovery

## Task Type

FEATURE

## Strategy

Full (PM -> Architect -> Team-Leader -> QA)

## User Intent

Enable data portability between the VS Code extension, Electron desktop app, and Claude Code by:

1. Allowing users to export all Ptah settings (API keys, OAuth tokens, license key, configuration) from the VS Code extension to a JSON file, and import them into the Electron app.
2. Automatically discovering Claude Code / cross-platform sessions so they appear in both apps without manual intervention.

## Feature 1: Settings Export/Import

### VS Code Extension -- Export Command (`ptah.exportSettings`)

- Runs server-side inside VS Code (has access to SecretStorage decryption)
- Exports a JSON file containing:
  - API keys (anthropic, openrouter, moonshot, z-ai, etc.) from SecretStorage
  - OAuth tokens (Claude Copilot) from SecretStorage
  - License key from SecretStorage (`ptah.licenseKey`)
  - VS Code `ptah.*` configuration (default provider, default model, preferences)
- User chooses save location via save dialog
- File is plaintext JSON -- user is warned about security implications

### Electron App -- Import Settings

- UI option to import the exported JSON file
- Reads the file and stores:
  - API keys -> Electron's safeStorage (encrypted)
  - License key -> Electron's safeStorage
  - Config -> Electron's state storage
- After successful import, advises user to DELETE the JSON file (contains plaintext secrets)
- Shows summary of what was imported

## Feature 2: Session Auto-Discovery (BOTH platforms)

Sessions live in `~/.claude/projects/{escaped-workspace-path}/` as JSONL files. Our apps only show sessions that have metadata entries in their storage (`SessionMetadataStore`).

### The Problem

If a user:

- Uses Claude Code and then opens the same workspace in Ptah -- sessions are invisible
- Uses Ptah VS Code and opens same workspace in Ptah Electron -- sessions are invisible
- Uses Ptah Electron and opens same workspace in Ptah VS Code -- sessions are invisible

### The Solution

On workspace open, scan `~/.claude/projects/{workspace-path}/` for JSONL files. For any session file that does NOT have a corresponding metadata entry, create one by reading basic info from the JSONL (first message timestamp, session ID). This way:

- Claude Code sessions appear automatically in Ptah
- VS Code extension sessions appear in Electron app
- Electron sessions appear in VS Code extension

### Critical Constraint

Only sync sessions that have NO existing metadata. Never overwrite existing metadata (which has user-set names, cost tracking, etc.).

## Relevant Codebase Context

### Secret Storage Keys (Verified)

| Key Pattern                       | Service            | Purpose                                            |
| --------------------------------- | ------------------ | -------------------------------------------------- |
| `ptah.licenseKey`                 | LicenseService     | License key                                        |
| `ptah.auth.claudeOAuthToken`      | AuthSecretsService | Copilot OAuth token                                |
| `ptah.auth.anthropicApiKey`       | AuthSecretsService | Anthropic API key                                  |
| `ptah.auth.provider.{providerId}` | AuthSecretsService | Per-provider API keys (openrouter, moonshot, z-ai) |
| `ptah.llm.{provider}.apiKey`      | LlmSecretsService  | LLM provider keys (legacy, currently empty)        |

### Session Infrastructure (Verified)

- `SessionMetadataStore` (agent-sdk): Stores lightweight UI metadata per session
- `SessionImporterService` (agent-sdk): Already scans `~/.claude/projects/` for JSONL files and imports metadata -- **this is Feature 2 already partially implemented**
- `JsonlReaderService` (agent-sdk): Reads JSONL files, finds sessions directory
- `SessionHistoryReaderService` (agent-sdk): Full history reading facade

### Platform Abstraction (Verified)

- `ISecretStorage` (platform-core): Platform-agnostic secret storage interface
- `IStateStorage` (platform-core): Platform-agnostic state storage interface
- `IUserInteraction` (platform-core): Platform-agnostic dialogs/notifications
- `IWorkspaceProvider` (platform-core): Platform-agnostic workspace access
- `IFileSystemProvider` (platform-core): Platform-agnostic file operations
- `PLATFORM_TOKENS` (platform-core): DI tokens for all platform interfaces

### Command Pattern (Verified)

- `LicenseCommands` (ptah-extension-vscode/commands): Injectable class with `registerCommands(context)` method
- Commands registered via `context.subscriptions.push(vscode.commands.registerCommand(...))`
- Uses VS Code dialogs (`vscode.window.showSaveDialog`, `vscode.window.showInformationMessage`)

### Existing Session Import (Verified)

`SessionImporterService.scanAndImport(workspacePath, limit)` already:

- Finds `~/.claude/projects/{escaped-path}/` directory
- Lists `.jsonl` files (excluding `agent-*.jsonl`)
- Sorts by modification time
- Checks if metadata already exists via `metadataStore.get(sessionId)`
- Extracts metadata from first 8KB (session ID from init message, name from first user message)
- Saves metadata via `metadataStore.save()`
- Is called during VS Code extension activation (`main.ts:665-673`)

**Feature 2 already works** via `SessionImporterService` with a default limit of 5 sessions. The enhancement needed is:

- Remove or increase the limit (currently only imports 5 most recent)
- Ensure it also runs in the Electron app on workspace open
- Possibly make the limit configurable
