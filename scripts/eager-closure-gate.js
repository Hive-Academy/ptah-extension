/**
 * Fails when forbidden renderer code enters the webview's initial static
 * import closure, or when that closure grows without an explicit allowance.
 *
 * Usage: node scripts/eager-closure-gate.js <head-stats.json> [--base <base-stats.json>]
 */
const fs = require('fs');
const path = require('path');
const {
  assertEagerClosureKept,
} = require('./electron-only-chunks');

const FORBIDDEN_EAGER_INPUTS = [
  /libs\/frontend\/declarative-dashboard\//,
  /libs\/shared\/src\/mcp-apps-contracts\//,
  /libs\/frontend\/chat-ui\/src\/ptah-ui\.ts$/,
  /libs\/frontend\/chat-ui\/src\/lib\/organisms\/ptah-ui\//,
  /libs\/frontend\/chat-ui\/src\/lib\/molecules\/turn-recap\//,
  /libs\/frontend\/declarative-dashboard\/.*\/charts\//,
];

const ALLOWED_EAGER_GROWTH_INPUTS = [
  /libs\/frontend\/chat\/.*\/execution\/ptah-ui-fence-line\.ts$/,
  /libs\/frontend\/chat-ui\/src\/lib\/services\/ptah-ui-live-window\.ts$/,
  /libs\/frontend\/chat\/.*\/transcript\/transcript-turns\.ts$/,
  /libs\/shared\/src\/lib\/utils\/(?:test-command-matcher|turn-tests\.utils|turn-sources\.utils|usage-format\.utils)\.ts$/,
];

function matchesAny(input, patterns) {
  const normalized = input.replaceAll('\\', '/');
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? normalized.includes(pattern) : pattern.test(normalized),
  );
}

function staticClosure(stats) {
  const outputs = stats.outputs ?? {};
  const seen = new Set();
  const queue = ['main.js'];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !outputs[file]) continue;
    seen.add(file);
    for (const imported of outputs[file].imports ?? []) {
      if (imported.kind === 'import-statement') queue.push(imported.path);
    }
  }
  return seen;
}

function forbiddenOutputs(stats, patterns = FORBIDDEN_EAGER_INPUTS) {
  return Object.entries(stats.outputs ?? {})
    .filter(([, output]) =>
      Object.keys(output.inputs ?? {}).some((input) => matchesAny(input, patterns)),
    )
    .map(([file]) => file)
    .sort();
}

function eagerInputs(stats) {
  const outputs = stats.outputs ?? {};
  const inputs = new Set();
  for (const file of staticClosure(stats)) {
    for (const input of Object.keys(outputs[file].inputs ?? {})) inputs.add(input);
  }
  return inputs;
}

function assertNoForbiddenEager(stats, patterns = FORBIDDEN_EAGER_INPUTS) {
  const outputs = forbiddenOutputs(stats, patterns);
  try {
    assertEagerClosureKept(stats, outputs);
  } catch (error) {
    const forbiddenInputs = [...eagerInputs(stats)]
      .filter((input) => matchesAny(input, patterns))
      .sort();
    throw new Error(
      `[eager-closure-gate] main.js statically reaches forbidden eager input(s): ${forbiddenInputs.join(', ')}`,
      { cause: error },
    );
  }
}

function assertNoUnlistedEagerGrowth(
  head,
  base,
  allowPatterns = ALLOWED_EAGER_GROWTH_INPUTS,
) {
  const baseInputs = eagerInputs(base);
  const unlisted = [...eagerInputs(head)]
    .filter(
      (input) =>
        !baseInputs.has(input) && !matchesAny(input, allowPatterns),
    )
    .sort();
  if (unlisted.length > 0) {
    throw new Error(
      `[eager-closure-gate] unlisted eager input growth: ${unlisted.join(', ')}`,
    );
  }
}

function initialChunkBytes(stats) {
  const outputs = stats.outputs ?? {};
  return [...staticClosure(stats)].reduce(
    (total, file) => total + (outputs[file].bytes ?? 0),
    0,
  );
}

function readStats(statsPath) {
  if (!fs.existsSync(statsPath)) {
    throw new Error(
      `[eager-closure-gate] ${statsPath} not found. Run the production webview build first.`,
    );
  }
  return JSON.parse(fs.readFileSync(statsPath, 'utf8'));
}

function run(args) {
  const [headPath, ...rest] = args;
  const baseIndex = rest.indexOf('--base');
  const basePath = baseIndex >= 0 ? rest[baseIndex + 1] : undefined;
  if (!headPath || (baseIndex >= 0 && !basePath) || (baseIndex < 0 && rest.length > 0)) {
    throw new Error(
      'Usage: node scripts/eager-closure-gate.js <head-stats.json> [--base <base-stats.json>]',
    );
  }

  const head = readStats(path.resolve(headPath));
  assertNoForbiddenEager(head);
  if (basePath) assertNoUnlistedEagerGrowth(head, readStats(path.resolve(basePath)));

  return {
    eagerInputCount: eagerInputs(head).size,
    initialChunkBytes: initialChunkBytes(head),
  };
}

module.exports = {
  FORBIDDEN_EAGER_INPUTS,
  ALLOWED_EAGER_GROWTH_INPUTS,
  forbiddenOutputs,
  assertNoForbiddenEager,
  eagerInputs,
  assertNoUnlistedEagerGrowth,
};

if (require.main === module) {
  try {
    const result = run(process.argv.slice(2));
    console.log(
      `[eager-closure-gate] eager inputs: ${result.eagerInputCount}; initial chunk bytes: ${result.initialChunkBytes}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
