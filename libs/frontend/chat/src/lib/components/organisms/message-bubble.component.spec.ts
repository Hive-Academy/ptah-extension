/**
 * MessageBubbleComponent specs — focused on the role-gated branch/rewind
 * action buttons added alongside the existing copy button.
 *
 * Mocks `ngx-markdown` (ESM-only, breaks Jest) and the lucide-angular module
 * via the same stub pattern used in chat-input.component.spec.ts.
 */

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
});
