#!/usr/bin/env node

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const BASE_CONFIG = path.join(__dirname, '..', 'electron-builder.yml');
const OVERLAY_CONFIG = path.join(
  __dirname,
  '..',
  'electron-builder.local-production.cjs',
);
const FORBIDDEN_HOOKS = [
  'beforeBuild',
  'beforePack',
  'afterPack',
  'afterSign',
  'artifactBuildStarted',
  'artifactBuildCompleted',
  'afterAllArtifactBuild',
];
const SIGNING_ENV =
  /^(CSC_|WIN_CSC_|APPLE_|AZURE_|SIGNING_|SIGNTOOL_|SSL_COM_|ESIGNER_|SM_|CERTIFICATE_)/i;

function validateBaseConfig(configText) {
  if (
    !/^appId:\s*com\.ptah\.desktop\s*$/m.test(configText) ||
    !/^productName:\s*Ptah\s*$/m.test(configText)
  ) {
    throw new Error(
      'Production appId/productName changed; local packaging refused',
    );
  }
  for (const hook of FORBIDDEN_HOOKS) {
    if (new RegExp(String.raw`^\s*${hook}\s*:`, 'm').test(configText)) {
      throw new Error(
        `Production builder hook ${hook} could sign or mutate artifacts`,
      );
    }
  }
}

function sanitizedEnvironment(source, gitSha) {
  const clean = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SIGNING_ENV.test(key) && value !== undefined) clean[key] = value;
  }
  return {
    ...clean,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    PTAH_LOCAL_PRODUCTION_GIT_SHA: gitSha,
  };
}

function readCleanGitSha(run = execFileSync, root = ROOT) {
  const sha = run('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const dirty = run('git', ['status', '--porcelain=v1'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (dirty) {
    throw new Error(
      'Local-production packaging requires a clean checkout so its Git SHA fully identifies the source',
    );
  }
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error('Could not resolve a full Git SHA');
  return sha;
}

function main() {
  validateBaseConfig(fs.readFileSync(BASE_CONFIG, 'utf8'));
  const gitSha = readCleanGitSha();
  const startedAt = Date.now();
  const builderCli = require.resolve('electron-builder/cli.js');
  const result = spawnSync(
    process.execPath,
    [
      builderCli,
      '--config',
      OVERLAY_CONFIG,
      '--project',
      path.join(ROOT, 'dist', 'apps', 'ptah-electron'),
      '--publish',
      'never',
      '--win',
    ],
    {
      cwd: ROOT,
      env: sanitizedEnvironment(process.env, gitSha),
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);

  execFileSync(
    process.execPath,
    [
      path.join(__dirname, 'verify-local-production-unsigned.js'),
      '--since',
      String(startedAt),
      '--sha',
      gitSha,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

module.exports = { readCleanGitSha, sanitizedEnvironment, validateBaseConfig };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      `[local-production] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
