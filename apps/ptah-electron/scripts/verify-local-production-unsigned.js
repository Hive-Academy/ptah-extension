#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const {
  resolveWindowsSystemExecutable,
} = require('./windows-system-executable.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT = path.join(ROOT, 'dist', 'release', 'local-production');

function collectExecutables(root) {
  const results = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...collectExecutables(full));
    else if (entry.name.toLowerCase().endsWith('.exe')) {
      results.push(full);
    }
  }
  return results;
}

function assertUnsignedStatuses(records, expectedPaths) {
  const byPath = new Map(
    records.map((record) => [path.resolve(record.Path), record.Status]),
  );
  for (const executable of expectedPaths) {
    if (byPath.get(path.resolve(executable)) !== 'NotSigned') {
      throw new Error(`Expected unsigned executable: ${executable}`);
    }
  }
}

function main(args = process.argv.slice(2)) {
  if (process.platform !== 'win32')
    throw new Error('Windows signature verification is required');
  const sinceIndex = args.indexOf('--since');
  const shaIndex = args.indexOf('--sha');
  const since = Number(args[sinceIndex + 1]);
  const sha = args[shaIndex + 1];
  if (!Number.isFinite(since) || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
    throw new Error(
      'Verifier requires --since <epoch-ms> and --sha <full-sha>',
    );
  }
  const unpacked = path.join(OUTPUT, 'win-unpacked');
  const appExecutable = path.join(unpacked, 'Ptah.exe');
  const installerPrefix = `Ptah-Local-${sha.slice(0, 12)}-`;
  const installers = fs
    .readdirSync(OUTPUT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(installerPrefix) &&
        entry.name.toLowerCase().endsWith('.exe'),
    )
    .map((entry) => path.join(OUTPUT, entry.name));
  // NTFS timestamps can be coarser than Date.now(); the two-second allowance
  // prevents a fresh artifact from being rejected at a timestamp boundary.
  const freshEnough = (file) => fs.statSync(file).mtimeMs >= since - 2_000;
  if (
    installers.length !== 1 ||
    !freshEnough(installers[0]) ||
    !fs.existsSync(appExecutable) ||
    !freshEnough(appExecutable)
  ) {
    throw new Error('Fresh installer and Ptah.exe were not both found');
  }
  // Copied dependencies can preserve source mtimes. Check every executable in
  // the newly packed app, not only files whose timestamps look fresh.
  const executables = [installers[0], ...collectExecutables(unpacked)];

  const command =
    '$p=ConvertFrom-Json $env:PTAH_VERIFY_PATHS_JSON;$r=@($p|ForEach-Object{$s=Get-AuthenticodeSignature -LiteralPath $_;[pscustomobject]@{Path=$s.Path;Status=$s.Status.ToString()}});$r|ConvertTo-Json -Compress';
  const raw = execFileSync(
    resolveWindowsSystemExecutable(
      path.win32.join('System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ),
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PTAH_VERIFY_PATHS_JSON: JSON.stringify(executables),
      },
    },
  );
  const parsed = JSON.parse(raw);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  assertUnsignedStatuses(records, executables);

  const packageJson = JSON.parse(
    asar
      .extractFile(
        path.join(OUTPUT, 'win-unpacked', 'resources', 'app.asar'),
        'package.json',
      )
      .toString('utf8'),
  );
  const identity = packageJson.ptahBuildIdentity;
  if (identity?.kind !== 'local-production' || identity.gitSha !== sha) {
    throw new Error(
      'Packaged app is missing the expected local-production identity',
    );
  }
  console.log(
    `[verify] unsigned local-production installer and app verified (${executables.length} executables)`,
  );
}

module.exports = { assertUnsignedStatuses, collectExecutables };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      `[verify] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
