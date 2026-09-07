/**
 * ElectronVoiceWorkerFactory — host implementation of `IVoiceWorkerProcessFactory`.
 * Spawns the bundled `voice-worker.mjs` in an Electron `utilityProcess` (its own
 * OS process, so a native ONNX abort kills only the child) and sends the `init`
 * config (ffmpeg path + model cache dir) immediately, before any request.
 */
import type {
  IVoiceWorkerProcess,
  IVoiceWorkerProcessFactory,
  VoiceWorkerInitMessage,
} from '@ptah-extension/voice-providers';
import { ElectronUtilityWorkerProcess } from './electron-utility-worker-process';

export class ElectronVoiceWorkerFactory implements IVoiceWorkerProcessFactory {
  constructor(
    private readonly workerPath: string,
    private readonly ffmpegPath: string | null,
    private readonly modelCacheDir: string | null,
  ) {}

  spawn(): IVoiceWorkerProcess {
    const child = ElectronUtilityWorkerProcess.fork(
      this.workerPath,
      'ptah-voice-worker',
    );
    const init: VoiceWorkerInitMessage = {
      type: 'init',
      ffmpegPath: this.ffmpegPath,
      modelCacheDir: this.modelCacheDir,
    };
    // Queued by Electron until the child's parent port is ready; delivered
    // before the first request the client posts synchronously after spawn().
    child.postMessage(init);
    return child;
  }
}
