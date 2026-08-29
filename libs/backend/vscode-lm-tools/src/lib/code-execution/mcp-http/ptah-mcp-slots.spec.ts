/**
 * Which config files Ptah's own MCP server is declared in.
 *
 * The rules pinned here are the ones a reader would otherwise have to infer
 * from five facet definitions: which targets are workspace-scoped, which have
 * no workspace scope at all, which are gated on the CLI being installed, and
 * which are deliberately absent.
 *
 * Source-under-test: `ptah-mcp-slots.ts`.
 */

import 'reflect-metadata';

// The `harness-sync` barrel re-exports its DI registration, which reaches
// `@ptah-extension/vscode-core` and from there `import * as vscode`, a module
// jest cannot execute in a node env. Stub the surface that path touches BEFORE
// any static import, exactly as `http-mcp-server.service.spec.ts` does. The
// FACETS themselves stay real — they are what this spec is about.
jest.mock('@ptah-extension/vscode-core', () => ({
  TOKENS: {},
  Logger: class {},
  WebviewManager: class {},
  FileSystemManager: class {},
}));

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HarnessTargetId } from '@ptah-extension/shared';
import {
  planPtahMcpSlots,
  ptahMcpEntry,
  CLAUDE_TARGET,
} from './ptah-mcp-slots';

