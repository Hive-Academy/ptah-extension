import { TestBed } from '@angular/core/testing';
import { WorkflowBadgeComponent } from './workflow-badge.component';

describe('WorkflowBadgeComponent', () => {
  it('shows a labelled badge only for a known kind', () => {
    const fixture = TestBed.createComponent(WorkflowBadgeComponent);
    fixture.componentRef.setInput('workflow', 'harness-configure');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[aria-label="Workflow: Configure Harness"]',
      ),
    ).not.toBeNull();
    fixture.componentRef.setInput('workflow', 'unknown');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.badge')).toBeNull();
  });
});
