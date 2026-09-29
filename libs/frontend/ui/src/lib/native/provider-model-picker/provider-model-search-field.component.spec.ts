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
    key('ArrowDown'); // opens, first row active
    expect(input().getAttribute('aria-expanded')).toBe('true');
    key('ArrowDown'); // second row: Claude Sonnet 4
    expect(input().getAttribute('aria-activedescendant')).toBe('suggestion-1');
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
    expect(
      root().querySelector(`#${controls} [role="listbox"]`),
    ).not.toBeNull();
  });
});
