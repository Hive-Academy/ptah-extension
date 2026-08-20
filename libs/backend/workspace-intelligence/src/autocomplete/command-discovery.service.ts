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
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';

/**
 * Frontmatter block plus the markdown body that follows it.
 *
 * Values are narrowed to strings: every field this service consumes
 * (`name`, `description`, `argument-hint`, `allowed-tools`, `model`) is a
 * scalar string in practice, and the tolerant fallback below can only ever
 * produce strings.
 */
interface ParsedFrontmatter {
  readonly data: Record<string, string>;
  readonly content: string;
}

/** `---\n…\n---\n<body>`, tolerating a BOM and CRLF line endings. */
const FRONTMATTER_BLOCK =
  /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

const FRONTMATTER_ENTRY = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Line-oriented frontmatter reader used when strict YAML parsing fails.
 *
 * Splits each entry on its FIRST colon and takes the remainder of the line
 * verbatim, which is precisely what strict YAML refuses to do. Skill authors
 * routinely write
 *
 *   description: Interactive designer. Use when users want to: (1) do a thing
 *
 * — legal for Claude Code's tolerant reader, but a hard parse error for
 * js-yaml ("incomplete explicit mapping pair"). Indented lines continue the
 * previous key so folded descriptions survive too.
 */
function parseFrontmatterTolerant(raw: string): ParsedFrontmatter {
  const match = FRONTMATTER_BLOCK.exec(raw);
  if (!match) return { data: {}, content: raw };

  const [, block, body = ''] = match;
  const data: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const line of block.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;

    const entry = FRONTMATTER_ENTRY.exec(line);
    if (entry) {
      currentKey = entry[1];
      data[currentKey] = stripWrappingQuotes(entry[2]);
      continue;
    }
    // Indented continuation of the previous key (folded scalar).
    if (currentKey !== null && /^[ \t]/.test(line)) {
      data[currentKey] = `${data[currentKey]} ${line.trim()}`.trim();
    }
  }

  return { data, content: body };
}

/**
 * Parse frontmatter, degrading to {@link parseFrontmatterTolerant} instead of
 * throwing. A skill whose description merely contains an unquoted colon used
 * to be dropped from discovery entirely in all three hosts.
 */
function parseFrontmatterLenient(
  raw: string,
  onFallback?: () => void,
): ParsedFrontmatter {
  try {
    // The options argument is load-bearing, not decoration. gray-matter
    // populates `matter.cache[content]` with the UNPARSED file object BEFORE
    // it runs the YAML parser (index.js:47 then :50), so once a document
    // throws, that poisoned entry — `data: {}` — is what every later call for
    // the same content returns, silently and without throwing. Discovery
    // re-scans on every file-watcher event, so a skill would parse-fail once
    // and then be served with empty frontmatter forever, never reaching the
    // fallback below. Passing any options object opts out of the cache
    // entirely (index.js:37).
    const parsed = matter(raw, {});
    return {
      data: parsed.data as Record<string, string>,
      content: parsed.content,
    };
  } catch {
    onFallback?.();
    return parseFrontmatterTolerant(raw);
  }
}

/** Node's errno shape, for distinguishing "no such file" from real failures. */
function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Command information
 */
export interface CommandInfo {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly scope: 'builtin' | 'project' | 'user' | 'mcp' | 'plugin';
  readonly filePath?: string;
  readonly template?: string;
  readonly allowedTools?: string[];
  readonly model?: string;
}

/**
 * Command discovery result
 */
export interface CommandDiscoveryResult {
  success: boolean;
  commands?: CommandInfo[];
  error?: string;
}

/**
 * Command search request
 */
export interface CommandSearchRequest {
  query: string;
  maxResults?: number;
  /**
   * Answer for this workspace specifically, overriding the process-global
   * `IWorkspaceProvider`. Omit for the active folder (pre-TASK_2026_200
   * behaviour). Same contract as `AgentSearchRequest.workspaceRoot`.
   */
  workspaceRoot?: string;
}

/**
 * Discovers and manages Claude CLI commands (built-in + custom)
 *
 * ARCHITECTURE:
 * - Hardcoded built-in commands (6 total)
 * - Scans .claude/commands/ directories (project + user)
 * - Scans .claude/skills/ directory (populated by HarnessReconciler)
 * - Parses YAML frontmatter for command metadata
 * - Watches for file changes (real-time invalidation)
 *
 * Commands and skills are discovered from the workspace .claude/ directory
 * (the source of truth) — NOT from plugin source directories.
 * `HarnessReconciler` (@ptah-extension/harness-sync) copies both surfaces
 * there from the user layer at activation and on every harness trigger. This
 * avoids plugin-namespaced entries (e.g. ptah-core:orchestrate) that the SDK
 * can't resolve since plugins are not passed via the SDK query option.
 */
