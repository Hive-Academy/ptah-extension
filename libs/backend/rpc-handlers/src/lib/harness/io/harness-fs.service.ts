/**
 * HarnessFsService.
 *
 * Owns the harness wizard's local filesystem surface:
 *   - `createSkillPlugin` writes a custom skill plugin to
 *     `~/.ptah/plugins/ptah-harness-{slug}/skills/{slug}/SKILL.md` (frontmatter
 *     escaping + tool-name sanitisation included).
 *   - `discoverMcpServers` reads `.vscode/mcp.json` and `.mcp.json` from the
 *     workspace root, prefixing the always-on built-in `ptah-mcp` server. ENOENT
 *     is silent; other read errors are logged via the injected `Logger`.
 *
 * Extracted from `harness-rpc.handlers.ts` (`registerCreateSkill` and
 * `registerDiscoverMcp`) to keep the handler free of `fs`/`path`/`os` imports.
 *
 * Behaviour is byte-identical to the pre-extraction implementation — the only
 * change is WHERE the code lives.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  HarnessCreateSkillParams,
  HarnessCreateSkillResponse,
  HarnessDiscoverMcpResponse,
} from '@ptah-extension/shared';

import { HARNESS_TOKENS } from '../tokens';
import type { HarnessWorkspaceContextService } from '../workspace/harness-workspace-context.service';

@injectable()
export class HarnessFsService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(HARNESS_TOKENS.WORKSPACE_CONTEXT)
    private readonly workspaceContext: HarnessWorkspaceContextService,
  ) {}

  /**
   * Create a custom skill plugin under `~/.ptah/plugins/ptah-harness-{slug}/`.
   *
   * The skill name is normalised to a kebab-case slug. YAML frontmatter values
   * are escaped to prevent malformed output for names/descriptions containing
   * quotes or newlines. Tool names are sanitised to a strict character set
   * before embedding so a tool name string cannot inject extra YAML keys.
   */
  async createSkillPlugin(
    params: HarnessCreateSkillParams,
  ): Promise<HarnessCreateSkillResponse> {
    const sanitizedName = params.name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (sanitizedName.length === 0) {
      throw new Error(
        'Invalid skill name: must contain at least one alphanumeric character',
      );
    }

    const pluginDir = path.join(
      os.homedir(),
      '.ptah',
      'plugins',
      `ptah-harness-${sanitizedName}`,
    );
    const skillDir = path.join(pluginDir, 'skills', sanitizedName);
    const skillMdPath = path.join(skillDir, 'SKILL.md');

    await fs.mkdir(skillDir, { recursive: true });

    // Escape values for YAML frontmatter: quote strings and escape
    // inner double-quotes and newlines to prevent malformed YAML
    const escapedName = params.name.replace(/"/g, '\\"');
    const escapedDesc = params.description
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    // Sanitize tool names before embedding in YAML to prevent injection
    // via newlines or special characters in a tool name string.
    const safeToolName = (t: string) => t.replace(/[^\w:/.\\-]/g, '');
    const toolsSection =
      params.allowedTools && params.allowedTools.length > 0
        ? `\nallowed_tools:\n${params.allowedTools.map((t) => `  - ${safeToolName(t)}`).join('\n')}`
        : '';

    const skillContent = [
      '---',
      `name: "${escapedName}"`,
      `description: "${escapedDesc}"`,
      `source: custom${toolsSection}`,
      '---',
      '',
      params.content,
      '',
    ].join('\n');

    await fs.writeFile(skillMdPath, skillContent, 'utf-8');

    return { skillId: sanitizedName, skillPath: skillMdPath };
  }

  /**
   * Discover MCP servers visible to the current workspace.
   *
   * Always prepends the built-in `ptah-mcp` server, then reads
   * `.vscode/mcp.json` and `.mcp.json` from the workspace root (in that order).
   * Both `servers` and `mcpServers` keys are accepted. Only server names are
   * surfaced — env, args, and credentials are deliberately not forwarded.
   *
   * ENOENT is silent. Any other read/parse error is logged via `logger.warn`
   * and the file is treated as empty, so a malformed config never blocks
   * discovery.
   */
  async discoverMcpServers(): Promise<HarnessDiscoverMcpResponse> {
    const servers: Array<{
      name: string;
      url: string;
      description?: string;
      enabled: boolean;
    }> = [];

    // Always include built-in Ptah MCP server
    servers.push({
      name: 'ptah-mcp',
      url: 'http://localhost:0', // Port assigned dynamically at runtime
      description:
        'Built-in Ptah MCP server providing workspace analysis, code execution, browser automation, and agent orchestration tools',
      enabled: true,
    });

    const wsRoot = this.workspaceContext.requireWorkspaceRoot();

    // Read .vscode/mcp.json — async-only, handle ENOENT in catch to avoid
    // blocking the event loop with existsSync and the TOCTOU race it creates.
    // Only extract server names — never forward env/args/credentials.
    const vscodeMcpPath = path.join(wsRoot, '.vscode', 'mcp.json');
    try {
      const raw = await fs.readFile(vscodeMcpPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const mcpServers =
        (parsed['servers'] as Record<string, unknown>) ??
        (parsed['mcpServers'] as Record<string, unknown>) ??
        {};
      for (const name of Object.keys(mcpServers)) {
        servers.push({
          name,
          url: '',
          description: 'From .vscode/mcp.json',
          enabled: true,
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `RPC: harness:discover-mcp failed to read .vscode/mcp.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Read .mcp.json from workspace root — same pattern.
    const rootMcpPath = path.join(wsRoot, '.mcp.json');
    try {
      const raw = await fs.readFile(rootMcpPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const mcpServers =
        (parsed['servers'] as Record<string, unknown>) ??
        (parsed['mcpServers'] as Record<string, unknown>) ??
        {};
      for (const name of Object.keys(mcpServers)) {
        servers.push({
          name,
          url: '',
          description: 'From .mcp.json',
          enabled: true,
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `RPC: harness:discover-mcp failed to read .mcp.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { servers };
  }
}
