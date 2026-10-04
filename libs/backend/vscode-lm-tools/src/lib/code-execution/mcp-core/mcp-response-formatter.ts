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

import * as path from 'path';
import json2md from 'json2md';
import type {
  SpawnAgentResult,
  AgentProcessInfo,
  AgentMessageOutcome,
  AgentMessagingMode,
  CliDetectionResult,
  GitWorktreeInfo,
} from '@ptah-extension/shared';
import {
  findAgentLimit,
  formatAlternatives,
  formatLimitColumn,
  formatPlanLimitsSection,
  formatSpawnLimitBlock,
  type AgentLimit,
} from './agent-limit.formatter';
import type {
  BrowserNavigateResult,
  BrowserScreenshotResult,
  BrowserEvaluateResult,
  BrowserClickResult,
  BrowserTypeResult,
  BrowserContentResult,
  BrowserNetworkResult,
  BrowserStatusResult,
  BrowserRecordStartResult,
  BrowserRecordStopResult,
  LspLocationReport,
} from '../types';
import {
  compactCoverage,
  coverageReasons,
  withCoverageVerdict,
  type CompactCoverage,
  type Count,
  type CoverageCensus,
  type CoverageChecks,
  type CoverageReason,
  type CoverageState,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';
import {
  fitsBudget,
  type TextBudget,
} from '@ptah-extension/tool-output-reducers';
import type { SpoolOutcome } from './tool-result-budget';

/** Directory levels rendered, the workspace root's entries being level 1. */
const TREE_MAX_DEPTH = 3;

/** Entries listed per directory before `... and N more`. */
const TREE_MAX_ENTRIES_PER_DIR = 25;

/**
 * Character budget for the whole tree. Levels are filled breadth-first, so the
 * top of the tree is always shown and only deeper levels give way. Each shown
 * directory also reserves room for its own `... and N more` line, so the
 * rendered tree stays within this budget plus one root-level summary line.
 */
const TREE_MAX_CHARS = 3_500;

/** Room reserved per shown directory for its `... and N more` line. */
const TREE_MORE_LINE_RESERVE = 40;

/** Longest entry name rendered; longer names are cut with an ellipsis. */
const TREE_MAX_NAME_CHARS = 80;

/**
 * Directories never expanded or listed: build output, dependencies, VCS data,
 * scratch space and agent worktrees. Their contents are generated or copied,
 * and one of them alone (a `tmp/` of 500 files) used to fill the result.
 */
const TREE_EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'tmp',
  'dist',
  '.claude-worktrees',
  '.ptah',
  'node_modules',
  '.git',
  'coverage',
]);

interface TreeNode {
  readonly name: string;
  readonly isDir: boolean;
  readonly structure: Record<string, unknown> | null;
}

/** One directory's listable entries: excluded directories dropped, dirs first. */
function treeChildren(structure: Record<string, unknown> | null): TreeNode[] {
  if (!structure) return [];
  const dirs = Array.isArray(structure['directories'])
    ? (structure['directories'] as Array<Record<string, unknown>>)
    : [];
  const files = Array.isArray(structure['files'])
    ? (structure['files'] as Array<Record<string, unknown>>)
    : [];
  const nodes: TreeNode[] = [];
  for (const dir of dirs) {
    const name = String(dir?.['name'] ?? '');
    if (!name || TREE_EXCLUDED_DIRS.has(name)) continue;
    const sub = dir['structure'];
    nodes.push({
      name,
      isDir: true,
      structure:
        sub && typeof sub === 'object'
          ? (sub as Record<string, unknown>)
          : null,
    });
  }
  for (const file of files) {
    const name = String(file?.['name'] ?? '');
    if (name) nodes.push({ name, isDir: false, structure: null });
  }
  return nodes;
}

function treeEntryLine(node: TreeNode, level: number): string {
  const name =
    node.name.length > TREE_MAX_NAME_CHARS
      ? `${node.name.slice(0, TREE_MAX_NAME_CHARS)}…`
      : node.name;
  return `${'  '.repeat(level)}- ${node.isDir ? `**${name}/**` : name}`;
}

/**
 * Render a DirectoryStructure as an indented bullet list, bounded three ways:
 * at most {@link TREE_MAX_DEPTH} levels, {@link TREE_MAX_ENTRIES_PER_DIR}
 * entries per directory, and {@link TREE_MAX_CHARS} overall. Every directory
 * that lists fewer entries than it has closes with `... and N more`, so a
 * caller can tell a cut listing from a complete one.
 *
 * Selection is breadth-first and round-robin within a level (which entries
 * fit), rendering depth-first (the nested list), so a single wide directory
 * cannot starve its siblings.
 *
 * The result is a raw Markdown list, one entry per line; the caller must pass
 * it to json2md as a string, not a `p` block, which would put a blank line
 * between every entry and double the size.
 */
function renderDirectoryTree(structure: Record<string, unknown>): string {
  const root: TreeNode = { name: '', isDir: true, structure };
  const shownChildren = new Map<TreeNode, TreeNode[]>();
  let budget = TREE_MAX_CHARS;
  let level: TreeNode[] = [root];

  for (let depth = 0; depth < TREE_MAX_DEPTH && level.length > 0; depth++) {
    // Round-robin across the level's directories: each takes its next entry
    // in turn, so the budget is shared instead of spent on the first one.
    const pending = level.map((parent) => ({
      parent,
      candidates: treeChildren(parent.structure).slice(
        0,
        TREE_MAX_ENTRIES_PER_DIR,
      ),
      shown: [] as TreeNode[],
      open: true,
    }));
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const entry of pending) {
        if (!entry.open) continue;
        const child = entry.candidates[entry.shown.length];
        const cost = child
          ? treeEntryLine(child, depth).length +
            1 +
            (child.isDir ? TREE_MORE_LINE_RESERVE : 0)
          : 0;
        if (!child || cost > budget) {
          // A directory's listing stays a contiguous prefix: once one entry
          // does not fit, the rest are counted in its "and N more" line.
          entry.open = false;
          continue;
        }
        budget -= cost;
        entry.shown.push(child);
        progressed = true;
      }
    }
    for (const entry of pending) {
      shownChildren.set(entry.parent, entry.shown);
    }
    level = pending.flatMap((entry) =>
      entry.shown.filter((child) => child.isDir),
    );
  }

  const lines: string[] = [];
  const render = (parent: TreeNode, depth: number): void => {
    const shown = shownChildren.get(parent) ?? [];
    for (const child of shown) {
      lines.push(treeEntryLine(child, depth));
      if (child.isDir) render(child, depth + 1);
    }
    // Only a directory whose level was reached is summarised: one at the
    // depth limit was never listed, and "and N more" would misstate that.
    if (!shownChildren.has(parent)) return;
    const hidden = treeChildren(parent.structure).length - shown.length;
    if (hidden > 0) {
      lines.push(`${'  '.repeat(depth)}- ... and ${hidden} more`);
    }
  };
  render(root, 0);

  return lines.join('\n');
}

/** Monorepo projects listed by name before `... and N more`. */
const PROJECTS_DISPLAY_CAP = 25;

/** Discovery notes listed before `... and N more notes`. */
const DISCOVERY_ISSUES_DISPLAY_CAP = 5;

/** Longest project name, path and per-row reason rendered in a project row. */
const PROJECT_NAME_MAX_CHARS = 60;
const PROJECT_PATH_MAX_CHARS = 80;
const PROJECT_ISSUE_MAX_CHARS = 80;

/** Longest discovery note rendered. */
const DISCOVERY_NOTE_MAX_CHARS = 400;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The `### Projects` section of a monorepo analysis.
 *
 * Counts come from `projectDiscovery.totalProjects` (every project found),
 * not the length of the inspected list, so "and N more" is true even when
 * inspection was capped; uninspected projects and discovery problems are
 * stated, never implied away.
 *
 * Status comes first — counts, the incomplete flag and the discovery notes
 * (which lead with any inspection-failure summary) — then the bounded
 * project rows, so a long list can never push the reason out of a later cut.
 */
