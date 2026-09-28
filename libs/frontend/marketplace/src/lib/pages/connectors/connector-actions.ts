import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { PTAH_CONNECTORS, type PtahConnector } from '@ptah-extension/shared';

import {
  ConnectorLinksStore,
  type ConnectorActionOutcome,
} from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import type { ConnectorCardAction } from '../../ui/connector-card-state';
import type {
  ConnectorActionOrigin,
  TrackedActionError,
} from './connector-cards';

/** Catalogue ids; a poll for anything else (a server ref) has no card. */
const CATALOGUE_IDS: ReadonlySet<string> = new Set(
  PTAH_CONNECTORS.map((connector) => connector.id),
);

/**
 * ConnectorActionsTracker — the Connectors page's view of the actions it
 * runs on `ConnectorLinksStore`.
 *
 * The store keeps one global `actionError` string and fire-and-forget polls;
 * a page needs more than that, so this collaborator adds three things without
 * growing the store (already past the 700-line cap, so it is not touched):
 *
 * - **Errors attributed on completion, per connector.** Each `run()` records
 *   its OWN outcome's error under its own connector id when it settles, so
 *   two overlapping actions on different connectors can never swap messages
 *   (the store's single `actionError` reflects whichever finished last).
 *   A connector's error clears when a new action starts on it or it is
 *   dismissed; other connectors' errors are untouched ({@link actionErrors}).
 * - **"Already connected" is not a failure** (Batch 6 follow-up 1).
 *   `openSmitherySetup` answering `opened: false` with no error can mean the
 *   connection is already complete; the store reports a failure and then
 *   re-reads. When a Connect or Authorize "fails" but the re-read shows the
 *   connector `connected`, no error is recorded and the card shows the
 *   connected state.
 * - **A silent poll deadline becomes a state** (Batch 6 follow-up 2). The
 *   Smithery setup poll gives up after five minutes without a word. Every
 *   catalogue connector the store is polling is watched — including polls a
 *   previous page instance started, picked up from `pollingIds` when this
 *   tracker is created. When a poll ends and the final re-read shows neither
 *   `connected` nor `error`, the connector is marked timed out
 *   ({@link timedOutIds}) and the card offers Retry.
 *
 *   Accepted limitation: this tracker lives with the page, the poll with the
 *   shell. A poll that ends while the Connectors page is NOT mounted (the
 *   user is on another Marketplace page) has no watcher, so on return the
 *   card shows its plain needs-sign-in state with Authorize rather than the
 *   timed-out note. Fixing that needs the store (or the shell) to remember
 *   the verdict; both are outside this batch.
 *
 * Successful actions also tell the inventory store its content changed, so a
 * loaded installed-servers list picks up the new connection (idle slices stay
 * idle; no RPC on a Connectors-only visit).
 *
 * Provided by `ConnectorsPageComponent`, so the connector detail rendered in
 * the page's outlet shares it with the grid.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- page-scoped, provided by ConnectorsPageComponent; see the class note.
@Injectable()
export class ConnectorActionsTracker {
  private readonly links = inject(ConnectorLinksStore);
  private readonly inventory = inject(MarketplaceInventoryStore);

  private readonly _errors = signal<ReadonlyMap<string, TrackedActionError>>(
    new Map(),
  );
  private readonly awaitingSetup = signal<ReadonlySet<string>>(new Set());
  private readonly _timedOut = signal<ReadonlySet<string>>(new Set());

  /** Every connector's last failed action, oldest first. */
  public readonly actionErrors: Signal<readonly TrackedActionError[]> =
    computed(() => [...this._errors().values()]);

  /**
   * Connectors whose Smithery setup poll ended without a verdict. A connector
   * that has since become `connected` drops out on its own.
   */
  public readonly timedOutIds: Signal<ReadonlySet<string>> = computed(() => {
    const timedOut = this._timedOut();
    if (timedOut.size === 0) return timedOut;
    const links = this.links.links();
    const open = new Set<string>();
    for (const id of timedOut) {
      if (links.get(id)?.status !== 'connected') open.add(id);
    }
    return open;
  });

  /** Adopt every catalogue poll the store runs, whoever started it. */
  private readonly pollAdopt = effect(() => {
    const polling = this.links.pollingIds();
    untracked(() => {
      const awaiting = this.awaitingSetup();
      const adopt = [...polling].filter(
        (id) => CATALOGUE_IDS.has(id) && !awaiting.has(id),
      );
      if (adopt.length > 0) this.addTo(this.awaitingSetup, adopt);
    });
  });

  /**
   * Judges every finished setup. The store drops the id from `pollingIds`
   * and starts its final re-read in the same tick, so a finished poll is
   * judged only once that re-read has landed (`state` no longer `loading`).
   */
  private readonly pollWatch = effect(() => {
    const awaiting = this.awaitingSetup();
    if (awaiting.size === 0) return;
    const polling = this.links.pollingIds();
    if (this.links.state() === 'loading') return;
    const links = this.links.links();
    untracked(() => {
      const finished = [...awaiting].filter((id) => !polling.has(id));
      if (finished.length === 0) return;
      this.removeFrom(this.awaitingSetup, finished);
      const unresolved = finished.filter((id) => {
        const status = links.get(id)?.status;
        return status !== 'connected' && status !== 'error';
      });
      if (unresolved.length > 0) this.addTo(this._timedOut, unresolved);
      if (unresolved.length < finished.length) {
        this.inventory.notifyContentChanged();
      }
    });
  });

  /** This connector's last failed action, or null. */
  public errorFor(connectorId: string): TrackedActionError | null {
    return this._errors().get(connectorId) ?? null;
  }

  /**
   * Run one card action. Resolves with the store's outcome; `needs-setup`
   * (an `oauth-app` Connect) is for the caller to act on — the page opens
   * the connector's detail, where the setup form lives.
   */
  public async run(
    action: ConnectorCardAction,
    connector: PtahConnector,
    origin: ConnectorActionOrigin,
  ): Promise<ConnectorActionOutcome> {
    this.clearError(connector.id);
    this.removeFrom(this._timedOut, [connector.id]);

    const outcome = await this.dispatch(action, connector);
    switch (outcome.kind) {
      case 'done':
        this.inventory.notifyContentChanged();
        break;
      case 'awaiting-setup':
        this.addTo(this.awaitingSetup, [connector.id]);
        this.inventory.notifyContentChanged();
        break;
      case 'failed':
        if (
          action !== 'disconnect' &&
          this.links.linkOf(connector).status === 'connected'
        ) {
          // Already connected: the store's re-read settled it. Not an error.
          this.links.dismissActionError();
          this.inventory.notifyContentChanged();
        } else {
          this.recordError(connector.id, outcome.error, origin);
        }
        break;
      default:
        break;
    }
    return outcome;
  }

  /** Retry after a timed-out setup: Authorize when a connection exists, else Connect. */
  public retry(
    connector: PtahConnector,
    origin: ConnectorActionOrigin,
  ): Promise<ConnectorActionOutcome> {
    const action = this.links.linkOf(connector).serverKey
      ? 'authorize'
      : 'connect';
    return this.run(action, connector, origin);
  }

  public dismissError(connectorId: string): void {
    this.clearError(connectorId);
    this.links.dismissActionError();
  }

  public dismissTimeout(connectorId: string): void {
    this.removeFrom(this._timedOut, [connectorId]);
  }

  private dispatch(
    action: ConnectorCardAction,
    connector: PtahConnector,
  ): Promise<ConnectorActionOutcome> {
    switch (action) {
      case 'connect':
        return this.links.connect(connector);
      case 'authorize':
        return this.links.authorize(connector);
      case 'disconnect':
        return this.links.disconnect(connector);
    }
  }

  private recordError(
    connectorId: string,
    message: string,
    origin: ConnectorActionOrigin,
  ): void {
    const text = message.trim();
    if (text.length === 0) return;
    this._errors.update((errors) => {
      const next = new Map(errors);
      next.delete(connectorId);
      next.set(connectorId, { connectorId, message: text, origin });
      return next;
    });
  }

  private clearError(connectorId: string): void {
    this._errors.update((errors) => {
      if (!errors.has(connectorId)) return errors;
      const next = new Map(errors);
      next.delete(connectorId);
      return next;
    });
  }

  private addTo(
    sig: WritableSignal<ReadonlySet<string>>,
    ids: readonly string[],
  ): void {
    sig.update((set) => new Set([...set, ...ids]));
  }

  private removeFrom(
    sig: WritableSignal<ReadonlySet<string>>,
    ids: readonly string[],
  ): void {
    sig.update((set) => {
      if (!ids.some((id) => set.has(id))) return set;
      const next = new Set(set);
      for (const id of ids) next.delete(id);
      return next;
    });
  }
}
