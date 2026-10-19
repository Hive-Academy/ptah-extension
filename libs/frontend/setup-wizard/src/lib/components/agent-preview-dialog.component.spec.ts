import { TestBed } from '@angular/core/testing';
import { AgentPreviewDialogComponent } from './agent-preview-dialog.component';

describe('AgentPreviewDialogComponent', () => {
  it('shows certainty and changed target warning, and Escape cancels', () => {
    const fixture = TestBed.createComponent(AgentPreviewDialogComponent);
    const cancel = jest.fn();
    fixture.componentInstance.dismissed.subscribe(cancel);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('changed', true);
    fixture.componentRef.setInput('preview', {
      agents: [
        {
          agentId: 'frontend-developer',
          files: [
            {
              relPath: '.claude/agents/frontend.md',
              target: 'claude',
              certainty: 'definite',
              willOverwrite: true,
            },
          ],
        },
      ],
    });
    fixture.detectChanges();
    const dialog: HTMLElement =
      fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog.textContent).toContain('definite');
    expect(dialog.textContent).toContain('Targets changed');
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
