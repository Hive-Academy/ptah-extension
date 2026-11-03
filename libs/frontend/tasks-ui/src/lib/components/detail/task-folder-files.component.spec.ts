import { TestBed } from '@angular/core/testing';
import {
  buildNestedFolderEntries,
  buildRootFolderEntries,
  folderBreadcrumbs,
  type TaskFolderRawEntry,
} from '../../services/task-folder-entries';
import type {
  TaskDocumentState,
  TaskFolderListing,
} from '../../services/task-folder.store';
import { TaskFolderFilesComponent } from './task-folder-files.component';

const ROOT: TaskFolderRawEntry[] = [
  { name: 'task.md', kind: 'file' },
  { name: 'context.md', kind: 'file' },
  { name: 'task-description.md', kind: 'file' },
  { name: 'decisions.md', kind: 'file' },
  { name: 'notes.txt', kind: 'file' },
  { name: 'escape', kind: 'symlink' },
  { name: 'prototype', kind: 'directory' },
];

function rootListing(raw: TaskFolderRawEntry[] = ROOT): TaskFolderListing {
  return {
    directory: '',
    status: 'ready',
    entries: buildRootFolderEntries(raw),
    message: null,
  };
}

describe('TaskFolderFilesComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TaskFolderFilesComponent] });
  });

  function render(
    listing: TaskFolderListing,
    options: {
      openFile?: string | null;
      openStatus?: TaskDocumentState['status'];
      directory?: string;
    } = {},
  ) {
    const fixture = TestBed.createComponent(TaskFolderFilesComponent);
    fixture.componentRef.setInput('listing', listing);
    fixture.componentRef.setInput(
      'breadcrumbs',
      folderBreadcrumbs('TASK_2026_200', options.directory ?? ''),
    );
    fixture.componentRef.setInput('openFile', options.openFile ?? null);
    fixture.componentRef.setInput('openStatus', options.openStatus ?? 'idle');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const row = (name: string) =>
      host.querySelector<HTMLElement>(
        `[data-testid="task-folder-row-${name}"]`,
      );
    return { fixture, host, row };
  }

  it('groups actual entries On disk apart from Expected workflow files', () => {
    const { host, row } = render(rootListing());
    const onDisk = host.querySelector('[data-testid="task-folder-on-disk"]');
    const expected = host.querySelector('[data-testid="task-folder-expected"]');
    expect(onDisk?.textContent).toContain('context.md');
    expect(onDisk?.textContent).toContain('prototype/');
    expect(onDisk?.textContent).toContain('decisions.md');
    expect(expected?.textContent).toContain('implementation-plan.md');
    expect(expected?.textContent).not.toContain('context.md');
    expect(host.textContent).toContain('On disk');
    expect(host.textContent).toContain('Expected workflow files');

    // Missing rows say so and offer no control.
    const plan = row('implementation-plan.md');
    expect(plan?.tagName).toBe('DIV');
    expect(plan?.getAttribute('data-presence')).toBe('missing');
    expect(plan?.textContent).toContain('Missing');
    expect(
      host.querySelector('[data-testid="task-folder-count"]')?.textContent,
    ).toContain('6 files, 1 folder');
  });

  it('marks the legacy batch file as Legacy', () => {
    const { row } = render(
      rootListing([
        { name: 'task.md', kind: 'file' },
        { name: 'tasks.md', kind: 'file' },
      ]),
    );
    expect(row('tasks.md')?.textContent).toContain('Legacy · Present');
  });

  it('reads a markdown file on click, and marks the open row current', () => {
    const { fixture, row } = render(rootListing(), {
      openFile: 'context.md',
      openStatus: 'ready',
    });
    const read: string[] = [];
    fixture.componentInstance.readFile.subscribe((file) => read.push(file));

    const context = row('context.md') as HTMLButtonElement;
    expect(context.tagName).toBe('BUTTON');
    expect(context.getAttribute('aria-current')).toBe('true');
    expect(context.className).toContain('focus-visible:outline-base-content');

    (row('decisions.md') as HTMLButtonElement).click();
    expect(read).toEqual(['decisions.md']);
  });

  it('shows the carrier row as the overview, current when nothing is open', () => {
    const { fixture, row } = render(rootListing());
    let shown = 0;
    fixture.componentInstance.showCarrier.subscribe(() => shown++);
    const carrier = row('task.md') as HTMLButtonElement;
    expect(carrier.textContent).toContain('Carrier');
    expect(carrier.getAttribute('aria-current')).toBe('true');
    carrier.click();
    expect(shown).toBe(1);
  });

  it('browses a directory instead of reading it as markdown', () => {
    const { fixture, row } = render(rootListing());
    const browsed: string[] = [];
    const read: string[] = [];
    fixture.componentInstance.openDirectory.subscribe((dir) =>
      browsed.push(dir),
    );
    fixture.componentInstance.readFile.subscribe((file) => read.push(file));
    const folder = row('prototype') as HTMLButtonElement;
    expect(folder.textContent).toContain('prototype/');
    expect(folder.textContent).toContain('Folder');
    expect(folder.getAttribute('aria-label')).toBe('Open folder prototype');
    folder.click();
    expect(browsed).toEqual(['prototype']);
    expect(read).toEqual([]);
  });

  it('keeps every actionable row a named native button in the tab order', () => {
    const { host } = render(rootListing());
    const actionable = Array.from(
      host.querySelectorAll<HTMLElement>('[data-action]'),
    );
    expect(actionable.length).toBeGreaterThan(0);
    for (const control of actionable) {
      // A native button is focusable and fires click on Enter and Space.
      expect(control.tagName).toBe('BUTTON');
      expect(control.getAttribute('type')).toBe('button');
      expect(control.getAttribute('tabindex')).toBeNull();
      expect(control.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    }
    // Missing and inert rows carry no control, so Tab never lands on them.
    expect(
      host.querySelectorAll('div[data-testid^="task-folder-row-"] button'),
    ).toHaveLength(0);
  });

  it('hands a non-markdown file to the editor and shows a symlink inert', () => {
    const { fixture, row } = render(rootListing());
    const opened: string[] = [];
    fixture.componentInstance.openInEditor.subscribe((file) =>
      opened.push(file),
    );
    (row('notes.txt') as HTMLButtonElement).click();
    expect(opened).toEqual(['notes.txt']);

    const link = row('escape');
    expect(link?.tagName).toBe('DIV');
    expect(link?.textContent).toContain('not followed');
  });

  it.each([
    ['binary', 'Binary'],
    ['unreadable', 'Unreadable'],
    ['rejected', 'Rejected'],
    ['too_large', 'Too large'],
  ] as const)(
    'labels the open row with the %s reader state',
    (status, label) => {
      const { row } = render(rootListing(), {
        openFile: 'decisions.md',
        openStatus: status,
      });
      expect(row('decisions.md')?.textContent).toContain(label);
    },
  );

  it('lists a nested folder with breadcrumbs back to the task folder', () => {
    const listing: TaskFolderListing = {
      directory: 'prototype/assets',
      status: 'ready',
      entries: buildNestedFolderEntries([
        { name: 'logo.png', kind: 'file' },
        { name: 'icons', kind: 'directory' },
      ]),
      message: null,
    };
    const { fixture, host, row } = render(listing, {
      directory: 'prototype/assets',
    });
    const browsed: string[] = [];
    fixture.componentInstance.openDirectory.subscribe((dir) =>
      browsed.push(dir),
    );

    // Nested files are listed, never offered to the reader or the editor.
    expect(row('logo.png')?.tagName).toBe('DIV');
    (row('icons') as HTMLButtonElement).click();
    expect(browsed).toEqual(['prototype/assets/icons']);

    const crumbs = Array.from(
      host.querySelectorAll<HTMLButtonElement>(
        '[data-testid="task-folder-crumb"]',
      ),
    );
    expect(crumbs.map((c) => c.getAttribute('data-path'))).toEqual([
      '',
      'prototype',
    ]);
    crumbs[0].click();
    expect(browsed).toEqual(['prototype/assets/icons', '']);
    expect(
      host.querySelector('[aria-current="location"]')?.textContent,
    ).toContain('assets');
  });

  it.each([
    ['missing', 'no longer exists'],
    ['unreadable', 'could not be read'],
    ['rejected', 'was refused'],
    ['too_many', 'too many entries'],
  ] as const)('explains a %s listing', (status, reason) => {
    const { host } = render(
      { directory: 'prototype', status, entries: [], message: null },
      { directory: 'prototype' },
    );
    expect(
      host.querySelector(`[data-testid="task-folder-${status}"]`)?.textContent,
    ).toContain(reason);
  });

  it('shows a labelled loading state and an error alert', () => {
    const loading = render({
      directory: 'prototype',
      status: 'loading',
      entries: [],
      message: null,
    }).host.querySelector('[data-testid="task-folder-loading"]');
    expect(loading?.getAttribute('aria-label')).toBe('Loading folder');

    const error = render({
      directory: 'prototype',
      status: 'error',
      entries: [],
      message: 'boom',
    }).host.querySelector('[data-testid="task-folder-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('boom');
  });

  it('says an empty folder is empty', () => {
    const { host } = render(
      { directory: 'prototype', status: 'ready', entries: [], message: null },
      { directory: 'prototype' },
    );
    expect(
      host.querySelector('[data-testid="task-folder-empty"]')?.textContent,
    ).toContain('empty');
  });
});
