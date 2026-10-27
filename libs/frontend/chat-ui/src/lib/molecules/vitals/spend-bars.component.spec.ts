import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpendBarsComponent } from './spend-bars.component';

describe('SpendBarsComponent', () => {
  let fixture: ComponentFixture<SpendBarsComponent>;
  let host: HTMLElement;

  function render(values: readonly (number | null)[]): void {
    fixture.componentRef.setInput('values', values);
    fixture.componentRef.setInput('ariaLabel', 'Spend, last 7 days');
    fixture.detectChanges();
  }

  function bars(): SVGRectElement[] {
    return Array.from(host.querySelectorAll('rect.ptah-spend-bars__bar'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpendBarsComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SpendBarsComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('is one image with the caller accessible name', () => {
    render([1, 2]);

    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Spend, last 7 days');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws one bar per value scaled to the maximum, last highlighted', () => {
    render([0.8, 1.6, 2.9, 0.4, 3.1, 2.2, 1.4]);

    const rects = bars();
    expect(rects).toHaveLength(7);
    const heights = rects.map((rect) => Number(rect.getAttribute('height')));
    expect(Math.max(...heights)).toBe(heights[4]);
    expect(heights[4]).toBe(24);
    const highlighted = rects.filter((rect) =>
      rect.classList.contains('ptah-spend-bars--last'),
    );
    expect(highlighted).toEqual([rects[6]]);
  });

  it('draws a dot for a null day', () => {
    render([1, null, 2]);

    expect(bars()).toHaveLength(2);
    const dots = host.querySelectorAll('circle.ptah-spend-bars__dot');
    expect(dots).toHaveLength(1);
  });

  it('draws flat minimum bars when every value is zero', () => {
    render([0, 0, 0]);

    const heights = bars().map((rect) => rect.getAttribute('height'));
    expect(heights).toEqual(['3', '3', '3']);
  });

  it('draws nothing for an empty series', () => {
    render([]);

    expect(host.querySelectorAll('rect, circle')).toHaveLength(0);
  });

  it('keeps every bar inside the viewbox', () => {
    render([5, 1, 3, 2]);

    for (const rect of bars()) {
      const x = Number(rect.getAttribute('x'));
      const width = Number(rect.getAttribute('width'));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(64.0001);
    }
  });
});