@injectable()
export class CommandDiscoveryService {
  private cache: CommandInfo[] = [];
  /**
   * `normalizeWorkspaceRoot()` of the root {@link cache} was built from.
   *
   * TASK_2026_200: `cache` is process-global and `searchCommands` served it to
   * every caller regardless of the workspace asked about, so the first
   * workspace to populate it answered for all later ones. Keying it is what
   * makes the explicit `workspaceRoot` override observable rather than accepted
   * and ignored. Written only alongside `cache`, synchronously and adjacently.
   */
  private cacheRootKey: string | undefined;
  private watchers: IDisposable[] = [];

  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fsProvider: IFileSystemProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Invalidate the command cache.
   * Called when plugin configuration changes so the next search
   * picks up newly junctioned skills and copied commands.
   */
  invalidateCache(): void {
    this.cache = [];
    // Clear the key with the list. Leaving a stale key behind a cleared cache
    // is harmless today (`cache.length > 0` is checked first) but becomes a
    // wrong-root cache hit the moment that check is relaxed.
    this.cacheRootKey = undefined;
  }

  /**
   * Discover all commands (built-in + custom + skills).
   *
   * @param explicitRoot Scan this workspace instead of the process-global
   * active folder. Omitted → `IWorkspaceProvider.getWorkspaceRoot()`, exactly
   * as before TASK_2026_200.
   */
  async discoverCommands(
    explicitRoot?: string,
  ): Promise<CommandDiscoveryResult> {
    try {
      // An explicit root ALWAYS wins over the provider — see discoverAgents.
      const workspaceRoot =
        explicitRoot ?? this.workspaceProvider.getWorkspaceRoot();
      if (!workspaceRoot) {
        return { success: false, error: 'No workspace folder open' };
      }
      const builtins = this.getBuiltinCommands();
      const projectCommands = await this.scanCommandDirectory(
        path.join(workspaceRoot, '.claude/commands'),
      );
      const userCommands = await this.scanCommandDirectory(
        path.join(os.homedir(), '.claude/commands'),
      );
      const workspaceSkills = await this.scanWorkspaceSkills(
        path.join(workspaceRoot, '.claude/skills'),
      );

      const allCommands = [
        ...builtins,
        ...projectCommands.map((c) => ({ ...c, scope: 'project' as const })),
        ...userCommands.map((c) => ({ ...c, scope: 'user' as const })),
        ...workspaceSkills,
      ];
      // List and its root key published together — two adjacent synchronous
      // writes, no await between them, so the pair can never disagree.
      this.cache = allCommands;
      this.cacheRootKey = normalizeWorkspaceRoot(workspaceRoot);

      return { success: true, commands: allCommands };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to discover commands: ${errorMessage}`,
      };
    }
  }

  /**
   * Search commands by query
   */
  async searchCommands(
    request: CommandSearchRequest,
  ): Promise<CommandDiscoveryResult> {
    try {
      const { query, maxResults = 20, workspaceRoot } = request;
      const root = workspaceRoot ?? this.workspaceProvider.getWorkspaceRoot();
      const rootKey = root ? normalizeWorkspaceRoot(root) : undefined;

      // Resolve into a LOCAL and filter that — never re-read `this.cache`
      // after an await. See `AgentDiscoveryService.searchAgents` for why:
      // a concurrent discovery for another workspace can replace the field
      // while we are suspended.
      let commands: CommandInfo[];
      if (this.cache.length > 0 && this.cacheRootKey === rootKey) {
        // Check and read in one synchronous block.
        commands = this.cache;
      } else {
        const discovered = await this.discoverCommands(root);
        // The awaited call's OWN return value — immune to a later publish.
        //
        // A failed discovery degrades to an empty list rather than propagating
        // `success: false`. That is deliberate bug-for-bug parity with the
        // pre-TASK_2026_200 code, which ignored `discoverCommands()`'s return
        // entirely and then sliced an empty `cache`. Propagating here would
        // turn "no workspace folder open" from an empty `/` picker into an
        // error toast — a UX regression outside this task's scope.
        commands = discovered.commands ?? [];
      }

      if (!query || query.trim() === '') {
        return { success: true, commands: commands.slice(0, maxResults) };
      }

      const lowerQuery = query.toLowerCase();
      const filtered = commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lowerQuery) ||
          cmd.description.toLowerCase().includes(lowerQuery),
      );

      return { success: true, commands: filtered.slice(0, maxResults) };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to search commands: ${errorMessage}`,
      };
    }
  }

  /**
   * Initialize file watchers.
   *
   * DELIBERATELY NOT root-parameterized (TASK_2026_200 task 2.4) — same
   * reasoning as `AgentDiscoveryService.initializeWatchers`: a background
   * refresh armed once at activation has no caller whose workspace it could be
   * scoped to, and pinning it to the activation-time root would be worse than
   * tracking the process-global active folder. Per-request correctness lives in
   * `searchCommands`/`discoverCommands`. Please do not "fix" this.
   */
  initializeWatchers(): void {
    const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
    if (!workspaceRoot) return;
    const projectWatcher = this.fsProvider.createFileWatcher(
      '.claude/commands/**/*.md',
    );

    const refreshCache = () => {
      this.discoverCommands().catch((error) => {
        console.error('[CommandDiscovery] Failed to refresh cache:', error);
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
   * Get hardcoded built-in commands (from CLI docs)
   */
  private getBuiltinCommands(): CommandInfo[] {
    return [
      {
        name: 'compact',
        description: 'Compact conversation to reduce token usage',
        scope: 'builtin',
      },
      {
        name: 'review',
        description: 'Code review workflow',
        scope: 'builtin',
      },
      {
        name: 'memory',
        description: 'Manage long-term memory (CLAUDE.md)',
        scope: 'builtin',
      },
      {
        name: 'clear',
        description: 'Clear conversation and start fresh',
        scope: 'builtin',
      },
      {
        name: 'context',
        description: 'Show current context and token usage',
        scope: 'builtin',
      },
      {
        name: 'cost',
        description: 'Show API cost for current session',
        scope: 'builtin',
      },
      {
        name: 'deep-research',
        description: 'Deep multi-source research workflow → cited report',
        argumentHint: '<question>',
        scope: 'builtin',
      },
    ];
  }

  /**
   * Scan command directory for .md files
   */
  private async scanCommandDirectory(dir: string): Promise<CommandInfo[]> {
    try {
      const files = await this.getAllMarkdownFiles(dir);

      const commands = await Promise.all(
        files.map((file) => this.parseCommandFile(file)),
      );

      return commands.filter(Boolean) as CommandInfo[];
    } catch {
      return [];
    }
  }

  /**
   * Recursively find all .md files
   */
  private async getAllMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const sentryService = this.sentryService;

    const scan = async (currentDir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);

          if (entry.isDirectory()) {
            await scan(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'CommandDiscoveryService.getAllMarkdownFiles' },
        );
      }
    };

    await scan(dir);
    return files;
  }

  /**
   * Parse command .md file with YAML frontmatter
   */
  private async parseCommandFile(
    filePath: string,
  ): Promise<CommandInfo | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { data: frontmatter, content: template } = parseFrontmatterLenient(
        content,
        () =>
          console.debug(
            `[CommandDiscovery] Strict YAML frontmatter failed for ${filePath}; using tolerant parse`,
          ),
      );
      let description: string | null | undefined = frontmatter['description'];
      if (!description) {
        description = this.extractDescriptionFromMarkdown(template);
      }

      return {
        name: path.basename(filePath, '.md'),
        description: description || 'No description',
        argumentHint: frontmatter['argument-hint'],
        scope: 'project', // Will be overridden by caller
        filePath,
        template,
        allowedTools: frontmatter['allowed-tools']
          ?.split(',')
          .map((t: string) => t.trim()),
        model: frontmatter['model'],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[CommandDiscovery] Failed to parse command file ${filePath}:`,
        errorMessage,
      );
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'CommandDiscoveryService.parseCommandFile' },
      );
      return null;
    }
  }

  /**
   * Extract a description from markdown content when no frontmatter description exists.
   * Looks for the first non-heading, non-empty paragraph line after the heading.
   */
  private extractDescriptionFromMarkdown(
    markdownContent: string,
  ): string | null {
    const lines = markdownContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('```') ||
        trimmed.startsWith('- ') ||
        trimmed.startsWith('* ')
      ) {
        continue;
      }
      return trimmed.length > 120 ? trimmed.substring(0, 117) + '...' : trimmed;
    }
    return null;
  }

  /**
   * Scan workspace .claude/skills/ for skill definitions.
   *
   * `HarnessReconciler` copies each enabled skill from the user layer into
   * `.claude/skills/{name}/` — a real directory since TASK_2026_278, not the
   * junction it used to be. Each contains a SKILL.md with YAML frontmatter
   * (name, description). Skills are listed without a plugin namespace prefix so
   * they resolve correctly when invoked as /skill-name.
   */
  private async scanWorkspaceSkills(skillsDir: string): Promise<CommandInfo[]> {
    const skills: CommandInfo[] = [];

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          // Tolerant parse: an unquoted colon in `description:` is legal for
          // Claude Code's reader but a hard js-yaml error, and it used to drop
          // the skill from discovery altogether.
          const { data: frontmatter } = parseFrontmatterLenient(content, () =>
            console.debug(
              `[CommandDiscovery] Strict YAML frontmatter failed for ${skillMdPath}; using tolerant parse`,
            ),
          );

          const name = frontmatter['name'] || entry.name;
          const description = frontmatter['description'] || 'Skill';

          skills.push({
            name,
            description:
              typeof description === 'string'
                ? description.replace(/\s+/g, ' ').trim()
                : String(description),
            scope: 'plugin',
            filePath: skillMdPath,
          });
        } catch (error) {
          // A directory without a SKILL.md simply is not a skill (e.g. a
          // stray `dist/`). That is not an error worth reporting.
          if (isEnoent(error)) continue;
          console.debug(
            `[CommandDiscovery] Cannot read SKILL.md at ${skillMdPath}:`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } catch (error) {
      console.debug(
        `[CommandDiscovery] Skills directory not accessible at ${skillsDir}:`,
        error instanceof Error ? error.message : String(error),
      );
      this.sentryService.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { errorSource: 'CommandDiscoveryService.scanWorkspaceSkills' },
      );
    }

    return skills;
  }

  /**
   * Cleanup on disposal
   */
  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
  }
}
