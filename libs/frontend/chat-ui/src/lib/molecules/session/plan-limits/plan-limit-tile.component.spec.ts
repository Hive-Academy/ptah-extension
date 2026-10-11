import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PlanLimitTileComponent } from './plan-limit-tile.component';
import type { PlanLimitTileModel } from './stats-limit-view-model.types';

const tile: PlanLimitTileModel = {
  id: 'plan:claude:five_hour',
  kind: 'window',
  label: '5-hour',
  captionLead: 'Claude account plan limit',
  caption: 'Claude account plan limit · cdef',
  value: '94% used',
  resetLine: 'resets 15:10 · in 3h 10m',
  shortReset: 'in 3h 10m',
  chip: { tone: 'warning', text: 'Near limit' },
  tone: 'warning',
  sourceChips: ['Provider API'],
  detailLines: [],
  window: {
    windowKey: 'five_hour',
    label: '5-hour',
    state: 'near-limit',
    usedText: '94% used',
    percent: 94,
    resetFacts: ['Resets today 15:10 UTC · in 3h 10m'],
    note: 'observed 10m ago',
    sourceChips: ['Provider API'],
  },
};

describe('PlanLimitTileComponent', () => {
  let fixture: ComponentFixture<PlanLimitTileComponent>;
  function render(value: PlanLimitTileModel = tile, open = false): HTMLElement {
    TestBed.configureTestingModule({ imports: [PlanLimitTileComponent] });
    fixture = TestBed.createComponent(PlanLimitTileComponent);
    fixture.componentRef.setInput('tile', value);
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the compact limit and relative reset visible with a horizontal meter', () => {
    const root = render();
    const face = root.querySelector<HTMLButtonElement>(
      '[data-testid="plan-limit-tile"]',
    )!;
    expect(face.textContent).toContain('5-hour');
    expect(face.textContent).toContain('94%');
    expect(face.textContent).toContain('in 3h 10m');
    expect(face.textContent).not.toContain('Claude account');
    expect(face.textContent).not.toContain('Provider API');
    expect(
      face.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
    ).toBe('94');
    expect(
      face
        .querySelector('[role="progressbar"]')
        ?.getAttribute('aria-valuetext'),
    ).toContain('94% used, resets 15:10');
    expect(
      face
        .querySelector('[role="progressbar"]')
        ?.firstElementChild?.classList.contains('bg-warning'),
    ).toBe(true);
    expect(
      face.querySelector('[data-testid="plan-limit-face-status"]')?.textContent,
    ).toContain('Near limit');
    expect(face.querySelector('.radial-progress')).toBeNull();
    expect(face.getAttribute('aria-expanded')).toBe('false');
    expect(face.getAttribute('aria-controls')).toBe(
      root.querySelector('[data-testid="plan-limit-panel"]')?.id,
    );
    expect(face.className).toContain('focus-visible:outline');
  });

  it('shows structured account, usage, reset, status and source when expanded', () => {
    const root = render(tile, true);
    const panel = root.querySelector<HTMLElement>(
      '[data-testid="plan-limit-panel"]',
    )!;
    expect(root.classList.contains('col-span-full')).toBe(true);
    expect(panel.textContent).toContain('Claude account plan limit · cdef');
    expect(panel.textContent).toContain('Resets today 15:10 UTC');
    expect(panel.textContent).toContain('Near limit');
    expect(panel.textContent).toContain('Provider API');
    expect(
      panel
        .querySelector('[role="progressbar"]')
        ?.getAttribute('aria-valuenow'),
    ).toBe('94');
  });

  it('uses an em dash for unknown usage and emits a disclosure toggle', () => {
    const root = render({
      ...tile,
      window: { ...tile.window!, percent: undefined },
    });
    const face = root.querySelector<HTMLButtonElement>(
      '[data-testid="plan-limit-tile"]',
    )!;
    expect(face.querySelector('[role="progressbar"]')).toBeNull();
    expect(
      face.querySelector('[data-testid="plan-limit-tile-value"]')?.textContent,
    ).toBe('—');
    const toggled = jest.fn();
    fixture.componentInstance.toggled.subscribe(toggled);
    face.click();
    expect(toggled).toHaveBeenCalledTimes(1);
  });

  it('shows limit reached on the closed face with an error meter', () => {
    const root = render({
      ...tile,
      tone: 'error',
      chip: { tone: 'error', text: 'Limit reached' },
      window: { ...tile.window!, state: 'limit-reached', percent: 100 },
    });
    const face = root.querySelector('[data-testid="plan-limit-tile"]')!;
    expect(
      face.querySelector('[data-testid="plan-limit-face-status"]')?.textContent,
    ).toContain('Limit reached');
    expect(
      face
        .querySelector('[role="progressbar"]')
        ?.firstElementChild?.classList.contains('bg-error'),
    ).toBe(true);
  });

  it('shows stale status and hides the chevron on a local usage tile', () => {
    const stale = render({
      ...tile,
      kind: 'status',
      value: 'Stale',
      resetLine: 'cached data · refresh failed',
      window: undefined,
    });
    expect(
      stale.querySelector('[data-testid="plan-limit-tile"]')?.textContent,
    ).toContain('Stale');
    fixture.destroy();
    TestBed.resetTestingModule();
    const local = render({ ...tile, kind: 'local-usage', window: undefined });
    const face = local.querySelector<HTMLButtonElement>(
      '[data-testid="plan-limit-tile"]',
    )!;
    expect(face.disabled).toBe(true);
    expect(face.querySelector('lucide-angular')).toBeNull();
    expect(
      face
        .querySelector('[data-testid="plan-limit-tile-value"]')
        ?.textContent?.trim(),
    ).toBe(tile.value);
  });

  it.each(['aged', 'not-confirmed'] as const)(
    'shows %s state on the closed face',
    (state) => {
      const el = render({
        ...tile,
        chip: { tone: 'warning', text: state },
        window: { ...tile.window!, state },
      });
      expect(
        el.querySelector('[data-testid="plan-limit-tile"]')?.textContent,
      ).toContain(state);
    },
  );
});
