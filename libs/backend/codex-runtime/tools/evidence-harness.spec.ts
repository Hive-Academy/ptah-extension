import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { childEnvironment, cleanupExperiment, createExperiment, disk, FrameDecoder, MAX_FRAME_BYTES,
  parseOptions, RpcChild, runHarness, sanitize, TURN_CAP, TurnBudget, type Experiment,
  assertSafeSandbox, policy, markerApprovalDecision, markerExists, assertDisjointHomes, createFatalCleanup,
  UsageBudget, USAGE_CEILING, type MarkerApproval, errorCode } from './evidence-harness';

function fakeDisk(): jest.Mocked<typeof disk> {
  return {
    mkdtempSync: jest.fn().mockReturnValue(join('fake', 'experiment')),
    mkdirSync: jest.fn(), copyFileSync: jest.fn(), chmodSync: jest.fn(), writeFileSync: jest.fn(), rmSync: jest.fn(),
    realpathSync: Object.assign(jest.fn().mockImplementation((path) => resolve(String(path))), { native: realpathSync.native }),
    lstatSync: jest.fn().mockReturnValue({ isSymbolicLink: () => false }),
  };
}
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: jest.fn().mockReturnValue(true), exitCode: 0, pid: undefined,
  });
}

describe('evidence harness safety (no native binaries or models)', () => {
  it('enforces one cap across children, failed sends and compaction, with no reset', async () => {
    const budget = new TurnBudget();
    const result = { id: 'cap', status: 'not run', turns: 0, events: [], approvals: [] };
    const firstChild = fakeChild();
    const secondChild = fakeChild();
    const first = new RpcChild(firstChild, result);
    const second = new RpcChild(secondChild, result);
    let frames = 0;
    for (const child of [firstChild, secondChild]) child.stdin.on('data', (chunk: Buffer) => {
      frames += 1;
      const request: { id: number } = JSON.parse(chunk.toString());
      child.stdout.write(JSON.stringify({ id: request.id, error: { code: -1, message: 'fake failure' } }) + '\n');
    });
    for (let index = 0; index < TURN_CAP; index += 1) {
      await expect((index % 2 ? first : second).request(index === 2 ? 'thread/compact/start' : 'turn/start', {}, budget))
        .rejects.toThrow('RPC error');
    }
    await expect(first.request('turn/start', {}, budget)).rejects.toThrow('not run: cap');
    await expect(second.request('thread/compact/start', {}, budget)).rejects.toThrow('not run: cap');
    expect(frames).toBe(8);
    expect(budget.consumed).toBe(8);
    expect(result.status).toBe('not run: cap');
    firstChild.emit('close', 0); secondChild.emit('close', 0);
    await first.stop(); await second.stop();
  });

  it('rejects model invocations without the global budget', async () => {
    const child = fakeChild();
    const rpc = new RpcChild(child, { id: 'missing-budget', status: '', turns: 0, events: [], approvals: [] });
    await expect(rpc.request('turn/start', {})).rejects.toThrow('not run: cap');
    child.emit('close', 0);
    await rpc.stop();
  });

  it.each([false, true])('copies only auth and always deletes it (keep=%s)', (keep) => {
    const io = fakeDisk();
    const experiment = createExperiment(join('real-home', 'auth.json'), io);
    expect(io.copyFileSync.mock.calls).toEqual([[join('real-home', 'auth.json'), join(experiment.home, 'auth.json')]]);
    expect(io.chmodSync).toHaveBeenCalledWith(join(experiment.home, 'auth.json'), 0o600);
    expect(JSON.stringify(io.copyFileSync.mock.calls)).not.toContain('config.toml');
    expect(io.writeFileSync).not.toHaveBeenCalled();
    cleanupExperiment(experiment, keep, io);
    expect(io.rmSync).toHaveBeenCalledWith(join(experiment.home, 'auth.json'), { force: true });
    expect(io.rmSync).toHaveBeenCalledWith(experiment.home, { recursive: true, force: true });
    expect(io.rmSync.mock.calls.some(([path]) => path === experiment.root)).toBe(!keep);
  });

  it('removes partial auth setup after a copy failure', () => {
    const io = fakeDisk();
    io.copyFileSync.mockImplementation(() => { throw new Error('secret failure'); });
    expect(() => createExperiment('auth.json', io)).toThrow('details withheld');
    expect(io.rmSync).toHaveBeenCalledWith(resolve('fake', 'experiment', 'home', 'auth.json'), { force: true });
    expect(io.rmSync).toHaveBeenCalledWith(resolve('fake', 'experiment'), { recursive: true, force: true });
  });

  it('attempts whole-home/root removal even when individual auth deletion fails', () => {
    const io = fakeDisk();
    const experiment = createExperiment('auth.json', io);
    io.rmSync.mockImplementationOnce(() => { throw new Error('denied'); });
    expect(() => cleanupExperiment(experiment, false, io)).toThrow('denied');
    expect(io.rmSync).toHaveBeenCalledWith(experiment.home, { recursive: true, force: true });
    expect(io.rmSync).toHaveBeenCalledWith(experiment.root, { recursive: true, force: true });
  });

  it('overrides only child env, strips inherited credentials, and leaves process.env unchanged', () => {
    const before = { ...process.env };
    const source = Object.freeze({ PATH: 'path', CODEX_HOME: 'real-home', OPENAI_API_KEY: 'secret', HTTPS_PROXY: 'secret-proxy' });
    const experiment: Experiment = { root: 'root', workspace: 'workspace', home: 'isolated-home', scratch: 'scratch' };
    expect(childEnvironment(experiment, source)).toEqual({ PATH: 'path', CODEX_HOME: 'isolated-home', HOME: 'isolated-home',
      USERPROFILE: 'isolated-home', TMP: 'scratch', TEMP: 'scratch', TMPDIR: 'scratch' });
    expect(source.CODEX_HOME).toBe('real-home');
    expect(process.env).toEqual(before);
  });

  it.each([{ args: [] }, { args: ['--dry-run'] }, { args: ['--run', '--dry-run'] }])('dry-run $args performs no disk operation', async ({ args }) => {
    const io = fakeDisk();
    const print = jest.fn();
    await runHarness(parseOptions(args), [{ id: 'fake-case', kind: 'command', turnCost: 1, observations: [2], purpose: 'fake' }], print, io);
    expect(print).toHaveBeenCalledWith(expect.stringContaining('dry-run'));
    for (const operation of Object.values(io)) expect(operation).not.toHaveBeenCalled();
  });

  it('requires all explicit real-run arguments before creating an experiment', async () => {
    const io = fakeDisk();
    await expect(runHarness(parseOptions(['--run']), [], jest.fn(), io)).rejects.toThrow('Required:');
    expect(io.mkdtempSync).not.toHaveBeenCalled();
  });

  it('bounds newline-terminated and unterminated frames across chunks', () => {
    expect(() => new FrameDecoder().push(Buffer.alloc(MAX_FRAME_BYTES + 1, 97))).toThrow('frame too large');
    expect(() => new FrameDecoder().push(Buffer.from('a'.repeat(MAX_FRAME_BYTES + 1) + '\n'))).toThrow('frame too large');
    const split = new FrameDecoder();
    split.push(Buffer.alloc(MAX_FRAME_BYTES, 97));
    expect(() => split.push(Buffer.from('a\n'))).toThrow('frame too large');
  });

  it('validates envelopes and preserves UTF-8 split across chunks', () => {
    const decoder = new FrameDecoder();
    const bytes = Buffer.from(JSON.stringify({ method: 'notice', params: 'é' }) + '\n');
    const split = bytes.indexOf(0xc3) + 1;
    expect(decoder.push(bytes.subarray(0, split))).toEqual([]);
    expect(decoder.push(bytes.subarray(split))).toEqual([{ method: 'notice', params: 'é' }]);
    expect(() => decoder.push(Buffer.from('{"id":1,"method":42}\n'))).toThrow();
    expect(() => new FrameDecoder().push(Buffer.from('{"id":1,"result":{},"error":{"code":1,"message":"x"}}\n'))).toThrow();
  });

  it('strips auth fields, bearer/JWT/API token strings and explicit opaque secrets', () => {
    const value = sanitize({ authorization: 'secret', nested: { refresh_token: 'refresh', prompt: 'private prompt' },
      output: 'Bearer abc.def sk-123456789abc eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature access_token=opaque opaque-secret',
      usage: { inputTokens: 12 } }, ['opaque-secret']);
    const serialized = JSON.stringify(value);
    for (const secret of ['private prompt', 'abc.def', 'sk-123456789abc', 'eyJhbGci', 'opaque-secret', '=opaque']) {
      expect(serialized).not.toContain(secret);
    }
    expect(value).toMatchObject({ usage: { inputTokens: 12 } });
  });
});


