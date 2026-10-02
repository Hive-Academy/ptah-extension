import axe from 'axe-core';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import { GIT_LOCKED_MESSAGE } from '@ptah-extension/shared';
import type { GitFileStatus, GitReviewFile } from '@ptah-extension/shared';
import { GitReviewService } from '../services/git-review.service';
import { GitStatusService } from '../services/git-status.service';
import { SourceControlService } from '../services/source-control.service';
import {
  ChangedFileTreeComponent,
  type ChangedFileSelection,
  type ChangedFileTreeComparison,
} from './changed-file-tree.component';

// Open-in reads its remembered editor through rpcCall; nothing here needs it.
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: jest.fn(async () => ({ success: false, error: 'not in tests' })),
  };
});

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    } as HTMLDialogElement['showModal'];
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    } as HTMLDialogElement['close'];
  }
  const doc = document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (!doc.elementFromPoint) doc.elementFromPoint = () => null;
  if (!doc.elementsFromPoint) doc.elementsFromPoint = () => [];
});

const STATUS: GitFileStatus[] = [
  {
    path: 'src/app.ts',
    status: 'M',
    staged: true,
    additions: 12,
    deletions: 3,
  },
  {
    path: 'src/util.ts',
    status: 'M',
    staged: false,
    additions: 8,
    deletions: 1,
  },
  { path: 'notes.md', status: '??', staged: false, additions: 4, deletions: 0 },
  { path: 'logo.bin', status: 'M', staged: false, binary: true },
];

const REVIEW: GitReviewFile[] = [
  {
    path: 'src/new.ts',
    originalPath: 'src/old.ts',
    status: 'R',
    additions: 1,
    deletions: 1,
    binary: false,
  },
  { path: 'README.md', status: 'M', additions: 2, deletions: 0, binary: false },
];

