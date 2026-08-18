/**
 * The invariant that `reconcile` and `verify` cannot disagree.
 *
 * The defect this pins was measured on a real workspace: `harness doctor --fix`
 * printed "Harness in sync across 5 targets" and exited 0, and `harness doctor`
 * run one second later over the untouched tree printed "23 missing across 5
 * targets" and exited 1. Neither converged, because the two code paths
 * classified the same path with different rules — `plan` called an unowned
 * desired path `foreign` and counted no gap, `verify` called it `missing` and
 * counted no refusal — and because a legacy copy no manifest owned could never
 * be repaired by any number of passes.
 *
 * The fixture is deliberately the hard case, all at once:
 *
 *   - a legacy `.ptah-managed.json` in a rival skills directory
 *   - unowned agent copies carrying the writer signature of the deleted
 *     `MultiCliAgentWriterService`, in both formats (markdown and TOML)
 *   - a genuinely foreign directory sitting on a DESIRED path
 *   - a genuinely foreign agent file sitting on a DESIRED path
 *   - the user's own MCP server in `.vscode/mcp.json`, which is not ours and
 *     is not a finding
 *   - the user's own MCP server under a key Ptah wants, which IS a finding
 *
 * Three assertions, and the third is the one that would have caught the
 * original bug on its own: reconcile's health and a following verify's health
 * are identical, and a second reconcile writes nothing.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  HarnessHealth,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { ClaudeTarget } from '../targets/claude-target';
import {
  createCodexTarget,
  createCopilotTarget,
  createVscodeMcpTarget,
} from '../targets/rival-targets';
import { HarnessReconcilerService } from './harness-reconciler.service';

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

/**
 * The three count columns plus the two path lists, per target.
 *
 * Compared as a whole object rather than field by field so a future field that
 * only one code path fills fails this spec instead of slipping through.
 */
