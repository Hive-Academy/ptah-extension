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
        const match = this.findMatchingModel(models, this.configuredModel);
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
   * Find a matching model from the available models list.
   *
   * Matching strategy (in priority order):
   * 1. Exact match on vendor/family combo (e.g., "copilot/gpt-5.3-codex")
   * 2. Substring match on id, family, or name
   * 3. If needle contains "/", also try matching just the family part
   */
  private findMatchingModel(
    models: vscode.LanguageModelChat[],
    needle: string
  ): vscode.LanguageModelChat | undefined {
    const lowerNeedle = needle.toLowerCase();

    // 1. Exact vendor/family match (how models are stored in settings)
    const exactMatch = models.find(
      (m) => `${m.vendor}/${m.family}`.toLowerCase() === lowerNeedle
    );
    if (exactMatch) return exactMatch;

    // 2. Substring match on id, family, or name
    const substringMatch = models.find(
      (m) =>
        m.id?.toLowerCase().includes(lowerNeedle) ||
        m.family?.toLowerCase().includes(lowerNeedle) ||
        m.name?.toLowerCase().includes(lowerNeedle) ||
        lowerNeedle.includes(m.family?.toLowerCase() ?? '')
    );
    if (substringMatch) return substringMatch;

    // 3. If needle is vendor/family format, try just the family part
    if (lowerNeedle.includes('/')) {
      const familyPart = lowerNeedle.split('/').pop() ?? '';
      if (familyPart) {
        return models.find(
          (m) =>
            m.family?.toLowerCase() === familyPart ||
            m.family?.toLowerCase().includes(familyPart)
        );
      }
    }

    return undefined;
  }

  /**
   * Read file contents using VS Code workspace filesystem.
   * Returns content as UTF-8 string, or an error placeholder if reading fails.
   */
  private async readFileContent(
    filePath: string,
    workingDirectory: string
  ): Promise<string> {
    try {
      // Resolve relative paths against working directory
      const uri =
        filePath.match(/^[a-zA-Z]:[\\/]/) || filePath.startsWith('/')
          ? vscode.Uri.file(filePath)
          : vscode.Uri.joinPath(vscode.Uri.file(workingDirectory), filePath);
      const content = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(content);
    } catch {
      return `[Error: Unable to read file "${filePath}"]`;
    }
  }

  /**
   * Build a prompt with file contents inlined.
   * VS Code LM has no tool-calling capability, so file contents
   * must be included directly in the prompt for the model to analyze them.
   */
  private async buildPromptWithFileContents(
    options: CliCommandOptions
  ): Promise<string> {
    let taskPrompt = buildTaskPrompt(options);

    // If files are specified, read and inline their contents
    if (options.files && options.files.length > 0) {
      const fileContents: string[] = [];
      for (const file of options.files) {
        const content = await this.readFileContent(
          file,
          options.workingDirectory
        );
        // Cap individual file at ~30KB to avoid blowing the context window
        const truncated =
          content.length > 30000
            ? content.substring(0, 30000) + '\n... [truncated]'
            : content;
        fileContents.push(`### ${file}\n\`\`\`\n${truncated}\n\`\`\``);
      }
      taskPrompt +=
        '\n\n## File Contents\n\nHere are the actual file contents for your analysis:\n\n' +
        fileContents.join('\n\n');
    }

    return taskPrompt;
  }

  /**
   * Run task via VS Code Language Model API.
   *
   * Uses vscode.lm.selectChatModels() to get a model, then streams
   * the response via model.sendRequest(). Abort is bridged from
   * AbortController to CancellationTokenSource.
   *
   * Unlike CLI agents, VS Code LM has no tool-calling capability.
   * File contents are inlined into the prompt so the model can analyze them.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    const models = await vscode.lm.selectChatModels();

    if (models.length === 0) {
      throw new Error(
        'No VS Code Language Models available. Ensure a Copilot subscription is active.'
      );
    }

    // If a model identifier is provided, try to match it against available models
    // Matches against vendor/family combo, id, family, or name (case-insensitive)
    let model: vscode.LanguageModelChat | undefined;
    if (options.model) {
      model = this.findMatchingModel(models, options.model);
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
    // Build prompt with file contents inlined (VS Code LM can't read files via tools)
    const taskPrompt = await this.buildPromptWithFileContents(options);
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
