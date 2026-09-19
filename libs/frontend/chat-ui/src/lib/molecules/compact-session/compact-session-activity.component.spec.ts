import { TestBed } from '@angular/core/testing';
import { CompactSessionActivityComponent } from './compact-session-activity.component';
import type { CompactSessionSummary } from './compact-session-summary';

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
      {
        id: 'prompt:q',
        kind: 'prompt',
        tone: 'warning',
        label: 'Question needs an answer',
      },
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

describe(CompactSessionActivityComponent.name, () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [CompactSessionActivityComponent],
    }),
  );

  it('renders exactly four bounded zones without transcript, forms, markdown, or scroll classes', () => {
    const fixture = TestBed.createComponent(CompactSessionActivityComponent);
    fixture.componentRef.setInput('summary', summary());
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelectorAll('[data-zone]')).toHaveLength(4);
    expect(
      [...root.querySelectorAll('[data-zone]')].map((el) =>
        el.getAttribute('data-zone'),
      ),
    ).toEqual(['status', 'pulse', 'content', 'metrics']);
    expect(root.innerHTML).not.toContain('overflow-auto');
    expect(root.querySelector('textarea, form, markdown')).toBeNull();
    expect(root.textContent).toContain('+2 more');
  });

  it('labels every semantic mark and emits the full-view action', () => {
    const fixture = TestBed.createComponent(CompactSessionActivityComponent);
    fixture.componentRef.setInput('summary', summary());
    const emitted = jest.fn();
    fixture.componentInstance.openFullView.subscribe(emitted);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[role="listitem"]')?.getAttribute('aria-label'),
    ).toBe('Question needs an answer');
    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('includes an explicit reduced-motion fallback', () => {
    const metadata = (
      CompactSessionActivityComponent as unknown as { ɵcmp: { decls: number } }
    ).ɵcmp;
    expect(metadata).toBeDefined();
    const fixture = TestBed.createComponent(CompactSessionActivityComponent);
    fixture.componentRef.setInput('summary', summary());
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).innerHTML).toContain(
      'motion-reduce:transition-none',
    );
  });
});
