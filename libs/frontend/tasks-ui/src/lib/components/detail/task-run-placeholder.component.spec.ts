import { TestBed } from '@angular/core/testing';
import { TaskRunPlaceholderComponent } from './task-run-placeholder.component';

describe('TaskRunPlaceholderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskRunPlaceholderComponent] });
  });

  function render(
    selectedTaskId: string | null = 'TASK_2026_200',
    workspaceRoot: string | null = '/work',
  ) {
    const fixture = TestBed.createComponent(TaskRunPlaceholderComponent);
    fixture.componentRef.setInput('selectedTaskId', selectedTaskId);
    fixture.componentRef.setInput('workspaceRoot', workspaceRoot);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('says it is planned for Phase 2 under TASK_2026_358', () => {
    const { host } = render();
    expect(host.textContent).toContain('Planned for Phase 2 · TASK_2026_358');
    expect(host.textContent).toContain(
      'Launch, watch and resume a Ptah-owned multi-stage run here.',
    );
  });

  it('is visibly inactive: dashed, with no control, progress or live state', () => {
    const { host } = render();
    const panel = host.querySelector('[data-testid="task-run-placeholder"]');
    expect(panel?.className).toContain('border-dashed');
    expect(
      host.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [tabindex], progress, [role="progressbar"], [aria-live]',
      ),
    ).toHaveLength(0);
  });

  it('takes the future selection contract as nullable inputs', () => {
    const { fixture, host } = render(null, null);
    expect(fixture.componentInstance.selectedTaskId()).toBeNull();
    expect(fixture.componentInstance.workspaceRoot()).toBeNull();
    expect(
      host
        .querySelector('[data-testid="task-run-placeholder"]')
        ?.hasAttribute('data-task-id'),
    ).toBe(false);

    fixture.componentRef.setInput('selectedTaskId', 'TASK_2026_201');
    fixture.componentRef.setInput('workspaceRoot', 'D:/repo');
    fixture.detectChanges();
    expect(fixture.componentInstance.workspaceRoot()).toBe('D:/repo');
    expect(
      host
        .querySelector('[data-testid="task-run-placeholder"]')
        ?.getAttribute('data-task-id'),
    ).toBe('TASK_2026_201');
  });
});
