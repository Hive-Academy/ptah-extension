import { injectable, inject } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import matter from 'gray-matter';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import type {
  IWorkspaceProvider,
  IFileSystemProvider,
  IDisposable,
  IFileWatcher,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';

/**
 * The errno of a failed `fs` call, or `''` when the rejection carried none.
 *
 * Used to tell "the directory is not there" (the normal case) apart from "the
 * directory is there and the OS refused" (a real problem the user must see).
 */
function errnoOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' ? code : '';
}

/**
 * Errnos that mean "this path is simply not a directory that exists".
 *
 * `ENOENT` is by far the common one — `~/.claude/agents` does not exist for any
 * user who has never authored a user-level agent, which is most of them.
 * `ENOTDIR` covers the same absence expressed differently (a parent segment is
 * a file), and Windows surfaces a missing path as `ENOENT` too.
 */
const ABSENT_DIR_ERRNOS: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/**
 * Agent information parsed from .md file
 */
export interface AgentInfo {
  readonly name: string;
  readonly description: string;
  readonly tools?: string[];
  readonly model?: string;
  readonly permissionMode?: string;
  readonly scope: 'project' | 'user' | 'builtin';
  readonly filePath: string;
  readonly prompt: string;
}

/**
 * Agent discovery result
 */
export interface AgentDiscoveryResult {
  success: boolean;
  agents?: AgentInfo[];
  error?: string;
}

/**
 * Agent search request
 */
export interface AgentSearchRequest {
  query: string;
  maxResults?: number;
  /**
   * Answer for this workspace specifically, overriding the process-global
   * `IWorkspaceProvider`. Omit for the active folder (pre-TASK_2026_200
   * behaviour). The process-global root is the *window's* folder in VS Code and
   * flips at runtime in Electron, so a caller bound to a particular workspace
   * must pass it — there is nothing else on the RPC envelope to disambiguate.
   */
  workspaceRoot?: string;
}

/**
 * Discovers and manages Claude CLI agents from .claude/agents/ directories
 *
 * ARCHITECTURE:
 * - Scans project + user agent directories
 * - Parses YAML frontmatter for agent metadata
 * - Watches for file changes (real-time invalidation)
 * - Caches results until file change detected
 */
@injectable()
export class AgentDiscoveryService {
  private cache: AgentInfo[] = [];
  private cacheTimestamp = 0;
  /**
   * `normalizeWorkspaceRoot()` of the root {@link cache} was built from, or
   * `undefined` when it was built with no workspace open.
   *
   * TASK_2026_200: `cache` is a process-global field and `searchAgents` served
   * it to every caller regardless of which workspace they asked about, so the
   * first workspace to populate it answered for all subsequent ones — the
   * silent wrong-workspace answer this task exists to kill, just on the `/`
   * picker instead of the `@` one. Keying the cache is what makes the explicit
   * `workspaceRoot` override actually observable; without it the override would
   * be accepted and then ignored on every call after the first.
   *
   * Written only alongside `cache` itself, synchronously and adjacently, so the
   * pair can never disagree about which root the list belongs to.
   */
  private cacheRootKey: string | undefined;
  private watchers: IDisposable[] = [];

