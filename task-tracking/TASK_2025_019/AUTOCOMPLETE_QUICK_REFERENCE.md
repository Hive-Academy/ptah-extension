# Claude CLI Autocomplete Quick Reference

**Version**: 1.0 (2025-11-24)
**For**: TASK_2025_019 Phase 2 Implementation

---

## Syntax Cheat Sheet

### @ Mentions

| Type             | Syntax                    | Example               | Notes                       |
| ---------------- | ------------------------- | --------------------- | --------------------------- |
| **File**         | `@path/to/file.ext`       | `@src/main.ts`        | Relative to workspace root  |
| **Agent**        | `@agent-name`             | `@code-reviewer`      | Lowercase with hyphens only |
| **MCP Resource** | `@server:protocol://path` | `@github:issue://123` | Server must be configured   |

### / Commands

| Type         | Syntax                 | Example                       | Notes                        |
| ------------ | ---------------------- | ----------------------------- | ---------------------------- |
| **Built-in** | `/command`             | `/help`, `/review`            | 33 built-in commands         |
| **Custom**   | `/custom-name`         | `/fix-issue 123`              | From `.claude/commands/*.md` |
| **MCP**      | `/mcp__server__prompt` | `/mcp__github__pr_review 456` | Exposed by MCP servers       |

---

## Message Format Examples

### Files Only

```bash
"Explain @src/main.ts and @src/utils.ts"
```

### Agent + Files

```bash
"@code-reviewer Review @src/auth.ts for security issues"
```

### Agent + Files + MCP

```bash
"@code-reviewer Review @src/auth.ts. Also check @github:issue://123 for context."
```

### Slash Command

```bash
"/review src/main.ts"
```

### Slash Command with Arguments

```bash
"/fix-issue 123"
```

---

## CLI Spawn Arguments

### Basic Spawn (Ptah Use Case)

```typescript
spawn(
  'claude',
  [
    '-p', // Print mode (non-interactive)
    '--output-format',
    'stream-json', // JSONL streaming
    '--resume',
    sessionId, // Resume session
    message, // Message with inline @ mentions
  ],
  {
    cwd: workspaceRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  }
);
```

### With Agent Definition

```typescript
spawn('claude', [
  '--agents',
  JSON.stringify({
    reviewer: {
      description: 'Reviews code',
      prompt: 'You are a code reviewer',
    },
  }),
  '-p',
  '--output-format',
  'stream-json',
  message,
]);
```

**IMPORTANT**: Use inline `@agent-name` syntax in message, NOT `--agent` flag.

---

## Config File Locations

### Agents

| Scope       | Path                    | Priority |
| ----------- | ----------------------- | -------- |
| **Project** | `.claude/agents/*.md`   | Highest  |
| **User**    | `~/.claude/agents/*.md` | Fallback |

### Commands

| Scope       | Path                      | Priority |
| ----------- | ------------------------- | -------- |
| **Project** | `.claude/commands/*.md`   | Highest  |
| **User**    | `~/.claude/commands/*.md` | Fallback |

### MCPs

| Scope             | Path                                                               | Priority |
| ----------------- | ------------------------------------------------------------------ | -------- |
| **Enterprise**    | `/Library/Application Support/ClaudeCode/managed-mcp.json` (macOS) | Highest  |
| **Project**       | `.mcp.json`                                                        | High     |
| **Project-Local** | `.claude/settings.local.json`                                      | Medium   |
| **User**          | `~/.claude/settings.local.json`                                    | Lowest   |

---

## File Format Reference

### Agent Definition (.md)

```markdown
---
name: code-reviewer
description: Expert code review specialist focusing on security and maintainability
tools: Read, Grep, Bash
model: sonnet
permissionMode: default
---

# System Prompt

You are a code review expert who focuses on...
```

**Required Fields**:

- `name` (lowercase alphanumeric + hyphens)
- `description` (used for auto-detection)

**Optional Fields**:

- `tools` (comma-separated)
- `model` (`sonnet`, `opus`, `haiku`, or `inherit`)
- `permissionMode` (`default`, `acceptEdits`, `bypassPermissions`, `plan`, `ignore`)

### Command Definition (.md)

```markdown
---
description: Analyze GitHub issue and suggest fixes
argument-hint: <issue-number>
allowed-tools: Bash, Read, Write
model: sonnet
---

Please analyze GitHub issue #$1 and suggest fixes.

Steps:

1. Fetch issue details
2. Identify relevant code
3. Propose solution
```

**Required Fields**:

- `description`

**Optional Fields**:

- `argument-hint` (e.g., `<file-path>`)
- `allowed-tools` (comma-separated)
- `model`

**Argument Placeholders**:

- `$ARGUMENTS` - All arguments as string
- `$1`, `$2`, `$3` - Positional arguments

### MCP Configuration (.mcp.json)

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "postgres": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "mcp/postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "${DATABASE_URL:-postgresql://localhost/mydb}"
      }
    },
    "remote-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

**Server Types**:

- `stdio` (default): Local process
- `http`: Remote HTTP server
- `sse`: Server-Sent Events (deprecated)

**Environment Variables**:

- `${VAR}` - Expand variable
- `${VAR:-default}` - Use default if unset

---

## Discovery API Quick Reference

### Backend Services (TypeScript)

```typescript
// Agent Discovery
const result = await agentDiscoveryService.searchAgents({
  query: 'code-reviewer',
  maxResults: 20,
});
// Returns: { success: boolean, agents: AgentInfo[], error?: string }

// MCP Discovery
const result = await mcpDiscoveryService.searchMCPServers({
  query: 'github',
  maxResults: 20,
  includeOffline: false,
});
// Returns: { success: boolean, servers: MCPServerInfo[], error?: string }

// Command Discovery
const result = await commandDiscoveryService.searchCommands({
  query: 'help',
  maxResults: 20,
});
// Returns: { success: boolean, commands: CommandInfo[], error?: string }
```

