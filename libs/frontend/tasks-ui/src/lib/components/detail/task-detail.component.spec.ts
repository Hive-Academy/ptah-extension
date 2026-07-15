import { TestBed } from '@angular/core/testing';
import type { TaskSpecDetail } from '@ptah-extension/shared';
import { TaskDetailComponent } from './task-detail.component';

function makeDetail(overrides: Partial<TaskSpecDetail> = {}): TaskSpecDetail {
  return {
    id: 'TASK_2026_200',
    folderName: 'TASK_2026_200',
    status: 'in_progress',
    type: 'FEATURE',
    title: 'Board detail',
    dependsOn: ['TASK_2026_100'],
    created: '2026-07-14T10:00:00.000Z',
    updated: '2026-07-14T11:00:00.000Z',
    frontmatterValid: true,
    validationIssues: [],
    body: '# Heading\n\nSome body copy.',
    artifacts: ['task.md', 'context.md'],
    ...overrides,
  };
}

describe('TaskDetailComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskDetailComponent] });
  });

  function render(detail: TaskSpecDetail | null, loading = false) {
    const fixture = TestBed.createComponent(TaskDetailComponent);
    fixture.componentRef.setInput('detail', detail);
    fixture.componentRef.setInput('loading', loading);
    fixture.detectChanges();
    return fixture;
  }

  it('renders frontmatter facts and depends_on', () => {
    const fixture = render(makeDetail());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Board detail');
    expect(text).toContain('In Progress');
    expect(text).toContain('TASK_2026_100');
  });

  it('routes the body through the markdown chokepoint (no [innerHTML])', () => {
    const fixture = render(makeDetail());
    const host = fixture.nativeElement as HTMLElement;
    // MarkdownBlockComponent (mocked as <markdown>) is present…
    expect(host.querySelector('ptah-markdown-block')).not.toBeNull();
    // …and no raw innerHTML binding leaked the markdown source verbatim.
    expect(host.innerHTML).not.toContain('# Heading');
  });

  it('renders validation warnings when present', () => {
    const fixture = render(
      makeDetail({
        validationIssues: [
          { field: 'created', code: 'invalid_date', message: 'unparseable' },
        ],
      }),
    );
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('created');
    expect(text).toContain('unparseable');
  });

  it('shows a spinner while loading', () => {
    const fixture = render(null, true);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.loading'),
    ).not.toBeNull();
  });
});
