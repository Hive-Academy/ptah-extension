import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { join, resolve } from 'node:path';
import {
  existsSync,
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
  caseDeadlineMs,
  shouldStopAfterCase,
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
  isToleratedMarkerRead,
  markerCommand,
  markerApprovalDecision,
  markerExists,
  assertDisjointHomes,
  createFatalCleanup,
  UsageBudget,
  USAGE_TURN_LIMIT,
  USAGE_CUMULATIVE_LIMIT,
  OUTPUT_BOUNDS,
  runCase,
  type MarkerApproval,
  errorCode,
} from './evidence-harness';
import { FrameDecoder, MAX_FRAME_BYTES } from './evidence-frames';
import {
  createPathRedactor,
  recordCaseFailure,
  recordCommandShape,
} from './evidence-failure-notes';

describe('tolerated marker read identity', () => {
  const marker = 'C:\\work\\ask-command-edit.marker';
  it.each(['powershell', 'pwsh'])(
    'accepts the run 6f %s wrapper and slash variants',
    (shell) => {
      for (const path of [marker, marker.replace(/\\/g, '/')]) {
        for (const verb of ['Get-Content', 'Test-Path', 'Get-Item']) {
          for (const flag of ['-LiteralPath', '-Path']) {
            const inner = `${verb} ${flag} '${path}'`;
            expect(isToleratedMarkerRead(inner, marker, 'win32')).toBe(true);
            expect(
              isToleratedMarkerRead(
                `"C:\\Windows\\${shell}.exe" -Command "${inner}"`,
                marker,
                'win32',
              ),
            ).toBe(true);
          }
        }
      }
    },
  );
  it.each([
    "Get-Content -LiteralPath 'C:/work/other.marker'",
    "Get-Content -LiteralPath 'C:/work/ask-command-edit.marker' 'other'",
    "Get-Content -LiteralPath 'C:/work/ask-command-edit.marker'; Get-Item 'other'",
    "Get-Content -LiteralPath 'C:/work/ask-command-edit.marker' | Out-Null",
    "Set-Content -LiteralPath 'C:/work/ask-command-edit.marker'",
    "Get-Content -LiteralPath 'C:/work/ask-command-edit.marker' -Raw",
    "Get-Content -LiteralPath 'C:/WORK/ask-command-edit.marker'",
    "Get-Content -LiteralPath 'C:/work/ask-command-edit.marker' > 'other'",
    "Get-Content -LiteralPath 'C:/work/ask-command-edit.marker' & whoami",
    "Get-Content -LiteralPath 'C:/work/ask-command-edit.marker'`",
    "Get-Content -LiteralPath '$(whoami)'",
  ])('rejects %s', (command) => {
    expect(isToleratedMarkerRead(command, marker, 'win32')).toBe(false);
  });
  it('accepts only fixed POSIX reads on non-Windows platforms', () => {
    const path = '/work/ask-command-edit.marker';
    for (const verb of ['cat', 'test -e'])
      expect(isToleratedMarkerRead(`${verb} '${path}'`, path, 'linux')).toBe(
        true,
      );
    expect(isToleratedMarkerRead(`cat '${path}' | cat`, path, 'linux')).toBe(
      false,
    );
    expect(isToleratedMarkerRead(`cat '${path}' 'other'`, path, 'linux')).toBe(
      false,
    );
    expect(
      isToleratedMarkerRead(`Get-Content -Path '${path}'`, path, 'linux'),
    ).toBe(false);
  });
});

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
    expect(source).toMatch(
      /const expectedCommand = readRule\s*\?[^;]+:\s*markerCommand\(\[\s*process\.execPath,\s*markerScript,\s*experiment\.root,\s*target,?\s*\]\)/,
    );
    expect(source).not.toContain("[process.execPath, '-e'");
    expect(source).toContain("if (command.includes('\"'))");
    expect(source).toContain('writeMarker(process.argv[2],process.argv[3]);');
    expect(expected).not.toContain('"');
    expect(expected).not.toContain("'-e'");
  });

  it('builds Windows command paths with forward slashes and no double quotes', () => {
    const paths = [
      'C:\\Program Files\\node.exe',
      'C:\\evidence\\marker.cjs',
      'C:\\evidence',
      'C:\\evidence\\workspace\\case.marker',
    ];
    const command = markerCommand(paths, 'win32');
    expect(command).toBe(
      "& 'C:/Program Files/node.exe' 'C:/evidence/marker.cjs' 'C:/evidence' 'C:/evidence/workspace/case.marker'",
    );
    expect(command).not.toContain('\\');
    expect(command).not.toContain('"');
    expect(() => markerCommand(['C:\\bad"path'], 'win32')).toThrow(
      'Command path contains a double quote',
    );
  });

  it('rejects doubled backslashes and slash variants at the identity gate', () => {
    for (const command of [
      expected.replace(/\\/g, '\\\\'),
      expected.replace(/\\/g, '/'),
    ]) {
      expect(commandMatches(command, expected, 'win32')).toBe(false);
      expect(
        commandMatches(
          `"C:\\pwsh.exe" -Command "${command}"`,
          expected,
          'win32',
        ),
      ).toBe(false);
    }
  });

  it('writes a confined marker with forward-slash root and target paths', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'marker-slashes-')));
    const target = join(root, 'workspace', 'case.marker');
    try {
      mkdirSync(join(root, 'workspace'));
      const source = readFileSync(
        join(__dirname, 'evidence-harness.ts'),
        'utf8',
      );
      const writer = /const MARKER_WRITER = String.raw`([\s\S]*?)`;/.exec(
        source,
      )?.[1];
      expect(writer).toBeDefined();
      runInNewContext(writer + ';writeMarker(root, target);', {
        require,
        root: root.replace(/\\/g, '/'),
        target: target.replace(/\\/g, '/'),
      });
      expect(readFileSync(target, 'utf8')).toBe('marker');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it.each([
    [
      'doubled backslashes',
      "& 'C:\\\\private\\\\marker'",
      "& 'C:\\private\\marker'",
    ],
    ['slash direction', "& 'C:/private/marker'", "& 'C:\\private\\marker'"],
    ['case only', "& 'C:/PRIVATE/marker'", "& 'C:/private/marker'"],
    ['whitespace', "&  'C:/private/marker'", "& 'C:/private/marker'"],
    ['quoting', '& "C:/private/marker"', "& 'C:/private/marker'"],
    ['wrapper', 'cmd /c "& \'C:/private/marker\'"', "& 'C:/private/marker'"],
    ['other', "& 'C:/private/changed'", "& 'C:/private/marker'"],
    [
      'doubled backslashes',
      '"C:\\Windows\\powershell.exe" -Command "& \'C:\\\\private\\\\marker\'"',
      "& 'C:\\private\\marker'",
    ],
  ])(
    'classifies %s from original command text without leaking paths',
    (label, observed, expected) => {
      const result = { notes: [] as string[] };
      recordCommandShape(
        result,
        {},
        { command: observed },
        { ...context, expectedCommand: expected },
      );
      expect(result.notes[2]).toBe(`Command differs by: ${label}`);
      expect(result.notes.join(' ')).not.toContain('private');
    },
  );

  it('redacts every forward-slash command path to its specific placeholder', () => {
    const result = { notes: [] as string[] };
    const command = markerCommand(
      [process.execPath, markerScript, experiment.root, experiment.workspace],
      'win32',
    );
    recordCommandShape(result, {}, { command }, context);
    expect(result.notes[0]).toBe(
      "Unexpected command shape: & '<NODE>' '<MARKER_SCRIPT>' '<ROOT>' '<WORKSPACE>'",
    );
  });

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
      expect(result.notes).toContain('Command differs by: wrapper');
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

  it('preserves the PowerShell basename and strips the accepted wrapper for classification', () => {
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
    expect(result.notes).toContain('Command differs by: other');
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
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'thread',
        server: 'marker',
        toolName: 'write_marker',
        arguments: { slot: 'original' },
      },
    };
    expect(markerApprovalDecision(frame, { ...context, kind: 'mcp' })).toBe(
      'decline',
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

  it('30,000-token per-turn bound stops subsequent observations with a distinct message', () => {
    const budget = new UsageBudget();
    budget.observe('one', USAGE_TURN_LIMIT);
    expect(() => budget.observe('one', USAGE_TURN_LIMIT + 1)).toThrow(
      'Per-turn usage bound reached',
    );
    expect(budget.exceeded).toBe(true);
    expect(() => budget.observe('later', 1)).toThrow(
      'Per-turn usage bound reached',
    );
  });

  it('cumulative bound stops subsequent observations with a distinct message', () => {
    const budget = new UsageBudget();
    for (let i = 0; i < 10; i++) budget.observe(String(i), 10_000);
    expect(budget.consumed).toBe(USAGE_CUMULATIVE_LIMIT);
    expect(budget.exceeded).toBe(false);
    expect(() => budget.observe('eleven', 1)).toThrow(
      'Cumulative usage bound reached',
    );
    expect(budget.exceeded).toBe(true);
    expect(() => budget.observe('later', 1)).toThrow(
      'Cumulative usage bound reached',
    );
  });

  it('attributes thread cumulative increments to separate turns without double counting', () => {
    const budget = new UsageBudget();
    expect(budget.observe('thread', 10_000, 'first')).toBe(10_000);
    expect(budget.observe('thread', 9_000, 'first')).toBe(10_000);
    expect(budget.observe('thread', 20_000, 'second')).toBe(10_000);
    expect(budget.consumed).toBe(20_000);
    expect(budget.exceeded).toBe(false);
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

describe('ask-command-edit evidence flow', () => {
  const protocolDirectory = join(__dirname, '../src/lib/protocol');
  const schemaText = readFileSync(
    join(protocolDirectory, 'codex-app-server-protocol.schema.json'),
    'utf8',
  );
  const approvalMethod = 'item/commandExecution/requestApproval';

  async function exercise(
    mode:
      | 'happy'
      | 'repeat'
      | 'refused'
      | 'original'
      | 'new-turn'
      | 'per-turn'
      | 'cumulative'
      | 'trailing-usage'
      | 'terminal-usage'
      | 'marker-read'
      | 'second-read'
      | 'late-read'
      | 'read-approval'
      | 'rule-approval'
      | 'rule-no-approval'
      | 'messages-only'
      | 'empty-turn'
      | 'steer-messages-only'
      | 'interrupted-empty'
      | 'accept-empty',
    cap = TURN_CAP,
  ) {
    const root = mkdtempSync(join(tmpdir(), 'ptah-edit-spec-'));
    const experiment: Experiment = {
      root,
      workspace: join(root, 'workspace'),
      home: join(root, 'home'),
      scratch: join(root, 'scratch'),
    };
    for (const directory of [
      experiment.workspace,
      experiment.home,
      experiment.scratch,
    ])
      mkdirSync(directory);
    const child = Object.assign(new childProcess.ChildProcess(), fakeChild());
    const processChild = child;
    const spawnModule =
      jest.requireActual<typeof import('node:child_process')>(
        'node:child_process',
      );
    const readRule = mode === 'rule-approval' || mode === 'rule-no-approval';
    let rulesAtSpawn: string | undefined;
    const spy = jest
      .spyOn(spawnModule, 'spawn')
      .mockImplementation((_binary, _args, options) => {
        if (readRule) {
          expect(options?.env?.['CODEX_HOME']).toBe(experiment.home);
          rulesAtSpawn = readFileSync(
            join(experiment.home, 'rules/default.rules'),
            'utf8',
          );
          expect(
            readFileSync(
              join(experiment.workspace, 'ask-read-rule.fixture.txt'),
              'utf8',
            ),
          ).toBe('fixture');
        }
        return processChild;
      });
    processChild.stdin.on('finish', () => processChild.emit('close', 0));
    const result: Parameters<typeof runCase>[1] = {
      id: readRule ? 'ask-read-rule' : 'ask-command-edit',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
      notes: [],
    };
    const budget = new TurnBudget(cap);
    const usage = new UsageBudget();
    if (mode === 'cumulative')
      for (let i = 0; i < 10; i++) usage.observe(`prior-${i}`, 10_000);
    const original = join(experiment.workspace, 'ask-command-edit.marker');
    const replacement = join(
      experiment.workspace,
      'ask-command-edit.replacement.marker',
    );
    const command = (target: string) =>
      markerCommand([
        process.execPath,
        join(root, 'ask-command-edit-marker.cjs'),
        root,
        target,
      ]);
    const sent: Record<string, unknown>[] = [];
    const send = (frame: object) =>
      child.stdout.write(JSON.stringify(frame) + '\n');
    const notify = (method: string, params: object) => send({ method, params });
    const readCommand = (path: string) =>
      process.platform === 'win32'
        ? `Get-Content -LiteralPath '${path.replace(/\\/g, '/')}'`
        : `cat '${path}'`;
    const notifyRead = (id: string, command: string, completed = false) =>
      notify(completed ? 'item/completed' : 'item/started', {
        threadId: 'thread',
        item: {
          id,
          type: 'commandExecution',
          command,
          ...(completed
            ? { status: 'completed', aggregatedOutput: 'fixture' }
            : {}),
        },
      });
    const requestRead = (id: string, command: string) =>
      send({
        id,
        method: approvalMethod,
        params: {
          threadId: 'thread',
          turnId: activeTurn,
          itemId: id,
          cwd: experiment.workspace,
          command,
          reason: `Contact person@example.com with Bearer secret-token ${'word '.repeat(120)}`,
          kind: 'command',
          proposedExecpolicyAmendment: ['private-amendment-content'],
        },
      });
    let activeTurn = 'turn-one';
    const requestApproval = (id: string, target: string) => {
      notify('item/started', {
        threadId: 'thread',
        item: { id, type: 'commandExecution', command: command(target) },
      });
      send({
        id,
        method: approvalMethod,
        params: {
          threadId: 'thread',
          turnId: activeTurn,
          itemId: id,
          cwd: experiment.workspace,
          command: command(target),
        },
      });
    };
    const selected = policy('ask');
    child.stdin.on('data', (bytes: Buffer) => {
      const frame: Record<string, unknown> = JSON.parse(bytes.toString());
      sent.push(frame);
      const reply = (value: object) => send({ id: frame['id'], result: value });
      switch (frame['method']) {
        case 'initialize':
          reply({ codexHome: experiment.home });
          break;
        case 'model/list':
          reply({ data: [{ id: 'test-model' }] });
          break;
        case 'config/read':
          reply({
            config: {
              ...OUTPUT_BOUNDS,
              sandbox_mode: selected.sandbox,
              approval_policy: selected.approvalPolicy,
              sandbox_workspace_write: { network_access: false },
            },
          });
          break;
        case 'thread/start':
          reply({ thread: { id: 'thread' }, ...selected });
          break;
        case 'turn/start':
          reply({ turn: { id: activeTurn } });
          setImmediate(() => {
            notify('turn/started', {
              threadId: 'thread',
              turn: { id: activeTurn },
            });
            notify('thread/tokenUsage/updated', {
              threadId: 'thread',
              turnId: activeTurn,
              tokenUsage: {
                total: {
                  totalTokens: mode === 'per-turn' ? USAGE_TURN_LIMIT + 1 : 100,
                },
              },
            });
            if (
              [
                'messages-only',
                'empty-turn',
                'interrupted-empty',
                'accept-empty',
              ].includes(mode)
            ) {
              if (mode === 'messages-only')
                notify('item/completed', {
                  item: {
                    type: 'agentMessage',
                    text: 'Unable to run the command.',
                  },
                });
              notify('turn/completed', {
                threadId: 'thread',
                turn: {
                  id: activeTurn,
                  status:
                    mode === 'interrupted-empty' ? 'interrupted' : 'completed',
                },
              });
              return;
            }
            if (readRule) {
              const command = readCommand(
                join(experiment.workspace, 'ask-read-rule.fixture.txt'),
              );
              notifyRead('rule', command);
              if (mode === 'rule-approval') requestRead('rule', command);
              else {
                notifyRead('rule', command, true);
                notify('turn/completed', {
                  threadId: 'thread',
                  turn: { id: activeTurn, status: 'completed' },
                });
              }
              return;
            }
            if (
              ['marker-read', 'second-read', 'read-approval'].includes(mode)
            ) {
              notifyRead('read', readCommand(original));
              if (mode === 'read-approval') {
                requestRead('read', readCommand(original));
                return;
              }
              notifyRead('read', readCommand(original), true);
              if (mode === 'second-read') {
                notifyRead('read-two', readCommand(original));
                return;
              }
            }
            requestApproval('first', original);
          });
          break;
        case 'turn/steer':
          if (mode === 'late-read') {
            reply({ turnId: activeTurn });
            setImmediate(() => notifyRead('late-read', readCommand(original)));
            break;
          }
          if (mode === 'refused') {
            send({
              id: frame['id'],
              error: { code: -32000, message: 'refused' },
            });
            break;
          }
          if (mode === 'new-turn') {
            activeTurn = 'turn-two';
            notify('turn/started', {
              threadId: 'thread',
              turn: { id: activeTurn },
            });
          }
          reply({ turnId: activeTurn });
          if (mode === 'steer-messages-only') {
            setImmediate(() => {
              notify('item/completed', {
                item: {
                  type: 'agentMessage',
                  text: 'Unable to run the new command.',
                },
              });
              notify('turn/completed', {
                threadId: 'thread',
                turn: { id: activeTurn, status: 'completed' },
              });
            });
            break;
          }
          setImmediate(() =>
            requestApproval(
              'second',
              mode === 'repeat' ? original : replacement,
            ),
          );
          break;
        case 'turn/interrupt':
          reply({});
          notify('turn/completed', {
            threadId: 'thread',
            turn: { id: activeTurn, status: 'interrupted' },
          });
          if (mode === 'trailing-usage')
            setTimeout(() => {
              notify('thread/tokenUsage/updated', {
                threadId: 'thread',
                turnId: activeTurn,
                tokenUsage: { total: { totalTokens: 300 } },
              });
            }, 30);
          break;
        default:
          if (frame['id'] === 'read') {
            expect(frame['result']).toEqual({ decision: 'decline' });
            setImmediate(() => {
              notifyRead('read', readCommand(original), true);
              requestApproval('first', original);
            });
          }
          if (frame['id'] === 'rule') {
            expect(frame['result']).toEqual({ decision: 'decline' });
            notify('item/completed', {
              threadId: 'thread',
              item: {
                id: 'rule',
                type: 'commandExecution',
                command: readCommand(
                  join(experiment.workspace, 'ask-read-rule.fixture.txt'),
                ),
                status: 'declined',
                aggregatedOutput: '',
              },
            });
          }
          if (
            frame['id'] === 'second' &&
            JSON.stringify(frame['result']).includes('accept')
          ) {
            setImmediate(() => {
              if (mode === 'terminal-usage') {
                notify('turn/completed', {
                  threadId: 'thread',
                  turn: { id: activeTurn, status: 'completed' },
                });
                setTimeout(
                  () =>
                    notify('thread/tokenUsage/updated', {
                      threadId: 'thread',
                      turnId: activeTurn,
                      tokenUsage: { total: { totalTokens: 300 } },
                    }),
                  30,
                );
                return;
              }
              writeFileSync(
                mode === 'original' ? original : replacement,
                'marker',
              );
              notify('thread/tokenUsage/updated', {
                threadId: 'thread',
                turnId: activeTurn,
                tokenUsage: { total: { totalTokens: 200 } },
              });
            });
          }
      }
    });
    let failure: unknown;
    try {
      await runCase(
        {
          id: result.id,
          turnCost: 1,
          observations: [1, 2],
          kind: readRule ? 'read-rule' : 'command',
          level: 'ask',
          decision: readRule
            ? 'deny'
            : mode === 'accept-empty'
              ? 'accept'
              : 'edit',
          purpose: 'test',
        },
        result,
        experiment,
        'unused',
        'test-model',
        budget,
        usage,
        {
          pinnedVersion: '0.155.1',
          binaryPath: 'unused',
          binarySha256: '',
          schemaSha256: '',
          platform: '',
          arch: '',
          methods: {
            requests: ['turn/steer'],
            serverRequests: [approvalMethod],
            clientNotifications: [],
            serverNotifications: [],
          },
        },
        schemaText,
        false,
        new Set(),
        root,
      );
    } catch (error) {
      failure = error;
    } finally {
      spy.mockRestore();
      cleanupExperiment(experiment, true);
      expect(() =>
        lstatSync(join(experiment.home, 'rules/default.rules')),
      ).toThrow();
      rmSync(root, { recursive: true, force: true });
    }
    return {
      result,
      sent,
      failure,
      budget,
      usage,
      rulesAtSpawn,
      readFixture: join(
        experiment.workspace,
        'ask-read-rule.fixture.txt',
      ).replace(/\\/g, '/'),
      expectedReadCommand: readCommand(
        join(experiment.workspace, 'ask-read-rule.fixture.txt'),
      ),
      editedCommand: command(replacement),
    };
  }

  it('declines, steers with schema params, accepts replacement and observes only its marker', async () => {
    const { result, sent, failure, editedCommand } = await exercise('happy');
    expect(failure).toBeUndefined();
    expect(result.status).toBe('observed');
    expect(result.approvals.map((entry) => entry.response)).toEqual([
      'decline',
      'accept',
    ]);
    expect(
      sent.find((frame) => frame['method'] === 'turn/steer'),
    ).toMatchObject({
      params: {
        threadId: 'thread',
        expectedTurnId: 'turn-one',
        input: [
          {
            type: 'text',
            text: expect.stringContaining(editedCommand),
            text_elements: [],
          },
        ],
      },
    });
    expect(sent.findIndex((frame) => frame['id'] === 'first')).toBeLessThan(
      sent.findIndex((frame) => frame['method'] === 'turn/steer'),
    );
    expect(result.markers).toEqual({
      original: false,
      replacement: true,
      outside: false,
    });
    expect(result.steer).toMatchObject({
      status: 'success',
      responseTurn: 'same',
      newTurnStarted: false,
      usageAfter: [{ turnId: 'turn-one', totalTokens: 200 }],
    });
    expect(result.notes).toContain('steer stayed in the same turn');
    expect(
      result.notes?.some((note) => note.includes('recorded agent messages:')),
    ).toBe(false);
    expect(
      sent.find((frame) => frame['method'] === 'thread/start'),
    ).toMatchObject({
      params: {
        developerInstructions:
          'Evidence experiment. Only the single requested marker may be touched. Do not inspect credentials, config, home, environment or network. No subagents. No retries. Stop after one tool action per user message; a later user message may request a different single marker.',
      },
    });
  });

  it.each([
    ['messages-only', 1, 0, 2],
    ['empty-turn', 0, 0, 2],
    ['steer-messages-only', 1, 1, 2],
    ['accept-empty', 0, 0, 1],
  ] as const)(
    'reports recorded message count for %s without approval',
    async (mode, count, approvals, expected) => {
      const { result, failure } = await exercise(mode);
      expect(failure).toBeUndefined();
      expect(result.status).toBe('unverified: required gate not observed');
      expect(result.approvals).toHaveLength(approvals);
      expect(result.notes).not.toContain(
        'granular ask: no approval request observed',
      );
      expect(
        result.notes?.filter((note) =>
          note.startsWith('Command turn completed with'),
        ),
      ).toHaveLength(1);
      expect(result.notes).toContain(
        `Command turn completed with ${approvals} of ${expected} expected approval requests; recorded agent messages: ${count}`,
      );
      expect(result.agentMessages ?? []).toHaveLength(count);
    },
  );

  it('does not add missing command approval notes for interrupted turns', async () => {
    const { result, failure } = await exercise('interrupted-empty');
    expect(failure).toBeUndefined();
    expect(result.terminal).toBe('interrupted');
    expect(
      result.notes?.some((note) => note.includes('expected approval requests')),
    ).toBe(false);
    expect(result.notes).not.toContain(
      'granular ask: no approval request observed',
    );
  });

  it.each(['marker-read', 'read-approval'] as const)(
    'continues the edit flow after %s',
    async (mode) => {
      const { result, failure, sent } = await exercise(mode);
      expect(failure).toBeUndefined();
      expect(result.status).toBe('observed');
      expect(result.notes).toContain('Tolerated marker read before command');
      expect(result.approvals.map((entry) => entry.response)).toEqual(
        mode === 'read-approval'
          ? ['decline', 'decline', 'accept']
          : ['decline', 'accept'],
      );
      if (mode === 'read-approval') {
        expect(result.notes).toContain('Tolerated read asked for approval');
        expect(
          sent.find((frame) => frame['id'] === 'read')?.['result'],
        ).toEqual({ decision: 'decline' });
      }
    },
  );

  it.each(['second-read', 'late-read'] as const)('rejects %s', async (mode) => {
    const { result, failure } = await exercise(mode);
    expect(failure).toBeDefined();
    expect(result.notes).toContain('Unexpected command');
  });

  it('observes rule approval before output, declines it, and records completion status', async () => {
    const { result, failure, rulesAtSpawn, readFixture } =
      await exercise('rule-approval');
    expect(failure).toBeUndefined();
    expect(result.status).toBe('observed');
    expect(result.approvals.map((entry) => entry.response)).toEqual([
      'decline',
    ]);
    expect(result.execPolicyRule).toEqual({
      path: 'rules/default.rules',
      content: rulesAtSpawn,
      completedStatus: 'declined',
    });
    const patterns =
      process.platform === 'win32'
        ? [
            ['Get-Content', '-LiteralPath', readFixture],
            ['Get-Content'],
            ['powershell.exe'],
          ]
        : [['cat', readFixture], ['cat']];
    expect(rulesAtSpawn).toBe(
      patterns
        .map(
          (pattern) =>
            `prefix_rule(pattern=${JSON.stringify(pattern)}, decision="prompt")\n`,
        )
        .join(''),
    );
    expect(result.notes).toContain('exec-policy rule location unverified');
  });

  it('keeps the decline and replacement plan out of the edit-case instructions', async () => {
    const { sent } = await exercise('happy');
    const start = sent.find((frame) => frame['method'] === 'thread/start');
    const instructions = String(
      (start?.['params'] as Record<string, unknown> | undefined)?.[
        'developerInstructions'
      ],
    );
    expect(instructions).toContain('Evidence experiment.');
    expect(instructions).not.toMatch(/replacement|declin|steer/i);
  });

  it('uses a neutral read-rule prompt without requesting approval', async () => {
    const { sent, expectedReadCommand } = await exercise('rule-approval');
    expect(
      sent.find((frame) => frame['method'] === 'turn/start'),
    ).toMatchObject({
      params: {
        input: [
          {
            type: 'text',
            text: `Run exactly this command once, without wrappers, changes or added punctuation. The command is the whole next line:\n${expectedReadCommand}\nNo other tools or retries.`,
          },
        ],
      },
    });
  });

  it.each(['rule-approval', 'read-approval'] as const)(
    'records sanitised approval evidence for %s without amendment content',
    async (mode) => {
      const { result, failure } = await exercise(mode);
      expect(failure).toBeUndefined();
      expect(result.approvals[0]).toMatchObject({
        paramKeys: [
          'command',
          'cwd',
          'itemId',
          'kind',
          'proposedExecpolicyAmendment',
          'reason',
          'threadId',
          'turnId',
        ],
        reason: String(
          sanitize(
            `Contact person@example.com with Bearer secret-token ${'word '.repeat(120)}`,
          ),
        ).slice(0, 400),
        kind: 'command',
        hasProposedExecpolicyAmendment: true,
        response: 'decline',
      });
      expect(result.approvals[0].reason).toHaveLength(400);
      expect(JSON.stringify(result.approvals)).not.toMatch(
        /person@example\.com|secret-token|private-amendment-content/,
      );
    },
  );

  it('records a read without approval as unverified, not a harness failure', async () => {
    const { result, failure } = await exercise('rule-no-approval');
    expect(failure).toBeUndefined();
    expect(result.status).toBe('unverified: rule did not prompt');
    expect(result.notes).toContain('unverified: rule did not prompt');
    expect(result.approvals).toEqual([]);
    expect(result.execPolicyRule?.completedStatus).toBe('completed');
  });

  it('rejects a second approval repeating the original command', async () => {
    const { result, failure } = await exercise('repeat');
    expect(failure).toBeDefined();
    expect(result.notes).toContain('Unexpected command');
    expect(result.approvals.map((entry) => entry.response)).toEqual([
      'decline',
      'decline',
    ]);
    expect(result.approvals[1].hasProposedExecpolicyAmendment).toBe(false);
  });

  it('fails cleanly with the RPC code when turn/steer is refused', async () => {
    const { result, failure, sent } = await exercise('refused');
    expect(failure).toBeDefined();
    expect(result.notes).toContain('turn/steer refused: RPC error -32000');
    expect(result.steer).toMatchObject({
      status: 'error',
      rpcErrorCode: -32000,
    });
    expect(
      sent.filter((frame) => frame['method'] === 'turn/start'),
    ).toHaveLength(1);
  });

  it('inspect rejects the original marker even after replacement approval', async () => {
    const { result, failure } = await exercise('original');
    expect(failure).toBeDefined();
    expect(result.notes).toContain('Unexpected marker effect');
  });

  it('charges a new steer turn once and records its separate usage', async () => {
    const { result, budget, failure } = await exercise('new-turn');
    expect(failure).toBeUndefined();
    expect(result.turns).toBe(2);
    expect(budget.consumed).toBe(2);
    expect(result.usageByTurn).toEqual({ 'turn-one': 100, 'turn-two': 100 });
    expect(result.steer).toMatchObject({
      responseTurn: 'new',
      newTurnStarted: true,
    });
    expect(result.notes).toContain('steer started a new turn');
  });

  it.each([
    ['per-turn', 'Per-turn usage bound reached'],
    ['cumulative', 'Cumulative usage bound reached'],
  ] as const)(
    '%s usage bound fails the active case and latches the run stop gate',
    async (mode, message) => {
      const { result, failure, usage, sent } = await exercise(mode);
      expect(failure).toBeDefined();
      expect(result.notes).toContain(message);
      expect(usage.exceeded).toBe(true);
      const breached = mode === 'per-turn' ? USAGE_TURN_LIMIT + 1 : 100;
      expect(result.usageByTurn).toEqual({ 'turn-one': breached });
      expect(usage.consumed).toBe(
        mode === 'cumulative' ? 100_000 + breached : breached,
      );
      expect(
        sent.filter((frame) => frame['method'] === 'turn/steer'),
      ).toHaveLength(0);
    },
  );

  it('does not send steer when the caller cap is one', async () => {
    const { result, sent, failure, budget } = await exercise('happy', 1);
    expect(failure).toBeDefined();
    expect(budget.consumed).toBe(1);
    expect(sent.some((frame) => frame['method'] === 'turn/steer')).toBe(false);
    expect(result.notes).toContain('turn/steer not sent: turn cap reached');
    expect(result.approvals.map((entry) => entry.response)).toEqual([
      'decline',
    ]);
  });

  it.each(['0', '18', '1.5', 'abc'])('rejects --turn-cap %s', (value) => {
    expect(() => parseOptions(['--turn-cap', value])).toThrow(
      'Turn cap must be an integer',
    );
  });

  it('accepts --turn-cap 7', () => {
    expect(parseOptions(['--turn-cap', '7']).turnCap).toBe(7);
  });

  it('rejects planned turns over the caller cap before spawning a child', async () => {
    const spawnModule =
      jest.requireActual<typeof import('node:child_process')>(
        'node:child_process',
      );
    const spy = jest.spyOn(spawnModule, 'spawn');
    try {
      await expect(
        runHarness(parseOptions(['--run', '--turn-cap', '1']), [
          {
            id: 'two',
            turnCost: 2,
            kind: 'command',
            level: 'ask',
            decision: 'accept',
            observations: [],
            purpose: 'test',
          },
        ]),
      ).rejects.toThrow('Planned turn budget exceeds cap');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('reports worst-case turns without reserving a steer slot in preflight', async () => {
    const print = jest.fn();
    await runHarness(
      parseOptions(['--dry-run', '--turn-cap', '1']),
      [
        {
          id: 'edit',
          turnCost: 1,
          kind: 'command',
          level: 'ask',
          decision: 'edit',
          observations: [],
          purpose: 'test',
        },
      ],
      print,
    );
    expect(JSON.parse(print.mock.calls[0][0])).toMatchObject({
      cap: 1,
      worstCaseTurns: 2,
      turnBudgetNote:
        'A steer-created turn can cause later cases to be skipped.',
    });
  });

  it.each(['trailing-usage', 'terminal-usage'] as const)(
    'captures trailing usage after %s',
    async (mode) => {
      const { result, failure, usage } = await exercise(mode);
      expect(failure).toBeUndefined();
      expect(result.notes).toContain('usage after terminal: observed');
      expect(result.usageByTurn).toEqual({ 'turn-one': 300 });
      expect(usage.consumed).toBe(300);
    },
  );

  it('records when terminal usage does not arrive within 500 ms', async () => {
    const { result, failure } = await exercise('happy');
    expect(failure).toBeUndefined();
    expect(result.notes).toContain(
      'usage after terminal: not observed within 500 ms',
    );
  });

  it('keeps observed steer turns in the count even when they exceed the cap', () => {
    const budget = new TurnBudget();
    for (let i = 0; i < TURN_CAP; i++) expect(budget.claim()).toBe(true);
    expect(budget.observeTurn()).toBe(false);
    expect(budget.consumed).toBe(TURN_CAP + 1);
    expect(budget.claim()).toBe(false);
  });

  it('declares ask-command-edit with one planned turn', () => {
    const cases: unknown = JSON.parse(
      readFileSync(join(__dirname, 'evidence-cases.json'), 'utf8'),
    );
    expect(cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ask-command-edit',
          turnCost: 1,
          decision: 'edit',
        }),
        expect.objectContaining({
          id: 'ask-read-rule',
          turnCost: 1,
          kind: 'read-rule',
          level: 'ask',
          decision: 'deny',
        }),
      ]),
    );
  });
});

describe('MCP elicitation evidence flow', () => {
  const method = 'mcpServer/elicitation/request';
  async function exercise(
    mode:
      | 'happy'
      | 'server'
      | 'non-mcp'
      | 'second'
      | 'turn'
      | 'tool'
      | 'required'
      | 'early'
      | 'title'
      | 'null-turn'
      | 'null-meta'
      | 'booleans'
      | 'openai/form'
      | 'openaiForm'
      | 'config-absent'
      | 'config-wrong'
      | 'usage'
      | 'usage-single',
  ) {
    const root = mkdtempSync(join(tmpdir(), 'ptah-mcp-spec-'));
    const experiment: Experiment = {
      root,
      workspace: join(root, 'workspace'),
      home: join(root, 'home'),
      scratch: join(root, 'scratch'),
    };
    for (const directory of [
      experiment.workspace,
      experiment.home,
      experiment.scratch,
    ])
      mkdirSync(directory);
    const child = Object.assign(new childProcess.ChildProcess(), fakeChild());
    const spawnModule =
      jest.requireActual<typeof import('node:child_process')>(
        'node:child_process',
      );
    const spawnSpy = jest
      .spyOn(spawnModule, 'spawn')
      .mockImplementation((_binary, args) => {
        if (mode !== 'non-mcp')
          expect(args).toContain(
            'mcp_servers.marker.default_tools_approval_mode="prompt"',
          );
        return child;
      });
    child.stdin.on('finish', () => child.emit('close', 0));
    const result: Parameters<typeof runCase>[1] = {
      id: mode.startsWith('usage') ? 'usage-semantics' : 'mcp-approval',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
      notes: [],
    };
    const original = join(experiment.workspace, `${result.id}.marker`);
    const sent: Record<string, unknown>[] = [];
    const selected = policy('ask');
    const send = (frame: object) =>
      child.stdout.write(JSON.stringify(frame) + '\n');
    const notify = (method: string, params: object) => send({ method, params });
    let writes = 0;
    let held = false;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const request = (id: string) =>
      send({
        id,
        method,
        params: {
          threadId: 'thread',
          turnId:
            mode === 'turn' ? 'wrong' : mode === 'null-turn' ? null : 'turn',
          serverName: mode === 'server' ? 'other' : 'marker',
          mode: mode === 'openai/form' || mode === 'openaiForm' ? mode : 'form',
          message:
            'Approve write_marker for person@example.com with Bearer private-token',
          requestedSchema:
            mode === 'booleans'
              ? {
                  type: 'object',
                  properties: {
                    approve: { type: 'boolean' },
                    confirm: { type: 'boolean' },
                    persist: { type: 'boolean' },
                  },
                  required: ['approve', 'confirm'],
                }
              : {
                  type: 'object',
                  properties: {
                    persist: { type: 'string', enum: ['session', 'always'] },
                  },
                  ...(mode === 'required' ? { required: ['persist'] } : {}),
                },
          ...(mode === 'tool' ? { tool: 'other' } : {}),
          _meta:
            mode === 'null-meta'
              ? null
              : {
                  tool_title:
                    mode === 'title' ? 'Write marker' : 'write_marker',
                  codex_approval_kind: 'private-metadata-value',
                },
        },
      });
    child.stdin.on('data', (bytes: Buffer) => {
      const frame: Record<string, unknown> = JSON.parse(bytes.toString());
      sent.push(frame);
      const reply = (value: object) => send({ id: frame['id'], result: value });
      switch (frame['method']) {
        case 'initialize':
          reply({ codexHome: experiment.home });
          break;
        case 'model/list':
          reply({ data: [{ id: 'test-model' }] });
          break;
        case 'config/read':
          reply({
            config: {
              ...OUTPUT_BOUNDS,
              sandbox_mode: selected.sandbox,
              approval_policy: selected.approvalPolicy,
              sandbox_workspace_write: { network_access: false },
              ...(mode === 'config-absent'
                ? {}
                : {
                    mcp_servers: {
                      marker: {
                        default_tools_approval_mode:
                          mode === 'config-wrong' ? 'auto' : 'prompt',
                      },
                    },
                  }),
            },
          });
          break;
        case 'thread/start':
          reply({ thread: { id: 'thread' }, ...selected });
          break;
        case 'turn/start':
          reply({ turn: { id: 'turn' } });
          setImmediate(() => {
            notify('turn/started', {
              threadId: 'thread',
              turn: { id: 'turn' },
            });
            notify('thread/tokenUsage/updated', {
              threadId: 'thread',
              turnId: 'turn',
              tokenUsage: {
                last: { totalTokens: 10 },
                total: { totalTokens: 10 },
              },
            });
            if (mode !== 'non-mcp')
              notify('item/started', {
                threadId: 'thread',
                turnId: 'turn',
                item: {
                  id: 'tool',
                  type: 'mcpToolCall',
                  status: 'inProgress',
                  server: 'marker',
                  tool: 'write_marker',
                  arguments: { slot: 'original' },
                },
              });
            request('approval-one');
            if (mode === 'second') request('approval-two');
            holdTimer = setTimeout(() => {
              held =
                !existsSync(original) &&
                !sent.some((entry) => entry['id'] === 'approval-one');
              if (mode === 'early')
                writeFileSync(original, 'marker', { flag: 'wx' });
            }, 50);
          });
          break;
        case 'turn/interrupt':
          reply({});
          notify('turn/completed', {
            threadId: 'thread',
            turn: { id: 'turn', status: 'interrupted' },
          });
          notify('thread/tokenUsage/updated', {
            threadId: 'thread',
            turnId: 'turn',
            tokenUsage: {
              last: { totalTokens: 10 },
              total: { totalTokens: 10 },
            },
          });
          break;
        default:
          if (
            frame['id'] === 'approval-one' &&
            [
              'happy',
              'usage',
              'usage-single',
              'title',
              'null-turn',
              'null-meta',
              'booleans',
              'config-absent',
            ].includes(mode)
          ) {
            expect(frame['result']).toEqual({
              action: 'accept',
              content:
                mode === 'booleans' ? { approve: true, confirm: true } : {},
            });
            expect(held).toBe(true);
            writeFileSync(original, 'marker', { flag: 'wx' });
            writes++;
            notify('item/completed', {
              threadId: 'thread',
              turnId: 'turn',
              item: {
                id: 'tool',
                type: 'mcpToolCall',
                status: 'completed',
                server: 'marker',
                tool: 'write_marker',
                arguments: { slot: 'original' },
                result: { private: 'never retained' },
                error: null,
              },
            });
            if (mode.startsWith('usage')) {
              if (mode === 'usage')
                notify('thread/tokenUsage/updated', {
                  threadId: 'thread',
                  turnId: 'turn',
                  tokenUsage: {
                    last: { totalTokens: 7 },
                    total: { totalTokens: 17 },
                  },
                });
              notify('turn/completed', {
                threadId: 'thread',
                turn: { id: 'turn', status: 'completed' },
              });
            }
          }
      }
    });
    let failure: unknown;
    try {
      const protocolDirectory = join(__dirname, '../src/lib/protocol');
      await runCase(
        {
          id: result.id,
          turnCost: 1,
          observations: [1],
          kind: mode === 'non-mcp' ? 'command' : 'mcp',
          level: 'ask',
          decision: 'accept',
          purpose: 'test',
        },
        result,
        experiment,
        'unused',
        'test-model',
        new TurnBudget(),
        new UsageBudget(),
        JSON.parse(
          readFileSync(
            join(protocolDirectory, 'codex-app-server-protocol.manifest.json'),
            'utf8',
          ),
        ),
        readFileSync(
          join(protocolDirectory, 'codex-app-server-protocol.schema.json'),
          'utf8',
        ),
        false,
        new Set(),
        root,
      );
    } catch (error) {
      failure = error;
    } finally {
      if (holdTimer) clearTimeout(holdTimer);
      spawnSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
    return { result, sent, failure, writes, held };
  }

  it('captures two model requests without interrupting at the MCP marker', async () => {
    const { result, sent, failure } = await exercise('usage');
    expect(failure).toBeUndefined();
    expect(result.status).toBe('observed');
    expect(result.usageSamples).toEqual([
      { last: 10, total: 10 },
      { last: 7, total: 17 },
    ]);
    expect(result.round?.['usageLastMatchesIncrement']).toBe(true);
    expect(sent.some((frame) => frame['method'] === 'turn/interrupt')).toBe(
      false,
    );
  });
  it('does not claim two-request usage proof from a single notification', async () => {
    const { result, failure } = await exercise('usage-single');
    expect(failure).toBeUndefined();
    expect(result.status).toBe('unverified: two model requests required');
  });

  it('holds the request without effects, accepts once, then observes the marker', async () => {
    const { result, sent, failure, writes, held } = await exercise('happy');
    expect(failure).toBeUndefined();
    expect(result.status).toBe('observed');
    expect(writes).toBe(1);
    expect(held).toBe(true);
    expect(result.approvals[0]).toMatchObject({
      absentBefore: true,
      response: 'accept',
      serverName: 'marker',
      requestedSchemaProperties: ['persist'],
      metaKeys: ['codex_approval_kind', 'tool_title'],
    });
    expect(JSON.stringify(result.approvals)).not.toMatch(
      /person@example.com|private-token|private-metadata-value/,
    );
    expect(sent.some((frame) => frame['method'] === 'turn/interrupt')).toBe(
      true,
    );
    expect(result.events).toContainEqual({
      direction: 'in',
      method: 'item/completed',
      itemType: 'mcpToolCall',
      itemStatus: 'completed',
      server: 'marker',
      tool: 'write_marker',
      hasError: false,
    });
  });

  it.each([
    'server',
    'non-mcp',
    'second',
    'turn',
    'tool',
    'required',
    'openai/form',
    'openaiForm',
  ] as const)('declines unexpected elicitation: %s', async (mode) => {
    const { result, sent, failure, writes } = await exercise(mode);
    expect(failure).toBeDefined();
    expect(result.notes).toContain('Unexpected request');
    expect(sent).toContainEqual({
      id: mode === 'second' ? 'approval-two' : 'approval-one',
      result: { action: 'decline' },
    });
    expect(writes).toBe(0);
  });

  it.each([
    'title',
    'null-turn',
    'null-meta',
    'booleans',
    'config-absent',
  ] as const)(
    'accepts supported elicitation and observes exactly one marker: %s',
    async (mode) => {
      const { result, failure, writes, held } = await exercise(mode);
      expect(failure).toBeUndefined();
      expect(result.status).toBe('observed');
      expect(writes).toBe(1);
      expect(held).toBe(true);
      if (mode === 'null-turn')
        expect(result.notes).toContain('elicitation turnId: null');
      if (mode === 'booleans')
        expect(result.notes).toContain(
          'elicitation required boolean fields: approve, confirm',
        );
      if (mode === 'config-absent')
        expect(result.notes).toContain(
          'MCP approval mode not visible in config/read',
        );
    },
  );

  it('rejects a visible MCP approval mode other than prompt before starting a thread', async () => {
    const { result, sent, failure, writes } = await exercise('config-wrong');
    expect(failure).toBeDefined();
    expect(String(failure)).toContain(
      'Effective config differs from bounded profile',
    );
    expect(result.status).not.toBe('observed');
    expect(sent.some((frame) => frame['method'] === 'thread/start')).toBe(
      false,
    );
    expect(writes).toBe(0);
  });

  it('fails if a marker appears during the hold', async () => {
    const { result, failure } = await exercise('early');
    expect(failure).toBeDefined();
    expect(result.status).not.toBe('observed');
  });

  it('summarizes item and startup fields without retaining payloads', async () => {
    const child = fakeChild();
    const result: Parameters<typeof runCase>[1] = {
      id: 'summary',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
    };
    const rpc = new RpcChild(child, result);
    const send = (method: string, params: object) =>
      child.stdout.write(JSON.stringify({ method, params }) + '\n');
    send('item/started', {
      item: { type: 'agentMessage', text: 'private-text' },
    });
    for (const error of [null, { message: 'private-error' }])
      send('item/completed', {
        item: {
          type: 'mcpToolCall',
          status: 'failed',
          server: 'server '.repeat(20),
          tool: 'person@example.com',
          arguments: { secret: 'private-args' },
          result: 'private-result',
          error,
        },
      });
    send('mcpServer/startupStatus/updated', {
      name: 'name '.repeat(20),
      status: 'failed',
      error: 'private-startup-error',
    });
    expect(result.events[0]).toEqual({
      direction: 'in',
      method: 'item/started',
      itemType: 'agentMessage',
    });
    expect(result.events[1]).toMatchObject({
      itemType: 'mcpToolCall',
      itemStatus: 'failed',
      server: 'server '.repeat(20).slice(0, 80),
      hasError: false,
    });
    expect(result.events[2]).toMatchObject({ hasError: true });
    expect(result.events[3]).toEqual({
      direction: 'in',
      method: 'mcpServer/startupStatus/updated',
      status: 'failed',
      name: 'name '.repeat(20).slice(0, 80),
    });
    expect(JSON.stringify(result.events)).not.toMatch(
      /private-|person@example.com|arguments|result|message/,
    );
    rpc.stopSync();
  });

  it('records only completed agent text, sanitized and bounded outside event summaries', () => {
    const child = fakeChild();
    const result: Parameters<typeof runCase>[1] = {
      id: 'agent-text',
      status: '',
      turns: 0,
      events: [],
      approvals: [],
    };
    const rpc = new RpcChild(child, result);
    const send = (method: string, type: string, text: unknown) =>
      child.stdout.write(
        JSON.stringify({ method, params: { item: { type, text } } }) + '\n',
      );
    send('item/started', 'agentMessage', 'private-started');
    send('item/completed', 'reasoning', 'private-reasoning');
    send('item/completed', 'agentMessage', { text: 'private-malformed' });
    expect(result.agentMessages).toBeUndefined();
    send(
      'item/completed',
      'agentMessage',
      'private-completed person@example.com Bearer secret-value',
    );
    send('item/completed', 'agentMessage', 'bounded text '.repeat(50));
    send('item/completed', 'agentMessage', 'third-completed');
    expect(result.agentMessages).toEqual([
      'private-completed [REDACTED] Bearer [REDACTED]',
      'bounded text '.repeat(50).slice(0, 400),
      'third-completed',
    ]);
    expect(result.agentMessages?.[1]).toHaveLength(400);
    send('item/completed', 'agentMessage', 'fourth-completed');
    expect(result.agentMessages).toEqual([
      'bounded text '.repeat(50).slice(0, 400),
      'third-completed',
      'fourth-completed',
    ]);
    expect(JSON.stringify(result.events)).not.toMatch(
      /private-|person@example.com|secret-value|bounded text|third-completed|fourth-completed/,
    );
    rpc.stopSync();
  });

  it.each(['\\', '/'])(
    'redacts experiment paths and usernames with %s separators before retaining text',
    (separator) => {
      const root =
        'C:/Users/alice/AppData/Local/Temp/ptah-codex-evidence-test'.replaceAll(
          '/',
          separator,
        );
      const experiment: Experiment = {
        root,
        workspace: `${root}${separator}workspace`,
        home: `${root}${separator}home`,
        scratch: `${root}${separator}scratch`,
      };
      const child = fakeChild();
      const result: Parameters<typeof runCase>[1] = {
        id: 'paths',
        status: '',
        turns: 0,
        events: [],
        approvals: [],
      };
      const rpc = new RpcChild(child, result, createPathRedactor(experiment));
      const text = [
        `${experiment.workspace}${separator}marker`,
        `${experiment.home}${separator}config`,
        `${experiment.scratch}${separator}marker`,
        `${experiment.root}${separator}script`,
        `C:${separator}Users${separator}bob${separator}other`,
        '/home/carol/file',
        '/Users/dana/file',
      ].join(' ');
      child.stdout.write(
        JSON.stringify({
          method: 'item/completed',
          params: { item: { type: 'agentMessage', text } },
        }) + '\n',
      );
      expect(result.agentMessages).toEqual([
        `<WORKSPACE>${separator}marker <HOME>${separator}config <SCRATCH>${separator}marker <ROOT>${separator}script <USER_HOME>${separator}other <USER_HOME>/file <USER_HOME>/file`,
      ]);
      expect(JSON.stringify(result)).not.toMatch(
        /alice|bob|carol|dana|AppData|ptah-codex-evidence-test/,
      );
      rpc.stopSync();
    },
  );
});

describe('round 7a catalog', () => {
  it('budgets nine paid turns with schema-only probes first', () => {
    const cases = JSON.parse(
      readFileSync(join(__dirname, 'evidence-cases.json'), 'utf8'),
    ) as { id: string; turnCost: number }[];
    const ids = [
      'different-home-isolation',
      'same-home-isolation',
      'profile-inputs',
      'usage-semantics',
      'resume-history',
      'always-allow-scope',
    ];
    expect(
      cases
        .filter((item) => ids.includes(item.id))
        .reduce((sum, item) => sum + item.turnCost, 0),
    ).toBe(9);
    expect(
      cases.find((item) => item.id === 'subagent-and-rewind')?.turnCost,
    ).toBe(0);
    expect(new TurnBudget(10).cap).toBe(10);
    expect(() => new TurnBudget(18)).toThrow();
  });
});

describe('additional experiment homes', () => {
  it('removes separately copied auth on fatal/keep cleanup without deleting retained artifacts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-extra-home-'));
    const home = join(root, 'home');
    const second = join(root, 'second-home');
    mkdirSync(home);
    mkdirSync(second);
    writeFileSync(join(second, 'auth.json'), 'fake-secret');
    try {
      cleanupExperiment(
        {
          root,
          home,
          workspace: root,
          scratch: root,
          additionalHomes: [second],
        },
        true,
      );
      expect(existsSync(home)).toBe(false);
      expect(existsSync(second)).toBe(false);
      expect(existsSync(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('case scheduling guards', () => {
  it.each([
    ['observed', false],
    ['unverified: two usage notifications required', false],
    ['failed: protocol, isolation or approval gate', true],
    ['not run: cap', true],
  ])('status %s stops=%s', (status, expected) => {
    expect(shouldStopAfterCase(String(status))).toBe(expected);
  });
  it.each([
    [0, 60000],
    [1, 75000],
    [2, 150000],
    [10, 225000],
  ])('bounds deadline for %i turns', (turnCost, expected) => {
    expect(caseDeadlineMs({ turnCost })).toBe(expected);
  });
});
