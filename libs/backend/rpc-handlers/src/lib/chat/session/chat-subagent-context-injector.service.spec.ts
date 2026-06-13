/**
 * ChatSubagentContextInjectorService — interrupted-agent context injection.
 *
 * Covers the post-TASK resume-contract fix:
 *  - prefix references the real resume contract (no Task "resume" parameter)
 *  - injection is non-destructive (records stay in the registry)
 *  - records are dropped after MAX_INJECTION_ATTEMPTS unconsumed injections
 *  - records without an on-disk transcript are removed and marked injected
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
  let ptahCli: { hasSubagentTranscript: jest.Mock };
  let injector: ChatSubagentContextInjectorService;

  beforeEach(() => {
    registry = new SubagentRegistryService(makeLogger());
    ptahCli = { hasSubagentTranscript: jest.fn().mockResolvedValue(true) };
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

  it('removes agents without a transcript on disk and marks them injected', async () => {
    registerInterrupted('tc-1', 'abc1234');
    ptahCli.hasSubagentTranscript.mockResolvedValue(false);

    const result = await injector.injectInterruptedAgentsContext(
      'msg',
      SESSION,
      WORKSPACE,
    );

    expect(result.injected).toBe(false);
    expect(registry.get('tc-1')).toBeNull();
    expect(registry.wasInjected('tc-1')).toBe(true);
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
