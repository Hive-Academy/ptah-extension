import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  HANG_LOG_FILE_NAME,
  MAX_BREADCRUMB_KEYS,
  MAX_BREADCRUMB_VALUE_LENGTH,
  MAX_WORKER_RESTARTS,
  MainLoopWatchdog,
  appendHangLogLine,
} from './main-loop-watchdog';
import { HANG_LOG_APPEND_SOURCE } from './main-loop-watchdog-source';
import type { Logger } from '../logging/logger';

const PERF_ENABLED = process.env['PTAH_PERF_SPECS'] === '1';

/**
 * These specs run the REAL eval'd worker against a REAL temp file and block
 * the REAL Jest thread with `Atomics.wait`. That is the only honest test of
 * this class: its whole claim is that a thread which does not need the main
 * loop writes the record WHILE the main loop is frozen. A mocked worker would
 * prove nothing about that (INV-8, AC-5).
 */

interface HangLine {
  time: string;
  source: string;
  event: 'hang' | 'recovered';
  blockedForMs: number;
  breadcrumbs: Record<string, string>;
}

function createLogger(): jest.Mocked<
  Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>
> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<
    Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>
  >;
}

/** Block this thread synchronously without spinning a core. */
function blockMainThread(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLines(file: string): HangLine[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as HangLine);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('MainLoopWatchdog', () => {
  let logsDir: string;
  let watchdog: MainLoopWatchdog;
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-watchdog-'));
    logger = createLogger();
    watchdog = new MainLoopWatchdog(logger as unknown as Logger);
  });

  afterEach(async () => {
    await watchdog.dispose();
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  it('AC-5: a 6 s main-loop block with default thresholds writes exactly one hang line and one recovery line', async () => {
    const hangLog = path.join(logsDir, HANG_LOG_FILE_NAME);
    watchdog.setBreadcrumb('rpcMethod', 'chat:resume');
    watchdog.start({ logsPath: logsDir });
    // Let the worker boot and receive its first heartbeat before blocking.
    await waitFor(() => watchdog.running, 1_000);
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    // Post one heartbeat immediately before the block. Without it the last
    // beat could be up to a full interval old (more under a loaded CI runner),
    // which shrinks the margin between "hang detected" and "block ended" from
    // ~750 ms to nearly nothing. `postMessage` enqueues synchronously, so the
    // worker receives it even though this thread blocks on the next line.
    (watchdog as unknown as { beat(): void }).beat();
    const blockStartedAt = Date.now();
    blockMainThread(6_000);

    // The hang line landed DURING the block — before this thread could run a
    // single timer — which is the property the worker exists for.
    const duringBlock = readLines(hangLog);
    expect(duringBlock).toHaveLength(1);
    expect(duringBlock[0].event).toBe('hang');
    expect(Date.parse(duringBlock[0].time)).toBeLessThanOrEqual(
      blockStartedAt + 6_000,
    );

    await waitFor(() => readLines(hangLog).length >= 2, 3_000);
    // One more heartbeat period, to prove recovery is not repeated.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const lines = readLines(hangLog);
    expect(lines.map((l) => l.event)).toEqual(['hang', 'recovered']);
    const [hang, recovered] = lines;
    expect(hang.source).toBe('main-loop-watchdog');
    expect(hang.blockedForMs).toBeGreaterThanOrEqual(5_000);
    expect(hang.breadcrumbs).toEqual({ rpcMethod: 'chat:resume' });
    expect(recovered.blockedForMs).toBeGreaterThanOrEqual(5_900);
    // Absolute upper bound is a timing budget, not a mechanism: a loaded CI
    // runner can delay the post-block heartbeat arbitrarily. Opt-in only, per
    // the repo's `PTAH_PERF_SPECS=1` convention.
    if (PERF_ENABLED) {
      expect(recovered.blockedForMs).toBeLessThan(7_500);
    }
  }, 20_000);

  it('writes nothing while heartbeats keep arriving', async () => {
    watchdog.start({
      logsPath: logsDir,
      heartbeatIntervalMs: 50,
      hangThresholdMs: 400,
      checkIntervalMs: 25,
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    expect(readLines(path.join(logsDir, HANG_LOG_FILE_NAME))).toEqual([]);
  });

  it('records one hang/recovery pair per block, carrying the latest breadcrumbs', async () => {
    const hangLog = path.join(logsDir, HANG_LOG_FILE_NAME);
    watchdog.start({
      logsPath: logsDir,
      heartbeatIntervalMs: 50,
      hangThresholdMs: 300,
      checkIntervalMs: 25,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    watchdog.setBreadcrumb('phase', 'first');
    await new Promise((resolve) => setTimeout(resolve, 150));
    blockMainThread(700);
    await waitFor(() => readLines(hangLog).length >= 2, 2_000);

    watchdog.setBreadcrumb('phase', 'second');
    await new Promise((resolve) => setTimeout(resolve, 150));
    blockMainThread(700);
    await waitFor(() => readLines(hangLog).length >= 4, 2_000);

    const lines = readLines(hangLog);
    expect(lines.map((l) => [l.event, l.breadcrumbs['phase']])).toEqual([
      ['hang', 'first'],
      ['recovered', 'first'],
      ['hang', 'second'],
      ['recovered', 'second'],
    ]);
  });

  it('creates the log directory on first write', async () => {
    const nested = path.join(logsDir, 'not', 'yet', 'there');
    const hangLog = path.join(nested, HANG_LOG_FILE_NAME);
    expect(fs.existsSync(nested)).toBe(false);
    watchdog.start({
      logsPath: nested,
      heartbeatIntervalMs: 50,
      hangThresholdMs: 300,
      checkIntervalMs: 25,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    blockMainThread(600);
    await waitFor(() => readLines(hangLog).length >= 1, 2_000);

    expect(fs.statSync(nested).isDirectory()).toBe(true);
    const lines = readLines(hangLog);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0].event).toBe('hang');
  });

  it('survives an unwritable hang log without the worker dying', async () => {
    // A FILE where the log directory should be makes every append throw.
    const blocker = path.join(logsDir, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    watchdog.start({
      logsPath: blocker,
      heartbeatIntervalMs: 50,
      hangThresholdMs: 300,
      checkIntervalMs: 25,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    blockMainThread(600);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(watchdog.running).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('bounds breadcrumb keys and value length', () => {
    for (let i = 0; i < MAX_BREADCRUMB_KEYS + 5; i++) {
      watchdog.setBreadcrumb(`k${i}`, i);
    }
    watchdog.setBreadcrumb('k0', 'x'.repeat(MAX_BREADCRUMB_VALUE_LENGTH + 50));
    const crumbs = (watchdog as unknown as { breadcrumbs: Map<string, string> })
      .breadcrumbs;

    expect(crumbs.size).toBe(MAX_BREADCRUMB_KEYS);
    expect(crumbs.has(`k${MAX_BREADCRUMB_KEYS}`)).toBe(false);
    expect(crumbs.get('k0')).toHaveLength(MAX_BREADCRUMB_VALUE_LENGTH);
  });

  it('start is idempotent and dispose is safe to repeat', async () => {
    watchdog.start({ logsPath: logsDir });
    const firstWorker = (watchdog as unknown as { worker: unknown }).worker;
    watchdog.start({ logsPath: logsDir });

    expect((watchdog as unknown as { worker: unknown }).worker).toBe(
      firstWorker,
    );
    expect(logger.info).toHaveBeenCalledTimes(1);

    await watchdog.dispose();
    await watchdog.dispose();
    expect(watchdog.running).toBe(false);
    // A dispose-caused exit is ours: no restart, no warning.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(watchdog.isDegraded).toBe(false);
  });

  describe('worker death', () => {
    type Internals = { worker: { terminate(): Promise<number> } | undefined };
    const workerOf = (w: MainLoopWatchdog) =>
      (w as unknown as Internals).worker;

    async function killWorker(w: MainLoopWatchdog): Promise<void> {
      const current = workerOf(w);
      if (current === undefined) throw new Error('no live worker to kill');
      await current.terminate();
      // `exit` is delivered on a later tick than the terminate resolution.
      await waitFor(() => workerOf(w) !== current, 2_000);
    }

    it('restarts a worker that exits on its own, with one warning per death, and keeps detecting hangs', async () => {
      const hangLog = path.join(logsDir, HANG_LOG_FILE_NAME);
      watchdog.start({
        logsPath: logsDir,
        heartbeatIntervalMs: 50,
        hangThresholdMs: 300,
        checkIntervalMs: 25,
      });
      const original = workerOf(watchdog);

      await killWorker(watchdog);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[watchdog] worker died — restarting',
        expect.objectContaining({ restart: 1, budget: MAX_WORKER_RESTARTS }),
      );
      expect(watchdog.running).toBe(true);
      expect(workerOf(watchdog)).not.toBe(original);

      // The replacement worker still records a hang.
      await new Promise((resolve) => setTimeout(resolve, 200));
      blockMainThread(700);
      await waitFor(() => readLines(hangLog).length >= 2, 2_000);
      expect(readLines(hangLog).map((l) => l.event)).toEqual([
        'hang',
        'recovered',
      ]);
    });

    it('stops after the restart budget and logs one degraded line', async () => {
      watchdog.start({ logsPath: logsDir, heartbeatIntervalMs: 50 });

      for (let i = 0; i < MAX_WORKER_RESTARTS; i++) {
        await killWorker(watchdog);
      }
      expect(watchdog.running).toBe(true);
      expect(logger.warn).toHaveBeenCalledTimes(MAX_WORKER_RESTARTS);

      await killWorker(watchdog);

      expect(watchdog.running).toBe(false);
      expect(watchdog.isDegraded).toBe(true);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        '[watchdog] degraded — restart budget spent, hang records stopped',
        expect.objectContaining({ restarts: MAX_WORKER_RESTARTS }),
      );
      // The heartbeat stopped with it: nothing left to post to, nothing logged.
      expect(
        (watchdog as unknown as { heartbeat: unknown }).heartbeat,
      ).toBeUndefined();
    });
  });

  it('the worker rotates its hang log at the cap', async () => {
    const hangLog = path.join(logsDir, HANG_LOG_FILE_NAME);
    fs.writeFileSync(hangLog, 'x'.repeat(400));
    watchdog.start({
      logsPath: logsDir,
      heartbeatIntervalMs: 50,
      hangThresholdMs: 300,
      checkIntervalMs: 25,
      hangLogMaxBytes: 256,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    blockMainThread(600);
    await waitFor(() => readLines(hangLog).length >= 1, 2_000);

    expect(fs.readFileSync(`${hangLog}.1`, 'utf8')).toBe('x'.repeat(400));
    expect(readLines(hangLog)[0].event).toBe('hang');
  });
});

describe('appendHangLogLine', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-hanglog-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rotates to .1 once the file is at the cap, replacing the previous .1', () => {
    const file = path.join(dir, 'logs', HANG_LOG_FILE_NAME);
    const line = `${'a'.repeat(99)}\n`;

    for (let i = 0; i < 3; i++)
      expect(appendHangLogLine(file, line, 250)).toBe(true);
    // 300 bytes >= 250: the next append rotates first.
    expect(fs.existsSync(`${file}.1`)).toBe(false);
    expect(appendHangLogLine(file, 'first-after-rotate\n', 250)).toBe(true);
    expect(fs.statSync(`${file}.1`).size).toBe(300);
    expect(fs.readFileSync(file, 'utf8')).toBe('first-after-rotate\n');

    fs.appendFileSync(file, 'b'.repeat(300));
    expect(appendHangLogLine(file, 'second-rotate\n', 250)).toBe(true);
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toMatch(
      /^first-after-rotate\n/,
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('second-rotate\n');
  });

  it('returns false instead of throwing when the directory cannot exist', () => {
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'file, not dir');
    expect(
      appendHangLogLine(path.join(blocker, HANG_LOG_FILE_NAME), 'x\n'),
    ).toBe(false);
  });

  it('agrees write-for-write with the worker twin HANG_LOG_APPEND_SOURCE', () => {
    // Eval THIS EXACT TEXT, the way the worker receives it.
    const twin = new Function(
      `${HANG_LOG_APPEND_SOURCE}; return appendHangLogLine;`,
    )() as (
      nodeFs: typeof fs,
      nodePath: typeof path,
      file: string,
      line: string,
      maxBytes: number,
    ) => boolean;

    const tsFile = path.join(dir, 'ts', HANG_LOG_FILE_NAME);
    const twinFile = path.join(dir, 'twin', HANG_LOG_FILE_NAME);
    const writes = Array.from(
      { length: 25 },
      (_, i) => `${'z'.repeat(i * 7)}\n`,
    );

    for (const line of writes) {
      expect(twin(fs, path, twinFile, line, 300)).toBe(
        appendHangLogLine(tsFile, line, 300),
      );
    }
    expect(fs.readFileSync(twinFile, 'utf8')).toBe(
      fs.readFileSync(tsFile, 'utf8'),
    );
    expect(fs.readFileSync(`${twinFile}.1`, 'utf8')).toBe(
      fs.readFileSync(`${tsFile}.1`, 'utf8'),
    );
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'file');
    expect(twin(fs, path, path.join(blocker, 'x.log'), 'x\n', 300)).toBe(
      appendHangLogLine(path.join(blocker, 'x.log'), 'x\n', 300),
    );
  });
});
