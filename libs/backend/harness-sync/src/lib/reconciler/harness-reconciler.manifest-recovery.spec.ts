/**
 * What happens when the copies land but the MANIFEST does not
 * (TASK_2026_278 review finding 1).
 *
 * `ManagedManifestStore.save` used to log and return void, so a pass whose
 * ownership record failed to persist reported as clean — and the NEXT pass, now
 * reading an empty manifest, classified every copy Ptah had just written as
 * `foreign` and refused to touch it again. The harness froze, silently, with a
 * green badge.
 *
 * Two halves close it, and both are pinned here:
 *
 * 1. The failed save is reported in `writeFailed` against the manifest path, so
 *    `summarizeHarnessHealth` reads `error` rather than `ok`.
 * 2. The next pass ADOPTS a desired path whose bytes already equal what it would
 *    write, instead of freezing on it. Adoption is safe for exactly that reason
 *    — the alternative action would have produced these bytes.
 *
 * Source-under-test: `HarnessReconcilerService.reconcileTarget`,
 * `ClaudeTarget.planEntry`, `WorkspaceHarnessTarget.planEntry`.
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
import type { HarnessTargetHealth } from '@ptah-extension/shared';
import { summarizeHarnessHealth } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { createClaudeTarget } from '../targets/claude-target';
import { createCodexTarget } from '../targets/rival-targets';
import { HarnessReconcilerService } from './harness-reconciler.service';
import { HarnessStateStore } from '../gitignore/harness-state-store';

/**
 * Skills are gated per workspace since TASK_2026_316, and a fresh temp
 * workspace has no manifest evidence, so the migration correctly gates it. This
 * suite is about a manifest that could not be PERSISTED and the adoption that
 * recovers from it, so the selection is recorded up front rather than
 * re-tested. The gate is owned by `harness-reconciler.skill-consent.spec.ts`.
 */
function grantSkillSync(workspaceRoot: string): void {
  const store = new HarnessStateStore();
  store.save(workspaceRoot, {
    ...store.load(workspaceRoot),
    skillSyncMode: 'all',
  });
}

function makeFakeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/**
 * A skill that a rival target genuinely has to REWRITE: `allowed-tools` is
 * Claude-only and gets stripped, and the unquoted `description` contains a
 * colon-space that Codex's YAML parser would read as a nested mapping. Without
 * both, the transformed copy would happen to hash equal to its source and the
 * codex test below would prove nothing.
 */
