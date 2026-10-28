/**
 * The post-run Library pass of one wizard generation invocation.
 *
 * After a run wrote agent files under the harness root this service grants
 * the `agents` sync consent, propagates the files (user-layer mirror, then
 * reconcile), decides `libraryPass` and lists the written agents whose
 * edited Library copy is now diverged. The decisions themselves are the pure
 * helpers in `generation-library-outcome.ts`; this service supplies the
 * reads.
 *
 * Every agents run gets these facts, tab-bound or not (TASK_2026_701 A4).
 * Nothing here changes a per-file outcome: a failed pass leaves the written
 * files, and the outcomes reported for them, exactly as they were.
 */

import * as path from 'path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AGENT_GENERATION_TOKENS,
  type GenerationCheckpointManifest,
  type UserLayerMirrorService,
  type WizardAgentOriginStore,
} from '@ptah-extension/agent-generation';
import {
  HARNESS_SYNC_TOKENS,
  resolveHarnessWorkspaceRoot,
  type AgentSyncGate,
  type HarnessPropagationService,
  type UserLayerRefreshStatus,
} from '@ptah-extension/harness-sync';
import type {
  GenerationAgentOutcome,
  SetupGenerationResultFacts,
} from '@ptah-extension/shared';
import {
  collectLibraryDiverged,
  libraryPassFor,
  writtenAgentIds,
} from './generation-library-outcome';

/**
 * Where a run writes, as far as the Library is concerned. Only files under
 * the harness root are a Library source; a run that writes under another
 * (opened) folder records no origin, grants no consent and runs no pass.
 */
export interface RunLibraryScope {
  harnessRoot: string;
  outputRoot: string;
  atHarnessRoot: boolean;
}

type PropagationFacts = NonNullable<SetupGenerationResultFacts['propagation']>;

/** Post-run facts of one invocation, persisted beside its outcomes. */
export interface PostRunFacts {
  propagation: PropagationFacts;
  library: NonNullable<GenerationCheckpointManifest['library']>;
}

/** What the pass reads from a settled invocation. */
export interface SettledWrites {
  writtenCount: number;
  outcomes: readonly GenerationAgentOutcome[];
}

/** Whether two paths name the same folder (case-insensitive on Windows). */
function samePath(a: string, b: string): boolean {
  return path.relative(path.resolve(a), path.resolve(b)) === '';
}

/**
 * The Library scope of a run from its manifest. A manifest written before
 * runs carried an output root writes under the workspace it was found in.
 */
