import {
  Component,
  input,
  output,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  Check,
  CircleAlert,
  X,
} from 'lucide-angular';
import type { RpcCallResult } from '@ptah-extension/core';
import { GIT_LOCKED_MESSAGE } from '@ptah-extension/shared';
import type {
  EditorTarget,
  GitCommitResult,
  GitFileStatus,
  GitMutationFailureCode,
  GitStatusUnavailableReason,
} from '@ptah-extension/shared';
import type { OpenInRequest } from '../open-in/open-in-button.component';
import type { OpenDiffRequest } from '../types/diff-tab.types';
import { SourceControlService } from '../services/source-control.service';
import { GitStatusService } from '../services/git-status.service';
import { SourceControlFileComponent } from './source-control-file.component';
import { WorktreeSectionComponent } from '../worktree/worktree-section.component';

/** Wording for each reason a status read failed, completing "Git status is unavailable (…)". */
const STATUS_UNAVAILABLE_LABELS: Readonly<
  Record<GitStatusUnavailableReason, string>
> = {
  'output-too-large': 'the status output is too large to read',
  timeout: 'git timed out',
  locked: 'another git process is using this repository',
  error: 'git reported an error',
};

/** Human wording for a status-unavailable reason; shared with the dock. */
export function statusUnavailableLabel(
  reason: GitStatusUnavailableReason,
): string {
  return STATUS_UNAVAILABLE_LABELS[reason];
}

/** The fields every git mutation result (stage, unstage, discard, commit) shares. */
interface GitMutationOutcome {
  readonly success: boolean;
  readonly error?: string;
  readonly code?: GitMutationFailureCode;
}

type SourceControlSection = 'staged' | 'unstaged';

/** Text for a call that never produced a git result (IPC failure, renderer timeout, throw). */
function transportFailureText(detail: string | undefined): string {
  return `Could not reach git: ${detail || 'the request failed'}`;
}

/**
 * Why a mutation failed, or null when git reports success. A transport
 * failure is reported as one — never read as git success (TASK_2026_576 RC1).
 * A held repository lock always reads as `GIT_LOCKED_MESSAGE`, never as the
 * backend's raw stderr.
 */
function mutationFailureText(
  result: RpcCallResult<GitMutationOutcome>,
): string | null {
  if (!result.success) return transportFailureText(result.error);
  const data = result.data;
  if (!data) return 'Git returned no result.';
  if (data.success) return null;
  if (data.code === 'LOCKED') return GIT_LOCKED_MESSAGE;
  return data.error || 'The git operation failed.';
}

function thrownFailureText(error: unknown): string {
  return transportFailureText(
    error instanceof Error ? error.message : String(error),
  );
}

/** The outcome of the last commit, pinned to the workspace it ran in. */
type CommitFeedback =
  | {
      readonly kind: 'success';
      readonly workspaceRoot: string;
      readonly hash?: string;
      readonly subject?: string;
    }
  | {
      readonly kind: 'failure';
      readonly workspaceRoot: string;
      readonly text: string;
      /** Hook stdout + stderr, verbatim, when the backend returned any. */
      readonly hookOutput?: string;
    };

function commitFeedbackFor(
  result: RpcCallResult<GitCommitResult>,
  workspaceRoot: string,
): CommitFeedback {
  const failure = mutationFailureText(result);
  const data = result.data;
  if (failure === null && data) {
    return {
      kind: 'success',
      workspaceRoot,
      hash: data.commitHash,
      subject: data.subject,
    };
  }
  const hookOutput = result.success ? data?.hookOutput : undefined;
  return {
    kind: 'failure',
    workspaceRoot,
    text: failure ?? 'The commit failed.',
    ...(hookOutput && hookOutput.trim() ? { hookOutput } : {}),
  };
}

interface GitFileTreeFileNode {
  readonly kind: 'file';
  readonly key: string;
  readonly file: GitFileStatus;
}

interface GitFileTreeFolderNode {
  readonly kind: 'folder';
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly children: GitFileTreeNode[];
}

type GitFileTreeNode = GitFileTreeFileNode | GitFileTreeFolderNode;

interface GitFileTreeFolderBuilder extends GitFileTreeFolderNode {
  readonly foldersByName: Map<string, GitFileTreeFolderBuilder>;
}

