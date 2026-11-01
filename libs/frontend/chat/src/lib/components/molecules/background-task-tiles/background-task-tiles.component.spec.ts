import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { BackgroundTaskTile } from './background-task-tiles.component';
import { BackgroundTaskTilesComponent } from './background-task-tiles.component';

const task = (taskId: string, taskType = 'local_bash'): BackgroundTaskTile => ({
  taskId,
  taskType,
  description: `Full command for ${taskId}`,
  status: 'running',
  firstSeenAt: 1_000,
});

function mount(
  tasks: readonly BackgroundTaskTile[],
): ComponentFixture<BackgroundTaskTilesComponent> {
  TestBed.configureTestingModule({ imports: [BackgroundTaskTilesComponent] });
  const fixture = TestBed.createComponent(BackgroundTaskTilesComponent);
  fixture.componentRef.setInput('tasks', tasks);
  fixture.componentRef.setInput('now', 66_000);
  fixture.detectChanges();
  return fixture;
}

describe('BackgroundTaskTilesComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders no row when there are no tasks', () => {
    const host: HTMLElement = mount([]).nativeElement;
    expect(
      host.querySelector('[aria-label="Running background tasks"]'),
    ).toBeNull();
  });

  it('shows a focusable tile with full tooltip details and elapsed time', () => {
    const host: HTMLElement = mount([
      {
        ...task('bash-1'),
        description: 'Compile',
        command: 'npm test -- --watch',
      },
    ]).nativeElement;
    const tile = host.querySelector('[data-test="background-task-tile"]');
    const tooltip = tile?.querySelector('[role="tooltip"]');
    expect(host.querySelector('[role="list"]')).not.toBeNull();
    expect(tile?.getAttribute('role')).toBe('listitem');
    expect(tile?.getAttribute('tabindex')).toBe('0');
    expect(tile?.tagName).toBe('SPAN');
    expect(tile?.getAttribute('aria-label')).toBe(
      'Running local_bash: Compile',
    );
    expect(tooltip?.id).toBe(tile?.getAttribute('aria-describedby'));
    expect(tooltip?.textContent).toBe(
      'local_bash\nnpm test -- --watch\nElapsed: 1m 5s',
    );
    expect(tooltip?.className).toContain('group-hover:block');
    expect(tooltip?.className).toContain('group-focus:block');
  });

  it('dismisses a focused tooltip with Escape', () => {
    const fixture = mount([task('bash-1')]);
    const tile = fixture.nativeElement.querySelector(
      '[data-test="background-task-tile"]',
    ) as HTMLElement;
    tile.focus();
    tile.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(document.activeElement).not.toBe(tile);
    expect(
      (tile.querySelector('[role="tooltip"]') as HTMLElement).style.display,
    ).toBe('none');
  });

  it('keeps at most four tiles and stacks the remaining labels', () => {
    const host: HTMLElement = mount([
      task('one'),
      task('two'),
      task('three'),
      task('four'),
      task('five'),
    ]).nativeElement;
    expect(
      host.querySelectorAll('[data-test="background-task-tile"]'),
    ).toHaveLength(3);
    const overflow = host.querySelector(
      '[data-test="background-task-overflow"]',
    );
    expect(overflow?.textContent).toContain('+2');
    expect(overflow?.getAttribute('role')).toBe('listitem');
    expect(overflow?.getAttribute('aria-label')).toBe('+2 more running tasks');
    expect(overflow?.getAttribute('aria-describedby')).toBe(
      overflow?.querySelector('[role="tooltip"]')?.id,
    );
    expect(overflow?.querySelector('[role="tooltip"]')?.textContent).toBe(
      'Full command for four\nFull command for five',
    );
  });

  it('renders every task supplied by the filtering container', () => {
    const host: HTMLElement = mount([
      task('agent', 'local_agent'),
      task('workflow', 'local_workflow'),
      task('remote', 'remote_agent'),
      task('bash'),
    ]).nativeElement;
    expect(
      host.querySelectorAll('[data-test="background-task-tile"]'),
    ).toHaveLength(4);
    expect(host.textContent).toContain('Full command for bash');
    expect(host.textContent).toContain('Full command for agent');
    expect(host.textContent).toContain('Full command for workflow');
    expect(host.textContent).toContain('Full command for remote');
  });
});
