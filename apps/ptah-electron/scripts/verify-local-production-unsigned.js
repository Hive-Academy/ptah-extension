#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
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

function isUnmodifiedDependency(executable, unpackedRoot, sourceNodeModules) {
  if (!unpackedRoot || !sourceNodeModules) return false;
  const packedModules = path.resolve(
    unpackedRoot,
    'resources',
    'app.asar.unpacked',
    'node_modules',
  );
  const relative = path.relative(packedModules, path.resolve(executable));
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return false;
  const source = path.resolve(sourceNodeModules, relative);
  const isContainedFile = (file, root) => {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
    const canonicalRelative = path.relative(
      fs.realpathSync(root),
      fs.realpathSync(file),
    );
    return (
      canonicalRelative !== '' &&
      canonicalRelative !== '..' &&
      !canonicalRelative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(canonicalRelative)
    );
  };
  if (
    !isContainedFile(executable, packedModules) ||
    !isContainedFile(source, sourceNodeModules)
  )
    return false;
  const hash = (file) =>
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return hash(executable) === hash(source);
}

function assertUnsignedStatuses(
  records,
  expectedPaths,
  { unpackedRoot, sourceNodeModules } = {},
) {
  const byPath = new Map(
    records.map((record) => [path.resolve(record.Path), record.Status]),
  );
  for (const executable of expectedPaths) {
    const status = byPath.get(path.resolve(executable));
    if (status === 'NotSigned') continue;
    // Upstream binaries retain their vendor signatures only when packaging
    // copied the exact installed dependency. Ptah's own artifacts never qualify.
    if (
      status === 'Valid' &&
      isUnmodifiedDependency(executable, unpackedRoot, sourceNodeModules)
    )
      continue;
    throw new Error(
      `Expected unsigned executable or unchanged signed dependency: ${executable}`,
    );
  }
}

function inspectSignatures(
  executables,
  run = execFileSync,
  environment = process.env,
) {
  const powershell = resolveWindowsSystemExecutable(
    path.win32.join('System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  );
  const modules = path.join(path.dirname(powershell), 'Modules');
  const canonicalModules = fs.realpathSync(modules);
  if (
    !fs.statSync(modules).isDirectory() ||
    path
      .relative(path.dirname(fs.realpathSync(powershell)), canonicalModules)
      .toLowerCase() !== 'modules'
  ) {
    throw new Error('Windows PowerShell system Modules directory is invalid');
  }
  // PS7 module paths inherited by PS5 can load incompatible Security TypeData.
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => key.toLowerCase() !== 'psmodulepath',
    ),
  );
  const command =
    "$ErrorActionPreference='Stop';$p=ConvertFrom-Json $env:PTAH_VERIFY_PATHS_JSON;$r=@($p|ForEach-Object{$s=Get-AuthenticodeSignature -LiteralPath $_;[pscustomobject]@{Path=$s.Path;Status=$s.Status.ToString()}});$r|ConvertTo-Json -Compress";
  const raw = run(
    powershell,
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...env,
        PSModulePath: canonicalModules,
        PTAH_VERIFY_PATHS_JSON: JSON.stringify(executables),
      },
    },
  );
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
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

  const records = inspectSignatures(executables);
  assertUnsignedStatuses(records, executables, {
    unpackedRoot: unpacked,
    sourceNodeModules: path.join(ROOT, 'node_modules'),
  });

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
    `[verify] unsigned Ptah installer/app and unchanged signed dependencies verified (${executables.length} executables inspected)`,
  );
}

module.exports = {
  assertUnsignedStatuses,
  collectExecutables,
  inspectSignatures,
};

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
