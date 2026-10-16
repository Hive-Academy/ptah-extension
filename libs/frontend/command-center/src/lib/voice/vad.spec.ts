import { EnergyVad } from './vad';

const frame = (level: number): Float32Array =>
  new Float32Array(128).fill(level);

describe('EnergyVad', () => {
  it('ignores silence and noise below the floor', () => {
    const vad = new EnergyVad({ noiseFloor: 0.03, speechThreshold: 0.01 });
    expect(
      [0, 100, 200, 400].map((time) => vad.processFrame(frame(0.02), time)),
    ).toEqual([null, null, null, null]);
  });

  it('detects a sustained utterance after hangover', () => {
    const vad = new EnergyVad();
    expect(vad.processFrame(frame(0.1), 0)).toBeNull();
    expect(vad.processFrame(frame(0.1), 120)).toBe('start');
    expect(vad.processFrame(frame(0.1), 400)).toBeNull();
    expect(vad.processFrame(frame(0), 450)).toBeNull();
    expect(vad.processFrame(frame(0), 1150)).toBe('end');
  });

  it('rejects a click shorter than the minimum utterance', () => {
    const vad = new EnergyVad({ speechStartMs: 0, minUtteranceMs: 250 });
    expect(vad.processFrame(frame(0.1), 0)).toBe('start');
    vad.processFrame(frame(0), 50);
    expect(vad.processFrame(frame(0), 750)).toBe('discard');
  });

  it('requires sustained onset during playback', () => {
    const vad = new EnergyVad();
    expect(vad.processFrame(frame(0.1), 0, true)).toBeNull();
    expect(vad.processFrame(frame(0.1), 120, true)).toBeNull();
    expect(vad.processFrame(frame(0), 140, true)).toBeNull();
    expect(vad.processFrame(frame(0.1), 200, true)).toBeNull();
    expect(vad.processFrame(frame(0.1), 500, true)).toBe('start');
  });

  it.each([false, true])(
    'keeps onset through mid-band dips during playbackMode=%s',
    (playbackMode) => {
      const vad = new EnergyVad();
      const onset = playbackMode ? 300 : 120;
      expect(vad.processFrame(frame(0.1), 0, playbackMode)).toBeNull();
      expect(vad.processFrame(frame(0.01), 60, playbackMode)).toBeNull();
      expect(vad.processFrame(frame(0.1), 120, playbackMode)).toBe(
        playbackMode ? null : 'start',
      );
      if (!playbackMode) return;
      expect(vad.processFrame(frame(0.1), onset, playbackMode)).toBe('start');
    },
  );

  it.each([false, true])(
    'does not start from a stale onset after sustained mid-band noise during playbackMode=%s',
    (playbackMode) => {
      const vad = new EnergyVad();
      expect(vad.processFrame(frame(0.1), 0, playbackMode)).toBeNull();
      for (let time = 50; time < 2000; time += 50) {
        expect(vad.processFrame(frame(0.01), time, playbackMode)).toBeNull();
      }
      expect(vad.processFrame(frame(0.1), 2000, playbackMode)).toBeNull();
    },
  );

  it('requires a new onset after an utterance ends through mid-band hangover', () => {
    const vad = new EnergyVad();
    expect(vad.processFrame(frame(0.1), 0)).toBeNull();
    expect(vad.processFrame(frame(0.1), 120)).toBe('start');
    expect(vad.processFrame(frame(0.01), 400)).toBeNull();
    expect(vad.processFrame(frame(0.01), 1100)).toBe('end');
    expect(vad.processFrame(frame(0.1), 1110)).toBeNull();
  });

  it('resets onset when a frame falls below the noise floor', () => {
    const vad = new EnergyVad();
    expect(vad.processFrame(frame(0.1), 0)).toBeNull();
    expect(vad.processFrame(frame(0), 60)).toBeNull();
    expect(vad.processFrame(frame(0.1), 120)).toBeNull();
    expect(vad.processFrame(frame(0.1), 240)).toBe('start');
  });
});
