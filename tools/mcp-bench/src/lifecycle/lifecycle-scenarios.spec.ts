import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildMemoryQuestionSet } from '../ground-truth/memory-questions';
import type { HostExit } from '../transport/host-launcher';
import { BenchHeldRealStateError } from '../transport/real-state-guard';
import type { McpToolCaller, ToolCallOutcome } from '../transport/mcp-client';
import {
  COPY_SCENARIOS,
  largeTsFile,
  unscoredScenarios,
  paddedTsFile,
  runCopyScenarios,
  runSessionScenarios,
  type BenchSession,
  type LifecycleDeps,
  type LifecycleResult,
} from './lifecycle-scenarios';
import { coverageOf, naScenarios } from './lifecycle-na';

type Handler = (
  root: string,
  tool: string,
  args: Record<string, unknown>,
) => Promise<ToolCallOutcome> | ToolCallOutcome;

const CLEAN: HostExit = { kind: 'clean', exitCode: 0, signal: null };
const result = (text: string, isError = false): ToolCallOutcome => ({
  kind: 'result',
  text,
  isError,
  wallMs: 1,
});

function fakeSession(
  root: string,
  handler: Handler,
  dbPath: string | null = 'fake.sqlite',
): BenchSession & { stops: number } {
  const callerFor = (callRoot: string): McpToolCaller => ({
    callTool: async (tool, args) => handler(callRoot, tool, args),
  });
  const session = {
    workspaceRoot: root,
    coldStartMs: 1_234,
    dbPath,
    client: callerFor(root),
    callerFor,
    stops: 0,
    stop: async () => {
      session.stops += 1;
      return { exit: CLEAN };
    },
  };
  return session;
}

function fakeDeps(
  overrides: Partial<LifecycleDeps> = {},
): LifecycleDeps & { clock: { now: number } } {
  const clock = { now: 0 };
  return {
    clock,
    launch: async () => {
      throw new Error('launch not stubbed');
    },
    sleep: async (ms) => {
      clock.now += ms;
    },
    now: () => clock.now,
    backdateCodeSymbols: async () => 0,
    git: async (cwd, args) => {
      if (args[0] === 'worktree')
        await mkdir(String(args[args.length - 1]), { recursive: true });
      return '';
    },
    log: () => undefined,
    ...overrides,
  };
}

const byScenario = (
  results: readonly LifecycleResult[],
): Record<string, LifecycleResult> =>
  Object.fromEntries(results.map((item) => [item.scenario, item]));

/** A search answer as `ptah_code_search_symbols` writes it. */
function searchAnswer(
  hits: { filePath: string; name: string }[],
  index = '"symbolCount":10,"indexAgeMs":1000,"reindexStarted":false,"reindexInFlight":false',
): string {
  return JSON.stringify({
    index: JSON.parse(`{${index}}`),
    coverage: { clean: true },
    bm25Only: false,
    hits: hits.map((hit) => ({
      subject: null,
      filePath: hit.filePath,
      symbolName: hit.name,
      kind: 'function',
      text: `function ${hit.name} in ${hit.filePath}:0-2`,
      score: 1,
    })),
  });
}

/** An index that sees every file under `root` at once: the behaviour the claims promise. */
async function liveIndexSearch(
  root: string,
  query: string,
): Promise<{ filePath: string; name: string }[]> {
  const hits: { filePath: string; name: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if ((await readFile(path, 'utf8')).includes(`function ${query}(`))
        hits.push({
          filePath: path.slice(root.length + 1).replaceAll('\\', '/'),
          name: query,
        });
    }
  };
  await walk(root);
  return hits;
}

let scratch = '';
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'mcp-bench-lifecycle-spec-'));
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function corpusCopy(): Promise<string> {
  const root = join(scratch, 'copy');
  await mkdir(join(root, 'libs', 'a'), { recursive: true });
  await writeFile(
    join(root, 'libs', 'a', 'probe.ts'),
    'export function probeSymbol(): number {\n  return 0;\n}\n',
    'utf8',
  );
  return root;
}

const probe = { name: 'probeSymbol', location: 'libs/a/probe.ts:1' };

