/**
 * Diagnostics coverage end to end — TASK_2026_559 Batch 25b.
 *
 * Proves `coverage` survives every boundary between the provider and the
 * text an agent reads:
 *
 *   real `LanguageAwareDiagnosticsProvider` (Batch 25a; its inner TypeScript
 *   provider is a fake, so no compiler runs)
 *   → real `buildDiagnosticsNamespace`
 *   → real `handleMCPRequest` (`ptah_get_diagnostics`, the tool-result budget)
 *   → real `formatDiagnostics`.
 *
 * The workspace is a mixed TypeScript + Python `mkdtemp` directory, removed
 * after each case. The syntax parser is scripted (a line holding `(:` is a
 * syntax error): the real grammars need Jest shims that belong to
 * workspace-intelligence, and they are covered by the provider's own spec.
 * The census walks the real directory.
 */

import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  FileType,
  type DiagnosticsResult,
  type DiagnosticsScope,
  type FileDiagnostics,
  type IDiagnosticsProvider,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import { Result } from '@ptah-extension/shared';
import {
  LanguageAwareDiagnosticsProvider,
  type SyntaxParser,
} from '@ptah-extension/workspace-intelligence';
import {
  handleMCPRequest,
  type ProtocolHandlerDependencies,
} from './protocol-dispatcher';
import { buildDiagnosticsNamespace } from '../namespace-builders/core-namespace.builders';
import type { MCPResponse, PtahAPI } from '../types';

const PY_BROKEN = 'def f(:\n    return 1\n';
const PY_CLEAN = 'def f():\n    return 1\n';
const TS_SOURCE = 'export const value = 1;\n';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-diag-e2e-'));
  createdDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  return root;
}

/** The path spelling the providers report: absolute, forward slashes. */
function abs(root: string, rel: string): string {
  return path.join(root, rel).replace(/\\/g, '/');
}

/** Every file under `dir`, absolute with forward slashes. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full.replace(/\\/g, '/'));
  }
  return found;
}

/** Disk-backed `stat`/`readFile`; the census `findFiles` walks the root. */
function diskFs(): IFileSystemProvider {
  return createMockFileSystemProvider({
    findFiles: async (
      _pattern: string,
      _exclude?: readonly string[],
      _limit?: number,
      cwd?: string,
    ) => (cwd ? walk(cwd) : []),
    stat: async (file: string) => {
      const stat = fs.statSync(file);
      return {
        type: stat.isFile() ? FileType.File : FileType.Directory,
        ctime: stat.ctimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
      };
    },
    readFile: async (file: string) => fs.readFileSync(file, 'utf-8'),
  });
}

/** A parser that reports one syntax error on every line holding `(:`. */
function scriptedParser(): SyntaxParser {
  return {
    initialize: async () => Result.ok(undefined),
    queryMulti: async (content: string) => {
      const captures = content.split('\n').flatMap((line, row) =>
        line.includes('(:')
          ? [
              {
                name: 'error',
                node: { type: 'ERROR' },
                text: '',
                startPosition: { row, column: line.indexOf('(:') },
                endPosition: { row, column: line.indexOf('(:') + 2 },
              },
            ]
          : [],
      );
      const map = new Map([
        ['error', captures.length > 0 ? [{ pattern: 0, captures }] : []],
        ['missing', []],
      ]);
      return Result.ok(
        Object.assign(map, {
          parseStatus: captures.length > 0 ? 'recovered' : 'ok',
          errorNodeCount: captures.length,
          errorNodeCountCapped: false,
        }),
      );
    },
  } as unknown as SyntaxParser;
}

/** The inner TypeScript provider: answers `diagnostics` for any call. */
function fakeTypeScript(
  diagnostics: (scope?: DiagnosticsScope) => FileDiagnostics[] = () => [],
): IDiagnosticsProvider {
  return {
    getDiagnostics: async (
      _root?: string,
      scope?: DiagnosticsScope,
    ): Promise<DiagnosticsResult> => ({
      status: 'available',
      source: 'typescript-compiler',
      diagnostics: diagnostics(scope),
    }),
    invalidate: () => undefined,
  };
}

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

