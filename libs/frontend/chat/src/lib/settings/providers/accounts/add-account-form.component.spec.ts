import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import { UNSAFE_ACCOUNT_NAME_MESSAGE } from './account-presentation';
import { AddAccountFormComponent } from './add-account-form.component';

@Component({
  standalone: true,
  imports: [AddAccountFormComponent],
  template: `
    @if (open()) {
      <ptah-add-account-form
        [accounts]="accounts()"
        [pending]="pending()"
        [refusal]="refusal()"
        (submitted)="onSubmit($event)"
        (cancelled)="open.set(false); cancelled = cancelled + 1"
      />
    }
    <button type="button" data-testid="elsewhere">Elsewhere</button>
  `,
})
class Host {
  readonly open = signal(true);
  readonly pending = signal(false);
  readonly refusal = signal<string | null>(null);
  readonly accounts = signal<readonly ProviderAccountSummary[]>([
    {
      profileId: 'p-work-0001',
      label: 'Work',
      provider: 'claude',
      state: 'signed-in',
      owner: 'unknown',
      revision: 1,
      activeRunCount: 0,
    },
  ]);
  readonly submitted: string[] = [];
  cancelled = 0;

  /** Mirrors the parent: the Add write starts synchronously. */
  onSubmit(label: string): void {
    this.submitted.push(label);
    this.pending.set(true);
  }
}

describe('AddAccountFormComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const input = () => q<HTMLInputElement>('add-account-name') as HTMLInputElement;
  const submit = () => q<HTMLButtonElement>('add-account-submit') as HTMLButtonElement;
  const alert = () => q('add-account-error') as HTMLElement;
  const form = () => q<HTMLFormElement>('add-account-form') as HTMLFormElement;
  const type = (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const send = () => {
    form().dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    (fixture.nativeElement as HTMLElement).remove();
  });

  it('starts empty with focus on the labelled name input', () => {
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    expect(el().querySelector('label[for="add-account-name"]')?.textContent).toBe('Name this account');
    expect(input().getAttribute('maxlength')).toBe(String(PROVIDER_ACCOUNT_LABEL_MAX_LENGTH));
    expect(input().getAttribute('aria-describedby')).toBe('add-account-name-hint add-account-name-error');
    expect(alert().getAttribute('role')).toBe('alert');
    expect(submit().disabled).toBe(true);
    expect(submit().textContent?.trim()).toBe('Add account');
  });

  it('refuses a duplicate name case-insensitively', () => {
    type(' work ');
    expect(alert().textContent).toBe(PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(submit().disabled).toBe(true);
  });

  it('refuses the reserved ambient name', () => {
    type('Existing Claude login');
    expect(alert().textContent).toBe(PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY);
    expect(submit().disabled).toBe(true);
  });

  it('refuses an unsafe name with the validator copy', () => {
    type('a\u0007b');
    expect(alert().textContent).toBe(UNSAFE_ACCOUNT_NAME_MESSAGE);
    expect(submit().disabled).toBe(true);
  });

  it('emits the trimmed name once, re-read at submit', () => {
    type('  Personal  ');
    expect(submit().disabled).toBe(false);
    expect(input().getAttribute('aria-invalid')).toBe('false');
    send();
    expect(host.submitted).toEqual(['Personal']);
  });

  it('shows pending: Adding…, disabled controls, aria-busy and focus on the status', () => {
    type('Personal');
    input().focus();
    send();
    expect(submit().textContent?.trim()).toBe('Adding…');
    expect(submit().disabled).toBe(true);
    expect(input().disabled).toBe(true);
    expect((q<HTMLButtonElement>('add-account-cancel') as HTMLButtonElement).disabled).toBe(true);
    expect(form().getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(q('add-account-status'));
    send();
    expect(host.submitted).toEqual(['Personal']);
  });

  it('keeps the value on a host refusal, shows it in the alert and returns focus to the input (B-2)', () => {
    type('Personal');
    send();
    host.refusal.set(PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY);
    host.pending.set(false);
    fixture.detectChanges();
    expect(input().value).toBe('Personal');
    expect(alert().textContent).toBe(PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY);
    expect(document.activeElement).toBe(input());
    type('Personal 2');
    expect(alert().textContent).toBe('');
  });

  it('keeps focus elsewhere after a refusal when the user moved it (B-2)', () => {
    type('Personal');
    send();
    const elsewhere = q<HTMLButtonElement>('elsewhere') as HTMLButtonElement;
    elsewhere.focus();
    host.refusal.set('Could not add the account.');
    host.pending.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(elsewhere);
    expect(alert().textContent).toBe('Could not add the account.');
  });

  it('replaces an unsafe host sentence with fixed copy', () => {
    type('Personal');
    send();
    host.refusal.set('/home/user/.claude is not readable');
    host.pending.set(false);
    fixture.detectChanges();
    expect(alert().textContent).toBe('This action did not complete. Refresh and try again.');
  });

  it('Escape and Cancel emit cancelled; Escape does not reach the drawer', () => {
    const outer = jest.fn();
    document.addEventListener('keydown', outer);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input().dispatchEvent(escape);
    fixture.detectChanges();
    document.removeEventListener('keydown', outer);
    expect(host.cancelled).toBe(1);
    expect(escape.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();

    host.open.set(true);
    fixture.detectChanges();
    expect(input().value).toBe('');
    (q<HTMLButtonElement>('add-account-cancel') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.cancelled).toBe(2);
  });

  it('ignores Escape while pending', () => {
    type('Personal');
    send();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(host.cancelled).toBe(0);
  });
});