function projectsBlocks(projectInfo: Record<string, unknown>): unknown[] {
  const projects = Array.isArray(projectInfo['projects'])
    ? (projectInfo['projects'] as Array<Record<string, unknown>>)
    : [];
  const discovery = (projectInfo['projectDiscovery'] ?? undefined) as
    Record<string, unknown> | undefined;
  if (!projectInfo['monorepoType'] && projects.length === 0) {
    return [];
  }

  const total =
    typeof discovery?.['totalProjects'] === 'number'
      ? discovery['totalProjects']
      : projects.length;
  const inspected = projects.length;
  const issues = Array.isArray(discovery?.['issues'])
    ? (discovery['issues'] as unknown[]).map(String)
    : [];
  const complete = discovery?.['complete'] !== false;

  const summary = [
    `**Found:** ${total} project${total === 1 ? '' : 's'}`,
    ...(inspected < total
      ? [`**Inspected:** ${inspected} (Frameworks above cover these only)`]
      : []),
    ...(complete ? [] : ['**Discovery:** incomplete — see notes']),
  ];
  const blocks: unknown[] = [{ h3: 'Projects' }, { p: summary.join('  \n') }];

  if (issues.length > 0) {
    const notes = issues
      .slice(0, DISCOVERY_ISSUES_DISPLAY_CAP)
      .map((note) => clip(note, DISCOVERY_NOTE_MAX_CHARS));
    if (issues.length > notes.length) {
      notes.push(`... and ${issues.length - notes.length} more notes`);
    }
    blocks.push({ p: '**Discovery notes:**' }, { ul: notes });
  }

  const shown = projects.slice(0, PROJECTS_DISPLAY_CAP);
  const items = shown.map((p) => {
    const type = String(p?.['type'] ?? 'unknown');
    const framework =
      p?.['framework'] && p['framework'] !== type
        ? `, ${String(p['framework'])}`
        : '';
    const issue = p?.['issue']
      ? ` — ${clip(String(p['issue']), PROJECT_ISSUE_MAX_CHARS)}`
      : '';
    const name = clip(String(p?.['name'] ?? ''), PROJECT_NAME_MAX_CHARS);
    const where = clip(String(p?.['path'] ?? ''), PROJECT_PATH_MAX_CHARS);
    return `${name} (${type}${framework}) — ${where}${issue}`;
  });
  const hidden = total - shown.length;
  if (hidden > 0) {
    const uninspected = total - inspected;
    items.push(
      `... and ${hidden} more${uninspected > 0 ? ` (${uninspected} not inspected)` : ''}`,
    );
  }
  if (items.length > 0) {
    blocks.push({ ul: items });
  }
  return blocks;
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
    const blocks: any[] = [{ h2: 'Workspace Analysis' }];
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
    if (projectInfo) {
      blocks.push(...projectsBlocks(projectInfo));
    }
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
    if (projectInfo) {
      const fileStats = projectInfo['fileStatistics'] as
        Record<string, number> | undefined;
      if (fileStats && Object.keys(fileStats).length > 0) {
        blocks.push({ h3: 'File Statistics' });
        const rows = Object.entries(fileStats)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 20)
          .map(([ext, count]) => ({ Extension: ext, Count: String(count) }));
        blocks.push({ table: { headers: ['Extension', 'Count'], rows } });
      }
    }
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
        // Raw string, as in formatDiagnosticList: json2md passes it through
        // untouched. The trailing newline keeps the next heading its own block.
        blocks.push(`${tree}\n`);
      }
    }
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
 * Format ptah_search_files result. `moreAvailable` says the provider matched
 * more files than `files` holds; the notice then sits in the header line, not
 * after the list, so a result-budget cut of the tail cannot drop it.
 */
export function formatSearchFiles(
  files: unknown,
  moreAvailable = false,
): string {
  try {
    if (!Array.isArray(files)) return fallbackJson(files);
    if (files.length === 0)
      return json2md([{ h2: 'File Search' }, { p: 'Found: 0 files' }]);

    const items = files.map((file, i) => {
      const filePath =
        typeof file === 'string'
          ? file
          : (file?.path ?? file?.file ?? String(file));
      return `${i + 1}. ${filePath}`;
    });

    const counted = `${files.length} file${files.length !== 1 ? 's' : ''}`;
    const found = moreAvailable
      ? `Found: more than ${counted} (showing first ${files.length}; narrow the pattern or raise limit)`
      : `Found: ${counted}`;

    return json2md([
      { h2: 'File Search' },
      { p: found },
      { ol: items.map((item) => item.replace(/^\d+\.\s*/, '')) },
    ]);
  } catch {
    return fallbackJson(files);
  }
}

/**
 * Most diagnostics `ptah_get_diagnostics` lists one by one (TASK_2026_559).
 *
 * A scoped check still reports sibling files in the owning project — that is
 * its contract — and nothing bounded how many. A project with a few hundred
 * sibling errors turned a one-file question into a six-figure-character answer.
 * Diagnostics in the requested files are ALWAYS listed in full; sibling files
 * fill whatever is left of this cap and the rest are counted and named per file.
 * Coverage failures (see {@link isCoverageFailure}) sit outside the cap: they
 * are always listed, and do not take room from requested or sibling entries.
 */
const DIAGNOSTICS_DISPLAY_CAP = 50;

/**
 * Longest message rendered for one diagnostic. A flattened TypeScript message
 * chain for a deep structural mismatch runs to thousands of characters; its
 * first few hundred carry the mismatch itself.
 */
const DIAGNOSTIC_MESSAGE_MAX_CHARS = 500;

/** Most files named in the omitted-diagnostics summary, largest first. */
const OMITTED_FILES_NAMED_MAX = 20;

/**
 * Format ptah_get_diagnostics result.
 *
 * Accepts a `DiagnosticsPayload` (`{ status, source, diagnostics,
 * requestedFiles? }`) so the formatter can distinguish "unavailable" from
 * "available with zero issues". Falls back to the legacy flat-array shape,
 * which carries no scope, for backward compatibility.
 *
 * `requestedFiles` is the call's `files` scope as the diagnostics namespace
 * resolved it: absolute paths under the session root. When present,
 * diagnostics in those files are listed first and never dropped; sibling-file
 * diagnostics fill the rest of {@link DIAGNOSTICS_DISPLAY_CAP}, and every
 * scoped result — an empty one included — closes with a `Shown N of M`
 * summary. The error and warning totals always count every diagnostic in the
 * payload.
 *
 * The payload's `coverage` (Batch 25b) decides what an answer may claim: a
 * bare "No issues found" only under the clean-answer rule with a type check
 * (see {@link DiagnosticsVerdict}); otherwise every qualifier is named in
 * words (syntax-only, unchecked, unsupported, census unknown, omittedByCap,
 * provider-defined, ...). The verdict and the compact coverage block sit
 * right under the totals, so the budget's cut of the tail never drops them
 * (the tool is `preformatted`: cut, never reduced).
 *
 * The checker fields (Batch 37b) qualify the verdict the same way: a `goVet`
 * run that did not check, `unmappedFindings` and `diagnosticsTruncated` are
 * named in the Coverage line, and a `**Go vet:**` line right under it says
 * what happened to the Go files (O2 §5.4 consent-off and stale texts).
 */
export function formatDiagnostics(payload: unknown): string {
  try {
    if (payload && typeof payload === 'object' && 'status' in payload) {
      const p = payload as {
        status: 'available' | 'unavailable';
        source: string;
        reason?: string;
        coverage?: unknown;
        notChecked?: unknown;
        goVet?: unknown;
        unmappedFindings?: unknown;
        diagnosticsTruncated?: unknown;
        diagnostics?: unknown[];
        requestedFiles?: unknown;
      };
      const limits = checkerLimits(p);
      const verdict = diagnosticsVerdict(p.coverage, limits);
      const notChecked = notCheckedGroups(p.notChecked);

      if (p.status === 'unavailable') {
        // The reason is unbounded (a compiler failure can run to pages), so
        // it goes last: the budget's cut of the tail may shorten it, never
        // the coverage verdict or the not-checked groups above it.
        return json2md([
          { h2: 'Diagnostics' },
          { p: `**Source:** ${p.source} — Unavailable (reason below).` },
          coverageBlock(verdict),
          ...goVetBlocks(limits),
          ...notCheckedBlocks(notChecked),
          { p: `**Reason:** ${p.reason ?? 'none given.'}` },
        ]);
      }

      const isRequested = requestedFileMatcher(p.requestedFiles);
      const diagnostics = Array.isArray(p.diagnostics) ? p.diagnostics : [];
      if (diagnostics.length === 0) {
        return json2md([
          { h2: 'Diagnostics' },
          {
            p: `**Source:** ${p.source}  \n${emptyVerdictLine(verdict)}`,
          },
          coverageBlock(verdict),
          ...goVetBlocks(limits),
          ...notCheckedBlocks(notChecked),
          ...(isRequested
            ? [
                {
                  p: scopedSummary({
                    shown: 0,
                    total: 0,
                    requested: 0,
                    coverage: 0,
                    requestedCoverage: 0,
                    omitted: 0,
                  }),
                },
              ]
            : []),
        ]);
      }

      return formatDiagnosticList(diagnostics, p.source, isRequested, {
        verdict,
        notChecked,
        goVet: goVetBlocks(limits),
      });
    }

    if (Array.isArray(payload)) {
      // The legacy shape carries no coverage, so it is never a clean answer.
      const verdict = diagnosticsVerdict(undefined, NO_CHECKER_LIMITS);
      if (payload.length === 0)
        return json2md([
          { h2: 'Diagnostics' },
          { p: emptyVerdictLine(verdict) },
          coverageBlock(verdict),
        ]);
      return formatDiagnosticList(payload, undefined, undefined, {
        verdict,
        notChecked: [],
        goVet: [],
      });
    }

    return fallbackJson(payload);
  } catch {
    return fallbackJson(payload);
  }
}

