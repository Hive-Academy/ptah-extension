/**
 * `ClaudeCliDetector` — the boot-path CLI probe.
 *
 * This spec exists because the detector was the first thing in the process to
 * call `child_process.spawn(command, args, { shell: needsShell })` on Windows,
 * which made Node print `[DEP0190]` once and then stay quiet about every other
 * offender in the run (TASK_2026_348). The assertions therefore pin the
 * MECHANISM, not the warning: `cross-spawn` is what runs, `child_process.spawn`
 * is not, and no call carries a `shell` option at all.
 *
 * `os` is pinned to win32 because that is the only platform where the old code
 * computed `needsShell` — a probe spawned on linux never proved anything about
 * this bug.
 */

import 'reflect-metadata';
import { EventEmitter } from 'events';

jest.mock('cross-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('which', () => ({ __esModule: true, default: jest.fn() }));

// `child_process.spawn` must not be reached at all. Mocked (rather than spied)
// so a regression fails loudly here instead of spawning a real process on the
// test machine.
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(() => {
    throw new Error('child_process.spawn must not be used by the detector');
  }),
}));

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn(() => 'win32'),
  homedir: jest.fn(() => 'C:\\Users\\test'),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => false),
}));

// The resolver is a separate unit with its own child process; stubbing it keeps
// this spec's "nothing else spawns" claim about the detector alone.
jest.mock('./claude-cli-path-resolver', () => ({
  ClaudeCliPathResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue(null),
  })),
}));

import crossSpawn from 'cross-spawn';
import whichLib from 'which';
import { spawn as rawSpawn } from 'child_process';
import * as fs from 'fs';

import { ClaudeCliDetector } from './claude-cli-detector';

const crossSpawnMock = crossSpawn as unknown as jest.Mock;
const whichMock = whichLib as unknown as jest.Mock;
const rawSpawnMock = rawSpawn as unknown as jest.Mock;
const existsSyncMock = fs.existsSync as unknown as jest.Mock;

const CONFIGURED_CMD = 'C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd';
const VERSION_LINE = '2.1.247 (Claude Code)';

/** Minimal stand-in for the pieces of `ChildProcess` the detector touches. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = jest.fn();
}

interface ChildScript {
  stdout?: string;
  stderr?: string;
  code?: number;
  /** Never emits `close` — used to drive the timeout path. */
  hang?: boolean;
}

let defaultScript: ChildScript = { stdout: '', stderr: '', code: 1 };
let spawnedChildren: FakeChild[] = [];

function scriptChildren(script: ChildScript): void {
  defaultScript = script;
}

/** Options every `cross-spawn` call was made with, in order. */
function spawnOptions(): Array<Record<string, unknown>> {
  return crossSpawnMock.mock.calls.map(
    (call) => (call[2] ?? {}) as Record<string, unknown>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  spawnedChildren = [];
  defaultScript = { stdout: '', stderr: '', code: 1 };
  existsSyncMock.mockReturnValue(false);
  whichMock.mockResolvedValue(null);

  crossSpawnMock.mockImplementation(() => {
    const child = new FakeChild();
    spawnedChildren.push(child);
    const script = defaultScript;
    if (script.hang !== true) {
      setImmediate(() => {
        if (script.stdout)
          child.stdout.emit('data', Buffer.from(script.stdout));
        if (script.stderr)
          child.stderr.emit('data', Buffer.from(script.stderr));
        child.emit('close', script.code ?? 0);
      });
    }
    return child;
  });
});

