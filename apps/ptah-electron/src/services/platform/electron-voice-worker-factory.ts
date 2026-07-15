/**
 * ElectronVoiceWorkerFactory — host implementation of `IVoiceWorkerProcessFactory`.
 * Spawns the bundled `voice-worker.mjs` in an Electron `utilityProcess` (its own
 * OS process, so a native ONNX abort kills only the child) and sends the `init`
 * config (ffmpeg path + model cache dir) immediately, before any request.
 */
import electron, { type UtilityProcess } from 'electron';

const { utilityProcess } = electron;
import type {
  IVoiceWorkerProcess,
  IVoiceWorkerProcessFactory,
  VoiceWorkerInitMessage,
} from '@ptah-extension/voice-providers';

class ElectronVoiceWorkerProcess implements IVoiceWorkerProcess {
  constructor(private readonly child: UtilityProcess) {}

  postMessage(msg: unknown): void {
    this.child.postMessage(msg);
  }

  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    cb: ((msg: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') {
      this.child.on('message', cb as (msg: unknown) => void);
    } else {
      this.child.on('exit', (code: number) =>
        (cb as (code: number | null) => void)(code),
      );
    }
  }

  kill(): void {
    this.child.kill();
  }
}

export class ElectronVoiceWorkerFactory implements IVoiceWorkerProcessFactory {
  constructor(
    private readonly workerPath: string,
    private readonly ffmpegPath: string | null,
    private readonly modelCacheDir: string | null,
  ) {}

  spawn(): IVoiceWorkerProcess {
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: 'ptah-voice-worker',
    });
    const init: VoiceWorkerInitMessage = {
      type: 'init',
      ffmpegPath: this.ffmpegPath,
      modelCacheDir: this.modelCacheDir,
    };
    // Queued by Electron until the child's parent port is ready; delivered
    // before the first request the client posts synchronously after spawn().
    child.postMessage(init);
    return new ElectronVoiceWorkerProcess(child);
  }
}
