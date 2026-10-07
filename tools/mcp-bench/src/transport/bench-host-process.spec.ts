import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';

import { BenchHostBootError, BenchIsolationError } from './bench-host-boot';
import {
  BenchHostArgumentError,
  FORCED_EXIT_AFTER_MS,
  describeFailure,
  readWorkspaceArg,
  shutdownRequested,
} from './bench-host-process';

jest.mock('@ptah-extension/cli-engine', () => ({
  withEngine: jest.fn(),
  CliDIContainer: { setup: jest.fn() },
}));
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: { LOGGER: 'LOGGER', CODE_EXECUTION_MCP: 'CODE_EXECUTION_MCP' },
  startCodeExecutionMcp: jest.fn(),
}));
jest.mock('@ptah-extension/platform-core', () => ({
  PLATFORM_TOKENS: { WORKSPACE_PROVIDER: 'WORKSPACE_PROVIDER' },
}));

afterEach(() => jest.restoreAllMocks());

describe('bench-host-process import', () => {
  it('starts nothing: no listener, no stdin read, no write, no exit', () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const on = jest.spyOn(process, 'on');
    const once = jest.spyOn(process, 'once');
    const stdout = jest.spyOn(process.stdout, 'write');
    const resume = jest.spyOn(process.stdin, 'resume');
    const sigterm = process.listenerCount('SIGTERM');

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./bench-host-process');
    });

    expect(exit).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(process.listenerCount('SIGTERM')).toBe(sigterm);
  });
});

describe('readWorkspaceArg', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-bench-process-spec-'));
    await writeFile(join(root, 'file.txt'), 'x');
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  const failure = (argv: string[]): unknown => {
    try {
      readWorkspaceArg(argv);
    } catch (error: unknown) {
      return error;
    }
    throw new Error('expected readWorkspaceArg to throw');
  };

  it('returns the resolved absolute directory', () => {
    expect(readWorkspaceArg(['node', 'host', '--workspace', root])).toBe(
      resolve(root),
    );
  });

  it.each([
    [['node', 'host']],
    [['node', 'host', '--workspace']],
    [['node', 'host', '--workspace', 'relative/dir']],
  ])(
    'refuses a missing or relative workspace (%j) with the usage line',
    (argv) => {
      const error = failure(argv);
      expect(error).toBeInstanceOf(BenchHostArgumentError);
      expect((error as Error).message).toBe(
        'usage: bench-host --workspace <absolute directory>',
      );
    },
  );

  it('refuses a file', () => {
    const file = join(root, 'file.txt');
    expect((failure(['--workspace', file]) as Error).message).toBe(
      `not a directory: ${file}`,
    );
  });

  it('refuses an unreadable path, quoting the fs error', () => {
    const error = failure(['--workspace', join(root, 'missing')]);
    expect(error).toBeInstanceOf(BenchHostArgumentError);
    expect((error as Error).message).toMatch(
      // Under jest the fs error comes from another realm, so it is
      // stringified ("Error: ENOENT ..."); in the host it is its message.
      /^workspace unreadable: (Error: )?ENOENT/,
    );
  });
});

describe('shutdownRequested', () => {
  const sources = (): { stdin: PassThrough; signals: EventEmitter } => ({
    stdin: new PassThrough(),
    signals: new EventEmitter(),
  });

  it('resolves stdin-eof on stdin end, and reads stdin', async () => {
    const { stdin, signals } = sources();
    const resume = jest.spyOn(stdin, 'resume');
    const reason = shutdownRequested(stdin, signals);
    expect(resume).toHaveBeenCalled();
    stdin.end();
    await expect(reason).resolves.toBe('stdin-eof');
  });

  it('resolves stdin-eof on stdin close', async () => {
    const { stdin, signals } = sources();
    const reason = shutdownRequested(stdin, signals);
    stdin.emit('close');
    await expect(reason).resolves.toBe('stdin-eof');
  });

  it.each(['SIGTERM', 'SIGINT'])(
    'resolves %s on that signal',
    async (signal) => {
      const { stdin, signals } = sources();
      const reason = shutdownRequested(stdin, signals);
      signals.emit(signal);
      await expect(reason).resolves.toBe(signal);
      expect(signals.listenerCount(signal)).toBe(0);
    },
  );
});

describe('describeFailure', () => {
  it('keeps the message of typed refusals', () => {
    expect(describeFailure(new BenchIsolationError('not isolated'))).toBe(
      'not isolated',
    );
    expect(describeFailure(new BenchHostArgumentError('usage: x'))).toBe(
      'usage: x',
    );
  });

  it('keeps a boot error message and writes its cause stack to stderr', () => {
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const cause = new Error('engine broke');
    const error = new BenchHostBootError('engine boot failed', 'engine-boot', {
      cause,
    });

    expect(describeFailure(error)).toBe('engine boot failed');
    expect(stderr).toHaveBeenCalledWith(`[bench-host] ${cause.stack}\n`);
  });

  it('gives anything else its stack, or its string form', () => {
    const error = new Error('plain');
    expect(describeFailure(error)).toBe(error.stack);
    expect(describeFailure('text')).toBe('text');
  });

  it('keeps the forced-exit window', () => {
    expect(FORCED_EXIT_AFTER_MS).toBe(20_000);
  });
});
