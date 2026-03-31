/**
 * MCP Response Formatter
 *
 * Converts raw JSON tool results into structured Markdown
 * using json2md for declarative JSON-to-Markdown conversion.
 *
 * All MCP tool results are rendered as proper Markdown with
 * headers, lists, tables, and paragraphs for readability in
 * any markdown-aware client (VS Code, Claude, etc.).
 */

import json2md from 'json2md';
import type {
  SpawnAgentResult,
  AgentProcessInfo,
  AgentOutput,
  CliDetectionResult,
  GitWorktreeInfo,
} from '@ptah-extension/shared';
import type {
  BrowserNavigateResult,
  BrowserScreenshotResult,
  BrowserEvaluateResult,
  BrowserClickResult,
  BrowserTypeResult,
  BrowserContentResult,
  BrowserNetworkResult,
  BrowserStatusResult,
} from '../types';

// ============================================================
// Workspace & Search Tools
// ============================================================

/**
 * Recursively render a DirectoryStructure as an indented bullet list.
 */
function renderDirectoryTree(
  structure: Record<string, unknown>,
  depth = 0,
): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  const dirs = structure['directories'] as
    | Array<{ name: string; structure: Record<string, unknown> | null }>
    | undefined;
  const files = structure['files'] as
    | Array<{ name: string; extension: string }>
    | undefined;

  if (Array.isArray(dirs)) {
    for (const dir of dirs) {
      lines.push(`${indent}- **${dir.name}/**`);
      if (dir.structure) {
        lines.push(renderDirectoryTree(dir.structure, depth + 1));
      }
    }
  }

  if (Array.isArray(files)) {
    for (const file of files) {
      lines.push(`${indent}- ${file.name}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format ptah_workspace_analyze result
 */
export function formatWorkspaceAnalysis(result: unknown): string {
  try {
    const r = result as {
      info?: Record<string, unknown>;
      structure?: Record<string, unknown>;
      projectInfo?: Record<string, unknown>;
    };
    const info = r?.info ?? {};
    const structure = r?.structure ?? {};
    const projectInfo = r?.projectInfo;

    const projectType = info['projectType'] ?? info['type'] ?? 'Unknown';
    const rootPath = info['rootPath'] ?? info['path'] ?? '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [{ h2: 'Workspace Analysis' }];

    // --- Project Info section ---
    const projectLines: string[] = [
      `**Project Type:** ${projectType}`,
      `**Root:** ${rootPath}`,
    ];

    if (projectInfo) {
      if (projectInfo['version'])
        projectLines.push(`**Version:** ${projectInfo['version']}`);
      if (projectInfo['description'])
        projectLines.push(`**Description:** ${projectInfo['description']}`);
      if (projectInfo['gitRepository'] !== undefined)
        projectLines.push(
          `**Git Repository:** ${projectInfo['gitRepository'] ? 'Yes' : 'No'}`,
        );
      if (typeof projectInfo['totalFiles'] === 'number')
        projectLines.push(`**Total Files:** ${projectInfo['totalFiles']}`);
    }

    blocks.push({ p: projectLines.join('  \n') });

    // --- Frameworks ---
    const frameworks = (info['frameworks'] ??
      info['detectedFrameworks'] ??
      []) as Array<Record<string, unknown>>;
    if (Array.isArray(frameworks) && frameworks.length > 0) {
      blocks.push({ h3: 'Frameworks' });
      const fwItems = frameworks.map((fw) => {
        if (typeof fw === 'string') return fw;
        const name = fw['name'] ?? fw['framework'] ?? 'Unknown';
        const version = fw['version'] ? ` ${fw['version']}` : '';
        const category = fw['category'] ? ` (${fw['category']})` : '';
        return `${name}${version}${category}`;
      });
      blocks.push({ ul: fwItems });
    }

    // --- Dependencies (from projectInfo) ---
    if (projectInfo) {
      const deps = projectInfo['dependencies'] as string[] | undefined;
      const devDeps = projectInfo['devDependencies'] as string[] | undefined;

      if (Array.isArray(deps) && deps.length > 0) {
        blocks.push({ h3: 'Dependencies' });
        const cappedDeps = deps.slice(0, 15);
        if (deps.length > 15) {
          cappedDeps.push(`... and ${deps.length - 15} more`);
        }
        blocks.push({ ul: cappedDeps });
      }

      if (Array.isArray(devDeps) && devDeps.length > 0) {
        blocks.push({ h3: 'Dev Dependencies' });
        const cappedDevDeps = devDeps.slice(0, 15);
        if (devDeps.length > 15) {
          cappedDevDeps.push(`... and ${devDeps.length - 15} more`);
        }
        blocks.push({ ul: cappedDevDeps });
      }
    }

    // --- File Statistics (from projectInfo) ---
    if (projectInfo) {
      const fileStats = projectInfo['fileStatistics'] as
        | Record<string, number>
        | undefined;
      if (fileStats && Object.keys(fileStats).length > 0) {
        blocks.push({ h3: 'File Statistics' });
        const rows = Object.entries(fileStats)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 20)
          .map(([ext, count]) => ({ Extension: ext, Count: String(count) }));
        blocks.push({ table: { headers: ['Extension', 'Count'], rows } });
      }
    }

    // --- Directory Structure ---
    const structureData = structure['structure'] ?? structure;
    const hasDirs =
      Array.isArray(
        (structureData as Record<string, unknown>)?.['directories'],
      ) &&
      ((structureData as Record<string, unknown>)['directories'] as unknown[])
        .length > 0;
    const hasFiles =
      Array.isArray((structureData as Record<string, unknown>)?.['files']) &&
      ((structureData as Record<string, unknown>)['files'] as unknown[])
        .length > 0;

    if (hasDirs || hasFiles) {
      blocks.push({ h3: 'Directory Structure' });
      const tree = renderDirectoryTree(
        structureData as Record<string, unknown>,
      );
      if (tree) {
        blocks.push({ p: tree });
      }
    }

    // --- Recommendations ---
    const recommendations = (structure['recommendations'] ?? []) as string[];
    if (Array.isArray(recommendations) && recommendations.length > 0) {
      blocks.push({ h3: 'Recommendations' });
      blocks.push({ ul: recommendations });
    }

    const output = json2md(blocks);
    return output || fallbackJson(result);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_search_files result
 */
export function formatSearchFiles(files: unknown): string {
  try {
    if (!Array.isArray(files)) return fallbackJson(files);
    if (files.length === 0)
      return json2md([{ h2: 'File Search' }, { p: 'Found: 0 files' }]);

    const items = files.map((file, i) => {
      const path =
        typeof file === 'string'
          ? file
          : (file?.path ?? file?.file ?? String(file));
      return `${i + 1}. ${path}`;
    });

    return json2md([
      { h2: 'File Search' },
      { p: `Found: ${files.length} file${files.length !== 1 ? 's' : ''}` },
      { ol: items.map((item) => item.replace(/^\d+\.\s*/, '')) },
    ]);
  } catch {
    return fallbackJson(files);
  }
}

// ============================================================
// Diagnostics & LSP Tools
// ============================================================

/**
 * Format ptah_get_diagnostics result
 */
export function formatDiagnostics(diagnostics: unknown): string {
  try {
    if (!Array.isArray(diagnostics)) return fallbackJson(diagnostics);
    if (diagnostics.length === 0)
      return json2md([
        { h2: 'Diagnostics' },
        { p: 'Errors: 0 | Warnings: 0 — No issues found.' },
      ]);

    const errors = diagnostics.filter(
      (d: Record<string, unknown>) =>
        d['severity'] === 'error' ||
        d['severity'] === 0 ||
        d['severity'] === 'Error',
    );
    const warnings = diagnostics.filter(
      (d: Record<string, unknown>) =>
        d['severity'] === 'warning' ||
        d['severity'] === 1 ||
        d['severity'] === 'Warning',
    );
    const others = diagnostics.filter(
      (d: Record<string, unknown>) =>
        !errors.includes(d) && !warnings.includes(d),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { h2: 'Diagnostics' },
      {
        p: `**Errors:** ${errors.length} | **Warnings:** ${warnings.length}${
          others.length > 0 ? ` | **Other:** ${others.length}` : ''
        }`,
      },
    ];

    if (errors.length > 0) {
      blocks.push({ h3: 'Errors' });
      blocks.push({
        ul: errors.map((e: Record<string, unknown>) => formatDiagnosticItem(e)),
      });
    }

    if (warnings.length > 0) {
      blocks.push({ h3: 'Warnings' });
      blocks.push({
        ul: warnings.map((w: Record<string, unknown>) =>
          formatDiagnosticItem(w),
        ),
      });
    }

    if (others.length > 0) {
      blocks.push({ h3: 'Other' });
      blocks.push({
        ul: others.map((o: Record<string, unknown>) => formatDiagnosticItem(o)),
      });
    }

    return json2md(blocks);
  } catch {
    return fallbackJson(diagnostics);
  }
}

function formatDiagnosticItem(d: Record<string, unknown>): string {
  const file = d['file'] ?? d['uri'] ?? d['path'] ?? '';
  const line = d['line'] ?? extractRangeLine(d['range']) ?? '';
  const col = d['col'] ?? d['column'] ?? '';
  const message = d['message'] ?? d['msg'] ?? '';
  const code = d['code'] ? ` ${d['code']}:` : '';
  const location = line
    ? `${file}:${line}${col ? ':' + col : ''}`
    : String(file);
  return `\`${location}\` —${code} ${message}`;
}

function extractRangeLine(range: unknown): number | string | undefined {
  if (range == null) return undefined;
  if (typeof range === 'number' || typeof range === 'string') return range;
  if (typeof range === 'object') {
    const r = range as Record<string, unknown>;
    const start = r['start'] as Record<string, unknown> | undefined;
    if (start && typeof start['line'] === 'number') {
      return start['line'];
    }
    if (typeof r['line'] === 'number') return r['line'];
  }
  return undefined;
}

/**
 * Format ptah_lsp_references result
 */
export function formatLspReferences(refs: unknown): string {
  try {
    if (!Array.isArray(refs)) return fallbackJson(refs);
    if (refs.length === 0)
      return json2md([{ h2: 'LSP References' }, { p: 'Found: 0 references' }]);

    const items = refs.map((ref: Record<string, unknown>) => {
      const file = ref['file'] ?? ref['uri'] ?? ref['path'] ?? '';
      const line = ref['line'] ?? '';
      const col = ref['col'] ?? ref['column'] ?? '';
      return line
        ? `\`${file}:${line}${col ? ':' + col : ''}\``
        : `\`${file}\``;
    });

    return json2md([
      { h2: 'LSP References' },
      { p: `Found: ${refs.length} reference${refs.length !== 1 ? 's' : ''}` },
      { ol: items },
    ]);
  } catch {
    return fallbackJson(refs);
  }
}

/**
 * Format ptah_lsp_definitions result
 */
export function formatLspDefinitions(defs: unknown): string {
  try {
    if (!Array.isArray(defs)) return fallbackJson(defs);
    if (defs.length === 0)
      return json2md([
        { h2: 'LSP Definitions' },
        { p: 'Found: 0 definitions' },
      ]);

    const items = defs.map((def: Record<string, unknown>) => {
      const file = def['file'] ?? def['uri'] ?? def['path'] ?? '';
      const line = def['line'] ?? '';
      const col = def['col'] ?? def['column'] ?? '';
      return line
        ? `\`${file}:${line}${col ? ':' + col : ''}\``
        : `\`${file}\``;
    });

    return json2md([
      { h2: 'LSP Definitions' },
      {
        p: `Found: ${defs.length} definition${defs.length !== 1 ? 's' : ''}`,
      },
      { ol: items },
    ]);
  } catch {
    return fallbackJson(defs);
  }
}

// ============================================================
// File & Token Tools
// ============================================================

/**
 * Format ptah_get_dirty_files result
 */
export function formatDirtyFiles(files: unknown): string {
  try {
    if (!Array.isArray(files)) return fallbackJson(files);
    if (files.length === 0)
      return json2md([{ h2: 'Dirty Files' }, { p: 'Found: 0 unsaved files' }]);

    const items = files.map((file) => {
      return typeof file === 'string'
        ? file
        : ((file as Record<string, unknown>)?.['path'] ?? String(file));
    });

    return json2md([
      { h2: 'Dirty Files' },
      {
        p: `Found: ${files.length} unsaved file${
          files.length !== 1 ? 's' : ''
        }`,
      },
      { ul: items as string[] },
    ]);
  } catch {
    return fallbackJson(files);
  }
}

/**
 * Format ptah_count_tokens result
 */
export function formatTokenCount(result: unknown): string {
  try {
    const r = result as { file?: string; tokens?: number };
    return json2md([
      { h2: 'Token Count' },
      {
        p: `**File:** ${r?.file ?? 'unknown'}  \n**Tokens:** ${r?.tokens ?? 0}`,
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

// ============================================================
// Agent Orchestration Tools
// ============================================================

/**
 * Format CLI label for display: shows Ptah CLI agent name when applicable.
 * Extracted to eliminate repeated inline formatting across agent formatters.
 */
function formatCliLabel(cli: string, ptahCliName?: string): string {
  return cli === 'ptah-cli' && ptahCliName ? `ptah-cli (${ptahCliName})` : cli;
}

/**
 * Format ptah_agent_list result as a markdown table
 */
export function formatAgentList(agents: CliDetectionResult[]): string {
  try {
    if (agents.length === 0) {
      return json2md([
        { h2: 'Available Agents' },
        {
          p: 'No agents found. Install a CLI agent (Gemini, Codex, Copilot) or configure a Ptah CLI agent.',
        },
      ]);
    }

    const rows = agents.map((agent) => {
      if (agent.cli === 'ptah-cli') {
        return {
          Agent: agent.ptahCliName ?? 'Unknown',
          Type: 'ptah-cli',
          Status: 'available',
          Capabilities: `provider: ${
            agent.providerName ?? 'Unknown'
          }, ptahCliId: ${agent.ptahCliId ?? 'N/A'}`,
        };
      }

      return {
        Agent: agent.cli,
        Type: 'cli',
        Status: agent.installed ? 'installed' : 'not installed',
        Capabilities: agent.supportsSteer ? 'steer: yes' : 'steer: no',
      };
    });

    return json2md([
      { h2: 'Available Agents' },
      { p: `**Total:** ${agents.length}` },
      { table: { headers: ['Agent', 'Type', 'Status', 'Capabilities'], rows } },
    ]);
  } catch {
    return fallbackJson(agents);
  }
}

/**
 * Format ptah_agent_spawn result
 */
export function formatAgentSpawn(result: SpawnAgentResult): string {
  try {
    const cliLabel = formatCliLabel(result.cli, result.ptahCliName);

    return json2md([
      { h2: 'Agent Spawned' },
      {
        p: [
          `**Agent ID:** ${result.agentId}`,
          `**CLI:** ${cliLabel}`,
          `**Status:** ${result.status}`,
          `**Started:** ${result.startedAt}`,
          ...(result.cliSessionId
            ? [`**CLI Session ID:** ${result.cliSessionId}`]
            : []),
        ].join('  \n'),
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_status result (single or array)
 */
export function formatAgentStatus(
  result: AgentProcessInfo | AgentProcessInfo[],
): string {
  try {
    const agents = Array.isArray(result) ? result : [result];
    if (agents.length === 0)
      return json2md([{ h2: 'Agent Status' }, { p: 'No agents found.' }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { h2: 'Agent Status' },
      { p: `**Total:** ${agents.length}` },
    ];

    for (const a of agents) {
      const task =
        a.task.length > 80 ? a.task.substring(0, 77) + '...' : a.task;
      const cliLabel = formatCliLabel(a.cli, a.ptahCliName);
      const lines = [
        `**CLI:** ${cliLabel}`,
        `**Status:** ${a.status}`,
        `**Task:** ${task}`,
        `**Started:** ${a.startedAt}`,
      ];
      if (a.cliSessionId) {
        lines.push(`**CLI Session ID:** ${a.cliSessionId}`);
      }
      if (a.exitCode !== undefined) {
        lines.push(`**Exit Code:** ${a.exitCode}`);
      }
      blocks.push({ h3: `Agent: ${a.agentId}` });
      blocks.push({ p: lines.join('  \n') });
    }

    return json2md(blocks);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_read result
 */
export function formatAgentRead(result: AgentOutput): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { h2: `Agent Output: ${result.agentId}` },
      {
        p: `**Lines:** ${result.lineCount} | **Truncated:** ${
          result.truncated ? 'Yes' : 'No'
        }`,
      },
    ];

    if (result.stdout) {
      blocks.push({ h3: 'stdout' });
      blocks.push({ code: { language: '', content: result.stdout } });
    }

    if (result.stderr) {
      blocks.push({ h3: 'stderr' });
      blocks.push({ code: { language: '', content: result.stderr } });
    }

    if (!result.stdout && !result.stderr) {
      blocks.push({ p: '*No output yet.*' });
    }

    return json2md(blocks);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_stop result
 */
export function formatAgentStop(result: AgentProcessInfo): string {
  try {
    const cliLabel = formatCliLabel(result.cli, result.ptahCliName);

    return json2md([
      { h2: 'Agent Stopped' },
      {
        p: [
          `**Agent ID:** ${result.agentId}`,
          `**CLI:** ${cliLabel}`,
          `**Status:** ${result.status}`,
          ...(result.cliSessionId
            ? [`**CLI Session ID:** ${result.cliSessionId}`]
            : []),
          `**Exit Code:** ${result.exitCode ?? 'N/A'}`,
        ].join('  \n'),
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_steer result
 */
export function formatAgentSteer(result: {
  agentId: string;
  steered: boolean;
}): string {
  try {
    return json2md([
      { h2: 'Agent Steered' },
      {
        p: [
          `**Agent ID:** ${result.agentId}`,
          `**Steered:** ${result.steered ? 'Yes' : 'No'}`,
        ].join('  \n'),
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

// ============================================================
// Web Search Tools (TASK_2025_189)
// ============================================================

/**
 * Format ptah_web_search result (multi-provider, TASK_2025_235)
 */
export function formatWebSearch(result: {
  query: string;
  summary: string;
  provider: string;
  durationMs: number;
  results: Array<{ title: string; url: string; snippet: string }>;
  resultCount: number;
}): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { h2: 'Web Search Results' },
      {
        p: [
          `**Query:** ${result.query}`,
          `**Provider:** ${result.provider}`,
          `**Results:** ${result.resultCount}`,
          `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
        ].join('  \n'),
      },
    ];

    // Summary section
    if (result.summary) {
      blocks.push({ h3: 'Summary' });
      blocks.push({ p: result.summary });
    }

    // Individual results
    if (result.results && result.results.length > 0) {
      blocks.push({ h3: 'Results' });
      const items = result.results.map(
        (r, i) => `**${i + 1}. [${r.title}](${r.url})**\n${r.snippet}`,
      );
      blocks.push({ ul: items });
    }

    return json2md(blocks);
  } catch {
    return fallbackJson(result);
  }
}

// ============================================================
// Git Worktree Tools (TASK_2025_236)
// ============================================================

/**
 * Format ptah_git_worktree_list result as a markdown table.
 * Accepts a result object with both a worktrees array and an optional error,
 * so the AI agent can distinguish "no worktrees" from "git error".
 */
export function formatWorktreeList(result: {
  worktrees: GitWorktreeInfo[];
  error?: string;
}): string {
  try {
    // If there's an error, surface it clearly so the AI agent knows git failed
    if (result.error) {
      return json2md([
        { h2: 'Git Worktrees' },
        { p: `**Error:** ${result.error}` },
        {
          p: 'Could not list worktrees. Verify this is a git repository and git is installed.',
        },
      ]);
    }

    if (result.worktrees.length === 0) {
      return json2md([
        { h2: 'Git Worktrees' },
        { p: 'No worktrees found. Only the main working tree exists.' },
      ]);
    }

    const rows = result.worktrees.map((wt) => ({
      Path: wt.path,
      Branch: wt.branch,
      HEAD: wt.head,
      Main: wt.isMain ? 'Yes' : 'No',
    }));

    return json2md([
      { h2: 'Git Worktrees' },
      { p: `**Total:** ${result.worktrees.length}` },
      { table: { headers: ['Path', 'Branch', 'HEAD', 'Main'], rows } },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_git_worktree_add result
 */
export function formatWorktreeAdd(result: {
  success: boolean;
  worktreePath?: string;
  error?: string;
}): string {
  try {
    if (result.success) {
      return json2md([
        { h2: 'Worktree Created' },
        {
          p: `**Path:** ${result.worktreePath ?? 'unknown'}  \n**Status:** Success`,
        },
      ]);
    }

    return json2md([
      { h2: 'Worktree Creation Failed' },
      {
        p: `**Error:** ${result.error ?? 'Unknown error'}`,
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_git_worktree_remove result
 */
export function formatWorktreeRemove(result: {
  success: boolean;
  error?: string;
}): string {
  try {
    if (result.success) {
      return json2md([
        { h2: 'Worktree Removed' },
        { p: '**Status:** Successfully removed.' },
      ]);
    }

    return json2md([
      { h2: 'Worktree Removal Failed' },
      {
        p: `**Error:** ${result.error ?? 'Unknown error'}`,
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

// ============================================================
// JSON Validation Tool (TASK_2025_240)
// ============================================================

/**
 * Format ptah_json_validate result as readable Markdown.
 * On success: shows file path, repairs applied, file overwritten confirmation.
 * On failure: shows errors for agent self-correction.
 */
export function formatJsonValidate(result: {
  success: boolean;
  file: string;
  repairs: string[];
  errors: string[];
  fileOverwritten: boolean;
}): string {
  try {
    if (result.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks: any[] = [
        { h2: 'JSON Validation Passed' },
        { p: `**File:** ${result.file}  \n**Status:** Valid JSON` },
      ];

      if (result.repairs.length > 0) {
        blocks.push({ h3: 'Repairs Applied' });
        blocks.push({ ul: result.repairs });
      }

      if (result.fileOverwritten) {
        blocks.push({
          p: 'File overwritten with clean, formatted JSON.',
        });
      }

      return json2md(blocks);
    }

    // Failure case — provide errors for agent self-correction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { h2: 'JSON Validation Failed' },
      { p: `**File:** ${result.file}` },
    ];

    if (result.repairs.length > 0) {
      blocks.push({ h3: 'Repairs Attempted' });
      blocks.push({ ul: result.repairs });
    }

    blocks.push({ h3: 'Errors' });
    blocks.push({ ul: result.errors });
    blocks.push({
      p: 'Please fix these issues and write the file again, then call ptah_json_validate to re-validate.',
    });

    return json2md(blocks);
  } catch {
    return fallbackJson(result);
  }
}

// ============================================================
// Browser Automation Tools (TASK_2025_244)
// ============================================================

/**
 * Format ptah_browser_navigate result
 */
export function formatBrowserNavigate(result: BrowserNavigateResult): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Navigation Failed' },
        { p: `**URL:** ${result.url}` },
        { p: `**Error:** ${result.error}` },
      ]);
    }

    return json2md([
      { h2: 'Navigation Complete' },
      { p: `**URL:** ${result.url}  \n**Title:** ${result.title}` },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_screenshot result.
 * Returns the base64 data as a labeled text block since the MCP text
 * response format is used for all tool results.
 */
export function formatBrowserScreenshot(
  result: BrowserScreenshotResult,
): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Screenshot Failed' },
        { p: `**Error:** ${result.error}` },
      ]);
    }

    const sizeKB = Math.round((result.data.length * 3) / 4 / 1024);
    return json2md([
      { h2: 'Screenshot Captured' },
      {
        p: `**Format:** ${result.format}  \n**Size:** ~${sizeKB}KB  \n**Data (base64):**`,
      },
      { code: { content: result.data } },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_evaluate result
 */
export function formatBrowserEvaluate(result: BrowserEvaluateResult): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'JavaScript Evaluation Failed' },
        { p: `**Type:** ${result.type}` },
        { p: `**Error:** ${result.error}` },
      ]);
    }

    const valueStr =
      typeof result.value === 'object'
        ? JSON.stringify(result.value, null, 2)
        : String(result.value);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = [
      { h2: 'JavaScript Evaluation Result' },
      { p: `**Type:** ${result.type}` },
    ];

    if (result.type === 'object' || valueStr.length > 100) {
      blocks.push({ code: { language: 'json', content: valueStr } });
    } else {
      blocks.push({ p: `**Value:** ${valueStr}` });
    }

    return json2md(blocks);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_click result
 */
export function formatBrowserClick(result: BrowserClickResult): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Click Failed' },
        { p: `**Error:** ${result.error}` },
      ]);
    }
    return json2md([
      { h2: 'Click Successful' },
      { p: 'Element clicked successfully.' },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_type result
 */
export function formatBrowserType(result: BrowserTypeResult): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Type Failed' },
        { p: `**Error:** ${result.error}` },
      ]);
    }
    return json2md([
      { h2: 'Type Successful' },
      { p: 'Text entered successfully.' },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_content result.
 * Truncates content if longer than 32KB to keep response manageable.
 */
export function formatBrowserContent(result: BrowserContentResult): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Content Read Failed' },
        { p: `**Error:** ${result.error}` },
      ]);
    }

    const MAX_TEXT_LENGTH = 32 * 1024;
    const text =
      result.text.length > MAX_TEXT_LENGTH
        ? result.text.substring(0, MAX_TEXT_LENGTH) + '\n\n[...truncated]'
        : result.text;

    const html =
      result.html.length > MAX_TEXT_LENGTH
        ? result.html.substring(0, MAX_TEXT_LENGTH) + '\n\n[...truncated]'
        : result.html;

    return json2md([
      { h2: 'Page Content' },
      { h3: 'Text' },
      { code: { content: text } },
      { h3: 'HTML' },
      { code: { language: 'html', content: html } },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_network result as a markdown table
 */
export function formatBrowserNetwork(result: BrowserNetworkResult): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Network Requests' },
        { p: `**Error:** ${result.error}` },
      ]);
    }

    if (result.requests.length === 0) {
      return json2md([
        { h2: 'Network Requests' },
        { p: 'No network requests captured.' },
      ]);
    }

    const rows = result.requests.map((req) => ({
      Method: req.method,
      Status: String(req.status),
      Type: req.type,
      Size: req.size ? `${Math.round(req.size / 1024)}KB` : '-',
      URL: req.url.length > 80 ? req.url.substring(0, 77) + '...' : req.url,
    }));

    return json2md([
      { h2: 'Network Requests' },
      { p: `**Total:** ${result.requests.length}` },
      {
        table: {
          headers: ['Method', 'Status', 'Type', 'Size', 'URL'],
          rows,
        },
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_close result
 */
export function formatBrowserClose(result: {
  success: boolean;
  error?: string;
}): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Browser Close Failed' },
        { p: `**Error:** ${result.error}` },
      ]);
    }
    return json2md([
      { h2: 'Browser Session Closed' },
      { p: 'Browser session closed and resources released.' },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_status result
 */
export function formatBrowserStatus(result: BrowserStatusResult): string {
  try {
    if (!result.connected) {
      return json2md([
        { h2: 'Browser Status' },
        {
          p: '**Connected:** No  \nNo active browser session. Use ptah_browser_navigate to start one.',
        },
      ]);
    }

    const uptimeSec = result.uptimeMs ? Math.round(result.uptimeMs / 1000) : 0;
    const autoCloseMin = result.autoCloseInMs
      ? Math.round(result.autoCloseInMs / 60000)
      : 0;

    return json2md([
      { h2: 'Browser Status' },
      {
        p:
          `**Connected:** Yes  \n**URL:** ${result.url ?? 'N/A'}  \n` +
          `**Title:** ${result.title ?? 'N/A'}  \n` +
          `**Uptime:** ${uptimeSec}s  \n` +
          `**Auto-close in:** ${autoCloseMin}m`,
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

// ============================================================
// Fallback
// ============================================================

function fallbackJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return '[Unable to serialize result]';
  }
}
