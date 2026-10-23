import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join, resolve } from 'node:path';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import {
  childEnvironment,
  cleanupExperiment,
  createExperiment,
  disk,
  parseOptions,
  RpcChild,
  runHarness,
  sanitize,
  TURN_CAP,
  TurnBudget,
  type Experiment,
  assertSafeSandbox,
  policy,
  approvalPolicyOverride,
  approvalPoliciesEqual,
  assertEffectiveApprovalPolicy,
  initializeParams,
  assertThreadApprovalPolicy,
  shouldNoteMissingApproval,
  commandMatches,
  markerApprovalDecision,
  markerExists,
  assertDisjointHomes,
  createFatalCleanup,
  UsageBudget,
  USAGE_CEILING,
  type MarkerApproval,
  errorCode,
} from './evidence-harness';
import { FrameDecoder, MAX_FRAME_BYTES } from './evidence-frames';
import {
  recordCaseFailure,
  recordCommandShape,
} from './evidence-failure-notes';

describe('strict command identity', () => {
  const expected =
    "& 'C:\\node.exe' 'C:\\case-marker.cjs' 'C:\\root' 'C:\\target'";

  it('accepts the exact command on every platform', () => {
    expect(commandMatches(expected, expected, 'win32')).toBe(true);
    expect(commandMatches(expected, expected, 'linux')).toBe(true);
    expect(commandMatches(undefined, expected, 'win32')).toBe(false);
  });

  it.each([
    'C:\\Windows\\System32\\powershell.exe',
    'C:\\Program Files\\PowerShell\\pwsh.exe',
    'C:/Windows/POWERSHELL.EXE',
    '\\\\server\\share\\pwsh.exe',
  ])('accepts only the exact absolute PowerShell wrapper: %s', (shell) => {
    expect(
      commandMatches(`"${shell}" -Command "${expected}"`, expected, 'win32'),
    ).toBe(true);
  });

  it.each([
    `"powershell.exe" -Command "${expected}"`,
    `"tools\\pwsh.exe" -Command "${expected}"`,
    `"C:pwsh.exe" -Command "${expected}"`,
    `"C:\\cmd.exe" -Command "${expected}"`,
    `"C:\\bash" -Command "${expected}"`,
    `"C:\\pwsh.exe" -NoProfile -Command "${expected}"`,
    `"C:\\pwsh.exe" -Command "${expected}" extra`,
    `"C:\\pwsh.exe" -Command "${expected}"\n`,
    `"C:\\pwsh.exe" -Command "${expected} extra"`,
    `"C:\\pwsh.exe" -Command "${expected.toUpperCase()}"`,
    `"C:\\bad"path\\pwsh.exe" -Command "${expected}"`,
  ])('rejects a non-identical or unsupported wrapper: %s', (observed) => {
    expect(commandMatches(observed, expected, 'win32')).toBe(false);
  });

  it('rejects wrapper matching for double quotes and non-Windows platforms', () => {
    const quoted = expected + ' "extra"';
    expect(
      commandMatches(`"C:\\pwsh.exe" -Command "${quoted}"`, quoted, 'win32'),
    ).toBe(false);
    expect(
      commandMatches(
        `"C:\\pwsh.exe" -Command "${expected}"`,
        expected,
        'linux',
      ),
    ).toBe(false);
  });

  it('builds a file-backed marker command without inline code or double quotes', () => {
    const source = readFileSync(join(__dirname, 'evidence-harness.ts'), 'utf8');
    expect(source).toContain(
      '[process.execPath, markerScript, experiment.root, target]',
    );
    expect(source).not.toContain("[process.execPath, '-e'");
    expect(source).toContain("if (expectedCommand.includes('\"'))");
    expect(source).toContain('writeMarker(process.argv[2],process.argv[3]);');
    expect(expected).not.toContain('"');
    expect(expected).not.toContain("'-e'");
  });
});

