import * as fs from 'fs';
import * as path from 'path';

/**
 * Playwright globalSetup -- verifies the Electron build artifacts exist
 * before any tests run. The `dependsOn` chain in project.json normally
 * runs `nx build-dev ptah-electron` + `nx copy-renderer ptah-electron`
 * automatically, but a stale dist directory can leave artifacts missing.
 * We fail fast with an actionable error if anything is absent.
 */
export default async function globalSetup(): Promise<void> {
  // __dirname when this file is compiled is .../apps/ptah-electron-e2e/src/support
  // The dist root is at workspace_root/dist/apps/ptah-electron, four levels up.
  const distRoot = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'dist',
    'apps',
    'ptah-electron',
  );

  const required = [
    path.join(distRoot, 'main.mjs'),
    path.join(distRoot, 'preload.js'),
    path.join(distRoot, 'renderer', 'index.html'),
  ];

  const missing = required.filter((p) => !fs.existsSync(p));

  if (missing.length > 0) {
    const list = missing.map((p) => `  - ${p}`).join('\n');
    throw new Error(
      `[ptah-electron-e2e] Missing Electron build artifacts:\n${list}\n\n` +
        `Run the build first:\n` +
        `  npx nx build-dev ptah-electron && npx nx copy-renderer ptah-electron\n\n` +
        `(The 'e2e' target normally chains these via dependsOn -- if you\n` +
        `see this error, the build step likely failed. Re-run with verbose\n` +
        `Nx output to inspect.)`,
    );
  }
}
