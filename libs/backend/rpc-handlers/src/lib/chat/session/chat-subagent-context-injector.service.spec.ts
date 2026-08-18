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
import type { SessionId } from '@ptah-extension/shared';

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

describe('ChatSubagentContextInjectorService', () => {
  let registry: SubagentRegistryService;
  let ptahCli: { probeSubagentTranscript: jest.Mock };
  let injector: ChatSubagentContextInjectorService;

  beforeEach(() => {
    registry = new SubagentRegistryService(makeLogger());
    ptahCli = {
      probeSubagentTranscript: jest.fn().mockResolvedValue('present'),
    };
    injector = new ChatSubagentContextInjectorService(
      makeLogger(),
      registry,
      ptahCli as unknown as ChatPtahCliService,
    );
  });

  function registerInterrupted(toolCallId: string, agentId: string): void {
    registry.register({
      toolCallId,
      sessionId: SESSION as string,
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
    expect(result.prompt).toContain('Resume agent abc1234');
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
      sessionId: SESSION as string,
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
    expect(second.prompt).toContain('Resume agent abc1234');
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
});