type SeverityClass = 'error' | 'warning' | 'other';

const SEVERITY_RANK: Record<SeverityClass, number> = {
  error: 0,
  warning: 1,
  other: 2,
};

const SEVERITY_HEADING: Record<SeverityClass, string> = {
  error: 'Errors',
  warning: 'Warnings',
  other: 'Other',
};

/**
 * Where one diagnostic is displayed: the three groups are disjoint. Requested
 * membership is kept separately in `requested`, because a coverage failure on a
 * requested tsconfig is displayed as coverage but still belongs to the request.
 */
type DiagnosticGroup = 'coverage' | 'requested' | 'sibling';

interface RankedDiagnostic {
  readonly raw: Record<string, unknown>;
  readonly file: string;
  readonly severity: SeverityClass;
  readonly group: DiagnosticGroup;
  readonly requested: boolean;
  readonly sortLine: number;
}

interface DiagnosticsSummaryCounts {
  readonly shown: number;
  readonly total: number;
  readonly requested: number;
  readonly coverage: number;
  readonly requestedCoverage: number;
  readonly omitted: number;
}

function formatDiagnosticList(
  diagnostics: unknown[],
  source: string | undefined,
  isRequested: ((file: string) => boolean) | undefined,
  answered: {
    readonly verdict: DiagnosticsVerdict;
    readonly notChecked: readonly NotCheckedGroup[];
    /** The go vet line, if any; it follows the Coverage line. */
    readonly goVet: ReadonlyArray<{ p: string }>;
  },
): string {
  const ranked: RankedDiagnostic[] = (
    diagnostics as Record<string, unknown>[]
  ).map((d) => {
    const file = diagnosticFile(d);
    const rawLine = d['line'] ?? extractRangeLine(d['range']);
    const line = Number(rawLine);
    const severity = severityClass(d['severity']);
    const requested = isRequested?.(file) ?? false;
    return {
      raw: d,
      file,
      severity,
      group: isCoverageFailure(file, rawLine, severity)
        ? 'coverage'
        : requested
          ? 'requested'
          : 'sibling',
      requested,
      sortLine: Number.isFinite(line) ? line : 0,
    };
  });

  // Totals are taken over EVERY diagnostic, before any cap is applied.
  const count = (s: SeverityClass): number =>
    ranked.filter((d) => d.severity === s).length;
  const errorCount = count('error');
  const warningCount = count('warning');
  const otherCount = count('other');

  ranked.sort(compareRanked);
  const coverage = ranked.filter((d) => d.group === 'coverage');
  const requestedCoverage = coverage.filter((d) => d.requested).length;
  const inRequested = ranked.filter((d) => d.group === 'requested');
  const siblings = ranked.filter((d) => d.group === 'sibling');
  // Requested-file diagnostics are never dropped, even past the cap: they are
  // the answer to the question asked. Siblings get whatever room is left.
  // Coverage failures are outside the cap altogether.
  const siblingRoom = Math.max(0, DIAGNOSTICS_DISPLAY_CAP - inRequested.length);
  const shownSiblings = siblings.slice(0, siblingRoom);
  const omitted = siblings.slice(siblingRoom);

  const blocks: any[] = [
    { h2: 'Diagnostics' },
    {
      p: `${source ? `**Source:** ${source}  \n` : ''}**Errors:** ${errorCount} | **Warnings:** ${warningCount}${
        otherCount > 0 ? ` | **Other:** ${otherCount}` : ''
      }`,
    },
    // Right under the totals, before every list: a budget cut of the tail
    // never drops what the answer did not cover.
    coverageBlock(answered.verdict),
    ...answered.goVet,
  ];
  // Unscoped, the not-checked groups are counts only and go next. Scoped,
  // they name requested files and follow the requested-file diagnostics, which
  // keep their place ahead of everything else (Batch 1 ordering).
  if (!isRequested) blocks.push(...notCheckedBlocks(answered.notChecked));

  // The grouped lists are pushed as raw strings: json2md passes a string
  // through untouched, whereas a `p` block would put a blank line between
  // every nested entry.
  if (coverage.length > 0) {
    blocks.push({ h3: 'Coverage failures' });
    blocks.push({
      p: 'These projects were not checked; their diagnostics are missing from this result.',
    });
    blocks.push(renderDiagnosticsByFile(coverage, false));
  }

  if (isRequested) {
    blocks.push({ h3: 'Requested files' });
    blocks.push(
      inRequested.length > 0
        ? renderDiagnosticsByFile(inRequested, true)
        : requestedCoverage > 0
          ? {
              p: `No other diagnostics in the requested files: ${requestedCoverage} requested file${requestedCoverage === 1 ? ' is' : 's are'} listed under Coverage failures above.`,
            }
          : { p: 'No diagnostics in the requested files.' },
    );
    blocks.push(...notCheckedBlocks(answered.notChecked));
    if (shownSiblings.length > 0) {
      blocks.push({ h3: 'Sibling files' });
      blocks.push(renderDiagnosticsByFile(shownSiblings, true));
    }
  } else {
    for (const severity of ['error', 'warning', 'other'] as const) {
      const section = shownSiblings.filter((d) => d.severity === severity);
      if (section.length === 0) continue;
      blocks.push({ h3: SEVERITY_HEADING[severity] });
      blocks.push(renderDiagnosticsByFile(section, false));
    }
  }

  if (omitted.length > 0) {
    blocks.push({
      p: `${isRequested ? 'Omitted sibling-file diagnostics' : 'Omitted diagnostics'}, by file: ${summarizeOmittedFiles(omitted)}`,
    });
  }

  const counts: DiagnosticsSummaryCounts = {
    shown: coverage.length + inRequested.length + shownSiblings.length,
    total: ranked.length,
    requested: inRequested.length,
    coverage: coverage.length,
    requestedCoverage,
    omitted: omitted.length,
  };
  if (isRequested) {
    blocks.push({ p: scopedSummary(counts) });
  } else if (omitted.length > 0) {
    blocks.push({
      p: `Shown ${counts.shown} of ${counts.total} (${coverageClause(counts)}${counts.omitted} omitted)`,
    });
  }

  return json2md(blocks);
}

/**
 * The closing line of every scoped result, an empty one included. Each shown
 * entry is counted once: requested coverage failures are counted under
 * coverage and named there, not added to the requested count.
 */
function scopedSummary(c: DiagnosticsSummaryCounts): string {
  return `Shown ${c.shown} of ${c.total} (${c.requested} in requested files, ${coverageClause(c)}${c.omitted} in sibling files omitted)`;
}

function coverageClause(c: DiagnosticsSummaryCounts): string {
  if (c.coverage === 0) return '';
  const inRequested =
    c.requestedCoverage > 0
      ? ` (${c.requestedCoverage} in requested files)`
      : '';
  return `${c.coverage} coverage failure${c.coverage === 1 ? '' : 's'}${inRequested}, `;
}

/**
 * What a diagnostics answer may claim (TASK_2026_559 Batch 25b). `bare` is
 * the only case that may print "No issues found": the coverage passes the
 * clean-answer rule (`coverageReasons` is empty) and the check was a type
 * check with no approximation. Otherwise `qualifiers` names, in words, each
 * reason the answer is not clean.
 */
interface DiagnosticsVerdict {
  readonly bare: boolean;
  readonly qualifiers: readonly string[];
  /** The compact coverage block (Batch 22c), when the payload carried one. */
  readonly compact?: CompactCoverage;
}

/** One `notChecked` group, as validated from the payload. */
interface NotCheckedGroup {
  readonly language: string;
  readonly count: number;
  readonly files: readonly string[];
  readonly reason: string;
}

const COVERAGE_NOT_REPORTED =
  'coverage not reported: which files and languages were checked is unknown';

const PROVIDER_DEFINED =
  'provider-defined: only what the installed language extensions report; census unknown, per-language coverage unknown';

/** A coverage object as the namespace forwards it, or `undefined`. */
function asCoverage(value: unknown): LanguageCoverage | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = value as Partial<LanguageCoverage>;
  return typeof candidate.census === 'string' &&
    Array.isArray(candidate.supportedLanguages)
    ? (value as LanguageCoverage)
    : undefined;
}

