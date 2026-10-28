import 'reflect-metadata';
import { Result } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { Logger } from '@ptah-extension/vscode-core';
import type { GenerationSummary } from '@ptah-extension/agent-generation';
import { GuidanceGenerationRunSupervisor } from './guidance-generation-run.supervisor';
import { GenerationRunSupervisor } from './wizard-generation-run.supervisor';

const tab = {
  tabId: 'tab-one',
  workflow: 'setup-project-prompt' as const,
  workspacePath: '/workspace',
};
const source = {
  kind: 'workspace-discovery' as const,
  reason: 'missing' as const,
};

describe('GuidanceGenerationRunSupervisor', () => {
  it('keeps agent and guidance run ownership independent in both directions', async () => {
    const logger = Object.assign(
      Object.create(Logger.prototype),
      createMockLogger(),
    ) as Logger;
    const agent = new GenerationRunSupervisor(logger);
    const guidance = new GuidanceGenerationRunSupervisor();
    const agentBinding = {
      tabId: 'agent-tab',
      workflow: 'setup-agent-generation' as const,
      workspacePath: tab.workspacePath,
      runId: '11111111-1111-4111-8111-111111111111',
    };
    const summary: GenerationSummary = {
      totalAgents: 0,
      successful: 0,
      failed: 0,
      durationMs: 0,
      warnings: [],
      outputDirectory: '/workspace/.claude/agents',
      writtenCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      keptCount: 0,
      changedSincePreviewCount: 0,
      rejectedSections: 0,
      tailoredSections: 0,
      lifecycle: 'completed',
      outcomes: [],
    };
    let finishAgent:
      ((result: Result<GenerationSummary, Error>) => void) | undefined;
    const agentRequest = {
      tabBinding: agentBinding,
      options: { workspacePath: tab.workspacePath },
      broadcaster: null,
      outputDirectory: summary.outputDirectory,
      carriedOver: [],
    };
    const runningAgent = agent.run({
      ...agentRequest,
      orchestrator: {
        generateAgents: () =>
          new Promise((resolve) => {
            finishAgent = resolve;
          }),
      },
    });
    expect(agent.isActive).toBe(true);
    const { binding } = guidance.start(tab, source, 'anthropic', 'sonnet');
    expect(guidance.lookup(tab).run?.binding).toEqual(binding);
    finishAgent?.(Result.ok(summary));
    await runningAgent;
    expect(guidance.lookup(tab).run?.status).toBe('starting');
    const nextAgent = await agent.run({
      ...agentRequest,
      orchestrator: { generateAgents: async () => Result.ok(summary) },
    });
    expect(nextAgent.payload.success).toBe(true);
    guidance.finish(binding, 'completed');
  });
  it('returns the active binding after a lost start response and resolves duplicate starts', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding } = supervisor.start(tab, source, 'anthropic', 'sonnet');
    expect(supervisor.lookup(tab).run?.binding).toEqual(binding);
    expect(supervisor.lookup(tab, binding.runId).run?.status).toBe('starting');
  });

  it('limits blocked disclosure to the owner tab in the same workspace', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    supervisor.start(tab, source, 'anthropic', 'sonnet');
    expect(supervisor.lookup({ ...tab, tabId: 'two' }).rejection).toEqual({
      reason: 'blocked',
      ownerTabId: tab.tabId,
    });
    expect(
      supervisor.lookup({ ...tab, workspacePath: '/other' }).rejection,
    ).toEqual({ reason: 'blocked' });
  });

  it('reports a tabless owner as blocked without any run binding', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    expect(supervisor.lookup(tab, undefined, true)).toEqual({
      run: null,
      rejection: { reason: 'blocked' },
    });
  });

  it('cancels only the exact binding and records unchanged before commit', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding, controller } = supervisor.start(
      tab,
      source,
      'anthropic',
      'sonnet',
    );
    expect(supervisor.cancel({ ...binding, runId: 'wrong' })).toMatchObject({
      outcome: 'not-running',
      rejection: { reason: 'not-running' },
    });
    expect(supervisor.cancel(binding)).toEqual({
      cancelled: true,
      outcome: 'cancelled',
    });
    expect(controller.signal.aborted).toBe(true);
    supervisor.finish(binding, 'completed');
    expect(supervisor.lookup(tab).run?.result?.committedState).toBe(
      'unchanged',
    );
    expect(supervisor.lookup(tab).run?.status).toBe('cancelled');
    expect(supervisor.cancel(binding).outcome).toBe('already-finalized');
    expect(supervisor.cancel({ ...binding, runId: 'other' }).outcome).toBe(
      'not-running',
    );
  });

  it('refuses cancellation once trace and state commit has begun', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding, controller } = supervisor.start(
      tab,
      source,
      'anthropic',
      'sonnet',
    );
    expect(supervisor.beginCommit(binding)).toBe(true);
    expect(supervisor.cancel(binding)).toEqual({
      cancelled: false,
      outcome: 'refused',
    });
    expect(controller.signal.aborted).toBe(false);
  });

  it('records timeout separately from user cancellation before commit', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding, controller } = supervisor.start(
      tab,
      source,
      'anthropic',
      'sonnet',
    );
    supervisor.timeout(binding);
    expect(controller.signal.aborted).toBe(true);
    supervisor.finish(binding, 'failed');
    expect(supervisor.lookup(tab, binding.runId).run).toMatchObject({
      status: 'timed-out',
      committedState: 'unchanged',
      result: {
        status: 'timed-out',
        success: false,
        committedState: 'unchanged',
      },
    });
  });

  it('keeps a user cancellation when the lock timer fires later', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding } = supervisor.start(tab, source, 'anthropic', 'sonnet');
    supervisor.cancel(binding);
    supervisor.timeout(binding);
    supervisor.finish(binding, 'failed');
    expect(supervisor.lookup(tab, binding.runId).run).toMatchObject({
      status: 'cancelled',
      committedState: 'unchanged',
    });
  });

  it('force releases once and a late return cannot overwrite the settled run', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding } = supervisor.start(tab, source, 'anthropic', 'sonnet');
    expect(supervisor.forceRelease(binding)).toBe(true);
    expect(supervisor.forceRelease(binding)).toBe(false);
    const later = supervisor.start(
      { ...tab, tabId: 'next' },
      source,
      'anthropic',
      'sonnet',
    );
    expect(supervisor.finish(binding, 'completed')).toBe(false);
    expect(supervisor.lookup(tab, binding.runId).run).toMatchObject({
      status: 'timed-out',
      committedState: 'unknown',
    });
    supervisor.finish(later.binding, 'completed');
  });

  it('reports an unknown failed outcome after commit begins', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding } = supervisor.start(tab, source, 'anthropic', 'sonnet');
    supervisor.beginCommit(binding);
    supervisor.finish(binding, 'failed');
    expect(supervisor.lookup(tab, binding.runId).run?.committedState).toBe(
      'unknown',
    );
  });

  it('returns an exact settled result even while another tab runs or the service is busy', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding } = supervisor.start(tab, source, 'anthropic', 'sonnet');
    supervisor.finish(binding, 'completed');
    supervisor.start({ ...tab, tabId: 'other' }, source, 'anthropic', 'sonnet');
    expect(supervisor.lookup(tab, binding.runId).run?.status).toBe('completed');
    expect(supervisor.lookup(tab, 'wrong').rejection?.reason).toBe('blocked');
    expect(supervisor.lookup(tab, binding.runId, true).run?.status).toBe(
      'completed',
    );
  });
});
