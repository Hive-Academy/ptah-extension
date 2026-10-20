import { SCENE_DOTS } from './command-scene-decoration';
import { drawBackdropTwinkle } from './command-scene-twinkle';

describe('drawBackdropTwinkle', () => {
  const context = Object.assign({} as CanvasRenderingContext2D, {
    save: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    fillStyle: 'original',
    globalAlpha: 0.7,
  });
  const saved = { fillStyle: '', globalAlpha: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    context.fillStyle = 'original';
    context.globalAlpha = 0.7;
    context.save.mockImplementation(() => {
      saved.fillStyle = String(context.fillStyle);
      saved.globalAlpha = context.globalAlpha;
    });
    context.restore.mockImplementation(() => {
      context.fillStyle = saved.fillStyle;
      context.globalAlpha = saved.globalAlpha;
    });
  });

  it('fills only selected backdrop positions with bounded alpha and restores style', () => {
    const fills: Array<{ x: number; y: number; alpha: number; ink: string }> =
      [];
    context.fillRect.mockImplementation((x: number, y: number) =>
      fills.push({
        x,
        y,
        alpha: context.globalAlpha,
        ink: String(context.fillStyle),
      }),
    );
    drawBackdropTwinkle(context, 320, 240, 'dark', 1000);
    const allowed = SCENE_DOTS.filter((_, index) => index % 4 === 1);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.length).toBeLessThanOrEqual(12);
    for (const fill of fills) {
      expect(
        allowed.some(
          (dot) => fill.x === dot.x * 320 - 0.4 && fill.y === dot.y * 240 - 0.4,
        ),
      ).toBe(true);
      expect(fill.alpha).toBeGreaterThan(0);
      expect(fill.alpha).toBeLessThanOrEqual(0.55);
      expect(fill.ink).toBe('#9d93ae');
    }
    expect(context.save).toHaveBeenCalledTimes(1);
    expect(context.restore).toHaveBeenCalledTimes(1);
    expect(context.fillStyle).toBe('original');
    expect(context.globalAlpha).toBe(0.7);
  });

  it('uses fixed time deterministically and changes brightness over time', () => {
    const alphas: number[] = [];
    context.fillRect.mockImplementation(() => alphas.push(context.globalAlpha));
    drawBackdropTwinkle(context, 320, 240, 'light', 900);
    const first = [...alphas];
    alphas.length = 0;
    drawBackdropTwinkle(context, 320, 240, 'light', 900);
    expect(alphas).toEqual(first);
    alphas.length = 0;
    drawBackdropTwinkle(context, 320, 240, 'light', 1600);
    expect(alphas).not.toEqual(first);
    expect(alphas.every((alpha) => alpha > 0 && alpha <= 0.4)).toBe(true);
  });

  it.each([
    [-1, 240, 0],
    [320, 0, 0],
    [320, 240, NaN],
    [320, 240, Infinity],
  ])('skips invalid dimensions or time', (width, height, time) => {
    drawBackdropTwinkle(context, width, height, 'dark', time);
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(context.save).not.toHaveBeenCalled();
  });
});
