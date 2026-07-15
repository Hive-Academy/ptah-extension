/**
 * Voice worker entry — runs inside an Electron `utilityProcess` (its own OS
 * process, so a native ONNX `abort()` kills only the child; the main process
 * gets an `exit` event and respawns). Bundled separately by ptah-electron's
 * `build-voice-worker` esbuild target to `voice-worker.mjs`.
 *
 * Thin shell over {@link VoiceWorkerCore}: it wires the real pipelines +
 * ffmpeg decode and forwards messages to/from the parent port. All logic lives
 * in the core so it is unit-testable without a real process.
 *
 * Communicates via `process.parentPort` (Electron utilityProcess MessagePort).
 * No `electron` import — the global is provided by the runtime, keeping this
 * file importable by the (electron-free) backend lib bundle.
 */
import { VoiceWorkerCore } from './voice-worker-core';
import { WhisperPipeline } from './whisper-pipeline';
import { KokoroPipeline } from './kokoro-pipeline';
import { FfmpegDecode } from './ffmpeg-decode';
import type { VoiceWorkerInbound } from './voice-worker-protocol';

interface ParentPortLike {
  on(event: 'message', cb: (e: { data: unknown }) => void): void;
  postMessage(msg: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike })
  .parentPort;

if (!parentPort) {
  throw new Error(
    'voice-worker.ts must be run as an Electron utilityProcess (no parentPort)',
  );
}

const port = parentPort;

const core = new VoiceWorkerCore({
  post: (msg) => port.postMessage(msg),
  createWhisper: (modelCacheDir) => new WhisperPipeline({ modelCacheDir }),
  createKokoro: (modelCacheDir) => new KokoroPipeline({ modelCacheDir }),
  createFfmpeg: (ffmpegPath) => new FfmpegDecode({ ffmpegPath }),
});

port.on('message', (e) => {
  core.handleMessage(e.data as VoiceWorkerInbound);
});
