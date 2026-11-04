import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CARRIER_FILE,
  CONTEXT_FILE,
  type TaskSpecDetail,
  type TaskStatus,
} from '@ptah-extension/shared';
import { TaskDetailHeaderComponent } from './task-detail-header.component';

function makeDetail(overrides: Partial<TaskSpecDetail> = {}): TaskSpecDetail {
  return {
    id: 'TASK_2026_871_0d04',
    folderName: 'TASK_2026_871_0d04',
    status: 'backlog',
    type: 'FEATURE',
    title: 'Revamp the Tasks UI',
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    body: '',
    artifacts: [CARRIER_FILE, CONTEXT_FILE],
    ...overrides,
  };
}

describe('TaskDetailHeaderComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskDetailHeaderComponent] });
  });

  function render(
    detail: TaskSpecDetail | null,
    inputs: { busy?: boolean; starting?: boolean; folderHint?: string } = {},
  ) {
    const fixture = TestBed.createComponent(TaskDetailHeaderComponent);
    fixture.componentRef.setInput('detail', detail);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const at = (id: string) =>
      host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return { fixture, host, at };
  }

  it('shows Back, the breadcrumb, title, badges and the folder path', () => {
    const { at, host } = render(makeDetail());
    expect(at('task-detail-back')?.textContent).toContain('Board');
    expect(at('task-detail-breadcrumb')?.textContent).toContain(
      '.ptah / specs / TASK_2026_871_0d04',
    );
    expect(host.querySelector('h2')?.textContent).toContain(
      'Revamp the Tasks UI',
    );
    expect(at('task-detail-status')?.textContent).toContain('Backlog');
    expect(host.textContent).toContain('FEATURE');
    expect(at('task-detail-path')?.textContent?.trim()).toBe(
      '.ptah/specs/TASK_2026_871_0d04/',
    );
  });

  it('moves focus to Back when the page opens', () => {
    const { at } = render(makeDetail());
    TestBed.inject(ApplicationRef).tick();
    expect(document.activeElement).toBe(at('task-detail-back'));
  });

  it('emits back, and the card payloads for Start and a new status', () => {
    const { fixture, at, host } = render(makeDetail());
    const events: unknown[] = [];
    fixture.componentInstance.back.subscribe(() => events.push('back'));
    fixture.componentInstance.startTask.subscribe((r) => events.push(r));
    fixture.componentInstance.statusChange.subscribe((c) => events.push(c));

    at('task-detail-back')?.click();
    at('task-detail-start')?.click();
    host.querySelector<HTMLElement>('[data-status="in_progress"]')?.click();

    expect(events).toEqual([
      'back',
      { taskId: 'TASK_2026_871_0d04', isolate: false },
      { taskId: 'TASK_2026_871_0d04', status: 'in_progress' },
    ]);
  });

  it('does not emit a status change for the current status', () => {
    const { fixture, host } = render(makeDetail());
    const changes: unknown[] = [];
    fixture.componentInstance.statusChange.subscribe((c) => changes.push(c));
    const current = host.querySelector<HTMLElement>('[data-status="backlog"]');
    expect(current?.getAttribute('aria-current')).toBe('true');
    current?.click();
    expect(changes).toEqual([]);
  });

  it.each<TaskStatus>(['in_progress', 'in_review', 'done', 'cancelled'])(
    'offers Start only where the card does (not for %s)',
    (status) => {
      const { at } = render(makeDetail({ status }));
      expect(at('task-detail-start')).toBeNull();
      expect(at('task-detail-status-trigger')).not.toBeNull();
    },
  );

  it('disables Start while launching and the menu while a write runs', () => {
    const { at } = render(makeDetail({ status: 'blocked' }), {
      busy: true,
      starting: true,
    });
    expect(at('task-detail-start')?.hasAttribute('disabled')).toBe(true);
    expect(at('task-detail-status-trigger')?.hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('keeps Back and the folder hint while the detail loads', () => {
    const { at } = render(null, { folderHint: 'TASK_2026_871_0d04' });
    expect(at('task-detail-back')).not.toBeNull();
    expect(at('task-detail-breadcrumb')?.textContent).toContain(
      'TASK_2026_871_0d04',
    );
    expect(at('task-detail-start')).toBeNull();
    expect(at('task-detail-status-trigger')).toBeNull();
  });
});
