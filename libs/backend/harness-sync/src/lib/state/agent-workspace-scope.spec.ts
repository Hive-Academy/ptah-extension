/**
 * The two halves of the agent workspace scope (TASK_2026_365).
 *
 * READER — `PluginConfigSourceResolver.resolve(ws)` must point `agentsRoot` at
 * one workspace's clones, so `buildAgents()` cannot see another project's.
 *
 * WRITER — `resolveAgentMirrorSource(ws, gate)` must hand the host the SAME
 * root, and must not mirror at all into a workspace that has not consented.
 *
 * Both are tested here because their one shared failure is silent: a reader and
 * a writer that disagree about the directory leave the reconciler with an empty
 * desired state, and agents are manifest-owned, so an empty desired state
 * DELETES every `.codex/agents/*.toml` and `.github/agents/*.agent.md` the
 * workspace has.
 */

import { homedir } from 'os';
import { join } from 'path';
import { userLayerAgentDirName } from '@ptah-extension/shared';
import {
  resolveAgentMirrorSource,
  type AgentConsentReader,
} from './agent-sync-gate';
import {
  PluginConfigSourceResolver,
  defaultHarnessSourceLayout,
  scopeAgentsRoot,
} from '../sources/plugin-config-source-resolver';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';

const WS_A = join(homedir(), 'projects', 'alpha');
const WS_B = join(homedir(), 'projects', 'beta');

function gateAnswering(enabled: boolean): AgentConsentReader {
  return { resolve: () => ({ enabled }) };
}

describe('the reader half — resolve(workspaceRoot) scopes agentsRoot', () => {
  const resolver = new PluginConfigSourceResolver(() => null);

  it('gives two workspaces two agent roots', () => {
    const a = resolver.resolve(WS_A).layout.agentsRoot;
    const b = resolver.resolve(WS_B).layout.agentsRoot;
    expect(a).not.toBe(b);
  });

  it('leaves the per-machine skill and command roots flat', () => {
    // Only agents are per-project. Scoping a skill root would fork one
    // installed skill into a copy per workspace.
    const a = resolver.resolve(WS_A).layout;
    const b = resolver.resolve(WS_B).layout;
    expect(a.skillsRoot).toBe(b.skillsRoot);
    expect(a.commandsRoot).toBe(b.commandsRoot);
  });

  it('scopes the READ-FAILURE state too, not only the success path', () => {
    // The resolver returns an `empty` state on any reader failure. An empty
    // state carrying the UNSCOPED root would let a transient plugin-loader
    // failure read the base directory as this workspace's desired state.
    const failing = new PluginConfigSourceResolver(() => {
      throw new Error('loader not ready');
    });
    expect(failing.resolve(WS_A).layout.agentsRoot).toBe(
      resolver.resolve(WS_A).layout.agentsRoot,
    );
  });

  it('falls back to the unscoped base when no root is given', () => {
    // No path that builds a desired state reaches this: the reconciler resolves
    // the root at its entry point and passes it from `reconcile` and `verify`.
    expect(resolver.resolve().layout.agentsRoot).toBe(
      defaultHarnessSourceLayout().agentsRoot,
    );
  });

  it('appends exactly the key `shared` derives, under the base', () => {
    const base = defaultHarnessSourceLayout();
    expect(scopeAgentsRoot(base, WS_A).agentsRoot).toBe(
      join(base.agentsRoot, userLayerAgentDirName(WS_A)),
    );
  });
});

describe('the writer half — resolveAgentMirrorSource', () => {
  it('names the source directory and the root, for a consented workspace', () => {
    expect(resolveAgentMirrorSource(WS_A, gateAnswering(true))).toEqual({
      agentSourceDir: join(WS_A, '.claude', 'agents'),
      workspaceRoot: WS_A,
    });
  });

  it('mirrors NOTHING for a workspace that has not consented', () => {
    // The defect: every host passed `agentSourceDir` unconditionally, so any
    // repository shipping `.claude/agents` populated the machine-wide layer on
    // its first activation, before the setup wizard had ever run.
    expect(resolveAgentMirrorSource(WS_A, gateAnswering(false))).toEqual({});
  });

  it('mirrors when the gate is absent, because absent is a wiring gap', () => {
    // Mirroring only ever CREATES clones, so an unknown answer falls to the
    // non-destructive side. The reconciler resolves the gate itself before it
    // can delete anything.
    expect(resolveAgentMirrorSource(WS_A, null)).toEqual({
      agentSourceDir: join(WS_A, '.claude', 'agents'),
      workspaceRoot: WS_A,
    });
  });

  it('names nothing when no folder is open', () => {
    expect(resolveAgentMirrorSource(undefined, gateAnswering(true))).toEqual(
      {},
    );
    expect(resolveAgentMirrorSource('', gateAnswering(true))).toEqual({});
  });

  it('hands back the root the READER keys on, not the caller’s spelling', () => {
    // This is the whole point of resolving here. A host that passed its raw
    // folder would mirror into a directory the reconciler never reads, and the
    // reconciler would then reap every agent copy it owns.
    const raw = join(WS_A, 'apps', 'nested');
    const written = resolveAgentMirrorSource(raw, null).workspaceRoot;
    expect(written).toBe(resolveHarnessWorkspaceRoot(raw));

    const resolver = new PluginConfigSourceResolver(() => null);
    expect(
      scopeAgentsRoot(defaultHarnessSourceLayout(), written).agentsRoot,
    ).toBe(
      resolver.resolve(resolveHarnessWorkspaceRoot(raw)).layout.agentsRoot,
    );
  });
});
