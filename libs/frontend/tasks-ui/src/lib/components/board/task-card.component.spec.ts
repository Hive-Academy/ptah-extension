import { TestBed } from '@angular/core/testing';
import type { TaskSpecSummary } from '@ptah-extension/shared';
import {
  TaskCardComponent,
  type TaskStartRequest,
  type TaskStatusChange,
} from './task-card.component';

function makeTask(overrides: Partial<TaskSpecSummary> = {}): TaskSpecSummary {
  return {
    id: 'TASK_2026_200',
    folderName: 'TASK_2026_200',
    status: 'backlog',
    type: 'FEATURE',
    title: 'Implement the board',
    dependsOn: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

describe('TaskCardComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskCardComponent] });
  });

  function render(task: TaskSpecSummary) {
    const fixture = TestBed.createComponent(TaskCardComponent);
    fixture.componentRef.setInput('task', task);
    fixture.detectChanges();
    return fixture;
  }

  it('renders id, title, and type badge', () => {
    const fixture = render(makeTask());
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TASK_2026_200');
    expect(text).toContain('Implement the board');
    expect(text).toContain('FEATURE');
  });

  it('shows a validation-warning affordance when frontmatter is invalid', () => {
    const fixture = render(
      makeTask({
        frontmatterValid: false,
        validationIssues: [
          { field: 'type', code: 'invalid_type', message: 'bad type' },
        ],
      }),
    );
    const warning = (fixture.nativeElement as HTMLElement).querySelector(
      '[title="Frontmatter has validation warnings"]',
    );
    expect(warning).not.toBeNull();
  });

  it('renders a depends_on indicator when dependencies exist', () => {
    const fixture = render(makeTask({ dependsOn: ['TASK_2026_100'] }));
    const dep = (fixture.nativeElement as HTMLElement).querySelector(
      '[title="Depends on: TASK_2026_100"]',
    );
    expect(dep).not.toBeNull();
  });

  it('emits start with the worktree flag when Start is clicked', () => {
    const fixture = render(makeTask());
    let emitted: TaskStartRequest | undefined;
    fixture.componentInstance.startTask.subscribe((r) => (emitted = r));

    fixture.componentInstance.useWorktree.set(true);
    const startBtn = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Start task TASK_2026_200"]',
    ) as HTMLButtonElement;
    startBtn.click();

    expect(emitted).toEqual({ taskId: 'TASK_2026_200', useWorktree: true });
  });

  it('emits statusChange when a different status is picked', () => {
    const fixture = render(makeTask({ status: 'backlog' }));
    let emitted: TaskStatusChange | undefined;
    fixture.componentInstance.statusChange.subscribe((c) => (emitted = c));

    // Invoke the protected handler through the template contract.
    (
      fixture.componentInstance as unknown as {
        onStatusPick: (s: string) => void;
      }
    ).onStatusPick('in_progress');

    expect(emitted).toEqual({
      taskId: 'TASK_2026_200',
      status: 'in_progress',
    });
  });
});
