import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SkillSynthesisDiagnosticsService } from './diagnostics.service';
import type { SkillSynthesisService } from './skill-synthesis.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type {
  EligibilityHistogram,
  SkillSynthesisEvent,
} from './diagnostics.types';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(
  overrides: Partial<Record<string, unknown>> = {},
): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'skillSynthesis.triggers.sessionEnd': true,
    'skillSynthesis.triggers.idleMs': 600000,
    'skillSynthesis.triggers.bootScan': true,
    ...overrides,
  };
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, def: unknown) => cfg[key] ?? def,
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    getWorkspaceRoot: jest.fn(() => '/ws'),
    getWorkspaceFolders: jest.fn(() => ['/ws']),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function makeSynthesis(opts: {
  lastAnalyzeRunAt?: number | null;
  lastCuratorPassAt?: number | null;
  histogram?: EligibilityHistogram;
  events?: SkillSynthesisEvent[];
}): SkillSynthesisService {
  return {
    lastRunSummary: jest.fn(() => ({
      lastAnalyzeRunAt: opts.lastAnalyzeRunAt ?? null,
      lastCuratorPassAt: opts.lastCuratorPassAt ?? null,
    })),
    recentEvents: jest.fn(() => opts.events ?? []),
    getEligibilityHistogram: jest.fn(
      () =>
        opts.histogram ?? {
          tooFewTurns: 0,
          lowFidelity: 0,
          insufficientAbstraction: 0,
          accepted: 0,
        },
    ),
    pushEvent: jest.fn(),
  } as unknown as SkillSynthesisService;
}

function makeStore(
  stats = { candidates: 0, promoted: 0, rejected: 0, invocations: 0 },
  shouldThrow = false,
): SkillCandidateStore {
  return {
    getStats: jest.fn(() => {
      if (shouldThrow) throw new Error('db unavailable');
      return stats;
    }),
  } as unknown as SkillCandidateStore;
}

describe('SkillSynthesisDiagnosticsService', () => {
  it('returns snapshot with last-run + triggers + histogram + status counts', async () => {
    const t = 1700000000000;
    const events: SkillSynthesisEvent[] = [
      { kind: 'analyze-run', timestamp: t, sessionId: 's1' },
    ];
    const service = new SkillSynthesisDiagnosticsService(
      makeLogger(),
      makeSynthesis({
        lastAnalyzeRunAt: t,
        lastCuratorPassAt: t - 1000,
        histogram: {
          tooFewTurns: 2,
          lowFidelity: 1,
          insufficientAbstraction: 1,
          accepted: 4,
        },
        events,
      }),
      makeStore({
        candidates: 3,
        promoted: 5,
        rejected: 1,
        invocations: 12,
      }),
      makeWorkspace(),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.lastAnalyzeRunAt).toBe(t);
    expect(snap.lastCuratorPassAt).toBe(t - 1000);
    expect(snap.eligibilityHistogram).toEqual({
      tooFewTurns: 2,
      lowFidelity: 1,
      insufficientAbstraction: 1,
      accepted: 4,
    });
    expect(snap.byStatus).toEqual({
      candidate: 3,
      promoted: 5,
      rejected: 1,
      invocations: 12,
    });
    expect(snap.recentEvents).toHaveLength(1);
    expect(snap.triggers).toMatchObject({
      sessionEnd: true,
      idleMs: 600000,
      bootScan: true,
      subagentStop: { enabled: true },
      postToolUse: { enabled: true, minEditCount: 3 },
      maxAnalyzesPerHour: 6,
    });
  });

  it('reflects updated triggers from workspace settings', async () => {
    const service = new SkillSynthesisDiagnosticsService(
      makeLogger(),
      makeSynthesis({}),
      makeStore(),
      makeWorkspace({
        'skillSynthesis.triggers.sessionEnd': false,
        'skillSynthesis.triggers.idleMs': 60000,
        'skillSynthesis.triggers.bootScan': false,
      }),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.triggers).toMatchObject({
      sessionEnd: false,
      idleMs: 60000,
      bootScan: false,
    });
  });

  it('falls back to zero byStatus when store.getStats throws', async () => {
    const service = new SkillSynthesisDiagnosticsService(
      makeLogger(),
      makeSynthesis({}),
      makeStore(undefined, true),
      makeWorkspace(),
    );
    const snap = await service.getSnapshot('/ws');
    expect(snap.byStatus).toEqual({
      candidate: 0,
      promoted: 0,
      rejected: 0,
      invocations: 0,
    });
  });

  it('forwards eventLimit to the synthesis service recentEvents', async () => {
    const synthesis = makeSynthesis({});
    const service = new SkillSynthesisDiagnosticsService(
      makeLogger(),
      synthesis,
      makeStore(),
      makeWorkspace(),
    );
    await service.getSnapshot('/ws', 25);
    expect(synthesis.recentEvents).toHaveBeenCalledWith(25);
  });
});
