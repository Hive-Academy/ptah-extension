import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import { CompactSessionActivityComponent } from './compact-session-activity.component';

describe('CompactSessionActivityComponent', () => {
  let fixture: ComponentFixture<CompactSessionActivityComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompactSessionActivityComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CompactSessionActivityComponent);
  });

  it('renders a cost badge for a genuinely zero-cost agent entry', () => {
    const agentNode: ExecutionNode = {
      id: 'agent-1',
      type: 'agent',
      status: 'complete',
      content: null,
      agentType: 'local-agent',
      toolCallId: 'tool-1',
      tokenUsage: { input: 100, output: 50 },
      cost: 0,
      children: [],
      isCollapsed: false,
    };
    const message: ExecutionChatMessage = {
      id: 'message-1',
      role: 'assistant',
      timestamp: 1,
      streamingState: agentNode,
    };

    fixture.componentRef.setInput('messages', [message]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('$0.0000');
  });
});
