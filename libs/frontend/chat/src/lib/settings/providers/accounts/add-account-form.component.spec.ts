import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PROVIDER_ACCOUNT_LABEL_MAX_LENGTH, type ProviderAccountSummary } from '@ptah-extension/shared';
import { isDisabledControl } from '../../feedback/busy-disabled.testing';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';
import { ACCOUNT_COPY, UNSAFE_ACCOUNT_NAME_MESSAGE } from './account-presentation';
import { AddAccountFormComponent } from './add-account-form.component';

@Component({
  standalone: true,
  imports: [AddAccountFormComponent],
  template: `
    @if (open()) {
      <ptah-add-account-form
        [accounts]="accounts()"
        [pending]="pending()"
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
  let announce: jest.Mock;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const input = () => q<HTMLInputElement>('add-account-name') as HTMLInputElement;
  const submit = () => q<HTMLButtonElement>('add-account-submit') as HTMLButtonElement;
  const cancelButton = () => q<HTMLButtonElement>('add-account-cancel') as HTMLButtonElement;
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
    announce = jest.fn();
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: SettingsSaveFeedbackService, useValue: { announce } }],
    }).compileComponents();
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

  it('starts empty with focus on the labelled input and a read-as-disabled Add', () => {
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    expect(el().querySelector('label[for="add-account-name"]')?.textContent?.trim()).toBe('Account name');
    expect(input().getAttribute('maxlength')).toBe(String(PROVIDER_ACCOUNT_LABEL_MAX_LENGTH));
    expect(submit().textContent?.trim()).toBe('Add');
    expect(submit().disabled).toBe(false);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(cancelButton().textContent?.trim()).toBe('Cancel');
  });

  it('has no helper copy and no inline status or alert line', () => {
    expect(el().textContent).not.toContain('Only you see this name');
    expect(el().querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull();
  });

  it('enables Add once the field is not blank', () => {
    type('   ');
    expect(isDisabledControl(submit())).toBe(true);
    type('Personal');
    expect(isDisabledControl(submit())).toBe(false);
  });

  it('ignores an empty submit without a toast', () => {
    type('  ');
    send();
    expect(host.submitted).toEqual([]);
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces a duplicate name as the design alert toast and keeps focus in the input', () => {
    type(' work ');
    submit().focus();
    send();
    expect(host.submitted).toEqual([]);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.nameTaken, 'alert');
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe(' work ');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    type('Work 2');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });

  it('announces the reserved ambient name as taken', () => {
    type('Existing Claude login');
    send();
    expect(announce).toHaveBeenCalledWith(ACCOUNT_COPY.nameTaken, 'alert');
  });

  it('announces an unsafe name with the validator copy', () => {
    type('a\u0007b');
    send();
    expect(announce).toHaveBeenCalledWith(UNSAFE_ACCOUNT_NAME_MESSAGE, 'alert');
    expect(document.activeElement).toBe(input());
  });

  it('emits the trimmed name once, re-read at submit, without a toast', () => {
    type('  Personal  ');
    send();
    expect(host.submitted).toEqual(['Personal']);
    expect(announce).not.toHaveBeenCalled();
  });

  it('while pending shows Adding…, keeps every control focusable but busy, and keeps focus', () => {
    type('Personal');
    input().focus();
    send();
    expect(submit().textContent?.trim()).toBe('Adding…');
    expect(submit().disabled).toBe(false);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(input().disabled).toBe(false);
    expect(input().readOnly).toBe(true);
    expect(cancelButton().getAttribute('aria-disabled')).toBe('true');
    expect(form().getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(input());
    send();
    expect(host.submitted).toEqual(['Personal']);
  });

  it('keeps the value and focus after the parent ends the write without closing the form (B-2)', () => {
    type('Personal');
    input().focus();
    send();
    host.pending.set(false);
    fixture.detectChanges();
    expect(input().value).toBe('Personal');
    expect(document.activeElement).toBe(input());
    expect(isDisabledControl(submit())).toBe(false);
  });

  it('does not take focus back when the user moved it during the write (B-2)', () => {
    type('Personal');
    send();
    const elsewhere = q<HTMLButtonElement>('elsewhere') as HTMLButtonElement;
    elsewhere.focus();
    host.pending.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(elsewhere);
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
    cancelButton().click();
    fixture.detectChanges();
    expect(host.cancelled).toBe(2);
  });

  it('ignores Escape and Cancel while pending', () => {
    type('Personal');
    send();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    cancelButton().click();
    fixture.detectChanges();
    expect(host.cancelled).toBe(0);
  });
});
