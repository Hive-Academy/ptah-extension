# Research Report: GitHub Copilot SDK for Programmatic Integration

**Date**: 2026-02-28
**Status**: Technical Preview (may have breaking changes)
**Confidence Level**: HIGH (15+ sources, official documentation, production examples)
**Relevance**: Direct replacement for current CLI child process spawning in Ptah Extension

---

## Executive Summary

The `@github/copilot-sdk` (v0.1.29) is a TypeScript SDK that wraps the Copilot CLI via JSON-RPC 2.0, providing programmatic control over sessions, streaming, tool calling, MCP integration, and permission handling. It replaces raw child process spawning with a structured, event-driven API while reusing the same production-tested agent runtime. The SDK is in Technical Preview (January 2026) and is a strong candidate for replacing the current `CopilotCliAdapter.runSdk()` implementation.

---

## 1. Package Name and Installation

**Package**: `@github/copilot-sdk`
**Current Version**: 0.1.29 (published 2026-02-27)
**License**: Proprietary (GitHub)
**Node.js Requirement**: 18+

```bash
npm install @github/copilot-sdk
```

**Key Dependency**: `vscode-jsonrpc` (^8.2.1) -- the same JSON-RPC library VS Code uses for LSP.

**Runtime Dependency**: The SDK requires the Copilot CLI to be installed separately. The CLI binary (`@github/copilot`) includes platform-specific optional dependencies (darwin-arm64, linux-x64, win32-x64, etc.). The SDK manages the CLI process lifecycle automatically -- it spawns the CLI in `--headless --stdio` mode and communicates via JSON-RPC over stdio pipes.

**Critical Architecture Detail**: The SDK is a thin wrapper. All planning, tool orchestration, and execution happens inside the Copilot CLI process. The SDK sends JSON-RPC requests and receives events/callbacks. This means:

- No duplicate agent runtime in your process
- You get the exact same behavior as `copilot` CLI
- CLI updates automatically improve SDK behavior

---

## 2. API Surface

### Client Lifecycle

```typescript
import { CopilotClient } from '@github/copilot-sdk';

// Initialize -- does NOT spawn CLI yet
const client = new CopilotClient({
  cliPath: '/path/to/copilot', // Optional: explicit binary path
  cliUrl: 'localhost:4321', // Optional: connect to external CLI server
  githubToken: process.env.GITHUB_TOKEN, // Optional: explicit auth
  useLoggedInUser: true, // Optional: use `gh auth token`
  useStdio: true, // Default: stdio transport
  port: 8080, // Alternative: TCP transport
  autoStart: true, // Default: start on first use
  autoRestart: true, // Default: restart on crash
  logLevel: 'info', // Logging verbosity
});

// Explicitly start (spawns CLI with --headless --stdio)
await client.start();

// Query available models at runtime
const models = await client.listModels();

// Graceful shutdown
await client.stop();
```

### Session Management

```typescript
const session = await client.createSession({
  model: 'gpt-4.1', // Required: LLM model
  streaming: true, // Enable incremental responses
  sessionId: 'custom-session-id', // Custom ID for resumption
  systemMessage: 'You are a ...', // Custom system prompt
  tools: [
    /* custom tool defs */
  ], // Custom tools (see section 3)
  hooks: {
    /* lifecycle hooks */
  }, // Permission/lifecycle hooks (see section 4)
});
```

### Sending Messages

```typescript
// Blocking: wait for complete response
const response = await session.sendAndWait({
  prompt: 'What is 2 + 2?',
});
console.log(response?.data.content);

// Non-blocking: send and handle via events
await session.send({ prompt: 'Refactor this code' });
```

### Event Subscription

```typescript
// Subscribe to specific event type (TypeScript type-safe)
const unsubscribe = session.on('assistant.message_delta', (event) => {
  process.stdout.write(event.data.deltaContent);
});

// Subscribe to all events (wildcard)
session.on((event) => {
  console.log(event.type, event.data);
});

// Cleanup
unsubscribe();
```

