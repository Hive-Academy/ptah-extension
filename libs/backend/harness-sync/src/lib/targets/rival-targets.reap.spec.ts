/**
 * Reaping: a disabled skill disappears from every rival target directory
 * without touching a foreign sibling (E5), and Copilot's home-directory sweep
 * only ever removes the `ptah-`/`ptahsynth-` leftovers it is responsible for,
 * never the user's own agents (E19).
 *
 * Source-under-test: `createCodexTarget` / `createCopilotTarget` /
 * `createCursorTarget` via `HarnessReconcilerService`.
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
import type { HarnessTargetId } from '@ptah-extension/shared';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import {
  createCodexTarget,
  createCopilotTarget,
  createCursorTarget,
} from './rival-targets';

interface FakeLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function makeFakeLogger(): FakeLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

function writeSkill(skillsRoot: string, slug: string): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\nbody\n`,
    'utf-8',
  );
}

describe('rival targets — reaping a disabled skill (E5)', () => {
  let ws: string;
  let sourcesRoot: string;
  let tempHome: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-reap-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-reap-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-reap-home-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  function reconcilerWith(
    disabledSkillIds: string[],
  ): HarnessReconcilerService {
    const skillsRoot = join(sourcesRoot, 'skills');
    writeSkill(skillsRoot, 'foo');
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds,
      disabledPluginIds: [],
    };
    const logger = makeFakeLogger();
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail),
    );
    const detector = detectorFor(['codex', 'copilot', 'cursor']);
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState),
      [
        createCodexTarget({
          manifestStore: store,
          detector,
          homeDir: tempHome,
        }),
        createCopilotTarget({
          manifestStore: store,
          detector,
          homeDir: tempHome,
        }),
        createCursorTarget({ manifestStore: store, detector }),
      ],
    );
  }

  it('[E5] the copy is gone from EVERY target dir once the slug is disabled, and a hand-made foreign sibling survives', async () => {
    const seedReconciler = reconcilerWith([]);
    await seedReconciler.reconcile(ws, { mode: 'full', reason: 'seed' });

    const targetSkillDirs = [
      join(ws, '.agents', 'skills'),
      join(ws, '.github', 'skills'),
      join(ws, '.cursor', 'skills'),
    ];
    for (const dir of targetSkillDirs) {
      expect(existsSync(join(dir, 'foo'))).toBe(true);
    }

    // A foreign directory the user made by hand, sitting next to Ptah's copy in
    // each target's skills directory.
    for (const dir of targetSkillDirs) {
      const foreignDir = join(dir, 'user-own-skill');
      mkdirSync(foreignDir, { recursive: true });
      writeFileSync(
        join(foreignDir, 'SKILL.md'),
        '---\nname: user-own-skill\n---\nmine\n',
        'utf-8',
      );
    }

    const reapReconciler = reconcilerWith(['foo']);
    await reapReconciler.reconcile(ws, { mode: 'full', reason: 'disable foo' });

    for (const dir of targetSkillDirs) {
      expect(existsSync(join(dir, 'foo'))).toBe(false);
      expect(existsSync(join(dir, 'user-own-skill', 'SKILL.md'))).toBe(true);
    }
  });
});

/**
 * The home reap (E19), and the ownership proof it now demands
 * (TASK_2026_278 review finding 5).
 *
 * Copilot resolves agents home-first, so a stale `~/.copilot/agents/ptah-x.md`
 * shadows the workspace copy Ptah just wrote and has to go. But the original
 * rule — "delete anything in that directory whose name starts with `ptah-` or
 * `ptahsynth-`" — was a name-prefix heuristic aimed at a directory Ptah does not
 * own, applied with no ownership check and no report. A user's own
 * `ptah-notes.agent.md` disappeared silently on the next activation.
 *
 * Two proofs now, either of which suffices: the frontmatter signature every
 * agent the Ptah pipeline emits carries (`source: ptah`, from
 * `transformers/transform-rules.ts`), or a name of the form `<prefix><id>` where
 * `id` is an agent this target is currently or was previously asked to write.
 */
