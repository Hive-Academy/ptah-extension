/**
 * Memory ground truth for `ptah_memory_search`: 150 synthetic project facts
 * built from fixed templates (no RNG, no user data), 20 abstention queries and
 * the 4 hand-graded TASK_2026_473 track-A queries.
 *
 * Facts live under two workspace roots, A and B, with placeholder root names so
 * the frozen file stays machine-independent. Every fact family exists in both
 * roots under the same subject with different values, so a cross-workspace
 * leak is detectable: a query scoped to one root must never return the other
 * root's fact (expectedLeakCount 0). Every fact is a temporal-update pair: an
 * older value superseded by a newer one; the truth is always the newer row.
 * A query issued from `<worktreeOfA>` expects A's facts, per the read-side
 * worktree mapping (worktree root plus the main repository root).
 *
 * `seedMemory` inserts the set through the product's memory store API
 * (`insertMemoryWithChunks`) — never raw SQL — so embeddings and FTS rows are
 * real. It opens no DB and resolves no path itself: Batch 9 calls it inside
 * the isolated bench host, from the `afterContainerReady` hook, with the real
 * store and isolated DB already wired. The older row is inserted before the
 * newer one.
 */

import { z } from 'zod';
import type {
  ChunkInsert,
  MemoryId,
  MemoryInsert,
  MemoryKind,
  MemoryStore,
  MemoryTier,
} from '@ptah-extension/memory-curator';
import { resultTokens } from '../metrics/cost-metrics';

/** Root placeholders used in the frozen file; seedMemory maps them to real roots. */
export type MemoryRootPlaceholder = '<rootA>' | '<rootB>' | '<worktreeOfA>';

/** The five synthetic project names each fact family uses. */
const FACT_PROJECTS: readonly string[] = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
];

/** Old and new fact values for one root; the new value supersedes the old. */
interface FactValues {
  readonly old: string;
  readonly new: string;
}

interface FactFamily {
  /** Subject slug: subject = `${project}-${slug}`, shared across roots. */
  readonly slug: string;
  readonly kind: MemoryKind;
  readonly tier: MemoryTier;
  /** Content sentence; the value is the only varying part. */
  readonly content: (project: string, value: string) => string;
  readonly verbatim: (project: string) => string;
  readonly paraphrase1: (project: string) => string;
  readonly paraphrase2: (project: string) => string;
  /** Values differ between roots so a workspace leak is detectable. */
  readonly values: (root: 'A' | 'B', projectIndex: number) => FactValues;
}

