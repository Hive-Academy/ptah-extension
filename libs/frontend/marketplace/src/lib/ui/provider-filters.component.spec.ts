/**
 * ProviderFiltersComponent specs (plan C8 `ProviderFilters`, Task 10.2).
 *
 * Search input, origin `role="radiogroup"` with roving focus, target and
 * status dropdowns (native dropdown + listbox), status words from
 * `statusPresentation()`, and filters that are not navigation.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type {
  ProviderFilter,
  ProviderFilterOptions,
} from '../data/provider-filtering';
import { ProviderFiltersComponent } from './provider-filters.component';
import { statusPresentation } from './status-pill.component';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

const OPTIONS: ProviderFilterOptions = {
  origins: [
    { value: 'harness-config', label: 'Config file', count: 3 },
    { value: 'claude-user', label: 'Claude CLI', count: 2 },
    { value: 'oauth', label: 'OAuth', count: 1 },
  ],
  targets: [
    { value: 'claude', label: 'Claude Code', count: 4 },
    { value: 'cursor', label: 'Cursor', count: 1 },
  ],
  statuses: [
    { value: 'failed', label: 'Failed', count: 1 },
    { value: 'needs-input', label: 'Needs setup', count: 1 },
    { value: 'unknown', label: 'Unknown', count: 1 },
    { value: 'configured', label: 'Configured', count: 3 },
  ],
};

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture.detectChanges();
}

describe('ProviderFiltersComponent', () => {
  let fixture: ComponentFixture<ProviderFiltersComponent>;
  let component: ProviderFiltersComponent;
  let element: HTMLElement;
  let emitted: ProviderFilter[];

  function render(
    filter: ProviderFilter = {},
    extra: Record<string, unknown> = {},
  ): void {
    fixture = TestBed.createComponent(ProviderFiltersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('filter', filter);
    fixture.componentRef.setInput('options', OPTIONS);
    for (const [name, value] of Object.entries(extra)) {
      fixture.componentRef.setInput(name, value);
    }
    emitted = [];
    component.filterChange.subscribe((next) => emitted.push(next));
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const radios = (): HTMLButtonElement[] =>
    Array.from(
      element.querySelectorAll<HTMLButtonElement>(
        '[data-testid="provider-filter-origin"] [role="radio"]',
      ),
    );
  const trigger = (name: 'target' | 'status'): HTMLButtonElement =>
    element.querySelector(
      `[data-testid="provider-filter-${name}"]`,
    ) as HTMLButtonElement;
  const listbox = (name: 'target' | 'status'): HTMLElement | null =>
    element.querySelector(`[data-testid="provider-filter-${name}-listbox"]`);
  /** An option's text nodes joined by single spaces. */
  const words = (node: Node): string => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const trimmed = (text.textContent ?? '').trim();
      if (trimmed) parts.push(trimmed);
    }
    return parts.join(' ');
  };
  const optionTexts = (name: 'target' | 'status'): string[] =>
    Array.from(listbox(name)?.querySelectorAll('[role="option"]') ?? []).map(
      words,
    );
  const key = (target: HTMLElement, name: string): void => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true }),
    );
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProviderFiltersComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders a type="search" field that emits the search term', () => {
    render({ origin: 'oauth' });
    const search = element.querySelector(
      '[data-testid="provider-filter-search"]',
    ) as HTMLInputElement;
    expect(search.type).toBe('search');
    expect(search.getAttribute('aria-label')).toBe('Search servers');
    search.value = 'git hub';
    search.dispatchEvent(new Event('input'));
    expect(emitted).toEqual([{ origin: 'oauth', search: 'git hub' }]);
  });

  it('shows the search term it is given', () => {
    render({ search: 'linear' });
    expect(
      (
        element.querySelector(
          '[data-testid="provider-filter-search"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('linear');
  });

  it('renders origin as a radiogroup with All first and counts', () => {
    render();
    const group = element.querySelector(
      '[data-testid="provider-filter-origin"]',
    );
    expect(group?.getAttribute('role')).toBe('radiogroup');
    expect(group?.getAttribute('aria-label')).toBe('Filter by origin');
    expect(
      radios().map((r) => r.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual(['All 6', 'Config file 3', 'Claude CLI 2', 'OAuth 1']);
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  it('keeps only the checked radio in the tab order', () => {
    render({ origin: 'claude-user' });
    expect(radios().map((r) => r.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '0',
      '-1',
    ]);
  });

  it('emits the chosen origin on click and ignores the current one', () => {
    render();
    radios()[3].click();
    radios()[0].click();
    expect(emitted).toEqual([{ origin: 'oauth' }]);
  });

  it('moves and chooses with arrow keys, wrapping, and focuses the new radio', () => {
    render({ origin: 'oauth' });
    const list = radios();
    list[3].focus();
    key(list[3], 'ArrowRight');
    expect(emitted.at(-1)).toEqual({ origin: null });
    expect(document.activeElement).toBe(list[0]);
    key(list[3], 'ArrowLeft');
    expect(emitted.at(-1)).toEqual({ origin: 'claude-user' });
    key(list[3], 'Home');
    key(list[3], 'End');
    expect(emitted).toHaveLength(3);
  });

  it('keeps a held origin listed when no row carries it', () => {
    render({ origin: 'smithery' });
    const held = radios().at(-1);
    expect(held?.getAttribute('data-origin')).toBe('smithery');
    expect(held?.getAttribute('aria-checked')).toBe('true');
  });

  it('hides the origin control when showOrigin is false', () => {
    render({}, { showOrigin: false });
    expect(element.querySelector('[role="radiogroup"]')).toBeNull();
  });

  // Listbox mechanics (keyboard, Escape, disabled) are covered in
  // provider-filter-select.component.spec.ts; these check the filter wiring.
  it('offers "Any target" plus the targets and emits the chosen target', async () => {
    render();
    const button = trigger('target');
    expect(button.textContent).toContain('Any target');
    button.click();
    await settle(fixture);
    expect(optionTexts('target')).toEqual([
      '(selected) Any target',
      'Claude Code 4',
      'Cursor 1',
    ]);
    (
      listbox('target')?.querySelectorAll('[role="option"]')[2] as HTMLElement
    ).click();
    await settle(fixture);
    expect(emitted).toEqual([{ target: 'cursor' }]);
    expect(listbox('target')).toBeNull();
  });

  it('uses the status pill words for the status options', async () => {
    render();
    trigger('status').click();
    await settle(fixture);
    const texts = optionTexts('status');
    expect(texts).toContain(`${statusPresentation('needs-input').label} 1`);
    expect(texts).not.toContain('Needs setup 1');
    expect(texts[0]).toBe('(selected) Any status');
    expect(texts).toContain('Unknown 1');
  });

  it('shows the chosen status on the trigger', () => {
    render({ status: 'failed' });
    expect(trigger('status').textContent).toContain('Failed');
  });

  it('keeps a held status on the trigger in the pill word', () => {
    render({ status: 'pending' });
    expect(trigger('status').textContent).toContain(
      statusPresentation('pending').label,
    );
  });

  it('emits the chosen status into the filter', async () => {
    render({ search: 'x' });
    trigger('status').click();
    await settle(fixture);
    (
      listbox('status')?.querySelectorAll('[role="option"]')[1] as HTMLElement
    ).click();
    await settle(fixture);
    expect(emitted).toEqual([{ search: 'x', status: 'failed' }]);
  });

  it('shows Clear filters only while a filter is in force, and clears all', () => {
    render();
    expect(
      element.querySelector('[data-testid="provider-filter-clear"]'),
    ).toBeNull();
    fixture.componentRef.setInput('filter', { search: 'x', target: 'claude' });
    fixture.detectChanges();
    (
      element.querySelector(
        '[data-testid="provider-filter-clear"]',
      ) as HTMLButtonElement
    ).click();
    expect(emitted).toEqual([
      { search: '', origin: null, target: null, status: null },
    ]);
  });

  it('is not navigation: no links anywhere', async () => {
    render();
    trigger('target').click();
    await settle(fixture);
    expect(element.querySelector('a')).toBeNull();
    expect(
      element.querySelector('[routerLink],[ng-reflect-router-link]'),
    ).toBeNull();
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'provider-filters.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
