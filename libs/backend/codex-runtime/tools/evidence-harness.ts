import { spawn, spawnSync } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync,
  appendFileSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

export const TURN_CAP = 8;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const CASE_DEADLINE_MS = 60_000;
export const USAGE_CEILING = 12_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_EVENTS = 4000;
// codex 0.155.1 has no per-turn output cap (model_max_output_tokens is ignored); user-approved substitute bounds.
export const OUTPUT_BOUNDS = { model_reasoning_effort: 'low', model_verbosity: 'low', tool_output_token_limit: 2000 } as const;
const idSchema = z.union([z.string(), z.number().int()]);
const methodSchema = z.string().max(200).regex(/^[A-Za-z0-9_./:-]+$/);
const header = { jsonrpc: z.literal('2.0').optional(), emittedAtMs: z.number().int().nonnegative().optional() };
const requestFrame = z.object({ ...header, id: idSchema, method: methodSchema, params: z.unknown().optional() }).strict();
const notificationFrame = z.object({ ...header, method: methodSchema, params: z.unknown().optional() }).strict();
const responseFrame = z.object({ ...header, id: idSchema, result: z.unknown() }).strict();
const errorFrame = z.object({ ...header, id: idSchema, error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }) }).strict();
const envelope = z.union([requestFrame, notificationFrame, responseFrame, errorFrame]);
type Frame = z.infer<typeof envelope>;
type RequestFrame = z.infer<typeof requestFrame>;
type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord {
  return z.record(z.string(), z.unknown()).parse(value);
}
function objectId(value: unknown, key: string): string {
  return z.string().parse(record(record(value)[key])['id']);
}

export class TurnBudget {
  private used = 0;
  get consumed(): number { return this.used; }
  claim(): boolean {
    if (this.used >= TURN_CAP) return false;
    this.used += 1;
    return true;
  }
}

// Only literal harness messages and known error names may enter evidence notes.
const failureMessages = new Set([
  'frame too large',
  'Experiment path is a symlink',
  'Experiment overlaps a real Codex home',
  'Path escapes experiment',
  'Unsafe marker parent',
  'Unsafe marker ancestor',
  'Unsafe marker',
  'Marker changed during check',
  'Experiment root is a symlink',
  'Experiment setup failed (details withheld)',
  'Tree kill failed; cleanup cannot safely continue',
  'Unsafe sandbox rejected',
  'Invalid usage',
  'Cumulative usage ceiling reached',
  'unsupported server request',
  'child failed',
  'child closed',
  'invalid or oversized protocol frame',
  'stdin failed',
  'event limit reached',
  'experiment interrupted',
  'approval/isolation gate failed',
  'child stopped',
  'outbound frame too large',
  'not run: cap',
  'RPC timeout',
  'request write failed',
  'child teardown not confirmed',
  'Pinned binary/schema manifest mismatch',
  'Network disable not confirmed by config/read',
  'Observed path escapes experiment',
  'Observed symlink',
  'Unexpected marker effect',
  'Unexpected request',
  'Side effect before approval',
  'Side effect during approval',
  'Approval rejected by safety gate',
  'Notification thread mismatch',
  'Unexpected command',
  'Unexpected file change',
  'Unexpected or repeated tool item',
  'CODEX_HOME isolation mismatch',
  'Selected model not in first model/list page',
  'Effective config differs from bounded profile',
  'No usage evidence; stop before further inference',
  'Planned turn budget exceeds cap',
  'Required: --run --binary <absolute native path> --auth-source <absolute auth.json> --model <id> --out <markdown path>',
  'Use a native executable',
  'Auth source must be auth.json',
  '--out must be a markdown artifact path',
  'Artifact destination overlaps source credentials',
  'Secret cleanup failed',
]);
const errorNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError', 'ZodError', 'AbortError']);
export function recordCaseFailure(result: { notes?: string[] }, error: unknown): void {
  const details = typeof error === 'object' && error !== null ? error : {};
  const message = 'message' in details && typeof details.message === 'string' ? details.message : '';
  const name = 'name' in details && typeof details.name === 'string' && errorNames.has(details.name) ? details.name : 'Error';
  const note = failureMessages.has(message) ? message : `unclassified error (${name})`;
  const notes = result.notes ??= [];
  if (!notes.includes(note)) notes.push(note);
}

/** Buffer bytes, not decoded characters: multibyte sequences may span chunks. */
export class FrameDecoder {
  private pending = Buffer.alloc(0);
  rejectedFrameKeys: string[] = [];
  push(chunk: Buffer): Frame[] {
    const frames: Frame[] = [];
    this.rejectedFrameKeys = [];
    let start = 0;
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      const part = chunk.subarray(start, end);
      if (this.pending.length + part.length > MAX_FRAME_BYTES) throw new Error('frame too large');
      const bytes = Buffer.concat([this.pending, part]);
      this.pending = Buffer.alloc(0);
      if (bytes.length) {
        const value: unknown = JSON.parse(bytes.toString('utf8'));
        const parsed = envelope.safeParse(value);
        if (!parsed.success) {
          this.rejectedFrameKeys = typeof value === 'object' && value !== null && !Array.isArray(value)
            ? Object.keys(value).filter((key) => /^[a-z][A-Za-z0-9]{0,31}$/.test(key)).slice(0, 10) : []; // camelCase protocol keys only: no paths or env names
          throw new Error('invalid or oversized protocol frame');
        }
        frames.push(parsed.data);
      }
      start = end + 1;
    }
    if (this.pending.length + chunk.length - start > MAX_FRAME_BYTES) throw new Error('frame too large');
    this.pending = Buffer.concat([this.pending, chunk.subarray(start)]);
    return frames;
  }
}

