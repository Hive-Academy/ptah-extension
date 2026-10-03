/**
 * The read-only user MCP server name reader for Codex lanes (TASK_2026_597,
 * component 1). Every case runs against a scratch `codexHome` and workspace,
 * never the developer's own `~/.codex`.
 */

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readCodexUserMcpServerNames } from './codex-user-mcp-servers';

describe('readCodexUserMcpServerNames', () => {
  let root: string;
  let codexHome: string;
  let workspace: string;

  beforeEach(() => {
    // Real path: the reader canonicalises, so trust keys written by the spec
    // must name the real directory even when the temp dir is itself a link.
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'codex-user-mcp-')));
    codexHome = join(root, 'codex-home');
    workspace = join(root, 'ws');
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(join(workspace, '.codex'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeHome(content: string): void {
    writeFileSync(join(codexHome, 'config.toml'), content, 'utf-8');
  }

  function writeWorkspace(content: string): void {
    writeFileSync(join(workspace, '.codex', 'config.toml'), content, 'utf-8');
  }

  function trustRecord(): string {
    return `[projects.'${workspace}']\ntrust_level = "trusted"\n`;
  }

  it('reads the home config only when the workspace has no config', async () => {
    writeHome(
      [
        '[mcp_servers.github]',
        'command = "npx"',
        '',
        '[mcp_servers.github.env]',
        'TOKEN = "x"',
        '',
        '[mcp_servers.ptah]',
        'url = "http://localhost:1"',
        '',
        '[mcp_servers."my server"]',
        'command = "node"',
        '',
      ].join('\r\n'),
    );

    const result = await readCodexUserMcpServerNames(workspace, { codexHome });

    expect(result).toEqual({ names: ['github', 'my server'], warnings: [] });
  });

  it('merges a trusted workspace config with the home one', async () => {
    writeHome(`[mcp_servers.github]\ncommand = "npx"\n\n${trustRecord()}`);
    writeWorkspace(
      '[mcp_servers.docs]\ncommand = "node"\n\n[mcp_servers.github]\ncommand = "npx"\n',
    );

    const result = await readCodexUserMcpServerNames(workspace, { codexHome });

    expect(result).toEqual({ names: ['docs', 'github'], warnings: [] });
  });

  it('ignores an untrusted workspace config, as Codex does', async () => {
    writeHome('[mcp_servers.github]\ncommand = "npx"\n');
    writeWorkspace('[mcp_servers.docs]\ncommand = "node"\n');

    const result = await readCodexUserMcpServerNames(workspace, { codexHome });

    expect(result).toEqual({ names: ['github'], warnings: [] });
  });

  it('returns nothing and no warning when no config exists', async () => {
    const result = await readCodexUserMcpServerNames('', { codexHome });
    expect(result).toEqual({ names: [], warnings: [] });
  });

  it('turns an unreadable home config into a warning, never a throw', async () => {
    // A directory where the file should be: exists, but cannot be read.
    mkdirSync(join(codexHome, 'config.toml'));

    const result = await readCodexUserMcpServerNames(workspace, { codexHome });

    expect(result.names).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining('Could not read the home Codex config'),
    ]);
  });

  it('keeps home names when the trusted workspace config is unreadable', async () => {
    writeHome(`[mcp_servers.github]\ncommand = "npx"\n\n${trustRecord()}`);
    mkdirSync(join(workspace, '.codex', 'config.toml'));

    const result = await readCodexUserMcpServerNames(workspace, { codexHome });

    expect(result.names).toEqual(['github']);
    expect(result.warnings).toEqual([
      expect.stringContaining('Could not read the workspace Codex config'),
    ]);
  });

  describe('declarations the scanner does not report (F2)', () => {
    it('warns on a header with a trailing comment, naming the line', async () => {
      writeHome(
        '[mcp_servers.docs] # added by hand\ncommand = "node"\n\n[mcp_servers.ok]\ncommand = "node"\n',
      );

      const result = await readCodexUserMcpServerNames(workspace, {
        codexHome,
      });

      // The name is never guessed: `docs` keeps loading, visibly.
      expect(result.names).toEqual(['ok']);
      expect(result.warnings).toEqual([
        expect.stringContaining('"[mcp_servers.docs] # added by hand"'),
      ]);
    });

    it('warns on odd spacing, arrays of tables, a bare table and top-level keys', async () => {
      writeHome(
        [
          'mcp_servers.inline = { command = "node" }',
          '[ mcp_servers.spaced ]',
          '[[mcp_servers.arr]]',
          '[mcp_servers]',
          'tbl = { command = "node" }',
          '[mcp_servers.good]',
          'command = "node"',
        ].join('\n'),
      );

      const result = await readCodexUserMcpServerNames(workspace, {
        codexHome,
      });

      expect(result.names).toEqual(['good']);
      expect(result.warnings).toHaveLength(4);
      for (const line of [
        'mcp_servers.inline = { command = "node" }',
        '[ mcp_servers.spaced ]',
        '[[mcp_servers.arr]]',
        '[mcp_servers]',
      ]) {
        expect(result.warnings.some((w) => w.includes(`"${line}"`))).toBe(true);
      }
    });

    it('stays silent for a clean config', async () => {
      writeHome(
        '[mcp_servers.a]\ncommand = "x"\n[mcp_servers.a.env]\nK = "v"\n',
      );
      const result = await readCodexUserMcpServerNames(workspace, {
        codexHome,
      });
      expect(result).toEqual({ names: ['a'], warnings: [] });
    });
  });

  describe('project layers and trust, as Codex 0.155.1 resolves them (F6)', () => {
    let repo: string;

    function trust(path: string): string {
      return `[projects.'${path}']\ntrust_level = "trusted"\n`;
    }

    function writeLayer(dir: string, server: string): void {
      mkdirSync(join(dir, '.codex'), { recursive: true });
      writeFileSync(
        join(dir, '.codex', 'config.toml'),
        `[mcp_servers.${server}]\ncommand = "node"\n`,
        'utf-8',
      );
    }

    beforeEach(() => {
      repo = join(root, 'repo');
      mkdirSync(join(repo, '.git'), { recursive: true });
      mkdirSync(join(repo, 'sub', 'deeper'), { recursive: true });
      writeLayer(repo, 'rootsrv');
      writeLayer(join(repo, 'sub'), 'subsrv');
      writeLayer(join(repo, 'sub', 'deeper'), 'deepsrv');
    });

    it('a trusted repo root covers every layer from the root down to the cwd', async () => {
      writeHome(trust(repo));
      const result = await readCodexUserMcpServerNames(join(repo, 'sub'), {
        codexHome,
      });
      expect(result).toEqual({ names: ['rootsrv', 'subsrv'], warnings: [] });
    });

    it('trust on a subdirectory only reads that layer, not the root or deeper ones', async () => {
      writeHome(trust(join(repo, 'sub')));
      const result = await readCodexUserMcpServerNames(
        join(repo, 'sub', 'deeper'),
        { codexHome },
      );
      expect(result).toEqual({ names: ['subsrv'], warnings: [] });
    });

    it('an untrusted repo reads no layer', async () => {
      writeHome('');
      const result = await readCodexUserMcpServerNames(join(repo, 'sub'), {
        codexHome,
      });
      expect(result).toEqual({ names: [], warnings: [] });
    });

    describe('project_root_markers (R2-1)', () => {
      it.each([
        'project_root_markers = [".codex"]',
        'project_root_markers = [".git", ".hg"]',
        'project_root_markers = []',
        'project_root_markers = [',
      ])(
        'custom %p reads no workspace layer and warns naming the setting',
        async (markers) => {
          writeHome(
            `${markers}\n\n[mcp_servers.homesrv]\ncommand = "node"\n\n${trust(repo)}`,
          );

          const result = await readCodexUserMcpServerNames(join(repo, 'sub'), {
            codexHome,
          });

          // Home servers are still read; no layer is, not even the trusted root.
          expect(result.names).toEqual(['homesrv']);
          expect(result.warnings).toEqual([
            expect.stringContaining(`project_root_markers ("${markers}")`),
          ]);
        },
      );

      it.each([
        'project_root_markers = [".git"]',
        "project_root_markers = [ '.git' ] # default",
      ])('the default %p keeps the .git layer rule', async (markers) => {
        writeHome(`${markers}\n\n${trust(repo)}`);

        const result = await readCodexUserMcpServerNames(join(repo, 'sub'), {
          codexHome,
        });

        expect(result).toEqual({ names: ['rootsrv', 'subsrv'], warnings: [] });
      });

      it('an absent setting keeps the .git layer rule', async () => {
        writeHome(trust(repo));
        const result = await readCodexUserMcpServerNames(join(repo, 'sub'), {
          codexHome,
        });
        expect(result).toEqual({ names: ['rootsrv', 'subsrv'], warnings: [] });
      });

      it('a project_root_markers key inside a table is not the top-level setting', async () => {
        writeHome(
          `${trust(repo)}\n[profiles.other]\nproject_root_markers = [".codex"]\n`,
        );
        const result = await readCodexUserMcpServerNames(join(repo, 'sub'), {
          codexHome,
        });
        expect(result).toEqual({ names: ['rootsrv', 'subsrv'], warnings: [] });
      });
    });

    describe('symlinked or junction working directories (R2-2)', () => {
      let link: string;

      beforeEach(() => {
        link = join(root, 'link');
        // 'junction' on Windows (no admin needed); a plain dir symlink elsewhere.
        symlinkSync(repo, link, 'junction');
      });

      it('a link to a trusted repo reads the real layers', async () => {
        writeHome(trust(repo));
        const result = await readCodexUserMcpServerNames(join(link, 'sub'), {
          codexHome,
        });
        expect(result).toEqual({ names: ['rootsrv', 'subsrv'], warnings: [] });
      });

      it('a trust entry naming the link does not trust the untrusted target', async () => {
        // Probe: Codex compares the canonical cwd, so a link-named key never
        // matches. Reading these layers would disable servers Codex never
        // loaded and fail the whole lane config.
        writeHome(trust(link));
        const result = await readCodexUserMcpServerNames(join(link, 'sub'), {
          codexHome,
        });
        expect(result).toEqual({ names: [], warnings: [] });
      });

      it('a working directory that cannot be resolved is untrusted, with a warning', async () => {
        writeHome(`[mcp_servers.homesrv]\ncommand = "node"\n\n${trust(root)}`);
        const result = await readCodexUserMcpServerNames(
          join(root, 'does-not-exist'),
          { codexHome },
        );
        expect(result.names).toEqual(['homesrv']);
        expect(result.warnings).toEqual([
          expect.stringContaining(
            'Could not resolve the lane working directory',
          ),
        ]);
      });
    });

    it('a git worktree is trusted through its main repository root', async () => {
      const gitDir = join(repo, '.git', 'worktrees', 'wt');
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(join(gitDir, 'commondir'), '../..\n', 'utf-8');
      const worktree = join(root, 'wt');
      mkdirSync(worktree, { recursive: true });
      writeFileSync(join(worktree, '.git'), `gitdir: ${gitDir}\n`, 'utf-8');
      writeLayer(worktree, 'wtsrv');
      writeHome(trust(repo));

      const result = await readCodexUserMcpServerNames(worktree, { codexHome });

      expect(result).toEqual({ names: ['wtsrv'], warnings: [] });
    });

    it('a .git file it cannot follow to a commondir (submodule) stays untrusted', async () => {
      const gitDir = join(repo, '.git', 'modules', 'mod');
      mkdirSync(gitDir, { recursive: true });
      const submodule = join(root, 'mod');
      mkdirSync(submodule, { recursive: true });
      writeFileSync(join(submodule, '.git'), `gitdir: ${gitDir}\n`, 'utf-8');
      writeLayer(submodule, 'modsrv');
      writeHome(trust(repo));

      const result = await readCodexUserMcpServerNames(submodule, {
        codexHome,
      });

      expect(result).toEqual({ names: [], warnings: [] });
    });

    it('outside git there is no walk-up: a trusted parent does not cover a child', async () => {
      const plain = join(root, 'plain');
      mkdirSync(join(plain, 'child'), { recursive: true });
      writeLayer(plain, 'plainsrv');
      writeLayer(join(plain, 'child'), 'childsrv');
      writeHome(trust(plain));

      const result = await readCodexUserMcpServerNames(join(plain, 'child'), {
        codexHome,
      });

      expect(result).toEqual({ names: [], warnings: [] });
    });
  });

  it('skips a quoted name it cannot read exactly, with a warning', async () => {
    // The scanner splits `"a.b"` at the dot. Disabling a name Codex did not
    // load fails the whole lane config, so the reader must not guess.
    writeHome(
      '[mcp_servers."a.b"]\ncommand = "node"\n\n[mcp_servers.ok]\ncommand = "node"\n',
    );

    const result = await readCodexUserMcpServerNames(workspace, { codexHome });

    expect(result.names).toEqual(['ok']);
    expect(result.warnings).toEqual([
      expect.stringContaining('could not be read exactly'),
    ]);
  });
});
