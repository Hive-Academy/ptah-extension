/**
 * Unit tests for `ptah analyze` command — TASK_2026_104 Sub-batch B5d.
 *
 * Coverage:
 *   - happy path: streams analyze.start / framework_detected / dependency_detected
 *     / recommendation / complete in order
 *   - --save persists manifest.json under analysesDir/<slug>/
 *   - --out <path> overrides analysesDir
 *   - RPC failure bubbles as task.error + exit 5
 *   - persistence failure does NOT fail the command (warning to stderr)
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';

import { execute } from './analyze.js';
import type { AnalyzeExecuteHooks, AnalyzeOptions } from './analyze.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: process.cwd(),
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface AnalysisLite {
  isMultiPhase: true;
  manifest: {
    slug: string;
    analyzedAt: string;
    model: string;
    totalDurationMs: number;
    phases: Record<
      string,
      { status: string; file: string; durationMs: number; error?: string }
    >;
  };
  phaseContents: Record<string, string>;
  analysisDir: string;
}

function defaultAnalysis(): AnalysisLite {
  return {
    isMultiPhase: true,
    manifest: {
      slug: 'project_alpha',
      analyzedAt: '2026-04-26T12:00:00.000Z',
      model: 'sonnet-4',
      totalDurationMs: 1234,
      phases: {
        'phase-1-frameworks': {
          status: 'completed',
          file: 'frameworks.md',
          durationMs: 500,
        },
        'phase-2-dependencies': {
          status: 'completed',
          file: 'deps.md',
          durationMs: 600,
        },
        'phase-3-skipped': {
          status: 'failed',
          file: 'skipped.md',
          durationMs: 0,
          error: 'oops',
        },
      },
    },
    phaseContents: {
      'phase-1-frameworks': '# frameworks',
      'phase-2-dependencies': '# deps',
      'phase-3-skipped': '',
    },
    analysisDir: 'C:/users/abdal/.ptah/analyses/project_alpha',
  };
}

interface MockEngine {
  withEngine: AnalyzeExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
}

function makeEngine(): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: defaultAnalysis() };
    }),
  } as unknown as CliMessageTransport;

  const container = { resolve: jest.fn() };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    });
  }) as unknown as AnalyzeExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted };
}

describe('ptah analyze (happy path)', () => {
  it('streams start → phases → recommendation → complete in order', async () => {
    const formatterTrace = makeFormatter();
    const stderrTrace = makeStderr();
    const engine = makeEngine();

    const exit = await execute(
      { model: 'sonnet-4' } satisfies AnalyzeOptions,
      baseGlobals,
      {
        formatter: formatterTrace.formatter,
        stderr: stderrTrace.stderr,
        withEngine: engine.withEngine,
      },
    );

    expect(exit).toBe(ExitCode.Success);
    const methods = formatterTrace.notifications.map((n) => n.method);
    expect(methods[0]).toBe('analyze.start');
    expect(methods).toContain('analyze.framework_detected');
    expect(methods).toContain('analyze.dependency_detected');
    expect(methods[methods.length - 2]).toBe('analyze.recommendation');
    expect(methods[methods.length - 1]).toBe('analyze.complete');

    expect(engine.rpcCalls[0]).toEqual({
      method: 'wizard:deep-analyze',
      params: { model: 'sonnet-4' },
    });
  });

  it('does NOT emit phase notifications for failed phases', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    const exit = await execute({} satisfies AnalyzeOptions, baseGlobals, {
      formatter: formatterTrace.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
    });
    expect(exit).toBe(ExitCode.Success);
    const phasePayloads = formatterTrace.notifications
      .filter(
        (n) =>
          n.method === 'analyze.framework_detected' ||
          n.method === 'analyze.dependency_detected',
      )
      .map((n) => (n.params as { phase: string }).phase);
    expect(phasePayloads).not.toContain('phase-3-skipped');
  });
});

describe('ptah analyze persistence', () => {
  it('--save writes to analysesDir/<slug>/manifest.json', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    const analysesDir = pathJoin(
      tmpdir(),
      `b5d-analyze-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      const exit = await execute(
        { save: true } satisfies AnalyzeOptions,
        baseGlobals,
        {
          formatter: formatterTrace.formatter,
          stderr: makeStderr().stderr,
          withEngine: engine.withEngine,
          analysesDir,
        },
      );
      expect(exit).toBe(ExitCode.Success);
      const target = pathJoin(analysesDir, 'project_alpha', 'manifest.json');
      const written = await fs.readFile(target, 'utf8');
      const parsed = JSON.parse(written);
      expect(parsed.manifest.slug).toBe('project_alpha');
      expect(parsed.phaseContents['phase-1-frameworks']).toBe('# frameworks');

      const completeNotification = formatterTrace.notifications.find(
        (n) => n.method === 'analyze.complete',
      );
      expect(completeNotification?.params).toMatchObject({
        savedTo: target,
      });
    } finally {
      await fs
        .rm(analysesDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  });

  it('--out <path> writes to the explicit path (implies --save)', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    const target = pathJoin(
      tmpdir(),
      `b5d-analyze-out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );

    try {
      const exit = await execute(
        { out: target } satisfies AnalyzeOptions,
        baseGlobals,
        {
          formatter: formatterTrace.formatter,
          stderr: makeStderr().stderr,
          withEngine: engine.withEngine,
        },
      );
      expect(exit).toBe(ExitCode.Success);
      const written = await fs.readFile(target, 'utf8');
      const parsed = JSON.parse(written);
      expect(parsed.manifest.slug).toBe('project_alpha');
    } finally {
      await fs.unlink(target).catch(() => undefined);
    }
  });

  it('skips persistence when --save and --out are both omitted', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    const exit = await execute({} satisfies AnalyzeOptions, baseGlobals, {
      formatter: formatterTrace.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
    });
    expect(exit).toBe(ExitCode.Success);
    const completeNotification = formatterTrace.notifications.find(
      (n) => n.method === 'analyze.complete',
    );
    expect(completeNotification?.params).toMatchObject({ savedTo: undefined });
  });
});

describe('ptah analyze RPC failure', () => {
  it('bubbles RPC failure as task.error + exit 5', async () => {
    const formatterTrace = makeFormatter();
    const engine = makeEngine();
    engine.scripted.set('wizard:deep-analyze', {
      success: false,
      error: 'premium licence required',
      errorCode: 'license_required',
    });

    const exit = await execute({} satisfies AnalyzeOptions, baseGlobals, {
      formatter: formatterTrace.formatter,
      stderr: makeStderr().stderr,
      withEngine: engine.withEngine,
    });

    expect(exit).toBe(ExitCode.InternalFailure);
    const last =
      formatterTrace.notifications[formatterTrace.notifications.length - 1];
    expect(last?.method).toBe('task.error');
  });
});
