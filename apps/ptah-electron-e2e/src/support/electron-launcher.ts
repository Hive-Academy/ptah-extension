import * as fs from 'fs';
import * as path from 'path';
import { _electron, type ElectronApplication } from '@playwright/test';

export interface LaunchOptions {
  /** Extra environment variables to merge into the Electron process env. */
  env?: Record<string, string>;
  /** Extra args appended after the entry point. */
  args?: string[];
  /** Override launch timeout in ms (default 30_000). */
  timeout?: number;
}

/**
 * Resolves the absolute path to the Electron main entry. The Nx build-dev
 * target writes `main.mjs` directly to `dist/apps/ptah-electron`.
 */
export function resolveElectronEntry(): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'dist',
    'apps',
    'ptah-electron',
    'main.mjs',
  );
}

/**
 * Launch the built Ptah Electron app and return the ElectronApplication
 * handle. The caller is responsible for closing it (the `electronApp`
 * fixture does this automatically).
 */
export async function launchPtah(
  opts: LaunchOptions = {},
): Promise<ElectronApplication> {
  const entry = resolveElectronEntry();

  if (!fs.existsSync(entry)) {
    throw new Error(
      `[ptah-electron-e2e] Electron entry not found at:\n  ${entry}\n\n` +
        `Run \`npx nx build-dev ptah-electron\` first (the 'e2e' Nx target\n` +
        `chains this via dependsOn).`,
    );
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: 'test',
    PTAH_E2E: '1',
    ...(opts.env ?? {}),
  };
  delete env['ELECTRON_RUN_AS_NODE'];
  const ciArgs = process.env['CI']
    ? ['--no-sandbox', '--disable-dev-shm-usage']
    : [];

  const app = await _electron.launch({
    args: [entry, ...ciArgs, ...(opts.args ?? [])],
    env: env as Record<string, string>,
    timeout: opts.timeout ?? 30_000,
  });
  app.process().stdout?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ptah-electron stdout] ${chunk.toString('utf8')}`);
  });
  app.process().stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ptah-electron stderr] ${chunk.toString('utf8')}`);
  });

  return app;
}
