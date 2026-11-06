import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TaskSpecDetail } from '@ptah-extension/shared';
import type {
  SectionState,
  TaskSectionData,
} from '../../../services/session-inspector';
import { groupTaskDocuments, InspectorTaskSectionComponent } from './inspector-task-section.component';
import { documentExcerpt, documentProgress, SessionTaskReader } from './session-task-reader';

const DOCUMENTS = [
  'task.md',
  'context.md',
  'design-spec.md',
  'implementation-plan.md',
  'batches.md',
  'test-report.md',
] as const;

const TASK = {
  id: 'TASK_2026_878_eae4',
  folderName: 'TASK_2026_878_eae4',
  status: 'backlog',
  title: 'Revamp landing page sections below the hero',
  artifacts: [...DOCUMENTS],
} as TaskSpecDetail;

function readyState(
  documents: readonly string[] = DOCUMENTS,
): SectionState<TaskSectionData> {
  return {
    status: 'ready',
    data: {
      lead: { taskId: TASK.id, missing: false },
      task: TASK,
      stage: 'Requirements',
      documents,
      related: [],
    },
  };
}

describe('InspectorTaskSectionComponent', () => {
  const state = signal<SectionState<TaskSectionData> | null>(null);
  const openError = signal<{ readonly file: string } | null>(null);
  const preview = signal<{ file: string; status: 'loading' | 'ready' | 'error'; content: string } | null>(null);
  const progress = signal<{ done: number; total: number } | null>(null);
  const reader = {
    state,
    canOpen: true,
    openError,
    preview,
    progress,
    previewDocument: jest.fn((file: string) => { preview.set({ file, status: 'ready', content: 'Preview text' }); }),
    closePreview: jest.fn(() => { preview.set(null); }),
    bind: jest.fn(),
    retry: jest.fn(),
    openDocument: jest.fn(),
  };

  beforeEach(() => {
    state.set(null);
    openError.set(null);
    preview.set(null);
    progress.set(null);
    reader.canOpen = true;
    reader.bind.mockReset();
    reader.retry.mockReset();
    reader.openDocument.mockReset();
    reader.previewDocument.mockClear();
    reader.closePreview.mockClear();
    TestBed.configureTestingModule({
      imports: [InspectorTaskSectionComponent],
    });
    TestBed.overrideComponent(InspectorTaskSectionComponent, {
      set: {
        providers: [{ provide: SessionTaskReader, useValue: reader }],
      },
    });
  });

  function mount(
    nextState: SectionState<TaskSectionData> = readyState(),
  ): ComponentFixture<InspectorTaskSectionComponent> {
    state.set(nextState);
    const fixture = TestBed.createComponent(InspectorTaskSectionComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.detectChanges();
    return fixture;
  }

  it('opens a document disclosure with keyboard access and returns focus on selection, Escape and outside click', () => {
    const fixture = mount();
    const root = fixture.nativeElement as HTMLElement;
    const list = root.querySelector<HTMLElement>('[aria-label="Task documents"]');
    const toggle = [...root.querySelectorAll<HTMLButtonElement>('button[aria-expanded][aria-controls]')]
      .find(button => button.textContent?.includes('+3 files'));

    expect(list).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect([...list!.querySelectorAll('button[aria-pressed]')].map(button => button.textContent?.trim())).toEqual(['task.md', 'implementation-plan.md', 'batches.md']);
    expect(toggle?.textContent?.trim()).toBe('+3 files');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    toggle?.focus();
    toggle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    toggle?.click();
    fixture.detectChanges();
    const menu = root.querySelector(`#${toggle?.getAttribute('aria-controls')}`);
    expect(menu?.querySelectorAll('li button')).toHaveLength(3);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-controls')).toBe(menu?.id);

    const choice = menu?.querySelector<HTMLButtonElement>('li button');
    choice?.focus();
    choice?.click();
    fixture.detectChanges();
    expect(reader.previewDocument).toHaveBeenCalledWith('context.md');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    toggle?.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('li button')?.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector(`#${toggle?.getAttribute('aria-controls')}`)).toBeNull();
    expect(document.activeElement).toBe(toggle);
    toggle?.click();
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('li button')?.focus();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(toggle);
  });

  it('shows the status as a tinted badge with an icon and a muted stage', () => {
    const root = mount().nativeElement as HTMLElement;
    const status = root.querySelector<HTMLElement>('[data-testid="task-status"]');

    expect(status?.textContent?.trim()).toBe('Backlog');
    expect(status?.classList.contains('badge')).toBe(true);
    expect(status?.classList.contains('badge-sm')).toBe(true);
    expect(status?.classList.contains('bg-current/10')).toBe(true);
    expect(status?.classList.contains('text-base-content-muted')).toBe(true);
    expect(status?.querySelector('lucide-angular, svg')).not.toBeNull();
    expect(root.textContent).toContain('· Requirements');
  });

  it('shows progress only when counts exist', () => {
    const fixture = mount();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('progress')).toBeNull();
    progress.set({ done: 3, total: 7 });
    fixture.detectChanges();
    expect(root.querySelector('progress')?.getAttribute('value')).toBe('3');
    expect(root.textContent).toContain('3/7 tasks');
  });

  it('groups names case insensitively by basename and prefers batches', () => {
    expect(groupTaskDocuments(['docs/TASK.MD', 'tasks.md', 'BATCHES.md', 'x/Task-Description.md', 'IMPLEMENTATION-PLAN.md', 'note.md']))
      .toEqual({ primary: ['docs/TASK.MD', 'x/Task-Description.md', 'IMPLEMENTATION-PLAN.md', 'BATCHES.md'], other: ['tasks.md', 'note.md'] });
  });

  it('strips front matter before excerpt and parses checkbox progress', () => {
    expect(documentExcerpt('---\ntitle: Example\n---\nFirst line\nSecond line')).toBe('First line\nSecond line');
    expect(documentExcerpt('---\ntitle: Example\n---\n')).toBe('No content');
    expect(documentExcerpt('one\ntwo\nthree\nfour\nfive\nsix\nseven')).toBe('one\ntwo\nthree\nfour\nfive\nsix…');
    expect(documentProgress('- [x] One\n- [ ] Two')).toEqual({ done: 1, total: 2 });
  });

  it('shows the task ID in a small ghost mono badge', () => {
    const root = mount().nativeElement as HTMLElement;
    const id = root.querySelector<HTMLElement>('[data-testid="task-id"]');

    expect(id?.textContent?.trim()).toBe(TASK.id);
    expect(id?.classList.contains('badge')).toBe(true);
    expect(id?.classList.contains('badge-ghost')).toBe(true);
    expect(id?.classList.contains('badge-sm')).toBe(true);
    expect(id?.classList.contains('font-mono')).toBe(true);
  });

  it('shows a compact error alert and retries the task read', () => {
    const fixture = mount({
      status: 'error',
      data: null,
      error: 'Could not load the task',
    });
    const root = fixture.nativeElement as HTMLElement;
    const alert = root.querySelector<HTMLElement>('[role="alert"]');
    const retry = root.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry loading task"]',
    );

    expect(alert?.textContent).toContain('Could not load task');
    expect(alert?.classList.contains('alert-error')).toBe(true);
    expect(alert?.classList.contains('alert-soft')).toBe(true);
    expect(retry?.classList.contains('btn')).toBe(true);
    expect(retry?.classList.contains('btn-ghost')).toBe(true);
    expect(retry?.classList.contains('btn-xs')).toBe(true);

    retry?.click();
    expect(reader.retry).toHaveBeenCalledTimes(1);
  });

  it('previews a document and opens it from the preview', () => {
    const fixture = mount();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>(
      '[aria-label="Task documents"] button',
    );

    button?.click();
    fixture.detectChanges();
    expect(reader.previewDocument).toHaveBeenCalledWith(DOCUMENTS[0]);
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[role="region"]')?.textContent).toContain('Preview text');
    const card = root.querySelector<HTMLElement>('[role="region"]');
    for (const className of ['rounded-lg', 'border-surface-border', 'bg-surface-1', 'p-3']) expect(card?.classList.contains(className)).toBe(true);
    const open = root.querySelector<HTMLButtonElement>('[role="region"] button');
    open?.click();
    expect(reader.openDocument).toHaveBeenCalledWith(DOCUMENTS[0], open);

    openError.set({ file: DOCUMENTS[0] });
    fixture.detectChanges();
    const alert = root.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain(`Could not open ${DOCUMENTS[0]}`);
    expect(open?.getAttribute('aria-describedby')).toBe(alert?.id);
  });

  it('toggles the preview and closes it with Escape', () => {
    const fixture = mount();
    const root = fixture.nativeElement as HTMLElement;
    const chip = root.querySelector<HTMLButtonElement>('[aria-label="Task documents"] button');
    chip?.click();
    fixture.detectChanges();
    const card = root.querySelector<HTMLElement>('[role="region"]');
    expect(card?.id).toBe(chip?.getAttribute('aria-controls'));
    expect(card?.textContent).toContain(DOCUMENTS[0]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('[role="region"]')).toBeNull();
    expect(chip?.getAttribute('aria-pressed')).toBe('false');

    chip?.click();
    fixture.detectChanges();
    chip?.click();
    fixture.detectChanges();
    expect(root.querySelector('[role="region"]')).toBeNull();
  });

  it('shows loading and preview error states with Retry', () => {
    const fixture = mount({ status: 'loading', data: readyState().data });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector('.skeleton')).not.toBeNull();

    state.set(readyState());
    preview.set({ file: DOCUMENTS[0], status: 'loading', content: '' });
    fixture.detectChanges();
    expect(root.querySelector('[aria-label="Loading document preview"]')).not.toBeNull();

    preview.set({ file: DOCUMENTS[0], status: 'error', content: '' });
    fixture.detectChanges();
    const retry = [...root.querySelectorAll<HTMLButtonElement>('[role="region"] button')]
      .find(button => button.textContent?.trim() === 'Retry');
    retry?.click();
    expect(reader.previewDocument).toHaveBeenCalledWith(DOCUMENTS[0]);
  });
});
