import 'reflect-metadata';
import { GuidanceGenerationRunSupervisor } from './guidance-generation-run.supervisor';

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

  it('cancels only the exact binding and keeps an unknown commit outcome', () => {
    const supervisor = new GuidanceGenerationRunSupervisor();
    const { binding, controller } = supervisor.start(
      tab,
      source,
      'anthropic',
      'sonnet',
    );
    expect(supervisor.cancel({ ...binding, runId: 'wrong' }).outcome).toBe(
      'refused',
    );
    expect(supervisor.cancel(binding)).toEqual({
      cancelled: true,
      outcome: 'cancelled',
    });
    expect(controller.signal.aborted).toBe(true);
    supervisor.finish(binding, 'completed');
    expect(supervisor.lookup(tab).run?.result?.committedState).toBe('unknown');
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

  it('records timeout separately from user cancellation with unknown commit state', () => {
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
      committedState: 'unknown',
      result: {
        status: 'timed-out',
        success: false,
        committedState: 'unknown',
      },
    });
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
