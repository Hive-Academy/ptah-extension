import { TestBed } from '@angular/core/testing';
import type { ExecutionNode } from '@ptah-extension/shared';
import { TaskCardComponent } from './task-card.component';

/** Minimal `tool` ExecutionNode factory for the card under test. */
function toolNode(
  toolName: string,
  toolInput?: Record<string, unknown>,
): ExecutionNode {
  return {
    id: 'n1',
    type: 'tool',
    status: 'complete',
    content: null,
    toolName,
    toolInput,
  } as ExecutionNode;
}

describe('TaskCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskCardComponent],
    }).compileComponents();
  });

  function render(node: ExecutionNode) {
    const fixture = TestBed.createComponent(TaskCardComponent);
    fixture.componentRef.setInput('node', node);
    fixture.detectChanges();
    return fixture;
  }

  it.each<[string, string]>([
    ['TaskCreate', 'Task created'],
    ['TaskUpdate', 'Task updated'],
    ['TaskList', 'Tasks listed'],
    ['TaskGet', 'Task fetched'],
    ['TaskStop', 'Task stopped'],
    ['TaskOutput', 'Task output'],
  ])('renders %s with action label "%s"', (toolName, label) => {
    const fixture = render(toolNode(toolName));
    expect(fixture.nativeElement.textContent).toContain(label);
  });

  it('shows the subject as the title for TaskCreate', () => {
    const fixture = render(
      toolNode('TaskCreate', {
        subject: 'Wire up the workflow card',
        description: 'ignored when subject present',
      }),
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Wire up the workflow card',
    );
  });

  it('falls back to description when no subject is present', () => {
    const fixture = render(
      toolNode('TaskGet', { description: 'Fetch the pending task' }),
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Fetch the pending task',
    );
  });

  it('renders the status badge with a status-specific class', () => {
    const fixture = render(
      toolNode('TaskUpdate', { taskId: 't-42', status: 'completed' }),
    );
    const badge = fixture.nativeElement.querySelector('span.badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('completed');
    expect(badge.className).toContain('badge-success');
    expect(fixture.nativeElement.textContent).toContain('t-42');
  });

  it('accepts the snake_case task_id arg (TaskStop/TaskOutput shape)', () => {
    const fixture = render(toolNode('TaskStop', { task_id: 't-99' }));
    expect(fixture.nativeElement.textContent).toContain('t-99');
  });

  it('does not crash when tool input is missing (partial streaming)', () => {
    const fixture = render(toolNode('TaskList', undefined));
    expect(fixture.nativeElement.textContent).toContain('Tasks listed');
    // No status badge when there is no status arg.
    expect(fixture.nativeElement.querySelector('span.badge')).toBeNull();
  });
});
