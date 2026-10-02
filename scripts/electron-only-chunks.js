/**
 * Electron-only chunk list for the webview build (TASK_2026_576, R12).
 *
 * Reads `dist/apps/ptah-extension-webview/stats.json` (esbuild metafile written
 * by the production build, `statsJson: true`) and writes
 * `dist/apps/ptah-extension-webview/electron-only-chunks.json`.
 *
 * A JS output is Electron-only ONLY when it has at least one input and EVERY
 * input is Electron-only code:
 *   - `libs/frontend/git-ui/src/lib/<dir>/**` for every git-ui surface dir that
 *     only the Electron shell mounts (everything except `services`, `types` and
 *     `renderer`: services are eager on both hosts, `renderer` is the Pierre
 *     diff host the VS Code skills drawer uses via
 *     `@ptah-extension/git-ui/diff-renderer`), or
 *   - the CodeMirror dependency closure under `node_modules`.
 * A chunk mixing in any other input (Pierre, shared libs, services) is kept, as
 * is a chunk with no inputs (nothing proves it Electron-only).
 *
 * `scripts/copy-webview.js` (VSIX) skips the listed files; the Electron
 * renderer copy (`apps/ptah-electron/scripts/copy-renderer.js`) keeps all.
 *
 * Usage: node scripts/electron-only-chunks.js [--dist <dir>]
 */
const fs = require('fs');
const path = require('path');

const GIT_UI_LIB = 'libs/frontend/git-ui/src/lib/';
// git-ui dirs that stay in the VSIX: eager services/types and the Pierre host.
const GIT_UI_SHARED_DIRS = new Set(['services', 'types', 'renderer']);
// CodeMirror and its closure; none of these is imported by Pierre or by shared code.
const CODEMIRROR_PACKAGES = [
  '@codemirror/',
  '@lezer/',
  '@marijn/find-cluster-break/',
  'style-mod/',
  'w3c-keyname/',
  'crelt/',
];

function normalize(input) {
  return input.replaceAll('\\', '/').replace(/^(\.\.\/)+/, '');
}

function isElectronOnlyInput(rawInput) {
  const input = normalize(rawInput);
  if (input.startsWith(GIT_UI_LIB)) {
    const dir = input.slice(GIT_UI_LIB.length).split('/')[0];
    return !GIT_UI_SHARED_DIRS.has(dir);
  }
  if (input.startsWith('node_modules/')) {
    const pkg = input.slice('node_modules/'.length);
    return CODEMIRROR_PACKAGES.some((p) => pkg.startsWith(p));
  }
  return false;
}

function classify(stats) {
  const outputs = stats.outputs ?? {};
  const jsFiles = Object.keys(outputs).filter(
    (f) => f.endsWith('.js') && f !== 'main.js',
  );
  const inputsOf = (f) => Object.keys(outputs[f].inputs ?? {});

  // importers[file] = every output (any kind of import) that references it.
  const importers = new Map();
  for (const [file, output] of Object.entries(outputs)) {
    for (const imp of output.imports ?? []) {
      if (!importers.has(imp.path)) importers.set(imp.path, []);
      importers.get(imp.path).push({ file, kind: imp.kind });
    }
  }

  // Optimistic start: every chunk whose inputs are all Electron-only, plus
  // every input-less shim chunk (esbuild re-export glue). Then only ever
  // remove (greatest fixpoint):
  //  - a kept chunk must never statically import a dropped one (dynamic
  //    imports are fine: only Electron-only code paths reach them);
  //  - an input-less shim stays only when it is imported and every importer
  //    is itself dropped.
  const dropped = new Set(
    jsFiles.filter((f) => {
      const inputs = inputsOf(f);
      return inputs.length === 0 || inputs.every(isElectronOnlyInput);
    }),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of [...dropped]) {
      const who = importers.get(f) ?? [];
      const shim = inputsOf(f).length === 0;
      const keptStaticImporter = who.some(
        (i) => i.kind === 'import-statement' && !dropped.has(i.file),
      );
      const orphanOrKeptImporter =
        shim && (who.length === 0 || who.some((i) => !dropped.has(i.file)));
      if (keptStaticImporter || orphanOrKeptImporter) {
        dropped.delete(f);
        changed = true;
      }
    }
  }

  const electronOnly = [...dropped].sort();
  const kept = jsFiles.filter((f) => !dropped.has(f)).sort();
  const keptPierre = kept
    .filter((f) =>
      inputsOf(f).some((i) => normalize(i).startsWith('node_modules/@pierre/')),
    )
    .sort();
  return { electronOnly, kept, keptPierre };
}

/** Generate the list from `<distDir>/stats.json`; returns the summary. */
function generate(distDir) {
  const statsPath = path.join(distDir, 'stats.json');
  if (!fs.existsSync(statsPath)) {
    throw new Error(
      `[electron-only-chunks] ${statsPath} not found. Run the production webview build first.`,
    );
  }
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  const result = classify(stats);
  const outPath = path.join(distDir, 'electron-only-chunks.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(result.electronOnly, null, 2) + '\n',
  );
  return { ...result, outPath };
}

module.exports = { generate, classify, isElectronOnlyInput };

if (require.main === module) {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--dist');
  const dist = path.resolve(
    idx >= 0 && args[idx + 1]
      ? args[idx + 1]
      : 'dist/apps/ptah-extension-webview',
  );
  const r = generate(dist);
  console.log(
    `[electron-only-chunks] JS chunks: ${r.electronOnly.length + r.kept.length} (excluding main.js), ` +
      `Electron-only: ${r.electronOnly.length}, kept: ${r.kept.length}, ` +
      `Pierre kept: ${r.keptPierre.length} -> ${r.outPath}`,
  );
}
