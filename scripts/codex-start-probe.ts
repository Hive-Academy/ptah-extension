/** Dev-only, no model turns. From the workspace root (PowerShell or bash):
 * npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts
 * npx ts-node --transpile-only -P scripts/codex-start-probe.tsconfig.json -r tsconfig-paths/register scripts/codex-start-probe.ts --no-user-mcp
 * Optional: --codex <absolute native binary> --cwd <directory> --model <model-id>
 * --mcp: attach a `ptah_probe` http server (unbound loopback port, fake secret header) through
 * the thread config; report its startup status and whether new rollout files hold the secret.
 */
import 'reflect-metadata';
import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  buildCodexExecutionProfile, CodexRuntime, CodexProcessFailureError,
  CodexSelectionSnapshot, createNodeCodexExecutableProbes,
  type CodexContext, type CodexExecutionProfileInput,
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
  const result = { codex: '', cwd: process.cwd(), model: 'gpt-6.1-sol', noUserMcp: false, mcp: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--no-user-mcp') { result.noUserMcp = true; continue; }
    if (flag === '--mcp') { result.mcp = true; continue; }
    if (flag !== '--codex' && flag !== '--cwd' && flag !== '--model') throw new Error('Unsupported probe option');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('Missing probe option value');
    result[flag.slice(2) as 'codex' | 'cwd' | 'model'] = value;
  }
  if (result.codex && !isAbsolute(result.codex)) throw new Error('--codex must be absolute');
  return result;
}

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

const PROBE_SERVER = 'ptah_probe';
const mcpStatuses = new Map<string, string[]>();

/** The runtime drops `mcpServer/startupStatus/updated`; read it from the raw JSON-RPC lines. */
function tapMcpStatus(child: ChildProcess): void {
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.includes('mcpServer/startupStatus/updated')) continue;
      const message: unknown = JSON.parse(line);
      if (typeof message !== 'object' || message === null || !('params' in message)) continue;
      const params = message.params;
      if (typeof params !== 'object' || params === null || !('name' in params) || !('status' in params)) continue;
      const name = String(params.name);
      mcpStatuses.set(name, [...(mcpStatuses.get(name) ?? []), String(params.status)]);
    }
  });
}

async function probeStatus(timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const settled = (states: string[] | undefined) => states?.some((s) => s !== 'starting') ?? false;
  while (!settled(mcpStatuses.get(PROBE_SERVER)) && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 200));
  return mcpStatuses.get(PROBE_SERVER) ?? [];
}

function rolloutScan(directory: string, since: number, needle: string): { files: number; hits: number } {
  const result = { files: 0, hits: 0 };
  let entries: string[];
  try { entries = readdirSync(directory); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const nested = rolloutScan(path, since, needle);
      result.files += nested.files; result.hits += nested.hits;
    } else if (stats.mtimeMs >= since) {
      result.files++;
      if (readFileSync(path, 'utf8').includes(needle)) result.hits++;
    }
  }
  return result;
}

function spawner(overrides: string[]): IProcessSpawner {
  return { spawnProcess(request) {
    const child = spawn(request.command, [...request.args, ...overrides], {
      cwd: request.cwd, env: request.env, detached: request.detached,
      windowsHide: true, stdio: 'pipe', shell: false,
    });
    tapMcpStatus(child);
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
  let probeMcp = false;
  let home = '';
  const secret = `ptah-probe-secret-${randomUUID()}`;
  try {
    const args = await step('parse options', options);
    probeMcp = args.mcp;
    const defaultProbes = createNodeCodexExecutableProbes(async () =>
      resolveCodexNativeBinaryPath());
    const selectionSnapshot = new CodexSelectionSnapshot({
      ...defaultProbes,
      ...(args.codex ? { installedCandidates: async () => [args.codex] } : {}),
    });
    const profile = await step('build profile', () => {
      const cwd = resolve(args.cwd);
      home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
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
          systemPrompt: 'You are Ptah, a coding assistant.',
          mcpServers: args.mcp ? [{ name: PROBE_SERVER, transport: 'http',
            url: 'http://127.0.0.1:9/session/probe/workspace/probe',
            headerReferences: { 'X-Ptah-Probe': 'probe.header' }, toolTimeoutSec: 960 }] : [] },
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
      selectionSnapshot, spawner: spawner(overrides), store, logger,
      sink: { async request() { print('FAIL unexpected approval request; denied'); process.exitCode = 1; return 'decline'; } },
      clock: { now: () => Date.now(), setTimeout(callback, delay) {
        const timer = setTimeout(callback, delay); return { dispose: () => clearTimeout(timer) };
      } },
    });
    runtime = openedRuntime;
    context = await step('open = initialize + thread/start', () =>
      openedRuntime.open(profile, undefined, new Map([['probe.header', secret]])));
    const selected = selectionSnapshot.current();
    if (!selected) throw new Error('Codex executable selection is missing after open');
    print(JSON.stringify({ codexExecutable: {
      source: selected.source, version: selected.version, reason: selected.reason,
    } }));
    threadPrefix = context.identity.threadId.slice(0, 8);
    if (args.mcp) {
      const states = await probeStatus(15000);
      print(`MCP ${PROBE_SERVER} startupStatus=${JSON.stringify(states)} (empty = thread config NOT applied)`);
      print(`MCP all servers=${JSON.stringify(Object.fromEntries(mcpStatuses))}`);
      if (states.length === 0) process.exitCode = 1;
    }
  } finally {
    await step('close', async () => {
      try { await context?.close(); } finally { await runtime?.close(); }
    });
  }
  if (probeMcp && home) {
    // No turn runs, so Codex may not write a rollout yet; scan every file it changed.
    const scan = rolloutScan(home, started, secret);
    print(`CODEX_HOME files-since-start=${scan.files} files-with-secret=${scan.hits}`);
    if (scan.hits > 0) process.exitCode = 1;
  }
  if (!process.exitCode) print(`OK thread=${threadPrefix} elapsedMs=${Date.now() - started}`);
}
void main().catch((error: unknown) => {
  if (!process.exitCode) { print('FAIL probe'); failure(error); }
  process.exitCode = 1;
});
