/**
 * Unit tests for VoiceWorkerClient — the main-side proxy over the voice
 * utilityProcess. Uses a fake `IVoiceWorkerProcess` (message loopback) so
 * these tests never spawn a real Electron utilityProcess.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { VoiceModelSpec } from '@ptah-extension/voice-contracts';
import { VoiceWorkerClient } from './voice-worker-client';
import type {
  IVoiceWorkerProcess,
  IVoiceWorkerProcessFactory,
} from './worker-process.port';

const SPEC: VoiceModelSpec = { kind: 'curated', name: 'base.en' };

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** Minimal fake `IVoiceWorkerProcess` — message loopback, no real process. */
class FakeVoiceWorkerProcess implements IVoiceWorkerProcess {
  readonly sent: Array<{ id: number; type: string; [k: string]: unknown }> = [];
  killed = false;
  private readonly messageListeners: Array<(msg: unknown) => void> = [];
  private readonly exitListeners: Array<(code: number | null) => void> = [];

  postMessage(msg: unknown): void {
    this.sent.push(msg as { id: number; type: string });
  }

  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overload implementation signature must accept both narrower callback shapes
  on(event: 'message' | 'exit', cb: (arg: any) => void): void {
    if (event === 'message') {
      this.messageListeners.push(cb as (msg: unknown) => void);
    } else {
      this.exitListeners.push(cb as (code: number | null) => void);
    }
  }

  kill(): void {
    this.killed = true;
  }

  /** Reply to the most recent request with an id-echoed response. */
  emitMessage(msg: unknown): void {
    for (const listener of this.messageListeners) listener(msg);
  }

  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }

  lastSent(): { id: number; type: string; [k: string]: unknown } {
    const last = this.sent[this.sent.length - 1];
    if (!last) throw new Error('no message sent yet');
    return last;
  }
}

function buildFactory(): {
  factory: IVoiceWorkerProcessFactory;
  workers: FakeVoiceWorkerProcess[];
} {
  const workers: FakeVoiceWorkerProcess[] = [];
  const factory: IVoiceWorkerProcessFactory = {
    spawn: jest.fn(() => {
      const worker = new FakeVoiceWorkerProcess();
      workers.push(worker);
      return worker;
    }),
  };
  return { factory, workers };
}

function buildClient(
  opts: {
    factory?: IVoiceWorkerProcessFactory | null;
    idleMs?: number;
  } = {},
): {
  client: VoiceWorkerClient;
  workers: FakeVoiceWorkerProcess[];
  factory: IVoiceWorkerProcessFactory | null;
  logger: Logger;
} {
  const logger = makeLogger();
  if (opts.factory === null) {
    return {
      client: new VoiceWorkerClient(logger, null, opts.idleMs),
      workers: [],
      factory: null,
      logger,
    };
  }
  const { factory, workers } = buildFactory();
  const client = new VoiceWorkerClient(logger, factory, opts.idleMs);
  return { client, workers, factory, logger };
}

