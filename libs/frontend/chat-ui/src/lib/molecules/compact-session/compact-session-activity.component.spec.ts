import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CompactSessionActivityComponent } from './compact-session-activity.component';
import type {
  CompactSemanticMark,
  CompactSessionSummary,
} from './compact-session-summary';

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

function mark(
  overrides: Partial<CompactSemanticMark> = {},
): CompactSemanticMark {
  return {
    id: 'tool:1',
    kind: 'tool',
    tone: 'success',
    label: 'Bash completed',
    timestamp: 1_000,
    ...overrides,
  };
}

function summary(
  overrides: Partial<CompactSessionSummary> = {},
): CompactSessionSummary {
  return {
    status: {
      text: 'Needs input',
      icon: '!',
      tone: 'warning',
      sessionColor: 'oklch(0.55 0.15 20)',
      workspaceLabel: 'ptah',
    },
    marks: [
      mark({
        id: 'prompt:q',
        kind: 'prompt',
        tone: 'warning',
        label: 'Question needs an answer',
        timestamp: 500,
      }),
    ],
    content: {
      kind: 'question',
      text: 'Which path?',
      additionalPromptCount: 2,
      actionable: true,
    },
    metrics: {
      model: 'sonnet',
      tokens: 100,
      cost: 0.02,
      agentCount: 1,
      compactionCount: 0,
    },
    ...overrides,
  };
}

function render(summaryValue: CompactSessionSummary) {
  const fixture = TestBed.createComponent(CompactSessionActivityComponent);
  fixture.componentRef.setInput('summary', summaryValue);
  fixture.detectChanges();
  return fixture;
}

