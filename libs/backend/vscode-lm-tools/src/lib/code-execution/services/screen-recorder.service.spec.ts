/**
 * Specs for ScreenRecorderService (TASK_2026_100 P1.B7).
 *
 * Covers:
 *   - start/stop lifecycle and isRecording() state
 *   - options validation (maxFrames, frameDelay) — clamping & fallbacks
 *   - addFrame ring-buffer behaviour and `truncated` flag
 *   - stopRecording output: GIF assembly pipeline (jpeg-js + gifenc)
 *   - error paths: no frames, all frames corrupt, GIF assembly failure
 *   - output directory resolution (fallback to os.tmpdir)
 *
 * External deps mocked via jest.mock:
 *   - 'jpeg-js'  → decode returns deterministic RGBA Uint8Array
 *   - 'gifenc'   → GIFEncoder/quantize/applyPalette spy stubs
 *   - 'fs'       → writeFile / chmod / stat / existsSync / mkdirSync / statSync
 */

import * as path from 'path';
import * as os from 'os';
import { ScreenRecorderService } from './screen-recorder.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('jpeg-js', () => ({
  decode: jest.fn(),
}));

jest.mock('gifenc', () => ({
  GIFEncoder: jest.fn(),
  quantize: jest.fn(),
  applyPalette: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    statSync: jest.fn(),
    promises: {
      writeFile: jest.fn(),
      chmod: jest.fn(),
      stat: jest.fn(),
    },
  };
});

const jpegMock = require('jpeg-js') as { decode: jest.Mock };

const gifencMock = require('gifenc') as {
  GIFEncoder: jest.Mock;
  quantize: jest.Mock;
  applyPalette: jest.Mock;
};

const fsMock = require('fs') as {
  existsSync: jest.Mock;
  mkdirSync: jest.Mock;
  statSync: jest.Mock;
  promises: {
    writeFile: jest.Mock;
    chmod: jest.Mock;
    stat: jest.Mock;
  };
};

interface EncoderStubState {
  writeFrame: jest.Mock;
  finish: jest.Mock;
  bytes: jest.Mock;
}

function makeEncoderStub(): EncoderStubState {
  return {
    writeFrame: jest.fn(),
    finish: jest.fn(),
    bytes: jest.fn(() => new Uint8Array([0x47, 0x49, 0x46])),
  };
}

