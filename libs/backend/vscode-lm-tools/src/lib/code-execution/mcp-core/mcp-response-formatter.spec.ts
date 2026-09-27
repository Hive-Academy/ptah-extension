/**
 * mcp-response-formatter — unit specs.
 *
 * The formatter converts raw tool result objects into MCP-facing Markdown
 * strings (via json2md). Tests focus on the contract-level guarantees the
 * rest of the MCP stack relies on:
 *
 *   1. Stringify shape — every exported formatter returns a non-empty string.
 *   2. Nested result serialization — diagnostics, worktrees, and search
 *      results render all key fields into the Markdown surface.
 *   3. Error response envelope — error-bearing results render an "Error"
 *      branch rather than the success branch.
 *   4. Defensive fallback — malformed inputs (null, non-arrays where arrays
 *      are expected) should not throw; they fall back to JSON serialization.
 *
 * Source-under-test:
 *   libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/mcp-response-formatter.ts
 */

import 'reflect-metadata';

import {
  formatWorkspaceAnalysis,
  formatSearchFiles,
  formatDiagnostics,
  formatLspReferences,
  formatTokenCount,
  formatAgentList,
  formatAgentSpawn,
  formatAgentStatus,
  formatWorktreeList,
  formatWorktreeAdd,
  formatJsonValidate,
  formatBrowserNavigate,
  formatBrowserClick,
  formatBrowserContent,
  formatBrowserStatus,
} from './mcp-response-formatter';
import type {
  BrowserNavigateResult,
  BrowserClickResult,
  BrowserContentResult,
  BrowserStatusResult,
} from '../types';
import type {
  SpawnAgentResult,
  AgentProcessInfo,
  CliDetectionResult,
} from '@ptah-extension/shared';
import {
  withCoverageVerdict,
  type CoverageFields,
  type LanguageCoverage,
} from '@ptah-extension/platform-core';

/** A type-checked answer that passes the clean-answer rule. */
const CLEAN_TYPE_CHECK_FIELDS: CoverageFields = {
  supportedLanguages: ['typescript', 'javascript', 'tsx', 'python'],
  census: 'complete',
  analyzed: null,
  unchecked: 0,
  failed: 0,
  unsupported: 0,
  unrecognised: 0,
  nonSource: 0,
  excluded: null,
  omittedByCap: 0,
  checks: 'type-check',
};
const CLEAN_TYPE_CHECK: LanguageCoverage = withCoverageVerdict(
  CLEAN_TYPE_CHECK_FIELDS,
);

function coverageWith(fields: Partial<CoverageFields>): LanguageCoverage {
  return withCoverageVerdict({ ...CLEAN_TYPE_CHECK_FIELDS, ...fields });
}

// ---------------------------------------------------------------------------
// Workspace / search
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › workspace & search', () => {
  it('formatWorkspaceAnalysis renders project type, root, frameworks and deps', () => {
    const out = formatWorkspaceAnalysis({
      info: {
        projectType: 'nx-monorepo',
        rootPath: '/repo',
        frameworks: [
          { name: 'NestJS', version: '11.0.0', category: 'backend' },
        ],
      },
      structure: { structure: { directories: [], files: [] } },
      projectInfo: {
        version: '1.2.3',
        description: 'Test workspace',
        gitRepository: true,
        totalFiles: 42,
        dependencies: ['nestjs', 'prisma'],
        devDependencies: ['jest'],
      },
    });

    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/Workspace Analysis/);
    expect(out).toMatch(/nx-monorepo/);
    expect(out).toMatch(/\/repo/);
    expect(out).toMatch(/NestJS 11\.0\.0/);
    expect(out).toMatch(/Test workspace/);
    expect(out).toMatch(/nestjs/);
    expect(out).toMatch(/jest/);
  });

  it('formatSearchFiles renders a numbered list with file count', () => {
    const out = formatSearchFiles(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(out).toMatch(/File Search/);
    expect(out).toMatch(/Found: 3 files/);
    expect(out).toMatch(/src\/a\.ts/);
    expect(out).toMatch(/src\/c\.ts/);
  });

  it('formatSearchFiles falls back to JSON when input is not an array', () => {
    const out = formatSearchFiles({ notAnArray: true });
    // Shouldn't throw, must still be a string, and should surface the raw shape.
    expect(typeof out).toBe('string');
    expect(out).toContain('notAnArray');
  });
});

// ---------------------------------------------------------------------------
// Workspace analysis — bounded directory tree (TASK_2026_559 Batch 10)
// ---------------------------------------------------------------------------

interface FixtureDir {
  directories: Array<{ name: string; structure: FixtureDir | null }>;
  files: Array<{ name: string; extension: string }>;
}

