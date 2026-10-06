import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PlanWindowDetailComponent } from './plan-window-detail.component';
import type { PlanWindowDetailModel } from './stats-limit-view-model.types';

const NEAR_WINDOW: PlanWindowDetailModel = {
  windowKey: 'five_hour',
  label: '5-hour',
  state: 'near-limit',
  chip: { tone: 'warning', glyph: '▲', text: 'Near limit' },
  usedText: '94% used',
  percent: 94,
  resetFacts: ['Resets today 15:10 UTC · in 3h 10m'],
  note: 'observed 10m ago',
  sourceChips: ['used · reset Provider API', 'limit From error'],
};

const UNKNOWN_WINDOW: PlanWindowDetailModel = {
  ...NEAR_WINDOW,
  state: 'usage-unknown',
  chip: { tone: 'neutral', glyph: '?', text: 'Usage unknown' },
  usedText: 'unknown',
  percent: undefined,
};

describe('PlanWindowDetailComponent', () => {
  let fixture: ComponentFixture<PlanWindowDetailComponent>;

  function render(
    window: PlanWindowDetailModel,
    showSummary?: boolean,
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [PlanWindowDetailComponent] });
    fixture = TestBed.createComponent(PlanWindowDetailComponent);
    fixture.componentRef.setInput('window', window);
    if (showSummary !== undefined) {
      fixture.componentRef.setInput('showSummary', showSummary);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const detail = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-testid="plan-window-detail"]');

  afterEach(() => TestBed.resetTestingModule());

  it('by default shows the summary: label, chip, meter, source chips and facts', () => {
    const root = render(NEAR_WINDOW);
    const text = detail(root)?.textContent ?? '';
    const meter = root.querySelector('[role="meter"]');

    expect(text).toContain('5-hour');
    expect(text).toContain('Near limit');
    expect(text).toContain('94% used');
    expect(text).toContain('used · reset Provider API');
    expect(text).toContain('limit From error');
    expect(text).toContain('Resets today 15:10 UTC · in 3h 10m');
    expect(text).toContain('observed 10m ago');
    expect(meter?.getAttribute('aria-valuenow')).toBe('94');
    expect(meter?.getAttribute('aria-valuetext')).toBe('94% used');
    expect(meter?.getAttribute('aria-label')).toBe('5-hour used');
  });

  it('never draws a meter for an unknown used value (unknown is never 0)', () => {
    const root = render(UNKNOWN_WINDOW);
    const text = detail(root)?.textContent ?? '';

    expect(root.querySelector('[role="meter"]')).toBeNull();
    expect(text).toContain('Used: unknown');
    expect(text).not.toMatch(/\b0%/);
  });

  it('with showSummary false, keeps only the meter from the summary', () => {
    const root = render(NEAR_WINDOW, false);
    const text = detail(root)?.textContent ?? '';

    expect(text).not.toContain('5-hour');
    expect(text).not.toContain('Near limit');
    expect(text).not.toContain('94% used');
    expect(text).not.toContain('used · reset Provider API');
    expect(text).not.toContain('limit From error');
    expect(root.querySelector('[role="meter"]')).not.toBeNull();
    expect(text).toContain('Resets today 15:10 UTC · in 3h 10m');
    expect(text).toContain('observed 10m ago');
  });

  it('with showSummary false and unknown usage, omits the meter and used text', () => {
    const root = render(UNKNOWN_WINDOW, false);
    const text = detail(root)?.textContent ?? '';

    expect(root.querySelector('[role="meter"]')).toBeNull();
    expect(text).not.toContain('Used: unknown');
  });
});