function diagnosticsVerdict(
  value: unknown,
  limits: CheckerLimits,
): DiagnosticsVerdict {
  const received = asCoverage(value);
  if (received === undefined) {
    return {
      bare: false,
      qualifiers: [COVERAGE_NOT_REPORTED, ...checkerQualifiers(limits)],
    };
  }
  // The payload crosses a boundary: a value outside a closed vocabulary is
  // one the clean-answer rule cannot judge, so it qualifies the answer and
  // is named (fail closed), never read as clean. The prose and the compact
  // block are both built from the same normalized coverage, so the block can
  // never say `clean: true` where the prose does not.
  const unrecognised = unrecognisedVocabularyTexts(received);
  const coverage = normalizedCoverage(received);
  const providerDefined = coverage.checks === 'provider-defined';
  const qualifiers: string[] = providerDefined ? [PROVIDER_DEFINED] : [];
  qualifiers.push(...unrecognised);
  for (const reason of coverageReasons(coverage)) {
    // Provider-defined coverage is unknown by construction; its sentence
    // already says so, so the unknown-count codes are not repeated.
    if (providerDefined && reason.endsWith('?')) continue;
    qualifiers.push(reasonText(reason, coverage));
  }
  qualifiers.push(...approximationTexts(coverage));
  // A go vet run that did not check, unplaced findings and a truncated list
  // each qualify the answer, whatever the coverage counts say (Batch 37b).
  qualifiers.push(...checkerQualifiers(limits));
  const typeCheckOnly =
    coverage.checks === undefined || coverage.checks === 'type-check';
  if (!typeCheckOnly && qualifiers.length === 0) {
    // Never an empty qualifier list: a check that is not a type check is
    // itself the qualifier.
    qualifiers.push(`${String(coverage.checks)} check: not a type-check claim`);
  }
  return {
    bare: qualifiers.length === 0 && typeCheckOnly,
    qualifiers,
    compact: compactCoverage(coverage),
  };
}

const CENSUS_VALUES: ReadonlySet<unknown> = new Set<CoverageCensus>([
  'complete',
  'truncated',
  'unknown',
]);
const STATE_VALUES: ReadonlySet<unknown> = new Set<CoverageState>([
  'current',
  'updating',
  'incomplete',
]);
const CHECKS_VALUES: ReadonlySet<unknown> = new Set<CoverageChecks>([
  'type-check',
  'syntax-only',
  'mixed',
  'provider-defined',
]);

/**
 * The coverage with each out-of-vocabulary verdict input replaced by a
 * non-clean value: an unrecognised `census` becomes `'unknown'`, an
 * unrecognised `state` becomes `'incomplete'`. (`checks` does not enter the
 * clean-answer rule; an unrecognised one is never bare, see the caller.)
 */
function normalizedCoverage(c: LanguageCoverage): LanguageCoverage {
  const censusValid = CENSUS_VALUES.has(c.census);
  const stateValid = c.state === undefined || STATE_VALUES.has(c.state);
  if (censusValid && stateValid) return c;
  return withCoverageVerdict({
    ...c,
    ...(censusValid ? {} : { census: 'unknown' as const }),
    ...(stateValid ? {} : { state: 'incomplete' as const }),
  });
}

/** A qualifier per `census`/`state`/`checks` value outside its vocabulary. */
function unrecognisedVocabularyTexts(c: LanguageCoverage): string[] {
  const texts: string[] = [];
  if (!CENSUS_VALUES.has(c.census)) {
    texts.push(
      `census ${JSON.stringify(c.census)} not recognised (treated as census unknown)`,
    );
  }
  if (c.state !== undefined && !STATE_VALUES.has(c.state)) {
    texts.push(`state ${JSON.stringify(c.state)} not recognised`);
  }
  if (c.checks !== undefined && !CHECKS_VALUES.has(c.checks)) {
    texts.push(
      `check kind ${JSON.stringify(c.checks)} not recognised (not a type-check claim)`,
    );
  }
  return texts;
}

function filesText(count: Count): string {
  return count === null
    ? 'an unknown number of files'
    : `${count} file${count === 1 ? '' : 's'}`;
}

/** `{python: 2, ruby: 1}` → `python 2, ruby 1`. */
function perKeyText(
  counts: Readonly<Partial<Record<string, number>>> | undefined,
): string {
  return Object.entries(counts ?? {})
    .filter(([, n]) => n !== undefined && n !== 0)
    .map(([key, n]) => `${key} ${n}`)
    .join(', ');
}

/** One clean-answer condition the coverage fails, in words. */
function reasonText(reason: CoverageReason, c: LanguageCoverage): string {
  switch (reason) {
    case 'census?':
      return 'census unknown (files outside the check were not counted)';
    case 'truncated':
      return `census truncated at ${c.censusLimit ?? 'its limit of'} files`;
    case 'updating':
      return 'index updating';
    case 'stale':
      return 'index incomplete';
    case 'unchecked':
      return `${filesText(c.unchecked)} unchecked (pass \`files\` to check them)`;
    case 'failed': {
      const why = perKeyText(c.failedByReason);
      return `${filesText(c.failed)} failed${why ? ` (${why})` : ''}`;
    }
    case 'unsupported': {
      const which = perKeyText(c.unsupportedByLanguage);
      return `${filesText(c.unsupported)} unsupported (no diagnostics for ${which || 'their language'} on this host)`;
    }
    case 'unrecognised':
      return `${filesText(c.unrecognised)} unrecognised (no language Ptah recognises)`;
    case 'omitted-by-cap':
      return `${filesText(c.omittedByCap)} omittedByCap (past the per-call cap; request them in another call)`;
    case 'excluded':
      return `${filesText(c.excluded)} excluded`;
    case 'unchecked?':
      return 'unchecked count unknown';
    case 'failed?':
      return 'failed count unknown';
    case 'unsupported?':
      return 'unsupported count unknown';
    case 'unrecognised?':
      return 'unrecognised count unknown';
    case 'omitted?':
      return 'omittedByCap count unknown';
    default:
      return reason;
  }
}

/**
 * The approximations the answer rests on. A syntax-only check is never a
 * type-check claim (Batch 25a floor amendment), so it is named even when the
 * counts are clean.
 */
function approximationTexts(c: LanguageCoverage): string[] {
  const approximations = c.approximations ?? [];
  const syntaxOnly = approximations
    .filter((a) => a.endsWith(':syntax-only'))
    .map((a) => a.slice(0, -':syntax-only'.length));
  const others = approximations.filter((a) => !a.endsWith(':syntax-only'));
  const texts: string[] = [];
  if (
    c.checks === 'syntax-only' ||
    c.checks === 'mixed' ||
    syntaxOnly.length > 0
  ) {
    // A mixed or syntax-only check always names its limitation, even when
    // the provider did not list which languages were syntax-only.
    const languages =
      syntaxOnly.length > 0 ? syntaxOnly.join(', ') : 'languages not named';
    texts.push(
      c.checks === 'mixed'
        ? `mixed check: ${languages} syntax-only (syntax errors only, not type-checked), the rest type-checked`
        : `syntax-only check (${languages}): syntax errors only, not type-checked`,
    );
  }
  if (others.length > 0) texts.push(`approximations: ${others.join(', ')}`);
  if (c.approximationsOmitted) {
    texts.push(
      `${c.approximationsOmitted} more approximation${c.approximationsOmitted === 1 ? '' : 's'} not listed`,
    );
  }
  return texts;
}

/** The totals line of an answer with no diagnostics. */
function emptyVerdictLine(verdict: DiagnosticsVerdict): string {
  return verdict.bare
    ? 'Errors: 0 | Warnings: 0 — No issues found.'
    : 'Errors: 0 | Warnings: 0 in what was checked — not a clean answer (see Coverage).';
}

/** The verdict in words, then the compact coverage block. */
function coverageBlock(verdict: DiagnosticsVerdict): { p: string } {
  const words = verdict.bare
    ? 'clean'
    : `qualified — ${verdict.qualifiers.join('; ')}.`;
  const block =
    verdict.compact === undefined
      ? ''
      : `  \n\`${JSON.stringify(verdict.compact)}\``;
  return { p: `**Coverage:** ${words}${block}` };
}

/** The payload's `notChecked` groups; malformed entries are dropped. */
function notCheckedGroups(value: unknown): NotCheckedGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: NotCheckedGroup[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const g = entry as Record<string, unknown>;
    if (
      typeof g['language'] !== 'string' ||
      typeof g['count'] !== 'number' ||
      typeof g['reason'] !== 'string'
    ) {
      continue;
    }
    const files = Array.isArray(g['files'])
      ? g['files'].filter((f): f is string => typeof f === 'string')
      : [];
    groups.push({
      language: g['language'],
      count: g['count'],
      files,
      reason: g['reason'],
    });
  }
  return groups;
}

/** A `Not checked` heading and one bullet per group, its files nested. */
function notCheckedBlocks(
  groups: readonly NotCheckedGroup[],
): Array<{ h3: string } | string> {
  if (groups.length === 0) return [];
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(
      `- ${group.count} ${group.language} file${group.count === 1 ? '' : 's'} — ${compactMessage(group.reason)}`,
    );
    for (const file of group.files) lines.push(`  - \`${file}\``);
    if (group.files.length > 0 && group.count > group.files.length) {
      lines.push(`  - … and ${group.count - group.files.length} more`);
    }
  }
  return [{ h3: 'Not checked' }, lines.join('\n') + '\n'];
}

