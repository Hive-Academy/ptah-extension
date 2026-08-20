/**
 * Detection gating (E17) — an undetected rival CLI must produce NO directories
 * and NO health noise, and installing it later must populate everything from
 * scratch on the very next reconcile, because nothing about the desired state
 * was ever conditional on detection.
 *
 * Source-under-test: `createRivalTargets` via `HarnessReconcilerService`.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { HarnessTargetId } from '@ptah-extension/shared';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { NO_CLI_DETECTOR } from '../sources/harness-source.port';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { createRivalTargets } from './rival-targets';

/**
 * Agents are gated per workspace since TASK_2026_286. This spec is about
 * DETECTION, so it records consent up front rather than re-testing the gate.
 */
function grantAgentSync(workspaceRoot: string): void {
  new HarnessStateStore().save(workspaceRoot, {
    version: 1,
    agentSyncEnabled: true,
  });
}

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

function writeAgent(agentsRoot: string, slug: string): void {
  mkdirSync(agentsRoot, { recursive: true });
  writeFileSync(
    join(agentsRoot, `${slug}.md`),
    `---\nname: ${slug}\ndescription: ${slug} agent\n---\nDo the thing.`,
    'utf-8',
  );
}

describe('rival targets — detection gating (E17)', () => {
  let ws: string;
  let sourcesRoot: string;
  let tempHome: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-detect-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-detect-src-'));
    tempHome = mkdtempSync(join(tmpdir(), 'harness-sync-detect-home-'));
    grantAgentSync(ws);
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
    rmSync(tempHome, { recursive: true, force: true });
  });

  function reconcilerWith(
    detector: IHarnessCliDetector,
  ): HarnessReconcilerService {
    const skillsRoot = join(sourcesRoot, 'skills');
    const agentsRoot = join(sourcesRoot, 'agents');
    writeSkill(skillsRoot, 'foo');
    writeAgent(agentsRoot, 'agentx');
    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot,
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
      createRivalTargets({ manifestStore: store, detector, homeDir: tempHome }),
    );
  }

  it('[E17] nothing installed -> every CLI target reports detected:false, expected:0, and no directory is created; installing codex populates it on the next reconcile', async () => {
    const reconciler = reconcilerWith(NO_CLI_DETECTOR);

    const firstHealth = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'no clis',
    });

    const cliTargets: HarnessTargetId[] = [
      'codex',
      'copilot',
      'cursor',
      'antigravity',
    ];
    for (const targetHealth of firstHealth.targets) {
      if (!cliTargets.includes(targetHealth.target)) continue;
      expect(targetHealth.detected).toBe(false);
      expect(targetHealth.expected).toBe(0);
    }
    expect(existsSync(join(ws, '.agents'))).toBe(false);
    expect(existsSync(join(ws, '.codex'))).toBe(false);
    expect(existsSync(join(ws, '.github'))).toBe(false);
    expect(existsSync(join(ws, '.cursor'))).toBe(false);

    // Now codex "gets installed": a fresh reconciler over the same workspace,
    // same manifests on disk, with a detector that says so.
    const withCodex = reconcilerWith(detectorFor(['codex']));
    await withCodex.reconcile(ws, { mode: 'full', reason: 'codex installed' });

    expect(existsSync(join(ws, '.agents', 'skills', 'foo'))).toBe(true);
    expect(existsSync(join(ws, '.codex', 'agents', 'agentx.toml'))).toBe(true);
  });

  it('[E17] the facet matrix is reported even for an undetected target', async () => {
    const reconciler = reconcilerWith(NO_CLI_DETECTOR);
    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'no clis',
    });

    const byId = new Map(health.targets.map((t) => [t.target, t]));
    expect(byId.get('codex')?.facets.commands).toBe('unsupported');
    expect(byId.get('codex')?.facets.skills).toBe('supported');
    expect(byId.get('antigravity')?.facets.agents).toBe('unsupported');
    expect(byId.get('vscode')?.facets.skills).toBe('unsupported');
    expect(byId.get('vscode')?.facets.mcp).toBe('supported');
  });
});
