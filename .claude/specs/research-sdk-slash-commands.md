# Research Report: Why SDK Slash Commands Don't Work via query()

## Executive Summary

**Root Cause Identified**: The `/clear` command has `supportsNonInteractive: false`, which causes it to be filtered out of the available commands list when the CLI runs in SDK (non-interactive) mode. When sent via `query()`, the CLI does NOT recognize it as a valid command and silently returns with no output.

**Key Finding**: Slash commands DO work via `query()` according to official documentation and source code -- but ONLY commands with `supportsNonInteractive: true`. The `/clear` command is specifically excluded from non-interactive mode.

---

## 1. How Does the SDK Parse Slash Commands from query({ prompt: "..." })?

### The Full Message Flow

1. **SDK side** (`sdk.mjs`): When `query({ prompt: "/clear" })` is called, the SDK wraps the string into a structured message and writes it to the CLI's stdin:

   ```javascript
   // sdk.mjs - sT function (the exported `query`)
   if (typeof Q === 'string')
     B7.write(
       JSON.stringify({
         type: 'user',
         session_id: '',
         message: { role: 'user', content: [{ type: 'text', text: '/clear' }] },
         parent_tool_use_id: null,
       }) + '\n'
     );
   ```

2. **CLI stdin parsing** (`cli.js` - `Ml1.processLine`): The CLI reads the JSON line from stdin, parses it, validates it's a `type: "user"` message, and yields it to the message loop.

3. **Print mode message loop** (`cli.js`): The message is added to `queuedCommands` with `mode: "prompt"` and `value: z1.message.content` (the content block array).

4. **Command dequeue** (`cli.js` - `mX6`): The queued command is dequeued and its `value` (content array) is passed as `prompt` to `IWq` (the main agent turn function).

5. **Input processing** (`cli.js` - `M0z` called by `FE6`): The text is extracted from the content blocks. If it starts with `/`, the slash command handler `cQ4` is called.

6. **Command lookup** (`cli.js` - `cQ4`): Parses the command name, looks it up in the available commands list, and dispatches to the appropriate handler.

### Key Code Path (cli.js - M0z function)

```javascript
// Extract text from content blocks
let W = null;
if (typeof A === "string") W = A;
else if (A.length > 0) {
  // Extract last text block as the main text
  let m = S[S.length - 1];
  if (m?.type === "text") W = m.text;
}

// Check if text starts with /
if (W !== null && W.startsWith("/")) {
  let S = await cQ4(W, ...); // Slash command handler
  return S;
}
```

---

## 2. Does the SDK Support Slash Commands via query(), or Only in REPL Mode?

**YES, the SDK supports slash commands via query()** -- this is confirmed by both:

- Official documentation at https://platform.claude.com/docs/en/agent-sdk/slash-commands
- Source code analysis showing the complete parsing pipeline

**HOWEVER**, not all commands work. The CLI filters commands based on `supportsNonInteractive`:

```javascript
// cli.js - Command filtering for SDK/print mode
let DA = o ? [] : H6.filter((A4) => (A4.type === 'prompt' && !A4.disableNonInteractive) || (A4.type === 'local' && A4.supportsNonInteractive));
```

### Commands That Work via SDK (supportsNonInteractive: true)

| Command                                   | Type   | Works via SDK                               |
| ----------------------------------------- | ------ | ------------------------------------------- |
| `/compact`                                | local  | YES                                         |
| `/context`                                | local  | YES                                         |
| `/cost`                                   | local  | YES                                         |
| `/release-notes`                          | local  | YES                                         |
| Custom commands (`.claude/commands/*.md`) | prompt | YES (unless `disableNonInteractive` is set) |
| Plugin commands                           | prompt | YES                                         |

### Commands That DO NOT Work via SDK (supportsNonInteractive: false)

| Command              | Type  | Works via SDK |
| -------------------- | ----- | ------------- |
| `/clear`             | local | NO            |
| `/color`             | local | NO            |
| `/copy`              | local | NO            |
| `/keybindings`       | local | NO            |
| `/install-slack-app` | local | NO            |
| `/rename`            | local | NO            |

---

## 3. What Happens When /clear Is Sent as the Initial Prompt?

### Step-by-step trace:

1. SDK sends `{ type: "user", message: { content: [{ type: "text", text: "/clear" }] } }` to CLI stdin
2. CLI parses it and adds to `queuedCommands`
3. The command is dequeued and passed to `IWq` -> `FE6` -> `M0z`
4. `M0z` extracts text `"/clear"`, sees it starts with `/`, calls `cQ4`
5. `cQ4` calls `pQ4` to parse: `{ commandName: "clear", args: "", isMcp: false }`
6. `cQ4` calls `_c("clear", commands)` to check if the command exists in the available list
7. **CRITICAL**: In SDK mode, `/clear` was FILTERED OUT of the commands list (because `supportsNonInteractive: false`)
8. `_c` returns `false` because "clear" is not in the filtered command list
9. Since "clear" is NOT in the `Oc()` set of recognized commands (that set uses the full list, but `_c` uses the filtered list), the code checks if a file `/clear` exists on disk
10. The code path treats it as a potential file path or falls through to sending it as a regular user prompt to Claude
11. Claude sees "/clear" as text, may produce a brief response (the "2 SDK messages, 0 stream events" behavior)
12. The query exits with code 0

### The "2 SDK messages" behavior

The 2 messages are likely:

- 1 `system` init message
- 1 `result` message (with empty or minimal result since the command was not recognized)

The 0 stream events confirms no assistant response was generated -- the prompt was either swallowed or produced an empty result.

---

## 4. How Does streamInput() Work?

