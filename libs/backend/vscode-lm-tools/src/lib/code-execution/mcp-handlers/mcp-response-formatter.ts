/**
 * MCP Response Formatter
 *
 * Converts raw JSON tool results into structured plain text.
 *
 * VS Code renders MCP tool results as PLAIN TEXT (not Markdown),
 * so we use clean key-value formatting that reads well in both
 * the VS Code tool output panel and when consumed by the LLM.
 *
 * Design: indented key-value pairs, dashes for lists, section
 * headers with [brackets]. No Markdown tables/headers/backticks.
 */

import type {
  SpawnAgentResult,
  AgentProcessInfo,
  AgentOutput,
} from '@ptah-extension/shared';

// ============================================================
// Workspace & Search Tools
// ============================================================

/**
 * Format ptah_workspace_analyze result
 */
export function formatWorkspaceAnalysis(result: unknown): string {
  try {
    const r = result as {
      info?: Record<string, unknown>;
      structure?: Record<string, unknown>;
    };
    const info = r?.info ?? {};
    const structure = r?.structure ?? {};

    const lines: string[] = ['[Workspace Analysis]'];

    // Project info
    const projectType = info['projectType'] ?? info['type'] ?? 'Unknown';
    const rootPath = info['rootPath'] ?? info['path'] ?? '';
    lines.push(`  Project: ${projectType}`);
    lines.push(`  Root: ${rootPath}`);

    // Frameworks
    const frameworks = (info['frameworks'] ??
      info['detectedFrameworks'] ??
      []) as Array<Record<string, unknown>>;
    if (Array.isArray(frameworks) && frameworks.length > 0) {
      lines.push('');
      lines.push('[Frameworks]');
      for (const fw of frameworks) {
        if (typeof fw === 'string') {
          lines.push(`  - ${fw}`);
        } else if (fw && typeof fw === 'object') {
          const name = fw['name'] ?? fw['framework'] ?? 'Unknown';
          const version = fw['version'] ? ` ${fw['version']}` : '';
          const category = fw['category'] ? ` (${fw['category']})` : '';
          lines.push(`  - ${name}${version}${category}`);
        }
      }
    }

    // Structure
    const dirs = (structure['directories'] ?? structure['dirs'] ?? []) as Array<
      Record<string, unknown>
    >;
    if (Array.isArray(dirs) && dirs.length > 0) {
      lines.push('');
      lines.push('[Structure]');
      for (const dir of dirs) {
        if (typeof dir === 'string') {
          lines.push(`  - ${dir}`);
        } else if (dir && typeof dir === 'object') {
          const name = dir['name'] ?? dir['path'] ?? '';
          const files = dir['files'] ?? dir['fileCount'] ?? '';
          const desc = dir['description'] ?? dir['desc'] ?? '';
          const extra = [files ? `${files} files` : '', desc]
            .filter(Boolean)
            .join(' — ');
          lines.push(`  - ${name}${extra ? ': ' + extra : ''}`);
        }
      }
    }

    if (lines.length <= 3) {
      return fallbackJson(result);
    }

    return lines.join('\n');
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
    if (files.length === 0) return '[File Search]\n  Found: 0 files';

    const lines: string[] = [
      '[File Search]',
      `  Found: ${files.length} file${files.length !== 1 ? 's' : ''}`,
      '',
    ];

    for (let i = 0; i < files.length; i++) {
      const file =
        typeof files[i] === 'string'
          ? files[i]
          : files[i]?.path ?? files[i]?.file ?? String(files[i]);
      lines.push(`  ${i + 1}. ${file}`);
    }

    return lines.join('\n');
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
      return '[Diagnostics]\n  Errors: 0\n  Warnings: 0\n  No issues found.';

    const errors = diagnostics.filter(
      (d: Record<string, unknown>) =>
        d['severity'] === 'error' ||
        d['severity'] === 0 ||
        d['severity'] === 'Error'
    );
    const warnings = diagnostics.filter(
      (d: Record<string, unknown>) =>
        d['severity'] === 'warning' ||
        d['severity'] === 1 ||
        d['severity'] === 'Warning'
    );
    const others = diagnostics.filter(
      (d: Record<string, unknown>) =>
        !errors.includes(d) && !warnings.includes(d)
    );

    const lines: string[] = [
      '[Diagnostics]',
      `  Errors: ${errors.length}`,
      `  Warnings: ${warnings.length}`,
    ];
    if (others.length > 0) {
      lines.push(`  Other: ${others.length}`);
    }

    if (errors.length > 0) {
      lines.push('');
      lines.push('[Errors]');
      for (const e of errors) {
        lines.push('  ' + formatDiagnosticItem(e as Record<string, unknown>));
      }
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push('[Warnings]');
      for (const w of warnings) {
        lines.push('  ' + formatDiagnosticItem(w as Record<string, unknown>));
      }
    }

    if (others.length > 0) {
      lines.push('');
      lines.push('[Other]');
      for (const o of others) {
        lines.push('  ' + formatDiagnosticItem(o as Record<string, unknown>));
      }
    }

    return lines.join('\n');
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
  return `- ${location} —${code} ${message}`;
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
    if (refs.length === 0) return '[LSP References]\n  Found: 0 references';

    const lines: string[] = [
      '[LSP References]',
      `  Found: ${refs.length} reference${refs.length !== 1 ? 's' : ''}`,
      '',
    ];

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i] as Record<string, unknown>;
      const file = ref['file'] ?? ref['uri'] ?? ref['path'] ?? '';
      const line = ref['line'] ?? '';
      const col = ref['col'] ?? ref['column'] ?? '';
      const loc = line
        ? `${file}:${line}${col ? ':' + col : ''}`
        : String(file);
      lines.push(`  ${i + 1}. ${loc}`);
    }

    return lines.join('\n');
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
    if (defs.length === 0) return '[LSP Definitions]\n  Found: 0 definitions';

    const lines: string[] = [
      '[LSP Definitions]',
      `  Found: ${defs.length} definition${defs.length !== 1 ? 's' : ''}`,
      '',
    ];

    for (let i = 0; i < defs.length; i++) {
      const def = defs[i] as Record<string, unknown>;
      const file = def['file'] ?? def['uri'] ?? def['path'] ?? '';
      const line = def['line'] ?? '';
      const col = def['col'] ?? def['column'] ?? '';
      const loc = line
        ? `${file}:${line}${col ? ':' + col : ''}`
        : String(file);
      lines.push(`  ${i + 1}. ${loc}`);
    }

    return lines.join('\n');
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
    if (files.length === 0) return '[Dirty Files]\n  Found: 0 unsaved files';

    const lines: string[] = [
      '[Dirty Files]',
      `  Found: ${files.length} unsaved file${files.length !== 1 ? 's' : ''}`,
      '',
    ];

    for (const file of files) {
      const path =
        typeof file === 'string'
          ? file
          : (file as Record<string, unknown>)?.['path'] ?? String(file);
      lines.push(`  - ${path}`);
    }

    return lines.join('\n');
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
    return [
      '[Token Count]',
      `  File: ${r?.file ?? 'unknown'}`,
      `  Tokens: ${r?.tokens ?? 0}`,
    ].join('\n');
  } catch {
    return fallbackJson(result);
  }
}

