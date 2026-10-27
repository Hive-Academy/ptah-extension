/** Dev-only, no model turns. From the workspace root (PowerShell or bash):
 * npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts
 * npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts --no-user-mcp
 * Optional: --codex <absolute native binary> --cwd <directory> --model <model-id>
 */
import 'reflect-metadata';
import { ChildProcess, spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  buildCodexExecutionProfile, CodexRuntime, CodexProcessFailureError,
  findCodexExecutablePin, type CodexContext, type CodexExecutionProfileInput,
  type CodexRuntimeLogger, type CodexThreadIdentity, type CodexThreadIdentityStore,
  type IProcessSpawner,
} from '@ptah-extension/codex-runtime';
import { resolveCodexNativeBinaryPath } from '../libs/backend/agent-sdk/src/lib/detector/codex-native-binary-path';
import { redactCodexDiagnostics } from '../libs/backend/codex-runtime/src/lib/codex-stderr-tail';

type Metadata = Readonly<Record<string, string | number | boolean>>;
let diagnostics: Metadata = {};
const print = (value: string) => process.stdout.write(`${value}\n`);
const log = (level: string) => (message: string, metadata?: Metadata): void => {
  diagnostics = { ...diagnostics, ...metadata };
  print(JSON.stringify({ level, message, ...metadata }));
};
const logger: CodexRuntimeLogger = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };

function failure(error: unknown): void {
  const chain: { class: string; message: string }[] = [];
  const seen = new Set<unknown>();
  let method = diagnostics['failedMethod'] ?? diagnostics['method'] ?? 'unavailable';
  let rpcCode = diagnostics['rpcCode'] ?? 'unavailable';
  while (error !== undefined && !seen.has(error)) {
    seen.add(error);
    chain.push({
      class: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof SyntaxError ? 'Invalid JSON (excerpt omitted)'
        : error instanceof Error ? redactCodexDiagnostics(error.message).slice(0, 2048)
          : 'Non-Error failure (value omitted)',
    });
    if (error instanceof CodexProcessFailureError && error.method) method = error.method;
    if (error instanceof Error && 'rpcCode' in error && typeof error.rpcCode === 'number') rpcCode = error.rpcCode;
    error = error instanceof Error ? error.cause : undefined;
  }
  print(JSON.stringify({ error: chain[0], failedMethod: method, rpcCode,
    causeChain: chain.slice(1), stderrTail: diagnostics['stderrTail'] ?? '' }));
}

async function step<T>(name: string, action: () => T | Promise<T>): Promise<T> {
  print(`START ${name}`);
  try {
    const result = await action();
    print(`OK ${name}`);
    return result;
  } catch (error) {
    print(`FAIL ${name}`);
    failure(error);
    process.exitCode = 1;
    throw error;
  }
}

function options() {
  const result = { codex: '', cwd: process.cwd(), model: 'gpt-6.1-sol', noUserMcp: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--no-user-mcp') { result.noUserMcp = true; continue; }
    if (flag !== '--codex' && flag !== '--cwd' && flag !== '--model') throw new Error('Unsupported probe option');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing probe option value');
    result[flag.slice(2) as 'codex' | 'cwd' | 'model'] = value;
  }
  if (result.codex && !isAbsolute(result.codex)) throw new Error('--codex must be absolute');
  return result;
}

function executable(override: string): string {
  const detected = override || resolveCodexNativeBinaryPath();
  if (!detected) throw new Error('Bundled Codex executable unavailable');
  const path = realpathSync(detected);
  if (override) return path;
  let directory = resolve(__dirname, '..');
  while (true) {
    const candidate = join(directory, 'node_modules');
    let exists = false;
    try { exists = statSync(candidate).isDirectory(); } catch { /* Try ancestor. */ }
    if (exists) {
      const local = relative(realpathSync(candidate), path);
      if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
        throw new Error('Codex executable is outside the host bundle');
      return path;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Bundled Codex package root unavailable');
    directory = parent;
  }
}

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function suppression(home: string): string[] {
  let config: string;
  try { config = readFileSync(join(home, 'config.toml'), 'utf8'); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') config = '';
    else throw error;
  }
  const names = new Set<string>();
  for (const header of config.matchAll(/^\s*\[\s*mcp_servers\s*\.([^\r\n]*)/gm)) {
    // Support bare names and simple quoted names; reject ambiguous dotted/escaped keys.
    const match = /^\s*(?:([\w-]+)|"([\w-]+)"|'([\w-]+)')\s*(?:\.[\w.-]+\s*)?\]\s*(?:#.*)?$/.exec(header[1]);
    if (!match) throw new Error('Unsupported MCP header; cannot safely suppress all user servers');
    names.add(match[1] ?? match[2] ?? match[3]);
  }
  print(`Suppressed MCP server names: ${JSON.stringify([...names].sort())}`);
  return [...names].flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]);
}

function processHandle(child: ChildProcess, whenSpawned: Promise<number | null>): ReturnType<IProcessSpawner['spawnProcess']> {
  return {
    stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, whenSpawned,
    get pid() { return child.pid; },
    get killed() { return child.killed; },
    get exitCode() { return child.exitCode; },
    kill: (signal) => child.kill(signal),
    on: (event, listener) => { child.on(event, listener); },
    once: (event, listener) => { child.once(event, listener); },
    off: (event, listener) => { child.off(event, listener); },
  };
}

