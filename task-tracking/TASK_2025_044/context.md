# TASK_2025_044: Claude Agent SDK Integration

**Created**: 2025-12-04
**Status**: Planned
**Type**: Feature Implementation (Extension Enhancement)
**Owner**: team-leader

---

## 🎯 User Intent

Integrate Claude Agent SDK into the Ptah VS Code extension to enable premium features:

1. **Dual authentication support**: Users can choose either `ANTHROPIC_API_KEY` OR `CLAUDE_CODE_OAUTH_TOKEN`
2. **Custom VS Code tools**: LSP-powered semantic search, editor context, Git workspace info
3. **Premium feature gates**: Check license status before enabling SDK features
4. **Parallel CLI support**: Keep existing CLI adapter for free tier users

**Key Insight**: Premium users get SDK-powered features by providing their own API key/OAuth token via VS Code settings.

---

## 📊 Context from Previous Tasks

This task is the implementation phase of **TASK_2025_041** (Claude Agent SDK Research) which identified:

- 4 premium features: Session forking, Structured outputs, Custom tools, Dynamic permissions
- Custom VS Code tools are THE competitive moat (impossible with CLI)
- 30-50% performance improvement (in-process vs CLI spawn)
- Zero UI changes needed (ExecutionNode abstraction works for both)

**Critical Decision from User**:

> "oauth token is also a setting that users can provide as we can authenticate claude agent sdk with 2 options (1- directly with anthropic api key, or 2- utilizing their pro/max subscription with the oauth api key)"

This means we need to support BOTH authentication methods in VS Code settings.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│               VS CODE EXTENSION                          │
│                                                           │
│  VS Code Settings:                                       │
│  • ptah.licenseKey = "ptah_lic_abc123..."               │
│  • ptah.anthropicApiKey = "sk-ant-..." (Option 1)       │
│  • ptah.claudeOAuthToken = "claude_oauth_..." (Option 2)│
│                                                           │
│  ┌─────────────────────────────────────────────┐        │
│  │  License Manager                             │        │
│  │  • Verify license key with server            │        │
│  │  • Cache premium status                      │        │
│  └─────────────┬───────────────────────────────┘        │
│                │                                          │
│                ▼                                          │
│  ┌─────────────────────────────────────────────┐        │
│  │  Agent Provider Factory                      │        │
│  │  • If premium + valid key → SdkAgentAdapter  │        │
│  │  • Else → CliAgentAdapter                    │        │
│  └─────────────┬───────────────────────────────┘        │
│                │                                          │
│       ┌────────┴────────┐                                │
│       ▼                  ▼                                │
│  ┌─────────────┐   ┌──────────────────────┐             │
│  │ CLI Adapter │   │ SDK Adapter (NEW!)   │             │
│  │ (Free Tier) │   │ (Premium Features)   │             │
│  │             │   │                       │             │
│  │ • Spawns   │   │ • Uses Anthropic     │             │
│  │   CLI      │   │   SDK directly       │             │
│  │ • JSONL    │   │ • Custom VS Code     │             │
│  │   parsing  │   │   tools              │             │
│  └─────────────┘   │ • Dual auth support  │             │
│                     └──────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 Success Criteria

### Must Have (Phase 1)

- ✅ VS Code settings for license key + API key + OAuth token
- ✅ License verification on extension activation
- ✅ `SdkAgentAdapter` implementation with dual auth
- ✅ 3 custom VS Code tools:
  - `workspace_semantic_search` (LSP)
  - `editor_context` (selection, cursor, diagnostics)
  - `git_workspace_info` (branch, changes, commits)
- ✅ Premium feature gates (check license before SDK)
- ✅ Upgrade prompts for free users

### Nice to Have (Phase 2)

- 🔮 Session forking UI
- 🔮 Structured outputs (Zod schemas)
- 🔮 Dynamic permission mode switching
- 🔮 Usage analytics dashboard

---

## 📝 Related Documentation

Key documents copied to this task:

- **SIMPLIFIED_ARCHITECTURE.md** - License flow and settings
- **research-report.md** - Complete SDK capabilities analysis (55K words)
- **PREMIUM_SAAS_STRATEGY.md** - Premium features design

**Important**: Focus on custom VS Code tools first (Phase 1). Other SDK features can be added later.

---

## 🚀 Implementation Timeline

