import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ExcludedTaskFolder,
  TasksSweepResult,
} from '@ptah-extension/shared';
import { TaskMaintenanceDialogComponent } from './task-maintenance-dialog.component';

function plan(over: Partial<TasksSweepResult> = {}): TasksSweepResult {
  return {
    candidates: [],
    deleted: [],
    skipped: [],
    previewOnly: true,
    ...over,
  };
}

describe('TaskMaintenanceDialogComponent', () => {
  function render(
    inputs: Partial<{
      sweep: TasksSweepResult | null;
      sweeping: boolean;
      exclusionsOpen: boolean;
      excludedCount: number;
      excludedFolders: readonly ExcludedTaskFolder[];
      namesUnavailable: boolean;
    }> = {},
  ): ComponentFixture<TaskMaintenanceDialogComponent> {
    TestBed.configureTestingModule({
      imports: [TaskMaintenanceDialogComponent],
    });
    const fixture = TestBed.createComponent(TaskMaintenanceDialogComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  const q = (
    fixture: ComponentFixture<TaskMaintenanceDialogComponent>,
    id: string,
  ) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    );

  it('renders no sweep dialog without a plan', () => {
    expect(q(render(), 'tasks-sweep-dialog')).toBeNull();
  });

  it('names every candidate and counts only committed folders', () => {
    const fixture = render({
      sweep: plan({
        candidates: [
          {
            taskId: 'TASK_2026_100',
            status: 'done',
            ageDays: 41,
            updated: null,
            committed: true,
          },
          {
            taskId: 'TASK_2026_101',
            status: 'cancelled',
            ageDays: 9,
            updated: null,
            committed: false,
          },
        ],
      }),
    });

    expect(q(fixture, 'tasks-sweep-row-TASK_2026_100')?.textContent).toContain(
      '41d old',
    );
    expect(q(fixture, 'tasks-sweep-row-TASK_2026_101')?.textContent).toContain(
      'not in git',
    );
    expect(q(fixture, 'tasks-sweep-confirm')?.textContent).toContain(
      'Delete 1 folder(s)',
    );
  });

  it('offers no delete when nothing has aged out', () => {
    const fixture = render({ sweep: plan() });
    expect(q(fixture, 'tasks-sweep-empty')).not.toBeNull();
    expect(q(fixture, 'tasks-sweep-confirm')).toBeNull();
  });

  it('emits confirm and close, and closes on Escape when idle', () => {
    const fixture = render({
      sweep: plan({
        candidates: [
          {
            taskId: 'TASK_2026_100',
            status: 'done',
            ageDays: 41,
            updated: null,
            committed: true,
          },
        ],
      }),
    });
    const events: string[] = [];
    fixture.componentInstance.sweepConfirmed.subscribe(() =>
      events.push('confirm'),
    );
    fixture.componentInstance.sweepClosed.subscribe(() => events.push('close'));

    q(fixture, 'tasks-sweep-confirm')?.click();
    q(fixture, 'tasks-sweep-close')?.click();
    q(fixture, 'tasks-sweep-dialog')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(events).toEqual(['confirm', 'close', 'close']);
  });

  it('disables the confirm while the sweep runs', () => {
    const fixture = render({
      sweeping: true,
      sweep: plan({
        candidates: [
          {
            taskId: 'TASK_2026_100',
            status: 'done',
            ageDays: 41,
            updated: null,
            committed: true,
          },
        ],
      }),
    });
    expect(
      (q(fixture, 'tasks-sweep-confirm') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('reports a finished sweep and the folders it left alone', () => {
    const fixture = render({
      sweep: plan({
        previewOnly: false,
        deleted: ['TASK_2026_100'],
        skipped: [{ taskId: 'TASK_2026_101', reason: 'uncommitted' }],
      }),
    });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('h2')?.textContent).toContain(
      'Swept 1 finished task(s)',
    );
    expect(q(fixture, 'tasks-sweep-skipped')?.textContent).toContain(
      '1 folder(s) were left alone',
    );
  });

  it('lists excluded folders by name with their typed reason', () => {
    const fixture = render({
      exclusionsOpen: true,
      excludedCount: 2,
      excludedFolders: [
        { folderName: 'TASK_2026_155', reason: 'no_carrier' },
        { folderName: 'TASK_2026_165', reason: 'yaml_unparseable' },
      ],
    });
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="tasks-excluded-row"]',
      ),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('TASK_2026_155');
    expect(rows[0].textContent).toContain('no_carrier');
    expect(
      rows[1]
        .querySelector('[data-testid="tasks-excluded-reason"]')
        ?.textContent?.trim().length,
    ).toBeGreaterThan(0);
  });

  it('says when the host counted exclusions but did not name them', () => {
    const fixture = render({
      exclusionsOpen: true,
      excludedCount: 3,
      namesUnavailable: true,
    });
    expect(q(fixture, 'tasks-excluded-unnamed')?.textContent).toContain(
      'reported 3 skipped folder(s)',
    );
  });
});
