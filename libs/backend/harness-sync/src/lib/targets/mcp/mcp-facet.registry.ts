/**
 * One definition per MCP config file, shared by the targets that WRITE them and
 * by the install surface that READS them.
 *
 * Before this existed the two disagreed by construction: `mcp-directory`'s
 * installers knew the root keys and paths, and nothing else did, so adding
 * Codex meant adding a writer in one place and hoping every lister, every
 * `--target` validator and every "where did it go" message followed. Defining
 * each file once and handing the same facet to both sides makes a mismatch
 * impossible rather than merely unlikely.
 */

import type { McpInstallTarget } from '@ptah-extension/shared';
import { CodexTomlMcpFacet } from './codex-toml-mcp-facet';
import { JsonMcpFacet } from './json-mcp-facet';
import type { IHarnessMcpFacet } from './mcp-facet.port';

export interface McpFacetOptions {
  /** Overridable so specs can redirect the user-global config files. */
  homeDir?: string;
}

/** Every target that owns an MCP config file, in a stable order. */
export const MCP_FACET_TARGETS: readonly McpInstallTarget[] = [
  'claude',
  'codex',
  'copilot',
  'cursor',
  'vscode',
];

/** The facet for one target. */
export function createMcpFacet(
  target: McpInstallTarget,
  options: McpFacetOptions = {},
): IHarnessMcpFacet {
  const home =
    options.homeDir === undefined ? {} : { homeDir: options.homeDir };

  switch (target) {
    case 'codex':
      return new CodexTomlMcpFacet(home);
    case 'copilot':
      return new JsonMcpFacet({
        target: 'copilot',
        mcpTarget: 'copilot',
        scope: 'home',
        segments: ['.copilot', 'mcp-config.json'],
        rootKey: 'mcpServers',
        includeType: false,
        ...home,
      });
    case 'cursor':
      return new JsonMcpFacet({
        target: 'cursor',
        mcpTarget: 'cursor',
        scope: 'workspace',
        segments: ['.cursor', 'mcp.json'],
        rootKey: 'mcpServers',
        includeType: false,
      });
    case 'vscode':
      return new JsonMcpFacet({
        target: 'vscode',
        mcpTarget: 'vscode',
        scope: 'workspace',
        segments: ['.vscode', 'mcp.json'],
        // The one target that keys its map `servers` and needs an explicit
        // `type` discriminant per entry.
        rootKey: 'servers',
        includeType: true,
      });
    case 'claude':
      return new JsonMcpFacet({
        target: 'claude',
        mcpTarget: 'claude',
        scope: 'workspace',
        segments: ['.mcp.json'],
        rootKey: 'mcpServers',
        // Claude infers the transport from `command` versus `url`; an explicit
        // `type` key is an unknown field to it.
        includeType: false,
      });
  }
}

/** Every facet, keyed by target. */
export function createAllMcpFacets(
  options: McpFacetOptions = {},
): Map<McpInstallTarget, IHarnessMcpFacet> {
  return new Map(
    MCP_FACET_TARGETS.map((target) => [
      target,
      createMcpFacet(target, options),
    ]),
  );
}
