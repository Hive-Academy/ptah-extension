/** @jest-environment jsdom */
import { PointerTilt, TiltTarget } from './pointer-tilt';

function canvasAt(left: number, bottom: number): { canvas: HTMLCanvasElement; rect: jest.SpyInstance } {
  const canvas = document.createElement('canvas');
  const rect = jest
    .spyOn(canvas, 'getBoundingClientRect')
    .mockReturnValue({ left, bottom, top: 0, right: 0, width: 0, height: 0, x: left, y: 0, toJSON: () => ({}) });
  return { canvas, rect };
}

function move(x: number, y: number): void {
  const event = new MouseEvent('pointermove', { clientX: x, clientY: y });
  window.dispatchEvent(event);
}

describe('PointerTilt', () => {
  let tilt: PointerTilt | undefined;

  afterEach(() => tilt?.detach());

  it('measures the canvas once, then again only after a scroll or invalidate', () => {
    const { canvas, rect } = canvasAt(100, 500);
    tilt = new PointerTilt(canvas, window);
    tilt.attach();
    const out: TiltTarget = { pointerX: 0, pointerY: 0 };
    move(150, 300);

    for (let i = 0; i < 10; i++) tilt.update(out, 0.016, 2, 0);
    expect(rect).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('scroll'));
    tilt.update(out, 0.016, 2, 0);
    expect(rect).toHaveBeenCalledTimes(2);

    tilt.invalidate();
    tilt.update(out, 0.016, 2, 0);
    expect(rect).toHaveBeenCalledTimes(3);
  });

  it('writes into the given object in drawing-buffer pixels, y up', () => {
    const { canvas } = canvasAt(100, 500);
    tilt = new PointerTilt(canvas, window);
    tilt.attach();
    const out: TiltTarget = { pointerX: 0, pointerY: 0 };
    move(150, 300);
    tilt.update(out, 0.016, 2, 0);

    expect(out.pointerX).toBeCloseTo(100);
    expect(out.pointerY).toBeCloseTo(400);
  });

  it('eases back to the origin and stops listening after detach', () => {
    const { canvas, rect } = canvasAt(0, 100);
    tilt = new PointerTilt(canvas, window);
    tilt.attach();
    const out: TiltTarget = { pointerX: 0, pointerY: 0 };
    move(10, 50);
    tilt.update(out, 0.016, 1, 0);
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    tilt.update(out, 0.016, 1, 0);
    expect(out.pointerX).toBeCloseTo(0);

    tilt.detach();
    move(40, 40);
    tilt.update(out, 0.016, 1, 0);
    expect(out.pointerX).toBeCloseTo(0);
    expect(rect).toHaveBeenCalledTimes(1);
  });
});