function spawner(overrides: string[]): IProcessSpawner {
  return { spawnProcess(request) {
    try {
      if (request.launchGuard?.fileIdentities?.length)
        throw new Error('Probe does not support file identity guards');
      for (const file of request.launchGuard?.fileContents ?? []) {
        if (digest(file.path) !== file.sha256.toLowerCase()) throw new Error('Digest changed');
      }
    } catch {
      const refused = new ChildProcess();
      queueMicrotask(() => {
        refused.emit('error', Object.assign(new Error('Codex launch digest guard refused'), { code: 'ELAUNCHGUARD' }));
        refused.emit('close', null, null);
      });
      return processHandle(refused, Promise.resolve(null));
    }
    const child = spawn(request.command, [...request.args, ...overrides], {
      cwd: request.cwd, env: request.env, detached: request.detached,
      windowsHide: true, stdio: 'pipe', shell: false,
    });
    const whenSpawned = new Promise<number | null>((done) => {
      child.once('spawn', () => done(child.pid ?? null));
      child.once('error', () => done(null));
    });
    return processHandle(child, whenSpawned);
  } };
}

async function main(): Promise<void> {
  const started = Date.now();
  let runtime: CodexRuntime | undefined;
  let context: CodexContext | undefined;
  let threadPrefix: string | undefined;
  try {
    const args = await step('parse options', options);
    const path = await step('resolve executable', () => executable(args.codex));
    const { pin, binary } = await step('verify pin', async () => {
      const pin = findCodexExecutablePin(process.platform, process.arch);
      if (!pin) throw new Error('No reviewed Codex executable pin for this platform');
      const sha256 = digest(path);
      if (sha256 !== pin.binarySha256) throw new Error('Codex executable digest does not match the reviewed pin');
      // Never surface execFile's error message: it may embed raw child stderr.
      const version = await promisify(execFile)(path, ['--version'], {
        encoding: 'utf8', timeout: 10000, windowsHide: true,
      }).catch(() => { throw new Error('Codex --version failed'); });
      const versionOutput = version.stdout.trim();
      if (versionOutput !== `codex-cli ${pin.pinnedVersion}`) throw new Error('Codex version does not match the reviewed pin');
      return { pin, binary: { executablePath: path, sha256, versionOutput, platform: process.platform, arch: process.arch } };
    });
    const profile = await step('build profile', () => {
      const cwd = resolve(args.cwd);
      const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
      const entries: CodexExecutionProfileInput['paths']['entries'] = {};
      for (const path of [cwd, resolve(cwd, home)]) {
        try { entries[path] = { kind: statSync(path).isDirectory() ? 'directory' : 'file', realpath: realpathSync(path) }; }
        catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
          entries[path] = { kind: 'missing' };
        }
      }
      return buildCodexExecutionProfile({
        paths: { platform: process.platform === 'win32' ? 'win32' : 'posix', baseDirectory: cwd, entries },
        session: { contextId: randomUUID(), consumer: 'chat', providerId: 'codex',
          workspaceId: cwd, cwd, normalizedHome: home, model: args.model, permissionLevel: 'ask',
          systemPrompt: 'You are Ptah, a coding assistant.', mcpServers: [] },
      });
    });
    const overrides = args.noUserMcp
      ? await step('suppress user MCP', () => suppression(profile.normalizedHome)) : [];
    const identities = new Map<string, CodexThreadIdentity>();
    const active = new Set<string>();
    const store: CodexThreadIdentityStore = {
      async persist(identity) { identities.set(identity.contextId, identity); active.add(identity.contextId); },
      async read(id) { return identities.get(id); },
      async markInactive(identity) {
        const stored = identities.get(identity.contextId);
        if (stored && (Object.keys(identity) as (keyof CodexThreadIdentity)[])
          .every((key) => stored[key] === identity[key])) active.delete(identity.contextId);
      },
    };
    const openedRuntime = new CodexRuntime({
      executable: { resolvedPath: path, expectedManifestRow: pin }, binary, spawner: spawner(overrides), store, logger,
      sink: { async request() { print('FAIL unexpected approval request; denied'); process.exitCode = 1; return 'decline'; } },
      clock: { now: () => Date.now(), setTimeout(callback, delay) {
        const timer = setTimeout(callback, delay); return { dispose: () => clearTimeout(timer) };
      } },
    });
    runtime = openedRuntime;
    context = await step('open = initialize + thread/start', () => openedRuntime.open(profile));
    threadPrefix = context.identity.threadId.slice(0, 8);
  } finally {
    await step('close', async () => {
      try { await context?.close(); } finally { await runtime?.close(); }
    });
  }
  if (!process.exitCode) print(`OK thread=${threadPrefix} elapsedMs=${Date.now() - started}`);
}
void main().catch((error: unknown) => {
  if (!process.exitCode) { print('FAIL probe'); failure(error); }
  process.exitCode = 1;
});
