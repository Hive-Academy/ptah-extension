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
import { ChangeSetCardComponent } from '@ptah-extension/chat-ui/change-set-card';
import type {
  ExecutionChatMessage,
  TurnChangeSet,
} from '@ptah-extension/shared';
import { ChatTranscriptComponent } from './chat-transcript.component';
import {
  configureTranscriptTestBed,
  makeTranscriptMessage,
} from './testing/transcript-spec-harness';

const MESSAGES: readonly ExecutionChatMessage[] = [
  makeTranscriptMessage('u1', 'user', 100),
  makeTranscriptMessage('a1', 'assistant', 110),
  makeTranscriptMessage('u2', 'user', 200),
  makeTranscriptMessage('a2', 'assistant', 210),
];

const CHANGE_SET: TurnChangeSet = {
  sessionId: 'session-1',
  workspaceRoot: '/repo',
  turnStartedAt: 105,
  turnEndedAt: 150,
  files: [
    { path: 'src/a.ts', status: 'M', additions: 3, deletions: 1 },
    { path: 'src/b.ts', status: 'A', additions: 10, deletions: 0 },
  ],
  truncatedCount: 0,
  totals: { files: 2, additions: 13, deletions: 1 },
  countsUnavailable: false,
};

/**
 * Stands in for the card so the spec asserts the transcript's own decisions
 * (placement, inputs, inline error), not the card's markup, which
 * `change-set-card.component.spec.ts` covers.
 */
@Component({
  selector: 'ptah-change-set-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
    type="button"
    data-testid="change-set-review"
    (click)="review.emit()"
  >
    {{ changeSet().files.length }} files on {{ host() }}
  </button>`,
})
class ChangeSetCardStub {
  readonly changeSet = input.required<TurnChangeSet>();
  readonly host = input.required<string>();
  readonly reconciled = input<ReadonlySet<string>>();
  readonly conflicted = input<ReadonlySet<string>>();
  readonly review = output<void>();
  readonly openFile = output<string>();
  readonly openScm = output<void>();
}

describe('ChatTranscriptComponent change-set cards', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render(
    changeSets: readonly TurnChangeSet[],
    review: jest.Mock = jest.fn(() => Promise.resolve()),
  ): Promise<ComponentFixture<ChatTranscriptComponent>> {
    configureTranscriptTestBed({
      tabs: signal([
        {
          id: 'tab-1',
          claudeSessionId: 'session-1',
          status: 'loaded',
          messages: MESSAGES,
          streamingState: null,
        },
      ]),
      buildTree: jest.fn(() => []),
      changeSets: signal(changeSets),
      changeSetActions: { review },
    });
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: { imports: [ChangeSetCardComponent] },
      add: { imports: [ChangeSetCardStub] },
    });
    const fixture = TestBed.createComponent(ChatTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function contentChildren(
    fixture: ComponentFixture<ChatTranscriptComponent>,
  ): string[] {
    const content: HTMLElement = fixture.nativeElement.querySelector(
      '.chat-scroll-content',
    );
    return Array.from(content.children).map(
      (child) =>
        child.getAttribute('data-ptah-transcript-message-id') ??
        child.getAttribute('data-testid') ??
        child.tagName,
    );
  }

  it('renders the card after the turn’s last assistant message, before the next user message', async () => {
    const fixture = await render([CHANGE_SET]);
    expect(contentChildren(fixture)).toEqual([
      'u1',
      'a1',
      'chat-change-set',
      'u2',
      'a2',
    ]);
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="change-set-review"]')
        .textContent.trim(),
    ).toBe('2 files on electron');
  });

  it('renders no card when the session has no change sets', async () => {
    const fixture = await render([]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="chat-change-set"]'),
    ).toBeNull();
  });

  it('shows a failed action inline and clears it on the next attempt', async () => {
    const review = jest
      .fn()
      .mockRejectedValueOnce(new Error('Could not open the review.'))
      .mockResolvedValueOnce(undefined);
    const fixture = await render([CHANGE_SET], review);
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="change-set-review"]',
    );

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const alert: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="chat-change-set-error"]',
    );
    expect(review).toHaveBeenCalledWith(CHANGE_SET);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent?.trim()).toBe('Could not open the review.');
    expect(alert.className).not.toMatch(/text-base-content\//);

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="chat-change-set-error"]',
      ),
    ).toBeNull();
  });
});
