import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  astBaseline,
  definitionsBaseline,
  dependentsBaseline,
  globBaseline,
  memoryBaseline,
  referencesBaseline,
  relevanceBaseline,
  relevanceGitLogBaseline,
  symbolsConceptBaseline,
  symbolsExactBaseline,
  textLiteralBaseline,
  textRegexBaseline,
  type NativeContext,
} from './native-baselines';
import {
  assertRgRuns,
  createRgRunner,
  parseRgJsonMatchLines,
  resolveRg,
  type RgRunner,
} from './rg-runner';

let root = '';
const hasRg = hasUsableRg();
/**
 * The live-rg cases skip on a developer machine without ripgrep. Under
 * `CI=true` a missing rg is a CI setup defect (ci.yml test-shard and
 * mcp-bench.yml install it), so
 * the cases fail instead: a silent skip hid two defects in Batch 8.
 */
const itWithRg: jest.It = hasRg
  ? it
  : process.env['CI'] === 'true'
    ? (((name: string) =>
        it(name, () => {
          throw new Error(
            'CI=true but no usable ripgrep was found: set RG_PATH or install rg (apt install ripgrep)',
          );
        })) as unknown as jest.It)
    : it.skip;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'mcp-native-baseline-'));
  await mkdir(path.join(root, 'libs'), { recursive: true });
  await mkdir(path.join(root, 'apps'), { recursive: true });
  await mkdir(path.join(root, '.ptah', 'specs'), { recursive: true });
  await writeFile(
    path.join(root, 'libs', 'alpha.ts'),
    'export class AgentPanel {}\nclass Definitions {\n  public async sendVerificationEmail(): Promise<void> {}\n  private readonly injectable = async () => {};\n}\nexport const arrowDefinition = () => {};\nexport interface FixtureContract {\n  contractMethod(): void;\n}\nconst message = "message";\nmessage;\n',
  );
  await writeFile(
    path.join(root, 'apps', 'consumer.ts'),
    "import { AgentPanel } from '../libs/alpha';\nconst load = () => import('../libs/alpha');\n",
  );
  await writeFile(
    path.join(root, 'libs', 'colon.ts'),
    "const t = '10:30:45';\n",
  );
  await writeFile(
    path.join(root, '.ptah', 'specs', 'x.md'),
    'seeded benchmark memory fact\n',
  );
  await writeFile(
    path.join(root, 'apps', 'relevance.md'),
    'seeded benchmark relevance fixture\n',
  );
  await mkdir(path.join(root, 'tools', 'mcp-bench', 'questions'), {
    recursive: true,
  });
  await writeFile(
    path.join(root, 'tools', 'mcp-bench', 'questions', 'query-leak.txt'),
    'message\n',
  );
  if (hasRg) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'bench@example.test'], {
      cwd: root,
    });
    execFileSync('git', ['config', 'user.name', 'Benchmark'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'seeded benchmark memory'], {
      cwd: root,
    });
    await writeFile(
      path.join(root, '.git', 'query-leak.txt'),
      'seeded benchmark memory fact\n',
    );
  }
});

afterAll(async () => rm(root, { recursive: true, force: true }));