const FAMILIES: readonly FactFamily[] = [
  {
    slug: 'lint-max-lines',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `The ${project} lint max-lines ceiling is ${value}.`,
    verbatim: (project) => `${project} lint max lines ceiling`,
    paraphrase1: (project) =>
      `how long can a source file be in the ${project} project`,
    paraphrase2: (project) => `largest permitted file length for ${project}`,
    values: (root, i) =>
      root === 'A'
        ? { old: `${620 + i * 10} lines`, new: `${700 + i * 10} lines` }
        : { old: `${530 + i * 10} lines`, new: `${810 + i * 10} lines` },
  },
  {
    slug: 'commit-message-style',
    kind: 'preference',
    tier: 'core',
    content: (project, value) =>
      `Commits in the ${project} project use ${value} commit messages.`,
    verbatim: (project) => `commit message format for ${project}`,
    paraphrase1: (project) => `how should the ${project} git history read`,
    paraphrase2: (project) => `git wording rules in ${project}`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'short plain-text', new: 'conventional' }
        : { old: 'imperative-mood', new: 'gitmoji' },
  },
  {
    slug: 'dev-port',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `The ${project} development server listens on port ${value}.`,
    verbatim: (project) => `${project} dev server port number`,
    paraphrase1: (project) => `which port does ${project} serve on locally`,
    paraphrase2: (project) => `${project} local network port for development`,
    values: (root, i) =>
      root === 'A'
        ? { old: String(51810 + i), new: String(51820 + i) }
        : { old: String(51910 + i), new: String(51920 + i) },
  },
  {
    slug: 'node-version',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `The ${project} project builds with Node ${value}.`,
    verbatim: (project) => `node version for ${project}`,
    paraphrase1: (project) => `which runtime does ${project} target`,
    paraphrase2: (project) => `${project} javascript engine requirement`,
    values: (root, _i) =>
      root === 'A'
        ? { old: '20.11.0', new: '22.13.0' }
        : { old: '18.19.0', new: '24.1.0' },
  },
  {
    slug: 'test-runner',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `Tests in the ${project} project run with ${value}.`,
    verbatim: (project) => `test runner for ${project}`,
    paraphrase1: (project) => `what executes the ${project} test suite`,
    paraphrase2: (project) => `${project} unit testing framework choice`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'mocha', new: 'jest' }
        : { old: 'jasmine', new: 'vitest' },
  },
  {
    slug: 'package-manager',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `Dependencies in the ${project} project are installed with ${value}.`,
    verbatim: (project) => `package manager for ${project}`,
    paraphrase1: (project) => `which tool installs ${project} dependencies`,
    paraphrase2: (project) => `${project} dependency install command`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'npm', new: 'pnpm' }
        : { old: 'yarn classic', new: 'bun' },
  },
  {
    slug: 'code-formatter',
    kind: 'preference',
    tier: 'core',
    content: (project, value) =>
      `The ${project} project formats code with ${value}.`,
    verbatim: (project) => `code formatter for ${project}`,
    paraphrase1: (project) => `which tool styles ${project} source files`,
    paraphrase2: (project) => `${project} formatting engine`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'prettier', new: 'biome' }
        : { old: 'standardjs', new: 'dprint' },
  },
  {
    slug: 'migration-language',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `Database migrations in the ${project} project are written in ${value}.`,
    verbatim: (project) => `migration language for ${project}`,
    paraphrase1: (project) => `how are ${project} schema changes authored`,
    paraphrase2: (project) => `${project} database change file format`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'plain SQL', new: 'TypeScript' }
        : { old: 'Ruby DSL', new: 'Go code' },
  },
  {
    slug: 'review-approvals',
    kind: 'preference',
    tier: 'core',
    content: (project, value) =>
      `Changes in the ${project} project need ${value} approval before merge.`,
    verbatim: (project) => `review approval needed in ${project}`,
    paraphrase1: (project) => `how many approvals gate a ${project} merge`,
    paraphrase2: (project) => `${project} merge rule on reviewers`,
    values: (root, _i) =>
      root === 'A' ? { old: 'one', new: 'two' } : { old: 'zero', new: 'three' },
  },
  {
    slug: 'release-branch',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `Releases in the ${project} project are cut from ${value}.`,
    verbatim: (project) => `release branch for ${project}`,
    paraphrase1: (project) => `where do ${project} releases come from`,
    paraphrase2: (project) => `which branch ships ${project} versions`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'main', new: 'release/main' }
        : { old: 'develop', new: 'release/next' },
  },
  {
    slug: 'error-reporting',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `Errors in the ${project} project are reported to ${value}.`,
    verbatim: (project) => `error reporting tool for ${project}`,
    paraphrase1: (project) => `where do ${project} failures get reported`,
    paraphrase2: (project) => `${project} crash reporting destination`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'a log file', new: 'the telemetry service' }
        : { old: 'the console', new: 'an issue tracker' },
  },
  {
    slug: 'cache-backend',
    kind: 'entity',
    tier: 'core',
    content: (project, value) =>
      `The ${project} project stores its cache in ${value}.`,
    verbatim: (project) => `cache backend for ${project}`,
    paraphrase1: (project) => `where does ${project} keep cached data`,
    paraphrase2: (project) => `${project} cache storage engine`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'memory', new: 'redis' }
        : { old: 'disk', new: 'memcached' },
  },
  {
    slug: 'ci-cadence',
    kind: 'event',
    tier: 'recall',
    content: (project, value) => `The ${project} pipeline runs ${value}.`,
    verbatim: (project) => `ci schedule for ${project}`,
    paraphrase1: (project) => `when does the ${project} pipeline trigger`,
    paraphrase2: (project) => `${project} build automation timing`,
    values: (root, _i) =>
      root === 'A'
        ? { old: 'nightly', new: 'on every push' }
        : { old: 'weekly', new: 'on every merge' },
  },
  {
    slug: 'token-budget',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `Tool results in the ${project} project are capped at ${value} characters.`,
    verbatim: (project) => `tool result budget in ${project}`,
    paraphrase1: (project) => `how large can a ${project} tool answer be`,
    paraphrase2: (project) => `${project} response size limit`,
    values: (root, i) =>
      root === 'A'
        ? { old: `${3000 + i * 100}`, new: `${8000 + i * 100}` }
        : { old: `${2000 + i * 100}`, new: `${9000 + i * 100}` },
  },
  {
    slug: 'index-cap',
    kind: 'fact',
    tier: 'core',
    content: (project, value) =>
      `The ${project} symbol index covers ${value} files.`,
    verbatim: (project) => `symbol index file cap for ${project}`,
    paraphrase1: (project) => `how many files does the ${project} index track`,
    paraphrase2: (project) => `${project} indexer coverage limit`,
    values: (root, i) =>
      root === 'A'
        ? { old: `${1000 + i * 100} files`, new: `${2000 + i * 100} files` }
        : { old: `${1500 + i * 100} files`, new: `${2500 + i * 100} files` },
  },
];

