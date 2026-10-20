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
    captionLead: 'Claude account',
    captionTail: '· cdef',
    caption: 'Claude account · cdef',
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
  });

  it('shows the state, reset line and source chips on the closed face', () => {
    const root = render(windowTile());
    const face = button(root).textContent ?? '';

    expect(face).toContain('5-hour');
    expect(
      button(root).querySelector('[data-testid="plan-limit-caption"]')
        ?.textContent,
    ).toBe('Claude account· cdef');
    expect(face).toContain('94% used');
    expect(face).toContain('resets 15:10 · in 3h 10m');
    expect(face).toContain('Near limit');
    expect(face).toContain('used · reset Provider API');
    expect(face).toContain('limit From error');
  });

  it('shows an accessible linear usage bar on a window row', () => {
    const root = render(windowTile());
    const progress = root.querySelector<HTMLElement>(
      '[data-testid="plan-limit-progress"]',
    );
    const fill = root.querySelector<HTMLElement>(
      '[data-testid="plan-limit-progress-fill"]',
    );

    expect(progress?.getAttribute('role')).toBe('progressbar');
    expect(progress?.getAttribute('aria-valuenow')).toBe('94');
    expect(progress?.getAttribute('aria-valuemin')).toBe('0');
    expect(progress?.getAttribute('aria-valuemax')).toBe('100');
    expect(progress?.getAttribute('aria-valuetext')).toBe('94% used');
    expect(progress?.getAttribute('aria-label')).toBe('5-hour plan usage');
    expect(progress?.getAttribute('title')).toContain('resets 15:10');
    expect(fill?.classList.contains('bg-warning')).toBe(true);
    expect(fill?.style.width).toBe('94%');
  });

  it('fills the bar by severity: success below 75%, warning from 75%', () => {
    const calm = render(
      windowTile({ tone: 'neutral', window: { ...NEAR_WINDOW, percent: 40 } }),
    );
    expect(
      calm.querySelector('[data-testid="plan-limit-progress-fill"]')?.className,
    ).toContain('bg-success');
    TestBed.resetTestingModule();

    const hot = render(
      windowTile({ tone: 'neutral', window: { ...NEAR_WINDOW, percent: 75 } }),
    );
    expect(
      hot.querySelector('[data-testid="plan-limit-progress-fill"]')?.className,
    ).toContain('bg-warning');
  });

  it('omits the caption and the shared source chips the section header shows', () => {
    const root = render(windowTile());
    fixture.componentRef.setInput('captionShared', true);
    fixture.componentRef.setInput('sharedSources', [
      'used · reset Provider API',
      'limit From error',
    ]);
    fixture.detectChanges();

    expect(root.querySelector('[data-testid="plan-limit-caption"]')).toBeNull();
    expect(button(root).textContent).not.toContain('Provider API');
    expect(button(root).textContent).not.toContain('From error');

    // A row whose sources differ from the shared list keeps its own chips.
    fixture.componentRef.setInput('sharedSources', ['Provider API']);
    fixture.detectChanges();
    expect(button(root).textContent).toContain('used · reset Provider API');
  });

  it('renders a status row on one line, without a bar or disclosure', () => {
    const root = render(
      windowTile({
        id: 'plan-status:none',
        kind: 'status',
        label: 'Usage',
        value: 'Unavailable',
        resetLine: 'owner not resolved',
        chip: undefined,
        tone: 'neutral',
        sourceChips: [],
        window: undefined,
        detailLines: ['Account not resolved yet.'],
      }),
    );
    const status = root.querySelector('[data-testid="plan-limit-status"]');

    expect(status?.textContent?.trim()).toBe(
      'Unavailable · owner not resolved',
    );
    expect(status?.getAttribute('title')).toBe('Account not resolved yet.');
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    expect(button(root).disabled).toBe(true);
    expect(button(root).getAttribute('aria-expanded')).toBeNull();
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
    expect(caption?.getAttribute('title')).toBe('Claude account · cdef');

    // An open row shows its whole caption, so it may wrap.
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(lead?.classList.contains('truncate')).toBe(false);
    expect(caption?.getAttribute('title')).toBe('Claude account · cdef');
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

  it('when open, shows the facts the face does not have', () => {
    const root = render(windowTile(), true);
    const text = panel(root).textContent ?? '';

    expect(button(root).getAttribute('aria-expanded')).toBe('true');
    expect(panel(root).hidden).toBe(false);
    expect(text).toContain('Resets today 15:10 UTC · in 3h 10m');
  });

  it('when open, the panel never repeats the face summary', () => {
    const root = render(windowTile(), true);
    const text = panel(root).textContent ?? '';

    // The face already shows the label, usage bar, value, chip and source
    // chips, so the panel shows only the reset facts (previous test).
    expect(text).not.toContain('5-hour');
    expect(text).not.toContain('94% used');
    expect(text).not.toContain('Near limit');
    expect(text).not.toContain('used · reset Provider API');
    expect(text).not.toContain('limit From error');
    expect(panel(root).querySelector('[role="meter"]')).toBeNull();
    expect(root.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
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

  it('renders local token and cost accounting without a usage bar', () => {
    const root = render(
      windowTile({
        id: 'local-usage:opencode#account:0123456789abcdef',
        kind: 'local-usage',
        label: 'Local usage: tokens & estimated cost',
        value: '1,234 tokens · $5.67',
        resetLine: 'Local CLI accounting',
        tone: 'neutral',
        window: undefined,
        detailLines: [],
      }),
    );

    expect(button(root).textContent).toContain(
      'Local usage: tokens & estimated cost',
    );
    expect(button(root).textContent).toContain('1,234 tokens · $5.67');
    expect(
      root.querySelector('[data-testid="plan-limit-progress"]'),
    ).toBeNull();
    expect(button(root).getAttribute('aria-expanded')).toBeNull();
  });

  it.each(['aged', 'not-confirmed'] as const)(
    'shows the %s state chip on the closed row',
    (state) => {
      const root = render(
        windowTile({
          chip: { tone: 'warning', text: state },
          window: { ...NEAR_WINDOW, state },
        }),
      );

      expect(
        root.querySelector('[data-testid="plan-limit-chip"]')?.textContent,
      ).toContain(state);
    },
  );

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

  it('uses semantic colour only for the row accent and the bar fill, never text', () => {
    const root = render(windowTile({ tone: 'error' }));
    const fill = root.querySelector('[data-testid="plan-limit-progress-fill"]');

    expect(button(root).className).toContain('border-error');
    expect(fill?.className).toContain('bg-error');
    expect(root.innerHTML).not.toMatch(/text-(error|warning|success|info)\b/);
  });
});

describe('PlanLimitTileComponent (variant="inspector")', () => {
  let fixture: ComponentFixture<PlanLimitTileComponent>;

  const UNKNOWN_WINDOW: PlanWindowDetailModel = {
    ...NEAR_WINDOW,
    state: 'usage-unknown',
    chip: { tone: 'neutral', glyph: '?', text: 'Usage unknown' },
    usedText: 'unknown',
    percent: undefined,
  };

  function statusTile(): PlanLimitTileModel {
    return windowTile({
      id: 'plan-status:none',
      kind: 'status',
      label: 'Usage',
      value: 'Unavailable',
      resetLine: 'owner not resolved',
      chip: undefined,
      tone: 'neutral',
      sourceChips: [],
      window: undefined,
      detailLines: ['Account not resolved yet.'],
    });
  }

  function localUsageTile(): PlanLimitTileModel {
    return windowTile({
      id: 'local-usage:opencode#account:0123456789abcdef',
      kind: 'local-usage',
      label: 'Local usage: tokens & estimated cost',
      value: '1,234 tokens · $5.67',
      resetLine: 'Local CLI accounting',
      chip: undefined,
      tone: 'neutral',
      window: undefined,
      detailLines: [],
    });
  }

  function unknownTile(): PlanLimitTileModel {
    return windowTile({
      value: 'unknown',
      tone: 'neutral',
      chip: UNKNOWN_WINDOW.chip,
      window: UNKNOWN_WINDOW,
    });
  }

  function render(tile: PlanLimitTileModel, open = false): HTMLElement {
    TestBed.configureTestingModule({ imports: [PlanLimitTileComponent] });
    fixture = TestBed.createComponent(PlanLimitTileComponent);
    fixture.componentRef.setInput('tile', tile);
    fixture.componentRef.setInput('variant', 'inspector');
    fixture.componentRef.setInput('open', open);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function byTestId(root: ParentNode, id: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!found) throw new Error(`no ${id}`);
    return found;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('wraps the face and the panel in one card container (AC 7.6)', () => {
    const root = render(windowTile());
    const card = byTestId(root, 'plan-limit-card');
    const face = byTestId(root, 'plan-limit-tile');
    const panel = byTestId(root, 'plan-limit-panel');

    expect(card.parentElement).toBe(root);
    expect(face.parentElement).toBe(card);
    expect(panel.parentElement).toBe(card);
    expect(face.nextElementSibling).toBe(panel);
    expect(face.contains(panel)).toBe(false);
    for (const cls of [
      'w-full',
      'relative',
      'overflow-hidden',
      'rounded-md',
      'border',
      'border-surface-border',
      'bg-surface-1',
      'border-l-2',
      'border-l-warning',
    ]) {
      expect(card.classList).toContain(cls);
    }
    // Left-edge accent only: no second all-edge border colour on the card.
    expect(card.classList).not.toContain('border-warning');
    expect(card.className).not.toContain('min-h-[56px]');
    expect(card.className).not.toContain('pr-5');
  });

  it('puts the label and chip in the header and the centre on its own row (AC 7.2)', () => {
    const root = render(windowTile());
    const header = byTestId(root, 'plan-limit-card-header');
    const label = byTestId(root, 'plan-limit-label');
    const chip = byTestId(root, 'plan-limit-chip');
    const progress = byTestId(root, 'plan-limit-progress');
    const centre = byTestId(root, 'plan-limit-card-centre');

    expect(header.contains(label)).toBe(true);
    expect(header.contains(chip)).toBe(true);
    expect(label.textContent).toBe('5-hour');
    expect(label.getAttribute('title')).toBe('5-hour');
    expect(chip.textContent).toContain('Near limit');
    expect(header.contains(progress)).toBe(false);
    expect(centre.parentElement).toBe(header.parentElement);
    expect(centre.contains(progress)).toBe(true);
    expect(centre.classList).toContain('mt-2');
    // The chevron sits in flow inside the header, not absolutely placed.
    const chevron = header.querySelector('lucide-angular');
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
    expect(chevron?.className).not.toContain('absolute');
  });

  it('puts the status text on its own wrapping row without the strip indent (AC 7.3)', () => {
    const root = render(statusTile());
    const status = byTestId(root, 'plan-limit-status');
    const header = byTestId(root, 'plan-limit-card-header');

    expect(status.textContent?.trim()).toBe('Unavailable · owner not resolved');
    expect(status.getAttribute('title')).toBe('Account not resolved yet.');
    expect(header.contains(status)).toBe(false);
    expect(status.parentElement).toBe(header.parentElement);
    expect(status.classList).toContain('block');
    expect(status.classList).toContain('break-words');
    expect(root.innerHTML).not.toContain('pl-[4.5rem]');
  });

  it('keeps an accessible h-2 usage bar beside the value, reset line below (AC 7.4)', () => {
    const root = render(windowTile());
    const progress = byTestId(root, 'plan-limit-progress');
    const value = byTestId(root, 'plan-limit-tile-value');
    const reset = byTestId(root, 'plan-limit-reset');

    expect(progress.getAttribute('role')).toBe('progressbar');
    expect(progress.getAttribute('aria-valuenow')).toBe('94');
    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuemax')).toBe('100');
    expect(progress.getAttribute('aria-valuetext')).toBe('94% used');
    expect(progress.getAttribute('aria-label')).toBe('5-hour plan usage');
    expect(progress.classList).toContain('h-2');
    expect(progress.classList).not.toContain('h-1.5');
    expect(byTestId(root, 'plan-limit-progress-fill').style.width).toBe('94%');
    expect(value.textContent).toBe('94% used');
    expect(value.parentElement).toBe(progress.parentElement);
    expect(reset.textContent).toBe('resets 15:10 · in 3h 10m');
    expect(progress.parentElement?.contains(reset)).toBe(false);
  });

  it('renders an unknown 5-hour window as an expandable card with no bar, never 0 (decision 8)', () => {
    const root = render(unknownTile());
    const face = byTestId(root, 'plan-limit-tile');
    const centre = byTestId(root, 'plan-limit-card-centre');

    expect(face.tagName).toBe('BUTTON');
    expect(face.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    expect(byTestId(root, 'plan-limit-chip').textContent).toContain(
      'Usage unknown',
    );
    expect(byTestId(centre, 'plan-limit-tile-value').textContent).toBe(
      'unknown',
    );
    expect(centre.textContent).toContain('· resets 15:10 · in 3h 10m');
    expect(centre.classList).toContain('break-words');
    expect(root.textContent).not.toMatch(/\b0%/);
  });

  it('shows the caption and own sources inside the card, omitted when shared (AC 7.5)', () => {
    const root = render(windowTile());
    const card = byTestId(root, 'plan-limit-card');
    const footer = byTestId(root, 'plan-limit-card-footer');
    const caption = byTestId(root, 'plan-limit-caption');

    expect(card.contains(footer)).toBe(true);
    expect(footer.contains(caption)).toBe(true);
    expect(caption.getAttribute('title')).toBe('Claude account · cdef');
    expect(caption.firstElementChild?.classList).toContain('truncate');
    expect(footer.textContent).toContain('used · reset Provider API');
    expect(footer.textContent).toContain('limit From error');

    fixture.componentRef.setInput('captionShared', true);
    fixture.componentRef.setInput('sharedSources', [
      'used · reset Provider API',
      'limit From error',
    ]);
    fixture.detectChanges();

    expect(root.querySelector('[data-testid="plan-limit-caption"]')).toBeNull();
    expect(
      root.querySelector('[data-testid="plan-limit-card-footer"]'),
    ).toBeNull();

    // A card whose sources differ from the shared list keeps its own chips.
    fixture.componentRef.setInput('sharedSources', ['Provider API']);
    fixture.detectChanges();
    expect(byTestId(root, 'plan-limit-card-footer').textContent).toContain(
      'used · reset Provider API',
    );
  });

  it('toggles through the host and controls a panel inside the card (AC 7.6)', () => {
    const root = render(windowTile());
    const emitted = jest.fn();
    fixture.componentInstance.toggled.subscribe(emitted);
    const face = byTestId(root, 'plan-limit-tile') as HTMLButtonElement;
    const panel = byTestId(root, 'plan-limit-panel');

    expect(face.type).toBe('button');
    expect(face.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.id).toMatch(/^ptah-stats-tile-panel-\d+$/);
    expect(byTestId(root, 'plan-limit-card').contains(panel)).toBe(true);
    expect(panel.hidden).toBe(true);
    expect(panel.textContent?.trim()).toBe('');
    expect(panel.classList).toContain('border-t');

    face.click();
    expect(emitted).toHaveBeenCalledTimes(1);
    // The open state belongs to the host; a click alone does not open it.
    expect(face.getAttribute('aria-expanded')).toBe('false');

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(face.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('Resets today 15:10 UTC · in 3h 10m');
    // An open card shows its whole caption, so it may wrap.
    expect(
      byTestId(root, 'plan-limit-caption').firstElementChild?.classList,
    ).not.toContain('truncate');
  });

  it.each([
    ['status', statusTile],
    ['local-usage', localUsageTile],
  ] as const)(
    'renders a %s card with no button, chevron, aria-expanded or panel (AC 7.6)',
    (_kind, make) => {
      const root = render(make(), true);
      const face = byTestId(root, 'plan-limit-tile');

      expect(face.tagName).toBe('DIV');
      expect(face.parentElement).toBe(byTestId(root, 'plan-limit-card'));
      expect(face.classList).toContain('p-2.5');
      expect(root.querySelector('button')).toBeNull();
      expect(root.querySelector('lucide-angular')).toBeNull();
      expect(root.querySelector('[aria-expanded]')).toBeNull();
      expect(root.querySelector('[aria-controls]')).toBeNull();
      expect(root.querySelector('[data-testid="plan-limit-panel"]')).toBeNull();
    },
  );

  it('renders local usage text in the centre row without a bar', () => {
    const root = render(localUsageTile());
    const centre = byTestId(root, 'plan-limit-card-centre');

    expect(byTestId(root, 'plan-limit-label').textContent).toBe(
      'Local usage: tokens & estimated cost',
    );
    expect(byTestId(centre, 'plan-limit-tile-value').textContent).toBe(
      '1,234 tokens · $5.67',
    );
    expect(centre.textContent).toContain('Local CLI accounting');
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('keeps every e2e hook and data-tile-id (AC 7.7)', () => {
    const root = render(windowTile(), true);

    for (const id of [
      'plan-limit-tile',
      'plan-limit-progress',
      'plan-limit-progress-fill',
      'plan-limit-tile-value',
      'plan-limit-chip',
      'plan-limit-caption',
      'plan-limit-panel',
    ]) {
      expect(root.querySelectorAll(`[data-testid="${id}"]`)).toHaveLength(1);
    }
    expect(root.getAttribute('data-tile-id')).toBe(
      'plan:claude-cli#account:0123456789abcdef:five_hour',
    );
    // The lane link (`InspectorLimitsLanesComponent.openPlanTile`) focuses
    // the first button inside the tile: it must be the disclosure face.
    expect(root.querySelector('button')).toBe(
      byTestId(root, 'plan-limit-tile'),
    );
    TestBed.resetTestingModule();

    const status = render(statusTile());
    expect(byTestId(status, 'plan-limit-status').textContent).toContain(
      'Unavailable',
    );
    expect(status.getAttribute('data-tile-id')).toBe('plan-status:none');
  });

  it('carries the class-level overflow guards (AC 7.9, structural only)', () => {
    // Measured overflow (scrollWidth <= clientWidth at dock 300/560 and the
    // 760 sheet) needs layout, which jsdom lacks: a QA item (D-I).
    const root = render(windowTile());
    const header = byTestId(root, 'plan-limit-card-header');
    const label = byTestId(root, 'plan-limit-label');
    const value = byTestId(root, 'plan-limit-tile-value');

    expect(header.classList).toContain('min-w-0');
    expect(label.classList).toContain('min-w-0');
    expect(label.classList).toContain('truncate');
    expect(byTestId(root, 'plan-limit-chip').className).toContain('shrink-0');
    expect(value.classList).toContain('whitespace-nowrap');
    expect(
      value.parentElement?.querySelector('[role="progressbar"]'),
    ).toBeTruthy();
    expect(root.innerHTML).not.toContain('pl-[4.5rem]');
    TestBed.resetTestingModule();

    const unknown = render(unknownTile());
    expect(byTestId(unknown, 'plan-limit-card-centre').classList).toContain(
      'break-words',
    );
    expect(
      byTestId(unknown, 'plan-limit-tile-value').classList,
    ).not.toContain('whitespace-nowrap');
    expect(unknown.innerHTML).not.toContain('pl-[4.5rem]');
    TestBed.resetTestingModule();

    const status = render(statusTile());
    expect(byTestId(status, 'plan-limit-status').classList).toContain(
      'break-words',
    );
    expect(status.innerHTML).not.toContain('pl-[4.5rem]');
  });

  it('uses semantic colour only for the card accent and the bar fill, never text', () => {
    const root = render(windowTile({ tone: 'error' }));

    expect(byTestId(root, 'plan-limit-card').classList).toContain(
      'border-l-error',
    );
    expect(byTestId(root, 'plan-limit-progress-fill').className).toContain(
      'bg-error',
    );
    expect(root.innerHTML).not.toMatch(/text-(error|warning|success|info)\b/);
  });
});
