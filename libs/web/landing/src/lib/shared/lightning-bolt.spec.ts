import { generateBoltPath, paintBolt, seededRandom } from './lightning-bolt';

describe('lightning-bolt', () => {
  it('gives the same bolt for the same seed, so server and client agree', () => {
    const a = generateBoltPath({ x: 0, y: 0 }, { x: 0, y: 100 }, seededRandom(42));
    const b = generateBoltPath({ x: 0, y: 0 }, { x: 0, y: 100 }, seededRandom(42));
    const c = generateBoltPath({ x: 0, y: 0 }, { x: 0, y: 100 }, seededRandom(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(17);
    expect(a[0]).toEqual({ x: 0, y: 0 });
    expect(a[16]).toEqual({ x: 0, y: 100 });
  });

  it('paints the three hero layers plus two forks and resets the context', () => {
    const calls: number[] = [];
    const context = {
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(() => calls.push(context.lineWidth)),
      lineWidth: 0,
      globalAlpha: 1,
      shadowBlur: 0,
    } as unknown as CanvasRenderingContext2D;
    const path = generateBoltPath({ x: 0, y: 0 }, { x: 1, y: 0 }, seededRandom(1));

    paintBolt(context, path, { x: 0, y: 0 }, { x: 100, y: 0 }, 1);

    expect(calls).toEqual([4, 1.6, 0.9, 0.75, 0.75]);
    expect(context.globalAlpha).toBe(1);
    expect(context.shadowBlur).toBe(0);
  });
});
