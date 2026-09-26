/**
 * TASK_2026_408 Batch 9 — integration test through the INSTALLED SDK.
 *
 * REAL: the pinned `@anthropic-ai/claude-agent-sdk` (0.3.278) `query()`,
 * loaded (ESM-only) in a child `node --input-type=module` process, exactly
 * the pattern in
 * `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-auto-compact-argv.spec.ts:82-148`,
 * spawning the REAL platform CLI binary from the SDK's own
 * `optionalDependencies` (no `spawnClaudeCodeProcess` override); the REAL
 * `CodexTranslationProxy` running in THIS jest process on a loopback port.
 *
 * MOCKED: the upstream Responses API — a plain `http` server that scripts
 * replies by inspecting request content (never by call order, except where a
 * scenario is inherently sequential and isolated to its own server
 * instance), and always answers an unrecognised ("side query") request with
 * plain text `ok` rather than erroring.
 *
 * No live provider is ever contacted. If the pinned SDK or its platform
 * binary is missing, `findPinnedSdk()` throws — this spec never skips.
 *
 * Each scenario gets its own temp project, its own mock upstream and its own
 * `CodexTranslationProxy`, so scenarios cannot leak state into each other.
 * Per-scenario jest timeout is 90s; the child CLI process tree is hard-killed
 * at 55s and its cleanup is bounded (TIMEOUT_CLEANUP_BUDGET_MS, checked at
 * load against the scenario timeout), so a single scenario can never hang
 * the whole suite (first real-CLI-binary spec in the repo; cold start is a
 * few seconds — R1).
 */

import 'reflect-metadata';
import * as http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { killProcessTree } from '@ptah-extension/platform-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { CodexTranslationProxy } from '../providers/codex/codex-translation-proxy';
import type { ICodexAuthService } from '../providers/codex/codex-provider.types';

const PINNED_SDK_VERSION = '0.3.278';
const SCENARIO_TIMEOUT_MS = 90_000;
const CHILD_HARD_KILL_MS = 55_000;
/** Timeout cleanup phases; each is individually bounded. */
const DESCENDANT_DISCOVERY_TIMEOUT_MS = 10_000;
const TREE_KILL_TIMEOUT_MS = 4_000;
const CHILD_EXIT_WAIT_MS = 4_000;
const SURVIVOR_POLL_MS = 4_000;
const TIMEOUT_CLEANUP_BUDGET_MS =
  DESCENDANT_DISCOVERY_TIMEOUT_MS +
  TREE_KILL_TIMEOUT_MS +
  CHILD_EXIT_WAIT_MS +
  SURVIVOR_POLL_MS;
// Hard kill plus the whole cleanup must report before Jest's own deadline,
// with margin for teardown (proxy/upstream close, fixture removal).
if (
  CHILD_HARD_KILL_MS + TIMEOUT_CLEANUP_BUDGET_MS >
  SCENARIO_TIMEOUT_MS - 10_000
) {
  throw new Error(
    'Child hard kill + cleanup budget exceeds the scenario timeout',
  );
}

// ---------------------------------------------------------------------------
// Pinned-SDK discovery (REAL). Mirrors ptah-cli-registry-auto-compact-argv's
// `findPinnedSdk`; failure here is loud, never a skip.
// ---------------------------------------------------------------------------

function findPinnedSdk(): {
  entry: string;
  version: string;
  installRoot: string;
} {
  let dir = __dirname;
  for (;;) {
    const root = path.join(
      dir,
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk',
    );
    const entry = path.join(root, 'sdk.mjs');
    if (existsSync(entry)) {
      const pkg = JSON.parse(
        readFileSync(path.join(root, 'package.json'), 'utf8'),
      ) as { version: string };
      return { entry, version: pkg.version, installRoot: dir };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        '@anthropic-ai/claude-agent-sdk is not installed — TASK_2026_408 ' +
          'Batch 9 requires the pinned real SDK and its platform CLI binary; ' +
          'this spec never skips on a missing dependency.',
      );
    }
    dir = parent;
  }
}

const PINNED_SDK = findPinnedSdk();
if (PINNED_SDK.version !== PINNED_SDK_VERSION) {
  throw new Error(
    `Pinned @anthropic-ai/claude-agent-sdk version drifted: expected ` +
      `${PINNED_SDK_VERSION}, found ${PINNED_SDK.version}. Re-verify the ` +
      'scenarios against sdk.d.ts before updating this constant.',
  );
}

/** This checkout: the SDK must be installed in the repository itself. */
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
if (path.relative(REPO_ROOT, PINNED_SDK.installRoot) !== '') {
  throw new Error(
    `The pinned SDK resolved outside this checkout (${PINNED_SDK.installRoot}); ` +
      `run the install in ${REPO_ROOT}.`,
  );
}

/**
 * Zod as the pinned SDK itself resolves it. The child script lives in a temp
 * directory, so a bare `import("zod")` there would resolve from the temp
 * location's ancestors (a user-profile install, for example) instead.
 */
