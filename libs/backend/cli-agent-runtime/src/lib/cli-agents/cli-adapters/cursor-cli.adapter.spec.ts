/**
 * CursorCliAdapter Unit Tests
 *
 * The adapter runs in-process via @cursor/sdk (Agent.create → send →
 * run.stream()). Tests mock the SDK module and drive a fake run stream.
 * Covers: detect()/ensureTokensFresh() gated on API key, runSdk() streaming
 * of SDKMessage events, tool-call dedup, AbortSignal → run.cancel(), resume
 * via Agent.resume, and the missing-key error path.
 */

// ---- Mocks declared before importing the adapter ----

interface FakeRunControls {
  push: (message: unknown) => void;
  end: () => void;
  cancel: jest.Mock;
  run: {
    id: string;
    agentId: string;
    stream: () => AsyncGenerator<unknown, void>;
    cancel: jest.Mock;
  };
}

/**
 * Build a fake Run whose stream() yields messages pushed via push() and
 * completes after end() is called. Backed by a simple async queue.
 */
function createFakeRun(agentId: string): FakeRunControls {
  const queue: unknown[] = [];
  let ended = false;
  let notify: (() => void) | null = null;

  const wake = (): void => {
    if (notify) {
      const n = notify;
      notify = null;
      n();
    }
  };

  async function* stream(): AsyncGenerator<unknown, void> {
    for (;;) {
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }

  const cancel = jest.fn(async () => {
    ended = true;
    wake();
  });

  return {
    push: (message: unknown) => {
      queue.push(message);
      wake();
    },
    end: () => {
      ended = true;
      wake();
    },
    cancel,
    run: { id: 'run-1', agentId, stream, cancel },
  };
}

const mockSend = jest.fn();
const mockClose = jest.fn();
const mockCreate = jest.fn();
const mockResume = jest.fn();
const mockModelsList = jest.fn();

jest.mock('@cursor/sdk', () => ({
  Agent: {
    create: (...args: unknown[]) => mockCreate(...args),
    resume: (...args: unknown[]) => mockResume(...args),
  },
  Cursor: {
    models: { list: (...args: unknown[]) => mockModelsList(...args) },
  },
}));

import { CursorCliAdapter } from './cursor-cli.adapter';
import type { SdkHandle } from './cli-adapter.interface';

const ORIGINAL_ENV = process.env;

describe('CursorCliAdapter', () => {
  let adapter: CursorCliAdapter;
  let currentRun: FakeRunControls | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, CURSOR_API_KEY: 'test-key' };
    currentRun = null;

    mockCreate.mockImplementation(async () => {
      currentRun = createFakeRun('agent-abc');
      return {
        agentId: 'agent-abc',
        send: (...args: unknown[]) => {
          mockSend(...args);
          return Promise.resolve(currentRun!.run);
        },
        close: mockClose,
      };
    });

    adapter = new CursorCliAdapter();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('detect() / ensureTokensFresh()', () => {
    it('reports installed when CURSOR_API_KEY is set', async () => {
      const result = await adapter.detect();
      expect(result.cli).toBe('cursor');
      expect(result.installed).toBe(true);
      expect(result.version).toBe('sdk');
      expect(result.supportsSteer).toBe(false);
    });

    it('reports NOT installed when no API key is resolvable', async () => {
      delete process.env['CURSOR_API_KEY'];
      delete process.env['HOME'];
      delete process.env['USERPROFILE'];

      const result = await adapter.detect();
      expect(result.installed).toBe(false);
    });

    it('ensureTokensFresh() reflects API key presence', async () => {
      expect(await adapter.ensureTokensFresh()).toBe(true);
      delete process.env['CURSOR_API_KEY'];
      delete process.env['HOME'];
      delete process.env['USERPROFILE'];
      expect(await adapter.ensureTokensFresh()).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('maps Cursor.models.list() results', async () => {
      mockModelsList.mockResolvedValue([
        { id: 'composer-2.5', displayName: 'Composer 2.5' },
        { id: 'composer-2' },
      ]);

      const models = await adapter.listModels();
      expect(models).toEqual([
        { id: 'composer-2.5', name: 'Composer 2.5' },
        { id: 'composer-2', name: 'composer-2' },
      ]);
    });

    it('falls back to the curated list when the API throws', async () => {
      mockModelsList.mockRejectedValue(new Error('network'));
      const models = await adapter.listModels();
      expect(models.some((m) => m.id === 'composer-2.5')).toBe(true);
    });
  });

  describe('runSdk() — streaming', () => {
    const defaultOptions = {
      task: 'Refactor module',
      workingDirectory: '/proj',
    };

    it('creates a local agent with cwd + default model and streams text', async () => {
      const handle: SdkHandle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      // Allow the async send() to wire up the run before pushing events.
      await Promise.resolve();
      await Promise.resolve();

      currentRun?.push({
        type: 'system',
        model: { id: 'composer-2.5' },
      });
      currentRun?.push({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
        },
      });
      currentRun?.end();

      const code = await handle.done;
      expect(code).toBe(0);

      const createArg = mockCreate.mock.calls[0][0] as {
        local?: { cwd?: string };
        model?: { id?: string };
        apiKey?: string;
      };
      expect(createArg.local?.cwd).toBe('/proj');
      expect(createArg.model?.id).toBe('composer-2.5');
      expect(createArg.apiKey).toBe('test-key');

      expect(output.join('')).toContain('[Model: composer-2.5]');
      expect(output.join('')).toContain('Done.');
      expect(handle.getSessionId?.()).toBe('agent-abc');
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('emits incremental text deltas for growing assistant messages', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data) => output.push(data));
      await Promise.resolve();
      await Promise.resolve();

      currentRun?.push({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        },
      });
      currentRun?.push({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      });
      currentRun?.end();
      await handle.done;

      // 'Hello' then delta ' world' — never the duplicated prefix.
      expect(output.join('')).toBe('Hello world');
    });

    it('emits a tool-call segment and dedups by call_id', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      const segments: Array<{ type: string; toolName?: string }> = [];
      handle.onOutput(() => {
        /* drain */
      });
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, toolName: seg.toolName }),
      );
      await Promise.resolve();
      await Promise.resolve();

      currentRun?.push({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tc-1',
              name: 'read_file',
              input: { path: 'a.ts' },
            },
          ],
        },
      });
      // Same id arrives again as a tool_call running event — must be ignored.
      currentRun?.push({
        type: 'tool_call',
        call_id: 'tc-1',
        name: 'read_file',
        status: 'running',
      });
      currentRun?.push({
        type: 'tool_call',
        call_id: 'tc-1',
        name: 'read_file',
        status: 'completed',
        result: 'file contents',
      });
      currentRun?.end();
      await handle.done;

      const toolCalls = segments.filter((s) => s.type === 'tool-call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe('read_file');
      expect(segments.some((s) => s.type === 'tool-result')).toBe(true);
    });

    it('resumes via Agent.resume when resumeSessionId is provided', async () => {
      mockResume.mockImplementation(async () => {
        currentRun = createFakeRun('agent-resumed');
        return {
          agentId: 'agent-resumed',
          send: () => Promise.resolve(currentRun!.run),
          close: mockClose,
        };
      });

      const handle = await adapter.runSdk({
        ...defaultOptions,
        resumeSessionId: 'agent-resumed',
      });
      handle.onOutput(() => {
        /* drain */
      });
      await Promise.resolve();
      await Promise.resolve();
      currentRun?.end();
      await handle.done;

      expect(mockResume).toHaveBeenCalledWith(
        'agent-resumed',
        expect.anything(),
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('passes the Ptah MCP server inline when mcpPort is set', async () => {
      const handle = await adapter.runSdk({ ...defaultOptions, mcpPort: 4321 });
      handle.onOutput(() => {
        /* drain */
      });
      await Promise.resolve();
      await Promise.resolve();
      currentRun?.end();
      await handle.done;

      const createArg = mockCreate.mock.calls[0][0] as {
        mcpServers?: Record<string, { url?: string }>;
      };
      expect(createArg.mcpServers?.['ptah']?.url).toBe('http://localhost:4321');
    });

    it('cancels the run on abort and resolves done with 1', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await Promise.resolve();
      await Promise.resolve();

      handle.abort.abort();
      const code = await handle.done;

      expect(currentRun?.cancel).toHaveBeenCalled();
      expect(code).toBe(1);
      expect(handle.abort.signal.aborted).toBe(true);
    });

    it('resolves done with 1 and emits an error segment on missing API key', async () => {
      delete process.env['CURSOR_API_KEY'];
      delete process.env['HOME'];
      delete process.env['USERPROFILE'];

      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      const segments: Array<{ type: string }> = [];
      handle.onOutput((data) => output.push(data));
      handle.onSegment?.((seg) => segments.push({ type: seg.type }));

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('Cursor API key not found');
      expect(segments.some((s) => s.type === 'error')).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('resolves done with 1 and emits an error segment when send() throws', async () => {
      mockCreate.mockImplementation(async () => {
        throw new Error('agent boom');
      });

      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('[Cursor SDK Error]');
      expect(output.join('')).toContain('agent boom');
    });
  });

  describe('continue() — multi-turn continuation', () => {
    const defaultOptions = {
      task: 'Refactor module',
      workingDirectory: '/proj',
    };

    it('does NOT close the agent after the first run completes', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await Promise.resolve();
      await Promise.resolve();

      currentRun?.end();
      await handle.done;

      expect(handle.supportsContinuation?.()).toBe(true);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('sends the next turn on the SAME agent without recreating it', async () => {
      const runs: FakeRunControls[] = [];
      mockCreate.mockImplementation(async () => {
        return {
          agentId: 'agent-abc',
          send: (...args: unknown[]) => {
            mockSend(...args);
            const next = createFakeRun('agent-abc');
            runs.push(next);
            currentRun = next;
            return Promise.resolve(next.run);
          },
          close: mockClose,
        };
      });

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await Promise.resolve();
      await Promise.resolve();
      runs[0]?.end();
      await handle.done;

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1);

      expect(handle.continue).toBeDefined();
      const outcomePromise = handle.continue?.('Follow-up');
      await Promise.resolve();
      await Promise.resolve();
      runs[1]?.end();
      const outcome = await outcomePromise;
      const code = await outcome?.done;

      expect(code).toBe(0);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[1][0]).toBe('Follow-up');
      expect(mockClose).not.toHaveBeenCalled();
    });

    it('streams the continued turn through the same onOutput callbacks', async () => {
      const runs: FakeRunControls[] = [];
      mockCreate.mockImplementation(async () => {
        return {
          agentId: 'agent-abc',
          send: (...args: unknown[]) => {
            mockSend(...args);
            const next = createFakeRun('agent-abc');
            runs.push(next);
            currentRun = next;
            return Promise.resolve(next.run);
          },
          close: mockClose,
        };
      });

      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data) => output.push(data));
      await Promise.resolve();
      await Promise.resolve();
      runs[0]?.end();
      await handle.done;

      const outcomePromise = handle.continue?.('again');
      await Promise.resolve();
      await Promise.resolve();
      runs[1]?.push({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Second turn' }],
        },
      });
      runs[1]?.end();
      const outcome = await outcomePromise;
      await outcome?.done;

      expect(output.join('')).toContain('Second turn');
    });

    it('closes the agent on abort and cancels the in-flight run', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await Promise.resolve();
      await Promise.resolve();

      handle.abort.abort();
      const code = await handle.done;

      expect(currentRun?.cancel).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(code).toBe(1);
    });
  });

  describe('supportsSteer() / parseOutput()', () => {
    it('reports supportsSteer() false', () => {
      expect(adapter.supportsSteer()).toBe(false);
    });

    it('strips ANSI escape codes', () => {
      expect(adapter.parseOutput('\x1b[32mok\x1b[0m')).toBe('ok');
    });
  });
});