/** Artifacts contain summaries, never full wire params, model text, prompts or stderr. */
export function sanitize(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === 'string') {
    let safe = value;
    for (const secret of secrets) if (secret.length > 3) safe = safe.split(secret).join('[REDACTED]');
    return safe.replace(/(?:Bearer\s+)[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
      .replace(/\b(?:access_token|refresh_token|id_token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
      .replace(/\b(?:acct|account|org|user)[_-][A-Za-z0-9_-]+\b/gi, '[REDACTED]')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[REDACTED]')
      .replace(/\b(?:gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/\b(?:account|email|cookie|session|token|refresh)[\w-]*\s*[=:]\s*[^\s,;]+/gi, '[REDACTED]')
      .replace(/\b[A-Za-z0-9_+/=-]{48,}\b/g, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, /auth|secret|password|credential|account|email|cookie|session|token|refresh|api.?key|prompt|stderr/i.test(key) &&
      !(typeof entry === 'number' && /^(inputTokens|outputTokens|totalTokens|cachedInputTokens|reasoningOutputTokens|maxOutputTokens|tool_output_token_limit)$/.test(key))
      ? '[REDACTED]' : /Sha256$/.test(key) && typeof entry === 'string' && /^[a-f0-9]{64}$/.test(entry)
        ? entry : sanitize(entry, secrets)]));
  return value;
}

export interface Experiment { root: string; workspace: string; scratch: string; home: string; }
export const disk = { mkdtempSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, rmSync, realpathSync, lstatSync };

function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}
// Realm-safe: fs errors are not `instanceof Error` inside a Jest VM context.
export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
function missing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}
// Canonicalize the existing ancestor too, so a missing .codex or CODEX_HOME cannot hide overlap.
function canonical(path: string, io: typeof disk): string {
  try { return String(io.realpathSync(path)); }
  catch (error) {
    if (!missing(error) || dirname(path) === path) throw error;
    return join(canonical(dirname(path), io), basename(path));
  }
}
export function assertDisjointHomes(root: string, home: string,
  protectedHomes: readonly string[] = [join(homedir(), '.codex'), ...(process.env['CODEX_HOME'] ? [process.env['CODEX_HOME']] : [])],
  io: typeof disk = disk): void {
  for (const path of [root, home]) {
    if (io.lstatSync(path).isSymbolicLink()) throw new Error('Experiment path is a symlink');
    const actual = String(io.realpathSync(path));
    for (const protectedHome of protectedHomes) {
      const protectedPath = canonical(resolve(protectedHome), io);
      if (within(actual, protectedPath) || within(protectedPath, actual)) throw new Error('Experiment overlaps a real Codex home');
    }
  }
}

/** lstat before and after realpath: dangling links are never interpreted as absence. */
export function markerExists(root: string, path: string): boolean {
  const actualRoot = realpathSync(root);
  if (lstatSync(root).isSymbolicLink() || !within(actualRoot, resolve(path))) throw new Error('Path escapes experiment');
  const inspect = (): boolean => {
    let parent = dirname(resolve(path));
    while (true) {
      if (lstatSync(parent).isSymbolicLink() || !within(actualRoot, realpathSync(parent))) throw new Error('Unsafe marker parent');
      if (parent === actualRoot) break;
      if (dirname(parent) === parent) throw new Error('Unsafe marker ancestor');
      parent = dirname(parent);
    }
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile() || !within(actualRoot, realpathSync(path))) throw new Error('Unsafe marker');
      return true;
    } catch (error) { if (missing(error)) return false; throw error; }
  };
  const before = inspect();
  if (inspect() !== before) throw new Error('Marker changed during check');
  return before;
}

export function createExperiment(authSource: string, io: typeof disk = disk,
  register: (experiment: Experiment) => void = () => undefined): Experiment {
  const createdRoot = io.mkdtempSync(join(tmpdir(), 'ptah-codex-evidence-'));
  if (io.lstatSync(createdRoot).isSymbolicLink()) throw new Error('Experiment root is a symlink');
  const root = String(io.realpathSync(createdRoot));
  const experiment = { root, workspace: join(root, 'workspace'), scratch: join(root, 'scratch'), home: join(root, 'home') };
  register(experiment); // Fatal handlers already installed; expose the auth destination BEFORE the copy.
  try {
    for (const path of [experiment.workspace, experiment.scratch, experiment.home]) io.mkdirSync(path, { mode: 0o700 });
    assertDisjointHomes(root, experiment.home, undefined, io);
    io.copyFileSync(authSource, join(experiment.home, 'auth.json'));
    io.chmodSync(join(experiment.home, 'auth.json'), 0o600);
    return experiment;
  } catch {
    cleanupExperiment(experiment, false, io);
    throw new Error('Experiment setup failed (details withheld)');
  }
}
export function cleanupExperiment(experiment: Experiment, keep: boolean, io: typeof disk = disk): void {
  // Delete the entire home even with --keep: runtime session/auth refresh files may contain secrets.
  try { io.rmSync(join(experiment.home, 'auth.json'), { force: true }); }
  finally {
    try { io.rmSync(experiment.home, { recursive: true, force: true }); }
    finally { if (!keep) io.rmSync(experiment.root, { recursive: true, force: true }); }
  }
}
export function childEnvironment(experiment: Experiment, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|LANG|LC_ALL)$/i.test(key)));
  return { ...env, CODEX_HOME: experiment.home, HOME: experiment.home, USERPROFILE: experiment.home,
    TMP: experiment.scratch, TEMP: experiment.scratch, TMPDIR: experiment.scratch };
}

