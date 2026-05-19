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

import { probeCliVersion } from './cli-adapter.utils';

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

describe('probeCliVersion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes the spawn through cross-spawn (not child_process.execFile)', async () => {
    const child = createFakeChild();
    mockCrossSpawn.mockReturnValueOnce(child);

    const probe = probeCliVersion('/usr/local/bin/gemini');
    // Drive the child to completion.
    child.stdout.emit('data', 'gemini-cli 1.4.2\n');
    child.emit('close', 0);

    await expect(probe).resolves.toBe('gemini-cli 1.4.2');
    expect(mockCrossSpawn).toHaveBeenCalledTimes(1);
    const [binary, args] = mockCrossSpawn.mock.calls[0] as [string, string[]];
    expect(binary).toBe('/usr/local/bin/gemini');
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
