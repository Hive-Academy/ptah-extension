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
});