/** One stored row of a fact: `old` (superseded) or `new` (the truth). */
export interface MemoryFactRow {
  readonly id: string;
  readonly age: 'old' | 'new';
  readonly content: string;
}

/** One fact: a subject under one root with its temporal-update pair. */
export interface MemoryFact {
  readonly id: string;
  readonly subject: string;
  readonly root: 'A' | 'B';
  readonly kind: MemoryKind;
  readonly tier: MemoryTier;
  readonly rows: readonly [MemoryFactRow, MemoryFactRow];
}

/** One memory question (verbatim, paraphrase, worktree, abstention or labelled). */
export interface MemoryQuestion {
  readonly id: string;
  readonly scope: MemoryRootPlaceholder;
  readonly query: string;
  readonly expectedFactIds: readonly string[];
  readonly expectedLeakCount: number;
  readonly abstain?: boolean;
  readonly method?: 'labelled';
  readonly raterCount?: number;
  readonly scorable?: boolean;
  readonly unscorableReason?: string;
}

/** Question categories the scorecard reports. */
export interface MemoryCounts {
  readonly facts: number;
  readonly rows: number;
  readonly verbatim: number;
  readonly paraphrase: number;
  readonly worktree: number;
  readonly abstention: number;
  readonly labelled: number;
  readonly total: number;
}

/** The seeded fact set plus every question derived from it. */
export interface MemoryQuestionSet {
  readonly facts: readonly MemoryFact[];
  readonly questions: readonly MemoryQuestion[];
  readonly counts: MemoryCounts;
}

/** Abstention queries: topics no seeded fact mentions. */
const ABSTENTION_QUERIES: readonly string[] = [
  'which espresso machine is in the office kitchen',
  'what is the wifi password in the studio',
  'who won the company football tournament',
  'which plant sits on the meeting room shelf',
  'what brand of pens does the design team prefer',
  'where is the company offsite next year',
  'what colour are the office walls',
  'who waters the office plants',
  'which podcast does the team listen to on Fridays',
  'what snacks are stocked in the pantry',
  'how many desks are in the corner room',
  'which streaming service plays in the lobby',
  'what is the founder favourite pizza topping',
  'who owns the shared coffee grinder',
  'which neighbourhood has the best lunch spots near the studio',
  'what board game is popular after hours',
  'who organises the birthday calendar',
  'which mug belongs to the intern',
  'what ringtone does the front desk phone use',
  'which season had the best weather for the picnic',
];

/**
 * The 4 TASK_2026_473 track-A queries, hand-graded against the user's real
 * memory. Their truth rows live in the real user DB, so they cannot be seeded
 * without user data and stay in the frozen set unscorable.
 */
export const TRACK_A_REASON =
  'hand-graded against real user memory rows that cannot be seeded without user data';

const TRACK_A_QUERIES: readonly {
  readonly id: string;
  readonly query: string;
}[] = [
  { id: 'track-a-q1', query: 'what did we decide about the judge threshold' },
  { id: 'track-a-q2', query: 'how do we name DI tokens' },
  { id: 'track-a-q3', query: 'why did the release branch drift' },
  {
    id: 'track-a-q4',
    query: "what is the user's preference for commit messages",
  },
];