const ZOD_ENTRY = createRequire(PINNED_SDK.entry).resolve('zod');
// `require.resolve` returns real paths, and a worktree's `node_modules` may be
// a link to another checkout's install: compare against its real path.
const REPO_NODE_MODULES = realpathSync(path.join(REPO_ROOT, 'node_modules'));
const zodFromRepo = path.relative(REPO_NODE_MODULES, ZOD_ENTRY);
if (zodFromRepo.startsWith('..') || path.isAbsolute(zodFromRepo)) {
  throw new Error(
    `zod resolved outside this checkout's node_modules (${REPO_NODE_MODULES}): ${ZOD_ENTRY}`,
  );
}

/**
 * One fixture root per suite run. Every scenario directory, child script and
 * child TEMP lives under it, and `afterAll` removes it, so nothing is left in
 * the shared OS temp root.
 */
let FIXTURE_ROOT: string | undefined;
function fixtureRoot(): string {
  FIXTURE_ROOT ??= mkdtempSync(path.join(os.tmpdir(), 'ptah-sdk-int-'));
  return FIXTURE_ROOT;
}

function removeTree(dir: string): void {
  // Windows can briefly hold handles of a just-exited process tree.
  rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}

// ---------------------------------------------------------------------------
// Structured views of a recorded upstream Responses request.
// ---------------------------------------------------------------------------

type InputItem = Record<string, unknown>;

function inputItems(parsed: unknown): InputItem[] {
  const input = (parsed as { input?: unknown } | undefined)?.input;
  return Array.isArray(input)
    ? input.filter(
        (item): item is InputItem => typeof item === 'object' && item !== null,
      )
    : [];
}

function callItem(
  parsed: unknown,
  type: 'function_call' | 'function_call_output',
  callId: string,
): InputItem | undefined {
  return inputItems(parsed).find(
    (item) => item['type'] === type && item['call_id'] === callId,
  );
}

function toolNames(parsed: unknown): string[] {
  const tools = (parsed as { tools?: unknown } | undefined)?.tools;
  return Array.isArray(tools)
    ? tools.map((tool) => String((tool as Record<string, unknown>)['name']))
    : [];
}

/** Whether a user message item carries `marker` (never tools or system). */
function userMessageIncludes(parsed: unknown, marker: string): boolean {
  return inputItems(parsed).some(
    (item) => item['role'] === 'user' && JSON.stringify(item).includes(marker),
  );
}

// ---------------------------------------------------------------------------
// Fixture writer (stays inside this spec, per plan — not a shared module).
// ---------------------------------------------------------------------------

function writeFixtures(projectDir: string): void {
  const skillDir = path.join(projectDir, '.claude', 'skills', 'fixture-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      'name: fixture-skill',
      'description: TASK_2026_408 Batch 9 integration fixture skill',
      '---',
      '',
      'SKILL-MARKER-7f3 args=$ARGUMENTS',
      '',
    ].join('\n'),
    'utf8',
  );
  const cmdDir = path.join(projectDir, '.claude', 'commands');
  mkdirSync(cmdDir, { recursive: true });
  writeFileSync(
    path.join(cmdDir, 'fixture-cmd.md'),
    'CMD-MARKER-91c $ARGUMENTS\n',
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Mocked upstream Responses API server.
// ---------------------------------------------------------------------------

interface ScriptedReply {
  readonly status?: number;
  readonly sseWire?: string;
  readonly jsonText?: string;
  /** Raw chunks written with separate `res.write()` calls (split-chunk cases). */
  readonly chunks?: readonly string[];
}

type Responder = (body: string, parsed: unknown) => ScriptedReply | undefined;

interface MockUpstream {
  readonly origin: string;
  readonly requests: Array<{ body: string }>;
  readonly close: () => Promise<void>;
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** A plain-text final Responses turn — the "ok" fallback and most replies. */
function textWire(text: string): string {
  return (
    sse({ type: 'response.output_text.delta', delta: text }) +
    sse({
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) +
    'data: [DONE]\n\n'
  );
}

function functionCallWire(callId: string, name: string, args: string): string {
  return (
    sse({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', call_id: callId, name },
    }) +
    sse({
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: args,
    }) +
    sse({
      type: 'response.output_item.done',
      output_index: 0,
      item: { type: 'function_call', call_id: callId, name, arguments: args },
    }) +
    sse({
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [
          { type: 'function_call', call_id: callId, name, arguments: args },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) +
    'data: [DONE]\n\n'
  );
}

const OVERFLOW_MESSAGE = 'Your input exceeds the context window of this model.';

function overflowJsonBody(): string {
  return JSON.stringify({
    error: { code: 'context_length_exceeded', message: OVERFLOW_MESSAGE },
  });
}

function overflowFailedWire(): string {
  return (
    sse({
      type: 'response.failed',
      response: {
        status: 'failed',
        error: { code: 'context_length_exceeded', message: OVERFLOW_MESSAGE },
      },
    }) + 'data: [DONE]\n\n'
  );
}

function startMockUpstream(respond: Responder): Promise<MockUpstream> {
  const requests: Array<{ body: string }> = [];
  return new Promise((resolve, reject) => {
    const instance = http.createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        requests.push({ body });
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = undefined;
        }
        const result = respond(body, parsed);
        if (!result) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(textWire('ok'));
          return;
        }
        if (result.chunks) {
          res.writeHead(result.status ?? 200, {
            'content-type': 'text/event-stream',
          });
          for (const chunk of result.chunks) res.write(chunk);
          res.end();
          return;
        }
        if (result.sseWire !== undefined) {
          res.writeHead(result.status ?? 200, {
            'content-type': 'text/event-stream',
          });
          res.end(result.sseWire);
          return;
        }
        res.writeHead(result.status ?? 200, {
          'content-type': 'application/json',
        });
        res.end(result.jsonText ?? '{}');
      });
    });
    instance.listen(0, '127.0.0.1', () => {
      const addr = instance.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('mock upstream: failed to get server address'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        requests,
        // Bounded: surviving (keep-alive or abandoned) connections are
        // dropped instead of holding `close()` open.
        close: () =>
          new Promise<void>((res2, rej2) => {
            instance.close((err) => (err ? rej2(err) : res2()));
            instance.closeIdleConnections();
            setTimeout(() => instance.closeAllConnections(), 2_000).unref();
          }),
      });
    });
    instance.on('error', reject);
  });
}

