/**
 * SingleChatSubagentViewComponent (TASK_2026_629 R9n, parity row 103): the
 * live agent node in full with tile mode off, permissions answered through
 * ChatStore (the R9g tile-mode permission gate), Back by button or Escape,
 * focus on entry, and Escape in an editable field keeps the view and its
 * draft (codex-review-R9n finding 1).
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  input,
  output,
  signal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  createExecutionNode,
  type ExecutionNode,
  type PermissionRequest,
  type PermissionResponse,
} from '@ptah-extension/shared';
import {
  AgentMonitorStore,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { ChatStore } from '../../../services/chat.store';
import { ExecutionNodeComponent } from '../execution/execution-node.component';
import { SubagentLaneComponent } from '../subagent-lane/subagent-lane.component';
import { SingleChatSubagentViewComponent } from './single-chat-subagent-view.component';

@Component({
  selector: 'ptah-execution-node',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Stands in for the nested "Message this agent" field of an agent bubble.
  template: '<textarea data-testid="agent-draft"></textarea>',
})
class ExecutionNodeStub {
  readonly node = input.required<ExecutionNode>();
  readonly isStreaming = input<boolean>(false);
  readonly agentTileMode = input<boolean>(false);
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();
  readonly permissionResponded = output<PermissionResponse>();
}

@Component({
  selector: 'ptah-subagent-lane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<input aria-label="Lane message" />',
})
class SubagentLaneStub {
  readonly record = input.required<SubagentRecord>();
  readonly sessionId = input<string | null>(null);
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();
  readonly permissionResponded = output<PermissionResponse>();
}

const PENDING = {
  id: 'perm-1',
  toolUseId: 'tool-p',
} as unknown as PermissionRequest;

function agentNode(children: readonly ExecutionNode[] = []): ExecutionNode {
  return createExecutionNode({
    id: 'agent-node-1',
    type: 'agent',
    status: 'streaming',
    toolCallId: 'agent-1',
    agentType: 'reviewer',
    children: [...children],
  });
}

function bash(toolCallId: string): ExecutionNode {
  return createExecutionNode({
    id: `node-${toolCallId}`,
    type: 'tool',
    status: 'pending',
    toolName: 'Bash',
    toolCallId,
  });
}

describe('SingleChatSubagentViewComponent (R9n)', () => {
  let chatStore: {
    getPermissionForTool: jest.Mock;
    handlePermissionResponse: jest.Mock;
  };
  let fixture: ComponentFixture<SingleChatSubagentViewComponent>;
  const subagents = signal<ReadonlyMap<string, SubagentRecord>>(new Map());

  function mount(node: ExecutionNode, isStreaming = false): void {
    fixture = TestBed.createComponent(SingleChatSubagentViewComponent);
    fixture.componentRef.setInput('node', node);
    fixture.componentRef.setInput('isStreaming', isStreaming);
    fixture.detectChanges();
  }

  const nodeStub = (): ExecutionNodeStub | null =>
    (fixture.debugElement.query(By.directive(ExecutionNodeStub))
      ?.componentInstance as ExecutionNodeStub | undefined) ?? null;
  const byTestId = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(() => {
    chatStore = {
      getPermissionForTool: jest.fn((toolCallId: string) =>
        toolCallId === 'tool-p' ? PENDING : null,
      ),
      handlePermissionResponse: jest.fn(),
    };
    subagents.set(new Map());
    TestBed.configureTestingModule({
      imports: [SingleChatSubagentViewComponent],
      providers: [
        { provide: ChatStore, useValue: chatStore },
        { provide: AgentMonitorStore, useValue: { subagents } },
      ],
    });
    TestBed.overrideComponent(SingleChatSubagentViewComponent, {
      remove: { imports: [ExecutionNodeComponent, SubagentLaneComponent] },
      add: { imports: [ExecutionNodeStub, SubagentLaneStub] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders the live agent node in full with tile mode off and follows updates in place', () => {
    const first = agentNode([bash('tool-a')]);
    mount(first, true);

    const stub = nodeStub();
    expect(stub?.node()).toBe(first);
    expect(stub?.agentTileMode()).toBe(false);
    expect(stub?.isStreaming()).toBe(true);
    expect(byTestId('subagent-view-name')?.textContent?.trim()).toBe(
      'reviewer',
    );

    // A rebuilt tree hands a new node: same execution-node instance, new input.
    const next = agentNode([bash('tool-a'), bash('tool-b')]);
    fixture.componentRef.setInput('node', next);
    fixture.componentRef.setInput('isStreaming', false);
    fixture.detectChanges();
    expect(nodeStub()).toBe(stub);
    expect(stub?.node()).toBe(next);
    expect(stub?.isStreaming()).toBe(false);
  });

  it('keeps a pending descendant permission answerable through ChatStore (R9g finding 3)', () => {
    mount(agentNode([bash('tool-p')]));
    const stub = nodeStub();
    const lookup = stub?.getPermissionForTool();

    expect(lookup?.('tool-p')).toBe(PENDING);
    expect(lookup?.('tool-x')).toBeNull();
    expect(chatStore.getPermissionForTool).toHaveBeenCalledWith('tool-p');

    const response = {
      id: 'perm-1',
      decision: 'allow',
    } as unknown as PermissionResponse;
    stub?.permissionResponded.emit(response);
    expect(chatStore.handlePermissionResponse).toHaveBeenCalledWith(response);
  });

  it('renders the store-backed lane when the agent has a monitor record', () => {
    const record: SubagentRecord = {
      parentToolUseId: 'agent-1',
      parentSessionId: 'session-9',
      status: 'completed',
    };
    subagents.set(new Map([['agent-1', record]]));
    mount(agentNode([bash('tool-p')]));
    const lane = fixture.debugElement.query(By.directive(SubagentLaneStub))
      ?.componentInstance as SubagentLaneStub | undefined;
    expect(lane?.record()).toBe(record);
    expect(lane?.sessionId()).toBe('session-9');
    expect(nodeStub()).toBeNull();
    expect(lane?.getPermissionForTool()?.('tool-p')).toBe(PENDING);
    const response = {
      id: 'perm-1',
      decision: 'allow',
    } as PermissionResponse;
    lane?.permissionResponded.emit(response);
    expect(chatStore.handlePermissionResponse).toHaveBeenCalledWith(response);
  });

  it('falls back to the agent node without a record and switches once one appears', () => {
    mount(agentNode());
    expect(nodeStub()).not.toBeNull();
    expect(
      fixture.debugElement.query(By.directive(SubagentLaneStub)),
    ).toBeNull();
    subagents.set(
      new Map([['agent-1', { parentToolUseId: 'agent-1', status: 'running' }]]),
    );
    fixture.detectChanges();
    expect(nodeStub()).toBeNull();
    const lane = fixture.debugElement.query(By.directive(SubagentLaneStub))
      ?.componentInstance as SubagentLaneStub | undefined;
    expect(lane?.sessionId()).toBeNull();
  });

  it('Escape in the lane message field keeps the view', () => {
    subagents.set(
      new Map([['agent-1', { parentToolUseId: 'agent-1', status: 'running' }]]),
    );
    mount(agentNode());
    const emitted = jest.fn();
    fixture.componentInstance.back.subscribe(emitted);
    const field = fixture.nativeElement.querySelector(
      'input[aria-label="Lane message"]',
    ) as HTMLInputElement;
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(emitted).not.toHaveBeenCalled();
  });

  it('moves focus to Back on entry and emits back on click', () => {
    mount(agentNode());
    const backButton = byTestId('subagent-view-back');
    expect(document.activeElement).toBe(backButton);

    const back = jest.fn();
    fixture.componentInstance.back.subscribe(back);
    backButton?.click();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('leaves on Escape unless a control inside already handled it', () => {
    mount(agentNode());
    const back = jest.fn();
    fixture.componentInstance.back.subscribe(back);
    const host: HTMLElement = fixture.nativeElement;

    const handled = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    host.dispatchEvent(handled);
    expect(back).not.toHaveBeenCalled();

    host.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('Escape in an editable field keeps the view and its draft; elsewhere it leaves', () => {
    mount(agentNode());
    const back = jest.fn();
    fixture.componentInstance.back.subscribe(back);
    const escape = (): KeyboardEvent =>
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });

    const draft = byTestId('agent-draft') as HTMLTextAreaElement;
    draft.value = 'half-written message to the agent';
    draft.focus();
    const inField = escape();
    draft.dispatchEvent(inField);
    fixture.detectChanges();
    expect(back).not.toHaveBeenCalled();
    expect(inField.defaultPrevented).toBe(false);
    expect(byTestId('agent-draft')).toBe(draft);
    expect(draft.value).toBe('half-written message to the agent');

    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    byTestId('subagent-view-body')?.appendChild(editable);
    inner.dispatchEvent(escape());
    expect(back).not.toHaveBeenCalled();

    byTestId('subagent-view-body')?.dispatchEvent(escape());
    expect(back).toHaveBeenCalledTimes(1);
  });
});