describe('ClaudeCliDetector — process spawning', () => {
  it('probes a configured Windows .cmd path without any shell option', async () => {
    existsSyncMock.mockImplementation((p: string) => p === CONFIGURED_CMD);
    scriptChildren({ stdout: VERSION_LINE, code: 0 });

    const detector = new ClaudeCliDetector();
    detector.configure({ configuredPath: CONFIGURED_CMD });

    const installation = await detector.findExecutable();

    expect(installation).toEqual({ path: CONFIGURED_CMD, source: 'config' });
    expect(crossSpawnMock).toHaveBeenCalledWith(
      CONFIGURED_CMD,
      ['--version'],
      expect.anything(),
    );
    // The whole point of the change: a `.cmd` wrapper is handled by cross-spawn,
    // not by handing cmd.exe a concatenated command line.
    for (const options of spawnOptions()) {
      expect(options).not.toHaveProperty('shell');
    }
    expect(rawSpawnMock).not.toHaveBeenCalled();
  });

  it('never spawns `where` — PATH lookup goes through the which library', async () => {
    const pathHit = 'C:\\Users\\test\\.local\\bin\\claude.exe';
    whichMock.mockResolvedValue([pathHit]);
    existsSyncMock.mockImplementation((p: string) => p === pathHit);
    scriptChildren({ stdout: VERSION_LINE, code: 0 });

    const installation = await new ClaudeCliDetector().findExecutable();

    expect(installation).toEqual({ path: pathHit, source: 'which-where' });
    expect(whichMock).toHaveBeenCalledWith('claude', {
      all: true,
      nothrow: true,
    });
    const commands = crossSpawnMock.mock.calls.map((call) => call[0]);
    expect(commands).not.toContain('where');
    expect(commands).not.toContain('which');
    expect(rawSpawnMock).not.toHaveBeenCalled();
  });

  it('passes no shell option on any fallback probe either', async () => {
    // Nothing exists and nothing succeeds: every strategy runs, which is the
    // widest set of spawns the detector can make in one call.
    scriptChildren({ stderr: 'not found', code: 1 });

    const installation = await new ClaudeCliDetector().findExecutable();

    expect(installation).toBeNull();
    expect(crossSpawnMock.mock.calls.length).toBeGreaterThan(0);
    for (const options of spawnOptions()) {
      expect(options).not.toHaveProperty('shell');
      expect(options).toMatchObject({ stdio: 'pipe', windowsHide: true });
    }
    expect(rawSpawnMock).not.toHaveBeenCalled();
  });
});

describe('ClaudeCliDetector — health check', () => {
  it('reports the version parsed from a successful probe', async () => {
    existsSyncMock.mockImplementation((p: string) => p === CONFIGURED_CMD);
    scriptChildren({ stdout: VERSION_LINE, code: 0 });

    const detector = new ClaudeCliDetector();
    detector.configure({ configuredPath: CONFIGURED_CMD });

    const health = await detector.performHealthCheck();

    expect(health).toMatchObject({
      available: true,
      path: CONFIGURED_CMD,
      version: '2.1.247',
      platform: 'win32',
    });
    expect(rawSpawnMock).not.toHaveBeenCalled();
  });

  it('reports unavailable when the probe exits non-zero', async () => {
    existsSyncMock.mockImplementation((p: string) => p === CONFIGURED_CMD);
    scriptChildren({ stderr: 'boom', code: 1 });

    const detector = new ClaudeCliDetector();
    detector.configure({ configuredPath: CONFIGURED_CMD });

    const health = await detector.performHealthCheck();

    expect(health.available).toBe(false);
    expect(health.error).toBeDefined();
  });

  it('reports unavailable when the CLI answers with something else', async () => {
    existsSyncMock.mockImplementation((p: string) => p === CONFIGURED_CMD);
    scriptChildren({ stdout: 'bash: command not found', code: 0 });

    const detector = new ClaudeCliDetector();
    detector.configure({ configuredPath: CONFIGURED_CMD });

    expect(await detector.findExecutable()).toBeNull();
  });
});

describe('ClaudeCliDetector — timeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('kills the child and fails the probe when it never closes', async () => {
    jest.useFakeTimers();
    scriptChildren({ hang: true });

    const detector = new ClaudeCliDetector();
    const verified = detector.verifyInstallation({
      path: CONFIGURED_CMD,
      source: 'config',
    });

    // Let the promise executor run, then expire the 10s verify timeout.
    await Promise.resolve();
    jest.advanceTimersByTime(10_000);

    await expect(verified).resolves.toBe(false);
    expect(spawnedChildren).toHaveLength(1);
    expect(spawnedChildren[0].kill).toHaveBeenCalled();
  });
});
