/**
 * Unit tests for `ptah execute-spec`.
 *
 * Coverage:
 *   - missing --id → exit 1, ptah_code:'unknown', task.error emitted
 *   - spec folder missing (TASK_DOES_NOT_EXIST) → exit 1, task.error
 *   - one of two files missing → exit 1, task.error
 *   - happy path: prompt template built with both files' contents,
 *     executeSessionStart called with the prompt, exit 0
 */

import * as path from 'node:path';

import { execute, buildTeamLeaderPrompt } from './execute-spec.js';
import type { ExecuteSpecHooks } from './execute-spec.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
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

type DelegateMock = jest.MockedFunction<
  NonNullable<ExecuteSpecHooks['executeSessionStart']>
>;

function makeDelegate(returnCode: number): DelegateMock {
  return jest.fn(async () => returnCode) as unknown as DelegateMock;
}

interface FsScript {
  readFile: jest.Mock;
}

function makeFsScript(map: Record<string, string | Error>): FsScript {
  return {
    readFile: jest.fn(async (p: string) => {
      const entry = map[p];
      if (entry === undefined) {
        const err = new Error(`ENOENT: no entry for ${p}`);
        (err as unknown as { code: string }).code = 'ENOENT';
        throw err;
      }
      if (entry instanceof Error) throw entry;
      return entry;
    }),
  };
}

