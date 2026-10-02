import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  MAX_MODEL_SUGGESTIONS,
  ProviderModelSearchFieldComponent,
  type ProviderModelSearchOption,
} from './provider-model-search-field.component';

// Floating UI measures real layout, which jsdom does not have.
jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

describe('ProviderModelSearchFieldComponent', () => {
  const OPTIONS: ProviderModelSearchOption[] = [
    { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', supportsToolUse: true },
    { id: 'gpt-5-mini', name: 'GPT-5 mini', supportsToolUse: false },
    { id: 'kimi-k2', name: 'Kimi K2', supportsToolUse: true },
  ];

  let fixture: ComponentFixture<ProviderModelSearchFieldComponent>;
  let emitted: string[];

  beforeEach(async () => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      writable: true,
      configurable: true,
      value: jest.fn(),
    });
    await TestBed.configureTestingModule({
      imports: [ProviderModelSearchFieldComponent],
    }).compileComponents();
  });

  function create(
    inputs: Partial<Record<string, unknown>> = {},
  ): ComponentFixture<ProviderModelSearchFieldComponent> {
    fixture = TestBed.createComponent(ProviderModelSearchFieldComponent);
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('defaultLabel', 'Default (haiku tier)');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    emitted = [];
    fixture.componentInstance.modelSelected.subscribe((id) => emitted.push(id));
    fixture.detectChanges();
    return fixture;
  }

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const input = (): HTMLInputElement =>
    root().querySelector(
      '[data-testid="provider-model-picker-search"]',
    ) as HTMLInputElement;
  const optionEls = (): HTMLElement[] =>
    Array.from(root().querySelectorAll('[role="option"]'));
  const optionLabels = (): string[] =>
    optionEls().map(
      (o) => o.querySelector('.truncate')?.textContent?.trim() ?? '',
    );

  function type(text: string): void {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function focus(): void {
    input().dispatchEvent(new Event('focus'));
    fixture.detectChanges();
  }

  function key(k: string): void {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    fixture.detectChanges();
  }

  it('shows the selected entry label while closed', () => {
    create({ selectedId: 'kimi-k2' });
    expect(input().value).toBe('Kimi K2');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(root().querySelector('[role="listbox"]')).toBeNull();
  });

  it('shows the sentinel label when nothing is pinned', () => {
    create();
    expect(input().value).toBe('Default (haiku tier)');
  });

  it('opens on focus with the sentinel first, then the catalogue', () => {
    create();
    focus();
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(optionLabels()).toEqual([
      'Default (haiku tier)',
      'Claude Sonnet 4',
      'GPT-5 mini',
      'Kimi K2',
    ]);
  });

  // Gate V 36 decision 2: the tier modal's fields open on click, typing or ArrowDown, not on focus.
  it('with openOnFocus off, focus keeps the list closed and Esc is not swallowed', () => {
    create({ openOnFocus: false });
    focus();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(root().querySelector('[role="listbox"]')).toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const parent = jest.fn();
    root().addEventListener('keydown', parent);
    input().dispatchEvent(escape);
    expect(parent).toHaveBeenCalledTimes(1);
    key('ArrowDown');
    expect(input().getAttribute('aria-expanded')).toBe('true');
  });

  it('with openOnFocus off, a click still opens the list', () => {
    create({ openOnFocus: false });
    input().dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();
    expect(input().getAttribute('aria-expanded')).toBe('true');
  });

  it('filters by name, case-insensitively', () => {
    create();
    type('SONNET');
    expect(optionLabels()).toEqual(['Claude Sonnet 4']);
  });

  it('filters by id as well as name', () => {
    create();
    type('k2');
    expect(optionLabels()).toEqual(['Kimi K2']);
    type('gpt-5');
    expect(optionLabels()).toEqual(['GPT-5 mini']);
  });

  it('shows the empty message when nothing matches', () => {
    create();
    type('does-not-exist');
    expect(optionEls()).toHaveLength(0);
    expect(root().textContent).toContain('No models match');
  });

  it(`caps the rendered list at ${MAX_MODEL_SUGGESTIONS} rows`, () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: `model-${i}`,
      name: `Model ${i}`,
      supportsToolUse: true,
    }));
    create({ options: many });
    focus();
    expect(optionEls()).toHaveLength(MAX_MODEL_SUGGESTIONS);

    type('model-1');
    // model-1, model-10..19, model-100..119 = 31 matches, under the cap.
    expect(optionEls()).toHaveLength(31);
  });

  it('marks only tool-capable models', () => {
    create();
    focus();
    const markers = optionEls().map(
      (o) =>
        o.querySelector('[data-testid="provider-model-picker-tooluse-marker"]')
          ?.textContent ?? null,
    );
    // Sentinel (unknown), Sonnet (yes), GPT-5 mini (no), Kimi (yes).
    expect(markers).toEqual([null, 'Tool use', null, 'Tool use']);
  });

  it('emits the clicked id and closes', () => {
    create();
    type('kimi');
    optionEls()[0].click();
    fixture.detectChanges();
    expect(emitted).toEqual(['kimi-k2']);
    expect(root().querySelector('[role="listbox"]')).toBeNull();
  });

  it('emits the sentinel id when the default entry is chosen', () => {
    create({ selectedId: 'kimi-k2' });
    focus();
    optionEls()[0].click();
    expect(emitted).toEqual(['']);
  });

  it('does not emit when the already-selected entry is chosen again', () => {
    create({ selectedId: 'kimi-k2' });
    type('kimi');
    optionEls()[0].click();
    expect(emitted).toEqual([]);
  });

  it('selects the active suggestion with the keyboard', () => {
    create();
    key('ArrowDown'); // opens, the selected sentinel is the active row
    expect(input().getAttribute('aria-expanded')).toBe('true');
    key('ArrowDown'); // second row: Claude Sonnet 4
    const activeId = input().getAttribute('aria-activedescendant');
    expect(activeId).toBe(optionEls()[1].id);
    expect(activeId).toMatch(/^ptah-provider-model-search-\d+-option-1$/);
    key('Enter');
    expect(emitted).toEqual(['claude-sonnet-4']);
  });

  it('closes on Escape without emitting', () => {
    create();
    focus();
    key('Escape');
    expect(root().querySelector('[role="listbox"]')).toBeNull();
    expect(emitted).toEqual([]);
  });

  it('stays closed while disabled', () => {
    create({ disabled: true });
    expect(input().disabled).toBe(true);
    focus();
    key('ArrowDown');
    expect(root().querySelector('[role="listbox"]')).toBeNull();
  });

  it('names the combobox from the ariaLabel input', () => {
    create({ ariaLabel: 'Main agent model' });
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-label')).toBe('Main agent model');
    const controls = input().getAttribute('aria-controls') ?? '';
    expect(controls).not.toBe('');
    focus();
    // aria-controls points at the listbox itself, not a wrapper around it.
    const listbox = root().querySelector(`[role="listbox"][id="${controls}"]`);
    expect(listbox).not.toBeNull();
  });

  it('resets the active row to the selected model when the panel reopens', () => {
    create({ selectedId: 'kimi-k2' });
    focus(); // the selected model's row is active on open
    expect(input().getAttribute('aria-activedescendant')).toBe(
      optionEls()[3].id,
    );
    key('ArrowDown'); // navigate away: wraps to the sentinel row
    expect(input().getAttribute('aria-activedescendant')).toBe(
      optionEls()[0].id,
    );
    key('Escape');
    focus(); // reopen
    const activeId = input().getAttribute('aria-activedescendant');
    expect(activeId).toBe(optionEls()[3].id); // Kimi K2, the selected model
    expect(activeId).not.toBe(optionEls()[0].id);
    key('Enter'); // Enter confirms the selection, it does not clear the pin
    expect(emitted).toEqual([]);
  });

  it('holds the reopen highlight until the user types, then targets the first match', () => {
    create({ selectedId: 'kimi-k2' });
    focus(); // reopen highlight: the selected model's row
    expect(input().getAttribute('aria-activedescendant')).toBe(
      optionEls()[3].id,
    );

    type('k'); // matches the sentinel ("haiku") and Kimi K2, in that order
    expect(optionLabels()).toEqual(['Default (haiku tier)', 'Kimi K2']);
    expect(input().getAttribute('aria-activedescendant')).toBe(
      optionEls()[0].id,
    );

    key('Enter'); // Enter picks the first match, not the old highlight
    expect(emitted).toEqual(['']);
  });

  it('marks the sentinel row active on reopen when nothing is pinned', () => {
    create();
    focus();
    key('ArrowDown'); // stale row: Claude Sonnet 4
    key('Escape');
    focus();
    expect(input().getAttribute('aria-activedescendant')).toBe(
      optionEls()[0].id,
    );
  });

  it('keeps no row active on open when the selection is not in the list', () => {
    create({ selectedId: 'model-not-in-catalog' });
    focus();
    expect(input().getAttribute('aria-activedescendant')).toBeNull();
    key('Enter'); // a stray Enter must not clear the pin to the sentinel
    expect(emitted).toEqual([]);
    key('ArrowDown'); // arrows enter at the first row
    expect(input().getAttribute('aria-activedescendant')).toBe(
      optionEls()[0].id,
    );
  });

  it('selects the first match when typing clears the suppressed state', () => {
    create({ selectedId: 'model-not-in-catalog' });
    focus(); // suppressed reopen: no active row
    expect(input().getAttribute('aria-activedescendant')).toBeNull();

    type('kimi'); // typing filters the list to one match
    fixture.detectChanges();
    expect(input().getAttribute('aria-activedescendant')).toBe(
      optionEls()[0].id,
    );

    key('Enter'); // Enter selects the first match, it is not inert
    expect(emitted).toEqual(['kimi-k2']);
  });

  it('never collides ids with a second field on the same page', () => {
    create({ ariaLabel: 'Main agent model' });
    focus();
    const firstIds = optionEls().map((o) => o.id);

    const second = TestBed.createComponent(ProviderModelSearchFieldComponent);
    second.componentRef.setInput('options', OPTIONS);
    second.componentRef.setInput('defaultLabel', 'Default (haiku tier)');
    second.detectChanges();
    const secondInput = second.nativeElement.querySelector(
      '[data-testid="provider-model-picker-search"]',
    ) as HTMLInputElement;
    secondInput.dispatchEvent(new Event('focus'));
    second.detectChanges();
    const secondIds = Array.from(
      (second.nativeElement as HTMLElement).querySelectorAll('[role="option"]'),
    ).map((o) => o.id);

    expect(firstIds).toHaveLength(4);
    expect(secondIds).toHaveLength(4);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);

    const active = input().getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    // Each input's activedescendant resolves inside its own panel only.
    expect(firstIds).toContain(active);
    expect(secondIds).not.toContain(active);
  });

  describe('compact use outside the picker (Batch 28b, barrel export)', () => {
    const MANUAL: ProviderModelSearchOption = { id: '__manual__', name: 'Enter a model ID…', supportsToolUse: null };

    it('defaults keep the picker output: sentinel first, no id, no pinned row', () => {
      create();
      focus();
      expect(input().hasAttribute('id')).toBe(false);
      expect(optionLabels()).toEqual(['Default (haiku tier)', 'Claude Sonnet 4', 'GPT-5 mini', 'Kimi K2']);
    });

    it('inputId gives the combobox an id for a host <label for>', () => {
      create({ inputId: 'main-agent-model' });
      expect(input().id).toBe('main-agent-model');
    });

    it('includeDefault=false hides the sentinel row', () => {
      create({ includeDefault: false, selectedId: 'kimi-k2' });
      focus();
      expect(optionLabels()).toEqual(['Claude Sonnet 4', 'GPT-5 mini', 'Kimi K2']);
    });

    it('a pinned option is always listed last, even when the filter matches nothing else, and emits its id', () => {
      create({ pinnedOption: MANUAL });
      focus();
      expect(optionLabels().at(-1)).toBe('Enter a model ID…');
      type('no-such-model');
      expect(optionLabels()).toEqual(['Enter a model ID…']);
      key('ArrowDown');
      key('Enter');
      expect(emitted).toEqual(['__manual__']);
    });

    it('Esc closes the open list without reaching an enclosing dialog; a closed field lets Esc through', () => {
      create();
      const reachedParent = jest.fn();
      root().addEventListener('keydown', reachedParent);
      focus();
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(input().getAttribute('aria-expanded')).toBe('false');
      expect(reachedParent).not.toHaveBeenCalled();
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(reachedParent).toHaveBeenCalledTimes(1);
    });
  });

  // TASK_2026_555 Batch 30, Visual round 1: opt-in compact list and search placeholder for the CLI matrix popover.
  describe('compact and placeholder (opt-in)', () => {
    async function settle(): Promise<void> {
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
      fixture.detectChanges();
    }

    it('keeps the default rows, width and placeholder when not opted in', async () => {
      create({ selectedId: 'kimi-k2' });
      focus();
      await settle();
      expect(input().placeholder).toBe('Kimi K2');
      expect(optionLabels()).toContain('Claude Sonnet 4');
      expect(optionEls()[0].className).not.toContain('!py-1');
      expect((root().querySelector('[role="listbox"]') as HTMLElement).style.width).toBe('');
    });

    it('opens empty with the given placeholder', async () => {
      create({ selectedId: 'kimi-k2', placeholder: 'Search models (e.g. gpt-5, sonnet)...' });
      focus();
      await settle();
      expect(input().value).toBe('');
      expect(input().placeholder).toBe('Search models (e.g. gpt-5, sonnet)...');
    });

    it('lists ids in mono with the display name after them and checks the current one', async () => {
      create({ selectedId: 'kimi-k2', compact: true, pinnedOption: { id: '__manual__', name: 'Enter a model ID…', supportsToolUse: null } });
      focus();
      await settle();
      const rows = optionEls();
      // The sentinel and the pinned action row keep their labels; catalogue rows lead with the id.
      expect(rows.map((row) => row.querySelector('.truncate')?.textContent?.trim()))
        .toEqual(['Default (haiku tier)', 'claude-sonnet-4', 'gpt-5-mini', 'kimi-k2', 'Enter a model ID…']);
      expect(rows[1].querySelector('.font-mono')?.textContent?.trim()).toBe('claude-sonnet-4');
      expect(rows[1].textContent).toContain('Claude Sonnet 4');
      expect(rows[0].querySelector('.font-mono')).toBeNull();
      const current = rows.filter((row) => row.querySelector('[data-current="true"]'));
      expect(current).toHaveLength(1);
      expect(current[0].textContent).toContain('✓');
      expect(current[0].textContent).toContain('(current)');
      expect(rows[1].className).toContain('!py-1');
    });

    // Batch 32b: a saved id the catalogue lacks is pinned by the host with a hint as its name; the closed compact
    // field shows the id, like the compact rows. The default (non-compact) field keeps showing the name.
    it('shows the selected id while closed in compact mode, and the name otherwise', () => {
      const saved: ProviderModelSearchOption = { id: 'glm-5.3:cloud', name: 'saved, not in the current list', supportsToolUse: null };
      create({ options: [saved, ...OPTIONS], selectedId: 'glm-5.3:cloud', compact: true });
      expect(input().value).toBe('glm-5.3:cloud');
      fixture.componentRef.setInput('selectedId', 'kimi-k2');
      fixture.detectChanges();
      expect(input().value).toBe('kimi-k2');
      fixture.componentRef.setInput('selectedId', '');
      fixture.detectChanges();
      expect(input().value).toBe('Default (haiku tier)');

      create({ options: [saved, ...OPTIONS], selectedId: 'glm-5.3:cloud' });
      expect(input().value).toBe('saved, not in the current list');
    });

    it('sizes the compact list to the field', async () => {
      create({ compact: true });
      jest.spyOn(root().querySelector('.autocomplete-input') as HTMLElement, 'getBoundingClientRect')
        .mockReturnValue({ width: 236 } as DOMRect);
      focus();
      await settle();
      expect((root().querySelector('[role="listbox"]') as HTMLElement).style.width).toBe('236px');
    });
  });
});
