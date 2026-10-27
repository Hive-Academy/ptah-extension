import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ActivityGridComponent,
  activityLevels,
  type ActivityDay,
} from './activity-grid.component';

const TODAY = '2026-10-21';
const TODAY_ROW = new Date(Date.UTC(2026, 9, 21)).getUTCDay();

function daysAgo(n: number): string {
  return new Date(Date.UTC(2026, 9, 21) - n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

describe('activityLevels', () => {
  it('maps zero and negative values to level 0', () => {
    const level = activityLevels([1, 2, 3]);
    expect(level(0)).toBe(0);
    expect(level(-4)).toBe(0);
  });

  it('spreads distinct values across levels 1-4 by quantile', () => {
    const level = activityLevels([1, 2, 3, 4, 0, 0]);
    expect([1, 2, 3, 4].map(level)).toEqual([1, 2, 3, 4]);
  });

  it('is scale-free: the same ranks give the same levels', () => {
    const small = activityLevels([1, 2, 3, 4]);
    const large = activityLevels([100, 200, 300, 400]);
    expect(small(3)).toBe(large(300));
  });

  it('returns 0 for everything when no day is active', () => {
    expect(activityLevels([0, 0])(5)).toBe(0);
  });
});

describe('ActivityGridComponent', () => {
  let fixture: ComponentFixture<ActivityGridComponent>;
  let host: HTMLElement;

  function render(inputs: {
    days?: readonly ActivityDay[];
    today?: string;
    weeks?: number;
    mode?: 'history' | 'day-one';
    caption?: string | null;
  }): void {
    fixture.componentRef.setInput('days', inputs.days ?? []);
    fixture.componentRef.setInput('today', inputs.today ?? TODAY);
    fixture.componentRef.setInput('ariaLabel', '13-week activity');
    if (inputs.weeks !== undefined)
      fixture.componentRef.setInput('weeks', inputs.weeks);
    if (inputs.mode) fixture.componentRef.setInput('mode', inputs.mode);
    if (inputs.caption !== undefined)
      fixture.componentRef.setInput('caption', inputs.caption);
    fixture.detectChanges();
  }

  function cells(): SVGRectElement[] {
    return Array.from(host.querySelectorAll('rect.ptah-activity-grid__cell'));
  }

  function cell(date: string): SVGRectElement | null {
    return host.querySelector(`rect[data-date="${date}"]`);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActivityGridComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ActivityGridComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('is one image with the caller accessible name', () => {
    render({});

    const svg = host.querySelector('svg.ptah-activity-grid__svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('13-week activity');
  });

  it('draws 13 weeks × 7 days up to today, today in the last column', () => {
    render({});

    const drawn = cells();
    expect(drawn).toHaveLength(12 * 7 + TODAY_ROW + 1);
    const today = cell(TODAY) as SVGRectElement;
    expect(today.classList).toContain('ptah-activity-grid__today');
    expect(today.getAttribute('x')).toBe(String(12 * 26));
    expect(today.getAttribute('y')).toBe(String(TODAY_ROW * 26));
    expect(today.getAttribute('stroke-width')).toBe('2');
    expect(host.querySelectorAll('.ptah-activity-grid__today')).toHaveLength(1);
  });

  it('sizes the svg for 13 columns of 20 px cells with 6 px gaps', () => {
    render({});

    const svg = host.querySelector('svg.ptah-activity-grid__svg');
    expect(svg?.getAttribute('width')).toBe(String(13 * 26 - 6));
    expect(svg?.getAttribute('height')).toBe(String(7 * 26 - 6));
  });

  it('assigns quantile levels from the day values', () => {
    render({
      days: [
        { date: daysAgo(1), value: 1 },
        { date: daysAgo(2), value: 2 },
        { date: daysAgo(3), value: 3 },
        { date: daysAgo(4), value: 4 },
      ],
    });

    expect(cell(daysAgo(1))?.classList).toContain('h1');
    expect(cell(daysAgo(4))?.classList).toContain('h4');
    expect(cell(daysAgo(10))?.classList).toContain('h0');
  });

  it('sums duplicate days and ignores days outside the window', () => {
    render({
      days: [
        { date: daysAgo(1), value: 1 },
        { date: daysAgo(1), value: 3 },
        { date: daysAgo(2), value: 2 },
        { date: daysAgo(400), value: 999 },
      ],
    });

    expect(cell(daysAgo(1))?.classList).toContain('h4');
    expect(cell(daysAgo(400))).toBeNull();
  });

  it('honours a custom week count', () => {
    render({ weeks: 2 });

    expect(cells()).toHaveLength(7 + TODAY_ROW + 1);
  });

  it.each(['2026-13-40', '2026-02-30', 'not a date', ''])(
    'renders nothing, not even the labelled image, for today = "%s"',
    (today) => {
      render({ today, caption: '214 sessions · 90 days' });

      expect(cells()).toHaveLength(0);
      expect(host.querySelector('[role="img"]')).toBeNull();
      expect(host.textContent?.trim()).toBe('');
    },
  );

  it('draws the calm day-one field: no data levels, opacity fading from today', () => {
    render({ mode: 'day-one', days: [{ date: daysAgo(1), value: 9 }] });

    expect(cells().every((rect) => rect.classList.contains('h0'))).toBe(true);
    expect(cell(TODAY)?.getAttribute('opacity')).toBeNull();
    const near = Number(cell(daysAgo(7))?.getAttribute('opacity'));
    const far = Number(cell(daysAgo(84))?.getAttribute('opacity'));
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0.12);
    expect(host.querySelector('.ptah-activity-grid__legend')).toBeNull();
  });

  it('shows the caption and a decorative legend in history mode', () => {
    render({ caption: '214 sessions · 90 days' });

    expect(host.textContent).toContain('214 sessions · 90 days');
    expect(
      host
        .querySelector('.ptah-activity-grid__legend')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('binds no per-cell event listener', () => {
    render({});

    const debugCells = fixture.debugElement.queryAll(
      (node) =>
        node.nativeNode instanceof Element &&
        node.nativeNode.classList.contains('ptah-activity-grid__cell'),
    );
    expect(debugCells.length).toBeGreaterThan(0);
    expect(debugCells.every((node) => node.listeners.length === 0)).toBe(true);
  });
});
