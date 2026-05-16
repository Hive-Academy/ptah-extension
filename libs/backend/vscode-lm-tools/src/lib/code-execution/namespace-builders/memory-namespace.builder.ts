/**
 * Memory namespace builder — exposes `ptah.memory.search`, `ptah.memory.list`,
 * and `ptah.memory.purgeBySubjectPattern` as MCP tools so the agent can retrieve
 * and manage memories on demand during a session.
 *
 * Services are resolved lazily (via getter functions) to avoid DI timing issues
 * and to degrade gracefully when memory-curator is not registered (e.g. VS Code
 * without SQLite support). Following the established pattern from
 * `agent-namespace.builder.ts` and `git-namespace.builder.ts`.
 *
 * Workspace-scope option bag is supported on ptah.memory.search.
 * Zod validation is applied at the MCP boundary for MemorySearchOptions.
 */

import { z } from 'zod';
import type {
  IMemoryReader,
  IMemoryLister,
  MemoryHit,
  MemoryRecord,
} from '@ptah-extension/memory-contracts';
import type { IMemoryWriter } from '@ptah-extension/platform-core';

export interface MemoryNamespaceDependencies {
  getMemorySearch: () => IMemoryReader | undefined;
  getMemoryStore: () => IMemoryLister | undefined;
  getMemoryWriter: () => IMemoryWriter | undefined;
  getWorkspaceRoot: () => string;
}

/**
 * Options bag for ptah.memory.search.
 *
 * - `workspace: true` — scope search to the active workspace (auto-injected root).
 * - `workspaceRoot: '/abs/path'` — scope search to an explicit absolute path (wins over `workspace`).
 * - `maxResults` — maximum hits to return (default: 10, capped to 50 by service).
 *
 * When both `workspace` and `workspaceRoot` are supplied, `workspaceRoot` wins,
 * consistent with the frontend filter behaviour.
 */
export interface MemorySearchOptions {
  workspace?: boolean;
  workspaceRoot?: string;
  maxResults?: number;
}

/**
 * Zod schema for validating the `MemorySearchOptions` object at the MCP boundary.
 *
 * The MCP tool path receives untrusted JSON from AI agent code. Fields like
 * `workspaceRoot` must be validated before calling `.trim()` or similar string
 * methods, as agents may send `{ workspaceRoot: 123 }` or `{ workspaceRoot: null }`.
 *
 * Schema constraints mirror the RPC-handler `MemorySearchParamsSchema` in
 * `rpc-handlers/src/lib/handlers/memory-rpc.schema.ts`:
 * - `workspaceRoot` uses `min(1)` to reject empty strings.
 * - `maxResults` is capped at 50 (same as the RPC handler's `topK` limit).
 */
export const MemorySearchOptionsSchema = z.object({
  workspace: z.boolean().optional(),
  workspaceRoot: z.string().min(1).optional(),
  maxResults: z.number().int().positive().max(50).optional(),
});

/**
 * Search result with an optional `scope` hint so the agent knows whether its
 * workspace-scope request was honoured or silently fell back to global.
 */
export type MemorySearchResult =
  | {
      hits: readonly MemoryHit[];
      bm25Only: boolean;
      scope: 'workspace' | 'global';
      /** Present only when `workspace: true` was requested but no workspace was open. */
      reason?: 'no_workspace';
    }
  | { hits: []; bm25Only: true; scope: 'global' | 'workspace'; error: string };

export interface MemoryNamespace {
  search(
    query: string,
    optionsOrMaxResults?: unknown,
  ): Promise<MemorySearchResult>;
  list(options?: {
    tier?: string;
    limit?: number;
    offset?: number;
  }): Promise<
    | { memories: readonly MemoryRecord[]; total: number }
    | { memories: []; total: 0; error: string }
  >;
  purgeBySubjectPattern(
    pattern: string,
    mode: 'substring' | 'like',
  ): Promise<{ deleted: number } | { deleted: 0; error: string }>;
}

/**
 * Resolve the effective workspace root and scope label from the options bag.
 *
 * Resolution order (matches frontend filter precedence):
 * 1. `options.workspaceRoot` (explicit absolute path) — always wins.
 * 2. `options.workspace === true` — auto-inject active workspace root.
 * 3. No option / number override (legacy positional) — global (undefined workspaceRoot).
 *
 * The second argument accepts `unknown` because the MCP boundary receives
 * untrusted JSON. Object inputs are validated via `MemorySearchOptionsSchema`
 * using `safeParse`; invalid objects are silently treated as no opts (global
 * search) per the error-envelope contract — no TypeError escapes.
 *
 * Returns `{ workspaceRoot, scope, noWorkspaceFallback, validatedOpts }`.
 * `validatedOpts` carries the parsed `MemorySearchOptions` when an object
 * passed validation (used by the caller to read `maxResults`).
 */
