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
  // __dirname (compiled) = .../apps/ptah-electron-e2e/src/support
  // workspace root is four levels up.
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
  // Strip ELECTRON_RUN_AS_NODE: when set, electron.exe impersonates Node and
  // `import { app } from 'electron'` returns nothing usable, breaking the launcher.
  delete env.ELECTRON_RUN_AS_NODE;

  // CI runners (GitHub ubuntu-latest) restrict the unprivileged user-namespace
  // sandbox via AppArmor / kernel.unprivileged_userns_clone, which makes
  // Chromium's zygote hang during launch. --no-sandbox bypasses that, and
  // --disable-dev-shm-usage avoids /dev/shm exhaustion in containerized envs.
  const ciArgs = process.env['CI']
    ? ['--no-sandbox', '--disable-dev-shm-usage']
    : [];

  const app = await _electron.launch({
    args: [entry, ...ciArgs, ...(opts.args ?? [])],
    env: env as Record<string, string>,
    timeout: opts.timeout ?? 30_000,
  });

  // Surface main-process stderr so a failed launch / crash leaves a trace
  // in CI logs instead of a bare Playwright timeout.
  app.process().stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[ptah-electron stderr] ${chunk.toString('utf8')}`);
  });

  return app;
}
