import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Offline export only: no server listener, authentication, inference or TypeScript generation.
const { values } = parseArgs({ options: { binary: { type: 'string' } }, strict: true });
if (!values.binary) throw new Error('Required: --binary <absolute native executable path>');
const binary = realpathSync(resolve(values.binary));
if (/\.(cmd|bat|js|mjs)$/i.test(binary)) throw new Error('Use the native executable, not a launcher');
let root;
let home;
const children = new Set();
const killed = new WeakSet();
function killTree(child) {
  if (!child.pid || killed.has(child)) return;
  if (process.platform === 'win32') {
    const result = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    if (result.error || result.status !== 0) {
      try { process.kill(child.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') { killed.add(child); return; } throw error; }
      throw new Error('Tree kill failed; cleanup cannot safely continue');
    }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  killed.add(child);
}
function cleanup() {
  for (const child of children) killTree(child);
  if (home) rmSync(join(home, 'auth.json'), { force: true });
  if (root) rmSync(root, { recursive: true, force: true });
}
function fatal() { try { cleanup(); } finally { process.exit(1); } }
const fatalEvents = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
for (const event of fatalEvents) process.on(event, fatal);
function within(parent, path) {
  const suffix = relative(parent, path);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep));
}
function canonical(path) {
  try { return realpathSync(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(canonical(dirname(path)), basename(path));
  }
}
function disjoint() {
  const protectedHomes = [join(homedir(), '.codex'), ...(process.env.CODEX_HOME ? [process.env.CODEX_HOME] : [])];
  for (const path of [root, home]) {
    if (lstatSync(path).isSymbolicLink()) throw new Error('Symlink experiment path');
    const actual = realpathSync(path);
    for (const protectedHome of protectedHomes) {
      const protectedPath = canonical(resolve(protectedHome));
      if (within(actual, protectedPath) || within(protectedPath, actual)) throw new Error('Experiment overlaps a real Codex home');
    }
  }
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function invoke(args, env) {
  const child = spawn(binary, args, { cwd: root, env, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false });
  children.add(child);
  let size = 0;
  const chunks = [];
  let timer;
  try {
    return await new Promise((done, reject) => {
      timer = setTimeout(() => { killTree(child); reject(new Error('Offline binary command timed out')); }, 30000);
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) { killTree(child); reject(new Error('Offline export exceeds output limit')); }
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.once('error', () => reject(new Error('Offline binary command failed (output withheld)')));
      child.once('close', code => code === 0 ? done(Buffer.concat(chunks).toString('utf8').trim())
        : reject(new Error('Offline binary command failed (output withheld)')));
    });
  } finally {
    clearTimeout(timer);
    killTree(child);
    children.delete(child);
  }
}
function methods(node, definitions, seen = new Set()) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((value) => methods(value, definitions, seen));
  const result = [];
  const method = node.properties?.method;
  if (typeof method?.const === 'string') result.push(method.const);
  if (Array.isArray(method?.enum)) result.push(...method.enum.filter((value) => typeof value === 'string'));
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/') && !seen.has(node.$ref)) {
    seen.add(node.$ref);
    const name = node.$ref.split('/').at(-1);
    result.push(...methods(definitions[name], definitions, seen));
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== '$ref') result.push(...methods(value, definitions, seen));
  }
  return [...new Set(result)].sort();
}
try {
  root = mkdtempSync(join(tmpdir(), 'ptah-codex-schema-'));
  if (lstatSync(root).isSymbolicLink()) throw new Error('Symlink experiment root');
  root = realpathSync(root);
  home = join(root, 'home');
  mkdirSync(home, { mode: 0o700 });
  disjoint();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|LANG|LC_ALL)$/i.test(key)));
  Object.assign(env, { CODEX_HOME: home, HOME: home, USERPROFILE: home, TMP: root, TEMP: root, TMPDIR: root });
  const version = await invoke(['--version'], env);
  if (!/^codex(?:-cli)? 0\.165\.0$/.test(version)) throw new Error('Expected pinned Codex 0.165.0');
  const output = join(root, 'export');
  mkdirSync(output);
  const command = ['app-server', 'generate-json-schema', '--out', output];
  await invoke(command, env);
  const files = [];
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink() || !within(realpathSync(root), realpathSync(path))) throw new Error('Unsafe schema export path');
      if (entry.isDirectory()) collect(path);
      else if (entry.name.endsWith('.json')) files.push({ path, schema: JSON.parse(readFileSync(path, 'utf8')) });
    }
  }
  collect(output);
  const aggregate = files.find(({ schema }) => (schema.definitions ?? schema.$defs)?.ClientRequest);
  if (!aggregate) throw new Error('Export has no aggregate ClientRequest schema; inspect offline export format before proceeding');
  const definitions = aggregate.schema.definitions ?? aggregate.schema.$defs;
  const groups = {};
  for (const [group, name] of Object.entries({ requests: 'ClientRequest', serverRequests: 'ServerRequest',
    clientNotifications: 'ClientNotification', serverNotifications: 'ServerNotification' })) {
    const source = definitions[name] ?? files.find(({ schema }) => schema.title === name)?.schema;
    groups[group] = methods(source, definitions);
    if (!groups[group].length) throw new Error(`Missing method group: ${name}`);
  }
  const schemaBytes = JSON.stringify(aggregate.schema, null, 2) + '\n';
  const binarySha256 = hash(readFileSync(binary));
  const schemaSha256 = hash(schemaBytes);
  const destination = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/protocol');
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'codex-app-server-protocol.schema.json'), schemaBytes);
  writeFileSync(join(destination, 'codex-app-server-protocol.manifest.json'), JSON.stringify({
    formatVersion: 1, pinnedVersion: '0.165.0', version, binaryPath: binary, binarySha256, schemaSha256,
    platform: process.platform, arch: process.arch, generatedAt: new Date().toISOString(),
    command: ['app-server', 'generate-json-schema', '--out', '<isolated-export>'], methods: groups,
    artifacts: [{ platform: process.platform, arch: process.arch, binarySha256, schemaSha256 }],
    provenance: 'offline binary schema export; no behavioral proof',
  }, null, 2) + '\n');
  process.stdout.write('Wrote pinned protocol schema and manifest. No model execution.\n');
} finally {
  try { cleanup(); } finally { for (const event of fatalEvents) process.removeListener(event, fatal); }
}
