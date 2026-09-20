/**
 * Unit tests for `probeCliVersion` — the cross-platform `--version` probe
 * shared by all CLI adapters' detect() paths.
 *
 * The cross-platform guarantee under test: probe MUST route the child spawn
 * through `cross-spawn`, NOT raw `child_process.execFile`. Node 18.20+ and
 * Electron 30+ refuse to execFile .cmd/.bat/.ps1 wrappers (CVE-2024-27980),
 * which is the bug that left Copilot CLI undetected on Windows when it was
 * installed via an npm-global `.cmd` wrapper.
 *
 * We mock `cross-spawn` directly so the test is platform-agnostic and never
 * touches a real binary.
 */

import 'reflect-metadata';
import { EventEmitter } from 'events';

const mockCrossSpawn = jest.fn();

jest.mock('cross-spawn', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCrossSpawn(...args),
}));

const mockExecFile = jest.fn(
  (...args: unknown[]) =>
    (args.at(-1) as (error: null, stdout: string, stderr: string) => void)(
      null,
      '',
      '',
    ),
);
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockReadFile = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

const mockWhich = jest.fn();
jest.mock('which', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockWhich(...args),
}));

import type {
  IProcessSpawner,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';

import type { AgentRoleDefinition } from '@ptah-extension/shared';
import { transformAgentBody } from '@ptah-extension/harness-sync';

import {
  assertCommandLineWithinLimit,
  buildTaskPrompt,
  CliCommandLineTooLongError,
  probeCliVersion,
  renderRoleBlock,
  resolveDirectSpawn,
  spawnCli,
  withAsarUnpackedTwin,
} from './cli-adapter.utils';

interface FakeChild {
  stdout: EventEmitter & { setEncoding: jest.Mock };
  emit: (event: string, ...args: unknown[]) => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  kill: jest.Mock;
  pid: number;
  killed: boolean;
  whenSpawned: Promise<number | null>;
}

function createFakeChild(): FakeChild & EventEmitter {
  const child = new EventEmitter() as FakeChild & EventEmitter;
  const stdout = Object.assign(new EventEmitter(), {
    setEncoding: jest.fn(),
  });
  child.stdout = stdout;
  child.kill = jest.fn();
  child.pid = 8675;
  child.killed = false;
  child.whenSpawned = Promise.resolve(child.pid);
  return child;
}

describe('buildTaskPrompt', () => {
  const toolPolicy =
    'Tool policy: prefer direct `ptah_*` tools over `execute_code`. `ptah.files` is read-only; use native CLI write/edit tools for file creation or edits, never `execute_code`.';

  it('includes the shared native-agent policy without enhanced guidance', () => {
    const prompt = buildTaskPrompt({
      task: 'Implement the requested change.',
      workingDirectory: 'D:\\workspace',
    });

    expect(prompt).toBe(`${toolPolicy}\n\nImplement the requested change.`);
  });

  it('includes the policy exactly once independently of system guidance', () => {
    const prompt = buildTaskPrompt({
      task: 'Implement the requested change.',
      workingDirectory: 'D:\\workspace',
      systemPrompt: 'Existing system guidance.',
      projectGuidance: 'Ignored fallback guidance.',
    });

    expect(prompt).toContain('Existing system guidance.\n\n---\n\n');
    expect(prompt).not.toContain('Ignored fallback guidance.');
    expect(prompt.split(toolPolicy)).toHaveLength(2);
  });

  describe('role section order', () => {
    const role: AgentRoleDefinition = {
      name: 'backend-developer',
      description: 'Writes server code',
      body: 'Follow the repository patterns.',
      sourcePath: '/ws/.claude/agents/backend-developer.md',
      bytes: 30,
    };
    const roleBlock =
      '## Role: backend-developer\n\n' +
      'You are running as the `backend-developer` role; the definition below governs this task and outranks any generic persona above.\n\n' +
      'Follow the repository patterns.';
    const tail =
      `${toolPolicy}\n\nShip it.` +
      '\n\nFocus on these files:\n- src/a.ts' +
      '\n\nWrite deliverable files to: /tf' +
      '\nUse convention: /tf/agent-output-{agentId}.md for main deliverable.';
    const base = {
      task: 'Ship it.',
      workingDirectory: '/ws',
      files: ['src/a.ts'],
      taskFolder: '/tf',
    };

    it('no system context, no role', () => {
      expect(buildTaskPrompt(base, 'pi')).toBe(tail);
    });

    it('system context, no role', () => {
      expect(buildTaskPrompt({ ...base, systemPrompt: 'SYSTEM' }, 'pi')).toBe(
        `SYSTEM\n\n---\n\n${tail}`,
      );
    });

    it('no system context, with role', () => {
      expect(buildTaskPrompt({ ...base, role }, 'pi')).toBe(
        `${roleBlock}\n\n---\n\n${tail}`,
      );
    });

    it('system context, with role', () => {
      expect(
        buildTaskPrompt(
          { ...base, projectGuidance: 'GUIDANCE', role },
          'opencode',
        ),
      ).toBe(`GUIDANCE\n\n---\n\n${roleBlock}\n\n---\n\n${tail}`);
    });

    it('is byte-identical without a role whether or not a CLI is passed', () => {
      expect(buildTaskPrompt({ ...base, systemPrompt: 'SYSTEM' })).toBe(
        buildTaskPrompt({ ...base, systemPrompt: 'SYSTEM' }, 'codex'),
      );
    });

    it('omits the role when an adapter strips it for another channel', () => {
      expect(buildTaskPrompt({ ...base, role: undefined })).toBe(tail);
    });

    it('refuses to render a role without knowing the CLI', () => {
      expect(() => buildTaskPrompt({ ...base, role })).toThrow(
        'without the CLI',
      );
    });
  });
});

describe('renderRoleBlock', () => {
  const header = (name: string): string =>
    `## Role: ${name}\n\n` +
    `You are running as the \`${name}\` role; the definition below governs this task and outranks any generic persona above.\n\n`;

  function role(body: string): AgentRoleDefinition {
    return {
      name: 'reviewer',
      body,
      sourcePath: '/ws/.claude/agents/reviewer.md',
      bytes: Buffer.byteLength(body, 'utf8'),
    };
  }

  const claudeFlavouredBody =
    'Use the AskUserQuestion tool when blocked, then run /review-code.';

  it.each(['codex', 'copilot', 'cursor', 'antigravity'] as const)(
    'applies the harness transform for the %s lane',
    (cli) => {
      const rendered = renderRoleBlock(role(claudeFlavouredBody), cli);
      const transformed = transformAgentBody(claudeFlavouredBody, cli);

      expect(transformed).not.toBe(claudeFlavouredBody);
      expect(rendered).toBe(header('reviewer') + transformed);
    },
  );

  it.each(['pi', 'opencode', 'ptah-cli'] as const)(
    'leaves the body unchanged for the %s lane',
    (cli) => {
      expect(renderRoleBlock(role(claudeFlavouredBody), cli)).toBe(
        header('reviewer') + claudeFlavouredBody,
      );
    },
  );

  describe('a body that itself begins with a --- pair', () => {
    const body = '---\nkeep: this block\n---\nThe real instructions.';

    it.each([
      'codex',
      'copilot',
      'cursor',
      'antigravity',
      'pi',
      'opencode',
      'ptah-cli',
    ] as const)('preserves the leading block on the %s lane', (cli) => {
      expect(renderRoleBlock(role(body), cli)).toBe(
        header('reviewer') +
          '---\nkeep: this block\n---\nThe real instructions.',
      );
    });

    it('keeps the block and still rewrites the text after it on a transform lane', () => {
      const rewritable = '---\nkeep: this block\n---\n' + claudeFlavouredBody;
      const rendered = renderRoleBlock(role(rewritable), 'codex');
      const transformedTail = transformAgentBody(claudeFlavouredBody, 'codex');

      expect(transformedTail).not.toBe(claudeFlavouredBody);
      expect(rendered).toBe(
        header('reviewer') + '---\nkeep: this block\n---\n' + transformedTail,
      );
    });
  });
});

describe('assertCommandLineWithinLimit', () => {
  function measure(
    command: string,
    args: readonly string[],
    platform: NodeJS.Platform,
  ): CliCommandLineTooLongError | undefined {
    try {
      assertCommandLineWithinLimit(command, args, platform);
      return undefined;
    } catch (error: unknown) {
      if (error instanceof CliCommandLineTooLongError) {
        return error;
      }
      throw error;
    }
  }

  describe('win32 CreateProcess (32,767 including the terminating NUL)', () => {
    const overhead = 'node'.length + 1 + 1;

    it.each([
      [32_766, false],
      [32_767, false],
      [32_768, true],
    ])('measured %i throws=%s', (measured, throws) => {
      const arg = 'x'.repeat(measured - overhead);
      const error = measure('node', [arg], 'win32');

      expect(error !== undefined).toBe(throws);
      if (error) {
        expect(error.measured).toBe(measured);
        expect(error.limit).toBe(32_767);
        expect(error.largestArgIndex).toBe(0);
      }
    });

    it('counts the wrapping quotes and the backslash escape a " costs', () => {
      const plain = 'x'.repeat(32_767 - overhead);
      expect(measure('node', [plain], 'win32')).toBeUndefined();

      const withQuote = 'x'.repeat(32_767 - overhead - 4) + '"';
      expect(measure('node', [withQuote], 'win32')).toBeUndefined();
      expect(measure('node', [withQuote + 'x'], 'win32')?.measured).toBe(
        32_768,
      );
    });

    it('doubles a trailing backslash inside a quoted argument', () => {
      const quotedWithTrailingSlash = 'x'.repeat(32_767 - overhead - 5) + ' \\';
      expect(
        measure('node', [quotedWithTrailingSlash], 'win32'),
      ).toBeUndefined();

      const error = measure('node', ['y' + quotedWithTrailingSlash], 'win32');
      expect(error?.measured).toBe(32_768);
    });

    it('does not charge a trailing backslash in an unquoted argument', () => {
      const arg = 'x'.repeat(32_767 - overhead - 1) + '\\';
      expect(measure('node', [arg], 'win32')).toBeUndefined();
    });

    it('counts separators, the command and empty args', () => {
      const error = measure('node', ['', 'x'.repeat(32_767)], 'win32');
      expect(error?.measured).toBe(4 + 1 + 2 + 1 + 32_767 + 1);
      expect(error?.largestArgIndex).toBe(1);
    });
  });

  describe('win32 .cmd/.bat shim through cmd.exe (8,191)', () => {
    it.each(['C:\\npm\\tool.cmd', 'C:\\npm\\tool.CMD', 'C:\\npm\\tool.Bat'])(
      'applies the cmd.exe cap to %s',
      (command) => {
        const overhead = command.length + 1 + 1;
        expect(
          measure(command, ['x'.repeat(8_190 - overhead)], 'win32'),
        ).toBeUndefined();
        expect(
          measure(command, ['x'.repeat(8_191 - overhead)], 'win32'),
        ).toBeUndefined();
        const error = measure(command, ['x'.repeat(8_192 - overhead)], 'win32');
        expect(error?.measured).toBe(8_192);
        expect(error?.limit).toBe(8_191);
      },
    );

    it('keeps the CreateProcess cap for a resolved node entrypoint', () => {
      const arg = 'x'.repeat(20_000);
      expect(
        measure(
          'C:\\node\\node.exe',
          ['C:\\npm\\tool\\index.js', arg],
          'win32',
        ),
      ).toBeUndefined();
    });
  });

  describe('linux (each arg 131,071 bytes)', () => {
    it.each([
      [131_070, false],
      [131_071, false],
      [131_072, true],
    ])('arg of %i bytes throws=%s', (bytes, throws) => {
      const error = measure('opencode', ['run', 'x'.repeat(bytes)], 'linux');
      expect(error !== undefined).toBe(throws);
      if (error) {
        expect(error.measured).toBe(131_072);
        expect(error.limit).toBe(131_071);
        expect(error.largestArgIndex).toBe(1);
      }
    });

    it('measures UTF-8 bytes, not UTF-16 units', () => {
      const error = measure('opencode', ['é'.repeat(65_536)], 'linux');
      expect(error?.measured).toBe(131_072);
    });

    it('does not sum args', () => {
      expect(
        measure(
          'opencode',
          ['x'.repeat(131_071), 'x'.repeat(131_071)],
          'linux',
        ),
      ).toBeUndefined();
    });
  });

  describe('darwin (sum of arg bytes 1,048,576 - 4,096)', () => {
    const limit = 1_048_576 - 4_096;

    it.each([
      [limit - 1, false],
      [limit, false],
      [limit + 1, true],
    ])('args summing %i bytes throw=%s', (total, throws) => {
      const half = Math.floor(total / 2);
      const error = measure(
        'opencode',
        ['x'.repeat(half), 'x'.repeat(total - half)],
        'darwin',
      );
      expect(error !== undefined).toBe(throws);
      if (error) {
        expect(error.measured).toBe(limit + 1);
        expect(error.limit).toBe(limit);
        expect(error.largestArgIndex).toBe(1);
      }
    });
  });

  it('explains that nothing was truncated and names both remedies without a vendor', () => {
    const error = measure(
      'C:\\bin\\copilot.cmd',
      ['-p', 'x'.repeat(9_000)],
      'win32',
    );

    expect(error).toBeInstanceOf(CliCommandLineTooLongError);
    expect(error?.name).toBe('CliCommandLineTooLongError');
    expect(error?.message).toContain('argument 1 is 9000 UTF-16 units');
    expect(error?.message).toContain('Nothing was truncated');
    expect(error?.message).toContain('shorten the task');
    expect(error?.message).toContain(
      'use a lane whose role channel does not pass the prompt on the command line',
    );
    expect(error?.message).not.toMatch(
      /copilot|codex|cursor|antigravity|opencode|claude|\bpi\b/i,
    );
  });
});

/**
 * A minimal `IProcessSpawner` that records its requests and hands back a fake
 * handle, so the delegation can be asserted without a real worker thread.
 */
function createFakeSpawner(): {
  spawner: IProcessSpawner;
  requests: ProcessSpawnRequest[];
  handles: Array<FakeChild & EventEmitter>;
} {
  const requests: ProcessSpawnRequest[] = [];
  const handles: Array<FakeChild & EventEmitter> = [];
  const spawner: IProcessSpawner = {
    spawnProcess: (request) => {
      requests.push(request);
      const handle = createFakeChild();
      handles.push(handle);
      return handle as unknown as SpawnedProcessHandle;
    },
  };
  return { spawner, requests, handles };
}

describe('spawnCli', () => {
  const realPlatform = process.platform;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    setPlatform(realPlatform);
  });

  it('spawns inline through cross-spawn when no spawner is supplied', () => {
    // The no-regression assertion. Without an injected spawner nothing about
    // the launch changed: same `cross-spawn` call, same options.
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const handle = spawnCli('/usr/local/bin/opencode', ['run'], {
      cwd: '/work',
    });

    expect(mockCrossSpawn).toHaveBeenCalledTimes(1);
    const [binary, args, options] = mockCrossSpawn.mock.calls[0] as [
      string,
      string[],
      { cwd?: string; stdio: string[] },
    ];
    expect(binary).toBe('/usr/local/bin/opencode');
    expect(args).toEqual(['run']);
    expect(options.cwd).toBe('/work');
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(handle.stdout).toBe(child.stdout);
  });

  it('delegates to the injected spawner instead of cross-spawn', () => {
    const { spawner, requests } = createFakeSpawner();

    spawnCli('opencode', ['run', '--print'], {
      cwd: '/work',
      env: { OPENCODE_CONFIG_CONTENT: '{}' },
      spawner,
    });

    expect(mockCrossSpawn).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0].command).toBe('opencode');
    expect(requests[0].args).toEqual(['run', '--print']);
    expect(requests[0].cwd).toBe('/work');
    // The clean-env defaults still apply, and the caller's env wins over them.
    expect(requests[0].env['NO_COLOR']).toBe('1');
    expect(requests[0].env['OPENCODE_CONFIG_CONTENT']).toBe('{}');
  });

  it('forwards needsConsole and detached to the spawner on POSIX', () => {
    setPlatform('linux');
    const { spawner, requests } = createFakeSpawner();

    spawnCli('opencode', [], { needsConsole: true, detached: true, spawner });

    expect(requests[0].needsConsole).toBe(true);
    expect(requests[0].detached).toBe(true);
  });

  it('never asks for detached on Windows, where taskkill /T walks the tree', () => {
    setPlatform('win32');
    const { spawner, requests } = createFakeSpawner();

    spawnCli('opencode.cmd', [], { detached: true, spawner });

    expect(requests[0].detached).toBe(false);
  });
});