describe('bounded command shape diagnostics', () => {
  const experiment = {
    root: 'C:\\evidence',
    home: 'C:\\evidence\\home',
    scratch: 'C:\\evidence\\scratch',
    workspace: 'C:\\evidence\\workspace',
  };
  const markerScript = 'C:\\evidence\\case-marker.cjs';
  const expectedCommand = `'${process.execPath}' '${markerScript}' '${experiment.root}' '${experiment.workspace}'`;
  const context = { experiment, markerScript, expectedCommand, sanitize };

  it('replaces real home and temp paths while preserving nested experiment paths', () => {
    const nested = {
      root: join(tmpdir(), 'shape-experiment'),
      home: join(tmpdir(), 'shape-experiment', 'home'),
      scratch: join(tmpdir(), 'shape-experiment', 'scratch'),
      workspace: join(homedir(), 'shape-workspace'),
    };
    const result = { notes: [] as string[] };
    recordCommandShape(
      result,
      {},
      {
        command: [
          `${homedir()}/private.txt`,
          `${tmpdir()}/private.txt`,
          nested.root,
          nested.home,
          nested.scratch,
          nested.workspace,
        ]
          .map((path) => JSON.stringify(path))
          .join(' '),
      },
      { ...context, experiment: nested },
    );
    expect(result.notes[0]).toBe(
      'Unexpected command shape: "<USER_HOME>/private.txt" ' +
        '"<TMP>/private.txt" "<ROOT>" "<HOME>" "<SCRATCH>" "<WORKSPACE>"',
    );
  });

  it('replaces cwd, CODEX_HOME and the caller auth directory', () => {
    const previous = process.env['CODEX_HOME'];
    const codexHome = join(tmpdir(), 'shape-codex-home');
    const authDirectory = join(codexHome, 'source');
    try {
      process.env['CODEX_HOME'] = codexHome;
      const result = { notes: [] as string[] };
      recordCommandShape(
        result,
        {},
        {
          command: [process.cwd(), codexHome, authDirectory].join(' '),
        },
        { ...context, authDirectory },
      );
      expect(result.notes[0]).toBe(
        'Unexpected command shape: <CWD> <CODEX_HOME> <AUTH_DIR>',
      );
    } finally {
      if (previous === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = previous;
    }
  });

  it.each([
    'Z:\\unknown-profile\\private.txt',
    'Z:/unknown-profile/private.txt',
    '\\\\unknown-host\\share\\private.txt',
    '/home/unknown-profile/private.txt',
    '/Users/unknown-profile/private.txt',
    '~/private.txt',
  ])('redacts an unknown absolute path: %s', (path) => {
    const result = { notes: [] as string[] };
    recordCommandShape(result, {}, { command: `cat "${path}" tail` }, context);
    expect(result.notes[0]).toBe('Unexpected command shape: cat "<PATH>" tail');
  });

  it('redacts a secret straddling character 400 before capping the note', () => {
    const secret = 'private-boundary-secret';
    const prefix = 'x '.repeat(195);
    const result = { notes: [] as string[] };
    recordCommandShape(
      result,
      {},
      { command: prefix + secret + ' tail '.repeat(20) },
      { ...context, sanitize: (value) => sanitize(value, [secret]) },
    );
    expect(result.notes[0]).toBe(
      'Unexpected command shape: ' + prefix + '[REDACTED]',
    );
    expect(result.notes[0]).not.toContain('private');
  });

  it('replaces specific paths before the root, script quoting variants and the node executable', () => {
    const result = { notes: [] as string[] };
    recordCommandShape(
      result,
      { command: 'unused' },
      {
        command: [
          process.execPath,
          markerScript.replace(/'/g, "''"),
          experiment.root,
          experiment.home.replace(/\\/g, '/'),
          experiment.scratch,
          experiment.workspace,
        ].join('  '),
      },
      context,
    );
    expect(result.notes[0]).toBe(
      'Unexpected command shape: <NODE> <MARKER_SCRIPT> <ROOT> <HOME> <SCRATCH> <WORKSPACE>',
    );
  });

  it.each(['powershell -Command', 'cmd /c', 'bash -lc'])(
    'classifies %s without approving it',
    (wrapper) => {
      const result = { notes: [] as string[] };
      recordCommandShape(
        result,
        {},
        { command: `${wrapper} "${expectedCommand}"` },
        context,
      );
      expect(result.notes).toContain('Command differs by: shell wrapper');
    },
  );

  it('distinguishes quoting from changed arguments and emits one shape per case', () => {
    const quoting = { notes: [] as string[] };
    const command = `${process.execPath} "${markerScript}" ${experiment.root} ${experiment.workspace}`;
    recordCommandShape(quoting, {}, { command }, context);
    expect(quoting.notes).toContain('Command differs by: quoting');
    const other = { notes: [] as string[] };
    recordCommandShape(
      other,
      {},
      { command: expectedCommand + ' extra' },
      context,
    );
    recordCommandShape(other, {}, { command: 'second shape' }, context);
    expect(other.notes).toHaveLength(3);
    expect(other.notes).toContain('Command differs by: other');
  });

  it('preserves the PowerShell basename and classifies an absolute shell wrapper', () => {
    const result = { notes: [] as string[] };
    recordCommandShape(
      result,
      {},
      {
        command: `"C:\\Private Directory\\powershell.exe" -Command "${expectedCommand}"`,
      },
      context,
    );
    expect(result.notes[0]).toContain('"<PATH>\\powershell.exe" -Command');
    expect(result.notes[0]).toContain('<MARKER_SCRIPT>');
    expect(result.notes.join(' ')).not.toContain('Private Directory');
    expect(result.notes).toContain('Command differs by: shell wrapper');
  });

  it('keeps only bounded command fields and camelCase key names, then sanitizes', () => {
    const result = { notes: [] as string[] };
    const params = {
      command: 'Bearer private-auth ' + 'x '.repeat(500),
      env: 'private-env',
      stderr: 'private-stderr',
      modelText: 'private-model',
      CODEX_HOME: 'private-home',
      'bad key': 'private',
      ['k'.repeat(40)]: 'private',
    };
    recordCommandShape(result, params, params, context);
    expect(result.notes[0].length).toBeLessThanOrEqual(
      'Unexpected command shape: '.length + 400,
    );
    expect(result.notes[0]).toContain('Bearer [REDACTED]');
    expect(result.notes[1]).toBe(
      'Request param keys: command, env, stderr, modelText',
    );
    expect(result.notes.join(' ')).not.toMatch(
      /private|CODEX_HOME|bad key|kkkk/,
    );
  });

  it('never records file-change contents or paths as command text', () => {
    const result = { notes: [] as string[] };
    recordCommandShape(
      result,
      { threadId: 'private' },
      { changes: [{ path: 'private-path', diff: 'private-diff' }] },
      context,
      'file change',
    );
    expect(result.notes).toEqual([
      'Unexpected file change shape: <missing command>',
      'Request param keys: threadId',
    ]);
  });

  it('matches path casing only on Windows', () => {
    const workspace = '/evidence/workspace';
    const result = { notes: [] as string[] };
    recordCommandShape(
      result,
      {},
      { command: workspace.toUpperCase() },
      { ...context, experiment: { ...experiment, workspace } },
    );
    expect(result.notes[0]).toBe(
      'Unexpected command shape: ' +
        (process.platform === 'win32'
          ? '<WORKSPACE>'
          : workspace.toUpperCase()),
    );
  });
});

function fakeDisk(): jest.Mocked<typeof disk> {
  return {
    mkdtempSync: jest.fn().mockReturnValue(join('fake', 'experiment')),
    mkdirSync: jest.fn(),
    copyFileSync: jest.fn(),
    chmodSync: jest.fn(),
    writeFileSync: jest.fn(),
    rmSync: jest.fn(),
    realpathSync: Object.assign(
      jest.fn().mockImplementation((path) => resolve(String(path))),
      { native: realpathSync.native },
    ),
    lstatSync: jest.fn().mockReturnValue({ isSymbolicLink: () => false }),
  };
}
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn().mockReturnValue(true),
    exitCode: 0,
    pid: undefined,
  });
}

