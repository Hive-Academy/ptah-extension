import type { SceneInks, SceneVoiceSnapshot } from './command-scene-renderer';
import { VoiceRippleEmitter } from './command-scene-ripples';

const inks: SceneInks = {
  run: '#blue',
  need: '#orange',
  err: '#red',
  done: '#green',
  idle: '#gray',
};

const voice = (
  voiceState: SceneVoiceSnapshot['voiceState'],
  level = 0,
): SceneVoiceSnapshot => ({
  voiceState,
  inputLevel: level,
  outputLevel: level,
});

describe('VoiceRippleEmitter', () => {
  let emitter: VoiceRippleEmitter;

  beforeEach(() => {
    emitter = new VoiceRippleEmitter();
  });

  it('emits on the first eligible frame and stays silent below threshold', () => {
    emitter.update(voice('listening', 0.18), inks, false, 100);
    expect(emitter.count).toBe(1);
    emitter.clear();
    for (const time of [100, 700, 2000]) {
      emitter.update(voice('listening', 0.17), inks, false, time);
    }
    expect(emitter.count).toBe(0);
  });

  it('emits a held level at its gap and suppresses a rising edge inside the gap', () => {
    emitter.update(voice('listening', 0.5), inks, false, 0);
    emitter.update(voice('listening', 0), inks, false, 100);
    emitter.update(voice('listening', 0.5), inks, false, 200);
    expect(emitter.count).toBe(1);
    emitter.update(voice('listening', 0.5), inks, false, 389);
    expect(emitter.count).toBe(1);
    emitter.update(voice('listening', 0.5), inks, false, 390);
    expect(emitter.count).toBe(2);
  });

  it('uses a 468 ms quiet gap and a 260 ms loud gap', () => {
    const quiet = new VoiceRippleEmitter();
    const loud = new VoiceRippleEmitter();
    for (const [time, quietCount, loudCount] of [
      [0, 1, 1],
      [259, 1, 1],
      [260, 1, 2],
      [467, 1, 2],
      [468, 2, 2],
      [519, 2, 2],
      [520, 2, 3],
      [936, 3, 4],
    ]) {
      quiet.update(voice('listening', 0.2), inks, false, time);
      loud.update(voice('listening', 1), inks, false, time);
      expect(quiet.count).toBe(quietCount);
      expect(loud.count).toBe(loudCount);
    }
  });

  it('breathes on the first thinking frame and every 2400 ms regardless of level', () => {
    emitter.update(voice('thinking', NaN), inks, false, 0);
    expect(emitter.count).toBe(1);
    const context = Object.assign({} as CanvasRenderingContext2D, {
      lineWidth: 2,
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      stroke: jest.fn(),
    });
    const strokes: Array<{ ink: string; width: number }> = [];
    context.stroke.mockImplementation(() => {
      strokes.push({ ink: String(context.strokeStyle), width: context.lineWidth });
    });
    emitter.draw(context, 0, 0, 30, 0);
    expect(strokes).toEqual([{ ink: inks.run, width: 1 + 1.2 * 0.35 }]);
    emitter.update(voice('thinking', 1), inks, false, 2399);
    expect(emitter.count).toBe(0);
    emitter.update(voice('thinking', 0), inks, false, 2400);
    expect(emitter.count).toBe(1);
  });

  it.each(['idle', 'muted', 'stopped', 'error'] as const)(
    'clears existing ripples in %s',
    (state) => {
      emitter.update(voice('listening', 1), inks, false, 0);
      emitter.update(voice(state, 1), inks, false, 1);
      expect(emitter.count).toBe(0);
      emitter.update(voice(state, 1), inks, false, 1000);
      expect(emitter.count).toBe(0);
    },
  );

  it('emits nothing under reduced motion', () => {
    emitter.update(voice('speaking', 1), inks, false, 0);
    emitter.update(voice('speaking', 1), inks, true, 1);
    expect(emitter.count).toBe(0);
    emitter.update(voice('thinking', 1), inks, true, 2400);
    expect(emitter.count).toBe(0);
  });

  it('keeps four ripples, dropping the oldest, and prunes at the life limit', () => {
    const context = Object.assign({} as CanvasRenderingContext2D, {
      lineWidth: 2,
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      stroke: jest.fn(),
    });
    const strokes: string[] = [];
    context.stroke.mockImplementation(() => strokes.push(String(context.strokeStyle)));
    for (let index = 0; index < 5; index++) {
      emitter.update(voice('listening', 1), { ...inks, done: `ink-${index}` }, false, index * 260);
    }
    expect(emitter.count).toBe(4);
    emitter.draw(context, 0, 0, 30, 1040);
    expect(strokes).toEqual(['ink-1', 'ink-2', 'ink-3', 'ink-4']);
    emitter.update(voice('listening', 0), inks, false, 2440);
    expect(emitter.count).toBe(0);
  });

  it('prunes after a long pause and emits at most one ripple', () => {
    emitter.update(voice('speaking', 1), inks, false, 0);
    emitter.update(voice('speaking', 1), inks, false, 60_000);
    expect(emitter.count).toBe(1);
  });

  it('resets emission timing when time goes backwards', () => {
    emitter.update(voice('listening', 1), inks, false, 1000);
    emitter.update(voice('listening', 1), inks, false, 100);
    expect(emitter.count).toBe(1);
    const context = Object.assign({} as CanvasRenderingContext2D, {
      lineWidth: 2,
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      stroke: jest.fn(),
    });
    emitter.draw(context, 0, 0, 30, 100);
    expect(context.arc).toHaveBeenCalledTimes(1);
    expect(context.arc).toHaveBeenCalledWith(0, 0, 48, 0, Math.PI * 2);
  });

  it.each([NaN, Infinity, Number.NEGATIVE_INFINITY, -1])(
    'normalises invalid or negative level %s to silence',
    (level) => {
      expect(() => emitter.update(voice('listening', level), inks, false, 0)).not.toThrow();
      expect(emitter.count).toBe(0);
    },
  );

  it('clamps levels above one for timing and strength', () => {
    emitter.update(voice('listening', 2), inks, false, 0);
    emitter.update(voice('listening', 2), inks, false, 259);
    expect(emitter.count).toBe(1);
    emitter.update(voice('listening', 2), inks, false, 260);
    expect(emitter.count).toBe(2);
  });

  it('draws with strength-dependent style and resets alpha to 1', () => {
    const context = Object.assign({} as CanvasRenderingContext2D, {
      lineWidth: 3,
      globalAlpha: 0.4,
      setLineDash: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      stroke: jest.fn(),
    });
    const strokes: Array<{ ink: string; alpha: number; width: number; radius: number }> = [];
    context.stroke.mockImplementation(() => {
      const radius = context.arc.mock.calls.at(-1)?.[2];
      if (radius === undefined) throw new Error('missing ripple arc');
      strokes.push({
        ink: String(context.strokeStyle),
        alpha: context.globalAlpha,
        width: context.lineWidth,
        radius,
      });
    });
    emitter.update(voice('speaking', 1), inks, false, 0);
    emitter.draw(context, 10, 20, 30, 0);
    expect(strokes).toEqual([{ ink: inks.need, alpha: 0.4, width: 2.2, radius: 48 }]);
    emitter.draw(context, 10, 20, 30, 700);
    expect(strokes[1].ink).toBe(inks.need);
    expect(strokes[1].alpha).toBeCloseTo(0.5 ** 1.6 * 0.4);
    expect(strokes[1].width).toBe(2.2);
    expect(strokes[1].radius).toBeCloseTo(48 + 0.75 * 70);
    expect(context.globalAlpha).toBe(1);
    expect(context.lineWidth).toBe(3);
    expect(context.setLineDash).toHaveBeenLastCalledWith([]);
  });
});
