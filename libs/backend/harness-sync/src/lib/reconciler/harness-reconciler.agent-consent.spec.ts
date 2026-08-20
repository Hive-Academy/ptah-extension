/**
 * The `agents` consent gate and — the part that matters — its migration
 * (TASK_2026_286).
 *
 * Agents were the one artifact kind that propagated with no user gate: every
 * `.md` under `~/.ptah/user/agents` was fanned out to `.codex/agents`,
 * `.github/agents` and `.cursor/agents` on the first pass in every workspace.
 * Gating it is easy. Gating it WITHOUT a flag day is the whole problem, because
 * agents are manifest-owned: a flag that defaulted to `false` would not merely
 * stop propagating, it would make the very next routine reconcile DELETE every
 * agent file every previous version of Ptah had written, in every workspace, on
 * upgrade.
 *
 * So the rule is: an absent flag resolves to `true` when any per-target
 * manifest already owns an agent entry (prior propagation is prior consent),
 * and to `false` otherwise. The resolved value is then persisted, so the
 * evidence walk runs once and cannot later flip.
 *
 * Source-under-test: `AgentSyncGate` via `HarnessReconcilerService`.
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
import type { HarnessTargetId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  HarnessStateStore,
  harnessStatePath,
  type HarnessWorkspaceState,
} from '../gitignore/harness-state-store';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { AgentSyncGate } from '../state/agent-sync-gate';
import {
  createCodexTarget,
  createCopilotTarget,
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

describe('HarnessReconcilerService — the agents consent gate', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;

  const CODEX_ONE = ['.codex', 'agents', 'agent-one.toml'];
  const CODEX_TWO = ['.codex', 'agents', 'agent-two.toml'];
  const COPILOT_ONE = ['.github', 'agents', 'agent-one.agent.md'];

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-consent-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-consent-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-consent-home-'));
    writeAgentSources('agent-one', 'agent-two');
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeAgentSources(...slugs: string[]): void {
    const agentsRoot = join(sourcesRoot, 'agents');
    mkdirSync(agentsRoot, { recursive: true });
    for (const slug of slugs) {
      writeFileSync(
        join(agentsRoot, `${slug}.md`),
        `---\nname: ${slug}\ndescription: the ${slug} agent\n---\n${slug} instructions\n`,
        'utf-8',
      );
    }
  }

  function sourceState(disabledAgentIds: string[] = []): HarnessSourceState {
    return {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds,
    };
  }

  function newReconciler(
    disabledAgentIds: string[] = [],
  ): HarnessReconcilerService {
    const store = new ManagedManifestStore();
    const deps = {
      manifestStore: store,
      detector: detectorFor(['codex', 'copilot']),
      homeDir: home,
    };
    return new HarnessReconcilerService(
      fakeLogger(),
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(sourceState(disabledAgentIds)),
      [createCodexTarget(deps), createCopilotTarget(deps)],
    );
  }

  function readState(): HarnessWorkspaceState | null {
    const path = harnessStatePath(ws);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as HarnessWorkspaceState;
  }

  function exists(...segments: string[]): boolean {
    return existsSync(join(ws, ...segments));
  }

  it('a workspace that never propagated agents gets none, and the derived decision is recorded so the evidence walk runs once', async () => {
    const health = await newReconciler().reconcile(ws, {
      mode: 'full',
      reason: 'first ever pass',
    });

    expect(exists(...CODEX_ONE)).toBe(false);
    expect(exists(...COPILOT_ONE)).toBe(false);
    // Nothing was owned, so nothing was deleted either — a gated workspace is
    // quiet, not destructive.
    for (const target of health.targets) {
      expect(target.removed).toEqual([]);
    }
    expect(readState()?.agentSyncEnabled).toBe(false);
  });

  it('THE MIGRATION: an absent flag over manifests that already own agents keeps the agents and reaps nothing', async () => {
    // Pass one is the world before the gate: consent recorded by hand stands in
    // for the ungated Ptah that wrote these files.
    new HarnessStateStore().save(ws, { version: 1, agentSyncEnabled: true });
    await newReconciler().reconcile(ws, {
      mode: 'full',
      reason: 'the ungated version',
    });
    expect(exists(...CODEX_ONE)).toBe(true);
    expect(exists(...COPILOT_ONE)).toBe(true);

    // The upgrade. Every version before this one wrote a state.json with no
    // `agentSyncEnabled` in it (or none at all), which is exactly what a user
    // upgrading into the gate looks like.
    rmSync(harnessStatePath(ws), { force: true });

    const health = await newReconciler().reconcile(ws, {
      mode: 'full',
      reason: 'first pass after the upgrade',
    });

    expect(exists(...CODEX_ONE)).toBe(true);
    expect(exists(...CODEX_TWO)).toBe(true);
    expect(exists(...COPILOT_ONE)).toBe(true);
    for (const target of health.targets) {
      expect(target.removed).toEqual([]);
      expect(target.missing).toEqual([]);
    }
    // Resolved from evidence, then written down: the manifests can be emptied
    // later without the answer flipping back.
    expect(readState()?.agentSyncEnabled).toBe(true);
  });

  it('a recorded false is not re-derived from evidence, so a user who declined stays declined', async () => {
    new HarnessStateStore().save(ws, { version: 1, agentSyncEnabled: false });

    await newReconciler().reconcile(ws, { mode: 'full', reason: 'declined' });

    expect(exists(...CODEX_ONE)).toBe(false);
    expect(readState()?.agentSyncEnabled).toBe(false);
  });

  it('the wizard grant is what opens the gate, and the next pass fans the agents out', async () => {
    const store = new ManagedManifestStore();
    expect(new AgentSyncGate(store).enable(ws)).toBe(true);

    await newReconciler().reconcile(ws, {
      mode: 'full',
      reason: 'wizard:generation-complete',
    });

    expect(exists(...CODEX_ONE)).toBe(true);
    expect(exists(...COPILOT_ONE)).toBe(true);
    const state = readState();
    expect(state?.agentSyncEnabled).toBe(true);
    // Recorded so a later reader can tell "the user asked for this" from "the
    // migration inferred it".
    expect(typeof state?.wizardCompletedAt).toBe('string');
  });

  it('verify() resolves the gate without recording anything — asking must not decide', async () => {
    const health = await newReconciler().verify(ws);

    expect(health.targets.some((target) => target.detected)).toBe(true);
    expect(readState()).toBeNull();
  });

  it('[286] a disabled agent is reaped from every target while its sibling stays', async () => {
    new HarnessStateStore().save(ws, { version: 1, agentSyncEnabled: true });
    await newReconciler().reconcile(ws, { mode: 'full', reason: 'both on' });
    expect(exists(...CODEX_TWO)).toBe(true);

    const health = await newReconciler(['agent-two']).reconcile(ws, {
      mode: 'full',
      reason: 'agent-two disabled',
    });

    expect(exists(...CODEX_TWO)).toBe(false);
    expect(exists(...CODEX_ONE)).toBe(true);
    expect(exists(...COPILOT_ONE)).toBe(true);
    const codex = health.targets.find((target) => target.target === 'codex');
    expect(codex?.removed).toContain('.codex/agents/agent-two.toml');
  });
});
