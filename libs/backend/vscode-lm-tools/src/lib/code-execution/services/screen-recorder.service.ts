/**
 * Screen Recorder Service
 * TASK_2025_254: CDP screencast frame capture and GIF assembly
 *
 * Manages an in-memory ring buffer of JPEG frames captured via
 * CDP Page.startScreencast, and assembles them into an animated GIF
 * using gifenc + jpeg-js.
 *
 * This is NOT a DI service -- it is instantiated directly by each
 * IBrowserCapabilities implementation to avoid cross-library dependencies.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================
// Lazy-loaded dependency types (gifenc has no TS declarations)
// ============================================================

/** jpeg-js decode result */
interface JpegDecodeResult {
  width: number;
  height: number;
  data: Uint8Array;
}

/** jpeg-js module shape */
interface JpegModule {
  decode(
    data: Buffer | Uint8Array | ArrayBuffer,
    opts?: {
      useTArray?: boolean;
      formatAsRGBA?: boolean;
      maxResolutionInMP?: number;
    },
  ): JpegDecodeResult;
}

/** gifenc palette -- array of [R, G, B] triples */
type GifPalette = Array<[number, number, number]>;

/** gifenc encoder instance returned by the GIFEncoder() factory */
interface GifEncoderInstance {
  writeFrame(
    index: Uint8Array,
    width: number,
    height: number,
    opts?: {
      palette?: GifPalette;
      delay?: number;
      transparent?: boolean;
      transparentIndex?: number;
      repeat?: number;
      dispose?: number;
    },
  ): void;
  finish(): void;
  bytes(): Uint8Array;
}

/** gifenc module shape */
interface GifencModule {
  GIFEncoder(opts?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GifEncoderInstance;
  quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: string },
  ): GifPalette;
  applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: string,
  ): Uint8Array;
}

// Lazy-loaded module singletons
let jpegModule: JpegModule | undefined;
let gifencModule: GifencModule | undefined;

async function loadJpeg(): Promise<JpegModule> {
  if (!jpegModule) {
    jpegModule = (await import('jpeg-js')) as unknown as JpegModule;
  }
  return jpegModule;
}

async function loadGifenc(): Promise<GifencModule> {
  if (!gifencModule) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- gifenc has no bundled types; d.ts exists locally but not visible to all consuming tsconfigs
    gifencModule = (await import('gifenc')) as unknown as GifencModule;
  }
  return gifencModule;
}

// ============================================================
// Recording state
// ============================================================

interface RecordingFrame {
  /** Base64-encoded JPEG data (no data URI prefix) */
  data: string;
  /** Timestamp when frame was captured (Date.now()) */
  timestamp: number;
}

interface RecordingState {
  frames: RecordingFrame[];
  maxFrames: number;
  frameDelay: number;
  startedAt: number;
  truncated: boolean;
}

// ============================================================
// Public result types (mirrors BrowserRecordStopResult shape)
// ============================================================

export interface RecordingStartResult {
  success: boolean;
  error?: string;
}

export interface RecordingStopResult {
  filePath: string;
  frameCount: number;
  durationMs: number;
  fileSizeBytes: number;
  truncated: boolean;
  error?: string;
}

// ============================================================
// ScreenRecorderService
// ============================================================

const DEFAULT_MAX_FRAMES = 500;
const DEFAULT_FRAME_DELAY = 200;
const GIF_QUANTIZE_MAX_COLORS = 256;

export class ScreenRecorderService {
  private state: RecordingState | null = null;

  /**
   * Returns true if a recording is currently in progress.
   */
  isRecording(): boolean {
    return this.state !== null;
  }

  /**
   * Initializes the frame buffer and starts recording.
   *
   * @param options - Optional configuration
   * @param options.maxFrames - Maximum frames to keep in ring buffer (default 500)
   * @param options.frameDelay - Delay between frames in the output GIF in milliseconds (default 200)
   * @returns Start result indicating success or error
   */
  startRecording(options?: {
    maxFrames?: number;
    frameDelay?: number;
  }): RecordingStartResult {
    if (this.state !== null) {
      return {
        success: false,
        error:
          'Recording already in progress. Stop the current recording first.',
      };
    }

    this.state = {
      frames: [],
      maxFrames: options?.maxFrames ?? DEFAULT_MAX_FRAMES,
      frameDelay: options?.frameDelay ?? DEFAULT_FRAME_DELAY,
      startedAt: Date.now(),
      truncated: false,
    };

    return { success: true };
  }

