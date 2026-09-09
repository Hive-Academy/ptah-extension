#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXCLUDED_DIRECTORY_NAMES = new Set([
  'cache',
  'code cache',
  'gpucache',
  'dawncache',
  'crashpad',
  'logs',
  'models',
  '.cache',
  'backups',
]);

function isExcluded(relativePath, entry) {
  if (!entry.isDirectory()) return false;
  const name = entry.name.toLowerCase();
  return (
    EXCLUDED_DIRECTORY_NAMES.has(name) ||
    /(^|[-_.])backup(s)?($|[-_.])/.test(name)
  );
}

function resolveThroughExistingAncestor(input) {
  let current = path.resolve(input);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  const resolved = fs.existsSync(current)
    ? fs.realpathSync.native(current)
    : current;
  return path.resolve(resolved, ...missing);
}

function pathKey(input) {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertOutsideSources(destination, sources) {
  const target = pathKey(resolveThroughExistingAncestor(destination));
  for (const source of sources) {
    const root = pathKey(resolveThroughExistingAncestor(source.path));
    if (target === root || target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Backup destination must not be inside ${source.label}`);
    }
  }
}

function assertSourceRootsAreDirectories(sources) {
  for (const source of sources) {
    const stat = fs.lstatSync(source.path);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symbolic source root: ${source.path}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Backup source is not a directory: ${source.path}`);
    }
  }
}

function assertPtahClosed() {
  if (process.platform !== 'win32') {
    throw new Error('This backup command currently supports Windows only');
  }
  const output = execFileSync(
    'tasklist.exe',
    ['/FI', 'IMAGENAME eq Ptah.exe', '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (/"Ptah\.exe"/i.test(output)) {
    throw new Error('Ptah is running. Close it completely before backing up');
  }
}

function snapshotDatabaseFiles(sources) {
  const result = new Map();
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(db|sqlite)(-(wal|shm))?$/i.test(entry.name)) {
        const stat = fs.statSync(full);
        result.set(full, `${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  for (const source of sources)
    if (fs.existsSync(source.path)) visit(source.path);
  return result;
}

function copyTree(source, destination, hashes, relativeRoot = '') {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const relative = path.join(relativeRoot, entry.name);
    if (isExcluded(relative, entry)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing to follow symlink: ${from}`);
    if (entry.isDirectory()) copyTree(from, to, hashes, relative);
    else if (entry.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const sourceHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(from))
        .digest('hex');
      const copyHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(to))
        .digest('hex');
      if (sourceHash !== copyHash)
        throw new Error(`Backup verification failed: ${from}`);
      hashes[path.join(relativeRoot, entry.name).replaceAll('\\', '/')] =
        sourceHash;
    }
  }
}

function createBackup({
  destination,
  sources,
  checkClosed = assertPtahClosed,
}) {
  checkClosed();
  assertOutsideSources(destination, sources);
  if (fs.existsSync(destination))
    throw new Error('Backup destination already exists');
  const available = sources.filter((source) => fs.existsSync(source.path));
  if (available.length === 0)
    throw new Error('No Ptah data directories were found');
  assertSourceRootsAreDirectories(available);

  const before = snapshotDatabaseFiles(available);
  const staging = `${destination}.incomplete-${process.pid}`;
  if (fs.existsSync(staging))
    throw new Error(`Staging path already exists: ${staging}`);
  try {
    fs.mkdirSync(staging, { recursive: false });
    const manifest = {
      createdAt: new Date().toISOString(),
      sources: [],
      files: {},
    };
    for (const source of available) {
      const target = path.join(staging, source.label);
      const hashes = {};
      copyTree(source.path, target, hashes);
      manifest.sources.push({
        label: source.label,
        source: path.resolve(source.path),
      });
      for (const [file, hash] of Object.entries(hashes)) {
        manifest.files[`${source.label}/${file}`] = hash;
      }
    }
    const after = snapshotDatabaseFiles(available);
    if (JSON.stringify([...before]) !== JSON.stringify([...after])) {
      throw new Error('Database files changed during backup; backup refused');
    }
    fs.writeFileSync(
      path.join(staging, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx' },
    );
    fs.renameSync(staging, destination);
    return manifest;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function main(args = process.argv.slice(2)) {
  const index = args.indexOf('--destination');
  const supplied = index >= 0 ? args[index + 1] : undefined;
  if (!supplied)
    throw new Error(
      'Usage: npm run electron:backup:production-data -- --destination <new-directory>',
    );
  const destination = path.resolve(supplied);
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not defined');
  const sources = [
    { label: 'electron-user-data', path: path.join(appData, 'Ptah') },
    { label: 'ptah-home', path: path.join(os.homedir(), '.ptah') },
  ];
  const manifest = createBackup({ destination, sources });
  console.log(
    `[backup] verified ${Object.keys(manifest.files).length} files at ${destination}`,
  );
}

module.exports = {
  assertOutsideSources,
  assertPtahClosed,
  assertSourceRootsAreDirectories,
  createBackup,
  isExcluded,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      `[backup] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
