import { runRoundCase, schemaProbe } from './evidence-cases-round';
import { spawn, spawnSync } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  rmSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  relative,
  sep,
} from 'node:path';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  FrameDecoder,
  MAX_FRAME_BYTES,
  type Frame,
  type RequestFrame,
} from './evidence-frames';
import {
  createPathRedactor,
  failureMessages,
  recordCaseFailure,
  recordCommandShape,
} from './evidence-failure-notes';
export const TURN_CAP = 8;
// decisions.md records 19 used of 35 approved, including the failed first 7a.
const MAX_APPROVED_TURN_CAP = 16;
export const CASE_DEADLINE_MS = 60_000;
export function caseDeadlineMs(item: Pick<EvidenceCase, 'turnCost'>): number {
  return Math.min(225_000, Math.max(CASE_DEADLINE_MS, item.turnCost * 75_000));
}
export function shouldStopAfterCase(status: string): boolean {
  return status !== 'observed' && !status.startsWith('unverified:');
}
export const USAGE_TURN_LIMIT = 30_000;
export const USAGE_CUMULATIVE_LIMIT = 100_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_EVENTS = 4000;
// codex 0.155.1 has no per-turn output cap (model_max_output_tokens is ignored); user-approved substitute bounds.
export const OUTPUT_BOUNDS = {
  model_reasoning_effort: 'low',
  model_verbosity: 'low',
  tool_output_token_limit: 2000,
} as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return z.record(z.string(), z.unknown()).parse(value);
}

function objectId(value: unknown, key: string): string {
  return z.string().parse(record(record(value)[key])['id']);
}

export class TurnBudget {
  private used = 0;
  constructor(readonly cap = TURN_CAP) {
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_APPROVED_TURN_CAP)
      throw new Error(
        `Turn cap must be an integer from 1 to ${MAX_APPROVED_TURN_CAP}`,
      );
  }
  get consumed(): number {
    return this.used;
  }
  observeTurn(): boolean {
    this.used += 1;
    return this.used <= this.cap;
  }
  claim(): boolean {
    if (this.used >= this.cap) return false;
    this.used += 1;
    return true;
  }
}

/** Artifacts contain summaries, never full wire params, model text, prompts or stderr. */

export function sanitize(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  if (typeof value === 'string') {
    let safe = value;
    for (const secret of secrets)
      if (secret.length > 3) safe = safe.split(secret).join('[REDACTED]');
    return safe
      .replace(/(?:Bearer\s+)[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(
        /\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
        '[REDACTED]',
      )
      .replace(
        /\b(?:access_token|refresh_token|id_token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
        '[REDACTED]',
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
      .replace(
        /<USER_HOME>|\b(?:acct|account|org|user)[_-][A-Za-z0-9_-]+\b/gi,
        (match) => (match === '<USER_HOME>' ? match : '[REDACTED]'),
      )
      .replace(
        /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi,
        '[REDACTED]',
      )
      .replace(/\b(?:gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(
        /\b(?:account|email|cookie|session|token|refresh)[\w-]*\s*[=:]\s*[^\s,;]+/gi,
        '[REDACTED]',
      )
      .replace(/\b[A-Za-z0-9_+/=-]{48,}\b/g, '[REDACTED]');
  }
  if (Array.isArray(value))
    return value.map((entry) => sanitize(entry, secrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /auth|secret|password|credential|account|email|cookie|session|token|refresh|api.?key|prompt|stderr/i.test(
          key,
        ) &&
        !(
          typeof entry === 'number' &&
          /^(inputTokens|outputTokens|totalTokens|cachedInputTokens|reasoningOutputTokens|maxOutputTokens|tool_output_token_limit)$/.test(
            key,
          )
        )
          ? '[REDACTED]'
          : /Sha256$/.test(key) &&
              typeof entry === 'string' &&
              /^[a-f0-9]{64}$/.test(entry)
            ? entry
            : sanitize(entry, secrets),
      ]),
    );
  return value;
}

export interface Experiment {
  root: string;
  workspace: string;
  scratch: string;
  home: string;
  additionalHomes?: string[];
}
export const disk = {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  rmSync,
  realpathSync,
  lstatSync,
};

function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return (
    suffix === '' ||
    (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
  );
}
// Realm-safe: fs errors are not `instanceof Error` inside a Jest VM context.

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

function missing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}
// Canonicalize the existing ancestor too, so a missing .codex or CODEX_HOME cannot hide overlap.

function canonical(path: string, io: typeof disk): string {
  try {
    return String(io.realpathSync(path));
  } catch (error) {
    if (!missing(error) || dirname(path) === path) throw error;
    return join(canonical(dirname(path), io), basename(path));
  }
}

export function assertDisjointHomes(
  root: string,
  home: string,
  protectedHomes: readonly string[] = [
    join(homedir(), '.codex'),
    ...(process.env['CODEX_HOME'] ? [process.env['CODEX_HOME']] : []),
  ],
  io: typeof disk = disk,
): void {
  for (const path of [root, home]) {
    if (io.lstatSync(path).isSymbolicLink())
      throw new Error('Experiment path is a symlink');
    const actual = String(io.realpathSync(path));
    for (const protectedHome of protectedHomes) {
      const protectedPath = canonical(resolve(protectedHome), io);
      if (within(actual, protectedPath) || within(protectedPath, actual))
        throw new Error('Experiment overlaps a real Codex home');
    }
  }
}

/** lstat before and after realpath: dangling links are never interpreted as absence. */

export function markerExists(root: string, path: string): boolean {
  const actualRoot = realpathSync(root);
  if (lstatSync(root).isSymbolicLink() || !within(actualRoot, resolve(path)))
    throw new Error('Path escapes experiment');
  const inspect = (): boolean => {
    let parent = dirname(resolve(path));
    while (true) {
      if (
        lstatSync(parent).isSymbolicLink() ||
        !within(actualRoot, realpathSync(parent))
      )
        throw new Error('Unsafe marker parent');
      if (parent === actualRoot) break;
      if (dirname(parent) === parent) throw new Error('Unsafe marker ancestor');
      parent = dirname(parent);
    }
    try {
      const stat = lstatSync(path);
      if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        !within(actualRoot, realpathSync(path))
      )
        throw new Error('Unsafe marker');
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  };
  const before = inspect();
  if (inspect() !== before) throw new Error('Marker changed during check');
  return before;
}

export function createExperiment(
  authSource: string,
  io: typeof disk = disk,
  register: (experiment: Experiment) => void = () => undefined,
): Experiment {
  const createdRoot = io.mkdtempSync(join(tmpdir(), 'ptah-codex-evidence-'));
  if (io.lstatSync(createdRoot).isSymbolicLink())
    throw new Error('Experiment root is a symlink');
  const root = String(io.realpathSync(createdRoot));
  const experiment = {
    root,
    workspace: join(root, 'workspace'),
    scratch: join(root, 'scratch'),
    home: join(root, 'home'),
  };
  register(experiment); // Fatal handlers already installed; expose the auth destination BEFORE the copy.
  try {
    for (const path of [
      experiment.workspace,
      experiment.scratch,
      experiment.home,
    ])
      io.mkdirSync(path, { mode: 0o700 });
    assertDisjointHomes(root, experiment.home, undefined, io);
    io.copyFileSync(authSource, join(experiment.home, 'auth.json'));
    io.chmodSync(join(experiment.home, 'auth.json'), 0o600);
    return experiment;
  } catch {
    cleanupExperiment(experiment, false, io);
    throw new Error('Experiment setup failed (details withheld)');
  }
}

function cleanupAdditionalHome(
  root: string,
  home: string,
  io: typeof disk,
): void {
  try {
    io.lstatSync(home);
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  assertDisjointHomes(root, home, undefined, io);
  io.rmSync(home, { recursive: true, force: true });
}

export function cleanupExperiment(
  experiment: Experiment,
  keep: boolean,
  io: typeof disk = disk,
): void {
  // Delete the entire home even with --keep: runtime session/auth refresh files may contain secrets.
  try {
    io.rmSync(join(experiment.home, 'auth.json'), { force: true });
  } finally {
    try {
      io.rmSync(experiment.home, { recursive: true, force: true });
    } finally {
      try {
        for (const home of experiment.additionalHomes ?? []) {
          cleanupAdditionalHome(experiment.root, home, io);
        }
      } finally {
        if (!keep) io.rmSync(experiment.root, { recursive: true, force: true });
      }
    }
  }
}

export function childEnvironment(
  experiment: Experiment,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) =>
      /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|LANG|LC_ALL)$/i.test(key),
    ),
  );
  return {
    ...env,
    CODEX_HOME: experiment.home,
    HOME: experiment.home,
    USERPROFILE: experiment.home,
    TMP: experiment.scratch,
    TEMP: experiment.scratch,
    TMPDIR: experiment.scratch,
  };
}
const caseSchema = z.object({
  id: z.string().regex(/^[a-z-]+$/),
  turnCost: z.number().int().min(0).max(2),
  observations: z.array(z.number()),
  kind: z.enum([
    'schema',
    'command',
    'file',
    'boundary',
    'mcp',
    'compact',
    'read-rule',
    'round',
  ]),
  level: z.enum(['ask', 'plan', 'auto-edit', 'yolo']).optional(),
  decision: z.enum(['accept', 'deny', 'edit']).optional(),
  purpose: z.string(),
});

export type EvidenceCase = z.infer<typeof caseSchema>;

interface EventSummary {
  direction: 'in' | 'out';
  method: string;
  itemType?: string;
  itemStatus?: string;
  server?: string;
  tool?: string;
  hasError?: boolean;
  status?: string;
  name?: string;
}

const ELICITATION = 'mcpServer/elicitation/request';
const elicitationSchema = z.object({
  threadId: z.string(),
  turnId: z.string().nullish(),
  serverName: z.literal('marker'),
  mode: z.literal('form'),
  message: z.string(),
  requestedSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).nullish(),
  }),
  _meta: z.record(z.string(), z.unknown()).nullish(),
  tool: z.string().optional(),
  toolName: z.string().optional(),
});

