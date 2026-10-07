import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PlanLimitTileComponent } from './plan-limit-tile.component';
import type {
  PlanLimitTileModel,
  PlanWindowDetailModel,
} from './stats-limit-view-model.types';

const NEAR_WINDOW: PlanWindowDetailModel = {
  windowKey: 'five_hour',
  label: '5-hour',
  state: 'near-limit',
  chip: { tone: 'warning', glyph: '▲', text: 'Near limit' },
  usedText: '94% used',
  percent: 94,
  resetFacts: ['Resets today 15:10 UTC · in 3h 10m'],
  sourceChips: ['Provider API'],
};

function windowTile(
  overrides: Partial<PlanLimitTileModel> = {},
): PlanLimitTileModel {
  return {
    id: 'plan:claude-cli#account:0123456789abcdef:five_hour',
    kind: 'window',
    label: '5-hour',
    captionLead: 'Claude account plan limit',
    captionTail: '· cdef',
    caption: 'Claude account plan limit · cdef',
    value: '94% used',
    resetLine: 'resets 15:10 · in 3h 10m',
    chip: NEAR_WINDOW.chip,
    tone: 'warning',
    sourceChips: ['used · reset Provider API', 'limit From error'],
    window: NEAR_WINDOW,
    detailLines: [],
    ...overrides,
  };
}

