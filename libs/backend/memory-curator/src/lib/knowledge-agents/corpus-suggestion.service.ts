/**
 * CorpusSuggestionService — deterministic, read-only clustering pass that
 * proposes one-click knowledge corpora from a workspace's episodic memories.
 *
 * The heuristic is concept-primary with a type-based fill:
 *   1. Unroll every memory's `concepts_json` (excluding code-index `entity`
 *      rows) with a single workspace-scoped `json_each` query.
 *   2. Group by concept → clusters; keep clusters ≥ MIN_CLUSTER_SIZE.
 *   3. Enrich each cluster (co-occurring concepts, dominant type).
 *   4. Dedupe against existing corpora (by concept and by name).
 *   5. Rank by memberCount desc then concept asc; cap at `limit`.
 *   6. If short of `limit`, fill with broad single-`type` clusters
 *      (≥ TYPE_MIN_CLUSTER_SIZE), skipping types already covered.
 *
 * Read-only guarantee: issues only SELECTs + `corpusStore.listFilterRows`,
 * uses the shared `connection.db` (never a new handle), and makes no LLM/SDK
 * call. Fully deterministic — no RNG, stable tie-breaks.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import type {
  BuildCorpusParams,
  MemoryType,
} from '@ptah-extension/memory-contracts';
import { MEMORY_TOKENS } from '../di/tokens';
import type { CorpusStore } from './corpus.store';
import { parseCorpusFilter } from './corpus-filter.util';

/**
 * A single one-click corpus proposal. `filter` maps 1:1 onto `corpus:build`
 * (it IS a {@link BuildCorpusParams}), so callers pass it through unchanged.
 */
export interface CorpusSuggestion {
  readonly suggestedName: string;
  readonly filter: BuildCorpusParams;
  /** Raw cluster size (pre-100-cap); the eventual corpus `count` may be lower. */
  readonly memberCount: number;
  /** Defining concept followed by ≤2 co-occurring concepts (empty for a type suggestion). */
  readonly topConcepts: readonly string[];
  readonly rationale: string;
  readonly signal: 'concept' | 'type';
}

export interface SuggestOptions {
  /** `undefined` = global (all workspaces); `null`/string scope like `CorpusStore.list`. */
  readonly workspaceRoot?: string | null;
  readonly minClusterSize?: number;
  readonly limit?: number;
}

/** Below 5 a board is too thin to be worth a one-click. */
const MIN_CLUSTER_SIZE = 5;
/** Fits one responsive card row without overwhelming the user. */
const MAX_SUGGESTIONS = 6;
/** Defining concept + up to 2 co-occurring — enough context, avoids tag soup. */
const TOP_CONCEPTS = 3;
/** Type is a broad signal (6 values); require a larger pool before proposing. */
const TYPE_MIN_CLUSTER_SIZE = 12;
/** Matches the build dialog default + `searchIndex` hard cap. */
const BOARD_LIMIT = 100;
/** Mirrors `CorpusNameSchema` (min 1, max 200) on the `corpus:build` path. */
const MAX_CORPUS_NAME = 200;

/**
 * MemoryType enum order — used as the deterministic tie-break for the modal
 * type of a cluster. MUST match `memory-contracts/curator-llm.port.ts`.
 */
const MEMORY_TYPE_ORDER: readonly MemoryType[] = [
  'bugfix',
  'feature',
  'decision',
  'discovery',
  'refactor',
  'change',
];

interface ConceptRow {
  readonly id: string;
  readonly type: string;
  readonly concept: string;
}

interface TypeCountRow {
  readonly type: string;
  readonly n: number;
}

