import { resolve } from 'node:path';
import type { AgentWaitResult } from '@ptah-extension/cli-agent-runtime';
import type {
  AgentId,
  AgentOutput,
  AgentProcessInfo,
} from '@ptah-extension/shared';
import {
  AGENT_WAIT_TOOL_NAME,
  buildAgentWaitTool,
  runAgentWait,
  type AgentWaitDependencies,
  type FileStat,
} from './agent-wait.tool';
import {
  AgentWaitArgsSchema,
  MAX_WAIT_AGENT_IDS,
  WAIT_SUMMARY_MAX_CHARS,
} from './wait-tools-args.schema';

const ROOT = resolve('/work/repo');
const STARTED = '2026-10-04T10:00:00.000Z';
const STARTED_MS = Date.parse(STARTED);

function info(
  agentId: string,
  overrides: Partial<AgentProcessInfo> = {},
): AgentProcessInfo {
  return {
    agentId: agentId as AgentId,
    cli: 'codex',
    task: 'do it',
    workingDirectory: ROOT,
    status: 'completed',
    exitCode: 0,
    startedAt: STARTED,
    completedAt: '2026-10-04T10:01:30.000Z',
    ...overrides,
  };
}

function output(stdout: string, stderr = ''): AgentOutput {
  return {
    agentId: 'x' as AgentId,
    stdout,
    stderr,
    lineCount: 0,
    totalLines: 0,
    omittedLines: 0,
    stdoutTotalLines: 0,
    stderrTotalLines: 0,
    truncated: false,
  };
}

function deps(
  result: AgentWaitResult,
  overrides: Partial<AgentWaitDependencies> = {},
): AgentWaitDependencies & {
  waitForAgents: jest.Mock;
  readOutput: jest.Mock;
} {
  return {
    waitForAgents: jest.fn(async () => result),
    readOutput: jest.fn(async () => output('line one\nline two\n')),
    statFile: jest.fn(async () => undefined),
    now: () => STARTED_MS + 60_000,
    ...overrides,
  } as AgentWaitDependencies & {
    waitForAgents: jest.Mock;
    readOutput: jest.Mock;
  };
}

describe('buildAgentWaitTool', () => {
  it('advertises the name, the bounds and the required ids', () => {
    const tool = buildAgentWaitTool();
    expect(tool.name).toBe(AGENT_WAIT_TOOL_NAME);
    expect(tool.inputSchema.required).toEqual(['agentIds']);
    expect(tool.inputSchema.properties['timeoutSec']).toMatchObject({
      maximum: 900,
    });
    expect(tool.inputSchema.properties['agentIds']).toMatchObject({
      maxItems: MAX_WAIT_AGENT_IDS,
    });
    expect(tool.description).toContain('PARTIAL');
  });
});

