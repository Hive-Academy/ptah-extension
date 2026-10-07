/**
 * Spec-only fakes for the Batch 18 suites: an in-memory {@link MergeUpdatePorts}
 * that follows the product rules the suites depend on, and a writer for
 * synthetic curator cassettes. Imported only by `dedup.suite.spec.ts` and
 * `update.suite.spec.ts`.
 *
 * Product rules mirrored (so a spec failure means a suite bug, not a fake bug):
 *   - the collector's tier 1 is the scope's rows with a case-folded subject
 *     equal to a draft subject, and tier 2 is skipped when tier 1 is empty
 *     (`merge-candidate-collector.ts:166-187`); this fake never adds tier 2;
 *   - `searchRich` returns chunks by fused score; with a reranker and at least
 *     5 fused rows it reorders the top `4 * topK` by reranker score and keeps
 *     `topK` (`memory-search.service.ts:369-401`);
 *   - `buildBlock` renders the top 5 hits as `N. [subject]: text`
 *     (`memory-prompt-injector.ts:107-131`);
 *   - a reseed replaces the rows of the same subject and fingerprint, or, in
 *     `append` mode, keeps them (to prove the suite detects a stale reseed).
 */

import { writeFileSync } from 'node:fs';

import type {
  CuratorExtraction,
  ExtractedMemoryDraft,
  ICuratorLLM,
  ResolvedMemoryDraft,
} from '@ptah-extension/memory-contracts';
import type {
  MemoryWriteRequest,
  MemoryWriteResult,
} from '@ptah-extension/platform-core';

import { container } from 'tsyringe';

import { CassetteStore } from '../../doubles/cassette-store';
import {
  curatorExtractKey,
  curatorResolveKey,
  RecordedCuratorLlm,
} from '../../doubles/recorded-curator-llm';
import { RecordedLaneRunner } from '../../doubles/recorded-lane-runner';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import type {
  MergeCandidateCollection,
  MergeCandidateView,
  MergeUpdatePorts,
  PortHit,
  PortRow,
  RerankPort,
} from './merge-update-ports';

interface FakeChunk {
  readonly text: string;
  readonly createdAt: number;
}

interface FakeRow {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly subject: string | null;
  readonly content: string;
  readonly fingerprint: string | null;
  readonly chunks: FakeChunk[];
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\s+/u)
      .filter((token) => token.length > 0),
  );
}

function overlap(query: Set<string>, text: string): number {
  let count = 0;
  for (const token of tokens(text)) if (query.has(token)) count += 1;
  return count;
}

export interface FakeMemoryOptions {
  readonly curator: Pick<ICuratorLLM, 'extract' | 'resolve'>;
  readonly reranker?: RerankPort | null;
  /** Prefix of generated row ids; vary it to prove ids never reach a result. */
  readonly idPrefix?: string;
  readonly seedMode?: 'replace' | 'append';
}

export class FakeMemory implements MergeUpdatePorts {
  readonly rows: FakeRow[] = [];
  /** Every draft passed to `insertRow`, as persisted (all fields). */
  readonly inserted: ExtractedMemoryDraft[] = [];
  /** Every `appendToRow` call: the row and the appended text. */
  readonly appended: { readonly id: string; readonly text: string }[] = [];
  readonly curator: Pick<ICuratorLLM, 'extract' | 'resolve'>;
  readonly reranker: RerankPort | null;
  private sequence = 0;
  private clock = 1_000_000;

  constructor(private readonly options: FakeMemoryOptions) {
    this.curator = options.curator;
    this.reranker = options.reranker ?? null;
  }

  private nextId(): string {
    this.sequence += 1;
    return `${this.options.idPrefix ?? 'row'}-${this.sequence}`;
  }

  private tick(): number {
    this.clock += 1_000;
    return this.clock;
  }

  private add(
    workspaceRoot: string,
    subject: string | null,
    content: string,
    fingerprint: string | null,
  ): string {
    const id = this.nextId();
    this.rows.push({
      id,
      workspaceRoot,
      subject,
      content,
      fingerprint,
      chunks: [{ text: content, createdAt: this.tick() }],
    });
    return id;
  }

  async insertRow(row: {
    sessionId: string;
    workspaceRoot: string;
    draft: ExtractedMemoryDraft;
  }): Promise<string> {
    this.inserted.push(row.draft);
    return this.add(
      row.workspaceRoot,
      row.draft.subject,
      row.draft.content,
      null,
    );
  }

  async appendToRow(
    id: string,
    text: string,
    workspaceRoot: string,
  ): Promise<'appended' | 'ineligible'> {
    const row = this.rows.find(
      (r) => r.id === id && r.workspaceRoot === workspaceRoot,
    );
    if (row === undefined) return 'ineligible';
    this.appended.push({ id, text });
    row.chunks.push({ text, createdAt: this.tick() });
    return 'appended';
  }

  mergeTarget(id: string, workspaceRoot: string): string | null {
    return this.rows.some(
      (r) => r.id === id && r.workspaceRoot === workspaceRoot,
    )
      ? id
      : null;
  }

  listRows(workspaceRoot: string): readonly PortRow[] {
    return this.rows
      .filter((r) => r.workspaceRoot === workspaceRoot)
      .map((r) => ({ id: r.id, subject: r.subject }));
  }

