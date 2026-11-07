/** @jest-environment jsdom */
import { type LightningBolt, LightningRenderer } from '../../shared/lightning/lightning-renderer';
import { STRIKE, STRIKE_TOTAL_MS } from '../../shared/lightning/strike-envelope';
import { HeroLightning } from './hero-lightning';
import { FINE_POINTER } from './hero-pointer';

/** The artifacts box on the page, and the symbol centres inside it (clockwise from top-left). */
const BOX = { left: 100, top: 20, width: 800, height: 600 };
const CENTERS = [
  { x: 100, y: 100 },
  { x: 700, y: 80 },
  { x: 700, y: 500 },
  { x: 120, y: 520 },
];

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

function element(box: DOMRect): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => box;
  return el;
}

function fakeView(finePointer: boolean) {
  const timers = new Map<number, { run: () => void; delay: number }>();
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const view = {
    devicePixelRatio: 2,
    setTimeout: jest.fn((run: () => void, delay: number) => {
      timers.set(++id, { run, delay });
      return id;
    }),
    clearTimeout: jest.fn((handle: number) => timers.delete(handle)),
    requestAnimationFrame: jest.fn((run: FrameRequestCallback) => {
      frames.set(++id, run);
      return id;
    }),
    cancelAnimationFrame: jest.fn((handle: number) => frames.delete(handle)),
    matchMedia: jest.fn((query: string) => ({ matches: finePointer && query === FINE_POINTER })),
  };
  const runTimer = (): number => {
    const [handle, timer] = [...timers][0];
    timers.delete(handle);
    timer.run();
    return timer.delay;
  };
  const runFrame = (time: number): void => {
    const [handle, run] = [...frames][0];
    frames.delete(handle);
    run(time);
  };
  return { view: view as unknown as Window, timers, frames, runTimer, runFrame };
}

function fakeRenderer() {
  return { resize: jest.fn(), draw: jest.fn(), clear: jest.fn(), dispose: jest.fn() };
}

function setup(options: { webgl?: boolean; finePointer?: boolean } = {}) {
  const renderer = fakeRenderer();
  const create = jest
    .spyOn(LightningRenderer, 'create')
    .mockReturnValue(options.webgl === false ? undefined : (renderer as unknown as LightningRenderer));
  const clock = fakeView(options.finePointer ?? false);
  const artifacts = element(rect(BOX.left, BOX.top, BOX.width, BOX.height));
  const symbols = CENTERS.map((c) => element(rect(BOX.left + c.x - 20, BOX.top + c.y - 20, 40, 40)));
  const canvas = document.createElement('canvas');
  const host = document.createElement('section');
  const lightning = new HeroLightning(clock.view, artifacts, canvas, symbols, host);
  // The frame loop reuses its bolt storage, so snapshot what each draw saw.
  const lastBolts = (): LightningBolt[] => {
    const calls = renderer.draw.mock.calls;
    if (calls.length === 0) return [];
    return (calls[calls.length - 1][0] as LightningBolt[]).map((bolt) => ({
      ...bolt,
      from: { ...bolt.from },
      to: { ...bolt.to },
    }));
  };
  const lit = (): number[] =>
    symbols.flatMap((symbol, index) => (symbol.classList.contains('lightning-lit') ? [index] : []));
  return { ...clock, renderer, create, lightning, canvas, host, lastBolts, lit };
}