describe('ChangedFileTreeComponent', () => {
  let fixture: ComponentFixture<ChangedFileTreeComponent>;
  let component: ChangedFileTreeComponent;
  let selections: ChangedFileSelection[];

  const railWidth = signal(256);
  const railCollapsed = signal(false);
  const layout = {
    gitRailWidth: railWidth.asReadonly(),
    gitRailCollapsed: railCollapsed.asReadonly(),
    setGitRailWidth: jest.fn((width: number) => railWidth.set(width)),
    commitGitRailWidth: jest.fn(),
  };
  const viewed = signal<ReadonlySet<string>>(new Set());
  const review = {
    isViewed: (path: string) => viewed().has(path),
    toggleViewed: jest.fn((path: string) => {
      const next = new Set(viewed());
      if (next.has(path)) next.delete(path);
      else next.add(path);
      viewed.set(next);
    }),
  };
  const ok = { success: true, data: { success: true } };
  const sourceControl = {
    stageFile: jest.fn(async () => ok),
    unstageFile: jest.fn(async () => ok),
    discardChanges: jest.fn(async () => ok),
    stageAll: jest.fn(async () => ok),
    unstageAll: jest.fn(async () => ok),
  };
  const gitStatus = { refresh: jest.fn(async () => undefined) };

  function render(
    comparison: ChangedFileTreeComparison,
    extra: Record<string, unknown> = {},
  ): void {
    fixture.componentRef.setInput('comparison', comparison);
    fixture.componentRef.setInput('statusFiles', STATUS);
    fixture.componentRef.setInput('reviewFiles', REVIEW);
    fixture.componentRef.setInput('workspaceRoot', '/ws');
    for (const [name, value] of Object.entries(extra)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const items = (): HTMLElement[] =>
    Array.from(host().querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const item = (name: string): HTMLElement => {
    const found = items().find((element) =>
      element
        .querySelector('[id$="-name"]')
        ?.textContent?.trim()
        .startsWith(name),
    );
    if (!found) throw new Error(`no row ${name}`);
    return found;
  };
  const key = (target: HTMLElement, keyName: string): void => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: keyName, bubbles: true }),
    );
    fixture.detectChanges();
  };
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    railWidth.set(256);
    railCollapsed.set(false);
    viewed.set(new Set());
    sourceControl.stageFile.mockImplementation(async () => ok);
    TestBed.configureTestingModule({
      imports: [ChangedFileTreeComponent],
      providers: [
        { provide: VSCodeService, useValue: {} },
        { provide: ElectronLayoutService, useValue: layout },
        { provide: GitReviewService, useValue: review },
        { provide: SourceControlService, useValue: sourceControl },
        { provide: GitStatusService, useValue: gitStatus },
      ],
    });
    fixture = TestBed.createComponent(ChangedFileTreeComponent);
    component = fixture.componentInstance;
    selections = [];
    component.fileSelected.subscribe((selection) => selections.push(selection));
  });

  describe('status comparisons', () => {
    it('lists Staged and Changes sections as level-1 items with their counts', () => {
      render('worktree');
      const tree = host().querySelector('[role="tree"]');
      expect(tree?.getAttribute('aria-label')).toBe('Changed files');
      const sections = items().filter(
        (el) => el.getAttribute('aria-level') === '1',
      );
      expect(
        sections.map((el) => el.textContent?.replace(/\s+/g, ' ').trim()),
      ).toEqual([
        expect.stringContaining('Staged (1)'),
        expect.stringContaining('Changes (3)'),
      ]);
      expect(sections[0].getAttribute('aria-setsize')).toBe('2');
      expect(sections[1].getAttribute('aria-posinset')).toBe('2');
      expect(sections[0].getAttribute('aria-expanded')).toBe('true');
    });

    it('nests files under folders with levels, status badges and line counts', () => {
      render('worktree');
      const folder = items().filter(
        (el) => el.dataset['testid'] === 'tree-row-folder',
      );
      expect(folder).toHaveLength(2); // src under Staged and under Changes
      expect(folder[0].getAttribute('aria-level')).toBe('2');
      const util = item('util.ts');
      expect(util.getAttribute('aria-level')).toBe('3');
      expect(
        util
          .querySelector('[data-testid="file-status-badge"]')
          ?.getAttribute('aria-label'),
      ).toBe('Modified');
      expect(util.textContent).toContain('+8');
      expect(util.textContent).toContain('−1');
      expect(item('logo.bin').textContent).toContain('binary');
      // The accessible name is built from the name, status word and counts.
      const ids = util.getAttribute('aria-labelledby')?.split(' ') ?? [];
      expect(ids).toHaveLength(3);
      for (const id of ids)
        expect(host().querySelector(`#${id}`)).not.toBeNull();
    });

    it('selects a file on click, naming its section', () => {
      render('worktree');
      item('util.ts').click();
      expect(selections).toEqual([{ path: 'src/util.ts', staged: false }]);
      item('app.ts').click();
      expect(selections[1]).toEqual({ path: 'src/app.ts', staged: true });
    });

    it('stages a file without selecting it, awaits the result and re-reads the status', async () => {
      render('worktree');
      const row = item('util.ts');
      row.focus();
      fixture.detectChanges();
      (
        row.querySelector('[data-testid="tree-stage"]') as HTMLButtonElement
      ).click();
      await settle();
      expect(sourceControl.stageFile).toHaveBeenCalledWith('src/util.ts');
      expect(selections).toEqual([]);
      expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
      expect(host().querySelector('[data-testid="tree-row-error"]')).toBeNull();
    });

    it('unstages a staged file', async () => {
      render('worktree');
      (
        item('app.ts').querySelector(
          '[data-testid="tree-unstage"]',
        ) as HTMLButtonElement
      ).click();
      await settle();
      expect(sourceControl.unstageFile).toHaveBeenCalledWith('src/app.ts');
    });

    it.each([
      [
        'git refuses',
        { success: true, data: { success: false, error: 'index.lock exists' } },
        'index.lock exists',
      ],
      [
        'the repository is locked',
        {
          success: true,
          data: { success: false, code: 'LOCKED', error: 'raw' },
        },
        GIT_LOCKED_MESSAGE,
      ],
      [
        'the transport fails',
        { success: false, error: 'timeout' },
        'Could not reach git: timeout',
      ],
    ])(
      'shows a row error when %s, still re-reads, and dismisses',
      async (_case, result, text) => {
        sourceControl.stageFile.mockImplementation(async () => result as never);
        render('worktree');
        (
          item('util.ts').querySelector(
            '[data-testid="tree-stage"]',
          ) as HTMLButtonElement
        ).click();
        await settle();
        const error = item('util.ts').querySelector(
          '[data-testid="tree-row-error"]',
        );
        expect(
          error?.querySelector('[role="alert"]')?.textContent?.trim(),
        ).toBe(text);
        expect(gitStatus.refresh).toHaveBeenCalled();
        (error?.querySelector('button') as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(
          host().querySelector('[data-testid="tree-row-error"]'),
        ).toBeNull();
        expect(selections).toEqual([]);
      },
    );

    it('reports a thrown call as a transport failure', async () => {
      sourceControl.stageFile.mockImplementation(async () => {
        throw new Error('ipc closed');
      });
      render('worktree');
      (
        item('util.ts').querySelector(
          '[data-testid="tree-stage"]',
        ) as HTMLButtonElement
      ).click();
      await settle();
      expect(
        host()
          .querySelector('[data-testid="tree-row-error"] [role="alert"]')
          ?.textContent?.trim(),
      ).toBe('Could not reach git: ipc closed');
    });

    it('keeps the row busy while its call is in flight', async () => {
      let finish: (value: unknown) => void = () => undefined;
      sourceControl.stageFile.mockImplementation(
        () => new Promise((resolve) => (finish = resolve)) as never,
      );
      render('worktree');
      const stage = item('util.ts').querySelector(
        '[data-testid="tree-stage"]',
      ) as HTMLButtonElement;
      stage.click();
      fixture.detectChanges();
      expect(stage.disabled).toBe(true);
      expect(item('util.ts').getAttribute('aria-busy')).toBe('true');
      stage.click();
      expect(sourceControl.stageFile).toHaveBeenCalledTimes(1);
      finish(ok);
      await settle();
      expect(stage.disabled).toBe(false);
    });

    it('discards only after the confirmation, and never on cancel', async () => {
      render('worktree');
      const discard = item('util.ts').querySelector(
        '[data-testid="tree-discard"]',
      ) as HTMLButtonElement;
      discard.click();
      fixture.detectChanges();
      const dialog = host().querySelector('[data-testid="git-confirm-dialog"]');
      expect(dialog?.textContent).toContain(
        'Your changes to src/util.ts will be lost',
      );
      expect(sourceControl.discardChanges).not.toHaveBeenCalled();
      (
        host().querySelector(
          '[data-testid="git-confirm-cancel"]',
        ) as HTMLButtonElement
      ).click();
      await settle();
      expect(sourceControl.discardChanges).not.toHaveBeenCalled();

      discard.click();
      fixture.detectChanges();
      (
        host().querySelector(
          '[data-testid="git-confirm-confirm"]',
        ) as HTMLButtonElement
      ).click();
      await settle();
      expect(sourceControl.discardChanges).toHaveBeenCalledWith('src/util.ts');
      expect(gitStatus.refresh).toHaveBeenCalled();
      expect(selections).toEqual([]);
    });

    it('words an untracked discard as a deletion', () => {
      render('worktree');
      (
        item('notes.md').querySelector(
          '[data-testid="tree-discard"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      const dialog = host().querySelector('[data-testid="git-confirm-dialog"]');
      expect(dialog?.textContent).toContain('Delete this untracked file?');
      expect(
        host()
          .querySelector('[data-testid="git-confirm-confirm"]')
          ?.textContent?.trim(),
      ).toBe('Delete file');
    });

    it('drops a confirmed discard when the workspace changed while asking', async () => {
      render('worktree');
      (
        item('util.ts').querySelector(
          '[data-testid="tree-discard"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      fixture.componentRef.setInput('workspaceRoot', '/other');
      fixture.detectChanges();
      (
        host().querySelector(
          '[data-testid="git-confirm-confirm"]',
        ) as HTMLButtonElement
      ).click();
      await settle();
      expect(sourceControl.discardChanges).not.toHaveBeenCalled();
    });

    it('stages and unstages a whole section from its header', async () => {
      render('worktree');
      (
        host().querySelector(
          '[data-testid="tree-stage-all"]',
        ) as HTMLButtonElement
      ).click();
      await settle();
      (
        host().querySelector(
          '[data-testid="tree-unstage-all"]',
        ) as HTMLButtonElement
      ).click();
      await settle();
      expect(sourceControl.stageAll).toHaveBeenCalledTimes(1);
      expect(sourceControl.unstageAll).toHaveBeenCalledTimes(1);
      expect(
        items()
          .filter((el) => el.getAttribute('aria-level') === '1')[0]
          .getAttribute('aria-expanded'),
      ).toBe('true');
    });

    it('marks the file in view as selected for its comparison only', () => {
      render('staged', { activePath: 'src/app.ts' });
      expect(item('app.ts').getAttribute('aria-selected')).toBe('true');
      expect(item('util.ts').getAttribute('aria-selected')).toBe('false');
      expect(item('app.ts').tabIndex).toBe(0);
    });

    it('says when there is nothing to list', () => {
      fixture.componentRef.setInput('comparison', 'worktree');
      fixture.detectChanges();
      expect(
        host()
          .querySelector('[data-testid="changed-file-tree-empty"]')
          ?.textContent?.trim(),
      ).toBe('No changes in the working tree.');
    });
  });

  describe('keyboard (WAI-ARIA tree)', () => {
    it('keeps exactly one tab stop and moves it with the arrow keys, Home and End', () => {
      render('worktree');
      const stops = () => items().filter((el) => el.tabIndex === 0);
      expect(stops()).toHaveLength(1);
      const first = items()[0];
      first.focus();
      key(first, 'ArrowDown');
      expect(document.activeElement).toBe(items()[1]);
      expect(stops()).toEqual([items()[1]]);
      key(items()[1], 'End');
      expect(document.activeElement).toBe(items()[items().length - 1]);
      key(document.activeElement as HTMLElement, 'Home');
      expect(document.activeElement).toBe(items()[0]);
      key(items()[0], 'ArrowUp');
      expect(document.activeElement).toBe(items()[0]);
    });

    it('collapses with Left, expands with Right, enters with Right and climbs with Left', () => {
      render('worktree');
      const staged = items()[0];
      staged.focus();
      key(staged, 'ArrowLeft');
      expect(staged.getAttribute('aria-expanded')).toBe('false');
      expect(() => item('app.ts')).toThrow();
      key(staged, 'ArrowRight');
      expect(staged.getAttribute('aria-expanded')).toBe('true');
      key(staged, 'ArrowRight');
      const folder = document.activeElement as HTMLElement;
      expect(folder.getAttribute('aria-level')).toBe('2');
      key(folder, 'ArrowRight');
      const file = document.activeElement as HTMLElement;
      expect(file).toBe(item('app.ts'));
      key(file, 'ArrowLeft');
      expect(document.activeElement).toBe(folder);
    });

    it('selects a file with Enter or Space and toggles a folder', () => {
      render('worktree');
      const file = item('util.ts');
      file.focus();
      key(file, 'Enter');
      key(file, ' ');
      expect(selections).toEqual([
        { path: 'src/util.ts', staged: false },
        { path: 'src/util.ts', staged: false },
      ]);
      const changes = item('Changes');
      key(changes, 'Enter');
      expect(changes.getAttribute('aria-expanded')).toBe('false');
    });

    it('leaves keys typed on a row control to that control', () => {
      render('worktree');
      const row = item('util.ts');
      row.focus();
      fixture.detectChanges();
      const stage = row.querySelector(
        '[data-testid="tree-stage"]',
      ) as HTMLButtonElement;
      key(stage, 'ArrowDown');
      expect(document.activeElement).toBe(row);
    });

    it('puts only the focused row controls in the tab order, with Open-in', () => {
      render('worktree');
      const row = item('util.ts');
      row.focus();
      fixture.detectChanges();
      expect(
        (row.querySelector('[data-testid="tree-stage"]') as HTMLElement)
          .tabIndex,
      ).toBe(0);
      expect(
        (
          item('app.ts').querySelector(
            '[data-testid="tree-unstage"]',
          ) as HTMLElement
        ).tabIndex,
      ).toBe(-1);
      expect(
        row.querySelector('[data-testid="open-in-button"]'),
      ).not.toBeNull();
      expect(
        host().querySelectorAll('[data-testid="open-in-button"]'),
      ).toHaveLength(1);
    });

    it('steps to the next and previous file, expanding what hides it', () => {
      render('staged', { activePath: 'src/app.ts' });
      // Collapse the Changes section so the next file is hidden.
      item('Changes').click();
      fixture.detectChanges();
      expect(() => item('util.ts')).toThrow();
      component.selectAdjacentFile(1);
      fixture.detectChanges();
      // Folders sort before files, so the next file is src/util.ts.
      expect(selections).toEqual([{ path: 'src/util.ts', staged: false }]);
      expect(item('util.ts').tabIndex).toBe(0);

      fixture.componentRef.setInput('activePath', 'src/app.ts');
      fixture.detectChanges();
      component.selectAdjacentFile(-1);
      expect(selections).toHaveLength(1);
    });
  });

  describe('branch and historical comparisons', () => {
    it('lists review files read-only with a persisted Viewed mark in branch mode', () => {
      render('branch');
      expect(
        items().some((el) => el.dataset['testid'] === 'tree-row-section'),
      ).toBe(false);
      expect(host().querySelector('[data-testid="tree-stage"]')).toBeNull();
      expect(host().querySelector('[data-testid="tree-discard"]')).toBeNull();
      const readme = item('README.md');
      expect(readme.getAttribute('aria-level')).toBe('1');
      const checkbox = readme.querySelector(
        '[data-testid="tree-viewed"]',
      ) as HTMLInputElement;
      expect(checkbox.getAttribute('aria-label')).toBe('Viewed README.md');
      checkbox.click();
      fixture.detectChanges();
      expect(review.toggleViewed).toHaveBeenCalledWith('README.md');
      expect(checkbox.checked).toBe(true);
      expect(selections).toEqual([]);
    });

    it('selects a renamed file with its original path', () => {
      render('branch');
      item('new.ts').click();
      expect(selections).toEqual([
        { path: 'src/new.ts', originalPath: 'src/old.ts' },
      ]);
      expect(
        item('new.ts').querySelector('[id$="-name"]')?.getAttribute('title'),
      ).toBe('src/old.ts → src/new.ts');
    });

    it('offers neither Viewed nor Open-in for a historical comparison', () => {
      render('historical');
      const row = item('README.md');
      row.focus();
      fixture.detectChanges();
      expect(host().querySelector('[data-testid="tree-viewed"]')).toBeNull();
      expect(host().querySelector('[data-testid="open-in-button"]')).toBeNull();
    });

    it('filters by path and says when nothing matches', () => {
      render('branch', { filter: 'readme' });
      expect(items().map((el) => el.dataset['testid'])).toEqual([
        'tree-row-file',
      ]);
      fixture.componentRef.setInput('filter', 'zzz');
      fixture.detectChanges();
      expect(host().querySelector('[role="tree"]')).toBeNull();
      expect(
        host()
          .querySelector('[data-testid="changed-file-tree-empty"]')
          ?.textContent?.trim(),
      ).toBe('No files match the filter.');
    });

    it('says when the comparison has no files', () => {
      render('branch', { reviewFiles: [] });
      expect(
        host()
          .querySelector('[data-testid="changed-file-tree-empty"]')
          ?.textContent?.trim(),
      ).toBe('No files changed in this comparison.');
    });
  });

  describe('rail layout', () => {
    it('beside the diff: persisted width and a resize handle that writes through the layout service', () => {
      render('worktree');
      const panel = host().querySelector(
        '[data-testid="changed-file-tree"]',
      ) as HTMLElement;
      expect(panel.style.width).toBe('256px');
      const handle = host().querySelector('[role="separator"]') as HTMLElement;
      expect(handle.getAttribute('aria-valuemin')).toBe('160');
      expect(handle.getAttribute('aria-valuemax')).toBe('480');
      key(handle, 'ArrowRight');
      expect(layout.setGitRailWidth).toHaveBeenCalledWith(272);
      expect(layout.commitGitRailWidth).toHaveBeenCalled();
      expect(panel.style.width).toBe('272px');
    });

    it('stacked: full width, no resize handle', () => {
      render('worktree', { stacked: true });
      const panel = host().querySelector(
        '[data-testid="changed-file-tree"]',
      ) as HTMLElement;
      expect(panel.style.width).toBe('');
      expect(panel.className).toContain('w-full');
      expect(host().querySelector('[role="separator"]')).toBeNull();
    });

    it('collapsed: renders nothing', () => {
      railCollapsed.set(true);
      render('worktree');
      expect(host().querySelector('[role="tree"]')).toBeNull();
      expect(host().className).toContain('hidden');
    });
  });

  describe('accessibility', () => {
    it.each(['worktree', 'branch'] as const)(
      'has no axe violations (%s)',
      async (comparison) => {
        render(comparison);
        items()[0].focus();
        fixture.detectChanges();
        const results = await axe.run(host() as Parameters<typeof axe.run>[0], {
          rules: {
            'color-contrast': { enabled: false },
            'target-size': { enabled: false },
            'scrollable-region-focusable': { enabled: false },
          },
        });
        expect(
          results.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`,
          ),
        ).toEqual([]);
        const ran = [...results.passes, ...results.incomplete].map((r) => r.id);
        expect(ran).toEqual(
          expect.arrayContaining([
            'aria-required-children',
            'aria-required-parent',
            'aria-valid-attr-value',
          ]),
        );
      },
    );
  });
});
