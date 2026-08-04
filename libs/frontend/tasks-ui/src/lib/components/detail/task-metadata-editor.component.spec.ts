import { TestBed } from '@angular/core/testing';
import {
  TaskMetadataPatchSchema,
  type TaskMetadataPatch,
  type TaskSpecSummary,
} from '@ptah-extension/shared';
import { TaskMetadataEditorComponent } from './task-metadata-editor.component';
import type { TaskMetadataWrite } from './task-metadata-write';

function makeTask(overrides: Partial<TaskSpecSummary> = {}): TaskSpecSummary {
  return {
    id: 'TASK_2026_200',
    folderName: 'TASK_2026_200',
    status: 'backlog',
    type: 'FEATURE',
    title: 'Implement the board',
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

/**
 * The SHARED schema's own message for a patch it refuses.
 *
 * Read out of the schema rather than typed here: a literal expectation would be
 * a second copy of the wording, and one copy is the entire point.
 */
function schemaMessage(patch: TaskMetadataPatch): string {
  const parsed = TaskMetadataPatchSchema.safeParse(patch);
  if (parsed.success) {
    throw new Error('expected the shared schema to refuse this patch');
  }
  return parsed.error.issues[0].message;
}

describe('TaskMetadataEditorComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskMetadataEditorComponent] });
  });

  function render(
    task: TaskSpecSummary,
    inputs: {
      knownLabels?: readonly string[];
      knownTaskIds?: readonly string[];
      busy?: boolean;
    } = {},
  ) {
    const fixture = TestBed.createComponent(TaskMetadataEditorComponent);
    fixture.componentRef.setInput('task', task);
    fixture.componentRef.setInput('knownLabels', inputs.knownLabels ?? []);
    fixture.componentRef.setInput('knownTaskIds', inputs.knownTaskIds ?? []);
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const emitted: TaskMetadataWrite[] = [];
    fixture.componentInstance.apply.subscribe((write) => emitted.push(write));

    const el = <T extends HTMLElement>(testid: string): T =>
      host.querySelector(`[data-testid="${testid}"]`) as T;

    const type = (testid: string, value: string): void => {
      const input = el<HTMLInputElement>(testid);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    const click = (testid: string): void => {
      el<HTMLButtonElement>(testid).click();
      fixture.detectChanges();
    };

    const text = (testid: string): string =>
      el(testid)?.textContent?.trim() ?? '';

    return { fixture, host, emitted, el, type, click, text };
  }

  // -------------------------------------------------------------------------
  // Rendering alone writes nothing. The editor emits requests; the store is the
  // only thing that issues a write, and `tasks:updateMetadata` the only method.
  // -------------------------------------------------------------------------
  it('emits nothing on a read-only render, with or without metadata', () => {
    const bare = render(makeTask());
    expect(bare.emitted).toEqual([]);

    const rich = render(
      makeTask({
        labels: ['licensing', 'needs:design'],
        estimate: 'L',
        parent: 'TASK_2026_100',
      }),
      { knownLabels: ['licensing'], knownTaskIds: ['TASK_2026_100'] },
    );
    expect(rich.emitted).toEqual([]);
  });

  it('renders every label verbatim as interpolated text', () => {
    // Hostile-but-legal label text. It reaches the DOM as TEXT and nothing else
    // — no [innerHTML], no markdown block, no path or RegExp interpolation — so
    // the markup it spells never becomes an element.
    const hostile = '<img src=x onerror=alert(1)>';
    const { host, text } = render(makeTask({ labels: [hostile, '#urgent'] }));

    expect(text('task-editor-labels')).toContain(hostile);
    expect(host.querySelector('img')).toBeNull();
    // The chip's label is a text node, not a parsed element subtree.
    const chipText = host.querySelector(
      '[data-testid="task-editor-labels"] span.truncate',
    );
    expect(chipText?.textContent).toBe(hostile);
    expect(chipText?.children).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Labels — full replacement, computed client-side
  // -------------------------------------------------------------------------
  it('appends one label and emits the WHOLE array', () => {
    const { emitted, type, click } = render(
      makeTask({ labels: ['licensing'] }),
    );

    type('task-editor-label-input', 'billing');
    click('task-editor-label-add');

    expect(emitted).toEqual([
      { taskId: 'TASK_2026_200', patch: { labels: ['licensing', 'billing'] } },
    ]);
  });

  it('trims the draft — a value being authored now, not one already on disk', () => {
    const { emitted, type, click } = render(makeTask());

    type('task-editor-label-input', '  billing  ');
    click('task-editor-label-add');

    expect(emitted[0].patch.labels).toEqual(['billing']);
  });

  it('removes by POSITION, so a repeated label loses only the chip pressed', () => {
    // The parser keeps a repeat in the file (FR-B4.8), so the array can carry
    // the same text twice and "remove this chip" has to mean this one.
    const { host, emitted, fixture } = render(
      makeTask({ labels: ['licensing', 'billing', 'licensing'] }),
    );
    const removes = host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="task-editor-label-remove"]',
    );
    expect(removes).toHaveLength(3);

    removes[0].click();
    fixture.detectChanges();

    expect(emitted).toEqual([
      { taskId: 'TASK_2026_200', patch: { labels: ['billing', 'licensing'] } },
    ]);
  });

  it('emits [] when the last label is removed — the writer removes the key', () => {
    const { emitted, click } = render(makeTask({ labels: ['licensing'] }));

    click('task-editor-label-remove');

    expect(emitted).toEqual([
      { taskId: 'TASK_2026_200', patch: { labels: [] } },
    ]);
  });

  it('refuses a label the task already carries, matched case- and space-insensitively', () => {
    const { emitted, type, click, text } = render(
      makeTask({ labels: ['licensing '] }),
    );

    type('task-editor-label-input', 'Licensing');
    click('task-editor-label-add');

    expect(emitted).toEqual([]);
    expect(text('task-editor-label-error')).toBe(
      'This task already carries that label.',
    );
  });

  it('offers only completions the task does not already hold', () => {
    const { host } = render(makeTask({ labels: ['Licensing'] }), {
      knownLabels: ['licensing ', 'billing'],
    });
    const options = Array.from(
      host.querySelectorAll<HTMLOptionElement>(
        '#task-label-completions option',
      ),
    ).map((option) => option.value);

    expect(options).toEqual(['billing']);
  });

  // -------------------------------------------------------------------------
  // The three label limits live in the shared schema and are quoted verbatim.
  // -------------------------------------------------------------------------
  // The newline limit is not exercised through this control on purpose: an
  // `<input type="text">` runs the HTML value-sanitization algorithm and strips
  // CR/LF before anything reads `.value`, so a newline cannot reach the draft
  // here. It is asserted at the funnel instead — see the `applyMetadata` block
  // in `tasks-store.service.spec.ts`, which is the boundary a paste, an agent,
  // or a later batch would actually cross.
  it('refuses a label over the length cap with the schema’s own sentence', () => {
    const value = 'x'.repeat(33);
    const { emitted, type, click, text } = render(makeTask());

    type('task-editor-label-input', value);
    click('task-editor-label-add');

    expect(emitted).toEqual([]);
    expect(text('task-editor-label-error')).toBe(
      schemaMessage({ labels: [value] }),
    );
  });

  it('refuses the label that would exceed the per-task cap, and allows the one before it', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `label-${i}`);
    const twelve = Array.from({ length: 12 }, (_, i) => `label-${i}`);

    const under = render(makeTask({ labels: eleven }));
    under.type('task-editor-label-input', 'one-more');
    under.click('task-editor-label-add');
    expect(under.emitted).toHaveLength(1);

    const at = render(makeTask({ labels: twelve }));
    at.type('task-editor-label-input', 'one-too-many');
    at.click('task-editor-label-add');
    expect(at.emitted).toEqual([]);
    expect(at.text('task-editor-label-error')).toBe(
      schemaMessage({ labels: [...twelve, 'one-too-many'] }),
    );
  });

  it('still lets an over-long PRE-EXISTING label be removed', () => {
    // The read boundary keeps it and warns; the write boundary refuses it. So a
    // full-replacement array that still contains it fails — but the array that
    // drops it does not, which is the recovery path.
    const tooLong = 'x'.repeat(40);
    const { emitted, host, fixture, text } = render(
      makeTask({ labels: [tooLong, 'billing'] }),
    );
    const removes = host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="task-editor-label-remove"]',
    );

    // Removing the OTHER label leaves the offender in the array → refused, with
    // the sentence that names the actual rule.
    removes[1].click();
    fixture.detectChanges();
    expect(emitted).toEqual([]);
    expect(text('task-editor-label-error')).toBe(
      schemaMessage({ labels: [tooLong] }),
    );

    // Removing the offender itself succeeds.
    removes[0].click();
    fixture.detectChanges();
    expect(emitted).toEqual([
      { taskId: 'TASK_2026_200', patch: { labels: ['billing'] } },
    ]);
  });

  // -------------------------------------------------------------------------
  // Estimate
  // -------------------------------------------------------------------------
  it('emits the chosen estimate, and null for "No estimate"', () => {
    const { emitted, el, fixture } = render(makeTask({ estimate: 'S' }));
    const select = el<HTMLSelectElement>('task-editor-estimate');

    expect(select.value).toBe('S');

    select.value = 'XL';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emitted).toEqual([
      { taskId: 'TASK_2026_200', patch: { estimate: 'XL' } },
    ]);

    select.value = '';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(emitted[1]).toEqual({
      taskId: 'TASK_2026_200',
      patch: { estimate: null },
    });
  });

  it('emits nothing when the estimate is re-selected unchanged', () => {
    // A no-op patch still rewrites the carrier and refreshes `updated`.
    const { emitted, el, fixture } = render(makeTask({ estimate: 'M' }));
    const select = el<HTMLSelectElement>('task-editor-estimate');

    select.value = 'M';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(emitted).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Parent
  // -------------------------------------------------------------------------
  it('sets and clears the parent, emitting null to remove the key', () => {
    const set = render(makeTask(), { knownTaskIds: ['TASK_2026_100'] });
    set.type('task-editor-parent-input', 'TASK_2026_100');
    set.click('task-editor-parent-set');
    expect(set.emitted).toEqual([
      { taskId: 'TASK_2026_200', patch: { parent: 'TASK_2026_100' } },
    ]);

    const clear = render(makeTask({ parent: 'TASK_2026_100' }));
    clear.click('task-editor-parent-clear');
    expect(clear.emitted).toEqual([
      { taskId: 'TASK_2026_200', patch: { parent: null } },
    ]);
  });

  it('offers no Clear control when there is no parent to clear', () => {
    const { el } = render(makeTask());
    expect(el('task-editor-parent-clear')).toBeNull();
  });

  it.each([
    ['a traversal token', '../escape'],
    ['a padded traversal token', ' .. '],
    ['a drive-relative prefix', 'C:elsewhere'],
    ['a separator', 'TASK_2026_100/task.md'],
  ])(
    'refuses %s as a parent, quoting the shared guard verbatim',
    (_n, value) => {
      const { emitted, type, click, text } = render(makeTask());

      type('task-editor-parent-input', value);
      click('task-editor-parent-set');

      expect(emitted).toEqual([]);
      expect(text('task-editor-parent-error')).toBe(
        schemaMessage({ parent: value }),
      );
    },
  );

  it('refuses a self-parent', () => {
    const { emitted, type, click, text } = render(makeTask());

    type('task-editor-parent-input', 'TASK_2026_200');
    click('task-editor-parent-set');

    expect(emitted).toEqual([]);
    expect(text('task-editor-parent-error')).toBe(
      'A task cannot be its own parent.',
    );
  });

  it('never offers the task itself as its own parent', () => {
    const { host } = render(makeTask(), {
      knownTaskIds: ['TASK_2026_100', 'TASK_2026_200'],
    });
    const options = Array.from(
      host.querySelectorAll<HTMLOptionElement>(
        '#task-parent-completions option',
      ),
    ).map((option) => option.value);

    expect(options).toEqual(['TASK_2026_100']);
  });

  // -------------------------------------------------------------------------
  // Busy
  // -------------------------------------------------------------------------
  it('emits nothing while a write is outstanding', () => {
    const { emitted, el, click } = render(makeTask({ labels: ['licensing'] }), {
      busy: true,
    });

    expect(el<HTMLButtonElement>('task-editor-label-input').disabled).toBe(
      true,
    );
    click('task-editor-label-remove');

    expect(emitted).toEqual([]);
  });
});
