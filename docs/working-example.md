Great question. At a high level, you need three pieces working together:

1. Spawn the Claude Code CLI process for each user turn and stream its JSONL output

- Use child_process.spawn (not exec) so you can stream stdout progressively.
- Pass --output-format stream-json --verbose and write the user text to stdin.
- Parse stdout line-by-line (each line is a JSON object) and update your UI/state accordingly.
- Keep a handle to the running process so you can stop it and so you don’t start two at once.

2. Maintain session and UI state in the extension

- Track sessionId returned by the CLI and pass --resume <sessionId> on later turns.
- Track isProcessing, token totals, request count, last error, and your conversation log.
- Persist lightweight state to workspaceState (e.g., sessionId, selected model) and heavier logs to files under context.storageUri.

3. Bridge the webview and CLI

- In onDidReceiveMessage from the webview, route to sendMessage/stop/newSession/etc.
- Use webview.postMessage to stream updates back to the UI as you parse CLI output.

Below is a minimal, self-contained skeleton that shows a robust pattern to connect to the CLI, stream results, manage state, and integrate with your webview.

Types and a simple CLI client you can drop into your extension

```typescript
// Minimal Claude CLI client: spawns the process, streams JSON lines, and exposes events.

import * as cp from 'child_process';
import { EventEmitter } from 'events';

type ClaudeJsonEvent =
  | { type: 'system'; subtype?: 'init'; session_id?: string; tools?: any[]; mcp_servers?: any[] }
  | { type: 'assistant'; message?: { content?: Array<any>; usage?: any } }
  | { type: 'user'; message?: { content?: Array<any> } }
  | {
      type: 'result';
      subtype?: 'success' | 'error';
      is_error?: boolean;
      result?: string;
      session_id?: string;
      total_cost_usd?: number;
      duration_ms?: number;
      num_turns?: number;
    }
  | any;

export interface ClaudeSendOptions {
  model?: string; // e.g., 'sonnet' | 'opus' | 'default'
  resumeSessionId?: string; // pass to --resume
  mcpConfigPath?: string; // pass to --mcp-config if you’re using MCP
  yoloMode?: boolean; // if true, add --dangerously-skip-permissions
  useWSL?: boolean; // Windows + WSL scenario
  wsl: { distro: string; nodePath: string; claudePath: string }; // for WSL
  cwd?: string;
}

export interface ClaudeEvents {
  ready: () => void;
  json: (evt: ClaudeJsonEvent) => void;
  tokens: (usage: { input?: number; output?: number; cacheCreation?: number; cacheRead?: number }) => void;
  text: (text: string) => void;
  thinking: (text: string) => void;
  toolUse: (payload: { name: string; input: any }) => void;
  toolResult: (payload: { content: string; isError?: boolean; toolUseId?: string }) => void;
  session: (info: { sessionId: string; tools?: any[]; mcpServers?: any[] }) => void;
  result: (payload: { totalCost?: number; durationMs?: number; turns?: number; sessionId?: string }) => void;
  error: (message: string) => void;
  closed: (code: number | null) => void;
}

export class ClaudeCliClient extends EventEmitter {
  private proc?: cp.ChildProcess;
  private buffer = '';

  constructor() {
    super();
  }

  // Send a single user turn to the CLI and stream its response.
  send(message: string, opts: ClaudeSendOptions) {
    if (this.proc) {
      this.emit('error', 'A Claude process is already running');
      return;
    }

    const args = ['-p', '--output-format', 'stream-json', '--verbose'];

    if (opts.yoloMode) {
      args.push('--dangerously-skip-permissions');
    } else if (opts.mcpConfigPath) {
      args.push('--mcp-config', opts.mcpConfigPath);
      // Optionally set allowed tools or custom permission prompt tool if you implement MCP workflow
      // args.push('--allowedTools', 'mcp__claude-code-chat-permissions__approval_prompt');
      // args.push('--permission-prompt-tool', 'mcp__claude-code-chat-permissions__approval_prompt');
    }

    if (opts.model && opts.model !== 'default') {
      args.push('--model', opts.model);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };

    if (opts.useWSL) {
      const wslCmd = `"${opts.wsl.nodePath}" --no-warnings --enable-source-maps "${opts.wsl.claudePath}" ${args.join(' ')}`;
      this.proc = cp.spawn('wsl', ['-d', opts.wsl.distro, 'bash', '-ic', wslCmd], {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    } else {
      this.proc = cp.spawn('claude', args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: process.platform === 'win32', // helps find claude on Windows PATH
      });
    }

    // Stream handling
    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt: ClaudeJsonEvent = JSON.parse(trimmed);
          this.emit('json', evt);
          this.routeJson(evt);
        } catch (e) {
          // Not JSON? Ignore or log
        }
      }
    });

    let stderrBuf = '';
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    this.proc.on('close', (code) => {
      this.proc = undefined;
      if (stderrBuf.trim()) {
        this.emit('error', stderrBuf.trim());
      }
      this.emit('closed', code);
    });

    this.proc.on('error', (err: Error) => {
      this.proc = undefined;
      if (err.message.includes('ENOENT') || err.message.includes('command not found')) {
        this.emit('error', 'Claude CLI not found. Install: https://www.anthropic.com/claude-code');
      } else {
        this.emit('error', `Error running Claude: ${err.message}`);
      }
    });

    // Write the user message
    this.proc.stdin?.write(message + '\n');
    this.proc.stdin?.end();
    this.emit('ready');
  }

  stop() {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = undefined;

    p.kill('SIGTERM');
    setTimeout(() => {
      if (!p.killed) p.kill('SIGKILL');
    }, 2000);
  }

  private routeJson(json: ClaudeJsonEvent) {
    switch (json.type) {
      case 'system':
        if ((json as any).subtype === 'init') {
          const sessionId = (json as any).session_id;
          if (sessionId) {
            this.emit('session', {
              sessionId,
              tools: (json as any).tools,
              mcpServers: (json as any).mcp_servers,
            });
          }
        }
        break;

      case 'assistant': {
        const msg = (json as any).message;
        if (msg?.usage) {
          this.emit('tokens', {
            input: msg.usage.input_tokens,
            output: msg.usage.output_tokens,
            cacheCreation: msg.usage.cache_creation_input_tokens,
            cacheRead: msg.usage.cache_read_input_tokens,
          });
        }
        for (const c of msg?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) this.emit('text', c.text.trim());
          if (c.type === 'thinking' && c.thinking?.trim()) this.emit('thinking', c.thinking.trim());
          if (c.type === 'tool_use') this.emit('toolUse', { name: c.name, input: c.input });
        }
        break;
      }

      case 'user': {
        const msg = (json as any).message;
        for (const c of msg?.content ?? []) {
          if (c.type === 'tool_result') {
            const content = typeof c.content === 'object' ? JSON.stringify(c.content, null, 2) : c.content ?? '';
            this.emit('toolResult', {
              content,
              isError: c.is_error,
              toolUseId: c.tool_use_id,
            });
          }
        }
        break;
      }

      case 'result': {
        if ((json as any).subtype === 'success') {
          const sessionId = (json as any).session_id;
          this.emit('result', {
            totalCost: (json as any).total_cost_usd,
            durationMs: (json as any).duration_ms,
            turns: (json as any).num_turns,
            sessionId,
          });
        }
        break;
      }
    }
  }
}
```