  async searchRich(
    query: string,
    topK: number,
    workspaceRoot: string,
  ): Promise<{ hits: readonly PortHit[]; bm25Only: boolean }> {
    const queryTokens = tokens(query);
    let fused = this.rows
      .filter((r) => r.workspaceRoot === workspaceRoot)
      .flatMap((row) =>
        row.chunks.map((chunk) => ({
          row,
          chunk,
          score: overlap(queryTokens, `${row.subject ?? ''} ${chunk.text}`),
        })),
      )
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK * 4);
    if (this.reranker !== null && fused.length >= 5) {
      const ranked = await this.reranker.rerank(
        query,
        fused.map((entry, index) => ({
          id: String(index),
          text: entry.chunk.text,
        })),
        topK,
      );
      fused = ranked.map((r) => fused[Number(r.id)]);
    }
    return {
      bm25Only: true,
      hits: fused.slice(0, topK).map((entry, index) => ({
        memoryId: entry.row.id,
        subject: entry.row.subject,
        chunkText: entry.chunk.text,
        chunkCreatedAt: entry.chunk.createdAt,
        score: entry.score,
        bm25Rank: index + 1,
        vecRank: null,
      })),
    };
  }

  async collectCandidates(
    drafts: readonly ExtractedMemoryDraft[],
    workspaceRoot: string,
  ): Promise<MergeCandidateCollection> {
    const subjects = new Set(
      drafts
        .map((d) => d.subject?.trim().toLowerCase())
        .filter((s): s is string => !!s),
    );
    const tier1: MergeCandidateView[] = this.rows
      .filter(
        (r) =>
          r.workspaceRoot === workspaceRoot &&
          r.subject !== null &&
          subjects.has(r.subject.trim().toLowerCase()),
      )
      .map((r) => ({ id: r.id, subject: r.subject, content: r.content }));
    return {
      candidates: tier1,
      tier1Count: tier1.length,
      tier2Count: 0,
      tier2Queries: 0,
      bm25Only: true,
      tier2Skipped: tier1.length === 0 ? 'tier1-empty' : null,
    };
  }

  async buildBlock(query: string, workspaceRoot: string): Promise<string> {
    const { hits } = await this.searchRich(query, 5, workspaceRoot);
    if (hits.length === 0) return '';
    return [
      '## Recalled Memory Context',
      '',
      ...hits.map(
        (hit, index) =>
          `${index + 1}. [${hit.subject ?? 'memory'}]: ${hit.chunkText}`,
      ),
      '',
      '---',
    ].join('\n');
  }

  async seed(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    const matches = this.rows.filter(
      (r) =>
        r.subject === request.subject &&
        r.fingerprint === request.workspaceFingerprint,
    );
    if (this.options.seedMode !== 'append') {
      for (const match of matches)
        this.rows.splice(this.rows.indexOf(match), 1);
    }
    const id = this.add(
      request.workspaceRoot,
      request.subject,
      request.content,
      request.workspaceFingerprint,
    );
    return { status: matches.length > 0 ? 'replaced' : 'inserted', id };
  }

  planWindows(transcript: string): readonly string[] {
    return [transcript];
  }
}

/** Builds a synthetic replay cassette (one JSONL line per entry). */
export class SyntheticCassette {
  private readonly lines: string[] = [];

  extract(window: string, response: CuratorExtraction): this {
    this.lines.push(
      JSON.stringify({
        key: curatorExtractKey(window),
        method: 'extract',
        model: 'synthetic',
        promptSha: 'synthetic',
        response,
      }),
    );
    return this;
  }

  resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly MergeCandidateView[],
    response: readonly ResolvedMemoryDraft[],
  ): this {
    this.lines.push(
      JSON.stringify({
        key: curatorResolveKey(drafts, related),
        method: 'resolve',
        model: 'synthetic',
        promptSha: 'synthetic',
        response,
      }),
    );
    return this;
  }

  write(path: string): void {
    writeFileSync(path, this.lines.map((line) => `${line}\n`).join(''), 'utf8');
  }
}

/** A replay curator double over a cassette file. */
export function replayCurator(cassettePath: string): RecordedCuratorLlm {
  return new RecordedCuratorLlm({
    store: new CassetteStore({ path: cassettePath, mode: 'replay' }),
    model: 'synthetic',
  });
}

/**
 * A host-suite context for specs. The container and doubles are only read by
 * the real `resolveMergeUpdatePorts`, which specs replace with a fake.
 */
export function suiteContext(input: {
  readonly home: string;
  readonly runDir: string;
  readonly options: unknown;
  readonly curator: RecordedCuratorLlm;
  readonly laneCassette: string;
}): MemorySkillsHostSuiteContext {
  return {
    runId: 'spec-run',
    runDir: input.runDir,
    options: input.options,
    workspaceRoot: '/bench/workspace',
    isolation: {
      home: input.home,
      userDataPath: input.home,
      dbPath: `${input.home}/ptah.sqlite`,
    },
    container: container.createChildContainer(),
    doubles: {
      mode: 'replay',
      curator: input.curator,
      laneRunner: new RecordedLaneRunner({
        store: new CassetteStore({ path: input.laneCassette, mode: 'replay' }),
        model: 'synthetic',
      }),
    },
    ci: true,
  };
}
