import type { CommandWorkNode } from '../model/command-center.store';
import { SpriteCache, type SpritePalette } from './sprite-cache';

const palette: SpritePalette = {
  lit: '#ffffff',
  mid: '#4477aa',
  dark: '#102030',
  rim: '#88bbff',
};
const node = (id: string, providerId: string | null): CommandWorkNode => ({
  id,
  kind: id.startsWith('tribunal:')
    ? 'tribunal'
    : id.startsWith('lane:')
      ? 'lane'
      : 'agent',
  parentId: 'root:r',
  label: 'Builder',
  providerId,
  state: 'running',
});

describe('SpriteCache', () => {
  const path = jest.fn();
  const fillText = jest.fn();
  const fill = jest.fn();
  const stroke = jest.fn();
  const gradient = { addColorStop: jest.fn() };
  const context = Object.assign({} as CanvasRenderingContext2D, {
    scale: jest.fn(),
    createRadialGradient: jest.fn(() => gradient),
    beginPath: jest.fn(),
    arc: jest.fn(),
    ellipse: jest.fn(),
    fill,
    stroke,
    translate: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    lineJoin: 'round',
    fillText,
  });
  const factory = jest.fn(() => {
    const canvas = document.createElement('canvas');
    jest.spyOn(canvas, 'getContext').mockImplementation(() => context);
    return canvas;
  });
  const request = (
    work: CommandWorkNode,
    theme: 'dark' | 'light' = 'dark',
    size = 58,
  ) => ({ node: work, theme, paletteName: 'blue', palette, size, dpr: 3 });

  beforeAll(() => {
    Object.defineProperty(globalThis, 'Path2D', {
      configurable: true,
      value: class {
        public constructor(data: string) {
          path(data);
        }
      },
    });
  });
  beforeEach(() => {
    factory.mockClear();
    path.mockClear();
    fillText.mockClear();
    fill.mockClear();
    stroke.mockClear();
  });

  it('reuses a detached sprite and parses provider paths only on a miss', () => {
    const cache = new SpriteCache(factory);
    const work = node('cli:a', 'codex');
    const first = cache.get(request(work));
    expect(cache.get(request(work))).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(path).toHaveBeenCalledTimes(1);
    expect(first.width).toBe(Math.ceil(58 * 2.2 * 2));
    expect(fillText).not.toHaveBeenCalled();
  });

  it('uses a vendor slug and a two-letter fallback for unknown providers', () => {
    const cache = new SpriteCache(factory);
    cache.get(request(node('cli:known', 'ollama-cloud')));
    expect(path).toHaveBeenCalled();
    cache.get(request(node('cli:unknown', 'glm')));
    expect(fillText).toHaveBeenCalledWith(
      'BU',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('draws a distinct Ptah P in both themes even when the root has a provider', () => {
    const cache = new SpriteCache(factory);
    const work = {
      ...node('root:r', 'codex'),
      kind: 'root' as const,
      parentId: null,
    };
    const colors: string[] = [];
    fillText.mockImplementation(() => colors.push(context.fillStyle as string));
    for (const theme of ['dark', 'light'] as const) {
      cache.get({ ...request(work, theme, 154), paletteName: 'gold' });
      expect(fillText).toHaveBeenLastCalledWith(
        'P',
        expect.any(Number),
        expect.any(Number),
      );
      expect(colors.at(-1)).not.toBe(palette.lit);
    }
    expect(colors).toEqual(['#fff3ce', '#2f241b']);
    expect(path).not.toHaveBeenCalled();
  });

  it('uses a dark provider mark on light delegate spheres and retains the dark-theme mark', () => {
    const cache = new SpriteCache(factory);
    const work = node('cli:provider-mark', 'codex');
    const colors: string[] = [];
    fill.mockImplementation((shape?: Path2D) => {
      if (shape) colors.push(context.fillStyle as string);
    });
    cache.get(request(work, 'dark'));
    cache.get(request(work, 'light'));
    expect(colors).toEqual([palette.lit, '#2f241b']);
    expect(factory).toHaveBeenCalledTimes(2);
    fill.mockReset();
  });

  it('uses the shield for Tribunal, keeps satellites at 32px and rebuilds on theme change', () => {
    const cache = new SpriteCache(factory);
    const tribunal = node('tribunal:run', null);
    cache.get(request(tribunal));
    expect(path).toHaveBeenCalledWith(expect.stringContaining('M12 22'));
    expect(fillText).not.toHaveBeenCalledWith(
      'T',
      expect.any(Number),
      expect.any(Number),
    );
    const satellite = cache.get(
      request(node('lane:run:judge', 'codex'), 'dark', 25),
    );
    expect(satellite.width).toBe(Math.ceil(32 * 2.2 * 2));
    cache.get(request(tribunal, 'light'));
    expect(factory).toHaveBeenCalledTimes(3);
  });

  it('prunes removed sprites but retains one shared with a live node', () => {
    const cache = new SpriteCache(factory);
    const sharedA = node('cli:shared-a', 'codex');
    const sharedB = node('cli:shared-b', 'codex');
    const removed = node('cli:removed', 'glm');
    const sharedSprite = cache.get(request(sharedA));
    expect(cache.get(request(sharedB))).toBe(sharedSprite);
    const removedSprite = cache.get(request(removed));
    cache.prune(new Set([sharedB.id]));
    expect(cache.get(request(sharedB))).toBe(sharedSprite);
    expect(cache.get(request(removed))).not.toBe(removedSprite);
    expect(factory).toHaveBeenCalledTimes(3);
  });
});
