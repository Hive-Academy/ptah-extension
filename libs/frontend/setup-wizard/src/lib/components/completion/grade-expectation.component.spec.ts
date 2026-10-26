import { TestBed } from '@angular/core/testing';
import { GradeExpectationComponent } from './grade-expectation.component';
import type { OutcomeFileRow } from './outcome-summary.component';

const row = (id: string, status: OutcomeFileRow['status']): OutcomeFileRow => ({
  id,
  fileName: `${id}.md`,
  status,
});

function render(rows: OutcomeFileRow[]): HTMLElement {
  TestBed.configureTestingModule({ imports: [GradeExpectationComponent] });
  const fixture = TestBed.createComponent(GradeExpectationComponent);
  fixture.componentRef.setInput('rows', rows);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('GradeExpectationComponent', () => {
  it('explains "No grade" when at least one agent was written', () => {
    const root = render([row('tester', 'written'), row('planner', 'kept')]);
    expect(
      root.querySelector('[data-testid="grade-expectation"]')?.textContent,
    ).toContain(
      'New agents show "No grade" in the Library. A grade appears after a task that uses the agent has been reviewed. Generating the file alone does not produce one.',
    );
    expect(root.textContent).not.toContain('Nothing new was written');
  });

  it('states that nothing new was written when all were kept or current', () => {
    const root = render([
      row('planner', 'kept'),
      row('code-reviewer', 'unchanged'),
      row('data-engineer', 'changed-since-preview'),
    ]);
    expect(root.querySelector('h3')?.textContent).toContain(
      'Nothing new was written',
    );
    expect(root.textContent).toContain(
      'All 3 agents were kept or already current. No new agents were added. Existing grades are unchanged.',
    );
    expect(root.querySelector('[data-testid="grade-expectation"]')).toBeNull();
  });

  it('says nothing when no agent was written and one failed', () => {
    const root = render([row('tester', 'failed'), row('planner', 'kept')]);
    expect(root.textContent?.trim()).toBe('');
  });

  it('says nothing for an empty run', () => {
    expect(render([]).textContent?.trim()).toBe('');
  });
});
