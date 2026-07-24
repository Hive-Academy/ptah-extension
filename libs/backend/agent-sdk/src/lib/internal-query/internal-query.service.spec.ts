import 'reflect-metadata';

import { InternalQueryService } from './internal-query.service';
import type { InternalQueryConfig } from './internal-query.types';
import type {
  SdkQueryRunner,
  OneShotRunInput,
  OneShotRunResult,
} from '../helpers/sdk-query-runner.service';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import { createFakeAsyncGenerator } from '@ptah-extension/shared/testing';

interface RunnerHarness {
  runner: { runOneShot: jest.Mock };
  service: InternalQueryService;
  result: OneShotRunResult;
}

function makeRunnerHarness(
  resultOverrides: Partial<OneShotRunResult> = {},
): RunnerHarness {
  const stream =
    resultOverrides.stream ??
    (createFakeAsyncGenerator<SDKMessage>(
      [],
    ) as unknown as AsyncIterable<SDKMessage>);
  const result: OneShotRunResult = {
    stream,
    abort: resultOverrides.abort ?? jest.fn(),
    close: resultOverrides.close ?? jest.fn(),
  };
  const runner = {
    runOneShot: jest.fn().mockResolvedValue(result),
  };
  const service = new InternalQueryService(runner as unknown as SdkQueryRunner);
  return { runner, service, result };
}

function makeConfig(
  overrides: Partial<InternalQueryConfig> = {},
): InternalQueryConfig {
  return {
    cwd: '/fake/workspace',
    model: 'claude-sonnet-4-20250514',
    prompt: 'Analyze this workspace',
    mcpServerRunning: false,
    ...overrides,
  };
}

describe('InternalQueryService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute() — delegation to SdkQueryRunner', () => {
    it('delegates to runner.runOneShot exactly once', async () => {
      const h = makeRunnerHarness();

      await h.service.execute(makeConfig());

      expect(h.runner.runOneShot).toHaveBeenCalledTimes(1);
    });

    it('returns the OneShotRunResult produced by the runner verbatim', async () => {
      const h = makeRunnerHarness();

      const handle = await h.service.execute(makeConfig());

      expect(handle).toBe(h.result);
    });

    it('forwards every InternalQueryConfig field with mode set to "oneShot"', async () => {
      const h = makeRunnerHarness();
      const abortController = new AbortController();
      const outputFormat = {
        type: 'json_schema',
        schema: { type: 'object', properties: {} },
      } as unknown as InternalQueryConfig['outputFormat'];

      const config: InternalQueryConfig = {
        cwd: '/work',
        model: 'opus',
        prompt: 'do the thing',
        systemPromptAppend: 'return JSON',
        mcpServerRunning: true,
        mcpPort: 51820,
        maxTurns: 12,
        outputFormat,
        abortController,
        pluginPaths: ['/p1', '/p2'],
      };

      await h.service.execute(config);

      const [input] = h.runner.runOneShot.mock.calls[0] as [OneShotRunInput];
      expect(input).toEqual({
        mode: 'oneShot',
        cwd: '/work',
        model: 'opus',
        prompt: 'do the thing',
        systemPromptAppend: 'return JSON',
        mcpServerRunning: true,
        mcpPort: 51820,
        maxTurns: 12,
        outputFormat,
        abortController,
        pluginPaths: ['/p1', '/p2'],
      });
    });

    it('forwards optional fields as undefined when omitted from the config', async () => {
      const h = makeRunnerHarness();

      await h.service.execute(makeConfig());

      const [input] = h.runner.runOneShot.mock.calls[0] as [OneShotRunInput];
      expect(input.mode).toBe('oneShot');
      expect(input.systemPromptAppend).toBeUndefined();
      expect(input.mcpPort).toBeUndefined();
      expect(input.maxTurns).toBeUndefined();
      expect(input.outputFormat).toBeUndefined();
      expect(input.abortController).toBeUndefined();
      expect(input.pluginPaths).toBeUndefined();
    });

    it('propagates rejections thrown by the runner', async () => {
      const h = makeRunnerHarness();
      const boom = new Error('runner boom');
      h.runner.runOneShot.mockRejectedValueOnce(boom);

      await expect(h.service.execute(makeConfig())).rejects.toBe(boom);
    });
  });
});