/**
 * The opt-in `go vet` run as the payload carries it (Batch 37b). The payload
 * crosses a boundary, so every field is read from `unknown`; a report that
 * does not have this shape is `'malformed'` and fails closed.
 */
interface GoVetView {
  readonly status: 'checked' | 'unchecked' | 'failed';
  readonly reason?: string;
  readonly staleReason?: string;
  readonly checkedFiles: number;
}

/**
 * The checker fields of a payload. `unmapped` is the count of findings a
 * checker could not place in the workspace (0 when none, `'unknown'` when
 * the field is present but not a count); `truncated` is fail-closed: any
 * present value other than `false` counts as truncated.
 */
interface CheckerLimits {
  readonly goVet?: GoVetView | 'malformed';
  readonly unmapped: number | 'unknown';
  readonly truncated: boolean;
}

const NO_CHECKER_LIMITS: CheckerLimits = { unmapped: 0, truncated: false };

const GO_VET_STATUSES: ReadonlySet<unknown> = new Set([
  'checked',
  'unchecked',
  'failed',
]);

/**
 * Each fixed go vet reason code (the checker's `GoVetReason`, plus the
 * provider's `checker-error`) in words. A code outside this map is named as
 * not recognised, never dropped.
 */
const GO_VET_REASON_TEXT: ReadonlyMap<string, string> = new Map([
  ['no-consent', '`go vet` is off for this workspace'],
  ['consent-stale', '`go vet` consent for this workspace is out of date'],
  ['no-go-binary', 'no Go toolchain was found on PATH'],
  [
    'no-go-mod',
    'no go.mod above the requested files (GOPATH mode is not vetted)',
  ],
  ['no-go-files', 'no requested Go file to vet'],
  ['unscoped', '`go vet` runs only on requested files (pass `files`)'],
  ['no-spawner', 'this host cannot start processes for it'],
  ['spawn-failed', 'the go command could not be started'],
  ['timeout', 'it timed out and a stop was requested'],
  ['too-large', 'its output passed the size cap and a stop was requested'],
  ['cancelled', 'the call was cancelled'],
  ['toolchain-mismatch', 'go.mod needs a newer Go than the local toolchain'],
  [
    'missing-modules',
    'required modules are not in the module cache (no network)',
  ],
  ['build-errors', 'the packages did not build'],
  ['analyzer-error', 'an analyzer failed'],
  ['unparseable', 'its output could not be read'],
  ['cgo', 'cgo files are not built here'],
  ['other-module', 'some files are in another Go module'],
  ['omitted-by-cap', 'some packages were past the per-call package cap'],
  ['invalid-package-path', 'a package directory could not be passed safely'],
  ['not-found', 'a requested file does not exist'],
  ['root-unresolvable', 'the workspace folder could not be resolved'],
  ['outside-root', 'a file resolves outside this workspace'],
  ['build-constraints', 'build constraints may exclude some files'],
  ['ignored-name', 'the go command ignores some file names'],
  ['unverifiable', 'some files could not be verified as analysed'],
  ['unmapped-findings', 'some findings could not be placed in the workspace'],
  ['checker-error', 'the go vet checker failed'],
]);

const GO_VET_STALE_TEXT: ReadonlyMap<string, string> = new Map([
  ['root-moved', 'the workspace folder moved'],
  ['root-replaced', 'the workspace folder was replaced'],
  ['go-changed', 'the Go toolchain changed'],
]);

/** Where to turn `go vet` on (O2 §5.4). */
const GO_VET_ENABLE_HINT =
  'Settings → Tools (desktop app) or run `ptah config go-vet on` in this workspace.';

/** The payload's checker fields, validated. */
function checkerLimits(p: {
  readonly goVet?: unknown;
  readonly unmappedFindings?: unknown;
  readonly diagnosticsTruncated?: unknown;
}): CheckerLimits {
  const unmapped =
    p.unmappedFindings === undefined
      ? 0
      : typeof p.unmappedFindings === 'number' &&
          Number.isInteger(p.unmappedFindings) &&
          p.unmappedFindings >= 0
        ? p.unmappedFindings
        : 'unknown';
  return {
    ...(p.goVet !== undefined ? { goVet: goVetView(p.goVet) } : {}),
    unmapped,
    truncated:
      p.diagnosticsTruncated !== undefined && p.diagnosticsTruncated !== false,
  };
}

function goVetView(value: unknown): GoVetView | 'malformed' {
  if (value === null || typeof value !== 'object') return 'malformed';
  const r = value as Record<string, unknown>;
  const status = r['status'];
  const reason = r['reason'];
  const staleReason = r['staleReason'];
  const checkedFiles = r['checkedFiles'];
  if (
    !GO_VET_STATUSES.has(status) ||
    (reason !== undefined && typeof reason !== 'string') ||
    (staleReason !== undefined && typeof staleReason !== 'string') ||
    typeof checkedFiles !== 'number' ||
    !Number.isInteger(checkedFiles) ||
    checkedFiles < 0
  ) {
    return 'malformed';
  }
  return {
    status: status as GoVetView['status'],
    ...(reason !== undefined ? { reason } : {}),
    ...(staleReason !== undefined ? { staleReason } : {}),
    checkedFiles,
  };
}

/** A reason code as it appears in the Coverage line. */
function goVetCode(reason: string | undefined): string {
  if (reason === undefined) return 'no reason given';
  return GO_VET_REASON_TEXT.has(reason)
    ? reason
    : `reason ${JSON.stringify(clip(reason, 40))} not recognised`;
}

/** A reason code in words. */
function goVetReasonWords(reason: string | undefined): string {
  if (reason === undefined) return 'no reason was given';
  return (
    GO_VET_REASON_TEXT.get(reason) ??
    `reason ${JSON.stringify(clip(reason, 40))} not recognised`
  );
}

/**
 * The Coverage-line qualifiers of the checker fields: a go vet run that did
 * not check (or checked with a limitation), findings that could not be
 * placed, and a truncated list. Each one keeps the answer from being bare.
 */
function checkerQualifiers(limits: CheckerLimits): string[] {
  const texts: string[] = [];
  const vet = limits.goVet;
  if (vet === 'malformed') {
    texts.push('go vet report not recognised (Go files not claimed as vetted)');
  } else if (vet !== undefined) {
    if (vet.status !== 'checked') {
      texts.push(
        `go vet ${vet.status === 'failed' ? 'failed' : 'not run'} (${goVetCode(vet.reason)})`,
      );
    } else if (
      vet.reason !== undefined &&
      !(vet.reason === 'unmapped-findings' && limits.unmapped !== 0)
    ) {
      texts.push(`go vet limitation (${goVetCode(vet.reason)})`);
    }
  }
  const checker = vet === undefined ? 'checker' : 'go vet';
  if (limits.unmapped === 'unknown') {
    texts.push(
      `an unreported number of ${checker} findings could not be placed in the workspace (not listed)`,
    );
  } else if (limits.unmapped > 0) {
    texts.push(
      `${limits.unmapped} ${checker} finding${limits.unmapped === 1 ? '' : 's'} could not be placed in the workspace (not listed)`,
    );
  }
  if (limits.truncated) {
    texts.push(
      `diagnostics truncated: the ${checker} listed only its first findings, more exist`,
    );
  }
  return texts;
}

/**
 * The `**Go vet:**` line (O2 §5.4): what happened to the Go files, in words.
 * It sits right under the Coverage line, above every list. Only a host that
 * attached the checker sends `goVet`, so VS Code never shows it.
 */
function goVetBlocks(limits: CheckerLimits): Array<{ p: string }> {
  const vet = limits.goVet;
  if (vet === undefined) return [];
  return [{ p: `**Go vet:** ${goVetLine(vet)}` }];
}

function goVetLine(vet: GoVetView | 'malformed'): string {
  if (vet === 'malformed') {
    return 'report not recognised; Go files are not claimed as vetted.';
  }
  if (vet.reason === 'no-consent') {
    return `Go files were syntax-checked only; \`go vet\` is off for this workspace. Enable it in ${GO_VET_ENABLE_HINT}`;
  }
  if (vet.reason === 'consent-stale') {
    const why =
      vet.staleReason === undefined
        ? 'reason not reported'
        : (GO_VET_STALE_TEXT.get(vet.staleReason) ??
          `reason ${JSON.stringify(clip(vet.staleReason, 40))} not recognised`);
    return `Go files were syntax-checked only; \`go vet\` consent for this workspace is out of date (${why}). Re-enable it in ${GO_VET_ENABLE_HINT}`;
  }
  if (vet.status === 'checked') {
    const files = `${vet.checkedFiles} file${vet.checkedFiles === 1 ? '' : 's'}`;
    const limitation =
      vet.reason === undefined
        ? ''
        : ` Limitation: ${goVetReasonWords(vet.reason)}.`;
    return `Go files: syntax check plus \`go vet\` (${files} vetted); \`go vet\` is not a type check.${limitation}`;
  }
  const what = vet.status === 'failed' ? 'failed' : 'did not run';
  return `Go files were syntax-checked only; \`go vet\` ${what}: ${goVetReasonWords(vet.reason)}.`;
}

