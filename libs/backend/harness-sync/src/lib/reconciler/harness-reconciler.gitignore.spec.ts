/**
 * E23 at the reconciler seam — WHICH directories reach the `.gitignore` block.
 *
 * `gitignore-writer.spec.ts` covers the splice itself. What is only testable
 * here is the selection: a full pass contributes the directories of DETECTED
 * targets and nothing else, a preflight contributes nothing at all, and no MCP
 * config file ever appears — those are files teams commit, and the reconciler
 * writing them into `.gitignore` would be the bug this spec exists to prevent.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeTarget } from '../targets/claude-target';
import {
  createCodexTarget,
  createCursorTarget,
} from '../targets/rival-targets';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessGitignoreWriter } from '../gitignore/gitignore-writer';
import { HarnessReconcilerService } from './harness-reconciler.service';

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('HarnessReconcilerService × .gitignore (E23)', () => {
  let ws: string;
  let sourcesRoot: string;
  let tempHome: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-gi-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-gi-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-gi-home-'));

    const skillsRoot = join(sourcesRoot, 'skills', 'foo');
    mkdirSync(skillsRoot, { recursive: true });
    writeFileSync(
      join(skillsRoot, 'SKILL.md'),
      '---\nname: foo\n---\nbody\n',
      'utf-8',
    );
    const commandsRoot = join(sourcesRoot, 'commands');
    mkdirSync(commandsRoot, { recursive: true });
    writeFileSync(join(commandsRoot, 'baz.md'), 'command baz', 'utf-8');
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, tempHome]) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A locked file on Windows must not fail the suite.
      }
    }
  });

  function sourceState(): HarnessSourceState {
    return {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      mcpIntents: [
        {
          serverKey: 'github',
          registryName: 'io.github.example/server',
          config: { type: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'] },
          targets: ['claude', 'cursor'],
        },
      ],
    };
  }

  function build(codexInstalled: boolean): HarnessReconcilerService {
    const logger = fakeLogger();
    const store = new ManagedManifestStore(() => undefined);
    // Cursor is never installed in these fixtures; Codex varies per test.
    const detector = {
      isInstalled: (id: string) =>
        Promise.resolve(id === 'codex' ? codexInstalled : false),
    };
    return new HarnessReconcilerService(
      logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState()),
      [
        new ClaudeTarget(store),
        createCodexTarget({
          manifestStore: store,
          detector,
          homeDir: tempHome,
        }),
        createCursorTarget({
          manifestStore: store,
          detector,
          homeDir: tempHome,
        }),
      ],
      new HarnessGitignoreWriter(logger),
    );
  }

  const gitignore = (): string => readFileSync(join(ws, '.gitignore'), 'utf-8');

  it('lists the directories of detected targets after a full pass', async () => {
    await build(true).reconcile(ws, { mode: 'full', reason: 'spec' });

    const text = gitignore();
    expect(text).toContain('.claude/skills/');
    expect(text).toContain('.claude/commands/');
    expect(text).toContain('.agents/skills/');
    expect(text).toContain('.codex/agents/');
  });

  it('omits an undetected target — no rule about a directory that will not exist', async () => {
    await build(false).reconcile(ws, { mode: 'full', reason: 'spec' });

    const text = gitignore();
    // Claude is always detected; Codex and Cursor are not installed here.
    expect(text).toContain('.claude/skills/');
    expect(text).not.toContain('.agents/skills/');
    expect(text).not.toContain('.cursor/');
  });

  it('never ignores an MCP config file — those are committed on purpose', async () => {
    await build(true).reconcile(ws, { mode: 'full', reason: 'spec' });

    const text = gitignore();
    expect(existsSync(join(ws, '.mcp.json'))).toBe(true);
    expect(text).not.toContain('.mcp.json');
    expect(text).not.toContain('mcp.json');
    expect(text).not.toContain('config.toml');
  });

  it('does not touch .gitignore during a preflight pass', async () => {
    await build(true).reconcile(ws, { mode: 'preflight', reason: 'spec' });

    expect(existsSync(join(ws, '.gitignore'))).toBe(false);
  });

  it('a full pass over an already-reconciled workspace rewrites nothing', async () => {
    const reconciler = build(true);
    await reconciler.reconcile(ws, { mode: 'full', reason: 'first' });
    const first = gitignore();

    await reconciler.reconcile(ws, { mode: 'full', reason: 'second' });

    expect(gitignore()).toBe(first);
  });

  it('verify() observes without writing anything — not even the manifest', async () => {
    // What `harness:health` and `ptah harness doctor` (no --fix) call. If this
    // ever writes, a polling badge starts repairing the workspace behind the
    // user's back and can take the lock from a session that is mid-copy.
    const reconciler = build(true);

    const report = await reconciler.verify(ws, 'spec');

    expect(report.mode).toBe('preflight');
    expect(report.targets.map((t) => t.target)).toContain('claude');
    expect(existsSync(join(ws, '.gitignore'))).toBe(false);
    expect(existsSync(join(ws, '.claude'))).toBe(false);
    expect(existsSync(join(ws, '.ptah', 'harness'))).toBe(false);
  });

  it('verify() reports the gap a full pass would close', async () => {
    const reconciler = build(true);

    const before = await reconciler.verify(ws, 'spec');
    await reconciler.reconcile(ws, { mode: 'full', reason: 'spec' });
    const after = await reconciler.verify(ws, 'spec');

    const claudeBefore = before.targets.find((t) => t.target === 'claude');
    const claudeAfter = after.targets.find((t) => t.target === 'claude');
    expect(claudeBefore?.missing.length).toBeGreaterThan(0);
    expect(claudeAfter?.missing).toEqual([]);
  });

  it('a reconciler wired without a gitignore writer leaves the file alone', async () => {
    const logger = fakeLogger();
    const store = new ManagedManifestStore(() => undefined);
    const reconciler = new HarnessReconcilerService(
      logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState()),
      [new ClaudeTarget(store)],
    );

    await reconciler.reconcile(ws, { mode: 'full', reason: 'spec' });

    expect(existsSync(join(ws, '.gitignore'))).toBe(false);
  });
});