describe('rg runner', () => {
  it('uses RG_PATH before PATH lookup and reports a clear resolution error', () => {
    expect(
      resolveRg({
        env: { RG_PATH: 'C:/tools/rg.exe' },
        lookup: () => 'ignored',
      }),
    ).toBe('C:/tools/rg.exe');
    expect(
      resolveRg({
        env: {},
        lookup: () => '/usr/bin/rg',
        platform: 'linux',
      }),
    ).toBe('/usr/bin/rg');
    expect(() => resolveRg({ env: {}, lookup: () => undefined })).toThrow(
      'RG_PATH',
    );
  });

  it('selects a Windows executable among where shim lines', () => {
    expect(
      resolveRg({
        env: {},
        lookup: () => ['C:/tools/rg', 'C:/tools/rg.EXE', 'C:/other/rg.exe'],
        platform: 'win32',
      }),
    ).toBe('C:/tools/rg.EXE');
    expect(() =>
      resolveRg({
        env: {},
        lookup: () => ['C:/tools/rg.cmd', 'C:/tools/rg'],
        platform: 'win32',
      }),
    ).toThrow('RG_PATH');
  });

  it('keeps RG_PATH ahead of Windows lookup and reports preflight failures clearly', async () => {
    expect(
      resolveRg({
        env: { RG_PATH: 'C:/custom/rg.cmd' },
        lookup: () => ['C:/tools/rg.exe'],
        platform: 'win32',
      }),
    ).toBe('C:/custom/rg.cmd');
    expect(resolveRg({ env: { RG_PATH: '"C:/custom/rg.exe"' } })).toBe(
      'C:/custom/rg.exe',
    );
    await expect(
      assertRgRuns('C:/tools/rg.exe', async () => {
        throw new Error('spawn ENOENT');
      }),
    ).rejects.toThrow('C:/tools/rg.exe');
    await expect(
      assertRgRuns('C:/tools/rg.exe', async () => {
        throw new Error('spawn ENOENT');
      }),
    ).rejects.toThrow('RG_PATH');
  });

  it('preserves the real spawn failure as the preflight cause', async () => {
    const executable = path.join(root, 'missing-rg-executable');
    await expect(assertRgRuns(executable)).rejects.toMatchObject({
      message: expect.stringContaining('ENOENT'),
      cause: expect.objectContaining({ code: 'ENOENT' }),
    });
  });

  it('parses JSON match records with Windows paths', () => {
    const stdout = JSON.stringify({
      type: 'match',
      data: { path: { text: 'C:\\repo\\libs\\a.ts' }, line_number: 7 },
    });
    expect(parseRgJsonMatchLines(stdout, 'C:\\repo')).toEqual(['libs/a.ts:7']);
  });

  itWithRg(
    'treats ripgrep exit code 1 as an empty result (skipped when live rg is unavailable)',
    async () => {
      const result = await createRgRunner()(['-n', 'absent-token'], {
        cwd: root,
        timeoutMs: 5_000,
      });
      expect(result).toMatchObject({ exitCode: 1, stdout: '' });
    },
    15_000,
  );

  itWithRg(
    'includes stderr when ripgrep exits with an error (skipped when live rg is unavailable)',
    async () => {
      await expect(
        createRgRunner()(['--definitely-not-an-rg-option'], {
          cwd: root,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow(/ripgrep exited with code 2: .+/u);
    },
    15_000,
  );
});

describe('native baselines', () => {
  it('uses gitRoot for the independent git-log relevance view', async () => {
    let gitCwd = '';
    const result = await relevanceGitLogBaseline(
      { query: 'seeded' },
      {
        corpusRoot: 'C:/corpus',
        gitRoot: 'C:/repository',
        rg: async () => ({
          stdout: '',
          exitCode: 1,
          latencyMs: 1,
          commandLine: 'rg',
        }),
        git: async (_args, options) => {
          gitCwd = options.cwd;
          return {
            stdout: '__MCP_COMMIT__abc\napps/changed.ts\n',
            exitCode: 0,
            latencyMs: 1,
            commandLine: 'git',
          };
        },
      },
    );
    expect(gitCwd).toBe('C:/repository');
    expect(result).toMatchObject({
      view: 'git-log',
      commands: 1,
      answer: { ranked: ['apps/changed.ts'] },
    });
  });

  it('returns an answer and command count for every suite without requiring rg', async () => {
    const rg: RgRunner = async (args) => {
      const query =
        args[args.length - 1] === '.'
          ? (args[args.length - 2] ?? '')
          : (args[args.length - 1] ?? '');
      const stdout = args.includes('-l')
        ? args.includes('libs')
          ? 'apps/consumer.ts\n'
          : query === '.ptah/specs'
            ? '.ptah/specs/x.md\n'
            : 'libs/alpha.ts\n'
        : query.includes('AgentPanel')
          ? 'libs/alpha.ts:1:export class AgentPanel {}\n'
          : 'libs/alpha.ts:2:const message = "message";\nlibs/alpha.ts:3:message;\n';
      return { stdout, exitCode: 0, latencyMs: 1, commandLine: 'rg' };
    };
    const git = async () => ({
      stdout: 'libs/alpha.ts\n',
      exitCode: 0,
      latencyMs: 1,
      commandLine: 'git',
    });
    const ctx: NativeContext = { corpusRoot: root, rg, git };
    await expect(
      symbolsExactBaseline({ query: 'AgentPanel' }, ctx),
    ).resolves.toMatchObject({
      commands: 1,
      answer: { ranked: ['libs/alpha.ts:1'] },
    });
    await expect(
      symbolsConceptBaseline({ query: 'AgentPanel messaging component' }, ctx),
    ).resolves.toMatchObject({ commands: 3 });
    await expect(
      referencesBaseline({ query: 'message' }, ctx),
    ).resolves.toMatchObject({
      commands: 1,
      answer: { ranked: ['libs/alpha.ts:2', 'libs/alpha.ts:3'] },
    });
    await expect(
      definitionsBaseline({ file: 'libs/alpha.ts', query: 'AgentPanel' }, ctx),
    ).resolves.toMatchObject({ commands: 1 });
    await expect(
      dependentsBaseline({ file: 'libs/alpha.ts' }, ctx),
    ).resolves.toMatchObject({
      commands: 2,
      answer: { ranked: ['apps/consumer.ts'] },
    });
    await expect(
      relevanceBaseline({ query: 'seeded benchmark' }, ctx),
    ).resolves.toMatchObject({ commands: 2 });
    await expect(
      relevanceGitLogBaseline({ query: 'seeded benchmark' }, ctx),
    ).resolves.toMatchObject({ view: 'git-log', commands: 2 });
    await expect(
      astBaseline({ file: 'libs/alpha.ts' }, ctx),
    ).resolves.toMatchObject({ commands: 1 });
    await expect(
      globBaseline({ pattern: 'libs/*.ts' }, ctx),
    ).resolves.toMatchObject({ commands: 1 });
    await expect(
      textLiteralBaseline({ query: 'message' }, ctx),
    ).resolves.toMatchObject({ commands: 1 });
    await expect(
      textRegexBaseline({ query: 'mess.ge' }, ctx),
    ).resolves.toMatchObject({ commands: 1 });
    await expect(
      memoryBaseline({ query: 'seeded benchmark' }, ctx),
    ).resolves.toMatchObject({ view: 'comparison', commands: 4 });
  });

  itWithRg(
    'covers each suite and does not shell-expand queries (skipped when live rg is unavailable)',
    async () => {
      const ctx: NativeContext = { corpusRoot: root, rg: createRgRunner() };
      await expect(
        symbolsExactBaseline({ query: 'AgentPanel' }, ctx),
      ).resolves.toMatchObject({
        commands: 1,
        answer: { ranked: ['libs/alpha.ts:1'] },
      });
      await expect(
        symbolsConceptBaseline(
          { query: 'AgentPanel messaging component' },
          ctx,
        ),
      ).resolves.toMatchObject({
        commands: 3,
        answer: { ranked: ['apps/consumer.ts', 'libs/alpha.ts'] },
      });
      const references = await referencesBaseline({ query: 'message' }, ctx);
      expect(references.answer.ranked).toEqual([
        'libs/alpha.ts:10',
        'libs/alpha.ts:11',
      ]);
      expect(references.commands).toBe(1);
      await expect(
        definitionsBaseline(
          { file: 'libs/alpha.ts', query: 'sendVerificationEmail' },
          ctx,
        ),
      ).resolves.toMatchObject({
        commands: 1,
        answer: { ranked: ['libs/alpha.ts:3'] },
      });
      await expect(
        definitionsBaseline(
          { file: 'libs/alpha.ts', query: 'arrowDefinition' },
          ctx,
        ),
      ).resolves.toMatchObject({ answer: { ranked: ['libs/alpha.ts:6'] } });
      await expect(
        definitionsBaseline(
          { file: 'libs/alpha.ts', query: 'contractMethod' },
          ctx,
        ),
      ).resolves.toMatchObject({ answer: { ranked: ['libs/alpha.ts:8'] } });
      await expect(
        dependentsBaseline({ file: 'libs/alpha.ts' }, ctx),
      ).resolves.toMatchObject({
        commands: 2,
        answer: { ranked: ['apps/consumer.ts'] },
      });
      await expect(
        relevanceBaseline({ query: 'seeded benchmark' }, ctx),
      ).resolves.toMatchObject({
        commands: 2,
        answer: { ranked: ['.ptah/specs/x.md', 'apps/relevance.md'] },
      });
      await expect(
        relevanceGitLogBaseline({ query: 'seeded benchmark' }, ctx),
      ).resolves.toMatchObject({ view: 'git-log', commands: 2 });
      await expect(
        astBaseline({ file: 'libs/alpha.ts' }, ctx),
      ).resolves.toMatchObject({
        commands: 1,
        answer: {
          ranked: [
            'export class AgentPanel {}\nclass Definitions {\n  public async sendVerificationEmail(): Promise<void> {}\n  private readonly injectable = async () => {};\n}\nexport const arrowDefinition = () => {};\nexport interface FixtureContract {\n  contractMethod(): void;\n}\nconst message = "message";\nmessage;\n',
          ],
        },
      });
      await expect(
        globBaseline({ pattern: 'libs/*.ts' }, ctx),
      ).resolves.toMatchObject({
        commands: 1,
        answer: { ranked: ['libs/alpha.ts', 'libs/colon.ts'] },
      });
      await expect(
        textLiteralBaseline({ query: 'seeded benchmark memory fact' }, ctx),
      ).resolves.toMatchObject({
        answer: { ranked: ['.ptah/specs/x.md:1'] },
      });
      await expect(
        textLiteralBaseline({ query: '10:30:45' }, ctx),
      ).resolves.toMatchObject({ answer: { ranked: ['libs/colon.ts:1'] } });
      await expect(
        textLiteralBaseline({ query: 'message' }, ctx),
      ).resolves.toMatchObject({
        commands: 1,
        answer: { ranked: ['libs/alpha.ts:10', 'libs/alpha.ts:11'] },
      });
      await expect(
        textRegexBaseline({ query: 'mess.ge' }, ctx),
      ).resolves.toMatchObject({
        commands: 1,
        answer: { ranked: ['libs/alpha.ts:10', 'libs/alpha.ts:11'] },
      });
      await expect(
        memoryBaseline({ query: 'seeded benchmark' }, ctx),
      ).resolves.toMatchObject({
        view: 'comparison',
        commands: 4,
        answer: { ranked: ['.ptah/specs/x.md'] },
      });

      const args: string[][] = [];
      const safeRunner: RgRunner = async (received) => {
        args.push([...received]);
        return { stdout: '', exitCode: 1, latencyMs: 1, commandLine: 'rg' };
      };
      await textLiteralBaseline(
        { query: '$(rm -rf x); "' },
        { corpusRoot: root, rg: safeRunner },
      );
      expect(args[0]).toEqual([
        '--hidden',
        '--glob',
        '!.git',
        '--glob',
        '!tools/mcp-bench/questions/**',
        '--glob',
        '!**/node_modules/**',
        '-n',
        '-F',
        '--',
        '$(rm -rf x); "',
        '.',
      ]);
    },
    15_000,
  );

  it('propagates a failed first dependent search instead of returning a partial answer', async () => {
    let calls = 0;
    const result = await dependentsBaseline(
      { file: 'libs/alpha.ts' },
      {
        corpusRoot: root,
        rg: async () => {
          calls += 1;
          if (calls === 1) throw new Error('first search failed');
          return {
            stdout: 'apps/consumer.ts\n',
            exitCode: 0,
            latencyMs: 1,
            commandLine: 'rg',
          };
        },
      },
    );
    expect(result.error).toContain('first search failed');
    expect(result.answer.ranked).toEqual([]);
    expect(result.commands).toBe(1);
  });
});

function resolveOrUndefined(): string | undefined {
  try {
    return resolveRg();
  } catch {
    return undefined;
  }
}

function hasUsableRg(): boolean {
  const executable = resolveOrUndefined();
  if (!executable) return false;
  try {
    execFileSync(executable, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
