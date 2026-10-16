import { TtsPlaybackQueue, type PlaybackHandle } from './tts-playback-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('TtsPlaybackQueue', () => {
  const url = URL as typeof URL & {
    createObjectURL: jest.Mock;
    revokeObjectURL: jest.Mock;
  };
  let ends: Array<() => void>;
  let played: string[];
  let stopped: number;

  beforeEach(() => {
    ends = [];
    played = [];
    stopped = 0;
    url.createObjectURL = jest
      .fn()
      .mockImplementation(() => `clip-${ends.length}`);
    url.revokeObjectURL = jest.fn();
  });

  const factory = (src: string): PlaybackHandle => ({
    play: async () => {
      played.push(src);
    },
    stop: () => {
      stopped++;
    },
    onEnded: (callback) => {
      ends.push(callback);
    },
  });

  it('limits synthesis to two requests and plays in submission order', async () => {
    const requests = [deferred<Blob>(), deferred<Blob>(), deferred<Blob>()];
    const synth = jest
      .fn()
      .mockImplementation(
        (_text: string) => requests[synth.mock.calls.length - 1].promise,
      );
    const queue = new TtsPlaybackQueue(synth, factory);
    queue.enqueue('first');
    queue.enqueue('second');
    queue.enqueue('third');
    expect(synth).toHaveBeenCalledTimes(2);
    requests[1].resolve(new Blob(['two']));
    await Promise.resolve();
    expect(played).toEqual([]);
    requests[0].resolve(new Blob(['one']));
    await Promise.resolve();
    expect(synth).toHaveBeenCalledTimes(3);
    expect(played).toEqual(['clip-0']);
    ends[0]();
    expect(played).toEqual(['clip-0', 'clip-1']);
    expect(url.revokeObjectURL).toHaveBeenCalledWith('clip-0');
    requests[2].resolve(new Blob(['three']));
    await Promise.resolve();
    ends[1]();
    expect(played).toEqual(['clip-0', 'clip-1', 'clip-2']);
  });

  it('reports playback start and only reports end after the final queued clip', async () => {
    const first = deferred<Blob>();
    const second = deferred<Blob>();
    const changes: boolean[] = [];
    const queue = new TtsPlaybackQueue(
      jest
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
      factory,
      () => undefined,
      (playing) => changes.push(playing),
    );
    queue.enqueue('first');
    queue.enqueue('second');
    expect(queue.hasPending).toBe(true);
    expect(changes).toEqual([]);
    first.resolve(new Blob(['first']));
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toEqual([true]);
    ends[0]();
    expect(queue.hasPending).toBe(true);
    expect(changes).toEqual([true]);
    second.resolve(new Blob(['second']));
    await Promise.resolve();
    await Promise.resolve();
    expect(changes).toEqual([true]);
    ends[1]();
    expect(queue.hasPending).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it.each(['bargeIn', 'stopAll', 'mute', 'navigate'] as const)(
    '%s revokes the current generation',
    async (method) => {
      const late = deferred<Blob>();
      const synth = jest
        .fn()
        .mockResolvedValueOnce(new Blob(['one']))
        .mockImplementationOnce(() => late.promise);
      const queue = new TtsPlaybackQueue(synth, factory);
      queue.enqueue('first');
      queue.enqueue('second');
      await Promise.resolve();
      queue[method]();
      late.resolve(new Blob(['late']));
      await Promise.resolve();
      expect(stopped).toBe(1);
      expect(played).toEqual(['clip-0']);
      expect(url.revokeObjectURL).toHaveBeenCalledWith('clip-0');
    },
  );

  it('reports playback failure while leaving source text with the caller', async () => {
    const failure = jest.fn();
    const queue = new TtsPlaybackQueue(
      async () => new Blob(['audio']),
      () => ({
        play: () => Promise.reject(new Error('blocked')),
        stop: jest.fn(),
        onEnded: jest.fn(),
      }),
      failure,
    );
    queue.enqueue('Full response remains visible');
    await Promise.resolve();
    await Promise.resolve();
    expect(failure).toHaveBeenCalledWith(
      'Full response remains visible',
      expect.any(Error),
    );
    expect(url.revokeObjectURL).toHaveBeenCalled();
  });

  it('does not report a pending play rejection after stopAll', async () => {
    const pending = deferred<void>();
    const failure = jest.fn();
    const queue = new TtsPlaybackQueue(
      async () => new Blob(['audio']),
      () => ({
        play: () => pending.promise,
        stop: jest.fn(),
        onEnded: jest.fn(),
      }),
      failure,
    );
    queue.enqueue('interrupted');
    await Promise.resolve();
    queue.stopAll();
    pending.reject(new DOMException('Interrupted', 'AbortError'));
    await Promise.resolve();
    expect(failure).not.toHaveBeenCalled();
  });

  it('reports an audio error and play rejection only once', async () => {
    const pending = deferred<void>();
    const failure = jest.fn();
    let emitError: (error: unknown) => void = () => undefined;
    const queue = new TtsPlaybackQueue(
      async () => new Blob(['audio']),
      () => ({
        play: () => pending.promise,
        stop: jest.fn(),
        onEnded: (_ended, onError) => {
          emitError = onError;
        },
      }),
      failure,
    );
    queue.enqueue('one clip');
    await Promise.resolve();
    emitError(new Error('audio event'));
    pending.reject(new Error('play rejected'));
    await Promise.resolve();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith('one clip', expect.any(Error));
  });

  it('reports a current play rejection and advances to the next clip', async () => {
    const firstPlay = deferred<void>();
    const failure = jest.fn();
    let calls = 0;
    const queue = new TtsPlaybackQueue(
      async (text) => new Blob([text]),
      () => ({
        play: () => {
          calls++;
          return calls === 1 ? firstPlay.promise : Promise.resolve();
        },
        stop: jest.fn(),
        onEnded: jest.fn(),
      }),
      failure,
    );
    queue.enqueue('first');
    queue.enqueue('second');
    await Promise.resolve();
    firstPlay.reject(new Error('blocked'));
    await Promise.resolve();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith('first', expect.any(Error));
    expect(calls).toBe(2);
  });
});
