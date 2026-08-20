/**
 * FileTreeNodeComponent specs — auto-load effect, click toggle, create-submit.
 *
 * Coverage:
 *   - Auto-loads children when expanded + needsLoad via the constructor effect
 *   - Does NOT double-load if isLoadingChildren is already true
 *   - onNodeClick toggles expanded for directory nodes (regression guard)
 *   - onCreateSubmit calls editorService.createFile for type=file
 *
 * EditorService and GitStatusService are stubbed at the TestBed boundary.
 * The test setup is Zone-based (jest-preset-angular setupZoneTestEnv) — calling
 * `fixture.detectChanges()` flushes signal effects.
 */

import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import type { ComponentRef } from '@angular/core';
import { FileTreeNodeComponent } from './file-tree-node.component';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import type { FileTreeNode } from '../models/file-tree.model';

function dirNode(
  overrides: Partial<FileTreeNode> & { path: string; name: string },
): FileTreeNode {
  return {
    name: overrides.name,
    path: overrides.path,
    type: 'directory',
    needsLoad: overrides.needsLoad,
    children: overrides.children ?? [],
    expanded: overrides.expanded,
  };
}

describe('FileTreeNodeComponent', () => {
  let editorMock: {
    loadDirectoryChildren: jest.Mock<Promise<void>, [string]>;
    createFile: jest.Mock<Promise<boolean>, [string]>;
    createFolder: jest.Mock<Promise<boolean>, [string]>;
    renameItem: jest.Mock<Promise<boolean>, [string, string]>;
  };
  let gitStatusMock: {
    activeWorkspacePath: ReturnType<typeof signal<string | null>>;
    fileStatusMap: ReturnType<typeof signal<Map<string, unknown[]>>>;
    changedDirPrefixes: ReturnType<typeof signal<ReadonlySet<string>>>;
  };

  beforeEach(async () => {
    editorMock = {
      loadDirectoryChildren: jest.fn().mockResolvedValue(undefined),
      createFile: jest.fn().mockResolvedValue(true),
      createFolder: jest.fn().mockResolvedValue(true),
      renameItem: jest.fn().mockResolvedValue(true),
    };

    gitStatusMock = {
      activeWorkspacePath: signal<string | null>(null),
      fileStatusMap: signal<Map<string, unknown[]>>(new Map()),
      changedDirPrefixes: signal<ReadonlySet<string>>(new Set<string>()),
    };

    await TestBed.configureTestingModule({
      imports: [FileTreeNodeComponent],
      providers: [
        { provide: EditorService, useValue: editorMock },
        { provide: GitStatusService, useValue: gitStatusMock },
      ],
    }).compileComponents();
  });

  function createFixture(node: FileTreeNode): {
    fixture: ComponentFixture<FileTreeNodeComponent>;
    component: FileTreeNodeComponent;
    componentRef: ComponentRef<FileTreeNodeComponent>;
  } {
    const fixture = TestBed.createComponent(FileTreeNodeComponent);
    fixture.componentRef.setInput('node', node);
    fixture.componentRef.setInput('depth', 0);
    fixture.componentRef.setInput('activeFilePath', undefined);
    return {
      fixture,
      component: fixture.componentInstance,
      componentRef: fixture.componentRef,
    };
  }

  // -------------------------------------------------------------------------
  // Auto-load effect
  // -------------------------------------------------------------------------

  it('auto-loads children when an expanded directory has needsLoad: true', async () => {
    const node = dirNode({
      name: 'pkg',
      path: '/ws/pkg',
      needsLoad: true,
      children: [],
    });
    const { fixture, component } = createFixture(node);
    fixture.detectChanges();

    // Initially not expanded — effect predicate fails, no load yet
    expect(editorMock.loadDirectoryChildren).not.toHaveBeenCalled();

    // Expand the node — effect should fire on the next CD pass
    component.expanded.set(true);
    fixture.detectChanges();

    expect(editorMock.loadDirectoryChildren).toHaveBeenCalledTimes(1);
    expect(editorMock.loadDirectoryChildren).toHaveBeenCalledWith('/ws/pkg');

    // Allow the .finally() to flip isLoadingChildren back so we don't leak state
    await Promise.resolve();
  });

  it('does not double-load when isLoadingChildren is already true', () => {
    const node = dirNode({
      name: 'pkg',
      path: '/ws/pkg',
      needsLoad: true,
      children: [],
    });
    const { fixture, component } = createFixture(node);
    fixture.detectChanges();

    // Mark loading BEFORE expanding so the effect's predicate (`!isLoadingChildren()`)
    // short-circuits.
    component.isLoadingChildren.set(true);
    component.expanded.set(true);
    fixture.detectChanges();

    expect(editorMock.loadDirectoryChildren).not.toHaveBeenCalled();
  });

  it('does not auto-load when needsLoad is false (already loaded)', () => {
    const node = dirNode({
      name: 'pkg',
      path: '/ws/pkg',
      needsLoad: false,
      children: [{ name: 'a.ts', path: '/ws/pkg/a.ts', type: 'file' }],
    });
    const { fixture, component } = createFixture(node);
    fixture.detectChanges();

    component.expanded.set(true);
    fixture.detectChanges();

    expect(editorMock.loadDirectoryChildren).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // onNodeClick — directory toggles expanded
  // -------------------------------------------------------------------------

  it('onNodeClick toggles expanded for directory nodes', async () => {
    const node = dirNode({
      name: 'pkg',
      path: '/ws/pkg',
      needsLoad: false,
      children: [],
    });
    const { fixture, component } = createFixture(node);
    fixture.detectChanges();

    expect(component.expanded()).toBe(false);

    // Cast to access protected method
    await (
      component as unknown as { onNodeClick(): Promise<void> }
    ).onNodeClick();
    expect(component.expanded()).toBe(true);

    await (
      component as unknown as { onNodeClick(): Promise<void> }
    ).onNodeClick();
    expect(component.expanded()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // onCreateSubmit — type=file routes to createFile
  // -------------------------------------------------------------------------

  it('onCreateSubmit calls editorService.createFile when creatingType is "file"', () => {
    const node = dirNode({
      name: 'pkg',
      path: '/ws/pkg',
      needsLoad: false,
      children: [],
    });
    const { fixture, component } = createFixture(node);
    fixture.detectChanges();

    component.creatingType.set('file');
    (
      component as unknown as { onCreateSubmit(name: string): void }
    ).onCreateSubmit('new.ts');

    expect(editorMock.createFile).toHaveBeenCalledTimes(1);
    expect(editorMock.createFile).toHaveBeenCalledWith('/ws/pkg/new.ts');
    expect(editorMock.createFolder).not.toHaveBeenCalled();
    expect(component.creatingType()).toBeNull();
  });

  it('onCreateSubmit calls editorService.createFolder when creatingType is "folder"', () => {
    const node = dirNode({
      name: 'pkg',
      path: '/ws/pkg',
      needsLoad: false,
      children: [],
    });
    const { fixture, component } = createFixture(node);
    fixture.detectChanges();

    component.creatingType.set('folder');
    (
      component as unknown as { onCreateSubmit(name: string): void }
    ).onCreateSubmit('subdir');

    expect(editorMock.createFolder).toHaveBeenCalledTimes(1);
    expect(editorMock.createFolder).toHaveBeenCalledWith('/ws/pkg/subdir');
    expect(editorMock.createFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // hasChangedChildren — O(1) directory indicator (B3, TASK_2026_173)
  //
  // This used to scan every key of `fileStatusMap` per directory node, so a
  // status update cost O(changed files × directory nodes). It is now a single
  // `Set.has` against GitStatusService.changedDirPrefixes.
  // -------------------------------------------------------------------------

  describe('hasChangedChildren (B3)', () => {
    const WS = 'C:/ws';

    beforeEach(() => {
      gitStatusMock.activeWorkspacePath.set(WS);
    });

    it('marks a directory whose relative path is in the prefix set (AC3)', () => {
      gitStatusMock.changedDirPrefixes.set(new Set(['src', 'src/app']));
      const { component } = createFixture(
        dirNode({ name: 'app', path: `${WS}/src/app` }),
      );

      expect(component.hasChangedChildren()).toBe(true);
    });

    it('does NOT mark a directory that is absent from the set (AC3, negative)', () => {
      gitStatusMock.changedDirPrefixes.set(new Set(['src', 'src/app']));
      const { component } = createFixture(
        dirNode({ name: 'vendor', path: `${WS}/vendor` }),
      );

      expect(component.hasChangedChildren()).toBe(false);
    });

    it('does not mark a sibling that merely shares a name prefix (AC3, negative)', () => {
      // `src/app` in the set must not light up `src/app-legacy`.
      gitStatusMock.changedDirPrefixes.set(new Set(['src', 'src/app']));
      const { component } = createFixture(
        dirNode({ name: 'app-legacy', path: `${WS}/src/app-legacy` }),
      );

      expect(component.hasChangedChildren()).toBe(false);
    });

    it('never marks a file node', () => {
      gitStatusMock.changedDirPrefixes.set(new Set(['src', 'src/app']));
      const fixture = TestBed.createComponent(FileTreeNodeComponent);
      fixture.componentRef.setInput('node', {
        name: 'app',
        path: `${WS}/src/app`,
        type: 'file',
      } as FileTreeNode);
      fixture.componentRef.setInput('depth', 0);

      expect(fixture.componentInstance.hasChangedChildren()).toBe(false);
    });

    it('resolves a Windows-separator node path against the normalized set (AC5)', () => {
      gitStatusMock.changedDirPrefixes.set(new Set(['src', 'src/app']));
      const { component } = createFixture(
        dirNode({ name: 'app', path: 'C:\\ws\\src\\app' }),
      );

      expect(component.hasChangedChildren()).toBe(true);
    });

    it('returns false when there is no active workspace', () => {
      gitStatusMock.activeWorkspacePath.set(null);
      gitStatusMock.changedDirPrefixes.set(new Set(['src']));
      const { component } = createFixture(
        dirNode({ name: 'src', path: `${WS}/src` }),
      );

      expect(component.hasChangedChildren()).toBe(false);
    });

    it('evaluates in constant time: one Set.has, zero fileStatusMap iteration (AC2)', () => {
      // 50k changed directories and 50k status entries. The old implementation
      // walked every map key for THIS one node; the new one asks the set once.
      const prefixes = new Set<string>();
      const statusMap = new Map<string, unknown[]>();
      for (let i = 0; i < 50_000; i++) {
        prefixes.add(`noise${i}`);
        statusMap.set(`noise${i}/file.ts`, []);
      }
      prefixes.add('src');
      prefixes.add('src/app');

      const hasSpy = jest.spyOn(prefixes, 'has');
      const keysSpy = jest.spyOn(statusMap, 'keys');

      gitStatusMock.changedDirPrefixes.set(prefixes);
      gitStatusMock.fileStatusMap.set(statusMap);

      const { component } = createFixture(
        dirNode({ name: 'app', path: `${WS}/src/app` }),
      );

      expect(component.hasChangedChildren()).toBe(true);
      expect(hasSpy).toHaveBeenCalledTimes(1);
      expect(hasSpy).toHaveBeenCalledWith('src/app');
      expect(keysSpy).not.toHaveBeenCalled();

      hasSpy.mockRestore();
      keysSpy.mockRestore();
    });
  });
});
