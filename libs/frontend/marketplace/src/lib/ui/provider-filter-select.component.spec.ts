/**
 * ProviderFilterSelectComponent specs (plan C8 `ProviderFilters`, Task 10.2,
 * revise round 1).
 *
 * The listbox dropdown behind the target and status filters: ARIA wiring,
 * selection, keyboard through the component-scoped
 * `KeyboardNavigationService`, Escape kept from the page, and the disabled
 * and empty states.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KeyboardNavigationService } from '@ptah-extension/ui';

import {
  ProviderFilterSelectComponent,
  type FilterSelectOption,
} from './provider-filter-select.component';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

const OPTIONS: readonly FilterSelectOption[] = [
  { value: null, label: 'Any target', count: null, icon: null },
  { value: 'claude', label: 'Claude Code', count: 4, icon: null },
  { value: 'cursor', label: 'Cursor', count: 1, icon: null },
  { value: 'codex', label: 'Codex CLI', count: 2, icon: null },
];

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture.detectChanges();
}

describe('ProviderFilterSelectComponent', () => {
  let fixture: ComponentFixture<ProviderFilterSelectComponent>;
  let element: HTMLElement;
  let emitted: (string | null)[];

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(ProviderFilterSelectComponent);
    fixture.componentRef.setInput('label', 'Target');
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('testId', 'select');
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    emitted = [];
    fixture.componentInstance.valueChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const trigger = (): HTMLButtonElement =>
    element.querySelector('[data-testid="select"]') as HTMLButtonElement;
  const listbox = (): HTMLElement | null =>
    element.querySelector('[data-testid="select-listbox"]');
  const options = (): HTMLElement[] =>
    Array.from(
      listbox()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
  const key = (name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
    });
    trigger().dispatchEvent(event);
    return event;
  };
  const activeId = (): string | null =>
    trigger().getAttribute('aria-activedescendant');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProviderFilterSelectComponent],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('provides its own KeyboardNavigationService', () => {
    render();
    const own = fixture.debugElement.injector.get(KeyboardNavigationService);
    expect(own).toBeInstanceOf(KeyboardNavigationService);
    const second = TestBed.createComponent(ProviderFilterSelectComponent);
    expect(
      second.debugElement.injector.get(KeyboardNavigationService),
    ).not.toBe(own);
  });

  it('is a listbox trigger showing the label and the chosen value', () => {
    render({ value: 'cursor' });
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBeNull();
    expect(trigger().textContent).toContain('Target:');
    expect(trigger().textContent).toContain('Cursor');
    expect(listbox()).toBeNull();
  });

  it('opens on click with the listbox wired to the trigger', async () => {
    render();
    trigger().click();
    await settle(fixture);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(listbox()?.getAttribute('role')).toBe('listbox');
    expect(listbox()?.getAttribute('aria-label')).toBe('Target');
    expect(trigger().getAttribute('aria-controls')).toBe(listbox()?.id);
    expect(options()).toHaveLength(4);
    expect(options()[0].textContent).toContain('(selected)');
  });

  it('emits a clicked option and closes', async () => {
    render();
    trigger().click();
    await settle(fixture);
    options()[2].click();
    await settle(fixture);
    expect(emitted).toEqual(['cursor']);
    expect(listbox()).toBeNull();
  });

  it('does not emit when the current value is chosen again', async () => {
    render({ value: 'claude' });
    trigger().click();
    await settle(fixture);
    options()[1].click();
    await settle(fixture);
    expect(emitted).toEqual([]);
    expect(listbox()).toBeNull();
  });

  it('opens with an arrow key on the current value', async () => {
    render({ value: 'cursor' });
    const event = key('ArrowDown');
    await settle(fixture);
    expect(event.defaultPrevented).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(activeId()).toBe(options()[2].id);
  });

  it('moves with arrows (wrapping) and Home/End through the service', async () => {
    render({ value: 'codex' });
    key('ArrowUp');
    await settle(fixture);
    expect(activeId()).toBe(options()[3].id);
    key('ArrowDown');
    fixture.detectChanges();
    expect(activeId()).toBe(options()[0].id);
    key('ArrowUp');
    fixture.detectChanges();
    expect(activeId()).toBe(options()[3].id);
    key('Home');
    fixture.detectChanges();
    expect(activeId()).toBe(options()[0].id);
    key('End');
    fixture.detectChanges();
    expect(activeId()).toBe(options()[3].id);
    expect(options()[3].getAttribute('aria-selected')).toBe('true');
  });

  it('chooses the active option with Enter and with Space', async () => {
    render();
    key('ArrowDown');
    await settle(fixture);
    key('ArrowDown');
    fixture.detectChanges();
    key('Enter');
    await settle(fixture);
    expect(emitted).toEqual(['claude']);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    key('ArrowDown');
    await settle(fixture);
    key('End');
    fixture.detectChanges();
    key(' ');
    await settle(fixture);
    expect(emitted).toEqual(['claude', 'codex']);
  });

  it('ignores Home, End, Enter and Escape while closed', async () => {
    render();
    const events = ['Home', 'End', 'Enter', 'Escape'].map(key);
    await settle(fixture);
    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
    expect(listbox()).toBeNull();
    expect(emitted).toEqual([]);
  });

  it('closes on Escape without emitting, and the page never sees the key', async () => {
    render();
    const pageHandler = jest.fn();
    element.addEventListener('keydown', pageHandler);
    trigger().click();
    await settle(fixture);
    const escape = key('Escape');
    await settle(fixture);
    expect(listbox()).toBeNull();
    expect(escape.defaultPrevented).toBe(true);
    expect(pageHandler).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('closes on Tab and lets focus move on', async () => {
    render();
    trigger().click();
    await settle(fixture);
    const tab = key('Tab');
    await settle(fixture);
    expect(listbox()).toBeNull();
    expect(tab.defaultPrevented).toBe(false);
  });

  it('is disabled and never opens when disabled is set', async () => {
    render({ disabled: true });
    expect(trigger().disabled).toBe(true);
    key('ArrowDown');
    await settle(fixture);
    expect(listbox()).toBeNull();
  });

  it('closes an open list when it becomes disabled', async () => {
    render();
    trigger().click();
    await settle(fixture);
    fixture.componentRef.setInput('disabled', true);
    await settle(fixture);
    expect(listbox()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('is disabled with no options and shows no value', async () => {
    render({ options: [] });
    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent?.replace(/\s+/g, ' ').trim()).toBe('Target:');
    key('ArrowDown');
    await settle(fixture);
    expect(listbox()).toBeNull();
  });

  it('keeps the active option in range when the options shrink', async () => {
    render({ value: 'codex' });
    key('ArrowDown');
    await settle(fixture);
    fixture.componentRef.setInput('options', OPTIONS.slice(0, 2));
    await settle(fixture);
    key('End');
    fixture.detectChanges();
    expect(activeId()).toBe(options()[1].id);
    key('Enter');
    await settle(fixture);
    expect(emitted).toEqual(['claude']);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'provider-filter-select.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
