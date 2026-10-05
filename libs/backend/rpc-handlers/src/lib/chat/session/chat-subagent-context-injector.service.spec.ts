/**
 * ChatSubagentContextInjectorService — interrupted-agent context injection.
 *
 * Covers the post-TASK resume-contract fix:
 *  - prefix references the real resume contract (no Task "resume" parameter)
 *  - injection is non-destructive (records stay in the registry)
 *  - records are dropped after MAX_INJECTION_ATTEMPTS unconsumed injections
 *  - records whose transcript is confirmed ABSENT are removed and marked
 *    injected
 *  - records whose transcript state is INDETERMINATE survive untouched
 *    (TASK_2026_295)
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { SessionId, SubagentRecord } from '@ptah-extension/shared';

import {
  ChatSubagentContextInjectorService,
  MAX_INJECTION_ATTEMPTS,
} from './chat-subagent-context-injector.service';
import type { ChatPtahCliService } from '../ptah-cli/chat-ptah-cli.service';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

const SESSION = 'sess-1' as SessionId;
const WORKSPACE = 'D:/ws';
const TTL_ENV = 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL';
const GUIDANCE =
  'Resume a subagent only when its cache is warm. When it is cold, start a fresh subagent with a short brief.';

describe('ChatSubagentContextInjectorService', () => {
  let registry: SubagentRegistryService;
  let ptahCli: { probeSubagentTranscript: jest.Mock };
  let workspace: { getConfiguration: jest.Mock };
  let injector: ChatSubagentContextInjectorService;
  let savedTtlEnv: string | undefined;

  beforeEach(() => {
    savedTtlEnv = process.env[TTL_ENV];
    delete process.env[TTL_ENV];
    registry = new SubagentRegistryService(makeLogger());
    ptahCli = {
      probeSubagentTranscript: jest.fn().mockResolvedValue('present'),
    };
    workspace = { getConfiguration: jest.fn().mockReturnValue('auto') };
    injector = new ChatSubagentContextInjectorService(
      makeLogger(),
      registry,
      ptahCli as unknown as ChatPtahCliService,
      workspace as unknown as IWorkspaceProvider,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedTtlEnv === undefined) {
      delete process.env[TTL_ENV];
    } else {
      process.env[TTL_ENV] = savedTtlEnv;
    }
  });

  function registerInterrupted(toolCallId: string, agentId: string): void {
    registry.register({
      toolCallId,
      agentType: 'Explore',
      agentId,
      startedAt: Date.now(),
      parentSessionId: SESSION as string,
    });
    registry.update(toolCallId, {
      status: 'interrupted',
      interruptedAt: Date.now(),
    });
  }

  it('returns the prompt unchanged when no resumable agents exist', async () => {
    const result = await injector.injectInterruptedAgentsContext(
      'hello',
      SESSION,
      WORKSPACE,
    );

    expect(result.injected).toBe(false);
    expect(result.prompt).toBe('hello');
  });

  it('injects the prefix with the agentId and keeps the record in the registry', async () => {
    registerInterrupted('tc-1', 'abc1234');

    const result = await injector.injectInterruptedAgentsContext(
      'continue please',
      SESSION,
      WORKSPACE,
    );

    expect(result.injected).toBe(true);
    expect(result.prompt).toContain('[SYSTEM CONTEXT - INTERRUPTED AGENTS]');
    expect(result.prompt).toContain('Resume agent <agentId>');
    expect(result.prompt).not.toContain('"resume" parameter set to');
    expect(result.prompt.endsWith('continue please')).toBe(true);

    expect(registry.get('tc-1')).not.toBeNull();
    expect(registry.getInjectionAttempts('tc-1')).toBe(1);
  });

  it('re-injects on subsequent continues until the attempt cap', async () => {
    registerInterrupted('tc-1', 'abc1234');

    for (let i = 0; i < MAX_INJECTION_ATTEMPTS; i++) {
      const result = await injector.injectInterruptedAgentsContext(
        'msg',
        SESSION,
        WORKSPACE,
      );
      expect(result.injected).toBe(true);
    }

    const afterCap = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );
    expect(afterCap.injected).toBe(false);
    expect(registry.get('tc-1')).toBeNull();
    expect(registry.wasInjected('tc-1')).toBe(true);
  });

  it('stops injecting once the agent is resumed (re-registered with same agentId)', async () => {
    registerInterrupted('tc-1', 'abc1234');

    await injector.injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
    registry.register({
      toolCallId: 'tc-2',
      agentType: 'Explore',
      agentId: 'abc1234',
      startedAt: Date.now(),
      parentSessionId: SESSION as string,
    });

    const result = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );
    expect(result.injected).toBe(false);
    expect(registry.get('tc-1')).toBeNull();
  });

  it('removes agents whose transcript is confirmed absent and marks them injected', async () => {
    registerInterrupted('tc-1', 'abc1234');
    ptahCli.probeSubagentTranscript.mockResolvedValue('absent');

    const result = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );

    expect(result.injected).toBe(false);
    expect(registry.get('tc-1')).toBeNull();
    expect(registry.wasInjected('tc-1')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TASK_2026_295 — "could not determine" must never destroy resume state.
  //
  // The probe used to return a plain boolean, so an unusable parentSessionId
  // (notably '') produced a confident `false`. That reached the same branch as
  // a genuinely missing transcript: remove() plus markAsInjected(), which also
  // poisons clearedToolCallIds so registerFromHistoryEvents() refuses to
  // re-register the record on the next chat:resume. One bad id on one
  // chat:continue made the interrupted subagent unrecoverable for the life of
  // the workspace.
  // -------------------------------------------------------------------------

  it('KEEPS the record when the transcript state is indeterminate', async () => {
    registerInterrupted('tc-1', 'abc1234');
    ptahCli.probeSubagentTranscript.mockResolvedValue('indeterminate');

    const result = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );

    expect(result.injected).toBe(false);
    expect(registry.get('tc-1')).not.toBeNull();
    // The poison flag is what makes destruction permanent — it must stay off.
    expect(registry.wasInjected('tc-1')).toBe(false);
  });

  it('does not burn an injection attempt on an indeterminate probe', async () => {
    registerInterrupted('tc-1', 'abc1234');
    ptahCli.probeSubagentTranscript.mockResolvedValue('indeterminate');

    for (let i = 0; i < MAX_INJECTION_ATTEMPTS + 2; i++) {
      await injector.injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
    }

    expect(registry.getInjectionAttempts('tc-1')).toBe(0);
    expect(registry.get('tc-1')).not.toBeNull();
  });

  it('recovers: an indeterminate probe followed by a successful one still injects', async () => {
    registerInterrupted('tc-1', 'abc1234');
    ptahCli.probeSubagentTranscript.mockResolvedValueOnce('indeterminate');

    const first = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );
    expect(first.injected).toBe(false);

    ptahCli.probeSubagentTranscript.mockResolvedValue('present');
    const second = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );

    expect(second.injected).toBe(true);
    expect(second.prompt).toContain('Resume agent <agentId>');
  });

  it('KEEPS the record when there is no workspace path to probe against', async () => {
    registerInterrupted('tc-1', 'abc1234');

    const result = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      undefined,
    );

    expect(result.injected).toBe(false);
    expect(ptahCli.probeSubagentTranscript).not.toHaveBeenCalled();
    expect(registry.get('tc-1')).not.toBeNull();
    expect(registry.wasInjected('tc-1')).toBe(false);
  });

  it('lists all resumable agents in the prefix', async () => {
    registerInterrupted('tc-1', 'aaa1111');
    registerInterrupted('tc-2', 'bbb2222');

    const result = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );

    expect(result.prompt).toContain('agentId: aaa1111');
    expect(result.prompt).toContain('agentId: bbb2222');
  });

  // -------------------------------------------------------------------------
  // N2 — cache state per agent and the warm/cold resume guidance
  // -------------------------------------------------------------------------

  describe('cache state', () => {
    const T0 = 1_800_000_000_000;
    const MIN = 60_000;

    function at(ms: number): void {
      jest.spyOn(Date, 'now').mockReturnValue(ms);
    }

    it('marks a just-interrupted agent warm with the auto TTL (1h) and resumes it first', async () => {
      at(T0);
      registerInterrupted('tc-1', 'abc1234');

      const { prompt } = await injector.injectInterruptedAgentsContext(
        'msg',
        SESSION,
        WORKSPACE,
      );

      expect(prompt).toContain(
        'Explore agent (agentId: abc1234) - cache: warm (TTL 1h, idle 0 min)',
      );
      expect(prompt).toContain(GUIDANCE);
      expect(prompt).toContain('1. Your FIRST action should be to resume');
      expect(prompt).toContain('Resume agent <agentId>');
      expect(prompt).not.toContain('cache: cold');
      expect(prompt).not.toContain('start a fresh subagent of the same type');
      expect(workspace.getConfiguration).toHaveBeenCalledWith(
        'ptah',
        'agentOrchestration.subagentPromptCacheTtl',
        'auto',
      );
    });

    it('marks an agent cold once the idle time reaches the 5m TTL and never tells the model to resume it', async () => {
      workspace.getConfiguration.mockReturnValue('5m');
      at(T0);
      registerInterrupted('tc-1', 'abc1234');
      at(T0 + 10 * MIN);

      const { prompt, injected } =
        await injector.injectInterruptedAgentsContext(
          'msg',
          SESSION,
          WORKSPACE,
        );

      expect(injected).toBe(true);
      expect(prompt).toContain(
        'interrupted 10 min ago - cache: cold (TTL 5m, idle 10 min)',
      );
      expect(prompt).toContain(GUIDANCE);
      expect(prompt).not.toContain('Your FIRST action');
      expect(prompt).not.toContain('Resume agent abc1234');
      expect(prompt).toContain(
        '1. Do NOT resume the agents marked "cache: cold". For each of them, start a fresh subagent of the same type with a short brief',
      );
    });

    it('lets a valid host env override win over the setting', async () => {
      workspace.getConfiguration.mockReturnValue('1h');
      process.env[TTL_ENV] = '5m';
      at(T0);
      registerInterrupted('tc-1', 'abc1234');
      at(T0 + 6 * MIN);

      const { prompt } = await injector.injectInterruptedAgentsContext(
        'msg',
        SESSION,
        WORKSPACE,
      );

      expect(prompt).toContain('cache: cold (TTL 5m, idle 6 min)');
    });

    it('resumes only the warm agent when warm and cold agents are mixed', async () => {
      workspace.getConfiguration.mockReturnValue('5m');
      at(T0);
      registerInterrupted('tc-cold', 'cold111');
      at(T0 + 8 * MIN);
      registerInterrupted('tc-warm', 'warm222');

      const { prompt } = await injector.injectInterruptedAgentsContext(
        'msg',
        SESSION,
        WORKSPACE,
      );

      expect(prompt).toContain(
        'agentId: cold111) - interrupted 8 min ago - cache: cold (TTL 5m, idle 8 min)',
      );
      expect(prompt).toContain(
        'agentId: warm222) - cache: warm (TTL 5m, idle 0 min)',
      );
      expect(prompt).not.toContain('Resume agent warm222');
      expect(prompt).toContain('Resume agent <agentId>');
      expect(prompt).not.toContain('Resume agent cold111');
      expect(prompt).toContain('1. Your FIRST action should be to resume');
      expect(prompt).toContain('2. Do NOT resume the agents marked');
    });

    it('prints "idle unknown", not "idle 0 min", for a record with no recorded activity', async () => {
      at(T0);
      const restored: SubagentRecord = {
        toolCallId: 'tc-hist',
        agentType: 'Plan',
        agentId: 'hist999',
        status: 'interrupted',
        startedAt: T0 - MIN,
        interruptedAt: T0 - MIN,
        parentSessionId: SESSION as string,
      };
      expect(registry.restoreResumableBySession(SESSION, [restored])).toBe(1);

      const { prompt } = await injector.injectInterruptedAgentsContext(
        'msg',
        SESSION,
        WORKSPACE,
      );

      expect(prompt).toContain('cache: cold (TTL 1h, idle unknown)');
      expect(prompt).not.toContain('idle 0 min');
      expect(prompt).not.toContain('Resume agent hist999');
    });
  });

  // -------------------------------------------------------------------------
  // Component 10.2 — resume/fresh advice from the subagent budget monitor
  // -------------------------------------------------------------------------

  describe('resume advice', () => {
    const MIN = 60_000;
    const HANDOFF = 100_000;

    function withMonitor(
      snapshot:
        | {
            contextTokens: number;
            weightedUsed: number;
            stopped: boolean;
            budgetReached: boolean;
          }
        | undefined,
    ): ChatSubagentContextInjectorService {
      return new ChatSubagentContextInjectorService(
        makeLogger(),
        registry,
        ptahCli as unknown as ChatPtahCliService,
        workspace as unknown as IWorkspaceProvider,
        { getSnapshot: jest.fn().mockReturnValue(snapshot) } as never,
        {
          getConfig: jest.fn().mockReturnValue({
            subagentHandoffTokens: HANDOFF,
          }),
        } as never,
      );
    }

    const snap = (
      over: Partial<{
        contextTokens: number;
        stopped: boolean;
        budgetReached: boolean;
      }> = {},
    ) => ({
      contextTokens: 10_000,
      weightedUsed: 1_000,
      stopped: false,
      budgetReached: false,
      ...over,
    });

    it('leaves the text unchanged when no monitor is registered', async () => {
      registerInterrupted('tc-1', 'abc1234');
      const { prompt } = await injector.injectInterruptedAgentsContext(
        'msg',
        SESSION,
        WORKSPACE,
      );
      expect(prompt).not.toContain('advice:');
    });

    it('advises resume for a warm agent within budget', async () => {
      registerInterrupted('tc-1', 'abc1234');
      const { prompt } = await withMonitor(
        snap(),
      ).injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
      expect(prompt).toContain('advice: resume (cache warm, context within');
      expect(prompt).toContain('1. Your FIRST action should be to resume');
    });

    it('B-m3: no "advice: fresh" instruction when no agent is advised fresh', async () => {
      registerInterrupted('tc-1', 'abc1234');
      const { prompt } = await withMonitor(
        snap(),
      ).injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
      expect(prompt).toContain('advice: resume');
      expect(prompt).not.toContain('Where an agent is marked "advice: fresh"');
    });

    it('advises fresh with the cold reason for a cold agent', async () => {
      workspace.getConfiguration.mockReturnValue('5m');
      registerInterrupted('tc-1', 'abc1234');
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * MIN);
      const { prompt } = await withMonitor(
        snap(),
      ).injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
      expect(prompt).toContain('advice: fresh (cold)');
    });

    it('advises fresh when the context reached the handoff size, even if warm', async () => {
      registerInterrupted('tc-1', 'abc1234');
      const { prompt } = await withMonitor(
        snap({ contextTokens: HANDOFF }),
      ).injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
      expect(prompt).toContain('advice: fresh (context at handoff size)');
      expect(prompt).not.toContain('Your FIRST action');
      expect(prompt).toContain('Where an agent is marked "advice: fresh"');
    });

    it('advises fresh for a stopped agent and for a reached budget', async () => {
      registerInterrupted('tc-1', 'abc1234');
      const stopped = await withMonitor(
        snap({ stopped: true }),
      ).injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
      expect(stopped.prompt).toContain('advice: fresh (stopped)');

      const budget = await withMonitor(
        snap({ budgetReached: true }),
      ).injectInterruptedAgentsContext('msg', SESSION, WORKSPACE);
      expect(budget.prompt).toContain('advice: fresh (budget reached)');
    });
  });
});
