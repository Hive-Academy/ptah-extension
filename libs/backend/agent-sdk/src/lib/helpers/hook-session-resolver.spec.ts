/**
 * Hook session identity — the payload-first / reject-empty rule (TASK_2026_295).
 *
 * Two layers are pinned here:
 *   1. The resolver itself: `''` from either source means absent, and the
 *      function returns `null` rather than `''` so no caller can publish one.
 *   2. Every hook handler that fans a payload into a callback registry. Seven
 *      of them resolved payload-first but never rejected the result, so a query
 *      whose closure id was still `''` (the case for a brand-new session, where
 *      `SdkQueryOptionsBuilder` passes `sessionId ?? ''` and the real id only
 *      arrives later in the system `init` message) pushed `sessionId: ''` into
 *      their subscribers.
 *
 * The table below drives the real handler classes, not a stand-in: the point is
 * that the rule holds for each one, and that a new handler added without it
 * fails here.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  HookJSONOutput,
} from '../types/sdk-types/claude-sdk.types';

import { resolveHookCwd, resolveHookSessionId } from './hook-session-resolver';
import { PostToolUseHookHandler } from './post-tool-use-hook-handler';
import { SessionEndHookHandler } from './session-end-hook-handler';
import { SessionStartHookHandler } from './session-start-hook-handler';
import { ToolFailureHookHandler } from './tool-failure-hook-handler';
import { UserPromptExpansionHookHandler } from './user-prompt-expansion-hook-handler';
import { UserPromptSubmitHookHandler } from './user-prompt-submit-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

interface RegistryStub {
  size: number;
  notifyAll: jest.Mock;
}

function makeRegistryStub(): RegistryStub {
  return { size: 1, notifyAll: jest.fn() };
}

describe('resolveHookSessionId / resolveHookCwd', () => {
  it('prefers the payload value over the closure value', () => {
    expect(resolveHookSessionId('from-payload', 'from-closure')).toBe(
      'from-payload',
    );
    expect(resolveHookCwd('/payload', '/closure')).toBe('/payload');
  });

  it('treats an empty payload value as absent rather than as a valid id', () => {
    expect(resolveHookSessionId('', 'from-closure')).toBe('from-closure');
    expect(resolveHookCwd('', '/closure')).toBe('/closure');
  });

  it('returns null — never an empty string — when neither source has a value', () => {
    expect(resolveHookSessionId('', '')).toBeNull();
    expect(resolveHookSessionId(undefined, undefined)).toBeNull();
    expect(resolveHookSessionId(undefined, null)).toBeNull();
    expect(resolveHookCwd(undefined, null)).toBeNull();
  });
});

interface HandlerCase {
  readonly name: string;
  readonly event: HookEvent;
  readonly build: (
    logger: Logger,
    registry: RegistryStub,
  ) => { createHooks(sessionId: string, cwd: string): HooksRecord };
  readonly input: Record<string, unknown>;
}

type HooksRecord = Partial<Record<HookEvent, HookCallbackMatcher[]>>;

const CASES: HandlerCase[] = [
  {
    name: 'PostToolUseHookHandler',
    event: 'PostToolUse',
    build: (logger, registry) =>
      new PostToolUseHookHandler(
        logger,
        registry as unknown as ConstructorParameters<
          typeof PostToolUseHookHandler
        >[1],
      ),
    input: {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { exit_code: 0 },
    },
  },
  {
    name: 'SessionEndHookHandler',
    event: 'SessionEnd',
    build: (logger, registry) =>
      new SessionEndHookHandler(
        logger,
        registry as unknown as ConstructorParameters<
          typeof SessionEndHookHandler
        >[1],
      ),
    input: { hook_event_name: 'SessionEnd', reason: 'clear' },
  },
  {
    name: 'SessionStartHookHandler',
    event: 'SessionStart',
    build: (logger, registry) =>
      new SessionStartHookHandler(
        logger,
        registry as unknown as ConstructorParameters<
          typeof SessionStartHookHandler
        >[1],
      ),
    input: { hook_event_name: 'SessionStart', source: 'startup' },
  },
  {
    name: 'ToolFailureHookHandler',
    event: 'PostToolUseFailure',
    build: (logger, registry) =>
      new ToolFailureHookHandler(
        logger,
        registry as unknown as ConstructorParameters<
          typeof ToolFailureHookHandler
        >[1],
      ),
    input: {
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      error: 'boom',
    },
  },
  {
    name: 'UserPromptExpansionHookHandler',
    event: 'UserPromptExpansion',
    build: (logger, registry) =>
      new UserPromptExpansionHookHandler(
        logger,
        registry as unknown as ConstructorParameters<
          typeof UserPromptExpansionHookHandler
        >[1],
      ),
    input: {
      hook_event_name: 'UserPromptExpansion',
      command_name: 'caveman',
      expansion_type: 'skill',
      command_args: '',
    },
  },
  {
    name: 'UserPromptSubmitHookHandler',
    event: 'UserPromptSubmit',
    build: (logger, registry) =>
      new UserPromptSubmitHookHandler(
        logger,
        registry as unknown as ConstructorParameters<
          typeof UserPromptSubmitHookHandler
        >[1],
      ),
    input: { hook_event_name: 'UserPromptSubmit', prompt: 'hello' },
  },
];

type HookCallback = (
  input: HookInput,
  toolUseId: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput>;

function callbackFor(hooks: HooksRecord, event: HookEvent): HookCallback {
  const fn = hooks[event]?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as HookCallback;
}

describe.each(CASES)(
  '$name — session id fan-out rule (TASK_2026_295)',
  ({ event, build, input }) => {
    it('fans out the payload session_id when the closure id is empty', async () => {
      const logger = makeLogger();
      const registry = makeRegistryStub();
      const hooks = build(logger, registry).createHooks('', '/repo');

      const result = await callbackFor(hooks, event)(
        { ...input, session_id: 'sdk-real-id' } as unknown as HookInput,
        undefined,
        { signal: new AbortController().signal },
      );

      expect(result).toEqual({ continue: true });
      expect(registry.notifyAll).toHaveBeenCalledTimes(1);
      expect(registry.notifyAll).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sdk-real-id' }),
      );
    });

    it('falls back to the closure id when the payload carries an empty one', async () => {
      const logger = makeLogger();
      const registry = makeRegistryStub();
      const hooks = build(logger, registry).createHooks('closure-id', '/repo');

      await callbackFor(hooks, event)(
        { ...input, session_id: '' } as unknown as HookInput,
        undefined,
        { signal: new AbortController().signal },
      );

      expect(registry.notifyAll).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'closure-id' }),
      );
    });

    it('publishes NOTHING rather than an empty sessionId when neither source has one', async () => {
      const logger = makeLogger();
      const registry = makeRegistryStub();
      const hooks = build(logger, registry).createHooks('', '/repo');

      const result = await callbackFor(hooks, event)(
        { ...input, session_id: '' } as unknown as HookInput,
        undefined,
        { signal: new AbortController().signal },
      );

      // Never block the SDK...
      expect(result).toEqual({ continue: true });
      // ...but never hand a subscriber an id that addresses no session either.
      expect(registry.notifyAll).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('missing sessionId'),
        expect.anything(),
      );
    });
  },
);
