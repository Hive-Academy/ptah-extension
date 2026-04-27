import { TestBed } from '@angular/core/testing';
import { StatusBadgeComponent } from './status-badge.component';
import type { ExecutionStatus } from '@ptah-extension/shared';

describe('StatusBadgeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBadgeComponent],
    }).compileComponents();
  });

  function render(status: ExecutionStatus) {
    const fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    return fixture;
  }

  it.each<[ExecutionStatus, string, string]>([
    ['pending', 'Pending', 'badge-ghost'],
    ['streaming', 'Streaming', 'badge-info'],
    ['complete', 'Done', 'badge-success'],
    ['interrupted', 'Stopped', 'badge-warning'],
    ['resumed', 'Resumed', 'badge-success'],
    ['error', 'Error', 'badge-error'],
  ])('renders %s with label "%s" and class %s', (status, label, klass) => {
    const fixture = render(status);
    const span = fixture.nativeElement.querySelector('span.badge');
    expect(span.textContent).toContain(label);
    expect(span.className).toContain(klass);
  });

  it('renders the streaming spinner when status is streaming', () => {
    const fixture = render('streaming');
    expect(
      fixture.nativeElement.querySelector('.loading.loading-spinner'),
    ).not.toBeNull();
  });
});