describe('evidence harness safety (no native binaries or models)', () => {
  it('accepts the app-server timestamp notification without jsonrpc', () => {
    const line =
      '{"method":"remoteControl/status/changed","params":{},"emittedAtMs":1761150000000}\n';
    expect(new FrameDecoder().push(Buffer.from(line))).toEqual([
      {
        method: 'remoteControl/status/changed',
        params: {},
        emittedAtMs: 1761150000000,
      },
    ]);
  });

  it.each([-1, 1.5, '1761150000000'])(
    'rejects an invalid emittedAtMs (%s)',
    (emittedAtMs) => {
      expect(() =>
        new FrameDecoder().push(
          Buffer.from(JSON.stringify({ method: 'status', emittedAtMs }) + '\n'),
        ),
      ).toThrow();
    },
  );

  it('still rejects unknown top-level keys', () => {
    expect(() =>
      new FrameDecoder().push(
        Buffer.from('{"method":"status","foo":"private"}\n'),
      ),
    ).toThrow();
  });

  it('records a failed case reason and bounded key names without frame values', async () => {
    const child = fakeChild();
    const result = {
      id: 'bad-frame',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
      notes: [] as string[],
    };
    const rpc = new RpcChild(child, result);
    const frame = {
      method: 'private-method',
      params: { auth: 'private-auth' },
      foo: 'private-output',
      'bad key': 'private-value',
      CODEX_HOME: 'private',
      'tmp/auth.json': 'private',
      ['k'.repeat(40)]: 'private',
      ...Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`key${index}`, 'private']),
      ),
    };
    child.stdout.write(JSON.stringify(frame) + '\n');
    child.stdout.write(JSON.stringify(frame) + '\n');
    expect(() => rpc.assertHealthy()).toThrow(
      'invalid or oversized protocol frame',
    );
    expect(result.notes).toEqual([
      'invalid or oversized protocol frame',
      'Rejected frame keys: method, params, foo, key0, key1, key2, key3, key4, key5, key6',
    ]);
    expect(JSON.stringify(result.notes)).not.toContain('private');
    expect(JSON.stringify(result.notes)).not.toContain('bad key');
    expect(JSON.stringify(result.notes)).not.toMatch(
      /CODEX_HOME|auth\.json|kkkk/,
    );
    child.emit('close', 0);
    await rpc.stop();
    expect(result.notes).not.toContain('child stopped');
  });

  it('keeps the first allowlisted stdout failure instead of the protocol-frame substitute', async () => {
    const child = fakeChild();
    const result = {
      id: 'big-frame',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
      notes: [] as string[],
    };
    const rpc = new RpcChild(child, result);
    child.stdout.write(Buffer.alloc(MAX_FRAME_BYTES + 1, 0x61));
    expect(() => rpc.assertHealthy()).toThrow('frame too large');
    expect(result.notes).toEqual(['frame too large']);
    child.emit('close', 0);
    await rpc.stop();
  });

  it('classifies only string error codes', () => {
    expect(errorCode({ code: 'ENOENT' })).toBe('ENOENT');
    expect(errorCode({ code: ['ESRCH'] })).toBeUndefined();
    expect(errorCode({ code: { toString: () => 'ENOENT' } })).toBeUndefined();
  });

  it('records only allowlisted messages and safe error names across realms', () => {
    const result = { notes: [] as string[] };
    recordCaseFailure(result, { name: 'Error', message: 'RPC timeout' });
    recordCaseFailure(result, { name: 'Error', message: 'RPC timeout' });
    recordCaseFailure(result, {
      name: 'TypeError',
      message: '/temp/CODEX_HOME/auth.json private-auth',
    });
    recordCaseFailure(result, {
      name: '/temp/private-auth',
      message: 'private-model-output',
    });
    recordCaseFailure(result, 'private-stderr');
    expect(result.notes).toEqual([
      'RPC timeout',
      'unclassified error (TypeError)',
      'unclassified error (Error)',
    ]);
  });

  it.each(['RPC error -32600', 'RPC error 0', 'RPC error 999999'])(
    'records a bounded RPC error code as-is: %s',
    (message) => {
      const result = { notes: [] as string[] };
      recordCaseFailure(result, new Error(message));
      expect(result.notes).toEqual([message]);
    },
  );

  it.each([
    'RPC error -32600 secret text',
    'RPC error 1234567',
    'RPC error -1234567',
    'RPC error +32600',
    'RPC error -32600\n',
    'private-server-message',
  ])('withholds unlisted RPC and server text: %s', (message) => {
    const result = { notes: [] as string[] };
    recordCaseFailure(result, new Error(message));
    expect(result.notes).toEqual(['unclassified error (Error)']);
  });

  it('does not report normal teardown as a case failure', async () => {
    const child = fakeChild();
    const result = {
      id: 'normal-stop',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
      notes: [] as string[],
    };
    const rpc = new RpcChild(child, result);
    rpc.stopSync();
    child.emit('close', 0);
    await rpc.stop();
    expect(result.notes).toEqual([]);
  });

  it('enforces one cap across children, failed sends and compaction, with no reset', async () => {
    const budget = new TurnBudget();
    const result = {
      id: 'cap',
      status: 'not run',
      turns: 0,
      events: [],
      approvals: [],
    };
    const firstChild = fakeChild();
    const secondChild = fakeChild();
    const first = new RpcChild(firstChild, result);
    const second = new RpcChild(secondChild, result);
    let frames = 0;
    for (const child of [firstChild, secondChild])
      child.stdin.on('data', (chunk: Buffer) => {
        frames += 1;
        const request: { id: number } = JSON.parse(chunk.toString());
        child.stdout.write(
          JSON.stringify({
            id: request.id,
            error: { code: -1, message: 'fake failure' },
          }) + '\n',
        );
      });
    for (let index = 0; index < TURN_CAP; index += 1) {
      await expect(
        (index % 2 ? first : second).request(
          index === 2 ? 'thread/compact/start' : 'turn/start',
          {},
          budget,
        ),
      ).rejects.toThrow('RPC error');
    }
    await expect(first.request('turn/start', {}, budget)).rejects.toThrow(
      'not run: cap',
    );
    await expect(
      second.request('thread/compact/start', {}, budget),
    ).rejects.toThrow('not run: cap');
    expect(frames).toBe(8);
    expect(budget.consumed).toBe(8);
    expect(result.status).toBe('not run: cap');
    firstChild.emit('close', 0);
    secondChild.emit('close', 0);
    await first.stop();
    await second.stop();
  });

  it('rejects model invocations without the global budget', async () => {
    const child = fakeChild();
    const rpc = new RpcChild(child, {
      id: 'missing-budget',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
    });
    await expect(rpc.request('turn/start', {})).rejects.toThrow('not run: cap');
    child.emit('close', 0);
    await rpc.stop();
  });

  it.each([false, true])(
    'copies only auth and always deletes it (keep=%s)',
    (keep) => {
      const io = fakeDisk();
      const experiment = createExperiment(join('real-home', 'auth.json'), io);
      expect(io.copyFileSync.mock.calls).toEqual([
        [join('real-home', 'auth.json'), join(experiment.home, 'auth.json')],
      ]);
      expect(io.chmodSync).toHaveBeenCalledWith(
        join(experiment.home, 'auth.json'),
        0o600,
      );
      expect(JSON.stringify(io.copyFileSync.mock.calls)).not.toContain(
        'config.toml',
      );
      expect(io.writeFileSync).not.toHaveBeenCalled();
      cleanupExperiment(experiment, keep, io);
      expect(io.rmSync).toHaveBeenCalledWith(
        join(experiment.home, 'auth.json'),
        { force: true },
      );
      expect(io.rmSync).toHaveBeenCalledWith(experiment.home, {
        recursive: true,
        force: true,
      });
      expect(
        io.rmSync.mock.calls.some(([path]) => path === experiment.root),
      ).toBe(!keep);
    },
  );

  it('removes partial auth setup after a copy failure', () => {
    const io = fakeDisk();
    io.copyFileSync.mockImplementation(() => {
      throw new Error('secret failure');
    });
    expect(() => createExperiment('auth.json', io)).toThrow('details withheld');
    expect(io.rmSync).toHaveBeenCalledWith(
      resolve('fake', 'experiment', 'home', 'auth.json'),
      { force: true },
    );
    expect(io.rmSync).toHaveBeenCalledWith(resolve('fake', 'experiment'), {
      recursive: true,
      force: true,
    });
  });

  it('attempts whole-home/root removal even when individual auth deletion fails', () => {
    const io = fakeDisk();
    const experiment = createExperiment('auth.json', io);
    io.rmSync.mockImplementationOnce(() => {
      throw new Error('denied');
    });
    expect(() => cleanupExperiment(experiment, false, io)).toThrow('denied');
    expect(io.rmSync).toHaveBeenCalledWith(experiment.home, {
      recursive: true,
      force: true,
    });
    expect(io.rmSync).toHaveBeenCalledWith(experiment.root, {
      recursive: true,
      force: true,
    });
  });

  it('overrides only child env, strips inherited credentials, and leaves process.env unchanged', () => {
    const before = { ...process.env };
    const source = Object.freeze({
      PATH: 'path',
      CODEX_HOME: 'real-home',
      OPENAI_API_KEY: 'secret',
      HTTPS_PROXY: 'secret-proxy',
    });
    const experiment: Experiment = {
      root: 'root',
      workspace: 'workspace',
      home: 'isolated-home',
      scratch: 'scratch',
    };
    expect(childEnvironment(experiment, source)).toEqual({
      PATH: 'path',
      CODEX_HOME: 'isolated-home',
      HOME: 'isolated-home',
      USERPROFILE: 'isolated-home',
      TMP: 'scratch',
      TEMP: 'scratch',
      TMPDIR: 'scratch',
    });
    expect(source.CODEX_HOME).toBe('real-home');
    expect(process.env).toEqual(before);
  });

  it.each([
    { args: [] },
    { args: ['--dry-run'] },
    { args: ['--run', '--dry-run'] },
  ])('dry-run $args performs no disk operation', async ({ args }) => {
    const io = fakeDisk();
    const print = jest.fn();
    await runHarness(
      parseOptions(args),
      [
        {
          id: 'fake-case',
          kind: 'command',
          turnCost: 1,
          observations: [2],
          purpose: 'fake',
        },
      ],
      print,
      io,
    );
    expect(print).toHaveBeenCalledWith(expect.stringContaining('dry-run'));
    for (const operation of Object.values(io))
      expect(operation).not.toHaveBeenCalled();
  });

  it('requires all explicit real-run arguments before creating an experiment', async () => {
    const io = fakeDisk();
    await expect(
      runHarness(parseOptions(['--run']), [], jest.fn(), io),
    ).rejects.toThrow('Required:');
    expect(io.mkdtempSync).not.toHaveBeenCalled();
  });

  it('bounds newline-terminated and unterminated frames across chunks', () => {
    expect(() =>
      new FrameDecoder().push(Buffer.alloc(MAX_FRAME_BYTES + 1, 97)),
    ).toThrow('frame too large');
    expect(() =>
      new FrameDecoder().push(
        Buffer.from('a'.repeat(MAX_FRAME_BYTES + 1) + '\n'),
      ),
    ).toThrow('frame too large');
    const split = new FrameDecoder();
    split.push(Buffer.alloc(MAX_FRAME_BYTES, 97));
    expect(() => split.push(Buffer.from('a\n'))).toThrow('frame too large');
  });

  it('validates envelopes and preserves UTF-8 split across chunks', () => {
    const decoder = new FrameDecoder();
    const bytes = Buffer.from(
      JSON.stringify({ method: 'notice', params: 'é' }) + '\n',
    );
    const split = bytes.indexOf(0xc3) + 1;
    expect(decoder.push(bytes.subarray(0, split))).toEqual([]);
    expect(decoder.push(bytes.subarray(split))).toEqual([
      { method: 'notice', params: 'é' },
    ]);
    expect(() => decoder.push(Buffer.from('{"id":1,"method":42}\n'))).toThrow();
    expect(() =>
      new FrameDecoder().push(
        Buffer.from('{"id":1,"result":{},"error":{"code":1,"message":"x"}}\n'),
      ),
    ).toThrow();
  });

  it('strips auth fields, bearer/JWT/API token strings and explicit opaque secrets', () => {
    const value = sanitize(
      {
        authorization: 'secret',
        nested: { refresh_token: 'refresh', prompt: 'private prompt' },
        output:
          'Bearer abc.def sk-123456789abc eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature access_token=opaque opaque-secret',
        usage: { inputTokens: 12 },
      },
      ['opaque-secret'],
    );
    const serialized = JSON.stringify(value);
    for (const secret of [
      'private prompt',
      'abc.def',
      'sk-123456789abc',
      'eyJhbGci',
      'opaque-secret',
      '=opaque',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(value).toMatchObject({ usage: { inputTokens: 12 } });
  });
});