### Frontend RPC (TypeScript)

```typescript
// Fetch agents
const result = await vscodeService.sendRequest({
  type: 'autocomplete:agents',
  data: { query: '', maxResults: 100 },
});

// Fetch MCPs
const result = await vscodeService.sendRequest({
  type: 'autocomplete:mcps',
  data: { query: '', maxResults: 50, includeOffline: false },
});

// Fetch commands
const result = await vscodeService.sendRequest({
  type: 'autocomplete:commands',
  data: { query: '', maxResults: 100 },
});
```

---

## Common Pitfalls & Gotchas

### ❌ DON'T

```typescript
// DON'T use --agent flag
spawn('claude', ['--agent', 'code-reviewer', message]);

// DON'T use --files flag
spawn('claude', ['--files', 'src/main.ts', message]);

// DON'T skip file extensions
"@README"  // Won't match README.md

// DON'T use uppercase in agent names
---
name: CodeReviewer  ❌
---

// DON'T forget server name in MCP resources
"@issue://123"  ❌  (missing server name)
```

### ✅ DO

```typescript
// DO use inline @ syntax
spawn('claude', [message]); // message = "@code-reviewer Review @src/main.ts"

// DO include file extensions
"@README.md"  ✅

// DO use lowercase with hyphens for agent names
---
name: code-reviewer  ✅
---

// DO include server name in MCP resources
"@github:issue://123"  ✅
```

---

## Troubleshooting

### Agent not appearing in autocomplete

**Check**:

1. File exists in `.claude/agents/*.md` (project or user)
2. YAML frontmatter has `name` and `description` fields
3. `name` is lowercase alphanumeric with hyphens only
4. File watcher is initialized (restart extension if needed)

**Debug**:

```typescript
// Backend logs
console.log('[AgentDiscovery] Scanned agents:', cache);

// Frontend logs
console.log('[AgentFacade] Fetched agents:', agents());
```

### MCP server showing as offline

**Check**:

1. Server configured in `.mcp.json`
2. Command/binary exists at specified path
3. Environment variables set correctly
4. Run `claude mcp list` manually to verify

**Debug**:

```bash
# Check MCP status
claude mcp list

# Enable MCP debug mode
claude --mcp-debug chat "test"
```

### Command not found in autocomplete

**Check**:

1. File exists in `.claude/commands/*.md` (project or user)
2. YAML frontmatter has `description` field
3. Filename matches command name (without .md)
4. File watcher is initialized

**Debug**:

```typescript
// Backend logs
console.log('[CommandDiscovery] Scanned commands:', cache);
```

### File watcher not updating cache

**Check**:

1. VS Code workspace folder is open
2. File watcher initialized on activation
3. File changes detected (check logs)

**Debug**:

```typescript
// Force refresh
await agentDiscoveryService.discoverAgents();
await mcpDiscoveryService.discoverMCPServers();
await commandDiscoveryService.discoverCommands();
```

---

## Performance Optimization Tips

### Caching Strategy

| Type         | Cache Duration       | Invalidation           | Polling     |
| ------------ | -------------------- | ---------------------- | ----------- |
| **Agents**   | Until file change    | File watcher           | No          |
| **Commands** | Until file change    | File watcher           | No          |
| **MCPs**     | Until config change  | File watcher           | Health: 30s |
| **Files**    | N/A (RPC to backend) | workspace-intelligence | No          |

### Memory Usage

```typescript
// Estimated memory per item:
AgentInfo:   ~500 bytes × 50 agents   = 25 KB
CommandInfo: ~300 bytes × 100 commands = 30 KB
MCPServerInfo: ~400 bytes × 20 servers = 8 KB

// Total: ~63 KB (negligible)
// Recommendation: Keep all in memory, no pagination
```

### Search Performance

```typescript
// Client-side filtering (< 50ms for 100 items)
const filtered = cache.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));

// Limit results
return filtered.slice(0, 20);
```

---

## Testing Checklist

### Unit Tests

- [ ] AgentDiscoveryService: parse valid/invalid frontmatter
- [ ] MCPDiscoveryService: merge configs, expand env vars
- [ ] CommandDiscoveryService: scan directories, parse templates
- [ ] Facades: RPC calls, signal updates, search filtering

### Integration Tests

- [ ] RPC handlers: request → service → response
- [ ] File watchers: create/modify/delete → cache refresh
- [ ] Health polling: MCP status updates every 30s

### Manual Tests

- [ ] Create agent file → appears in dropdown
- [ ] Modify agent → cache updates
- [ ] Delete agent → removed from dropdown
- [ ] Type `@agent-name` → agent suggestion first
- [ ] Type `@filename` → file suggestions shown
- [ ] Type `@server:` → MCP resources shown
- [ ] Type `/command` → commands shown
- [ ] Select suggestion → correct syntax inserted

---

## Quick Links

**Research Report**: [CLAUDE_CLI_AUTOCOMPLETE_RESEARCH.md](./CLAUDE_CLI_AUTOCOMPLETE_RESEARCH.md)
**Implementation Guide**: [PHASE2_IMPLEMENTATION_GUIDE.md](./PHASE2_IMPLEMENTATION_GUIDE.md)

**Official Docs**:

- [Claude Code Sub-agents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Slash Commands](https://code.claude.com/docs/en/slash-commands)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)

---

**End of Quick Reference**
