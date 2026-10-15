import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { VSCodeService } from '@ptah-extension/core';
import type { ExecutionNode } from '@ptah-extension/shared';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import { WorkflowCardComponent } from './workflow-card.component';

describe('WorkflowCardComponent', () => {
  const requestPanelOpen = jest.fn();
  const node = {
    id: 'workflow', type: 'tool', status: 'complete', content: null,
    toolName: 'Workflow', toolInput: { name: 'Review' },
  } as ExecutionNode;

  function render(isElectron: boolean) {
    requestPanelOpen.mockClear();
    TestBed.configureTestingModule({
      imports: [WorkflowCardComponent],
      providers: [
        { provide: VSCodeService, useValue: { isElectron } },
        { provide: AgentMonitorStore, useValue: { requestPanelOpen } },
        { provide: SESSION_CONTEXT, useValue: signal('tab-1') },
      ],
    });
    const fixture = TestBed.createComponent(WorkflowCardComponent);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a static lane hint in Electron without requesting a panel', () => {
    const fixture = render(true);
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Its agents appear as lanes of this session.');
    expect(requestPanelOpen).not.toHaveBeenCalled();
  });

  it('requests the VS Code Agents panel for this tab', () => {
    const fixture = render(false);
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(requestPanelOpen).toHaveBeenCalledWith('tab-1');
  });
});
