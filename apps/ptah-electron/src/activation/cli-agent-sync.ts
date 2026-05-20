
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';

/**
 * Distribute existing .claude/agents/*.md to all installed CLI targets.
 * Ensures agents are present after fresh install without re-running the wizard.
 * Pro/trial_pro-only, fire-and-forget. Caller is responsible for the license-tier gate.
 */
export function syncCliAgentsOnActivation(
  container: DependencyContainer,
  startupWorkspaceRoot: string,
): void {
  (async () => {
    const { readdir, readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { createHash } = await import('crypto');

    const agentsDir = join(startupWorkspaceRoot, '.claude', 'agents');
    let agentFileNames: string[];
    try {
      const entries = await readdir(agentsDir);
      agentFileNames = entries
        .filter((f) => f.endsWith('.md') && !f.startsWith('.backup-'))
        .sort();
    } catch {
      console.log(
        '[Ptah Electron] CLI agent sync skipped (no .claude/agents/)',
      );
      return;
    }
    if (agentFileNames.length === 0) {
      console.log('[Ptah Electron] CLI agent sync skipped (no agent files)');
      return;
    }
    const agentFiles = (
      await Promise.all(
        agentFileNames.map(async (name) => {
          const filePath = join(agentsDir, name);
          try {
            const content = await readFile(filePath, 'utf8');
            return { name, filePath, content };
          } catch {
            console.log(
              `[Ptah Electron] CLI agent sync: skipping unreadable file ${name}`,
            );
            return null;
          }
        }),
      )
    ).filter(
      (f): f is { name: string; filePath: string; content: string } =>
        f !== null,
    );

    if (agentFiles.length === 0) {
      console.log(
        '[Ptah Electron] CLI agent sync skipped (no readable agent files)',
      );
      return;
    }

    const combinedContent = agentFiles.map((f) => f.content).join('\n---\n');
    const contentHash = createHash('sha1')
      .update(combinedContent)
      .digest('hex');

    const cliDetection = container.resolve(TOKENS.CLI_DETECTION_SERVICE) as {
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
      console.log('[Ptah Electron] CLI agent sync skipped (no CLI targets)');
      return;
    }

    const agentSyncStateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );

    const staleTargets = targetClis.filter(
      (cli) =>
        agentSyncStateStorage.get<string>(`cli_agent_sync_hash_${cli}`) !==
        contentHash,
    );

    if (staleTargets.length === 0) {
      console.log(
        '[Ptah Electron] CLI agent sync skipped (all CLIs up-to-date)',
      );
      return;
    }

    const agents = agentFiles.map((f) => {
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
        filePath: f.filePath,
      };
    });

    const multiCliWriter = container.resolve(
      AGENT_GENERATION_TOKENS.MULTI_CLI_AGENT_WRITER_SERVICE,
    ) as {
      writeForClis: (
        agents: unknown[],
        targetClis: string[],
      ) => Promise<
        Array<{ cli: string; agentsWritten: number; agentsFailed: number }>
      >;
    };

    const writeResults = await multiCliWriter.writeForClis(
      agents,
      staleTargets,
    );
    const successfulClis = writeResults
      .filter((r) => r.agentsFailed === 0)
      .map((r) => r.cli);

    await Promise.all(
      successfulClis.map((cli) =>
        agentSyncStateStorage.update(`cli_agent_sync_hash_${cli}`, contentHash),
      ),
    );

    console.log(
      `[Ptah Electron] CLI agent sync complete (${successfulClis.length}/${staleTargets.length} CLIs, ${agents.length} agents)`,
    );
  })().catch((agentSyncError) => {
    console.warn(
      '[Ptah Electron] CLI agent sync failed (non-blocking):',
      agentSyncError instanceof Error
        ? agentSyncError.message
        : String(agentSyncError),
    );
  });
}