---

## 3. Tool Use / MCP Support

### Custom Tool Definition (Zod)

The SDK supports defining custom tools with Zod schemas for parameter validation. The `defineTool()` helper automatically converts Zod schemas to JSON Schema:

```typescript
import { z } from 'zod';

const session = await client.createSession({
  model: 'gpt-4.1',
  tools: [
    {
      name: 'lookup_issue',
      description: 'Look up a GitHub issue by number',
      parameters: z.object({
        repo: z.string().describe('Repository in owner/name format'),
        number: z.number().describe('Issue number'),
      }),
      handler: async (params) => {
        const issue = await fetchIssue(params.repo, params.number);
        return { output: JSON.stringify(issue) };
      },
    },
    {
      name: 'query_db',
      description: 'Execute a database query',
      parameters: z.object({
        sql: z.string(),
        timeout: z.number().optional().default(5000),
      }),
      handler: async (params) => {
        const result = await db.query(params.sql);
        return { output: JSON.stringify(result) };
      },
    },
  ],
});
```

### Tool Calling Flow (Internal)

1. Agent decides a tool call is needed during planning
2. CLI sends `tool.call` JSON-RPC request to SDK with tool name + parameters
3. SDK locates the registered handler and executes it
4. Handler returns `ToolResult` with output/errors
5. SDK sends response back to CLI via JSON-RPC
6. Agent processes the result and continues planning

### MCP Server Integration

The SDK inherits Copilot CLI's full MCP support. MCP servers can be configured and the agent will discover and use their tools:

```typescript
// MCP servers are configured via CLI flags or config files
// The SDK passes through CLI's MCP capabilities
// You can also use --additional-mcp-config to add MCP servers
```

Confirmed MCP capabilities:

- Connect to MCP servers (stdio and HTTP transports)
- Use MCP tools in agent planning loop
- Azure MCP Server integration documented by Microsoft
- GitHub's own MCP server for repo/issue/PR access

### Default First-Party Tools

By default, the SDK enables ALL first-party tools (equivalent to `--allow-all` CLI flag):

- File system operations (read, write, create, delete)
- Git operations
- Web requests
- Shell command execution

Tool availability is configurable through SDK client options.

---

## 4. User Interaction / Permission Handling

This is the most significant upgrade over raw CLI spawning. The SDK provides a **hook system** that intercepts tool calls, user prompts, and session lifecycle events programmatically:

### Pre-Tool Use Hook (Permission Gate)

```typescript
const session = await client.createSession({
  model: 'gpt-4.1',
  hooks: {
    onPreToolUse: async (event) => {
      // event.toolName: "bash", "edit", "view", "create"
      // event.toolArgs: JSON string with tool arguments

      // Option 1: Allow silently
      return { permissionDecision: 'allow' };

      // Option 2: Deny with reason
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Blocked: dangerous command',
      };

      // Option 3: Ask user (delegates to your UI)
      return { permissionDecision: 'ask' };

      // Option 4: Allow with modified arguments
      return {
        permissionDecision: 'allow',
        modifiedArgs: { ...originalArgs, safe: true },
        additionalContext: 'Modified for safety',
      };
    },
  },
});
```

### Post-Tool Use Hook (Logging/Monitoring)

```typescript
hooks: {
  onPostToolUse: async (event) => {
    // event.toolName, event.toolArgs, event.toolResult
    // event.toolResult.resultType: "success" | "failure" | "denied"
    // event.toolResult.textResultForLlm: result text shown to agent
    logToolExecution(event);
  },
}
```

### Full Hook Catalog

