import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
  type TemplateRef,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div></div>',
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

import { TestBed } from '@angular/core/testing';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import type {
  ExecutionNode,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { ExecutionNodeComponent } from './execution-node.component';
import { InlineAgentBubbleComponent } from './inline-agent-bubble.component';

/**
 * Stand-in for the agent bubble: the real one injects agent-monitor stores,
 * which are irrelevant to whether the SendMessage branch renders its children.
 */
@Component({
  selector: 'ptah-inline-agent-bubble',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="agent-bubble-stub">{{ node().id }}</div>`,
})
class InlineAgentBubbleStubComponent {
  readonly node = input.required<ExecutionNode>();
  readonly getPermissionForTool = input<
    ((toolCallId: string) => PermissionRequest | null) | undefined
  >();
  readonly nodeTemplate = input<TemplateRef<unknown>>();
  readonly isFinalizing = input<boolean>(false);
  readonly permissionResponded = output<PermissionResponse>();
}

function sendMessageNode(children: ExecutionNode[]): ExecutionNode {
  return {
    id: 'tool-send',
    type: 'tool',
    status: 'complete',
    content: null,
    toolName: 'SendMessage',
    toolCallId: 'toolu_send_1',
    toolInput: { to: 'researcher', message: 'Keep going' },
    children,
  } as ExecutionNode;
}

const resumedAgent = {
  id: 'agent-resumed',
  type: 'agent',
  status: 'streaming',
  content: null,
  agentType: 'researcher',
  children: [],
} as unknown as ExecutionNode;

describe('ExecutionNodeComponent — SendMessage branch', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExecutionNodeComponent],
      providers: [{ provide: SURFACE_ACTIVE, useValue: signal(true) }],
    });
    TestBed.overrideComponent(ExecutionNodeComponent, {
      remove: { imports: [InlineAgentBubbleComponent] },
      add: { imports: [InlineAgentBubbleStubComponent] },
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  function render(node: ExecutionNode) {
    const fixture = TestBed.createComponent(ExecutionNodeComponent);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the resumed agent child beneath the SendMessage chip', () => {
    const el: HTMLElement = render(
      sendMessageNode([resumedAgent]),
    ).nativeElement;

    expect(el.querySelector('ptah-send-message-chip')).not.toBeNull();
    const bubble = el.querySelector('[data-testid="agent-bubble-stub"]');
    expect(bubble?.textContent).toContain('agent-resumed');
    expect(bubble?.closest('.exec-children')).not.toBeNull();
    expect(
      el
        .querySelector('[data-testid="resumed-agent-status"]')
        ?.getAttribute('data-status'),
    ).toBe('running');
  });

  it('renders no children container when the SendMessage node has none', () => {
    const el: HTMLElement = render(sendMessageNode([])).nativeElement;

    expect(el.querySelector('ptah-send-message-chip')).not.toBeNull();
    expect(el.querySelector('.exec-children')).toBeNull();
  });
});