/**
 * A project the compiler provider could NOT check. The provider files each
 * such failure as an error at line 0 on the project's `tsconfig*.json`
 * (`withConfigFailures` in workspace-intelligence), so all three must hold: a
 * tsconfig diagnostic with a real line number is an ordinary finding in that
 * file and is ranked like any other.
 */
function isCoverageFailure(
  file: string,
  rawLine: unknown,
  severity: SeverityClass,
): boolean {
  return (
    severity === 'error' &&
    (rawLine === 0 || rawLine === '0') &&
    /^tsconfig.*\.json$/i.test(baseName(file))
  );
}

/** Severity, then file, then line. */
function compareRanked(a: RankedDiagnostic, b: RankedDiagnostic): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.sortLine - b.sortLine;
}

function severityClass(severity: unknown): SeverityClass {
  if (severity === 'error' || severity === 0 || severity === 'Error') {
    return 'error';
  }
  if (severity === 'warning' || severity === 1 || severity === 'Warning') {
    return 'warning';
  }
  return 'other';
}

function diagnosticFile(d: Record<string, unknown>): string {
  return String(d['file'] ?? d['uri'] ?? d['path'] ?? '');
}

/**
 * Canonical identity of a path, applied alike to requested and diagnostic
 * paths: separators unified, `.`/`..` and doubled slashes removed, no trailing
 * slash, and case-folded for Windows paths — the same folding rule the
 * diagnostics providers apply to their own scope.
 *
 * On a Windows host, and for any drive path (`D:/…`), Windows semantics apply,
 * so `..` stops at the drive or UNC share root instead of eating it. Other
 * paths on a POSIX host keep POSIX semantics. `normalize` rather than `resolve`: both sides are
 * absolute (the namespace resolved the request against the session root), and
 * resolving here would read the process cwd, which belongs to no session.
 */
function pathIdentity(p: string): string {
  const trimmedInput = p.trim();
  const windowsShaped =
    process.platform === 'win32' || /^[a-z]:[\\/]/i.test(trimmedInput);
  const normalized = (
    windowsShaped
      ? path.win32.normalize(trimmedInput)
      : path.posix.normalize(trimmedInput.replace(/\\/g, '/'))
  ).replace(/\\/g, '/');
  const isRoot =
    normalized === '/' ||
    /^[a-z]:\/$/i.test(normalized) ||
    /^\/\/[^/]+\/[^/]+\/?$/.test(normalized);
  const trimmed =
    !isRoot && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  return windowsShaped ? trimmed.toLowerCase() : trimmed;
}

/**
 * Predicate for "this diagnostic is in a file the caller asked about", or
 * `undefined` when the payload carries no scope. A diagnostic is requested
 * exactly when its canonical identity equals a requested one; there is no
 * suffix matching, so `src/a.ts` under one package never selects another
 * package's `src/a.ts`. Non-string entries are ignored.
 */
function requestedFileMatcher(
  files: unknown,
): ((file: string) => boolean) | undefined {
  if (!Array.isArray(files)) return undefined;
  const identities = new Set(
    files
      .filter((f): f is string => typeof f === 'string' && f.trim() !== '')
      .map(pathIdentity),
  );
  if (identities.size === 0) return undefined;
  return (file: string): boolean => identities.has(pathIdentity(file));
}

/**
 * One bullet per file, its diagnostics nested beneath it in the order given.
 * The full path is written once per file; each entry repeats only the base
 * name, which keeps 50 entries well inside the result budget.
 */
function renderDiagnosticsByFile(
  entries: readonly RankedDiagnostic[],
  tagSeverity: boolean,
): string {
  const byFile = new Map<string, RankedDiagnostic[]>();
  for (const entry of entries) {
    const group = byFile.get(entry.file);
    if (group) group.push(entry);
    else byFile.set(entry.file, [entry]);
  }

  const lines: string[] = [];
  for (const [file, group] of byFile) {
    lines.push(`- \`${file}\``);
    for (const entry of group) {
      lines.push(`  - ${formatDiagnosticItem(entry, tagSeverity)}`);
    }
  }
  // Trailing newline: json2md adds none after a raw string, and the next
  // heading needs a blank line to read as its own block.
  return lines.join('\n') + '\n';
}

function formatDiagnosticItem(
  entry: RankedDiagnostic,
  tagSeverity: boolean,
): string {
  const d = entry.raw;
  const name = baseName(entry.file);
  const line = d['line'] ?? extractRangeLine(d['range']) ?? '';
  const col = d['col'] ?? d['column'] ?? '';
  const code = d['code'] ? ` ${d['code']}:` : '';
  const tag = tagSeverity ? ` ${entry.severity}` : '';
  const location = line ? `${name}:${line}${col ? ':' + col : ''}` : name;
  return `\`${location}\` —${tag}${code} ${compactMessage(d['message'] ?? d['msg'] ?? '')}`;
}

function baseName(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] || file;
}

/** One line, at most {@link DIAGNOSTIC_MESSAGE_MAX_CHARS} characters. */
function compactMessage(message: unknown): string {
  const text = String(message)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(' ');
  if (text.length <= DIAGNOSTIC_MESSAGE_MAX_CHARS) return text;
  const cut = text.length - DIAGNOSTIC_MESSAGE_MAX_CHARS;
  return `${text.slice(0, DIAGNOSTIC_MESSAGE_MAX_CHARS)}… (+${cut} chars)`;
}

/**
 * Omitted diagnostics named per file, largest first, so a caller can see which
 * siblings are noisy without the list itself becoming the payload.
 */
function summarizeOmittedFiles(omitted: readonly RankedDiagnostic[]): string {
  const perFile = new Map<string, number>();
  for (const d of omitted) perFile.set(d.file, (perFile.get(d.file) ?? 0) + 1);

  const files = [...perFile.entries()].sort(
    ([fa, a], [fb, b]) => b - a || (fa < fb ? -1 : fa > fb ? 1 : 0),
  );
  const named = files
    .slice(0, OMITTED_FILES_NAMED_MAX)
    .map(([file, n]) => `\`${file}\` (${n})`);
  const rest = files.slice(OMITTED_FILES_NAMED_MAX);
  if (rest.length > 0) {
    const restCount = rest.reduce((sum, [, n]) => sum + n, 0);
    named.push(
      `and ${rest.length} more file${rest.length === 1 ? '' : 's'} (${restCount})`,
    );
  }
  return named.join(', ');
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
 * Format ptah_lsp_references result: an `LspLocationReport` (what the
 * dispatcher passes) or a plain location array.
 */
export function formatLspReferences(refs: unknown): string {
  return formatLspLocations(refs, 'LSP References', 'reference');
}

/**
 * Format ptah_lsp_definitions result: an `LspLocationReport` (what the
 * dispatcher passes) or a plain location array.
 */
export function formatLspDefinitions(defs: unknown): string {
  return formatLspLocations(defs, 'LSP Definitions', 'definition');
}

function formatLspLocations(
  value: unknown,
  title: string,
  noun: string,
): string {
  try {
    if (isLspLocationReport(value)) {
      return formatLspReport(value, title, noun);
    }
    if (!Array.isArray(value)) return fallbackJson(value);
    // A bare location list says nothing about how it was produced: render it
    // as a host answer whose language support is unknown.
    return formatLspReport(
      {
        locations: value,
        mechanism: 'provider-defined',
        language: null,
        languageSupported: null,
        approximations: [],
      },
      title,
      noun,
    );
  } catch {
    return fallbackJson(value);
  }
}

function isLspLocationReport(value: unknown): value is LspLocationReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record['locations']) &&
    typeof record['mechanism'] === 'string' &&
    Array.isArray(record['approximations'])
  );
}

/** A report whose locations are rendered leniently (legacy arrays too). */
type RenderableLspReport = Omit<LspLocationReport, 'locations'> & {
  readonly locations: readonly unknown[];
};

/**
 * The mechanism, language support, approximations and caps come before the
 * locations, so a cut result still says how it was produced. `none` never
 * prints a count: nothing was searched.
 */
