import type { AgentPackInfoDto } from '@ptah-extension/shared';
import type { WizardInternalState } from './wizard-internal-state';

/**
 * WizardCommunityPacksState — owns community agent pack discovery,
 * loading state, per-agent install status, and the currently expanded
 * pack accordion source.
 *
 * Plain TypeScript class (no `@Injectable`, no `inject()`). Receives the
 * shared {@link WizardInternalState} handle via constructor; mutates the
 * coordinator-owned writable signals through the handle so signal
 * identity is preserved for `asReadonly()` consumers.
 */
export class WizardCommunityPacksState {
  public constructor(private readonly state: WizardInternalState) {}

  /**
   * Set available community agent packs.
   * Called after fetching pack manifests from backend.
   *
   * @param packs - Array of community agent pack info DTOs
   */
  public setCommunityPacks(packs: AgentPackInfoDto[]): void {
    this.state.communityPacks.set(packs);
  }

  /**
   * Set community packs loading state.
   *
   * @param loading - Whether packs are currently being fetched
   */
  public setCommunityPacksLoading(loading: boolean): void {
    this.state.communityPacksLoading.set(loading);
  }

  /**
   * Set install status for a specific agent.
   * Key format: "{source}::{file}" for unique identification across packs.
   *
   * @param key - Unique key identifying the agent ({source}::{file})
   * @param status - Current install status
   */
  public setAgentInstallStatus(
    key: string,
    status: 'idle' | 'installing' | 'installed' | 'error',
  ): void {
    this.state.agentInstallStatus.update((map) => ({
      ...map,
      [key]: status,
    }));
  }

  /**
   * Toggle expanded pack source.
   * Collapses if the same source is already expanded, otherwise expands.
   *
   * @param source - Pack source URL to toggle
   */
  public toggleExpandedPack(source: string): void {
    this.state.expandedPackSource.update((current) =>
      current === source ? null : source,
    );
  }

  /**
   * Reset community-packs signals owned by this helper.
   * Mirrors lines 1140–1143 of the original coordinator's `reset()` body.
   */
  public reset(): void {
    this.state.communityPacks.set([]);
    this.state.communityPacksLoading.set(false);
    this.state.agentInstallStatus.set({});
    this.state.expandedPackSource.set(null);
  }
}