describe('probeCliVersion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the first stdout line through an injected spawner', async () => {
    const { spawner, requests, handles } = createFakeSpawner();

    const probe = probeCliVersion('agy', ['--version'], 5000, spawner);
    handles[0].stdout.emit('data', 'agy 1.1.3\nbanner\n');
    handles[0].emit('close', 0);

    await expect(probe).resolves.toBe('agy 1.1.3');
    expect(mockCrossSpawn).not.toHaveBeenCalled();
    expect(requests[0].command).toBe('agy');
    expect(requests[0].args).toEqual(['--version']);
  });

  it('kills the child and resolves undefined when a spawner probe times out', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    try {
      const { spawner, handles, requests } = createFakeSpawner();

      const probe = probeCliVersion('agy', ['--version'], 50, spawner);
      jest.advanceTimersByTime(51);

      await expect(probe).resolves.toBeUndefined();
      await Promise.resolve();
      expect(handles[0].kill).not.toHaveBeenCalled();
      expect(requests[0].detached).toBe(false);
      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '8675', '/T', '/F'],
        expect.any(Function),
      );
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });

  it('routes the spawn through cross-spawn (not child_process.execFile)', async () => {
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion('/usr/local/bin/codex');
    // Drive the child to completion.
    child.stdout.emit('data', 'codex-cli 1.4.2\n');
    child.emit('close', 0);

    await expect(probe).resolves.toBe('codex-cli 1.4.2');
    expect(mockCrossSpawn).toHaveBeenCalledTimes(1);
    const [binary, args] = mockCrossSpawn.mock.calls[0] as [string, string[]];
    expect(binary).toBe('/usr/local/bin/codex');
    expect(args).toEqual(['--version']);
  });

  it('passes a Windows .cmd wrapper path straight to cross-spawn (which handles the shim)', async () => {
    // The actual bug we are guarding against: prior to this fix, the version
    // probe used execFile, which throws EINVAL on .cmd/.bat/.ps1 wrappers on
    // Node 18.20+/Electron 30+ (CVE-2024-27980). cross-spawn transparently
    // re-routes those through cmd.exe with proper escaping.
    const cmdPath = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\copilot.cmd';
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion(cmdPath);
    child.stdout.emit('data', 'copilot 1.0.45\n');
    child.emit('close', 0);

    await expect(probe).resolves.toBe('copilot 1.0.45');
    const [binary] = mockCrossSpawn.mock.calls[0] as [string, string[]];
    expect(binary).toBe(cmdPath);
  });

  it('returns the first stdout line when the binary prints multi-line output', async () => {
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion('/usr/local/bin/cursor-agent');
    child.stdout.emit('data', 'cursor-agent 0.9.1\nhelp banner line\n');
    child.emit('close', 0);

    await expect(probe).resolves.toBe('cursor-agent 0.9.1');
  });

  it('resolves to undefined when the probe errors (e.g. spawn ENOENT)', async () => {
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion('/missing/binary');
    child.emit('error', new Error('spawn ENOENT'));

    await expect(probe).resolves.toBeUndefined();
  });

  it('resolves to undefined when the binary exits without producing stdout', async () => {
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion('/usr/local/bin/silent-cli');
    child.emit('close', 0);

    await expect(probe).resolves.toBeUndefined();
  });

  it('kills the child and resolves undefined when the probe times out', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    try {
      const child = createFakeChild();
      mockCrossSpawn.mockReturnValueOnce(child);

      const probe = probeCliVersion('/usr/local/bin/hung-cli', ['--version'], 50);
      // Advance past the timeout without emitting stdout or close.
      jest.advanceTimersByTime(51);
      await expect(probe).resolves.toBeUndefined();
      await Promise.resolve();
      expect(child.kill).not.toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '8675', '/T', '/F'],
        expect.any(Function),
      );
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });

  it('forwards a custom args array to cross-spawn', async () => {
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion('/usr/local/bin/cli', ['version', '--json']);
    child.stdout.emit('data', 'v2\n');
    child.emit('close', 0);

    await probe;
    const [, args] = mockCrossSpawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(['version', '--json']);
  });
});