describe('scenario files', () => {
  it('writes a 3,900-line file and a file of at least 1.5 MiB, each ending in its symbol', () => {
    const long = largeTsFile('benchLong', 3_900);
    expect(long.split('\n').filter((line) => line !== '').length).toBe(3_900);
    expect(long).toContain('export function benchLong(');
    const big = paddedTsFile('benchBig', 1.5 * 1024 * 1024);
    expect(Buffer.byteLength(big)).toBeGreaterThanOrEqual(1.5 * 1024 * 1024);
    expect(big.trimEnd().endsWith('}')).toBe(true);
  });
});

describe('runCopyScenarios', () => {
  it('records cold start, edit/add then query and index age as failures when the index stays empty (cli-headless today)', async () => {
    const root = await corpusCopy();
    const sessions: ReturnType<typeof fakeSession>[] = [];
    const backdate = jest.fn(async () => 0);
    const handler: Handler = (_root, tool) => {
      if (tool === 'ptah_code_search_symbols')
        return result(
          searchAnswer(
            [],
            '"symbolCount":0,"indexAgeMs":null,"reindexStarted":true,"reindexInFlight":true',
          ).replace('{"clean":true}', '{"census":"unknown"}'),
        );
      if (tool === 'ptah_code_reindex')
        return result('{"outcome":"failed:too-large"}');
      return result('## File Search\n\nFound: 1 file\n\n1. package.json\n');
    };
    const deps = fakeDeps({
      launch: async (workspace) => {
        const session = fakeSession(workspace, handler);
        sessions.push(session);
        return session;
      },
      backdateCodeSymbols: backdate,
    });

    const { results, exits } = await runCopyScenarios(root, deps, {
      smoke: true,
      probe,
      tag: 't1',
    });
    const scored = byScenario(results);

    for (const name of [
      'cold-start',
      'edit-then-query-5s',
      'edit-then-query-60s',
      'add-then-query',
      'delete-then-query',
      'large-file-3900-lines',
      'index-age-24h',
    ])
      expect(scored[name]?.pass).toBe(false);
    expect(scored['cold-start'].detail).toContain(
      'no correct answer for probeSymbol within 120 s',
    );
    expect(scored['cold-start'].detail).toContain('unknown-coverage');
    expect(scored['delete-then-query'].detail).toContain('precondition failed');
    expect(scored['index-age-24h'].detail).toContain('the index never settled');
    expect(backdate).not.toHaveBeenCalled();
    expect(scored['large-file-1.5mib']).toMatchObject({ pass: true });
    expect(scored['large-file-1.5mib'].detail).toContain(
      'reported as too large',
    );
    expect(scored['transport-restart'].pass).toBe(true);
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.stops === 1)).toBe(true);
    expect(exits).toEqual([CLEAN, CLEAN]);
    // The scenario files were written to the copy only.
    expect(
      existsSync(join(root, 'libs', 'mcp-bench-lifecycle', 'large-3900-t1.ts')),
    ).toBe(true);
  });

  it('passes every copy scenario against an index that follows the files', async () => {
    const root = await corpusCopy();
    const handler: Handler = async (callRoot, tool, args) => {
      if (tool === 'ptah_code_search_symbols') {
        const hits = await liveIndexSearch(callRoot, String(args['query']));
        return result(
          searchAnswer(
            hits,
            '"symbolCount":10,"indexAgeMs":90000000,"reindexStarted":true,"reindexInFlight":false',
          ),
        );
      }
      if (tool === 'ptah_code_reindex') return result('{"outcome":"indexed"}');
      return result('## File Search\n\nFound: 1 file\n\n1. package.json\n');
    };
    const deps = fakeDeps({
      launch: async (workspace) => fakeSession(workspace, handler),
      backdateCodeSymbols: async () => 12,
    });

    const { results } = await runCopyScenarios(root, deps, {
      smoke: true,
      probe,
      tag: 't2',
    });

    expect(results.filter((item) => !item.pass)).toEqual([]);
    const age = byScenario(results)['index-age-24h'].detail;
    expect(age).toContain('index settled after 0 ms (DB ');
    expect(age).toContain('coverage {"clean":true}); 12 rows backdated 25 h');
    expect(byScenario(results)['cold-start'].detail).toContain(
      'reindexInFlight false first seen',
    );
    expect(
      existsSync(join(root, 'libs', 'mcp-bench-lifecycle', 'added-t2.ts')),
    ).toBe(false);
  });

  it('passes edit on a positive hit under unknown coverage and does not pass delete', async () => {
    const root = await corpusCopy();
    const handler: Handler = async (callRoot, tool, args) => {
      if (tool === 'ptah_code_search_symbols') {
        const hits = await liveIndexSearch(callRoot, String(args['query']));
        const body = JSON.parse(
          searchAnswer(
            hits,
            '"symbolCount":10,"indexAgeMs":90000000,"reindexStarted":true,"reindexInFlight":false',
          ),
        ) as { coverage: unknown };
        body.coverage = {
          clean: false,
          reasons: ['census?', 'unchecked?', 'failed?'],
          census: 'unknown',
        };
        return result(JSON.stringify(body));
      }
      if (tool === 'ptah_code_reindex') return result('{"outcome":"indexed"}');
      return result('## File Search\n\nFound: 1 file\n\n1. package.json\n');
    };
    const deps = fakeDeps({
      launch: async (workspace) => fakeSession(workspace, handler),
      backdateCodeSymbols: async () => 12,
    });

    const scored = byScenario(
      (
        await runCopyScenarios(root, deps, {
          smoke: true,
          probe,
          tag: 'unk',
        })
      ).results,
    );
    const phrase = ' (found under unknown coverage)';

    expect(scored['edit-then-query-5s']).toMatchObject({ pass: true });
    expect(scored['edit-then-query-5s'].detail).toContain(
      `at 5 s: found${phrase}`,
    );
    expect(scored['edit-then-query-60s'].pass).toBe(true);
    expect(scored['edit-then-query-60s'].detail).toContain(phrase);
    expect(scored['cold-start'].pass).toBe(true);
    expect(scored['cold-start'].detail).toContain(phrase);
    expect(scored['add-then-query'].pass).toBe(true);
    expect(scored['add-then-query'].detail).toContain(phrase);
    expect(scored['large-file-3900-lines'].pass).toBe(true);
    expect(scored['large-file-3900-lines'].detail).toContain(phrase);
    expect(scored['delete-then-query'].pass).toBe(false);
    expect(scored['delete-then-query'].detail).toContain('still answered');
    expect(scored['delete-then-query'].detail).not.toContain(phrase);
    expect(scored['large-file-1.5mib'].pass).toBe(false);
    expect(scored['large-file-1.5mib'].detail).toContain(
      'not found and not reported as too large',
    );
    expect(scored['index-age-24h'].pass).toBe(false);
    expect(scored['index-age-24h'].detail).toContain(
      'probeSymbol missing (cap or skip)',
    );
  });

  it('stops the scenario host and rethrows when a scenario throws', async () => {
    const root = await corpusCopy();
    const session = fakeSession(root, () => {
      throw new Error('guard tripped');
    });
    const deps = fakeDeps({ launch: async () => session });
    await expect(
      runCopyScenarios(root, deps, { smoke: true, probe, tag: 't3' }),
    ).rejects.toThrow('guard tripped');
    expect(session.stops).toBe(1);
  });

  it('lets a guard error from the cleanup stop win over the scenario error, so the run is voided', async () => {
    const root = await corpusCopy();
    const guard = new BenchHeldRealStateError([
      { pid: 7, name: 'node.exe', path: 'C:/Users/u/.ptah/state/ptah.sqlite' },
    ]);
    const session = fakeSession(root, () => {
      throw new Error('scenario broke');
    });
    session.stop = async () => {
      session.stops += 1;
      throw guard;
    };
    const deps = fakeDeps({ launch: async () => session });
    const rejection = runCopyScenarios(root, deps, {
      smoke: true,
      probe,
      tag: 't4',
    });
    await expect(rejection).rejects.toBe(guard);
    expect(guard.cause).toEqual(new Error('scenario broke'));
    expect(guard.message).toContain(
      'raised while stopping the host after: scenario broke',
    );
    expect(session.stops).toBe(1);
  });
});

