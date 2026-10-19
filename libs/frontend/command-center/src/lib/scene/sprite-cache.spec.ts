import { SpriteCache } from './sprite-cache';

describe('SpriteCache voice halo', () => {
  it('reuses a theme, palette, and DPR sprite across live levels', () => {
    const gradient = { addColorStop: jest.fn() };
    const context = Object.assign({} as CanvasRenderingContext2D, {
      scale: jest.fn(),
      createRadialGradient: jest.fn(() => gradient),
      fillRect: jest.fn(),
    });
    const createCanvas = jest.fn(() => {
      const canvas = document.createElement('canvas');
      jest.spyOn(canvas, 'getContext').mockReturnValue(context);
      return canvas;
    });
    const cache = new SpriteCache(createCanvas);
    const palette = { lit: '#fff', mid: '#aaa', dark: '#333', rim: '#fdc' };
    const request = {
      theme: 'dark' as const,
      paletteName: 'gold',
      palette,
      dpr: 3,
    };
    const first = cache.getVoiceHalo(request);
    expect(first.width).toBe(384);
    expect(cache.getVoiceHalo({ ...request })).toBe(first);
    expect(createCanvas).toHaveBeenCalledTimes(1);
    expect(context.createRadialGradient).toHaveBeenCalledTimes(1);
    expect(cache.getVoiceHalo({ ...request, theme: 'light' })).not.toBe(first);
    expect(createCanvas).toHaveBeenCalledTimes(2);
  });

  it('evicts the prior halo when DPR changes', () => {
    const context = Object.assign({} as CanvasRenderingContext2D, {
      scale: jest.fn(),
      createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
      fillRect: jest.fn(),
    });
    const createCanvas = jest.fn(() => {
      const canvas = document.createElement('canvas');
      jest.spyOn(canvas, 'getContext').mockReturnValue(context);
      return canvas;
    });
    const cache = new SpriteCache(createCanvas);
    const request = {
      theme: 'dark' as const,
      paletteName: 'gold',
      palette: { lit: '#fff', mid: '#aaa', dark: '#333', rim: '#fdc' },
      dpr: 1,
    };
    const first = cache.getVoiceHalo(request);
    const second = cache.getVoiceHalo({ ...request, dpr: 2 });
    expect(first.width).toBe(0);
    expect(first.height).toBe(0);
    expect(second.width).toBe(384);
    expect(cache.getVoiceHalo(request)).not.toBe(first);
    expect(createCanvas).toHaveBeenCalledTimes(3);
  });
});
