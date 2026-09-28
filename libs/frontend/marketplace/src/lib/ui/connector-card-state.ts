/**
 * The one set of connector card rules, shared by the featured row, the
 * Connectors grid and the connector detail (plan C8/C9: a connector card is
 * a `ptah-catalog-card` with connector content — there is no separate
 * connector card component). `ptah-connector-card-status` and
 * `ptah-connector-card-actions` draw a {@link ConnectorCardState}.
 */

import {
  ptahConnectorCategoryLabel,
  ptahConnectorKindHint,
  type PtahConnector,
} from '@ptah-extension/shared';

import type { ConnectorStatus } from '../data/connector-links.store';
import type { ProviderStatus } from '../data/provider-row';

/** The primary actions a connector card offers (plan C9). */
export type ConnectorCardAction = 'connect' | 'authorize' | 'disconnect';

/**
 * The status pill word for a connector state, through the shared
 * `ProviderStatus` vocabulary so a connector and an installed row read the
 * same. `not-connected` has no pill: the Connect button already says it,
 * and "Disconnected" would claim a connection that never existed.
 */
export function connectorPillStatus(
  status: ConnectorStatus,
): ProviderStatus | null {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'needs-auth':
      return 'needs-auth';
    case 'error':
      return 'failed';
    case 'not-connected':
      return null;
  }
}

/**
 * The sign-in hint of a connector. An `oauth-app` entry also says how many
 * provider-side steps it needs.
 */
export function connectorKindText(connector: PtahConnector): string {
  const hint = ptahConnectorKindHint(connector.kind);
  const steps = connector.setupSteps?.length ?? 0;
  if (connector.kind !== 'oauth-app' || steps === 0) return hint;
  return `${hint} · ${steps} ${steps === 1 ? 'step' : 'steps'}`;
}

/** The card meta line: category, then the sign-in hint. */
export function connectorMeta(connector: PtahConnector): string[] {
  return [
    ptahConnectorCategoryLabel(connector.category),
    connectorKindText(connector),
  ];
}

/** What the links store and the page's action tracker say about one connector. */
export interface ConnectorCardInput {
  readonly status: ConnectorStatus;
  /** The reason text of an `error` link (`ConnectorLink.detail`). */
  readonly detail?: string | null;
  /** The connection is not Ptah's; Disconnect is withheld. */
  readonly managedElsewhere?: boolean;
  /** An action is in flight for this connector. */
  readonly busy: boolean;
  /** A Smithery setup poll is waiting for the browser step to finish. */
  readonly polling: boolean;
  /** Why Smithery has no connections (no key), or null. */
  readonly smitheryUnavailable?: string | null;
  /** The last Smithery setup poll ended without a verdict. */
  readonly timedOut?: boolean;
  /** This connector's last action error, or null. */
  readonly error?: string | null;
}

/** One connector as every connector surface draws it. */
export interface ConnectorCardState {
  readonly connector: PtahConnector;
  /** Category, then the sign-in hint ({@link connectorMeta}). */
  readonly meta: readonly string[];
  readonly status: ConnectorStatus;
  readonly pill: ProviderStatus | null;
  /** The reason text of an `error` link. */
  readonly detail: string | null;
  readonly activity: 'busy' | 'polling' | null;
  readonly managedElsewhere: boolean;
  /** A Smithery connector with no Smithery key: the key link replaces Connect. */
  readonly needsSmitheryKey: boolean;
  readonly timedOut: boolean;
  readonly error: string | null;
  readonly canConnect: boolean;
  readonly canAuthorize: boolean;
  readonly canDisconnect: boolean;
  /** Every action button is disabled while one runs. */
  readonly locked: boolean;
  /** Anything to draw in the status content. */
  readonly hasStatus: boolean;
  /** Any action button to draw. */
  readonly hasActions: boolean;
}

/**
 * The card rules: Connect when not connected, Authorize when listed but
 * unusable, Disconnect when connected and Ptah's. A Smithery connector with
 * no Smithery key offers the key link instead of a Connect that can only
 * fail; a timed-out setup is dropped once the connector is connected.
 */
export function connectorCardState(
  connector: PtahConnector,
  input: ConnectorCardInput,
): ConnectorCardState {
  const status = input.status;
  const detailText = input.detail?.trim() ?? '';
  const detail =
    status === 'error' && detailText.length > 0 ? detailText : null;
  const activity = input.polling ? 'polling' : input.busy ? 'busy' : null;
  const managedElsewhere =
    input.managedElsewhere === true && status !== 'not-connected';
  const needsSmitheryKey =
    connector.kind === 'smithery' &&
    status === 'not-connected' &&
    (input.smitheryUnavailable ?? null) !== null;
  const timedOut = input.timedOut === true && status !== 'connected';
  const errorText = input.error?.trim() ?? '';
  const error = errorText.length > 0 ? errorText : null;
  const pill = connectorPillStatus(status);
  const canConnect = status === 'not-connected' && !needsSmitheryKey;
  const canAuthorize = status === 'needs-auth' || status === 'error';
  const canDisconnect =
    status !== 'not-connected' && input.managedElsewhere !== true;
  return {
    connector,
    meta: connectorMeta(connector),
    status,
    pill,
    detail,
    activity,
    managedElsewhere,
    needsSmitheryKey,
    timedOut,
    error,
    canConnect,
    canAuthorize,
    canDisconnect,
    locked: activity !== null,
    hasStatus:
      pill !== null ||
      managedElsewhere ||
      detail !== null ||
      activity !== null ||
      timedOut ||
      needsSmitheryKey ||
      error !== null,
    hasActions: canConnect || canAuthorize || canDisconnect,
  };
}
