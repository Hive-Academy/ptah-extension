/**
 * Ambient type declarations for gifenc (pure JS GIF encoder)
 * TASK_2025_254
 *
 * gifenc has no bundled TypeScript definitions. These minimal declarations
 * cover the API surface used by ScreenRecorderService.
 *
 * See: https://github.com/mattdesl/gifenc
 */
declare module 'gifenc' {
  /** RGB color triple */
  type GifColor = [number, number, number];

  /** RGBA color quadruple (when using rgba4444 format) */
  type GifColorRGBA = [number, number, number, number];

  /** Color palette -- array of RGB or RGBA tuples */
  type GifPalette = GifColor[] | GifColorRGBA[];

  /** Options for GIFEncoder factory */
  interface GIFEncoderOptions {
    /** Initial byte buffer capacity (default 4096) */
    initialCapacity?: number;
    /**
     * In auto mode (default true), header and first-frame metadata
     * are written automatically on the first writeFrame call.
     */
    auto?: boolean;
  }

  /** Options for writeFrame */
  interface WriteFrameOptions {
    /** Color palette for this frame (required for first frame in auto mode) */
    palette?: GifPalette;
    /** Frame delay in milliseconds */
    delay?: number;
    /** Enable 1-bit transparency */
    transparent?: boolean;
    /** Palette index to treat as transparent */
    transparentIndex?: number;
    /** Repeat count: -1=once, 0=forever, >0=count */
    repeat?: number;
    /** Color depth (default 8) */
    colorDepth?: number;
    /** Disposal method (-1=auto, 0=none, 1=no dispose, 2=restore bg, 3=restore prev) */
    dispose?: number;
    /** In non-auto mode, set true for the first frame */
    first?: boolean;
  }

  /** GIF encoder instance returned by the GIFEncoder factory function */
  interface GIFEncoderInstance {
    /** Reset the encoder stream */
    reset(): void;
    /** Write the GIF trailer byte (end-of-stream) */
    finish(): void;
    /** Get the encoded GIF data as a new Uint8Array */
    bytes(): Uint8Array;
    /** Get a view into the underlying buffer (no copy) */
    bytesView(): Uint8Array;
    /** The underlying ArrayBuffer */
    readonly buffer: ArrayBuffer;
    /** Write the GIF89a header manually (only needed in non-auto mode) */
    writeHeader(): void;
    /**
     * Write a single frame.
     * @param index - Indexed pixel data (Uint8Array, one byte per pixel)
     * @param width - Frame width in pixels
     * @param height - Frame height in pixels
     * @param opts - Per-frame options
     */
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions,
    ): void;
  }

  /** Options for the quantize function */
  interface QuantizeOptions {
    /** Color format: "rgb565" (default), "rgb444", or "rgba4444" */
    format?: string;
    /** Snap alpha to 0 or 255 */
    oneBitAlpha?: boolean | number;
    /** Replace transparent pixels with clearAlphaColor */
    clearAlpha?: boolean;
    /** Alpha threshold for clearing (default 0) */
    clearAlphaThreshold?: number;
    /** Replacement color for cleared alpha pixels (default 0x00) */
    clearAlphaColor?: number;
  }

  /**
   * Create a new GIF encoding stream.
   * NOTE: This is a factory function, NOT a constructor -- do NOT use `new`.
   */
  export function GIFEncoder(opts?: GIFEncoderOptions): GIFEncoderInstance;

  /**
   * Quantize RGBA pixel data down to a reduced palette.
   * @param rgba - Flat RGBA pixel data (4 bytes per pixel)
   * @param maxColors - Maximum palette size (typically 256)
   * @param options - Quantization options
   * @returns Array of color tuples (RGB or RGBA)
   */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): GifPalette;

  /**
   * Map each pixel in RGBA data to the nearest palette index.
   * @param rgba - Flat RGBA pixel data (4 bytes per pixel)
   * @param palette - Color palette from quantize()
   * @param format - Color format matching quantize (default "rgb565")
   * @returns Indexed pixel data (one byte per pixel)
   */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: string,
  ): Uint8Array;

  /**
   * Find the nearest color index in the palette for a single color.
   */
  export function nearestColorIndex(
    palette: GifPalette,
    color: GifColor | GifColorRGBA,
    format?: string,
  ): number;

  /**
   * Find the nearest color in the palette for a single color.
   */
  export function nearestColor(
    palette: GifPalette,
    color: GifColor | GifColorRGBA,
    format?: string,
  ): GifColor | GifColorRGBA;

  /**
   * Find the nearest color index with distance metric.
   */
  export function nearestColorIndexWithDistance(
    palette: GifPalette,
    color: GifColor | GifColorRGBA,
    format?: string,
  ): [number, number];

  /**
   * Snap all quantized colors to their exact palette entries.
   */
  export function snapColorsToPalette(
    palette: GifPalette,
    knownColors: GifPalette,
    threshold?: number,
  ): void;

  /**
   * Pre-quantize RGBA data by reducing channel precision.
   */
  export function prequantize(
    rgba: Uint8Array | Uint8ClampedArray,
    options?: {
      roundRGB?: number;
      roundAlpha?: number;
      oneBitAlpha?: boolean | number;
    },
  ): void;

  export default GIFEncoder;
}