describe('runSessionScenarios', () => {
  const memory = buildMemoryQuestionSet();
  const rows = memory.facts.flatMap((fact) =>
    fact.rows.map((row) => ({ ...row, root: fact.root })),
  );

  function memoryAnswer(
    root: string,
    query: string,
    roots: { rootA: string; rootB: string; worktreeOfA: string },
    leak: boolean,
  ): string {
    const scope =
      root === roots.rootB ? 'B' : root === roots.rootA ? 'A' : 'none';
    const question = memory.questions.find((item) => item.query === query);
    const truth = rows.filter(
      (row) =>
        question?.expectedFactIds.includes(row.id) &&
        (row.root === scope || (leak && row.root !== scope)),
    );
    const other = leak
      ? rows.filter((row) => row.root !== scope).slice(0, 1)
      : [];
    return JSON.stringify({
      hits: [...truth, ...other].map((row) => ({
        memoryId: row.id,
        subject: null,
        content: row.content,
        chunkText: row.content,
        score: 1,
        tier: 'core',
      })),
      bm25Only: false,
      scope: 'workspace',
    });
  }

  it('records scenario 9 and the worktree checks as failures when the task tools ignore workspaceRoot (today)', async () => {
    const roots = {
      rootA: join(scratch, 'A'),
      rootB: join(scratch, 'B'),
      worktreeOfA: join(scratch, 'A-wt'),
    };
    let calls = 0;
    const handler: Handler = async (root, tool, args) => {
      if (tool === 'ptah_memory_search') {
        if (args['global'] === true)
          return result(
            `${'x'.repeat(100)}\n[reduced: none — partial, cut mid-line — full output: ${join(scratch, 'copy', '.ptah', 'tmp', 'spool.txt')}]`,
          );
        return result(memoryAnswer(root, String(args['query']), roots, false));
      }
      if (tool === 'ptah_code_search_symbols')
        return result(
          searchAnswer([{ filePath: 'libs/a/probe.ts', name: 'probeSymbol' }]),
        );
      if (tool === 'ptah_task_create') {
        // Today: the argument is stripped and the task lands in the URL root.
        await mkdir(join(root, '.ptah', 'specs', `TASK_${(calls += 1)}`), {
          recursive: true,
        });
        return result('{"ok":true}');
      }
      return calls === -1
        ? result('')
        : {
            kind: 'transport-error',
            code: 'ECONNRESET',
            detail: 'socket hang up',
            wallMs: 1,
          };
    };
    const session = fakeSession(join(scratch, 'copy'), handler);
    const deps = fakeDeps();

    const results = byScenario(
      await runSessionScenarios(session, deps, {
        smoke: true,
        probe,
        tag: 's1',
        memoryRoots: roots,
        scratchDir: join(scratch, 'scenario9'),
      }),
    );

    expect(results['two-workspaces-memory-leak']).toMatchObject({ pass: true });
    expect(results['worktree-memory-scope'].pass).toBe(false);
    expect(results['worktree-spool-path'].pass).toBe(false);
    expect(results['worktree-spool-path'].detail).toContain(
      "under the caller's root",
    );
    expect(results['worktree-spool-path'].detail).toContain(': false');
    expect(results['two-workspaces-symbol-scope'].pass).toBe(false);
    expect(results['transport-idle-gaps']).toMatchObject({ pass: false });
    expect(results['transport-idle-gaps'].detail).toContain('ECONNRESET 40');
    expect(results['worktree-task-tools'].pass).toBe(false);
    expect(results['worktree-task-tools'].detail).toContain(
      'task folder under the worktree: none',
    );
    expect(results['worktree-task-tools'].detail).toContain('accepted');
    expect(deps.clock.now).toBeGreaterThanOrEqual(39 * 4_000);
  });

  it('passes scenario 7, 8 and 9 against tools that keep each root apart', async () => {
    const roots = {
      rootA: join(scratch, 'A'),
      rootB: join(scratch, 'B'),
      worktreeOfA: join(scratch, 'A-wt'),
    };
    const worktree = join(scratch, 'scenario9', 'task-worktree');
    const handler: Handler = async (root, tool, args) => {
      if (tool === 'ptah_memory_search') {
        if (args['global'] === true)
          return result(
            `${'x'.repeat(100)}\n[reduced: none — partial, cut mid-line — full output: ${join(root, '.ptah', 'tmp', 'spool.txt')}]`,
          );
        return result(
          memoryAnswer(
            root === roots.worktreeOfA ? roots.rootA : root,
            String(args['query']),
            roots,
            false,
          ),
        );
      }
      if (tool === 'ptah_code_search_symbols') return result(searchAnswer([]));
      if (tool === 'ptah_task_create') {
        if (args['workspaceRoot'] !== worktree)
          return result(
            '{"ok":false,"error":"WORKSPACE_ROOT_NOT_IN_REPOSITORY"}',
          );
        await mkdir(join(worktree, '.ptah', 'specs', 'TASK_1'), {
          recursive: true,
        });
        return result('{"ok":true}');
      }
      return result('## File Search\n\nFound: 1 file\n\n1. package.json\n');
    };
    const session = fakeSession(join(scratch, 'copy'), handler);

    const results = await runSessionScenarios(session, fakeDeps(), {
      smoke: true,
      probe,
      tag: 's2',
      memoryRoots: roots,
      scratchDir: join(scratch, 'scenario9'),
    });

    expect(results.filter((item) => !item.pass)).toEqual([]);
  });
});