function resolveSearchScope(
  optionsOrMaxResults: unknown,
  getWorkspaceRoot: () => string,
): {
  workspaceRoot: string | undefined;
  scope: 'workspace' | 'global';
  noWorkspaceFallback: boolean;
  validatedOpts: MemorySearchOptions | undefined;
} {
  // Backward-compat: positional number or undefined → global search
  if (
    optionsOrMaxResults === undefined ||
    typeof optionsOrMaxResults === 'number'
  ) {
    return {
      workspaceRoot: undefined,
      scope: 'global',
      noWorkspaceFallback: false,
      validatedOpts: undefined,
    };
  }

  // Non-object values (string, null, array, boolean, etc.) → treat as no opts
  if (
    optionsOrMaxResults === null ||
    typeof optionsOrMaxResults !== 'object' ||
    Array.isArray(optionsOrMaxResults)
  ) {
    return {
      workspaceRoot: undefined,
      scope: 'global',
      noWorkspaceFallback: false,
      validatedOpts: undefined,
    };
  }

  // Object input: validate at the MCP boundary via Zod before touching any fields
  const parsed = MemorySearchOptionsSchema.safeParse(optionsOrMaxResults);
  if (!parsed.success) {
    // Invalid shape (e.g. workspaceRoot: 123, maxResults: -1) → treat as no opts
    return {
      workspaceRoot: undefined,
      scope: 'global',
      noWorkspaceFallback: false,
      validatedOpts: undefined,
    };
  }

  const opts = parsed.data;

  // Explicit absolute path wins over workspace flag
  if (opts.workspaceRoot !== undefined) {
    // workspaceRoot already passed min(1) so it is a non-empty string
    return {
      workspaceRoot: opts.workspaceRoot,
      scope: 'workspace',
      noWorkspaceFallback: false,
      validatedOpts: opts,
    };
  }

  if (opts.workspace === true) {
    const root = getWorkspaceRoot();
    if (!root) {
      // No active workspace — fall back to global with a hint
      return {
        workspaceRoot: undefined,
        scope: 'global',
        noWorkspaceFallback: true,
        validatedOpts: opts,
      };
    }
    return {
      workspaceRoot: root,
      scope: 'workspace',
      noWorkspaceFallback: false,
      validatedOpts: opts,
    };
  }

  // Options bag supplied but neither workspace nor workspaceRoot → global
  return {
    workspaceRoot: undefined,
    scope: 'global',
    noWorkspaceFallback: false,
    validatedOpts: opts,
  };
}

export function buildMemoryNamespace(
  deps: MemoryNamespaceDependencies,
): MemoryNamespace {
  const { getMemorySearch, getMemoryStore, getMemoryWriter, getWorkspaceRoot } =
    deps;

  return {
    search: async (
      query: string,
      optionsOrMaxResults?: unknown,
    ): Promise<MemorySearchResult> => {
      const reader = getMemorySearch();
      if (!reader) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          scope: 'global',
          error: 'Memory search service not available',
        };
      }

      const { workspaceRoot, scope, noWorkspaceFallback, validatedOpts } =
        resolveSearchScope(optionsOrMaxResults, getWorkspaceRoot);

      // Resolve maxResults — positional number wins; validated opts bag next; then default
      const maxResults =
        typeof optionsOrMaxResults === 'number'
          ? optionsOrMaxResults
          : (validatedOpts?.maxResults ?? 10);

      try {
        const result = await reader.search(query, maxResults, workspaceRoot);
        if (noWorkspaceFallback) {
          return { ...result, scope, reason: 'no_workspace' as const };
        }
        return { ...result, scope };
      } catch (err) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          scope,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    list: async (options?: {
      tier?: string;
      limit?: number;
      offset?: number;
    }) => {
      const lister = getMemoryStore();
      if (!lister) {
        return {
          memories: [] as [],
          total: 0 as const,
          error: 'Memory store not available',
        };
      }
      try {
        return lister.listAll(
          getWorkspaceRoot(),
          options?.tier,
          options?.limit ?? 50,
          options?.offset ?? 0,
        );
      } catch (err) {
        return {
          memories: [] as [],
          total: 0 as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    purgeBySubjectPattern: async (
      pattern: string,
      mode: 'substring' | 'like',
    ) => {
      const writer = getMemoryWriter();
      if (!writer) {
        return { deleted: 0 as const, error: 'Memory writer not available' };
      }
      if (pattern.trim() === '') {
        return { deleted: 0 as const, error: 'Pattern must not be empty' };
      }
      if (mode !== 'substring' && mode !== 'like') {
        return { deleted: 0 as const, error: 'Invalid mode' };
      }
      const workspaceRoot = getWorkspaceRoot();
      if (!workspaceRoot) {
        return {
          deleted: 0 as const,
          error:
            'No active workspace; cross-workspace purge is not permitted from MCP',
        };
      }
      try {
        const deleted = writer.purgeBySubjectPattern(
          pattern,
          mode,
          workspaceRoot,
        );
        return { deleted };
      } catch (err) {
        return {
          deleted: 0 as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