describe('PlanLimitTileComponent', () => {
  let fixture: ComponentFixture<PlanLimitTileComponent>;

  function render(tile: PlanLimitTileModel, open = false): HTMLElement {
    TestBed.configureTestingModule({ imports: [PlanLimitTileComponent] });
    fixture = TestBed.createComponent(PlanLimitTileComponent);
    fixture.componentRef.setInput('tile', tile);
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function button(root: HTMLElement): HTMLButtonElement {
    const found = root.querySelector<HTMLButtonElement>(
      '[data-testid="plan-limit-tile"]',
    );
    if (!found) throw new Error('no tile button');
    return found;
  }

  function panel(root: HTMLElement): HTMLElement {
    const found = root.querySelector<HTMLElement>(
      '[data-testid="plan-limit-panel"]',
    );
    if (!found) throw new Error('no panel');
    return found;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('is a native disclosure button whose panel is the next sibling', () => {
    const root = render(windowTile());
    const face = button(root);

    // A native <button type="button"> gets Enter and Space activation and a
    // Tab stop from the platform; no key handler is needed or added.
    expect(face.tagName).toBe('BUTTON');
    expect(face.type).toBe('button');
    expect(face.getAttribute('aria-expanded')).toBe('false');
    expect(face.nextElementSibling).toBe(panel(root));
    expect(face.getAttribute('aria-controls')).toBe(panel(root).id);
    expect(panel(root).id).toMatch(/^ptah-stats-tile-panel-\d+$/);
  });

  it('starts closed: the panel is hidden and its detail is not rendered', () => {
    const root = render(windowTile());

    expect(panel(root).hidden).toBe(true);
    expect(root.querySelector('[role="meter"]')).toBeNull();
    expect(root.classList.contains('col-span-full')).toBe(false);
  });

  it('shows the state, reset line and source chips on the closed face', () => {
    const root = render(windowTile());
    const face = button(root).textContent ?? '';

    expect(face).toContain('5-hour');
    expect(
      button(root).querySelector('[data-testid="plan-limit-caption"]')
        ?.textContent,
    ).toBe('Claude account plan limit· cdef');
    expect(face).toContain('94% used');
    expect(face).toContain('resets 15:10 · in 3h 10m');
    expect(face).toContain('Near limit');
    expect(face).toContain('used · reset Provider API');
    expect(face).toContain('limit From error');
  });

  it('shows an accessible radial usage gauge on a window tile', () => {
    const root = render(windowTile());
    const progress = root.querySelector<HTMLElement>(
      '[data-testid="plan-limit-radial-progress"]',
    );

    expect(progress?.getAttribute('aria-valuenow')).toBe('94');
    expect(progress?.classList.contains('radial-progress')).toBe(true);
    expect(progress?.classList.contains('text-warning')).toBe(true);
    expect(progress?.style.getPropertyValue('--value')).toBe('94');
    expect(progress?.getAttribute('title')).toContain('resets 15:10');
  });

  it('truncates the closed caption to one line and titles the full text', () => {
    const root = render(windowTile());
    const caption = button(root).querySelector(
      '[data-testid="plan-limit-caption"]',
    );

    const lead = caption?.firstElementChild;
    const tail = caption?.lastElementChild;

    expect(caption?.classList.contains('flex')).toBe(true);
    expect(caption?.classList.contains('gap-1')).toBe(true);
    expect(lead?.classList.contains('truncate')).toBe(true);
    expect(tail?.classList.contains('shrink-0')).toBe(true);
    expect(tail?.textContent?.trim()).toBe('· cdef');
    expect(tail?.textContent).toBe('· cdef');
    expect(caption?.getAttribute('title')).toBe(
      'Claude account plan limit · cdef',
    );

    // An open tile spans both columns, so its caption may keep wrapping.
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(lead?.classList.contains('truncate')).toBe(false);
    expect(caption?.getAttribute('title')).toBe(
      'Claude account plan limit · cdef',
    );
  });

  it('hides the chip glyph and the chevron from assistive technology', () => {
    const root = render(windowTile());
    const chip = root.querySelector('[data-testid="plan-limit-chip"]');
    const glyph = chip?.querySelector('[aria-hidden="true"]');

    expect(glyph?.textContent?.trim()).toBe('▲');
    expect(
      root.querySelector('lucide-angular')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('emits toggled on activation and leaves the open state to the host', () => {
    const root = render(windowTile());
    const emitted = jest.fn();
    fixture.componentInstance.toggled.subscribe(emitted);

    button(root).click();
    fixture.detectChanges();

    expect(emitted).toHaveBeenCalledTimes(1);
    expect(button(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('when open, spans the grid and shows the facts the face does not have', () => {
    const root = render(windowTile(), true);
    const text = panel(root).textContent ?? '';

    expect(button(root).getAttribute('aria-expanded')).toBe('true');
    expect(panel(root).hidden).toBe(false);
    expect(root.classList.contains('col-span-full')).toBe(true);
    expect(text).toContain('Resets today 15:10 UTC · in 3h 10m');
  });

  it('when open, the panel never repeats the face summary', () => {
    const root = render(windowTile(), true);
    const text = panel(root).textContent ?? '';

    // The face already shows the label, value, chip and source chips, so the
    // panel shows only the reset facts (previous test).
    expect(text).not.toContain('5-hour');
    expect(text).not.toContain('94% used');
    expect(text).not.toContain('Near limit');
    expect(text).not.toContain('used · reset Provider API');
    expect(text).not.toContain('limit From error');
    expect(root.querySelectorAll('[role="meter"]')).toHaveLength(1);
  });

  it('never draws a meter for an unknown used value (unknown is never 0)', () => {
    const unknown: PlanWindowDetailModel = {
      ...NEAR_WINDOW,
      state: 'usage-unknown',
      chip: { tone: 'neutral', glyph: '?', text: 'Usage unknown' },
      usedText: 'unknown',
      percent: undefined,
    };
    const root = render(
      windowTile({ value: 'unknown', tone: 'neutral', window: unknown }),
      true,
    );

    expect(root.querySelector('[role="meter"]')).toBeNull();
    expect(panel(root).textContent).not.toMatch(/\b0%/);
  });

  it('renders the detail lines of a non-window tile', () => {
    const root = render(
      windowTile({
        id: 'plan-cooldown:ollama-cloud#api-key:x',
        kind: 'cooldown',
        label: 'Cooldown',
        value: 'until 12:14',
        resetLine: 'retry delay, not a plan reset',
        chip: { tone: 'info', text: 'Cooldown' },
        tone: 'info',
        window: undefined,
        detailLines: ['Retry after today 12:14 UTC · in 14m'],
      }),
      true,
    );

    expect(panel(root).textContent).toContain(
      'Retry after today 12:14 UTC · in 14m',
    );
    expect(button(root).className).toContain('border-info');
  });

  it('uses semantic text colour only for the radial gauge fill', () => {
    const root = render(windowTile({ tone: 'error' }));
    const gauge = root.querySelector(
      '[data-testid="plan-limit-radial-progress"]',
    );

    expect(button(root).className).toContain('border-error');
    expect(gauge?.className).toContain('text-error');
  });
});