describe('review regression guards using real functions and isolated disk', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(
      mkdtempSync(join(tmpdir(), 'ptah-evidence-safety-test-')),
    );
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects full access recursively and retains approval requests for every level', () => {
    expect(() =>
      assertSafeSandbox({ sandboxPolicy: { type: 'danger-full-access' } }),
    ).toThrow('Unsafe sandbox');
    expect(() => assertSafeSandbox('external-sandbox')).toThrow(
      'Unsafe sandbox',
    );
    for (const level of ['ask', 'plan', 'auto-edit', 'yolo'] as const) {
      if (level !== 'ask')
        expect(policy(level).approvalPolicy).toBe('on-request');
      expect(policy(level).sandbox).toBe(
        level === 'auto-edit' || level === 'yolo'
          ? 'workspace-write'
          : 'read-only',
      );
    }
  });

  it('rejects unsafe sandbox on the actual request path without writing a frame', async () => {
    const child = fakeChild();
    const result = {
      id: 'sandbox',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
    };
    const rpc = new RpcChild(child, result);
    const write = jest.spyOn(child.stdin, 'write');
    await expect(
      rpc.request('thread/start', { sandbox: 'danger-full-access' }),
    ).rejects.toThrow('Unsafe sandbox');
    expect(write).not.toHaveBeenCalled();
    child.emit('close', 0);
    await rpc.stop();
  });

  it.each(['ask', 'plan', 'auto-edit', 'yolo'] as const)(
    'declines unless the single fixed command matches (%s)',
    (level) => {
      const target = join(root, 'expected.marker');
      const context: MarkerApproval = {
        root,
        workspace: root,
        target,
        kind: 'boundary',
        level,
        decision: 'accept',
        threadId: 'thread',
        expectedCommand: 'fixed command',
        approvals: 0,
        validatedFileItems: new Set(),
      };
      const frame = {
        id: 1,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'thread', command: 'fixed command' },
      };
      expect(markerApprovalDecision(frame, context)).toBe(
        level === 'plan' ? 'decline' : 'accept',
      );
      expect(
        markerApprovalDecision(
          {
            ...frame,
            params: { threadId: 'thread', command: 'write somewhere else' },
          },
          context,
        ),
      ).toBe('decline');
      expect(
        markerApprovalDecision(
          { ...frame, method: 'unknown/approval' },
          context,
        ),
      ).toBe('decline');
      expect(markerApprovalDecision(frame, { ...context, approvals: 1 })).toBe(
        'decline',
      );
      expect(
        markerApprovalDecision(frame, { ...context, decision: 'deny' }),
      ).toBe('decline');
    },
  );

  it('requires an identified file item and exact MCP arguments', () => {
    const context: MarkerApproval = {
      root,
      workspace: root,
      target: join(root, 'marker'),
      kind: 'file',
      level: 'ask',
      decision: 'accept',
      threadId: 'thread',
      expectedCommand: 'fixed',
      approvals: 0,
      validatedFileItems: new Set(['expected']),
    };
    expect(
      markerApprovalDecision(
        {
          id: 1,
          method: 'item/fileChange/requestApproval',
          params: { threadId: 'thread', itemId: 'other' },
        },
        context,
      ),
    ).toBe('decline');
    const frame = {
      id: 2,
      method: 'item/mcpToolCall/requestApproval',
      params: {
        threadId: 'thread',
        server: 'marker',
        toolName: 'write_marker',
        arguments: { slot: 'original' },
      },
    };
    expect(markerApprovalDecision(frame, { ...context, kind: 'mcp' })).toBe(
      'accept',
    );
    expect(
      markerApprovalDecision(
        {
          ...frame,
          params: { ...frame.params, arguments: { slot: 'replacement' } },
        },
        { ...context, kind: 'mcp' },
      ),
    ).toBe('decline');
  });

  it('rejects real home equality and nesting in either direction, including a missing child', () => {
    const home = join(root, 'home');
    const protectedHome = join(root, 'real-codex');
    mkdirSync(home);
    mkdirSync(protectedHome);
    expect(() => assertDisjointHomes(root, home, [root])).toThrow('overlaps');
    expect(() => assertDisjointHomes(root, home, [protectedHome])).toThrow(
      'overlaps',
    );
    expect(() => assertDisjointHomes(home, home, [root])).toThrow('overlaps');
    expect(() =>
      assertDisjointHomes(root, home, [join(home, 'missing', '.codex')]),
    ).toThrow('overlaps');
    expect(() =>
      assertDisjointHomes(home, home, [protectedHome]),
    ).not.toThrow();
  });

  it.each(['file', 'parent'] as const)(
    'rejects real %s symlinks including dangling markers',
    (kind) => {
      const directory = join(root, 'directory');
      const link = join(root, 'link');
      mkdirSync(directory);
      try {
        symlinkSync(
          kind === 'file' ? join(directory, 'absent') : directory,
          link,
          kind === 'file'
            ? 'file'
            : process.platform === 'win32'
              ? 'junction'
              : 'dir',
        );
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(errorCode(error) ?? '')) {
          process.stdout.write(
            `SKIP symlink ${kind}: OS forbids symlink creation.\n`,
          );
          return;
        }
        throw error;
      }
      const marker = kind === 'file' ? link : join(link, 'marker');
      expect(() => markerExists(root, marker)).toThrow();
      expect(() =>
        markerApprovalDecision(
          {
            id: 1,
            method: 'item/commandExecution/requestApproval',
            params: { threadId: 'thread', command: 'fixed' },
          },
          {
            root,
            workspace: root,
            target: marker,
            kind: 'command',
            level: 'yolo',
            decision: 'accept',
            threadId: 'thread',
            expectedCommand: 'fixed',
            approvals: 0,
            validatedFileItems: new Set(),
          },
        ),
      ).toThrow();
    },
  );

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
    const rpc = new RpcChild(child, {
      id: 'signal',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
    });
    const exits: number[] = [];
    let kills = 0;
    jest.spyOn(rpc, 'stopSync').mockImplementation(() => {
      if (kills++ === 0)
        expect(readFileSync(join(experiment.home, 'auth.json'), 'utf8')).toBe(
          'fake-auth',
        );
    });
    const handler = createFatalCleanup(
      () => cleanupExperiment(experiment, true),
      new Set([rpc]),
      (code) => {
        exits.push(code);
      },
    );
    try {
      expect(registered).toBe(true);
      expect(() => lstatSync(join(experiment.home, 'config.toml'))).toThrow();
      handler();
      expect(() => lstatSync(join(experiment.home, 'auth.json'))).toThrow();
      handler();
      expect(kills).toBe(2);
      expect(exits).toEqual([1, 1]);
      expect(readFileSync(source, 'utf8')).toBe('fake-auth');
    } finally {
      cleanupExperiment(experiment, false);
    }
  });

  it('answers unknown server requests with an explicit decline frame', async () => {
    const child = fakeChild();
    const rpc = new RpcChild(child, {
      id: 'unknown',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
    });
    const frames: string[] = [];
    child.stdin.on('data', (chunk: Buffer) => frames.push(chunk.toString()));
    child.stdout.write(
      JSON.stringify({
        id: 'unknown',
        method: 'unknown/approval',
        params: {},
      }) + '\n',
    );
    await new Promise<void>((done) => setImmediate(done));
    expect(frames.map((frame) => JSON.parse(frame))).toEqual([
      { id: 'unknown', result: { decision: 'decline' } },
    ]);
    expect(() => rpc.assertHealthy()).toThrow();
    child.emit('close', 0);
    await rpc.stop();
  });

  it('counts cumulative usage monotonically across children and rejects the ceiling', () => {
    const budget = new UsageBudget();
    budget.observe('one', 1000);
    budget.observe('one', 800);
    budget.observe('two', 500);
    expect(budget.consumed).toBe(1500);
    expect(() => budget.observe('two', USAGE_CEILING - 1000)).toThrow(
      'ceiling',
    );
  });

  it('redacts account/email/cookie/session/token keys and markdown text', () => {
    const text =
      'person@example.com acct_12345 session=short cookie=value token=abc refresh=xyz';
    const sanitized = JSON.stringify(
      sanitize({
        text,
        email: 'private',
        accountId: 'private',
        cookie: 'private',
        session: 'private',
        token: 'private',
        refresh: 'private',
      }),
    );
    for (const secret of [
      'person@example.com',
      'acct_12345',
      '=short',
      '=value',
      '=abc',
      '=xyz',
      'private',
    ])
      expect(sanitized).not.toContain(secret);
    expect(sanitize(`| ${text} |`)).not.toContain('person@example.com');
  });
});