export function libraryScopeOf(
  workspaceRoot: string,
  manifest: Pick<GenerationCheckpointManifest, 'target' | 'outputRoot'> | null,
): RunLibraryScope {
  const harnessRoot =
    manifest?.target?.harnessRoot ?? resolveHarnessWorkspaceRoot(workspaceRoot);
  const outputRoot = manifest?.outputRoot ?? workspaceRoot;
  return {
    harnessRoot,
    outputRoot,
    atHarnessRoot: samePath(outputRoot, harnessRoot),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class GenerationLibraryPassService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE)
    private readonly originStore: Pick<WizardAgentOriginStore, 'read'>,
    // Optional host capabilities: a host without harness sync has no
    // consent gate, no propagation and so no Library.
    @inject(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, { isOptional: true })
    private readonly agentSyncGate: Pick<AgentSyncGate, 'enable'> | undefined,
    @inject(HARNESS_SYNC_TOKENS.PROPAGATION, { isOptional: true })
    private readonly propagation:
      | Pick<HarnessPropagationService, 'propagateWithReport'>
      | undefined,
    @inject(AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE, {
      isOptional: true,
    })
    private readonly mirror:
      | Pick<UserLayerMirrorService, 'readCloneOrigin'>
      | undefined,
  ) {}

  /**
   * Propagation and Library outcome of one settled invocation.
   *
   * - Nothing written: no pass; the propagation an earlier invocation of the
   *   same run recorded is kept.
   * - Written under another folder than the harness root: no consent grant,
   *   no pass (no Library or rival CLI reads that folder).
   * - Otherwise propagate the harness root; the user-layer refresh decides
   *   `libraryPass`, and an updated Library lists the written agents whose
   *   edited Library copy is now diverged.
   */
  async afterRun(
    scope: RunLibraryScope,
    writes: SettledWrites,
    previousPropagation?: PropagationFacts,
  ): Promise<PostRunFacts> {
    const notAttempted = {
      consent: 'not-granted' as const,
      status: 'not-attempted' as const,
    };
    if (writes.writtenCount === 0)
      return {
        propagation: previousPropagation ?? notAttempted,
        library: { pass: 'not-applicable', diverged: [] },
      };
    if (!scope.atHarnessRoot) {
      this.logger.info(
        'RPC: generated agents were written outside the harness root; no Library pass is due',
        { outputRoot: scope.outputRoot, harnessRoot: scope.harnessRoot },
      );
      return {
        propagation: notAttempted,
        library: { pass: 'not-applicable', diverged: [] },
      };
    }
    const { propagation, userLayer } = await this.propagateGeneratedAgents(
      scope.harnessRoot,
    );
    const pass = libraryPassFor({
      atHarnessRoot: true,
      writtenCount: writes.writtenCount,
      userLayer,
    });
    const diverged =
      pass === 'updated'
        ? await this.libraryDiverged(scope.harnessRoot, writes.outcomes)
        : [];
    if (pass === 'failed')
      this.logger.warn(
        'RPC: the Library was not refreshed after generation; the written files are unaffected',
        { harnessRoot: scope.harnessRoot },
      );
    return { propagation, library: { pass, diverged } };
  }

  /**
   * Written agents whose edited Library copy is diverged from the content
   * this run wrote. A host without a Library mirror lists none.
   */
  private async libraryDiverged(
    harnessRoot: string,
    outcomes: readonly GenerationAgentOutcome[],
  ): Promise<string[]> {
    const written = writtenAgentIds(outcomes);
    const mirror = this.mirror;
    if (written.length === 0 || !mirror) return [];
    // `read` never throws: an unreadable record is empty and already warned.
    const origins = await this.originStore.read(harnessRoot);
    return collectLibraryDiverged({
      writtenAgentIds: written,
      originHashes: Object.fromEntries(
        Object.entries(origins).map(([slug, origin]) => [slug, origin.hash]),
      ),
      readClone: (agentId) =>
        mirror.readCloneOrigin('agent', agentId, harnessRoot),
      warn: (message, meta) => this.logger.warn(`RPC: ${message}`, meta),
    });
  }

  /**
   * Fan freshly generated subagents out to every harness target through
   * `HarnessPropagationService` (mirror, then reconcile — the reconciler's
   * desired state IS the user layer, and `{ws}/.claude/agents` is a SOURCE,
   * so an agent the wizard just wrote is invisible to a reconcile until the
   * mirror has run). A wizard run must not fail because a rival CLI's
   * directory was read-only.
   */
  private async propagateGeneratedAgents(harnessRoot: string): Promise<{
    propagation: PropagationFacts;
    /** `null` when the host has no propagation (and so no Library). */
    userLayer: UserLayerRefreshStatus | null;
  }> {
    let consent = false;
    try {
      // BEFORE the propagate, because the reconciler resolves the gate at the
      // top of the pass: granting after it would leave the agents this run
      // just generated sitting in the user layer until a later trigger.
      consent = this.grantAgentSyncConsent(harnessRoot);
      const consentFact = consent ? 'granted' : 'not-granted';
      if (!this.propagation)
        return {
          propagation: { consent: consentFact, status: 'unavailable' },
          userLayer: null,
        };
      const { health, userLayer } = await this.propagation.propagateWithReport(
        harnessRoot,
        'wizard:generation-complete',
      );
      if (health === null)
        return {
          propagation: { consent: consentFact, status: 'unavailable' },
          userLayer,
        };
      const targets = health.targets
        .filter((target) => target.detected)
        .map((target) => target.target);
      this.logger.info('Generated agents propagated to harness targets', {
        targets,
        userLayer,
      });
      return {
        propagation: { consent: consentFact, status: 'completed', targets },
        userLayer,
      };
    } catch (error: unknown) {
      // degradation-audit: reported - the caller returns this as
      // libraryPass 'failed'; the written files are unaffected.
      this.logger.warn('Harness propagation after generation failed', {
        error: errorMessage(error),
      });
      return {
        propagation: {
          consent: consent ? 'granted' : 'not-granted',
          status: 'failed',
        },
        userLayer: 'failed',
      };
    }
  }

  /**
   * Completing the setup wizard IS the user asking Ptah to manage subagents in
   * this workspace, so it is what grants the `agents` consent gate. Without it
   * the reconciler would decline to fan a single generated agent out to
   * Codex, Copilot or Cursor.
   */
  private grantAgentSyncConsent(workspaceRoot: string): boolean {
    if (!this.agentSyncGate) return false;
    try {
      if (this.agentSyncGate.enable(workspaceRoot)) return true;
      this.logger.warn(
        'Could not record agent-sync consent; generated agents may not reach rival CLIs',
        { workspaceRoot },
      );
      return false;
    } catch (error: unknown) {
      // degradation-audit: reported - consent failure is logged and surfaced as unavailable.
      this.logger.warn('Recording agent-sync consent failed', {
        error: errorMessage(error),
      });
      return false;
    }
  }
}
