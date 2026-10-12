import { TestBed } from '@angular/core/testing';
import { AgentPermissionResponder } from '@ptah-extension/chat';
import type { AgentPermissionRequest } from '@ptah-extension/shared';
import { TileAgentMiniPanelComponent } from './tile-agent-mini-panel.component';

describe('TileAgentMiniPanelComponent', () => {
  const respondLane = jest.fn();
  const permission = (requestId: string): AgentPermissionRequest => ({
    requestId,
    agentId: 'agent-1',
    kind: 'write',
    toolName: 'edit',
    toolArgs: '{}',
    description: 'Edit file',
    timestamp: 1,
  });

  beforeEach(() => {
    respondLane.mockClear();
    TestBed.configureTestingModule({
      imports: [TileAgentMiniPanelComponent],
      providers: [
        { provide: AgentPermissionResponder, useValue: { respondLane } },
      ],
    });
  });

  it('passes each request ID and decision to the shared responder', () => {
    const fixture = TestBed.createComponent(TileAgentMiniPanelComponent);
    fixture.componentRef.setInput('agents', []);
    fixture.detectChanges();

    fixture.componentInstance.allowPermission('agent-1', permission('first'));
    fixture.componentInstance.denyPermission('agent-1', permission('second'));

    expect(respondLane).toHaveBeenNthCalledWith(1, 'agent-1', 'first', 'allow');
    expect(respondLane).toHaveBeenNthCalledWith(2, 'agent-1', 'second', 'deny');
  });
});
