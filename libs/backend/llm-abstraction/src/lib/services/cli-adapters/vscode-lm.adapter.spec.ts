/**
 * VsCodeLmAdapter Unit Tests
 * TASK_2025_158 Batch 4, Task 4.5
 *
 * Tests: detect(), runSdk(), abort/cancellation, output streaming,
 *        edge cases (no models available, send request errors).
 */

// ---- Mock vscode before any imports ----

/** Tracks dispose() calls on CancellationTokenSource */
const mockDispose = jest.fn();
const mockCancel = jest.fn();

/** Fake CancellationTokenSource with token property */
function FakeCancellationTokenSource(this: {
  token: { isCancellationRequested: boolean };
  cancel: jest.Mock;
  dispose: jest.Mock;
}): void {
  this.token = { isCancellationRequested: false };
  this.cancel = mockCancel;
  this.dispose = mockDispose;
}

const mockSelectChatModels = jest.fn();
const mockLanguageModelChatMessageUser = jest.fn((content: string) => ({
  role: 'user',
  content,
}));

jest.mock(
  'vscode',
  () => ({
    lm: {
      selectChatModels: mockSelectChatModels,
    },
    LanguageModelChatMessage: {
      User: mockLanguageModelChatMessageUser,
    },
    CancellationTokenSource: FakeCancellationTokenSource,
  }),
  { virtual: true }
);

// Import adapter AFTER mocks are declared
import { VsCodeLmAdapter } from './vscode-lm.adapter';
import type { SdkHandle } from './cli-adapter.interface';

// ---- Test Helpers ----

interface FakeModel {
  id: string;
  name: string;
  vendor: string;
  family: string;
  version: string;
  maxInputTokens: number;
  sendRequest: jest.Mock;
}

/**
 * Create a fake VS Code Language Model that returns an async iterable of text chunks.
 */
function createFakeModel(
  chunks: string[],
  options?: { throwError?: Error }
): FakeModel {
  const model: FakeModel = {
    id: 'copilot-claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    vendor: 'copilot',
    family: 'claude-3.5-sonnet',
    version: '1',
    maxInputTokens: 200000,
    sendRequest: jest.fn(),
  };

  if (options?.throwError) {
    model.sendRequest.mockRejectedValue(options.throwError);
  } else {
    // Create an async iterable for response.text
    const textIterable = {
      [Symbol.asyncIterator]: () => {
        let index = 0;
        return {
          async next(): Promise<IteratorResult<string>> {
            if (index < chunks.length) {
              return { done: false, value: chunks[index++] };
            }
            return { done: true, value: undefined as never };
          },
        };
      },
    };

    model.sendRequest.mockResolvedValue({
      text: textIterable,
    });
  }

  return model;
}

