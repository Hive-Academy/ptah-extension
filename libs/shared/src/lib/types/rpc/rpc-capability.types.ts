/**
 * Capability toggle wire contract (TASK_2026_560): the three `capabilities:*`
 * RPC methods the Marketplace uses to read and change the per-workspace and
 * global on/off state of MCP servers, skills and plugins.
 *
 * The shapes are built on the policy types in `../capability-toggle.types`, so
 * the webview renders exactly the entries the backend resolver produced.
 *
 * ## Which workspace
 *
 * No method takes a root. The handler resolves the host's active workspace to
 * its canonical policy root itself, so a webview can never address a policy
 * outside the workspace it is showing — the same rule `mcpDirectory:install`
 * and `plugins:get-config` follow.
 */

import type { CapabilityScope } from '../mcp-directory.types';
import type { CapabilityKind } from '../capability-id-codec';
import type {
  CapabilityEntry,
  CapabilityInventory,
  CapabilitySetRequest,
  EffectiveCapabilitySet,
} from '../capability-toggle.types';

// ---------------------------------------------------------------------------
// capabilities:getState
// ---------------------------------------------------------------------------

/** Params for `capabilities:getState`. The workspace is the host's active one. */
export type CapabilitiesGetStateParams = Record<string, never>;

/**
 * Result of `capabilities:getState`: every capability row and the policy state
 * it was resolved under.
 *
 * `entries[].schemaTokens` is optional: the handler attaches it only when a
 * schema-size measurement is registered and has a figure for that server.
 * Absent means "size unknown", never zero. `entries[].effectiveEnabled` is
 * `null` whenever `status` is `unverified`.
 */
export type CapabilitiesGetStateResult = CapabilityInventory;

// ---------------------------------------------------------------------------
// capabilities:getEffective
// ---------------------------------------------------------------------------

/** Params for `capabilities:getEffective`. The workspace is the host's active one. */
export type CapabilitiesGetEffectiveParams = Record<string, never>;

/**
 * Result of `capabilities:getEffective`: the set a session built in the active
 * workspace right now would load. Under `status: 'unverified'` every consumer
 * fails closed (ptah only, no skills), and `reasons` names what was unreadable.
 */
export type CapabilitiesGetEffectiveResult = EffectiveCapabilitySet;

// ---------------------------------------------------------------------------
// capabilities:setEnabled
// ---------------------------------------------------------------------------

/**
 * Params for `capabilities:setEnabled`: one toggle.
 *
 * {@link CapabilitySetRequest} minus `cwd`, which the handler supplies from the
 * active workspace, plus the install-path `explicit` flag.
 */
export interface CapabilitiesSetEnabledParams extends Omit<
  CapabilitySetRequest,
  'cwd'
> {
  /** `workspace` writes this workspace's item; `global` writes the user-wide item. */
  scope: CapabilityScope;
  kind: CapabilityKind;
  /** The capability id as it appears in `capabilities:getState` entries. */
  id: string;
  enabled: boolean;
  /**
   * Keep a concrete workspace value even when it equals the inherited
   * `global ?? default` one (the install path, N6), so a later global change
   * cannot undo it. Omitted or `false` is an ordinary toggle, which writes the
   * "follows global" tombstone when the choice equals the inherited value.
   *
   * Only meaningful for `scope: 'workspace'`; the handler rejects it with
   * `scope: 'global'`.
   */
  explicit?: boolean;
}

/**
 * Result of `capabilities:setEnabled`: the row as re-resolved after the write,
 * so the UI replaces its optimistic value with the persisted one. A write that
 * fails is an RPC error naming the item, never a result.
 */
export interface CapabilitiesSetEnabledResult {
  entry: CapabilityEntry;
}
