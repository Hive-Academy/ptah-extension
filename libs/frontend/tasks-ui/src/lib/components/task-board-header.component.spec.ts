import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TaskBoardHeaderComponent } from './task-board-header.component';
import type { TaskViewMode } from '../services/task-view-mode.service';

describe('TaskBoardHeaderComponent', () => {
  function render(
    inputs: Partial<{
      totalCount: number;
      activeCount: number;
      doneCount: number;
      mode: TaskViewMode;
      canWrite: boolean;
      busy: boolean;
      loading: boolean;
      sweeping: boolean;
      excludedCount: number;
    }> = {},
  ): ComponentFixture<TaskBoardHeaderComponent> {
    TestBed.configureTestingModule({ imports: [TaskBoardHeaderComponent] });
    const fixture = TestBed.createComponent(TaskBoardHeaderComponent);
    fixture.componentRef.setInput('mode', inputs.mode ?? 'kanban');
    for (const [key, value] of Object.entries(inputs)) {
      if (key !== 'mode') fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  const q = (fixture: ComponentFixture<TaskBoardHeaderComponent>, id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    );

  it('starts the heading order at h1 and states the counts', () => {
    const fixture = render({ totalCount: 24, activeCount: 8, doneCount: 7 });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Tasks');
    expect(q(fixture, 'tasks-header-counts')?.textContent).toMatch(
      /24 tasks · 8 active ·\s+7 done/,
    );
  });

  it('omits the counts on an empty board', () => {
    expect(q(render(), 'tasks-header-counts')).toBeNull();
  });

  it('marks the active layout with aria-pressed and emits a switch', () => {
    const fixture = render({ mode: 'list' });
    const modes: TaskViewMode[] = [];
    fixture.componentInstance.modeChange.subscribe((mode) => modes.push(mode));

    expect(
      q(fixture, 'tasks-view-mode-list')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      q(fixture, 'tasks-view-mode-kanban')?.getAttribute('aria-pressed'),
    ).toBe('false');

    q(fixture, 'tasks-view-mode-kanban')?.click();
    expect(modes).toEqual(['kanban']);
  });

  it('uses the design tokens for the bar and the primary New Task action', () => {
    const fixture = render({ canWrite: true });
    const header = (fixture.nativeElement as HTMLElement).querySelector(
      'header',
    );

    expect(header?.className).toContain('bg-surface-1');
    expect(header?.className).toContain('border-surface-border');
    const create = q(fixture, 'tasks-create-trigger');
    expect(create?.className).toContain('btn-primary');
    expect(create?.className).toContain('h-9');
    expect(q(fixture, 'tasks-palette-trigger')?.className).toContain(
      'btn-ghost',
    );
  });

  it('disables every write action when no workspace can be written', () => {
    const fixture = render({ canWrite: false });

    for (const id of [
      'tasks-create-trigger',
      'tasks-reindex',
      'tasks-registry',
      'tasks-sweep-trigger',
    ]) {
      expect((q(fixture, id) as HTMLButtonElement).disabled).toBe(true);
    }
    // The palette and the excluded-folder list stay reachable.
    expect(
      (q(fixture, 'tasks-palette-trigger') as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (q(fixture, 'tasks-maintenance-excluded') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('emits each maintenance action and closes the menu behind it', () => {
    const fixture = render({ canWrite: true, excludedCount: 2 });
    const header = fixture.componentInstance;
    const fired: string[] = [];
    header.reindex.subscribe(() => fired.push('reindex'));
    header.generateRegistry.subscribe(() => fired.push('registry'));
    header.openSweep.subscribe(() => fired.push('sweep'));
    header.openExclusions.subscribe(() => fired.push('excluded'));
    header.createTask.subscribe(() => fired.push('create'));
    header.openPalette.subscribe(() => fired.push('palette'));

    const menu = q(fixture, 'tasks-maintenance-menu') as HTMLDetailsElement;
    menu.open = true;
    q(fixture, 'tasks-reindex')?.click();
    expect(menu.open).toBe(false);

    q(fixture, 'tasks-registry')?.click();
    q(fixture, 'tasks-sweep-trigger')?.click();
    q(fixture, 'tasks-maintenance-excluded')?.click();
    q(fixture, 'tasks-create-trigger')?.click();
    q(fixture, 'tasks-palette-trigger')?.click();

    expect(fired).toEqual([
      'reindex',
      'registry',
      'sweep',
      'excluded',
      'create',
      'palette',
    ]);
    expect(q(fixture, 'tasks-maintenance-excluded')?.textContent).toContain(
      'Excluded folders (2)',
    );
  });

  it('keeps Reindex and Tidy finished off while their work is in flight', () => {
    const fixture = render({ canWrite: true, loading: true, sweeping: true });

    expect((q(fixture, 'tasks-reindex') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (q(fixture, 'tasks-sweep-trigger') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((q(fixture, 'tasks-registry') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('closes the Manage menu on Escape and returns focus to its summary', () => {
    const fixture = render({ canWrite: true });
    const menu = q(fixture, 'tasks-maintenance-menu') as HTMLDetailsElement;
    menu.open = true;

    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  });
});
