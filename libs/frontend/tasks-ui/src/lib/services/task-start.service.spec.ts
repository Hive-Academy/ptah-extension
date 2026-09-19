/**
 * TaskStartService — orchestration launch flow (R6 / §8, F-D1).
 *
 * Stubs `AppStateManager` and `ClaudeRpcService`. `TaskPromptContextService`
 * runs for real against the stubbed RPC layer, so the prompt tests below pin
 * the three prompt shapes with a silent context block (every RPC fails), and
 * one wiring test proves the block is appended after the body — and after the
 * isolation directive when isolated.
 *
 * Launch is a PREFILL, never a send: the user reviews the composer and presses
 * send. The AGENT owns the status transition — launch never writes status, so
 * `updateStatus` is pinned UN-called (the `TasksStore` stub stays as the
 * regression pin for that). The host creates no worktree (F-D1): no
 * `git:addWorktree` RPC, no `tasks:updateMetadata` RPC.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type { ChatPromptRequest } from '@ptah-extension/core';
import { DOC_FILES } from '@ptah-extension/shared';
import { TasksStore } from './tasks-store.service';
import { TaskStartService } from './task-start.service';
import type { TaskAgentTarget } from '../types/task-agent.types';

const ISOLATION_HINT = 'Isolate all implementation for this task';
const CONTEXT_HEADING = '## Task context';

/** Drain the microtask queue: `buildPrompt` awaits several RPCs per launch. */
async function flush(times = 16): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

const ok = <T>(data: T) => ({ success: true, isSuccess: () => true, data });
const err = (error: string) => ({ success: false, isSuccess: () => false, error });

