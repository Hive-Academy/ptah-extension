/**
 * TypeScriptDiagnosticsProvider — shared IDiagnosticsProvider for Electron/CLI.
 *
 * Uses the TypeScript compiler API in-process (no `tsc` subprocess, no shell)
 * to collect config, syntactic, options, global, and semantic diagnostics
 * from workspace `tsconfig*.json` files. Returns an honest
 * available/unavailable contract:
 *
 * - `unavailable` for no root, no tsconfig, malformed config, or missing compiler.
 * - `available` with zero diagnostics for a clean project.
 * - `available` with diagnostics for a project with errors.
 * - Throws only for genuine execution failures (e.g. filesystem read error).
 *
 * No caching — re-reads per call for workspace-switch correctness.
 */

import * as path from 'path';
import type * as ts from 'typescript';
import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
  FileDiagnostics,
  DiagnosticEntry,
  DiagnosticSeverity,
} from '@ptah-extension/platform-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { DEFAULT_WORKSPACE_EXCLUDES } from '../file-indexing/workspace-default-excludes';

const SOURCE = 'typescript-compiler';

/** Lazy-load the typescript module; return undefined if not installed. */
function loadTypescript(): typeof ts | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('typescript');
  } catch {
    return undefined;
  }
}

interface CollectedDiagnostic {
  file: string;
  line: number;
  severity: DiagnosticSeverity;
  code: number;
  message: string;
}

export class TypeScriptDiagnosticsProvider implements IDiagnosticsProvider {
  constructor(private readonly fs: IFileSystemProvider) {}

  async getDiagnostics(workspaceRoot?: string): Promise<DiagnosticsResult> {
    if (!workspaceRoot) {
      return {
        status: 'unavailable',
        source: SOURCE,
        reason: 'No workspace root resolved.',
      };
    }

    const ts = loadTypescript();
    if (!ts) {
      return {
        status: 'unavailable',
        source: SOURCE,
        reason: 'TypeScript compiler not available.',
      };
    }

    // Discover tsconfig*.json files under the root, excluding generated/vendor trees.
    const configPaths: string[] = await this.fs.findFiles(
      '**/tsconfig*.json',
      [...DEFAULT_WORKSPACE_EXCLUDES],
      200,
      workspaceRoot,
    );

    if (configPaths.length === 0) {
      return {
        status: 'unavailable',
        source: SOURCE,
        reason: 'No tsconfig.json found under workspace root.',
      };
    }

    const normRoot = path.resolve(workspaceRoot).replace(/\\/g, '/');

    const visitedConfigs = new Set<string>();
    const visitedPrograms = new Set<string>();
    const allDiagnostics: CollectedDiagnostic[] = [];
    const errors: string[] = [];

    const collectFromConfig = (configPath: string): void => {
      const normConfig = configPath.replace(/\\/g, '/');
      if (visitedConfigs.has(normConfig)) return;
      visitedConfigs.add(normConfig);

      const configFile = ts.readConfigFile(configPath, (p: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require('fs').readFileSync(p, 'utf-8');
        } catch {
          return undefined;
        }
      });

      if (configFile.error) {
        errors.push(
          `Malformed ${path.basename(configPath)}: ${configFile.error.messageText}`,
        );
        return;
      }

      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath),
        undefined,
        configPath,
      );

      // Filter file names to those within the requested root.
      const rootFileNames = parsed.fileNames.filter((f) => {
        const normFile = path.resolve(f).replace(/\\/g, '/');
        const rel = path.relative(normRoot, normFile);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      });

      if (rootFileNames.length === 0) return;

      const programKey = normConfig;
      if (visitedPrograms.has(programKey)) return;
      visitedPrograms.add(programKey);

      const program = ts.createProgram({
        rootNames: rootFileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
      });

      const diags = ts.getPreEmitDiagnostics(program);

      for (const diag of diags) {
        this.flattenDiagnostic(diag, ts, normRoot, allDiagnostics);
      }

      // Traverse project references once.
      const refs = program.getProjectReferences();
      if (refs) {
        for (const ref of refs) {
          if (ref && typeof ref === 'object' && 'path' in ref) {
            collectFromConfig(ref.path);
          }
        }
      }
    };

    for (const configPath of configPaths) {
      try {
        collectFromConfig(configPath);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to process ${path.basename(configPath)}: ${msg}`);
      }
    }

    if (visitedPrograms.size === 0 && errors.length > 0) {
      return {
        status: 'unavailable',
        source: SOURCE,
        reason: errors.join('; '),
      };
    }

    // Deduplicate by file:startLine:code:message.
    const seen = new Set<string>();
    const uniqueDiags = allDiagnostics.filter((d) => {
      const key = `${d.file}:${d.line}:${d.code}:${d.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Group by file.
    const byFile = new Map<string, DiagnosticEntry[]>();
    for (const d of uniqueDiags) {
      const entry: DiagnosticEntry = {
        message: d.message,
        line: d.line,
        severity: d.severity,
        code: d.code,
      };
      const existing = byFile.get(d.file);
      if (existing) {
        existing.push(entry);
      } else {
        byFile.set(d.file, [entry]);
      }
    }

    const diagnostics: FileDiagnostics[] = [];
    for (const [file, entries] of byFile) {
      diagnostics.push({ file, diagnostics: entries });
    }

    return {
      status: 'available',
      source: SOURCE,
      diagnostics,
    };
  }

  private flattenDiagnostic(
    diag: ts.Diagnostic,
    ts: typeof import('typescript'),
    normRoot: string,
    out: CollectedDiagnostic[],
  ): void {
    // Walk message chains — `next` exists on DiagnosticWithLocation at runtime.
    let current: ts.Diagnostic | undefined = diag;
    while (current) {
      if (current.file && current.start !== undefined) {
        const filePath = current.file.fileName.replace(/\\/g, '/');
        const rel = path.relative(normRoot, filePath);
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
          const { line } = current.file.getLineAndCharacterOfPosition(
            current.start,
          );
          out.push({
            file: filePath,
            line,
            severity: this.categoryToSeverity(current.category, ts),
            code: current.code,
            message: ts.flattenDiagnosticMessageText(current.messageText, '\n'),
          });
        }
      }
      // Access `next` via a cast since the base Diagnostic type may not expose it.
      current = (current as ts.Diagnostic & { next?: ts.Diagnostic }).next;
    }
  }

  private categoryToSeverity(
    category: ts.DiagnosticCategory,
    ts: typeof import('typescript'),
  ): DiagnosticSeverity {
    switch (category) {
      case ts.DiagnosticCategory.Error:
        return 'error';
      case ts.DiagnosticCategory.Warning:
        return 'warning';
      case ts.DiagnosticCategory.Suggestion:
        return 'info';
      case ts.DiagnosticCategory.Message:
        return 'hint';
      default:
        return 'hint';
    }
  }
}