describe('unscoredScenarios', () => {
  it('fails every expected case that was not scored, with the reason', () => {
    const rows = unscoredScenarios(
      COPY_SCENARIOS,
      [
        {
          scenario: 'cold-start',
          tool: 'ptah_code_search_symbols',
          pass: false,
          detail: 'x',
        },
      ],
      'host lifecycle failed to start',
    );
    expect(rows).toHaveLength(COPY_SCENARIOS.length - 1);
    expect(
      rows.every(
        (row) =>
          !row.pass && row.detail === 'not run: host lifecycle failed to start',
      ),
    ).toBe(true);
    expect(rows.map((row) => row.scenario)).not.toContain('cold-start');
  });
  it('marks the seeded-memory scenarios na (not failed) when the host has no seeding hook, and runs the rest', async () => {
    const roots = {
      rootA: join(scratch, 'A'),
      rootB: join(scratch, 'B'),
      worktreeOfA: join(scratch, 'A-wt'),
    };
    const memoryCalls: string[] = [];
    const handler: Handler = async (root, tool) => {
      if (tool === 'ptah_memory_search') memoryCalls.push(root);
      if (tool === 'ptah_search_files') return result('{"files":[]}');
      if (tool === 'ptah_code_search_symbols')
        return result('{"hits":[],"index":{"symbolCount":5}}');
      return result('{"ok":true}');
    };
    const results = byScenario(
      await runSessionScenarios(
        fakeSession(join(scratch, 'copy'), handler),
        fakeDeps(),
        {
          smoke: true,
          probe,
          tag: 's3',
          memoryRoots: roots,
          memoryNaReason: 'no seeding hook',
          scratchDir: join(scratch, 'scenario9'),
        },
      ),
    );
    for (const name of [
      'two-workspaces-memory-leak',
      'worktree-memory-scope',
      'worktree-spool-path',
    ])
      expect(results[name]).toMatchObject({
        pass: false,
        na: 'no seeding hook',
      });
    expect(memoryCalls).toEqual([]);
    expect(results['transport-idle-gaps'].na).toBeUndefined();
    expect(results['two-workspaces-symbol-scope'].na).toBeUndefined();
    expect(results['worktree-task-tools'].na).toBeUndefined();
  });
});

describe('naScenarios and coverageOf', () => {
  it('naScenarios builds one na row per expected case with the reason', () => {
    const rows = naScenarios(
      [{ scenario: 'a', tool: 't' }],
      'attach mode never writes to a user DB',
    );
    expect(rows).toEqual([
      {
        scenario: 'a',
        tool: 't',
        pass: false,
        detail: '',
        na: 'attach mode never writes to a user DB',
      },
    ]);
  });

  it('coverageOf quotes the balanced coverage block, or says it is absent', () => {
    expect(
      coverageOf(
        '{"hits":[],"coverage":{"clean":true,"census":"complete","by":{"x":1}},"index":{}}',
      ),
    ).toBe('{"clean":true,"census":"complete","by":{"x":1}}');
    expect(coverageOf('{"hits":[]}')).toBe('none in the answer');
  });
});