describe('runAgentWait', () => {
  it('passes ids, mode and the timeout in ms to the manager', async () => {
    const d = deps({ mode: 'any', timedOut: false, waitedMs: 5, entries: [] });
    await runAgentWait(
      AgentWaitArgsSchema.parse({
        agentIds: ['a', 'b'],
        mode: 'any',
        timeoutSec: 30,
      }),
      d,
    );
    expect(d.waitForAgents).toHaveBeenCalledWith(
      ['a', 'b'],
      'any',
      30_000,
      undefined,
    );
  });

  it('forwards the signal and reports a fired one as a cancelled partial result (E.3)', async () => {
    const controller = new AbortController();
    controller.abort();
    const d = deps(
      {
        mode: 'all',
        timedOut: false,
        cancelled: true,
        waitedMs: 2_000,
        entries: [
          {
            agentId: 'lane-1',
            state: 'running',
            info: info('lane-1', {
              status: 'running',
              exitCode: undefined,
              completedAt: undefined,
            }),
          },
        ],
      },
      { signal: controller.signal },
    );

    const text = await runAgentWait(
      AgentWaitArgsSchema.parse({ agentIds: ['lane-1'], timeoutSec: 30 }),
      d,
    );

    expect(d.waitForAgents).toHaveBeenCalledWith(
      ['lane-1'],
      'all',
      30_000,
      controller.signal,
    );
    expect(text).toContain('WAIT CANCELLED after 2s waiting for all');
    expect(text).toContain('0 of 1 known lane(s) ended, 1 still running');
    expect(text).not.toContain('TIMED OUT');
    expect(d.readOutput).not.toHaveBeenCalled();
  });

  it('reports status, exit code, duration, stop reason, deliverables and last lines', async () => {
    const statFile = jest.fn(
      async (path: string): Promise<FileStat | undefined> =>
        path.endsWith('report.md')
          ? { size: 1234, mtimeMs: STARTED_MS + 1000 }
          : path.endsWith('old.md')
            ? { size: 10, mtimeMs: STARTED_MS - 1000 }
            : path.endsWith('empty.md')
              ? { size: 0, mtimeMs: STARTED_MS + 1000 }
              : undefined,
    );
    const d = deps(
      {
        mode: 'all',
        timedOut: false,
        waitedMs: 90_000,
        entries: [
          {
            agentId: 'lane-1',
            state: 'exited',
            info: info('lane-1', {
              status: 'failed',
              exitCode: 2,
              taskFolder: 'specs/T1',
              deliverables: ['report.md', 'old.md', 'empty.md', 'gone.md'],
            }),
          },
        ],
      },
      { statFile },
    );

    const text = await runAgentWait(
      AgentWaitArgsSchema.parse({ agentIds: ['lane-1'] }),
      d,
    );

    expect(text).toContain('Wait (all) done after 1m 30s: 1 of 1');
    expect(text).toContain(
      '[lane-1] codex: failed, exit 2, 1m 30s, failed with exit code 2',
    );
    expect(text).toContain(
      `${resolve(ROOT, 'specs/T1', 'report.md')}: 1234 bytes`,
    );
    expect(text).toContain('old.md: 10 bytes (NOT written by this run)');
    expect(text).toContain('empty.md: EMPTY');
    expect(text).toContain('gone.md: MISSING');
    expect(text).toContain('Last lines:\n    line one\n    line two');
    expect(text).toContain('ptah_agent_read');
  });

  it('names the lane budget guard stop reason instead of "on request"', async () => {
    const lane = (stopReason?: 'tool-call-budget' | 'repeat-call') => ({
      agentId: 'lane-1',
      state: 'exited' as const,
      info: info('lane-1', { status: 'stopped', exitCode: 1, stopReason }),
    });
    const run = (stopReason?: 'tool-call-budget' | 'repeat-call') =>
      runAgentWait(
        AgentWaitArgsSchema.parse({ agentIds: ['lane-1'], timeoutSec: 30 }),
        deps({
          mode: 'all',
          timedOut: false,
          waitedMs: 1,
          entries: [lane(stopReason)],
        }),
      );

    expect(await run('tool-call-budget')).toContain(
      'stopped by the lane budget guard: tool-call budget reached',
    );
    expect(await run('repeat-call')).toContain(
      'stopped by the lane budget guard: repeated identical call',
    );
    expect(await run()).toContain('stopped on request');
  });

  it('reports a timeout as a partial result with running lanes and per-id unknowns', async () => {
    const d = deps({
      mode: 'all',
      timedOut: true,
      waitedMs: 30_000,
      entries: [
        {
          agentId: 'lane-1',
          state: 'running',
          info: info('lane-1', {
            status: 'running',
            exitCode: undefined,
            completedAt: undefined,
          }),
        },
        { agentId: 'ghost', state: 'not_found' },
        { agentId: 'theirs', state: 'other_workspace' },
      ],
    });

    const text = await runAgentWait(
      AgentWaitArgsSchema.parse({
        agentIds: ['lane-1', 'ghost', 'theirs'],
        timeoutSec: 30,
      }),
      d,
    );

    expect(text).toContain('TIMED OUT after 30s waiting for all');
    expect(text).toContain('0 of 1 known lane(s) ended, 1 still running');
    expect(text).toContain('call ptah_agent_wait again');
    expect(text).toContain('[lane-1] codex: running, 1m 0s, still running');
    expect(text).toContain('[ghost] not found');
    expect(text).toContain('[theirs] belongs to another workspace');
    // A running lane's output is not read: it is still being written.
    expect(d.readOutput).not.toHaveBeenCalled();
  });

  it('falls back to stderr when stdout is empty, and survives a failed read', async () => {
    const d = deps(
      {
        mode: 'any',
        timedOut: false,
        waitedMs: 1,
        entries: [
          { agentId: 'a', state: 'exited', info: info('a') },
          { agentId: 'b', state: 'exited', info: info('b') },
        ],
      },
      {
        readOutput: jest.fn(async (id: string) => {
          if (id === 'b') throw new Error('Agent not found: b');
          return output('', 'boom on stderr\n');
        }),
      },
    );
    const text = await runAgentWait(
      AgentWaitArgsSchema.parse({ agentIds: ['a', 'b'] }),
      d,
    );
    expect(text).toContain('boom on stderr');
    expect(text).toContain('[b] codex: completed, exit 0');
  });

  it(`keeps the whole reply within ${WAIT_SUMMARY_MAX_CHARS} chars at the worst case`, async () => {
    const ids = Array.from(
      { length: MAX_WAIT_AGENT_IDS },
      (_, i) => `lane-${i}-${'x'.repeat(110)}`,
    );
    const longLine = 'L'.repeat(5_000);
    const d = deps(
      {
        mode: 'all',
        timedOut: true,
        waitedMs: 900_000,
        entries: ids.map((agentId) => ({
          agentId,
          state: 'exited' as const,
          info: info(agentId, {
            status: 'timeout',
            displayName: 'D'.repeat(500),
            deliverables: Array.from(
              { length: 20 },
              (_, i) => `${'deep/'.repeat(60)}file-${i}.md`,
            ),
          }),
        })),
      },
      {
        readOutput: jest.fn(async () =>
          output(Array.from({ length: 50 }, () => longLine).join('\n')),
        ),
      },
    );

    const text = await runAgentWait(
      AgentWaitArgsSchema.parse({ agentIds: ids, timeoutSec: 900 }),
      d,
    );
    expect(text.length).toBeLessThanOrEqual(WAIT_SUMMARY_MAX_CHARS);
    expect(text).toContain('TIMED OUT');
    for (const id of ids) expect(text).toContain(`[${id}]`);
  });

  it('keeps the newest output lines when a single lane is over budget', async () => {
    const lines = Array.from(
      { length: 12 },
      (_, i) => `out-${i} ${'y'.repeat(150)}`,
    );
    const d = deps(
      {
        mode: 'all',
        timedOut: false,
        waitedMs: 1,
        entries: [{ agentId: 'a', state: 'exited', info: info('a') }],
      },
      { readOutput: jest.fn(async () => output(lines.join('\n'))) },
    );
    const text = await runAgentWait(
      AgentWaitArgsSchema.parse({ agentIds: ['a'] }),
      d,
    );
    expect(text.length).toBeLessThanOrEqual(WAIT_SUMMARY_MAX_CHARS);
    expect(text).toContain('out-11');
  });
});
