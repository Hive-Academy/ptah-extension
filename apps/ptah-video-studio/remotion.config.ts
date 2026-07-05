/**
 * Remotion configuration for the Ptah video studio.
 *
 * Only affects `remotion studio` / `remotion render` invocations from this app
 * dir. Output is H.264 yuv420p (web-faststart implied by the mp4 muxer) so the
 * rendered promo clips are upload-ready — matching the contract `transcode.mjs`
 * already produced (see FR-8 / AC-5).
 */
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');
// Leave concurrency to Remotion's default (null = auto by core count). Tunable
// per-machine via the CLI `--concurrency` flag in render-all.mjs.
Config.setConcurrency(null);
// OffthreadVideo seeks the source webm via ffmpeg; keep the cache generous so
// long scenes do not thrash on re-seeks during render.
Config.setOffthreadVideoCacheSizeInBytes(2 * 1024 * 1024 * 1024);