describe('granular ask approval policy', () => {
  it('enables experimentalApi only for granular initialize params', () => {
    for (const level of ['ask', undefined] as const) {
      expect(initializeParams(policy(level).approvalPolicy)).toEqual({
        clientInfo: { name: 'ptah_evidence', version: '0.0.1' },
        capabilities: { experimentalApi: true },
      });
    }
    for (const level of ['plan', 'auto-edit', 'yolo'] as const) {
      expect(initializeParams(policy(level).approvalPolicy)).toEqual({
        clientInfo: { name: 'ptah_evidence', version: '0.0.1' },
        capabilities: { experimentalApi: false },
      });
    }
  });

  it('confirms an echoed granular policy and user reviewer structurally', () => {
    expect(() =>
      assertThreadApprovalPolicy(
        {
          approvalPolicy: {
            granular: Object.fromEntries(Object.entries(granular).reverse()),
          },
          approvalsReviewer: 'user',
        },
        policy('ask').approvalPolicy,
      ),
    ).not.toThrow();
  });

  it('rejects missing or different thread approval policy and reviewer', () => {
    const expected = policy('ask').approvalPolicy;
    const message = 'Effective approval policy differs from bounded profile';
    for (const response of [
      { approvalsReviewer: 'user' },
      { approvalPolicy: 'on-request', approvalsReviewer: 'user' },
      {
        approvalPolicy: { granular: { ...granular, rules: false } },
        approvalsReviewer: 'user',
      },
      { approvalPolicy: expected },
      { approvalPolicy: expected, approvalsReviewer: 'guardian_subagent' },
      null,
    ]) {
      expect(() => assertThreadApprovalPolicy(response, expected)).toThrow(
        message,
      );
      const result = { notes: [] as string[] };
      try {
        assertThreadApprovalPolicy(response, expected);
      } catch (error) {
        recordCaseFailure(result, error);
      }
      expect(result.notes).toEqual([message]);
    }
  });

  it('notes missing approval only after an ask turn starts without a request', () => {
    expect(shouldNoteMissingApproval('turn', 'ask', false)).toBe(true);
    expect(shouldNoteMissingApproval('', 'ask', false)).toBe(false);
    expect(shouldNoteMissingApproval('turn', 'ask', true)).toBe(false);
    for (const level of [undefined, 'plan', 'auto-edit', 'yolo'] as const) {
      expect(shouldNoteMissingApproval('turn', level, false)).toBe(false);
      expect(shouldNoteMissingApproval('', level, false)).toBe(false);
    }
  });

  it('does not note missing approval after a harness gate failure', () => {
    expect(shouldNoteMissingApproval('turn', 'ask', false, true)).toBe(false);
    expect(shouldNoteMissingApproval('turn', 'ask', false, false)).toBe(true);
  });

  it('reports an allowlisted approval-policy mismatch', () => {
    const expected = policy('ask').approvalPolicy;
    const message = 'Effective approval policy differs from bounded profile';
    expect(() => assertEffectiveApprovalPolicy('on-request', expected)).toThrow(
      message,
    );
    expect(() =>
      assertEffectiveApprovalPolicy(expected, expected),
    ).not.toThrow();
    const result = { notes: [] as string[] };
    try {
      assertEffectiveApprovalPolicy('on-request', expected);
    } catch (error) {
      recordCaseFailure(result, error);
    }
    expect(result.notes).toEqual([message]);
  });

  const granular = {
    sandbox_approval: true,
    rules: true,
    mcp_elicitations: true,
    request_permissions: true,
    skill_approval: true,
  };
  it('uses granular approvals for ask and the default read-only profile', () => {
    for (const level of ['ask', undefined] as const)
      expect(policy(level)).toEqual({
        sandbox: 'read-only',
        approvalPolicy: { granular },
        approvalsReviewer: 'user',
      });
  });
  it('serializes the config override as TOML, retaining on-request for other levels', () => {
    expect(approvalPolicyOverride(policy('ask').approvalPolicy)).toBe(
      'approval_policy={granular={sandbox_approval=true,rules=true,mcp_elicitations=true,request_permissions=true,skill_approval=true}}',
    );
    for (const level of ['plan', 'auto-edit', 'yolo'] as const) {
      expect(approvalPolicyOverride(policy(level).approvalPolicy)).toBe(
        'approval_policy="on-request"',
      );
      expect(policy(level)).not.toHaveProperty('approvalsReviewer');
    }
  });
  it('compares the config structurally, rejecting changed, missing and extra values', () => {
    const expected = policy('ask').approvalPolicy;
    expect(
      approvalPoliciesEqual(
        { granular: Object.fromEntries(Object.entries(granular).reverse()) },
        expected,
      ),
    ).toBe(true);
    expect(
      approvalPoliciesEqual(
        { granular: { ...granular, rules: false } },
        expected,
      ),
    ).toBe(false);
    expect(approvalPoliciesEqual({ granular: { rules: true } }, expected)).toBe(
      false,
    );
    expect(approvalPoliciesEqual({ granular, extra: true }, expected)).toBe(
      false,
    );
    expect(approvalPoliciesEqual('on-request', expected)).toBe(false);
  });
});
