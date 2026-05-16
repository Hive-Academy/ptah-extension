/**
 * Branded identity types for the chat domain.
 *
 * Distinguishes the four identifiers used across the chat layer:
 *
 *   - TabId             — UI surface (a slot in navbar / canvas tile)
 *   - ClaudeSessionId   — backend SDK session (stable across compactions)
 *   - ConversationId    — user-perceived thread; spans 1..N sessions
 *   - BackgroundAgentId — a sub-agent running inside a session
 *
 * `ClaudeSessionId` is exported here as an alias of the cross-platform
 * `SessionId` (defined in `@ptah-extension/shared`) so chat-domain callers
 * read in domain-meaningful terms without duplicating the brand. The other
 * three are minted in the frontend and live here.
 *
 * Lib placement: `chat-state` is the per-tab state library, which is the
 * lowest layer that needs all four identities together. Putting them in
 * `shared` would force the brand on backend code that doesn't know about
 * tabs or conversations.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SessionId } from '@ptah-extension/shared';
import { TabId as SharedTabId } from '@ptah-extension/shared';

/** UUID v4 format used by every brand below. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// TabId
// ---------------------------------------------------------------------------

/**
 * Identifies a tab — a UI surface a user can open, close, or arrange in the
 * canvas grid. Lives only in the renderer; never round-trips through the SDK.
 *
 * `TabId` is canonically defined in `@ptah-extension/shared` so backend
 * signatures can refer to the same brand (see `branded.types.ts`). It is
 * re-exported here so `import { TabId } from '@ptah-extension/chat-state'`
 * resolves `.create()`, `.validate()`, `.from()`, and `.safeParse()` against
 * the canonical brand.
 */
export type TabId = SharedTabId;

export const TabId = SharedTabId;

// ---------------------------------------------------------------------------
// ClaudeSessionId
// ---------------------------------------------------------------------------

/**
 * Alias for the cross-platform `SessionId` brand from `@ptah-extension/shared`.
 * Re-exported here so chat-domain code reads in domain-meaningful terms.
 *
 * Same brand at the type level — the two are interchangeable. The alias exists
 * so callers in this layer can write `ClaudeSessionId` and make their intent
 * explicit (this is the SDK session id, not a frontend identity).
 */
export type ClaudeSessionId = SessionId;

// ---------------------------------------------------------------------------
// ConversationId
// ---------------------------------------------------------------------------

/**
 * Identifies a user-perceived conversation thread that survives compaction
 * (the SDK keeps `sessionId` stable across compactions today, but a future
 * SDK rolling new ids would still leave the conversation intact) and that
 * survives the multi-tab fan-out used in canvas grid mode.
 *
 * One conversation contains an ordered list of `ClaudeSessionId`s
 * (see `ConversationRegistry`). One conversation can be bound to many tabs
 * simultaneously (see `TabSessionBinding`).
 */
export type ConversationId = string & { readonly __brand: 'ConversationId' };

export const ConversationId = {
  create(): ConversationId {
    return uuidv4() as ConversationId;
  },
  validate(id: string): id is ConversationId {
    return UUID_REGEX.test(id);
  },
  from(id: string): ConversationId {
    if (!ConversationId.validate(id)) {
      throw new TypeError(`Invalid ConversationId format: ${id}`);
    }
    return id as ConversationId;
  },
  safeParse(id: string): ConversationId | null {
    return ConversationId.validate(id) ? (id as ConversationId) : null;
  },
};

// ---------------------------------------------------------------------------
// BackgroundAgentId
// ---------------------------------------------------------------------------

/**
 * Identifies a background sub-agent spawned inside a session. Distinct from
 * `ClaudeSessionId` so the background-agent store can never collide with
 * the parent session's keys.
 */
export type BackgroundAgentId = string & {
  readonly __brand: 'BackgroundAgentId';
};

export const BackgroundAgentId = {
  create(): BackgroundAgentId {
    return uuidv4() as BackgroundAgentId;
  },
  validate(id: string): id is BackgroundAgentId {
    return UUID_REGEX.test(id);
  },
  from(id: string): BackgroundAgentId {
    if (!BackgroundAgentId.validate(id)) {
      throw new TypeError(`Invalid BackgroundAgentId format: ${id}`);
    }
    return id as BackgroundAgentId;
  },
  safeParse(id: string): BackgroundAgentId | null {
    return BackgroundAgentId.validate(id) ? (id as BackgroundAgentId) : null;
  },
};

// ---------------------------------------------------------------------------
// SurfaceId
// ---------------------------------------------------------------------------

/**
 * Identifies a non-tab consumer of a streaming pipeline — currently a
 * setup-wizard analysis phase or a harness-builder operation. Sibling brand
 * to `TabId`: both refer to a "consumer of streaming events bound to a
 * conversation", but they belong to disjoint sets so consumers that care
 * about UI tabs (tabs panel, navbar, persistence) never accidentally
 * enumerate wizard/harness surfaces, and vice versa.
 *
 * Lives only in the renderer; never round-trips through the SDK. Minted by
 * the originating service (wizard's `WizardPhaseAnalysis`, harness's
 * state/streaming services), mirroring `TabId.create()`.
 */
export type SurfaceId = string & { readonly __brand: 'SurfaceId' };

export const SurfaceId = {
  create(): SurfaceId {
    return uuidv4() as SurfaceId;
  },
  validate(id: string): id is SurfaceId {
    return UUID_REGEX.test(id);
  },
  from(id: string): SurfaceId {
    if (!SurfaceId.validate(id)) {
      throw new TypeError(`Invalid SurfaceId format: ${id}`);
    }
    return id as SurfaceId;
  },
  safeParse(id: string): SurfaceId | null {
    return SurfaceId.validate(id) ? (id as SurfaceId) : null;
  },
};
