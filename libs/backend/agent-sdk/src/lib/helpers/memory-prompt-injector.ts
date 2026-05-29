/**
 * MemoryPromptInjector — prepends recalled memory hits to the session system prompt.
 *
 * Two injection paths:
 *   - buildBlock(query, cwd): mid-session semantic recall (uses IMemoryReader)
 *   - buildSessionStartBlock(workspaceRoot, observationCount, corpusCount):
 *       session-start workspace memory roster (uses IMemoryLister)
 *
 * Always returns '' on error or 0 hits — never throws.
 *
 * Privacy invariant for buildSessionStartBlock:
 *   - only subject (memory side) and corpus name/count cross the boundary
 *   - no chunk text, no tool_response_text, no JSONL excerpt
 *   - workspace-scoped via listAll(workspaceRoot, ...); never cross-workspace
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type IMemoryReader,
  type IMemoryLister,
} from '@ptah-extension/memory-contracts';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

const MAX_HITS = 5;
const MAX_CHUNK_CHARS = 400;
const MIN_QUERY_LENGTH = 8;
const MIN_SCORE = 0.05;

const SESSION_START_SECTION = 'ptah';
const SESSION_START_INJECTION_ENABLED_KEY =
  'memory.triggers.sessionStart.injectionEnabled';
const SESSION_START_OBSERVATION_COUNT_KEY =
  'memory.triggers.sessionStart.observationCount';
const SESSION_START_CORPUS_COUNT_KEY =
  'memory.triggers.sessionStart.corpusCount';
const SESSION_START_DEFAULT_OBSERVATION_COUNT = 10;
const SESSION_START_DEFAULT_CORPUS_COUNT = 5;
const SESSION_START_MAX_OBSERVATIONS = 50;
const SESSION_START_MAX_CORPORA = 50;

export interface CorpusSummary {
  readonly name: string;
  readonly count: number;
}

@injectable()
export class MemoryPromptInjector {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_CONTRACT_TOKENS.MEMORY_READER)
    private readonly memoryReader: IMemoryReader,
    @inject(MEMORY_CONTRACT_TOKENS.MEMORY_LISTER)
    private readonly memoryLister: IMemoryLister,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
  ) {}

  /**
   * Returns a formatted memory block for system prompt injection.
   * Returns '' when no hits, store unavailable, or any error occurs.
   */
  async buildBlock(query: string, workspaceRoot?: string): Promise<string> {
    if (query.trim().length < MIN_QUERY_LENGTH) return '';
    try {
      const result = await this.memoryReader.search(
        query,
        MAX_HITS,
        workspaceRoot,
      );
      const hits = result.hits.filter((h) => h.score >= MIN_SCORE);
      if (hits.length === 0) return '';
      const lines = hits.map((h, i) => {
        const label = h.subject ? `[${h.subject}]` : '[memory]';
        const raw = h.chunkText;
        const text =
          raw.length > MAX_CHUNK_CHARS
            ? raw.slice(
                0,
                raw.lastIndexOf(' ', MAX_CHUNK_CHARS) || MAX_CHUNK_CHARS,
              ) + '…'
            : raw;
        return `${i + 1}. ${label}: ${text}`;
      });
      return [
        '## Recalled Memory Context',
        'The following facts were recalled from your persistent memory based on this session:',
        '',
        ...lines,
        '',
        '---',
      ].join('\n');
    } catch (err: unknown) {
      this.logger.warn(
        '[MemoryPromptInjector] Memory search failed; skipping injection',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return '';
    }
  }

  /**
   * Returns a workspace-scoped roster of recent memory subjects, prepended to
   * the system prompt at session start.
   *
   * Empty string when:
   *   - workspaceRoot is undefined (no cross-workspace surfacing)
   *   - injectionEnabled config is false
   *   - listAll yields no memories AND no corpora
   *   - any error path
   *
   * Privacy: only memory subject + corpus name/count cross the boundary.
   */
  async buildSessionStartBlock(
    workspaceRoot?: string,
    observationCount?: number,
    corpusCount?: number,
    corpora: readonly CorpusSummary[] = [],
  ): Promise<string> {
    if (!workspaceRoot) return '';
    const injectionEnabled =
      this.workspace.getConfiguration<boolean>(
        SESSION_START_SECTION,
        SESSION_START_INJECTION_ENABLED_KEY,
        true,
      ) ?? true;
    if (!injectionEnabled) return '';
    const resolvedObservationCount =
      observationCount ??
      this.workspace.getConfiguration<number>(
        SESSION_START_SECTION,
        SESSION_START_OBSERVATION_COUNT_KEY,
        SESSION_START_DEFAULT_OBSERVATION_COUNT,
      ) ??
      SESSION_START_DEFAULT_OBSERVATION_COUNT;
    const resolvedCorpusCount =
      corpusCount ??
      this.workspace.getConfiguration<number>(
        SESSION_START_SECTION,
        SESSION_START_CORPUS_COUNT_KEY,
        SESSION_START_DEFAULT_CORPUS_COUNT,
      ) ??
      SESSION_START_DEFAULT_CORPUS_COUNT;
    const memoryLimit = clampPositive(
      resolvedObservationCount,
      SESSION_START_DEFAULT_OBSERVATION_COUNT,
      SESSION_START_MAX_OBSERVATIONS,
    );
    const corpusLimit = clampPositive(
      resolvedCorpusCount,
      SESSION_START_DEFAULT_CORPUS_COUNT,
      SESSION_START_MAX_CORPORA,
    );
    let subjects: string[] = [];
    if (memoryLimit > 0) {
      try {
        const page = this.memoryLister.listAll(
          workspaceRoot,
          undefined,
          memoryLimit,
          0,
        );
        subjects = page.memories
          .map((m) => (m.subject ?? '').trim())
          .filter((s) => s.length > 0);
      } catch (err: unknown) {
        this.logger.warn(
          '[MemoryPromptInjector] SessionStart memory listing failed; skipping injection',
          { error: err instanceof Error ? err.message : String(err) },
        );
        return '';
      }
    }
    const corporaList = corpora.slice(0, corpusLimit);
    if (subjects.length === 0 && corporaList.length === 0) return '';
    const sections: string[] = ['## Workspace Memory Snapshot'];
    if (subjects.length > 0) {
      sections.push(
        '',
        `Recent observations curated for this workspace (${subjects.length}):`,
        '',
        ...subjects.map((s, i) => `${i + 1}. ${s}`),
      );
    }
    if (corporaList.length > 0) {
      sections.push(
        '',
        `Available knowledge corpora (${corporaList.length}):`,
        '',
        ...corporaList.map((c, i) => `${i + 1}. ${c.name} (${c.count})`),
      );
    }
    sections.push('', '---');
    return sections.join('\n');
  }
}

function clampPositive(value: number, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return fallback;
  if (value === 0) return 0;
  return Math.min(Math.floor(value), max);
}