@injectable()
export class CorpusSuggestionService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(MEMORY_TOKENS.CORPUS_STORE)
    private readonly corpusStore: CorpusStore,
  ) {}

  /**
   * Compute ranked corpus suggestions for the given scope. Synchronous —
   * better-sqlite3 is sync (matching `CorpusStore.list`).
   */
  suggestCorpora(opts: SuggestOptions = {}): readonly CorpusSuggestion[] {
    const minClusterSize = Math.max(1, opts.minClusterSize ?? MIN_CLUSTER_SIZE);
    const limit = Math.max(0, opts.limit ?? MAX_SUGGESTIONS);
    if (limit === 0) return [];

    const hasWorkspaceFilter = opts.workspaceRoot !== undefined;
    const scopedRoot = opts.workspaceRoot ?? null;

    const conceptRows = this.loadConceptRows(hasWorkspaceFilter, scopedRoot);

    // Aggregate: concept → member ids, id → concepts, id → type.
    const conceptToIds = new Map<string, Set<string>>();
    const idToConcepts = new Map<string, Set<string>>();
    const idToType = new Map<string, string>();
    for (const row of conceptRows) {
      addToSetMap(conceptToIds, row.concept, row.id);
      addToSetMap(idToConcepts, row.id, row.concept);
      idToType.set(row.id, row.type);
    }

    const { existingConceptsLc, existingNamesLc, existingSingleTypes } =
      this.loadExistingCorpora(hasWorkspaceFilter, scopedRoot);

    // ── Step 1-4: concept clusters ────────────────────────────────────────
    const conceptSuggestions: CorpusSuggestion[] = [];
    for (const [concept, ids] of conceptToIds) {
      const memberCount = ids.size;
      if (memberCount < minClusterSize) continue;
      const conceptLc = concept.toLowerCase();
      // Dedupe: skip a concept already covered by an existing corpus (by
      // concept filter or by name).
      if (existingConceptsLc.has(conceptLc) || existingNamesLc.has(conceptLc)) {
        continue;
      }

      // Guard the corpus name against the stricter build-path `CorpusNameSchema`
      // (min 1, max 200) so this suggestion is guaranteed to build. One `name`
      // feeds both `suggestedName` and `filter.name` — equal by construction.
      const name = clampCorpusName(concept);
      if (name === null) continue;

      const memberIds = [...ids];
      const topConcepts = this.deriveTopConcepts(
        concept,
        memberIds,
        idToConcepts,
      );
      const { dominantType, share } = this.deriveDominantType(
        memberIds,
        idToType,
      );

      const rationale =
        `${memberCount} memories tagged "${concept}"` +
        (share >= 0.5 ? ` (mostly ${dominantType})` : '');

      conceptSuggestions.push({
        suggestedName: name,
        filter: {
          name,
          workspaceRoot: scopedRoot,
          concepts: [concept],
          limit: BOARD_LIMIT,
        },
        memberCount,
        topConcepts,
        rationale,
        signal: 'concept',
      });
    }

    // Rank: memberCount desc, then concept asc (stable/deterministic).
    conceptSuggestions.sort(
      (a, b) =>
        b.memberCount - a.memberCount ||
        compareStrings(a.suggestedName, b.suggestedName),
    );
    const ranked = conceptSuggestions.slice(0, limit);

    // ── Step 5: type fill (secondary) ─────────────────────────────────────
    if (ranked.length < limit) {
      const typeSuggestions = this.buildTypeSuggestions(
        hasWorkspaceFilter,
        scopedRoot,
        existingSingleTypes,
        existingNamesLc,
        limit - ranked.length,
      );
      ranked.push(...typeSuggestions);
    }

    return ranked;
  }

  /** Single workspace-scoped `json_each` unroll of every memory's concepts. */
  private loadConceptRows(
    hasWorkspaceFilter: boolean,
    scopedRoot: string | null,
  ): readonly ConceptRow[] {
    const base = `SELECT m.id AS id, m.type AS type, je.value AS concept
                    FROM memories m, json_each(m.concepts_json) je
                   WHERE m.kind != 'entity'
                     AND je.value != ''`;
    if (hasWorkspaceFilter) {
      return this.connection.db
        .prepare(`${base} AND m.workspace_root IS ?`)
        .all(scopedRoot) as ConceptRow[];
    }
    return this.connection.db.prepare(base).all() as ConceptRow[];
  }

  /**
   * Load existing corpora for dedupe. Returns lowercased concept + name sets
   * plus the single-type filters already covered.
   */
  private loadExistingCorpora(
    hasWorkspaceFilter: boolean,
    scopedRoot: string | null,
  ): {
    existingConceptsLc: Set<string>;
    existingNamesLc: Set<string>;
    existingSingleTypes: Set<string>;
  } {
    const existingConceptsLc = new Set<string>();
    const existingNamesLc = new Set<string>();
    const existingSingleTypes = new Set<string>();

    // Single batched read (id/name/workspace_root/query_json) — no per-row
    // `getByName`/`countMembers` round trip. Parse each filter blob in JS.
    const rows = hasWorkspaceFilter
      ? this.corpusStore.listFilterRows({ workspaceRoot: scopedRoot })
      : this.corpusStore.listFilterRows();

    for (const row of rows) {
      existingNamesLc.add(row.name.toLowerCase());
      const filter = parseCorpusFilter(row.queryJson);
      if (!filter) {
        this.logger.warn(
          '[memory-curator] suggest — corpus filter unparseable',
          { name: row.name },
        );
        continue;
      }
      if (Array.isArray(filter.concepts)) {
        for (const concept of filter.concepts) {
          if (typeof concept === 'string' && concept !== '') {
            existingConceptsLc.add(concept.toLowerCase());
          }
        }
      }
      if (
        Array.isArray(filter.type) &&
        filter.type.length === 1 &&
        typeof filter.type[0] === 'string'
      ) {
        existingSingleTypes.add(filter.type[0]);
      }
    }

    return { existingConceptsLc, existingNamesLc, existingSingleTypes };
  }

  /**
   * Defining concept + up to (TOP_CONCEPTS - 1) most-frequent co-occurring
   * concepts among the cluster's members (ties broken alphabetically).
   */
  private deriveTopConcepts(
    definingConcept: string,
    memberIds: readonly string[],
    idToConcepts: ReadonlyMap<string, Set<string>>,
  ): readonly string[] {
    const coCounts = new Map<string, number>();
    for (const id of memberIds) {
      const concepts = idToConcepts.get(id);
      if (!concepts) continue;
      for (const concept of concepts) {
        if (concept === definingConcept) continue;
        coCounts.set(concept, (coCounts.get(concept) ?? 0) + 1);
      }
    }
    const co = [...coCounts.entries()]
      .sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]))
      .slice(0, TOP_CONCEPTS - 1)
      .map(([concept]) => concept);
    return [definingConcept, ...co];
  }

  /**
   * Modal `type` across the cluster's members; ties resolve to the earliest
   * entry in `MEMORY_TYPE_ORDER`. `share` = dominant count / member count.
   */
  private deriveDominantType(
    memberIds: readonly string[],
    idToType: ReadonlyMap<string, string>,
  ): { dominantType: string; share: number } {
    const counts = new Map<string, number>();
    for (const id of memberIds) {
      const type = idToType.get(id);
      if (type === undefined) continue;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    let dominantType: string = MEMORY_TYPE_ORDER[0];
    let best = -1;
    for (const type of MEMORY_TYPE_ORDER) {
      const count = counts.get(type) ?? 0;
      if (count > best) {
        best = count;
        dominantType = type;
      }
    }
    const share = memberIds.length > 0 ? best / memberIds.length : 0;
    return { dominantType, share };
  }

  /**
   * Broad single-`type` fallback clusters, appended when concept clusters do
   * not fill `limit`. Sorted by count desc then enum order (deterministic).
   */
  private buildTypeSuggestions(
    hasWorkspaceFilter: boolean,
    scopedRoot: string | null,
    existingSingleTypes: ReadonlySet<string>,
    existingNamesLc: ReadonlySet<string>,
    remaining: number,
  ): readonly CorpusSuggestion[] {
    if (remaining <= 0) return [];

    const base = `SELECT m.type AS type, COUNT(*) AS n
                    FROM memories m
                   WHERE m.kind != 'entity'`;
    const rows = (
      hasWorkspaceFilter
        ? this.connection.db
            .prepare(
              `${base} AND m.workspace_root IS ? GROUP BY m.type HAVING n >= ?`,
            )
            .all(scopedRoot, TYPE_MIN_CLUSTER_SIZE)
        : this.connection.db
            .prepare(`${base} GROUP BY m.type HAVING n >= ?`)
            .all(TYPE_MIN_CLUSTER_SIZE)
    ) as TypeCountRow[];

    // Deterministic order: count desc, then enum position, then type name asc
    // (the trailing alphabetical tie-break makes types outside
    // `MEMORY_TYPE_ORDER` — which share the same fallback index — stable).
    const ordered = [...rows].sort(
      (a, b) =>
        b.n - a.n ||
        typeOrderIndex(a.type) - typeOrderIndex(b.type) ||
        compareStrings(a.type, b.type),
    );

    const suggestions: CorpusSuggestion[] = [];
    for (const row of ordered) {
      if (suggestions.length >= remaining) break;
      if (existingSingleTypes.has(row.type)) continue;
      // Same build-path name guard as the concept path; `name` feeds both
      // `suggestedName` and `filter.name` (equal by construction).
      const name = clampCorpusName(`${capitalize(row.type)} memories`);
      if (name === null) continue;
      if (existingNamesLc.has(name.toLowerCase())) continue;
      suggestions.push({
        suggestedName: name,
        filter: {
          name,
          workspaceRoot: scopedRoot,
          type: [row.type as MemoryType],
          limit: BOARD_LIMIT,
        },
        memberCount: row.n,
        topConcepts: [],
        rationale: `${row.n} ${row.type} memories`,
        signal: 'type',
      });
    }
    return suggestions;
  }
}

function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  set.add(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function typeOrderIndex(type: string): number {
  const idx = MEMORY_TYPE_ORDER.indexOf(type as MemoryType);
  return idx === -1 ? MEMORY_TYPE_ORDER.length : idx;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/**
 * Derive a corpus name guaranteed to satisfy the build-path `CorpusNameSchema`
 * (min 1, max 200): trim, truncate to 200, re-trim. Returns null when nothing
 * usable remains (empty after trimming) so the caller skips that cluster.
 */
function clampCorpusName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length <= MAX_CORPUS_NAME) return trimmed;
  const truncated = trimmed.slice(0, MAX_CORPUS_NAME).trim();
  return truncated === '' ? null : truncated;
}