describe('Copilot home-directory reap (E19)', () => {
  let ws: string;
  let sourcesRoot: string;
  let tempHome: string;
  let homeAgentsDir: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-e19-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-e19-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-e19-home-'));
    homeAgentsDir = join(tempHome, '.copilot', 'agents');
    mkdirSync(homeAgentsDir, { recursive: true });
    // Agents are gated per workspace since TASK_2026_286. This suite is about
    // the home REAP, so consent is recorded up front rather than re-tested.
    new HarnessStateStore().save(ws, { version: 1, agentSyncEnabled: true });
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  /** What `rewriteFrontmatter` emitted, and still emits, for every Ptah agent. */
  function ptahWrittenAgent(agentId: string): string {
    return `---\nname: ${agentId}\ndescription: "an agent"\nsource: ptah\ntarget-cli: copilot\n---\n\nbody\n`;
  }

  function writeAgentSource(slug: string): void {
    const agentsRoot = join(sourcesRoot, 'agents');
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(
      join(agentsRoot, `${slug}.md`),
      `---\nname: ${slug}\ndescription: "an agent"\n---\ninstructions\n`,
      'utf-8',
    );
  }

  function reconciler(): HarnessReconcilerService {
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
    const logger = makeFakeLogger();
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail),
    );
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState),
      [
        createCopilotTarget({
          manifestStore: store,
          detector: detectorFor(['copilot']),
          homeDir: tempHome,
        }),
      ],
    );
  }

  it('[E19] reaps prefixed home entries that carry the Ptah writer signature, and reports every one in removed', async () => {
    const ptahFile = join(homeAgentsDir, 'ptah-old.agent.md');
    const ptahsynthFile = join(homeAgentsDir, 'ptahsynth-old.agent.md');
    const userFile = join(homeAgentsDir, 'user-keep.md');
    writeFileSync(ptahFile, ptahWrittenAgent('old'), 'utf-8');
    writeFileSync(ptahsynthFile, ptahWrittenAgent('old'), 'utf-8');
    writeFileSync(userFile, "the user's own agent", 'utf-8');

    const health = await reconciler().reconcile(ws, {
      mode: 'full',
      reason: 'home reap',
    });

    expect(existsSync(ptahFile)).toBe(false);
    expect(existsSync(ptahsynthFile)).toBe(false);
    expect(existsSync(userFile)).toBe(true);
    // Deleting a file in the user's HOME directory must be visible in the
    // report, not merely in a debug log nobody reads.
    const copilot = health.targets.find((t) => t.target === 'copilot');
    expect(copilot?.removed).toEqual(
      expect.arrayContaining([ptahFile, ptahsynthFile]),
    );
  });

  it("[E19] a user's own ptah-notes.agent.md with no marker survives — the prefix alone is not proof of ownership", async () => {
    const usersOwn = join(homeAgentsDir, 'ptah-notes.agent.md');
    writeFileSync(
      usersOwn,
      '---\nname: ptah-notes\ndescription: "my notes about ptah"\n---\nmine\n',
      'utf-8',
    );

    const health = await reconciler().reconcile(ws, {
      mode: 'full',
      reason: 'home reap',
    });

    expect(existsSync(usersOwn)).toBe(true);
    expect(readFileSync(usersOwn, 'utf-8')).toContain('my notes about ptah');
    expect(health.targets.find((t) => t.target === 'copilot')?.removed).toEqual(
      [],
    );
  });

  it('[E19] a marker-less leftover is still reaped when its name names an agent this target writes', async () => {
    writeAgentSource('backend-developer');
    // Frontmatter hand-edited away by a user tidying the file — the name is the
    // remaining evidence, and it is evidence only because Ptah is being asked to
    // write `backend-developer` for this very target.
    const stripped = join(homeAgentsDir, 'ptah-backend-developer.agent.md');
    writeFileSync(stripped, 'no frontmatter at all\n', 'utf-8');
    const unrelated = join(homeAgentsDir, 'ptah-notes.agent.md');
    writeFileSync(unrelated, 'no frontmatter at all\n', 'utf-8');

    await reconciler().reconcile(ws, { mode: 'full', reason: 'home reap' });

    expect(existsSync(stripped)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });
});