`streamInput()` on the Query object (`Y4` class in sdk.mjs) iterates over an async iterable of `SDKUserMessage` objects and writes each one to the CLI's stdin transport:

```javascript
async streamInput(Q) {
  let X = 0;
  for await (let Y of Q) {
    if (X++, this.abortController?.signal.aborted) break;
    await Promise.resolve(this.transport.write(JSON.stringify(Y) + "\n"));
  }
  if (X > 0 && this.hasBidirectionalNeeds())
    await this.waitForFirstResult();
  this.transport.endInput(); // Close stdin
}
```

Key behaviors:

- It serializes each `SDKUserMessage` as JSON and writes to the CLI process stdin
- After all messages are sent, if the query has bidirectional needs (hooks, MCP servers, canUseTool), it waits for the first result before closing stdin
- Otherwise it calls `endInput()` to close stdin, signaling the CLI that no more input is coming
- The CLI's message loop then processes all queued messages and exits

### Does streamInput keep the session alive?

No. After `streamInput` finishes iterating the async iterable, it closes stdin. The CLI processes remaining messages and exits. For long-lived sessions, you need the V2 API (`unstable_v2_createSession`).

---

## 5. Do Plugin Commands Work via the query API?

**YES.** Plugin commands work via `query()` because they are registered as `type: "prompt"` commands, and the filtering logic for non-interactive mode only excludes `type: "local"` commands that have `supportsNonInteractive: false`.

Plugin commands are loaded via the `plugins` option:

```typescript
query({
  prompt: '/my-plugin:greet',
  options: {
    plugins: [{ type: 'local', path: './my-plugin' }],
  },
});
```

The CLI passes `--plugin-dir <path>` for each plugin, and plugin commands are namespaced as `plugin-name:command-name`.

Custom commands from `.claude/commands/*.md` also work via `query()` since they are `type: "prompt"` commands.

---

## 6. CLI vs SDK API Command Handling Differences

| Aspect               | Interactive CLI (REPL)                           | SDK API (query/print mode)                                 |
| -------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Command availability | ALL commands                                     | Only `supportsNonInteractive: true` for local commands     |
| Input parsing        | React-based `Xk` callback handles keyboard input | `Ml1.processLine` parses JSON from stdin                   |
| Slash detection      | `v6.trim().startsWith("/")` in Xk                | `W.startsWith("/")` in M0z                                 |
| Command execution    | `local-jsx` type renders React UI                | `local-jsx` returns `{ messages: [], shouldQuery: false }` |
| `/clear` behavior    | Calls `u8("clear")` to exit with "clear" reason  | Command not found in filtered list                         |
| Session lifecycle    | REPL stays alive for more input                  | Single query execution, exits when done                    |

### The V2 Session API

The `unstable_v2_createSession()` / `unstable_v2_resumeSession()` API creates a session object with a `send()` method:

```typescript
// sdk.mjs - Session.send()
async send(Q) {
  let X = typeof Q === "string"
    ? { type: "user", session_id: "", message: { role: "user", content: [{ type: "text", text: Q }] }, parent_tool_use_id: null }
    : Q;
  this.inputStream.enqueue(X);
}
```

This pipes messages through `streamInput()` to the same CLI process. The same command filtering applies -- `/clear` would still not work because the CLI's command list is filtered in non-interactive mode.

---

## Recommendations

### For /clear functionality via SDK

The `/clear` command in the CLI does `u8("clear")` which sets the exit reason to "clear" and terminates the session. In SDK mode, this is meaningless because:

1. Each `query()` call is a separate CLI process
2. The SDK manages sessions externally

**To achieve "clear" behavior via SDK**, you should NOT try to send `/clear` as a prompt. Instead:

- Start a new `query()` call without `resume` or `continue` options
- Or use the V2 API: create a new session via `unstable_v2_createSession()`

### For /compact functionality via SDK

`/compact` has `supportsNonInteractive: true` and DOES work via `query()`:

```typescript
for await (const message of query({ prompt: '/compact', options: { maxTurns: 1 } })) {
  if (message.type === 'system' && message.subtype === 'compact_boundary') {
    console.log('Compaction completed');
  }
}
```

### For custom/plugin commands via SDK

These work as documented:

```typescript
query({ prompt: "/my-custom-command args", options: { ... } })
```

### Discovering available commands

Use `supportedCommands()` on the Query object to get the list of commands available in the current session:

```typescript
const q = query({ prompt: 'Hello', options: {} });
const commands = await q.supportedCommands();
// Returns SlashCommand[] - only commands valid for current mode
```

---

## Source References

1. **SDK source**: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (v0.2.42)

   - `sT` function (exported as `query`) - line ~373908
   - `Y4` class (Query object) - constructor, streamInput, supportedCommands

2. **CLI source**: `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` (claudeCodeVersion: 2.1.42)

   - `Ml1` class - stdin JSON parsing (pos ~10795781)
   - `M0z` function - input processing with slash detection (pos ~10817661)
   - `cQ4` function - slash command handler (pos ~8136978)
   - `pQ4` function - command name parser (pos ~8136978)
   - `FE6` function - main input processor (pos ~10817661)
   - `hWq.submitMessage` - non-interactive query execution (pos ~10835042)
   - Clear command definition: `supportsNonInteractive: false` (pos ~9183352)
   - Command filtering for non-interactive mode (pos ~11410217)

3. **Official documentation**: https://platform.claude.com/docs/en/agent-sdk/slash-commands

4. **SDK type definitions**: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
   - `SlashCommand` type (line 1744)
   - `supportedCommands()` method (line 1050)
   - `ExitReason` type includes "clear" (line 252)