/** `ptah_get_diagnostics` through the real provider, namespace and dispatcher. */
async function callTool(
  root: string,
  inner: IDiagnosticsProvider,
  args: { severity?: 'error' | 'warning' | 'all'; files?: string[] },
): Promise<string> {
  const provider = new LanguageAwareDiagnosticsProvider(
    inner,
    diskFs(),
    scriptedParser(),
  );
  const session = {
    getWorkspaceRoot: () => root,
    getWorkspaceFolders: () => [root],
  } as unknown as IWorkspaceProvider;
  const deps: ProtocolHandlerDependencies = {
    ptahAPI: {
      diagnostics: buildDiagnosticsNamespace(provider, session),
    } as unknown as PtahAPI,
    permissionPromptService:
      {} as ProtocolHandlerDependencies['permissionPromptService'],
    logger,
    // Spools of an over-budget answer land inside the temp root.
    workspaceProvider: { getWorkspaceFolders: () => [root] },
  };
  const response: MCPResponse = await handleMCPRequest(
    {
      jsonrpc: '2.0',
      id: 'diag-e2e',
      method: 'tools/call',
      params: { name: 'ptah_get_diagnostics', arguments: args },
    },
    deps,
  );
  const result = response.result as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  expect(result.isError).toBeFalsy();
  return result.content[0].text;
}

const MIXED = {
  'src/app.ts': TS_SOURCE,
  'src/util.ts': TS_SOURCE,
  'py/good.py': PY_CLEAN,
  'py/bad.py': PY_BROKEN,
};