function auth(endpoint: string): ICodexAuthService {
  return {
    getAccountUsageEligibility: async () => 'supported',
    getApiEndpoint: async () => endpoint,
    getHeaders: async () => ({}),
    ensureTokensFresh: async () => false,
    isAuthenticated: async () => true,
    listModels: async () => [],
    clearCache: () => undefined,
    getTokenStatus: async () => ({ authenticated: true, stale: false }),
    startWatchingAuthFile: () => undefined,
    stopWatchingAuthFile: () => undefined,
  } as unknown as ICodexAuthService;
}

// ---------------------------------------------------------------------------
// Real child process running the pinned SDK's query() against the REAL CLI
// binary (no spawnClaudeCodeProcess override). One process per scenario.
// ---------------------------------------------------------------------------

/** 1x1 PNG the S5 MCP tool returns; asserted byte-exact in the replay. */
const FIXTURE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const CHILD_SCRIPT = [
  'const chunks = [];',
  'for await (const chunk of process.stdin) chunks.push(chunk);',
  'const cfg = JSON.parse(Buffer.concat(chunks).toString("utf8"));',
  'const sdkMod = await import(cfg.sdkUrl);',
  'const { query, createSdkMcpServer, tool } = sdkMod;',
  'let zMod;',
  'const outputs = [];',
  'let priorSessionId;',
  'for (const run of cfg.runs) {',
  '  const options = { ...run.options, cwd: cfg.cwd };',
  '  const mcpCalls = [];',
  '  if (run.mcp) {',
  '    zMod = zMod || (await import(cfg.zodUrl));',
  '    const z = zMod.z ?? zMod.default ?? zMod;',
  '    const toolDef = tool(',
  '      run.mcp.toolName,',
  '      "fixture tool for TASK_2026_408 S5",',
  '      { value: z.string() },',
  '      async (args) => {',
  '        mcpCalls.push(args);',
  '        if (run.mcp.returnImage) {',
  '          return { content: [{ type: "image", data: cfg.pngB64, mimeType: "image/png" }] };',
  '        }',
  '        return { content: [{ type: "text", text: "S5-TOOL-OK" }] };',
  '      },',
  '    );',
  '    const server = createSdkMcpServer({ name: run.mcp.serverName, version: "1.0.0", tools: [toolDef] });',
  '    options.mcpServers = { [run.mcp.serverName]: server };',
  '  }',
  '  if (run.resumePrevious) {',
  '    if (!priorSessionId) throw new Error("resumePrevious requested with no prior session id");',
  '    options.resume = priorSessionId;',
  '  }',
  '  const messages = [];',
  '  let queryError = null;',
  '  try {',
  '    const q = query({ prompt: run.prompt, options });',
  '    for await (const message of q) {',
  '      messages.push(message);',
  '      process.stderr.write("MSG " + message.type + " " + (message.subtype||"") + "\\n");',
  '      if (message.type === "result" && typeof message.session_id === "string") {',
  '        priorSessionId = message.session_id;',
  '      }',
  '    }',
  '  } catch (error) {',
  '    queryError = error instanceof Error ? error.message : String(error);',
  '  }',
  '  outputs.push({ messages, mcpCalls, queryError });',
  '}',
  'process.stdout.write(JSON.stringify(outputs), () => process.exit(0));',
].join('\n');

interface ChildRun {
  readonly prompt: string;
  readonly options: Record<string, unknown>;
  readonly mcp?: {
    serverName: string;
    toolName: string;
    returnImage?: boolean;
  };
  readonly resumePrevious?: boolean;
}

interface ChildRunResult {
  readonly messages: Array<Record<string, unknown>>;
  readonly mcpCalls: unknown[];
  readonly queryError: string | null;
}

/**
 * ASYNC by necessity, not preference: `spawnSync` blocks Node's event loop
 * for its entire duration, and BOTH the mock upstream and the real
 * `CodexTranslationProxy` are in-process `http.Server`s in THIS same
 * process. A blocked event loop means neither server can ever accept the
 * CLI subprocess's TCP connections, so `spawnSync` here deadlocks on any
 * scenario that requires a live request/response round trip — reproduced
 * directly: the CLI prints its `system init` message (no I/O needed) and
 * then hangs forever, because its very next step is a connection our own
 * process can never accept while frozen inside `spawnSync`. Do not revert to
 * `spawnSync` for this reason, however tempting for the parallel with
 * `ptah-cli-registry-auto-compact-argv.spec.ts` (that spec never has an
 * in-process server on the other end of the child's traffic).
 */
