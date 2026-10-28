import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type { GenerationSummary } from '@ptah-extension/agent-generation';
import {
  GenerationRunSupervisor,
  GENERATION_CANCEL_REASON,
  buildCompletePayload,
} from './wizard-generation-run.supervisor';

const binding = {
  tabId: 'tab-1',
  workflow: 'setup-agent-generation' as const,
  workspacePath: '/workspace',
  runId: '11111111-1111-4111-8111-111111111111',
};

function summary(): GenerationSummary {
  return {
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
}

function logger(): Logger {
  return Object.assign(
    Object.create(Logger.prototype),
    createMockLogger(),
  ) as Logger;
}

describe('GenerationRunSupervisor ownership', () => {
  it('counts final outcomes rather than attempted-file summary totals', () => {
    const payload = buildCompletePayload({
      summary: {
        ...summary(),
        writtenCount: 99,
        failedCount: 99,
        outcomes: [
          {
            agentId: 'agent',
            filePath: '/workspace/.claude/agents/agent.md',
            status: 'written',
            rejectedSections: 2,
            tailoredSections: 3,
          },
        ],
      },
      failure: null,
      abortReason: null,
      carriedOver: [],
      outputDirectory: '/workspace/.claude/agents',
      durationMs: 1,
    });
    expect(payload).toMatchObject({
      success: true,
      writtenCount: 1,
      failedCount: 0,
      rejectedSections: 2,
      tailoredSections: 3,
    });
  });
  it('aborts only the exact tab, workspace and run', async () => {
    const supervisor = new GenerationRunSupervisor(logger());
    let finish: ((value: Result<GenerationSummary, Error>) => void) | undefined;
    const running = supervisor.run({
      tabBinding: binding,
      options: { workspacePath: '/workspace' },
      orchestrator: {
        generateAgents: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
      broadcaster: null,
      outputDirectory: '/workspace/.claude/agents',
      carriedOver: [],
    });
    expect(supervisor.binding).toEqual(binding);
    expect(
      supervisor.abortBound({ ...binding, tabId: 'other' }, 'cancel'),
    ).toBe(false);
    expect(
      supervisor.abortBound(
        { ...binding, runId: '22222222-2222-4222-8222-222222222222' },
        'cancel',
      ),
    ).toBe(false);
    expect(supervisor.abortBound(binding, GENERATION_CANCEL_REASON)).toBe(true);
    finish?.(Result.ok({ ...summary(), lifecycle: 'paused' }));
    const settled = await running;
    expect(settled.payload.success).toBe(false);
    expect(settled.payload.terminalStatus).toBe('cancelled');
    expect(supervisor.binding).toBeNull();
  });

  it('changes a successful payload to failure when finalization fails', async () => {
    const supervisor = new GenerationRunSupervisor(logger());
    const settled = await supervisor.run({
      tabBinding: binding,
      options: { workspacePath: '/workspace' },
      orchestrator: { generateAgents: async () => Result.ok(summary()) },
      broadcaster: null,
      outputDirectory: '/workspace/.claude/agents',
      carriedOver: [],
      onSettled: async () => {
        throw new Error('checkpoint write failed');
      },
    });
    expect(settled.payload.success).toBe(false);
    expect(settled.payload.terminalStatus).toBe('failed');
  });

  it('gives an untabbed run its result facts, without a tab binding (A4)', async () => {
    const supervisor = new GenerationRunSupervisor(logger());
    const settled = await supervisor.run({
      options: { workspacePath: '/workspace' },
      orchestrator: { generateAgents: async () => Result.ok(summary()) },
      broadcaster: null,
      outputDirectory: '/workspace/.claude/agents',
      carriedOver: [],
      source: { kind: 'workspace-discovery', reason: 'missing' },
      effectiveProvider: 'anthropic',
      effectiveModel: 'sonnet',
      onSettled: async (run) => {
        run.resultDetails = { libraryPass: 'failed', libraryDiverged: [] };
      },
    });
    expect(settled.payload.tabBinding).toBeUndefined();
    expect(settled.payload.terminalStatus).toBe('completed');
    expect(settled.payload.result).toMatchObject({
      status: 'completed',
      success: true,
      effectiveProvider: 'anthropic',
      effectiveModel: 'sonnet',
      libraryPass: 'failed',
      libraryDiverged: [],
    });
  });
});
