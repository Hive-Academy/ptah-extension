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
 *   request:  { id, configPaths: string[], normRoot: string,
 *               platform: NodeJS.Platform }
 *   response: { id, ok: true, collected: CollectedDiagnostic[],
 *               errors: ConfigFailure[], programCount: number }
 *           | { id, ok: false, error: string }
 *
 * **Root containment is checked in TWO places, doing two different jobs**
 * (TASK_2026_303 finding 1). Neither is redundant and neither replaces the
 * other:
 *
 *   1. HERE, as a TRANSPORT BOUND. `ts.getPreEmitDiagnostics(program)` takes no
 *      file argument — it walks all of `program.getSourceFiles()`, which is the
 *      full transitive closure reachable from the entry points through imports
 *      and resolved project references. `rootFileNames` bounds the ENTRY
 *      POINTS, not what gets diagnosed. So opening `apps/ptah-electron` as the
 *      root, whose tsconfig reaches `libs/backend/*` through references and
 *      `paths`, diagnoses every one of those libs. Without a filter here, all
 *      of that crosses `parentPort.postMessage` uncapped — and the
 *      DESERIALIZATION runs on the main thread, which is the exact loop
 *      TASK_2026_323 moved this work off. Filtering before the boundary keeps
 *      the payload proportional to the root instead of to the reference graph.
 *   2. On the HOST, as the AUTHORITATIVE decision, through `platform-core`'s
 *      `isPathWithinRoots` — the shared, tested predicate that also guards the
 *      terminal spawn path and the VS Code diagnostics adapter.
 *
 * A third check, on `parsed.fileNames`, decides which files are worth COMPILING.
 * It cannot move to the host, which never sees a `fileNames` list.
 *
 * An eval'd worker has no module resolution, so it CANNOT import
 * `isPathWithinRoots`; the twin below is the price. A worker-side filter that
 * drops too much is UNRECOVERABLE — it runs before `postMessage`, so the host
 * can never ask for what it discarded — which makes an unchecked hand-kept twin
 * the most dangerous shape this file could take. So it is not left as a promise:
 * `ts-diagnostics-worker-containment.spec.ts` evals `WORKER_CONTAINMENT_SOURCE`
 * and asserts row-by-row that it agrees with the real helper. `platform` is on
 * the request so both sides fold case identically and a spec can drive the win32
 * rule from a Linux CI runner.
 *
 * `errors` carries STRUCTURED per-config failures — `{ config, message, code? }`
 * — not prose (TASK_2026_325 finding 1). A run where one config is malformed
 * and another compiles used to drop the failure on the floor, because the host
 * only read `errors` when `programCount === 0`. The host now renders every
 * failure as an error diagnostic bound to the tsconfig that failed, which needs
 * the config's PATH, not a `basename(...)` already baked into a sentence.
 */
/**
 * The worker's root-containment predicate, as source text.
 *
 * A structural twin of `normalize()` + `isContainedIn()` in `platform-core`'s
 * `utils/path-containment.ts` — resolve, forward-slash, win32-only case fold,
 * strip trailing slashes, then compare with a separator boundary so `/foo/bar`
 * cannot match the sibling `/foo/barbaz`. Both operands go through the SAME
 * normalization, which is what the helper does and what the old
 * `nodePath.relative(root, file).startsWith('..')` form did not.
 *
 * Split out of {@link TS_DIAGNOSTICS_WORKER_SOURCE} for exactly one reason: so
 * `ts-diagnostics-worker-containment.spec.ts` can eval THIS EXACT TEXT and
 * prove, row by row, that it still agrees with `isPathWithinRoots`. It is not a
 * module and must never become one — the worker is started with `eval: true`
 * and has no module resolution, so an `import` here would not survive the trip.
 *
 * Free variable: `nodePath`. The worker prelude below binds it via
 * `require('node:path')`; the spec injects it as a `new Function` parameter.
 */
export const WORKER_CONTAINMENT_SOURCE = String.raw`
function normalizeForContainment(p, platform) {
  const resolved = nodePath.resolve(p.replace(/\\/g, '/')).replace(/\\/g, '/');
  const cased = platform === 'win32' ? resolved.toLowerCase() : resolved;
  return cased.replace(/\/+$/, '');
}

function isWithinRoot(normRoot, normFile, platform) {
  const target = normalizeForContainment(normFile, platform);
  const root = normalizeForContainment(normRoot, platform);
  return target === root || target.startsWith(root + '/');
}
`;

export const TS_DIAGNOSTICS_WORKER_SOURCE =
  String.raw`
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
` +
  WORKER_CONTAINMENT_SOURCE +
  String.raw`
// Convert one ts.Diagnostic to the wire shape, when it carries a file position
// and falls inside the root.
//
// The containment call here is a TRANSPORT BOUND, not the authoritative answer
// -- see the header. getPreEmitDiagnostics walks the whole program, so on this
// monorepo an entry point in one app pulls in diagnostics for every lib its
// references reach; those must not cross postMessage to be dropped on the main
// thread afterwards. The host re-decides with the real isPathWithinRoots.
//
// The message chain IS flattened -- by ts.flattenDiagnosticMessageText, which
// walks the DiagnosticMessageChain hanging off messageText and joins it with
// newlines. That chain is the only '.next' chain in play. This used to be a
// 'while (current) { ...; current = current.next; }' loop over the DIAGNOSTIC,
// which named a mechanism that cannot run: ts.Diagnostic has no .next field, so
// the cast always yielded undefined and the body ran exactly once
// (TASK_2026_303 finding 2). Output was already correct; the loop only made a
// reader trust a walk that never happened.
function collectDiagnostic(diag, normRoot, platform, out) {
  if (!diag.file || diag.start === undefined) return;
  const filePath = diag.file.fileName.replace(/\\/g, '/');
  if (!isWithinRoot(normRoot, filePath, platform)) return;
  const pos = diag.file.getLineAndCharacterOfPosition(diag.start);
  out.push({
    file: filePath,
    line: pos.line,
    severity: categoryToSeverity(diag.category),
    code: diag.code,
    message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
  });
}

function run(request) {
  const configPaths = request.configPaths || [];
  const normRoot = request.normRoot;
  const platform = request.platform;

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
      return isWithinRoot(
        normRoot,
        nodePath.resolve(f).replace(/\\/g, '/'),
        platform
      );
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
        collectDiagnostic(diag, normRoot, platform, collected);
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
