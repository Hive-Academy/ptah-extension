import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountActionResult,
} from '@ptah-extension/shared';
import { AddAccountDialogComponent } from './add-account-dialog.component';

@Component({
  standalone: true,
  imports: [AddAccountDialogComponent],
  template: `
    <button type="button" data-testid="opener" (click)="open.set(true)">Add Claude account</button>
    <ptah-add-account-dialog
      [open]="open()"
      [pending]="pending()"
      [error]="error()"
      (add)="added.push($event)"
      (closed)="open.set(false); closedCount = closedCount + 1"
    />
  `,
})
class Host {
  readonly open = signal(false);
  readonly pending = signal(false);
  readonly error = signal<ProviderAccountActionResult | null>(null);
  readonly added: string[] = [];
  closedCount = 0;
}

describe('AddAccountDialogComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const input = () => q<HTMLInputElement>('add-account-label') as HTMLInputElement;
  const submitButton = () => q<HTMLButtonElement>('add-account-submit') as HTMLButtonElement;
  const dialog = () => el().querySelector('dialog') as HTMLDialogElement;

  function openFromOpener(): HTMLButtonElement {
    const opener = q<HTMLButtonElement>('opener');
    if (!opener) throw new Error('no opener');
    opener.focus();
    opener.click();
    fixture.detectChanges();
    return opener;
  }
  function type(value: string): void {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  function submitWithEnter(): void {
    q<HTMLFormElement>('add-account-form')?.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    fixture.detectChanges();
  }

  beforeEach(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('asks for a local label only, with the design copy', () => {
    openFromOpener();
    const text = q('add-account-dialog')?.textContent ?? '';
    expect(text).toContain('Add a named Claude account');
    expect(text).toContain('Enter a local label only.');
    expect(el().querySelector('label[for="add-account-label"]')?.textContent?.trim()).toBe(
      'Local label',
    );
    const fields = el().querySelectorAll('dialog input, dialog select, dialog textarea');
    expect(fields).toHaveLength(1);
    expect(input().type).toBe('text');
    expect(input().getAttribute('maxlength')).toBe(String(PROVIDER_ACCOUNT_LABEL_MAX_LENGTH));
    expect(submitButton().textContent?.trim()).toBe('Add profile');
    expect(q('add-account-cancel')?.textContent?.trim()).toBe('Cancel');
  });

  it('keeps Add disabled until the label is a non-blank bounded label', () => {
    openFromOpener();
    expect(submitButton().disabled).toBe(true);
    type('   ');
    expect(submitButton().disabled).toBe(true);
    type('Work\u0007Claude');
    expect(submitButton().disabled).toBe(true);
    type('Work Claude');
    expect(submitButton().disabled).toBe(false);
  });

  it('submits the trimmed label with Enter and emits nothing else', () => {
    openFromOpener();
    type('  Work Claude  ');
    submitWithEnter();
    expect(host.added).toEqual(['Work Claude']);
    expect(host.closedCount).toBe(0);
  });

  it('allows a label another profile already uses', () => {
    openFromOpener();
    type('Personal Claude');
    submitButton().click();
    fixture.detectChanges();
    type('Personal Claude');
    submitButton().click();
    expect(host.added).toEqual(['Personal Claude', 'Personal Claude']);
  });

  it('shows the exact secret-free duplicate-directory refusal as an alert', () => {
    openFromOpener();
    type('Work Claude');
    host.error.set({ code: 'conflict', summary: PROVIDER_ACCOUNT_DUPLICATE_ROUTE_SUMMARY });
    fixture.detectChanges();
    const alert = q('add-account-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent?.trim()).toBe(
      'This local account directory is already represented by another profile. Rename that profile instead.',
    );
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe('add-account-error');
  });

  it('replaces an unsafe refusal sentence with fixed copy', () => {
    openFromOpener();
    host.error.set({ code: 'unavailable-storage', summary: 'ENOENT /home/me/.claude/accounts.db' });
    fixture.detectChanges();
    expect(q('add-account-error')?.textContent?.trim()).toBe(
      'This action did not complete. Refresh and try again.',
    );
  });

  it('announces a pending Add politely and blocks a second submit', () => {
    openFromOpener();
    type('Work Claude');
    const status = q('add-account-status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    host.pending.set(true);
    fixture.detectChanges();
    expect(status?.textContent?.trim()).toBe('Adding profile…');
    expect(submitButton().disabled).toBe(true);
    submitWithEnter();
    expect(host.added).toEqual([]);
  });

  it('returns focus to the opener on Cancel', () => {
    const opener = openFromOpener();
    q<HTMLButtonElement>('add-account-cancel')?.focus();
    q<HTMLButtonElement>('add-account-cancel')?.click();
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(host.added).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });

  it('requests closure on Escape and returns focus to the opener', () => {
    const opener = openFromOpener();
    input().focus();
    dialog().dispatchEvent(new Event('cancel'));
    fixture.detectChanges();
    expect(host.closedCount).toBe(1);
    expect(document.activeElement).toBe(opener);
  });

  it('returns focus to the opener when the parent closes it after a committed Add', () => {
    const opener = openFromOpener();
    type('Work Claude');
    submitButton().focus();
    submitButton().click();
    host.pending.set(true);
    fixture.detectChanges();
    host.pending.set(false);
    host.open.set(false);
    fixture.detectChanges();
    expect(host.added).toEqual(['Work Claude']);
    expect(document.activeElement).toBe(opener);
  });

  it('starts every open with an empty label', () => {
    openFromOpener();
    type('Work Claude');
    host.open.set(false);
    fixture.detectChanges();
    openFromOpener();
    expect(input().value).toBe('');
    expect(submitButton().disabled).toBe(true);
  });
});
