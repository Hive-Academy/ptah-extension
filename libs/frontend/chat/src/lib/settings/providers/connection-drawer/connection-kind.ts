import type { ProvidersConnection } from '@ptah-extension/core';
import type { NativeTab } from '@ptah-extension/ui';

/**
 * What a connection is, for the connection drawer (design-spec §2.3). Derived only from
 * non-secret connection metadata, never from the provider id, so the drawer content is per
 * connection rather than Claude's content for every provider (the prototype's known defect).
 */
export type ConnectionKind = 'claude-cli' | 'api-key' | 'oauth' | 'local' | 'custom';

export type ConnectionDrawerTabId = 'overview' | 'credentials' | 'models' | 'advanced';

export interface ConnectionDrawerTab extends NativeTab {
  readonly id: ConnectionDrawerTabId;
}

const OVERVIEW: ConnectionDrawerTab = { id: 'overview', label: 'Overview & Used By' };
const CREDENTIALS: ConnectionDrawerTab = { id: 'credentials', label: 'Credentials' };
const MODELS: ConnectionDrawerTab = { id: 'models', label: 'Models & Tiers' };
const ADVANCED: ConnectionDrawerTab = { id: 'advanced', label: 'Advanced' };

/** Only a custom endpoint has custom-only fields (models endpoint, help URL, pricing, delete). */
const TABS_BY_KIND: Readonly<Record<ConnectionKind, readonly ConnectionDrawerTab[]>> = {
  'claude-cli': [OVERVIEW, CREDENTIALS, MODELS],
  'api-key': [OVERVIEW, CREDENTIALS, MODELS],
  oauth: [OVERVIEW, CREDENTIALS, MODELS],
  local: [OVERVIEW, CREDENTIALS, MODELS],
  custom: [OVERVIEW, CREDENTIALS, MODELS, ADVANCED],
};

/**
 * A user-defined entry is `custom` whatever its protocol, because it alone has the Advanced fields.
 * Otherwise the auth mode decides: a native CLI session, a provider sign-in, a local server, or a key.
 */
export function connectionKind(connection: Pick<ProvidersConnection, 'authMode' | 'custom'>): ConnectionKind {
  if (connection.custom || connection.authMode === 'custom') return 'custom';
  switch (connection.authMode) {
    case 'cli': return 'claude-cli';
    case 'oauth': return 'oauth';
    case 'local-native':
    case 'local-proxy': return 'local';
    case 'apiKey': return 'api-key';
    // An auth mode added later (or unexpected host data) must still yield a drawer: a key-based
    // connection is the safest reading (no custom-only fields, no session actions).
    default: return 'api-key';
  }
}

/** The drawer tabs that apply to `kind`, in display order. Inapplicable tabs are absent, not disabled. */
export function connectionDrawerTabs(kind: ConnectionKind): readonly ConnectionDrawerTab[] {
  return TABS_BY_KIND[kind];
}