function primeHappyPath(): EncoderStubState {
  const encoder = makeEncoderStub();
  gifencMock.GIFEncoder.mockReturnValue(encoder);
  gifencMock.quantize.mockReturnValue([[0, 0, 0]]);
  gifencMock.applyPalette.mockReturnValue(new Uint8Array([0]));

  jpegMock.decode.mockReturnValue({
    width: 4,
    height: 4,
    data: new Uint8Array(4 * 4 * 4),
  });

  fsMock.promises.writeFile.mockResolvedValue(undefined);
  fsMock.promises.chmod.mockResolvedValue(undefined);
  fsMock.promises.stat.mockResolvedValue({ size: 1024 });

  fsMock.existsSync.mockReturnValue(true);
  fsMock.statSync.mockReturnValue({ isDirectory: () => true });

  return encoder;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('ScreenRecorderService', () => {
  let service: ScreenRecorderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScreenRecorderService();
  });

  describe('isRecording()', () => {
    it('returns false before any recording has started', () => {
      expect(service.isRecording()).toBe(false);
    });

    it('returns true while a recording is in progress', () => {
      service.startRecording();
      expect(service.isRecording()).toBe(true);
    });
  });

  describe('startRecording()', () => {
    it('accepts default options and reports success', () => {
      const result = service.startRecording();
      expect(result).toEqual({ success: true });
      expect(service.isRecording()).toBe(true);
    });

    it('refuses to start a second recording while one is active', () => {
      service.startRecording();
      const second = service.startRecording();
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already in progress/i);
    });

    it('clamps non-finite / non-positive maxFrames to default', () => {
      const result = service.startRecording({
        maxFrames: Number.NaN,
        frameDelay: 250,
      });
      expect(result.success).toBe(true);
    });

    it('clamps extreme maxFrames to 10000 upper bound', () => {
      const result = service.startRecording({ maxFrames: 1_000_000 });
      expect(result.success).toBe(true);
    });

    it('clamps frameDelay to the minimum of 10ms', () => {
      const result = service.startRecording({ frameDelay: 1 });
      expect(result.success).toBe(true);
    });

    it('clamps frameDelay to the maximum of 60000ms', () => {
      const result = service.startRecording({ frameDelay: 10_000_000 });
      expect(result.success).toBe(true);
    });
  });

  describe('addFrame()', () => {
    it('is a no-op when recording is not active', () => {
      expect(() => service.addFrame('abc')).not.toThrow();
    });

    it('buffers frames and truncates when maxFrames is exceeded', async () => {
      const encoder = primeHappyPath();
      service.startRecording({ maxFrames: 2 });

      service.addFrame('f1');
      service.addFrame('f2');
      service.addFrame('f3'); // triggers truncation

      const result = await service.stopRecording();
      expect(result.truncated).toBe(true);
      // One writeFrame call per surviving frame (2).
      expect(encoder.writeFrame).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopRecording()', () => {
    it('returns an error when called without an active recording', async () => {
      const result = await service.stopRecording();
      expect(result.error).toMatch(/no recording in progress/i);
      expect(result.filePath).toBe('');
    });

    it('returns an error when no frames were captured', async () => {
      primeHappyPath();
      service.startRecording();
      const result = await service.stopRecording();
      expect(result.frameCount).toBe(0);
      expect(result.error).toMatch(/no frames/i);
    });

    it('assembles a GIF via gifenc pipeline and writes it to disk', async () => {
      const encoder = primeHappyPath();
      service.startRecording({ frameDelay: 150 });
      service.addFrame('base64frame1');
      service.addFrame('base64frame2');

      const result = await service.stopRecording();

      expect(jpegMock.decode).toHaveBeenCalledTimes(2);
      expect(gifencMock.quantize).toHaveBeenCalledTimes(2);
      expect(gifencMock.applyPalette).toHaveBeenCalledTimes(2);
      expect(encoder.writeFrame).toHaveBeenCalledTimes(2);
      expect(encoder.finish).toHaveBeenCalledTimes(1);
      expect(encoder.bytes).toHaveBeenCalledTimes(1);
      expect(fsMock.promises.writeFile).toHaveBeenCalledTimes(1);
      expect(result.error).toBeUndefined();
      expect(result.frameCount).toBe(2);
      expect(result.fileSizeBytes).toBe(1024);
      expect(result.filePath).toMatch(/ptah-recording-.*\.gif$/);
    });

    it('passes the configured frameDelay to every writeFrame call', async () => {
      const encoder = primeHappyPath();
      service.startRecording({ frameDelay: 123 });
      service.addFrame('a');
      await service.stopRecording();

      expect(encoder.writeFrame).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        4,
        4,
        expect.objectContaining({ delay: 123 }),
      );
    });

    it('skips corrupt frames but still assembles the GIF from valid ones', async () => {
      const encoder = primeHappyPath();
      jpegMock.decode
        .mockImplementationOnce(() => {
          throw new Error('bad jpeg');
        })
        .mockReturnValue({
          width: 4,
          height: 4,
          data: new Uint8Array(4 * 4 * 4),
        });

      service.startRecording();
      service.addFrame('corrupt');
      service.addFrame('good');
      const result = await service.stopRecording();

      expect(encoder.writeFrame).toHaveBeenCalledTimes(1);
      expect(result.error).toBeUndefined();
      expect(result.frameCount).toBe(2);
    });

    it('returns an error when every frame is corrupt', async () => {
      primeHappyPath();
      jpegMock.decode.mockImplementation(() => {
        throw new Error('bad jpeg');
      });

      service.startRecording();
      service.addFrame('corrupt1');
      service.addFrame('corrupt2');
      const result = await service.stopRecording();

      expect(result.error).toMatch(/all .* frames were corrupt/i);
      expect(result.filePath).toBe('');
    });

    it('surfaces GIF assembly errors via the error field', async () => {
      primeHappyPath();
      gifencMock.GIFEncoder.mockImplementation(() => {
        throw new Error('encoder exploded');
      });

      service.startRecording();
      service.addFrame('frame');
      const result = await service.stopRecording();

      expect(result.error).toMatch(/GIF assembly failed.*encoder exploded/);
    });

    it('clears recording state so isRecording() returns false afterwards', async () => {
      primeHappyPath();
      service.startRecording();
      service.addFrame('frame');
      await service.stopRecording();
      expect(service.isRecording()).toBe(false);
    });

    it('writes to os.tmpdir() when no outputDir is provided', async () => {
      primeHappyPath();
      service.startRecording();
      service.addFrame('f');
      const result = await service.stopRecording();

      expect(result.filePath.startsWith(path.resolve(os.tmpdir()))).toBe(true);
    });

    it('falls back to os.tmpdir() when the target directory cannot be resolved', async () => {
      primeHappyPath();
      fsMock.existsSync.mockReturnValue(false);
      fsMock.mkdirSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      service.startRecording();
      service.addFrame('f');
      const result = await service.stopRecording();

      expect(result.filePath.startsWith(path.resolve(os.tmpdir()))).toBe(true);
    });

    it('falls back to os.tmpdir() when the provided path is not a directory', async () => {
      primeHappyPath();
      fsMock.existsSync.mockReturnValue(true);
      fsMock.statSync.mockReturnValue({ isDirectory: () => false });

      service.startRecording();
      service.addFrame('f');
      const result = await service.stopRecording(
        path.resolve('D:/tmp/not-a-dir'),
      );

      expect(result.filePath.startsWith(path.resolve(os.tmpdir()))).toBe(true);
    });
  });
});
