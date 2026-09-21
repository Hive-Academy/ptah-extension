import { TestBed } from '@angular/core/testing';
import { CompactSessionActivityComponent } from './compact-session-activity.component';
import type {
  CompactSemanticMark,
  CompactSessionSummary,
} from './compact-session-summary';

function mark(overrides: Partial<CompactSemanticMark> = {}): CompactSemanticMark {
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

function render(
  summaryValue: CompactSessionSummary,
  tier: 'compact' | 'compact-tall' = 'compact',
) {
  const fixture = TestBed.createComponent(CompactSessionActivityComponent);
  fixture.componentRef.setInput('summary', summaryValue);
  fixture.componentRef.setInput('tier', tier);
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

    // Exactly one text line (the time/badge/label row) inside the row — no
    // second, empty detail line rendered for a mark with no `text`.
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
    // Different glyph + different kind text, not merely different colour classes.
    expect(badges[0].textContent?.trim()).not.toBe(
      badges[1].textContent?.trim(),
    );
    expect(badges[0].textContent).toContain('TERM');
    expect(badges[1].textContent).toContain('TOOL');
  });

  it('bounds the feed to the tier row budget: fewer rows at compact than compact-tall', () => {
    const manyMarks = Array.from({ length: 20 }, (_, index) =>
      mark({ id: `m${index}`, timestamp: index }),
    );

    const compactFixture = render(summary({ marks: manyMarks }), 'compact');
    const tallFixture = render(summary({ marks: manyMarks }), 'compact-tall');

    const compactRows = compactFixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"]',
    ).length;
    const tallRows = tallFixture.nativeElement.querySelectorAll(
      '[data-zone="feed"] [role="listitem"]',
    ).length;

    expect(compactRows).toBeLessThan(tallRows);
    expect(compactRows).toBe(5);
    expect(tallRows).toBe(10);
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
});