**Estimated**: 1 week

**Week 1: SDK Adapter + Custom Tools**

- Day 1: VS Code settings + License manager
- Day 2: `SdkAgentAdapter` with dual auth
- Day 3: Custom tool #1 (workspace_semantic_search)
- Day 4: Custom tool #2 (editor_context)
- Day 5: Custom tool #3 (git_workspace_info)
- Day 6: Premium feature gates + upgrade prompts
- Day 7: Testing + QA

---

## 🔗 Dependencies

**Extension Libraries**:

- `@anthropic-ai/sdk` - Anthropic SDK client
- `@anthropic-ai/agent-sdk` - Agent SDK for custom tools
- `zod` - Schema validation for structured outputs

**VS Code APIs**:

- `vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider')` - LSP search
- `vscode.window.activeTextEditor` - Editor context
- `vscode.extensions.getExtension('vscode.git')` - Git integration

**Internal Dependencies**:

- `libs/backend/claude-domain` - `IAgentProvider` interface
- `libs/shared` - Message types (already provider-agnostic)
- `libs/frontend/core` - License manager service (NEW)

---

## 📁 Files to Create/Modify

### New Files

```
libs/backend/claude-domain/src/sdk/
  ├─ sdk-agent-adapter.ts          # SdkAgentAdapter implementation
  ├─ sdk-tools-provider.ts         # Custom VS Code tools
  └─ sdk-auth-helper.ts            # Dual auth support

libs/frontend/core/src/lib/services/
  └─ license-manager.service.ts    # License verification

apps/ptah-extension-vscode/src/
  └─ license/
      ├─ license-config.ts         # VS Code settings interface
      └─ license-verifier.ts       # API calls
```

### Modified Files

```
apps/ptah-extension-vscode/package.json
  • Add VS Code settings contributions:
    - ptah.licenseKey
    - ptah.anthropicApiKey
    - ptah.claudeOAuthToken

libs/backend/claude-domain/src/services/agent-provider.factory.ts
  • Add SDK adapter to factory

apps/ptah-extension-vscode/src/extension.ts
  • Add license verification on activation
  • Register premium/free provider based on license
```

---

## 🎯 Premium Features (Custom Tools)

### Tool #1: `workspace_semantic_search`

```typescript
tool(
  'workspace_semantic_search',
  'Search workspace using LSP symbols (classes, functions, interfaces)',
  z.object({
    query: z.string(),
    type: z.enum(['class', 'function', 'interface', 'variable', 'all']),
  }),
  async (args) => {
    const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', args.query);
    // Filter by type and return results
  }
);
```

### Tool #2: `editor_context`

```typescript
tool(
  'editor_context',
  'Get current editor context (selection, cursor, diagnostics)',
  z.object({
    includeSelection: z.boolean().default(true),
    includeDiagnostics: z.boolean().default(true),
  }),
  async (args) => {
    const editor = vscode.window.activeTextEditor;
    return {
      fileName: editor.document.fileName,
      language: editor.document.languageId,
      selection: editor.document.getText(editor.selection),
      diagnostics: vscode.languages.getDiagnostics(editor.document.uri),
      cursorPosition: { line: editor.selection.active.line, character: editor.selection.active.character },
    };
  }
);
```

### Tool #3: `git_workspace_info`

```typescript
tool('git_workspace_info', 'Get Git context (branch, uncommitted changes, recent commits)', z.object({}), async (args) => {
  const gitApi = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
  const repo = gitApi.repositories[0];
  return {
    branch: repo.state.HEAD?.name,
    uncommittedChanges: repo.state.workingTreeChanges.length,
    recentCommits: await repo.log({ maxEntries: 5 }),
  };
});
```

---

## 📌 Key Constraints

1. **Zero UI Changes**: ExecutionNode abstraction must work for both CLI and SDK
2. **Dual Auth Support**: Must handle both API key AND OAuth token
3. **Graceful Degradation**: Free users see upgrade prompts, not errors
4. **Offline Support**: Cached license verification (7-day grace period)

---

## 🎯 Next Steps

1. Create `task-description.md` (requirements)
2. Create `implementation-plan.md` (detailed design)
3. Team-leader will break down into atomic tasks
4. Backend-developer will implement SDK adapter
5. Frontend-developer will implement license UI
6. Senior-tester will validate premium features
