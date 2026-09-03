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

import { EventEmitter } from 'events';

const mockCrossSpawn = jest.fn();

jest.mock('cross-spawn', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCrossSpawn(...args),
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

import {
  buildTaskPrompt,
  probeCliVersion,
  resolveDirectSpawn,
  spawnCli,
  withAsarUnpackedTwin,
} from './cli-adapter.utils';

interface FakeChild {
  stdout: EventEmitter & { setEncoding: jest.Mock };
  emit: (event: string, ...args: unknown[]) => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  kill: jest.Mock;
}

function createFakeChild(): FakeChild & EventEmitter {
  const child = new EventEmitter() as FakeChild & EventEmitter;
  const stdout = Object.assign(new EventEmitter(), {
    setEncoding: jest.fn(),
  });
  child.stdout = stdout;
  child.kill = jest.fn();
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
    const { spawner, handles } = createFakeSpawner();

    const probe = probeCliVersion('agy', ['--version'], 50, spawner);
    jest.advanceTimersByTime(51);
    handles[0].emit('close', null);

    await expect(probe).resolves.toBeUndefined();
    expect(handles[0].kill).toHaveBeenCalled();
    jest.useRealTimers();
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
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion('/usr/local/bin/hung-cli', ['--version'], 50);
    // Advance past the timeout without emitting stdout or close.
    jest.advanceTimersByTime(51);
    // The probe's timeout handler kills the child, which would normally cause
    // a 'close' to fire. Simulate that to let the promise settle deterministically.
    child.emit('close', null);

    await expect(probe).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenCalled();
    jest.useRealTimers();
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
