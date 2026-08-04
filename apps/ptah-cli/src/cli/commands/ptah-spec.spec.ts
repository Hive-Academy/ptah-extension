/**
 * `ptah spec` — unit specs (TASK_2026_179, task 6.1).
 *
 * Two things are being proven here, and they are different in kind:
 *
 *  1. **The machine contract.** Each of the six subcommands emits EXACTLY ONE
 *     notification, and that notification encodes to a single parseable JSON
 *     document. The assertion goes through the real `JsonFormatter` and the
 *     real encoder onto a captured stream, not through a fake — a test against
 *     a stub formatter would prove the command called a function, not that
 *     stdout is parseable.
 *
 *  2. **`doctor --plan` does not mutate.** This one runs the REAL
 *     `TaskDoctorService` over the REAL `CliFileSystemProvider` against a temp
 *     fixture on disk, and compares a byte-level snapshot of the whole tree
 *     before and after. Mocking the doctor here would test nothing: the claim
 *     is about what the shipping code does to a user's files.
 */

import 'reflect-metadata';
import { promises as nodeFs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';

import { CliFileSystemProvider } from '@ptah-extension/platform-cli';
import {
  NoOpTaskIndexNotifier,
  TaskDoctorService,
  TaskWriterService,
} from '@ptah-extension/task-specs';
import type { Logger } from '@ptah-extension/vscode-core';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';

import {
  execute,
  type SpecExecuteHooks,
  type SpecOptions,
} from './ptah-spec.js';
import { ExitCode } from '../jsonrpc/types.js';
import { JsonFormatter, type Formatter } from '../output/formatter.js';
import { StdoutWriter } from '../io/stdout-writer.js';
import type { GlobalOptions } from '../router.js';

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: process.cwd(),
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

/**
 * A real `JsonFormatter` writing into a captured buffer.
 *
 * This is what makes the "single parseable JSON document" claim testable: it
 * exercises the actual encoder and the actual writer, so the assertion is about
 * bytes on the stream rather than about call counts.
 */
function makeCapturingFormatter(): {
  formatter: Formatter;
  read: () => string;
} {
  let buffer = '';
  const sink = new Writable({
    write(chunk, _encoding, callback): void {
      buffer += String(chunk);
      callback();
    },
  });
  const writer = new StdoutWriter({
    output: sink as unknown as NodeJS.WriteStream,
  });
  return { formatter: new JsonFormatter(writer), read: () => buffer };
}

type ScriptedResponse =
  | { success: true; data?: unknown }
  | { success: false; error: string; errorCode?: string };

interface MockEngine {
  withEngine: SpecExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<string, ScriptedResponse>;
  resolved: symbol[];
}

/**
 * @param services token → instance, for the `doctor` path which resolves
 *   `TaskDoctorService` from the container instead of going through RPC.
 */
function makeEngine(services: Map<symbol, unknown> = new Map()): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const resolved: symbol[] = [];

  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      return scripted.get(method) ?? { success: true, data: {} };
    }),
  } as unknown as CliMessageTransport;

  const container = {
    resolve: jest.fn((token: symbol) => {
      resolved.push(token);
      const service = services.get(token);
      if (!service) throw new Error(`unregistered token ${String(token)}`);
      return service;
    }),
  };

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: { removeAllListeners(): void };
    }) => Promise<unknown>,
  ): Promise<unknown> =>
    fn({
      container,
      transport,
      pushAdapter: { removeAllListeners: jest.fn() },
    })) as unknown as SpecExecuteHooks['withEngine'];

  return { withEngine, rpcCalls, scripted, resolved };
}

function silentLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// The machine contract: one notification, one JSON document
// ---------------------------------------------------------------------------

