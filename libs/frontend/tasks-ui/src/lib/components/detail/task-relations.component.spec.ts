import { TestBed } from '@angular/core/testing';
import {
  TaskMetadataPatchSchema,
  buildTaskGraph,
  type TaskGraph,
  type TaskMetadataPatch,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import { TaskRelationsComponent } from './task-relations.component';
import type { TaskMetadataWrite } from './task-metadata-write';

function makeTask(
  id: string,
  overrides: Partial<TaskSpecSummary> = {},
): TaskSpecSummary {
  return {
    id,
    folderName: id,
    status: 'backlog',
    type: 'FEATURE',
    title: id,
    dependsOn: [],
    labels: [],
    duplicates: [],
    relatesTo: [],
    created: null,
    updated: null,
    frontmatterValid: true,
    validationIssues: [],
    ...overrides,
  };
}

/** The shared schema's own message for a patch it refuses. */
function schemaMessage(patch: TaskMetadataPatch): string {
  const parsed = TaskMetadataPatchSchema.safeParse(patch);
  if (parsed.success) {
    throw new Error('expected the shared schema to refuse this patch');
  }
  return parsed.error.issues[0].message;
}

const SELF = 'TASK_2026_200';
const OTHER = 'TASK_2026_201';

describe('TaskRelationsComponent — write affordances', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskRelationsComponent] });
  });

  function render(
    task: TaskSpecSummary,
    graph: TaskGraph | null,
    inputs: { editable?: boolean; busy?: boolean } = {},
  ) {
    const fixture = TestBed.createComponent(TaskRelationsComponent);
    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('graph', graph);
    fixture.componentRef.setInput('editable', inputs.editable ?? true);
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const emitted: TaskMetadataWrite[] = [];
    fixture.componentInstance.apply.subscribe((write) => emitted.push(write));

    const el = <T extends HTMLElement>(testid: string): T =>
      host.querySelector(`[data-testid="${testid}"]`) as T;

    const group = (key: string): HTMLElement | null =>
      host.querySelector(`[data-testid="task-relations-group-${key}"]`);

    const removesIn = (key: string): HTMLButtonElement[] =>
      Array.from(
        group(key)?.querySelectorAll<HTMLButtonElement>(
          '[data-testid="task-relation-remove"]',
        ) ?? [],
      );

    const add = (kind: string, ref: string): void => {
      const select = el<HTMLSelectElement>('task-relations-add-kind');
      select.value = kind;
      select.dispatchEvent(new Event('change'));
      const input = el<HTMLInputElement>('task-relations-add-input');
      input.value = ref;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      el<HTMLButtonElement>('task-relations-add-submit').click();
      fixture.detectChanges();
    };

    const addError = (): string =>
      el('task-relations-add-error')?.textContent?.trim() ?? '';

    return { fixture, host, emitted, el, group, removesIn, add, addError };
  }

  // -------------------------------------------------------------------------
  // Read-only stays read-only
  // -------------------------------------------------------------------------
  it('renders no write control at all when not editable', () => {
    const task = makeTask(SELF, { dependsOn: [OTHER] });
    const graph = buildTaskGraph([task, makeTask(OTHER)]);
    const { host, emitted } = render(task, graph, { editable: false });

    expect(
      host.querySelector('[data-testid="task-relation-remove"]'),
    ).toBeNull();
    expect(host.querySelector('[data-testid="task-relations-add"]')).toBeNull();
    expect(emitted).toEqual([]);
  });

  it('emits nothing on a render alone', () => {
    const task = makeTask(SELF, {
      dependsOn: [OTHER],
      duplicates: [OTHER],
      relatesTo: [OTHER],
    });
    const graph = buildTaskGraph([task, makeTask(OTHER)]);
    expect(render(task, graph).emitted).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Authored edges are removable; derived edges are not
  // -------------------------------------------------------------------------
  it('offers removal on authored groups only', () => {
    const task = makeTask(SELF, {
      dependsOn: ['TASK_2026_300'],
      duplicates: ['TASK_2026_301'],
      relatesTo: ['TASK_2026_302'],
    });
    // This one declares every inverse edge, so all three derived groups render.
    const inverse = makeTask(OTHER, {
      dependsOn: [SELF],
      duplicates: [SELF],
      relatesTo: [SELF],
    });
    const graph = buildTaskGraph([
      task,
      inverse,
      makeTask('TASK_2026_300'),
      makeTask('TASK_2026_301'),
      makeTask('TASK_2026_302'),
    ]);
    const { removesIn, group } = render(task, graph);

    expect(removesIn('blocked_by')).toHaveLength(1);
    expect(removesIn('duplicates')).toHaveLength(1);
    expect(removesIn('related:authored')).toHaveLength(1);

    // Someone else's frontmatter. The group's note already says to open it.
    expect(group('blocks')).not.toBeNull();
    expect(removesIn('blocks')).toHaveLength(0);
    expect(removesIn('duplicated_by')).toHaveLength(0);
    expect(removesIn('related:derived')).toHaveLength(0);
  });

  it.each([
    ['blocked_by', 'dependsOn'],
    ['duplicates', 'duplicates'],
    ['related:authored', 'relatesTo'],
  ] as ReadonlyArray<
    readonly [string, 'dependsOn' | 'duplicates' | 'relatesTo']
  >)(
    'removing from %s replaces the whole %s array on THIS carrier',
    (groupKey, field) => {
      const task = makeTask(SELF, {
        dependsOn: [OTHER, 'TASK_2026_300'],
        duplicates: [OTHER, 'TASK_2026_300'],
        relatesTo: [OTHER, 'TASK_2026_300'],
      });
      const graph = buildTaskGraph([
        task,
        makeTask(OTHER),
        makeTask('TASK_2026_300'),
      ]);
      const { removesIn, emitted, fixture } = render(task, graph);

      removesIn(groupKey)[0].click();
      fixture.detectChanges();

      expect(emitted).toEqual([
        { taskId: SELF, patch: { [field]: ['TASK_2026_300'] } },
      ]);
    },
  );

  it('removes every copy of a repeated authored entry in one action', () => {
    // The list is de-duplicated for display (FR-B4.8), so one chip stands for
    // every copy — leaving a stale copy behind after the user removed the only
    // control that named it would be the worse outcome.
    const task = makeTask(SELF, { dependsOn: [OTHER, OTHER, 'TASK_2026_300'] });
    const graph = buildTaskGraph([
      task,
      makeTask(OTHER),
      makeTask('TASK_2026_300'),
    ]);
    const { removesIn, emitted, fixture } = render(task, graph);

    expect(removesIn('blocked_by')).toHaveLength(2);
    removesIn('blocked_by')[0].click();
    fixture.detectChanges();

    expect(emitted).toEqual([
      { taskId: SELF, patch: { dependsOn: ['TASK_2026_300'] } },
    ]);
  });

  it('emits [] when the last authored entry of a group is removed', () => {
    const task = makeTask(SELF, { relatesTo: [OTHER] });
    const graph = buildTaskGraph([task, makeTask(OTHER)]);
    const { removesIn, emitted, fixture } = render(task, graph);

    removesIn('related:authored')[0].click();
    fixture.detectChanges();

    expect(emitted).toEqual([{ taskId: SELF, patch: { relatesTo: [] } }]);
  });

  // -------------------------------------------------------------------------
  // Adding — three kinds write this carrier, `blocks` writes the other one
  // -------------------------------------------------------------------------
  it.each([
    ['blocked_by', 'dependsOn'],
    ['duplicates', 'duplicates'],
    ['related', 'relatesTo'],
  ] as ReadonlyArray<
    readonly [string, 'dependsOn' | 'duplicates' | 'relatesTo']
  >)('declaring %s appends to %s on this task', (kind, field) => {
    const task = makeTask(SELF, { [field]: ['TASK_2026_300'] });
    const graph = buildTaskGraph([
      task,
      makeTask(OTHER),
      makeTask('TASK_2026_300'),
    ]);
    const { add, emitted } = render(task, graph);

    add(kind, OTHER);

    expect(emitted).toEqual([
      { taskId: SELF, patch: { [field]: ['TASK_2026_300', OTHER] } },
    ]);
  });

  // FR-B4.3. There is no `blocks:` key and there never will be.
  it('declaring "blocks" writes the OTHER task’s depends_on, not this carrier', () => {
    const task = makeTask(SELF);
    const other = makeTask(OTHER, { dependsOn: ['TASK_2026_300'] });
    const graph = buildTaskGraph([task, other, makeTask('TASK_2026_300')]);
    const { add, emitted } = render(task, graph);

    add('blocks', OTHER);

    expect(emitted).toEqual([
      { taskId: OTHER, patch: { dependsOn: ['TASK_2026_300', SELF] } },
    ]);
  });

  it('refuses "blocks" against a task the board cannot see, rather than guessing its array', () => {
    const task = makeTask(SELF);
    const graph = buildTaskGraph([task]);
    const { add, emitted, addError } = render(task, graph);

    add('blocks', 'TASK_2026_999');

    expect(emitted).toEqual([]);
    expect(addError()).toContain('not on the board');
    expect(addError()).toContain('no blocks: key');
  });

  it('refuses a "blocks" edge the other task already declares', () => {
    const task = makeTask(SELF);
    const other = makeTask(OTHER, { dependsOn: [SELF] });
    const graph = buildTaskGraph([task, other]);
    const { add, emitted, addError } = render(task, graph);

    add('blocks', OTHER);

    expect(emitted).toEqual([]);
    expect(addError()).toContain('already depends on this task');
  });

  it('refuses a relation this task already declares', () => {
    const task = makeTask(SELF, { relatesTo: [OTHER] });
    const graph = buildTaskGraph([task, makeTask(OTHER)]);
    const { add, emitted, addError } = render(task, graph);

    add('related', OTHER);

    expect(emitted).toEqual([]);
    expect(addError()).toContain('already declares');
  });

  it('refuses a self-reference', () => {
    const task = makeTask(SELF);
    const graph = buildTaskGraph([task]);
    const { add, emitted, addError } = render(task, graph);

    add('related', SELF);

    expect(emitted).toEqual([]);
    expect(addError()).toBe('A task cannot declare a relation to itself.');
  });

  it.each([
    ['a traversal token', '../escape'],
    ['a drive-relative prefix', 'C:elsewhere'],
    ['a separator', 'TASK_2026_100/task.md'],
  ])(
    'refuses %s as a relation, quoting the shared guard verbatim',
    (_n, ref) => {
      const task = makeTask(SELF);
      const graph = buildTaskGraph([task]);
      const { add, emitted, addError } = render(task, graph);

      add('related', ref);

      expect(emitted).toEqual([]);
      expect(addError()).toBe(schemaMessage({ relatesTo: [ref] }));
    },
  );

  it('renders the add control even when this task has no relations at all', () => {
    const task = makeTask(SELF);
    const { el } = render(task, buildTaskGraph([task]));
    expect(el('task-relations-add')).not.toBeNull();
  });

  it('never offers the task itself for completion', () => {
    const task = makeTask(SELF);
    const graph = buildTaskGraph([task, makeTask(OTHER)]);
    const { host } = render(task, graph);
    const options = Array.from(
      host.querySelectorAll<HTMLOptionElement>(
        '#task-relation-completions option',
      ),
    ).map((option) => option.value);

    expect(options).toEqual([OTHER]);
  });

  it('emits nothing while a write is outstanding', () => {
    const task = makeTask(SELF, { dependsOn: [OTHER] });
    const graph = buildTaskGraph([task, makeTask(OTHER)]);
    const { removesIn, emitted, fixture } = render(task, graph, { busy: true });

    removesIn('blocked_by')[0].click();
    fixture.detectChanges();

    expect(emitted).toEqual([]);
  });
});
