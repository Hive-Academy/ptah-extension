import { Injectable, inject } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type {
  AutocompleteCommandInfo,
  RpcMethodName,
  RpcMethodParams,
  RpcMethodResult,
  TaskSpecDetail,
} from '@ptah-extension/shared';
import {
  TASK_ESTIMATE_LABELS,
  TASK_STATUS_LABELS,
  WORKFLOW_ARTIFACTS,
} from '../task-presentation';

/**
 * Live listings are read at launch time, so give the merged command/skill scan
 * a generous budget — a truncated list silently drops sections.
 */
const AUTOCOMPLETE_MAX_RESULTS = 200;

/**
 * TaskPromptContextService — builds the deterministic context block appended
 * to a Start prompt (`TASK_2026_471`, Batch C).
 *
 * Gathers launch-time facts over `ClaudeRpcService`, nothing else:
 *   - carrier facts (`tasks:get`): status, type, estimate;
 *   - phase: which workflow documents exist and which stage is the furthest
 *     reached, derived from the SAME result's artifacts against
 *     `WORKFLOW_ARTIFACTS` (never a hand-written document name);
 *   - git (`git:info`, `git:worktrees`): branch, working-tree state, and any
 *     worktree whose path or branch names this task;
 *   - workspace skills and commands (`autocomplete:commands`), grouped by the
 *     `source` field: `skill` entries and `command` entries as two sections.
 *
 * Failure posture: EVERY call is best-effort. A call that fails or returns
 * nothing omits ITS OWN section and nothing else; a launch is never blocked
 * or failed because git or autocomplete did not answer. Nothing in this
 * service throws, and nothing in it calls a model — the block only hands the
 * receiving agent facts.
 */
@Injectable({ providedIn: 'root' })
export class TaskPromptContextService {
  private readonly appState = inject(AppStateManager);
  private readonly rpc = inject(ClaudeRpcService);

  /**
   * Build the markdown context block for `taskId`, or `''` when no source
   * answered. The block starts with `\n\n## Task context` so callers append
   * it to any prompt tail without further spacing.
   */
  public async buildContextBlock(taskId: string): Promise<string> {
    const sections = await Promise.all([
      this.fetchCarrierSection(taskId),
      this.fetchGitSection(taskId),
      this.fetchListingsSection(),
    ]);
    const present = sections.filter((section) => section.length > 0);
    if (present.length === 0) return '';
    return `\n\n## Task context\n\n${present.join('\n\n')}`;
  }

  // --- carrier facts + workflow phase (one `tasks:get` result) --------------

  private async fetchCarrierSection(taskId: string): Promise<string> {
    try {
      const data = await this.safeCall('tasks:get', {
        taskId,
        ...this.workspaceParam(),
      });
      const task = data?.task;
      if (!task) return '';

      const lines: string[] = [];
      const facts: string[] = [`Status: ${TASK_STATUS_LABELS[task.status]}`];
      // Absent type/estimate is ordinary: omit the segment, never a placeholder.
      if (task.type) facts.push(`Type: ${task.type}`);
      if (task.estimate) {
        facts.push(`Estimate: ${TASK_ESTIMATE_LABELS[task.estimate]}`);
      }
      lines.push(facts.join(' · '));

      const workflow = this.workflowLine(task);
      if (workflow) lines.push(workflow);
      return lines.join('\n');
    } catch {
      // degradation-audit: optional-capability - a `tasks:get` that throws
      // drops only the carrier facts (status, type, estimate, workflow
      // phase) from the context block; the launch proceeds with the git and
      // listing sections instead of failing.
      return '';
    }
  }

  /**
   * Which workflow documents the task folder holds, and which stage is the
   * furthest reached. Document names come from `WORKFLOW_ARTIFACTS` (the
   * shared `DOC_FILES` contract) — never hand-written here.
   */
  private workflowLine(task: TaskSpecDetail): string {
    const present = WORKFLOW_ARTIFACTS.filter((artifact) =>
      artifact.files.some((file) => task.artifacts.includes(file)),
    );
    if (present.length === 0) return '';
    const names = present.map((artifact) => artifact.label).join(', ');
    const furthest = present[present.length - 1].label;
    return `Workflow documents present: ${names}. Furthest stage reached: ${furthest}.`;
  }

