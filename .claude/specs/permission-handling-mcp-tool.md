## Complete Permission Flow: CLI ↔ Extension Communication

### The Key Mechanism: MCP Permission Prompt Tool

The extension uses Claude Code CLI's **`--permission-prompt-tool`** flag to intercept all permission requests. Here's the complete flow:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │────▶│  MCP Server     │────▶│  VS Code        │────▶│  Webview UI     │
│  CLI            │     │  (approval_     │     │  Extension      │     │  (Chat Panel)   │
│                 │◀────│  prompt tool)   │◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Step-by-Step Flow

#### 1. **CLI Invocation with Permission Flags**

When sending a message to Claude, the extension spawns the CLI with these critical arguments:

```typescript name=src/extension.ts url=https://github.com/andrepimenta/claude-code-chat/blob/d891070d9eb7c27b106767095727e19ce2ff9a26/src/extension.ts#L487-L494
// Add MCP configuration for permissions
const mcpConfigPath = this.getMCPConfigPath();
if (mcpConfigPath) {
  args.push('--mcp-config', this.convertToWSLPath(mcpConfigPath));
  args.push('--allowedTools', 'mcp__claude-code-chat-permissions__approval_prompt');
  args.push('--permission-prompt-tool', 'mcp__claude-code-chat-permissions__approval_prompt');
}
```

The `--permission-prompt-tool` flag tells Claude CLI: **"Instead of prompting in the terminal, call this MCP tool to handle permissions."**

#### 2. **MCP Server Receives Permission Request**

When Claude wants to execute a tool (read file, write file, bash command), it calls the `approval_prompt` MCP tool:

```typescript name=claude-code-chat-permissions-mcp/mcp-permissions.ts url=https://github.com/andrepimenta/claude-code-chat/blob/d891070d9eb7c27b106767095727e19ce2ff9a26/claude-code-chat-permissions-mcp/mcp-permissions.ts#L163-L212
server.tool(
  'approval_prompt',
  'Request user permission to execute a tool via VS Code dialog',
  {
    tool_name: z.string().describe('The name of the tool requesting permission'),
    input: z.object({}).passthrough().describe('The input for the tool'),
    tool_use_id: z.string().optional().describe('The unique tool use request ID'),
  },
  async ({ tool_name, input }) => {
    const permissionResult = await requestPermission(tool_name, input);
    const behavior = permissionResult.approved ? 'allow' : 'deny';

    return {
      content: [
        {
          type: 'text',
          text: behavior === 'allow' ? JSON.stringify({ behavior: behavior, updatedInput: input }) : JSON.stringify({ behavior: behavior, message: permissionResult.reason || 'Permission denied' }),
        },
      ],
    };
  }
);
```

#### 3. **File-Based IPC: Request → Response**

The MCP server communicates with VS Code using **file-based inter-process communication**:

```typescript name=claude-code-chat-permissions-mcp/mcp-permissions.ts url=https://github.com/andrepimenta/claude-code-chat/blob/d891070d9eb7c27b106767095727e19ce2ff9a26/claude-code-chat-permissions-mcp/mcp-permissions.ts#L84-L160
async function requestPermission(tool_name: string, input: any): Promise<{ approved: boolean; reason?: string }> {
  // First check if already pre-approved
  if (isAlwaysAllowed(tool_name, input)) {
    return { approved: true };
  }

  const requestId = generateRequestId();
  const requestFile = path.join(PERMISSIONS_PATH, `${requestId}.request`);
  const responseFile = path.join(PERMISSIONS_PATH, `${requestId}. response`);

  // Write request file (VS Code will see this)
  const request = {
    id: requestId,
    tool: tool_name,
    input: input,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));

  // Watch for response file from VS Code
  return new Promise((resolve) => {
    const watcher = fs.watch(PERMISSIONS_PATH, (eventType, filename) => {
      if (eventType === 'rename' && filename === path.basename(responseFile)) {
        if (fs.existsSync(responseFile)) {
          const response = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
          fs.unlinkSync(responseFile); // Clean up
          resolve({ approved: response.approved });
        }
      }
    });
  });
}
```

#### 4. **VS Code Extension Watches for Requests**

The extension sets up a `FileSystemWatcher` for `. request` files:

```typescript name=src/extension.ts url=https://github.com/andrepimenta/claude-code-chat/blob/d891070d9eb7c27b106767095727e19ce2ff9a26/src/extension.ts#L1211-L1227
// Set up file watcher for *.request files
this._permissionWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this._permissionRequestsPath, '*.request'));

this._permissionWatcher.onDidCreate(async (uri) => {
  if (uri.scheme === 'file') {
    await this._handlePermissionRequest(uri);
  }
});
```

