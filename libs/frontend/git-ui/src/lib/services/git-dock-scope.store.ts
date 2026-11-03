import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  GIT_SESSION_SCOPE_SOURCE,
  VSCodeService,
  type GitSessionScopeCandidate,
} from '@ptah-extension/core';
import {
  isSameWorkingRoot,
  resolveSessionWorkingRoot,
  type SessionWorkingRoot,
  type SessionWorkingRootSource,
} from '@ptah-extension/shared';
import { GitBranchesService } from './git-branches.service';
import {
  GitDockMutationGate,
  UNRESOLVED_SCOPE_MESSAGE,
} from './git-dock-mutation-gate';
import { GitReviewService } from './git-review.service';
import { GitRootWatchLeaseService } from './git-root-watch-lease.service';
import { GitStatusService } from './git-status.service';
import { ReviewDiffService } from './review-diff.service';
import { ReviewNavigationService } from './review-navigation.service';

export type GitDockScopeMode = 'follow-session' | 'pinned';

/** What the git dock is scoped to. */
export interface GitDockScope {
  readonly mode: GitDockScopeMode;
  /** The root every dock read and write uses; null when no folder is open. */
  readonly root: string | null;
  /** Which session candidate won (see `resolveSessionWorkingRoot`). */
  readonly source: SessionWorkingRootSource | null;
  /** The session the scope came from; null for the plain workspace scope. */
  readonly session: {
    readonly tabId: string;
    readonly name: string;
    /** The pinned session's tab was closed; the last root is kept. */
    readonly closed: boolean;
  } | null;
  /** True when the root is not the active workspace folder. */
  readonly isWorktree: boolean;
  /**
   * True while the session's organization record is not loaded: its root is
   * unknown, `root` is null, the services keep their last root and every
   * mutation is refused (`GitDockMutationGate`) until the record arrives.
   */
  readonly unresolved: boolean;
}

/** A candidate's resolution; `unresolved` when its worktree is not known. */
interface CandidateRoot extends SessionWorkingRoot {
  readonly unresolved: boolean;
}

const UNRESOLVED_ROOT: CandidateRoot = {
  root: null,
  source: null,
  unresolved: true,
};

/** A pin: the tab, the workspace it was made in, and its last resolution. */
interface PinnedScope {
  readonly tabId: string;
  readonly workspacePath: string | null;
  readonly name: string;
  readonly last: CandidateRoot;
}

/**
 * Every input of the scope, read in one place. The effect reads them in its
 * TRACKED body and hands this plain snapshot to the untracked reconcile, so a
 * change to any of them — an active-tab switch alone included — re-runs it
 * (TASK_2026_855 D21).
 */
interface ScopeInputs {
  readonly workspacePath: string | null;
  readonly followEnabled: boolean;
  readonly pinned: PinnedScope | null;
  readonly pinnedCandidate: GitSessionScopeCandidate | null;
  readonly active: GitSessionScopeCandidate | null;
  readonly open: readonly GitSessionScopeCandidate[];
}

interface WorkspaceAwareService {
  switchWorkspace(workspacePath: string): void;
  removeWorkspaceState(workspacePath: string): void;
}

function resolveCandidate(
  candidate: GitSessionScopeCandidate,
  workspacePath: string | null,
): CandidateRoot {
  // Never guess for a session whose record is not loaded: falling through to
  // the cwd/workspace folder would point stage/commit/discard at the main
  // tree while the session may live in a worktree (review S1).
  if (!candidate.organizationResolved) return UNRESOLVED_ROOT;
  const resolved = resolveSessionWorkingRoot({
    organizationWorktreePath: candidate.organizationWorktreePath,
    agentOriginWorktreePath: candidate.agentOriginWorktreePath,
    sessionCwd: candidate.sessionCwd,
    workspaceRoot: workspacePath,
  });
  return { ...resolved, unresolved: false };
}

function workspaceScope(
  workspacePath: string | null,
  mode: GitDockScopeMode,
): GitDockScope {
  return {
    mode,
    root: workspacePath,
    source: workspacePath === null ? null : 'workspace-root',
    session: null,
    isWorktree: false,
    unresolved: false,
  };
}