function fixtureFiles(count: number, prefix = 'file'): FixtureDir['files'] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}-${String(i).padStart(3, '0')}.ts`,
    extension: '.ts',
  }));
}

function fixtureDir(
  directories: FixtureDir['directories'] = [],
  files: FixtureDir['files'] = [],
): FixtureDir {
  return { directories, files };
}

function analysisWithTree(tree: FixtureDir): string {
  return formatWorkspaceAnalysis({
    info: { projectType: 'node', rootPath: '/repo' },
    structure: { structure: tree, recommendations: [] },
  });
}

/** The rendered Directory Structure section alone. */
function treeSection(out: string): string {
  const start = out.indexOf('### Directory Structure');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = out.indexOf('\n### ', start + 1);
  return out.slice(start, end === -1 ? undefined : end);
}

describe('mcp-response-formatter › workspace analysis tree bounds', () => {
  it('renders a 500-flat-file directory under 4,000 chars with an "and N more" line', () => {
    const tree = fixtureDir([], fixtureFiles(500));

    const section = treeSection(analysisWithTree(tree));

    expect(section.length).toBeLessThan(4_000);
    expect(section).toContain('file-000.ts');
    expect(section).toContain('file-024.ts');
    expect(section).not.toContain('file-025.ts');
    expect(section).toContain('... and 475 more');
    // One entry per line: no json2md paragraph blank line between entries.
    expect(section).toContain('- file-000.ts\n- file-001.ts');
  });

  it('shares the budget across sibling directories instead of spending it on the first', () => {
    const packages = Array.from({ length: 12 }, (_, i) => ({
      name: `pkg-${String(i).padStart(2, '0')}`,
      structure: fixtureDir(
        Array.from({ length: 25 }, (_, j) => ({
          name: `module-${j}-${'m'.repeat(40)}`,
          structure: fixtureDir(),
        })),
      ),
    }));

    const section = treeSection(analysisWithTree(fixtureDir(packages)));

    expect(section.length).toBeLessThan(4_000);
    expect(section).toMatch(/\*\*pkg-00\/\*\*\n {2}- \*\*module-0-/);
    expect(section).toMatch(/\*\*pkg-11\/\*\*\n {2}- \*\*module-0-/);
  });

  it('caps each directory at 25 entries, directories before files', () => {
    const subdirs = Array.from({ length: 30 }, (_, i) => ({
      name: `pkg-${String(i).padStart(2, '0')}`,
      structure: fixtureDir(),
    }));
    const tree = fixtureDir(subdirs, fixtureFiles(3, 'root'));

    const section = treeSection(analysisWithTree(tree));

    expect(section).toContain('**pkg-24/**');
    expect(section).not.toContain('pkg-25');
    expect(section).not.toContain('root-000.ts');
    expect(section).toContain('... and 8 more');
  });

  it('stops at three levels and does not summarise a directory it never listed', () => {
    const tree = fixtureDir([
      {
        name: 'level1',
        structure: fixtureDir([
          {
            name: 'level2',
            structure: fixtureDir([
              {
                name: 'level3',
                structure: fixtureDir(
                  [{ name: 'level4', structure: fixtureDir() }],
                  fixtureFiles(40, 'deep'),
                ),
              },
            ]),
          },
        ]),
      },
    ]);

    const section = treeSection(analysisWithTree(tree));

    expect(section).toContain('- **level1/**');
    expect(section).toContain('  - **level2/**');
    expect(section).toContain('    - **level3/**');
    expect(section).not.toContain('level4');
    expect(section).not.toContain('deep-000.ts');
    expect(section).not.toMatch(/and \d+ more/);
  });

  it('skips tmp, dist, .claude-worktrees, .ptah, node_modules, .git and coverage', () => {
    const excluded = [
      'tmp',
      'dist',
      '.claude-worktrees',
      '.ptah',
      'node_modules',
      '.git',
      'coverage',
    ];
    const tree = fixtureDir(
      [
        ...excluded.map((name) => ({
          name,
          structure: fixtureDir([], fixtureFiles(5, `inside-${name}`)),
        })),
        { name: 'src', structure: fixtureDir([], fixtureFiles(1, 'main')) },
      ],
      [],
    );

    const section = treeSection(analysisWithTree(tree));

    for (const name of excluded) {
      expect(section).not.toContain(`**${name}/**`);
      expect(section).not.toContain(`inside-${name}`);
    }
    expect(section).toContain('**src/**');
    expect(section).toContain('main-000.ts');
    // Excluded directories are not counted as hidden entries either.
    expect(section).not.toMatch(/and \d+ more/);
  });

  it('keeps a wide, deep tree within the character budget', () => {
    const wide = (depth: number): FixtureDir =>
      depth === 0
        ? fixtureDir([], fixtureFiles(500))
        : fixtureDir(
            Array.from({ length: 40 }, (_, i) => ({
              name: `dir-${depth}-${i}-${'x'.repeat(120)}`,
              structure: wide(depth - 1),
            })),
            fixtureFiles(500),
          );

    const section = treeSection(analysisWithTree(wide(3)));

    expect(section.length).toBeLessThan(4_000);
    expect(section).toContain('…/**');
  });

  it('keeps the whole analysis of a large monorepo fixture within 8,000 chars', () => {
    const appDirs = Array.from({ length: 30 }, (_, i) => ({
      name: `app-${String(i).padStart(2, '0')}`,
      structure: fixtureDir(
        [
          {
            name: 'src',
            structure: fixtureDir([], fixtureFiles(500, `app${i}`)),
          },
        ],
        fixtureFiles(4, 'config'),
      ),
    }));
    const tree = fixtureDir(
      [
        { name: 'apps', structure: fixtureDir(appDirs) },
        { name: 'libs', structure: fixtureDir(appDirs) },
        { name: 'tmp', structure: fixtureDir([], fixtureFiles(500, 'tmp')) },
        { name: '.ptah', structure: fixtureDir([], fixtureFiles(500, 'ptah')) },
      ],
      fixtureFiles(20, 'root'),
    );

    const out = formatWorkspaceAnalysis({
      info: {
        projectType: 'nx-monorepo',
        rootPath: '/repo',
        frameworks: ['angular', 'node', 'react'],
      },
      structure: {
        structure: tree,
        recommendations: [
          'Include main source files relevant to your task',
          'Exclude build artifacts and dependencies',
        ],
      },
      projectInfo: {
        version: '1.0.0',
        description: 'Fixture monorepo',
        gitRepository: true,
        totalFiles: 120_000,
        dependencies: Array.from({ length: 60 }, (_, i) => `dep-${i}`),
        devDependencies: Array.from({ length: 90 }, (_, i) => `dev-${i}`),
        fileStatistics: { '.ts': 9000, '.js': 400, '.json': 700 },
        monorepoType: 'nx',
        projects: Array.from({ length: 30 }, (_, i) => ({
          name: `app-${i}`,
          path: `apps/app-${i}`,
          type: i % 2 === 0 ? 'angular' : 'node',
        })),
      },
    });

    expect(out.length).toBeLessThanOrEqual(8_000);
    expect(out).toContain('nx-monorepo');
    expect(out).toContain('### Projects');
    expect(out).toContain('app-0 (angular) — apps/app-0');
    expect(out).toContain('... and 5 more');
    expect(out).not.toContain('tmp-000.ts');
  });
});

describe('mcp-response-formatter › monorepo projects section (Batch 10 r1)', () => {
  const analysis = (projectInfo: Record<string, unknown>): string =>
    formatWorkspaceAnalysis({
      info: { projectType: 'nx-monorepo', rootPath: '/repo' },
      structure: { structure: { directories: [], files: [] } },
      projectInfo,
    });

  it('r1 B1: counts hidden projects against the discovered total, not the inspected list', () => {
    const inspected = Array.from({ length: 200 }, (_, i) => ({
      name: `pkg-${i}`,
      path: `libs/pkg-${i}`,
      type: 'node',
    }));

    const out = analysis({
      monorepoType: 'nx',
      projects: inspected,
      projectDiscovery: {
        totalProjects: 206,
        inspectedProjects: 200,
        complete: false,
        issues: ['6 of 206 projects not inspected (limit 200)'],
      },
    });

    expect(out).toContain('**Found:** 206 projects');
    expect(out).toContain('**Inspected:** 200');
    expect(out).toContain('... and 181 more (6 not inspected)');
    expect(out).toContain('**Discovery:** incomplete');
    expect(out).toContain('6 of 206 projects not inspected (limit 200)');
  });

  it('r1 B2 + S2: shows an unreadable project with its reason and a framework beside its type', () => {
    const out = analysis({
      monorepoType: 'yarn-workspaces',
      projects: [
        {
          name: 'api',
          path: 'services/api',
          type: 'node',
          framework: 'express',
        },
        {
          name: 'broken',
          path: 'services/broken',
          type: 'unknown',
          issue: 'package.json could not be read or parsed',
        },
      ],
      projectDiscovery: {
        totalProjects: 2,
        inspectedProjects: 2,
        complete: true,
        issues: [],
      },
    });

    expect(out).toContain('api (node, express) — services/api');
    expect(out).toContain(
      'broken (unknown) — services/broken — package.json could not be read or parsed',
    );
    expect(out).not.toMatch(/and \d+ more/);
  });

  it('r2 B3: a failed project past the 25-row prefix is still stated through the composition summary', () => {
    const projects = Array.from({ length: 30 }, (_, i) => ({
      name: `pkg-${String(i).padStart(2, '0')}`,
      path: `libs/pkg-${String(i).padStart(2, '0')}`,
      type: i === 29 ? 'unknown' : 'node',
      ...(i === 29
        ? { issue: 'project.json could not be read or parsed' }
        : {}),
    }));

    const out = analysis({
      monorepoType: 'nx',
      projects,
      projectDiscovery: {
        totalProjects: 30,
        inspectedProjects: 30,
        complete: false,
        issues: [
          '1 project could not be fully inspected: libs/pkg-29 (project.json could not be read or parsed)',
        ],
      },
    });

    expect(out).not.toContain('pkg-29 (unknown)');
    expect(out).toContain('**Discovery:** incomplete');
    expect(out).toContain(
      '1 project could not be fully inspected: libs/pkg-29 (project.json could not be read or parsed)',
    );
  });

  it('r3 M1: states the inspection failure before long project rows and bounds each row', () => {
    const long = 'x'.repeat(300);
    const projects = Array.from({ length: 30 }, (_, i) => ({
      name: `pkg-${String(i).padStart(2, '0')}-${long}`,
      path: `libs/${long}/pkg-${String(i).padStart(2, '0')}`,
      type: i === 29 ? 'unknown' : 'node',
    }));
    const summary =
      '1 project could not be fully inspected: libs/pkg-29 (project.json could not be read or parsed)';

    const out = analysis({
      monorepoType: 'nx',
      projects,
      projectDiscovery: {
        totalProjects: 30,
        inspectedProjects: 30,
        complete: false,
        issues: [summary],
      },
    });

    expect(out.length).toBeLessThanOrEqual(8_000);
    expect(out.indexOf(summary)).toBeGreaterThan(-1);
    expect(out.indexOf(summary)).toBeLessThan(out.indexOf('pkg-00-'));
    for (const line of out.split('\n').filter((l) => l.includes('pkg-'))) {
      expect(line.length).toBeLessThanOrEqual(200);
    }
  });

  it('r1 S1: renders the section for a monorepo with no projects found, with its notes', () => {
    const out = analysis({
      monorepoType: 'dotnet-solution',
      projects: [],
      projectDiscovery: {
        totalProjects: 0,
        inspectedProjects: 0,
        complete: false,
        issues: ['member listing is not supported for this monorepo type'],
      },
    });

    expect(out).toContain('### Projects');
    expect(out).toContain('**Found:** 0 projects');
    expect(out).toContain(
      'member listing is not supported for this monorepo type',
    );
  });
});

// ---------------------------------------------------------------------------
// Diagnostics / LSP / tokens
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › diagnostics, lsp & tokens', () => {
  it('formatDiagnostics groups errors and warnings with counts', () => {
    const out = formatDiagnostics([
      {
        file: 'a.ts',
        line: 1,
        col: 2,
        message: 'bad thing',
        severity: 'error',
        code: 'E1',
      },
      { file: 'b.ts', line: 5, message: 'maybe bad', severity: 'warning' },
    ]);

    expect(out).toMatch(/\*\*Errors:\*\* 1/);
    expect(out).toMatch(/\*\*Warnings:\*\* 1/);
    expect(out).toMatch(/a\.ts:1:2/);
    expect(out).toMatch(/bad thing/);
    expect(out).toMatch(/b\.ts:5/);
    expect(out).toMatch(/maybe bad/);
  });

  it('formatDiagnostics renders the legacy empty array as zero issues, never as a clean answer (it carries no coverage)', () => {
    const out = formatDiagnostics([]);
    expect(out).toContain('Errors: 0 | Warnings: 0');
    expect(out).not.toMatch(/No issues found/);
    expect(out).toContain('coverage not reported');
  });

  it('formatDiagnostics renders unavailable status with source and reason (TASK_2026_299)', () => {
    const out = formatDiagnostics({
      status: 'unavailable',
      source: 'cli-phase0',
      reason: 'Diagnostics not configured.',
    });
    expect(out).toMatch(/Diagnostics/);
    expect(out).toMatch(/Unavailable/);
    expect(out).toMatch(/cli-phase0/);
    expect(out).toMatch(/Diagnostics not configured/);
    expect(out).not.toMatch(/No issues found/);
  });

  it('formatDiagnostics renders available-empty with source and "No issues found" under a clean type-check coverage (TASK_2026_299, 559 Batch 25b)', () => {
    const out = formatDiagnostics({
      status: 'available',
      source: 'typescript-compiler',
      coverage: CLEAN_TYPE_CHECK,
      diagnostics: [],
    });
    expect(out).toMatch(/No issues found/);
    expect(out).toMatch(/typescript-compiler/);
    expect(out).toMatch(
      /\*\*Coverage:\*\* clean\s+`\{"clean":true,"analyzed":null\}`/,
    );
  });

  it('formatDiagnostics renders available-populated with source header (TASK_2026_299)', () => {
    const out = formatDiagnostics({
      status: 'available',
      source: 'vscode-languages',
      diagnostics: [
        { file: 'a.ts', line: 1, message: 'bad', severity: 'error' },
      ],
    });
    expect(out).toMatch(/vscode-languages/);
    expect(out).toMatch(/\*\*Errors:\*\* 1/);
    expect(out).toMatch(/a\.ts:1/);
  });

  describe('display cap, requested files first (TASK_2026_559)', () => {
    const ROOT =
      'D:/projects/ptah-extension/libs/backend/vscode-lm-tools/src/lib';
    const REQUESTED = `${ROOT}/code-execution/mcp-core/protocol-dispatcher.ts`;
    const SIBLING_A = `${ROOT}/code-execution/mcp-core/mcp-response-formatter.ts`;
    const SIBLING_B = `${ROOT}/code-execution/namespace-builders/core-namespace.builders.ts`;
    const TYPICAL =
      "Argument of type 'string | undefined' is not assignable to parameter of type 'string'.";

    function diag(
      file: string,
      line: number,
      severity: 'error' | 'warning',
      tag: string,
    ): Record<string, unknown> {
      return {
        file,
        line,
        severity,
        code: 2345,
        message: `${tag} ${TYPICAL}`,
      };
    }

    function payload(
      diagnostics: Record<string, unknown>[],
      requestedFiles?: string[],
    ) {
      return {
        status: 'available',
        source: 'typescript-compiler',
        coverage: CLEAN_TYPE_CHECK,
        diagnostics,
        ...(requestedFiles ? { requestedFiles } : {}),
      };
    }

    it('200 diagnostics across 3 files, 1 requested: every requested entry, exact totals and summary, <= 8,000 chars', () => {
      const diagnostics: Record<string, unknown>[] = [];
      // Interleave so the requested file is NOT first in the payload.
      for (let i = 0; i < 100; i++) {
        diagnostics.push(diag(SIBLING_A, i + 1, 'error', `sibA-${i}`));
      }
      for (let i = 0; i < 30; i++) {
        diagnostics.push(
          diag(REQUESTED, i + 1, i % 3 === 0 ? 'warning' : 'error', `req-${i}`),
        );
      }
      for (let i = 0; i < 70; i++) {
        diagnostics.push(diag(SIBLING_B, i + 1, 'warning', `sibB-${i}`));
      }

      const out = formatDiagnostics(payload(diagnostics, [REQUESTED]));

      // Totals count every diagnostic, not the shown ones: 100 + 20 errors,
      // 10 + 70 warnings.
      expect(out).toContain('**Errors:** 120 | **Warnings:** 80');
      for (let i = 0; i < 30; i++) {
        expect(out).toContain(`req-${i} `);
      }
      expect(out).toContain(
        'Shown 50 of 200 (30 in requested files, 150 in sibling files omitted)',
      );
      // Siblings fill the remaining 20 slots, errors first.
      const shownSiblingA = (out.match(/sibA-\d+ /g) ?? []).length;
      const shownSiblingB = (out.match(/sibB-\d+ /g) ?? []).length;
      expect(shownSiblingA).toBe(20);
      expect(shownSiblingB).toBe(0);
      // Omitted siblings are still named per file, with exact counts.
      expect(out).toContain(`\`${SIBLING_A}\` (80)`);
      expect(out).toContain(`\`${SIBLING_B}\` (70)`);
      // Requested files render before sibling files.
      expect(out.indexOf('### Requested files')).toBeLessThan(
        out.indexOf('### Sibling files'),
      );
      expect(out.indexOf('req-0 ')).toBeLessThan(out.indexOf('sibA-0 '));
      expect(out.length).toBeLessThanOrEqual(8000);
    });

    it('never drops a requested-file entry, even when requested files alone exceed the cap', () => {
      const diagnostics: Record<string, unknown>[] = [];
      for (let i = 0; i < 30; i++) {
        diagnostics.push(diag(SIBLING_A, i + 1, 'error', `sib-${i}`));
      }
      for (let i = 0; i < 70; i++) {
        diagnostics.push(diag(REQUESTED, i + 1, 'warning', `req-${i}`));
      }

      const out = formatDiagnostics(payload(diagnostics, [REQUESTED]));

      for (let i = 0; i < 70; i++) {
        expect(out).toContain(`req-${i} `);
      }
      expect(out).not.toMatch(/sib-\d+ /);
      expect(out).toContain('**Errors:** 30 | **Warnings:** 70');
      expect(out).toContain(
        'Shown 70 of 100 (70 in requested files, 30 in sibling files omitted)',
      );
      expect(out).toContain(`\`${SIBLING_A}\` (30)`);
    });

    it('matches a backslashed requested path, and never suffix-matches a relative one', () => {
      const diagnostics = [
        diag(SIBLING_A, 1, 'error', 'sib-0'),
        diag(REQUESTED, 4, 'error', 'req-0'),
      ];

      const backslashed = formatDiagnostics(
        payload(diagnostics, [REQUESTED.replace(/\//g, '\\')]),
      );
      expect(backslashed).toContain(
        'Shown 2 of 2 (1 in requested files, 0 in sibling files omitted)',
      );
      expect(backslashed.indexOf('req-0 ')).toBeLessThan(
        backslashed.indexOf('sib-0 '),
      );

      // The namespace resolves relative entries against the session root
      // before they reach the payload; the formatter has no root, so a
      // relative entry is an identity of its own and matches nothing.
      for (const relative of [
        './libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts',
        'protocol-dispatcher.ts',
      ]) {
        expect(formatDiagnostics(payload(diagnostics, [relative]))).toContain(
          '(0 in requested files',
        );
      }
    });

    it('says so when the requested files are clean but siblings are not', () => {
      const out = formatDiagnostics(
        payload([diag(SIBLING_A, 1, 'error', 'sib-0')], [REQUESTED]),
      );
      expect(out).toContain('No diagnostics in the requested files.');
      expect(out).toContain('sib-0 ');
      expect(out).toContain(
        'Shown 1 of 1 (0 in requested files, 0 in sibling files omitted)',
      );
    });

    it('lists a tsconfig coverage failure ahead of other sibling diagnostics', () => {
      const diagnostics: Record<string, unknown>[] = [];
      for (let i = 0; i < 80; i++) {
        diagnostics.push(diag(SIBLING_A, i + 1, 'error', `sib-${i}`));
      }
      diagnostics.push({
        file: 'D:/projects/ptah-extension/libs/backend/zz-lib/tsconfig.lib.json',
        line: 0,
        severity: 'error',
        message: 'This project was not type-checked: boom',
      });

      const out = formatDiagnostics(payload(diagnostics, [REQUESTED]));
      expect(out).toContain('This project was not type-checked: boom');
      expect(out).toContain('**Errors:** 81');
    });

    it('caps an unscoped call at 50 entries, errors first, with an exact summary', () => {
      const diagnostics: Record<string, unknown>[] = [];
      for (let i = 0; i < 90; i++) {
        diagnostics.push(diag(SIBLING_B, i + 1, 'warning', `warn-${i}`));
      }
      for (let i = 0; i < 30; i++) {
        diagnostics.push(diag(SIBLING_A, i + 1, 'error', `err-${i}`));
      }

      const out = formatDiagnostics(payload(diagnostics));

      expect(out).toContain('**Errors:** 30 | **Warnings:** 90');
      expect((out.match(/err-\d+ /g) ?? []).length).toBe(30);
      expect((out.match(/warn-\d+ /g) ?? []).length).toBe(20);
      expect(out).toContain('Shown 50 of 120 (70 omitted)');
      expect(out).toContain(`\`${SIBLING_B}\` (70)`);
      expect(out).not.toContain('requested files');
      expect(out.length).toBeLessThanOrEqual(8000);
    });

    it('does not add a summary line to an uncapped unscoped result', () => {
      const out = formatDiagnostics(
        payload([diag(SIBLING_A, 1, 'error', 'only')]),
      );
      expect(out).not.toMatch(/Shown \d+ of/);
    });

    it('shortens a very long message to one bounded line', () => {
      const out = formatDiagnostics(
        payload(
          [
            {
              file: REQUESTED,
              line: 1,
              severity: 'error',
              message: `head\n  ${'x'.repeat(2000)}`,
            },
          ],
          [REQUESTED],
        ),
      );
      expect(out).toContain('head xxx');
      expect(out).toMatch(/… \(\+\d+ chars\)/);
      expect(out.length).toBeLessThan(1500);
    });
  });

  describe('requested-file identity and coverage failures (TASK_2026_559 r1)', () => {
    // A root that is absolute on the platform running the spec.
    const REPO = process.platform === 'win32' ? 'D:/repo' : '/repo';

    function scoped(
      diagnostics: Record<string, unknown>[],
      requestedFiles?: string[],
    ) {
      return {
        status: 'available',
        source: 'typescript-compiler',
        coverage: CLEAN_TYPE_CHECK,
        diagnostics,
        ...(requestedFiles ? { requestedFiles } : {}),
      };
    }

    function render(p: ReturnType<typeof scoped>): string {
      return formatDiagnostics(p);
    }

    function error(file: string, line: number, message: string) {
      return { file, line, severity: 'error', message };
    }

    function coverageFailure(file: string, message: string) {
      return { file, line: 0, severity: 'error', message };
    }

    it('matches a requested path spelled with dot segments, doubled or back slashes, or a trailing slash', () => {
      const diagnostics = [
        ...Array.from({ length: 60 }, (_, i) =>
          error(`${REPO}/src/a.ts`, i + 1, `sib-${i}`),
        ),
        error(`${REPO}/src/z.ts`, 1, 'TARGET'),
      ];
      const spellings = [
        `${REPO}/src/../src/z.ts`,
        `${REPO}\\src\\..\\src\\z.ts`,
        `${REPO}//src/./z.ts/`,
      ];
      if (process.platform === 'win32') spellings.push('d:/REPO/SRC/Z.TS');

      for (const requested of spellings) {
        const out = render(scoped(diagnostics, [requested]));
        expect(out).toContain('TARGET');
        expect(out).not.toContain('No diagnostics in the requested files');
        expect(out).toContain(
          'Shown 50 of 61 (1 in requested files, 11 in sibling files omitted)',
        );
        expect(out.indexOf('### Requested files')).toBeLessThan(
          out.indexOf('TARGET'),
        );
        expect(out.indexOf('TARGET')).toBeLessThan(
          out.indexOf('### Sibling files'),
        );
      }
    });

    it('keeps the drive root when an absolute request climbs above it', () => {
      // Drive paths use Windows semantics on every host, so this runs on posix CI too.
      const diagnostics = [
        ...Array.from({ length: 60 }, (_, i) =>
          error('D:/repo/src/a.ts', i + 1, `sib-${i}`),
        ),
        error('D:/repo/src/z.ts', 1, 'TARGET'),
      ];

      const out = render(scoped(diagnostics, ['D:/repo/../../repo/src/z.ts']));

      expect(out).toContain('TARGET');
      expect(out).not.toContain('No diagnostics in the requested files');
      expect(out).toContain(
        'Shown 50 of 61 (1 in requested files, 11 in sibling files omitted)',
      );
    });

    if (process.platform === 'win32') {
      it('matches a UNC request spelled with dot segments and forward slashes', () => {
        const diagnostics = [
          ...Array.from({ length: 60 }, (_, i) =>
            error('\\\\server\\share\\src\\a.ts', i + 1, `sib-${i}`),
          ),
          error('\\\\server\\share\\src\\z.ts', 1, 'TARGET'),
        ];

        const out = render(
          scoped(diagnostics, ['//server/share/src/../src/z.ts']),
        );

        expect(out).toContain('TARGET');
        expect(out).toContain(
          'Shown 50 of 61 (1 in requested files, 11 in sibling files omitted)',
        );
      });
    }

    it('never calls a requested tsconfig clean when it has a coverage failure', () => {
      const out = render(
        scoped(
          [coverageFailure(`${REPO}/tsconfig.json`, 'NOT CHECKED')],
          [`${REPO}/tsconfig.json`],
        ),
      );

      expect(out).toContain('NOT CHECKED');
      expect(out).not.toContain('No diagnostics in the requested files');
      expect(out).toContain(
        'No other diagnostics in the requested files: 1 requested file is listed under Coverage failures above.',
      );
      expect(out).toContain(
        'Shown 1 of 1 (0 in requested files, 1 coverage failure (1 in requested files), 0 in sibling files omitted)',
      );
    });

    it('counts a requested coverage failure once when a requested source file also has diagnostics', () => {
      const out = render(
        scoped(
          [
            coverageFailure(`${REPO}/tsconfig.json`, 'NOT CHECKED'),
            coverageFailure(`${REPO}/libs/x/tsconfig.json`, 'NOT CHECKED X'),
            error(`${REPO}/src/a.ts`, 3, 'REAL'),
          ],
          [`${REPO}/tsconfig.json`, `${REPO}/src/a.ts`],
        ),
      );

      expect(out).toContain('NOT CHECKED X');
      expect(out).toContain('REAL');
      expect(out).not.toContain('No other diagnostics in the requested files');
      expect(out).toContain(
        'Shown 3 of 3 (1 in requested files, 2 coverage failures (1 in requested files), 0 in sibling files omitted)',
      );
    });

    it('renders every coverage failure when exactly 50 requested entries fill the cap', () => {
      const diagnostics = [
        ...Array.from({ length: 50 }, (_, i) =>
          error(`${REPO}/src/a.ts`, i + 1, `req-${i}`),
        ),
        coverageFailure(`${REPO}/tsconfig.lib.json`, 'NOT CHECKED A'),
        coverageFailure(`${REPO}/libs/x/tsconfig.json`, 'NOT CHECKED B'),
      ];

      const out = render(scoped(diagnostics, [`${REPO}/src/a.ts`]));

      expect(out).toContain('NOT CHECKED A');
      expect(out).toContain('NOT CHECKED B');
      for (let i = 0; i < 50; i++) expect(out).toContain(`req-${i}`);
      expect(out).toContain('**Errors:** 52 | **Warnings:** 0');
      expect(out).toContain(
        'Shown 52 of 52 (50 in requested files, 2 coverage failures, 0 in sibling files omitted)',
      );
      expect(out).not.toContain('Omitted sibling-file diagnostics');
    });

    it('renders every coverage failure when more than 50 requested entries exceed the cap', () => {
      const diagnostics = [
        ...Array.from({ length: 10 }, (_, i) =>
          error(`${REPO}/src/b.ts`, i + 1, `sib-${i}`),
        ),
        ...Array.from({ length: 55 }, (_, i) =>
          error(`${REPO}/src/a.ts`, i + 1, `req-${i}`),
        ),
        coverageFailure(`${REPO}/tsconfig.lib.json`, 'NOT CHECKED A'),
        coverageFailure(`${REPO}/libs/x/tsconfig.json`, 'NOT CHECKED B'),
      ];

      const out = render(scoped(diagnostics, [`${REPO}/src/a.ts`]));

      expect(out).toContain('NOT CHECKED A');
      expect(out).toContain('NOT CHECKED B');
      for (let i = 0; i < 55; i++) expect(out).toContain(`req-${i}`);
      expect(out).not.toMatch(/sib-\d+/);
      expect(out).toContain('**Errors:** 67 | **Warnings:** 0');
      expect(out).toContain(
        'Shown 57 of 67 (55 in requested files, 2 coverage failures, 10 in sibling files omitted)',
      );
      expect(out).toContain(
        `Omitted sibling-file diagnostics, by file: \`${REPO}/src/b.ts\` (10)`,
      );
    });

    it('does not promote a tsconfig diagnostic that has a line number', () => {
      const diagnostics = [
        ...Array.from({ length: 60 }, (_, i) =>
          error(`${REPO}/src/a.ts`, i + 1, `sib-${i}`),
        ),
        error(`${REPO}/tsconfig.json`, 3, 'ORDINARY CONFIG'),
      ];

      const out = render(scoped(diagnostics));

      expect(out).not.toContain('ORDINARY CONFIG');
      expect(out).not.toContain('coverage failure');
      expect(out).toContain('Shown 50 of 61 (11 omitted)');
      expect(out).toContain(`\`${REPO}/tsconfig.json\` (1)`);
    });

    it('counts and lists severities other than error and warning under Other', () => {
      const out = render(
        scoped([
          { file: `${REPO}/src/a.ts`, line: 1, severity: 'hint', message: 'H' },
          { file: `${REPO}/src/a.ts`, line: 2, severity: 3, message: 'I' },
          error(`${REPO}/src/a.ts`, 3, 'E'),
        ]),
      );
      expect(out).toContain('**Errors:** 1 | **Warnings:** 0 | **Other:** 2');
      expect(out).toContain('### Other');
      expect(out.indexOf('### Errors')).toBeLessThan(out.indexOf('### Other'));
    });

    it('names 20 omitted files, and folds the 21st into an "and N more" count', () => {
      const withOmittedFiles = (n: number) => [
        ...Array.from({ length: 50 }, (_, i) =>
          error(`${REPO}/a/keep.ts`, i + 1, `keep-${i}`),
        ),
        ...Array.from({ length: n }, (_, i) => ({
          file: `${REPO}/z/f${String(i).padStart(2, '0')}.ts`,
          line: 1,
          severity: 'warning',
          message: `w-${i}`,
        })),
      ];

      const twenty = render(scoped(withOmittedFiles(20)));
      expect(twenty).toContain(`\`${REPO}/z/f19.ts\` (1)`);
      expect(twenty).not.toMatch(/and \d+ more file/);
      expect(twenty).toContain('Shown 50 of 70 (20 omitted)');

      const twentyOne = render(scoped(withOmittedFiles(21)));
      expect(twentyOne).toContain(
        `\`${REPO}/z/f19.ts\` (1), and 1 more file (1)`,
      );
      expect(twentyOne).not.toContain(`${REPO}/z/f20.ts`);
      expect(twentyOne).toContain('Shown 50 of 71 (21 omitted)');
    });

    it('orders numeric and string line numbers numerically', () => {
      const out = render(
        scoped([
          error(`${REPO}/src/a.ts`, 10, 'L10'),
          {
            file: `${REPO}/src/a.ts`,
            line: '2',
            severity: 'error',
            message: 'L2',
          },
          error(`${REPO}/src/a.ts`, 1, 'L1'),
        ]),
      );
      expect(out.indexOf('a.ts:1`')).toBeLessThan(out.indexOf('a.ts:2`'));
      expect(out.indexOf('a.ts:2`')).toBeLessThan(out.indexOf('a.ts:10`'));
    });

    it('keeps a message of up to 500 characters whole and cuts a longer one at 500', () => {
      const messageOf = (n: number) =>
        render(scoped([error(`${REPO}/src/a.ts`, 1, 'm'.repeat(n))]));

      // Unscoped entries carry no severity tag: `a.ts:1` — <message>.
      expect(messageOf(499)).toContain(`— ${'m'.repeat(499)}\n`);
      expect(messageOf(500)).toContain(`— ${'m'.repeat(500)}\n`);
      expect(messageOf(500)).not.toContain('…');
      expect(messageOf(501)).toContain(`— ${'m'.repeat(500)}… (+1 chars)\n`);
    });

    it('closes a scoped call with no diagnostics with a Shown 0 of 0 summary', () => {
      const out = render(scoped([], [`${REPO}/src/a.ts`]));
      expect(out).toContain('No issues found');
      expect(out).toContain(
        'Shown 0 of 0 (0 in requested files, 0 in sibling files omitted)',
      );
    });
  });

  describe('coverage and the clean-answer rule (TASK_2026_559 Batch 25b)', () => {
    const PASS_FILES =
      'The syntax check runs only on requested files: pass `files` to check them.';

    function empty(
      coverage: unknown,
      notChecked?: unknown,
      requestedFiles?: string[],
    ): string {
      return formatDiagnostics({
        status: 'available',
        source: 'typescript-compiler',
        coverage,
        ...(notChecked !== undefined ? { notChecked } : {}),
        diagnostics: [],
        ...(requestedFiles ? { requestedFiles } : {}),
      });
    }

    it('mixed repo never prints a bare No issues found', () => {
      // An unscoped call on a TS + Python repository: the compiler found
      // nothing, the two Python files were never looked at.
      const out = empty(coverageWith({ unchecked: 2 }), [
        { language: 'python', count: 2, reason: PASS_FILES },
      ]);

      expect(out).not.toMatch(/No issues found/);
      expect(out).toContain('not a clean answer');
      expect(out).toContain(
        '**Coverage:** qualified — 2 files unchecked (pass `files` to check them).',
      );
      expect(out).toContain('"reasons":["unchecked"]');
      expect(out).toContain('### Not checked');
      expect(out).toContain(`- 2 python files — ${PASS_FILES}`);
    });

    it.each([
      [
        'syntax-only',
        coverageWith({
          analyzed: 1,
          checks: 'syntax-only',
          approximations: ['python:syntax-only'],
        }),
        'syntax-only check (python): syntax errors only, not type-checked',
      ],
      [
        'mixed',
        coverageWith({
          checks: 'mixed',
          approximations: ['go:syntax-only', 'python:syntax-only'],
        }),
        'mixed check: go, python syntax-only (syntax errors only, not type-checked), the rest type-checked',
      ],
      [
        'unsupported',
        coverageWith({ unsupported: 1, unsupportedByLanguage: { ruby: 1 } }),
        '1 file unsupported (no diagnostics for ruby 1 on this host)',
      ],
      [
        'census unknown',
        coverageWith({
          census: 'unknown',
          unchecked: null,
          failed: null,
          unsupported: null,
          unrecognised: null,
          nonSource: null,
          omittedByCap: null,
        }),
        'census unknown (files outside the check were not counted)',
      ],
      [
        'omittedByCap',
        coverageWith({ analyzed: 50, checks: 'syntax-only', omittedByCap: 1 }),
        '1 file omittedByCap (past the per-call cap; request them in another call)',
      ],
      [
        'failed',
        coverageWith({
          failed: 2,
          failedByReason: { read: 1, 'too-large': 1 },
        }),
        '2 files failed (read 1, too-large 1)',
      ],
      [
        'truncated census',
        coverageWith({ census: 'truncated', censusLimit: 50_000 }),
        'census truncated at 50000 files',
      ],
      [
        'provider-defined',
        withCoverageVerdict({
          supportedLanguages: [],
          census: 'unknown',
          analyzed: null,
          unchecked: null,
          failed: null,
          unsupported: null,
          unrecognised: null,
          nonSource: null,
          excluded: null,
          omittedByCap: null,
          checks: 'provider-defined',
        }),
        'provider-defined: only what the installed language extensions report',
      ],
    ] as const)(
      'names the %s qualifier instead of a bare No issues found',
      (_name, coverage, qualifier) => {
        const out = empty(coverage);
        expect(out).not.toMatch(/No issues found/);
        expect(out).toContain(qualifier);
      },
    );

    it('a clean syntax-only answer is still not a type-check claim', () => {
      const coverage = coverageWith({
        analyzed: 3,
        checks: 'syntax-only',
        approximations: ['python:syntax-only'],
      });
      expect(coverage.clean).toBe(true);
      expect(empty(coverage)).not.toMatch(/No issues found/);
    });

    it('a payload with no coverage is never clean', () => {
      const out = empty(undefined);
      expect(out).not.toMatch(/No issues found/);
      expect(out).toContain('coverage not reported');
    });

    // Review r1 M1: a value outside a closed vocabulary fails closed and is
    // named, even when every count is clean.
    it.each([
      [
        'census',
        { census: 'unavailable' },
        'census "unavailable" not recognised (treated as census unknown)',
      ],
      ['state', { state: 'frozen' }, 'state "frozen" not recognised'],
      [
        'checks',
        { checks: 'lint' },
        'check kind "lint" not recognised (not a type-check claim)',
      ],
    ])(
      'an unrecognised %s value with zero counts is never a bare clean answer',
      (_field, override, qualifier) => {
        const coverage = { ...CLEAN_TYPE_CHECK, ...override };
        const out = empty(coverage);
        expect(out).not.toMatch(/No issues found/);
        expect(out).toContain(`**Coverage:** qualified — ${qualifier}`);
      },
    );

    // Review r2 R2-M1: the compact block is built from the same normalized
    // coverage as the prose, so it never says clean where the prose does not.
    it.each([
      [
        'census',
        { census: 'unavailable' },
        '"reasons":["census?"]',
        '"census":"unknown"',
        'census unknown (files outside the check were not counted)',
      ],
      [
        'state',
        { state: 'frozen' },
        '"reasons":["stale"]',
        '"state":"incomplete"',
        'index incomplete',
      ],
    ])(
      'an unrecognised %s value makes the compact block clean:false, consistent with the prose',
      (_field, override, reasons, normalized, prose) => {
        const out = empty({ ...CLEAN_TYPE_CHECK, ...override });
        const compact = /`(\{"clean":[^`]*\})`/.exec(out);
        expect(compact).not.toBeNull();
        const block = compact?.[1] ?? '';
        expect(block.startsWith('{"clean":false,')).toBe(true);
        expect(block).toContain(reasons);
        expect(block).toContain(normalized);
        expect(out).not.toContain('"clean":true');
        expect(out).toContain(prose);
      },
    );

    // Review r1 M3: never an empty qualifier list.
    it.each([
      [
        'mixed',
        'mixed check: languages not named syntax-only (syntax errors only, not type-checked), the rest type-checked',
      ],
      [
        'syntax-only',
        'syntax-only check (languages not named): syntax errors only, not type-checked',
      ],
    ] as const)(
      'a %s check without approximation names still names its qualifier',
      (checks, qualifier) => {
        const out = empty(coverageWith({ checks }));
        expect(out).not.toMatch(/No issues found/);
        expect(out).not.toContain('qualified — .');
        expect(out).toContain(`**Coverage:** qualified — ${qualifier}.`);
      },
    );

    it('renders coverage and the not-checked files on the unavailable arm', () => {
      const file = '/repo/app/main.rb';
      const out = formatDiagnostics({
        status: 'unavailable',
        source: 'tree-sitter-syntax',
        reason: 'No requested file could be checked.',
        coverage: coverageWith({
          analyzed: 0,
          checks: undefined,
          unsupported: 1,
          unsupportedByLanguage: { ruby: 1 },
        }),
        notChecked: [
          {
            language: 'ruby',
            count: 1,
            files: [file],
            reason: 'No diagnostics for ruby.',
          },
        ],
        diagnostics: [],
      });
      expect(out).toContain('Unavailable (reason below).');
      expect(out).toContain('**Reason:** No requested file could be checked.');
      expect(out).toContain('1 file unsupported');
      // Review r1 M2: the unbounded reason comes after the coverage.
      expect(out.indexOf('**Coverage:**')).toBeLessThan(
        out.indexOf('**Reason:**'),
      );
      expect(out.indexOf('### Not checked')).toBeLessThan(
        out.indexOf('**Reason:**'),
      );
      expect(out).toContain(
        `- 1 ruby file — No diagnostics for ruby.\n  - \`${file}\``,
      );
    });

    it('lists a group past its named files with the remainder counted', () => {
      const out = empty(
        coverageWith({ omittedByCap: 12, checks: 'syntax-only' }),
        [
          {
            language: 'python',
            count: 12,
            files: ['/r/a.py', '/r/b.py'],
            reason: 'Past the cap.',
          },
        ],
      );
      expect(out).toContain('  - `/r/b.py`\n  - … and 10 more');
    });

    it('puts the verdict above every list; scoped, the not-checked files follow the requested ones and precede siblings', () => {
      const REPO = '/repo';
      const out = formatDiagnostics({
        status: 'available',
        source: 'typescript-compiler+tree-sitter-syntax',
        coverage: coverageWith({
          checks: 'mixed',
          approximations: ['python:syntax-only'],
          unsupported: 1,
          unsupportedByLanguage: { ruby: 1 },
        }),
        notChecked: [
          {
            language: 'ruby',
            count: 1,
            files: [`${REPO}/x.rb`],
            reason: 'No diagnostics for ruby.',
          },
        ],
        diagnostics: [
          {
            file: `${REPO}/sib.ts`,
            line: 1,
            severity: 'error',
            message: 'SIB',
          },
          {
            file: `${REPO}/req.py`,
            line: 2,
            severity: 'error',
            message: 'REQ',
          },
        ],
        requestedFiles: [`${REPO}/req.py`, `${REPO}/x.rb`],
      });
      const at = (s: string): number => {
        const i = out.indexOf(s);
        expect(i).toBeGreaterThanOrEqual(0);
        return i;
      };
      expect(at('**Coverage:** qualified')).toBeLessThan(
        at('### Requested files'),
      );
      expect(at('REQ')).toBeLessThan(at('### Not checked'));
      expect(at('### Not checked')).toBeLessThan(at('### Sibling files'));
      expect(at('### Sibling files')).toBeLessThan(at('SIB'));
    });
  });

  it('formatLspReferences shows count and file:line:col entries', () => {
    const out = formatLspReferences([
      { file: 'src/foo.ts', line: 10, col: 4 },
      { file: 'src/bar.ts', line: 3, col: 0 },
    ]);
    expect(out).toMatch(/Found: 2 references/);
    expect(out).toMatch(/src\/foo\.ts:10:4/);
    expect(out).toMatch(/src\/bar\.ts:3/);
  });

  it('formatTokenCount renders file + token count', () => {
    const out = formatTokenCount({ file: 'src/big.ts', tokens: 12345 });
    expect(out).toMatch(/Token Count/);
    expect(out).toMatch(/src\/big\.ts/);
    expect(out).toMatch(/12345/);
  });
});

// ---------------------------------------------------------------------------
// Agent namespace
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › agent namespace', () => {
  it('formatAgentList renders a table of detected agents', () => {
    const agents = [
      {
        cli: 'codex',
        installed: true,
        messagingMode: 'steer',
      },
      {
        cli: 'copilot',
        installed: false,
        messagingMode: 'queue',
      },
    ] as unknown as CliDetectionResult[];

    const out = formatAgentList(agents);
    expect(out).toMatch(/Available Agents/);
    expect(out).toMatch(/\*\*Total:\*\* 2/);
    expect(out).toMatch(/codex/);
    expect(out).toMatch(/installed/);
    expect(out).toMatch(/not installed/);
  });

  it('formatAgentList renders the messaging capability for a system CLI', () => {
    const agents = [
      { cli: 'cursor', installed: true, messagingMode: 'interrupt' },
    ] as unknown as CliDetectionResult[];

    expect(formatAgentList(agents)).toMatch(/messaging: interrupt/);
  });

  it('formatAgentList appends messaging to the Ptah CLI row (Req 5.2)', () => {
    // The cell must read the SAME declaration the message router reads. A
    // hardcoded value here would advertise a mechanism the router never uses.
    const agents = [
      {
        cli: 'ptah-cli',
        installed: true,
        messagingMode: 'queue',
        ptahCliId: 'pc-1',
        ptahCliName: 'Reviewer',
        providerName: 'Acme',
      },
    ] as unknown as CliDetectionResult[];

    const out = formatAgentList(agents);
    expect(out).toMatch(/provider: Acme/);
    expect(out).toMatch(/ptahCliId: pc-1/);
    expect(out).toMatch(/messaging: queue/);
  });

  it('formatAgentList marks a disabled-but-installed agent as disabled', () => {
    const agents = [
      { cli: 'codex', installed: true, messagingMode: 'steer', disabled: true },
      {
        cli: 'cursor',
        installed: false,
        messagingMode: 'interrupt',
        disabled: true,
      },
    ] as unknown as CliDetectionResult[];

    const out = formatAgentList(agents);
    expect(out).toMatch(/disabled \(installed\)/);
    // A disabled CLI that is not installed reads plainly as `disabled`.
    expect(out).toMatch(/\bdisabled\b/);
    expect(out).not.toMatch(/not installed/);
  });

  it('formatAgentList renders helpful empty-state message for zero agents', () => {
    const out = formatAgentList([]);
    expect(out).toMatch(/No agents found/);
  });

  it('formatAgentSpawn includes model tier when provided', () => {
    const result = {
      agentId: 'agent-42',
      cli: 'codex',
      status: 'running',
      startedAt: '2026-04-24T00:00:00Z',
      cliSessionId: 'sess-xyz',
    } as unknown as SpawnAgentResult;

    const out = formatAgentSpawn(result, { modelTier: 'opus' });
    expect(out).toMatch(/Agent Spawned/);
    expect(out).toMatch(/agent-42/);
    expect(out).toMatch(/codex/);
    expect(out).toMatch(/Model Tier.*opus/);
    expect(out).toMatch(/sess-xyz/);
  });

  it('formatAgentStatus normalizes single-result input to an array', () => {
    const single = {
      agentId: 'agent-1',
      cli: 'codex',
      task: 'hello world',
      status: 'running',
      startedAt: '2026-04-24T01:02:03Z',
    } as unknown as AgentProcessInfo;

    const out = formatAgentStatus(single);
    expect(out).toMatch(/Agent Status/);
    expect(out).toMatch(/\*\*Total:\*\* 1/);
    expect(out).toMatch(/agent-1/);
    expect(out).toMatch(/codex/);
    expect(out).toMatch(/hello world/);
  });

  it('formatAgentList adds role delivery to each Capabilities cell that has it', () => {
    const agents = [
      {
        cli: 'codex',
        installed: true,
        messagingMode: 'steer',
        roleDelivery: 'preamble',
        roleChannel: 'developer-instructions',
      },
      {
        cli: 'ptah-cli',
        installed: true,
        messagingMode: 'queue',
        ptahCliId: 'pc-1',
        ptahCliName: 'Reviewer',
        providerName: 'Acme',
        roleDelivery: 'preamble',
        roleChannel: 'system-prompt',
      },
      { cli: 'cursor', installed: true, messagingMode: 'interrupt' },
    ] as unknown as CliDetectionResult[];

    const out = formatAgentList(agents, []);
    expect(out).toMatch(
      /messaging: steer, role delivery: preamble\/developer-instructions/,
    );
    expect(out).toMatch(
      /messaging: queue, role delivery: preamble\/system-prompt/,
    );
    expect(out).toMatch(/messaging: interrupt \|/);
  });

  it('formatAgentList lists the workspace roles when there are some', () => {
    const agents = [
      { cli: 'codex', installed: true, messagingMode: 'steer' },
    ] as unknown as CliDetectionResult[];

    const out = formatAgentList(agents, ['architect', 'reviewer']);
    expect(out).toMatch(/Roles in this workspace: architect, reviewer/);
    expect(out).not.toMatch(/No agent roles generated/);
  });

  it('formatAgentList says no roles were generated for an empty role list', () => {
    const agents = [
      { cli: 'codex', installed: true, messagingMode: 'steer' },
    ] as unknown as CliDetectionResult[];

    expect(formatAgentList(agents, [])).toMatch(
      /No agent roles generated for this workspace/,
    );
    expect(formatAgentList([], [])).toMatch(
      /No agent roles generated for this workspace/,
    );
  });

  it('formatAgentList renders no roles line when roles are not supplied', () => {
    const agents = [
      { cli: 'codex', installed: true, messagingMode: 'steer' },
    ] as unknown as CliDetectionResult[];

    const out = formatAgentList(agents);
    expect(out).not.toMatch(/Roles in this workspace/);
    expect(out).not.toMatch(/No agent roles generated/);
  });

  it('formatAgentSpawn renders the role with its delivery and channel', () => {
    const result = {
      agentId: 'agent-7',
      cli: 'codex',
      status: 'running',
      startedAt: '2026-04-24T00:00:00Z',
      role: 'reviewer',
      roleDelivery: 'preamble',
      roleChannel: 'developer-instructions',
    } as unknown as SpawnAgentResult;

    expect(formatAgentSpawn(result)).toMatch(
      /\*\*Role:\*\* reviewer \(preamble via developer-instructions\)/,
    );
  });

  it('formatAgentSpawn omits the role line on a role-less spawn', () => {
    const result = {
      agentId: 'agent-8',
      cli: 'codex',
      status: 'running',
      startedAt: '2026-04-24T00:00:00Z',
    } as unknown as SpawnAgentResult;

    expect(formatAgentSpawn(result)).not.toMatch(/Role:/);
  });

  it('formatAgentStatus shows the role an agent was spawned as', () => {
    const withRole = {
      agentId: 'agent-2',
      cli: 'codex',
      task: 'review',
      status: 'running',
      startedAt: '2026-04-24T01:02:03Z',
      role: 'architect',
      roleDelivery: 'preamble',
      roleChannel: 'task-prompt',
    } as unknown as AgentProcessInfo;
    const withoutRole = {
      agentId: 'agent-3',
      cli: 'codex',
      task: 'review',
      status: 'running',
      startedAt: '2026-04-24T01:02:03Z',
    } as unknown as AgentProcessInfo;

    expect(formatAgentStatus(withRole)).toMatch(
      /\*\*Role:\*\* architect \(preamble via task-prompt\)/,
    );
    expect(formatAgentStatus(withoutRole)).not.toMatch(/Role:/);
  });
});

// ---------------------------------------------------------------------------
// Git worktree — nested result serialization + error envelope
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › git worktree', () => {
  it('formatWorktreeList renders a table with branch + HEAD columns', () => {
    const out = formatWorktreeList({
      worktrees: [
        {
          path: '/repo',
          branch: 'main',
          head: 'abc1234',
          isMain: true,
          isBare: false,
        },
        {
          path: '/repo-feat',
          branch: 'feature/foo',
          head: 'def5678',
          isMain: false,
          isBare: false,
        },
      ],
    });

    expect(out).toMatch(/\*\*Total:\*\* 2/);
    expect(out).toMatch(/\/repo-feat/);
    expect(out).toMatch(/feature\/foo/);
    expect(out).toMatch(/abc1234/);
    expect(out).toMatch(/def5678/);
  });

  it('formatWorktreeList surfaces git errors as a dedicated error section', () => {
    const out = formatWorktreeList({
      worktrees: [],
      error: 'git is not installed',
    });
    expect(out).toMatch(/\*\*Error:\*\* git is not installed/);
    expect(out).toMatch(/Could not list worktrees/);
  });

  it('formatWorktreeAdd branches on success vs failure envelopes', () => {
    const ok = formatWorktreeAdd({
      success: true,
      worktreePath: '/repo-wt',
    });
    expect(ok).toMatch(/Worktree Created/);
    expect(ok).toMatch(/\/repo-wt/);

    const bad = formatWorktreeAdd({ success: false, error: 'ref exists' });
    expect(bad).toMatch(/Worktree Creation Failed/);
    expect(bad).toMatch(/ref exists/);
  });
});

// ---------------------------------------------------------------------------
// JSON validate — success vs errors envelope
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › json validate', () => {
  it('formatJsonValidate renders success branch with repairs list', () => {
    const out = formatJsonValidate({
      success: true,
      file: 'config.json',
      repairs: ['stripped markdown fences', 'fixed trailing commas'],
      errors: [],
      fileOverwritten: true,
    });
    expect(out).toMatch(/JSON Validation Passed/);
    expect(out).toMatch(/config\.json/);
    expect(out).toMatch(/stripped markdown fences/);
    expect(out).toMatch(/File overwritten/);
  });

  it('formatJsonValidate renders failure branch with errors and recovery hint', () => {
    const out = formatJsonValidate({
      success: false,
      file: 'broken.json',
      repairs: [],
      errors: ['missing comma at line 3', 'unquoted key foo'],
      fileOverwritten: false,
    });
    expect(out).toMatch(/JSON Validation Failed/);
    expect(out).toMatch(/missing comma at line 3/);
    expect(out).toMatch(/unquoted key foo/);
    expect(out).toMatch(/Please fix these issues/);
  });
});

// ---------------------------------------------------------------------------
// Browser formatters — error envelope fidelity
// ---------------------------------------------------------------------------

describe('mcp-response-formatter › browser tools', () => {
  it('formatBrowserNavigate surfaces URL + title on success', () => {
    const result: BrowserNavigateResult = {
      success: true,
      url: 'https://example.com/',
      title: 'Example',
    };
    const out = formatBrowserNavigate(result);
    expect(out).toMatch(/Navigation Complete/);
    expect(out).toMatch(/https:\/\/example\.com/);
    expect(out).toMatch(/Example/);
  });

  it('formatBrowserNavigate emits a "Navigation Failed" block when an error is present', () => {
    const result: BrowserNavigateResult = {
      success: false,
      url: 'https://blocked.invalid/',
      title: '',
      error: 'URL is on security blocklist',
    };
    const out = formatBrowserNavigate(result);
    expect(out).toMatch(/Navigation Failed/);
    expect(out).toMatch(/URL is on security blocklist/);
  });

  it('formatBrowserClick branches on error vs success', () => {
    const ok: BrowserClickResult = { success: true };
    expect(formatBrowserClick(ok)).toMatch(/Click Successful/);

    const bad: BrowserClickResult = {
      success: false,
      error: 'selector not found',
    };
    const out = formatBrowserClick(bad);
    expect(out).toMatch(/Click Failed/);
    expect(out).toMatch(/selector not found/);
  });

  it('formatBrowserContent truncates text longer than 32KB with a marker', () => {
    const longText = 'a'.repeat(40 * 1024);
    const result: BrowserContentResult = {
      html: '<p>short</p>',
      text: longText,
    };
    const out = formatBrowserContent(result);
    expect(out).toMatch(/Page Content/);
    expect(out).toMatch(/\[\.\.\.truncated\]/);
    // HTML is short, shouldn't be truncated.
    expect(out).toMatch(/<p>short<\/p>/);
  });

  it('formatBrowserStatus reports disconnected state cleanly', () => {
    const result: BrowserStatusResult = { connected: false };
    const out = formatBrowserStatus(result);
    expect(out).toMatch(/Browser Status/);
    expect(out).toMatch(/\*\*Connected:\*\* No/);
    expect(out).toMatch(/No active browser session/);
  });

  it('formatBrowserStatus includes optional headless / viewport / recording fields when provided', () => {
    const result: BrowserStatusResult = {
      connected: true,
      url: 'https://x.test/',
      title: 'x',
      uptimeMs: 30000,
      autoCloseInMs: 120000,
      headless: true,
      viewport: { width: 1024, height: 768 },
      recording: false,
    };
    const out = formatBrowserStatus(result);
    expect(out).toMatch(/Headless/);
    expect(out).toMatch(/1024x768/);
    expect(out).toMatch(/Recording.*Inactive/);
  });
});