describe('ptah spec — --json emits a single JSON document', () => {
  /** Minimal valid invocation for each subcommand, plus its RPC script. */
  const CASES: Array<{
    label: string;
    opts: SpecOptions;
    notification: string;
    script?: Array<[string, ScriptedResponse]>;
    doctor?: boolean;
  }> = [
    {
      label: 'new',
      opts: { subcommand: 'new', title: 'A task', type: 'FEATURE', json: true },
      notification: 'spec.created',
      script: [
        [
          'tasks:create',
          { success: true, data: { success: true, task: { id: 'TASK_X' } } },
        ],
      ],
    },
    {
      label: 'status',
      opts: {
        subcommand: 'status',
        id: 'TASK_X',
        to: 'in_progress',
        json: true,
      },
      notification: 'spec.status',
      script: [
        [
          'tasks:updateStatus',
          { success: true, data: { success: true, task: { id: 'TASK_X' } } },
        ],
      ],
    },
    {
      label: 'show',
      opts: { subcommand: 'show', id: 'TASK_X', json: true },
      notification: 'spec.detail',
      script: [
        ['tasks:get', { success: true, data: { task: { id: 'TASK_X' } } }],
      ],
    },
    {
      label: 'list',
      opts: { subcommand: 'list', json: true },
      notification: 'spec.list',
      script: [
        [
          'tasks:list',
          {
            success: true,
            data: { tasks: [], excludedCount: 0, specsDirExists: true },
          },
        ],
      ],
    },
    {
      label: 'check',
      opts: { subcommand: 'check', json: true },
      notification: 'spec.check',
      script: [
        [
          'tasks:board',
          {
            success: true,
            data: {
              columns: {},
              excluded: [],
              excludedCount: 0,
              specsDirExists: true,
            },
          },
        ],
      ],
    },
    {
      label: 'doctor',
      opts: { subcommand: 'doctor', doctorMode: 'plan', json: true },
      notification: 'spec.doctor',
      doctor: true,
    },
  ];

  it.each(CASES)(
    'spec $label --json writes exactly one parseable JSON document',
    async ({ opts, notification, script, doctor }) => {
      const services = new Map<symbol, unknown>();
      if (doctor) {
        services.set(Symbol.for('TaskSpecsDoctor'), {
          plan: jest.fn(async () => ({
            ok: true,
            plan: {
              workspaceRoot: baseGlobals.cwd,
              contractVersion: 1,
              stampVersion: null,
              actions: [],
              warnings: [],
            },
          })),
          apply: jest.fn(),
          undo: jest.fn(),
        });
      }
      const engine = makeEngine(services);
      for (const [method, response] of script ?? []) {
        engine.scripted.set(method, response);
      }
      const capture = makeCapturingFormatter();

      const exit = await execute(opts, baseGlobals, {
        formatter: capture.formatter,
        withEngine: engine.withEngine,
      });

      expect(exit).toBe(ExitCode.Success);

      const raw = capture.read();
      // Exactly one line: no interleaved logging, no second notification.
      const lines = raw.split('\n').filter((line) => line.trim().length > 0);
      expect(lines).toHaveLength(1);

      // And it parses on its own, as a whole document.
      const parsed = JSON.parse(raw) as {
        jsonrpc: string;
        method: string;
      };
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.method).toBe(notification);
    },
  );

  it('forces JSON output even when --human was passed globally', async () => {
    // `--json` on the subcommand is authoritative. Without this, a caller who
    // set --human once would silently get a pretty-printed table back from a
    // command they asked to be machine-readable.
    const engine = makeEngine();
    engine.scripted.set('tasks:list', {
      success: true,
      data: { tasks: [], excludedCount: 0, specsDirExists: true },
    });
    const capture = makeCapturingFormatter();

    await execute(
      { subcommand: 'list', json: true },
      { ...baseGlobals, human: true, json: false },
      { formatter: capture.formatter, withEngine: engine.withEngine },
    );

    expect(() => JSON.parse(capture.read())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Routing + validation
// ---------------------------------------------------------------------------

describe('ptah spec — routing', () => {
  it('routes each read/write subcommand to its RPC method', async () => {
    const cases: Array<[SpecOptions, string]> = [
      [{ subcommand: 'new', title: 'T', type: 'BUGFIX' }, 'tasks:create'],
      [
        { subcommand: 'status', id: 'TASK_X', to: 'done' },
        'tasks:updateStatus',
      ],
      [{ subcommand: 'show', id: 'TASK_X' }, 'tasks:get'],
      [{ subcommand: 'list' }, 'tasks:list'],
      [{ subcommand: 'check' }, 'tasks:board'],
    ];

    for (const [opts, method] of cases) {
      const engine = makeEngine();
      engine.scripted.set(method, {
        success: true,
        data:
          method === 'tasks:get'
            ? { task: { id: 'TASK_X' } }
            : { success: true, task: { id: 'TASK_X' } },
      });
      const trace = makeFormatter();
      await execute(opts, baseGlobals, {
        formatter: trace.formatter,
        withEngine: engine.withEngine,
      });
      expect(engine.rpcCalls.map((call) => call.method)).toEqual([method]);
    }
  });

  it('rejects an unknown --type before touching the backend', async () => {
    const engine = makeEngine();
    const trace = makeFormatter();
    const exit = await execute(
      { subcommand: 'new', title: 'T', type: 'NOT_A_TYPE' },
      baseGlobals,
      { formatter: trace.formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toEqual([]);
    expect(trace.notifications).toHaveLength(1);
    expect(trace.notifications[0].method).toBe('task.error');
  });

  it('rejects an unknown --to status before touching the backend', async () => {
    const engine = makeEngine();
    const trace = makeFormatter();
    const exit = await execute(
      { subcommand: 'status', id: 'TASK_X', to: 'nearly_done' },
      baseGlobals,
      { formatter: trace.formatter, withEngine: engine.withEngine },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(engine.rpcCalls).toEqual([]);
  });

  it('surfaces a TASK_CONFLICT code so a script can retry', async () => {
    const engine = makeEngine();
    engine.scripted.set('tasks:updateStatus', {
      success: true,
      data: {
        success: false,
        error: { code: 'TASK_CONFLICT', message: 'changed on disk' },
      },
    });
    const trace = makeFormatter();

    const exit = await execute(
      { subcommand: 'status', id: 'TASK_X', to: 'done' },
      baseGlobals,
      { formatter: trace.formatter, withEngine: engine.withEngine },
    );

    expect(exit).toBe(ExitCode.GeneralError);
    expect(trace.notifications).toHaveLength(1);
    expect(trace.notifications[0].params).toMatchObject({
      code: 'TASK_CONFLICT',
    });
  });
});

// ---------------------------------------------------------------------------
// `spec doctor --plan` is READ-ONLY — proven against real files
// ---------------------------------------------------------------------------

/** Byte-level snapshot of every file under `root`, keyed by relative path. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    const entries = await nodeFs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Record directories too — an adoption that created an empty folder
        // would otherwise slip past a files-only comparison.
        snapshot.set(`${path.relative(root, full)}/`, '');
        await walk(full);
      } else {
        const bytes = await nodeFs.readFile(full);
        snapshot.set(path.relative(root, full), bytes.toString('base64'));
      }
    }
  };
  await walk(root);
  return snapshot;
}

describe('ptah spec doctor --plan — lists without mutating', () => {
  let fixtureRoot: string;

  beforeEach(async () => {
    fixtureRoot = await nodeFs.mkdtemp(
      path.join(os.tmpdir(), 'ptah-spec-doctor-'),
    );
    const specs = path.join(fixtureRoot, '.ptah', 'specs');
    // A carrier-less folder holding a completion artifact. The doctor should
    // propose adopting it as `done` — and propose is all it may do.
    const orphan = path.join(specs, 'TASK_2026_155');
    await nodeFs.mkdir(orphan, { recursive: true });
    await nodeFs.writeFile(
      path.join(orphan, 'context.md'),
      '# Orphaned work\n\nSome prose.\n',
      'utf8',
    );
    await nodeFs.writeFile(
      path.join(orphan, 'test-report.md'),
      '# Test report\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await nodeFs.rm(fixtureRoot, { recursive: true, force: true });
  });

  it('names the carrier-less folder and leaves the tree byte-identical', async () => {
    const fsProvider = new CliFileSystemProvider();
    const logger = silentLogger();
    const realDoctor = new TaskDoctorService(
      fsProvider,
      logger,
      new TaskWriterService(fsProvider, logger, new NoOpTaskIndexNotifier()),
    );

    const engine = makeEngine(
      new Map<symbol, unknown>([
        [Symbol.for('TaskSpecsDoctor'), realDoctor as unknown],
      ]),
    );
    const trace = makeFormatter();

    const before = await snapshotTree(fixtureRoot);

    const exit = await execute(
      { subcommand: 'doctor', doctorMode: 'plan', json: true },
      { ...baseGlobals, cwd: fixtureRoot },
      { formatter: trace.formatter, withEngine: engine.withEngine },
    );

    expect(exit).toBe(ExitCode.Success);

    // It resolved the doctor rather than going through RPC.
    expect(engine.resolved).toContain(Symbol.for('TaskSpecsDoctor'));
    expect(engine.rpcCalls).toEqual([]);

    // It NAMED the folder, and marked the deduced status as deduced.
    expect(trace.notifications).toHaveLength(1);
    const params = trace.notifications[0].params as {
      mode: string;
      applied: boolean;
      actions: Array<Record<string, unknown>>;
    };
    expect(params.mode).toBe('plan');
    expect(params.applied).toBe(false);
    const adopt = params.actions.find((a) => a['kind'] === 'adopt');
    expect(adopt).toBeDefined();
    expect(adopt?.['folderName']).toBe('TASK_2026_155');
    // `test-report.md` present ⇒ finished work, not `backlog`.
    expect(adopt?.['status']).toBe('done');
    expect(adopt?.['statusInferred']).toBe(true);
    expect(adopt?.['inferredFrom']).toContain('test-report.md');

    // And NOTHING moved. No carrier, no journal, no contract stamp, no
    // byte of any existing file.
    const after = await snapshotTree(fixtureRoot);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [relPath, bytes] of before) {
      expect(after.get(relPath)).toBe(bytes);
    }
  });
});
