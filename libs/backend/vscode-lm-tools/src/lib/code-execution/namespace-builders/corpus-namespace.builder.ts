/**
 * Corpus namespace builder — exposes `ptah.corpus.build`, `ptah.corpus.list`,
 * `ptah.corpus.rebuild`, and `ptah.corpus.prime` inside the `execute_code`
 * sandbox so the in-chat agent can assemble and prime knowledge corpora
 * (workspace-scoped memory boards) conversationally.
 *
 * The knowledge agent is reached through the formal `IKnowledgeAgent` port from
 * `@ptah-extension/memory-contracts` (injected in `PtahAPIBuilder` via
 * `KNOWLEDGE_AGENT_TOKEN`, optional so it degrades gracefully on runtimes
 * without SQLite/SDK support). Following the established pattern from
 * `memory-namespace.builder.ts`:
 *
 * - Services are resolved lazily (via getter functions) to avoid DI timing
 *   issues and to degrade gracefully when the knowledge agent is not registered.
 * - Zod validates untrusted agent-supplied args at the boundary.
 * - `workspaceRoot` is ALWAYS injected from `getWorkspaceRoot()` and NEVER
 *   accepted from the model — the filter schema is `.strict()`, so a
 *   model-supplied `workspaceRoot` is rejected.
 * - Every method returns an `{ error }` envelope instead of throwing across the
 *   sandbox boundary.
 */

import { z } from 'zod';
import type {
  IKnowledgeAgent,
  BuildCorpusParams,
  CorpusRef,
  CorpusListEntry,
} from '@ptah-extension/memory-contracts';

export interface CorpusNamespaceDependencies {
  getKnowledgeAgent: () => IKnowledgeAgent | undefined;
  getWorkspaceRoot: () => string;
}

/**
 * Corpus name — required, non-empty, bounded. Mirrors the RPC-handler
 * `CorpusBuildParamsSchema` name constraint.
 */
const CorpusNameSchema = z.string().min(1).max(200);

/**
 * Memory type taxonomy — must match `MemoryType` in
 * `memory-contracts/curator-llm.port.ts`.
 */
const MemoryTypeSchema = z.enum([
  'bugfix',
  'feature',
  'decision',
  'discovery',
  'refactor',
  'change',
]);

/**
 * The LLM supplies a name + a natural filter; it MUST NOT supply a
 * `workspaceRoot` (injected from context). `.strict()` rejects unknown keys —
 * especially a model-supplied `workspaceRoot`.
 */
const CorpusFilterSchema = z
  .object({
    type: z.array(MemoryTypeSchema).max(10).optional(),
    concepts: z.array(z.string().min(1).max(200)).max(20).optional(),
    files: z.array(z.string().min(1).max(2048)).max(20).optional(),
    query: z.string().max(2000).optional(),
    dateRange: z
      .object({
        fromMs: z.number().int().nonnegative().optional(),
        toMs: z.number().int().nonnegative().optional(),
      })
      .optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

/**
 * Discriminated-union results — success shapes on the left, `{ error }`
 * envelopes on the right. No method ever throws across the sandbox boundary.
 */
export type CorpusBuildResult = { corpus: CorpusRef } | { error: string };
export type CorpusListResult =
  | { corpora: readonly CorpusListEntry[] }
  | { error: string };
export type CorpusRebuildResultEnvelope =
  | { added: number; removed: number }
  | { error: string };
export type CorpusPrimeResultEnvelope =
  | { sessionId: string }
  | { error: string };

export interface CorpusNamespace {
  build(name: string, filter?: unknown): Promise<CorpusBuildResult>;
  list(): Promise<CorpusListResult>;
  rebuild(name: string): Promise<CorpusRebuildResultEnvelope>;
  prime(name: string): Promise<CorpusPrimeResultEnvelope>;
}

const SERVICE_UNAVAILABLE = 'Knowledge corpus service not available';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Surface every Zod issue (not just the first) so a multi-field-invalid filter
 * reports all problems at once. Falls back to a generic message if empty.
 */
function zodMessage(error: z.ZodError, fallback: string): string {
  const joined = error.issues.map((issue) => issue.message).join('; ');
  return joined.length > 0 ? joined : fallback;
}

export function buildCorpusNamespace(
  deps: CorpusNamespaceDependencies,
): CorpusNamespace {
  const { getKnowledgeAgent, getWorkspaceRoot } = deps;

  return {
    build: async (
      name: string,
      filter?: unknown,
    ): Promise<CorpusBuildResult> => {
      const agent = getKnowledgeAgent();
      if (!agent) {
        return { error: SERVICE_UNAVAILABLE };
      }

      const parsedName = CorpusNameSchema.safeParse(name);
      if (!parsedName.success) {
        return {
          error: zodMessage(parsedName.error, 'Invalid corpus name'),
        };
      }

      const parsedFilter = CorpusFilterSchema.safeParse(filter ?? {});
      if (!parsedFilter.success) {
        return {
          error: zodMessage(parsedFilter.error, 'Invalid filter'),
        };
      }

      // workspaceRoot is ALWAYS injected — never taken from the model.
      const params: BuildCorpusParams = {
        name: parsedName.data,
        workspaceRoot: getWorkspaceRoot(),
        ...parsedFilter.data,
      };

      try {
        const corpus = await agent.buildCorpus(params);
        return { corpus };
      } catch (err: unknown) {
        return { error: errorMessage(err) };
      }
    },

    list: async (): Promise<CorpusListResult> => {
      const agent = getKnowledgeAgent();
      if (!agent) {
        return { error: SERVICE_UNAVAILABLE };
      }
      try {
        const corpora = agent.listCorpora(getWorkspaceRoot());
        return { corpora };
      } catch (err: unknown) {
        return { error: errorMessage(err) };
      }
    },

    rebuild: async (name: string): Promise<CorpusRebuildResultEnvelope> => {
      const agent = getKnowledgeAgent();
      if (!agent) {
        return { error: SERVICE_UNAVAILABLE };
      }
      const parsedName = CorpusNameSchema.safeParse(name);
      if (!parsedName.success) {
        return {
          error: zodMessage(parsedName.error, 'Invalid corpus name'),
        };
      }
      try {
        const { added, removed } = await agent.rebuildCorpus(parsedName.data);
        return { added, removed };
      } catch (err: unknown) {
        return { error: errorMessage(err) };
      }
    },

    prime: async (name: string): Promise<CorpusPrimeResultEnvelope> => {
      const agent = getKnowledgeAgent();
      if (!agent) {
        return { error: SERVICE_UNAVAILABLE };
      }
      const parsedName = CorpusNameSchema.safeParse(name);
      if (!parsedName.success) {
        return {
          error: zodMessage(parsedName.error, 'Invalid corpus name'),
        };
      }
      try {
        const { sessionId } = await agent.primeCorpus(parsedName.data);
        return { sessionId };
      } catch (err: unknown) {
        return { error: errorMessage(err) };
      }
    },
  };
}
