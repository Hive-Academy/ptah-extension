import { TestBed } from '@angular/core/testing';
import { WorkflowCardComponent } from './workflow-card.component';

describe('WorkflowCardComponent', () => {
  it('names the section and emits its action', () => {
    const fixture = TestBed.createComponent(WorkflowCardComponent);
    fixture.componentRef.setInput('id', 'agents');
    fixture.componentRef.setInput('title', 'Generate agents');
    fixture.componentRef.setInput('description', 'Create agents');
    fixture.componentRef.setInput('action', 'Open');
    const open = jest.fn();
    fixture.componentInstance.open.subscribe(open);
    fixture.detectChanges();
    expect(
      fixture.nativeElement
        .querySelector('section')
        .getAttribute('aria-labelledby'),
    ).toBe('agents');
    fixture.nativeElement.querySelector('button').click();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
