import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  AGENT_GENERATION_TOKENS,
  extractFrontmatterDescription,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';

const RIVAL_HOME_REAPED_AT = 'rival_home_reaped_at';
const LEGACY_PREFIXES = ['ptah-', 'ptahsynth-'];

/**
 * Distribute user-layer agents (~/.ptah/user/agents) to all installed rival
 * CLIs at the WORKSPACE level. Pro/trial_pro-only, fire-and-forget. Also runs a
 * one-time reap of stale Ptah-managed home copies so they don't shadow the new
 * workspace copies.
 */
export function syncCliAgentsOnActivation(
  container: DependencyContainer,
  startupWorkspaceRoot: string,
): void {
  (async () => {
    const { readdir, readFile, rm } = await import('fs/promises');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const { createHash } = await import('crypto');

    await reapStaleHomeAgents(container, { readdir, rm, join, homedir });

    const mirror = container.resolve<UserLayerMirrorService>(
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
      console.log(
        '[Ptah Electron] CLI agent sync skipped (no ~/.ptah/user/agents)',
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
      .update(`${startupWorkspaceRoot}|${combinedContent}`)
      .digest('hex');

    const cliDetection = container.resolve(TOKENS.CLI_DETECTION_SERVICE) as {
      detectAll: () => Promise<Array<{ cli: string; installed: boolean }>>;
    };
    const installedClis = await cliDetection.detectAll();
    const targetClis = installedClis
      .filter(
        (c) =>
          (c.cli === 'copilot' || c.cli === 'codex' || c.cli === 'cursor') &&
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
        agentSyncStateStorage.get<string>(`cli_agent_sync_hash_v2_${cli}`) !==
        contentHash,
    );

    if (staleTargets.length === 0) {
      console.log(
        '[Ptah Electron] CLI agent sync skipped (all CLIs up-to-date)',
      );
      return;
    }

    const agents = agentFiles.map((f) => {
      const fallback = `${f.name.replace(/\.md$/, '')} agent`;
      const description = extractFrontmatterDescription(f.content) ?? fallback;
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
        workspaceRoot: string,
      ) => Promise<
        Array<{ cli: string; agentsWritten: number; agentsFailed: number }>
      >;
    };

    const writeResults = await multiCliWriter.writeForClis(
      agents,
      staleTargets,
      startupWorkspaceRoot,
    );
    const successfulClis = writeResults
      .filter((r) => r.agentsFailed === 0)
      .map((r) => r.cli);

    await Promise.all(
      successfulClis.map((cli) =>
        agentSyncStateStorage.update(
          `cli_agent_sync_hash_v2_${cli}`,
          contentHash,
        ),
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

async function reapStaleHomeAgents(
  container: DependencyContainer,
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
    const stateStorage = container.resolve<IStateStorage>(
      PLATFORM_TOKENS.STATE_STORAGE,
    );
    if (stateStorage.get<number>(RIVAL_HOME_REAPED_AT) !== undefined) {
      return;
    }
    const home = fns.homedir();
    const dirs = [
      fns.join(home, '.codex', 'agents'),
      fns.join(home, '.copilot', 'agents'),
      fns.join(home, '.cursor', 'agents'),
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
    console.log(
      `[Ptah Electron] Stale rival home copies reaped (${removed} entries)`,
    );
  } catch (reapError) {
    console.warn(
      '[Ptah Electron] Stale home reap failed (non-fatal):',
      reapError instanceof Error ? reapError.message : String(reapError),
    );
  }
}
