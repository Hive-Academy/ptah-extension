import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AcceptedAnswerBadge } from './accepted-answer-badge';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AcceptedAnswerBadge],
  template: `<ptah-accepted-answer-badge [hoisted]="hoisted()" />`,
})
class HostComponent {
  public readonly hoisted = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

describe('AcceptedAnswerBadge', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders through the SHARED StatusBadge, not a bespoke pill (R9.7)', () => {
    // If this stops resolving to `ptah-status-badge`, a second green chip has
    // been introduced and there are now two things to restyle when the panel
    // theme moves.
    const fixture = render();

    expect(
      fixture.nativeElement.querySelector('ptah-status-badge'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.badge-success'),
    ).not.toBeNull();
  });

  it('reads "Accepted" in place and "Accepted answer" when hoisted', () => {
    // The same post is rendered twice on a thread page (§3.3, R1.5.1): hoisted
    // above the list, and again in chronological order. The hoist announces
    // itself; the in-line copy only marks the spot.
    const fixture = render();
    expect(fixture.nativeElement.textContent).toContain('Accepted');
    expect(fixture.nativeElement.textContent).not.toContain('Accepted answer');

    fixture.componentInstance.hoisted.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Accepted answer');
  });
});