function formatLspReport(
  report: RenderableLspReport,
  title: string,
  noun: string,
): string {
  const language = report.language ?? 'unrecognised';
  if (report.mechanism === 'none') {
    return json2md([
      { h2: title },
      {
        p:
          `Not available on this host (mechanism: none; language: ${language}). ` +
          `No ${noun} lookup ran, so this is not an empty result; ` +
          `search the workspace text instead.`,
      },
    ]);
  }

  const support =
    report.languageSupported === true
      ? ''
      : report.languageSupported === false
        ? ' (not supported by this mechanism)'
        : ' (support unknown: not reported by the host)';
  const blocks: json2md.DataObject[] = [
    { h2: title },
    { p: `Mechanism: ${report.mechanism}; language: ${language}${support}` },
  ];
  if (report.approximations.length > 0) {
    blocks.push({ p: `Approximations: ${report.approximations.join(', ')}` });
  }
  if (report.truncated === true) {
    blocks.push({
      p: `Truncated: a scan or result cap was hit; more ${noun}s may exist.`,
    });
  }

  const count = report.locations.length;
  // Only an explicitly supported language makes an empty list meaningful.
  const qualified =
    report.languageSupported !== true ||
    report.approximations.length > 0 ||
    report.truncated === true;
  const found = `Found: ${count} ${noun}${count !== 1 ? 's' : ''}`;
  blocks.push({
    p:
      count === 0 && qualified
        ? `${found} (qualified as above; not proof that none exist)`
        : found,
  });
  if (count > 0) {
    blocks.push({ ol: report.locations.map(formatLspLocationItem) });
  }
  return json2md(blocks);
}

function formatLspLocationItem(location: unknown): string {
  const loc = (location ?? {}) as Record<string, unknown>;
  const file = loc['file'] ?? loc['uri'] ?? loc['path'] ?? '';
  const line = loc['line'];
  const col = loc['col'] ?? loc['column'];
  // Coordinates are zero-based, as the tools take them: 0 is a real position,
  // so test presence, not truthiness.
  if (!isCoordinate(line)) return `\`${file}\``;
  return isCoordinate(col)
    ? `\`${file}:${line}:${col}\``
    : `\`${file}:${line}\``;
}

function isCoordinate(value: unknown): value is number | string {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value !== '')
  );
}

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

/**
 * Format CLI label for display: shows Ptah CLI agent name when applicable.
 * Extracted to eliminate repeated inline formatting across agent formatters.
 */
function formatCliLabel(cli: string, ptahCliName?: string): string {
  return cli === 'ptah-cli' && ptahCliName ? `ptah-cli (${ptahCliName})` : cli;
}

function formatRoleLine(role: {
  role?: string;
  roleDelivery?: string;
  roleChannel?: string;
}): string | undefined {
  if (!role.role) {
    return undefined;
  }
  const how =
    role.roleDelivery && role.roleChannel
      ? ` (${role.roleDelivery} via ${role.roleChannel})`
      : '';
  return `**Role:** ${role.role}${how}`;
}

function formatRoleDeliveryCapability(agent: CliDetectionResult): string {
  return agent.roleDelivery && agent.roleChannel
    ? `, role delivery: ${agent.roleDelivery}/${agent.roleChannel}`
    : '';
}

function formatWorkspaceRoles(roles: readonly string[]): string {
  return roles.length > 0
    ? `Roles in this workspace: ${roles.join(', ')}`
    : 'No agent roles generated for this workspace';
}

const NO_AGENTS_TEXT =
  'No agents found. Install one of the supported CLI agents, or configure a Ptah CLI agent (an Anthropic-compatible provider) in Ptah settings.';

function agentListRow(agent: CliDetectionResult): Record<string, string> {
  if (agent.cli === 'ptah-cli') {
    return {
      Agent: agent.ptahCliName ?? 'Unknown',
      Type: 'ptah-cli',
      Status: 'available',
      // `messagingMode` is read from the SAME declaration the message
      // router reads (Req 5.2) — never hardcoded here, or the cell would
      // promise a mechanism the router does not use.
      Capabilities: `provider: ${
        agent.providerName ?? 'Unknown'
      }, ptahCliId: ${agent.ptahCliId ?? 'N/A'}, messaging: ${
        agent.messagingMode
      }${formatRoleDeliveryCapability(agent)}`,
    };
  }

  // `disabled` outranks `installed`: the binary is present but spawning it
  // is rejected, and that is the fact the caller needs before choosing.
  const status = agent.disabled
    ? agent.installed
      ? 'disabled (installed)'
      : 'disabled'
    : agent.installed
      ? 'installed'
      : 'not installed';

  return {
    Agent: agent.cli,
    Type: 'cli',
    Status: status,
    Capabilities: `messaging: ${agent.messagingMode}${formatRoleDeliveryCapability(agent)}`,
  };
}

/**
 * Format ptah_agent_list result as a markdown table.
 *
 * Without `limits` the output is the pre-plan-limits text, byte for byte.
 * With `limits` a `Limit state` column is appended last, and the
 * `### Plan limits` and `### Alternatives by limit state` sections follow the
 * workspace roles line (design §5.1).
 */
export function formatAgentList(
  agents: CliDetectionResult[],
  roles?: readonly string[],
  limits?: readonly AgentLimit[],
): string {
  try {
    const rolesBlock =
      roles !== undefined ? [{ p: formatWorkspaceRoles(roles) }] : [];
    let listed: string;
    if (agents.length === 0) {
      listed = json2md([
        { h2: 'Available Agents' },
        { p: NO_AGENTS_TEXT },
        ...rolesBlock,
      ]);
    } else {
      const headers = ['Agent', 'Type', 'Status', 'Capabilities'];
      const rows = agents.map((agent) => {
        const row = agentListRow(agent);
        if (limits === undefined) return row;
        const limit = findAgentLimit(limits, agent);
        return {
          ...row,
          'Limit state': limit
            ? formatLimitColumn(limit)
            : 'unknown (limit lookup failed)',
        };
      });
      listed = json2md([
        { h2: 'Available Agents' },
        { p: `**Total:** ${agents.length}` },
        {
          table: {
            headers:
              limits === undefined ? headers : [...headers, 'Limit state'],
            rows,
          },
        },
        ...rolesBlock,
      ]);
    }
    if (limits === undefined) return listed;
    return `${listed}\n\n${formatPlanLimitsSection(limits)}\n\n${formatAlternatives(limits)}`;
  } catch {
    return fallbackJson(agents);
  }
}

/**
 * Format ptah_agent_spawn result.
 *
 * Without `limits` the output is the pre-plan-limits text, byte for byte.
 * With `limits` the limit block for the lane the spawn ran on follows the
 * existing fields (design §5.2).
 */
