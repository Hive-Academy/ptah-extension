/**
 * MessageBubbleComponent specs — focused on the role-gated branch/rewind
 * action buttons added alongside the existing copy button.
 *
 * Mocks `ngx-markdown` (ESM-only, breaks Jest) and the lucide-angular module
 * via the same stub pattern used in chat-input.component.spec.ts.
 */

import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
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

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { createExecutionChatMessage } from '@ptah-extension/shared';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { MessageBubbleComponent } from './message-bubble.component';
import { buildTurnContexts } from '../../utils/turn-facts.utils';
import { ExecutionNodeComponent } from './execution/execution-node.component';
import { VSCodeService } from '@ptah-extension/core';
import { ChatStore } from '../../services/chat.store';

describe('MessageBubbleComponent — branch/rewind action buttons', () => {
  let fixture: ComponentFixture<MessageBubbleComponent>;

  // Minimal fakes — the component only reads `getPtahIconUri` /
  // `getPtahUserIconUri` from VSCodeService and `getPermissionForTool` /
  // `handlePermissionResponse` from ChatStore in code paths these tests don't
  // exercise. Returning safe defaults keeps the component happy in tests.
  const vscodeStub: Partial<VSCodeService> = {
    getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
    getPtahUserIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
  };
  const chatStoreStub: Partial<ChatStore> = {
    getPermissionForTool: () => null,
    handlePermissionResponse: jest.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MessageBubbleComponent],
      providers: [
        provideSurfaceActiveTesting(),
        { provide: VSCodeService, useValue: vscodeStub },
        { provide: ChatStore, useValue: chatStoreStub },
      ],
    }).compileComponents();
  });

  function setMessage(message: ExecutionChatMessage): void {
    fixture = TestBed.createComponent(MessageBubbleComponent);
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
  }

  it('forwards the opt-in agent tile mode to each execution tree row', () => {
    setMessage(createExecutionChatMessage({
      id: 'agent-message', role: 'assistant', rawContent: '',
      streamingState: { id: 'root', type: 'message', status: 'complete', content: null,
        children: [{ id: 'text-1', type: 'text', status: 'complete', content: 'done',
          children: [], isCollapsed: false }], isCollapsed: false },
    }));
    fixture.componentRef.setInput('agentTileMode', true);
    fixture.detectChanges();
    // The bubble renders the root's children itself (work log / answer),
    // each through an unchanged ptah-execution-node.
    const row = fixture.debugElement.query(By.directive(ExecutionNodeComponent));
    expect(row.componentInstance.node().id).toBe('text-1');
    expect(row.componentInstance.agentTileMode()).toBe(true);
  });

  it('renders branch + rewind buttons for user role messages', () => {
    setMessage(
      createExecutionChatMessage({
        id: 'msg-user-1',
        role: 'user',
        rawContent: 'hello',
      }),
    );

    const branch = fixture.debugElement.query(
      By.css('[data-testid="user-branch-button"]'),
    );
    const rewind = fixture.debugElement.query(
      By.css('[data-testid="user-rewind-button"]'),
    );

    expect(branch).not.toBeNull();
    expect(rewind).not.toBeNull();
  });

  it('does NOT render branch/rewind buttons for assistant role messages', () => {
    setMessage(
      createExecutionChatMessage({
        id: 'msg-assistant-1',
        role: 'assistant',
        rawContent: 'response',
      }),
    );

    const branch = fixture.debugElement.query(
      By.css('[data-testid="user-branch-button"]'),
    );
    const rewind = fixture.debugElement.query(
      By.css('[data-testid="user-rewind-button"]'),
    );

    expect(branch).toBeNull();
    expect(rewind).toBeNull();
  });

  /** A settled assistant message as its turn's only message. */
  function setSettledTurn(message: ExecutionChatMessage): void {
    fixture = TestBed.createComponent(MessageBubbleComponent);
    fixture.componentRef.setInput('message', message);
    fixture.componentRef.setInput(
      'turn',
      buildTurnContexts([message]).get(message.id) ?? null,
    );
    fixture.detectChanges();
  }

  function showActivityButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="turn-show-activity"]',
    );
  }

  function activityPanel(): HTMLElement | null {
    return fixture.nativeElement.querySelector(
      '[data-test="turn-activity-panel"]',
    );
  }

  it('keeps tokens and cost in the activity panel, closed by default (B-8, B-11)', async () => {
    setSettledTurn(
      createExecutionChatMessage({
        id: 'msg-assistant-priced',
        role: 'assistant',
        rawContent: 'response',
        tokens: { input: 10, output: 5 },
        cost: 0.5,
      }),
    );

    const button = showActivityButton();
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(activityPanel()).toBeNull();

    button?.click();
    fixture.detectChanges();

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    await fixture.whenStable();
    fixture.detectChanges();
    const panel = activityPanel();
    expect(panel?.id).toBe(button?.getAttribute('aria-controls'));
    expect(panel?.textContent).toContain('Tokens');
    expect(panel?.textContent).toContain('$0.50');
  });

  it('keeps the aria-controls target mounted while the activity panel loads', async () => {
    setSettledTurn(
      createExecutionChatMessage({
        id: 'msg-assistant-loading',
        role: 'assistant',
        rawContent: 'response',
        tokens: { input: 10, output: 5 },
      }),
    );

    const button = showActivityButton();
    button?.click();
    fixture.detectChanges();

    const controlledId = button?.getAttribute('aria-controls');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(controlledId).toBeTruthy();
    expect(fixture.nativeElement.querySelector(`[id="${controlledId}"]`)).not.toBeNull();
    expect(activityPanel()).toBeNull();

    await fixture.whenStable();
    fixture.detectChanges();
    expect(activityPanel()?.id).toBe(controlledId);
  });

  it('omits the cost item when usage has no known price', async () => {
    setSettledTurn(
      createExecutionChatMessage({
        id: 'msg-assistant-unpriced',
        role: 'assistant',
        rawContent: 'response',
        tokens: { input: 10, output: 5 },
        cost: null,
      }),
    );

    showActivityButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(activityPanel()?.textContent).toContain('Tokens');
    expect(activityPanel()?.textContent).not.toContain('Cost');
  });

  it('renders a genuinely known zero cost as $0.0000 in the activity panel', async () => {
    setSettledTurn(
      createExecutionChatMessage({
        id: 'msg-assistant-free',
        role: 'assistant',
        rawContent: 'response',
        tokens: { input: 10, output: 5 },
        cost: 0,
      }),
    );

    showActivityButton()?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(activityPanel()?.textContent).toContain('$0.0000');
  });

  it('renders no cost badge when a message has no usage', () => {
    setMessage(
      createExecutionChatMessage({
        id: 'msg-user-no-usage',
        role: 'user',
        rawContent: 'hello',
      }),
    );

    expect(fixture.debugElement.query(By.css('ptah-cost-badge'))).toBeNull();
    expect(
      fixture.debugElement.query(By.css('[data-testid="cost-unavailable"]')),
    ).toBeNull();
  });

  it('hides Show activity when every activity item is unknown', () => {
    setSettledTurn(
      createExecutionChatMessage({
        id: 'msg-assistant-empty-metadata',
        role: 'assistant',
        rawContent: 'response',
        cost: null,
      }),
    );

    expect(
      fixture.nativeElement.querySelector('[data-testid="turn-action-row"]'),
    ).not.toBeNull();
    expect(showActivityButton()).toBeNull();
    expect(activityPanel()).toBeNull();
  });

  it('renders the report control in the action row of a settled assistant turn', () => {
    setSettledTurn(
      createExecutionChatMessage({
        id: 'msg-assistant-report',
        role: 'assistant',
        rawContent: 'response',
      }),
    );

    const report = fixture.nativeElement.querySelector(
      '[data-testid="turn-action-row"] [data-testid="report-response-button"]',
    ) as HTMLAnchorElement | null;
    expect(report).not.toBeNull();
    expect(report?.getAttribute('href')).toMatch(/^mailto:help@ptah\.live\?/);
  });

  it('does NOT render the report control for user messages', () => {
    setMessage(
      createExecutionChatMessage({
        id: 'msg-user-report',
        role: 'user',
        rawContent: 'hello',
      }),
    );

    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="report-response-button"]',
      ),
    ).toBeNull();
  });

  it('emits branchRequested with the message id when the branch button is clicked', () => {
    setMessage(
      createExecutionChatMessage({
        id: 'msg-user-7',
        role: 'user',
        rawContent: 'fork me',
      }),
    );

    const emitted: string[] = [];
    fixture.componentInstance.branchRequested.subscribe((id) =>
      emitted.push(id),
    );

    const button = fixture.debugElement.query(
      By.css('[data-testid="user-branch-button"]'),
    );
    button.nativeElement.click();

    expect(emitted).toEqual(['msg-user-7']);
  });

  it('emits rewindRequested with the message id when the rewind button is clicked', () => {
    setMessage(
      createExecutionChatMessage({
        id: 'msg-user-9',
        role: 'user',
        rawContent: 'rewind me',
      }),
    );

    const emitted: string[] = [];
    fixture.componentInstance.rewindRequested.subscribe((id) =>
      emitted.push(id),
    );

    const button = fixture.debugElement.query(
      By.css('[data-testid="user-rewind-button"]'),
    );
    button.nativeElement.click();

    expect(emitted).toEqual(['msg-user-9']);
  });

  // Sentry NODE-NESTJS-2Y / 2N / 2X — rewind on a historical session that
  // has no live SDK Query handle throws SessionNotActiveError on the
  // backend. The UI guard disables the button and suppresses the click
  // emission so the RPC never fires.
  it('disables the rewind button and suppresses emission when session is inactive', () => {
    fixture = TestBed.createComponent(MessageBubbleComponent);
    fixture.componentRef.setInput(
      'message',
      createExecutionChatMessage({
        id: 'msg-user-inactive',
        role: 'user',
        rawContent: 'cold session',
      }),
    );
    fixture.componentRef.setInput('isSessionActive', false);
    fixture.detectChanges();

    const button = fixture.debugElement.query(
      By.css('[data-testid="user-rewind-button"]'),
    );
    expect(button).not.toBeNull();
    expect(button.nativeElement.disabled).toBe(true);

    const emitted: string[] = [];
    fixture.componentInstance.rewindRequested.subscribe((id) =>
      emitted.push(id),
    );

    // Programmatic click bypasses the `[disabled]` pointer guard but the
    // component's onRewindClick early-returns when isSessionActive is false.
    button.nativeElement.click();
    expect(emitted).toEqual([]);
  });

  it('keeps the rewind button enabled and emits when session is active', () => {
    fixture = TestBed.createComponent(MessageBubbleComponent);
    fixture.componentRef.setInput(
      'message',
      createExecutionChatMessage({
        id: 'msg-user-active',
        role: 'user',
        rawContent: 'live session',
      }),
    );
    fixture.componentRef.setInput('isSessionActive', true);
    fixture.detectChanges();

    const button = fixture.debugElement.query(
      By.css('[data-testid="user-rewind-button"]'),
    );
    expect(button.nativeElement.disabled).toBe(false);

    const emitted: string[] = [];
    fixture.componentInstance.rewindRequested.subscribe((id) =>
      emitted.push(id),
    );
    button.nativeElement.click();
    expect(emitted).toEqual(['msg-user-active']);
  });

  describe('inbound peer bubble', () => {
    function peerMessage(label: string): ExecutionChatMessage {
      return createExecutionChatMessage({
        id: 'msg-peer-1',
        role: 'user',
        rawContent: '**check this**',
        inboundPeer: { label },
      });
    }

    it('renders the peer test id and the sender label instead of "You"', () => {
      setMessage(peerMessage('reviewer'));

      expect(
        fixture.debugElement.query(By.css('[data-testid="chat-peer-message"]')),
      ).toBeTruthy();
      expect(
        fixture.debugElement.query(By.css('[data-testid="chat-user-message"]')),
      ).toBeNull();
      expect(
        fixture.debugElement
          .query(By.css('[data-testid="chat-peer-label"]'))
          .nativeElement.textContent.trim(),
      ).toBe('reviewer');
      expect(
        fixture.debugElement.query(By.css('.chat-header')).nativeElement
          .textContent,
      ).not.toContain('You');
    });

    it('states that the sender is unverified', () => {
      setMessage(peerMessage('reviewer'));

      const caption = fixture.debugElement.query(
        By.css('[data-testid="chat-peer-unverified-caption"]'),
      );
      expect(caption.nativeElement.textContent).toContain('unverified');
    });

    it('routes the body through <markdown>, not innerHTML', () => {
      setMessage(peerMessage('reviewer'));

      const markdown = fixture.debugElement.query(By.css('markdown'));
      expect(markdown).toBeTruthy();
      expect(markdown.componentInstance.data).toBe('**check this**');
    });

    it('shows the message under a neutral label when the label is blank', () => {
      setMessage(peerMessage('   '));

      expect(
        fixture.debugElement.query(By.css('[data-testid="chat-peer-message"]')),
      ).toBeTruthy();
      expect(
        fixture.debugElement
          .query(By.css('[data-testid="chat-peer-label"]'))
          .nativeElement.textContent.trim(),
      ).toBe('peer session');
    });

    it('leaves an ordinary user turn on the user bubble', () => {
      setMessage(
        createExecutionChatMessage({
          id: 'msg-plain',
          role: 'user',
          rawContent: 'typed by me',
        }),
      );

      expect(
        fixture.debugElement.query(By.css('[data-testid="chat-user-message"]')),
      ).toBeTruthy();
      expect(
        fixture.debugElement.query(
          By.css('[data-testid="chat-peer-unverified-caption"]'),
        ),
      ).toBeNull();
    });
  });
});
