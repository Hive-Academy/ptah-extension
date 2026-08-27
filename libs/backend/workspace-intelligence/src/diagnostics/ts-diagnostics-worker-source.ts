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
 *               errors: ConfigFailure[], programCount: number }
 *           | { id, ok: false, error: string }
 *
 * `errors` carries STRUCTURED per-config failures — `{ config, message, code? }`
 * — not prose (TASK_2026_325 finding 1). A run where one config is malformed
 * and another compiles used to drop the failure on the floor, because the host
 * only read `errors` when `programCount === 0`. The host now renders every
 * failure as an error diagnostic bound to the tsconfig that failed, which needs
 * the config's PATH, not a `basename(...)` already baked into a sentence.
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

    // Guard each config on its OWN frame. Guarding the top-level loop instead
    // attributed a throw three project references deep to the discovered entry
    // point, which sent the caller to a file that was fine.
    try {
      checkConfig(normConfig);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push({
        config: normConfig,
        message: 'This project was not type-checked: ' + msg,
      });
    }
  }

  function checkConfig(normConfig) {
    // Hand TypeScript the FORWARD-SLASHED path, never the OS-native one.
    // ts.readConfigFile normalizes the name internally and then asserts the
    // parsed source file's name still matches what it was given, so on Windows
    // a backslashed path throws
    //   Debug Failure. Expected C:/x/tsconfig.json === C:\x\tsconfig.json
    // the moment the config is malformed enough to need an error node. A valid
    // config never reaches that assert, which is why this only ever showed up
    // on the broken-config path -- as a thrown exception standing in for the
    // 'Malformed tsconfig' diagnostic the caller was supposed to get.
    const configFile = ts.readConfigFile(normConfig, function (p) {
      try {
        return nodeFs.readFileSync(p, 'utf-8');
      } catch (readError) {
        return undefined;
      }
    });

    if (configFile.error) {
      errors.push({
        config: normConfig,
        code: configFile.error.code,
        message:
          'Malformed tsconfig, so this project was not type-checked: ' +
          ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'),
      });
      return;
    }

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      nodePath.dirname(normConfig),
      undefined,
      normConfig
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
    collectFromConfig(configPath);
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