describe('VoiceWorkerClient', () => {
  describe('available', () => {
    it('is false when no worker factory is registered (VS Code/CLI degrade)', () => {
      const { client } = buildClient({ factory: null });
      expect(client.available).toBe(false);
    });

    it('is true when a worker factory is registered', () => {
      const { client } = buildClient();
      expect(client.available).toBe(true);
    });
  });

  describe('request/response round trip', () => {
    it('sends stt:transcribe and resolves with the worker text response', async () => {
      const { client, workers } = buildClient();
      const promise = client.transcribe('/tmp/audio.webm', SPEC);

      const worker = workers[0];
      const sent = worker.lastSent();
      expect(sent.type).toBe('stt:transcribe');
      expect(sent.audioPath).toBe('/tmp/audio.webm');
      expect(sent.model).toEqual(SPEC);

      worker.emitMessage({ id: sent.id, ok: true, text: 'hello world' });
      await expect(promise).resolves.toBe('hello world');
    });

    it('sends tts:synthesize and resolves with wav bytes + sampleRate', async () => {
      const { client, workers } = buildClient();
      const promise = client.synthesize('hi', 'af_heart', SPEC, 'q8');

      const worker = workers[0];
      const sent = worker.lastSent();
      expect(sent.type).toBe('tts:synthesize');
      expect(sent.text).toBe('hi');
      expect(sent.voice).toBe('af_heart');
      expect(sent.dtype).toBe('q8');

      worker.emitMessage({
        id: sent.id,
        ok: true,
        wav: new Uint8Array([1, 2, 3]),
        sampleRate: 24000,
      });
      await expect(promise).resolves.toEqual({
        wav: new Uint8Array([1, 2, 3]),
        sampleRate: 24000,
      });
    });

    it('sends stt:download / tts:download and resolves alreadyPresent', async () => {
      const { client, workers } = buildClient();
      const p1 = client.downloadStt(SPEC);
      const w = workers[0];
      w.emitMessage({ id: w.lastSent().id, ok: true, alreadyPresent: true });
      await expect(p1).resolves.toEqual({ alreadyPresent: true });

      const p2 = client.downloadTts(SPEC, 'q8');
      w.emitMessage({ id: w.lastSent().id, ok: true, alreadyPresent: false });
      await expect(p2).resolves.toEqual({ alreadyPresent: false });
    });

    it('rejects with a VoiceProviderError carrying the worker category on an ok:false reply', async () => {
      const { client, workers } = buildClient();
      const promise = client.transcribe('/tmp/a.webm', SPEC);
      const worker = workers[0];
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: false,
        error: 'model load failed',
        category: 'model-invalid',
      });

      await expect(promise).rejects.toMatchObject({
        category: 'model-invalid',
        providerId: 'local',
        message: 'model load failed',
      });
    });
  });

  describe('download progress fan-out', () => {
    it('re-emits download-progress worker messages through onDownload', async () => {
      const { client, workers } = buildClient();
      const events: unknown[] = [];
      client.onDownload((e) => events.push(e));

      const promise = client.downloadStt(SPEC);
      const worker = workers[0];
      worker.emitMessage({
        type: 'download-progress',
        direction: 'stt',
        model: 'base.en',
        kind: 'download:progress',
        percent: 42,
      });
      expect(events).toEqual([
        {
          kind: 'download:progress',
          direction: 'stt',
          model: 'base.en',
          percent: 42,
        },
      ]);

      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        alreadyPresent: false,
      });
      await promise;
    });

    it('stops delivering events to a disposed listener', async () => {
      const { client, workers } = buildClient();
      const events: unknown[] = [];
      const sub = client.onDownload((e) => events.push(e));
      sub.dispose();

      const promise = client.downloadStt(SPEC);
      const worker = workers[0];
      worker.emitMessage({
        type: 'download-progress',
        direction: 'stt',
        model: 'base.en',
        kind: 'download:start',
      });
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        alreadyPresent: false,
      });
      await promise;

      expect(events).toEqual([]);
    });
  });

  describe('respawn after exit (FR-2.2)', () => {
    it('rejects in-flight requests with process-crashed on exit and respawns fresh on the next request', async () => {
      const { client, workers } = buildClient();
      const promise = client.transcribe('/tmp/a.webm', SPEC);
      const worker1 = workers[0];

      worker1.emitExit(1);
      await expect(promise).rejects.toMatchObject({
        category: 'process-crashed',
        providerId: 'local',
      });

      const promise2 = client.transcribe('/tmp/b.webm', SPEC);
      expect(workers).toHaveLength(2);
      const worker2 = workers[1];
      worker2.emitMessage({ id: worker2.lastSent().id, ok: true, text: 'ok' });
      await expect(promise2).resolves.toBe('ok');
    });

    it('does not set a permanent failed flag — a clean exit (code 0) also respawns on next request', async () => {
      const { client, workers } = buildClient();
      const promise = client.transcribe('/tmp/a.webm', SPEC);
      workers[0].emitExit(0);
      await expect(promise).rejects.toMatchObject({
        category: 'process-crashed',
      });

      client.transcribe('/tmp/b.webm', SPEC);
      expect(workers).toHaveLength(2);
    });
  });

  describe('idle teardown (FR-2.2 + R7)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('tears down the worker after the idle timeout once in-flight requests settle', async () => {
      jest.useFakeTimers();
      const { client, workers } = buildClient({ idleMs: 1000 });
      const promise = client.transcribe('/tmp/a.webm', SPEC);
      const worker = workers[0];
      worker.emitMessage({ id: worker.lastSent().id, ok: true, text: 'hi' });
      await promise;

      expect(worker.killed).toBe(false);
      jest.advanceTimersByTime(1000);
      expect(worker.killed).toBe(true);
      expect(worker.sent.some((m) => m.type === 'dispose')).toBe(true);
    });

    it('cancels the idle timer when a new request arrives before it fires, reusing the warm worker', async () => {
      jest.useFakeTimers();
      const { client, workers } = buildClient({ idleMs: 1000 });

      const p1 = client.transcribe('/tmp/a.webm', SPEC);
      const worker = workers[0];
      worker.emitMessage({ id: worker.lastSent().id, ok: true, text: 'x' });
      await p1;

      jest.advanceTimersByTime(500);

      const p2 = client.transcribe('/tmp/b.webm', SPEC);
      expect(workers).toHaveLength(1); // reused the warm worker, no respawn
      worker.emitMessage({ id: worker.lastSent().id, ok: true, text: 'y' });
      await p2;

      // Timer was cancelled at the second request and re-armed only after it
      // settled — 500ms more should not be enough to fire it.
      jest.advanceTimersByTime(500);
      expect(worker.killed).toBe(false);

      jest.advanceTimersByTime(500);
      expect(worker.killed).toBe(true);
    });
  });

  describe('crash-loop backoff', () => {
    it('refuses to spawn for a backoff window after 3 exits within the crash-loop window', async () => {
      const { client, workers } = buildClient();

      for (let i = 0; i < 3; i++) {
        const p = client
          .transcribe(`/tmp/${i}.webm`, SPEC)
          .catch((e: unknown) => e);
        workers[workers.length - 1].emitExit(1);
        await p;
      }
      expect(workers).toHaveLength(3);

      await expect(
        client.transcribe('/tmp/refused.webm', SPEC),
      ).rejects.toMatchObject({
        category: 'process-crashed',
        providerId: 'local',
      });
      // No new worker was spawned for the refused request.
      expect(workers).toHaveLength(3);
    });
  });

  describe('dispose', () => {
    it('rejects pending requests, kills the worker, and is idempotent', async () => {
      const { client, workers } = buildClient();
      const promise = client
        .transcribe('/tmp/a.webm', SPEC)
        .catch((e: unknown) => e);
      const worker = workers[0];

      client.dispose();

      const err = await promise;
      expect(err).toMatchObject({ category: 'process-crashed' });
      expect(worker.killed).toBe(true);
      expect(() => client.dispose()).not.toThrow();
    });
  });

  describe('unavailable runtime (no worker factory)', () => {
    it('throws assets-unavailable instead of attempting to spawn', async () => {
      const { client } = buildClient({ factory: null });
      await expect(
        client.transcribe('/tmp/a.webm', SPEC),
      ).rejects.toMatchObject({
        category: 'assets-unavailable',
        providerId: 'local',
      });
    });
  });
});