export function formatAgentSpawn(
  result: SpawnAgentResult,
  options?: { modelTier?: string },
  limits?: readonly AgentLimit[],
): string {
  try {
    const cliLabel = formatCliLabel(result.cli, result.ptahCliName);
    const roleLine = formatRoleLine(result);

    const formatted = json2md([
      { h2: 'Agent Spawned' },
      {
        p: [
          `**Agent ID:** ${result.agentId}`,
          `**CLI:** ${cliLabel}`,
          ...(options?.modelTier
            ? [`**Model Tier:** ${options.modelTier}`]
            : []),
          ...(roleLine ? [roleLine] : []),
          `**Status:** ${result.status}`,
          `**Started:** ${result.startedAt}`,
          ...(result.cliSessionId
            ? [`**CLI Session ID:** ${result.cliSessionId}`]
            : []),
        ].join('  \n'),
      },
    ]);
    if (limits === undefined) return formatted;
    const block = formatSpawnLimitBlock(
      limits,
      { cli: result.cli, ptahCliId: result.ptahCliId },
      false,
    );
    return `${formatted}\n\n${block}`;
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
      const roleLine = formatRoleLine(a);
      if (roleLine) {
        lines.push(roleLine);
      }
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
 * What each delivery mode means to the agent that asked for it.
 *
 * `interrupt-resume` carries a warning rather than a description: the
 * interrupted turn's partial work is gone, and a caller that reads the call as
 * a plain success will assume work that no longer exists (TASK_2026_402 R-11).
 */
const AGENT_MESSAGE_MODE_NOTES: Readonly<Record<AgentMessagingMode, string>> = {
  steer: 'Injected into the turn already in flight; that turn continues.',
  'interrupt-resume':
    'The turn in flight was ABORTED and its partial work DISCARDED, then the ' +
    'message was re-submitted on the same session. Anything that turn had ' +
    'produced but not written is gone.',
  'queue-next-turn':
    'Held and delivered as the next full turn, not mid-turn. The agent acts ' +
    'on it once its current turn settles.',
  unsupported:
    'NOTHING was delivered. The agent did not receive this message — see the ' +
    'reason below and use ptah_agent_list to check what this agent supports.',
};

/**
 * Format ptah_agent_message result
 */
export function formatAgentMessage(
  result: AgentMessageOutcome & {
    agentId: string;
  },
): string {
  try {
    return json2md([
      { h2: 'Agent Message' },
      {
        p: [
          `**Agent ID:** ${result.agentId}`,
          `**Mode:** ${result.mode}`,
          AGENT_MESSAGE_MODE_NOTES[result.mode],
          ...(result.detail ? [`**Detail:** ${result.detail}`] : []),
        ].join('  \n'),
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_agent_report result
 *
 * A refusal is rendered as plainly as a delivery: the calling agent has to be
 * able to tell that its report reached nobody.
 */
export function formatAgentReport(result: {
  delivered: boolean;
  reason?: string;
  parentSessionId?: string;
}): string {
  try {
    return json2md([
      { h2: result.delivered ? 'Report Delivered' : 'Report NOT Delivered' },
      {
        p: [
          `**Delivered:** ${result.delivered ? 'Yes' : 'No'}`,
          ...(result.reason ? [`**Reason:** ${result.reason}`] : []),
          ...(result.parentSessionId
            ? [`**Parent Session:** ${result.parentSessionId}`]
            : []),
        ].join('  \n'),
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_web_search result (multi-provider)
 */
export function formatWebSearch(result: {
  query: string;
  summary: string;
  providers: string[];
  status: string;
  durationMs: number;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    sources: string[];
  }>;
  resultCount: number;
  outcomes: Array<{
    provider: string;
    status: string;
    durationMs: number;
    resultCount: number;
    reason?: string;
    message?: string;
  }>;
}): string {
  try {
    const blocks: any[] = [
      { h2: 'Web Search Results' },
      {
        p: [
          `**Query:** ${result.query}`,
          `**Providers:** ${(result.providers ?? []).join(', ')}`,
          `**Status:** ${result.status}`,
          `**Results:** ${result.resultCount}`,
          `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
        ].join('  \n'),
      },
    ];
    // Always rendered, success included: this section is how the agent learns
    // which provider failed and whether a narrowed retry is worth making.
    const outcomes = result.outcomes ?? [];
    if (outcomes.length > 0) {
      blocks.push({ h3: 'Provider status' });
      blocks.push({
        // Both branches carry the count AND the timing. A failure's duration
        // is what tells the agent whether the provider timed out slowly or
        // refused instantly, which decides whether a retry is worth making.
        ul: outcomes.map((o) => {
          const measurements = `${o.resultCount} results, ${(
            o.durationMs / 1000
          ).toFixed(1)}s`;
          return o.status === 'ok'
            ? `**${o.provider}** — ok (${measurements})`
            : `**${o.provider}** — failed (${measurements}) — ${
                o.reason ?? 'provider-error'
              }: ${o.message ?? 'Unknown error'}`;
        }),
      });
    }
    if (result.summary) {
      blocks.push({ h3: 'Summary' });
      blocks.push({ p: result.summary });
    }
    if (result.results && result.results.length > 0) {
      blocks.push({ h3: 'Results' });
      const items = result.results.map(
        (r, i) =>
          `**${i + 1}. [${r.title}](${r.url})** — sources: ${(
            r.sources ?? []
          ).join(', ')}\n${r.snippet}`,
      );
      blocks.push({ ul: items });
    }

    return json2md(blocks);
  } catch {
    return fallbackJson(result);
  }
}

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
    const savedLine = result.filePath
      ? `  \n**Saved to:** \`${result.filePath}\``
      : '';
    return json2md([
      { h2: 'Screenshot Captured' },
      {
        p: `**Format:** ${result.format}  \n**Size:** ~${sizeKB}KB${savedLine}  \n**Data (base64):**`,
      },
      { code: { content: result.data } },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/** Saves the full stringified evaluate value (the dispatcher passes `spoolToolText`). */
export type EvaluateValueSpool = (text: string) => Promise<SpoolOutcome>;

/** The line that replaces the dropped tail of an over-budget evaluate value. */
function evaluateTruncationTrailer(
  dropped: number,
  saved: SpoolOutcome,
): string {
  const where =
    'path' in saved
      ? `full value: ${saved.path}`
      : `full value could not be saved: ${saved.failure}`;
  return `[...truncated: ${dropped} more chars; ${where} — for page content use ptah_browser_content with a selector]`;
}

/**
 * Largest `n` in `[0, max]` for which `fits(n)` holds, else 0 (`fits`
 * monotone; `fits(0)` is not tested).
 */
function largestFittingLength(
  max: number,
  fits: (n: number) => boolean,
): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** `end`, moved back one unit when the prefix would end on a high surrogate. */
function surrogateSafeEnd(text: string, end: number): number {
  const last = text.charCodeAt(end - 1);
  return end > 0 && last >= 0xd800 && last <= 0xdbff ? end - 1 : end;
}

/**
 * Format ptah_browser_evaluate result.
 *
 * A result that fits `budget` (the tool's result budget, measured the way
 * the budget step measures it) is rendered exactly as before. Otherwise the
 * full stringified value is saved with `spool`, and the value is cut to the
 * longest prefix (never inside a surrogate pair) for which the whole
 * answer, header and trailer included, still fits `budget`. The budget step
 * then returns it unchanged, so the trailer, with the dropped count and the
 * saved path, stays visible. Without the cut, `evaluate` would bypass the
 * cap `formatBrowserContent` puts on page content.
 */
export async function formatBrowserEvaluate(
  result: BrowserEvaluateResult,
  budget: TextBudget,
  spool: EvaluateValueSpool,
): Promise<string> {
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
    const header = [
      { h2: 'JavaScript Evaluation Result' },
      { p: `**Type:** ${result.type}` },
    ];

    if (result.type !== 'object' && valueStr.length <= 100) {
      return json2md([...header, { p: `**Value:** ${valueStr}` }]);
    }

    const render = (content: string): string =>
      json2md([...header, { code: { language: 'json', content } }]);
    const whole = render(valueStr);
    if (fitsBudget(whole, budget)) {
      return whole;
    }

    const saved = await spool(valueStr);
    const renderCut = (kept: number): string =>
      render(
        `${valueStr.slice(0, kept)}\n\n` +
          evaluateTruncationTrailer(valueStr.length - kept, saved),
      );
    const kept = surrogateSafeEnd(
      valueStr,
      largestFittingLength(Math.min(valueStr.length - 1, budget.chars), (n) =>
        fitsBudget(renderCut(n), budget),
      ),
    );
    return renderCut(kept);
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
    let statusText =
      `**Connected:** Yes  \n**URL:** ${result.url ?? 'N/A'}  \n` +
      `**Title:** ${result.title ?? 'N/A'}  \n` +
      `**Uptime:** ${uptimeSec}s  \n` +
      `**Auto-close in:** ${autoCloseMin}m`;

    if (result.headless !== undefined) {
      statusText += `  \n**Mode:** ${result.headless ? 'Headless' : 'Visible'}`;
    }
    if (result.viewport) {
      statusText += `  \n**Viewport:** ${result.viewport.width}x${result.viewport.height}`;
    }
    if (result.recording !== undefined) {
      statusText += `  \n**Recording:** ${result.recording ? 'Active' : 'Inactive'}`;
    }

    return json2md([{ h2: 'Browser Status' }, { p: statusText }]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_record_start result
 */
export function formatBrowserRecordStart(
  result: BrowserRecordStartResult,
): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Recording Start Failed' },
        { p: `**Error:** ${result.error}` },
      ]);
    }
    return json2md([
      { h2: 'Recording Started' },
      {
        p: 'Screen recording is now active. Use ptah_browser_record_stop to save the GIF.',
      },
    ]);
  } catch {
    return fallbackJson(result);
  }
}

/**
 * Format ptah_browser_record_stop result
 */
export function formatBrowserRecordStop(
  result: BrowserRecordStopResult,
): string {
  try {
    if (result.error) {
      return json2md([
        { h2: 'Recording Stop Failed' },
        { p: `**Error:** ${result.error}` },
      ]);
    }

    const sizeKB = Math.round(result.fileSizeBytes / 1024);
    const durationSec = Math.round(result.durationMs / 1000);
    const blocks: any[] = [
      { h2: 'Recording Saved' },
      {
        p:
          `**File:** ${result.filePath}  \n` +
          `**Frames:** ${result.frameCount}  \n` +
          `**Duration:** ${durationSec}s  \n` +
          `**Size:** ${sizeKB}KB`,
      },
    ];

    if (result.truncated) {
      blocks.push({
        p: '**Warning:** Recording was truncated because the frame buffer limit was reached. Older frames were discarded.',
      });
    }

    return json2md(blocks);
  } catch {
    return fallbackJson(result);
  }
}

function fallbackJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    // degradation-audit: optional-capability - this is already the last-resort
    // raw dump after the primary markdown formatter failed; a
    // circular-reference or BigInt payload that even JSON.stringify rejects has
    // no further representation, so the placeholder string is the intended
    // final fallback.
    return '[Unable to serialize result]';
  }
}
