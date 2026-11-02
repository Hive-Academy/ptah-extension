/** @jest-environment jsdom */
import { generateBoltPath, HeroLightning } from './hero-lightning';

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];
  readonly observe = jest.fn();
  readonly unobserve = jest.fn();
  readonly disconnect = jest.fn();

  constructor(_callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }
}

describe('hero lightning', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: ResizeObserverStub });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    ResizeObserverStub.instances = [];
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: originalResizeObserver });
  });

  it('generates a jagged path with exact endpoints', () => {
    const start = { x: 12, y: 24 };
    const end = { x: 220, y: 80 };
    const points = generateBoltPath(start, end, () => 0.8);
    expect(points).toHaveLength(17);
    expect(points[0]).toEqual(start);
    expect(points.at(-1)).toEqual(end);
    expect(points.slice(1, -1).some((point) => point.y !== start.y && point.y !== end.y)).toBe(true);
  });

  it('arcs crossways: top-left with bottom-right, then top-right with bottom-left', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const { lightning, request, symbols } = createLightning(true, 4);
    const litPairs: number[][] = [];
    lightning.start();
    for (let cycle = 0; cycle < 3; cycle++) {
      jest.advanceTimersByTime(3000);
      litPairs.push(symbols.flatMap((symbol, index) => symbol.classList.contains('lightning-lit') ? [index] : []));
      (request.mock.calls.at(-1)?.[0] as FrameRequestCallback)(0);
      (request.mock.calls.at(-1)?.[0] as FrameRequestCallback)(360);
      jest.advanceTimersByTime(110);
      (request.mock.calls.at(-1)?.[0] as FrameRequestCallback)(1000);
      (request.mock.calls.at(-1)?.[0] as FrameRequestCallback)(1360);
    }
    expect(litPairs).toEqual([[0, 2], [1, 3], [0, 2]]);
    lightning.destroy();
  });

  function createLightning(withContext = true, symbolCount = 2): {
    lightning: HeroLightning;
    request: jest.Mock;
    cancel: jest.Mock;
    artifacts: HTMLDivElement;
    canvas: HTMLCanvasElement;
    symbols: HTMLImageElement[];
    context: CanvasRenderingContext2D;
  } {
    const artifacts = document.createElement('div');
    const canvas = document.createElement('canvas');
    const symbols = Array.from({ length: symbolCount }, () => document.createElement('img'));
    artifacts.append(...symbols, canvas);
    const context = Object.assign({} as CanvasRenderingContext2D, {
      clearRect: jest.fn(), setTransform: jest.fn(), beginPath: jest.fn(),
      moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
    });
    Object.defineProperty(canvas, 'getContext', { value: jest.fn(() => withContext ? context : null) });
    const request = jest.fn(() => 7);
    const cancel = jest.fn();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(request);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(cancel);
    const lightning = new HeroLightning(window, artifacts, canvas, symbols);
    return { lightning, request, cancel, artifacts, canvas, symbols, context };
  }

  it('does not schedule work when canvas has no 2D context', () => {
    const { lightning, request } = createLightning(false);
    lightning.start();
    expect(jest.getTimerCount()).toBe(0);
    expect(request).not.toHaveBeenCalled();
    lightning.destroy();
  });

  it('cancels its idle timer, active frame, and resize observer', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const { lightning, request, cancel } = createLightning();
    lightning.start();
    expect(jest.getTimerCount()).toBe(1);
    lightning.stop();
    expect(jest.getTimerCount()).toBe(0);

    lightning.start();
    jest.advanceTimersByTime(3000);
    expect(request).toHaveBeenCalledTimes(1);
    lightning.destroy();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(jest.getTimerCount()).toBe(0);
    expect(ResizeObserverStub.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('caps canvas DPR, paints forward and reverse pairs, and clears symbol glow', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const originalRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    try {
      const { lightning, request, artifacts, canvas, symbols, context } = createLightning();
      jest.spyOn(artifacts, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 120, 80));
      jest.spyOn(symbols[0], 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 20, 20));
      jest.spyOn(symbols[1], 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 40, 20, 20));

      lightning.start();
      expect(jest.getTimerCount()).toBe(1);
      lightning.start();
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(3000);
      expect(canvas.width).toBe(240);
      expect(canvas.height).toBe(160);
      expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
      expect(symbols.every((symbol) => symbol.classList.contains('lightning-lit'))).toBe(true);

      const firstFrame = request.mock.calls[0][0] as FrameRequestCallback;
      firstFrame(0);
      expect(context.moveTo).toHaveBeenCalledWith(20, 20);
      expect(context.lineTo).toHaveBeenCalledWith(80, 30);

      const finishForward = request.mock.calls[1][0] as FrameRequestCallback;
      finishForward(360);
      jest.advanceTimersByTime(110);
      const reverseFrame = request.mock.calls[2][0] as FrameRequestCallback;
      (context.moveTo as jest.Mock).mockClear();
      reverseFrame(500);
      expect(context.moveTo).toHaveBeenCalledWith(80, 30);
      expect(context.lineTo).toHaveBeenCalledWith(20, 20);
      expect(symbols.every((symbol) => symbol.classList.contains('lightning-lit'))).toBe(true);

      lightning.stop();
      expect(symbols.every((symbol) => !symbol.classList.contains('lightning-lit'))).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      lightning.destroy();
    } finally {
      if (originalRatio) Object.defineProperty(window, 'devicePixelRatio', originalRatio);
    }
  });
});