/** The scope the inputs describe. Pure. */
function scopeFrom(inputs: ScopeInputs): GitDockScope {
  const { workspacePath, pinned } = inputs;
  if (!inputs.followEnabled) {
    return workspaceScope(workspacePath, 'follow-session');
  }
  const isWorktree = (root: string | null): boolean =>
    root !== null &&
    workspacePath !== null &&
    !isSameWorkingRoot(root, workspacePath);

  if (pinned !== null) {
    const candidate = inputs.pinnedCandidate;
    const resolved =
      candidate === null
        ? pinned.last
        : resolveCandidate(candidate, workspacePath);
    return {
      mode: 'pinned',
      root: resolved.root,
      source: resolved.source,
      session: {
        tabId: pinned.tabId,
        name: candidate?.sessionName ?? pinned.name,
        closed: candidate === null,
      },
      isWorktree: isWorktree(resolved.root),
      unresolved: resolved.unresolved,
    };
  }

  const active = inputs.active;
  if (active === null) return workspaceScope(workspacePath, 'follow-session');
  const resolved = resolveCandidate(active, workspacePath);
  return {
    mode: 'follow-session',
    root: resolved.root,
    source: resolved.source,
    session: { tabId: active.tabId, name: active.sessionName, closed: false },
    isWorktree: isWorktree(resolved.root),
    unresolved: resolved.unresolved,
  };
}

function sameScope(a: GitDockScope, b: GitDockScope): boolean {
  return (
    a.mode === b.mode &&
    a.root === b.root &&
    a.source === b.source &&
    a.isWorktree === b.isWorktree &&
    a.unresolved === b.unresolved &&
    a.session?.tabId === b.session?.tabId &&
    a.session?.name === b.session?.name &&
    a.session?.closed === b.session?.closed
  );
}

/**
 * GitDockScopeStore — decides the root the git dock works in and drives the
 * git services to it (TASK_2026_855).
 *
 * In Electron the dock follows the active chat session's working root
 * (organization worktree → agent-origin worktree → session cwd → workspace
 * folder, `resolveSessionWorkingRoot`), or stays on a pinned session. In
 * every other host, or without a session source, the scope is the workspace
 * folder — today's behaviour.
 *
 * It is the single caller of `switchWorkspace(root)` on GitStatusService,
 * GitBranchesService, ReviewDiffService, GitReviewService and
 * ReviewNavigationService (in that order — navigation last, it reads the
 * status service's new root when it resets). Those services keep one
 * "active root" each, so retargeting them is all it takes for every dock
 * read and write to follow. The fan-out runs only when the root actually
 * changes.
 *
 * The root is not validated here: the backend re-validates every `git:*`
 * root, and a refused one shows the dock's "unavailable" state while this
 * scope stays visible so the user can unpin or switch tabs.
 *
 * Pins live in memory only (D11). A pinned tab that closes keeps its last
 * root, marked closed, until unpinned; a workspace switch or removal clears
 * a pin made in that workspace.
 */
@Injectable({ providedIn: 'root' })
export class GitDockScopeStore {
  private readonly source = inject(GIT_SESSION_SCOPE_SOURCE, {
    optional: true,
  });
  private readonly vscode = inject(VSCodeService);
  private readonly leases = inject(GitRootWatchLeaseService);
  private readonly gate = inject(GitDockMutationGate);
  private readonly services: readonly WorkspaceAwareService[] = [
    inject(GitStatusService),
    inject(GitBranchesService),
    inject(ReviewDiffService),
    inject(GitReviewService),
    // Last: it reads GitStatusService's new root when it resets.
    inject(ReviewNavigationService),
  ];

  private readonly _workspacePath = signal<string | null>(null);
  private readonly _pinned = signal<PinnedScope | null>(null);
  /** The root the services were last switched to. */
  private appliedRoot: string | null = null;
  /**
   * Key of the root list last handed to the lease client. A pinned tab's
   * candidate is re-read on every tab update (streaming included); the lease
   * client only hears about an actual change of the list.
   */
  private leasedKey: string | null = null;

  /** Whether this host follows chat sessions (Electron with a source). */
  readonly followsSessions = computed(
    () => this.source !== null && this.vscode.config().isElectron === true,
  );

  readonly scope = computed<GitDockScope>(() => scopeFrom(this.readInputs()), {
    equal: sameScope,
  });

  readonly mode = computed<GitDockScopeMode>(() => this.scope().mode);

  constructor() {
    effect(() => {
      const inputs = this.readInputs();
      untracked(() => this.reconcile(inputs));
    });
  }

  /** The workspace folder became active (WorkspaceCoordinatorService). */
  setWorkspace(path: string): void {
    const pinned = untracked(this._pinned);
    if (pinned !== null && !isSameWorkingRoot(pinned.workspacePath, path)) {
      this._pinned.set(null);
    }
    this._workspacePath.set(path);
    this.reconcileNow();
  }