interface ApprovalSummary {
  method: string;
  absentBefore: boolean;
  response: string;
  paramKeys: string[];
  serverName?: string;
  message?: string;
  requestedSchemaProperties?: string[];
  metaKeys?: string[];
  reason?: string | null;
  kind?: string | null;
  type?: string | null;
  hasProposedExecpolicyAmendment: boolean;
}

function approvalSummary(frame: RequestFrame): ApprovalSummary {
  const parsed = z.record(z.string(), z.unknown()).safeParse(frame.params);
  const params = parsed.success ? parsed.data : {};
  const evidence: ApprovalSummary = {
    method: frame.method,
    absentBefore: false,
    response: 'pending',
    paramKeys: Object.keys(params)
      .map((key) => String(sanitize(key)))
      .sort(),
    hasProposedExecpolicyAmendment:
      params['proposedExecpolicyAmendment'] != null,
  };
  for (const key of ['reason', 'kind', 'type'] as const) {
    const value = params[key];
    if (typeof value === 'string')
      evidence[key] = String(sanitize(value)).slice(0, 400);
    else if (value === null) evidence[key] = null;
  }
  if (frame.method === ELICITATION) {
    const keys = (value: unknown): string[] => {
      const parsed = z.record(z.string(), z.unknown()).safeParse(value);
      return parsed.success
        ? Object.keys(parsed.data)
            .map((key) => String(sanitize(key)).slice(0, 80))
            .sort()
        : [];
    };
    const schema = z
      .object({ properties: z.unknown().optional() })
      .safeParse(params['requestedSchema']);
    if (typeof params['serverName'] === 'string')
      evidence.serverName = String(sanitize(params['serverName'])).slice(0, 80);
    if (typeof params['message'] === 'string')
      evidence.message = String(sanitize(params['message'])).slice(0, 400);
    evidence.requestedSchemaProperties = keys(
      schema.success ? schema.data.properties : undefined,
    );
    evidence.metaKeys = keys(params['_meta']);
  }
  return evidence;
}

export interface CaseResult {
  id: string;
  status: string;
  turns: number;
  events: EventSummary[];
  approvals: ApprovalSummary[];
  agentMessages?: string[];
  markers?: { original: boolean; replacement: boolean; outside: boolean };
  terminal?: string;
  usage?: unknown;
  round?: Record<string, unknown>;
  usageSamples?: { last: number; total: number }[];
  usageByTurn?: Record<string, number>;
  steer?: {
    status: 'pending' | 'success' | 'error';
    rpcErrorCode?: number;
    responseTurn: 'unreported' | 'same' | 'new';
    newTurnStarted: boolean;
    usageAfter: { turnId: string; totalTokens: number }[];
  };
  effectiveConfig?: unknown;
  execPolicyRule?: { path: string; content: string; completedStatus?: string };
  notes?: string[];
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RpcProcess = EventEmitter & {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  pid?: number;
  exitCode: number | null;
  kill: (signal?: NodeJS.Signals) => boolean;
};

export function killTreeSync(child: RpcProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killed = spawnSync(
      join(
        process.env['SystemRoot'] ?? 'C:\\Windows',
        'System32',
        'taskkill.exe',
      ),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore', timeout: 5000 },
    );
    if (killed.error || killed.status !== 0) {
      try {
        process.kill(child.pid, 0);
      } catch (error) {
        if (errorCode(error) === 'ESRCH') return;
        throw error;
      }
      throw new Error('Tree kill failed; cleanup cannot safely continue');
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (errorCode(error) !== 'ESRCH') throw error;
    }
  }
}

/** Synchronous and repeatable, including a second Ctrl+C. Kill before deleting credentials. */

export function createFatalCleanup(
  cleanup: () => void,
  children: ReadonlySet<RpcChild>,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  return () => {
    try {
      for (const child of children) child.stopSync();
      cleanup();
    } finally {
      exit(1);
    }
  };
}

export function assertSafeSandbox(value: unknown): void {
  if (
    typeof value === 'string' &&
    /^(danger-?full-?access|external-?sandbox)$/i.test(value)
  )
    throw new Error('Unsafe sandbox rejected');
  if (Array.isArray(value)) value.forEach(assertSafeSandbox);
  else if (value && typeof value === 'object')
    Object.values(value).forEach(assertSafeSandbox);
}

