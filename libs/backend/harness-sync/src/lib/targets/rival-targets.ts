/**
 * The five non-Claude harness targets, as configurations of one engine.
 *
 * Each entry below is the complete answer to "where does this tool look for its
 * harness, and what can it accept". They are deliberately data, not classes:
 * the behaviour lives in `WorkspaceHarnessTarget`, and a new CLI is a new entry
 * here plus (if its agent format is novel) one transformer.
 *
 * ## Target × facet matrix
 *
 * | Target      | skills                  | commands                | agents                        | mcp                          |
 * |-------------|-------------------------|-------------------------|-------------------------------|------------------------------|
 * | codex       | `{ws}/.agents/skills`   | **unsupported**         | `{ws}/.codex/agents/*.toml`   | `~/.codex/config.toml`       |
 * | copilot     | `{ws}/.github/skills`   | **unsupported**         | `{ws}/.github/agents/*.agent.md` | `~/.copilot/mcp-config.json` |
 * | cursor      | `{ws}/.cursor/skills`   | `{ws}/.cursor/commands` | `{ws}/.cursor/agents/*.md`    | `{ws}/.cursor/mcp.json`      |
 * | antigravity | `{ws}/.agents/skills`   | **unsupported**         | **unsupported**               | **unsupported**              |
 * | vscode      | **unsupported**         | **unsupported**         | **unsupported**               | `{ws}/.vscode/mcp.json`      |
 *
 * ### Why the `unsupported` cells are unsupported
 *
 * - **Codex commands.** Codex rejects project-scoped prompts; the prompt
 *   directory is home-only upstream (openai/codex#9848). Writing them into the
 *   workspace produced files Codex never read.
 * - **Copilot commands.** Copilot documents no project prompt directory
 *   (github/copilot-cli#2829).
 * - **Antigravity commands.** `agy`'s customization surface is Rules, Skills,
 *   Plugins, Hooks and MCP. There is no slash-command concept to target.
 * - **Antigravity agents.** `agy` documents no subagent format. A transformer
 *   would have to invent a file layout the CLI does not read, so the facet
 *   reports `unsupported` and the health surface says so out loud rather than
 *   showing agents permanently missing.
 * - **Antigravity MCP.** `agy` reads `~/.gemini/config/mcp_config.json`, and
 *   `AntigravityCliAdapter` already writes Ptah's own server there at spawn.
 *   User-installed servers for `agy` are not offered by the install surface, so
 *   there is no intent to reconcile; adding the facet would mean adding the
 *   target to `McpInstallTarget` with no UI behind it.
 * - **VS Code skills/commands/agents.** VS Code is an editor, not a CLI agent
 *   harness. It appears here solely because `.vscode/mcp.json` is a real MCP
 *   surface the install RPC has always offered.
 *
 * ## Codex and Antigravity share `{ws}/.agents/skills`
 *
 * That is `agy`'s native workspace root and also where Codex discovers skills.
 * Both targets are declared co-owners of the other, so each accepts the other's
 * manifest as proof of Ptah ownership. Without it, whichever CLI was installed
 * second would find the directory full of files it could not prove it wrote,
 * classify every one of them foreign, and never update a skill again.
 */

import { homedir } from 'os';
import { join } from 'path';
import type { HarnessFacetMatrix } from '@ptah-extension/shared';
import type { ManagedManifestStore } from '../manifest-store/managed-manifest';
import type { IHarnessCliDetector } from '../sources/harness-source.port';
import type { IHarnessTarget } from './harness-target.port';
import { createMcpFacet } from './mcp/mcp-facet.registry';
import { CodexAgentTransformer } from './transformers/codex-agent-transformer';
import { CopilotAgentTransformer } from './transformers/copilot-agent-transformer';
import { CursorAgentTransformer } from './transformers/cursor-agent-transformer';
import { WorkspaceHarnessTarget } from './workspace-target';

/** Prefixes of the home-directory copies the pre-reconciler pipeline left behind. */
export const LEGACY_HOME_PREFIXES: readonly string[] = ['ptah-', 'ptahsynth-'];

