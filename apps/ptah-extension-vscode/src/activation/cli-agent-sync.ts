// CLI Agent Sync on activation: distributes existing .claude/agents/*.md to
// all installed CLI targets. Ensures agents are present after fresh install
// without re-running the wizard. Pro/trial_pro-only fire-and-forget dispatcher.
// Caller is responsible for the tier gate and workspace-root presence.
// Mirrors the Electron sibling (apps/ptah-electron/src/activation/cli-agent-sync.ts).

import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { DIContainer } from '../di/container';

export function syncCliAgentsOnActivation(
  workspaceRoot: string,
  logger: Logger,
): void {
  (async () => {
    const { readdir, readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { createHash } = await import('crypto');

    const agentsDir = join(workspaceRoot, '.claude', 'agents');
    let agentFileNames: string[];
    try {
      const entries = await readdir(agentsDir);
      // Sort for deterministic hash regardless of readdir order on non-NTFS filesystems
      agentFileNames = entries
        .filter((f) => f.endsWith('.md') && !f.startsWith('.backup-'))
        .sort();
    } catch {
      logger.debug('CLI agent sync skipped (no .claude/agents/ directory)');
      return;
    }
    if (agentFileNames.length === 0) {
      logger.debug('CLI agent sync skipped (no agent files found)');
      return;
    }

    // Read files individually — skip unreadable files rather than aborting all
    const agentFiles = (
      await Promise.all(
        agentFileNames.map(async (name) => {
          const filePath = join(agentsDir, name);
          try {
            const content = await readFile(filePath, 'utf8');
            return { name, filePath, content };
          } catch {
            logger.debug(`CLI agent sync: skipping unreadable file ${name}`);
            return null;
          }
        }),
      )
    ).filter(
      (f): f is { name: string; filePath: string; content: string } =>
        f !== null,
    );

    if (agentFiles.length === 0) {
      logger.debug('CLI agent sync skipped (no readable agent files)');
      return;
    }

    const combinedContent = agentFiles.map((f) => f.content).join('\n---\n');
    const contentHash = createHash('sha1')
      .update(combinedContent)
      .digest('hex');

    const cliDetection = DIContainer.getContainer().resolve(
      TOKENS.CLI_DETECTION_SERVICE,
    ) as {
      detectAll: () => Promise<Array<{ cli: string; installed: boolean }>>;
    };
    const installedClis = await cliDetection.detectAll();
    const targetClis = installedClis
      .filter(
        (c) =>
          (c.cli === 'copilot' ||
            c.cli === 'gemini' ||
            c.cli === 'codex' ||
            c.cli === 'cursor') &&
          c.installed,
      )
      .map((c) => c.cli);

    if (targetClis.length === 0) {
      logger.debug('CLI agent sync skipped (no CLI targets installed)');
      return;
    }

    const agentSyncStateStorage = DIContainer.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );

    const staleTargets = targetClis.filter(
      (cli) =>
        agentSyncStateStorage.get<string>(`cli_agent_sync_hash_${cli}`) !==
        contentHash,
    );

    if (staleTargets.length === 0) {
      logger.debug('CLI agent sync skipped (all CLIs up-to-date)');
      return;
    }

    const agents = agentFiles.map((f) => {
      // Extract description from frontmatter for quality parity with wizard-generated agents
      const descMatch = /^description:\s*(.+)$/m.exec(f.content);
      const description =
        descMatch?.[1]?.trim() ?? `${f.name.replace(/\.md$/, '')} agent`;
      return {
        sourceTemplateId: f.name.replace(/\.md$/, ''),
        sourceTemplateVersion: 'unknown',
        content: f.content,
        variables: { description } as Record<string, string>,
        customizations: [],
        generatedAt: new Date(),
        // filePath is the source path; transformers derive their own target paths via homedir()
        filePath: f.filePath,
      };
    });

    const multiCliWriter = DIContainer.getContainer().resolve(
      AGENT_GENERATION_TOKENS.MULTI_CLI_AGENT_WRITER_SERVICE,
    ) as {
      writeForClis: (
        agents: unknown[],
        targetClis: string[],
      ) => Promise<
        Array<{
          cli: string;
          agentsWritten: number;
          agentsFailed: number;
        }>
      >;
    };

    const writeResults = await multiCliWriter.writeForClis(
      agents,
      staleTargets,
    );

    // Only mark CLIs as up-to-date when all agents were written successfully.
    // CLIs with write failures retain their stale hash so the next activation retries.
    const successfulClis = writeResults
      .filter((r) => r.agentsFailed === 0)
      .map((r) => r.cli);

    await Promise.all(
      successfulClis.map((cli) =>
        agentSyncStateStorage.update(`cli_agent_sync_hash_${cli}`, contentHash),
      ),
    );

    logger.info('CLI agent sync complete', {
      targets: staleTargets,
      written: successfulClis,
      agents: agents.length,
    });
  })().catch((agentSyncError) => {
    logger.debug('CLI agent sync failed (non-blocking)', {
      error:
        agentSyncError instanceof Error
          ? agentSyncError.message
          : String(agentSyncError),
    });
  });
}
