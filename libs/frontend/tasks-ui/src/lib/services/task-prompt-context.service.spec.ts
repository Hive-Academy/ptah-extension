/**
 * TaskPromptContextService — launch-time context block tests.
 *
 * Stubs `ClaudeRpcService.call` to exercise every section source against the
 * real `tasks:get` / `git:info` / `git:worktrees` / `autocomplete:commands`
 * RPC names. Document names in fixtures flow from the shared `DOC_FILES`
 * contract — never a hand-written filename (CI ratchet).
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import {
  DOC_FILES,
  type AutocompleteCommandInfo,
} from '@ptah-extension/shared';
import { TaskPromptContextService } from './task-prompt-context.service';

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const err = (error: string) => ({ success: false, isSuccess: () => false, error });

describe('TaskPromptContextService', () => {
  let service: TaskPromptContextService;
  let rpcCall: jest.Mock;
  /** Per-test result map; the mock implementation reads it on every call. */
  let results: Record<string, unknown>;

  beforeEach(() => {
    rpcCall = jest.fn((method: string) =>
      Promise.resolve(method in results ? results[method] : err('unhandled method')),
    );

    TestBed.configureTestingModule({
      providers: [
        TaskPromptContextService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
        {
          provide: AppStateManager,
          useValue: {
            workspaceInfo: signal({ path: 'D:/ws', name: 'ws', type: 'workspace' }),
          },
        },
      ],
    });
    service = TestBed.inject(TaskPromptContextService);

    results = {
      'tasks:get': ok({
        task: {
          status: 'in_progress',
          type: 'FEATURE',
          estimate: 'M',
          artifacts: [DOC_FILES[0], DOC_FILES[DOC_FILES.length - 1]],
        },
      }),
      'git:info': ok({
        branch: { branch: 'feat/x', upstream: null, ahead: 0, behind: 0 },
        files: [],
        isGitRepo: true,
      }),
      'git:worktrees': ok({
        worktrees: [
          {
            path: 'D:/wt/TASK_2026_300',
            branch: 'feat/other',
            head: 'abc1234',
            isMain: false,
            isBare: false,
          },
        ],
      }),
      'autocomplete:commands': ok({
        commands: [
          { name: 'compact', description: 'Host builtin', scope: 'builtin', source: 'builtin' },
          { name: 'agent-lanes', description: 'Delegate work to CLI lanes', scope: 'plugin', source: 'skill' },
          { name: 'review-code', description: 'Review changed code', scope: 'project', source: 'command' },
        ] as AutocompleteCommandInfo[],
      }),
    };
  });

  it('renders all four sources in one block', async () => {
    const block = await service.buildContextBlock('TASK_2026_300');

    expect(block.startsWith('\n\n## Task context')).toBe(true);
    expect(block).toContain('Status: In Progress');
    expect(block).toContain('Type: FEATURE');
    expect(block).toContain('Estimate: Medium');
    expect(block).toContain('Workflow documents present:');
    expect(block).toContain('Furthest stage reached:');
    expect(block).toContain('### Git');
    expect(block).toContain('Branch: feat/x.');
    expect(block).toContain('Working tree: clean.');
    expect(block).toContain('Worktree for this task: D:/wt/TASK_2026_300 (branch feat/other)');
    expect(block).toContain('### Skills');
    expect(block).toContain('- agent-lanes — Delegate work to CLI lanes');
    expect(block).toContain('### Commands');
    expect(block).toContain('- review-code — Review changed code');
  });

  it('a failed tasks:get omits only the carrier facts, never the other sections', async () => {
    results['tasks:get'] = err('scan failed');

    const block = await service.buildContextBlock('TASK_2026_300');

    expect(block).not.toContain('Status:');
    expect(block).not.toContain('Workflow documents present:');
    expect(block).toContain('### Git');
    expect(block).toContain('### Skills');
    expect(block).toContain('### Commands');
  });

  it('a failed git:info omits only the branch and working-tree lines, keeping the worktree fact', async () => {
    results['git:info'] = err('not a repo');

    const block = await service.buildContextBlock('TASK_2026_300');

    expect(block).toContain('Status: In Progress');
    expect(block).not.toContain('Branch:');
    expect(block).not.toContain('Working tree:');
    expect(block).toContain('Worktree for this task: D:/wt/TASK_2026_300');
    expect(block).toContain('### Skills');
  });

  it('a failed git:worktrees omits only the worktree line, keeping the branch facts', async () => {
    results['git:worktrees'] = err('worktree list failed');

    const block = await service.buildContextBlock('TASK_2026_300');

    expect(block).toContain('Branch: feat/x.');
    expect(block).toContain('Working tree: clean.');
    expect(block).not.toContain('Worktree for this task');
    expect(block).toContain('Status: In Progress');
  });

  /**
   * `git:info` and `git:worktrees` are independent facts and must be in
   * flight together: `safeCall` waits out a full timeout on a dead transport,
   * so sequential awaits stacked two timeouts into the launch's busy state.
   */
  it('issues both git RPCs before either answers', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    rpcCall.mockImplementation((method: string) => {
      if (method === 'git:info' || method === 'git:worktrees') {
        return new Promise((resolve) => pending.set(method, resolve));
      }
      return Promise.resolve(results[method]);
    });

    const blockPromise = service.buildContextBlock('TASK_2026_300');

    // Neither git RPC has answered, yet both are already in flight — under
    // the sequential awaits, `git:worktrees` was not even issued yet.
    expect(pending.has('git:info')).toBe(true);
    expect(pending.has('git:worktrees')).toBe(true);

    pending.get('git:info')?.(results['git:info']);
    pending.get('git:worktrees')?.(results['git:worktrees']);
    const block = await blockPromise;

    expect(block).toContain('Branch: feat/x.');
    expect(block).toContain('Worktree for this task: D:/wt/TASK_2026_300');
  });

  it('a failed autocomplete:commands omits only the listings', async () => {
    results['autocomplete:commands'] = err('discovery failed');

    const block = await service.buildContextBlock('TASK_2026_300');

    expect(block).toContain('Status: In Progress');
    expect(block).toContain('### Git');
    expect(block).not.toContain('### Skills');
    expect(block).not.toContain('### Commands');
  });

  it('every source failing yields an empty block, not a throw', async () => {
    results = {};

    await expect(service.buildContextBlock('TASK_2026_300')).resolves.toBe('');
  });

  it('a rejecting RPC layer still yields an empty block, not a throw', async () => {
    rpcCall.mockRejectedValue(new Error('bus gone'));

    await expect(service.buildContextBlock('TASK_2026_300')).resolves.toBe('');
  });

  it('groups entries by source and drops builtins from both listings', async () => {
    const block = await service.buildContextBlock('TASK_2026_300');

    const skillsIndex = block.indexOf('### Skills');
    const agentLanesIndex = block.indexOf('- agent-lanes');
    const commandsIndex = block.indexOf('### Commands');
    const reviewCodeIndex = block.indexOf('- review-code');

    expect(skillsIndex).toBeGreaterThan(-1);
    expect(agentLanesIndex).toBeGreaterThan(skillsIndex);
    expect(agentLanesIndex).toBeLessThan(commandsIndex);
    expect(reviewCodeIndex).toBeGreaterThan(commandsIndex);
    expect(block.indexOf('- compact')).toBe(-1); // builtin: not a workspace capability
  });

  it('omits an absent estimate and an absent type without a placeholder', async () => {
    results['tasks:get'] = ok({
      task: { status: 'backlog', type: null, artifacts: [] },
    });

    const block = await service.buildContextBlock('TASK_2026_300');

    expect(block).toContain('Status: Backlog');
    expect(block).not.toContain('Estimate:');
    expect(block).not.toContain('Type:');
    expect(block).not.toContain('Workflow documents present:');
  });

  it('scopes workspace-aware calls to the active root and never sends an empty root', async () => {
    await service.buildContextBlock('TASK_2026_300');

    expect(rpcCall).toHaveBeenCalledWith(
      'tasks:get',
      expect.objectContaining({ taskId: 'TASK_2026_300', workspaceRoot: 'D:/ws' }),
    );
    expect(rpcCall).toHaveBeenCalledWith(
      'git:info',
      expect.objectContaining({ workspaceRoot: 'D:/ws' }),
    );
    expect(rpcCall).toHaveBeenCalledWith(
      'autocomplete:commands',
      expect.objectContaining({ workspaceRoot: 'D:/ws' }),
    );
    expect(rpcCall).toHaveBeenCalledWith('git:worktrees', {});
  });
});