import { TestBed } from '@angular/core/testing';
import type { ExecutionNode, ExecutionStatus } from '@ptah-extension/shared';
import { SendMessageChipComponent } from './send-message-chip.component';

/** SendMessage `tool` node, optionally carrying the resumed subagent as a child. */
function sendMessageNode(children: ExecutionNode[] = []): ExecutionNode {
  return {
    id: 'tool-1',
    type: 'tool',
    status: 'complete',
    content: null,
    toolName: 'SendMessage',
    toolCallId: 'toolu_send_1',
    toolInput: { to: 'researcher', summary: 'Continue the audit' },
    children,
  } as ExecutionNode;
}

function agentChild(status: ExecutionStatus): ExecutionNode {
  return {
    id: 'agent-1',
    type: 'agent',
    status,
    content: null,
    children: [],
  } as ExecutionNode;
}

describe('SendMessageChipComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SendMessageChipComponent],
    }).compileComponents();
  });

  function render(node: ExecutionNode) {
    const fixture = TestBed.createComponent(SendMessageChipComponent);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    return fixture;
  }

  function statusBadge(fixture: ReturnType<typeof render>): HTMLElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="resumed-agent-status"]',
    );
  }

  it('renders recipient and summary', () => {
    const fixture = render(sendMessageNode());
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('researcher');
    expect(text).toContain('Continue the audit');
  });

  it('renders no status badge without an agent child', () => {
    expect(statusBadge(render(sendMessageNode()))).toBeNull();
  });

  it.each<ExecutionStatus>(['pending', 'streaming'])(
    'shows "running" while the resumed agent is %s',
    (status) => {
      const badge = statusBadge(render(sendMessageNode([agentChild(status)])));
      expect(badge?.dataset['status']).toBe('running');
      expect(badge?.textContent).toContain('running');
    },
  );

  it('shows "done" once the resumed agent completes', () => {
    const badge = statusBadge(
      render(sendMessageNode([agentChild('complete')])),
    );
    expect(badge?.dataset['status']).toBe('done');
    expect(badge?.textContent).toContain('done');
  });

  it('updates from running to done when the child status changes', () => {
    const fixture = render(sendMessageNode([agentChild('streaming')]));
    expect(statusBadge(fixture)?.dataset['status']).toBe('running');

    fixture.componentRef.setInput(
      'node',
      sendMessageNode([agentChild('complete')]),
    );
    fixture.detectChanges();
    expect(statusBadge(fixture)?.dataset['status']).toBe('done');
  });

  it('ignores non-agent children', () => {
    const textChild = {
      id: 'text-1',
      type: 'text',
      status: 'streaming',
      content: 'tool result',
      children: [],
    } as ExecutionNode;
    expect(statusBadge(render(sendMessageNode([textChild])))).toBeNull();
  });
});