| Hook                    | Trigger                      | Can Modify?             | Use Case                    |
| ----------------------- | ---------------------------- | ----------------------- | --------------------------- |
| `onSessionStart`        | Session begins/resumes       | No                      | Init logging, load context  |
| `onSessionEnd`          | Session completes/terminates | No                      | Cleanup, final reporting    |
| `onUserPromptSubmitted` | User sends input             | No                      | Audit logging, compliance   |
| `onPreToolUse`          | Before tool execution        | YES (allow/deny/modify) | Permission UI, safety gates |
| `onPostToolUse`         | After tool execution         | No                      | Monitoring, statistics      |
| `onErrorOccurred`       | Error during execution       | No                      | Error reporting, alerting   |

### Hook Input Parameters (Common)

All hooks receive:

- `timestamp`: Unix milliseconds
- `cwd`: Current working directory

Additional per-hook:

- `onPreToolUse`: `toolName`, `toolArgs` (JSON string)
- `onPostToolUse`: `toolName`, `toolArgs`, `toolResult` object
- `onSessionStart`: `source` ("new" | "resume" | "startup"), `initialPrompt`
- `onSessionEnd`: `reason` ("complete" | "error" | "abort" | "timeout" | "user_exit")
- `onErrorOccurred`: `error` object with `message`, `name`, `stack`

---

## 5. Session Management

### Session IDs and Resumption

```typescript
// Create with custom session ID
const session = await client.createSession({
  model: 'gpt-4.1',
  sessionId: 'user-123-task-456-1709142000',
});

// Later: resume the same session
const resumed = await client.resumeSession({
  sessionId: 'user-123-task-456-1709142000',
});
```

### Infinite Sessions

By default, sessions use "infinite sessions" which:

- Automatically manage context window limits
- Perform background compaction when conversation grows too large
- Persist state to a workspace directory
- Maintain conversation continuity across compaction boundaries

### Concurrent Sessions

Multiple sessions can run concurrently with isolated state within one client connection. Each session maintains independent conversational context.

### Session State Machine

```
session.create -> session.start -> [send/receive loop] -> session.idle -> [more sends] -> session.end
                                         |
                                   tool.call (callback)
                                         |
                                   tool result (response)
```

---

## 6. Streaming Format

### Event Types

The SDK emits 40+ strongly-typed session events. Key events:

| Event Type                | When Emitted                                  | Data                          |
| ------------------------- | --------------------------------------------- | ----------------------------- |
| `assistant.message_delta` | Each streaming token/chunk                    | `deltaContent: string`        |
| `assistant.message`       | Complete response assembled                   | `content: string, id: string` |
| `assistant.reasoning`     | Model's reasoning trace                       | Reasoning content             |
| `tool.execution_start`    | Tool invocation begins                        | `toolName: string`            |
| `tool.execution_complete` | Tool invocation finishes                      | `toolName, result`            |
| `session.idle`            | Processing complete, ready for next input     | -                             |
| `session.start`           | Session initialized                           | -                             |
| `session.error`           | Error during execution                        | Error details                 |
| `permission.request`      | Permission needed (CLI -> SDK callback)       | Tool/action details           |
| `session.askUserInput`    | CLI requests user input (CLI -> SDK callback) | Prompt text                   |

### TypeScript Type System

Events are generated from a shared `session-events.schema.json` (single source of truth across all 4 SDK languages):

```typescript
// Zod schemas for runtime validation
export const AssistantMessageEventSchema = z.object({
  type: z.literal('assistant.message'),
  data: z.object({
    content: z.string(),
    id: z.string(),
  }),
});

// Discriminated union for type-safe event matching
export type SessionEvent = AssistantMessageEvent | AssistantMessageDeltaEvent | ToolExecutionStartEvent | ToolExecutionCompleteEvent | SessionIdleEvent | SessionErrorEvent | PermissionRequestEvent;
```

### Streaming Example

