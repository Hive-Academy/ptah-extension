# apps/ptah-extension-vscode - Main VS Code Extension

## Purpose

Main VS Code extension providing complete visual interface for Claude Code CLI through Angular webviews, commands, and backend orchestration.

## Architecture

```
Extension Activation
    ↓
DIContainer.setup()
    ↓
Register Domain Services (hierarchical)
├── workspace-intelligence
├── ai-providers-core
├── claude-domain
└── App services
    ↓
PtahExtension.initialize()
    ├── Register Commands
    ├── Register Webviews
    └── Setup EventBus
```

## Key Components

- **PtahExtension** (`src/core/ptah-extension.ts`): Main coordinator
- **CommandHandlers** (`src/handlers/command-handlers.ts`): All VS Code commands
- **AngularWebviewProvider** (`src/providers/angular-webview.provider.ts`): Webview lifecycle
- **AnalyticsDataCollector** (`src/services/analytics-data-collector.ts`): Real system metrics
- **CommandBuilderService** (`src/services/command-builder.service.ts`): Template management

## Commands

- `ptah.quickChat`: Quick chat interface
- `ptah.reviewCurrentFile`: Code review workflow
- `ptah.generateTests`: Test generation
- `ptah.buildCommand`: Visual command builder
- `ptah.newSession`: Create new chat session
- `ptah.includeFile` / `ptah.excludeFile`: Context management
- `ptah.showAnalytics`: Analytics dashboard
- `ptah.openFullPanel`: Full panel mode

## Configuration

```jsonc
{
  // Claude CLI
  "ptah.claudeCliPath": "claude",
  "ptah.defaultProvider": "anthropic",
  "ptah.claude.model": "claude-3-sonnet-20241022",
  "ptah.claude.temperature": 0.1,
  "ptah.maxTokens": 200000,

  // Context
  "ptah.autoIncludeOpenFiles": true,
  "ptah.contextOptimization": true,
  "ptah.context.maxFileSize": 1048576,

  // Streaming
  "ptah.streaming.bufferSize": 8192,
  "ptah.streaming.chunkSize": 1024
}
```

## Testing

Press **F5** to launch Extension Development Host.

## File Locations

- **Core**: `src/core/ptah-extension.ts`
- **Handlers**: `src/handlers/command-handlers.ts`
- **Providers**: `src/providers/angular-webview.provider.ts`
- **Services**: `src/services/*.ts`
- **Adapters**: `src/adapters/*.ts`
- **Entry**: `src/main.ts`