function shape(health: HarnessHealth): unknown {
  return health.targets
    .map((target: HarnessTargetHealth) => ({
      target: target.target,
      detected: target.detected,
      expected: target.expected,
      found: target.found,
      missing: [...target.missing].sort(),
      foreign: [...target.foreign].sort(),
      writeFailed: target.writeFailed.map((failure) => failure.relPath).sort(),
    }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

function findTarget(
  health: HarnessHealth,
  id: HarnessTargetId,
): HarnessTargetHealth {
  const found = health.targets.find((target) => target.target === id);
  if (found === undefined) throw new Error(`no health for target ${id}`);
  return found;
}

describe('HarnessReconcilerService — reconcile and verify agree', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;
  let reconciler: HarnessReconcilerService;

  /** `~/.ptah/user/skills/<slug>/SKILL.md`, and the rest of the user layer. */
  function writeSources(): HarnessSourceState {
    const skillsRoot = join(sourcesRoot, 'skills');
    const commandsRoot = join(sourcesRoot, 'commands');
    const agentsRoot = join(sourcesRoot, 'agents');
    mkdirSync(commandsRoot, { recursive: true });
    mkdirSync(agentsRoot, { recursive: true });

    for (const slug of ['alpha', 'beta']) {
      mkdirSync(join(skillsRoot, slug), { recursive: true });
      writeFileSync(
        join(skillsRoot, slug, 'SKILL.md'),
        `---\nname: ${slug}\ndescription: the ${slug} skill\n---\n${slug} body\n`,
        'utf-8',
      );
    }
    writeFileSync(join(commandsRoot, 'run-it.md'), 'command body\n', 'utf-8');
    for (const id of ['agent-one', 'agent-two']) {
      writeFileSync(
        join(agentsRoot, `${id}.md`),
        `---\nname: ${id}\ndescription: the ${id} agent\n---\n${id} instructions\n`,
        'utf-8',
      );
    }

    return {
      layout: { skillsRoot, commandsRoot, agentsRoot },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      mcpIntents: [
        {
          serverKey: 'wanted',
          registryName: 'io.github.example/wanted',
          config: { type: 'stdio', command: 'wanted-server' },
          targets: ['vscode'],
        },
      ],
    };
  }

  /** Everything the old pipelines and the user left in the workspace. */
  function writeWorkspaceState(): void {
    // A legacy rival-installer manifest claiming a copy it made. Adoptable.
    const rivalSkills = join(ws, '.agents', 'skills');
    mkdirSync(join(rivalSkills, 'beta'), { recursive: true });
    writeFileSync(
      join(rivalSkills, 'beta', 'SKILL.md'),
      'stale legacy copy\n',
      'utf-8',
    );
    writeFileSync(
      join(rivalSkills, '.ptah-managed.json'),
      JSON.stringify({ skills: ['beta'], commands: [] }),
      'utf-8',
    );

    // A Claude skill directory the USER wrote, at a slug Ptah also wants.
    // Nothing proves it is ours, so it stays foreign — and is therefore a gap.
    mkdirSync(join(ws, '.claude', 'skills', 'alpha'), { recursive: true });
    writeFileSync(
      join(ws, '.claude', 'skills', 'alpha', 'SKILL.md'),
      'hand-written by the user\n',
      'utf-8',
    );

    // Legacy agent copies, in both formats, carrying the writer signature of
    // the deleted MultiCliAgentWriterService. Adoptable.
    mkdirSync(join(ws, '.github', 'agents'), { recursive: true });
    writeFileSync(
      join(ws, '.github', 'agents', 'agent-one.agent.md'),
      '---\nname: agent-one\ndescription: "old"\nsource: ptah\ntarget-cli: copilot\n---\n\nstale\n',
      'utf-8',
    );
    mkdirSync(join(ws, '.codex', 'agents'), { recursive: true });
    writeFileSync(
      join(ws, '.codex', 'agents', 'agent-one.toml'),
      'name = "agent-one"\ndescription = "old"\ndeveloper_instructions = """\nstale\n"""\n',
      'utf-8',
    );

    // An agent file the USER wrote at a desired path. No signature, so it is
    // foreign, and the agent Ptah was asked to install is therefore missing.
    writeFileSync(
      join(ws, '.github', 'agents', 'agent-two.agent.md'),
      '# my own notes about agent-two\n',
      'utf-8',
    );

    // The user's own MCP servers. `user-thing` is simply not ours and must not
    // be reported at all; `wanted` collides with a key Ptah was asked to
    // install and must be reported as both foreign and missing.
    mkdirSync(join(ws, '.vscode'), { recursive: true });
    writeFileSync(
      join(ws, '.vscode', 'mcp.json'),
      JSON.stringify(
        {
          servers: {
            'user-thing': { type: 'stdio', command: 'the-users-server' },
            wanted: { type: 'stdio', command: 'the-users-other-server' },
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
  }

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-agree-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-agree-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-agree-home-'));

    const sourceState = writeSources();
    writeWorkspaceState();

    const store = new ManagedManifestStore();
    const deps = {
      manifestStore: store,
      detector: detectorFor(['codex', 'copilot']),
      homeDir: home,
    };
    reconciler = new HarnessReconcilerService(
      fakeLogger(),
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState),
      [
        new ClaudeTarget(store),
        createCodexTarget(deps),
        createCopilotTarget(deps),
        createVscodeMcpTarget(deps),
      ],
    );
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports the same counts and the same paths from reconcile and from a following verify', async () => {
    const reconciled = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });
    const verified = await reconciler.verify(ws, 'test');

    expect(shape(verified)).toEqual(shape(reconciled));
  });

  it('is a no-op on the second pass: nothing is rewritten, removed or newly claimed', async () => {
    await reconciler.reconcile(ws, { mode: 'full', reason: 'first' });

    const written = join(ws, '.agents', 'skills', 'beta', 'SKILL.md');
    const beforeMtime = statSync(written).mtimeMs;

    const second = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'second',
    });

    expect(statSync(written).mtimeMs).toBe(beforeMtime);
    for (const target of second.targets) {
      expect(target.removed).toEqual([]);
      expect(target.writeFailed).toEqual([]);
      expect(target.overwrittenLocalEdit).toEqual([]);
      expect(target.adopted ?? []).toEqual([]);
    }
  });

  it('adopts legacy copies it can prove it wrote, in every format, and rewrites them with current output', async () => {
    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    // The legacy `.ptah-managed.json` skill copy.
    expect(findTarget(health, 'codex').adopted).toContain(
      '.agents/skills/beta',
    );
    expect(
      readFileSync(join(ws, '.agents', 'skills', 'beta', 'SKILL.md'), 'utf-8'),
    ).toContain('beta body');

    // The markdown agent, adopted on its frontmatter signature.
    expect(findTarget(health, 'copilot').adopted).toContain(
      '.github/agents/agent-one.agent.md',
    );
    expect(
      readFileSync(
        join(ws, '.github', 'agents', 'agent-one.agent.md'),
        'utf-8',
      ),
    ).toContain('agent-one instructions');

    // The TOML agent, adopted on its predecessor's shape, and rewritten with
    // the marker so the next generation needs no heuristic.
    expect(findTarget(health, 'codex').adopted).toContain(
      '.codex/agents/agent-one.toml',
    );
    expect(
      readFileSync(join(ws, '.codex', 'agents', 'agent-one.toml'), 'utf-8'),
    ).toContain('# source: ptah');
  });

  it('reports a desired path blocked by a foreign entry as BOTH foreign and missing, and leaves the file alone', async () => {
    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    const claude = findTarget(health, 'claude');
    expect(claude.foreign).toContain('.claude/skills/alpha');
    expect(claude.missing).toContain('.claude/skills/alpha');
    expect(
      readFileSync(join(ws, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf-8'),
    ).toBe('hand-written by the user\n');

    const copilot = findTarget(health, 'copilot');
    expect(copilot.foreign).toContain('.github/agents/agent-two.agent.md');
    expect(copilot.missing).toContain('.github/agents/agent-two.agent.md');
    expect(
      readFileSync(
        join(ws, '.github', 'agents', 'agent-two.agent.md'),
        'utf-8',
      ),
    ).toBe('# my own notes about agent-two\n');
  });

  it("counts the user's own MCP server as foreign only when it occupies a key Ptah wants", async () => {
    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });
    const vscode = findTarget(health, 'vscode');

    // A collision: Ptah was asked to install `wanted`, the user already has one.
    expect(vscode.foreign).toContain('.vscode/mcp.json#wanted');
    expect(vscode.missing).toContain('.vscode/mcp.json#wanted');

    // Not a collision, not ours, not a finding. Reporting it made an ordinary
    // config file read as a list of problems nobody could act on.
    expect(vscode.foreign).not.toContain('.vscode/mcp.json#user-thing');
    expect(vscode.missing).not.toContain('.vscode/mcp.json#user-thing');

    // And it is still on disk, byte for byte.
    const config = JSON.parse(
      readFileSync(join(ws, '.vscode', 'mcp.json'), 'utf-8'),
    ) as { servers: Record<string, { command?: string }> };
    expect(config.servers['user-thing'].command).toBe('the-users-server');
    expect(config.servers['wanted'].command).toBe('the-users-other-server');
  });
});
