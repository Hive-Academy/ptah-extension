import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { JsonlReaderService, SdkError } from '@ptah-extension/agent-sdk';
import {
  SubagentMetricsExtractor,
  extractTaskIdFromPrompt,
} from './subagent-metrics-extractor';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

/** Minimal shape of a raw JSONL transcript line the reader parses. */
interface Line {
  uuid: string;
  sessionId: string;
  timestamp?: string;
  type?: string;
  model?: string;
  message?: {
    role: string;
    content: string | Array<Record<string, unknown>>;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

function userLine(content: string, ts = '2026-07-15T10:00:00.000Z'): Line {
  return {
    uuid: 'u-user',
    sessionId: 's1',
    timestamp: ts,
    type: 'user',
    message: { role: 'user', content },
  };
}

function assistantLine(opts: {
  ts?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  toolUseCount?: number;
  contentIsString?: boolean;
}): Line {
  const blocks: Array<Record<string, unknown>> = [
    { type: 'text', text: 'working' },
  ];
  for (let i = 0; i < (opts.toolUseCount ?? 0); i++) {
    blocks.push({ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} });
  }
  return {
    uuid: `a-${Math.random().toString(36).slice(2)}`,
    sessionId: 's1',
    timestamp: opts.ts ?? '2026-07-15T10:05:00.000Z',
    type: 'assistant',
    message: {
      role: 'assistant',
      model: opts.model,
      content: opts.contentIsString ? 'working' : blocks,
      usage: opts.usage,
    },
  };
}

describe('extractTaskIdFromPrompt', () => {
  it('prefers the specs-path anchor over an incidental depends_on mention', () => {
    const text =
      'Task Folder: D:/projects/ptah/.ptah/specs/TASK_2026_158\n' +
      'depends_on: [TASK_2026_157]';
    expect(extractTaskIdFromPrompt(text)).toBe('TASK_2026_158');
  });

  it('matches a Windows backslash specs path', () => {
    const text = 'C:\\dev\\repo\\.ptah\\specs\\TASK_2026_042\\tasks.md';
    expect(extractTaskIdFromPrompt(text)).toBe('TASK_2026_042');
  });

  it('returns the single distinct bare id when no specs path is present', () => {
    expect(extractTaskIdFromPrompt('working on TASK_2026_042 now')).toBe(
      'TASK_2026_042',
    );
  });

  it('collapses the same bare id mentioned twice to that id', () => {
    expect(
      extractTaskIdFromPrompt('TASK_2026_042 then again TASK_2026_042'),
    ).toBe('TASK_2026_042');
  });

  it('returns null when multiple distinct bare ids are present', () => {
    expect(
      extractTaskIdFromPrompt('see TASK_2026_100 and TASK_2026_200'),
    ).toBeNull();
  });

  it('returns null when no task id appears', () => {
    expect(extractTaskIdFromPrompt('just a normal prompt')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractTaskIdFromPrompt('')).toBeNull();
  });
});

describe('SubagentMetricsExtractor', () => {
  let tmpDir: string;
  let extractor: SubagentMetricsExtractor;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-metrics-'));
    extractor = new SubagentMetricsExtractor(
      new JsonlReaderService(makeLogger()),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeTranscript(lines: Line[]): Promise<string> {
    const file = path.join(
      tmpDir,
      `${Math.random().toString(36).slice(2)}.jsonl`,
    );
    await fs.writeFile(
      file,
      lines.map((l) => JSON.stringify(l)).join('\n'),
      'utf8',
    );
    return file;
  }

  it('aggregates tokens, cost, duration, tool count and task id (full usage)', async () => {
    const file = await writeTranscript([
      userLine('Task Folder: /repo/.ptah/specs/TASK_2026_158'),
      assistantLine({
        model: 'gpt-4o',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
        },
        toolUseCount: 2,
        ts: '2026-07-15T10:05:00.000Z',
      }),
    ]);

    const { metrics, taskId } = await extractor.extract(file);

    expect(metrics.inputTokens).toBe(1000);
    expect(metrics.outputTokens).toBe(500);
    expect(metrics.cacheReadTokens).toBe(200);
    expect(metrics.cacheCreationTokens).toBe(100);
    // gpt-4o: 1000*2.5e-6 + 500*10e-6 = 0.0075 (cache priced at 0)
    expect(metrics.costUsd).toBeCloseTo(0.0075, 8);
    expect(metrics.durationMs).toBe(5 * 60 * 1000);
    expect(metrics.toolCount).toBe(2);
    expect(taskId).toBe('TASK_2026_158');
  });

  it('yields all-null metrics for a usage-less (Copilot-style) transcript', async () => {
    const file = await writeTranscript([
      userLine('no task context here'),
      // Copilot-style: assistant messages carry no usage block, but do have tools.
      assistantLine({ model: 'claude-sonnet-4.5', toolUseCount: 3 }),
    ]);

    const { metrics, taskId } = await extractor.extract(file);

    expect(metrics).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
      durationMs: null,
      toolCount: null,
    });
    expect(taskId).toBeNull();
  });

