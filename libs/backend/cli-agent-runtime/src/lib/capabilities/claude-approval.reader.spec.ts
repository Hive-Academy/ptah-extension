import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CLAUDE_APPROVAL_GIT_TIMEOUT_MS,
  ClaudeApprovalReader,
  createGitRunner,
  type GitRunResult,
  type GitRunner,
} from './claude-approval.reader';

/**
 * Every case uses a temp `homeDir` and a temp workspace root. The reader
 * defaults to `os.homedir()`, so a spec that omitted the option would read the
 * developer's real `~/.claude.json`.
 */

/** A git runner that answers from a table keyed by the git subcommand. */
function scriptedGit(
  answers: Partial<Record<string, GitRunResult>>,
): GitRunner & jest.Mock {
  return jest.fn(async (_cwd: string, args: readonly string[]) => {
    const answer = answers[args[0]];
    if (answer === undefined) throw new Error(`unexpected git ${args[0]}`);
    return answer;
  });
}

const exited = (code: number, stdout = ''): GitRunResult => ({
  outcome: 'exited',
  code,
  stdout,
});

/** Inside a work tree, untracked, ignored. */
const TRUSTING_GIT = {
  'rev-parse': exited(0, 'true\n'),
  'ls-files': exited(0, ''),
  'check-ignore': exited(0),
};

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('ClaudeApprovalReader', () => {
  let homeDir: string;
  let root: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-approval-home-'));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-approval-root-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const claudeJsonPath = (): string => path.join(homeDir, '.claude.json');
  const settingsLocalPath = (): string =>
    path.join(root, '.claude', 'settings.local.json');

  const writeClaudeJson = (value: unknown): void => {
    fs.writeFileSync(claudeJsonPath(), JSON.stringify(value));
  };
  const writeSettingsLocal = (content: string): void => {
    fs.mkdirSync(path.dirname(settingsLocalPath()), { recursive: true });
    fs.writeFileSync(settingsLocalPath(), content);
  };

  describe('~/.claude.json', () => {
    it('reports ok with no approvals when the file is missing', async () => {
      const reader = new ClaudeApprovalReader({ homeDir, runGit: scriptedGit({}) });
      await expect(reader.read(root)).resolves.toEqual({
        status: 'ok',
        approvals: [],
        reasons: [],
      });
    });

    it('reads the project entry for the root', async () => {
      writeClaudeJson({
        projects: {
          [root]: {
            enableAllProjectMcpServers: true,
            enabledMcpjsonServers: ['sentry'],
            disabledMcpjsonServers: ['sonarqube'],
          },
          '/some/other/project': { enabledMcpjsonServers: ['elsewhere'] },
        },
      });
      const reader = new ClaudeApprovalReader({ homeDir, runGit: scriptedGit({}) });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'ok',
        approvals: [
          {
            path: claudeJsonPath(),
            kind: 'claude-project',
            enableAllProjectMcpServers: true,
            enabledMcpjsonServers: ['sentry'],
            disabledMcpjsonServers: ['sonarqube'],
          },
        ],
        reasons: [],
      });
    });

    it('merges every entry that folds to the root when case folds', async () => {
      writeClaudeJson({
        projects: {
          'D:/projects/repo': { enabledMcpjsonServers: ['a'] },
          'd:\\projects\\repo\\': { disabledMcpjsonServers: ['b'] },
        },
      });
      const reader = new ClaudeApprovalReader({
        homeDir,
        caseInsensitive: true,
        runGit: scriptedGit({}),
      });

      const result = await reader.read('D:\\Projects\\Repo');
      expect(result.status).toBe('ok');
      expect(result.approvals).toEqual([
        {
          path: claudeJsonPath(),
          kind: 'claude-project',
          enabledMcpjsonServers: ['a'],
          disabledMcpjsonServers: ['b'],
        },
      ]);
    });

    it('does not fold case on a case-sensitive filesystem', async () => {
      writeClaudeJson({
        projects: { '/a/Repo': { enabledMcpjsonServers: ['a'] } },
      });
      const reader = new ClaudeApprovalReader({
        homeDir,
        caseInsensitive: false,
        runGit: scriptedGit({}),
      });

      await expect(reader.read('/a/repo')).resolves.toMatchObject({
        status: 'ok',
        approvals: [],
      });
    });

    it.each([
      ['unparseable JSON', '{"projects":', 'invalid JSON'],
      ['a non-object document', '[]', 'not a JSON object'],
      ['a non-object projects map', '{"projects":[]}', 'invalid projects map'],
    ])('reports %s as an error and no approvals', async (_label, content, error) => {
      fs.writeFileSync(claudeJsonPath(), content);
      const reader = new ClaudeApprovalReader({ homeDir, runGit: scriptedGit({}) });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'error',
        approvals: [],
        reasons: [{ path: claudeJsonPath(), error }],
      });
    });
  });

  describe('.claude/settings.local.json', () => {
    const LOCAL = JSON.stringify({ enabledMcpjsonServers: ['local-server'] });

    it('does not ask git when the file does not exist', async () => {
      const runGit = scriptedGit({});
      const reader = new ClaudeApprovalReader({ homeDir, runGit });

      await expect(reader.read(root)).resolves.toMatchObject({ status: 'ok' });
      expect(runGit).not.toHaveBeenCalled();
    });

    it('reads the file when git reports it untracked and ignored', async () => {
      writeSettingsLocal(LOCAL);
      const runGit = scriptedGit(TRUSTING_GIT);
      const reader = new ClaudeApprovalReader({ homeDir, runGit });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'ok',
        approvals: [
          {
            path: settingsLocalPath(),
            kind: 'settings-local',
            enabledMcpjsonServers: ['local-server'],
          },
        ],
        reasons: [],
      });
      // Argument arrays with the path after `--`, never a shell string.
      expect(runGit.mock.calls).toEqual([
        [root, ['rev-parse', '--is-inside-work-tree']],
        [root, ['ls-files', '-z', '--', '.claude/settings.local.json']],
        [root, ['check-ignore', '-q', '--', '.claude/settings.local.json']],
      ]);
    });

    it('skips a tracked file', async () => {
      writeSettingsLocal(LOCAL);
      const runGit = scriptedGit({
        ...TRUSTING_GIT,
        'ls-files': exited(0, '.claude/settings.local.json\0'),
      });
      const reader = new ClaudeApprovalReader({ homeDir, runGit });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'ok',
        approvals: [],
        reasons: [],
      });
    });

    it('skips a file git does not ignore (check-ignore exits 1)', async () => {
      writeSettingsLocal(LOCAL);
      const reader = new ClaudeApprovalReader({
        homeDir,
        runGit: scriptedGit({ ...TRUSTING_GIT, 'check-ignore': exited(1) }),
      });

      await expect(reader.read(root)).resolves.toMatchObject({
        status: 'ok',
        approvals: [],
      });
    });

    it('skips the file outside a git work tree (rev-parse exits 128)', async () => {
      writeSettingsLocal(LOCAL);
      const runGit = scriptedGit({ 'rev-parse': exited(128) });
      const reader = new ClaudeApprovalReader({ homeDir, runGit });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'ok',
        approvals: [],
        reasons: [],
      });
      expect(runGit).toHaveBeenCalledTimes(1);
    });

    it('skips the file when git is not installed', async () => {
      writeSettingsLocal(LOCAL);
      const reader = new ClaudeApprovalReader({
        homeDir,
        runGit: scriptedGit({ 'rev-parse': { outcome: 'not-installed' } }),
      });

      await expect(reader.read(root)).resolves.toMatchObject({
        status: 'ok',
        approvals: [],
      });
    });

    it('reports a git timeout as an error and publishes nothing', async () => {
      writeSettingsLocal(LOCAL);
      writeClaudeJson({ projects: { [root]: { enabledMcpjsonServers: ['a'] } } });
      const reader = new ClaudeApprovalReader({
        homeDir,
        runGit: scriptedGit({
          ...TRUSTING_GIT,
          'ls-files': { outcome: 'failed', reason: 'git timed out' },
        }),
      });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'error',
        approvals: [],
        reasons: [{ path: settingsLocalPath(), error: 'git timed out' }],
      });
    });

    it('reports an exit code git does not use for the answer as an error', async () => {
      writeSettingsLocal(LOCAL);
      const reader = new ClaudeApprovalReader({
        homeDir,
        runGit: scriptedGit({ ...TRUSTING_GIT, 'check-ignore': exited(128) }),
      });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'error',
        approvals: [],
        reasons: [
          { path: settingsLocalPath(), error: 'git check-ignore exited 128' },
        ],
      });
    });

    it('reports an unparseable trusted file as an error', async () => {
      writeSettingsLocal('{"enabledMcpjsonServers":');
      const reader = new ClaudeApprovalReader({
        homeDir,
        runGit: scriptedGit(TRUSTING_GIT),
      });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'error',
        approvals: [],
        reasons: [{ path: settingsLocalPath(), error: 'invalid JSON' }],
      });
    });

    it('never throws, even when the git runner itself throws', async () => {
      writeSettingsLocal(LOCAL);
      const runGit: GitRunner = async () => {
        throw new TypeError('boom');
      };
      const reader = new ClaudeApprovalReader({ homeDir, runGit });

      await expect(reader.read(root)).resolves.toEqual({
        status: 'error',
        approvals: [],
        reasons: [{ path: root, error: 'TypeError' }],
      });
    });
  });

  describe('createGitRunner', () => {
    it('uses a 2 s timeout by default', () => {
      expect(CLAUDE_APPROVAL_GIT_TIMEOUT_MS).toBe(2_000);
    });

    // Integration against the real git binary, where one is installed.
    (gitAvailable() ? describe : describe.skip)('with a real git', () => {
      const git = (cwd: string, ...args: string[]): void => {
        execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });
      };

      beforeEach(() => {
        git(root, 'init', '-q');
        fs.writeFileSync(
          path.join(root, '.gitignore'),
          '.claude/settings.local.json\n',
        );
        writeSettingsLocal(JSON.stringify({ disabledMcpjsonServers: ['x'] }));
      });

      it('trusts an untracked, ignored file', async () => {
        const reader = new ClaudeApprovalReader({
          homeDir,
          runGit: createGitRunner(),
        });
        const result = await reader.read(root);
        expect(result).toMatchObject({
          status: 'ok',
          approvals: [{ kind: 'settings-local', disabledMcpjsonServers: ['x'] }],
        });
      });

      it('does not trust a tracked file, even when it is ignored', async () => {
        git(root, 'add', '-f', '.claude/settings.local.json');
        const reader = new ClaudeApprovalReader({
          homeDir,
          runGit: createGitRunner(),
        });
        await expect(reader.read(root)).resolves.toEqual({
          status: 'ok',
          approvals: [],
          reasons: [],
        });
      });

      it('answers rev-parse with an exit code outside a work tree', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
        try {
          const result = await createGitRunner()(outside, [
            'rev-parse',
            '--is-inside-work-tree',
          ]);
          // 128 outside any repository; 0 only if the temp dir sits inside one.
          expect(result.outcome).toBe('exited');
        } finally {
          fs.rmSync(outside, { recursive: true, force: true });
        }
      });
    });
  });
});
