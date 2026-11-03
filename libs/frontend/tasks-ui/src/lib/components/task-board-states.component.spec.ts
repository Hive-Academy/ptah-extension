import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  TaskBoardStatesComponent,
  type TaskBoardStateKind,
} from './task-board-states.component';

describe('TaskBoardStatesComponent', () => {
  function render(
    kind: TaskBoardStateKind,
    extra: Partial<{
      specsDirExists: boolean;
      totalIndexed: number;
      busy: boolean;
    }> = {},
  ): ComponentFixture<TaskBoardStatesComponent> {
    TestBed.configureTestingModule({ imports: [TaskBoardStatesComponent] });
    const fixture = TestBed.createComponent(TaskBoardStatesComponent);
    fixture.componentRef.setInput('kind', kind);
    for (const [key, value] of Object.entries(extra)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  const q = (fixture: ComponentFixture<TaskBoardStatesComponent>, id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    );

  it('labels the first load as busy for assistive technology', () => {
    const loading = q(render('loading'), 'tasks-loading');

    expect(loading?.getAttribute('aria-busy')).toBe('true');
    expect(loading?.getAttribute('role')).toBe('status');
    expect(loading?.textContent).toContain('Loading tasks');
  });

  it('explains the no-workspace case and offers only Check again', () => {
    const fixture = render('no-workspace');
    const retries: void[] = [];
    fixture.componentInstance.retry.subscribe(() => retries.push(undefined));
    const panel = q(fixture, 'tasks-no-workspace');

    expect(panel?.textContent).toContain('No folder is open');
    expect(panel?.textContent).toContain('.ptah/specs');
    expect(panel?.textContent).not.toContain('Create your first task');
    expect(panel?.querySelectorAll('button')).toHaveLength(1);

    q(fixture, 'tasks-no-workspace-retry')?.click();
    expect(retries).toHaveLength(1);
  });

  it('disables Check again while a load is in flight', () => {
    const retry = q(
      render('no-workspace', { busy: true }),
      'tasks-no-workspace-retry',
    );
    expect((retry as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers the first-task CTA on an empty board', () => {
    const fixture = render('empty', { specsDirExists: false });
    const creates: void[] = [];
    fixture.componentInstance.create.subscribe(() => creates.push(undefined));

    expect(q(fixture, 'tasks-empty')?.textContent).toContain(
      'No .ptah/specs directory yet',
    );
    q(fixture, 'tasks-empty-create')?.click();
    expect(creates).toHaveLength(1);
  });

  it('says "No tasks on the board" when the directory exists', () => {
    expect(q(render('empty'), 'tasks-empty')?.textContent).toContain(
      'No tasks on the board',
    );
  });

  it('separates filtered-empty from empty and offers only Clear the filter', () => {
    const fixture = render('filtered-empty', { totalIndexed: 181 });
    const clears: void[] = [];
    fixture.componentInstance.clearFilter.subscribe(() =>
      clears.push(undefined),
    );
    const panel = q(fixture, 'tasks-filtered-empty');

    expect(panel?.textContent).toContain('All 181 indexed task(s)');
    expect(panel?.textContent).not.toContain('Create your first task');
    q(fixture, 'tasks-filtered-empty-clear')?.click();
    expect(clears).toHaveLength(1);
  });

  it('carries no opacity-modified text colour and hides decorative glyphs', () => {
    for (const kind of ['no-workspace', 'empty', 'filtered-empty'] as const) {
      const host = render(kind).nativeElement as HTMLElement;
      const offenders = Array.from(host.querySelectorAll('*')).filter((el) =>
        Array.from(el.classList).some((name) =>
          /^text-base-content\/\d/.test(name),
        ),
      );
      expect(offenders).toEqual([]);
      for (const glyph of Array.from(host.querySelectorAll('lucide-angular'))) {
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
      }
      TestBed.resetTestingModule();
    }
  });
});