  it('sums cost across multiple priceable models', async () => {
    const file = await writeTranscript([
      userLine('Working on TASK_2026_158'),
      assistantLine({
        model: 'gpt-4o',
        usage: { input_tokens: 1000, output_tokens: 500 },
        ts: '2026-07-15T10:01:00.000Z',
      }),
      assistantLine({
        model: 'gpt-4o-mini',
        usage: { input_tokens: 2000, output_tokens: 1000 },
        ts: '2026-07-15T10:02:00.000Z',
      }),
    ]);

    const { metrics } = await extractor.extract(file);

    expect(metrics.inputTokens).toBe(3000);
    expect(metrics.outputTokens).toBe(1500);
    // gpt-4o 0.0075 + gpt-4o-mini (2000*0.15e-6 + 1000*0.6e-6 = 0.0009) = 0.0084
    expect(metrics.costUsd).toBeCloseTo(0.0084, 8);
  });

  it('token-bearing but non-priceable model yields tokens with null cost', async () => {
    const file = await writeTranscript([
      userLine('no task'),
      assistantLine({
        model: 'mystery-provider-9x',
        usage: { input_tokens: 800, output_tokens: 300 },
      }),
    ]);

    const { metrics } = await extractor.extract(file);

    expect(metrics.inputTokens).toBe(800);
    expect(metrics.outputTokens).toBe(300);
    expect(metrics.costUsd).toBeNull();
  });

  it('skips malformed JSONL lines and still computes from valid messages', async () => {
    const file = path.join(tmpDir, 'malformed.jsonl');
    const valid = [
      JSON.stringify(userLine('Task Folder: /repo/.ptah/specs/TASK_2026_158')),
      '{ this is not valid json',
      JSON.stringify(
        assistantLine({
          model: 'gpt-4o',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ),
    ].join('\n');
    await fs.writeFile(file, valid, 'utf8');

    const { metrics, taskId } = await extractor.extract(file);

    expect(metrics.inputTokens).toBe(100);
    expect(metrics.outputTokens).toBe(50);
    expect(taskId).toBe('TASK_2026_158');
  });

  it('propagates the reader SdkError for oversized transcripts (>50MB)', async () => {
    const reader = {
      readJsonlMessages: jest
        .fn()
        .mockRejectedValue(
          new SdkError('Session file too large (60MB). Max: 50MB'),
        ),
    } as unknown as JsonlReaderService;
    const throwing = new SubagentMetricsExtractor(reader);

    await expect(throwing.extract('/tmp/huge.jsonl')).rejects.toBeInstanceOf(
      SdkError,
    );
  });

  it('propagates missing-file errors (unrecoverable I/O)', async () => {
    await expect(
      extractor.extract(path.join(tmpDir, 'does-not-exist.jsonl')),
    ).rejects.toBeDefined();
  });
});