function hover(host: HTMLElement, type: string, x: number, y: number, pointerType = 'mouse'): void {
  const event = new MouseEvent(type, { clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  host.dispatchEvent(event);
}

describe('HeroLightning', () => {
  beforeEach(() => jest.spyOn(Math, 'random').mockReturnValue(0.5));
  afterEach(() => jest.restoreAllMocks());

  it('renders nothing and schedules nothing without WebGL', () => {
    const { lightning, timers, frames } = setup({ webgl: false });
    lightning.start();
    expect(timers.size).toBe(0);
    expect(frames.size).toBe(0);
    lightning.destroy();
  });

  it('sizes the canvas for the pixel ratio', () => {
    const { renderer, lightning } = setup();
    expect(renderer.resize).toHaveBeenCalledWith(BOX.width, BOX.height, 2);
    lightning.destroy();
  });

  it('strikes icon to icon, ramps up, fades, then sleeps through a dark gap', () => {
    const { lightning, runTimer, runFrame, timers, frames, renderer, lastBolts, lit } = setup();
    lightning.start();
    expect(runTimer()).toBe(STRIKE.firstDelayMs);
    expect(frames.size).toBe(1);

    runFrame(1000);
    const first = lastBolts();
    expect(first).toHaveLength(1);
    expect(first[0].from).toEqual(CENTERS[0]);
    expect(first[0].to).toEqual(CENTERS[2]);
    expect(lit()).toEqual([0, 2]);

    runFrame(1000 + STRIKE.rampMs + 100);
    const peak = lastBolts()[0];
    expect(peak.intensity).toBeGreaterThan(first[0].intensity);
    expect(peak.core).toBeGreaterThan(first[0].core);
    // The writhe clock runs in seconds from the strike's first frame.
    const draws = renderer.draw.mock.calls;
    expect(draws[draws.length - 1][1]).toBeCloseTo((STRIKE.rampMs + 100) / 1000);
    // Frames reuse one bolt list and its bolts instead of allocating new ones.
    expect(draws[draws.length - 1][0]).toBe(draws[0][0]);

    // The strike is over: no frame during the gap, one timer for the next strike.
    runFrame(1000 + STRIKE_TOTAL_MS);
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(1);
    expect(renderer.clear).toHaveBeenCalled();
    expect(lit()).toEqual([]);
    const gap = runTimer();
    expect(gap).toBeGreaterThanOrEqual(STRIKE.minGapMs);
    expect(gap).toBeLessThan(STRIKE.maxGapMs);

    runFrame(5000);
    expect(lastBolts()[0].from).toEqual(CENTERS[1]);
    expect(lastBolts()[0].to).toEqual(CENTERS[3]);
    lightning.destroy();
  });

  it('also joins the nearest icon to a hovering mouse, live', () => {
    const { lightning, host, runTimer, runFrame, lastBolts, lit } = setup({ finePointer: true });
    lightning.start();
    runTimer();
    hover(host, 'pointermove', BOX.left + 650, BOX.top + 120);
    runFrame(0);
    expect(lastBolts()).toHaveLength(2);
    expect(lastBolts()[1].from).toEqual(CENTERS[1]);
    expect(lastBolts()[1].to).toEqual({ x: 650, y: 120 });
    expect(lit()).toEqual([0, 1, 2]);

    hover(host, 'pointermove', BOX.left + 150, BOX.top + 480);
    runFrame(16);
    expect(lastBolts()[1].from).toEqual(CENTERS[3]);
    expect(lastBolts()[1].to).toEqual({ x: 150, y: 480 });

    hover(host, 'pointerleave', 0, 0);
    runFrame(32);
    expect(lastBolts()).toHaveLength(1);
    lightning.destroy();
  });

  it('keeps touch pointers and no-hover devices icon to icon', () => {
    const touch = setup({ finePointer: true });
    touch.lightning.start();
    touch.runTimer();
    hover(touch.host, 'pointermove', 300, 300, 'touch');
    touch.runFrame(0);
    expect(touch.lastBolts()).toHaveLength(1);
    touch.lightning.destroy();

    const coarse = setup({ finePointer: false });
    coarse.lightning.start();
    coarse.runTimer();
    hover(coarse.host, 'pointermove', 300, 300);
    coarse.runFrame(0);
    expect(coarse.lastBolts()).toHaveLength(1);
    coarse.lightning.destroy();
  });

  it('stops mid-strike without leaving a frame, a timer or a lit icon', () => {
    const { lightning, runTimer, runFrame, timers, frames, lit } = setup();
    lightning.start();
    runTimer();
    runFrame(0);
    lightning.stop();
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(0);
    expect(lit()).toEqual([]);
    lightning.destroy();
  });

  it('halts on context loss and resumes once the context is restored', () => {
    const { lightning, canvas, runTimer, runFrame, timers, frames, create } = setup();
    lightning.start();
    runTimer();
    runFrame(0);
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(frames.size).toBe(0);

    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(create).toHaveBeenCalledTimes(2);
    expect(timers.size).toBe(1);
    lightning.destroy();
  });

  it('releases the context and every listener on destroy', () => {
    const { lightning, renderer, canvas, host } = setup({ finePointer: true });
    const canvasRemove = jest.spyOn(canvas, 'removeEventListener');
    const hostRemove = jest.spyOn(host, 'removeEventListener');
    lightning.start();
    lightning.destroy();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(canvasRemove).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
    expect(canvasRemove).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function));
    expect(hostRemove).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(hostRemove).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });
});