const scopeOfRoot = (root: 'A' | 'B'): MemoryRootPlaceholder =>
  root === 'A' ? '<rootA>' : '<rootB>';

/** Builds the 150-fact seed set and every question derived from it. */
export function buildMemoryQuestionSet(): MemoryQuestionSet {
  const facts: MemoryFact[] = [];
  const questions: MemoryQuestion[] = [];
  for (const family of FAMILIES) {
    FACT_PROJECTS.forEach((project, projectIndex) => {
      for (const root of ['A', 'B'] as const) {
        const factId = `fact-${String(facts.length + 1).padStart(3, '0')}`;
        const subject = `${project}-${family.slug}`;
        const values = family.values(root, projectIndex);
        const oldRow: MemoryFactRow = {
          id: `${factId}-old`,
          age: 'old',
          content: family.content(project, values.old),
        };
        const newRow: MemoryFactRow = {
          id: `${factId}-new`,
          age: 'new',
          content: family.content(project, values.new),
        };
        facts.push({
          id: factId,
          subject,
          root,
          kind: family.kind,
          tier: family.tier,
          rows: [oldRow, newRow],
        });
        for (const [suffix, query] of [
          ['v', family.verbatim(project)],
          ['p1', family.paraphrase1(project)],
          ['p2', family.paraphrase2(project)],
        ] as const) {
          questions.push({
            id: `${factId}-${suffix}`,
            scope: scopeOfRoot(root),
            query,
            expectedFactIds: [newRow.id],
            expectedLeakCount: 0,
          });
        }
        // One query per family, issued from the worktree of A, expecting A's
        // fact (read-side worktree mapping; the worktree itself stores none).
        if (root === 'A' && projectIndex === 0) {
          questions.push({
            id: `wt-${factId}`,
            scope: '<worktreeOfA>',
            query: family.paraphrase2(project),
            expectedFactIds: [newRow.id],
            expectedLeakCount: 0,
          });
        }
      }
    });
  }
  ABSTENTION_QUERIES.forEach((query, index) => {
    questions.push({
      id: `abstain-${String(index + 1).padStart(2, '0')}`,
      scope: (['<rootA>', '<rootB>', '<worktreeOfA>'] as const)[index % 3],
      query,
      expectedFactIds: [],
      expectedLeakCount: 0,
      abstain: true,
    });
  });
  for (const trackA of TRACK_A_QUERIES) {
    questions.push({
      id: trackA.id,
      scope: '<rootA>',
      query: trackA.query,
      expectedFactIds: [],
      expectedLeakCount: 0,
      method: 'labelled',
      raterCount: 1,
      scorable: false,
      unscorableReason: TRACK_A_REASON,
    });
  }
  const verbatim = questions.filter((q) => q.id.endsWith('-v')).length;
  const paraphrase = questions.filter(
    (q) => q.id.endsWith('-p1') || q.id.endsWith('-p2'),
  ).length;
  const worktree = questions.filter((q) => q.id.startsWith('wt-')).length;
  const abstention = questions.filter((q) => q.abstain === true).length;
  const labelled = questions.filter((q) => q.method === 'labelled').length;
  return {
    facts,
    questions,
    counts: {
      facts: facts.length,
      rows: facts.length * 2,
      verbatim,
      paraphrase,
      worktree,
      abstention,
      labelled,
      total: questions.length,
    },
  };
}

/** Real roots the placeholders map to during seeding. */
export interface MemoryRoots {
  readonly rootA: string;
  readonly rootB: string;
  /** Present for completeness; the worktree stores no facts of its own. */
  readonly worktreeOfA: string;
}

/**
 * Inserts the fact set through the product's memory store API, the older row
 * before the newer one, and returns the inserted id per fact row. Opens no DB
 * and resolves no path: the caller supplies the live store inside the isolated
 * bench host (Batch 9, `afterContainerReady`).
 */