function writeSkill(skillsRoot: string, slug: string): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: a skill: it orchestrates\nallowed-tools: Read, Write\n---\nbody\n`,
    'utf-8',
  );
}

function healthFor(
  targets: readonly HarnessTargetHealth[],
  id: string,
): HarnessTargetHealth {
  const found = targets.find((target) => target.target === id);
  if (found === undefined) throw new Error(`no health for target ${id}`);
  return found;
}

describe('HarnessReconcilerService — a manifest that could not be persisted', () => {
  let ws: string;
  let sourcesRoot: string;
  let skillsRoot: string;
  // Never the real home directory: the Codex facet READS `~/.codex/config.toml`
  // to find foreign server keys, and a spec that let it reach the developer's
  // own config would report their servers as this workspace's foreign entries
  // (and, one edit away, would write into it).
  let tempHome: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-mrec-ws-'));
    grantSkillSync(ws);
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-mrec-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-mrec-home-'));
    skillsRoot = join(sourcesRoot, 'skills');
    writeSkill(skillsRoot, 'orchestration');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  function sourceState(): HarnessSourceState {
    return {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  }

  function reconcilerWith(
    store: ManagedManifestStore,
    kinds: 'claude' | 'claude+codex',
  ): HarnessReconcilerService {
    const logger = makeFakeLogger();
    const detector = { isInstalled: () => Promise.resolve(true) };
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState()),
      kinds === 'claude'
        ? [createClaudeTarget(store)]
        : [
            createClaudeTarget(store),
            createCodexTarget({
              manifestStore: store,
              detector,
              homeDir: tempHome,
            }),
          ],
    );
  }

  it('reports the failed manifest write in writeFailed, so the summary reads error and not ok', async () => {
    const store = new ManagedManifestStore();
    jest.spyOn(store, 'save').mockReturnValue(false);

    const health = await reconcilerWith(store, 'claude').reconcile(ws, {
      mode: 'full',
      reason: 'manifest write fails',
    });

    // The copy itself succeeded — this is not a copy failure.
    expect(
      existsSync(join(ws, '.claude', 'skills', 'orchestration', 'SKILL.md')),
    ).toBe(true);

    const claude = healthFor(health.targets, 'claude');
    expect(claude.writeFailed).toContainEqual({
      relPath: '.ptah/harness/claude.manifest.json',
      reason: expect.stringContaining('could not be persisted'),
    });
    expect(summarizeHarnessHealth(health).level).toBe('error');
  });

  it('[claude] the next pass ADOPTS the byte-identical copies instead of freezing on them as foreign', async () => {
    const failingStore = new ManagedManifestStore();
    jest.spyOn(failingStore, 'save').mockReturnValue(false);
    await reconcilerWith(failingStore, 'claude').reconcile(ws, {
      mode: 'full',
      reason: 'manifest write fails',
    });
    // Precondition: no ownership record exists at all.
    expect(
      existsSync(join(ws, '.ptah', 'harness', 'claude.manifest.json')),
    ).toBe(false);

    const healthyStore = new ManagedManifestStore();
    const health = await reconcilerWith(healthyStore, 'claude').reconcile(ws, {
      mode: 'full',
      reason: 'recovery pass',
    });

    const claude = healthFor(health.targets, 'claude');
    expect(claude.foreign).toEqual([]);
    expect(claude.writeFailed).toEqual([]);
    expect(claude.found).toBe(claude.expected);
    expect(summarizeHarnessHealth(health).level).toBe('ok');

    // Adoption is worth nothing unless it is DURABLE: the recovered manifest
    // must now own the path, or every later pass repeats the recovery.
    const persisted = healthyStore.load(ws, 'claude');
    expect(persisted.entries['.claude/skills/orchestration']).toBeDefined();
  });

  it('[codex] a TRANSFORMED rival copy is adopted too — compared against the transformed output hash, not the source hash', async () => {
    const failingStore = new ManagedManifestStore();
    jest.spyOn(failingStore, 'save').mockReturnValue(false);
    await reconcilerWith(failingStore, 'claude+codex').reconcile(ws, {
      mode: 'full',
      reason: 'manifest write fails',
    });

    const copied = join(ws, '.agents', 'skills', 'orchestration', 'SKILL.md');
    expect(existsSync(copied)).toBe(true);
    const bytesBefore = readFileSync(copied, 'utf-8');

    const healthyStore = new ManagedManifestStore();
    const health = await reconcilerWith(healthyStore, 'claude+codex').reconcile(
      ws,
      { mode: 'full', reason: 'recovery pass' },
    );

    const codex = healthFor(health.targets, 'codex');
    expect(codex.foreign).toEqual([]);
    // Adopted, not rewritten: nothing was reported as an overwritten local edit,
    // which is what a naive comparison against the SOURCE hash would produce for
    // every transformed copy on every pass.
    expect(codex.overwrittenLocalEdit).toEqual([]);
    expect(readFileSync(copied, 'utf-8')).toBe(bytesBefore);

    const entry = healthyStore.load(ws, 'codex').entries[
      '.agents/skills/orchestration'
    ];
    expect(entry).toBeDefined();
    // The recorded hash is the hash of what is ON DISK. Recording the source
    // hash here would make the very next pass report a hand-edit nobody made.
    expect(entry.sourceHash).toBeDefined();
    expect(entry.hash).not.toBe(entry.sourceHash);
  });

  it("a foreign path that is NOT byte-identical stays foreign — adoption is not a licence to claim the user's files (E9)", async () => {
    const store = new ManagedManifestStore();
    const usersOwn = join(ws, '.claude', 'skills', 'orchestration');
    mkdirSync(usersOwn, { recursive: true });
    writeFileSync(
      join(usersOwn, 'SKILL.md'),
      '---\nname: orchestration\n---\nMY OWN VERSION\n',
      'utf-8',
    );

    const health = await reconcilerWith(store, 'claude').reconcile(ws, {
      mode: 'full',
      reason: 'user owns the path',
    });

    expect(healthFor(health.targets, 'claude').foreign).toContain(
      '.claude/skills/orchestration',
    );
    expect(readFileSync(join(usersOwn, 'SKILL.md'), 'utf-8')).toContain(
      'MY OWN VERSION',
    );
  });
});
