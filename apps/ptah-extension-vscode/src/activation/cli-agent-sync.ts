import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  AGENT_GENERATION_TOKENS,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import { DIContainer } from '../di/container';

const RIVAL_HOME_REAPED_AT = 'rival_home_reaped_at';
const LEGACY_PREFIXES = ['ptah-', 'ptahsynth-'];

export function syncCliAgentsOnActivation(
  workspaceRoot: string,
  logger: Logger,
): void {
  (async () => {
    const { readdir, readFile, rm } = await import('fs/promises');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const { createHash } = await import('crypto');

    await reapStaleHomeAgents(logger, { readdir, rm, join, homedir });

    const mirror = DIContainer.getContainer().resolve<UserLayerMirrorService>(
      AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
    );
    const agentsDir = mirror.getUserLayerRoots().agents;
    let agentFileNames: string[];
    try {
      const entries = await readdir(agentsDir);
      agentFileNames = entries
        .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
        .sort();
    } catch {
      logger.debug('CLI agent sync skipped (no ~/.ptah/user/agents directory)');
      return;
    }
    if (agentFileNames.length === 0) {
      logger.debug('CLI agent sync skipped (no agent files found)');
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
      .update(`${workspaceRoot}|${combinedContent}`)
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

    const multiCliWriter = DIContainer.getContainer().resolve(
      AGENT_GENERATION_TOKENS.MULTI_CLI_AGENT_WRITER_SERVICE,
    ) as {
      writeForClis: (
        agents: unknown[],
        targetClis: string[],
        workspaceRoot: string,
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
      workspaceRoot,
    );
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

async function reapStaleHomeAgents(
  logger: Logger,
  fns: {
    readdir: (p: string) => Promise<string[]>;
    rm: (
      p: string,
      opts: { recursive?: boolean; force?: boolean },
    ) => Promise<void>;
    join: (...parts: string[]) => string;
    homedir: () => string;
  },
): Promise<void> {
  try {
    const stateStorage = DIContainer.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    if (stateStorage.get<number>(RIVAL_HOME_REAPED_AT) !== undefined) {
      return;
    }
    const home = fns.homedir();
    const dirs = [
      fns.join(home, '.gemini', 'agents'),
      fns.join(home, '.codex', 'agents'),
      fns.join(home, '.copilot', 'agents'),
      fns.join(home, '.cursor', 'agents'),
      fns.join(home, '.gemini', 'skills'),
      fns.join(home, '.codex', 'skills'),
      fns.join(home, '.agents', 'skills'),
      fns.join(home, '.copilot', 'skills'),
      fns.join(home, '.cursor', 'skills'),
    ];
    let removed = 0;
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = await fns.readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (LEGACY_PREFIXES.some((p) => entry.startsWith(p))) {
          await fns.rm(fns.join(dir, entry), { recursive: true, force: true });
          removed++;
        }
      }
    }
    await stateStorage.update(RIVAL_HOME_REAPED_AT, Date.now());
    logger.info('Stale rival home copies reaped', { removed });
  } catch (reapError) {
    logger.debug('Stale home reap failed (non-fatal)', {
      error: reapError instanceof Error ? reapError.message : String(reapError),
    });
  }
}
