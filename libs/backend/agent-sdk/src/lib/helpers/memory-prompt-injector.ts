/**
 * MemoryPromptInjector — prepends recalled memory hits to the session system prompt.
 *
 * Three injection paths:
 *   - buildBlock(query, cwd): mid-session semantic recall (uses IMemoryReader)
 *   - buildSessionStartBlock(workspaceRoot, observationCount, corpusCount):
 *       session-start workspace memory roster (uses IMemoryLister)
 *   - buildCorpusBlock(corpusName, budgetTokens): knowledge-agent priming —
 *       resolves the named corpus + its member memories and emits a 5-field
 *       summary block bounded by `0.9 × budget`. Used by `SdkQueryOptionsBuilder`
 *       when `sessionConfig.corpusName` is set.
 *
 * Always returns '' on error or 0 hits — never throws.
 *
 * Privacy invariant for buildSessionStartBlock and buildCorpusBlock:
 *   - only subject, 5-field summaries, type, corpus name/count cross the boundary
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

const CORPUS_STORE_TOKEN = Symbol.for('PtahCorpusStore');

export interface CorpusMemberView {
  readonly id: string;
  readonly subject: string | null;
  readonly type: string;
  readonly request: string | null;
  readonly investigated: string | null;
  readonly learned: string | null;
  readonly completed: string | null;
  readonly nextSteps: string | null;
}

/**
 * Structural contract for the corpus reader injected via `Symbol.for('PtahCorpusStore')`.
 * Defined locally to keep agent-sdk from importing memory-curator directly —
 * the concrete `CorpusStore` satisfies this shape.
 */
export interface CorpusReader {
  getByName(
    name: string,
  ): { readonly id: string; readonly name: string } | null;
  getCorpusMemoriesForPriming(name: string): readonly CorpusMemberView[];
}

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

const CORPUS_PRIMING_BUDGET_KEY = 'memory.corpus.primingTokenBudget';
const CORPUS_PRIMING_DEFAULT_BUDGET = 50_000;
const CORPUS_PRIMING_BUDGET_RATIO = 0.9;

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
    @inject(CORPUS_STORE_TOKEN, { isOptional: true })
    private readonly corpus: CorpusReader | null = null,
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

  /**
   * Returns the knowledge-agent priming block for `corpusName`, grouped by
   * memory `type`. The cumulative token estimate stops at
   * `CORPUS_PRIMING_BUDGET_RATIO × budget`.
   *
   * Empty string when:
   *   - corpusName is empty
   *   - no corpus reader is wired (registration deferred / unavailable)
   *   - corpus does not exist
   *   - corpus has no members
   *   - any error path
   *
   * Privacy: only subject + 5-field summaries + type cross the boundary.
   * Markdown framing: `## Knowledge corpus: ${name}\n${grouped sections}\n---`.
   */
  async buildCorpusBlock(
    corpusName: string,
    budgetTokens?: number,
  ): Promise<string> {
    const trimmedName = corpusName.trim();
    if (trimmedName.length === 0) return '';
    if (!this.corpus) return '';
    let members: readonly CorpusMemberView[];
    let resolvedName: string;
    try {
      const rec = this.corpus.getByName(trimmedName);
      if (!rec) return '';
      resolvedName = rec.name;
      members = this.corpus.getCorpusMemoriesForPriming(trimmedName);
    } catch (err: unknown) {
      this.logger.warn(
        '[MemoryPromptInjector] Corpus lookup failed; skipping injection',
        { error: err instanceof Error ? err.message : String(err) },
      );
      return '';
    }
    if (members.length === 0) return '';

    const budgetRaw =
      budgetTokens ??
      this.workspace.getConfiguration<number>(
        SESSION_START_SECTION,
        CORPUS_PRIMING_BUDGET_KEY,
        CORPUS_PRIMING_DEFAULT_BUDGET,
      ) ??
      CORPUS_PRIMING_DEFAULT_BUDGET;
    const effectiveBudget = clampBudget(
      budgetRaw,
      CORPUS_PRIMING_DEFAULT_BUDGET,
    );
    const tokenCeiling = Math.floor(
      effectiveBudget * CORPUS_PRIMING_BUDGET_RATIO,
    );

    const groups = new Map<string, CorpusMemberView[]>();
    for (const m of members) {
      const key = (m.type || 'discovery').trim() || 'discovery';
      const bucket = groups.get(key);
      if (bucket) bucket.push(m);
      else groups.set(key, [m]);
    }

    const sections: string[] = [`## Knowledge corpus: ${resolvedName}`];
    let cumulativeTokens = estimateTokens(sections[0]);
    let truncated = false;

    outer: for (const [type, bucket] of groups) {
      const header = `### ${type}`;
      sections.push('', header);
      cumulativeTokens += estimateTokens(header);
      for (const m of bucket) {
        const entry = formatMemberEntry(m);
        const entryTokens = estimateTokens(entry);
        if (cumulativeTokens + entryTokens > tokenCeiling) {
          truncated = true;
          break outer;
        }
        sections.push(entry);
        cumulativeTokens += entryTokens;
      }
    }
    if (truncated) {
      sections.push('', '> (corpus truncated to fit token budget)');
    }
    sections.push('', '---');
    return sections.join('\n');
  }
}

function clampBudget(value: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function formatMemberEntry(m: CorpusMemberView): string {
  const parts: string[] = [`- **${m.subject ?? '(no subject)'}**`];
  if (m.request) parts.push(`  - request: ${m.request}`);
  if (m.investigated) parts.push(`  - investigated: ${m.investigated}`);
  if (m.learned) parts.push(`  - learned: ${m.learned}`);
  if (m.completed) parts.push(`  - completed: ${m.completed}`);
  if (m.nextSteps) parts.push(`  - nextSteps: ${m.nextSteps}`);
  return parts.join('\n');
}

function clampPositive(value: number, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return fallback;
  if (value === 0) return 0;
  return Math.min(Math.floor(value), max);
}