How to wire it into your VS Code extension’s webview flow

- Keep a single ClaudeCliClient instance on your provider class.
- On sendMessage from the webview, set isProcessing = true, clear any draft input, optionally prepend plan/thinking prefixes, and call client.send.
- Subscribe to client events and relay updates to the webview via postMessage.
- On stopRequest, call client.stop() and set isProcessing = false.
- Persist state as needed.

Example integration snippet:

```typescript
// In your provider class
private client = new ClaudeCliClient();
private isProcessing = false;
private sessionId: string | undefined;
private totalTokensInput = 0;
private totalTokensOutput = 0;
private totalCost = 0;
private requestCount = 0;

constructor(private readonly context: vscode.ExtensionContext) {
  // Restore sessionId if you saved it previously
  this.sessionId = this.context.workspaceState.get<string>('sessionId');

  // Wire client events to your webview
  this.client.on('ready', () => {
    this.post({ type: 'setProcessing', data: { isProcessing: true } });
  });

  this.client.on('session', ({ sessionId }) => {
    this.sessionId = sessionId;
    void this.context.workspaceState.update('sessionId', sessionId);
    this.post({ type: 'sessionInfo', data: { sessionId } });
  });

  this.client.on('tokens', (u) => {
    this.totalTokensInput += u.input ?? 0;
    this.totalTokensOutput += u.output ?? 0;
    this.post({ type: 'updateTokens', data: {
      totalTokensInput: this.totalTokensInput,
      totalTokensOutput: this.totalTokensOutput,
      currentInputTokens: u.input ?? 0,
      currentOutputTokens: u.output ?? 0,
      cacheCreationTokens: u.cacheCreation ?? 0,
      cacheReadTokens: u.cacheRead ?? 0
    }});
  });

  this.client.on('text', (text) => this.post({ type: 'output', data: text }));
  this.client.on('thinking', (text) => this.post({ type: 'thinking', data: text }));
  this.client.on('toolUse', (t) => this.post({ type: 'toolUse', data: { toolInfo: `🔧 Executing: ${t.name}`, rawInput: t.input, toolName: t.name } }));
  this.client.on('toolResult', (r) => this.post({ type: 'toolResult', data: r }));

  this.client.on('result', (r) => {
    this.isProcessing = false;
    this.requestCount++;
    if (typeof r.totalCost === 'number') this.totalCost += r.totalCost;
    if (r.sessionId && !this.sessionId) {
      this.sessionId = r.sessionId;
      void this.context.workspaceState.update('sessionId', r.sessionId);
    }
    this.post({ type: 'setProcessing', data: { isProcessing: false } });
    this.post({ type: 'updateTotals', data: {
      totalCost: this.totalCost,
      totalTokensInput: this.totalTokensInput,
      totalTokensOutput: this.totalTokensOutput,
      requestCount: this.requestCount,
      currentCost: r.totalCost,
      currentDuration: r.durationMs,
      currentTurns: r.turns
    }});
  });

  this.client.on('error', (msg) => {
    this.isProcessing = false;
    this.post({ type: 'setProcessing', data: { isProcessing: false } });
    this.post({ type: 'error', data: msg });
  });

  this.client.on('closed', () => {
    this.isProcessing = false;
    this.post({ type: 'setProcessing', data: { isProcessing: false } });
  });
}

private post(msg: any) {
  this._panel?.webview.postMessage(msg) ?? this._webview?.postMessage(msg);
}

private sendToClaude(text: string, opts: { planMode?: boolean; thinkingMode?: boolean }) {
  if (this.isProcessing) {
    vscode.window.showWarningMessage('Please wait for the current request to finish.');
    return;
  }

  // Optional prefixes for planning/thinking
  let actualText = text;
  if (opts.planMode) {
    actualText = 'PLAN FIRST FOR THIS MESSAGE ONLY: ' + actualText;
  }
  if (opts.thinkingMode) {
    actualText = 'THINK THROUGH THIS STEP BY STEP:\n' + actualText;
  }

  this.isProcessing = true;
  this.post({ type: 'userInput', data: text });
  this.post({ type: 'setProcessing', data: { isProcessing: true } });
  this.post({ type: 'loading', data: 'Claude is working...' });

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();

  // Read your settings (model, WSL, MCP, YOLO) from configuration
  const cfg = vscode.workspace.getConfiguration('yourExtensionId');
  const wslEnabled = cfg.get<boolean>('wsl.enabled', false);
  const model = cfg.get<string>('model', 'default');
  const yolo = cfg.get<boolean>('permissions.yoloMode', false);
  const mcpConfigPath = cfg.get<string>('mcp.configPath'); // optional
  const wsl = {
    distro: cfg.get<string>('wsl.distro', 'Ubuntu')!,
    nodePath: cfg.get<string>('wsl.nodePath', '/usr/bin/node')!,
    claudePath: cfg.get<string>('wsl.claudePath', '/usr/local/bin/claude')!,
  };

  this.client.send(actualText, {
    model,
    resumeSessionId: this.sessionId,
    mcpConfigPath,
    yoloMode: yolo,
    useWSL: wslEnabled,
    wsl,
    cwd,
  });
}

// In your webview message handler:
switch (message.type) {
  case 'sendMessage':
    this.sendToClaude(message.text, { planMode: message.planMode, thinkingMode: message.thinkingMode });
    break;
  case 'stopRequest':
    this.client.stop();
    break;
  case 'newSession':
    this.sessionId = undefined;
    this.isProcessing = false;
    this.post({ type: 'sessionCleared' });
    break;
}
```

Key tips and pitfalls

- Use spawn, not exec: exec buffers output; spawn lets you stream JSON lines as they arrive.
- Parse by lines: The CLI emits one JSON object per line. Keep an incomplete tail between chunks.
- Handle ENOENT gracefully: surface a helpful “Install Claude Code” message if the CLI isn’t found.
- Session management: Store sessionId when you see it in system/init or in result.success. Pass --resume for continuity across turns.
- Cancelation: SIGTERM first, then SIGKILL after a short timeout. Remember to set isProcessing = false and clear loading UI.
- Windows/WSL: If you use WSL, run via wsl -d <distro> bash -ic "<node> <claude> args". Convert Windows paths to /mnt/c/… if you pass host paths into WSL.
- MCP and permissions: Optional. If you add permissions via MCP, point --mcp-config to a JSON config and implement a small file-based permission request loop or a direct IPC to your extension, as in the reference you shared.
- Persisting conversations: Save messages to context.storageUri to reload on activation. Keep a small index in workspaceState to show a “recent conversations” list.

If you share a bit about your current extension structure (panel vs. sidebar, whether you need MCP/WSL, and how you want to persist state), I can tailor the client and the wiring code to match your exact setup.