function buildFileTree(files: readonly GitFileStatus[]): GitFileTreeNode[] {
  const root: GitFileTreeNode[] = [];
  const rootFolders = new Map<string, GitFileTreeFolderBuilder>();

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const folderParts = file.isDirectory ? parts : parts.slice(0, -1);
    let children = root;
    let foldersByName = rootFolders;
    let parentPath = '';

    for (const name of folderParts) {
      const path = parentPath ? `${parentPath}/${name}` : name;
      let folder = foldersByName.get(name);
      if (!folder) {
        folder = {
          kind: 'folder',
          key: `folder:${path}`,
          name,
          path,
          children: [],
          foldersByName: new Map<string, GitFileTreeFolderBuilder>(),
        };
        foldersByName.set(name, folder);
        children.push(folder);
      }
      children = folder.children;
      foldersByName = folder.foldersByName;
      parentPath = path;
    }

    if (!file.isDirectory) {
      children.push({ kind: 'file', key: `file:${file.path}`, file });
    }
  }
  return root;
}

/**
 * SourceControlPanelComponent - Main source control panel with commit UI and file groups.
 *
 * Complexity Level: 2 (Medium - service injection, computed signals, commit workflow)
 * Patterns: Standalone, OnPush, signal-based, facade service delegation
 *
 * Layout (top to bottom):
 * 1. Commit message textarea + commit button
 * 2. Collapsible "Staged Changes (N)" section
 * 3. Collapsible "Changes (N)" section
 *
 * Every stage/unstage/discard/commit result is awaited and checked
 * (TASK_2026_576 RC1): a failure shows as a dismissible error on the row or
 * section it came from, a failed commit keeps the message and shows the hook
 * output, and `GitStatusService.refresh()` runs after every mutation — the
 * VS Code and CLI hosts have no `.git` watcher to push the new state.
 *
 * When the latest status read failed but an earlier one succeeded, the lists
 * keep that earlier data, marked stale (RC3). Only without earlier data are
 * the lists replaced by the unavailable notice.
 */
