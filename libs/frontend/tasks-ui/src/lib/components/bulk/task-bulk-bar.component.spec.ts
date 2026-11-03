import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TaskBulkBarComponent } from './task-bulk-bar.component';
import type {
  BulkOperation,
  BulkProgress,
} from '../../services/tasks-store.service';

/**
 * The bulk region's own spec: tokens, the three states it can be in, and that
 * every control routes through an output. The confirmation wording and the
 * summary/retry flow are pinned in `task-bulk-summary.component.spec.ts`.
 */
describe('TaskBulkBarComponent', () => {
  async function render(
    inputs: Partial<{
      count: number;
      hiddenCount: number;
      matchedCount: number;
      requested: BulkOperation | null;
      progress: BulkProgress | null;
    }>,
  ): Promise<ComponentFixture<TaskBulkBarComponent>> {
    TestBed.configureTestingModule({ imports: [TaskBulkBarComponent] });
    const fixture = TestBed.createComponent(TaskBulkBarComponent);
    fixture.componentRef.setInput('count', inputs.count ?? 1);
    for (const [name, value] of Object.entries(inputs)) {
      if (name !== 'count') fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  const q = (fixture: ComponentFixture<TaskBulkBarComponent>, id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    );

  it('is a labelled region on the raised design surface', async () => {
    const bar = q(await render({ count: 1 }), 'task-bulk-bar');

    expect(bar?.getAttribute('role')).toBe('region');
    for (const token of [
      'bg-surface-2',
      'border-surface-border',
      'rounded-box',
      'p-3',
      'shadow-[var(--elev-shadow-raised)]',
    ]) {
      expect(bar?.className).toContain(token);
    }
  });

  it('offers select-all-matching only when it would add tasks', async () => {
    const fixture = await render({ count: 1, matchedCount: 9 });
    const fired: string[] = [];
    fixture.componentInstance.selectAllMatching.subscribe(() =>
      fired.push('all'),
    );
    fixture.componentInstance.clearSelection.subscribe(() =>
      fired.push('clear'),
    );

    expect(q(fixture, 'task-bulk-select-all')?.textContent).toContain(
      'Select all 9 matching',
    );
    q(fixture, 'task-bulk-select-all')?.click();
    q(fixture, 'task-bulk-clear')?.click();
    expect(fired).toEqual(['all', 'clear']);

    TestBed.resetTestingModule();
    const all = await render({ count: 9, matchedCount: 9 });
    expect(q(all, 'task-bulk-select-all')).toBeNull();
  });

  it('routes the status and label pickers through outputs', async () => {
    const fixture = await render({ count: 2, matchedCount: 2 });
    const statuses: string[] = [];
    const labels: string[] = [];
    fixture.componentInstance.statusPicked.subscribe((status) =>
      statuses.push(status),
    );
    fixture.componentInstance.labelPicked.subscribe((pick) =>
      labels.push(`${pick.mode}:${pick.label}`),
    );

    const select = q(fixture, 'task-bulk-status') as HTMLSelectElement;
    select.value = 'done';
    select.dispatchEvent(new Event('change'));
    const input = q(fixture, 'task-bulk-label-input') as HTMLInputElement;
    input.value = 'licensing';
    q(fixture, 'task-bulk-label-add')?.click();
    input.value = 'licensing';
    q(fixture, 'task-bulk-label-remove')?.click();

    expect(statuses).toEqual(['done']);
    expect(labels).toEqual(['add:licensing', 'remove:licensing']);
  });

  it('says how many selected tasks the filter hides', async () => {
    const fixture = await render({ count: 3, hiddenCount: 2 });
    expect(q(fixture, 'task-bulk-hidden')?.textContent).toContain(
      '2 of them hidden by the filter',
    );
  });

  it('shows polite progress and a Cancel that stops after the batch', async () => {
    const fixture = await render({
      count: 5,
      progress: {
        operation: { kind: 'status', status: 'done' },
        done: 2,
        total: 5,
        cancelled: false,
      },
    });
    const cancels: number[] = [];
    fixture.componentInstance.cancelRun.subscribe(() => cancels.push(1));

    const progress = q(fixture, 'task-bulk-progress');
    expect(progress?.getAttribute('aria-live')).toBe('polite');
    expect(progress?.textContent).toContain('2 / 5');
    q(fixture, 'task-bulk-cancel')?.click();
    expect(cancels).toHaveLength(1);
  });

  it('keeps Confirm and Keep-the-selection inside the alertdialog', async () => {
    const fixture = await render({
      count: 12,
      requested: { kind: 'status', status: 'blocked' },
    });
    const events: string[] = [];
    fixture.componentInstance.confirmRequest.subscribe(() =>
      events.push('confirm'),
    );
    fixture.componentInstance.cancelRequest.subscribe(() =>
      events.push('keep'),
    );
    const dialog = q(fixture, 'task-bulk-confirm');

    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(dialog?.contains(q(fixture, 'task-bulk-confirm-run'))).toBe(true);
    expect(dialog?.contains(q(fixture, 'task-bulk-confirm-cancel'))).toBe(true);
    q(fixture, 'task-bulk-confirm-run')?.click();
    q(fixture, 'task-bulk-confirm-cancel')?.click();
    expect(events).toEqual(['confirm', 'keep']);
  });
});
