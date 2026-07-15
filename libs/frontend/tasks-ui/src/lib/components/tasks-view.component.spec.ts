import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  TASK_STATUSES,
  type TaskStatus,
  type TaskSpecSummary,
  type TasksBoardResult,
} from '@ptah-extension/shared';
import { TasksViewComponent } from './tasks-view.component';

function board(
  partial: Partial<Record<TaskStatus, TaskSpecSummary[]>> = {},
  meta: Partial<
    Pick<TasksBoardResult, 'excludedCount' | 'specsDirExists'>
  > = {},
): TasksBoardResult {
  const columns = TASK_STATUSES.reduce(
    (acc, status) => {
      acc[status] = partial[status] ?? [];
      return acc;
    },
    {} as Record<TaskStatus, TaskSpecSummary[]>,
  );
  return {
    columns,
    excludedCount: meta.excludedCount ?? 0,
    specsDirExists: meta.specsDirExists ?? true,
  };
}

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });

describe('TasksViewComponent', () => {
  let rpcCall: jest.Mock;

  function setup() {
    rpcCall = jest
      .fn()
      .mockResolvedValue(ok(board({}, { specsDirExists: false })));
    TestBed.configureTestingModule({
      imports: [TasksViewComponent],
      providers: [
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
      ],
    });
  }

  it('loads the board on creation', async () => {
    setup();
    const fixture = TestBed.createComponent(TasksViewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(rpcCall).toHaveBeenCalledWith('tasks:board', {});
  });

  it('shows the empty-state create CTA when there are no tasks', async () => {
    setup();
    const fixture = TestBed.createComponent(TasksViewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Create your first task');
  });

  it('renders the header actions', async () => {
    setup();
    const fixture = TestBed.createComponent(TasksViewComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('New Task');
    expect(text).toContain('Reindex');
    expect(text).toContain('Registry');
  });
});