describe('ptah_get_diagnostics coverage, provider to text (TASK_2026_559 Batch 25b)', () => {
  it('empty: a mixed TS/Python workspace with no compiler errors is never a bare No issues found', async () => {
    const root = fixture(MIXED);

    const text = await callTool(root, fakeTypeScript(), {});

    expect(text).not.toMatch(/No issues found/);
    expect(text).toContain('not a clean answer');
    expect(text).toContain('2 files unchecked (pass `files` to check them)');
    expect(text).toContain('"reasons":["unchecked"]');
    expect(text).toContain('- 2 python files — ');
  });

  it('empty: a TypeScript-only workspace with no errors is the one bare No issues found', async () => {
    const root = fixture({ 'src/app.ts': TS_SOURCE });

    const text = await callTool(root, fakeTypeScript(), {});

    expect(text).toContain('Errors: 0 | Warnings: 0 — No issues found.');
    expect(text).toContain('**Coverage:** clean');
  });

  it('non-empty: a scoped mixed request lists compiler and syntax errors and names the syntax-only check', async () => {
    const root = fixture(MIXED);
    const inner = fakeTypeScript((scope) =>
      (scope?.files ?? []).map((file) => ({
        file,
        diagnostics: [
          { message: 'TS2322 type mismatch', line: 1, severity: 'error' },
        ],
      })),
    );

    const text = await callTool(root, inner, {
      files: ['src/app.ts', 'py/bad.py', 'py/good.py'],
    });

    expect(text).not.toMatch(/No issues found/);
    expect(text).toContain('TS2322 type mismatch');
    expect(text).toContain('Syntax error (python; syntax-only check');
    expect(text).toContain(
      'mixed check: python syntax-only (syntax errors only, not type-checked), the rest type-checked',
    );
    expect(text).toContain('**Errors:** 2');
  });

  it('a scoped Python-only request that parses clean says syntax-only, not No issues found', async () => {
    const root = fixture(MIXED);

    const text = await callTool(root, fakeTypeScript(), {
      files: ['py/good.py'],
    });

    expect(text).not.toMatch(/No issues found/);
    expect(text).toContain(
      'syntax-only check (python): syntax errors only, not type-checked',
    );
  });

  it('getErrors: the severity filter drops warnings and keeps the coverage', async () => {
    const root = fixture({ ...MIXED, 'lib/tool.rb': 'puts 1\n' });
    const inner = fakeTypeScript((scope) =>
      (scope?.files ?? []).map((file) => ({
        file,
        diagnostics: [
          { message: 'only a warning', line: 3, severity: 'warning' },
        ],
      })),
    );

    const text = await callTool(root, inner, {
      severity: 'error',
      files: ['src/app.ts', 'lib/tool.rb'],
    });

    expect(text).not.toContain('only a warning');
    expect(text).not.toMatch(/No issues found/);
    expect(text).toContain(
      '1 file unsupported (no diagnostics for ruby 1 on this host)',
    );
    expect(text).toContain(`\`${abs(root, 'lib/tool.rb')}\``);
  });

  it('a long result is cut by the budget and still carries its coverage verdict and requested files first', async () => {
    const root = fixture(MIXED);
    const sibling = abs(root, 'src/aaa-sibling.ts');
    const inner = fakeTypeScript((scope) => [
      {
        file: sibling,
        diagnostics: Array.from({ length: 400 }, (_, i) => ({
          message: `sibling-${i} ${'x'.repeat(300)}`,
          line: i + 1,
          severity: 'error' as const,
        })),
      },
      ...(scope?.files ?? []).map((file) => ({
        file,
        diagnostics: [
          { message: 'REQUESTED-TS', line: 1, severity: 'error' as const },
        ],
      })),
    ]);

    const text = await callTool(root, inner, {
      files: ['src/util.ts', 'py/bad.py'],
    });

    expect(text).toMatch(/\[reduced: [^\]]*— showing \d+ of \d+ tokens —/);
    expect(text).toContain('**Coverage:** qualified — mixed check: python');
    expect(text).toContain('REQUESTED-TS');
    expect(text).toContain('Syntax error (python');
    expect(text.indexOf('**Coverage:**')).toBeLessThan(
      text.indexOf('REQUESTED-TS'),
    );
    expect(text.indexOf('REQUESTED-TS')).toBeLessThan(
      text.indexOf('sibling-0 '),
    );
  });

  // Review r1 M2: a long unavailable reason used to come first and the cut
  // removed every coverage line while "Unavailable" stayed.
  it('an unavailable answer with a very long reason keeps its coverage through the budget cut', async () => {
    const root = fixture(MIXED);
    const inner: IDiagnosticsProvider = {
      getDiagnostics: async (): Promise<DiagnosticsResult> => ({
        status: 'unavailable',
        source: 'typescript-compiler',
        reason: `tsconfig failed to load: ${'detail '.repeat(3_000)}`,
      }),
    };

    const text = await callTool(root, inner, {});

    expect(text).toMatch(/\[reduced: [^\]]*— showing \d+ of \d+ tokens —/);
    expect(text).toContain('Unavailable (reason below).');
    expect(text).toContain('**Coverage:** qualified — 4 files unchecked');
    expect(text).toContain('### Not checked');
    expect(text).toContain('- 2 python files — ');
    expect(text.indexOf('**Coverage:**')).toBeLessThan(
      text.indexOf('**Reason:**'),
    );
  });

  it('keeps the Batch 1 requested-file order: requested entries ahead of 60 earlier-sorting siblings', async () => {
    const root = fixture({ ...MIXED, 'src/zzz.ts': TS_SOURCE });
    const inner = fakeTypeScript((scope) => [
      {
        file: abs(root, 'src/aaa.ts'),
        diagnostics: Array.from({ length: 60 }, (_, i) => ({
          message: `sib-${i}`,
          line: i + 1,
          severity: 'error' as const,
        })),
      },
      ...(scope?.files ?? []).map((file) => ({
        file,
        diagnostics: [
          { message: 'TARGET-TS', line: 1, severity: 'error' as const },
        ],
      })),
    ]);

    const text = await callTool(root, inner, {
      files: ['src/zzz.ts', 'py/bad.py'],
    });

    const requested = text.indexOf('### Requested files');
    expect(requested).toBeGreaterThan(text.indexOf('**Coverage:**'));
    expect(text.indexOf('TARGET-TS')).toBeGreaterThan(requested);
    expect(text.indexOf('Syntax error (python')).toBeGreaterThan(requested);
    expect(text.indexOf('TARGET-TS')).toBeLessThan(text.indexOf('sib-0'));
    expect(text).toContain(
      'Shown 50 of 62 (2 in requested files, 12 in sibling files omitted)',
    );
  });
});
