import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { TaskSpecDetail } from '@ptah-extension/shared';
import { TaskFolderOverviewComponent } from './task-folder-overview.component';

function makeDetail(overrides: Partial<TaskSpecDetail> = {}): TaskSpecDetail {
  return {
    id: 'TASK_2026_200',
    folderName: 'TASK_2026_200',
    status: 'backlog',
    type: 'FEATURE',
    title: 'Overview',
    description: 'One-line carrier description.',
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    body: '## Carrier body\n\nText.',
    artifacts: ['task.md'],
    ...overrides,
  };
}

describe('TaskFolderOverviewComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskFolderOverviewComponent] });
  });

  function render(detail: TaskSpecDetail, carrierOpenable = true) {
    const fixture = TestBed.createComponent(TaskFolderOverviewComponent);
    fixture.componentRef.setInput('detail', detail);
    fixture.componentRef.setInput('carrierOpenable', carrierOpenable);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const byId = (id: string) =>
      host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { fixture, host, byId };
  }

  it('labels task.md as the machine-owned carrier with its canonical path', () => {
    const { host, byId } = render(makeDetail());
    expect(host.textContent).toContain('task.md');
    expect(host.textContent).toContain('Machine-owned carrier');
    expect(byId('task-overview-path')?.textContent?.trim()).toBe(
      '.ptah/specs/TASK_2026_200/',
    );
    expect(byId('task-overview-description')?.textContent).toContain(
      'One-line carrier description.',
    );
  });

  it('builds identity from the folder name and reports a mismatched id', () => {
    const { byId } = render(
      makeDetail({ id: 'TASK_2026_999', folderName: 'TASK_2026_200_ab12' }),
    );
    expect(byId('task-overview-path')?.textContent).toContain(
      'TASK_2026_200_ab12',
    );
    expect(byId('task-overview-path')?.textContent).not.toContain(
      'TASK_2026_999',
    );
    const note = byId('task-overview-id-mismatch');
    expect(note?.textContent).toContain('TASK_2026_999');
    expect(note?.textContent).toContain('is the task');
  });

  it('shows no mismatch note when id and folder agree', () => {
    expect(render(makeDetail()).byId('task-overview-id-mismatch')).toBeNull();
  });

  it('renders the body through the shared markdown block with the auto variant', () => {
    const { fixture, host } = render(makeDetail());
    const block = fixture.debugElement.query(
      By.directive(MarkdownBlockComponent),
    );
    const instance: MarkdownBlockComponent = block.componentInstance;
    expect(instance.content()).toBe('## Carrier body\n\nText.');
    expect(instance.variant()).toBe('auto');
    expect(host.innerHTML).not.toContain('## Carrier body');
  });

  it('says a blank body has no readable body', () => {
    const { fixture, byId } = render(makeDetail({ body: '   ' }));
    expect(byId('task-overview-empty')?.textContent).toContain(
      'This file has no readable body.',
    );
    expect(
      fixture.debugElement.query(By.directive(MarkdownBlockComponent)),
    ).toBeNull();
  });

  it('lists validation warnings', () => {
    const { byId } = render(
      makeDetail({
        validationIssues: [
          { field: 'created', code: 'invalid_date', message: 'unparseable' },
        ],
      }),
    );
    expect(byId('task-detail-issues')?.textContent).toContain(
      'created: unparseable',
    );
  });

  it('opens the carrier in the editor only when it is openable', () => {
    const { fixture, byId } = render(makeDetail());
    const opened: string[] = [];
    fixture.componentInstance.openInEditor.subscribe((file) =>
      opened.push(file),
    );
    (byId('task-overview-open-editor') as HTMLButtonElement).click();
    expect(opened).toEqual(['task.md']);

    expect(
      render(makeDetail(), false).byId('task-overview-open-editor'),
    ).toBeNull();
  });
});
