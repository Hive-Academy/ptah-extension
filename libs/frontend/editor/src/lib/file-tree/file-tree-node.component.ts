import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import {
  LucideAngularModule,
  Folder,
  File,
  FileCode,
  FileJson,
  FileText,
  Hash,
  Globe,
  Palette,
} from 'lucide-angular';
import { FileTreeNode } from '../models/file-tree.model';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import { FileTreeInlineInputComponent } from './file-tree-inline-input.component';
import type { GitFileStatus } from '@ptah-extension/shared';

/**
 * FileTreeNodeComponent - Recursive tree node for file explorer.
 *
 * Complexity Level: 2 (Medium - recursive rendering, interactive state, lazy loading)
 * Patterns: Standalone component, signal-based state, recursive composition
 *
 * Renders a single file or directory node with:
 * - Indentation based on depth level
 * - Expand/collapse toggle for directories
 * - Lucide file/folder icons
 * - Active file highlighting
 * - Click-to-select for files, click-to-toggle for directories
 * - Lazy loading for directories at the depth boundary (needsLoad)
 * - Git status badges (M/A/D/??) with color coding via GitStatusService
 */
@Component({
  selector: 'ptah-file-tree-node',
  standalone: true,
  imports: [
    FileTreeNodeComponent,
    LucideAngularModule,
    FileTreeInlineInputComponent,
  ],
  template: `
    @if (isRenaming()) {
      <ptah-file-tree-inline-input
        [initialValue]="node().name"
        [depth]="depth()"
        (submitted)="onRenameSubmit($event)"
        (cancelled)="isRenaming.set(false)"
      />
    } @else {
      <div
        class="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer rounded text-sm select-none hover:bg-base-300 transition-colors"
        [class.bg-primary]="isActive()"
        [class.text-primary-content]="isActive()"
        [style.padding-left.px]="depth() * 16 + 8"
        (click)="onNodeClick()"
        (contextmenu)="onRightClick($event)"
        role="treeitem"
        [attr.aria-expanded]="node().type === 'directory' ? expanded() : null"
        [attr.aria-selected]="isActive()"
        [attr.aria-label]="node().name"
      >
        @if (node().type === 'directory') {
          <span class="text-xs w-4 text-center opacity-70 flex-shrink-0">{{
            expanded() ? '&#9660;' : '&#9654;'
          }}</span>
          <lucide-angular
            [img]="FolderIcon"
            class="w-4 h-4 flex-shrink-0 text-amber-500"
            aria-hidden="true"
          />
        } @else {
          <span class="w-4 flex-shrink-0"></span>
          <lucide-angular
            [img]="getFileIcon()"
            [class]="'w-4 h-4 flex-shrink-0 ' + getFileIconColor()"
            aria-hidden="true"
          />
        }
        <span class="truncate" [class]="fileNameColor()">{{
          node().name
        }}</span>
        @if (nodeGitStatus()) {
          <span
            class="ml-auto text-[10px] font-mono flex-shrink-0"
            [class]="gitStatusColor()"
            [title]="gitStatusTitle()"
            aria-hidden="true"
            >{{ gitStatusLabel() }}</span
          >
        }
        @if (hasChangedChildren()) {
          <span
            class="w-1.5 h-1.5 rounded-full bg-warning ml-auto flex-shrink-0"
            title="Contains changes"
          ></span>
        }
        @if (isLoadingChildren()) {
          <span class="loading loading-spinner loading-xs ml-auto"></span>
        }
      </div>
    }
    @if (node().type === 'directory' && expanded()) {
      @if (creatingType()) {
        <ptah-file-tree-inline-input
          [depth]="depth() + 1"
          (submitted)="onCreateSubmit($event)"
          (cancelled)="creatingType.set(null)"
        />
      }
      @for (child of sortedChildren(); track child.path) {
        <ptah-file-tree-node
          [node]="child"
          [depth]="depth() + 1"
          [activeFilePath]="activeFilePath()"
          (fileClicked)="fileClicked.emit($event)"
          (contextMenuRequested)="contextMenuRequested.emit($event)"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeNodeComponent {
  private readonly editorService = inject(EditorService);
  private readonly gitStatus = inject(GitStatusService);

  readonly node = input.required<FileTreeNode>();
  readonly depth = input<number>(0);
  readonly activeFilePath = input<string | undefined>(undefined);

  readonly fileClicked = output<string>();
  readonly contextMenuRequested = output<{
    event: MouseEvent;
    node: FileTreeNode;
  }>();

  readonly expanded = signal(false);
  readonly isLoadingChildren = signal(false);
  readonly isRenaming = signal(false);
  readonly creatingType = signal<'file' | 'folder' | null>(null);

  /**
   * Look up the git status for this node by converting its absolute path
   * to a relative path (stripping the workspace root prefix) and checking
   * the fileStatusMap.
   *
   * Git status paths from `git status --porcelain=v2` are relative to the repo root
   * (e.g., "src/services/foo.ts"). File tree node paths are absolute
   * (e.g., "D:/projects/ptah-extension/src/services/foo.ts").
   * We strip the workspace root prefix to derive the relative path for lookup.
   *
   * fileStatusMap returns an array of GitFileStatus entries per path because a file
   * can have both staged and unstaged changes. We prefer the staged entry for the
   * badge display (staged changes are more significant in the tree view), falling
   * back to the first entry if no staged entry exists.
   */
  readonly nodeGitStatus = computed((): GitFileStatus | undefined => {
    const absolutePath = this.node().path;
    const workspaceRoot = this.gitStatus.activeWorkspacePath;
    if (!workspaceRoot) return undefined;

    // Normalize both to forward slashes for consistent comparison
    const normalizedPath = absolutePath.replace(/\\/g, '/');
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');

    // Strip workspace root prefix + trailing slash to get relative path
    const rootWithSlash = normalizedRoot.endsWith('/')
      ? normalizedRoot
      : normalizedRoot + '/';

    if (!normalizedPath.startsWith(rootWithSlash)) return undefined;

    const relativePath = normalizedPath.slice(rootWithSlash.length);

    // Get all entries for this path (may include both staged and unstaged)
    const entries = this.gitStatus.fileStatusMap().get(relativePath);
    if (!entries || entries.length === 0) return undefined;

    // Prefer staged entry for the badge (staged changes are more significant)
    return entries.find((e) => e.staged) ?? entries[0];
  });

  /**
   * CSS class for git status badge color coding.
   * M=warning (modified), A=success (added), D=error (deleted),
   * ??=info (untracked), default=muted.
   */
  private static readonly STATUS_LABELS: Record<string, string> = {
    M: 'M',
    A: 'A',
    D: 'D',
    R: 'R',
    C: 'C',
    '??': 'U',
    '!': 'I',
  };

  private static readonly STATUS_TITLES: Record<string, string> = {
    M: 'Modified',
    A: 'Added',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    '??': 'Untracked',
    '!': 'Ignored',
  };

  readonly gitStatusLabel = computed((): string => {
    const status = this.nodeGitStatus();
    if (!status) return '';
    return FileTreeNodeComponent.STATUS_LABELS[status.status] ?? status.status;
  });

  readonly gitStatusTitle = computed((): string => {
    const status = this.nodeGitStatus();
    if (!status) return '';
    return FileTreeNodeComponent.STATUS_TITLES[status.status] ?? status.status;
  });

  readonly gitStatusColor = computed((): string => {
    const status = this.nodeGitStatus();
    if (!status) return '';
    switch (status.status) {
      case 'M':
        return 'text-warning';
      case 'A':
        return 'text-success';
      case 'D':
        return 'text-error';
      case '??':
        return 'text-info';
      default:
        return 'text-base-content/50';
    }
  });

  /**
   * CSS class for coloring the entire filename based on git status.
   * Applied to files only (directories use hasChangedChildren dot instead).
   * Deleted files also get a line-through decoration.
   */
  readonly fileNameColor = computed((): string => {
    const status = this.nodeGitStatus();
    if (!status) return '';
    switch (status.status) {
      case 'M':
        return 'text-warning';
      case 'A':
        return 'text-success';
      case 'D':
        return 'text-error line-through';
      case '??':
        return 'text-success';
      default:
        return '';
    }
  });

  /**
   * Whether this directory contains any files with git changes.
   * Used to show a small dot indicator on directories that have modified children.
   * Only applies to directory nodes.
   */
  readonly hasChangedChildren = computed((): boolean => {
    if (this.node().type !== 'directory') return false;
    const nodePath = this.node().path.replace(/\\/g, '/');
    const workspaceRoot = this.gitStatus.activeWorkspacePath;
    if (!workspaceRoot) return false;

    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    const rootWithSlash = normalizedRoot.endsWith('/')
      ? normalizedRoot
      : normalizedRoot + '/';
    const relativeDirPath = nodePath.startsWith(rootWithSlash)
      ? nodePath.slice(rootWithSlash.length)
      : '';
    if (!relativeDirPath) return false;

    const dirPrefix = relativeDirPath + '/';
    for (const key of this.gitStatus.fileStatusMap().keys()) {
      if (key.startsWith(dirPrefix)) return true;
    }
    return false;
  });

  // Lucide icons
  readonly FolderIcon = Folder;
  private readonly FileIcon = File;
  private readonly FileCodeIcon = FileCode;
  private readonly FileJsonIcon = FileJson;
  private readonly FileTextIcon = FileText;
  private readonly HashIcon = Hash;
  private readonly GlobeIcon = Globe;
  private readonly PaletteIcon = Palette;

  protected isActive(): boolean {
    return (
      this.node().type === 'file' && this.node().path === this.activeFilePath()
    );
  }

  protected sortedChildren(): FileTreeNode[] {
    const children = this.node().children;
    if (!children) return [];
    return [...children].sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });
  }

  protected async onNodeClick(): Promise<void> {
    if (this.node().type === 'directory') {
      const wasExpanded = this.expanded();
      this.expanded.update((v) => !v);

      // Lazy load children if this directory needs loading and is being expanded
      if (!wasExpanded && this.node().needsLoad) {
        this.isLoadingChildren.set(true);
        await this.editorService.loadDirectoryChildren(this.node().path);
        this.isLoadingChildren.set(false);
      }
    } else {
      this.fileClicked.emit(this.node().path);
    }
  }

  protected onRightClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuRequested.emit({ event, node: this.node() });
  }

  /** Start rename mode — called externally via the context menu action. */
  startRename(): void {
    this.isRenaming.set(true);
  }

  /** Start creating a new file/folder inside this directory — called externally. */
  startCreate(type: 'file' | 'folder'): void {
    if (this.node().type === 'directory') {
      this.expanded.set(true);
      this.creatingType.set(type);
    }
  }

  protected onRenameSubmit(newName: string): void {
    this.isRenaming.set(false);
    const currentPath = this.node().path.replace(/\\/g, '/');
    const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
    const newPath = parentPath + '/' + newName;
    if (newPath !== currentPath) {
      void this.editorService.renameItem(currentPath, newPath);
    }
  }

  protected onCreateSubmit(name: string): void {
    const type = this.creatingType();
    this.creatingType.set(null);
    const dirPath = this.node().path.replace(/\\/g, '/');
    const newPath = dirPath + '/' + name;
    if (type === 'file') {
      void this.editorService.createFile(newPath);
    } else if (type === 'folder') {
      void this.editorService.createFolder(newPath);
    }
  }

  protected getFileIcon(): typeof File {
    const name = this.node().name;
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
      case 'py':
      case 'rb':
      case 'rs':
      case 'go':
      case 'java':
      case 'c':
      case 'cpp':
      case 'cs':
      case 'php':
      case 'swift':
      case 'kt':
      case 'dart':
      case 'lua':
      case 'sh':
      case 'bash':
        return this.FileCodeIcon;
      case 'json':
        return this.FileJsonIcon;
      case 'md':
      case 'txt':
      case 'log':
        return this.FileTextIcon;
      case 'html':
      case 'htm':
        return this.GlobeIcon;
      case 'css':
      case 'scss':
      case 'less':
        return this.PaletteIcon;
      case 'yaml':
      case 'yml':
      case 'toml':
      case 'ini':
      case 'cfg':
      case 'env':
        return this.HashIcon;
      default:
        return this.FileIcon;
    }
  }

  protected getFileIconColor(): string {
    const name = this.node().name;
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'text-blue-400';
      case 'js':
      case 'jsx':
        return 'text-yellow-400';
      case 'json':
        return 'text-green-400';
      case 'html':
      case 'htm':
        return 'text-orange-400';
      case 'css':
      case 'scss':
      case 'less':
        return 'text-pink-400';
      case 'md':
        return 'text-gray-400';
      case 'py':
        return 'text-green-300';
      default:
        return 'text-gray-500';
    }
  }
}