export class UsageBudget {
  private readonly totals = new Map<string, number>();
  private readonly turns = new Map<string, number>();
  private failure: string | undefined;
  get exceeded(): boolean {
    return this.failure !== undefined;
  }
  get consumed(): number {
    return [...this.totals.values()].reduce((sum, count) => sum + count, 0);
  }
  turnTotal(id: string, turnId: string): number {
    return this.turns.get(JSON.stringify([id, turnId])) ?? 0;
  }
  observe(id: string, count: number, turnId = id): number {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error('Invalid usage');
    const previous = this.totals.get(id) ?? 0;
    const total = Math.max(count, previous);
    this.totals.set(id, total);
    const key = JSON.stringify([id, turnId]);
    const turnTotal = (this.turns.get(key) ?? 0) + total - previous;
    this.turns.set(key, turnTotal);
    if (turnTotal > USAGE_TURN_LIMIT)
      this.failure ??= 'Per-turn usage bound reached';
    if (this.consumed > USAGE_CUMULATIVE_LIMIT)
      this.failure ??= 'Cumulative usage bound reached';
    if (this.failure) throw new Error(this.failure);
    return turnTotal;
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
  onRequest: (frame: RequestFrame, evidence: ApprovalSummary) => Promise<void> =
    async (frame) => {
      this.decline(frame.id);
      throw new Error('unsupported server request');
    };
  private readonly answered = new Set<string | number>();
  private readonly elicitations = new Set<string | number>();
  denyLiteral = 'decline'; // Fallback from batch-1a research/review; recorded as unverified unless schema confirms it.
  onNotification: (method: string, params: unknown) => void = () => undefined;
  constructor(
    private readonly child: RpcProcess,
    private readonly result: CaseResult,
    private readonly redactPaths = createPathRedactor(),
  ) {
    this.exited = new Promise((done) => child.once('close', done));
    child.stderr.resume(); // Never retain stderr: it can include credentials and prompts.
    child.on('error', () => this.fail(new Error('child failed')));
    child.on('close', () => {
      if (!this.ending) this.fail(new Error('child closed'));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.decoder.push(chunk)) this.receive(frame);
      } catch (error) {
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? error.message
            : undefined;
        this.fail(
          new Error(
            typeof message === 'string' && failureMessages.has(message)
              ? message
              : 'invalid or oversized protocol frame',
          ),
        );
        const keys = `Rejected frame keys: ${this.decoder.rejectedFrameKeys.join(', ')}`;
        const notes = (this.result.notes ??= []);
        if (this.decoder.rejectedFrameKeys.length && !notes.includes(keys))
          notes.push(keys);
        this.stopSync();
      }
    });
    child.stdin.on('error', () => this.fail(new Error('stdin failed')));
  }
  private event(
    direction: 'in' | 'out',
    method: string,
    params?: unknown,
  ): void {
    if (this.result.events.length >= MAX_EVENTS)
      throw new Error('event limit reached');
    const summary: EventSummary = { direction, method };
    const parsed = z
      .object({
        item: z
          .object({
            type: z.string(),
            text: z.unknown().optional(),
            status: z.string().optional(),
            server: z.string().optional(),
            tool: z.string().optional(),
            error: z.unknown().optional(),
          })
          .optional(),
        status: z.string().optional(),
        name: z.string().optional(),
      })
      .safeParse(params);
    if (direction === 'in' && parsed.success) {
      const data = parsed.data;
      const item = data.item;
      const capped = (value: string) => String(sanitize(value)).slice(0, 80);
      if ((method === 'item/started' || method === 'item/completed') && item) {
        summary.itemType = capped(item.type);
        if (
          method === 'item/completed' &&
          item.type === 'agentMessage' &&
          typeof item.text === 'string'
        ) {
          const messages = (this.result.agentMessages ??= []);
          messages.push(
            String(
              sanitize(
                this.redactPaths(item.text)
                  .replace(
                    /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/gi,
                    '<USER_HOME>',
                  )
                  .replace(/\/(?:home|Users)\/[^/\s"'<>]+/g, '<USER_HOME>'),
              ),
            )
              .slice(0, 400)
              .replace(/(?:<[^>]*|\[[^\]]*)$/, ''),
          );
          if (messages.length > 3) messages.shift();
        }
        if (item.status !== undefined) summary.itemStatus = capped(item.status);
        if (item.type === 'mcpToolCall') {
          if (item.server !== undefined) summary.server = capped(item.server);
          if (item.tool !== undefined) summary.tool = capped(item.tool);
          if (method === 'item/completed')
            summary.hasError = item.error != null;
        }
      }
      if (method === 'mcpServer/startupStatus/updated') {
        if (data.status !== undefined) summary.status = capped(data.status);
        if (data.name !== undefined) summary.name = capped(data.name);
      }
    }
    this.result.events.push(summary);
  }
  private fail(error: Error): void {
    if (!this.failure && !this.ending) recordCaseFailure(this.result, error);
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }
  assertHealthy(): void {
    if (this.failure) throw this.failure;
  }
  abort(): void {
    this.fail(new Error('experiment interrupted'));
    this.stopSync();
  }
  private receive(frame: Frame): void {
    if ('method' in frame) {
      const evidence = 'id' in frame ? approvalSummary(frame) : undefined;
      if ('id' in frame && frame.method === ELICITATION)
        this.elicitations.add(frame.id);
      if (
        evidence &&
        (frame.method.endsWith('/requestApproval') ||
          frame.method === ELICITATION)
      )
        this.result.approvals.push(evidence);
      try {
        this.event('in', frame.method, frame.params);
      } catch (error) {
        if ('id' in frame) {
          this.decline(frame.id);
          if (evidence) evidence.response = 'decline';
        }
        throw error;
      }
      if ('id' in frame && evidence) {
        if (this.failure || this.ending) {
          this.decline(frame.id);
          evidence.response = 'decline';
          return;
        }
        this.handlers = this.handlers
          .then(() => {
            if (this.failure || this.ending) {
              this.decline(frame.id);
              evidence.response = 'decline';
              return;
            }
            return this.onRequest(frame, evidence);
          })
          .catch(() => {
            this.decline(frame.id);
            if (evidence.response === 'pending') evidence.response = 'decline';
            this.fail(new Error('approval/isolation gate failed'));
            this.stopSync();
          });
      } else this.onNotification(frame.method, frame.params);
    } else if (typeof frame.id === 'number') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      if ('error' in frame)
        pending.reject(new Error(`RPC error ${frame.error.code}`));
      else pending.resolve(frame.result);
    }
  }
  private write(frame: object): void {
    this.assertHealthy();
    if (this.ending) throw new Error('child stopped');
    const bytes = JSON.stringify(frame) + '\n';
    if (Buffer.byteLength(bytes) > MAX_FRAME_BYTES)
      throw new Error('outbound frame too large');
    this.child.stdin.write(bytes);
  }
  async request(
    method: string,
    params: object,
    budget?: TurnBudget,
  ): Promise<unknown> {
    assertSafeSandbox(params);
    if (method === 'turn/start' || method === 'thread/compact/start') {
      if (!budget?.claim()) {
        this.result.status = 'not run: cap';
        throw new Error('not run: cap');
      }
      this.result.turns += 1;
    }
    this.assertHealthy();
    this.event('out', method);
    const id = ++this.nextId;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('RPC timeout'));
        this.fail(new Error('RPC timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      try {
        this.write({ id, method, params });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('request write failed'));
      }
    });
  }
  notify(method: string): void {
    this.event('out', method);
    this.write({ method });
  }
  respond(id: string | number, result: object): void {
    this.write({ id, result });
    this.answered.add(id);
  }
  decline(id: string | number): void {
    if (this.answered.has(id)) return;
    this.answered.add(id);
    // Deliberately bypass assertHealthy: even a failed case must answer pending requests.
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.write(
        JSON.stringify({
          id,
          result: this.elicitations.has(id)
            ? { action: 'decline' }
            : { decision: this.denyLiteral },
        }) + '\n',
      );
    }
  }
  stopSync(): void {
    if (!this.treeKilled) {
      killTreeSync(this.child);
      this.treeKilled = true;
    }
    this.ending = true;
    this.fail(new Error('child stopped'));
  }
  async stop(): Promise<void> {
    this.stopSync();
    this.child.stdin.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('child teardown not confirmed')),
            5000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await this.handlers;
  }
}
// Shared by the exact approved command and the local MCP fixture. No arbitrary path argument from the model.
export const MARKER_WRITER = String.raw`
const fs = require('node:fs');
const path = require('node:path');

function writeMarker(root, target) {
  root = path.resolve(root);
  target = path.resolve(target);
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
const MCP_FIXTURE =
  MARKER_WRITER +
  String.raw`
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

const manifestSchema = z.object({
  pinnedVersion: z.literal('0.155.1'),
  binaryPath: z.string(),
  binarySha256: z.string(),
  schemaSha256: z.string(),
  platform: z.string(),
  arch: z.string(),
  methods: z.object({
    requests: z.array(z.string()),
    serverRequests: z.array(z.string()),
    clientNotifications: z.array(z.string()),
    serverNotifications: z.array(z.string()),
  }),
});

export type Manifest = z.infer<typeof manifestSchema>;

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function loadManifest(binary: string): {
  manifest: Manifest;
  schemaText: string;
} {
  const directory = resolve(__dirname, '../src/lib/protocol');
  const schemaPath = join(directory, 'codex-app-server-protocol.schema.json');
  const manifest = manifestSchema.parse(
    JSON.parse(
      readFileSync(
        join(directory, 'codex-app-server-protocol.manifest.json'),
        'utf8',
      ),
    ),
  );
  if (
    manifest.platform !== process.platform ||
    manifest.arch !== process.arch ||
    realpathSync(manifest.binaryPath) !== binary ||
    digest(binary) !== manifest.binarySha256 ||
    digest(schemaPath) !== manifest.schemaSha256
  ) {
    throw new Error('Pinned binary/schema manifest mismatch');
  }
  return { manifest, schemaText: readFileSync(schemaPath, 'utf8') };
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function markerState(
  root: string,
  original: string,
  replacement: string,
  outside: string,
): NonNullable<CaseResult['markers']> {
  return {
    original: markerExists(root, original),
    replacement: markerExists(root, replacement),
    outside: markerExists(root, outside),
  };
}

type ApprovalPolicy =
  | 'on-request'
  | {
      granular: {
        sandbox_approval: boolean;
        rules: boolean;
        mcp_elicitations: boolean;
        request_permissions: boolean;
        skill_approval: boolean;
      };
    };

export function policy(level: EvidenceCase['level']): {
  sandbox: string;
  approvalPolicy: ApprovalPolicy;
  approvalsReviewer?: 'user';
} {
  const approvalPolicy: ApprovalPolicy =
    level === 'ask' || level === undefined
      ? {
          granular: {
            sandbox_approval: true,
            rules: true,
            mcp_elicitations: true,
            request_permissions: true,
            skill_approval: true,
          },
        }
      : 'on-request';
  const selected = {
    sandbox:
      level === 'yolo' || level === 'auto-edit'
        ? 'workspace-write'
        : 'read-only',
    approvalPolicy,
    ...(typeof approvalPolicy === 'string'
      ? {}
      : { approvalsReviewer: 'user' as const }),
  };
  assertSafeSandbox(selected);
  return selected;
}

export function approvalPolicyOverride(value: ApprovalPolicy): string {
  return (
    'approval_policy=' +
    (typeof value === 'string'
      ? JSON.stringify(value)
      : '{granular={' +
        Object.entries(value.granular)
          .map(([key, enabled]) => `${key}=${enabled}`)
          .join(',') +
        '}}')
  );
}

export function approvalPoliciesEqual(
  actual: unknown,
  expected: ApprovalPolicy,
): boolean {
  return isDeepStrictEqual(actual, expected);
}

export function initializeParams(approvalPolicy: ApprovalPolicy) {
  return {
    clientInfo: { name: 'ptah_evidence', version: '0.0.1' },
    capabilities: { experimentalApi: typeof approvalPolicy !== 'string' },
  };
}

export function assertThreadApprovalPolicy(
  response: unknown,
  expected: ApprovalPolicy,
): void {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('approvalPolicy' in response) ||
    !approvalPoliciesEqual(response.approvalPolicy, expected) ||
    !('approvalsReviewer' in response) ||
    response.approvalsReviewer !== 'user'
  )
    throw new Error('Effective approval policy differs from bounded profile');
}

export function assertEffectiveApprovalPolicy(
  actual: unknown,
  expected: ApprovalPolicy,
): void {
  if (!approvalPoliciesEqual(actual, expected))
    throw new Error('Effective approval policy differs from bounded profile');
}

export function shouldNoteMissingApproval(
  turnId: string,
  level: EvidenceCase['level'],
  approvalRequestObserved: boolean,
  harnessFailed = false,
): boolean {
  return (
    !!turnId && level === 'ask' && !approvalRequestObserved && !harnessFailed
  );
}

