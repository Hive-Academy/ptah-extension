/**
 * The REAL `SdkInternalQueryCuratorLlm` over an `InternalQueryService`-shaped
 * stand-in (implementation-plan.md:906-920).
 *
 * - `resolver: null`, `mcpServerStatus: null` (so the adapter itself asks for
 *   `mcpServerRunning: false`), and a workspace stub answering exactly what the
 *   adapter calls on it: `getWorkspaceRoot()` (resolveQueryCwd) and
 *   `getConfiguration('ptah', 'memory.curatorModel' | 'memory.curatorProvider', '')`
 *   (resolveCuratorModel / resolveCuratorProviderId) — both return the default
 *   `''`, so the model is the production default tier alias `haiku`.
 * - `execute(config)` forwards to `@anthropic-ai/claude-agent-sdk` `query()`
 *   with `config.model`, `config.maxTurns`, `config.cwd`,
 *   `config.abortController`, and `config.systemPromptAppend` appended to the
 *   `claude_code` preset — the same `{ type: 'preset', preset: 'claude_code',
 *   append }` shape `SdkQueryRunner.buildOneShotSystemPrompt` builds
 *   (sdk-query-runner.service.ts:510-540). It returns `{ stream, abort, close }`
 *   (internal-query.types.ts:103-114).
 * - Variant `old`: first ASSERTS the received append equals the branch
 *   constant, then substitutes the base-commit text captured by `git show
 *   ebfc73321:...` into `%TEMP%\mqs-563-eval\old-*.txt`. Variant `new`:
 *   asserts equality and forwards unchanged. Either way the adapter's
 *   `runQuery`, last-message capture and `parseDrafts`/`parseResolved` run
 *   verbatim.
 *
 * MCP IS OFF for every call (plan:926-932): `mcpServers: {}` plus
 * `strictMcpConfig: true` (ignores user/project/plugin MCP config) and
 * `settingSources: []` (no user hooks, plugins or CLAUDE.md). With the real
 * Ptah MCP server `ptah_memory_search` would read and record usage on the live
 * database. Built-in tools are limited to the read-only `Read`, `Grep`,
 * `Glob` (the prompts name `Read`/`Grep`), with a `canUseTool` that denies
 * everything else, so a harness call can never write a file.
 * `persistSession: false`, so no session JSONL is written under
 * `~/.claude/projects`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdkInternalQueryCuratorLlm } from '../../../../../libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm';
import { EXTRACT_SYSTEM_PROMPT } from '../../../../../libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt';
import { RESOLVE_SYSTEM_PROMPT } from '../../../../../libs/backend/agent-sdk/src/lib/curator-llm-adapter/resolve-prompt';
import { EVAL_DIR } from './copy-db';

export type PromptVariant = 'old' | 'new';

export interface LlmCallRecord {
  readonly label: string;
  readonly variant: PromptVariant;
  readonly promptKind: 'extract' | 'resolve';
  readonly model: string;
  readonly resolvedModel: string | null;
  readonly cwd: string;
  readonly maxTurns: number | undefined;
  readonly mcpServerRunningRequested: boolean;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly resultSubtype: string | null;
  readonly numTurns: number | null;
  readonly usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  readonly totalCostUsd: number | null;
  readonly toolUses: string[];
  readonly lastAssistantText: string;
  readonly error: string | null;
}

interface InternalQueryConfigLike {
  cwd: string;
  model: string;
  prompt: string;
  systemPromptAppend?: string;
  mcpServerRunning: boolean;
  mcpPort?: number;
  maxTurns?: number;
  abortController?: AbortController;
}

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

/** Env vars that tie a child `claude` to THIS agent session; never forwarded. */
const SESSION_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_AGENT_SDK_VERSION',
];

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SESSION_ENV_KEYS.includes(k)) continue;
    // Empty auth/routing vars would shadow the CLI's own login; drop them.
    if (k.startsWith('ANTHROPIC_') && v.trim() === '') continue;
    env[k] = v;
  }
  return env;
}

export function loadOldPrompt(kind: 'extract' | 'resolve'): string {
  const file = path.join(
    EVAL_DIR,
    kind === 'extract'
      ? 'old-EXTRACT_SYSTEM_PROMPT.txt'
      : 'old-RESOLVE_SYSTEM_PROMPT.txt',
  );
  return fs.readFileSync(file, 'utf8');
}

/** Per-call label carried across the adapter's awaits. */
export const callLabel = new AsyncLocalStorage<string>();

interface SdkModule {
  query(params: {
    prompt: string;
    options: Record<string, unknown>;
  }): AsyncIterable<unknown> & {
    return?: () => Promise<unknown>;
    interrupt?: () => Promise<void>;
  };
}

export class HarnessInternalQuery {
  private sdk: SdkModule | null = null;

  constructor(
    private readonly variant: PromptVariant,
    private readonly sink: (record: LlmCallRecord) => void,
    private readonly timeoutMs = 240_000,
  ) {}

