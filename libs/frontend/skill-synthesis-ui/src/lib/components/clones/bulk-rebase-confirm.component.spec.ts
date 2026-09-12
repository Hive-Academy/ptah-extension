import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BulkRebaseConfirmComponent } from './bulk-rebase-confirm.component';

/**
 * Host for the dismissal contract. The confirmation is created and destroyed
 * with the open flag (exactly as `SkillClonesViewComponent` does it), which is
 * what makes focus restoration observable.
 */
@Component({
  standalone: true,
  imports: [BulkRebaseConfirmComponent],
  template: `
    <button type="button" data-testid="opener" (click)="open.set(true)">
      Rebase all diverged
    </button>
    @if (open()) {
      <ptah-bulk-rebase-confirm
        [count]="2"
        (confirmed)="confirmed = confirmed + 1"
        (cancelled)="onCancelled()"
      />
    }
  `,
})
class HostComponent {
  public readonly open = signal(false);
  public confirmed = 0;
  public cancelled = 0;

  public onCancelled(): void {
    this.cancelled += 1;
    this.open.set(false);
  }
}

describe('BulkRebaseConfirmComponent — dismissal', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const q = <T extends HTMLElement>(testId: string): T | null =>
      root.querySelector<T>(`[data-testid="${testId}"]`);

    // The host is attached so focus() actually moves the active element.
    document.body.appendChild(root);
    const opener = q<HTMLButtonElement>('opener') as HTMLButtonElement;
    opener.focus();
    opener.click();
    fixture.detectChanges();

    return { fixture, q, opener, host: fixture.componentInstance };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('starts focus on Cancel, the SAFE control, not on the destructive one', () => {
    const { q } = setup();
    expect(document.activeElement).toBe(q('clones-bulk-cancel'));
  });

  it('cancels on Escape', () => {
    const { fixture, q, host } = setup();

    q('clones-bulk-modal')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();

    expect(host.cancelled).toBe(1);
    expect(host.confirmed).toBe(0);
    expect(q('clones-bulk-modal')).toBeNull();
  });

  it('cancels on a backdrop click', () => {
    const { fixture, q, host } = setup();

    q<HTMLButtonElement>('clones-bulk-backdrop')?.click();
    fixture.detectChanges();

    expect(host.cancelled).toBe(1);
    expect(host.confirmed).toBe(0);
  });

  it('returns focus to the control that opened it', () => {
    const { fixture, q, opener } = setup();

    q<HTMLButtonElement>('clones-bulk-cancel')?.click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(opener);
  });

  it('still emits confirmed from the destructive control', () => {
    const { fixture, q, host } = setup();

    q<HTMLButtonElement>('clones-bulk-confirm')?.click();
    fixture.detectChanges();

    expect(host.confirmed).toBe(1);
    expect(host.cancelled).toBe(0);
  });
});
