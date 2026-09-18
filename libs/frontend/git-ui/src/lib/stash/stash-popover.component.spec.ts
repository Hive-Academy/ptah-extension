import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitStashFileEntry, StashEntry } from '@ptah-extension/shared';
import { GitStashService } from '../services/git-stash.service';
import { GitStatusService } from '../services/git-status.service';
import { StashPopoverComponent, stashAge } from './stash-popover.component';

describe('StashPopoverComponent', () => {
  let fixture: ComponentFixture<StashPopoverComponent>;
  const activeWorkspace = signal<string | null>('/ws/a');
  const stash = {
    entries: signal<StashEntry[]>([]),
    listLoading: signal(false),
    selectedIndex: signal<number | null>(null),
    files: signal<GitStashFileEntry[]>([]),
    filesLoading: signal(false),
    busy: signal(false),
    error: signal<string | null>(null),
    loadList: jest.fn(async () => undefined),
    select: jest.fn(async () => undefined),
    mutate: jest.fn(async () => ({ success: true })),
    openFileDiff: jest.fn(async () => undefined),
  };

  const el = (id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement;

  beforeEach(() => {
    jest.clearAllMocks();
    activeWorkspace.set('/ws/a');
    stash.entries.set([
      {
        index: 0,
        hash: '0123456789abcdef',
        message: 'WIP on main: tidy',
        branch: 'main',
      },
    ]);
    stash.selectedIndex.set(null);
    stash.files.set([]);
    stash.busy.set(false);
    stash.error.set(null);
    TestBed.configureTestingModule({
      imports: [StashPopoverComponent],
      providers: [
        { provide: GitStashService, useValue: stash },
        {
          provide: GitStatusService,
          useValue: { activeWorkspacePath: activeWorkspace.asReadonly() },
        },
      ],
    });
    fixture = TestBed.createComponent(StashPopoverComponent);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  });

  it('loads and lists entries when opened', () => {
    expect(stash.loadList).toHaveBeenCalled();
    const entry = el('stash-entry');
    expect(entry.textContent).toContain('stash@{0}');
    expect(entry.textContent).toContain('WIP on main: tidy');
    expect(entry.textContent).toContain('on main');
  });

  it('shows an empty state', () => {
    stash.entries.set([]);
    fixture.detectChanges();
    expect(el('stash-empty')).not.toBeNull();
  });

  it('selects an entry and opens a file diff', () => {
    el('stash-entry').click();
    expect(stash.select).toHaveBeenCalledWith(stash.entries()[0]);

    stash.selectedIndex.set(0);
    stash.files.set([{ path: 'src/a.ts', status: 'M' }]);
    fixture.detectChanges();
    el('stash-file').click();
    expect(stash.openFileDiff).toHaveBeenCalledWith({
      path: 'src/a.ts',
      status: 'M',
    });
  });

  it('applies and pops directly', () => {
    el('stash-apply').click();
    el('stash-pop').click();
    expect(stash.mutate).toHaveBeenNthCalledWith(
      1,
      'apply',
      stash.entries()[0],
    );
    expect(stash.mutate).toHaveBeenNthCalledWith(2, 'pop', stash.entries()[0]);
  });

  it('requires an inline confirmation before dropping', () => {
    el('stash-drop').click();
    fixture.detectChanges();
    expect(stash.mutate).not.toHaveBeenCalled();
    el('stash-drop-confirm').click();
    expect(stash.mutate).toHaveBeenCalledWith('drop', stash.entries()[0]);
  });

  it('adds contextual labels to stash actions', () => {
    expect(el('stash-apply').getAttribute('aria-label')).toBe(
      'Apply stash@{0}',
    );
    expect(el('stash-pop').getAttribute('aria-label')).toBe('Pop stash@{0}');
    expect(el('stash-drop').getAttribute('aria-label')).toBe('Drop stash@{0}');
    el('stash-drop').click();
    fixture.detectChanges();
    expect(el('stash-drop-confirm').getAttribute('aria-label')).toBe(
      'Confirm drop stash@{0}',
    );
  });

  it('disables entry and file actions while a mutation is busy', () => {
    stash.selectedIndex.set(0);
    stash.files.set([{ path: 'src/a.ts', status: 'M' }]);
    stash.busy.set(true);
    fixture.detectChanges();

    expect((el('stash-entry') as HTMLButtonElement).disabled).toBe(true);
    expect((el('stash-file') as HTMLButtonElement).disabled).toBe(true);
  });

  it('resets drop confirmation when the popover open state changes', () => {
    el('stash-drop').click();
    fixture.detectChanges();
    expect(el('stash-drop-confirm')).not.toBeNull();

    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    expect(el('stash-drop-confirm')).toBeNull();
  });

  it('resets drop confirmation when the stash entries change', () => {
    el('stash-drop').click();
    fixture.detectChanges();
    expect(el('stash-drop-confirm')).not.toBeNull();

    stash.entries.set([
      {
        index: 0,
        hash: 'changed-hash-1111',
        message: 'different stash',
        branch: 'main',
      },
    ]);
    fixture.detectChanges();

    expect(el('stash-drop-confirm')).toBeNull();
  });

  it('resets drop confirmation when the active workspace changes', () => {
    el('stash-drop').click();
    fixture.detectChanges();
    expect(el('stash-drop-confirm')).not.toBeNull();

    activeWorkspace.set('/ws/b');
    fixture.detectChanges();

    expect(el('stash-drop-confirm')).toBeNull();
  });

  it('emits closed on an outside click', () => {
    const closed = jest.fn();
    fixture.componentInstance.closed.subscribe(closed);
    document.body.click();
    expect(closed).toHaveBeenCalled();
  });

  it('formats a coarse age', () => {
    const now = 10 * 24 * 3_600_000;
    expect(stashAge(undefined, now)).toBe('');
    expect(stashAge(now - 30_000, now)).toBe('just now');
    expect(stashAge(now - 5 * 60_000, now)).toBe('5m ago');
    expect(stashAge(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(stashAge(now - 2 * 24 * 3_600_000, now)).toBe('2d ago');
  });
});
