import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SdkBackgroundTaskSummary } from '@ptah-extension/shared';
import { AwaitingBackgroundIndicatorComponent } from './awaiting-background-indicator.component';

describe('AwaitingBackgroundIndicatorComponent', () => {
  let fixture: ComponentFixture<AwaitingBackgroundIndicatorComponent>;

  const makeTask = (
    overrides: Partial<SdkBackgroundTaskSummary> = {},
  ): SdkBackgroundTaskSummary => ({
    id: overrides.id ?? 'task-1',
    type: overrides.type ?? 'subagent',
    status: overrides.status ?? 'running',
    description: overrides.description ?? 'mock subagent task',
    command: overrides.command,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AwaitingBackgroundIndicatorComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(AwaitingBackgroundIndicatorComponent);
  });

  it('creates with default inputs (0 tasks)', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('0 task(s)');
  });

  it('renders the moon (idle) icon, not a spinner', () => {
    fixture.detectChanges();
    const icon = fixture.nativeElement.querySelector(
      '[data-test="awaiting-background-icon"]',
    );
    expect(icon).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.loading-spinner')).toBeNull();
  });

  it('renders label with singular task count interpolation', () => {
    fixture.componentRef.setInput('taskCount', 1);
    fixture.componentRef.setInput('tasks', [makeTask()]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Working in background — 1 task(s)',
    );
  });

  it('renders label with N task count interpolation', () => {
    fixture.componentRef.setInput('taskCount', 3);
    fixture.componentRef.setInput('tasks', [
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
    ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Working in background — 3 task(s)',
    );
  });

  it('hides task list by default when tasks are present', () => {
    fixture.componentRef.setInput('taskCount', 1);
    fixture.componentRef.setInput('tasks', [makeTask()]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-test="awaiting-background-task-list"]',
      ),
    ).toBeNull();
  });

  it('shows task list after toggling expanded', () => {
    fixture.componentRef.setInput('taskCount', 2);
    fixture.componentRef.setInput('tasks', [
      makeTask({ id: 'a', type: 'subagent', description: 'agent A' }),
      makeTask({ id: 'b', type: 'shell', description: 'agent B' }),
    ]);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    const list = fixture.nativeElement.querySelector(
      '[data-test="awaiting-background-task-list"]',
    );
    expect(list).toBeTruthy();
    expect(list.textContent).toContain('agent A');
    expect(list.textContent).toContain('agent B');
    expect(list.textContent).toContain('subagent');
    expect(list.textContent).toContain('shell');
  });

  it('collapses task list on second click', () => {
    fixture.componentRef.setInput('taskCount', 1);
    fixture.componentRef.setInput('tasks', [makeTask()]);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    button.click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        '[data-test="awaiting-background-task-list"]',
      ),
    ).toBeNull();
  });

  it('does not toggle expanded when tasks list is empty', () => {
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(false);
  });
});
