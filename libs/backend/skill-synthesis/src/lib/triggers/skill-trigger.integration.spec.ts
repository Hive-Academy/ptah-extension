import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  PostToolUseCallbackRegistry,
  StopCallbackRegistry,
  SubagentStopCallbackRegistry,
  UserPromptExpansionCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { SkillTriggerService } from './skill-trigger.service';

function makeHarness() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const workspace = {
    getConfiguration: jest.fn(
      (_section: string, _key: string, defaultValue: unknown) => defaultValue,
    ),
  } as unknown as IWorkspaceProvider;
  const fs = {} as IFileSystemProvider;
  const subagentStopRegistry = new SubagentStopCallbackRegistry(logger);
  const postToolUseRegistry = new PostToolUseCallbackRegistry(logger);
  const userPromptExpansionRegistry = new UserPromptExpansionCallbackRegistry(logger);
  const stopRegistry = new StopCallbackRegistry(logger);
  const recordSkillEvent = jest.fn();
  const harvest = jest.fn().mockResolvedValue(undefined);
  const extract = jest.fn().mockResolvedValue({
    metrics: {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: null,
      durationMs: null,
      toolCount: null,
    },
    taskId: null,
  });
  const service = new SkillTriggerService(
    logger,
    workspace,
    fs,
    subagentStopRegistry,
    postToolUseRegistry,
    userPromptExpansionRegistry,
    { recordSkillEvent } as never,
    stopRegistry,
    { harvest } as never,
    { extract } as never,
  );
  return {
    service,
    subagentStopRegistry,
    postToolUseRegistry,
    userPromptExpansionRegistry,
    stopRegistry,
    recordSkillEvent,
    harvest,
    extract,
  };
}

describe('SkillTriggerService retained hook integration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('registers and disposes the four retained hooks', () => {
    const h = makeHarness();
    h.service.start();
    h.service.start();
    expect(h.subagentStopRegistry.size).toBe(1);
    expect(h.postToolUseRegistry.size).toBe(1);
    expect(h.userPromptExpansionRegistry.size).toBe(1);
    expect(h.stopRegistry.size).toBe(1);

    h.service.stop();
    expect(h.subagentStopRegistry.size).toBe(0);
    expect(h.postToolUseRegistry.size).toBe(0);
    expect(h.userPromptExpansionRegistry.size).toBe(0);
    expect(h.stopRegistry.size).toBe(0);
  });

  it('captures Skill and Task tool invocations', async () => {
    const h = makeHarness();
    h.service.start();
    h.postToolUseRegistry.notifyAll({
      toolName: 'Skill',
      toolInput: { command: '/review' },
      toolOutput: '',
      exitCode: 0,
      success: true,
      sessionId: 'session-1',
      workspaceRoot: '/ws',
      timestamp: 1000,
    });
    h.postToolUseRegistry.notifyAll({
      toolName: 'Task',
      toolInput: { subagent_type: 'general-purpose' },
      toolOutput: '',
      exitCode: 1,
      success: false,
      sessionId: 'session-1',
      workspaceRoot: '/ws',
      timestamp: 1001,
    });
    await jest.runAllTimersAsync();

    expect(h.recordSkillEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'review',
        source: 'tool-use',
        isError: false,
      }),
    );
    expect(h.recordSkillEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'general-purpose',
        source: 'subagent',
        isError: true,
      }),
    );
    h.service.stop();
  });

  it('captures prompt expansion and subagent completion invocations', async () => {
    const h = makeHarness();
    h.service.start();
    h.userPromptExpansionRegistry.notifyAll({
      skillSlug: 'review',
      expansionType: 'slash_command',
      commandArgs: '',
      sessionId: 'parent-1',
      workspaceRoot: '/ws',
      timestamp: 1000,
    });
    h.subagentStopRegistry.notifyAll({
      subagentSessionId: 'child-1',
      parentSessionId: 'parent-1',
      workspaceRoot: '/ws',
      agentId: 'agent-1',
      agentType: 'general-purpose',
      transcriptPath: '/tmp/child-1.jsonl',
      timestamp: 1001,
    });
    await jest.runAllTimersAsync();

    expect(h.recordSkillEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'review',
        source: 'slash-command',
        sessionId: 'parent-1',
      }),
    );
    expect(h.extract).toHaveBeenCalledWith('/tmp/child-1.jsonl');
    expect(h.recordSkillEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'general-purpose',
        source: 'subagent',
        sessionId: 'parent-1',
        runId: 'agent-1',
      }),
    );
    h.service.stop();
  });

  it('harvests specs after Stop for a workspace', async () => {
    const h = makeHarness();
    h.service.start();
    h.stopRegistry.notifyAll({
      sessionId: 'session-1',
      workspaceRoot: '/ws',
      lastAssistantMessage: null,
      effortLevel: null,
      hasBackgroundWork: false,
      timestamp: 1000,
    });
    await jest.advanceTimersByTimeAsync(90_000);
    expect(h.harvest).toHaveBeenCalledTimes(1);
    expect(h.harvest).toHaveBeenCalledWith('/ws');
    h.service.stop();
  });
});