  /**
   * Adds a captured frame to the ring buffer.
   * When the buffer exceeds maxFrames, the oldest frame is discarded
   * and the recording is marked as truncated.
   *
   * @param base64JpegData - Base64-encoded JPEG image data (no data URI prefix)
   */
  addFrame(base64JpegData: string): void {
    if (!this.state) {
      return; // Silently ignore frames when not recording
    }

    this.state.frames.push({
      data: base64JpegData,
      timestamp: Date.now(),
    });

    // Ring buffer: discard oldest frame if we exceed the limit
    if (this.state.frames.length > this.state.maxFrames) {
      this.state.frames.shift();
      this.state.truncated = true;
    }
  }

  /**
   * Stops the recording, assembles all captured frames into an animated GIF,
   * and writes the file to disk.
   *
   * @param outputDir - Directory to write the GIF file. Falls back to os.tmpdir()
   *                     if empty, undefined, or the directory cannot be created.
   * @returns Stop result with file path, stats, and truncation info
   */
  async stopRecording(outputDir?: string): Promise<RecordingStopResult> {
    if (!this.state) {
      return {
        filePath: '',
        frameCount: 0,
        durationMs: 0,
        fileSizeBytes: 0,
        truncated: false,
        error: 'No recording in progress.',
      };
    }

    // Capture state and clear it immediately so isRecording() returns false
    const recordingState = this.state;
    this.state = null;

    const durationMs = Date.now() - recordingState.startedAt;
    const frameCount = recordingState.frames.length;

    if (frameCount === 0) {
      return {
        filePath: '',
        frameCount: 0,
        durationMs,
        fileSizeBytes: 0,
        truncated: recordingState.truncated,
        error: 'No frames were captured during recording.',
      };
    }

    try {
      // Load dependencies lazily
      const jpeg = await loadJpeg();
      const gifenc = await loadGifenc();

      // Create the GIF encoder
      const gif = gifenc.GIFEncoder();

      // Process each frame: decode JPEG -> quantize -> apply palette -> write frame
      // Per-frame try/catch: skip corrupt frames rather than losing the entire recording
      let skippedFrames = 0;
      for (const frame of recordingState.frames) {
        try {
          const jpegBytes = Buffer.from(frame.data, 'base64');
          const decoded = jpeg.decode(jpegBytes, {
            useTArray: true,
            formatAsRGBA: true,
            maxResolutionInMP: 100, // Allow up to 100MP to handle 1280x720 safely
          });

          const rgba = decoded.data;
          const { width, height } = decoded;

          // Quantize RGBA to a 256-color palette for this frame
          const palette = gifenc.quantize(rgba, GIF_QUANTIZE_MAX_COLORS);

          // Map each pixel to the nearest palette index
          const indexedPixels = gifenc.applyPalette(rgba, palette);

          // Write frame with per-frame palette and configured delay
          gif.writeFrame(indexedPixels, width, height, {
            palette,
            delay: recordingState.frameDelay,
          });
        } catch {
          // Skip corrupt frame — one bad JPEG should not kill the entire recording
          skippedFrames++;
        }
        // Release base64 data after processing to reduce memory pressure
        frame.data = '';
      }

      // If all frames were corrupt, fail gracefully
      const validFrameCount = frameCount - skippedFrames;
      if (validFrameCount === 0) {
        return {
          filePath: '',
          frameCount,
          durationMs,
          fileSizeBytes: 0,
          truncated: recordingState.truncated,
          error: `All ${frameCount} frames were corrupt and could not be decoded.`,
        };
      }

      // Finalize the GIF stream
      gif.finish();
      const gifBytes = gif.bytes();

      // Determine output directory
      const resolvedDir = this.resolveOutputDir(outputDir);

      // Generate filename with ISO timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `ptah-recording-${timestamp}.gif`;
      const filePath = path.join(resolvedDir, filename);

      // Write the GIF file
      fs.writeFileSync(filePath, gifBytes);

      // Set restrictive file permissions on non-Windows platforms
      if (process.platform !== 'win32') {
        fs.chmodSync(filePath, 0o600);
      }

      const fileSizeBytes = fs.statSync(filePath).size;

      return {
        filePath,
        frameCount,
        durationMs,
        fileSizeBytes,
        truncated: recordingState.truncated,
      };
    } catch (error) {
      return {
        filePath: '',
        frameCount,
        durationMs,
        fileSizeBytes: 0,
        truncated: recordingState.truncated,
        error: `GIF assembly failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Resolves and validates the output directory.
   * Creates the directory if it does not exist.
   * Falls back to os.tmpdir() if creation fails or path is empty.
   */
  private resolveOutputDir(outputDir?: string): string {
    const tmpDir = os.tmpdir();

    if (!outputDir || outputDir.trim() === '') {
      return tmpDir;
    }

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Verify the directory is actually a directory
      const stat = fs.statSync(outputDir);
      if (!stat.isDirectory()) {
        return tmpDir;
      }

      return outputDir;
    } catch {
      // Fall back to temp directory if we cannot create or access the target
      return tmpDir;
    }
  }
}
