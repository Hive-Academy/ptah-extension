import type { CliDetectionService } from '@ptah-extension/llm-abstraction';
import type { Logger } from '@ptah-extension/vscode-core';

export interface WebSearchDependencies {
  cliDetectionService: CliDetectionService;
  logger: Logger;
}

export interface WebSearchResult {
  query: string;
  summary: string;
  provider: 'gemini-cli';
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

    // Gemini CLI (has native google_web_search)
    try {
      const result = await this.searchViaGeminiCli(sanitizedQuery, timeout);
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
          `Gemini CLI failed. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
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
