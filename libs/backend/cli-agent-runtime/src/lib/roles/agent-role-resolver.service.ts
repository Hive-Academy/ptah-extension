import { join } from 'path';
import { inject, injectable } from 'tsyringe';
import {
  FileType,
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import {
  extractFrontmatterDescription,
  resolveHarnessWorkspaceRoot,
  stripFrontmatter,
} from '@ptah-extension/harness-sync';
import type { AgentRoleDefinition } from '@ptah-extension/shared';

export const MAX_ROLE_BYTES = 64 * 1024;

const ROLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const ROLE_FILE_EXTENSION = '.md';

export type AgentRoleErrorCode =
  | 'invalid_role_name'
  | 'no_roles'
  | 'unknown_role'
  | 'empty_role'
  | 'role_too_large'
  | 'role_read_failed';

export class AgentRoleError extends Error {
  readonly availableRoles: string[];

  constructor(
    readonly code: AgentRoleErrorCode,
    message: string,
    availableRoles: readonly string[] = [],
  ) {
    super(message);
    this.name = 'AgentRoleError';
    this.availableRoles = [...availableRoles];
  }
}

@injectable()
export class AgentRoleResolver {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
  ) {}

  async listRoles(workspaceRoot: string): Promise<string[]> {
    const agentsDir = this.agentsDirFor(
      resolveHarnessWorkspaceRoot(workspaceRoot),
    );
    return (await this.listRoleFiles(agentsDir)).map((file) => file.role);
  }

  async resolve(
    workspaceRoot: string,
    role: string,
  ): Promise<AgentRoleDefinition> {
    if (!ROLE_NAME_PATTERN.test(role)) {
      throw new AgentRoleError(
        'invalid_role_name',
        `Invalid role name ${JSON.stringify(role)}. A role name starts with a letter or digit and contains only letters, digits, ".", "_" or "-" (at most 100 characters).`,
      );
    }

    const harnessRoot = resolveHarnessWorkspaceRoot(workspaceRoot);
    const agentsDir = this.agentsDirFor(harnessRoot);
    const roleFiles = await this.listRoleFiles(agentsDir);
    const availableRoles = roleFiles.map((file) => file.role);

    if (roleFiles.length === 0) {
      throw new AgentRoleError(
        'no_roles',
        `No roles are defined for workspace ${harnessRoot}: ${agentsDir} has no role files. The setup wizard generates roles into that directory. Spawning without "role" is valid.`,
      );
    }

    const match = roleFiles.find((file) => file.role === role);
    if (!match) {
      throw new AgentRoleError(
        'unknown_role',
        `Unknown role "${role}" for workspace ${harnessRoot}. Available roles: ${availableRoles.join(', ')}.`,
        availableRoles,
      );
    }

    const sourcePath = join(agentsDir, match.fileName);
    let raw: string;
    try {
      raw = await this.fileSystem.readFile(sourcePath);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AgentRoleError(
        'role_read_failed',
        `Failed to read role "${role}" from ${sourcePath} (workspace ${harnessRoot}): ${reason}. Available roles: ${availableRoles.join(', ')}.`,
        availableRoles,
      );
    }

    const body = stripFrontmatter(raw);
    if (body.trim() === '') {
      throw new AgentRoleError(
        'empty_role',
        `Role "${role}" at ${sourcePath} (workspace ${harnessRoot}) has no content after its frontmatter. Available roles: ${availableRoles.join(', ')}.`,
        availableRoles,
      );
    }

    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > MAX_ROLE_BYTES) {
      throw new AgentRoleError(
        'role_too_large',
        `Role "${role}" at ${sourcePath} (workspace ${harnessRoot}) is ${bytes} bytes; the limit is ${MAX_ROLE_BYTES} bytes. Available roles: ${availableRoles.join(', ')}.`,
        availableRoles,
      );
    }

    const description = extractFrontmatterDescription(raw);
    return {
      name: match.role,
      ...(description !== undefined ? { description } : {}),
      body,
      sourcePath,
      bytes,
    };
  }

  private agentsDirFor(harnessRoot: string): string {
    return join(harnessRoot, '.claude', 'agents');
  }

  private async listRoleFiles(
    agentsDir: string,
  ): Promise<Array<{ role: string; fileName: string }>> {
    try {
      if (!(await this.fileSystem.exists(agentsDir))) {
        return [];
      }
      const entries = await this.fileSystem.readDirectory(agentsDir);
      return entries
        .filter(
          (entry) =>
            entry.type === FileType.File &&
            entry.name.endsWith(ROLE_FILE_EXTENSION),
        )
        .map((entry) => ({
          role: entry.name.slice(0, -ROLE_FILE_EXTENSION.length),
          fileName: entry.name,
        }))
        .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0));
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AgentRoleError(
        'role_read_failed',
        `Failed to list roles in ${agentsDir}: ${reason}.`,
      );
    }
  }
}