describe('VsCodeLmAdapter', () => {
  let adapter: VsCodeLmAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new VsCodeLmAdapter();
  });

  describe('properties', () => {
    it('should have name "vscode-lm"', () => {
      expect(adapter.name).toBe('vscode-lm');
    });

    it('should have displayName "VS Code LM"', () => {
      expect(adapter.displayName).toBe('VS Code LM');
    });
  });

  describe('detect()', () => {
    it('should return installed: true when VS Code LM models are available', async () => {
      const fakeModel = createFakeModel([]);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const result = await adapter.detect();

      expect(result.cli).toBe('vscode-lm');
      expect(result.installed).toBe(true);
      expect(result.version).toBe('Claude 3.5 Sonnet (copilot)');
      expect(result.supportsSteer).toBe(false);
    });

    it('should return installed: false when no models are available', async () => {
      mockSelectChatModels.mockResolvedValue([]);

      const result = await adapter.detect();

      expect(result.cli).toBe('vscode-lm');
      expect(result.installed).toBe(false);
      expect(result.supportsSteer).toBe(false);
    });

    it('should return installed: false when selectChatModels throws', async () => {
      mockSelectChatModels.mockRejectedValue(
        new Error('VS Code LM API unavailable')
      );

      const result = await adapter.detect();

      expect(result.cli).toBe('vscode-lm');
      expect(result.installed).toBe(false);
    });
  });

  describe('buildCommand()', () => {
    it('should return a dummy command with task prompt', () => {
      const cmd = adapter.buildCommand({
        task: 'Write a test',
        workingDirectory: '/project',
      });

      expect(cmd.binary).toBe('vscode-lm');
      expect(cmd.args).toContain('Write a test');
    });
  });

  describe('supportsSteer()', () => {
    it('should return false', () => {
      expect(adapter.supportsSteer()).toBe(false);
    });
  });

  describe('parseOutput()', () => {
    it('should return raw output without transformation', () => {
      const raw = 'Hello World\nLine 2';
      expect(adapter.parseOutput(raw)).toBe(raw);
    });
  });

  describe('runSdk()', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/project/root',
    };

    it('should throw when no models are available', async () => {
      mockSelectChatModels.mockResolvedValue([]);

      await expect(adapter.runSdk(defaultOptions)).rejects.toThrow(
        /No VS Code Language Models available/
      );
    });

    it('should send request to the first available model when no Claude model exists', async () => {
      const fakeModel = createFakeModel(['Hello']);
      fakeModel.family = 'gpt-4';
      fakeModel.id = 'copilot-gpt-4';
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle: SdkHandle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      expect(fakeModel.sendRequest).toHaveBeenCalledTimes(1);
      const [messages, options, token] = fakeModel.sendRequest.mock.calls[0];
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        role: 'user',
        content: 'Implement feature X',
      });
      expect(options).toEqual({});
      expect(token).toHaveProperty('isCancellationRequested');
    });

    it('should prefer a Claude model when multiple models are available', async () => {
      const gptModel = createFakeModel(['GPT response']);
      gptModel.family = 'gpt-4';
      gptModel.id = 'copilot-gpt-4';
      gptModel.name = 'GPT-4';

      const claudeModel = createFakeModel(['Claude response']);
      claudeModel.family = 'claude-3.5-sonnet';
      claudeModel.id = 'copilot-claude-3.5-sonnet';
      claudeModel.name = 'Claude 3.5 Sonnet';

      mockSelectChatModels.mockResolvedValue([gptModel, claudeModel]);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      // Claude model should be selected, not the first (GPT)
      expect(claudeModel.sendRequest).toHaveBeenCalledTimes(1);
      expect(gptModel.sendRequest).not.toHaveBeenCalled();
    });

    it('should include file context in the task prompt', async () => {
      const fakeModel = createFakeModel(['Done']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk({
        ...defaultOptions,
        files: ['src/app.ts', 'src/utils.ts'],
      });
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      // The LanguageModelChatMessage.User was called with the full prompt
      const promptArg = mockLanguageModelChatMessageUser.mock
        .calls[0][0] as string;
      expect(promptArg).toContain('Focus on these files:');
      expect(promptArg).toContain('- src/app.ts');
      expect(promptArg).toContain('- src/utils.ts');
    });

    it('should stream text chunks to onOutput callback', async () => {
      const fakeModel = createFakeModel(['Hello ', 'World', '! How are you?']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      // Should contain all chunks plus trailing newline
      expect(output).toContain('Hello ');
      expect(output).toContain('World');
      expect(output).toContain('! How are you?');
      expect(output[output.length - 1]).toBe('\n');
    });

    it('should resolve done with 0 on successful completion', async () => {
      const fakeModel = createFakeModel(['Response text']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      const exitCode = await handle.done;
      expect(exitCode).toBe(0);
    });

    it('should resolve done with 1 on sendRequest error', async () => {
      const fakeModel = createFakeModel([]);
      // Use a delayed rejection so onOutput callback is registered before the error fires
      fakeModel.sendRequest.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('Model request failed')), 5);
          })
      );
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      const exitCode = await handle.done;

      expect(exitCode).toBe(1);
      expect(output.some((o) => o.includes('Model request failed'))).toBe(true);
    });

    it('should return an AbortController for the abort field', async () => {
      const fakeModel = createFakeModel(['text']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      expect(handle.abort).toBeInstanceOf(AbortController);
    });

    it('should support multiple onOutput callbacks', async () => {
      const fakeModel = createFakeModel(['chunk']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);

      const output1: string[] = [];
      const output2: string[] = [];
      handle.onOutput((data: string) => output1.push(data));
      handle.onOutput((data: string) => output2.push(data));

      await handle.done;

      expect(output1).toContain('chunk');
      expect(output2).toContain('chunk');
    });

    it('should cancel CancellationTokenSource when abort is called', async () => {
      // Create a model that blocks until abort, then yields another chunk
      // so the abort check inside the for-await loop fires
      let abortResolve: (() => void) | undefined;
      const waitForAbort = new Promise<void>((resolve) => {
        abortResolve = resolve;
      });

      const fakeModel = createFakeModel([]);
      // Override sendRequest to return a blocking async iterable
      fakeModel.sendRequest.mockImplementation(() => {
        let callCount = 0;
        const textIterable = {
          [Symbol.asyncIterator]: () => ({
            async next(): Promise<IteratorResult<string>> {
              callCount++;
              if (callCount === 1) {
                // First chunk: returned immediately
                return { done: false, value: 'Working...' };
              }
              if (callCount === 2) {
                // Second call: block until abort happens
                await waitForAbort;
                // After unblocking, yield another chunk so the for-await body
                // runs and the abort signal check fires
                return { done: false, value: 'More...' };
              }
              // Third call: done
              return { done: true, value: undefined as never };
            },
          }),
        };
        return Promise.resolve({ text: textIterable });
      });
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      // Give async iteration time to start and process first chunk
      await new Promise((r) => setTimeout(r, 10));

      // Abort and unblock the waiting iterator
      handle.abort.abort();
      abortResolve?.();

      const exitCode = await handle.done;

      // Should have cancelled the CancellationTokenSource via the abort bridge
      expect(mockCancel).toHaveBeenCalled();
      // Should exit with code 1 (aborted)
      expect(exitCode).toBe(1);
    });

    it('should resolve done with 1 when aborted (no error emitted)', async () => {
      const fakeModel = createFakeModel([]);
      // Simulate cancellation error from VS Code LM API
      fakeModel.sendRequest.mockRejectedValue(
        new Error('Request was cancelled')
      );
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      // Signal abort before the promise resolves
      handle.abort.abort();

      const exitCode = await handle.done;
      expect(exitCode).toBe(1);
    });

    it('should dispose CancellationTokenSource after completion', async () => {
      const fakeModel = createFakeModel(['Done']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      expect(mockDispose).toHaveBeenCalled();
    });

    it('should buffer output emitted before onOutput is registered', async () => {
      const fakeModel = createFakeModel(['Early ', 'data']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk(defaultOptions);

      // Small delay to let the IIFE process chunks before we register callback
      await new Promise((r) => setTimeout(r, 10));

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      // Should receive the early output that was buffered
      expect(output.join('')).toContain('Early ');
      expect(output.join('')).toContain('data');
    });

    it('should select model by family when model option is provided', async () => {
      const gptModel = createFakeModel(['GPT response']);
      gptModel.family = 'gpt-4o';
      gptModel.id = 'copilot-gpt-4o';
      gptModel.name = 'GPT-4o';

      const claudeModel = createFakeModel(['Claude response']);
      claudeModel.family = 'claude-3.5-sonnet';
      claudeModel.id = 'copilot-claude-3.5-sonnet';
      claudeModel.name = 'Claude 3.5 Sonnet';

      mockSelectChatModels.mockResolvedValue([gptModel, claudeModel]);

      const handle = await adapter.runSdk({
        ...defaultOptions,
        model: 'gpt-4o',
      });
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      // GPT model should be selected because we asked for gpt-4o
      expect(gptModel.sendRequest).toHaveBeenCalledTimes(1);
      expect(claudeModel.sendRequest).not.toHaveBeenCalled();
    });

    it('should throw when requested model is not found', async () => {
      const fakeModel = createFakeModel(['response']);
      fakeModel.family = 'gpt-4o';
      fakeModel.id = 'copilot-gpt-4o';
      fakeModel.vendor = 'copilot';
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      await expect(
        adapter.runSdk({ ...defaultOptions, model: 'nonexistent-model' })
      ).rejects.toThrow(/Model "nonexistent-model" not found/);
    });

    it('should match model by name case-insensitively', async () => {
      const fakeModel = createFakeModel(['response']);
      fakeModel.family = 'claude-3.5-sonnet';
      fakeModel.name = 'Claude 3.5 Sonnet';
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk({
        ...defaultOptions,
        model: 'CLAUDE 3.5',
      });
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      expect(fakeModel.sendRequest).toHaveBeenCalledTimes(1);
    });

    it('should include taskFolder in prompt when provided', async () => {
      const fakeModel = createFakeModel(['text']);
      mockSelectChatModels.mockResolvedValue([fakeModel]);

      const handle = await adapter.runSdk({
        ...defaultOptions,
        taskFolder: '/tmp/task-tracking/TASK_001',
      });
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      const promptArg = mockLanguageModelChatMessageUser.mock
        .calls[0][0] as string;
      expect(promptArg).toContain('/tmp/task-tracking/TASK_001');
    });
  });
});
