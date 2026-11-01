#!/usr/bin/env node
/**
 * Offline CLI wrapper for `sanitizeScenario` (`apps/ptah-electron/src/replay/scenario-sanitizer.ts`).
 *
 * Usage:
 *   node apps/ptah-electron/scripts/sanitize-replay-scenario.mjs \
 *     --in raw.json \
 *     --out scenario.json \
 *     --id <id> \
 *     [--title "Short title"] \
 *     [--allow-file src/main.ts ...] \
 *     [--strict]
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const result = {
    inPath: '',
    outPath: '',
    id: undefined,
    title: undefined,
    allowFiles: [],
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--in' && i + 1 < argv.length) {
      result.inPath = argv[++i];
    } else if (arg === '--out' && i + 1 < argv.length) {
      result.outPath = argv[++i];
    } else if (arg === '--id' && i + 1 < argv.length) {
      result.id = argv[++i];
    } else if (arg === '--title' && i + 1 < argv.length) {
      result.title = argv[++i];
    } else if (arg === '--allow-file' && i + 1 < argv.length) {
      result.allowFiles.push(argv[++i]);
    } else if (arg === '--strict') {
      result.strict = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return result;
}

function loadSanitizerModule() {
  const createJiti = require('jiti');
  const jiti = createJiti(__filename, { interopDefault: true });
  const sanitizerPath = path.resolve(
    __dirname,
    '../src/replay/scenario-sanitizer.ts',
  );
  return jiti(sanitizerPath);
}

function atomicWriteJson(targetPath, content) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  writeFileSync(tmpPath, content, 'utf8');
  renameSync(tmpPath, targetPath);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      'Usage: node apps/ptah-electron/scripts/sanitize-replay-scenario.mjs --in <raw.json> --out <scenario.json> --id <id> [--title <title>] [--allow-file <path> ...] [--strict]',
    );
    process.exit(0);
  }

  if (!parsed.inPath || !parsed.outPath || !parsed.id) {
    console.error(
      'Error: --in <path>, --out <path>, and --id <id> are required.',
    );
    process.exit(1);
  }

  const resolvedIn = path.resolve(parsed.inPath);
  const resolvedOut = path.resolve(parsed.outPath);
  if (resolvedIn === resolvedOut) {
    console.error(
      'Error: --in and --out must not resolve to the same file path.',
    );
    process.exit(1);
  }

  const { sanitizeScenario } = loadSanitizerModule();
  let rawJson;
  try {
    rawJson = JSON.parse(readFileSync(resolvedIn, 'utf8'));
  } catch {
    console.error('Error: Failed to read or parse input JSON file.');
    process.exit(1);
  }

  const { scenario, report } = sanitizeScenario(rawJson, {
    id: parsed.id,
    title: parsed.title,
    allowFiles: parsed.allowFiles,
    strict: parsed.strict,
  });

  atomicWriteJson(resolvedOut, `${JSON.stringify(scenario, null, 2)}\n`);

  // Print only sanitized key paths and summary counts (never field values)
  console.log(
    JSON.stringify({
      ok: true,
      out: resolvedOut,
      id: scenario.id,
      report: {
        droppedRpcMethods: report.droppedRpcMethods,
        droppedPushTypes: report.droppedPushTypes,
        redactedFields: report.redactedFields,
        redactedSecretsCount: report.redactedSecretsCount,
        replacedPathsCount: report.replacedPathsCount,
        replacedPiiCount: report.replacedPiiCount,
        redactedPayloadsCount: report.redactedPayloadsCount,
        remappedUuidsCount: report.remappedUuidsCount,
        normalizedTimestampsCount: report.normalizedTimestampsCount,
      },
    }),
  );
}

try {
  main();
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
