import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import {
  UserPromptExpansionCallbackRegistry,
  type UserPromptExpansionPayload,
} from './user-prompt-expansion-callback-registry';
import { UserPromptExpansionHookHandler } from './user-prompt-expansion-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

type HookFn = (
  input: HookInput,
  toolUseId: string | undefined,
  options: { signal: AbortSignal },
) => Promise<Record<string, unknown>>;

function getHookCallback(
  handler: UserPromptExpansionHookHandler,
  sessionId: string | undefined,
): HookFn {
  const fn = handler.createHooks(sessionId, '/workspace').UserPromptExpansion?.[0]
    ?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as HookFn;
}

function expansionInput(extra: Record<string, unknown> = {}): HookInput {
  return {
    hook_event_name: 'UserPromptExpansion',
    session_id: 'sdk-sess',
    cwd: '/hook-cwd',
    expansion_type: 'slash_command',
    command_name: 'orchestrate',
    command_args: 'TASK_2026_123',
    prompt: '/orchestrate TASK_2026_123',
    ...extra,
  } as unknown as HookInput;
}

const SIGNAL = { signal: new AbortController().signal };

describe('UserPromptExpansionHookHandler', () => {
  function setup(): {
    fn: HookFn;
    captured: UserPromptExpansionPayload[];
    logger: jest.Mocked<Logger>;
  } {
    const logger = makeLogger();
    const registry = new UserPromptExpansionCallbackRegistry(logger);
    const captured: UserPromptExpansionPayload[] = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new UserPromptExpansionHookHandler(logger, registry);
    return { fn: getHookCallback(handler, 'closure-sess'), captured, logger };
  }

  it('maps a main-thread expansion without an agentId key', async () => {
    const { fn, captured } = setup();

    const result = await fn(expansionInput(), undefined, SIGNAL);

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        skillSlug: 'orchestrate',
        expansionType: 'slash_command',
        commandArgs: 'TASK_2026_123',
        sessionId: 'sdk-sess',
        workspaceRoot: '/workspace',
      }),
    );
    expect('agentId' in captured[0]).toBe(false);
  });

  it('carries agentId when the expansion fired inside a subagent', async () => {
    const { fn, captured } = setup();

    await fn(expansionInput({ agent_id: 'agent-9' }), undefined, SIGNAL);

    expect(captured[0].agentId).toBe('agent-9');
  });

  it('omits agentId for an empty agent_id', async () => {
    const { fn, captured } = setup();

    await fn(expansionInput({ agent_id: '' }), undefined, SIGNAL);

    expect('agentId' in captured[0]).toBe(false);
  });

  it('ignores other hook events', async () => {
    const { fn, captured } = setup();

    const result = await fn(
      { hook_event_name: 'SessionStart' } as unknown as HookInput,
      undefined,
      SIGNAL,
    );

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(0);
  });
});