describe(CompactSessionActivityComponent.name, () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [CompactSessionActivityComponent],
    }),
  );

  it('renders exactly four bounded zones without transcript, forms, markdown, or scroll classes beyond the feed', () => {
    const fixture = render(summary());
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('[data-zone]')).toHaveLength(4);
    expect(
      [...root.querySelectorAll('[data-zone]')].map((el) =>
        el.getAttribute('data-zone'),
      ),
    ).toEqual(['status', 'recap', 'feed', 'metrics']);
    expect(root.querySelector('textarea, form, markdown')).toBeNull();
    expect(root.innerHTML).not.toContain('overflow-auto"');
    expect(root.textContent).toContain('+2 more');
  });

  it('emits the full-view action from the recap pane', () => {
    const fixture = render(summary());
    const emitted = jest.fn();
    fixture.componentInstance.openFullView.subscribe(emitted);

    fixture.nativeElement
      .querySelector<HTMLButtonElement>('[data-zone="recap"] button')
      ?.click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('renders label and text on a feed row, with the label always present', () => {
    const fixture = render(
      summary({
        marks: [
          mark({
            id: 'tool:call',
            label: 'Bash failed',
            tone: 'error',
            text: 'Exit code 1: 3 test suites failed',
          }),
        ],
      }),
    );
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('Bash failed');
    expect(root.textContent).toContain('Exit code 1: 3 test suites failed');
  });

  it('renders no detail element and no empty row for a mark with no text', () => {
    const fixture = render(
      summary({
        marks: [mark({ id: 'terminal:1', kind: 'terminal', text: undefined })],
      }),
    );
    const row = fixture.nativeElement.querySelector(
      '[data-zone="feed"] [role="listitem"]',
    ) as HTMLElement;

    // Exactly one text line (the time/badge/label row) inside the row
    expect(row.children).toHaveLength(1);
  });

  it('conveys tone through more than colour: a distinct glyph and kind label per row', () => {
    const fixture = render(
      summary({
        marks: [
          mark({ id: 'a', kind: 'terminal', tone: 'error', label: 'Failed' }),
          mark({ id: 'b', kind: 'tool', tone: 'success', label: 'Done' }),
        ],
      }),
    );
    const badges = [
      ...fixture.nativeElement.querySelectorAll(
        '[data-zone="feed"] [role="listitem"] span.inline-flex',
      ),
    ] as HTMLElement[];

    expect(badges).toHaveLength(2);
    expect(badges[0].textContent?.trim()).not.toBe(
      badges[1].textContent?.trim(),
    );
    expect(badges[0].textContent).toContain('TERM');
    expect(badges[1].textContent).toContain('TOOL');
  });

  it('renders all marks in the feed scroll area (no fixed ROW_BUDGET truncation)', () => {
    const twentyMarks = Array.from({ length: 20 }, (_, index) =>
      mark({ id: `m${index}`, timestamp: index }),
    );

    const fixture = render(summary({ marks: twentyMarks }));

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"]',
    ).length;

    expect(rows).toBe(20);
  });

  it('keeps the newest mark last (chronological) within the visible feed', () => {
    const fixture = render(
      summary({
        marks: [
          mark({ id: 'old', label: 'Older event', timestamp: 1 }),
          mark({ id: 'new', label: 'Newer event', timestamp: 2 }),
        ],
      }),
    );
    const labels = [
      ...fixture.nativeElement.querySelectorAll(
        '[data-zone="feed"] [role="listitem"]',
      ),
    ].map((row) => row.textContent);

    expect(labels[0]).toContain('Older event');
    expect(labels[1]).toContain('Newer event');
  });

  it('renders MarkdownBlockComponent for prose recap and plain text for question', () => {
    const proseFixture = render(
      summary({
        content: {
          kind: 'prose',
          text: '## Assistant decision\n\nVerified **100%** coverage.',
          additionalPromptCount: 0,
          actionable: false,
        },
      }),
    );
    const markdownEl = proseFixture.nativeElement.querySelector(
      '[data-zone="recap"] markdown',
    );
    expect(markdownEl).not.toBeNull();
    expect(markdownEl?.textContent).toContain('## Assistant decision');

    const questionFixture = render(
      summary({
        content: {
          kind: 'question',
          text: 'Which file should be edited?',
          additionalPromptCount: 0,
          actionable: true,
        },
      }),
    );
    expect(
      questionFixture.nativeElement.querySelector(
        '[data-zone="recap"] markdown',
      ),
    ).toBeNull();
    expect(questionFixture.nativeElement.textContent).toContain(
      'Which file should be edited?',
    );
  });

  it('strips markdown syntax from feed row labels and details to a single line', () => {
    const fixture = render(
      summary({
        marks: [
          mark({
            id: 'm1',
            label: 'Tool started: `read_file`',
            text: '## Target File\n| File | Lines |\n|---|---|\n| `foo.ts` | 42 |',
          }),
        ],
      }),
    );
    const textContent = fixture.nativeElement.textContent;
    expect(textContent).toContain('Tool started: read_file');
    expect(textContent).toContain('Target File File Lines foo.ts 42');
    expect(textContent).not.toContain('## Target File');
    expect(textContent).not.toContain('|---|---|');
  });

  it('filters marks locally using ALL, ERR, and WARN filter chips and updates aria-pressed', () => {
    const fixture = render(
      summary({
        marks: [
          mark({ id: '1', tone: 'success', label: 'Success event' }),
          mark({ id: '2', tone: 'error', label: 'Error event' }),
          mark({ id: '3', tone: 'warning', label: 'Warning event' }),
          mark({ id: '4', tone: 'error', label: 'Another error' }),
        ],
      }),
    );

    const buttons = fixture.nativeElement.querySelectorAll(
      '.cs-filter-chips button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons).toHaveLength(3);

    const [allBtn, errBtn, warnBtn] = Array.from(buttons);
    expect(allBtn.textContent).toContain('ALL (4)');
    expect(errBtn.textContent).toContain('ERR (2)');
    expect(warnBtn.textContent).toContain('WARN (1)');

    expect(allBtn.getAttribute('aria-pressed')).toBe('true');
    expect(errBtn.getAttribute('aria-pressed')).toBe('false');

    // Filter to ERR
    errBtn.click();
    fixture.detectChanges();

    expect(errBtn.getAttribute('aria-pressed')).toBe('true');
    expect(allBtn.getAttribute('aria-pressed')).toBe('false');
    const errRows = fixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"]',
    );
    expect(errRows).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Error event');
    expect(fixture.nativeElement.textContent).toContain('Another error');
    expect(fixture.nativeElement.textContent).not.toContain('Success event');

    // Filter to WARN
    warnBtn.click();
    fixture.detectChanges();

    const warnRows = fixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"]',
    );
    expect(warnRows).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Warning event');

    // Reset to ALL
    allBtn.click();
    fixture.detectChanges();
    const allRows = fixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"]',
    );
    expect(allRows).toHaveLength(4);
  });

  it('renders an empty state listitem when no events match the active filter', () => {
    const fixture = render(
      summary({
        marks: [mark({ id: '1', tone: 'success', label: 'Success only' })],
      }),
    );
    // Click ERR filter
    const errBtn = fixture.nativeElement.querySelectorAll(
      '.cs-filter-chips button',
    )[1] as HTMLButtonElement;
    errBtn.click();
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"]',
    );
    expect(items).toHaveLength(1);
    expect(items[0].textContent?.trim()).toBe('No matching events');
  });

  it('shows blinking cursor on newest live row and tone badge on status row', () => {
    const fixture = render(
      summary({
        status: {
          text: 'Using tools',
          icon: '⚙',
          tone: 'live',
          sessionColor: 'oklch(0.6 0.2 250)',
          workspaceLabel: 'ptah-extension',
        },
        marks: [
          mark({ id: 'm1', tone: 'live', label: 'First live mark' }),
          mark({ id: 'm2', tone: 'live', label: 'Second live mark' }),
        ],
      }),
    );

    // Status tone badge
    const statusZone = fixture.nativeElement.querySelector(
      '[data-zone="status"]',
    );
    expect(statusZone?.textContent).toContain('▶');
    expect(statusZone?.textContent).toContain('RUN');

    // Recap outcome tag
    const recapZone = fixture.nativeElement.querySelector(
      '[data-zone="recap"]',
    );
    expect(recapZone?.textContent).toContain('ACTIVE');

    // Only newest live row in the feed list has blinking cursor
    const rowCursors = fixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"] .blinking-cursor',
    );
    expect(rowCursors).toHaveLength(1);

    // Terminal prompt footer also features a blinking cursor when live
    const terminalCursors = fixture.nativeElement.querySelectorAll(
      '.cs-terminal-footer .blinking-cursor',
    );
    expect(terminalCursors).toHaveLength(1);
  });

  it('derives agent context box and outcome tag without 3x repeating finished text', () => {
    const fixture = render(
      summary({
        status: {
          text: 'Finished',
          icon: '✓',
          tone: 'success',
          sessionColor: 'oklch(0.6 0.2 140)',
          workspaceLabel: 'ptah-extension',
        },
        marks: [
          mark({
            id: 'ag:1',
            kind: 'agent',
            tone: 'success',
            label: 'Agent started: backend-developer',
          }),
          mark({
            id: 'err:1',
            kind: 'tool',
            tone: 'error',
            label: 'Bash failed',
          }),
        ],
      }),
    );

    const root = fixture.nativeElement as HTMLElement;
    // Status badge shows DONE
    expect(root.querySelector('[data-zone="status"]')?.textContent).toContain(
      'DONE',
    );
    // Recap title shows FINISHED tag
    expect(root.querySelector('[data-zone="recap"]')?.textContent).toContain(
      'FINISHED',
    );
    // Agent context box shows backend-developer, total events, and newest error
    const agentContext = root.querySelector('.cs-agent-context');
    expect(agentContext?.textContent).toContain('backend-developer');
    expect(agentContext?.textContent).toContain('Events:');
    expect(agentContext?.textContent).toContain('2');
    expect(agentContext?.textContent).toContain('Last error: Bash failed');
    expect(agentContext?.textContent).not.toContain('Phase:');
  });

  it('renders terminal prompt footer with workspace label and event count', () => {
    const fixture = render(
      summary({
        status: {
          text: 'Ready',
          icon: '✓',
          tone: 'idle',
          sessionColor: 'oklch(0.5 0.1 200)',
          workspaceLabel: 'my-workspace',
        },
        marks: [mark({ id: '1' }), mark({ id: '2' })],
      }),
    );

    const terminalFooter = fixture.nativeElement.querySelector(
      '.cs-terminal-footer',
    );
    expect(terminalFooter).not.toBeNull();
    expect(terminalFooter?.textContent).toContain('ptah:my-workspace$');
    expect(terminalFooter?.textContent).toContain('ready');
    expect(terminalFooter?.textContent).toContain('2 events');
  });

  it('strips markdown from an agent label before parsing the agent name', () => {
    const fixture = render(
      summary({
        marks: [
          mark({
            id: 'ag:md',
            kind: 'agent',
            tone: 'success',
            label: 'Agent started: **backend-developer**',
          }),
        ],
      }),
    );

    expect(fixture.componentInstance.activeAgentName()).toBe(
      'backend-developer',
    );
    const agentContext =
      fixture.nativeElement.querySelector('.cs-agent-context');
    expect(agentContext?.textContent).toContain('backend-developer');
    expect(agentContext?.textContent).not.toContain('**');
  });

  it('converts a bounded markdown prefix to plain text before truncating the detail line', () => {
    const longCode = 'x'.repeat(700);
    const fixture = render(
      summary({
        marks: [
          mark({
            id: 'tool:long',
            kind: 'tool',
            tone: 'success',
            label: 'Long output',
            text: '```ts\n' + longCode + '\n```',
          }),
        ],
      }),
    );
    const detailText = fixture.componentInstance.feedRows()[0].detail ?? '';

    expect(detailText).not.toContain('`');
    expect(detailText.length).toBeLessThanOrEqual(600);
    expect(detailText).toContain('x');
  });
});
