import { TestBed } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import type { EligibilityHistogramDto } from '@ptah-extension/shared';

import { EligibilityHistogramComponent } from './eligibility-histogram.component';

@Component({
  selector: 'ptah-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EligibilityHistogramComponent],
  template: `<ptah-eligibility-histogram [histogram]="histogram()" />`,
})
class HostComponent {
  public readonly histogram = signal<EligibilityHistogramDto>({
    tooFewTurns: 0,
    lowFidelity: 0,
    insufficientAbstraction: 0,
    accepted: 0,
  });
}

describe('EligibilityHistogramComponent', () => {
  it('shows empty state when total is zero', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'No eligibility data recorded yet',
    );
  });

  it('renders four bars proportional to their values', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.histogram.set({
      tooFewTurns: 1,
      lowFidelity: 2,
      insufficientAbstraction: 4,
      accepted: 8,
    });
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll(
      '[role="listitem"]',
    ) as NodeListOf<HTMLElement>;
    expect(items.length).toBe(4);

    const bars = fixture.nativeElement.querySelectorAll(
      '[role="listitem"] > div > div',
    ) as NodeListOf<HTMLElement>;
    expect(bars.length).toBe(4);
    expect(bars[0].style.width).toBe('12.5%');
    expect(bars[1].style.width).toBe('25%');
    expect(bars[2].style.width).toBe('50%');
    expect(bars[3].style.width).toBe('100%');

    const labels = Array.from(items).map((it) =>
      it.querySelector('span:first-child')?.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Too few turns',
      'Low fidelity',
      'Insufficient abstraction',
      'Accepted',
    ]);
  });
});
