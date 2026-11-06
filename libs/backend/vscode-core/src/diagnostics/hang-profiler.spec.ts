import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '../logging/logger';
import {
  HANG_PROFILE_DIR_NAME,
  HANG_PROFILE_ROTATE_MS,
  HANG_PROFILE_SAMPLING_INTERVAL_US,
  HangProfiler,
  MAX_HANG_PROFILES,
  isHangProfileEnabled,
} from './hang-profiler';
import {
  createFakeInspectorSession,
  type FakeInspectorSession,
} from '../testing/inspector-session.mock';

const T = Date.parse('2026-11-06T04:16:52.080Z');

type ProfilerLogger = Pick<Logger, 'debug' | 'info' | 'warn'>;

function createLogger(): jest.Mocked<ProfilerLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
}

describe('HangProfiler', () => {
  let logsDir: string;
  let session: FakeInspectorSession;
  let logger: jest.Mocked<ProfilerLogger>;
  let now: number;
  let profiler: HangProfiler;
  const postParams: Array<{ method: string; params: object | undefined }> = [];

  beforeEach(() => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-hang-profile-'));
    session = createFakeInspectorSession();
    const post = session.post;
    session.post = (method, params) => {
      postParams.push({ method, params });
      return post(method, params);
    };
    postParams.length = 0;
    logger = createLogger();
    now = T;
    profiler = new HangProfiler({
      logger,
      logsPath: logsDir,
      createSession: () => session,
      now: () => now,
    });
  });

  afterEach(async () => {
    await profiler.dispose();
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  it('starts a coarse sampling profile (interval set before start)', async () => {
    await profiler.start();

    expect(session.calls).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
    ]);
    expect(postParams[1].params).toEqual({
      interval: HANG_PROFILE_SAMPLING_INTERVAL_US,
    });
  });

  it('on recovery stops the window, restarts sampling, writes the profile and ranks the hang window', async () => {
    await profiler.start();
    session.calls.length = 0;

    const fields = await profiler.captureHang({
      hangStartedAt: T - 600,
      blockedForMs: 500,
    });

    expect(session.calls).toEqual(['Profiler.stop', 'Profiler.start']);
    expect(path.dirname(fields.hangProfile)).toBe(
      path.join(logsDir, HANG_PROFILE_DIR_NAME),
    );
    expect(path.basename(fields.hangProfile)).toBe(
      '2026-11-06T04-16-52-080Z.cpuprofile',
    );
    const written: unknown = JSON.parse(
      fs.readFileSync(fields.hangProfile, 'utf8'),
    );
    expect(written).toEqual(session.nextProfile);
    expect(fields.profileWindowed).toBe(true);
    expect(fields.topSelfTime[0]).toEqual({
      fn: 'hotLoop',
      at: 'file:///app/main.js:42',
      selfMs: 400,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[hang-profile] captured',
      expect.objectContaining({ path: fields.hangProfile, top: 'hotLoop' }),
    );
  });

  it(`keeps at most ${MAX_HANG_PROFILES} profiles, deleting the oldest`, async () => {
    const dir = path.join(logsDir, HANG_PROFILE_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < MAX_HANG_PROFILES + 2; i++) {
      const day = String(i + 1).padStart(2, '0');
      fs.writeFileSync(
        path.join(dir, `2026-01-${day}T00-00-00-000Z.cpuprofile`),
        '{}',
      );
    }
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'kept');
    await profiler.start();

    const fields = await profiler.captureHang({
      hangStartedAt: T - 600,
      blockedForMs: 500,
    });

    const remaining = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.cpuprofile'))
      .sort();
    expect(remaining).toHaveLength(MAX_HANG_PROFILES);
    expect(remaining).toContain(path.basename(fields.hangProfile));
    expect(remaining).not.toContain('2026-01-01T00-00-00-000Z.cpuprofile');
    expect(remaining).not.toContain('2026-01-03T00-00-00-000Z.cpuprofile');
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true);
  });

  it('rotates an on-time window but leaves a late one (main was blocked) running', async () => {
    await profiler.start();
    session.calls.length = 0;

    now += HANG_PROFILE_ROTATE_MS;
    profiler.onRotateTick();
    await profiler.captureHang({ hangStartedAt: now - 10, blockedForMs: 5 });
    expect(session.calls.slice(0, 2)).toEqual([
      'Profiler.stop',
      'Profiler.start',
    ]);

    session.calls.length = 0;
    now += HANG_PROFILE_ROTATE_MS + 8_000;
    profiler.onRotateTick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(session.calls).toEqual([]);
  });

  it('disconnects and rejects when the profiler cannot start', async () => {
    session.failOn = 'Profiler.start';

    await expect(profiler.start()).rejects.toThrow('Profiler.start failed');
    expect(session.disconnected).toBe(true);
    await expect(
      profiler.captureHang({ hangStartedAt: T - 600, blockedForMs: 500 }),
    ).rejects.toThrow('hang profiler not running');
  });

  it('rejects a capture whose profile cannot be parsed, and keeps sampling', async () => {
    await profiler.start();
    const post = session.post;
    session.post = (method, params) =>
      method === 'Profiler.stop'
        ? Promise.resolve({ profile: { nodes: 'broken' } })
        : post(method, params);

    await expect(
      profiler.captureHang({ hangStartedAt: T - 600, blockedForMs: 500 }),
    ).rejects.toThrow();
    expect(session.calls[session.calls.length - 1]).toBe('Profiler.start');
  });

  it('stops and disconnects on dispose, idempotently', async () => {
    await profiler.start();
    await profiler.dispose();
    await profiler.dispose();

    expect(session.calls.filter((c) => c === 'Profiler.stop')).toHaveLength(1);
    expect(session.disconnected).toBe(true);
  });
});

describe('isHangProfileEnabled', () => {
  it('is on only for PTAH_HANG_PROFILE=1', () => {
    expect(isHangProfileEnabled({ PTAH_HANG_PROFILE: '1' })).toBe(true);
    expect(isHangProfileEnabled({ PTAH_HANG_PROFILE: ' 1 ' })).toBe(true);
    expect(isHangProfileEnabled({ PTAH_HANG_PROFILE: '0' })).toBe(false);
    expect(isHangProfileEnabled({ PTAH_HANG_PROFILE: 'true' })).toBe(false);
    expect(isHangProfileEnabled({})).toBe(false);
  });
});