/** Every live process id with its parent, from the OS process table. */
function processTable(): Promise<Array<{ pid: number; ppid: number }>> {
  const [file, args] =
    process.platform === 'win32'
      ? [
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
          ],
        ]
      : ['ps', ['-A', '-o', 'pid=,ppid=']];
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: DESCENDANT_DISCOVERY_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(
          String(stdout)
            .split(/\r?\n/)
            .map((line) => line.trim().split(/\s+/).map(Number))
            .filter(
              ([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid),
            )
            .map(([pid, ppid]) => ({ pid, ppid })),
        );
      },
    );
  });
}

async function descendantPids(root: number): Promise<number[]> {
  const table = await processTable();
  const found: number[] = [];
  const frontier = [root];
  while (frontier.length) {
    const parent = frontier.pop() as number;
    for (const { pid, ppid } of table) {
      if (ppid === parent && pid !== parent && !found.includes(pid)) {
        found.push(pid);
        frontier.push(pid);
      }
    }
  }
  return found;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Kill a process tree within TREE_KILL_TIMEOUT_MS. Resolves with the error, or
 * undefined on success. On Windows `taskkill` runs with an execFile timeout, so
 * Node terminates `taskkill` itself when the bound expires and nothing outlives
 * cleanup. Elsewhere killProcessTree signals the group; a bound that expires is
 * reported as an error, never as success.
 */
/** Mirrors `resolveTaskkill` in platform-core process-tree-reaper.ts (not exported). */
function systemTaskkill(): string | undefined {
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir'];
  return systemRoot
    ? String.raw`${systemRoot}\System32\taskkill.exe`
    : undefined;
}

async function boundedTreeKill(pid: number): Promise<unknown> {
  if (process.platform === 'win32') {
    // Never a bare `taskkill`: PATH lookup could run an interposed binary.
    const taskkill = systemTaskkill();
    if (taskkill === undefined) {
      return new Error(
        'Neither SystemRoot nor windir is set; taskkill.exe cannot be resolved',
      );
    }
    return new Promise<unknown>((resolve) => {
      execFile(
        taskkill,
        ['/pid', String(pid), '/T', '/F'],
        { timeout: TREE_KILL_TIMEOUT_MS, windowsHide: true },
        (error) => resolve(error ?? undefined),
      );
    });
  }
  let killError: unknown;
  const finished = await Promise.race([
    killProcessTree(pid, 'SIGKILL', (error) => {
      killError = error;
    }).then(() => true),
    delay(TREE_KILL_TIMEOUT_MS).then(() => false),
  ]);
  return finished
    ? killError
    : new Error(`tree kill did not finish in ${TREE_KILL_TIMEOUT_MS} ms`);
}

/**
 * Kill the child and every descendant (the real CLI binary included), then
 * verify: the wrapper has exited and no recorded descendant is alive.
 * Resolves only when that is verified; rejects, listing what is unverified
 * or still alive, otherwise. Every phase is bounded (TIMEOUT_CLEANUP_BUDGET_MS).
 */
async function killChildTree(
  child: ReturnType<typeof spawn>,
  exited: Promise<void>,
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  let descendants: number[] | undefined;
  let discoveryError: unknown;
  try {
    descendants = await descendantPids(pid);
  } catch (error: unknown) {
    discoveryError = error;
  }
  // Kill by the wrapper's tree even when discovery failed.
  const killError = await boundedTreeKill(pid);
  await Promise.race([exited, delay(CHILD_EXIT_WAIT_MS)]);
  const deadline = Date.now() + SURVIVOR_POLL_MS;
  let survivors = [pid, ...(descendants ?? [])].filter(isAlive);
  while (survivors.length && Date.now() < deadline) {
    await delay(200);
    survivors = survivors.filter(isAlive);
  }
  const problems: string[] = [];
  if (discoveryError !== undefined) {
    problems.push(
      `descendants could not be enumerated, so their exit is NOT verified (${
        discoveryError instanceof Error
          ? discoveryError.message
          : String(discoveryError)
      })`,
    );
  }
  if (killError !== undefined) {
    problems.push(
      `tree kill reported an error (${killError instanceof Error ? killError.message : String(killError)})`,
    );
  }
  if (survivors.length) problems.push(`still alive: ${survivors.join(', ')}`);
  if (problems.length) {
    throw new Error(
      `Child process tree cleanup failed: ${problems.join('; ')}`,
    );
  }
}

function runChild(
  cwd: string,
  env: NodeJS.ProcessEnv,
  runs: readonly ChildRun[],
): Promise<ChildRunResult[]> {
  // Inside the scenario's own fixture directory, removed at teardown.
  const scriptPath = path.join(
    path.dirname(cwd),
    `child-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  writeFileSync(scriptPath, CHILD_SCRIPT, 'utf8');
  const payload = JSON.stringify({
    sdkUrl: pathToFileURL(PINNED_SDK.entry).href,
    zodUrl: pathToFileURL(ZOD_ENTRY).href,
    pngB64: FIXTURE_PNG_B64,
    cwd,
    runs,
  });
  return new Promise<ChildRunResult[]>((resolve, reject) => {
    // POSIX: own process group, so the tree kill can signal the whole group.
    const child = spawn(process.execPath, [scriptPath], {
      env,
      detached: process.platform !== 'win32',
    });
    const exited = new Promise<void>((resolveExit) =>
      child.once('close', () => resolveExit()),
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const timedOut = (cleanup: string) =>
        new Error(
          `SDK child timed out after ${CHILD_HARD_KILL_MS}ms; ${cleanup}` +
            `\nstderr: ${stderr}\nstdout: ${stdout.slice(0, 4000)}`,
        );
      void killChildTree(child, exited).then(
        () => reject(timedOut('process tree killed and verified exited')),
        (error: unknown) =>
          reject(
            timedOut(error instanceof Error ? error.message : String(error)),
          ),
      );
    }, CHILD_HARD_KILL_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `SDK child failed to start: ${err.message}\nstderr: ${stderr}`,
        ),
      );
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `SDK child exited ${code} (signal ${signal}):\n` +
              `stderr: ${stderr}\nstdout: ${stdout.slice(0, 4000)}`,
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ChildRunResult[]);
      } catch (err) {
        reject(
          new Error(
            `SDK child produced non-JSON stdout: ${err instanceof Error ? err.message : String(err)}\n` +
              `stdout: ${stdout.slice(0, 4000)}\nstderr: ${stderr}`,
          ),
        );
      }
    });
    child.stdin.end(payload);
  });
}

// ---------------------------------------------------------------------------
// Shared scenario scaffolding: temp project + REAL CodexTranslationProxy +
// isolated HOME/USERPROFILE/CLAUDE_CONFIG_DIR.
// ---------------------------------------------------------------------------

interface ScenarioEnv {
  readonly projectDir: string;
  readonly proxyUrl: string;
  readonly upstream: MockUpstream;
  readonly proxy: CodexTranslationProxy;
  readonly env: NodeJS.ProcessEnv;
  readonly teardown: () => Promise<void>;
}

/**
 * This spec runs INSIDE an ambient coding-agent session, whose full
 * `process.env` carries dozens of that outer session's own variables
 * (messaging socket/token, session id, npm/jest internals, GPU/driver
 * vendor vars, and more). Spreading `process.env` wholesale into the child
 * made the spawned CLI hang indefinitely after printing only its `init`
 * message — zero upstream requests ever sent, reproduced up to 280s — while
 * the identical script/options spawned from a plain (non-Jest) Node process
 * with a small curated env completed in seconds. The exact poisoning
 * variable was not isolated (there are ~90 candidates and bisecting further
 * was not worth the cost), so this spec uses an explicit ALLOWLIST rather
 * than `process.env` minus a denylist. Keep it allowlist-shaped; do not
 * revert to spreading `process.env`.
 */
const ALLOWED_HOST_ENV_KEYS = [
  'PATH',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'TEMP',
  'TMP',
  'COMSPEC',
  'PATHEXT',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USERDOMAIN',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'ALLUSERSPROFILE',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PUBLIC',
  'OS',
] as const;

function hostEnvSubset(): NodeJS.ProcessEnv {
  const subset: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_HOST_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) subset[key] = value;
  }
  return subset;
}

async function setupScenario(respond: Responder): Promise<ScenarioEnv> {
  const tmpRoot = mkdtempSync(path.join(fixtureRoot(), 'scenario-'));
  const projectDir = path.join(tmpRoot, 'project');
  const homeDir = path.join(tmpRoot, 'home');
  const childTmp = path.join(tmpRoot, 'tmp');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(childTmp, { recursive: true });
  writeFixtures(projectDir);

  const upstream = await startMockUpstream(respond);
  const proxy = new CodexTranslationProxy(
    createMockLogger() as unknown as Logger,
    auth(upstream.origin),
  );
  const { url } = await proxy.start();

  const env: NodeJS.ProcessEnv = {
    ...hostEnvSubset(),
    // The child's temp files stay inside this scenario's fixture directory.
    TEMP: childTmp,
    TMP: childTmp,
    TMPDIR: childTmp,
    HOME: homeDir,
    USERPROFILE: homeDir,
    CLAUDE_CONFIG_DIR: homeDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: 'test-key',
    NO_PROXY: '127.0.0.1,localhost',
    // Matches sdk-query-runner.service.ts: any non-api.anthropic.com base URL
    // disables experimental betas, which otherwise negotiate a capability
    // preflight this mock upstream and a plain TranslationProxyBase 404 for
    // unknown routes cannot satisfy.
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
  };

  return {
    projectDir,
    proxyUrl: url,
    upstream,
    proxy,
    env,
    teardown: async () => {
      try {
        await proxy.stop();
        await upstream.close();
      } finally {
        removeTree(tmpRoot);
      }
    },
  };
}

function baseOptions(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    // Must be a model the CLI's own `unrecognized_model` guard accepts — an
    // unrecognised id stalls the run before any upstream request is sent
    // (observed empirically: `[claude-code:unrecognized_model]`). The proxy
    // never rewrites this field, so the Codex-facing model id in the plan
    // (`gpt-5.4`) is not required by any scenario's assertions here.
    model: 'claude-sonnet-5',
    settingSources: ['project', 'local'],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 4,
    ...overrides,
  };
}

function allText(value: unknown): string {
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('TASK_2026_408 Batch 9 — SDK/CLI/proxy integration (mocked upstream only)', () => {
  afterAll(() => {
    if (FIXTURE_ROOT) removeTree(FIXTURE_ROOT);
  });

  it('keeps every fixture inside one suite-owned temp directory', () => {
    const root = fixtureRoot();
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^ptah-sdk-int-/);
  });

  it('the timeout kill ends the whole child tree and verifies it exited', async () => {
    // Same shape as the SDK child: a node wrapper with a long-lived descendant.
    const grandchild =
      'require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); setInterval(() => {}, 1000);';
    const child = spawn(process.execPath, ['-e', grandchild], {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
    const exited = new Promise<void>((resolve) =>
      child.once('close', () => resolve()),
    );
    let descendants: number[] = [];
    try {
      // Bounded wait for the grandchild to appear; enumeration errors fail.
      const deadline = Date.now() + 20_000;
      while (descendants.length === 0 && Date.now() < deadline) {
        await delay(200);
        descendants = await descendantPids(child.pid as number);
      }
      expect(descendants.length).toBeGreaterThan(0);
      await expect(killChildTree(child, exited)).resolves.toBeUndefined();
      expect(descendants.filter(isAlive)).toEqual([]);
    } finally {
      // Never leak the wrapper or grandchild, whatever failed above.
      if (child.pid !== undefined && isAlive(child.pid)) {
        await boundedTreeKill(child.pid);
      }
      for (const pid of descendants.filter(isAlive)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already gone between the check and the kill.
        }
      }
    }
  }, 75_000);

  it(
    'S1 Skill: real SDK/CLI calls the Skill tool with args forwarded, real CodexTranslationProxy relays to the (mocked) upstream, final result is success',
    async () => {
      const CALL_ID = 'call-skill-1';
      let skillArgs: Record<string, string> | undefined;
      let toolResultRequest: unknown;
      // Scripted by content only: the scenario's user marker plus the
      // structured tool-result call id; everything else is a side query.
      const scenario = await setupScenario((_body, parsed) => {
        if (callItem(parsed, 'function_call_output', CALL_ID)) {
          toolResultRequest ??= parsed;
          return { sseWire: textWire('S1-DONE') };
        }
        if (
          skillArgs === undefined &&
          userMessageIncludes(parsed, 'S1-MARKER') &&
          toolNames(parsed).includes('Skill')
        ) {
          const request = parsed as { tools?: Array<Record<string, unknown>> };
          const skillTool = request.tools?.find((t) => t['name'] === 'Skill');
          const schema = skillTool?.['parameters'] as
            { properties?: Record<string, unknown> } | undefined;
          const args: Record<string, string> = {};
          for (const key of Object.keys(schema?.properties ?? {})) {
            args[key] = key.toLowerCase().includes('skill')
              ? 'fixture-skill'
              : 'alpha beta';
          }
          skillArgs = args;
          return {
            sseWire: functionCallWire(CALL_ID, 'Skill', JSON.stringify(args)),
          };
        }
        return undefined;
      });
      try {
        const [result] = await runChild(scenario.projectDir, scenario.env, [
          {
            prompt:
              'S1-MARKER Use the fixture-skill skill with args "alpha beta".',
            options: baseOptions(),
          },
        ]);
        if (result.queryError) {
          throw new Error(`S1 query() failed: ${result.queryError}`);
        }
        expect(skillArgs).toBeDefined();
        expect(toolResultRequest).toBeDefined();
        // The replayed call carries the name and the exact arguments sent.
        const replayed = callItem(toolResultRequest, 'function_call', CALL_ID);
        expect(replayed?.['name']).toBe('Skill');
        expect(JSON.parse(String(replayed?.['arguments']))).toEqual(skillArgs);
        // Its result is paired by call id.
        expect(
          callItem(toolResultRequest, 'function_call_output', CALL_ID),
        ).toBeDefined();
        // The skill body reached the model with its $ARGUMENTS substituted,
        // outside the function_call item (which only holds the raw args).
        const nonCallItems = inputItems(toolResultRequest).filter(
          (item) => item['type'] !== 'function_call',
        );
        expect(JSON.stringify(nonCallItems)).toContain(
          'SKILL-MARKER-7f3 args=alpha beta',
        );
        const finalResult = result.messages.find(
          (m) => m['type'] === 'result',
        ) as { subtype?: string; result?: string } | undefined;
        expect(finalResult?.subtype).toBe('success');
        expect(finalResult?.result ?? '').toContain('S1-DONE');
      } finally {
        await scenario.teardown();
      }
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'S2 slash command: /fixture-cmd hello world is expanded by the real CLI before it reaches the (mocked) upstream',
    async () => {
      const scenario = await setupScenario(() => ({
        sseWire: textWire('S2-DONE'),
      }));
      try {
        const [result] = await runChild(scenario.projectDir, scenario.env, [
          { prompt: '/fixture-cmd hello world', options: baseOptions() },
        ]);
        if (result.queryError) {
          throw new Error(`S2 query() failed: ${result.queryError}`);
        }
        // Content, not position: some user message carries the expansion.
        expect(
          scenario.upstream.requests.some((request) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(request.body);
            } catch {
              return false;
            }
            return userMessageIncludes(parsed, 'CMD-MARKER-91c hello world');
          }),
        ).toBe(true);
      } finally {
        await scenario.teardown();
      }
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'S3 unknown slash command: /no-such-cmd x — pins the OBSERVED behaviour (Assumption A3), never a silent expansion',
    async () => {
      const scenario = await setupScenario(() => ({
        sseWire: textWire('S3-DONE'),
      }));
      try {
        const [result] = await runChild(scenario.projectDir, scenario.env, [
          { prompt: '/no-such-cmd x', options: baseOptions() },
        ]);
        if (result.queryError) {
          throw new Error(`S3 query() failed: ${result.queryError}`);
        }
        const bodies = scenario.upstream.requests.map((r) => r.body);
        // The system prompt advertises every available command by its first
        // line (`fixture-cmd: CMD-MARKER-91c $ARGUMENTS`, the RAW, unexpanded
        // placeholder) regardless of what the user typed — that catalog entry
        // is not an expansion. Only a substituted argument (anything other
        // than the literal `$ARGUMENTS` placeholder right after the marker)
        // would mean `/no-such-cmd x` was misrouted into `fixture-cmd`.
        const anyExpanded = bodies.some((b) =>
          /CMD-MARKER-91c(?! \$ARGUMENTS)/.test(b),
        );
        // Never silently expand an unknown command into a known command's body.
        expect(anyExpanded).toBe(false);

        // PINNED observed contract for SDK 0.3.278 (integration-observations
        // S3): the CLI forwards the unknown command literally as the user
        // turn and does NOT reject it locally. A CLI change to local
        // rejection must fail here and be re-decided on the SDK upgrade.
        expect(/Unknown command/i.test(allText(result.messages))).toBe(false);
        const forwardedLiterally = bodies.some((b) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(b);
          } catch {
            return false;
          }
          return userMessageIncludes(parsed, '/no-such-cmd x');
        });
        expect(forwardedLiterally).toBe(true);
        const finalResult = result.messages.find(
          (m) => m['type'] === 'result',
        ) as { subtype?: string } | undefined;
        expect(finalResult?.subtype).toBe('success');
      } finally {
        await scenario.teardown();
      }
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'S4 unknown tool: a hallucinated tool call is rejected by the real CLI with "No such tool available", disclosed to the (mocked) upstream',
    async () => {
      const CALL_ID = 'call-unknown-1';
      let callIssued = false;
      let toolResultRequest: unknown;
      const scenario = await setupScenario((_body, parsed) => {
        if (callItem(parsed, 'function_call_output', CALL_ID)) {
          toolResultRequest ??= parsed;
          return { sseWire: textWire('S4-DONE') };
        }
        if (!callIssued && userMessageIncludes(parsed, 'S4-MARKER')) {
          callIssued = true;
          return { sseWire: functionCallWire(CALL_ID, 'NoSuchTool', '{}') };
        }
        return undefined;
      });
      try {
        const [result] = await runChild(scenario.projectDir, scenario.env, [
          {
            prompt: 'S4-MARKER Call the NoSuchTool tool.',
            options: baseOptions(),
          },
        ]);
        if (result.queryError) {
          throw new Error(`S4 query() failed: ${result.queryError}`);
        }
        expect(toolResultRequest).toBeDefined();
        const replayed = callItem(toolResultRequest, 'function_call', CALL_ID);
        expect(replayed?.['name']).toBe('NoSuchTool');
        const output = callItem(
          toolResultRequest,
          'function_call_output',
          CALL_ID,
        )?.['output'];
        expect(typeof output).toBe('string');
        expect(String(output).startsWith('Error:')).toBe(true);
        expect(String(output)).toContain('No such tool available');
      } finally {
        await scenario.teardown();
      }
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'S5 long MCP name round-trips: upstream sees only the alias, handler receives the args, replay reuses the alias, image tool result becomes input_image for Codex',
    async () => {
      const serverName = 'fixture-mcp-server-with-a-very-long-descriptive-name';
      const toolName = 'invoke-fixture-tool-operation';
      expect(`mcp__${serverName}__${toolName}`.length).toBeGreaterThan(64);

      const CALL_ID = 'call-mcp-1';
      const rawName = `mcp__${serverName}__${toolName}`;
      let aliasSeen: string | undefined;
      let toolResultRequest: unknown;
      const scenario = await setupScenario((_body, parsed) => {
        if (callItem(parsed, 'function_call_output', CALL_ID)) {
          toolResultRequest ??= parsed;
          return { sseWire: textWire('S5-DONE') };
        }
        const mcpName = toolNames(parsed).find((name) =>
          name.startsWith('mcp__'),
        );
        if (
          aliasSeen === undefined &&
          mcpName !== undefined &&
          userMessageIncludes(parsed, 'S5-MARKER')
        ) {
          aliasSeen = mcpName;
          return {
            sseWire: functionCallWire(
              CALL_ID,
              aliasSeen,
              JSON.stringify({ value: '42' }),
            ),
          };
        }
        return undefined;
      });
      try {
        const [result] = await runChild(scenario.projectDir, scenario.env, [
          {
            prompt: 'S5-MARKER Call the fixture MCP tool with value 42.',
            options: baseOptions({ skills: [], strictMcpConfig: true }),
            mcp: { serverName, toolName, returnImage: true },
          },
        ]);
        if (result.queryError) {
          throw new Error(`S5 query() failed: ${result.queryError}`);
        }
        expect(result.mcpCalls).toEqual([{ value: '42' }]);
        expect(aliasSeen).toBeDefined();
        // Only the alias is on the wire, never the raw >64-char name.
        expect(aliasSeen).not.toBe(rawName);
        expect(toolResultRequest).toBeDefined();
        expect(toolNames(toolResultRequest)).toContain(aliasSeen);
        expect(toolNames(toolResultRequest)).not.toContain(rawName);
        // History replay reuses the alias with the original arguments.
        const replayed = callItem(toolResultRequest, 'function_call', CALL_ID);
        expect(replayed?.['name']).toBe(aliasSeen);
        expect(JSON.parse(String(replayed?.['arguments']))).toEqual({
          value: '42',
        });
        // The image tool result is an input_image part of that call's output.
        const output = callItem(
          toolResultRequest,
          'function_call_output',
          CALL_ID,
        )?.['output'];
        expect(Array.isArray(output)).toBe(true);
        expect(output).toContainEqual({
          type: 'input_image',
          image_url: `data:image/png;base64,${FIXTURE_PNG_B64}`,
        });
      } finally {
        await scenario.teardown();
      }
    },
    SCENARIO_TIMEOUT_MS,
  );

  // S6a: upstream HTTP 400 overflow. S6b: a streamed `response.failed`
  // overflow as the FIRST upstream event, split across two writes. Before any
  // output the proxy answers S6b with the same HTTP 400 prompt-too-long as
  // S6a (it defers the SSE headers), so the real CLI must compact both.
  describe.each([
    ['S6a plain HTTP 400 JSON', 'json' as const],
    [
      'S6b streamed response.failed first, split across two chunks',
      'sse-failed-first' as const,
    ],
  ])('S6 overflow (%s)', (_label, variant) => {
    it(
      'triggers real auto-compaction and a successful retry',
      async () => {
        let roleIHandled = false;
        let roleIIHandled = false;
        let roleIIIHandled = false;
        const scenario = await setupScenario((body) => {
          const hasSeed1 = body.includes('S6-SEED-1');
          const hasTarget = body.includes('S6-TARGET');
          const hasSummary = body.includes('S6-SUMMARY');

          if (!roleIHandled && hasTarget && hasSeed1) {
            roleIHandled = true;
            if (variant === 'json') {
              return { status: 400, jsonText: overflowJsonBody() };
            }
            const wire = overflowFailedWire();
            const splitAt = Math.max(1, Math.floor(wire.length / 2));
            return {
              status: 200,
              chunks: [wire.slice(0, splitAt), wire.slice(splitAt)],
            };
          }
          if (roleIHandled && !roleIIHandled && hasSeed1 && !hasTarget) {
            roleIIHandled = true;
            return {
              sseWire: textWire('Summary of prior turns: S6-SUMMARY'),
            };
          }
          if (
            roleIIHandled &&
            !roleIIIHandled &&
            hasSummary &&
            hasTarget &&
            !hasSeed1
          ) {
            roleIIIHandled = true;
            return { sseWire: textWire('S6-DONE') };
          }
          return undefined; // side query -> generic 'ok'
        });
        try {
          const filler = 'F'.repeat(4000);
          const [seedResult, targetResult] = await runChild(
            scenario.projectDir,
            scenario.env,
            [
              {
                prompt: `S6-SEED-1 ${filler}`,
                options: baseOptions({ maxTurns: 6 }),
              },
              {
                prompt: 'S6-TARGET',
                options: baseOptions({ maxTurns: 6 }),
                resumePrevious: true,
              },
            ],
          );
          if (seedResult.queryError) {
            throw new Error(`S6 seed query() failed: ${seedResult.queryError}`);
          }
          if (targetResult.queryError) {
            throw new Error(
              `S6 target query() failed: ${targetResult.queryError}`,
            );
          }

          // Required: the real CLI compacted (no propagation-only fallback).
          const compactBoundary = targetResult.messages.find(
            (m) =>
              m['type'] === 'system' && m['subtype'] === 'compact_boundary',
          ) as { compact_metadata?: { trigger?: string } } | undefined;
          expect(compactBoundary).toBeDefined();
          expect(compactBoundary?.compact_metadata?.trigger).toBe('auto');
          expect(
            targetResult.messages.indexOf(
              compactBoundary as Record<string, unknown>,
            ),
          ).toBeGreaterThan(0);

          const finalResult = targetResult.messages[
            targetResult.messages.length - 1
          ] as { type?: string; subtype?: string; result?: string } | undefined;
          expect(finalResult?.type).toBe('result');
          expect(finalResult?.subtype).toBe('success');
          expect(finalResult?.result ?? '').toContain('S6-DONE');
          // The summary request and the post-compaction retry both happened.
          expect(roleIIHandled).toBe(true);
          expect(roleIIIHandled).toBe(true);
        } finally {
          await scenario.teardown();
        }
      },
      SCENARIO_TIMEOUT_MS,
    );
  });
});