```typescript
const session = await client.createSession({
  model: 'gpt-4.1',
  streaming: true,
});

// Streaming tokens
session.on('assistant.message_delta', (event) => {
  process.stdout.write(event.data.deltaContent);
});

// Tool activity
session.on('tool.execution_start', (event) => {
  console.log(`[Tool] ${event.data.toolName} starting...`);
});
session.on('tool.execution_complete', (event) => {
  console.log(`[Tool] ${event.data.toolName} done`);
});

// Session ready for next message
session.on('session.idle', () => {
  console.log('\n--- Ready ---');
});

// NOTE: assistant.message and assistant.reasoning are always
// sent regardless of streaming setting
await session.send({ prompt: 'Refactor the login module' });
```

---

## 7. Authentication

The SDK supports four authentication methods:

| Method                   | Configuration                                         | Best For                                   |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| **Logged-in user**       | `useLoggedInUser: true` (default)                     | VS Code extension (user already signed in) |
| **Explicit token**       | `githubToken: "ghp_..."`                              | CI/CD, automated workflows                 |
| **Environment variable** | `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` | Server environments                        |
| **BYOK**                 | Provider-specific API keys                            | No GitHub subscription needed              |

### VS Code Extension Context

For our use case (VS Code extension), the recommended approach is:

1. User authenticates to GitHub via VS Code's built-in GitHub auth
2. Extract the token via VS Code's authentication API
3. Pass it to `CopilotClient({ githubToken: token })`

Alternatively, if the user has `gh` CLI authenticated, `useLoggedInUser: true` reads the stored OAuth credentials.

### BYOK (Bring Your Own Key)

```typescript
const client = new CopilotClient();
const session = await client.createSession({
  model: 'gpt-4.1',
  provider: {
    type: 'openai', // or "azure", "anthropic"
    apiKey: 'sk-...',
  },
});
```

BYOK eliminates the GitHub Copilot subscription requirement but only supports key-based auth (no Azure AD, managed identities, or third-party identity providers).

---

## 8. Comparison: SDK vs CLI Child Process Spawning

### Current Implementation (CLI Spawning)

The current `CopilotCliAdapter.runSdk()` in Ptah:

- Spawns `copilot -p "task" --yolo --autopilot --silent` via `cross-spawn`
- Captures stdout/stderr as raw text streams
- No structured events -- just text parsing
- No tool interception -- `--yolo` auto-approves everything
- No session persistence -- each spawn is a fresh session
- MCP configured via CLI flags (`--additional-mcp-config`, `--disable-mcp-server`)
- Abort via `SIGTERM` on the child process
- Folder trust managed by writing to `~/.copilot/config.json` manually

### SDK Approach (Proposed)

| Capability              | CLI Spawning                          | SDK                                                  |
| ----------------------- | ------------------------------------- | ---------------------------------------------------- |
| **Output format**       | Raw text (stdout/stderr)              | Structured typed events (40+ types)                  |
| **Streaming**           | Line-by-line stdout                   | `assistant.message_delta` events with `deltaContent` |
| **Tool interception**   | None (`--yolo` approves all)          | `onPreToolUse` hook with allow/deny/modify           |
| **Permission UI**       | None (headless)                       | `permission.request` callback to show UI             |
| **User input**          | None (headless)                       | `session.askUserInput` callback                      |
| **Session persistence** | None (fresh each time)                | `sessionId` + `resumeSession()`                      |
| **Session continuity**  | None                                  | Infinite sessions with auto-compaction               |
| **MCP integration**     | CLI flags                             | Inherited from CLI + custom tool definitions         |
| **Custom tools**        | Not possible                          | Zod-validated tool definitions with async handlers   |
| **Model selection**     | `--model` flag                        | `session.model` + runtime `listModels()`             |
| **Error handling**      | Exit code + stderr parsing            | Typed error events + `onErrorOccurred` hook          |
| **Process lifecycle**   | Manual spawn/kill                     | `autoStart`, `autoRestart`, `stop()`                 |
| **Auth**                | Pre-authenticated CLI                 | Token, env var, logged-in user, or BYOK              |
| **Windows compat**      | `cross-spawn` for .cmd                | SDK handles internally                               |
| **Folder trust**        | Manual `~/.copilot/config.json` write | SDK handles via session config                       |
| **Multi-session**       | One process per task                  | Multiple concurrent sessions on one client           |