export function commandMatches(
  observed: unknown,
  expected: string,
  platform = process.platform,
): boolean {
  if (observed === expected) return true;
  if (
    platform !== 'win32' ||
    expected.includes('"') ||
    typeof observed !== 'string'
  )
    return false;
  const wrapper =
    /^"((?:[A-Za-z]:[\\/]|\\\\[^"\\/]+[\\/][^"\\/]+[\\/])[^"\r\n]*)" -Command "([^"\r\n]*)"$/.exec(
      observed,
    );
  return (
    wrapper !== null &&
    wrapper[0] === observed &&
    /[\\/](?:powershell|pwsh)\.exe$/i.test(wrapper[1]) &&
    wrapper[2] === expected
  );
}

/** Only slash direction is normalized; no case folding or shell interpretation. */
export function isToleratedMarkerRead(
  command: unknown,
  originalMarker: string,
  platform = process.platform,
): boolean {
  if (typeof command !== 'string') return false;
  let inner = command;
  if (platform === 'win32' && command.startsWith('"')) {
    const match = / -Command "([^"\r\n]*)"$/.exec(command);
    if (!match || !commandMatches(command, match[1], platform)) return false;
    inner = match[1];
  }
  if (/[;|&>`\r\n]|\$\(/.test(inner)) return false;
  const match = (
    platform === 'win32'
      ? /^(?:Get-Content|Test-Path|Get-Item) -(?:LiteralPath|Path) '([^']+)'$/
      : /^(?:cat|test -e) '([^']+)'$/
  ).exec(inner);
  return (
    match !== null &&
    match[0] === inner &&
    match[1].replace(/\\/g, '/') === originalMarker.replace(/\\/g, '/')
  );
}

export const MARKER_INSTRUCTIONS =
  'Evidence experiment. Only the single requested marker may be touched. Do not inspect credentials, config, home, environment or network. No subagents. No retries. Stop after one tool action.';
export const MARKER_MESSAGE_INSTRUCTIONS =
  'Evidence experiment. Only the single requested marker may be touched. Do not inspect credentials, config, home, environment or network. No subagents. No retries. Stop after one tool action per user message; a later user message may request a different single marker.';

export function commandPrompt(command: string, readOnly = false): string {
  return `${readOnly ? 'Run' : 'Request approval, then run'} exactly this command once, without wrappers, changes or added punctuation. The command is the whole next line:\n${command}\nNo other tools or retries.`;
}

export function markerCommand(
  paths: string[],
  platform = process.platform,
): string {
  const command =
    (platform === 'win32' ? '& ' : '') +
    paths
      .map((value) => {
        const path = platform === 'win32' ? value.replace(/\\/g, '/') : value;
        return platform === 'win32'
          ? "'" + path.replace(/'/g, "''") + "'"
          : "'" + path.replace(/'/g, "'\\''") + "'";
      })
      .join(' ');
  if (command.includes('"'))
    throw new Error('Command path contains a double quote');
  if (platform === 'win32' && command.includes('\\'))
    throw new Error('Command path contains a backslash');
  return command;
}

export function configSummary(value: unknown): unknown {
  const config = record(record(value)['config']);
  assertSafeSandbox(config);
  if (
    record(config['sandbox_workspace_write'] ?? {})['network_access'] !== false
  )
    throw new Error('Network disable not confirmed by config/read');
  return Object.fromEntries(
    [
      'model',
      'sandbox_mode',
      'approval_policy',
      'sandbox_workspace_write',
      ...Object.keys(OUTPUT_BOUNDS),
    ].map((key) => [key, config[key]]),
  );
}

function usageSummary(params: unknown): unknown {
  const data = record(params);
  const usage = record(data['tokenUsage'] ?? {});
  const totals = record(usage['total'] ?? {});
  return Object.fromEntries(
    Object.entries(totals).filter(([, value]) => typeof value === 'number'),
  );
}

export interface MarkerApproval {
  kind: EvidenceCase['kind'];
  level: EvidenceCase['level'];
  decision: EvidenceCase['decision'];
  threadId: string;
  expectedCommand: string;
  target: string;
  workspace: string;
  root: string;
  validatedFileItems: ReadonlySet<string>;
  approvals: number;
}

/** The only accept decision in the harness: exact command, exact validated file, or fixed local MCP call. */

export function markerApprovalDecision(
  frame: RequestFrame,
  context: MarkerApproval,
): 'accept' | 'decline' {
  const params = record(frame.params ?? {});
  if (
    context.approvals !== 0 ||
    context.level === 'plan' ||
    context.decision !== 'accept' ||
    params['threadId'] !== context.threadId
  )
    return 'decline';
  if (
    typeof params['cwd'] === 'string' &&
    resolve(params['cwd']) !== context.workspace
  )
    return 'decline';
  markerExists(context.root, context.target);
  if (
    (context.kind === 'command' ||
      context.kind === 'boundary' ||
      context.kind === 'read-rule') &&
    frame.method === 'item/commandExecution/requestApproval'
  ) {
    return commandMatches(params['command'], context.expectedCommand)
      ? 'accept'
      : 'decline';
  }
  if (
    context.kind === 'file' &&
    frame.method === 'item/fileChange/requestApproval'
  ) {
    return typeof params['itemId'] === 'string' &&
      context.validatedFileItems.has(params['itemId'])
      ? 'accept'
      : 'decline';
  }
  return 'decline';
}

function checkObservedPaths(
  root: string,
  workspace: string,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => checkObservedPaths(root, workspace, entry));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (
      /^(paths|filePaths|writableRoots|roots)$/i.test(key) &&
      Array.isArray(entry)
    ) {
      for (const path of entry) checkObservedPaths(root, workspace, { path });
      continue;
    }
    if (
      /^(path|cwd|filePath|file_path|file|root|writableRoot|grantRoot)$/i.test(
        key,
      ) &&
      typeof entry === 'string'
    ) {
      const path = resolve(workspace, entry);
      const actualRoot = realpathSync(root);
      if (
        !within(actualRoot, path) ||
        !within(actualRoot, canonical(path, disk))
      )
        throw new Error('Observed path escapes experiment');
      // Directory paths are allowed as metadata, but symlinks at any component are not.
      let cursor = path;
      while (cursor !== actualRoot) {
        try {
          if (lstatSync(cursor).isSymbolicLink())
            throw new Error('Observed symlink');
        } catch (error) {
          if (!missing(error)) throw error;
        }
        if (dirname(cursor) === cursor)
          throw new Error('Observed path escapes experiment');
        cursor = dirname(cursor);
      }
    } else checkObservedPaths(root, workspace, entry);
  }
}

function schemaDenial(
  schemaText: string,
  method: string,
): { literal: string; verified: boolean } {
  const schema = record(JSON.parse(schemaText));
  const definitions = record(schema['definitions'] ?? schema['$defs'] ?? {});
  const literals = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(literals);
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, entry]) =>
      key === 'const' && typeof entry === 'string'
        ? [entry]
        : key === 'enum' && Array.isArray(entry)
          ? entry.filter((item): item is string => typeof item === 'string')
          : literals(entry),
    );
  };
  const name =
    method === 'item/commandExecution/requestApproval'
      ? 'CommandExecutionApprovalDecision'
      : method === 'item/fileChange/requestApproval'
        ? 'FileChangeApprovalDecision'
        : '';
  const values = literals(definitions[name]);
  return values.includes('decline')
    ? { literal: 'decline', verified: true }
    : values.includes('deny')
      ? { literal: 'deny', verified: true }
      : { literal: 'decline', verified: false };
}

export async function runCase(
  item: EvidenceCase,
  result: CaseResult,
  experiment: Experiment,
  binary: string,
  model: string,
  budget: TurnBudget,
  usage: UsageBudget,
  manifest: Manifest,
  schemaText: string,
  compact: boolean,
  children: Set<RpcChild>,
  authDirectory: string,
): Promise<void> {
  if (item.kind === 'round') {
    await runRoundCase({
      item,
      result,
      experiment,
      binary,
      model,
      budget,
      usage,
      manifest,
      children,
      authDirectory,
    });
    return;
  }
  const editing = item.kind === 'command' && item.decision === 'edit';
  const readRule = item.kind === 'read-rule';
  if (editing && !manifest.methods.requests.includes('turn/steer'))
    throw new Error('turn/steer missing from manifest');
  const original = join(experiment.workspace, `${item.id}.marker`);
  const replacement = join(
    experiment.workspace,
    `${item.id}.replacement.marker`,
  );
  const outside = join(experiment.scratch, `${item.id}.marker`);
  const target = item.kind === 'file' ? outside : original;
  const fixture = join(experiment.root, `${item.id}-mcp.cjs`);
  writeFileSync(fixture, MCP_FIXTURE, { flag: 'wx', mode: 0o600 });
  const selected = policy(item.level);
  const markerScript = join(experiment.root, `${item.id}-marker.cjs`);
  writeFileSync(
    markerScript,
    MARKER_WRITER + ';writeMarker(process.argv[2],process.argv[3]);',
    { flag: 'wx', mode: 0o600 },
  );
  const readFixture = join(experiment.workspace, `${item.id}.fixture.txt`);
  const readPath =
    process.platform === 'win32'
      ? readFixture.replace(/\\/g, '/')
      : readFixture;
  const readTokens =
    process.platform === 'win32'
      ? ['Get-Content', '-LiteralPath', readPath]
      : ['cat', readPath];
  if (readRule) {
    writeFileSync(readFixture, 'fixture', { flag: 'wx', mode: 0o600 });
    const path = 'rules/default.rules';
    const patterns = [
      readTokens,
      [readTokens[0]],
      ...(process.platform === 'win32' ? [['powershell.exe']] : []),
    ];
    const content = patterns
      .map(
        (pattern) =>
          `prefix_rule(pattern=${JSON.stringify(pattern)}, decision="prompt")\n`,
      )
      .join('');
    mkdirSync(join(experiment.home, 'rules'), { recursive: true });
    writeFileSync(join(experiment.home, path), content, {
      flag: 'wx',
      mode: 0o600,
    });
    result.execPolicyRule = { path, content };
    (result.notes ??= []).push('exec-policy rule location unverified');
  }
  const expectedCommand = readRule
    ? `${readTokens.slice(0, -1).join(' ')} '${readPath}'`
    : markerCommand([process.execPath, markerScript, experiment.root, target]);
  const editedCommand = markerCommand([
    process.execPath,
    markerScript,
    experiment.root,
    replacement,
  ]);
  const overrides = [
    `mcp_servers.marker.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.marker.args=${JSON.stringify([fixture, JSON.stringify({ root: experiment.root, original })])}`,
    `mcp_servers.marker.enabled=${item.kind === 'mcp'}`,
    ...(item.kind === 'mcp'
      ? ['mcp_servers.marker.default_tools_approval_mode="prompt"']
      : []),
    ...Object.entries(OUTPUT_BOUNDS).map(
      ([key, value]) => `${key}=${JSON.stringify(value)}`,
    ),
    'web_search="disabled"',
    'features.apps=false',
    'sandbox_workspace_write.network_access=false',
    `sandbox_mode=${JSON.stringify(selected.sandbox)}`,
    approvalPolicyOverride(selected.approvalPolicy),
  ];
  assertSafeSandbox(selected);
  const child = spawn(
    binary,
    [...overrides.flatMap((entry) => ['-c', entry]), 'app-server'],
    {
      cwd: experiment.workspace,
      env: childEnvironment(experiment),
      stdio: 'pipe',
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  );
  const rpc = new RpcChild(
    child,
    result,
    createPathRedactor(experiment, authDirectory),
  );
  // Only validated command approvals participate in marker outcome checks.
  const validatedApprovals: ApprovalSummary[] = [];
  children.add(rpc);
  let threadId = '';
  let turnId = '';
  let initialTurnId = '';
  let steerSent = false;
  const chargedTurns = new Set<string>();
  const adoptSteerTurn = (id: string): void => {
    if (!chargedTurns.has(id)) {
      const withinCap = budget.observeTurn();
      result.turns += 1;
      chargedTurns.add(id);
      if (!withinCap) throw new Error('not run: cap');
    }
    if (turnId !== id) {
      turnId = id;
      terminal = undefined;
      interrupted = false;
    }
  };
  let terminal: string | undefined;
  let compacted = false;
  let compacting = false;
  let interrupted = false;
  let outcome = false;
  let approvalPending = false;
  let approvalRounds = 0;
  let approvalRequestObserved = false;
  let toleratedReadId: string | undefined;
  let toleratedReadApproval = false;
  let readCompleted = false;
  let harnessFailed = false;
  const noteWrapper = (command: unknown): void => {
    if (
      command !== expectedCommand &&
      commandMatches(command, expectedCommand)
    ) {
      const notes = (result.notes ??= []);
      const note = 'Command accepted via PowerShell wrapper';
      if (!notes.includes(note)) notes.push(note);
    }
  };
  let usageWait: Promise<void> | undefined;
  let usageTimer: ReturnType<typeof setTimeout> | undefined;
  let finishUsageWait: ((observed: boolean) => void) | undefined;
  let terminalUsageTurn = '';
  const beginUsageWait = (): void => {
    if (usageWait || !turnId) return;
    terminalUsageTurn = turnId;
    usageWait = new Promise<void>((resolveWait) => {
      finishUsageWait = (observed) => {
        clearTimeout(usageTimer);
        finishUsageWait = undefined;
        (result.notes ??= []).push(
          observed
            ? 'usage after terminal: observed'
            : 'usage after terminal: not observed within 500 ms',
        );
        resolveWait();
      };
      usageTimer = setTimeout(() => finishUsageWait?.(false), 500);
    });
  };
  let toolItems = 0;
  const validatedFileItems = new Set<string>();
  const interrupt = (): void => {
    if (interrupted || !turnId || compacting) return;
    interrupted = true;
    beginUsageWait();
    void rpc
      .request('turn/interrupt', { threadId, turnId })
      .catch(() => rpc.abort());
  };
  const inspect = (): void => {
    const state = markerState(experiment.root, original, replacement, outside);
    if (editing) {
      if (
        state.original ||
        state.outside ||
        (state.replacement &&
          (approvalPending || validatedApprovals[1]?.response !== 'accept'))
      )
        throw new Error('Unexpected marker effect');
      if (state.replacement) {
        outcome = true;
        interrupt();
      }
      return;
    }
    const present = target === outside ? state.outside : state.original;
    if (
      state.replacement ||
      (target === outside ? state.original : state.outside) ||
      (present &&
        (approvalPending || validatedApprovals[0]?.response !== 'accept'))
    )
      throw new Error('Unexpected marker effect');
    if (present || validatedApprovals[0]?.response === 'decline') {
      outcome = true;
      if (item.id !== 'usage-semantics') interrupt();
    }
  };
  // One bounded poll per child, always released below; never one poll per event/item.
  const guard = setInterval(() => {
    try {
      inspect();
    } catch (error) {
      recordCaseFailure(result, error);
      rpc.abort();
    }
  }, 20);
  const deadline = setTimeout(() => rpc.abort(), caseDeadlineMs(item));
  rpc.onRequest = async (frame, evidence) => {
    const requestParams = record(frame.params ?? {});
    const beforeFirstApproval = !approvalRequestObserved;
    approvalRequestObserved ||=
      frame.method.endsWith('/requestApproval') || frame.method === ELICITATION;
    let answered = false;
    try {
      if (frame.method === ELICITATION) {
        const parsed = elicitationSchema.safeParse(frame.params);
        if (
          !parsed.success ||
          item.kind !== 'mcp' ||
          approvalRounds !== 0 ||
          compacting ||
          !manifest.methods.serverRequests.includes(ELICITATION)
        )
          throw new Error('Unexpected request');
        const params = parsed.data;
        if (
          !threadId ||
          !turnId ||
          params.threadId !== threadId ||
          (params.turnId != null && params.turnId !== turnId) ||
          [params.tool, params.toolName, params._meta?.['toolName']].some(
            (name) => name !== undefined && name !== 'write_marker',
          )
        )
          throw new Error('Unexpected request');
        const required = params.requestedSchema.required ?? [];
        if (
          !required.every(
            (name) =>
              Object.hasOwn(params.requestedSchema.properties, name) &&
              z
                .object({ type: z.literal('boolean') })
                .safeParse(params.requestedSchema.properties[name]).success,
          )
        )
          throw new Error('Unexpected request');
        const content = Object.fromEntries(
          required.map((name) => [name, true]),
        );
        if (params.turnId == null)
          (result.notes ??= []).push('elicitation turnId: null');
        if (required.length)
          (result.notes ??= []).push(
            `elicitation required boolean fields: ${required.map((name) => String(sanitize(name)).slice(0, 80)).join(', ')}`,
          );
        checkObservedPaths(experiment.root, experiment.workspace, frame.params);
        approvalRounds += 1;
        approvalPending = true;
        if (markerExists(experiment.root, original))
          throw new Error('Side effect before approval');
        await delay(200);
        rpc.assertHealthy();
        if (markerExists(experiment.root, original))
          throw new Error('Side effect during approval');
        evidence.absentBefore = true;
        evidence.response = 'accept';
        validatedApprovals.push(evidence);
        approvalPending = false;
        rpc.respond(frame.id, { action: 'accept', content });
        answered = true;
        inspect();
        return;
      }
      const denial = schemaDenial(schemaText, frame.method);
      rpc.denyLiteral = denial.literal;
      result.notes?.push(
        `Denial literal ${denial.literal}: ${denial.verified ? 'found in method approval schema; wire behavior unverified' : 'unverified fallback from batch-1a review; research does not establish per-method response shape'}`,
      );
      checkObservedPaths(experiment.root, experiment.workspace, frame.params);
      if (
        toleratedReadId !== undefined &&
        beforeFirstApproval &&
        !toleratedReadApproval &&
        frame.method === 'item/commandExecution/requestApproval' &&
        requestParams['itemId'] === toleratedReadId &&
        requestParams['threadId'] === threadId &&
        (requestParams['cwd'] === undefined ||
          requestParams['cwd'] === experiment.workspace) &&
        isToleratedMarkerRead(requestParams['command'], original)
      ) {
        toleratedReadApproval = true;
        rpc.decline(frame.id);
        evidence.response = 'decline';
        answered = true;
        (result.notes ??= []).push('Tolerated read asked for approval');
        inspect();
        return;
      }
      if (readRule && readCompleted) throw new Error('Unexpected request');
      const approvalCommand =
        editing && approvalRounds === 1 ? editedCommand : expectedCommand;
      const approvalTarget =
        editing && approvalRounds === 1 ? replacement : target;
      if (
        editing &&
        (approvalRounds > 1 || (approvalRounds === 1 && !steerSent))
      )
        throw new Error('Unexpected request');
      const context: MarkerApproval = {
        kind: item.kind,
        level: item.level,
        decision: editing
          ? approvalRounds === 0
            ? 'deny'
            : 'accept'
          : item.decision,
        threadId,
        expectedCommand: approvalCommand,
        target: approvalTarget,
        root: experiment.root,
        workspace: experiment.workspace,
        validatedFileItems,
        approvals: editing ? 0 : approvalRounds,
      };
      // Validate identity independently of the selected decline policy.
      const fixed =
        markerApprovalDecision(frame, {
          ...context,
          level: 'ask',
          decision: 'accept',
        }) === 'accept';
      if (!fixed && frame.method === 'item/commandExecution/requestApproval') {
        const params = record(frame.params ?? {});
        if (!commandMatches(params['command'], approvalCommand)) {
          recordCommandShape(result, params, params, {
            experiment,
            expectedCommand,
            markerScript,
            authDirectory,
            sanitize,
          });
          if (editing || readRule) throw new Error('Unexpected command');
        }
      }
      if (
        !manifest.methods.serverRequests.includes(frame.method) ||
        !fixed ||
        compacting
      )
        throw new Error('Unexpected request');
      if (frame.method === 'item/commandExecution/requestApproval')
        noteWrapper(record(frame.params ?? {})['command']);
      approvalRounds += 1;
      approvalPending = true;
      if (markerExists(experiment.root, approvalTarget))
        throw new Error('Side effect before approval');
      await delay(200);
      rpc.assertHealthy();
      if (markerExists(experiment.root, approvalTarget))
        throw new Error('Side effect during approval');
      const decision = markerApprovalDecision(frame, context);
      if (decision === 'decline') rpc.decline(frame.id);
      else rpc.respond(frame.id, { decision: 'accept' });
      answered = true;
      evidence.absentBefore = true;
      evidence.response = decision;
      validatedApprovals.push(evidence);
      approvalPending = false;
      if (editing && approvalRounds === 1) {
        if (!turnId) throw new Error('Unexpected request');
        if (budget.consumed >= budget.cap) {
          (result.notes ??= []).push('turn/steer not sent: turn cap reached');
          interrupt();
          throw new Error('not run: cap');
        }
        steerSent = true;
        result.steer = {
          status: 'pending',
          responseTurn: 'unreported',
          newTurnStarted: false,
          usageAfter: [],
        };
        const expectedTurnId = turnId;
        let steeredTurnId: string;
        try {
          const response = z.object({ turnId: z.string() }).parse(
            await rpc.request('turn/steer', {
              threadId,
              expectedTurnId,
              input: [
                {
                  type: 'text',
                  text: `That command was declined. Do not retry it. Request approval, then run exactly this command once instead, without wrappers, changes or added punctuation. The command is the whole next line:\n${editedCommand}\nNo other tools or retries.`,
                  text_elements: [],
                },
              ],
            }),
          );
          result.steer.status = 'success';
          result.steer.responseTurn =
            response.turnId === expectedTurnId ? 'same' : 'new';
          steeredTurnId = response.turnId;
        } catch (error) {
          result.steer.status = 'error';
          const match =
            error instanceof Error
              ? /^RPC error (-?\d+)$/.exec(error.message)
              : null;
          if (match) {
            result.steer.rpcErrorCode = Number(match[1]);
            (result.notes ??= []).push(
              `turn/steer refused: RPC error ${Number(match[1])}`,
            );
          }
          throw error;
        }
        adoptSteerTurn(steeredTurnId);
      }
      inspect();
    } catch (error) {
      recordCaseFailure(result, error);
      if (!answered) {
        rpc.decline(frame.id);
        evidence.response = 'decline';
      }
      interrupt();
      rpc.abort();
      throw new Error('Approval rejected by safety gate');
    }
  };
  rpc.onNotification = (method, params) => {
    const data = record(params ?? {});
    checkObservedPaths(experiment.root, experiment.workspace, data);
    if (
      typeof data['threadId'] === 'string' &&
      threadId &&
      data['threadId'] !== threadId
    )
      throw new Error('Notification thread mismatch');
    if (method === 'turn/started') {
      const id = objectId(data, 'turn');
      if (!initialTurnId) {
        initialTurnId = id;
        turnId = id;
        chargedTurns.add(id);
      } else if (editing && steerSent && id !== initialTurnId) {
        if (result.steer) result.steer.newTurnStarted = true;
        adoptSteerTurn(id);
      }
    }
    if (method === 'item/started' || method === 'item/completed') {
      const observed = record(data['item']);
      let toleratedRead = false;
      if (observed['type'] === 'commandExecution') {
        if (
          editing &&
          item.id === 'ask-command-edit' &&
          selected.sandbox === 'read-only' &&
          isToleratedMarkerRead(observed['command'], original)
        ) {
          const id = z.string().parse(observed['id']);
          if (
            method === 'item/started' &&
            toleratedReadId === undefined &&
            !approvalRequestObserved
          ) {
            toleratedReadId = id;
            (result.notes ??= []).push('Tolerated marker read before command');
            toleratedRead = true;
          } else if (method === 'item/completed' && id === toleratedReadId) {
            toleratedRead = true;
          }
        }
        if (
          !toleratedRead &&
          !commandMatches(observed['command'], expectedCommand) &&
          !(
            editing &&
            steerSent &&
            commandMatches(observed['command'], editedCommand)
          )
        ) {
          recordCommandShape(result, data, observed, {
            experiment,
            expectedCommand,
            markerScript,
            authDirectory,
            sanitize,
          });
          throw new Error('Unexpected command');
        }
        noteWrapper(observed['command']);
        if (readRule && method === 'item/completed') {
          readCompleted = true;
          const status = z
            .enum(['inProgress', 'completed', 'failed', 'declined'])
            .parse(observed['status']);
          if (result.execPolicyRule)
            result.execPolicyRule.completedStatus = status;
          if (approvalRounds === 0) {
            (result.notes ??= []).push('unverified: rule did not prompt');
          }
        }
      }
      if (observed['type'] === 'mcpToolCall') {
        const call = z
          .object({
            server: z.literal('marker'),
            tool: z.literal('write_marker'),
            arguments: z.object({ slot: z.literal('original') }).strict(),
          })
          .safeParse(observed);
        if (item.kind !== 'mcp' || !call.success)
          throw new Error('Unexpected or repeated tool item');
      }
      if (observed['type'] === 'fileChange') {
        const changes = z
          .array(z.object({ path: z.string() }))
          .parse(observed['changes']);
        if (
          item.kind !== 'file' ||
          changes.length !== 1 ||
          resolve(experiment.workspace, changes[0].path) !== target
        ) {
          recordCommandShape(
            result,
            data,
            observed,
            {
              experiment,
              expectedCommand,
              markerScript,
              authDirectory,
              sanitize,
            },
            'file change',
          );
          throw new Error('Unexpected file change');
        }
        markerExists(experiment.root, target);
        if (method === 'item/started')
          validatedFileItems.add(z.string().parse(observed['id']));
      }
      if (
        method === 'item/started' &&
        !toleratedRead &&
        ![
          'reasoning',
          'agentMessage',
          'userMessage',
          'contextCompaction',
        ].includes(String(observed['type']))
      ) {
        if (
          !['commandExecution', 'fileChange', 'mcpToolCall'].includes(
            String(observed['type']),
          ) ||
          ++toolItems > (editing ? 2 : 1)
        )
          throw new Error('Unexpected or repeated tool item');
      }
      compacted ||=
        method === 'item/completed' && observed['type'] === 'contextCompaction';
    }
    if (
      method === 'turn/completed' &&
      (!editing || objectId(data, 'turn') === turnId)
    ) {
      terminal = z.string().parse(record(data['turn'])['status']);
      beginUsageWait();
    }
    if (method === 'thread/tokenUsage/updated') {
      result.usage = usageSummary(params);
      if (item.id === 'usage-semantics') {
        const wireUsage = record(data['tokenUsage']);
        (result.usageSamples ??= []).push({
          last: z
            .number()
            .int()
            .nonnegative()
            .parse(record(wireUsage['last'])['totalTokens']),
          total: z
            .number()
            .int()
            .nonnegative()
            .parse(record(wireUsage['total'])['totalTokens']),
        });
      }
      const usageTurnId = z.string().parse(data['turnId']);
      const totalTokens = z
        .number()
        .int()
        .nonnegative()
        .parse(record(result.usage)['totalTokens']);
      if (steerSent && result.steer)
        result.steer.usageAfter.push({ turnId: usageTurnId, totalTokens });
      if (usageTurnId === terminalUsageTurn) finishUsageWait?.(true);
      try {
        usage.observe(item.id, totalTokens, usageTurnId);
      } finally {
        (result.usageByTurn ??= {})[usageTurnId] = usage.turnTotal(
          item.id,
          usageTurnId,
        );
      }
    }
    inspect();
  };
  try {
    if (typeof selected.approvalPolicy !== 'string') {
      (result.notes ??= []).push(
        'Initialize: experimentalApi=true (required by 0.155.1 for granular approvals)',
      );
    }
    const init = record(
      await rpc.request(
        'initialize',
        initializeParams(selected.approvalPolicy),
      ),
    );
    if (
      typeof init['codexHome'] !== 'string' ||
      realpathSync(init['codexHome']) !== realpathSync(experiment.home)
    )
      throw new Error('CODEX_HOME isolation mismatch');
    rpc.notify('initialized');
    const models = record(await rpc.request('model/list', {}));
    if (
      !z
        .array(z.object({ id: z.string(), model: z.string().optional() }))
        .parse(models['data'])
        .some((entry) => entry.id === model || entry.model === model)
    )
      throw new Error('Selected model not in first model/list page');
    const configResponse = await rpc.request('config/read', {
      includeLayers: false,
    });
    if (item.kind === 'mcp') {
      const parsed = z
        .object({
          config: z.object({
            mcp_servers: z.object({
              marker: z.record(z.string(), z.unknown()),
            }),
          }),
        })
        .safeParse(configResponse);
      const marker = parsed.success
        ? parsed.data.config.mcp_servers.marker
        : {};
      if (!Object.hasOwn(marker, 'default_tools_approval_mode'))
        (result.notes ??= []).push(
          'MCP approval mode not visible in config/read',
        );
      else if (marker['default_tools_approval_mode'] !== 'prompt')
        throw new Error('Effective config differs from bounded profile');
    }
    result.effectiveConfig = configSummary(configResponse);
    const effective = record(result.effectiveConfig);
    if (
      Object.entries(OUTPUT_BOUNDS).some(
        ([key, value]) => effective[key] !== value,
      ) ||
      effective['sandbox_mode'] !== selected.sandbox
    )
      throw new Error('Effective config differs from bounded profile');
    assertEffectiveApprovalPolicy(
      effective['approval_policy'],
      selected.approvalPolicy,
    );
    const thread = await rpc.request('thread/start', {
      model,
      cwd: experiment.workspace,
      ...selected,
      ephemeral: true,
      developerInstructions: readRule
        ? 'Evidence experiment. Only read the single requested fixture. Do not inspect credentials, config, home, environment or network. No subagents or retries. Stop after one tool action.'
        : editing
          ? // Match accept/deny while allowing one action for each user message.
            MARKER_MESSAGE_INSTRUCTIONS
          : MARKER_INSTRUCTIONS,
    });
    if (typeof selected.approvalPolicy !== 'string') {
      assertThreadApprovalPolicy(thread, selected.approvalPolicy);
      (result.notes ??= []).push(
        'Effective config: granular approvalPolicy and approvalsReviewer="user" confirmed by thread/start response',
      );
    }
    assertSafeSandbox(thread);
    threadId = objectId(thread, 'thread');
    const prompt =
      item.kind === 'mcp'
        ? 'Use only marker MCP write_marker once with slot original. After the tool result, reply DONE without further tools or retries.'
        : item.kind === 'file'
          ? `Use the file edit tool once to create ${target} containing marker. Request approval. No commands or retries.`
          : // The command stands alone on its line: run 6d copied a trailing period into it.
            commandPrompt(expectedCommand, readRule);
    const sandboxPolicy =
      selected.sandbox === 'read-only'
        ? { type: 'readOnly', networkAccess: false }
        : {
            type: 'workspaceWrite',
            writableRoots: [experiment.workspace],
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          };
    const started = await rpc.request(
      'turn/start',
      {
        threadId,
        model,
        sandboxPolicy,
        approvalPolicy: selected.approvalPolicy,
        ...(selected.approvalsReviewer
          ? { approvalsReviewer: selected.approvalsReviewer }
          : {}),
        input: [{ type: 'text', text: prompt, text_elements: [] }],
      },
      budget,
    );
    initialTurnId ||= objectId(started, 'turn');
    turnId ||= initialTurnId;
    chargedTurns.add(initialTurnId);
    if (outcome && item.id !== 'usage-semantics') interrupt();
    while (
      (!terminal && !interrupted) ||
      (editing && result.steer?.status === 'pending')
    ) {
      rpc.assertHealthy();
      inspect();
      await delay(20);
    }
    rpc.assertHealthy();
    inspect();
    await usageWait;
    rpc.assertHealthy();
    inspect();
    result.terminal = terminal;
    result.markers = markerState(
      experiment.root,
      original,
      replacement,
      outside,
    );
    result.status =
      readRule && readCompleted && approvalRounds === 0
        ? 'unverified: rule did not prompt'
        : outcome &&
            validatedApprovals.length === (editing ? 2 : 1) &&
            (!readRule ||
              terminal === 'interrupted' ||
              result.execPolicyRule?.completedStatus === 'declined' ||
              result.execPolicyRule?.completedStatus === 'failed') &&
            (!editing || result.steer?.status === 'success')
          ? 'observed'
          : 'unverified: required gate not observed';
    if (
      compact &&
      result.status === 'observed' &&
      manifest.methods.requests.includes('thread/compact/start')
    ) {
      compacting = true;
      result.notes?.push(
        'Compaction shares the case deadline and usage bounds; separately charged model invocation.',
      );
      await rpc.request('thread/compact/start', { threadId }, budget);
      while (!compacted) {
        rpc.assertHealthy();
        await delay(20);
      }
      result.notes?.push('compaction completion observed');
    }
    if (item.id === 'usage-semantics') {
      const samples = result.usageSamples ?? [];
      const distinct = samples.filter(
        (sample, index) =>
          index === 0 || sample.total > samples[index - 1].total,
      );
      if (terminal !== 'completed' || distinct.length < 2)
        result.status = 'unverified: two model requests required';
      result.round = {
        usageLastMatchesIncrement:
          distinct.length >= 2 &&
          distinct
            .slice(1)
            .every(
              (sample, index) =>
                sample.last === sample.total - distinct[index].total,
            ),
      };
    }
    if (!result.usage)
      throw new Error('No usage evidence; stop before further inference');
  } catch (error) {
    harnessFailed = true;
    throw error;
  } finally {
    const expectedApprovals = editing ? 2 : 1;
    if (
      item.kind === 'command' &&
      terminal === 'completed' &&
      validatedApprovals.length < expectedApprovals
    )
      (result.notes ??= []).push(
        `Command turn completed with ${validatedApprovals.length} of ${expectedApprovals} expected approval requests; recorded agent messages: ${result.agentMessages?.length ?? 0}`,
      );
    if (
      item.kind !== 'command' &&
      shouldNoteMissingApproval(
        turnId,
        item.level,
        approvalRequestObserved,
        harnessFailed,
      )
    ) {
      (result.notes ??= []).push('granular ask: no approval request observed');
    }
    if (result.steer?.status === 'success')
      (result.notes ??= []).push(
        result.steer.newTurnStarted || result.steer.responseTurn === 'new'
          ? 'steer started a new turn'
          : 'steer stayed in the same turn',
      );
    await usageWait;
    clearTimeout(usageTimer);
    clearInterval(guard);
    clearTimeout(deadline);
    await rpc.stop();
    children.delete(rpc);
    // Cases share an experiment home: do not carry this rule into later children.
    if (readRule)
      rmSync(join(experiment.home, 'rules/default.rules'), { force: true });
    result.markers = markerState(
      experiment.root,
      original,
      replacement,
      outside,
    );
  }
}

export interface HarnessOptions {
  run: boolean;
  dryRun: boolean;
  keep: boolean;
  binary?: string;
  authSource?: string;
  model?: string;
  out?: string;
  turnCap?: number;
}

export function parseOptions(args: string[]): HarnessOptions {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      run: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      keep: { type: 'boolean' },
      binary: { type: 'string' },
      'auth-source': { type: 'string' },
      model: { type: 'string' },
      out: { type: 'string' },
      'turn-cap': { type: 'string' },
    },
  });
  const turnCap =
    values['turn-cap'] === undefined ? TURN_CAP : Number(values['turn-cap']);
  new TurnBudget(turnCap);
  return {
    turnCap,
    run: values.run === true,
    dryRun: values['dry-run'] === true || values.run !== true,
    keep: values.keep === true,
    binary: values.binary,
    authSource: values['auth-source'],
    model: values.model,
    out: values.out,
  };
}
export async function runHarness(
  options: HarnessOptions,
  cases: readonly EvidenceCase[],
  print: (text: string) => void = (text) => process.stdout.write(text),
  io: typeof disk = disk,
): Promise<void> {
  const cap = options.turnCap ?? TURN_CAP;
  const budget = new TurnBudget(cap);
  const plannedTurns = cases.reduce((sum, item) => sum + item.turnCost, 0);
  if (plannedTurns > cap) throw new Error('Planned turn budget exceeds cap');
  const worstCaseTurns =
    plannedTurns +
    cases.filter((item) => item.kind === 'command' && item.decision === 'edit')
      .length;
  const turnBudgetNote =
    'A steer-created turn can cause later cases to be skipped.';
  if (!options.run || options.dryRun) {
    print(
      JSON.stringify(
        {
          mode: 'dry-run',
          cap,
          worstCaseTurns,
          turnBudgetNote,
          outputBounds: OUTPUT_BOUNDS,
          usageBounds: {
            perTurn: USAGE_TURN_LIMIT,
            cumulative: USAGE_CUMULATIVE_LIMIT,
          },
          caseDeadlinesMs: Object.fromEntries(
            cases.map((item) => [item.id, caseDeadlineMs(item)]),
          ),
          cases: cases.map((item) => ({
            ...item,
            deadlineMs: caseDeadlineMs(item),
          })),
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  const { binary: binaryInput, authSource, model, out } = options;
  if (
    !binaryInput ||
    !authSource ||
    !model ||
    !out ||
    !isAbsolute(binaryInput) ||
    !isAbsolute(authSource)
  ) {
    throw new Error(
      'Required: --run --binary <absolute native path> --auth-source <absolute auth.json> --model <id> --out <markdown path>',
    );
  }
  const binary = realpathSync(binaryInput);
  if (/\.(cmd|bat|js|mjs)$/i.test(binary))
    throw new Error('Use a native executable');
  const { manifest, schemaText } = loadManifest(binary);
  const output = resolve(out);
  if (basename(authSource).toLowerCase() !== 'auth.json')
    throw new Error('Auth source must be auth.json');
  if (!/\.md$/i.test(output))
    throw new Error('--out must be a markdown artifact path');
  const authPath = realpathSync(authSource);
  const outputJson = output.replace(/\.md$/i, '.json');
  if (
    [output, outputJson].some(
      (path) =>
        resolve(path) === resolve(authSource) ||
        (existsSync(path) && realpathSync(path) === authPath),
    )
  )
    throw new Error('Artifact destination overlaps source credentials');
  const usage = new UsageBudget();
  const results: CaseResult[] = [];
  let experiment: Experiment | undefined;
  const children = new Set<RpcChild>();
  let cleanup = 'pending';
  let stop = false;
  const signal = createFatalCleanup(() => {
    if (experiment) cleanupExperiment(experiment, options.keep, io);
  }, children);
  const fatalEvents = [
    'SIGINT',
    'SIGTERM',
    'uncaughtException',
    'unhandledRejection',
    ...(process.platform === 'win32' ? ['SIGBREAK'] : []),
  ];
  for (const event of fatalEvents) process.on(event, signal);
  try {
    experiment = createExperiment(authSource, io, (created) => {
      experiment = created;
    });
    for (const item of cases) {
      const result: CaseResult = {
        id: item.id,
        status: 'not run',
        turns: 0,
        events: [],
        approvals: [],
        notes: [],
      };
      results.push(result);
      if (item.kind === 'schema') {
        result.status = 'schema only';
        result.notes = [
          item.id === 'subagent-and-rewind'
            ? JSON.stringify(schemaProbe(manifest))
            : item.id === 'modified-input-schema'
              ? `modifiedInput property present: ${schemaText.includes('"modifiedInput"')}; wire response and behavior unverified; no invented mapping`
              : `Method presence only: ${Object.values(manifest.methods)
                  .flat()
                  .filter((method) =>
                    /userInput|plan|agent|rollback|resume|compact|skills/i.test(
                      method,
                    ),
                  )
                  .join(', ')}`,
        ];
        continue;
      }
      if (item.kind === 'compact') {
        const source = results.find(
          (entry) => entry.id === 'ask-command-accept',
        );
        if (source && source.turns > 1) {
          result.turns = source.turns - 1;
          source.turns = 1;
        }
        result.status = source?.notes?.includes(
          'compaction completion observed',
        )
          ? 'observed'
          : 'unverified: compaction not observed';
        result.notes = [
          'Reserved invocation is charged on the retained accepted-command child.',
        ];
        continue;
      }
      if (stop || usage.exceeded) {
        result.status = 'not run: prior gate or usage bound';
        continue;
      }
      if (budget.consumed >= cap) {
        result.status = 'not run: prior gate or usage bound';
        continue;
      }
      try {
        await runCase(
          item,
          result,
          experiment,
          binary,
          model,
          budget,
          usage,
          manifest,
          schemaText,
          item.id === 'ask-command-accept',
          children,
          dirname(authPath),
        );
        if (
          item.id === 'usage-semantics' &&
          (result.usageSamples?.length ?? 0) < 2
        ) {
          result.status = 'unverified: two usage notifications required';
        }
        if (shouldStopAfterCase(result.status)) stop = true;
      } catch (error) {
        recordCaseFailure(result, error);
        result.status =
          result.status === 'not run: cap'
            ? result.status
            : 'failed: protocol, isolation or approval gate';
        stop = true;
      }
    }
  } finally {
    try {
      for (const child of children) child.stopSync();
      if (experiment) cleanupExperiment(experiment, options.keep, io);
      cleanup =
        'home/auth deleted; experiment ' +
        (options.keep ? 'non-home files retained' : 'deleted');
    } catch {
      cleanup = 'FAILED: manual cleanup required';
    } finally {
      for (const event of fatalEvents) process.removeListener(event, signal);
    }
    const artifact = sanitize({
      provenance: 'real run requested; individual observations only',
      model,
      binary,
      binarySha256: manifest.binarySha256,
      schemaSha256: manifest.schemaSha256,
      platform: process.platform,
      arch: process.arch,
      cap,
      worstCaseTurns,
      turnBudgetNote,
      turnsConsumed: budget.consumed,
      outputBounds: OUTPUT_BOUNDS,
      usageBounds: {
        perTurn: USAGE_TURN_LIMIT,
        cumulative: USAGE_CUMULATIVE_LIMIT,
      },
      observedUsage: usage.consumed,
      caseDeadlinesMs: Object.fromEntries(
        cases.map((item) => [item.id, caseDeadlineMs(item)]),
      ),
      cleanup,
      results,
      harnessCapabilities: [
        ['Plan entry/read-only planning', 'plan'],
        ['AskUserQuestion', 'userInput'],
        ['ExitPlanMode', 'plan'],
        ['Subagent spawn/list/background', 'agent'],
        ['Agent reporting/interrupted context', 'agent'],
        ['Edited input/remembered permissions', 'Approval'],
        ['Compact/file rewind', 'compact|rollback'],
        ['Skills/instruction harness', 'skills'],
      ].map(([capability, pattern]) => ({
        capability,
        behavior: 'unverified; case observations do not establish parity',
        schemaMethods: Object.values(manifest.methods)
          .flat()
          .filter((method) => new RegExp(pattern, 'i').test(method)),
      })),
      gaps: [
        'modifiedInput behavior',
        'Always Allow',
        'native plan transitions and user answers/cancel',
        'subagent lifecycle',
        'remote MCP/OAuth/Smithery',
        'skills/instructions/images/effort/resume role parity',
        'same-home concurrent profile isolation',
        'different-account isolation',
        'file rewind/history/stats',
        'packaged binary manifests',
        'positive read and multi-path sandbox boundaries are not proved by single-action cases',
        'usage reporting can lag billing; observed usage bounds are not a provider-side spending limit; usage is observed after the turn, so one turn can overshoot',
      ],
    });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(outputJson, JSON.stringify(artifact, null, 2) + '\n');
    appendFileSync(
      output,
      String(
        sanitize(
          '\n| Case | Status | Charged turns |\n| --- | --- | ---: |\n' +
            results
              .map(
                (entry) => `| ${entry.id} | ${entry.status} | ${entry.turns} |`,
              )
              .join('\n') +
            `\n\nTotal: ${budget.consumed}/${cap}. Observed usage: ${usage.consumed}. Usage bounds: ${USAGE_TURN_LIMIT} per turn, ${USAGE_CUMULATIVE_LIMIT} cumulative. Cleanup: ${cleanup}.\n`,
        ),
      ),
    );
    // A failed secret cleanup must surface even when the run itself threw, so it overrides that error.
    // eslint-disable-next-line no-unsafe-finally
    if (cleanup.startsWith('FAILED')) throw new Error('Secret cleanup failed');
  }
}
if (require.main === module) {
  const cases = z
    .array(caseSchema)
    .parse(
      JSON.parse(readFileSync(join(__dirname, 'evidence-cases.json'), 'utf8')),
    );
  void runHarness(parseOptions(process.argv.slice(2)), cases).catch(() => {
    process.stderr.write(
      'Evidence harness failed; sensitive error details withheld. Check prerequisites and sanitized results.\n',
    );
    process.exitCode = 1;
  });
}
