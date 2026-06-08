/**
 * CodeSymbolPromptInjector — appends relevant indexed code symbols to the
 * session system prompt, retrieved by hybrid (BM25 + vector) search over the
 * workspace symbol index.
 *
 * Mirrors MemoryPromptInjector.buildBlock:
 *   - returns '' on disabled setting, short query, no hits, no reader, or any error
 *   - workspace-scoped via the optional ICodeSymbolReader
 *
 * The reader is injected optionally: runtimes without the SQLite-backed symbol
 * index (VS Code, CLI) leave the token unbound and injection no-ops gracefully,
 * avoiding hand-maintained per-runtime stubs.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type ICodeSymbolReader,
} from '@ptah-extension/memory-contracts';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

const SECTION = 'ptah';
const INJECTION_ENABLED_KEY = 'memory.symbolInjectionEnabled';
const MAX_HITS = 8;
const MIN_QUERY_LENGTH = 8;
const MAX_SNIPPET_CHARS = 240;

@injectable()
export class CodeSymbolPromptInjector {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(MEMORY_CONTRACT_TOKENS.CODE_SYMBOL_READER, { isOptional: true })
    private readonly reader: ICodeSymbolReader | null = null,
  ) {}

  /**
   * Returns a formatted code-symbol block for system prompt injection.
   * Returns '' when disabled, no reader, query too short, no hits, or any error.
   */
  async buildBlock(query: string, workspaceRoot?: string): Promise<string> {
    if (!this.reader) return '';
    if (query.trim().length < MIN_QUERY_LENGTH) return '';
    const enabled =
      this.workspace.getConfiguration<boolean>(
        SECTION,
        INJECTION_ENABLED_KEY,
        true,
      ) ?? true;
    if (!enabled) return '';
    try {
      const page = await this.reader.searchSymbols(
        query,
        MAX_HITS,
        workspaceRoot,
      );
      if (page.hits.length === 0) return '';
      const lines = page.hits.map((h, i) => {
        const name = h.symbolName || h.subject || 'symbol';
        const kind = h.kind ? `${h.kind} ` : '';
        const loc = h.filePath ? ` — ${h.filePath}` : '';
        const sig = firstSignatureLine(h.text);
        return `${i + 1}. ${kind}\`${name}\`${loc}${sig ? `\n   ${sig}` : ''}`;
      });
      return [
        '## Relevant Workspace Symbols',
        'These indexed code symbols may be relevant to the request (retrieved from the workspace symbol index):',
        '',
        ...lines,
        '',
        '---',
      ].join('\n');
    } catch (err: unknown) {
      this.logger.warn(
        '[CodeSymbolPromptInjector] Symbol search failed; skipping injection',
        { error: err instanceof Error ? err.message : String(err) },
      );
      return '';
    }
  }
}

function firstSignatureLine(text: string): string {
  const firstLine = (
    text.split('\n').find((l) => l.trim().length > 0) ?? ''
  ).trim();
  if (firstLine.length === 0) return '';
  return firstLine.length > MAX_SNIPPET_CHARS
    ? firstLine.slice(0, MAX_SNIPPET_CHARS) + '…'
    : firstLine;
}
