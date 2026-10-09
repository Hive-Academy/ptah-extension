/**
 * HarnessLlmRunner — provider and model resolve together for the harness's
 * workspace, the way a chat session resolves them.
 *
 * The regression: the one-shot rode the process-wide auth env (the provider
 * configured last) while the model came from the settings, so after a
 * provider + model change the new provider was sent the previous model id.
 */

import 'reflect-metadata';

jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual('@ptah-extension/agent-sdk'),
  SdkStreamProcessor: jest.fn().mockImplementation(() => ({
    process: jest.fn().mockResolvedValue({ structuredOutput: { ok: true } }),
  })),
}));

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  InternalQueryService,
  IWorkspaceLlmResolver,
  WorkspaceLlmSnapshot,
} from '@ptah-extension/agent-sdk';
import { HarnessLlmRunner } from './harness-llm-runner.service';
import type { HarnessStreamBroadcaster } from '../streaming/harness-stream-broadcaster.service';

function makeRunner(snapshot: WorkspaceLlmSnapshot) {
  const execute = jest.fn().mockResolvedValue({
    stream: (async function* () {
      /* no messages */
    })(),
    close: jest.fn(),
  });
  const resolveForPath = jest.fn(async () => snapshot);
  const broadcaster = {
    createStreamEmitter: jest.fn(() => ({ emitter: {}, operationId: 'op-1' })),
    teeStreamWithFlatEvents: jest.fn((stream: unknown) => stream),
    broadcastComplete: jest.fn(),
    broadcastFlatComplete: jest.fn(),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const runner = new HarnessLlmRunner(
    logger,
    { execute } as unknown as InternalQueryService,
    broadcaster as unknown as HarnessStreamBroadcaster,
    { resolveForPath } as IWorkspaceLlmResolver,
  );
  return { runner, execute, resolveForPath, broadcaster };
}

const ARGS = {
  operation: 'design-agents',
  serviceTag: '[Test]',
  timeoutMs: 60_000,
  execute: {
    cwd: '/ws/project-a',
    prompt: 'p',
    systemPromptAppend: 's',
    mcpServerRunning: false,
    maxTurns: 1,
  },
} as unknown as Parameters<HarnessLlmRunner['run']>[0];

describe('HarnessLlmRunner — workspace provider and model', () => {
  it('runs on the provider and model of ONE snapshot resolved for its cwd', async () => {
    const auth = {
      env: { ANTHROPIC_AUTH_TOKEN: 'moonshot-key' },
      baseUrl: 'https://api.moonshot.ai/anthropic',
    };
    const { runner, execute, resolveForPath } = makeRunner({
      providerId: 'moonshot',
      model: 'kimi-k2.5',
      auth,
    });

    const result = await runner.run(ARGS);

    expect(resolveForPath).toHaveBeenCalledWith('/ws/project-a', {
      requestedModel: undefined,
    });
    const config = execute.mock.calls[0][0];
    expect(config.model).toBe('kimi-k2.5');
    expect(config.auth).toBe(auth);
    expect(config.cwd).toBe('/ws/project-a');
    expect(result.structuredOutput).toEqual({ ok: true });
  });

  it('passes a caller model to the resolver to validate rather than sending it as is', async () => {
    const { runner, execute, resolveForPath } = makeRunner({
      providerId: 'moonshot',
      model: 'kimi-k2.5',
      auth: { env: {} },
    });

    await runner.run({
      ...ARGS,
      execute: { ...ARGS.execute, model: 'gpt-4o' },
    });

    expect(resolveForPath).toHaveBeenCalledWith('/ws/project-a', {
      requestedModel: 'gpt-4o',
    });
    expect(execute.mock.calls[0][0].model).toBe('kimi-k2.5');
  });

  it('with no isolated snapshot, omits auth and still uses the snapshot model', async () => {
    const { runner, execute } = makeRunner({
      providerId: 'openrouter',
      model: 'saved-model',
    });

    await runner.run(ARGS);

    const config = execute.mock.calls[0][0];
    expect(config.model).toBe('saved-model');
    expect(config).not.toHaveProperty('auth');
  });

  it('when the snapshot cannot be resolved, clears the abort timer and broadcasts failure', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    const { runner, execute, resolveForPath, broadcaster } = makeRunner({
      providerId: 'moonshot',
      model: 'kimi-k2.5',
    });
    resolveForPath.mockRejectedValueOnce(new Error('settings unreadable'));

    await expect(runner.run(ARGS)).rejects.toThrow('settings unreadable');

    expect(execute).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    expect(broadcaster.broadcastComplete).toHaveBeenCalledWith(
      'design-agents',
      'op-1',
      false,
      'settings unreadable',
    );
    expect(broadcaster.broadcastFlatComplete).toHaveBeenCalledWith(
      'op-1',
      false,
      'settings unreadable',
    );
    clearSpy.mockRestore();
  });
});