// ============================================================
// Agent Orchestration Tools
// ============================================================

/**
 * Format ptah_agent_spawn result
 */
export function formatAgentSpawn(result: SpawnAgentResult): string {
  try {
    return [
      '[Agent Spawned]',
      `  Agent ID: ${result.agentId}`,
      `  CLI: ${result.cli}`,
      `  Status: ${result.status}`,
      `  Started: ${result.startedAt}`,
    ].join('\n');
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_status result (single or array)
 */
export function formatAgentStatus(
  result: AgentProcessInfo | AgentProcessInfo[]
): string {
  try {
    const agents = Array.isArray(result) ? result : [result];
    if (agents.length === 0) return '[Agent Status]\n  No agents found.';

    const lines: string[] = ['[Agent Status]', `  Total: ${agents.length}`];

    for (const a of agents) {
      const task =
        a.task.length > 80 ? a.task.substring(0, 77) + '...' : a.task;
      lines.push('');
      lines.push(`  Agent: ${a.agentId}`);
      lines.push(`    CLI: ${a.cli}`);
      lines.push(`    Status: ${a.status}`);
      lines.push(`    Task: ${task}`);
      lines.push(`    Started: ${a.startedAt}`);
      if (a.exitCode !== undefined) {
        lines.push(`    Exit Code: ${a.exitCode}`);
      }
    }

    return lines.join('\n');
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_read result
 */
export function formatAgentRead(result: AgentOutput): string {
  try {
    const lines: string[] = [
      `[Agent Output: ${result.agentId}]`,
      `  Lines: ${result.lineCount}`,
      `  Truncated: ${result.truncated ? 'Yes' : 'No'}`,
    ];

    if (result.stdout) {
      lines.push('');
      lines.push('[stdout]');
      // Agent stdout may contain markdown from the CLI tool.
      // Pass through as-is — the LLM will parse it.
      lines.push(result.stdout);
    }

    if (result.stderr) {
      lines.push('');
      lines.push('[stderr]');
      lines.push(result.stderr);
    }

    if (!result.stdout && !result.stderr) {
      lines.push('');
      lines.push('  No output yet.');
    }

    return lines.join('\n');
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_stop result
 */
export function formatAgentStop(result: AgentProcessInfo): string {
  try {
    return [
      '[Agent Stopped]',
      `  Agent ID: ${result.agentId}`,
      `  CLI: ${result.cli}`,
      `  Status: ${result.status}`,
      `  Exit Code: ${result.exitCode ?? 'N/A'}`,
    ].join('\n');
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
    return [
      '[Agent Steered]',
      `  Agent ID: ${result.agentId}`,
      `  Steered: ${result.steered ? 'Yes' : 'No'}`,
    ].join('\n');
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
