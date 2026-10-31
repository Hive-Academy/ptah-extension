/**
 * D-2 retirement removal policy for MCP keys (TASK_2026_853, Batch 23).
 *
 * A retired, manifest-owned server key is deleted only when its entry still
 * hashes to the manifest hash; a workspace config file must also be proven
 * untracked by git, a `~/` home config skips that check. Siblings — owned or
 * hand-added — are never touched, and a key no manifest owns is never even
 * planned for removal (E18). Fixtures live in `mkdtemp` roots: the workspace and
 * a fake home directory, so no real config file is read or written.
 */

import { execFileSync } from 'child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  HarnessFacetMatrix,
  McpServerConfig,
} from '@ptah-extension/shared';
import type { HarnessDesiredState } from '../../manifest/desired-state.types';
import {
  emptyManifest,
  managedEntry,
  ManagedManifestStore,
  type ManagedEntries,
} from '../../manifest-store/managed-manifest';
import type {
  HarnessApplyResult,
  HarnessPlanRemove,
} from '../harness-target.port';
import { WorkspaceHarnessTarget } from '../workspace-target';
import {
  applyMcpFacet,
  planMcpFacet,
  type GitTrackingProbe,
  type GitTrackingState,
} from './mcp-facet-planner';
import type { IHarnessMcpFacet } from './mcp-facet.port';
import { createMcpFacet } from './mcp-facet.registry';
import { hashMcpConfig } from './mcp-json-format';

const RETIRED = 'retired-srv';
const SIBLING = 'sibling-srv';
const HAND = 'hand-added';

/** Raw config entries as a user's JSON file spells them. */
const RAW_SERVERS = {
  [RETIRED]: { command: 'npx', args: ['retired'] },
  [SIBLING]: { command: 'npx', args: ['sibling'] },
  [HAND]: { command: 'my-own', args: [] },
};

function emptyResult(): HarnessApplyResult {
  return { written: {}, removed: [], writeFailed: [], keptLocalEdit: [] };
}

/** A probe answering one fixed state and recording what it was asked. */
function fixedProbe(
  state: GitTrackingState,
): GitTrackingProbe & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  const probe = ((workspaceRoot: string, relPath: string) => {
    calls.push([workspaceRoot, relPath]);
    return Promise.resolve(state);
  }) as GitTrackingProbe & { calls: typeof calls };
  probe.calls = calls;
  return probe;
}

