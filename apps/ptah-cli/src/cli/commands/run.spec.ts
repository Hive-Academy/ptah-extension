/**
 * Unit tests for `ptah run`.
 *
 * `ptah run` is a thin deprecation alias for `ptah session start --task`. The
 * body prints a deprecation notice on stderr and delegates to
 * `executeSessionStart` from `./session`. These tests mock that import.
 */

jest.mock('./session.js', () => ({
  executeSessionStart: jest.fn(),
}));

import { executeSessionStart } from './session.js';
import { execute } from './run.js';
import type { GlobalOptions } from '../router.js';

const mockedExecuteSessionStart =
  executeSessionStart as unknown as jest.MockedFunction<
    typeof executeSessionStart
  >;

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

describe('ptah run', () => {
  let stderrSpy: jest.SpyInstance;
  let stderrBuffer: string;

  beforeEach(() => {
    mockedExecuteSessionStart.mockReset();
    stderrBuffer = '';
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ): boolean => {
      stderrBuffer +=
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('prints a deprecation notice on stderr and delegates to executeSessionStart', async () => {
    mockedExecuteSessionStart.mockResolvedValue(0);

    const exit = await execute({ task: 'hello' }, baseGlobals);

    expect(exit).toBe(0);
    expect(stderrBuffer).toMatch(
      /Use 'ptah session start --task <task>' instead/,
    );
    expect(stderrBuffer).toMatch(/will be removed in the next release/);
    expect(mockedExecuteSessionStart).toHaveBeenCalledTimes(1);
    const delegateOpts = mockedExecuteSessionStart.mock.calls[0]?.[0];
    expect(delegateOpts).toMatchObject({
      task: 'hello',
      once: true,
      cwd: baseGlobals.cwd,
    });
  });

  it('forwards --profile when provided', async () => {
    mockedExecuteSessionStart.mockResolvedValue(0);

    await execute({ task: 'work', profile: 'enhanced' }, baseGlobals);

    const delegateOpts = mockedExecuteSessionStart.mock.calls[0]?.[0];
    expect(delegateOpts).toMatchObject({
      task: 'work',
      profile: 'enhanced',
      once: true,
    });
  });

  it('propagates a non-zero exit code from executeSessionStart', async () => {
    mockedExecuteSessionStart.mockResolvedValue(1);

    const exit = await execute({ task: 'broken' }, baseGlobals);

    expect(exit).toBe(1);
  });

  it('passes globals through to executeSessionStart for downstream resolution', async () => {
    mockedExecuteSessionStart.mockResolvedValue(0);

    await execute({ task: 'inspect' }, baseGlobals);

    expect(mockedExecuteSessionStart).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'inspect' }),
      baseGlobals,
    );
  });
});
