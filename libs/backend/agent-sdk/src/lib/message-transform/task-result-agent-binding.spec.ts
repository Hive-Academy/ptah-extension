import 'reflect-metadata';

import {
  SubagentRegistryService,
  type Logger,
} from '@ptah-extension/vscode-core';
import { SubagentHookHandler } from '../helpers/subagent-hook-handler';
import { SubagentStopCallbackRegistry } from '../helpers/subagent-stop-callback-registry';
import { SessionStatsOwnerService } from '../session-stats/session-stats-owner.service';
import type {
  HookInput,
  HookJSONOutput,
} from '../types/sdk-types/claude-sdk.types';
import type { TransformerHelpers } from './transformer-helpers';
import {
  bindTaskResultToHeldStart,
  readTaskResultAgentIds,
} from './task-result-agent-binding';

/**
 * TASK_2026_614 F.5 B1 / F-F, second half: a SubagentStart without a
 * `toolUseId` for an agent no record names yet is held, and the Task tool
 * result's exact `agentId:` line binds it to the Task's toolCallId — so stop,
 * steer and the budget stop can reach it. Runs the REAL hook handler and the
 * REAL registry.
 */

type HookFn = (
  input: HookInput,
  toolUseId: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput>;

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

const signal = new AbortController().signal;

function setup() {
  const logger = makeLogger();
  const registry = new SubagentRegistryService(logger);
  const handler = new SubagentHookHandler(
    logger,
    registry,
    new SubagentStopCallbackRegistry(logger),
    new SessionStatsOwnerService(),
  );
  const hooks = handler.createHooks('/workspace', 'parent-sess');
  const start = hooks.SubagentStart?.[0]?.hooks?.[0] as HookFn;
  const stop = hooks.SubagentStop?.[0]?.hooks?.[0] as HookFn;
  const helpers = {
    logger,
    subagentRegistry: registry,
  } as unknown as TransformerHelpers;
  return { logger, registry, start, stop, helpers };
}

function startInput(agentId: string, sessionId = 'parent-sess'): HookInput {
  return {
    hook_event_name: 'SubagentStart',
    session_id: sessionId,
    agent_id: agentId,
    agent_type: 'backend-developer',
  } as unknown as HookInput;
}

function taskResult(agentId: string): string {
  return `Done.\nagentId: ${agentId} (use SendMessage to continue this agent)`;
}

describe('readTaskResultAgentIds', () => {
  it('reads the agentId line from string and block-array content', () => {
    expect(readTaskResultAgentIds(taskResult('a1b2c3'))).toEqual(['a1b2c3']);
    expect(
      readTaskResultAgentIds([{ type: 'text', text: taskResult('a1b2c3') }]),
    ).toEqual(['a1b2c3']);
  });

  it('returns every distinct id, and none when no line is present', () => {
    expect(
      readTaskResultAgentIds('agentId: aaa1\nagentId: aaa1\nagentId: bbb2'),
    ).toEqual(['aaa1', 'bbb2']);
    expect(readTaskResultAgentIds('no id here')).toEqual([]);
  });
});

describe('Task result binds a held SubagentStart (F-F)', () => {
  it('binds a start without toolUseId when the Task result names its id — the agent becomes stoppable', async () => {
    const { logger, registry, start, helpers } = setup();

    await start(startInput('a1b2c3'), undefined, { signal });
    expect(registry.getRunningBySession('parent-sess')).toEqual([]);

    bindTaskResultToHeldStart('toolu_task_1', taskResult('a1b2c3'), helpers);

    const record = registry.get('toolu_task_1');
    expect(record).toEqual(
      expect.objectContaining({
        toolCallId: 'toolu_task_1',
        agentId: 'a1b2c3',
        agentType: 'backend-developer',
        parentSessionId: 'parent-sess',
        status: 'running',
      }),
    );
    // What subagent:stop and the budget stop resolve the agent through.
    expect(registry.getToolCallIdByAgentId('a1b2c3')).toBe('toolu_task_1');
    expect(
      registry.getRunningBySession('parent-sess').map((r) => r.toolCallId),
    ).toEqual(['toolu_task_1']);
    expect(registry.hasHeldUnboundStarts()).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stays unbound and WARNS when the Task result names an id no held start matches', async () => {
    const { logger, registry, start, helpers } = setup();

    await start(startInput('a1b2c3'), undefined, { signal });
    bindTaskResultToHeldStart('toolu_task_1', taskResult('ffff00'), helpers);

    expect(registry.get('toolu_task_1')).toBeNull();
    expect(registry.hasHeldUnboundStarts()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no held SubagentStart matches'),
      expect.objectContaining({ toolCallId: 'toolu_task_1', agentId: 'ffff00' }),
    );
  });

  it('stays unbound and WARNS when two held starts name the same id', async () => {
    const { logger, registry, start, helpers } = setup();

    await start(startInput('a1b2c3', 'parent-sess'), undefined, { signal });
    await start(startInput('a1b2c3', 'other-sess'), undefined, { signal });
    bindTaskResultToHeldStart('toolu_task_1', taskResult('a1b2c3'), helpers);

    expect(registry.get('toolu_task_1')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('several held SubagentStarts name this agentId'),
      expect.objectContaining({ candidateCount: 2 }),
    );
  });

  it('stays unbound and WARNS when the result names two different ids', async () => {
    const { logger, registry, start, helpers } = setup();

    await start(startInput('a1b2c3'), undefined, { signal });
    bindTaskResultToHeldStart(
      'toolu_task_1',
      'agentId: a1b2c3\nagentId: d4e5f6',
      helpers,
    );

    expect(registry.get('toolu_task_1')).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('names several agentIds'),
      expect.objectContaining({ agentIds: ['a1b2c3', 'd4e5f6'] }),
    );
  });

  it('drops the held start when SubagentStop arrives first, so a late result binds nothing', async () => {
    const { registry, start, stop, helpers } = setup();

    await start(startInput('a1b2c3'), undefined, { signal });
    await stop(
      {
        hook_event_name: 'SubagentStop',
        session_id: 'parent-sess',
        agent_id: 'a1b2c3',
        stop_hook_active: false,
      } as unknown as HookInput,
      undefined,
      { signal },
    );

    expect(registry.hasHeldUnboundStarts()).toBe(false);
    bindTaskResultToHeldStart('toolu_task_1', taskResult('a1b2c3'), helpers);
    expect(registry.get('toolu_task_1')).toBeNull();
  });

  it('does not scan tool results while nothing is held', () => {
    const { registry, helpers } = setup();
    const spy = jest.spyOn(registry, 'bindHeldStartToToolCall');

    bindTaskResultToHeldStart('toolu_read', taskResult('a1b2c3'), helpers);

    expect(spy).not.toHaveBeenCalled();
  });
});