function facets(supported: Partial<HarnessFacetMatrix>): HarnessFacetMatrix {
  return {
    skills: 'unsupported',
    commands: 'unsupported',
    agents: 'unsupported',
    mcp: 'unsupported',
    ...supported,
  };
}

/** Facet options derived from the shared target dependencies. */
function facetOptions(deps: RivalTargetDeps): { homeDir?: string } {
  return deps.homeDir === undefined ? {} : { homeDir: deps.homeDir };
}

/** What every target factory needs from the host container. */
export interface RivalTargetDeps {
  manifestStore: ManagedManifestStore;
  detector: IHarnessCliDetector;
  /** Overridable so specs can redirect user-global config files. */
  homeDir?: string;
}

export function createCodexTarget(deps: RivalTargetDeps): IHarnessTarget {
  return new WorkspaceHarnessTarget({
    id: 'codex',
    facets: facets({
      skills: 'supported',
      agents: 'supported',
      mcp: 'supported',
    }),
    manifestStore: deps.manifestStore,
    detector: deps.detector,
    skillsDirRel: '.agents/skills',
    agentTransformer: new CodexAgentTransformer(),
    mcpFacet: createMcpFacet('codex', facetOptions(deps)),
    coOwners: ['antigravity'],
  });
}

export function createCopilotTarget(deps: RivalTargetDeps): IHarnessTarget {
  return new WorkspaceHarnessTarget({
    id: 'copilot',
    facets: facets({
      skills: 'supported',
      agents: 'supported',
      mcp: 'supported',
    }),
    manifestStore: deps.manifestStore,
    detector: deps.detector,
    skillsDirRel: '.github/skills',
    agentTransformer: new CopilotAgentTransformer(),
    mcpFacet: createMcpFacet('copilot', facetOptions(deps)),
    // Copilot resolves agents home-first, so a `ptah-` copy left in
    // `~/.copilot/agents` by the deleted pipeline silently shadows the
    // workspace copy Ptah just wrote (E19).
    homeReap: {
      dir: () => join(deps.homeDir ?? homedir(), '.copilot', 'agents'),
      prefixes: LEGACY_HOME_PREFIXES,
    },
  });
}

export function createCursorTarget(deps: RivalTargetDeps): IHarnessTarget {
  return new WorkspaceHarnessTarget({
    id: 'cursor',
    facets: facets({
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    }),
    manifestStore: deps.manifestStore,
    detector: deps.detector,
    skillsDirRel: '.cursor/skills',
    commandsDirRel: '.cursor/commands',
    agentTransformer: new CursorAgentTransformer(),
    mcpFacet: createMcpFacet('cursor', facetOptions(deps)),
  });
}

export function createAntigravityTarget(deps: RivalTargetDeps): IHarnessTarget {
  return new WorkspaceHarnessTarget({
    id: 'antigravity',
    facets: facets({ skills: 'supported' }),
    manifestStore: deps.manifestStore,
    detector: deps.detector,
    skillsDirRel: '.agents/skills',
    coOwners: ['codex'],
  });
}

export function createVscodeMcpTarget(deps: RivalTargetDeps): IHarnessTarget {
  return new WorkspaceHarnessTarget({
    id: 'vscode',
    facets: facets({ mcp: 'supported' }),
    manifestStore: deps.manifestStore,
    // VS Code is the host in one of the three runtimes and simply present in
    // the others' eyes; there is no binary to probe for, and gating on one
    // would silently drop `.vscode/mcp.json` installs.
    detector: { isInstalled: () => Promise.resolve(true) },
    mcpFacet: createMcpFacet('vscode', facetOptions(deps)),
  });
}

/** Every rival target, in a stable order. */
export function createRivalTargets(deps: RivalTargetDeps): IHarnessTarget[] {
  return [
    createCodexTarget(deps),
    createCopilotTarget(deps),
    createCursorTarget(deps),
    createAntigravityTarget(deps),
    createVscodeMcpTarget(deps),
  ];
}
