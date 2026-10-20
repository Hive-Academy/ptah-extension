import { drawRootGlow, drawSceneDecoration } from './command-scene-decoration';

describe('scene orbit guides', () => {
  it('uses a finite root glow radius for NaN voice input', () => {
    const context = Object.assign({} as CanvasRenderingContext2D, {
      createRadialGradient: jest.fn((_x: number, _y: number, _inner: number, _x2: number, _y2: number, outer: number) => {
        if (!Number.isFinite(outer)) throw new Error('non-finite radius');
        return { addColorStop: jest.fn() };
      }),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
    });
    expect(() => drawRootGlow(context, 100, 80, 30, NaN, 'dark', false)).not.toThrow();
    expect(context.createRadialGradient).toHaveBeenCalledWith(100, 80, 16.5, 100, 80, 57);
  });
  it.each([
    [0, 1],
    [5, 1],
    [9, 2],
  ])('strokes only the %i-node layout tracks', (count, tracks) => {
    const context = Object.assign({} as CanvasRenderingContext2D, {
      createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      ellipse: jest.fn(),
      stroke: jest.fn(),
    });
    drawSceneDecoration(
      context,
      400,
      300,
      'dark',
      { x: 0, y: 0, width: 400, height: 300 },
      count,
    );
    expect(context.ellipse).toHaveBeenCalledTimes(tracks);
    expect(context.stroke).toHaveBeenCalledTimes(tracks);
  });
});