#### 5. **Show Dialog in Webview UI**

When a request is detected, it sends it to the webview:

```typescript name=src/extension.ts url=https://github.com/andrepimenta/claude-code-chat/blob/d891070d9eb7c27b106767095727e19ce2ff9a26/src/extension.ts#L1257-L1283
private async _showPermissionDialog(request: any): Promise<boolean> {
    // Send permission request to the UI
    this._sendAndSaveMessage({
        type: 'permissionRequest',
        data: {
            id: request.id,
            tool: toolName,
            input: request. input,
            pattern: pattern
        }
    });

    // Wait for response from UI using Promise
    return new Promise((resolve) => {
        this._pendingPermissionResolvers.set(request.id, resolve);
    });
}
```

#### 6. **User Responds via UI Buttons**

The webview shows Allow/Deny/Always Allow buttons:

```typescript name=src/script.ts url=https://github. com/andrepimenta/claude-code-chat/blob/d891070d9eb7c27b106767095727e19ce2ff9a26/src/script.ts#L2170-L2176
function respondToPermission(id, approved, alwaysAllow = false) {
  vscode.postMessage({
    type: 'permissionResponse',
    id: id,
    approved: approved,
    alwaysAllow: alwaysAllow,
  });
}
```

#### 7. **Extension Writes Response File**

The extension writes a `. response` file that the MCP server is watching for:

```typescript name=src/extension.ts url=https://github.com/andrepimenta/claude-code-chat/blob/d891070d9eb7c27b106767095727e19ce2ff9a26/src/extension.ts#L1229-L1254
private async _handlePermissionRequest(requestUri: vscode.Uri): Promise<void> {
    const content = await vscode.workspace.fs.readFile(requestUri);
    const request = JSON.parse(new TextDecoder().decode(content));

    const approved = await this._showPermissionDialog(request);

    // Write response file (MCP server is watching for this)
    const responseFile = requestUri.fsPath. replace('. request', '.response');
    const response = {
        id: request. id,
        approved: approved,
        timestamp: new Date().toISOString()
    };
    await vscode.workspace.fs.writeFile(vscode.Uri.file(responseFile), responseContent);

    // Clean up request file
    await vscode.workspace.fs.delete(requestUri);
}
```

#### 8. **MCP Server Returns to CLI**

The MCP server reads the `. response` file and returns the result to Claude CLI:

```json
// If approved:
{ "behavior": "allow", "updatedInput": {... } }

// If denied:
{ "behavior": "deny", "message": "User rejected the request" }
```

### Summary Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        PERMISSION FLOW                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Claude CLI                                                              │
│    │                                                                     │
│    │ --permission-prompt-tool mcp__claude-code-chat-permissions__...      │
│    ▼                                                                     │
│  MCP Server (approval_prompt tool)                                       │
│    │                                                                     │
│    │ 1. Check alwaysAllow in permissions. json                           │
│    │ 2. If not pre-approved → write {id}. request file                   │
│    │ 3. fs.watch() for {id}.response file                               │
│    ▼                                                                     │
│  VS Code Extension (FileSystemWatcher)                                   │
│    │                                                                     │
│    │ onDidCreate('*. request') triggered                                  │
│    │ Read request → Show in webview UI                                   │
│    ▼                                                                     │
│  Webview UI (Chat Panel)                                                 │
│    │                                                                     │
│    │ User clicks: [Deny] [Always Allow] [Allow]                         │
│    │ postMessage({ type: 'permissionResponse', approved: true/false })  │
│    ▼                                                                     │
│  VS Code Extension                                                       │
│    │                                                                     │
│    │ Write {id}.response file with { approved: true/false }             │
│    │ Delete {id}.request file                                            │
│    ▼                                                                     │
│  MCP Server                                                              │
│    │                                                                     │
│    │ fs.watch() detects . response → read & return to CLI                │
│    ▼                                                                     │
│  Claude CLI                                                              │
│    │                                                                     │
│    │ Receives { behavior: "allow"/"deny" }                              │
│    │ Proceeds or aborts the tool execution                               │
│    ▼                                                                     │
│  Tool executes (or not)                                                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

This file-based IPC approach is clever because it works across process boundaries (MCP server runs as a separate Node.js process from VS Code) and doesn't require complex socket/pipe communication.
