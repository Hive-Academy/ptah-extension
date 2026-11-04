import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConnectionChoiceComponent } from './connection-choice.component';
import { ConnectionChoiceStore, type ChoiceNotice } from './connection-choice.store';
import type { ProviderKind, SelectionView } from './provider-readiness.derive';

interface Case {
  readonly number: number;
  readonly label: string;
  readonly saved: SelectionView;
  readonly pending?: ProviderKind;
  readonly notice?: ChoiceNotice;
  readonly saving?: boolean;
  readonly writable?: boolean;
  readonly text: string;
  readonly role?: string;
  readonly checked?: ProviderKind | null;
  readonly focus?: 'radio';
}
const cases: readonly Case[] = [
  { number: 1, label: 'loading', saved: { kind: 'loading' }, text: 'Loading your saved connection', checked: null },
  { number: 2, label: 'loaded unchanged', saved: { kind: 'claude-cli' }, text: 'Claude Code', checked: 'claude-cli' },
  { number: 3, label: 'other card selected', saved: { kind: 'claude-cli' }, pending: 'openai-codex', text: 'Use Codex as your main connection?', role: 'group', checked: 'openai-codex', focus: 'radio' },
  { number: 4, label: 'write target missing', saved: { kind: 'claude-cli' }, pending: 'openai-codex', writable: false, text: 'Where to save is not loaded yet', role: 'status', checked: 'openai-codex' },
  { number: 5, label: 'saving', saved: { kind: 'claude-cli' }, pending: 'openai-codex', saving: true, text: 'Saving your main connection...', role: 'status', checked: 'openai-codex' },
  { number: 6, label: 'saved reread ok', saved: { kind: 'openai-codex' }, pending: 'openai-codex', notice: 6, text: 'Saved. Codex is your main connection.', checked: 'openai-codex', focus: 'radio' },
  { number: 7, label: 'saved refresh failed', saved: { kind: 'openai-codex' }, pending: 'openai-codex', notice: 7, text: 'Some settings could not be refreshed', checked: 'openai-codex', focus: 'radio' },
  { number: 8, label: 'save returned false', saved: { kind: 'claude-cli' }, pending: 'openai-codex', notice: 8, text: 'Another save is in progress', checked: 'claude-cli', focus: 'radio' },
  { number: 9, label: 'blocked failed or partial', saved: { kind: 'claude-cli' }, pending: 'openai-codex', notice: 9, text: 'Not saved.', role: 'alert', checked: 'claude-cli', focus: 'radio' },
  { number: 10, label: 'unconfirmed', saved: { kind: 'claude-cli' }, pending: 'openai-codex', notice: 10, text: 'Ptah could not confirm the change', role: 'alert', checked: 'claude-cli', focus: 'radio' },
  { number: 11, label: 'saved status not confirmed', saved: { kind: 'not-confirmed' }, pending: 'openai-codex', notice: 11, text: 'Saved, status not confirmed', role: 'alert', checked: null, focus: 'radio' },
  { number: 12, label: 'cannot read saved connection', saved: { kind: 'unreadable' }, text: 'Ptah could not read your saved connection', role: 'alert', checked: null },
  { number: 13, label: 'other connection saved', saved: { kind: 'other', name: 'OpenRouter' }, text: 'You can manage OpenRouter in Providers', checked: null },
];

describe('ConnectionChoiceComponent design states 1–13', () => {
  it.each(cases)('state $number: $label', async (scenario) => {
    const saved = signal<SelectionView>(scenario.number === 6 || scenario.number === 7 ? { kind: 'claude-cli' } : scenario.saved);
    const pending = signal<ProviderKind | null>(scenario.number === 3 ? null : scenario.pending ?? null);
    const phase = signal<'idle' | 'saving'>(scenario.saving ? 'saving' : 'idle');
    const notice = signal<ChoiceNotice>(scenario.number >= 6 && scenario.number <= 11 ? null : scenario.notice ?? null);
    const writable = signal(scenario.writable !== false);
    const store = {
      saved, pending, phase, notice,
      changed: computed(() => pending() !== null && pending() !== saved().kind),
      canConfirm: computed(() => writable()), target: computed(() => writable() ? 'workspace' : null),
      name: () => saved().kind === 'openai-codex' ? 'Codex' : saved().kind === 'other' ? 'OpenRouter' : 'Claude Code',
      nameForPending: () => pending() === 'openai-codex' ? 'Codex' : 'Claude Code',
      choose: (provider: ProviderKind) => pending.set(provider),
      cancel: () => pending.set(null),
      confirm: jest.fn<Promise<void>, []>(async () => { pending.set(null); saved.set(scenario.saved); notice.set(scenario.notice ?? null); }),
      retry: jest.fn<Promise<void>, []>(async () => undefined),
    };
    TestBed.configureTestingModule({ imports: [ConnectionChoiceComponent], providers: [provideRouter([]),
      { provide: ConnectionChoiceStore, useValue: store }] });
    const fixture = TestBed.createComponent(ConnectionChoiceComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    if (scenario.number === 3) {
      const radio = element.querySelector<HTMLInputElement>('input[value="openai-codex"]');
      radio?.focus();
      radio?.click();
      fixture.detectChanges();
    }
    if (scenario.number >= 6 && scenario.number <= 11) {
      (element.querySelector('button.btn-primary') as HTMLButtonElement).click();
      await Promise.resolve();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    }
    expect(element.textContent).toContain(scenario.text);
    if (scenario.role) expect(element.querySelector(`[role="${scenario.role}"]`)).not.toBeNull();
    if (scenario.number === 1) expect(element.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    else expect(element.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    const checked = element.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(checked?.value ?? null).toBe(scenario.checked ?? null);
    if (scenario.number === 2) expect(element.querySelector('[aria-label="Confirm main connection change"]')).toBeNull();
    if (scenario.number === 4) expect(element.querySelector('button.btn-primary')?.getAttribute('aria-disabled')).toBe('true');
    if (scenario.number === 5) expect(element.querySelectorAll('input:disabled')).toHaveLength(2);
    if (scenario.number === 11) expect(element.querySelectorAll('[role="alert"]')).toHaveLength(1);
    if (scenario.number === 12) {
      store.retry.mockImplementation(async () => { saved.set({ kind: 'claude-cli' }); notice.set(null); });
      (element.querySelector('button.btn-outline') as HTMLButtonElement).click();
      await Promise.resolve();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(document.activeElement).toBe(element.querySelector('input[value="claude-cli"]'));
    }
    if (scenario.focus === 'radio') {
      const radio = element.querySelector<HTMLInputElement>('input[type="radio"]:checked') ?? element.querySelector<HTMLInputElement>('input[type="radio"]');
      expect(document.activeElement).toBe(radio);
    }
  });
});
