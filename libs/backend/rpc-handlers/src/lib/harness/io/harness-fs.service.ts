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
 * Discovery of the `ptah-harness-*` directories this service writes is NOT here:
 * it lives in `PluginLoaderService.discoverHarnessPluginPaths()` (agent-sdk), so
 * `resolveCurrentPluginPaths()` is the single source of truth for every junction
 * call site instead of an ad-hoc merge at one of them.
 *
 * Behaviour is byte-identical to the pre-extraction implementation — the only
 * change is WHERE the code lives.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { UserLayerMirrorService } from '@ptah-extension/agent-generation';
import {
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  resolveSkillsRoot,
} from '@ptah-extension/skill-synthesis';
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
    /**
     * Mirror the plugin we just wrote into `~/.ptah/user/skills/<slug>` the
     * moment it exists.
     *
     * Without this, a harness-authored skill reached the workspace only through
     * the junction overlay: no user-layer clone, therefore no sidecar, no
     * divergence tracking, and nothing for the rival-CLI sync to copy — defect 6
     * / edge case E15. Optional because the CLI tier registers no mirror; there
     * the plugin still lands on disk and is picked up by the next host's
     * `mirrorAll`.
     */
    @inject(USER_LAYER_MIRROR_SERVICE_TOKEN, { isOptional: true })
    private readonly mirror: UserLayerMirrorService | null = null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null = null,
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
    const escapedName = params.name.replace(/"/g, '\\"');
    const escapedDesc = params.description
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
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

    // Not an unconditional overwrite. Re-running create/apply with the SAME
    // body used to rewrite the file anyway, which changes nothing on disk but
    // does change the mtime — and a mirror pass that then fast-forwards the
    // clone snapshots a "previous version" identical to the current one. An
    // identical body is a no-op; a changed body is the user's explicit intent
    // and still wins.
    if (await this.isIdenticalOnDisk(skillMdPath, skillContent)) {
      this.logger.debug(
        'RPC: harness:create-skill — body unchanged, leaving the plugin as it is',
        { skillId: sanitizedName },
      );
    } else {
      await fs.writeFile(skillMdPath, skillContent, 'utf-8');
    }

    await this.mirrorHarnessPlugin(pluginDir);

    return { skillId: sanitizedName, skillPath: skillMdPath };
  }

  private async isIdenticalOnDisk(
    filePath: string,
    content: string,
  ): Promise<boolean> {
    try {
      return (await fs.readFile(filePath, 'utf-8')) === content;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `RPC: harness:create-skill could not read the existing SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  /**
   * Clone this one harness plugin into the user layer immediately.
   *
   * `harnessPluginRoots` rather than `pluginPaths` because that is the channel
   * the mirror uses for `ptah-harness-*` — same treatment, different producer.
   * `synthesizedSkillsRoot` is passed so the sweep has a root to compare
   * against; the mirror is create-if-absent, so naming it costs a directory
   * walk and never rewrites anything.
   *
   * Non-fatal: a failed mirror must not fail the skill the user just authored.
   */
  private async mirrorHarnessPlugin(pluginDir: string): Promise<void> {
    if (!this.mirror) return;
    try {
      await this.mirror.mirrorAll({
        pluginPaths: [],
        harnessPluginRoots: [pluginDir],
        synthesizedSkillsRoot: resolveSkillsRoot(this.workspace),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `RPC: harness:create-skill mirrored no user-layer clone: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    servers.push({
      name: 'ptah-mcp',
      url: 'http://localhost:0', // Port assigned dynamically at runtime
      description:
        'Built-in Ptah MCP server providing workspace analysis, code execution, browser automation, and agent orchestration tools',
      enabled: true,
    });

    const wsRoot = this.workspaceContext.requireWorkspaceRoot();
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