describe('ptah execute-spec', () => {
  it('exits 1 with ptah_code:unknown when --id is missing', async () => {
    const f = makeFormatter();
    const hooks: ExecuteSpecHooks = {
      formatter: f.formatter,
      readFile: jest.fn(async () => {
        throw new Error('should not be called');
      }),
      executeSessionStart: jest.fn(async () => 0),
    };

    const exit = await execute({ id: undefined }, baseGlobals, hooks);

    expect(exit).toBe(ExitCode.GeneralError);
    expect(f.notifications).toHaveLength(1);
    expect(f.notifications[0]).toMatchObject({
      method: 'task.error',
      params: {
        ptah_code: 'unknown',
        message: 'execute-spec requires --id',
        command: 'execute-spec',
      },
    });
    expect(hooks.executeSessionStart).not.toHaveBeenCalled();
  });

  it('exits 1 when --id is an empty string', async () => {
    const f = makeFormatter();
    const hooks: ExecuteSpecHooks = {
      formatter: f.formatter,
      readFile: jest.fn(async () => '   '),
      executeSessionStart: jest.fn(async () => 0),
    };

    const exit = await execute({ id: '   ' }, baseGlobals, hooks);

    expect(exit).toBe(ExitCode.GeneralError);
    expect(f.notifications[0]?.method).toBe('task.error');
    expect(hooks.executeSessionStart).not.toHaveBeenCalled();
  });

  it('emits task.error and exits 1 when the spec folder is missing (TASK_DOES_NOT_EXIST)', async () => {
    const f = makeFormatter();
    // Both required files missing — readFile rejects on every path.
    const fsScript = makeFsScript({});
    const hooks: ExecuteSpecHooks = {
      formatter: f.formatter,
      readFile: fsScript.readFile,
      executeSessionStart: jest.fn(async () => 0),
    };

    const exit = await execute(
      { id: 'TASK_DOES_NOT_EXIST' },
      baseGlobals,
      hooks,
    );

    expect(exit).toBe(ExitCode.GeneralError);
    expect(f.notifications).toHaveLength(1);
    expect(f.notifications[0]).toMatchObject({
      method: 'task.error',
      params: {
        ptah_code: 'unknown',
        message: 'spec folder not found',
        spec_id: 'TASK_DOES_NOT_EXIST',
        command: 'execute-spec',
      },
    });
    expect(hooks.executeSessionStart).not.toHaveBeenCalled();
  });

  it('exits 1 when only implementation-plan.md is missing', async () => {
    const f = makeFormatter();
    const specDir = path.join(
      baseGlobals.cwd,
      '.ptah',
      'specs',
      'TASK_2026_999',
    );
    const fsScript = makeFsScript({
      [path.join(specDir, 'task-description.md')]: '# desc',
      // implementation-plan.md is intentionally omitted
    });
    const hooks: ExecuteSpecHooks = {
      formatter: f.formatter,
      readFile: fsScript.readFile,
      executeSessionStart: jest.fn(async () => 0),
    };

    const exit = await execute({ id: 'TASK_2026_999' }, baseGlobals, hooks);

    expect(exit).toBe(ExitCode.GeneralError);
    expect(f.notifications[0]?.method).toBe('task.error');
    expect((f.notifications[0]?.params as { spec_id: string }).spec_id).toBe(
      'TASK_2026_999',
    );
    expect(hooks.executeSessionStart).not.toHaveBeenCalled();
  });

  it('exits 1 when only task-description.md is missing', async () => {
    const f = makeFormatter();
    const specDir = path.join(
      baseGlobals.cwd,
      '.ptah',
      'specs',
      'TASK_2026_888',
    );
    const fsScript = makeFsScript({
      [path.join(specDir, 'implementation-plan.md')]: '# plan',
    });
    const hooks: ExecuteSpecHooks = {
      formatter: f.formatter,
      readFile: fsScript.readFile,
      executeSessionStart: jest.fn(async () => 0),
    };

    const exit = await execute({ id: 'TASK_2026_888' }, baseGlobals, hooks);

    expect(exit).toBe(ExitCode.GeneralError);
    expect(f.notifications[0]?.method).toBe('task.error');
    expect(hooks.executeSessionStart).not.toHaveBeenCalled();
  });

  it('builds the team-leader prompt and delegates to executeSessionStart on the happy path', async () => {
    const f = makeFormatter();
    const specId = 'TASK_2026_104';
    const specDir = path.join(baseGlobals.cwd, '.ptah', 'specs', specId);
    const taskDescContents = '# Goal\n\nShip the foo widget.';
    const implPlanContents = '## Batch 1\n\nDo the thing.';
    const fsScript = makeFsScript({
      [path.join(specDir, 'task-description.md')]: taskDescContents,
      [path.join(specDir, 'implementation-plan.md')]: implPlanContents,
    });
    const delegate = makeDelegate(0);
    const hooks: ExecuteSpecHooks = {
      formatter: f.formatter,
      readFile: fsScript.readFile,
      executeSessionStart: delegate,
    };

    const exit = await execute({ id: specId }, baseGlobals, hooks);

    expect(exit).toBe(0);
    // No task.error emitted — the body delegated successfully.
    expect(
      f.notifications.find((n) => n.method === 'task.error'),
    ).toBeUndefined();
    expect(delegate).toHaveBeenCalledTimes(1);
    const delegateOpts = delegate.mock.calls[0]?.[0];
    expect(delegateOpts).toMatchObject({
      once: true,
      cwd: baseGlobals.cwd,
    });
    // The prompt must interpolate both files' contents and the spec id.
    const prompt = (delegateOpts as { task: string }).task;
    expect(prompt).toContain(specId);
    expect(prompt).toContain(taskDescContents);
    expect(prompt).toContain(implPlanContents);
    expect(prompt).toContain('## Task description');
    expect(prompt).toContain('## Implementation plan');
  });

  it('propagates a non-zero exit code from executeSessionStart', async () => {
    const f = makeFormatter();
    const specId = 'TASK_2026_104';
    const specDir = path.join(baseGlobals.cwd, '.ptah', 'specs', specId);
    const fsScript = makeFsScript({
      [path.join(specDir, 'task-description.md')]: '# d',
      [path.join(specDir, 'implementation-plan.md')]: '# p',
    });
    const delegate = makeDelegate(1);
    const hooks: ExecuteSpecHooks = {
      formatter: f.formatter,
      readFile: fsScript.readFile,
      executeSessionStart: delegate,
    };

    const exit = await execute({ id: specId }, baseGlobals, hooks);

    expect(exit).toBe(1);
  });
});

describe('buildTeamLeaderPrompt()', () => {
  it('emits a single string with both file contents and the spec id', () => {
    const prompt = buildTeamLeaderPrompt(
      'TASK_TEST_1',
      'task description body',
      'implementation plan body',
    );
    expect(typeof prompt).toBe('string');
    expect(prompt).toMatch(/Task ID: TASK_TEST_1/);
    expect(prompt).toContain('task description body');
    expect(prompt).toContain('implementation plan body');
    // Sanity: the canonical instruction language survives.
    expect(prompt).toMatch(/Coordinate sub-agents/);
    expect(prompt).toMatch(/typecheck, test, lint, build/);
  });
});
