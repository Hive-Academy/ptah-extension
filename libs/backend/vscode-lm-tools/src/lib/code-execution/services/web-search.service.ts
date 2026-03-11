import type {
  LlmService,
  LlmConfigurationService,
  CliDetectionService,
} from '@ptah-extension/llm-abstraction';
import type { Logger } from '@ptah-extension/vscode-core';

export interface WebSearchDependencies {
  llmService: LlmService;
  configService: LlmConfigurationService;
  cliDetectionService: CliDetectionService;
  logger: Logger;
}

export interface WebSearchResult {
  query: string;
  summary: string;
  provider: 'vscode-lm' | 'gemini-cli';
  durationMs: number;
}

const MAX_QUERY_LENGTH = 2000;

export class WebSearchService {
  constructor(private readonly deps: WebSearchDependencies) {}

  async search(query: string, timeoutMs?: number): Promise<WebSearchResult> {
    // Validate query
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new Error('Web search query must not be empty');
    }
    const sanitizedQuery =
      trimmed.length > MAX_QUERY_LENGTH
        ? trimmed.substring(0, MAX_QUERY_LENGTH)
        : trimmed;

    // Clamp timeout: default 30s, max 60s
    const timeout = Math.min(timeoutMs ?? 30000, 60000);
    const start = Date.now();

    // Try VS Code LM API first (in-process, fast)
    try {
      const result = await this.searchViaVsCodeLm(sanitizedQuery, timeout);
      if (result) {
        this.deps.logger.info(
          '[WebSearch] Completed via VS Code LM',
          'WebSearchService',
          {
            query: sanitizedQuery.substring(0, 80),
            durationMs: Date.now() - start,
          }
        );
        return {
          query: sanitizedQuery,
          summary: result,
          provider: 'vscode-lm',
          durationMs: Date.now() - start,
        };
      }
    } catch (error) {
      this.deps.logger.warn(
        '[WebSearch] VS Code LM failed, trying Gemini CLI',
        'WebSearchService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    // Fallback: Gemini CLI (has native google_web_search)
    try {
      const remaining = timeout - (Date.now() - start);
      if (remaining <= 0) {
        throw new Error('Timeout exhausted after VS Code LM attempt');
      }
      const result = await this.searchViaGeminiCli(sanitizedQuery, remaining);
      this.deps.logger.info(
        '[WebSearch] Completed via Gemini CLI',
        'WebSearchService',
        {
          query: sanitizedQuery.substring(0, 80),
          durationMs: Date.now() - start,
        }
      );
      return {
        query: sanitizedQuery,
        summary: result,
        provider: 'gemini-cli',
        durationMs: Date.now() - start,
      };
    } catch (error) {
      throw new Error(
        `Web search failed: no provider available. ` +
          `VS Code LM and Gemini CLI both failed. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Search via VS Code LM API (in-process, fast path).
   * Returns null (not throw) when provider is unavailable, enabling fallback.
   *
   * Note: setProvider() mutates the shared LlmService singleton's active provider.
   * This is the same pattern used by buildProviderNamespace() in llm-namespace.builder.ts.
   * The LlmService uses an internal Mutex to serialize provider switches.
   */
  private async searchViaVsCodeLm(
    query: string,
    timeoutMs: number
  ): Promise<string | null> {
    const model = this.deps.configService.getDefaultModel('vscode-lm');
    const setResult = await this.deps.llmService.setProvider(
      'vscode-lm',
      model
    );
    if (setResult.isErr()) {
      this.deps.logger.debug(
        '[WebSearch] VS Code LM not available',
        'WebSearchService'
      );
      return null;
    }

    const systemPrompt =
      'You are a web search assistant. Search the web for the given query ' +
      'and provide a comprehensive summary of the most relevant and recent results. ' +
      'Include key facts, sources, and URLs when available.';

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completionResult = await Promise.race([
        this.deps.llmService.getCompletion(
          systemPrompt,
          `Search the web for: ${query}`
        ),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);

      if (!completionResult || completionResult.isErr()) return null;
      return completionResult.value || null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Search via Gemini CLI (has native google_web_search tool).
   * Spawns a Gemini CLI process with search-focused prompt.
   * Cleans up timer and process on completion or timeout.
   */
  private async searchViaGeminiCli(
    query: string,
    timeoutMs: number
  ): Promise<string> {
    const detection = await this.deps.cliDetectionService.getDetection(
      'gemini'
    );
    if (!detection?.installed) {
      throw new Error('Gemini CLI not installed');
    }

    const adapter = this.deps.cliDetectionService.getAdapter('gemini');
    if (!adapter?.runSdk) {
      throw new Error('Gemini CLI adapter does not support SDK mode');
    }

    const handle = await adapter.runSdk({
      task:
        `Search the web for: "${query}". Use the google_web_search tool to find relevant results. ` +
        `Provide a comprehensive summary of the findings including key facts, sources, and URLs. ` +
        `Do NOT use any other tools. Only search and summarize.`,
      workingDirectory: process.cwd(),
      binaryPath: detection.path,
    });

    let output = '';
    handle.onOutput((data) => {
      output += data;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const exitCode = await Promise.race([
        handle.done,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            handle.abort.abort();
            reject(new Error('Gemini CLI search timed out'));
          }, timeoutMs);
        }),
      ]);

      if (exitCode !== 0) {
        this.deps.logger.warn(
          `[WebSearch] Gemini CLI exited with code ${exitCode}`,
          'WebSearchService',
          { exitCode, hasOutput: !!output.trim() }
        );
        if (!output.trim()) {
          throw new Error(`Gemini CLI exited with code ${exitCode}`);
        }
        // Partial output from non-zero exit: log warning but still return
        // if there's meaningful content (Gemini CLI may exit non-zero
        // after completing its output on some platforms)
      }

      return output.trim() || 'No results found.';
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // Ensure process cleanup if it's still running (e.g., after timeout)
      if (timedOut) {
        try {
          handle.abort.abort();
        } catch {
          // Already aborted, ignore
        }
      }
    }
  }
}