describe('review regression guards using real functions and isolated disk', () => {
  let root: string;
  beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'ptah-evidence-safety-test-'))); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('rejects full access recursively and retains approval requests for every level', () => {
    expect(() => assertSafeSandbox({ sandboxPolicy: { type: 'danger-full-access' } })).toThrow('Unsafe sandbox');
    expect(() => assertSafeSandbox('external-sandbox')).toThrow('Unsafe sandbox');
    for (const level of ['ask', 'plan', 'auto-edit', 'yolo'] as const) {
      expect(policy(level).approvalPolicy).toBe('untrusted');
      expect(policy(level).sandbox).toBe(level === 'auto-edit' || level === 'yolo' ? 'workspace-write' : 'read-only');
    }
  });

  it('rejects unsafe sandbox on the actual request path without writing a frame', async () => {
    const child = fakeChild();
    const result = { id: 'sandbox', status: '', turns: 0, events: [], approvals: [] };
    const rpc = new RpcChild(child, result);
    const write = jest.spyOn(child.stdin, 'write');
    await expect(rpc.request('thread/start', { sandbox: 'danger-full-access' })).rejects.toThrow('Unsafe sandbox');
    expect(write).not.toHaveBeenCalled();
    child.emit('close', 0);
    await rpc.stop();
  });

  it.each(['ask', 'plan', 'auto-edit', 'yolo'] as const)('declines unless the single fixed command matches (%s)', (level) => {
    const target = join(root, 'expected.marker');
    const context: MarkerApproval = { root, workspace: root, target, kind: 'boundary', level,
      decision: 'accept', threadId: 'thread', expectedCommand: 'fixed command', approvals: 0, validatedFileItems: new Set() };
    const frame = { id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', command: 'fixed command' } };
    expect(markerApprovalDecision(frame, context)).toBe(level === 'plan' ? 'decline' : 'accept');
    expect(markerApprovalDecision({ ...frame, params: { threadId: 'thread', command: 'write somewhere else' } }, context)).toBe('decline');
    expect(markerApprovalDecision({ ...frame, method: 'unknown/approval' }, context)).toBe('decline');
    expect(markerApprovalDecision(frame, { ...context, approvals: 1 })).toBe('decline');
    expect(markerApprovalDecision(frame, { ...context, decision: 'deny' })).toBe('decline');
  });

  it('requires an identified file item and exact MCP arguments', () => {
    const context: MarkerApproval = { root, workspace: root, target: join(root, 'marker'), kind: 'file', level: 'ask',
      decision: 'accept', threadId: 'thread', expectedCommand: 'fixed', approvals: 0, validatedFileItems: new Set(['expected']) };
    expect(markerApprovalDecision({ id: 1, method: 'item/fileChange/requestApproval', params: { threadId: 'thread', itemId: 'other' } }, context)).toBe('decline');
    const frame = { id: 2, method: 'item/mcpToolCall/requestApproval', params: { threadId: 'thread', server: 'marker', toolName: 'write_marker', arguments: { slot: 'original' } } };
    expect(markerApprovalDecision(frame, { ...context, kind: 'mcp' })).toBe('accept');
    expect(markerApprovalDecision({ ...frame, params: { ...frame.params, arguments: { slot: 'replacement' } } }, { ...context, kind: 'mcp' })).toBe('decline');
  });

  it('rejects real home equality and nesting in either direction, including a missing child', () => {
    const home = join(root, 'home');
    const protectedHome = join(root, 'real-codex');
    mkdirSync(home); mkdirSync(protectedHome);
    expect(() => assertDisjointHomes(root, home, [root])).toThrow('overlaps');
    expect(() => assertDisjointHomes(root, home, [protectedHome])).toThrow('overlaps');
    expect(() => assertDisjointHomes(home, home, [root])).toThrow('overlaps');
    expect(() => assertDisjointHomes(root, home, [join(home, 'missing', '.codex')])).toThrow('overlaps');
    expect(() => assertDisjointHomes(home, home, [protectedHome])).not.toThrow();
  });

  it.each(['file', 'parent'] as const)('rejects real %s symlinks including dangling markers', (kind) => {
    const directory = join(root, 'directory');
    const link = join(root, 'link');
    mkdirSync(directory);
    try { symlinkSync(kind === 'file' ? join(directory, 'absent') : directory, link,
      kind === 'file' ? 'file' : process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(errorCode(error) ?? '')) {
        process.stdout.write(`SKIP symlink ${kind}: OS forbids symlink creation.\n`);
        return;
      }
      throw error;
    }
    const marker = kind === 'file' ? link : join(link, 'marker');
    expect(() => markerExists(root, marker)).toThrow();
    expect(() => markerApprovalDecision({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread', command: 'fixed' } },
      { root, workspace: root, target: marker, kind: 'command', level: 'yolo', decision: 'accept', threadId: 'thread', expectedCommand: 'fixed', approvals: 0, validatedFileItems: new Set() })).toThrow();
  });

  it('copies auth only and synchronously kills before deleting it on repeated fatal handler calls', () => {
    const source = join(root, 'auth.json');
    writeFileSync(source, 'fake-auth');
    writeFileSync(join(root, 'config.toml'), 'never copy');
    let registered = false;
    const experiment = createExperiment(source, disk, (created) => {
      expect(() => lstatSync(join(created.home, 'auth.json'))).toThrow();
      registered = true;
    });
    const child = fakeChild();
    const rpc = new RpcChild(child, { id: 'signal', status: '', turns: 0, events: [], approvals: [] });
    const exits: number[] = [];
    let kills = 0;
    jest.spyOn(rpc, 'stopSync').mockImplementation(() => {
      if (kills++ === 0) expect(readFileSync(join(experiment.home, 'auth.json'), 'utf8')).toBe('fake-auth');
    });
    const handler = createFatalCleanup(() => cleanupExperiment(experiment, true), new Set([rpc]), (code) => { exits.push(code); });
    try {
      expect(registered).toBe(true);
      expect(() => lstatSync(join(experiment.home, 'config.toml'))).toThrow();
      handler();
      expect(() => lstatSync(join(experiment.home, 'auth.json'))).toThrow();
      handler();
      expect(kills).toBe(2);
      expect(exits).toEqual([1, 1]);
      expect(readFileSync(source, 'utf8')).toBe('fake-auth');
    } finally { cleanupExperiment(experiment, false); }
  });

  it('answers unknown server requests with an explicit decline frame', async () => {
    const child = fakeChild();
    const rpc = new RpcChild(child, { id: 'unknown', status: '', turns: 0, events: [], approvals: [] });
    const frames: string[] = [];
    child.stdin.on('data', (chunk: Buffer) => frames.push(chunk.toString()));
    child.stdout.write(JSON.stringify({ id: 'unknown', method: 'unknown/approval', params: {} }) + '\n');
    await new Promise<void>((done) => setImmediate(done));
    expect(frames.map((frame) => JSON.parse(frame))).toEqual([{ id: 'unknown', result: { decision: 'decline' } }]);
    expect(() => rpc.assertHealthy()).toThrow();
    child.emit('close', 0);
    await rpc.stop();
  });

  it('counts cumulative usage monotonically across children and rejects the ceiling', () => {
    const budget = new UsageBudget();
    budget.observe('one', 1000); budget.observe('one', 800); budget.observe('two', 500);
    expect(budget.consumed).toBe(1500);
    expect(() => budget.observe('two', USAGE_CEILING - 1000)).toThrow('ceiling');
  });

  it('redacts account/email/cookie/session/token keys and markdown text', () => {
    const text = 'person@example.com acct_12345 session=short cookie=value token=abc refresh=xyz';
    const sanitized = JSON.stringify(sanitize({ text, email: 'private', accountId: 'private', cookie: 'private', session: 'private', token: 'private', refresh: 'private' }));
    for (const secret of ['person@example.com', 'acct_12345', '=short', '=value', '=abc', '=xyz', 'private']) expect(sanitized).not.toContain(secret);
    expect(sanitize(`| ${text} |`)).not.toContain('person@example.com');
  });
});
