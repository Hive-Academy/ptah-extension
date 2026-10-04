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
import { VSCodeService } from '@ptah-extension/core';
import { ChangeSetCardComponent } from '@ptah-extension/chat-ui/change-set-card';
import { TurnTestsRowComponent } from '@ptah-extension/chat-ui/turn-recap';
import type {
  ExecutionChatMessage,
  ExecutionNode,
  TurnChangeSet,
  TurnTestRun,
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

/**
 * Stands in for the tests row for the same reason as the card stub above:
 * the spec asserts the transcript's own decisions (placement, inputs), not
 * the row's markup, which `turn-tests-row.component.spec.ts` covers.
 */
@Component({
  selector: 'ptah-turn-tests-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span data-testid="turn-tests-stub"
    >{{ runs().length }} runs, incomplete: {{ incomplete() }}</span
  >`,
})
class TurnTestsRowStub {
  readonly runs = input.required<readonly TurnTestRun[]>();
  readonly incomplete = input<boolean>(false);
}

describe('ChatTranscriptComponent change-set cards', () => {
  afterEach(() => TestBed.resetTestingModule());

  interface RenderOptions {
    /** Overrides the default no-tree MESSAGES fixture. */
    readonly messages?: readonly ExecutionChatMessage[];
    /** Host gate; the harness default is Electron (`true`). */
    readonly isElectron?: boolean;
  }

  async function render(
    changeSets: readonly TurnChangeSet[],
    review: jest.Mock = jest.fn(() => Promise.resolve()),
    options: RenderOptions = {},
  ): Promise<ComponentFixture<ChatTranscriptComponent>> {
    configureTranscriptTestBed({
      tabs: signal([
        {
          id: 'tab-1',
          claudeSessionId: 'session-1',
          status: 'loaded',
          messages: options.messages ?? MESSAGES,
          streamingState: null,
        },
      ]),
      buildTree: jest.fn(() => []),
      changeSets: signal(changeSets),
      changeSetActions: { review },
    });
    if (options.isElectron === false) {
      TestBed.overrideProvider(VSCodeService, {
        useValue: {
          getPtahIconUri: () => 'ptah.svg',
          isElectron: false,
        } as unknown as VSCodeService,
      });
    }
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: { imports: [ChangeSetCardComponent, TurnTestsRowComponent] },
      add: { imports: [ChangeSetCardStub, TurnTestsRowStub] },
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
    // Reads as an error without relying on colour: error ink plus an icon.
    expect(alert.className).toContain('text-error');
    expect(
      alert.querySelector('lucide-angular')?.getAttribute('aria-hidden'),
    ).toBe('true');

    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="chat-change-set-error"]',
      ),
    ).toBeNull();
  });

  // --- Turn tests row (TASK_2026_610 Batch A4) ---

  function bashNode(id: string, command: string): ExecutionNode {
    return {
      id,
      type: 'tool',
      toolName: 'Bash',
      toolInput: { command },
      status: 'complete',
      content: '',
      children: [],
      isCollapsed: false,
    };
  }

  function assistantTree(
    id: string,
    children: readonly ExecutionNode[],
  ): ExecutionNode {
    return {
      id,
      type: 'message',
      status: 'complete',
      content: 'assistant reply',
      children,
      isCollapsed: false,
    };
  }

  const TEST_MESSAGES: readonly ExecutionChatMessage[] = [
    makeTranscriptMessage('u1', 'user', 100),
    makeTranscriptMessage(
      'a1',
      'assistant',
      110,
      assistantTree('a1-tree', [
        bashNode('a1-jest', 'npx jest libs/frontend/chat'),
      ]),
    ),
    makeTranscriptMessage('u2', 'user', 200),
    makeTranscriptMessage('a2', 'assistant', 210),
  ];

  it('renders the card and the tests row after the turn’s last assistant message', async () => {
    const fixture = await render([CHANGE_SET], jest.fn(), {
      messages: TEST_MESSAGES,
    });
    // The card keeps its place after the turn-ending message (Req 1.1); the
    // tests row is the second block, below the card.
    expect(contentChildren(fixture)).toEqual([
      'u1',
      'a1',
      'chat-change-set',
      'chat-turn-tests',
      'u2',
      'a2',
    ]);
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="turn-tests-stub"]')
        .textContent.trim(),
    ).toBe('1 runs, incomplete: false');
  });

  it('renders neither the tests row nor the card for a no-op turn', async () => {
    // The turn ran a Bash command, but not a test command (Req 1.4), and the
    // session produced no change set.
    const fixture = await render([], jest.fn(), {
      messages: [
        makeTranscriptMessage('u1', 'user', 100),
        makeTranscriptMessage(
          'a1',
          'assistant',
          110,
          assistantTree('a1-tree', [bashNode('a1-ls', 'ls -la')]),
        ),
        makeTranscriptMessage('u2', 'user', 200),
        makeTranscriptMessage('a2', 'assistant', 210),
      ],
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="chat-turn-tests"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="chat-change-set"]'),
    ).toBeNull();
  });

  it('lists the turn’s files only once — the tests row carries no file content', async () => {
    const fixture = await render([CHANGE_SET], jest.fn(), {
      messages: TEST_MESSAGES,
    });
    expect(
      fixture.nativeElement.querySelectorAll('[data-testid="chat-change-set"]')
        .length,
    ).toBe(1);
    const row: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="chat-turn-tests"]',
    );
    expect(row.textContent).not.toMatch(/files?/i);
  });

  it('renders the tests row after a reload', async () => {
    // Session-loader fixture (Req 1.8 / A-1): after a reload,
    // `SessionHistoryReplayer.replay` finalizes through the same
    // `MessageFinalizationService`
    // (`session-history-replayer.service.ts:226` → `finalizeSessionHistory`),
    // so a reloaded tab's messages keep their root trees — a finalized
    // `streamingState` whose Bash nodes keep `toolInput.command` and a
    // terminal status. The fixture mirrors that stored shape.
    const fixture = await render([], jest.fn(), {
      messages: TEST_MESSAGES,
    });
    const row: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="chat-turn-tests"]',
    );
    expect(row).not.toBeNull();
    expect(
      row.querySelector('[data-testid="turn-tests-stub"]')?.textContent.trim(),
    ).toBe('1 runs, incomplete: false');
  });

  it('renders no tests row when the host is not Electron', async () => {
    const fixture = await render([CHANGE_SET], jest.fn(), {
      messages: TEST_MESSAGES,
      isElectron: false,
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="chat-turn-tests"]'),
    ).toBeNull();
    // The change-set card is not Electron-gated and still renders.
    expect(
      fixture.nativeElement.querySelector('[data-testid="chat-change-set"]'),
    ).not.toBeNull();
  });
});
