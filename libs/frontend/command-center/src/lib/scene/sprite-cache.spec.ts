import { SpriteCache } from './sprite-cache';
import type { CommandWorkNode } from '../model/command-center.store';

describe('SpriteCache root logo', () => {
  it('uses the P fallback, then redraws the clipped logo after image load', () => {
    const image = document.createElement('img');
    const imageConstructor = jest
      .spyOn(globalThis, 'Image')
      .mockImplementation(() => image);
    const context = Object.assign({} as CanvasRenderingContext2D, {
      scale: jest.fn(),
      createRadialGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      stroke: jest.fn(),
      ellipse: jest.fn(),
      fillText: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      clip: jest.fn(),
      drawImage: jest.fn(),
    });
    const createCanvas = jest.fn(() => {
      const canvas = document.createElement('canvas');
      jest.spyOn(canvas, 'getContext').mockReturnValue(context);
      return canvas;
    });
    const ready = jest.fn();
    const cache = new SpriteCache(createCanvas, 'ptah.svg', ready);
    const node: CommandWorkNode = {
      id: 'root',
      kind: 'root',
      parentId: null,
      label: 'Ptah',
      providerId: null,
      state: 'completed',
    };
    const request = {
      node,
      theme: 'dark' as const,
      paletteName: 'gold',
      palette: { lit: '#fff', mid: '#aaa', dark: '#333', rim: '#fdc' },
      size: 60,
      dpr: 1,
    };
    const fallback = cache.get(request);
    expect(context.fillText).toHaveBeenCalledWith(
      'P',
      expect.any(Number),
      expect.any(Number),
    );
    expect(cache.get(request)).toBe(fallback);
    image.onload?.(new Event('load'));
    expect(ready).toHaveBeenCalledTimes(1);
    const logo = cache.get(request);
    expect(logo).not.toBe(fallback);
    expect(context.clip).toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(
      image,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(createCanvas).toHaveBeenCalledTimes(2);
    image.onerror?.(new Event('error'));
    const afterError = cache.get(request);
    expect(afterError).toBe(fallback);
    expect(context.fillText).toHaveBeenCalledTimes(1);
    imageConstructor.mockRestore();
  });
});

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
