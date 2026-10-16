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
});