  async execute(config: InternalQueryConfigLike): Promise<{
    stream: AsyncIterable<unknown>;
    abort(): void;
    close(): void;
  }> {
    const received = config.systemPromptAppend ?? '';
    let promptKind: 'extract' | 'resolve';
    if (received === EXTRACT_SYSTEM_PROMPT) promptKind = 'extract';
    else if (received === RESOLVE_SYSTEM_PROMPT) promptKind = 'resolve';
    else {
      throw new Error(
        'harness stand-in: systemPromptAppend does not equal the branch EXTRACT/RESOLVE constant',
      );
    }
    const append =
      this.variant === 'old' ? loadOldPrompt(promptKind) : received;
    if (config.mcpServerRunning) {
      throw new Error(
        'harness stand-in: the adapter asked for MCP; the harness runs MCP-off only',
      );
    }
    this.sdk ??= require('@anthropic-ai/claude-agent-sdk') as SdkModule;
    const abortController = config.abortController ?? new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeoutMs);
    const label = callLabel.getStore() ?? '(unlabelled)';
    const started = new Date();
    const t0 = performance.now();
    const q = this.sdk.query({
      prompt: config.prompt,
      options: {
        cwd: config.cwd,
        model: config.model,
        maxTurns: config.maxTurns,
        abortController,
        systemPrompt: { type: 'preset', preset: 'claude_code', append },
        tools: READ_ONLY_TOOLS,
        allowedTools: READ_ONLY_TOOLS,
        canUseTool: async (toolName: string, input: Record<string, unknown>) =>
          READ_ONLY_TOOLS.includes(toolName)
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'harness: read-only tools only' },
        mcpServers: {},
        strictMcpConfig: true,
        settingSources: [],
        persistSession: false,
        env: childEnv(),
      },
    });
    const record = {
      resolvedModel: null as string | null,
      resultSubtype: null as string | null,
      numTurns: null as number | null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      totalCostUsd: null as number | null,
      toolUses: [] as string[],
      lastAssistantText: '',
      error: null as string | null,
    };
    const finish = (): void => {
      clearTimeout(timer);
      this.sink({
        label,
        variant: this.variant,
        promptKind,
        model: config.model,
        cwd: config.cwd,
        maxTurns: config.maxTurns,
        mcpServerRunningRequested: config.mcpServerRunning,
        startedAt: started.toISOString(),
        durationMs: Math.round(performance.now() - t0),
        ...record,
      });
    };
    async function* observed(): AsyncGenerator<unknown> {
      try {
        for await (const raw of q) {
          const msg = raw as Record<string, unknown>;
          if (msg['type'] === 'system' && msg['subtype'] === 'init') {
            record.resolvedModel =
              typeof msg['model'] === 'string'
                ? (msg['model'] as string)
                : null;
          }
          if (msg['type'] === 'assistant') {
            const content = ((msg['message'] as { content?: unknown[] })
              ?.content ?? []) as Array<Record<string, unknown>>;
            let text = '';
            for (const block of content) {
              if (block['type'] === 'text') text += String(block['text'] ?? '');
              if (block['type'] === 'tool_use')
                record.toolUses.push(String(block['name'] ?? ''));
            }
            record.lastAssistantText = text;
          }
          if (msg['type'] === 'result') {
            record.resultSubtype = String(msg['subtype'] ?? '');
            record.numTurns =
              typeof msg['num_turns'] === 'number'
                ? (msg['num_turns'] as number)
                : null;
            const u = (msg['usage'] ?? {}) as Record<string, number>;
            record.usage = {
              input_tokens: Number(u['input_tokens'] ?? 0),
              output_tokens: Number(u['output_tokens'] ?? 0),
              cache_read_input_tokens: Number(
                u['cache_read_input_tokens'] ?? 0,
              ),
              cache_creation_input_tokens: Number(
                u['cache_creation_input_tokens'] ?? 0,
              ),
            };
            record.totalCostUsd =
              typeof msg['total_cost_usd'] === 'number'
                ? (msg['total_cost_usd'] as number)
                : null;
          }
          yield raw;
        }
      } catch (err: unknown) {
        record.error = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        finish();
        // The adapter breaks on the result message; release the subprocess.
        await q.return?.().catch(() => undefined);
      }
    }
    return {
      stream: observed(),
      abort: () => abortController.abort(),
      close: () => {
        void q.return?.();
      },
    };
  }
}

/** Workspace stub: exactly the two members the adapter reads. */
export function makeWorkspaceStub(root: string): never {
  return {
    getWorkspaceRoot: () => root,
    getConfiguration: <T>(_section: string, _key: string, defaultValue?: T) =>
      defaultValue,
  } as never;
}

export function buildCuratorLlm(
  variant: PromptVariant,
  logger: never,
  workspaceRoot: string,
  sink: (record: LlmCallRecord) => void,
): SdkInternalQueryCuratorLlm {
  return new SdkInternalQueryCuratorLlm(
    logger,
    new HarnessInternalQuery(variant, sink) as never,
    makeWorkspaceStub(workspaceRoot),
    null,
    null,
  );
}