describe('planPtahMcpSlots', () => {
  let tempHome: string;
  const WS_A = join('/tmp', 'ws-a');
  const WS_B = join('/tmp', 'ws-b');

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'ptah-mcp-slots-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  /**
   * Record `trust_level = "trusted"` for these roots in the fake home config.
   *
   * The real thing is written by Codex when the user accepts its trust prompt.
   * Ptah only ever reads it — see `codex-project-trust.ts`.
   */
  function trustCodexProjects(roots: string[]): void {
    mkdirSync(join(tempHome, '.codex'), { recursive: true });
    const body = roots
      .flatMap((root) => [
        `[projects.'${root.replace(/\\/g, '\\\\')}']`,
        'trust_level = "trusted"',
        '',
      ])
      .join('\n');
    writeFileSync(join(tempHome, '.codex', 'config.toml'), body, 'utf-8');
  }

  function plan(
    options: {
      roots?: string[];
      installed?: HarnessTargetId[];
    } = {},
  ) {
    const installed = new Set(options.installed ?? []);
    return planPtahMcpSlots({
      workspaceRoots: options.roots ?? [WS_A],
      isInstalled: (target) => Promise.resolve(installed.has(target)),
      homeDir: tempHome,
    });
  }

  async function targets(options?: Parameters<typeof plan>[0]) {
    return (await plan(options)).map((slot) => slot.target);
  }

  it('always plans the claude slot, whatever the detector says', async () => {
    // `.mcp.json` is read by Claude Code, Copilot CLI and `ptah-cli`, so "is
    // Claude installed" is the wrong question — and it has always been written
    // unconditionally, so gating it now would be a silent removal.
    expect(await targets({ installed: [] })).toEqual([CLAUDE_TARGET]);
  });

  it('plans one claude slot per open workspace folder', async () => {
    const slots = await plan({ roots: [WS_A, WS_B] });

    expect(slots.map((slot) => slot.workspaceRoot).sort()).toEqual(
      [WS_A, WS_B].sort(),
    );
    expect(slots.map((slot) => slot.configPath)).toEqual([
      join(WS_A, '.mcp.json'),
      join(WS_B, '.mcp.json'),
    ]);
  });

  it('deduplicates a root that is both a folder and the active root', async () => {
    const slots = await plan({ roots: [WS_A, WS_A] });

    expect(slots).toHaveLength(1);
  });

  it('drops an empty root rather than planning an unresolvable slot', async () => {
    const slots = await plan({ roots: ['', WS_A] });

    expect(slots).toHaveLength(1);
    expect(slots[0].workspaceRoot).toBe(WS_A);
  });

  describe('detection gating', () => {
    // Writing `~/.codex/config.toml` on a machine with no Codex CREATES that
    // file; writing `{ws}/.cursor/mcp.json` for a user who does not run Cursor
    // adds a file to their repository.
    it.each<HarnessTargetId>(['cursor', 'codex', 'antigravity'])(
      'omits %s when its CLI is not installed',
      async (target) => {
        expect(await targets({ installed: [] })).not.toContain(target);
      },
    );

    it.each<HarnessTargetId>(['cursor', 'codex', 'antigravity'])(
      'includes %s when its CLI is installed',
      async (target) => {
        expect(await targets({ installed: [target] })).toContain(target);
      },
    );
  });

  describe('scope', () => {
    it('resolves cursor under the workspace, one slot per folder', async () => {
      const slots = (
        await plan({ roots: [WS_A, WS_B], installed: ['cursor'] })
      ).filter((slot) => slot.target === 'cursor');

      expect(slots.map((slot) => slot.configPath)).toEqual([
        join(WS_A, '.cursor', 'mcp.json'),
        join(WS_B, '.cursor', 'mcp.json'),
      ]);
    });

    it('resolves a TRUSTED codex project under the workspace', async () => {
      // Codex reads `{ws}/.codex/config.toml` and merges it with the home file.
      // `codex --help` and `codex doctor` name only the home one, which is what
      // an earlier version of the planner wrongly concluded from. Measured on
      // codex-cli 0.150.1: with the project file present, `codex doctor` in that
      // workspace went from `MCP servers 1` to `2`.
      trustCodexProjects([WS_A, WS_B]);

      const slots = (
        await plan({ roots: [WS_A, WS_B], installed: ['codex'] })
      ).filter((slot) => slot.target === 'codex');

      expect(slots.map((slot) => slot.configPath)).toEqual([
        join(WS_A, '.codex', 'config.toml'),
        join(WS_B, '.codex', 'config.toml'),
      ]);
    });

    it('falls back to the HOME config for an UNTRUSTED codex project', async () => {
      // Codex ignores a project config it does not trust, and says nothing
      // about it. Writing the workspace file there would be a silent no-op; the
      // home file is read unconditionally, so the user gets working tools on
      // the first run — which is also the run that raises the trust prompt.
      const slots = (
        await plan({ roots: [WS_A], installed: ['codex'] })
      ).filter((slot) => slot.target === 'codex');

      expect(slots.map((slot) => slot.configPath)).toEqual([
        join(tempHome, '.codex', 'config.toml'),
      ]);
    });

    it('never plans BOTH codex scopes for one trusted root', async () => {
      trustCodexProjects([WS_A]);

      const slots = (
        await plan({ roots: [WS_A], installed: ['codex'] })
      ).filter((slot) => slot.target === 'codex');

      expect(slots).toHaveLength(1);
    });

    it('covers a mixed set: a workspace file each, plus one home file', async () => {
      // One home entry serves every untrusted root at once, which is the whole
      // reason the home spec is planned when it applies to ANY of them.
      trustCodexProjects([WS_A]);

      const slots = (
        await plan({ roots: [WS_A, WS_B], installed: ['codex'] })
      ).filter((slot) => slot.target === 'codex');

      expect(slots.map((slot) => slot.configPath).sort()).toEqual(
        [
          join(WS_A, '.codex', 'config.toml'),
          join(tempHome, '.codex', 'config.toml'),
        ].sort(),
      );
    });

    it('resolves antigravity BOTH globally and per workspace folder', async () => {
      // Antigravity is two products. The EDITOR documents
      // `{ws}/.agents/mcp_config.json`; the `agy` CLI does not read it — `agy
      // mcp list` reported `No MCP servers configured` with that file present
      // and listed the server the moment the same entry went in the global
      // file, its bundled docs define Global and Plugin scopes only, and the
      // binary carries no `.agents/mcp_config.json` literal. Workspace-only
      // would therefore break the CLI silently.
      const slots = (
        await plan({ roots: [WS_A, WS_B], installed: ['antigravity'] })
      ).filter((slot) => slot.target === 'antigravity');

      expect(slots.map((slot) => slot.configPath).sort()).toEqual(
        [
          join(tempHome, '.gemini', 'config', 'mcp_config.json'),
          join(WS_A, '.agents', 'mcp_config.json'),
          join(WS_B, '.agents', 'mcp_config.json'),
        ].sort(),
      );
    });

    it('writes the antigravity workspace entry in `agy` dialect', async () => {
      // `serverUrl`, not `url` — an entry spelled `url` parses and never
      // connects. The facet owns that; this asserts the right facet was chosen.
      const slot = (
        await plan({ roots: [WS_A], installed: ['antigravity'] })
      ).find((s) => s.configPath.includes('.agents'));

      expect(slot).toBeDefined();
      expect(slot?.facet.configRelPath()).toBe('.agents/mcp_config.json');
    });
  });

  describe('targets deliberately absent', () => {
    it('never plans copilot — it already reads the `.mcp.json` we write', async () => {
      // `copilot mcp --help`: config loads from user `~/.copilot/mcp-config.json`,
      // WORKSPACE `.mcp.json` or `.github/mcp.json`, and plugins. Writing the
      // home file too would declare the same server twice, in every project.
      const all = await targets({
        installed: ['cursor', 'codex', 'antigravity', 'copilot'],
      });

      expect(all).not.toContain('copilot');
    });

    it('never plans vscode — its MCP servers are user-managed in the editor', async () => {
      const all = await targets({
        installed: ['cursor', 'codex', 'antigravity', 'vscode'],
      });

      expect(all).not.toContain('vscode');
    });
  });

  it('gives every slot a distinct config path', async () => {
    const slots = await plan({
      roots: [WS_A, WS_B],
      installed: ['cursor', 'codex', 'antigravity'],
    });
    const paths = slots.map((slot) => slot.configPath);

    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('ptahMcpEntry', () => {
  it('is `http` for every target, so a read-back cannot disagree', () => {
    // `jsonToConfig` infers the transport from the URL (`sse` only when it
    // contains `/sse`), so an entry WRITTEN as `sse` reads back as `http` and
    // the service's read-compare would rewrite the file on every pass.
    expect(ptahMcpEntry(51820)).toEqual({
      type: 'http',
      url: 'http://localhost:51820',
    });
  });
});