const caseSchema = z.object({ id: z.string().regex(/^[a-z-]+$/), turnCost: z.number().int().min(0).max(1),
  observations: z.array(z.number()), kind: z.enum(['schema', 'command', 'file', 'boundary', 'mcp', 'compact']),
  level: z.enum(['ask', 'plan', 'auto-edit', 'yolo']).optional(), decision: z.enum(['accept', 'deny']).optional(), purpose: z.string() });
type EvidenceCase = z.infer<typeof caseSchema>;
interface EventSummary { direction: 'in' | 'out'; method: string; }
interface ApprovalSummary { method: string; absentBefore: boolean; response: string; }
interface CaseResult {
  id: string; status: string; turns: number; events: EventSummary[]; approvals: ApprovalSummary[];
  markers?: { original: boolean; replacement: boolean; outside: boolean };
  terminal?: string; usage?: unknown; effectiveConfig?: unknown; notes?: string[];
}
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };
type RpcProcess = EventEmitter & { stdin: Writable; stdout: Readable; stderr: Readable; pid?: number;
  exitCode: number | null; kill: (signal?: NodeJS.Signals) => boolean };

export function killTreeSync(child: RpcProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killed = spawnSync(join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    if (killed.error || killed.status !== 0) {
      try { process.kill(child.pid, 0); }
      catch (error) { if (errorCode(error) === 'ESRCH') return; throw error; }
      throw new Error('Tree kill failed; cleanup cannot safely continue');
    }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (errorCode(error) !== 'ESRCH') throw error; }
  }
}

/** Synchronous and repeatable, including a second Ctrl+C. Kill before deleting credentials. */
export function createFatalCleanup(cleanup: () => void, children: ReadonlySet<RpcChild>,
  exit: (code: number) => void = (code) => process.exit(code)): () => void {
  return () => {
    try {
      for (const child of children) child.stopSync();
      cleanup();
    } finally { exit(1); }
  };
}

export function assertSafeSandbox(value: unknown): void {
  if (typeof value === 'string' && /^(danger-?full-?access|external-?sandbox)$/i.test(value)) throw new Error('Unsafe sandbox rejected');
  if (Array.isArray(value)) value.forEach(assertSafeSandbox);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertSafeSandbox);
}

export class UsageBudget {
  private readonly totals = new Map<string, number>();
  get consumed(): number { return [...this.totals.values()].reduce((sum, count) => sum + count, 0); }
  observe(id: string, count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid usage');
    this.totals.set(id, Math.max(count, this.totals.get(id) ?? 0));
    if (this.consumed >= USAGE_CEILING) throw new Error('Cumulative usage ceiling reached');
  }
}

export class RpcChild {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly decoder = new FrameDecoder();
  private failure: Error | undefined;
  private ending = false;
  private treeKilled = false;
  private readonly exited: Promise<void>;
  private handlers: Promise<void> = Promise.resolve();
  onRequest: (frame: RequestFrame) => Promise<void> = async (frame) => {
    this.decline(frame.id);
    throw new Error('unsupported server request');
  };
  private readonly answered = new Set<string | number>();
  denyLiteral = 'decline'; // Fallback from batch-1a research/review; recorded as unverified unless schema confirms it.
  onNotification: (method: string, params: unknown) => void = () => undefined;
  constructor(private readonly child: RpcProcess, private readonly result: CaseResult) {
    this.exited = new Promise((done) => child.once('close', done));
    child.stderr.resume(); // Never retain stderr: it can include credentials and prompts.
    child.on('error', () => this.fail(new Error('child failed')));
    child.on('close', () => { if (!this.ending) this.fail(new Error('child closed')); });
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.decoder.push(chunk)) this.receive(frame);
      } catch (error) {
        const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined;
        this.fail(new Error(typeof message === 'string' && failureMessages.has(message) ? message : 'invalid or oversized protocol frame'));
        const keys = `Rejected frame keys: ${this.decoder.rejectedFrameKeys.join(', ')}`;
        const notes = this.result.notes ??= [];
        if (this.decoder.rejectedFrameKeys.length && !notes.includes(keys)) notes.push(keys);
        this.stopSync();
      }
    });
    child.stdin.on('error', () => this.fail(new Error('stdin failed')));
  }
  private event(direction: 'in' | 'out', method: string): void {
    if (this.result.events.length >= MAX_EVENTS) throw new Error('event limit reached');
    this.result.events.push({ direction, method });
  }
  private fail(error: Error): void {
    if (!this.failure && !this.ending) recordCaseFailure(this.result, error);
    this.failure ??= error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
    this.pending.clear();
  }
  assertHealthy(): void { if (this.failure) throw this.failure; }
  abort(): void { this.fail(new Error('experiment interrupted')); this.stopSync(); }
  private receive(frame: Frame): void {
    if ('method' in frame) {
      try { this.event('in', frame.method); }
      catch (error) { if ('id' in frame) this.decline(frame.id); throw error; }
      if ('id' in frame) {
        if (this.failure || this.ending) { this.decline(frame.id); return; }
        this.handlers = this.handlers.then(() => {
          if (this.failure || this.ending) { this.decline(frame.id); return; }
          return this.onRequest(frame);
        }).catch(() => {
          this.decline(frame.id);
          this.fail(new Error('approval/isolation gate failed'));
          this.stopSync();
        });
      } else this.onNotification(frame.method, frame.params);
    } else if (typeof frame.id === 'number') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      if ('error' in frame) pending.reject(new Error(`RPC error ${frame.error.code}`));
      else pending.resolve(frame.result);
    }
  }
  private write(frame: object): void {
    this.assertHealthy();
    if (this.ending) throw new Error('child stopped');
    const bytes = JSON.stringify(frame) + '\n';
    if (Buffer.byteLength(bytes) > MAX_FRAME_BYTES) throw new Error('outbound frame too large');
    this.child.stdin.write(bytes);
  }
  async request(method: string, params: object, budget?: TurnBudget): Promise<unknown> {
    assertSafeSandbox(params);
    if (method === 'turn/start' || method === 'thread/compact/start') {
      if (!budget?.claim()) { this.result.status = 'not run: cap'; throw new Error('not run: cap'); }
      this.result.turns += 1;
    }
    this.assertHealthy();
    this.event('out', method);
    const id = ++this.nextId;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('RPC timeout')); this.fail(new Error('RPC timeout')); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      try { this.write({ id, method, params }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('request write failed')); }
    });
  }
  notify(method: string): void { this.event('out', method); this.write({ method }); }
  respond(id: string | number, result: object): void { this.write({ id, result }); this.answered.add(id); }
  decline(id: string | number): void {
    if (this.answered.has(id)) return;
    this.answered.add(id);
    // Deliberately bypass assertHealthy: even a failed case must answer pending requests.
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.write(JSON.stringify({ id, result: { decision: this.denyLiteral } }) + '\n');
    }
  }
  stopSync(): void {
    if (!this.treeKilled) { killTreeSync(this.child); this.treeKilled = true; }
    this.ending = true;
    this.fail(new Error('child stopped'));
  }
  async stop(): Promise<void> {
    this.stopSync();
    this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('child teardown not confirmed')), 5000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
    await this.handlers;
  }
}

