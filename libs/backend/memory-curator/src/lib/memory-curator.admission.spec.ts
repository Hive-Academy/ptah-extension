/**
 * `MemoryCuratorService` admission — TASK_2026_437 FU-16b-a and C14 (f).
 *
 * ## FU-16b-a — `memory:runNow` behind a governed background pass
 *
 * The fake LLM below reproduces the internal-query gate's one relevant rule:
 * a call on the BACKGROUND lane (`userInitiated` not set) waits for the
 * governor before it answers; a user-initiated call does not. With the old
 * order — enter `CuratorJobQueue`, then meet the governor inside the first
 * call — a background pass held by a generating turn sat at the head of the
 * queue and the user's pass waited behind it. These specs fail against that
 * order: the manual pass never resolves while the turn is generating.
 *
 * ## C14 (f) — network back-off
 *
 * A `provider-unreachable` stall opens the back-off; later BACKGROUND passes
 * defer at dispatch with their input untouched (`stalled`), a user-initiated
 * pass is never deferred, and the first answered pass clears it.
 */
import 'reflect-metadata';
import {
  BackgroundWorkGovernor,
  type Logger,
} from '@ptah-extension/vscode-core';
import type {
  CuratorCallOptions,
  ICompactionCallbackRegistry,
  ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import { MemoryCuratorService } from './memory-curator.service';
import type { MemoryStore } from './memory.store';
import type { SalienceScorer } from './salience-scorer';
import type {
  CuratorExtraction,
  ICuratorLLM,
} from './curator-llm/curator-llm.interface';

const TRANSCRIPT = '{"type":"user","content":"remember the lanes"}';

type Info = jest.Mock & ((message: string, meta?: unknown) => void);

function makeLogger(): Logger & { info: Info; warn: jest.Mock } {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger & { info: Info; warn: jest.Mock };
}

/** A generating chat turn, as the real governor computes it. */
function generatingTurn(logger: Logger) {
  const governor = new BackgroundWorkGovernor(logger);
  let busy = true;
  let notify: () => void = () => undefined;
  governor.addForegroundSource({
    isForegroundBusy: () => busy,
    onForegroundChange: (listener) => {
      notify = listener;
      return () => undefined;
    },
  });
  return {
    governor,
    endTurn: () => {
      busy = false;
      notify();
    },
  };
}

function build(opts: {
  logger: Logger;
  extract: jest.Mock;
  governor?: BackgroundWorkGovernor | null;
}): MemoryCuratorService {
  return new MemoryCuratorService(
    opts.logger,
    {
      register: jest.fn(() => () => undefined),
    } as unknown as ICompactionCallbackRegistry,
    {
      list: jest.fn(() => ({ memories: [], total: 0 })),
      insertMemoryWithChunks: jest.fn().mockResolvedValue(undefined),
      appendChunks: jest.fn().mockResolvedValue(undefined),
      getById: jest.fn(),
      updateSalience: jest.fn(),
    } as unknown as MemoryStore,
    { score: jest.fn(() => 0.5) } as unknown as SalienceScorer,
    { read: jest.fn() } as unknown as ITranscriptReader,
    {
      extract: opts.extract,
      resolve: jest.fn().mockResolvedValue([]),
    } as unknown as ICuratorLLM,
    null,
    null,
    null,
    undefined,
    opts.governor ?? null,
  );
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const EXTRACTED: CuratorExtraction = { status: 'extracted', drafts: [] };
const UNREACHABLE: CuratorExtraction = {
  status: 'stalled',
  reason: 'provider-unreachable',
  providerId: 'openai-codex',
};

describe('MemoryCuratorService — a background pass waits for the governor BEFORE the job queue (FU-16b-a)', () => {
  function harness() {
    const logger = makeLogger();
    const turn = generatingTurn(logger);
    // The gate's rule: background-lane calls wait for clearance.
    const extract = jest.fn(
      async (
        _transcript: string,
        _signal: AbortSignal | undefined,
        options: CuratorCallOptions,
      ): Promise<CuratorExtraction> => {
        if (options.userInitiated !== true) await turn.governor.whenClear();
        return EXTRACTED;
      },
    );
    const svc = build({ logger, extract, governor: turn.governor });
    return { svc, extract, logger, ...turn };
  }

  it('runNow during a chat turn completes while a background pass for another session is pending', async () => {
    const { svc, extract, governor, endTurn } = harness();

    const background = svc.curate({
      sessionId: 'background-1',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    let backgroundSettled = false;
    void background.then(() => (backgroundSettled = true));

    const manual = await svc.curate({
      sessionId: 'manual-1',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
      userInitiated: true,
    });

    expect(manual.outcome).toBe('ran');
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0][2]).toEqual({ userInitiated: true });
    await flush();
    expect(backgroundSettled).toBe(false);

    endTurn();
    await expect(background).resolves.toMatchObject({ outcome: 'ran' });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract.mock.calls[1][2]).toEqual({ userInitiated: undefined });
    governor.dispose();
  });

  it('background passes still wait: nothing is dispatched until the turn ends', async () => {
    const { svc, extract, governor, endTurn } = harness();

    const first = svc.curate({
      sessionId: 'a',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    const second = svc.curate({
      sessionId: 'b',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    await flush();
    expect(extract).not.toHaveBeenCalled();

    endTurn();
    await Promise.all([first, second]);
    expect(extract).toHaveBeenCalledTimes(2);
    governor.dispose();
  });

  it('promotes a same-session background pass still waiting for clearance', async () => {
    const { svc, extract, logger, governor } = harness();
    const input = {
      sessionId: 'shared-1',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    };

    const background = svc.curate(input);
    const manual = svc.curate({ ...input, userInitiated: true });

    await expect(manual).resolves.toMatchObject({ outcome: 'ran' });
    await expect(background).resolves.toMatchObject({ outcome: 'ran' });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0][2]).toEqual({ userInitiated: true });
    expect(logger.info).toHaveBeenCalledWith(
      '[memory-curator] user-initiated curate promoted a pass waiting for background-work clearance; it runs on the user-action lane',
      { sessionId: 'shared-1' },
    );
    governor.dispose();
  });

  it('defers a pass still waiting at host shutdown without dispatching it', async () => {
    const { svc, extract, governor } = harness();

    const pass = svc.curate({
      sessionId: 's',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    governor.dispose();

    await expect(pass).resolves.toMatchObject({ outcome: 'stalled' });
    expect(extract).not.toHaveBeenCalled();
    expect(svc.recentEvents(1)[0]).toMatchObject({
      kind: 'rate-limited',
      stats: { reason: 'host-shutdown', source: 'background-work-governor' },
    });
  });
});

describe('MemoryCuratorService — network back-off (C14 f)', () => {
  let now = 1_800_000_000_000;
  beforeEach(() => {
    now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const backoffLines = (logger: { info: jest.Mock }) =>
    logger.info.mock.calls.filter((call) =>
      String(call[0]).includes('backs off'),
    );

  it('defers background passes while the window is open, keeps their input, and logs once per level', async () => {
    const logger = makeLogger();
    const extract = jest.fn().mockResolvedValue(UNREACHABLE);
    const svc = build({ logger, extract });

    const first = await svc.curate({
      sessionId: 'a',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    const second = await svc.curate({
      sessionId: 'b',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    now += 10_000;
    const third = await svc.curate({
      sessionId: 'c',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });

    expect([first.outcome, second.outcome, third.outcome]).toEqual([
      'stalled',
      'stalled',
      'stalled',
    ]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(svc.recentEvents(1)[0]).toMatchObject({
      kind: 'rate-limited',
      sessionId: 'c',
      stats: { reason: 'network-backoff', source: 'network-backoff' },
    });
    expect(backoffLines(logger)).toHaveLength(1);
    expect(
      logger.warn.mock.calls.filter((call) =>
        String(call[0]).includes('never dispatched'),
      ),
    ).toEqual([]);
  });

  it('dispatches the next background pass once the window has passed, and raises the level on a second failure', async () => {
    const logger = makeLogger();
    const extract = jest.fn().mockResolvedValue(UNREACHABLE);
    const svc = build({ logger, extract });

    await svc.curate({
      sessionId: 'a',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    now += 30_000;
    await svc.curate({
      sessionId: 'b',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });

    expect(extract).toHaveBeenCalledTimes(2);
    expect(backoffLines(logger).map((call) => call[1])).toEqual([
      { level: 1, windowMs: 30_000 },
      { level: 2, windowMs: 60_000 },
    ]);
  });

  it('never defers a user-initiated pass, and its answer clears the back-off for background work', async () => {
    const logger = makeLogger();
    const extract = jest
      .fn()
      .mockResolvedValueOnce(UNREACHABLE)
      .mockResolvedValue(EXTRACTED);
    const svc = build({ logger, extract });

    await svc.curate({
      sessionId: 'a',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });
    const manual = await svc.curate({
      sessionId: 'b',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
      userInitiated: true,
    });
    const background = await svc.curate({
      sessionId: 'c',
      workspaceRoot: '/ws',
      transcript: TRANSCRIPT,
    });

    expect(manual.outcome).toBe('ran');
    expect(background.outcome).toBe('ran');
    expect(extract).toHaveBeenCalledTimes(3);
    expect(logger.info).toHaveBeenCalledWith(
      '[memory-curator] provider reachable again; network back-off cleared',
      { previousLevel: 1 },
    );
  });
});