### Key Advantages of SDK

1. **Structured output**: Instead of parsing raw text for tool calls, file edits, and status updates, you receive typed events. This eliminates fragile regex-based output parsing.

2. **Permission UI**: The `onPreToolUse` hook lets you show a VS Code dialog asking the user to approve/deny file edits or command execution, rather than auto-approving everything with `--yolo`.

3. **Tool extensibility**: You can inject Ptah-specific tools (workspace analysis, diagnostics) directly into the agent's tool set via Zod schemas, rather than configuring MCP servers via CLI flags.

4. **Session continuity**: Resume sessions across VS Code restarts, maintaining conversation context. The current implementation loses all context when the process exits.

5. **Concurrent sessions**: Run multiple agent sessions on a single CLI process, reducing resource usage compared to spawning N child processes.

6. **Crash recovery**: `autoRestart: true` automatically restarts the CLI process if it crashes, without losing the session.

### Limitations / Risks

1. **Technical Preview**: The SDK is in Technical Preview (since January 2026). Breaking changes are expected. Version 0.1.29 suggests rapid iteration.

2. **CLI dependency**: The SDK still requires the Copilot CLI binary. It does not eliminate the CLI -- it wraps it. If the CLI is not installed, the SDK cannot function.

3. **Bundle size**: Adding `@github/copilot-sdk` + its dependency `vscode-jsonrpc` increases the extension bundle. Measure impact.

4. **Startup latency**: The SDK spawns the CLI process on first use. Measure cold-start time vs direct CLI spawning.

5. **Debugging**: JSON-RPC communication adds a layer of indirection. Debugging tool call failures requires understanding the RPC protocol.

---

## 9. JSON-RPC Protocol Details

### Message Categories

**SDK to CLI (Requests)**:

- `session.create` -- Create a new session
- `session.send` -- Send a message/prompt
- `ping` -- Protocol version check
- `models.list` -- Query available models

**CLI to SDK (Callbacks -- expect response)**:

- `tool.call` -- Invoke a custom tool handler
- `permission.request` -- Request permission for an action
- `session.askUserInput` -- Request user input

**CLI to SDK (Notifications -- no response expected)**:

- `assistant.message` -- Complete message
- `assistant.message_delta` -- Streaming chunk
- `assistant.reasoning` -- Reasoning trace
- `tool.execution_start` -- Tool invocation begins
- `tool.execution_complete` -- Tool invocation ends
- `session.idle` -- Ready for next input
- `session.start` -- Session initialized
- `session.error` -- Error occurred

### Transport Options

- **stdio** (default): CLI spawned with `--headless --stdio`, communication over stdin/stdout pipes
- **TCP**: CLI spawned with `--headless --port N`, communication over TCP socket

---

## 10. Integration Strategy for Ptah Extension

### Recommended Approach

Replace `CopilotCliAdapter.runSdk()` with SDK-based implementation while maintaining the `CliAdapter` interface contract:

```typescript
// Conceptual sketch -- NOT production code
import { CopilotClient } from '@github/copilot-sdk';

export class CopilotCliAdapter implements CliAdapter {
  private client: CopilotClient | null = null;

  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    if (!this.client) {
      this.client = new CopilotClient({
        cliPath: options.binaryPath,
        autoRestart: true,
      });
      await this.client.start();
    }

    const abortController = new AbortController();
    const outputCallbacks: Array<(data: string) => void> = [];
    const outputBuffer: string[] = [];

    const session = await this.client.createSession({
      model: options.model ?? 'gpt-4.1',
      streaming: true,
      tools: this.buildPtahTools(options.mcpPort),
      hooks: {
        onPreToolUse: async (event) => {
          // Route to VS Code permission dialog
          return { permissionDecision: 'allow' };
        },
      },
    });

    // Map SDK events to SdkHandle.onOutput
    session.on('assistant.message_delta', (ev) => {
      emit(ev.data.deltaContent);
    });
    session.on('tool.execution_start', (ev) => {
      emit(`[Tool] ${ev.data.toolName}\n`);
    });

    // Send the task prompt
    const taskPrompt = buildTaskPrompt(options);
    const sendPromise = session.send({ prompt: taskPrompt });

    // Map session.idle to "done"
    const done = new Promise<number>((resolve) => {
      session.on('session.idle', () => resolve(0));
      session.on('session.error', () => resolve(1));
    });

    return { abort: abortController, done, onOutput: (cb) => outputCallbacks.push(cb) };
  }
}
```

### Migration Considerations

1. **Keep `buildCommand()` as fallback**: The raw CLI spawn path should remain for users who do not have the SDK installed or for debugging.

2. **Reuse client instance**: Create a single `CopilotClient` per extension activation, not per task. This avoids spawning multiple CLI processes.

3. **Map events to `CliOutputSegment`**: The structured events from the SDK can populate the `onSegment` callback in `SdkHandle`, enabling richer UI rendering in the webview.

4. **MCP integration**: Instead of `--additional-mcp-config` CLI flags, consider injecting Ptah tools directly as custom tools via Zod schemas. This eliminates the MCP server overhead for Ptah-specific capabilities.

5. **Permission routing**: Wire `onPreToolUse` to the VS Code webview via the existing RPC bridge, allowing users to approve/deny file edits from the chat UI.

---

## 11. Sources

### Primary Sources (Official)

1. [GitHub Copilot SDK - Getting Started (GitHub Docs)](https://docs.github.com/en/copilot/how-tos/copilot-sdk/sdk-getting-started)
2. [GitHub Copilot SDK Repository](https://github.com/github/copilot-sdk)
3. [Copilot SDK Getting Started Guide](https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md)
4. [Copilot SDK Node.js README](https://github.com/github/copilot-sdk/blob/main/nodejs/README.md)
5. [@github/copilot-sdk on npm](https://www.npmjs.com/package/@github/copilot-sdk)
6. [Copilot SDK Technical Preview Announcement](https://github.blog/changelog/2026-01-14-copilot-sdk-in-technical-preview/)
7. [Hooks Configuration Reference (GitHub Docs)](https://docs.github.com/en/copilot/reference/hooks-configuration)

### Secondary Sources (Analysis & Tutorials)

8. [Build an Agent into Any App with the GitHub Copilot SDK (GitHub Blog)](https://github.blog/news-insights/company-news/build-an-agent-into-any-app-with-the-github-copilot-sdk/)
9. [GitHub Copilot SDK Architecture (DeepWiki)](https://deepwiki.com/github/copilot-sdk)
10. [DeepWiki: Examples and Cookbook](https://deepwiki.com/github/copilot-sdk/10-examples-and-cookbook)
11. [GitHub Copilot SDK Lets Developers Integrate Copilot CLI Engine into Apps (InfoQ)](https://www.infoq.com/news/2026/02/github-copilot-sdk/)
12. [Building Agents with GitHub Copilot SDK (Microsoft Tech Community)](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/building-agents-with-github-copilot-sdk-a-practical-guide-to-automated-tech-upda/4488948)
13. [Azure MCP Server + Copilot SDK Integration (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/how-to/github-copilot-sdk)
14. [Copilot CLI Enhanced Agents Changelog](https://github.blog/changelog/2026-01-14-github-copilot-cli-enhanced-agents-context-management-and-new-ways-to-install/)
15. [GitHub Copilot SDK for .NET Guide](https://www.devleader.ca/2026/02/26/github-copilot-sdk-for-net-complete-developer-guide)