// Shared by the exact approved command and the local MCP fixture. No arbitrary path argument from the model.
const MARKER_WRITER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
function writeMarker(root, target) {
  const actualRoot = fs.realpathSync(root);
  const within = value => {
    const suffix = path.relative(actualRoot, value);
    return suffix === '' || (!path.isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + path.sep));
  };
  const check = () => {
    if (fs.lstatSync(root).isSymbolicLink() || !within(path.resolve(target))) throw Error('unsafe root');
    let parent = path.dirname(target);
    while (true) {
      if (fs.lstatSync(parent).isSymbolicLink() || !within(fs.realpathSync(parent))) throw Error('unsafe parent');
      if (parent === actualRoot) break;
      if (path.dirname(parent) === parent) throw Error('unsafe ancestor');
      parent = path.dirname(parent);
    }
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile() || !within(fs.realpathSync(target))) throw Error('unsafe marker');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  check();
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { check(); fs.writeSync(fd, 'marker'); check(); } finally { fs.closeSync(fd); }
}
`;
const MCP_FIXTURE = MARKER_WRITER + String.raw`
const readline = require('node:readline');
const allowed = JSON.parse(process.argv[2]);
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (Buffer.byteLength(line) > 65536) { process.exitCode = 1; rl.close(); return; }
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (!('id' in request)) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'isolated-marker', version: '1.0.0' } };
  else if (request.method === 'tools/list') result = { tools: [{ name: 'write_marker', description: 'Write a harmless isolated marker', inputSchema: { type: 'object', properties: { slot: { type: 'string', enum: ['original', 'replacement'] } }, required: ['slot'], additionalProperties: false } }] };
  else if (request.method === 'tools/call' && request.params.name === 'write_marker') {
    const slot = request.params.arguments?.slot;
    if (!['original', 'replacement'].includes(slot)) { send({ id: request.id, error: { code: -32602, message: 'invalid marker slot' } }); return; }
    if (slot !== 'original') { send({ id: request.id, error: { code: -32602, message: 'only fixed marker allowed' } }); return; }
    try { writeMarker(allowed.root, allowed.original); }
    catch { send({ id: request.id, error: { code: -32603, message: 'marker confinement failed' } }); process.exitCode = 1; rl.close(); return; }
    result = { content: [{ type: 'text', text: 'marker written' }] };
  } else { send({ id: request.id, error: { code: -32601, message: 'unsupported method' } }); return; }
  send({ id: request.id, result });
});
process.stdin.on('end', () => rl.close());
`;

const manifestSchema = z.object({ pinnedVersion: z.literal('0.155.1'), binaryPath: z.string(),
  binarySha256: z.string(), schemaSha256: z.string(), platform: z.string(), arch: z.string(),
  methods: z.object({ requests: z.array(z.string()), serverRequests: z.array(z.string()),
    clientNotifications: z.array(z.string()), serverNotifications: z.array(z.string()) }) });
type Manifest = z.infer<typeof manifestSchema>;
function digest(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function loadManifest(binary: string): { manifest: Manifest; schemaText: string } {
  const directory = resolve(__dirname, '../src/lib/protocol');
  const schemaPath = join(directory, 'codex-app-server-protocol.schema.json');
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(directory, 'codex-app-server-protocol.manifest.json'), 'utf8')));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch ||
    realpathSync(manifest.binaryPath) !== binary || digest(binary) !== manifest.binarySha256 || digest(schemaPath) !== manifest.schemaSha256) {
    throw new Error('Pinned binary/schema manifest mismatch');
  }
  return { manifest, schemaText: readFileSync(schemaPath, 'utf8') };
}
function delay(ms: number): Promise<void> { return new Promise((done) => setTimeout(done, ms)); }
function markerState(root: string, original: string, replacement: string, outside: string): NonNullable<CaseResult['markers']> {
  return { original: markerExists(root, original), replacement: markerExists(root, replacement), outside: markerExists(root, outside) };
}
export function policy(level: EvidenceCase['level']): { sandbox: string; approvalPolicy: string } {
  const selected = { sandbox: level === 'yolo' || level === 'auto-edit' ? 'workspace-write' : 'read-only', approvalPolicy: 'on-request' };
  assertSafeSandbox(selected);
  return selected;
}
function configSummary(value: unknown): unknown {
  const config = record(record(value)['config']);
  assertSafeSandbox(config);
  if (record(config['sandbox_workspace_write'] ?? {})['network_access'] !== false) throw new Error('Network disable not confirmed by config/read');
  return Object.fromEntries(['model', 'sandbox_mode', 'approval_policy', 'sandbox_workspace_write', ...Object.keys(OUTPUT_BOUNDS)].map((key) => [key, config[key]]));
}
function usageSummary(params: unknown): unknown {
  const data = record(params);
  const usage = record(data['tokenUsage'] ?? {});
  const totals = record(usage['total'] ?? {});
  return Object.fromEntries(Object.entries(totals).filter(([, value]) => typeof value === 'number'));
}

export interface MarkerApproval {
  kind: EvidenceCase['kind']; level: EvidenceCase['level']; decision: EvidenceCase['decision'];
  threadId: string; expectedCommand: string; target: string; workspace: string; root: string;
  validatedFileItems: ReadonlySet<string>; approvals: number;
}
/** The only accept decision in the harness: exact command, exact validated file, or fixed local MCP call. */
export function markerApprovalDecision(frame: RequestFrame, context: MarkerApproval): 'accept' | 'decline' {
  const params = record(frame.params ?? {});
  if (context.approvals !== 0 || context.level === 'plan' || context.decision !== 'accept' || params['threadId'] !== context.threadId) return 'decline';
  if (typeof params['cwd'] === 'string' && resolve(params['cwd']) !== context.workspace) return 'decline';
  markerExists(context.root, context.target);
  if ((context.kind === 'command' || context.kind === 'boundary') && frame.method === 'item/commandExecution/requestApproval') {
    return params['command'] === context.expectedCommand ? 'accept' : 'decline';
  }
  if (context.kind === 'file' && frame.method === 'item/fileChange/requestApproval') {
    return typeof params['itemId'] === 'string' && context.validatedFileItems.has(params['itemId']) ? 'accept' : 'decline';
  }
  if (context.kind === 'mcp' && frame.method === 'item/mcpToolCall/requestApproval' && params['server'] === 'marker' && params['toolName'] === 'write_marker') {
    const args = record(params['arguments'] ?? {});
    return args['slot'] === 'original' && Object.keys(args).length === 1 ? 'accept' : 'decline';
  }
  return 'decline';
}

function checkObservedPaths(root: string, workspace: string, value: unknown): void {
  if (Array.isArray(value)) { value.forEach((entry) => checkObservedPaths(root, workspace, entry)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(paths|filePaths|writableRoots|roots)$/i.test(key) && Array.isArray(entry)) {
      for (const path of entry) checkObservedPaths(root, workspace, { path });
      continue;
    }
    if (/^(path|cwd|filePath|file_path|file|root|writableRoot|grantRoot)$/i.test(key) && typeof entry === 'string') {
      const path = resolve(workspace, entry);
      const actualRoot = realpathSync(root);
      if (!within(actualRoot, path) || !within(actualRoot, canonical(path, disk))) throw new Error('Observed path escapes experiment');
      // Directory paths are allowed as metadata, but symlinks at any component are not.
      let cursor = path;
      while (cursor !== actualRoot) {
        try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Observed symlink'); }
        catch (error) { if (!missing(error)) throw error; }
        if (dirname(cursor) === cursor) throw new Error('Observed path escapes experiment');
        cursor = dirname(cursor);
      }
    } else checkObservedPaths(root, workspace, entry);
  }
}

function schemaDenial(schemaText: string, method: string): { literal: string; verified: boolean } {
  const schema = record(JSON.parse(schemaText));
  const definitions = record(schema['definitions'] ?? schema['$defs'] ?? {});
  const literals = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(literals);
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, entry]) => key === 'const' && typeof entry === 'string' ? [entry]
      : key === 'enum' && Array.isArray(entry) ? entry.filter((item): item is string => typeof item === 'string') : literals(entry));
  };
  const name = method === 'item/commandExecution/requestApproval' ? 'CommandExecutionApprovalDecision'
    : method === 'item/fileChange/requestApproval' ? 'FileChangeApprovalDecision'
      : method === 'item/mcpToolCall/requestApproval' ? 'McpToolCallApprovalDecision' : '';
  const values = literals(definitions[name]);
  return values.includes('decline') ? { literal: 'decline', verified: true }
    : values.includes('deny') ? { literal: 'deny', verified: true } : { literal: 'decline', verified: false };
}

async function runCase(item: EvidenceCase, result: CaseResult, experiment: Experiment, binary: string,
  model: string, budget: TurnBudget, usage: UsageBudget, manifest: Manifest, schemaText: string,
  compact: boolean, children: Set<RpcChild>): Promise<void> {
  const original = join(experiment.workspace, `${item.id}.marker`);
  const replacement = join(experiment.workspace, `${item.id}.replacement.marker`);
  const outside = join(experiment.scratch, `${item.id}.marker`);
  const target = item.kind === 'file' ? outside : original;
  const fixture = join(experiment.root, `${item.id}-mcp.cjs`);
  writeFileSync(fixture, MCP_FIXTURE, { flag: 'wx', mode: 0o600 });
  const selected = policy(item.level);
  const shellQuote = (value: string): string => process.platform === 'win32'
    ? "'" + value.replace(/'/g, "''") + "'" : "'" + value.replace(/'/g, "'\\''") + "'";
  const markerScript = MARKER_WRITER + ';writeMarker(process.argv[1],process.argv[2]);';
  const expectedCommand = (process.platform === 'win32' ? '& ' : '') +
    [process.execPath, '-e', markerScript, experiment.root, target].map(shellQuote).join(' ');
  const overrides = [
    `mcp_servers.marker.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.marker.args=${JSON.stringify([fixture, JSON.stringify({ root: experiment.root, original })])}`,
    `mcp_servers.marker.enabled=${item.kind === 'mcp'}`,
    ...Object.entries(OUTPUT_BOUNDS).map(([key, value]) => `${key}=${JSON.stringify(value)}`), 'web_search="disabled"', 'features.apps=false',
    'sandbox_workspace_write.network_access=false',
    `sandbox_mode=${JSON.stringify(selected.sandbox)}`, `approval_policy=${JSON.stringify(selected.approvalPolicy)}`,
  ];
  assertSafeSandbox(selected);
  const child = spawn(binary, [...overrides.flatMap((entry) => ['-c', entry]), 'app-server'], {
    cwd: experiment.workspace, env: childEnvironment(experiment), stdio: 'pipe', shell: false,
    windowsHide: true, detached: process.platform !== 'win32',
  });
  const rpc = new RpcChild(child, result);
  children.add(rpc);
  let threadId = '';
  let turnId = '';
  let terminal: string | undefined;
  let compacted = false;
  let compacting = false;
  let interrupted = false;
  let outcome = false;
  let approvalPending = false;
  let approvalRounds = 0;
  let toolItems = 0;
  const validatedFileItems = new Set<string>();
  const interrupt = (): void => {
    if (interrupted || !turnId || compacting) return;
    interrupted = true;
    void rpc.request('turn/interrupt', { threadId, turnId }).catch(() => rpc.abort());
  };
  const inspect = (): void => {
    const state = markerState(experiment.root, original, replacement, outside);
    const present = target === outside ? state.outside : state.original;
    if (state.replacement || (target === outside ? state.original : state.outside) ||
      (present && (approvalPending || result.approvals[0]?.response !== 'accept'))) throw new Error('Unexpected marker effect');
    if (present || result.approvals[0]?.response === 'decline') { outcome = true; interrupt(); }
  };
  // One bounded poll per child, always released below; never one poll per event/item.
  const guard = setInterval(() => { try { inspect(); } catch { rpc.abort(); } }, 20);
  const deadline = setTimeout(() => rpc.abort(), CASE_DEADLINE_MS);
  rpc.onRequest = async (frame) => {
    let answered = false;
    try {
      const denial = schemaDenial(schemaText, frame.method);
      rpc.denyLiteral = denial.literal;
      result.notes?.push(`Denial literal ${denial.literal}: ${denial.verified ? 'found in method approval schema; wire behavior unverified' : 'unverified fallback from batch-1a review; research does not establish per-method response shape'}`);
      checkObservedPaths(experiment.root, experiment.workspace, frame.params);
      const context: MarkerApproval = { kind: item.kind, level: item.level, decision: item.decision,
        threadId, expectedCommand, target, root: experiment.root, workspace: experiment.workspace,
        validatedFileItems, approvals: approvalRounds };
      // Validate identity independently of the selected decline policy.
      const fixed = markerApprovalDecision(frame, { ...context, level: 'ask', decision: 'accept' }) === 'accept';
      if (!manifest.methods.serverRequests.includes(frame.method) || !fixed || compacting) throw new Error('Unexpected request');
      approvalRounds += 1;
      approvalPending = true;
      if (markerExists(experiment.root, target)) throw new Error('Side effect before approval');
      await delay(200);
      rpc.assertHealthy();
      if (markerExists(experiment.root, target)) throw new Error('Side effect during approval');
      const decision = markerApprovalDecision(frame, context);
      if (decision === 'decline') rpc.decline(frame.id);
      else rpc.respond(frame.id, { decision: 'accept' });
      answered = true;
      result.approvals.push({ method: frame.method, absentBefore: true, response: decision });
      approvalPending = false;
      inspect();
    } catch {
      if (!answered) rpc.decline(frame.id);
      interrupt();
      rpc.abort();
      throw new Error('Approval rejected by safety gate');
    }
  };
  rpc.onNotification = (method, params) => {
    const data = record(params ?? {});
    checkObservedPaths(experiment.root, experiment.workspace, data);
    if (typeof data['threadId'] === 'string' && threadId && data['threadId'] !== threadId) throw new Error('Notification thread mismatch');
    if (method === 'item/started' || method === 'item/completed') {
      const observed = record(data['item']);
      if (observed['type'] === 'commandExecution') {
        if (observed['command'] !== expectedCommand) throw new Error('Unexpected command');
      }
      if (observed['type'] === 'fileChange') {
        const changes = z.array(z.object({ path: z.string() })).parse(observed['changes']);
        if (item.kind !== 'file' || changes.length !== 1 || resolve(experiment.workspace, changes[0].path) !== target) throw new Error('Unexpected file change');
        markerExists(experiment.root, target);
        if (method === 'item/started') validatedFileItems.add(z.string().parse(observed['id']));
      }
      if (method === 'item/started' && !['reasoning', 'agentMessage', 'userMessage', 'contextCompaction'].includes(String(observed['type']))) {
        if (!['commandExecution', 'fileChange', 'mcpToolCall'].includes(String(observed['type'])) || ++toolItems > 1) throw new Error('Unexpected or repeated tool item');
      }
      compacted ||= method === 'item/completed' && observed['type'] === 'contextCompaction';
    }
    if (method === 'turn/completed') terminal = z.string().parse(record(data['turn'])['status']);
    if (method === 'thread/tokenUsage/updated') {
      result.usage = usageSummary(params);
      usage.observe(item.id, z.number().int().nonnegative().parse(record(result.usage)['totalTokens']));
    }
    inspect();
  };
  try {
    const init = record(await rpc.request('initialize', { clientInfo: { name: 'ptah_evidence', version: '0.0.1' }, capabilities: { experimentalApi: false } }));
    if (typeof init['codexHome'] !== 'string' || realpathSync(init['codexHome']) !== realpathSync(experiment.home)) throw new Error('CODEX_HOME isolation mismatch');
    rpc.notify('initialized');
    const models = record(await rpc.request('model/list', {}));
    if (!z.array(z.object({ id: z.string(), model: z.string().optional() })).parse(models['data']).some((entry) => entry.id === model || entry.model === model)) throw new Error('Selected model not in first model/list page');
    result.effectiveConfig = configSummary(await rpc.request('config/read', { includeLayers: false }));
    const effective = record(result.effectiveConfig);
    if (Object.entries(OUTPUT_BOUNDS).some(([key, value]) => effective[key] !== value) || effective['sandbox_mode'] !== selected.sandbox || effective['approval_policy'] !== selected.approvalPolicy) throw new Error('Effective config differs from bounded profile');
    const thread = await rpc.request('thread/start', { model, cwd: experiment.workspace, ...selected, ephemeral: true,
      developerInstructions: 'Evidence experiment. Only the single requested marker may be touched. Do not inspect credentials, config, home, environment or network. No subagents. No retries. Stop after one tool action.' });
    assertSafeSandbox(thread);
    threadId = objectId(thread, 'thread');
    const prompt = item.kind === 'mcp' ? 'Use only marker MCP write_marker once with slot original. No other tools or retries.'
      : item.kind === 'file' ? `Use the file edit tool once to create ${target} containing marker. Request approval. No commands or retries.`
      : `Run exactly this command once, without wrappers or changes: ${expectedCommand}. Request approval. No other tools or retries.`;
    const sandboxPolicy = selected.sandbox === 'read-only'
      ? { type: 'readOnly', networkAccess: false }
      : { type: 'workspaceWrite', writableRoots: [experiment.workspace], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
    const started = await rpc.request('turn/start', { threadId, model, sandboxPolicy, approvalPolicy: selected.approvalPolicy,
      input: [{ type: 'text', text: prompt, text_elements: [] }] }, budget);
    turnId = objectId(started, 'turn');
    if (outcome) interrupt();
    while (!terminal) { rpc.assertHealthy(); inspect(); await delay(20); }
    rpc.assertHealthy();
    inspect();
    result.terminal = terminal;
    result.markers = markerState(experiment.root, original, replacement, outside);
    result.status = outcome && result.approvals.length === 1 ? 'observed' : 'unverified: required gate not observed';
    if (compact && result.status === 'observed' && manifest.methods.requests.includes('thread/compact/start')) {
      compacting = true;
      result.notes?.push('Compaction shares the case deadline and usage ceiling; separately charged model invocation.');
      await rpc.request('thread/compact/start', { threadId }, budget);
      while (!compacted) { rpc.assertHealthy(); await delay(20); }
      result.notes?.push('compaction completion observed');
    }
    if (!result.usage) throw new Error('No usage evidence; stop before further inference');
  } finally {
    clearInterval(guard);
    clearTimeout(deadline);
    await rpc.stop();
    children.delete(rpc);
    result.markers = markerState(experiment.root, original, replacement, outside);
  }
}

export interface HarnessOptions { run: boolean; dryRun: boolean; keep: boolean; binary?: string; authSource?: string; model?: string; out?: string; }
export function parseOptions(args: string[]): HarnessOptions {
  const { values } = parseArgs({ args, strict: true, options: { run: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    keep: { type: 'boolean' }, binary: { type: 'string' }, 'auth-source': { type: 'string' }, model: { type: 'string' }, out: { type: 'string' } } });
  return { run: values.run === true, dryRun: values['dry-run'] === true || values.run !== true, keep: values.keep === true,
    binary: values.binary, authSource: values['auth-source'], model: values.model, out: values.out };
}
export async function runHarness(options: HarnessOptions, cases: readonly EvidenceCase[],
  print: (text: string) => void = (text) => process.stdout.write(text), io: typeof disk = disk): Promise<void> {
  if (cases.reduce((total, item) => total + item.turnCost, 0) > TURN_CAP) throw new Error('Planned turn budget exceeds cap');
  if (!options.run || options.dryRun) {
    print(JSON.stringify({ mode: 'dry-run', cap: TURN_CAP, outputBounds: OUTPUT_BOUNDS, usageCeiling: USAGE_CEILING, caseDeadlineMs: CASE_DEADLINE_MS, cases }, null, 2) + '\n');
    return;
  }
  const { binary: binaryInput, authSource, model, out } = options;
  if (!binaryInput || !authSource || !model || !out || !isAbsolute(binaryInput) || !isAbsolute(authSource)) {
    throw new Error('Required: --run --binary <absolute native path> --auth-source <absolute auth.json> --model <id> --out <markdown path>');
  }
  const binary = realpathSync(binaryInput);
  if (/\.(cmd|bat|js|mjs)$/i.test(binary)) throw new Error('Use a native executable');
  const { manifest, schemaText } = loadManifest(binary);
  const output = resolve(out);
  if (basename(authSource).toLowerCase() !== 'auth.json') throw new Error('Auth source must be auth.json');
  if (!/\.md$/i.test(output)) throw new Error('--out must be a markdown artifact path');
  const authPath = realpathSync(authSource);
  const outputJson = output.replace(/\.md$/i, '.json');
  if ([output, outputJson].some((path) => resolve(path) === resolve(authSource) ||
    (existsSync(path) && realpathSync(path) === authPath))) throw new Error('Artifact destination overlaps source credentials');
  const budget = new TurnBudget();
  const usage = new UsageBudget();
  const results: CaseResult[] = [];
  let experiment: Experiment | undefined;
  const children = new Set<RpcChild>();
  let cleanup = 'pending';
  let stop = false;
  const signal = createFatalCleanup(() => { if (experiment) cleanupExperiment(experiment, options.keep, io); }, children);
  const fatalEvents = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  for (const event of fatalEvents) process.on(event, signal);
  try {
    experiment = createExperiment(authSource, io, (created) => { experiment = created; });
    for (const item of cases) {
      const result: CaseResult = { id: item.id, status: 'not run', turns: 0, events: [], approvals: [], notes: [] };
      results.push(result);
      if (item.kind === 'schema') {
        result.status = 'schema only';
        result.notes = [item.id === 'modified-input-schema'
          ? `modifiedInput property present: ${schemaText.includes('"modifiedInput"')}; wire response and behavior unverified; no invented mapping`
          : `Method presence only: ${Object.values(manifest.methods).flat().filter((method) => /userInput|plan|agent|rollback|resume|compact|skills/i.test(method)).join(', ')}`];
        continue;
      }
      if (item.kind === 'compact') {
        const source = results.find((entry) => entry.id === 'ask-command-accept');
        if (source && source.turns > 1) { result.turns = source.turns - 1; source.turns = 1; }
        result.status = source?.notes?.includes('compaction completion observed') ? 'observed' : 'unverified: compaction not observed';
        result.notes = ['Reserved invocation is charged on the retained accepted-command child.'];
        continue;
      }
      if (stop || usage.consumed >= USAGE_CEILING) { result.status = 'not run: prior gate or usage ceiling'; continue; }
      if (budget.consumed >= TURN_CAP) { result.status = 'not run: cap'; continue; }
      try {
        await runCase(item, result, experiment, binary, model, budget, usage, manifest, schemaText, item.id === 'ask-command-accept', children);
        if (result.status !== 'observed') stop = true;
      } catch (error) {
        recordCaseFailure(result, error);
        result.status = result.status === 'not run: cap' ? result.status : 'failed: protocol, isolation or approval gate';
        stop = true;
      }
    }
  } finally {
    try {
      for (const child of children) child.stopSync();
      if (experiment) cleanupExperiment(experiment, options.keep, io);
      cleanup = 'home/auth deleted; experiment ' + (options.keep ? 'non-home files retained' : 'deleted');
    }
    catch { cleanup = 'FAILED: manual cleanup required'; }
    finally { for (const event of fatalEvents) process.removeListener(event, signal); }
    const artifact = sanitize({ provenance: 'real run requested; individual observations only', model, binary,
      binarySha256: manifest.binarySha256, schemaSha256: manifest.schemaSha256, platform: process.platform, arch: process.arch,
      cap: TURN_CAP, turnsConsumed: budget.consumed, outputBounds: OUTPUT_BOUNDS, usageCeiling: USAGE_CEILING,
      observedUsage: usage.consumed, caseDeadlineMs: CASE_DEADLINE_MS, cleanup, results,
      harnessCapabilities: [
        ['Plan entry/read-only planning', 'plan'], ['AskUserQuestion', 'userInput'], ['ExitPlanMode', 'plan'],
        ['Subagent spawn/list/background', 'agent'], ['Agent reporting/interrupted context', 'agent'],
        ['Edited input/remembered permissions', 'Approval'], ['Compact/file rewind', 'compact|rollback'],
        ['Skills/instruction harness', 'skills'],
      ].map(([capability, pattern]) => ({ capability, behavior: 'unverified; case observations do not establish parity',
        schemaMethods: Object.values(manifest.methods).flat().filter((method) => new RegExp(pattern, 'i').test(method)) })),
      gaps: ['modifiedInput behavior', 'Always Allow', 'native plan transitions and user answers/cancel', 'subagent lifecycle',
        'remote MCP/OAuth/Smithery', 'skills/instructions/images/effort/resume role parity', 'same-home concurrent profile isolation',
        'different-account isolation', 'file rewind/history/stats', 'packaged binary manifests',
        'positive read and multi-path sandbox boundaries are not proved by single-action cases',
        'usage reporting can lag billing; observed usage ceiling is not a provider-side spending limit'] });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(outputJson, JSON.stringify(artifact, null, 2) + '\n');
    appendFileSync(output, String(sanitize('\n| Case | Status | Charged turns |\n| --- | --- | ---: |\n' + results.map((entry) =>
      `| ${entry.id} | ${entry.status} | ${entry.turns} |`).join('\n') + `\n\nTotal: ${budget.consumed}/${TURN_CAP}. Usage ceiling: ${USAGE_CEILING}. Cleanup: ${cleanup}.\n`)));
    // A failed secret cleanup must surface even when the run itself threw, so it overrides that error.
    // eslint-disable-next-line no-unsafe-finally
    if (cleanup.startsWith('FAILED')) throw new Error('Secret cleanup failed');
  }
}

if (require.main === module) {
  const cases = z.array(caseSchema).parse(JSON.parse(readFileSync(join(__dirname, 'evidence-cases.json'), 'utf8')));
  void runHarness(parseOptions(process.argv.slice(2)), cases).catch(() => {
    process.stderr.write('Evidence harness failed; sensitive error details withheld. Check prerequisites and sanitized results.\n');
    process.exitCode = 1;
  });
}