@Component({
  selector: 'ptah-source-control-panel',
  standalone: true,
  imports: [
    FormsModule,
    NgTemplateOutlet,
    LucideAngularModule,
    SourceControlFileComponent,
    WorktreeSectionComponent,
  ],
  template: `
    <div
      class="flex flex-col h-full overflow-y-auto scrollbar-thin"
      role="region"
      aria-label="Source Control"
    >
      <!-- Commit area -->
      <div class="p-2 border-b border-base-300 flex-shrink-0">
        <textarea
          class="textarea textarea-bordered textarea-xs w-full resize-none"
          rows="3"
          placeholder="Commit message"
          aria-label="Commit message"
          [(ngModel)]="commitMessage"
          [disabled]="isCommitting()"
        ></textarea>
        <button
          class="btn btn-primary btn-xs w-full mt-1"
          [disabled]="!canCommit"
          (click)="onCommit()"
        >
          @if (isCommitting()) {
            <span class="loading loading-spinner loading-xs"></span>
            Committing...
          } @else {
            Commit ({{ stagedFiles().length }})
          }
        </button>
        @if (commitFeedback(); as feedback) {
          @if (feedback.kind === 'success') {
            <div
              role="status"
              data-testid="git-commit-success"
              class="flex items-center gap-1 mt-1 text-xs text-base-content min-w-0"
            >
              <lucide-angular
                [img]="CheckIcon"
                class="w-3 h-3 flex-shrink-0 text-success"
                aria-hidden="true"
              />
              <span class="flex-1 min-w-0 truncate"
                >Committed
                @if (feedback.hash) {
                  <span class="font-mono">{{ feedback.hash }}</span>
                }
                @if (feedback.subject) {
                  {{ feedback.subject }}
                }
              </span>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square p-0 w-6 h-6 min-h-6 flex-shrink-0
                       focus-visible:outline focus-visible:outline-2
                       focus-visible:outline-offset-[-2px]
                       focus-visible:outline-[oklch(var(--s))]"
                aria-label="Dismiss commit result"
                (click)="dismissCommitFeedback()"
              >
                <lucide-angular [img]="DismissIcon" class="w-3 h-3" />
              </button>
            </div>
          } @else {
            <div
              class="flex flex-col gap-1 mt-1"
              data-testid="git-commit-failure"
            >
              <!-- text-base-content on the error tint: text-error on base
                   fails AA in both themes (design-spec §0, stale-hunk chip). -->
              <div
                role="alert"
                class="flex items-start gap-1 px-1.5 py-1 rounded text-xs
                       text-base-content bg-error/10 border border-error/60"
              >
                <lucide-angular
                  [img]="ErrorIcon"
                  class="w-3 h-3 mt-0.5 flex-shrink-0 text-error"
                  aria-hidden="true"
                />
                <span class="flex-1 min-w-0 break-words"
                  >Commit failed: {{ feedback.text }} Your message was
                  kept.</span
                >
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square p-0 w-6 h-6 min-h-6 flex-shrink-0
                         focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-[-2px]
                         focus-visible:outline-[oklch(var(--s))]"
                  aria-label="Dismiss commit error"
                  (click)="dismissCommitFeedback()"
                >
                  <lucide-angular [img]="DismissIcon" class="w-3 h-3" />
                </button>
              </div>
              @if (feedback.hookOutput) {
                <!-- tabindex="0" makes the capped log keyboard-scrollable. -->
                <pre
                  role="log"
                  tabindex="0"
                  aria-label="Commit hook output"
                  data-testid="git-commit-hook-output"
                  class="m-0 p-2 rounded bg-base-300/50 font-mono text-[11px]
                         text-base-content max-h-48 overflow-y-auto
                         whitespace-pre-wrap break-words
                         focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-offset-[-2px]
                         focus-visible:outline-[oklch(var(--s))]"
                  >{{ feedback.hookOutput }}</pre>
              }
            </div>
          }
        }
      </div>

      @if (statusUnavailable() && !staleReason()) {
        <!-- The status could not be read and there is no earlier good read
             to fall back on (TASK_2026_437, TASK_2026_576 RC3). An empty file
             list here means nothing was read, so neither section nor any
             count or "No changes" message is rendered. -->
        <div
          role="status"
          class="flex-shrink-0 px-3 py-2 text-[10px] text-base-content-muted text-center"
          data-testid="git-status-unavailable"
        >
          Git status is unavailable ({{ unavailableLabel() }}).
        </div>
      } @else {
        @if (staleReason()) {
          <!-- The latest read failed; the lists below are the last successful
             read, marked stale rather than hidden (TASK_2026_576 RC3). -->
          <div
            [id]="staleNoticeId"
            role="status"
            class="flex-shrink-0 flex items-start gap-1 px-2 py-1.5 text-[10px]
                 text-base-content-muted border-l-2 border-warning bg-base-200"
            data-testid="git-status-stale"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="w-3 h-3 mt-px flex-shrink-0 text-warning"
              aria-hidden="true"
            />
            <span
              >Git status is unavailable ({{ unavailableLabel() }}) — showing
              the last known changes.</span
            >
          </div>
        }
        <!-- Staged Changes section -->
        <div class="flex-shrink-0">
          <!-- Header bar is a PRESENTATIONAL row: the disclosure toggle and the
             unstage-all action are SIBLINGS. Nesting the action inside the
             toggle (as this was) is invalid HTML and was the only reason
             onUnstageAll needed stopPropagation (D1 AC1/AC5).

             Two AC6 details that are easy to lose:
             - opacity-70/hover:opacity-100 stays on the ROW, not the toggle,
               so the action button's resting opacity and the whole-header
               hover response are exactly what they were.
             - the toggle repeats the uppercase class. Tailwind preflight resets
               text-transform to none on <button>, so the label would silently
               drop out of caps now that the text lives inside a button rather
               than being the button (measured: 108.39px -> 96.78px). -->
          <div
            class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
                 uppercase tracking-wider opacity-70 hover:opacity-100
                 bg-base-200 transition-opacity"
          >
            <button
              type="button"
              class="flex flex-1 items-center gap-1 -my-1 -ml-2 py-1 pl-2 uppercase
                   cursor-pointer focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-[-2px]
                   focus-visible:outline-[oklch(var(--s))]"
              [attr.aria-expanded]="stagedExpanded()"
              [attr.aria-controls]="stagedListId"
              aria-label="Toggle staged changes section"
              (click)="stagedExpanded.set(!stagedExpanded())"
            >
              <lucide-angular
                [img]="stagedExpanded() ? ChevronDownIcon : ChevronRightIcon"
                class="w-3 h-3 flex-shrink-0"
              />
              <span>Staged Changes ({{ stagedFiles().length }})</span>
            </button>
            @if (stagedFiles().length > 0) {
              <button
                type="button"
                class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto
                     focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-[-2px]
                     focus-visible:outline-[oklch(var(--s))]"
                title="Unstage all"
                aria-label="Unstage all files"
                [disabled]="!canRunBulk()"
                [attr.aria-busy]="isPending(sectionErrorKey('staged')) || null"
                (click)="onUnstageAll()"
              >
                <lucide-angular [img]="MinusIcon" class="w-3.5 h-3.5" />
              </button>
            }
          </div>
          <ng-container
            [ngTemplateOutlet]="sectionErrorTpl"
            [ngTemplateOutletContext]="{ $implicit: 'staged' }"
          />
          @if (stagedExpanded()) {
            <div
              [id]="stagedListId"
              role="list"
              aria-label="Staged files"
              [class]="staleListClass()"
              [attr.data-stale]="staleReason() ? 'true' : null"
              [attr.aria-describedby]="staleReason() ? staleNoticeId : null"
            >
              <ng-container
                [ngTemplateOutlet]="treeNodes"
                [ngTemplateOutletContext]="{
                  $implicit: stagedTree(),
                  staged: true,
                  section: 'staged',
                }"
              />
              <!-- role="listitem" is load-bearing, not decoration. This div is a
                 CHILD of the role="list" region above, and the list role
                 declares listitem as its required owned role — so a plain
                 <div> here is a CRITICAL aria-required-children violation,
                 live on the most common state there is (most working trees
                 have nothing staged). It now reads as "list, 1 item, No staged
                 changes" rather than as an unowned orphan. Same at the Changes
                 section below; the two must not drift (TASK_2026_211). -->
              @if (stagedFiles().length === 0) {
                <div
                  role="listitem"
                  class="px-3 py-2 text-[10px] opacity-40 text-center"
                >
                  No staged changes
                </div>
              }
            </div>
          }
        </div>

        <!-- Unstaged Changes section — same de-nested shape as Staged above. -->
        <div class="flex-shrink-0">
          <div
            class="flex items-center gap-1 w-full px-2 py-1 text-[10px] font-semibold
                 uppercase tracking-wider opacity-70 hover:opacity-100
                 bg-base-200 transition-opacity"
          >
            <button
              type="button"
              class="flex flex-1 items-center gap-1 -my-1 -ml-2 py-1 pl-2 uppercase
                   cursor-pointer focus-visible:outline focus-visible:outline-2
                   focus-visible:outline-offset-[-2px]
                   focus-visible:outline-[oklch(var(--s))]"
              [attr.aria-expanded]="unstagedExpanded()"
              [attr.aria-controls]="unstagedListId"
              aria-label="Toggle changes section"
              (click)="unstagedExpanded.set(!unstagedExpanded())"
            >
              <lucide-angular
                [img]="unstagedExpanded() ? ChevronDownIcon : ChevronRightIcon"
                class="w-3 h-3 flex-shrink-0"
              />
              <span>Changes ({{ unstagedFiles().length }})</span>
            </button>
            @if (unstagedFiles().length > 0) {
              <button
                type="button"
                class="btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ml-auto
                     focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-[-2px]
                     focus-visible:outline-[oklch(var(--s))]"
                title="Stage all"
                aria-label="Stage all files"
                [disabled]="!canRunBulk()"
                [attr.aria-busy]="
                  isPending(sectionErrorKey('unstaged')) || null
                "
                (click)="onStageAll()"
              >
                <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
              </button>
            }
          </div>
          <ng-container
            [ngTemplateOutlet]="sectionErrorTpl"
            [ngTemplateOutletContext]="{ $implicit: 'unstaged' }"
          />
          @if (unstagedExpanded()) {
            <div
              [id]="unstagedListId"
              role="list"
              aria-label="Changed files"
              [class]="staleListClass()"
              [attr.data-stale]="staleReason() ? 'true' : null"
              [attr.aria-describedby]="staleReason() ? staleNoticeId : null"
            >
              <ng-container
                [ngTemplateOutlet]="treeNodes"
                [ngTemplateOutletContext]="{
                  $implicit: unstagedTree(),
                  staged: false,
                  section: 'unstaged',
                }"
              />
              <!-- role="listitem" for the same reason as the staged empty state
                 above — see that comment (TASK_2026_211). -->
              @if (unstagedFiles().length === 0) {
                <div
                  role="listitem"
                  class="px-3 py-2 text-[10px] opacity-40 text-center"
                >
                  No changes
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Worktrees section (collapsible, below Changes) -->
      <ptah-worktree-section />

      <ng-template
        #treeNodes
        let-nodes
        let-staged="staged"
        let-section="section"
      >
        @for (node of nodes; track node.key) {
          @if (node.kind === 'folder') {
            <div role="listitem">
              <button
                type="button"
                class="flex items-center gap-1.5 w-full px-2 py-0.5 text-left text-xs
                       hover:bg-base-content/10 transition-colors cursor-pointer
                       focus-visible:outline focus-visible:outline-2
                       focus-visible:outline-offset-[-2px]
                       focus-visible:outline-[oklch(var(--s))]"
                [attr.aria-expanded]="isFolderExpanded(section, node.path)"
                [attr.aria-controls]="folderListId(section, node.path)"
                [attr.aria-label]="folderToggleLabel(node.name)"
                (click)="toggleFolder(section, node.path)"
              >
                <lucide-angular
                  [img]="
                    isFolderExpanded(section, node.path)
                      ? ChevronDownIcon
                      : ChevronRightIcon
                  "
                  class="w-3.5 h-3.5 flex-shrink-0"
                  aria-hidden="true"
                />
                <span class="font-medium truncate">{{ node.name }}</span>
              </button>
              @if (isFolderExpanded(section, node.path)) {
                <div
                  [id]="folderListId(section, node.path)"
                  role="list"
                  [attr.aria-label]="node.name + ' folder'"
                  class="ml-3 border-l border-base-300/60"
                >
                  <ng-container
                    [ngTemplateOutlet]="treeNodes"
                    [ngTemplateOutletContext]="{
                      $implicit: node.children,
                      staged: staged,
                      section: section,
                    }"
                  />
                </div>
              }
            </div>
          } @else {
            <ptah-source-control-file
              [file]="node.file"
              [staged]="staged"
              [showParentDir]="false"
              [editorTargets]="editorTargets()"
              [workspaceRoot]="workspaceRoot()"
              [error]="rowError(section, node.file.path)"
              [busy]="!canRunRow(section, node.file.path)"
              (stage)="onStageFile(section, $event)"
              (unstage)="onUnstageFile(section, $event)"
              (discard)="onDiscardFile(section, $event)"
              (dismissError)="clearError(rowErrorKey(section, node.file.path))"
              (openDiff)="diffRequested.emit($event)"
              (openFile)="fileClicked.emit($event)"
            />
          }
        }
      </ng-template>

      <!-- A failed stage-all / unstage-all of one section. Outside the
           role="list" region so it never becomes an unowned list child. -->
      <ng-template #sectionErrorTpl let-section>
        @if (sectionError(section); as message) {
          <div
            data-testid="git-section-error"
            class="flex items-start gap-1 mx-2 my-1 px-1.5 py-1 rounded text-[10px]
                   text-base-content bg-error/10 border border-error/60"
          >
            <lucide-angular
              [img]="ErrorIcon"
              class="w-3 h-3 mt-px flex-shrink-0 text-error"
              aria-hidden="true"
            />
            <span role="alert" class="flex-1 min-w-0 break-words">{{
              message
            }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square p-0 w-6 h-6 min-h-6 flex-shrink-0
                     focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-offset-[-2px]
                     focus-visible:outline-[oklch(var(--s))]"
              [attr.aria-label]="sectionDismissLabel(section)"
              (click)="clearError(sectionErrorKey(section))"
            >
              <lucide-angular [img]="DismissIcon" class="w-3 h-3" />
            </button>
          </div>
        }
      </ng-template>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlPanelComponent {
  private readonly sourceControl = inject(SourceControlService);
  private readonly gitStatus = inject(GitStatusService);

  readonly files = input.required<GitFileStatus[]>();
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly workspaceRoot = input('');
  /**
   * Why the backend could not read `git status`, or null. Without a
   * {@link staleReason}, `files` being empty does not mean a clean tree, so
   * both change sections are replaced with a notice.
   */
  readonly statusUnavailable = input<GitStatusUnavailableReason | null>(null);
  /**
   * Set when `files` is the last successfully read list kept after a failed
   * read (TASK_2026_576 RC3). The lists stay visible, marked stale.
   */
  readonly staleReason = input<GitStatusUnavailableReason | null>(null);

  readonly fileClicked = output<OpenInRequest>();
  /** Structured diff request — carries which comparison the row represents. */
  readonly diffRequested = output<OpenDiffRequest>();
  protected readonly stagedExpanded = signal(true);
  protected readonly unstagedExpanded = signal(true);
  private readonly expandedFolders = signal<ReadonlySet<string>>(new Set());

  /**
   * Commit message draft per workspace root, like VS Code's per-repository
   * SCM input: text typed for one workspace never shows in another, and a
   * commit that finishes after a switch clears only its own workspace's draft.
   */
  private readonly commitDrafts = signal<ReadonlyMap<string, string>>(
    new Map(),
  );
  /** Workspace roots with a commit in flight. */
  private readonly committingRoots = signal<ReadonlySet<string>>(new Set());

  /**
   * Failed mutations by row / section key. Keys carry the workspace root the
   * action ran in, so an error never shows against another workspace's rows.
   */
  private readonly errors = signal<ReadonlyMap<string, string>>(new Map());
  /** Row / section mutation keys (same keys as `errors`) with a call in flight. */
  private readonly pending = signal<ReadonlySet<string>>(new Set());
  /** The last commit outcome per workspace root. */
  private readonly commitFeedbackByRoot = signal<
    ReadonlyMap<string, CommitFeedback>
  >(new Map());

  /** The displayed workspace's commit message draft (bound by ngModel). */
  protected get commitMessage(): string {
    return this.commitDrafts().get(this.workspaceRoot()) ?? '';
  }
  protected set commitMessage(value: string) {
    this.setCommitDraft(this.workspaceRoot(), value);
  }

  /** Whether the displayed workspace has a commit in flight. */
  protected readonly isCommitting = computed(() =>
    this.committingRoots().has(this.workspaceRoot()),
  );

  /** The displayed workspace's last commit outcome. */
  protected readonly commitFeedback = computed(
    () => this.commitFeedbackByRoot().get(this.workspaceRoot()) ?? null,
  );

  /**
   * Whether a stage-all / unstage-all may start: nothing else is in flight
   * for the displayed workspace. A bulk action touches every row, so it
   * never overlaps a row action or the other bulk action.
   */
  protected readonly canRunBulk = computed(() => {
    const prefix = this.workspaceKeyPrefix();
    for (const key of this.pending()) {
      if (key.startsWith(prefix)) return false;
    }
    return true;
  });

  protected readonly unavailableLabel = computed(() => {
    const reason = this.staleReason() ?? this.statusUnavailable();
    return reason ? statusUnavailableLabel(reason) : '';
  });

  /** Left rule marking a list whose contents are last-known, not current. */
  protected readonly staleListClass = computed(() =>
    this.staleReason() ? 'border-l-2 border-warning' : '',
  );

  /**
   * Per-instance ids for the two `role="list"` regions, so each disclosure
   * toggle can point `aria-controls` at the region it expands (D1 AC3/AC4)
   * without two mounted panels ever emitting a duplicate id.
   */
  private static instanceCount = 0;
  private readonly instanceId = SourceControlPanelComponent.instanceCount++;
  protected readonly stagedListId = `sc-staged-list-${this.instanceId}`;
  protected readonly unstagedListId = `sc-unstaged-list-${this.instanceId}`;
  protected readonly staleNoticeId = `sc-stale-notice-${this.instanceId}`;
  readonly PlusIcon = Plus;
  readonly MinusIcon = Minus;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly CheckIcon = Check;
  readonly ErrorIcon = CircleAlert;
  readonly DismissIcon = X;
  protected readonly stagedFiles = computed(() =>
    this.files().filter((f) => f.staged),
  );

  protected readonly unstagedFiles = computed(() =>
    this.files().filter((f) => !f.staged),
  );

  protected readonly stagedTree = computed(() =>
    buildFileTree(this.stagedFiles()),
  );

  protected readonly unstagedTree = computed(() =>
    buildFileTree(this.unstagedFiles()),
  );

  protected isFolderExpanded(section: string, path: string): boolean {
    return this.expandedFolders().has(`${section}:${path}`);
  }

  protected toggleFolder(section: string, path: string): void {
    const key = `${section}:${path}`;
    const next = new Set(this.expandedFolders());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expandedFolders.set(next);
  }

  protected folderListId(section: string, path: string): string {
    const listId =
      section === 'staged' ? this.stagedListId : this.unstagedListId;
    return `${listId}-folder-${encodeURIComponent(path)}`;
  }

  protected folderToggleLabel(name: string): string {
    return `Toggle ${name} folder`;
  }

  /**
   * Whether the commit button should be enabled. A getter rather than a
   * computed() to sit beside the ngModel-bound `commitMessage` accessor; it
   * re-evaluates on each change detection cycle.
   */
  protected get canCommit(): boolean {
    return (
      this.stagedFiles().length > 0 &&
      this.commitMessage.trim().length > 0 &&
      !this.isCommitting()
    );
  }

  protected rowErrorKey(section: SourceControlSection, path: string): string {
    return `${this.workspaceKeyPrefix()}row\u0000${section}\u0000${path}`;
  }

  protected sectionErrorKey(section: SourceControlSection): string {
    return `${this.workspaceKeyPrefix()}section\u0000${section}`;
  }

  /** Prefix shared by every row / section key of the displayed workspace. */
  private workspaceKeyPrefix(): string {
    return `${this.workspaceRoot()}\u0000`;
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  /**
   * Whether a row's stage / unstage / discard may start: that row has no call
   * in flight and no bulk action is running over its workspace.
   */
  protected canRunRow(section: SourceControlSection, path: string): boolean {
    return (
      !this.isPending(this.rowErrorKey(section, path)) &&
      !this.isPending(this.sectionErrorKey('staged')) &&
      !this.isPending(this.sectionErrorKey('unstaged'))
    );
  }

  protected rowError(
    section: SourceControlSection,
    path: string,
  ): string | null {
    return this.errors().get(this.rowErrorKey(section, path)) ?? null;
  }

  protected sectionError(section: SourceControlSection): string | null {
    return this.errors().get(this.sectionErrorKey(section)) ?? null;
  }

  protected sectionDismissLabel(section: SourceControlSection): string {
    return section === 'staged'
      ? 'Dismiss unstage all error'
      : 'Dismiss stage all error';
  }

  protected clearError(key: string): void {
    this.setError(key, null);
  }

  protected dismissCommitFeedback(): void {
    this.setCommitFeedback(this.workspaceRoot(), null);
  }

  protected onStageFile(
    section: SourceControlSection,
    path: string,
  ): Promise<void> {
    if (!this.canRunRow(section, path)) return Promise.resolve();
    return this.runMutation(this.rowErrorKey(section, path), () =>
      this.sourceControl.stageFile(path),
    );
  }

  protected onUnstageFile(
    section: SourceControlSection,
    path: string,
  ): Promise<void> {
    if (!this.canRunRow(section, path)) return Promise.resolve();
    return this.runMutation(this.rowErrorKey(section, path), () =>
      this.sourceControl.unstageFile(path),
    );
  }

  protected onDiscardFile(
    section: SourceControlSection,
    path: string,
  ): Promise<void> {
    if (!this.canRunRow(section, path)) return Promise.resolve();
    return this.runMutation(this.rowErrorKey(section, path), () =>
      this.sourceControl.discardChanges(path),
    );
  }

  /**
   * Stage-all / unstage-all take no event. Both buttons are SIBLINGS of the
   * section disclosure toggle rather than children of it, so activating them
   * cannot toggle the section. The isolation is structural — there is no
   * `stopPropagation()` to forget (D1 AC5).
   */
  protected onStageAll(): Promise<void> {
    if (!this.canRunBulk()) return Promise.resolve();
    return this.runMutation(this.sectionErrorKey('unstaged'), () =>
      this.sourceControl.stageAll(),
    );
  }

  protected onUnstageAll(): Promise<void> {
    if (!this.canRunBulk()) return Promise.resolve();
    return this.runMutation(this.sectionErrorKey('staged'), () =>
      this.sourceControl.unstageAll(),
    );
  }

  protected async onCommit(): Promise<void> {
    // The disabled button is the first guard; this one also covers a second
    // activation that lands before the next render.
    if (!this.canCommit) return;
    const message = this.commitMessage.trim();

    const workspaceRoot = this.workspaceRoot();
    this.setCommitting(workspaceRoot, true);
    this.setCommitFeedback(workspaceRoot, null);

    let feedback: CommitFeedback;
    try {
      feedback = commitFeedbackFor(
        await this.sourceControl.commit(message),
        workspaceRoot,
      );
    } catch (error) {
      feedback = {
        kind: 'failure',
        workspaceRoot,
        text: thrownFailureText(error),
      };
    }

    // Only a confirmed commit clears the message — the draft of the workspace
    // the commit ran in, even if another one is displayed now. Every failure
    // keeps it.
    if (feedback.kind === 'success') this.setCommitDraft(workspaceRoot, '');
    this.setCommitFeedback(workspaceRoot, feedback);
    this.setCommitting(workspaceRoot, false);
    this.refreshStatus();
  }

  /**
   * Run one mutation, record its failure (or clear an earlier one on
   * success) under `key`, then re-read the status: a failed call can still
   * have changed the index, and the non-Electron hosts push nothing. `key`
   * stays pending until the call settles, which disables its control and
   * turns a repeated activation into a no-op.
   */
  private async runMutation(
    key: string,
    call: () => Promise<RpcCallResult<GitMutationOutcome>>,
  ): Promise<void> {
    if (this.isPending(key)) return;
    this.setPending(key, true);
    let failure: string | null;
    try {
      failure = mutationFailureText(await call());
    } catch (error) {
      failure = thrownFailureText(error);
    }
    this.setError(key, failure);
    this.setPending(key, false);
    this.refreshStatus();
  }

  /**
   * Re-read the status after a mutation. `GitStatusService.refresh()`
   * catches its own read failures and publishes them as `staleReason`
   * (`git-status.service.ts` `fetchGitInfo`), so it does not reject today.
   * The catch keeps a future rejection from becoming an unhandled one.
   */
  private refreshStatus(): void {
    this.gitStatus.refresh().catch(() => {
      // degradation-audit: reported - a failed re-read is surfaced by
      // GitStatusService as a stale / unavailable status notice.
    });
  }

  private setPending(key: string, pending: boolean): void {
    const next = new Set(this.pending());
    if (pending) next.add(key);
    else next.delete(key);
    this.pending.set(next);
  }

  private setCommitting(workspaceRoot: string, committing: boolean): void {
    const next = new Set(this.committingRoots());
    if (committing) next.add(workspaceRoot);
    else next.delete(workspaceRoot);
    this.committingRoots.set(next);
  }

  private setCommitDraft(workspaceRoot: string, message: string): void {
    const next = new Map(this.commitDrafts());
    if (message) next.set(workspaceRoot, message);
    else next.delete(workspaceRoot);
    this.commitDrafts.set(next);
  }

  private setCommitFeedback(
    workspaceRoot: string,
    feedback: CommitFeedback | null,
  ): void {
    const next = new Map(this.commitFeedbackByRoot());
    if (feedback) next.set(workspaceRoot, feedback);
    else next.delete(workspaceRoot);
    this.commitFeedbackByRoot.set(next);
  }

  private setError(key: string, message: string | null): void {
    const current = this.errors();
    if (message === null && !current.has(key)) return;
    const next = new Map(current);
    if (message === null) next.delete(key);
    else next.set(key, message);
    this.errors.set(next);
  }
}