  // --- git -------------------------------------------------------------------

  private async fetchGitSection(taskId: string): Promise<string> {
    try {
      const lines: string[] = [];

      // Both git facts are independent, and `safeCall` waits out a timeout on
      // a dead transport — run them concurrently so two timeouts do not stack
      // (the launch's `busyTaskId` stays set for the whole section otherwise).
      const [info, worktrees] = await Promise.all([
        this.safeCall('git:info', { ...this.workspaceParam() }),
        this.safeCall('git:worktrees', {}),
      ]);
      if (info?.isGitRepo) {
        lines.push(`Branch: ${info.branch.branch}.`);
        if (info.statusUnavailable) {
          // An empty `files` list here would NOT mean a clean tree.
          lines.push('Working tree: status unavailable.');
        } else {
          lines.push(
            info.files.length > 0
              ? `Working tree: dirty (${info.files.length} changed files).`
              : 'Working tree: clean.',
          );
        }
      }

      for (const worktree of worktrees?.worktrees ?? []) {
        const namesTask =
          this.namesTask(worktree.path, taskId) ||
          this.namesTask(worktree.branch, taskId);
        if (namesTask) {
          lines.push(
            `Worktree for this task: ${worktree.path} (branch ${worktree.branch})`,
          );
        }
      }

      return lines.length > 0 ? `### Git\n${lines.join('\n')}` : '';
    } catch {
      // degradation-audit: optional-capability - git facts (branch,
      // working-tree state, a task-named worktree) only orient the receiving
      // agent; when `git:info` or `git:worktrees` throws, the block ships
      // without the git section rather than blocking the launch.
      return '';
    }
  }

  private namesTask(value: string, taskId: string): boolean {
    return value.toLowerCase().includes(taskId.toLowerCase());
  }

  // --- workspace skills and commands -----------------------------------------

  private async fetchListingsSection(): Promise<string> {
    try {
      const data = await this.safeCall('autocomplete:commands', {
        query: '',
        maxResults: AUTOCOMPLETE_MAX_RESULTS,
        ...this.workspaceParam(),
      });
      const commands = data?.commands ?? [];
      const sections: string[] = [];
      const skills = this.entriesFrom(commands, 'skill');
      if (skills) sections.push(`### Skills\n${skills}`);
      const workspaceCommands = this.entriesFrom(commands, 'command');
      if (workspaceCommands) {
        sections.push(`### Commands\n${workspaceCommands}`);
      }
      return sections.join('\n\n');
    } catch {
      // degradation-audit: optional-capability - the skills and commands
      // listing only suggests capabilities the agent may use; when
      // `autocomplete:commands` throws, the block omits both sections and
      // the prompt still reaches the composer.
      return '';
    }
  }

  /**
   * Live entries of one `source`, as `- name — description` lines. Builtins
   * are the host's own slash commands, not workspace capabilities — they do
   * not belong in either listing.
   */
  private entriesFrom(
    commands: AutocompleteCommandInfo[],
    source: 'skill' | 'command',
  ): string {
    return commands
      .filter((command) => command.source === source)
      .map((command) => `- ${command.name} — ${command.description}`)
      .join('\n');
  }

  // --- shared plumbing --------------------------------------------------------

  /**
   * `rpc.call` resolves (never rejects) with a failure result on timeout, but
   * a future change or a stubbed provider could throw — this keeps every
   * section self-contained.
   */
  private async safeCall<T extends RpcMethodName>(
    method: T,
    params: RpcMethodParams<T>,
  ): Promise<RpcMethodResult<T> | null> {
    try {
      const result = await this.rpc.call(method, params);
      return result.isSuccess() ? result.data : null;
    } catch {
      // degradation-audit: optional-capability - `rpc.call` resolves with a
      // failure result rather than throwing; this guards only a stubbed or
      // future-throwing provider, where null already means "section absent"
      // to every caller.
      return null;
    }
  }

  /**
   * Same convention as `TasksStore.workspaceParam`: the active workspace root
   * when there is one, omitted otherwise — never `''` (the backend Zod
   * boundary rejects an empty string).
   */
  private workspaceParam(): { workspaceRoot?: string } {
    const root = this.appState.workspaceInfo()?.path;
    return root ? { workspaceRoot: root } : {};
  }
}