describe('TaskStartService', () => {
  let service: TaskStartService;
  let rpcCall: jest.Mock;
  let requestChatPrompt: jest.Mock;
  let updateStatus: jest.Mock;
  let lastPromptRequest: ChatPromptRequest | null;

  beforeEach(() => {
    lastPromptRequest = null;
    // Defaults to returning undefined, so every context-source call fails
    // inside TaskPromptContextService's guards and the block comes back ''.
    rpcCall = jest.fn();
    requestChatPrompt = jest.fn((req: ChatPromptRequest) => {
      lastPromptRequest = req;
    });
    updateStatus = jest.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        TaskStartService,
        {
          provide: ClaudeRpcService,
          useValue: { call: rpcCall as unknown as ClaudeRpcService['call'] },
        },
        {
          provide: AppStateManager,
          useValue: {
            requestChatPrompt,
            workspaceInfo: signal({ path: 'D:/ws', name: 'ws', type: 'workspace' }),
          },
        },
        // The service no longer injects TasksStore. The stub stays PURELY as a
        // regression pin: launch must never write status (the AGENT owns the
        // transition), so updateStatus is asserted UN-called below.
        { provide: TasksStore, useValue: { updateStatus } },
      ],
    });
    service = TestBed.inject(TaskStartService);
  });

  it('isolate=false: prefills the plain prompt and writes NO status on success', async () => {
    const pending = service.start('TASK_2026_200', false);
    await flush();

    // F-D1: no host-side worktree RPC, and no metadata write either.
    expect(rpcCall).not.toHaveBeenCalledWith('git:addWorktree', expect.anything());
    expect(rpcCall).not.toHaveBeenCalledWith('tasks:updateMetadata', expect.anything());
    expect(requestChatPrompt).toHaveBeenCalledTimes(1);
    expect(lastPromptRequest?.prompt).toBe('/orchestrate TASK_2026_200');
    expect(lastPromptRequest?.prompt).not.toContain(ISOLATION_HINT);
    expect(lastPromptRequest?.sessionName).toBe('TASK_2026_200');

    lastPromptRequest?.resolve?.({ success: true });
    await pending;

    expect(updateStatus).not.toHaveBeenCalled(); // the agent owns the transition
    expect(service.error()).toBeNull();
    expect(service.busyTaskId()).toBeNull();
  });

  it('isolate=true: appends the worktree-isolation directive and makes NO addWorktree RPC call', async () => {
    const pending = service.start('TASK_2026_201', true);
    await flush();

    // The whole point of F-D1: no host-created worktree, no git write.
    expect(rpcCall).not.toHaveBeenCalledWith('git:addWorktree', expect.anything());
    expect(requestChatPrompt).toHaveBeenCalledTimes(1);
    expect(lastPromptRequest?.prompt).toContain('/orchestrate TASK_2026_201');
    expect(lastPromptRequest?.prompt).toContain(ISOLATION_HINT);
    expect(lastPromptRequest?.prompt).toContain('worktree');

    lastPromptRequest?.resolve?.({ success: true });
    await pending;

    expect(updateStatus).not.toHaveBeenCalled(); // the agent owns the transition
  });

  it('targets a specialist role with the exact agent prompt format', async () => {
    const target: TaskAgentTarget = {
      id: 'specialist:frontend-developer',
      name: 'Frontend Developer',
      category: 'specialist',
      role: 'frontend-developer',
    };

    const pending = service.start('TASK_2026_206', false, target);
    await flush();

    expect(lastPromptRequest?.prompt).toBe(
      '/orchestrate TASK_2026_206 --agent frontend-developer\n\n' +
        'Execute phase for task TASK_2026_206 using role @frontend-developer. ' +
        'Refer to .ptah/specs/TASK_2026_206/ for requirements and context.',
    );
    lastPromptRequest?.resolve?.({ success: true });
    await pending;
  });

  it('targets a CLI lane with the exact lane prompt format', async () => {
    const target: TaskAgentTarget = {
      id: 'lane:codex',
      name: 'Codex',
      category: 'lane',
      cli: 'codex',
    };

    const pending = service.start('TASK_2026_207', false, target);
    await flush();

    expect(lastPromptRequest?.prompt).toBe(
      '/orchestrate TASK_2026_207 --lane codex\n\n' +
        'Assign task TASK_2026_207 execution to background CLI lane codex ' +
        'per agent-lanes guidelines. Deliverables belong in .ptah/specs/TASK_2026_207/.',
    );
    lastPromptRequest?.resolve?.({ success: true });
    await pending;
  });

  it('treats an explicit orchestrator target exactly like no target', async () => {
    const pending = service.start('TASK_2026_208', false, {
      id: 'orchestrator',
      name: 'Full Orchestrator',
      category: 'orchestrator',
    });
    await flush();

    expect(lastPromptRequest?.prompt).toBe('/orchestrate TASK_2026_208');
    lastPromptRequest?.resolve?.({ success: true });
    await pending;
  });

  it('appends the launch-time context block after the body, and after the isolation directive when isolated', async () => {
    rpcCall.mockImplementation((method: string) => {
      switch (method) {
        case 'tasks:get':
          return Promise.resolve(
            ok({
              task: {
                status: 'in_progress',
                type: 'FEATURE',
                estimate: 'M',
                // Document names flow from the shared DOC_FILES contract —
                // never a hand-written filename (CI ratchet).
                artifacts: [DOC_FILES[0], DOC_FILES[DOC_FILES.length - 1]],
              },
            }),
          );
        case 'git:info':
          return Promise.resolve(
            ok({
              branch: { branch: 'feat/tasks-page-agent-assign', upstream: null, ahead: 0, behind: 0 },
              files: [],
              isGitRepo: true,
            }),
          );
        case 'git:worktrees':
          return Promise.resolve(
            ok({
              worktrees: [
                {
                  path: 'D:/wt/TASK_2026_209',
                  branch: 'feat/tasks-page-agent-assign',
                  head: 'abc1234',
                  isMain: false,
                  isBare: false,
                },
              ],
            }),
          );
        case 'autocomplete:commands':
          return Promise.resolve(
            ok({
              commands: [
                { name: 'compact', description: 'Host builtin', scope: 'builtin', source: 'builtin' },
                { name: 'agent-lanes', description: 'Delegate work to CLI lanes', scope: 'plugin', source: 'skill' },
                { name: 'review-code', description: 'Review changed code', scope: 'project', source: 'command' },
              ],
            }),
          );
        default:
          return Promise.resolve(err('unhandled method'));
      }
    });

    // Plain launch: body first, context block last.
    const pending = service.start('TASK_2026_209', false);
    await flush();

    const prompt = lastPromptRequest?.prompt ?? '';
    expect(prompt.startsWith('/orchestrate TASK_2026_209')).toBe(true);
    expect(prompt).toContain(CONTEXT_HEADING);
    expect(prompt).toContain('Status: In Progress');
    expect(prompt).toContain('Workflow documents present:');
    expect(prompt).toContain('Furthest stage reached:');
    expect(prompt).toContain('### Git');
    expect(prompt).toContain('Branch: feat/tasks-page-agent-assign.');
    expect(prompt).toContain('Worktree for this task: D:/wt/TASK_2026_209');
    expect(prompt).toContain('### Skills');
    expect(prompt).toContain('- agent-lanes — Delegate work to CLI lanes');
    expect(prompt).toContain('### Commands');
    expect(prompt).toContain('- review-code — Review changed code');
    expect(prompt.indexOf('- compact')).toBe(-1); // builtins are not workspace capabilities
    expect(prompt.indexOf(CONTEXT_HEADING)).toBeGreaterThan(
      prompt.indexOf('/orchestrate TASK_2026_209'),
    );
    lastPromptRequest?.resolve?.({ success: true });
    await pending;

    // Isolated launch: body, then isolation directive, then context block.
    const pendingIsolated = service.start('TASK_2026_210', true);
    await flush();

    const isolatedPrompt = lastPromptRequest?.prompt ?? '';
    const bodyIndex = isolatedPrompt.indexOf('/orchestrate TASK_2026_210');
    const isolationIndex = isolatedPrompt.indexOf(ISOLATION_HINT);
    const contextIndex = isolatedPrompt.indexOf(CONTEXT_HEADING);
    expect(isolationIndex).toBeGreaterThan(bodyIndex);
    expect(contextIndex).toBeGreaterThan(isolationIndex);
    lastPromptRequest?.resolve?.({ success: true });
    await pendingIsolated;
  });

  it('structural session failure: status untouched, error surfaced', async () => {
    const pending = service.start('TASK_2026_202', false);
    await flush();

    lastPromptRequest?.resolve?.({ success: false, error: 'AUTH_REQUIRED' });
    await pending;

    expect(updateStatus).not.toHaveBeenCalled();
    expect(service.error()).toContain('Could not start orchestration');
    expect(service.error()).toContain('AUTH_REQUIRED');
  });

  it('is re-entrancy guarded: a second start while busy is a no-op', async () => {
    const first = service.start('TASK_2026_205', false);
    await flush();
    await service.start('TASK_2026_205', false); // ignored — first still in flight

    expect(requestChatPrompt).toHaveBeenCalledTimes(1);
    lastPromptRequest?.resolve?.({ success: true });
    await first;
  });
});