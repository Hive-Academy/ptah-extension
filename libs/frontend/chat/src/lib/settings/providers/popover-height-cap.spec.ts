import { capPopoverHeight } from './popover-height-cap';

describe('capPopoverHeight', () => {
  it('returns the room unchanged when it is at least the floor and fits', () => {
    expect(capPopoverHeight(459.7, 951)).toBe(459);
    expect(capPopoverHeight(160, 368)).toBe(160);
  });

  it('floors zero and negative room at 120 px', () => {
    expect(capPopoverHeight(0, 368)).toBe(120);
    expect(capPopoverHeight(-50, 368)).toBe(120);
  });

  it('falls back to the floor for non-finite input', () => {
    expect(capPopoverHeight(NaN, 368)).toBe(120);
    expect(capPopoverHeight(Infinity, 368)).toBe(120);
    expect(capPopoverHeight(200, NaN)).toBe(200);
    expect(capPopoverHeight(NaN, NaN)).toBe(120);
  });

  it('never exceeds the fit, so the whole panel stays inside the viewport, and never goes under 1 px', () => {
    expect(capPopoverHeight(300, 200)).toBe(200);
    expect(capPopoverHeight(0, 16)).toBe(16);
    expect(capPopoverHeight(0, 0)).toBe(1);
    expect(capPopoverHeight(-20, -6)).toBe(1);
  });
});
