# Ptah Extension - VS Code Application

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **ptah-extension-vscode** is the main VS Code extension application that orchestrates the entire Ptah Extension. It provides:

- VS Code extension activation and lifecycle management
- Command palette integration
- Webview hosting for the Angular SPA
- Dependency injection container setup
- Backend service orchestration
- RPC communication layer between extension host and webview

## Boundaries

**Belongs here**:

- VS Code extension entry point (`main.ts`)
- Extension activation/deactivation logic
- Command registration and handlers
- Webview provider setup
- DI container initialization
- RPC handler registration

**Does NOT belong**:

- Business logic (belongs in backend libraries)
- UI components (belongs in ptah-extension-webview)
- Shared types (belongs in @ptah-extension/shared)
- Reusable services (belongs in backend libraries)

## Key Files

### Entry Points

- `src/main.ts` - Extension activation entry point
- `package.json` - VS Code extension manifest (commands, activationEvents, contributions)

### Configuration

- `webpack.config.js` - Webpack bundling configuration
- `tsconfig.app.json` - TypeScript configuration
- `project.json` - Nx build configuration

### Assets

- `src/assets/` - Extension icons, media, static files
- `dist/` - Build output (webview copied here during build)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js Process)       │
├─────────────────────────────────────────────────┤
│  main.ts                                         │
│    ↓                                             │
│  Activate Extension                              │
│    ↓                                             │
│  Initialize DI Container (tsyringe)              │
│    ↓                                             │
│  Register Commands & Webview Providers           │
│    ↓                                             │
│  Setup RPC Communication Layer                   │
│    ↓                                             │
│  ┌───────────────────────────────────────┐      │
│  │  Webview Panel (Angular SPA)          │      │
│  │  (ptah-extension-webview build)       │      │
│  └───────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

## Dependencies

### Internal Libraries (Nx Workspace)

- `@ptah-extension/shared` - Type system and message protocol
- `@ptah-extension/vscode-core` - Infrastructure (DI, EventBus, Logger)
- `@ptah-extension/workspace-intelligence` - Workspace analysis
- `@ptah-extension/agent-generation` - Agent generation services
- `@ptah-extension/agent-sdk` - Claude Agent SDK integration
- `@ptah-extension/llm-abstraction` - LLM provider abstraction
- `@ptah-extension/template-generation` - Template processing
- `@ptah-extension/vscode-lm-tools` - VS Code LM tools

### External NPM Packages

- `vscode` - VS Code Extension API
- `tsyringe` - Dependency injection
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK
- `eventemitter3` - Event bus
- `uuid` - ID generation

### Build Dependencies

- `@nx/webpack` - Webpack executor
- `webpack` - Module bundler
- `esbuild` - Fast bundling

## Commands

```bash
# Development
npm run dev:extension              # Watch mode (rebuild on changes)
nx build ptah-extension-vscode --watch

# Build
npm run build:extension            # Production build
nx build ptah-extension-vscode

# Quality Gates
npm run lint:extension             # Lint code
nx run ptah-extension-vscode:typecheck  # Type-check
nx test ptah-extension-vscode      # Run tests

# Packaging
npm run package                    # Create .vsix file
nx run ptah-extension-vscode:package
```

## Build Process

The build process consists of multiple steps orchestrated by Nx:

1. **build-webpack**: Bundle extension code with Webpack

   - Input: `src/main.ts`
   - Output: `dist/apps/ptah-extension-vscode/main.js`
   - Target: Node.js (CommonJS)

2. **post-build-copy**: Copy webview and assets

   - Copy webview build from `ptah-extension-webview`
   - Copy extension assets (icons, images)
   - Copy `package.json` manifest

3. **Final Structure**:
   ```
   dist/apps/ptah-extension-vscode/
   ├── main.js                    # Extension bundle
   ├── package.json               # Manifest
   ├── assets/                    # Icons, images
   └── webview/                   # Angular SPA
       └── browser/
           ├── index.html
           ├── main-*.js
           └── styles-*.css
   ```

## Extension Manifest (`package.json`)

Key sections:

```json
{
  "name": "ptah-extension",
  "displayName": "Ptah - Coding Orchestra",
  "publisher": "ptah",
  "main": "./main.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [...],
    "viewsContainers": {...},
    "views": {...}
  }
}
```

## RPC Communication

The extension uses a custom RPC layer for webview ↔ extension communication:

```typescript
// Extension Host (Backend)
rpcHandler.register('chat:send', async (payload) => {
  // Handle request from webview
  return response;
});

// Webview (Frontend)
const response = await rpcService.invoke('chat:send', { message });
```

## Development Workflow

1. **Start Watch Mode**:

   ```bash
   npm run dev:all  # Watches both extension and webview
   ```

2. **Open Extension Development Host**:

   - Press F5 in VS Code
   - Extension loads in new window
   - Console logs appear in original window

3. **Make Changes**:

   - Edit code in `src/`
   - Webpack rebuilds automatically
   - Reload extension window (Ctrl+R)

4. **Debug**:
   - Set breakpoints in extension code
   - View logs in "Debug Console"
   - Inspect webview with DevTools (Ctrl+Shift+I in webview)

## Guidelines

### Extension Lifecycle

```typescript
// main.ts
export async function activate(context: vscode.ExtensionContext) {
  // 1. Initialize DI container
  // 2. Register services
  // 3. Register commands
  // 4. Register webview providers
  // 5. Setup RPC handlers
}

export async function deactivate() {
  // Cleanup resources
}
```

### Command Registration

```typescript
const disposable = vscode.commands.registerCommand('ptah.commandName', async () => {
  // Command handler
});

context.subscriptions.push(disposable);
```

### Webview Best Practices

1. **Security**: Use Content Security Policy
2. **State Management**: Persist state in webview, not extension
3. **Communication**: Use RPC for all webview ↔ extension calls
4. **Lifecycle**: Handle webview disposal properly

### Performance

- **Lazy Load**: Only activate heavy services when needed
- **Background Processing**: Use worker threads for CPU-intensive tasks
- **Caching**: Cache expensive computations
- **Memory**: Dispose resources in `deactivate()`

## Testing

```bash
# Unit tests
nx test ptah-extension-vscode

# E2E tests (with VS Code API)
npm run test:e2e

# Manual testing
# 1. Run extension in debug mode (F5)
# 2. Test commands in command palette
# 3. Verify webview renders correctly
```

## Troubleshooting

**Extension not activating**:

- Check `activationEvents` in package.json
- Verify no errors in Output > Extension Host

**Webview not loading**:

- Ensure `ptah-extension-webview` built successfully
- Check `post-build-copy` executed
- Verify webview files in `dist/apps/ptah-extension-vscode/webview/`

**RPC communication failing**:

- Check RPC handlers registered
- Verify message types match between webview and extension
- Enable RPC debug logging

## Related Documentation

- [Angular Webview App](../ptah-extension-webview/CLAUDE.md)
- [VS Code Core Library](../../libs/backend/vscode-core/CLAUDE.md)
- [Shared Types](../../libs/shared/CLAUDE.md)
