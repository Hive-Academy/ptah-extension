/**
 * The type-check worker's program text, carried as a string.
 *
 * **Why a string and not a `.ts` file.** This worker is started with
 * `new Worker(source, { eval: true })`, so there is nothing to resolve on disk
 * and nothing to bundle. The alternative — a real entry file — would need a new
 * esbuild target in EVERY host that binds `ptah_get_diagnostics`
 * (`apps/ptah-electron`, `apps/ptah-cli`) plus a host-implemented factory port
 * to hand the lib the emitted path, which is exactly the shape
 * `IEmbedderWorkerProcessFactory` has in `memory-curator`. That price is worth
 * paying for the embedder, which loads a native ONNX runtime and must survive
 * `abort()`; it is not worth paying for a pure-JS compiler pass whose only
 * requirement is "not on the host thread". An eval worker needs no build
 * target, no packaging asset, no factory port and no host wiring, and it
 * behaves identically under Jest (CJS), the Electron ESM bundle and the CLI
 * ESM bundle.
 *
 * **The trade this makes.** The body below is not type-checked or linted. It is
 * covered instead by `type-script-diagnostics-provider.spec.ts`, which drives
 * every case through this worker against real on-disk fixtures and the real
 * compiler — so a typo here fails the suite rather than shipping.
 *
 * **Constraints on edits.** The literal is a `String.raw` template so `\\` and
 * `\n` survive into the emitted program unchanged. Therefore the program text
 * must contain no backticks and no `${` sequence, or it stops being a string
 * and starts being an interpolation. Use `'a' + b` concatenation, never a
 * template literal.
 *
 * `typescript` is loaded from an absolute path supplied as `workerData`, because
 * the worker's own module resolution starts at the host's cwd, which has nothing
 * to do with the workspace being checked.
 *
 * Protocol (see `ts-diagnostics-worker.ts` for the typed mirror):
 *   request:  { id, configPaths: string[], normRoot: string }
 *   response: { id, ok: true, collected: CollectedDiagnostic[],
 *               errors: string[], programCount: number }
 *           | { id, ok: false, error: string }
 */
export const TS_DIAGNOSTICS_WORKER_SOURCE = String.raw`
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const nodePath = require('node:path');
const nodeFs = require('node:fs');

const ts = require(workerData.tsModulePath);

function categoryToSeverity(category) {
  if (category === ts.DiagnosticCategory.Error) return 'error';
  if (category === ts.DiagnosticCategory.Warning) return 'warning';
  if (category === ts.DiagnosticCategory.Suggestion) return 'info';
  return 'hint';
}

function isWithinRoot(normRoot, normFile) {
  const rel = nodePath.relative(normRoot, normFile);
  return !rel.startsWith('..') && !nodePath.isAbsolute(rel);
}

function flattenDiagnostic(diag, normRoot, out) {
  let current = diag;
  while (current) {
    if (current.file && current.start !== undefined) {
      const filePath = current.file.fileName.replace(/\\/g, '/');
      if (isWithinRoot(normRoot, filePath)) {
        const pos = current.file.getLineAndCharacterOfPosition(current.start);
        out.push({
          file: filePath,
          line: pos.line,
          severity: categoryToSeverity(current.category),
          code: current.code,
          message: ts.flattenDiagnosticMessageText(current.messageText, '\n'),
        });
      }
    }
    current = current.next;
  }
}

function run(request) {
  const configPaths = request.configPaths || [];
  const normRoot = request.normRoot;

  const visitedConfigs = new Set();
  const visitedPrograms = new Set();
  const collected = [];
  const errors = [];

  function collectFromConfig(configPath) {
    const normConfig = configPath.replace(/\\/g, '/');
    if (visitedConfigs.has(normConfig)) return;
    visitedConfigs.add(normConfig);

    const configFile = ts.readConfigFile(configPath, function (p) {
      try {
        return nodeFs.readFileSync(p, 'utf-8');
      } catch (readError) {
        return undefined;
      }
    });

    if (configFile.error) {
      errors.push(
        'Malformed ' +
          nodePath.basename(configPath) +
          ': ' +
          configFile.error.messageText
      );
      return;
    }

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      nodePath.dirname(configPath),
      undefined,
      configPath
    );

    const rootFileNames = parsed.fileNames.filter(function (f) {
      return isWithinRoot(normRoot, nodePath.resolve(f).replace(/\\/g, '/'));
    });

    if (rootFileNames.length > 0) {
      visitedPrograms.add(normConfig);

      const program = ts.createProgram({
        rootNames: rootFileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
      });

      const diags = ts.getPreEmitDiagnostics(program);
      for (const diag of diags) {
        flattenDiagnostic(diag, normRoot, collected);
      }
    }

    const refs = parsed.projectReferences || [];
    for (const ref of refs) {
      const resolvedRefConfig = ts.resolveProjectReferencePath(ref);
      if (resolvedRefConfig) {
        collectFromConfig(resolvedRefConfig);
      }
    }
  }

  for (const configPath of configPaths) {
    try {
      collectFromConfig(configPath);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(
        'Failed to process ' + nodePath.basename(configPath) + ': ' + msg
      );
    }
  }

  return {
    collected: collected,
    errors: errors,
    programCount: visitedPrograms.size,
  };
}

parentPort.on('message', function (message) {
  try {
    const outcome = run(message);
    parentPort.postMessage({
      id: message.id,
      ok: true,
      collected: outcome.collected,
      errors: outcome.errors,
      programCount: outcome.programCount,
    });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
`;
