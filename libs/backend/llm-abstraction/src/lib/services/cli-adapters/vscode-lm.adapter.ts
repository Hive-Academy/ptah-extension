/**
 * VS Code Language Model Adapter
 * TASK_2025_158: VS Code LM as a spawnable agent via ptah_agent_spawn
 *
 * Uses VS Code's built-in Language Model API to run tasks in-process.
 * No external CLI binary or API key needed — authentication is handled
 * by VS Code itself (e.g., GitHub Copilot subscription).
 *
 * This is an SDK-based adapter: it implements runSdk() and the
 * AgentProcessManager uses SdkHandle instead of child_process.spawn().
 */
import * as vscode from 'vscode';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type {
  CliAdapter,
  CliCommand,
  CliCommandOptions,
  SdkHandle,
} from './cli-adapter.interface';
import { buildTaskPrompt } from './cli-adapter.utils';

export class VsCodeLmAdapter implements CliAdapter {
  readonly name = 'vscode-lm' as const;
  readonly displayName = 'VS Code LM';

  /** Optional configured model identifier (e.g., 'copilot/gpt-5.3-codex') from user settings */
  private configuredModel?: string;

  /**
   * Set the user's configured default model.
   * Used by detect() to show the configured model in version string,
   * and as implicit default when no model is specified in runSdk().
   */
  setConfiguredModel(model: string): void {
    this.configuredModel = model;
  }

  /**
   * Detect if VS Code Language Models are available.
   * Returns installed: true if at least one model can be selected.
   * Shows the configured model in the version string if set.
   */
  async detect(): Promise<CliDetectionResult> {
    try {
      const models = await vscode.lm.selectChatModels();

      if (models.length === 0) {
        return {
          cli: 'vscode-lm',
          installed: false,
          supportsSteer: false,
        };
      }

      // Show configured model if set, otherwise show first available
      let versionModel = models[0];
      if (this.configuredModel) {
        const needle = this.configuredModel.toLowerCase();
        const match = models.find(
          (m) =>
            m.id?.toLowerCase().includes(needle) ||
            m.family?.toLowerCase().includes(needle)
        );
        if (match) {
          versionModel = match;
        }
      }

      return {
        cli: 'vscode-lm',
        installed: true,
        version: `${versionModel.name} (${versionModel.vendor})`,
        supportsSteer: false,
      };
    } catch {
      return {
        cli: 'vscode-lm',
        installed: false,
        supportsSteer: false,
      };
    }
  }

  /**
   * Build command is not used for SDK-based adapters.
   * Returns a dummy command for interface compliance.
   */
  buildCommand(options: CliCommandOptions): CliCommand {
    return {
      binary: 'vscode-lm',
      args: [buildTaskPrompt(options)],
    };
  }

  /**
   * VS Code LM does not support stdin steering.
   */
  supportsSteer(): boolean {
    return false;
  }

  /**
   * VS Code LM output does not contain ANSI codes, return raw.
   */
  parseOutput(raw: string): string {
    return raw;
  }

  /**
   * Run task via VS Code Language Model API.
   *
   * Uses vscode.lm.selectChatModels() to get a model, then streams
   * the response via model.sendRequest(). Abort is bridged from
   * AbortController to CancellationTokenSource.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const models = await vscode.lm.selectChatModels();

    if (models.length === 0) {
      throw new Error(
        'No VS Code Language Models available. Ensure a Copilot subscription is active.'
      );
    }

    // If a model identifier is provided, try to match it against available models
    // Matches against id, family, or name (case-insensitive substring)
    let model: vscode.LanguageModelChat | undefined;
    if (options.model) {
      const needle = options.model.toLowerCase();
      model = models.find(
        (m) =>
          m.id?.toLowerCase().includes(needle) ||
          m.family?.toLowerCase().includes(needle) ||
          m.name?.toLowerCase().includes(needle)
      );
      if (!model) {
        throw new Error(
          `Model "${options.model}" not found. Available models: ${models
            .map((m) => `${m.vendor}/${m.family}`)
            .join(', ')}`
        );
      }
    } else {
      // Default: prefer a Claude model if available, then fall back to first available
      model =
        models.find(
          (m) => m.family?.includes('claude') || m.id?.includes('claude')
        ) ?? models[0];
    }
    const taskPrompt = buildTaskPrompt(options);
    const messages = [vscode.LanguageModelChatMessage.User(taskPrompt)];

    // Bridge AbortController (SdkHandle contract) to CancellationTokenSource (VS Code API)
    const abortController = new AbortController();
    const cancellationTokenSource = new vscode.CancellationTokenSource();

    // When the AbortController is aborted, cancel the VS Code CancellationToken
    const onAbort = (): void => {
      cancellationTokenSource.cancel();
    };
    abortController.signal.addEventListener('abort', onAbort);

    // Output buffering: buffer output until callbacks are registered,
    // then flush buffered data and switch to direct delivery.
    const outputBuffer: string[] = [];
    const outputCallbacks: Array<(data: string) => void> = [];

    const onOutput = (callback: (data: string) => void): void => {
      outputCallbacks.push(callback);
      // Flush any buffered output to the newly registered callback
      if (outputBuffer.length > 0) {
        for (const buffered of outputBuffer) {
          callback(buffered);
        }
        outputBuffer.length = 0;
      }
    };

    const emitOutput = (data: string): void => {
      if (outputCallbacks.length === 0) {
        outputBuffer.push(data);
      } else {
        for (const cb of outputCallbacks) {
          cb(data);
        }
      }
    };

    // Start the request and stream response chunks
    const done = (async (): Promise<number> => {
      try {
        const response = await model.sendRequest(
          messages,
          {},
          cancellationTokenSource.token
        );

        for await (const chunk of response.text) {
          if (abortController.signal.aborted) {
            return 1;
          }
          emitOutput(chunk);
        }

        // Ensure output ends with a newline for clean buffer handling
        emitOutput('\n');
        return 0;
      } catch (error: unknown) {
        // Cancellation is expected when we abort — treat as non-error exit
        if (abortController.signal.aborted) {
          return 1;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        emitOutput(`\n[VS Code LM Error] ${errorMessage}\n`);
        return 1;
      } finally {
        // Clean up event listener and dispose token source
        abortController.signal.removeEventListener('abort', onAbort);
        cancellationTokenSource.dispose();
      }
    })();

    return { abort: abortController, done, onOutput };
  }
}