describe('resolveDirectSpawn', () => {
  const realPlatform = process.platform;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      value: platform,
      configurable: true,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    setPlatform(realPlatform);
  });

  it('returns the binary unchanged on non-Windows even for a .cmd path', async () => {
    setPlatform('linux');

    const result = await resolveDirectSpawn('/usr/local/bin/copilot.cmd');

    expect(result).toEqual({
      command: '/usr/local/bin/copilot.cmd',
      prefixArgs: [],
    });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('returns the binary unchanged on Windows for a non-.cmd path', async () => {
    setPlatform('win32');

    const result = await resolveDirectSpawn('C:\\bin\\copilot.exe');

    expect(result).toEqual({ command: 'C:\\bin\\copilot.exe', prefixArgs: [] });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('rewrites a Windows .cmd wrapper to a direct node + entrypoint spawn', async () => {
    setPlatform('win32');
    mockReadFile.mockResolvedValue(
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & ' +
        '"%_prog%"  "%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*',
    );
    mockWhich.mockResolvedValue('C:\\Program Files\\nodejs\\node.exe');

    const result = await resolveDirectSpawn(
      'C:\\Users\\dev\\AppData\\Roaming\\npm\\copilot.cmd',
    );

    expect(result.command).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(result.prefixArgs).toHaveLength(1);
    expect(result.prefixArgs[0]).toMatch(/npm-loader\.js$/);
  });

  it('falls back to bare "node" when the node binary cannot be resolved', async () => {
    setPlatform('win32');
    mockReadFile.mockResolvedValue(
      '"%dp0%\\node_modules\\@github\\copilot\\npm-loader.js" %*',
    );
    mockWhich.mockRejectedValue(new Error('not found'));

    const result = await resolveDirectSpawn('C:\\npm\\copilot.cmd');

    expect(result.command).toBe('node');
    expect(result.prefixArgs[0]).toMatch(/npm-loader\.js$/);
  });

  it('falls back to the original .cmd when the wrapper cannot be read', async () => {
    setPlatform('win32');
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const result = await resolveDirectSpawn('C:\\npm\\copilot.cmd');

    expect(result).toEqual({ command: 'C:\\npm\\copilot.cmd', prefixArgs: [] });
  });
});

/**
 * Pure string helper — no cross-spawn / fs / which mocking needed.
 *
 * A native binary inside `app.asar` satisfies existsSync through the asar shim
 * but cannot be spawned; electron-builder's `asarUnpack` puts the spawnable
 * copy in the sibling `app.asar.unpacked` tree. Codex and opencode both route
 * their module-resolved candidates through this helper.
 */
describe('withAsarUnpackedTwin', () => {
  const UNIX_CANDIDATE =
    '/usr/local/lib/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
  const ASAR_CANDIDATE =
    'C:\\Users\\dev\\AppData\\Local\\Programs\\Ptah\\resources\\app.asar\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';

  it('returns the candidate alone when it is not inside an asar', () => {
    expect(withAsarUnpackedTwin(UNIX_CANDIDATE)).toEqual([UNIX_CANDIDATE]);
  });

  it('appends the app.asar.unpacked twin, original first', () => {
    const result = withAsarUnpackedTwin(ASAR_CANDIDATE);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(ASAR_CANDIDATE);
    expect(result[1]).toBe(
      ASAR_CANDIDATE.replace('app.asar\\', 'app.asar.unpacked\\'),
    );
    expect(result[1]).toContain('\\app.asar.unpacked\\node_modules\\');
  });

  it('does not re-rewrite a path that is already app.asar.unpacked', () => {
    // What the `(?!\.unpacked)` lookahead exists for: without it this would
    // yield an `app.asar.unpacked.unpacked` directory that never exists.
    const unpacked = ASAR_CANDIDATE.replace(
      'app.asar\\',
      'app.asar.unpacked\\',
    );

    const result = withAsarUnpackedTwin(unpacked);

    expect(result).toEqual([unpacked]);
    expect(result[0]).not.toContain('app.asar.unpacked.unpacked');
  });
});
