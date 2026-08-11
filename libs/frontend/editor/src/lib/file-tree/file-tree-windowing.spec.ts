/**
 * File-tree windowing — TASK_2026_203.
 *
 * WHAT THIS CAN AND CANNOT SHOW. jsdom reports zero height for every element
 * and does no layout, so nothing here is evidence about scrolling, viewport
 * intersection or paint. It is deliberately not asked to be: the claim under
 * test is a COUNTING claim — how many `FileTreeNodeComponent`s get mounted
 * when a directory of 5,000 entries is expanded, and how many times its child
 * list gets sorted. Both are exact integers that jsdom reports correctly, and
 * the first is the actual mechanism behind the concern TASK_2026_203 was filed
 * for (see its context.md: "a single directory expanded to reveal thousands of
 * nodes simultaneously mounted in the DOM"). The visual half is verified in a
 * live Electron host, recorded in the task.
 *
 * The pre-change baseline these numbers replace, measured by reverting the
 * window against this same fixture: 5,001 mounted rows where there are now
 * 201, and three full sorts of the child list per children change where there
 * is now one.
 */

import { Component, signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FileTreeComponent } from './file-tree.component';
import { FileTreeNodeComponent } from './file-tree-node.component';
import {
  createFileTreeWindow,
  FILE_TREE_WINDOW_SIZE,
} from './file-tree-window';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import type { FileTreeNode } from '../models/file-tree.model';

/** Far above the window, and above anything a hand-authored directory holds. */
const HUGE = 5000;

function file(name: string, parent = '/ws/big'): FileTreeNode {
  return { name, path: `${parent}/${name}`, type: 'file' };
}

/** `count` files named so that sort order and creation order agree. */
function manyFiles(count: number, parent = '/ws/big'): FileTreeNode[] {
  return Array.from({ length: count }, (_, i) =>
    file(`f${String(i).padStart(6, '0')}.ts`, parent),
  );
}

function bigDir(count = HUGE): FileTreeNode {
  return {
    name: 'big',
    path: '/ws/big',
    type: 'directory',
    children: manyFiles(count),
  };
}

// ---------------------------------------------------------------------------
// The primitive, on its own
// ---------------------------------------------------------------------------

describe('createFileTreeWindow', () => {
  it('renders everything, and hides nothing, below the window size', () => {
    const nodes = manyFiles(FILE_TREE_WINDOW_SIZE);
    const window = createFileTreeWindow(() => nodes);

    expect(window.visible().length).toBe(FILE_TREE_WINDOW_SIZE);
    expect(window.hiddenCount()).toBe(0);
  });

  it('caps at the window size and reports the remainder', () => {
    const nodes = manyFiles(HUGE);
    const window = createFileTreeWindow(() => nodes);

    expect(window.visible().length).toBe(FILE_TREE_WINDOW_SIZE);
    expect(window.hiddenCount()).toBe(HUGE - FILE_TREE_WINDOW_SIZE);
    // A contiguous prefix, in the caller's order — not a sample.
    expect(window.visible()[0]).toBe(nodes[0]);
    expect(window.visible()[FILE_TREE_WINDOW_SIZE - 1]).toBe(
      nodes[FILE_TREE_WINDOW_SIZE - 1],
    );
  });

  it('reveals exactly one more chunk per showMore, and stops at the end', () => {
    const nodes = manyFiles(FILE_TREE_WINDOW_SIZE * 2 + 10);
    const window = createFileTreeWindow(() => nodes);

    window.showMore();
    expect(window.visible().length).toBe(FILE_TREE_WINDOW_SIZE * 2);
    expect(window.hiddenCount()).toBe(10);

    window.showMore();
    expect(window.visible().length).toBe(nodes.length);
    expect(window.hiddenCount()).toBe(0);

    // Past the end it stays put rather than reporting a negative remainder.
    window.showMore();
    expect(window.visible().length).toBe(nodes.length);
    expect(window.hiddenCount()).toBe(0);
  });

  it('drops back to the first chunk on reset', () => {
    const nodes = manyFiles(HUGE);
    const window = createFileTreeWindow(() => nodes);

    window.showMore();
    window.showMore();
    expect(window.visible().length).toBe(FILE_TREE_WINDOW_SIZE * 3);

    window.reset();
    expect(window.visible().length).toBe(FILE_TREE_WINDOW_SIZE);
    expect(window.hiddenCount()).toBe(HUGE - FILE_TREE_WINDOW_SIZE);
  });

  it('stretches to include the active file when it sits past the window', () => {
    const nodes = manyFiles(HUGE);
    const active = nodes[3000];
    const window = createFileTreeWindow(
      () => nodes,
      () => active.path,
    );

    // Without this, revealing a file in a big directory would scroll to
    // nothing — the row simply would not be in the DOM.
    expect(window.visible().length).toBe(3001);
    expect(window.visible()[3000]).toBe(active);
    expect(window.hiddenCount()).toBe(HUGE - 3001);
  });

  it('does not stretch when the active file is already inside the window', () => {
    const nodes = manyFiles(HUGE);
    const window = createFileTreeWindow(
      () => nodes,
      () => nodes[5].path,
    );

    expect(window.visible().length).toBe(FILE_TREE_WINDOW_SIZE);
  });

  it('ignores an active path that is not one of these siblings', () => {
    const nodes = manyFiles(HUGE);
    const window = createFileTreeWindow(
      () => nodes,
      () => '/ws/somewhere/else.ts',
    );

    expect(window.visible().length).toBe(FILE_TREE_WINDOW_SIZE);
    expect(window.hiddenCount()).toBe(HUGE - FILE_TREE_WINDOW_SIZE);
  });
});