export async function seedMemory(
  target: Pick<MemoryStore, 'insertMemoryWithChunks'>,
  set: MemoryQuestionSet,
  roots: MemoryRoots,
): Promise<ReadonlyMap<string, MemoryId>> {
  const insertedIds = new Map<string, MemoryId>();
  for (const fact of set.facts) {
    const workspaceRoot = fact.root === 'A' ? roots.rootA : roots.rootB;
    for (const row of fact.rows) {
      const insert: MemoryInsert = {
        workspaceRoot,
        tier: fact.tier,
        kind: fact.kind,
        subject: fact.subject,
        content: row.content,
      };
      const chunks: readonly Omit<ChunkInsert, 'memoryId'>[] = [
        { ord: 0, text: row.content, tokenCount: resultTokens(row.content) },
      ];
      const id = await target.insertMemoryWithChunks(insert, chunks);
      insertedIds.set(row.id, id);
    }
  }
  return insertedIds;
}

// ---------------------------------------------------------------------------
// frozen file
// ---------------------------------------------------------------------------

export interface MemoryBuildOptions {
  readonly corpusCommit: string;
  readonly frozenAt: string;
  readonly generator?: string;
}

/** Frozen memory question file (envelope mirrors scorecard groundTruth). */
export interface MemoryQuestionFile {
  readonly id: 'memory';
  readonly version: '1';
  readonly method: 'seeded';
  readonly frozenAt: string;
  readonly corpusCommit: string;
  readonly generator: string;
  readonly seed: null;
  readonly counts: MemoryCounts;
  readonly questions: readonly MemoryQuestion[];
}

export const memoryQuestionSchema = z
  .object({
    id: z.string().min(1),
    scope: z.enum(['<rootA>', '<rootB>', '<worktreeOfA>']),
    query: z.string().min(1),
    expectedFactIds: z.array(z.string().min(1)),
    expectedLeakCount: z.number().int().nonnegative(),
    abstain: z.boolean().optional(),
    method: z.literal('labelled').optional(),
    raterCount: z.number().int().positive().optional(),
    scorable: z.boolean().optional(),
    unscorableReason: z.string().min(1).optional(),
  })
  .superRefine((question, context) => {
    if (question.abstain === true && question.expectedFactIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an abstention question must expect no facts',
        path: ['expectedFactIds'],
      });
    }
    if (
      question.expectedFactIds.length === 0 &&
      question.abstain !== true &&
      question.scorable !== false
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an empty expectation must abstain or be unscorable',
        path: ['expectedFactIds'],
      });
    }
    if (
      question.scorable === false &&
      question.unscorableReason === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an unscorable question must carry a reason',
        path: ['unscorableReason'],
      });
    }
    if (
      question.scorable !== false &&
      question.unscorableReason !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a scorable question carries no unscorableReason',
        path: ['unscorableReason'],
      });
    }
    if (question.method === 'labelled' && question.raterCount === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a labelled question must carry raterCount',
        path: ['raterCount'],
      });
    }
  });

export const memoryQuestionFileSchema = z
  .object({
    id: z.literal('memory'),
    version: z.literal('1'),
    method: z.literal('seeded'),
    frozenAt: z.string().datetime(),
    corpusCommit: z.string().min(1),
    generator: z.string().min(1),
    seed: z.null(),
    counts: z.object({
      facts: z.number().int().nonnegative(),
      rows: z.number().int().nonnegative(),
      verbatim: z.number().int().nonnegative(),
      paraphrase: z.number().int().nonnegative(),
      worktree: z.number().int().nonnegative(),
      abstention: z.number().int().nonnegative(),
      labelled: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    questions: z.array(memoryQuestionSchema),
  })
  .superRefine((file, context) => {
    if (file.counts.facts * 2 !== file.counts.rows) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'counts.rows must equal counts.facts * 2',
        path: ['counts', 'rows'],
      });
    }
    if (file.counts.total !== file.questions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'counts.total must equal questions.length',
        path: ['counts', 'total'],
      });
    }
  });

/** Builds the question set and the frozen memory question file. */
export function buildMemoryQuestionFile(options: MemoryBuildOptions): {
  readonly set: MemoryQuestionSet;
  readonly file: MemoryQuestionFile;
} {
  const set = buildMemoryQuestionSet();
  return {
    set,
    file: {
      id: 'memory',
      version: '1',
      method: 'seeded',
      frozenAt: options.frozenAt,
      corpusCommit: options.corpusCommit,
      generator: options.generator ?? 'memory-questions.ts',
      seed: null,
      counts: set.counts,
      questions: set.questions,
    },
  };
}