  /**
   * `${dir}::${errno}` for every scan failure already reported this process.
   *
   * `scanAgentDirectory` runs on EVERY `autocomplete:agents` call, over both the
   * project and the user agent directory, and a user with no `~/.claude/agents`
   * fails the user half every single time. Reporting that repeatedly says
   * nothing a reader did not learn the first time (TASK_2026_315 C5).
   *
   * Keyed by errno, not by directory alone, so a directory that degrades from
   * absent to unreadable — ENOENT then EACCES after a permissions change — is
   * reported again under its new failure mode instead of being swallowed by the
   * earlier entry. Cleared for a directory the moment it reads successfully, so
   * a later regression is a fresh report rather than a permanent silence.
   */
  private readonly reportedScanFailures = new Set<string>();

  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fsProvider: IFileSystemProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /**
   * Get built-in agents
   */
  private getBuiltinAgents(): AgentInfo[] {
    return [
      {
        name: 'general-purpose',
        description:
          'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks',
        tools: ['*'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'statusline-setup',
        description: 'Configure status line setting',
        tools: ['Read', 'Edit'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'Explore',
        description:
          'Fast agent specialized for exploring codebases, finding files by patterns, searching code',
        tools: ['All tools'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'Plan',
        description: 'Fast agent for codebase exploration and planning',
        tools: ['All tools'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
      {
        name: 'claude-code-guide',
        description: 'Agent for documentation and SDK architecture questions',
        tools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'],
        scope: 'builtin',
        filePath: '',
        prompt: '',
      },
    ];
  }

  /**
   * Discover all agents (project + user).
   *
   * @param explicitRoot Scan this workspace instead of the process-global
   * active folder. Omitted → `IWorkspaceProvider.getWorkspaceRoot()`, exactly
   * as before TASK_2026_200.
   */
  async discoverAgents(explicitRoot?: string): Promise<AgentDiscoveryResult> {
    try {
      // An explicit root ALWAYS wins over the provider. The provider reports
      // whichever folder is active *now*, which is not necessarily the
      // workspace the calling tab/session is bound to.
      const workspaceRoot =
        explicitRoot ?? this.workspaceProvider.getWorkspaceRoot();
      const builtinAgents = this.getBuiltinAgents();

      if (!workspaceRoot) {
        return { success: true, agents: builtinAgents };
      }
      const projectAgents = await this.scanAgentDirectory(
        path.join(workspaceRoot, '.claude/agents'),
      );
      const userAgents = await this.scanAgentDirectory(
        path.join(os.homedir(), '.claude/agents'),
      );

      const allAgents = [
        ...builtinAgents, // Add built-in agents first - show at top
        ...projectAgents.map((a) => ({ ...a, scope: 'project' as const })),
        ...userAgents.map((a) => ({ ...a, scope: 'user' as const })),
      ];
      // Publish the list and the root it belongs to together: three adjacent
      // synchronous writes with no await between them, so a concurrent
      // discovery for another root can only replace the whole triple, never
      // leave `cache` from one root tagged with another root's key.
      this.cache = allAgents;
      this.cacheRootKey = normalizeWorkspaceRoot(workspaceRoot);
      this.cacheTimestamp = Date.now();

      return { success: true, agents: allAgents };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to discover agents: ${errorMessage}`,
      };
    }
  }

  /**
   * Search agents by query
   */
  async searchAgents(
    request: AgentSearchRequest,
  ): Promise<AgentDiscoveryResult> {
    try {
      const { query, maxResults = 20, workspaceRoot } = request;
      const root = workspaceRoot ?? this.workspaceProvider.getWorkspaceRoot();
      const rootKey = root ? normalizeWorkspaceRoot(root) : undefined;

      // Resolve the list into a LOCAL and filter that — never re-read
      // `this.cache` after an await. `cache` is a process-global field that any
      // concurrent `discoverAgents` for a different workspace can replace while
      // we are suspended; reading it post-await is precisely how the other
      // workspace's agents end up in this caller's `/` picker.
      let agents: AgentInfo[];
      if (this.cache.length > 0 && this.cacheRootKey === rootKey) {
        // Cache hit: the check above and this read are in the same synchronous
        // block, so the list cannot be swapped out between them.
        agents = this.cache;
      } else {
        const discovered = await this.discoverAgents(root);
        // The awaited call's OWN return value — immune to a later publish.
        //
        // A failed discovery degrades to an empty list rather than propagating
        // `success: false`, matching the pre-TASK_2026_200 code, which ignored
        // `discoverAgents()`'s return entirely and sliced an empty `cache`.
        //
        // ONE deliberate behaviour change (TASK_2026_200, documented): with NO
        // workspace open, `discoverAgents` returns the builtin agents but does
        // not cache them, so the old code sliced the empty field and dropped
        // them. Reading the return value surfaces them, which is plainly what
        // `discoverAgents` intends. Covered by a named test.
        agents = discovered.agents ?? [];
      }

      if (!query || query.trim() === '') {
        return { success: true, agents: agents.slice(0, maxResults) };
      }

      const lowerQuery = query.toLowerCase();
      const filtered = agents.filter(
        (agent) =>
          agent.name.toLowerCase().includes(lowerQuery) ||
          agent.description.toLowerCase().includes(lowerQuery),
      );

      return { success: true, agents: filtered.slice(0, maxResults) };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to search agents: ${errorMessage}`,
      };
    }
  }

  /**
   * Initialize file watchers for real-time updates.
   *
   * DELIBERATELY NOT root-parameterized (TASK_2026_200 task 2.4). This is a
   * background refresh path with no caller to scope it to — it is armed once at
   * activation, and its `refreshCache` fires from OS events, not from a request
   * that knows which workspace it means. Threading a root here would only pin
   * the watcher to whichever workspace happened to be active at activation
   * time, which is worse than tracking the process-global active folder. The
   * per-request correctness fix lives in `searchAgents`/`discoverAgents`, where
   * a caller with an opinion actually exists. Please do not "fix" this.
   */
  initializeWatchers(): void {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) return;
    const projectWatcher = this.fsProvider.createFileWatcher(
      '.claude/agents/*.md',
    );

    const refreshCache = () => {
      this.discoverAgents().catch((error) => {
        console.error('[AgentDiscovery] Failed to refresh cache:', error);
      });
    };

    const createDisposable = projectWatcher.onDidCreate(refreshCache);
    const changeDisposable = projectWatcher.onDidChange(refreshCache);
    const deleteDisposable = projectWatcher.onDidDelete(refreshCache);

    this.watchers.push(
      projectWatcher,
      createDisposable,
      changeDisposable,
      deleteDisposable,
    );
  }

  /**
   * Scan agent directory for .md files
   */
  private async scanAgentDirectory(dir: string): Promise<AgentInfo[]> {
    try {
      const files = await fs.readdir(dir);
      const agentFiles = files.filter((f) => f.endsWith('.md'));

      const agents = await Promise.all(
        agentFiles.map((file) => this.parseAgentFile(path.join(dir, file))),
      );

      for (const key of [...this.reportedScanFailures]) {
        if (key.startsWith(`${dir}::`)) this.reportedScanFailures.delete(key);
      }

      return agents.filter(Boolean) as AgentInfo[];
    } catch (error: unknown) {
      this.reportScanFailure(dir, error);
      return [];
    }
  }

  /**
   * Report a directory scan that failed, at most once per directory per errno.
   *
   * The two failures are not the same event and must not read the same. An
   * ABSENT directory is the expected shape of a machine where the user never
   * created a user-level agent, so it belongs at debug. A directory that is
   * present and the OS refused to open — EACCES, EPERM, EBUSY, EIO — is a real
   * problem the user has to be able to see, so it is a warning; quietening it
   * along with the expected miss is exactly the mistake this fix must not make.
   */
  private reportScanFailure(dir: string, error: unknown): void {
    const errno = errnoOf(error);
    const key = `${dir}::${errno}`;
    if (this.reportedScanFailures.has(key)) return;
    this.reportedScanFailures.add(key);

    const detail = {
      dir,
      code: errno === '' ? undefined : errno,
      error: error instanceof Error ? error.message : String(error),
    };

    if (ABSENT_DIR_ERRNOS.has(errno)) {
      this.logger.debug('[AgentDiscovery] No agent directory here', detail);
      return;
    }
    this.logger.warn('[AgentDiscovery] Agent directory unreadable', detail);
  }

  /**
   * Parse agent .md file with YAML frontmatter
   */
  private async parseAgentFile(filePath: string): Promise<AgentInfo | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter, content: prompt } = matter(content);
      if (!frontmatter['name'] || !frontmatter['description']) {
        console.warn(
          `[AgentDiscovery] Invalid agent file (missing name/description): ${filePath}`,
        );
        return null;
      }
      if (!/^[a-z0-9-]+$/.test(frontmatter['name'])) {
        console.warn(
          `[AgentDiscovery] Invalid agent name format: ${frontmatter['name']}`,
        );
        return null;
      }

      return {
        name: frontmatter['name'],
        description: frontmatter['description'],
        tools: frontmatter['tools']?.split(',').map((t: string) => t.trim()),
        model: frontmatter['model'],
        permissionMode: frontmatter['permissionMode'],
        scope: 'project', // Will be overridden by caller
        filePath,
        prompt: prompt.trim(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[AgentDiscovery] Failed to parse agent file ${filePath}:`,
        errorMessage,
      );
      return null;
    }
  }

  /**
   * Cleanup watchers on disposal
   */
  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
  }
}
