import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  PlanRingComponent,
  planRingCaption,
  type PlanRingData,
} from './plan-ring.component';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('planRingCaption', () => {
  it('formats the reset delay after the label', () => {
    expect(
      planRingCaption({
        percent: 38,
        label: '5h window',
        resetsInMs: 2 * HOUR + 14 * MINUTE,
      }),
    ).toBe('5h window · resets in 2h 14m');
  });

  it('returns only the label when the reset time is unknown', () => {
    expect(
      planRingCaption({ percent: 38, label: '5h window', resetsInMs: null }),
    ).toBe('5h window');
  });

  it.each([
    [30 * 1000, 'resets in <1m'],
    [14 * MINUTE, 'resets in 14m'],
    [3 * HOUR, 'resets in 3h'],
    [3 * DAY + 4 * HOUR + 10 * MINUTE, 'resets in 3d 4h'],
    [2 * DAY, 'resets in 2d'],
    [0, 'resets now'],
  ])('formats %d ms as "%s"', (ms, expected) => {
    expect(
      planRingCaption({ percent: 10, label: 'Weekly', resetsInMs: ms }),
    ).toBe(`Weekly · ${expected}`);
  });
});

describe('PlanRingComponent', () => {
  let fixture: ComponentFixture<PlanRingComponent>;
  let host: HTMLElement;

  function render(ring: PlanRingData | null): void {
    fixture.componentRef.setInput('ring', ring);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanRingComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(PlanRingComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('renders nothing when the ring is null', () => {
    render(null);

    expect(host.querySelector('ptah-progress-ring')).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'renders nothing when the percent is %s',
    (percent) => {
      render({ percent, label: '5h window', resetsInMs: HOUR });

      expect(host.querySelector('ptah-progress-ring')).toBeNull();
    },
  );

  it('wraps a teal value-size ring with the percent as centre text', () => {
    render({ percent: 38.4, label: '5h window', resetsInMs: 2 * HOUR });

    const ring = host.querySelector('ptah-progress-ring') as HTMLElement;
    expect(ring.getAttribute('data-tone')).toBe('teal');
    expect(ring.getAttribute('data-size')).toBe('value');
    expect(ring.querySelector('.ptah-ring__value')?.textContent).toBe('38%');
    expect(ring.getAttribute('aria-label')).toBe(
      '38% used. 5h window · resets in 2h',
    );
  });

  it('renders no caption of its own', () => {
    render({ percent: 50, label: '5h window', resetsInMs: HOUR });

    expect(host.textContent).not.toContain('5h window');
    expect(host.querySelector('.ptah-ring__sub')).toBeNull();
  });

  it('clamps the percent to 0-100', () => {
    render({ percent: 140, label: 'Weekly', resetsInMs: null });

    expect(host.querySelector('.ptah-ring__value')?.textContent).toBe('100%');
  });
});