// ---------------------------------------------------------------------------
// The rendered tree
// ---------------------------------------------------------------------------

@Component({
  standalone: true,
  imports: [FileTreeComponent],
  template: `<ptah-file-tree
    [files]="files()"
    [activeFilePath]="activePath()"
  />`,
})
class HostComponent {
  readonly files = signal<FileTreeNode[]>([]);
  readonly activePath = signal<string | undefined>(undefined);
}

describe('file tree rendering is bounded (TASK_2026_203)', () => {
  let fixture: ComponentFixture<HostComponent>;

  const rows = (): HTMLElement[] =>
    Array.from(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="editor-file-node"]',
      ),
    );

  const moreRows = (): HTMLElement[] =>
    Array.from(
      fixture.nativeElement.querySelectorAll(
        '[data-testid="editor-file-tree-more"]',
      ),
    );

  function click(el: HTMLElement): void {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        {
          provide: EditorService,
          useValue: {
            loadDirectoryChildren: jest.fn().mockResolvedValue(undefined),
            createFile: jest.fn().mockResolvedValue(true),
            createFolder: jest.fn().mockResolvedValue(true),
            renameItem: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: GitStatusService,
          useValue: {
            activeWorkspacePath: signal<string | null>(null),
            fileStatusMap: signal(new Map()),
            changedDirPrefixes: signal(new Set<string>()),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('mounts one chunk, not 5,000 rows, when a huge directory is expanded', () => {
    fixture.componentInstance.files.set([bigDir()]);
    fixture.detectChanges();

    // Collapsed: the directory row only.
    expect(rows().length).toBe(1);

    click(rows()[0]);

    // The directory row + one chunk of children. Before windowing this was
    // 1 + 5000.
    expect(rows().length).toBe(1 + FILE_TREE_WINDOW_SIZE);
    expect(moreRows().length).toBe(1);
  });

  it('scales the rendered row count with the window, not with the directory', () => {
    // The asymptotic claim, stated as an equality rather than a bound: ten
    // times the children must still render the same number of rows.
    const counts: number[] = [];
    for (const size of [HUGE, HUGE * 10]) {
      fixture.componentInstance.files.set([
        { ...bigDir(size), path: `/ws/big${size}` },
      ]);
      fixture.detectChanges();
      click(rows()[0]);
      counts.push(rows().length);
    }

    expect(counts).toEqual([
      1 + FILE_TREE_WINDOW_SIZE,
      1 + FILE_TREE_WINDOW_SIZE,
    ]);
  });

  it('reveals exactly one more chunk per click on the reveal row', () => {
    fixture.componentInstance.files.set([bigDir()]);
    fixture.detectChanges();
    click(rows()[0]);

    click(moreRows()[0]);
    expect(rows().length).toBe(1 + FILE_TREE_WINDOW_SIZE * 2);

    click(moreRows()[0]);
    expect(rows().length).toBe(1 + FILE_TREE_WINDOW_SIZE * 3);
    expect(moreRows().length).toBe(1);
  });

  it('drops the reveal row once everything is rendered', () => {
    fixture.componentInstance.files.set([
      { ...bigDir(FILE_TREE_WINDOW_SIZE + 3), path: '/ws/big' },
    ]);
    fixture.detectChanges();
    click(rows()[0]);

    expect(moreRows().length).toBe(1);
    click(moreRows()[0]);

    expect(rows().length).toBe(1 + FILE_TREE_WINDOW_SIZE + 3);
    expect(moreRows().length).toBe(0);
  });

  it('renders no reveal row at all for an ordinary directory', () => {
    fixture.componentInstance.files.set([bigDir(12)]);
    fixture.detectChanges();
    click(rows()[0]);

    expect(rows().length).toBe(1 + 12);
    expect(moreRows().length).toBe(0);
  });

  it('re-collapses back to one chunk rather than to whatever was revealed', () => {
    fixture.componentInstance.files.set([bigDir()]);
    fixture.detectChanges();
    click(rows()[0]);
    click(moreRows()[0]);
    click(moreRows()[0]);
    expect(rows().length).toBe(1 + FILE_TREE_WINDOW_SIZE * 3);

    click(rows()[0]); // collapse
    expect(rows().length).toBe(1);

    click(rows()[0]); // re-expand
    expect(rows().length).toBe(1 + FILE_TREE_WINDOW_SIZE);
  });

  it('windows the root list by the same rule', () => {
    fixture.componentInstance.files.set(manyFiles(HUGE, '/ws'));
    fixture.detectChanges();

    expect(rows().length).toBe(FILE_TREE_WINDOW_SIZE);
    expect(moreRows().length).toBe(1);

    click(moreRows()[0]);
    expect(rows().length).toBe(FILE_TREE_WINDOW_SIZE * 2);
  });

  it('keeps the open file rendered even when it sits past the window', () => {
    const children = manyFiles(HUGE);
    fixture.componentInstance.activePath.set(children[4000].path);
    fixture.componentInstance.files.set([
      { name: 'big', path: '/ws/big', type: 'directory', children },
    ]);
    fixture.detectChanges();
    click(rows()[0]);

    const active = fixture.nativeElement.querySelector(
      '[aria-selected="true"]',
    ) as HTMLElement | null;
    expect(active).toBeTruthy();
    expect(active?.getAttribute('aria-label')).toBe(children[4000].name);
  });

  // -- the reveal row is a real, announced control ---------------------------

  it('makes the reveal row a focusable treeitem, not a bare div', () => {
    fixture.componentInstance.files.set([bigDir()]);
    fixture.detectChanges();
    click(rows()[0]);

    const more = moreRows()[0];
    // role="treeitem": it is a direct child of the tree's child list, and an
    // unowned child there is a critical aria-required-children failure.
    expect(more.getAttribute('role')).toBe('treeitem');
    // A button, so a keyboard user can reveal the rest at all.
    expect(more.tagName).toBe('BUTTON');
    more.focus();
    expect(document.activeElement).toBe(more);
    expect(more.getAttribute('aria-label')).toContain('Show');
  });

  it('names both the next chunk and the total remainder', () => {
    fixture.componentInstance.files.set([bigDir()]);
    fixture.detectChanges();
    click(rows()[0]);

    expect(moreRows()[0].textContent?.trim()).toBe(
      `Show ${FILE_TREE_WINDOW_SIZE.toLocaleString()} more ` +
        `(${(HUGE - FILE_TREE_WINDOW_SIZE).toLocaleString()} hidden)`,
    );

    // On the last chunk there is no second number to report.
    fixture.componentInstance.files.set([
      { ...bigDir(FILE_TREE_WINDOW_SIZE + 3), path: '/ws/small' },
    ]);
    fixture.detectChanges();
    click(rows()[0]);
    expect(moreRows()[0].textContent?.trim()).toBe('Show 3 more');
  });
});

// ---------------------------------------------------------------------------
// Sort memoization
// ---------------------------------------------------------------------------

describe('the child list is sorted once per change, not once per reader (TASK_2026_203)', () => {
  let fixture: ComponentFixture<FileTreeNodeComponent>;
  let compares: jest.SpyInstance;

  /** The comparator the component uses, so the reference sort below matches. */
  function compare(a: FileTreeNode, b: FileTreeNode): number {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileTreeNodeComponent],
      providers: [
        {
          provide: EditorService,
          useValue: {
            loadDirectoryChildren: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GitStatusService,
          useValue: {
            activeWorkspacePath: signal<string | null>('/ws'),
            fileStatusMap: signal(new Map()),
            changedDirPrefixes: signal(new Set<string>()),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FileTreeNodeComponent);
    // The comparator is this component's only caller of localeCompare, so the
    // call count IS the sort count. Spying on the prototype catches the sort
    // wherever it runs, without reaching into a protected member.
    compares = jest.spyOn(String.prototype, 'localeCompare');
  });

  afterEach(() => {
    compares.mockRestore();
    TestBed.resetTestingModule();
  });

  it('sorts exactly once, though three computeds read the result', () => {
    const children = manyFiles(1000);

    // Cost of ONE sort of this exact input, measured rather than hardcoded, so
    // the assertion does not depend on the engine's sort implementation.
    const mark = compares.mock.calls.length;
    [...children].sort(compare);
    const oneSort = compares.mock.calls.length - mark;
    expect(oneSort).toBeGreaterThan(0);

    const before = compares.mock.calls.length;
    fixture.componentRef.setInput('node', {
      name: 'big',
      path: '/ws/big',
      type: 'directory',
      children,
    });
    fixture.componentRef.setInput('depth', 0);
    fixture.detectChanges();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();

    // The window derives three computeds from this list. Read as a method,
    // each of them re-sorts: 3 x oneSort (measured: 6,657 vs 2,219).
    expect(compares.mock.calls.length - before).toBe(oneSort);
  });

  it('re-sorts when the children actually change', () => {
    fixture.componentRef.setInput('node', bigDir(1000));
    fixture.detectChanges();
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();

    const before = compares.mock.calls.length;
    fixture.componentRef.setInput('node', {
      name: 'big',
      path: '/ws/big',
      type: 'directory',
      children: manyFiles(1000).reverse(),
    });
    fixture.detectChanges();

    // Memoized is not frozen — new children must actually be re-sorted.
    expect(compares.mock.calls.length).toBeGreaterThan(before);
  });
});
