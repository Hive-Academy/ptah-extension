import { Type } from '@angular/core';

export type MarketplaceProviderStatus = 'live' | 'coming-soon';
export type MarketplaceProviderKind = 'skills' | 'mcp';

/**
 * Frontend-only UI metadata describing one marketplace provider (skills.sh,
 * official MCP registry, Smithery, Composio, ...). Descriptors are pure UI
 * metadata plus a direct component reference — they carry NO backend imports
 * and respect the frontend<->backend isolation rule.
 *
 * Open/Closed seam: adding a provider = appending a descriptor here (+ a surface
 * component for live providers). Zero shell edits required.
 */
export interface MarketplaceProviderSpec {
  /** Stable id (used for tab persistence in AppStateManager). */
  readonly id: string;
  /** Display name (TS source only — never shipped markdown; trademark scanner safe). */
  readonly name: string;
  /** lucide-angular icon ref (LucideIconData) or undefined. */
  readonly icon?: unknown;
  readonly status: MarketplaceProviderStatus;
  readonly kind: MarketplaceProviderKind;
  /** Optional short tagline for the provider list row. */
  readonly tagline?: string;
  /** Whether selecting this provider requires Pro (drives in-view gate copy). */
  readonly proGated?: boolean;
  /**
   * Content surface resolver. For 'live' providers, the component that renders
   * the provider's browse/install UI (already-OnPush standalone). For
   * 'coming-soon', omit — the shell renders the disabled placeholder.
   * Component is referenced directly (same lib or chat-ui import) — NO DI token
   * needed because marketplace imports chat-ui directly (no cycle).
   */
  readonly surface?: Type<unknown>;
}
