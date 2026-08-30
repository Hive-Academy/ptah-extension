import 'reflect-metadata';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AUTO_CAPTURE_COOLDOWN_MS,
  CPU_PROFILE_ON_LAG_MS_ENV,
  CpuProfileCapture,
  DEFAULT_CPU_PROFILE_DURATION_MS,
} from './cpu-profile-capture';
import type { Logger } from '../logging/logger';

function createLogger(): Pick<Logger, 'debug' | 'info' | 'warn' | 'error'> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
}

describe('CpuProfileCapture', () => {
  let tempDir: string;
  let logger: ReturnType<typeof createLogger>;
  let capture: CpuProfileCapture;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ptah-cpuprofile-'));
    logger = createLogger();
    capture = new CpuProfileCapture(logger as unknown as Logger, undefined);
    capture.configure(tempDir);
  });

  afterEach(async () => {
    delete process.env[CPU_PROFILE_ON_LAG_MS_ENV];
    await rm(tempDir, { recursive: true, force: true });
  });

  it('writes a parseable .cpuprofile to the configured directory', async () => {
    // A real inspector session against a real 25 ms window — the point of this
    // spec is that V8 actually produces a profile in this runtime, which a
    // mocked session would not tell us.
    const profilePath = await capture.captureFor(25);

    expect(profilePath.startsWith(tempDir)).toBe(true);
    expect(profilePath.endsWith('.cpuprofile')).toBe(true);

    const parsed: unknown = JSON.parse(await readFile(profilePath, 'utf8'));
    // DevTools requires `nodes`, `startTime` and `endTime` to open the file.
    expect(parsed).toEqual(
      expect.objectContaining({
        nodes: expect.any(Array),
        startTime: expect.any(Number),
        endTime: expect.any(Number),
      }),
    );
  });

  it('logs the path at warn so it is findable in a filtered log', async () => {
    const profilePath = await capture.captureFor(25);

    expect(logger.warn).toHaveBeenCalledWith(
      '[cpu-profile] captured',
      expect.objectContaining({ path: profilePath }),
    );
  });

  it('is single-flight — a concurrent call shares the running capture', async () => {
    const first = capture.captureFor(60);
    const second = capture.captureFor(60);

    // Same promise identity, not merely the same value: two overlapping
    // `Profiler.start` calls on one session is a protocol error, and the
    // trigger conditions (a stall) arrive in bursts.
    expect(second).toBe(first);
    expect(capture.capturing).toBe(true);

    const [firstPath, secondPath] = await Promise.all([first, second]);
    expect(secondPath).toBe(firstPath);
    expect(await readdir(tempDir)).toHaveLength(1);
    expect(capture.capturing).toBe(false);
  });

  it('allows a fresh capture once the previous one settled', async () => {
    await capture.captureFor(25);
    await capture.captureFor(25);

    expect(await readdir(tempDir)).toHaveLength(2);
  });

  it('falls back to the platform storage logs dir when unconfigured', async () => {
    const fallback = new CpuProfileCapture(
      logger as unknown as Logger,
      {
        type: 'cli',
        extensionPath: tempDir,
        globalStoragePath: tempDir,
        workspaceStoragePath: tempDir,
      } as unknown as ConstructorParameters<typeof CpuProfileCapture>[1],
    );

    const profilePath = await fallback.captureFor(25);

    expect(profilePath.startsWith(path.join(tempDir, 'logs'))).toBe(true);
  });

  /**
   * `captureFor` is stubbed throughout this block. Auto-capture defaults to a
   * 10 s profile, and these tests are about the DECISION to capture — the
   * threshold, the cooldown — not about profiling, which the specs above
   * already exercise for real.
   */
  describe('auto-capture on lag', () => {
    let captureFor: jest.SpyInstance;

    beforeEach(() => {
      captureFor = jest
        .spyOn(capture, 'captureFor')
        .mockResolvedValue(path.join(tempDir, 'stub.cpuprofile'));
    });

    it('does nothing when PTAH_PROFILE_ON_LAG_MS is unset', () => {
      capture.handleLag({ maxMs: 5000, p99Ms: 4000, meanMs: 100 });

      expect(captureFor).not.toHaveBeenCalled();
    });

    it('does nothing when lag is below the configured threshold', () => {
      process.env[CPU_PROFILE_ON_LAG_MS_ENV] = '1000';

      capture.handleLag({ maxMs: 300, p99Ms: 250, meanMs: 50 });

      expect(captureFor).not.toHaveBeenCalled();
    });

    it('captures a 10s profile once lag passes the threshold', () => {
      process.env[CPU_PROFILE_ON_LAG_MS_ENV] = '200';

      capture.handleLag({ maxMs: 900, p99Ms: 700, meanMs: 120 });

      expect(captureFor).toHaveBeenCalledWith(DEFAULT_CPU_PROFILE_DURATION_MS);
      expect(logger.warn).toHaveBeenCalledWith(
        '[cpu-profile] lag over auto-capture threshold',
        expect.objectContaining({ maxMs: 900, thresholdMs: 200 }),
      );
    });

    it('holds the cooldown across a run of lag windows', () => {
      process.env[CPU_PROFILE_ON_LAG_MS_ENV] = '200';
      const sample = { maxMs: 900, p99Ms: 700, meanMs: 120 };

      // A stall produces consecutive breached windows every 2 s. Without the
      // cooldown each one would start a profile on an already-struggling
      // process and fill the log directory with near-identical files.
      capture.handleLag(sample);
      capture.handleLag(sample);
      capture.handleLag(sample);

      expect(captureFor).toHaveBeenCalledTimes(1);
    });

    it('captures again once the cooldown has elapsed', () => {
      process.env[CPU_PROFILE_ON_LAG_MS_ENV] = '200';
      const sample = { maxMs: 900, p99Ms: 700, meanMs: 120 };
      const realNow = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow);

      try {
        capture.handleLag(sample);
        nowSpy.mockReturnValue(realNow + AUTO_CAPTURE_COOLDOWN_MS + 1);
        capture.handleLag(sample);
      } finally {
        nowSpy.mockRestore();
      }

      expect(captureFor).toHaveBeenCalledTimes(2);
    });

    it('logs rather than throws when an auto-capture fails', async () => {
      process.env[CPU_PROFILE_ON_LAG_MS_ENV] = '200';
      captureFor.mockRejectedValue(new Error('inspector unavailable'));

      expect(() =>
        capture.handleLag({ maxMs: 900, p99Ms: 700, meanMs: 120 }),
      ).not.toThrow();

      // The rejection is handled in a `.catch` on a floating promise, so let
      // the microtask queue drain before asserting on the log.
      await Promise.resolve();
      await Promise.resolve();
      expect(logger.warn).toHaveBeenCalledWith(
        '[cpu-profile] auto-capture failed',
        expect.objectContaining({ reason: 'inspector unavailable' }),
      );
    });
  });
});