describe('MCP facet planner — retired key removal proofs (D-2)', () => {
  let tempRoot: string;
  let ws: string;
  let home: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'ptah-b23-mcp-'));
    ws = join(tempRoot, 'ws');
    home = join(tempRoot, 'home');
    mkdirSync(ws, { recursive: true });
    mkdirSync(home, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Write a config holding all three servers; answer the facet and the file. */
  function seed(kind: 'home' | 'workspace'): {
    facet: IHarnessMcpFacet;
    file: string;
  } {
    const facet =
      kind === 'home'
        ? createMcpFacet('antigravity', { homeDir: home })
        : createMcpFacet('cursor');
    const file = facet.configPath(ws) as string;
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: RAW_SERVERS }, null, 2));
    return { facet, file };
  }

  /** Manifest entries owning RETIRED and SIBLING (never HAND) at their current hash. */
  function ownedEntries(facet: IHarnessMcpFacet): ManagedEntries {
    const actual = facet.readAll(ws);
    const entries: ManagedEntries = {};
    for (const key of [RETIRED, SIBLING]) {
      const config = actual.get(key) as McpServerConfig;
      entries[`${facet.configRelPath()}#${key}`] = managedEntry(
        hashMcpConfig(config),
        `registry/${key}`,
        'mcp',
      );
    }
    return entries;
  }

  function retiredRemoval(facet: IHarnessMcpFacet): HarnessPlanRemove {
    return {
      relPath: `${facet.configRelPath()}#${RETIRED}`,
      kind: 'mcp',
      isDirectory: false,
      mcpServerKey: RETIRED,
      retiredItemId: `mcp:${RETIRED}`,
    };
  }

  const keysIn = (file: string): string[] =>
    Object.keys(
      (JSON.parse(readFileSync(file, 'utf-8')) as { mcpServers: object })
        .mcpServers,
    ).sort();

  it('plans retiredItemId = mcpRetiredItemId(key) for a retired owned key only; a hand-added key is never planned', () => {
    const { facet } = seed('home');
    const plan = planMcpFacet(facet, [], ws, ownedEntries(facet), [
      RETIRED,
      HAND,
    ]);

    expect(plan.removals).toEqual(
      expect.arrayContaining([
        retiredRemoval(facet),
        {
          relPath: `${facet.configRelPath()}#${SIBLING}`,
          kind: 'mcp',
          isDirectory: false,
          mcpServerKey: SIBLING,
        },
      ]),
    );
    expect(plan.removals).toHaveLength(2);
    expect(plan.removals.map((r) => r.mcpServerKey)).not.toContain(HAND);
  });

  it('home config: removes the owned unchanged key, siblings and the hand-added key untouched, no git asked', async () => {
    const { facet, file } = seed('home');
    const probe = fixedProbe('unverifiable');
    const result = emptyResult();

    await applyMcpFacet(facet, [], [retiredRemoval(facet)], ws, result, {
      baseEntries: ownedEntries(facet),
      probeGitTracking: probe,
    });

    expect(keysIn(file)).toEqual([HAND, SIBLING].sort());
    const relPath = `${facet.configRelPath()}#${RETIRED}`;
    expect(relPath.startsWith('~/')).toBe(true);
    expect(result.removed).toEqual([relPath]);
    expect(result.removedRetired).toEqual([
      { relPath, itemId: `mcp:${RETIRED}` },
    ]);
    expect(result.keptRetired ?? []).toEqual([]);
    expect(probe.calls).toEqual([]);
  });

  it('home config: an edited retired key is kept `edited` and stays in the file', async () => {
    const { facet, file } = seed('home');
    const baseEntries = ownedEntries(facet);
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    parsed.mcpServers[RETIRED].args = ['retired', '--my-flag'];
    writeFileSync(file, JSON.stringify(parsed));
    const result = emptyResult();

    await applyMcpFacet(facet, [], [retiredRemoval(facet)], ws, result, {
      baseEntries,
      probeGitTracking: fixedProbe('untracked'),
    });

    expect(keysIn(file)).toEqual([HAND, RETIRED, SIBLING].sort());
    expect(result.removed).toEqual([]);
    expect(result.keptRetired).toEqual([
      {
        relPath: `${facet.configRelPath()}#${RETIRED}`,
        itemId: `mcp:${RETIRED}`,
        reason: 'edited',
      },
    ]);
  });

  it.each([
    ['tracked', 'git-tracked'],
    ['unverifiable', 'unverifiable'],
  ] as const)(
    'workspace config: git %s keeps the key as `%s`',
    async (state, reason) => {
      const { facet, file } = seed('workspace');
      const probe = fixedProbe(state);
      const result = emptyResult();

      await applyMcpFacet(facet, [], [retiredRemoval(facet)], ws, result, {
        baseEntries: ownedEntries(facet),
        probeGitTracking: probe,
      });

      expect(keysIn(file)).toEqual([HAND, RETIRED, SIBLING].sort());
      expect(result.removed).toEqual([]);
      expect(result.keptRetired).toEqual([
        {
          relPath: `.cursor/mcp.json#${RETIRED}`,
          itemId: `mcp:${RETIRED}`,
          reason,
        },
      ]);
      expect(probe.calls).toEqual([[ws, '.cursor/mcp.json']]);
    },
  );

  it('workspace config: provably untracked removes only the retired key', async () => {
    const { facet, file } = seed('workspace');
    const result = emptyResult();

    await applyMcpFacet(facet, [], [retiredRemoval(facet)], ws, result, {
      baseEntries: ownedEntries(facet),
      probeGitTracking: fixedProbe('untracked'),
    });

    expect(keysIn(file)).toEqual([HAND, SIBLING].sort());
    expect(result.removedRetired).toEqual([
      { relPath: `.cursor/mcp.json#${RETIRED}`, itemId: `mcp:${RETIRED}` },
    ]);
  });

  it('a retired key already gone from the file counts as removed', async () => {
    const { facet } = seed('home');
    const baseEntries = ownedEntries(facet);
    await facet.remove(ws, RETIRED);
    const result = emptyResult();

    await applyMcpFacet(facet, [], [retiredRemoval(facet)], ws, result, {
      baseEntries,
      probeGitTracking: fixedProbe('untracked'),
    });

    expect(result.removedRetired).toEqual([
      {
        relPath: `${facet.configRelPath()}#${RETIRED}`,
        itemId: `mcp:${RETIRED}`,
      },
    ]);
  });

  it('I/O failures stay owned: read and remove errors land in writeFailed with the item id', async () => {
    const { facet } = seed('home');
    const baseEntries = ownedEntries(facet);
    const relPath = `${facet.configRelPath()}#${RETIRED}`;

    const unreadable: IHarnessMcpFacet = {
      ...facet,
      configRelPath: () => facet.configRelPath(),
      readAll: () => {
        throw new Error('EACCES: permission denied');
      },
      remove: jest.fn(),
    };
    const readFailed = emptyResult();
    await applyMcpFacet(
      unreadable,
      [],
      [retiredRemoval(facet)],
      ws,
      readFailed,
      {
        baseEntries,
        probeGitTracking: fixedProbe('untracked'),
      },
    );
    expect(readFailed.writeFailed).toEqual([
      expect.objectContaining({ relPath, itemId: `mcp:${RETIRED}` }),
    ]);
    expect(unreadable.remove).not.toHaveBeenCalled();

    const unwritable: IHarnessMcpFacet = {
      ...facet,
      configRelPath: () => facet.configRelPath(),
      readAll: (root: string) => facet.readAll(root),
      remove: () => Promise.reject(new Error('EBUSY: resource busy')),
    };
    const removeFailed = emptyResult();
    await applyMcpFacet(
      unwritable,
      [],
      [retiredRemoval(facet)],
      ws,
      removeFailed,
      {
        baseEntries,
        probeGitTracking: fixedProbe('untracked'),
      },
    );
    expect(removeFailed.writeFailed).toEqual([
      {
        relPath,
        itemId: `mcp:${RETIRED}`,
        reason: 'failed to remove MCP entry: EBUSY: resource busy',
      },
    ]);
    for (const result of [readFailed, removeFailed]) {
      expect(result.removed).toEqual([]);
      expect(result.keptRetired ?? []).toEqual([]);
    }
  });

  it('without a retirement context a retired removal fails owned and deletes nothing', async () => {
    const { facet, file } = seed('home');
    const result = emptyResult();

    await applyMcpFacet(facet, [], [retiredRemoval(facet)], ws, result);

    expect(keysIn(file)).toEqual([HAND, RETIRED, SIBLING].sort());
    expect(result.writeFailed).toEqual([
      expect.objectContaining({ itemId: `mcp:${RETIRED}` }),
    ]);
  });

  it('real git through WorkspaceHarnessTarget: removes the untracked retired key, keeps the rest', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env['GIT_DIR'];
    delete env['GIT_WORK_TREE'];
    delete env['GIT_INDEX_FILE'];
    execFileSync('git', ['init', '-q'], { cwd: ws, env, stdio: 'ignore' });
    const { facet, file } = seed('workspace');
    const facets: HarnessFacetMatrix = {
      skills: 'unsupported',
      commands: 'unsupported',
      agents: 'unsupported',
      mcp: 'supported',
    };
    const target = new WorkspaceHarnessTarget({
      id: 'cursor',
      facets,
      manifestStore: new ManagedManifestStore(),
      detector: { isInstalled: () => Promise.resolve(true) },
      mcpFacet: facet,
    });
    const desired: HarnessDesiredState = {
      skills: [],
      commands: [],
      agents: [],
      // The sibling stays desired, so only the retired key leaves the set.
      mcp: [
        {
          serverKey: SIBLING,
          registryName: `registry/${SIBLING}`,
          config: facet.readAll(ws).get(SIBLING) as McpServerConfig,
          targets: ['cursor'],
          contentHash: hashMcpConfig(
            facet.readAll(ws).get(SIBLING) as McpServerConfig,
          ),
        },
      ],
      collisions: [],
      sources: 'ok',
      sourceRoots: [],
    };

    const plan = await target.plan(
      desired,
      ws,
      { ...emptyManifest('cursor'), entries: ownedEntries(facet) },
      undefined,
      { skillSourceRoots: [], mcpServerKeys: [RETIRED] },
    );
    const result = await target.apply(plan, ws);

    expect(keysIn(file)).toEqual([HAND, SIBLING].sort());
    expect(result.removedRetired).toEqual([
      { relPath: `.cursor/mcp.json#${RETIRED}`, itemId: `mcp:${RETIRED}` },
    ]);
    expect(result.writeFailed).toEqual([]);
  });
});