  /**
   * A workspace folder was closed (WorkspaceCoordinatorService). Tears the
   * folder down in every git service, clears a pin made in it and, when it
   * was the active one, also releases the session root the services were
   * scoped to.
   */
  removeWorkspace(path: string): void {
    for (const service of this.services) service.removeWorkspaceState(path);
    const pinned = untracked(this._pinned);
    if (pinned !== null && isSameWorkingRoot(pinned.workspacePath, path)) {
      this._pinned.set(null);
    }
    if (isSameWorkingRoot(untracked(this._workspacePath), path)) {
      this._workspacePath.set(null);
      const applied = this.appliedRoot;
      if (applied !== null && !isSameWorkingRoot(applied, path)) {
        for (const service of this.services) {
          service.removeWorkspaceState(applied);
        }
      }
      this.appliedRoot = null;
    }
    this.reconcileNow();
  }

  /** Pin the current session scope: tab switches no longer move the dock. */
  pin(): void {
    const scope = untracked(this.scope);
    if (!untracked(this.followsSessions) || scope.session === null) return;
    this._pinned.set({
      tabId: scope.session.tabId,
      workspacePath: untracked(this._workspacePath),
      name: scope.session.name,
      last: {
        root: scope.root,
        source: scope.source,
        unresolved: scope.unresolved,
      },
    });
    this.reconcileNow();
  }

  /** Return to following the active session. */
  unpin(): void {
    if (untracked(this._pinned) === null) return;
    this._pinned.set(null);
    this.reconcileNow();
  }

  /**
   * Show one session's changes: the active tab's follows (unpins), any other
   * tab's pins the dock to it without switching the chat.
   */
  showSession(tabId: string): void {
    if (!untracked(this.followsSessions) || this.source === null) return;
    const source = this.source;
    if (untracked(source.activeSession)?.tabId === tabId) {
      this.unpin();
      return;
    }
    const candidate = untracked(() => source.candidateForTab(tabId));
    if (candidate === null) return;
    const workspacePath = untracked(this._workspacePath);
    this._pinned.set({
      tabId,
      workspacePath,
      name: candidate.sessionName,
      last: resolveCandidate(candidate, workspacePath),
    });
    this.reconcileNow();
  }

  private readInputs(): ScopeInputs {
    const workspacePath = this._workspacePath();
    const followEnabled = this.followsSessions();
    const pinned = this._pinned();
    const source = this.source;
    if (!followEnabled || source === null) {
      return {
        workspacePath,
        followEnabled: false,
        pinned,
        pinnedCandidate: null,
        active: null,
        open: [],
      };
    }
    return {
      workspacePath,
      followEnabled,
      pinned,
      pinnedCandidate:
        pinned === null ? null : source.candidateForTab(pinned.tabId),
      active: source.activeSession(),
      open: source.openSessions(),
    };
  }

  private reconcileNow(): void {
    const inputs = untracked(() => this.readInputs());
    this.reconcile(inputs);
  }

  /** Apply a snapshot: retarget the services and the leases. Idempotent. */
  private reconcile(inputs: ScopeInputs): void {
    const scope = scopeFrom(inputs);
    this.rememberPinnedRoot(inputs, scope);
    this.gate.setBlockedReason(
      scope.unresolved ? UNRESOLVED_SCOPE_MESSAGE : null,
    );

    const root = scope.root;
    if (root !== null && !isSameWorkingRoot(root, this.appliedRoot)) {
      this.appliedRoot = root;
      for (const service of this.services) service.switchWorkspace(root);
    }

    if (!inputs.followEnabled) return;
    const workspacePath = inputs.workspacePath;
    const sessionRoots = inputs.open
      .map((candidate) => resolveCandidate(candidate, workspacePath).root)
      .filter(
        (candidate): candidate is string =>
          candidate !== null && !isSameWorkingRoot(candidate, workspacePath),
      );
    const leaseRoots = [scope.isWorktree ? root : null, ...sessionRoots];
    const key = leaseRoots.join('\n');
    if (key === this.leasedKey) return;
    this.leasedKey = key;
    this.leases.update(leaseRoots);
  }

  /** Keep the pinned tab's latest root, so a closed tab shows where it was. */
  private rememberPinnedRoot(inputs: ScopeInputs, scope: GitDockScope): void {
    const pinned = inputs.pinned;
    if (pinned === null || inputs.pinnedCandidate === null) return;
    if (
      pinned.last.root === scope.root &&
      pinned.last.source === scope.source &&
      pinned.last.unresolved === scope.unresolved &&
      pinned.name === inputs.pinnedCandidate.sessionName
    ) {
      return;
    }
    this._pinned.set({
      ...pinned,
      name: inputs.pinnedCandidate.sessionName,
      last: {
        root: scope.root,
        source: scope.source,
        unresolved: scope.unresolved,
      },
    });
  }
}
