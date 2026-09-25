import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArrowLeft, ExternalLink, LucideAngularModule } from 'lucide-angular';
import {
  PTAH_CONNECTORS,
  ptahConnectorCategoryLabel,
  type PtahConnector,
} from '@ptah-extension/shared';
import { BrandMarkComponent } from '@ptah-extension/ui';

import { ConnectorLinksStore } from '../../data/connector-links.store';
import { MarketplaceInventoryStore } from '../../data/marketplace-inventory.store';
import { MarketplaceLayout } from '../../layout/marketplace-layout';
import { OAuthSurfaceComponent } from '../../oauth-surface.component';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import { ConnectorCardActionsComponent } from '../../ui/connector-card-actions.component';
import { ConnectorCardStatusComponent } from '../../ui/connector-card-status.component';
import {
  connectorCardState,
  connectorKindText,
  type ConnectorCardAction,
  type ConnectorCardState,
} from '../../ui/connector-card-state';
import { statusPresentation } from '../../ui/status-pill.component';
import { ConnectorActionsTracker } from './connector-actions';
import {
  connectorDetailPlacement,
  connectorSetupSteps,
  formatConnectorDate,
  safeDocsUrl,
} from './connector-cards';

let instanceCounter = 0;

/** One row of the facts list. */
interface ConnectorFact {
  readonly label: string;
  readonly value: string;
  /** Rendered as an external link when set. */
  readonly href?: string;
  /** Rendered in a monospace, breakable style (URLs, qualified names). */
  readonly code?: boolean;
}

/**
 * ConnectorDetailComponent — one catalogue connector at
 * `connectors/:connectorId` (plan C9).
 *
 * Brand header, description, category, sign-in hint, status, the server
 * address (the catalogue URL or Smithery qualified name — never a secret),
 * documentation link, the date the entry was verified, the connection dates
 * the links store knows, and the same actions as the card.
 *
 * `oauth-app` connectors need an app the user creates with the provider. The
 * detail lists the provider steps with `{redirectUrl}` replaced by the host's
 * real redirect URL — read from the embedded form's public `redirectUri()`,
 * so there is no second RPC — and embeds `<ptah-oauth-surface>`, pre-filled
 * after it renders through its public `urlInput` / `nameInput` /
 * `advancedOpen` signals (frozen by C13). Connect on such a card lands here.
 *
 * Frame-agnostic: the Connectors page places it in a drawer (compact and
 * regular) or on the whole page (wide). On the whole page its title is the
 * page's `<h1>` and receives focus; in the drawer it is an `<h2>`. The page
 * owns Esc and the way back.
 *
 * An id the catalogue does not know renders "Connector not found" with a link
 * back to the Connectors page.
 */
@Component({
  selector: 'ptah-connector-detail',
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    BrandMarkComponent,
    ConnectorCardStatusComponent,
    ConnectorCardActionsComponent,
    OAuthSurfaceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'connector-detail' },
  templateUrl: './connector-detail.component.html',
})
export class ConnectorDetailComponent {
  private readonly links = inject(ConnectorLinksStore);
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly layout = inject(MarketplaceLayout);
  private readonly injector = inject(Injector);
  protected readonly tracker = inject(ConnectorActionsTracker);

  protected readonly ExternalIcon = ExternalLink;
  protected readonly BackIcon = ArrowLeft;

  private readonly idPrefix = `pcd-${(instanceCounter++).toString(36)}`;
  protected readonly headingId = `${this.idPrefix}-heading`;
  protected readonly setupHeadingId = `${this.idPrefix}-setup`;

  protected readonly connectorsLink = marketplaceRouteLink({
    page: 'connectors',
  });
  protected readonly smitheryKeyLink = marketplaceRouteLink({
    page: 'servers',
    source: 'smithery',
  });

  /** The `:connectorId` route parameter (component input binding). */
  public readonly connectorId = input<string | undefined>();

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly setupSection =
    viewChild<ElementRef<HTMLElement>>('setupSection');
  private readonly form = viewChild(OAuthSurfaceComponent);

  /** The catalogue entry, or `null` for an id the catalogue does not know. */
  protected readonly connector = computed<PtahConnector | null>(() => {
    const id = this.connectorId()?.trim() ?? '';
    return PTAH_CONNECTORS.find((connector) => connector.id === id) ?? null;
  });

  protected readonly placement = computed(() =>
    connectorDetailPlacement(this.layout.tier()),
  );

  /** `<h1>` on the whole page, `<h2>` inside the drawer. */
  protected readonly titleIsPageHeading = computed(
    () => this.placement() === 'page',
  );

  protected readonly card = computed<ConnectorCardState | null>(() => {
    const connector = this.connector();
    if (connector === null) return null;
    const link = this.links.linkOf(connector);
    return connectorCardState(connector, {
      status: link.status,
      detail: link.detail ?? null,
      managedElsewhere: link.managedElsewhere === true,
      busy: this.links.isBusy(connector),
      polling: this.links.isPolling(connector),
      smitheryUnavailable: this.links.smitheryUnavailable(),
      timedOut: this.tracker.timedOutIds().has(connector.id),
      error: this.tracker.errorFor(connector.id)?.message ?? null,
    });
  });

  protected readonly facts = computed<ConnectorFact[]>(() => {
    const card = this.card();
    if (card === null) return [];
    const connector = card.connector;
    const facts: ConnectorFact[] = [
      {
        label: 'Category',
        value: ptahConnectorCategoryLabel(connector.category),
      },
      { label: 'Sign-in', value: connectorKindText(connector) },
      {
        label: 'Status',
        value:
          card.pill === null
            ? 'Not connected'
            : statusPresentation(card.pill).label,
      },
    ];
    if (connector.kind === 'smithery') {
      if (connector.smitheryQualifiedName) {
        facts.push({
          label: 'Smithery server',
          value: connector.smitheryQualifiedName,
          code: true,
        });
      }
    } else if (connector.url) {
      facts.push({ label: 'Server URL', value: connector.url, code: true });
    }
    const docs = safeDocsUrl(connector.docsUrl);
    if (docs !== null) {
      facts.push({ label: 'Documentation', value: docs, href: docs });
    }
    facts.push({
      label: 'Verified',
      value: formatConnectorDate(connector.verifiedAt),
    });
    const serverKey = this.links.linkOf(connector).serverKey;
    if (serverKey) {
      const dates = this.links.datesFor(serverKey);
      if (dates.connectedAt) {
        facts.push({
          label: 'Connected',
          value: formatConnectorDate(dates.connectedAt),
        });
      }
      if (dates.createdAt) {
        facts.push({
          label: 'Created',
          value: formatConnectorDate(dates.createdAt),
        });
      }
    }
    return facts;
  });

  /** Provider steps for `oauth-app`, with the host's redirect URL filled in. */
  protected readonly setupSteps = computed(() => {
    const connector = this.connector();
    if (connector === null) return [];
    return connectorSetupSteps(connector, this.form()?.redirectUri() ?? null);
  });

  /** The connector id the embedded form was last pre-filled for. */
  private prefilledFor: string | null = null;

  public constructor() {
    // Pre-fill the embedded form once it exists, once per connector, so a
    // re-render never overwrites what the user has typed since.
    effect(() => {
      const connector = this.connector();
      const form = this.form();
      if (connector?.kind !== 'oauth-app' || form === undefined) return;
      untracked(() => {
        if (this.prefilledFor === connector.id) return;
        this.prefilledFor = connector.id;
        form.urlInput.set(connector.url ?? '');
        form.nameInput.set(connector.label);
        form.advancedOpen.set(true);
      });
    });

    // On the whole page the title is the page heading: focus moves to it
    // when the detail opens and when it switches to another connector.
    effect(() => {
      this.connectorId();
      if (!this.titleIsPageHeading()) return;
      untracked(() =>
        afterNextRender(() => this.heading()?.nativeElement.focus(), {
          injector: this.injector,
        }),
      );
    });
  }

  protected onAction(action: ConnectorCardAction): void {
    const card = this.card();
    if (card === null || card.locked) return;
    void this.run(action, card.connector);
  }

  protected retry(): void {
    const card = this.card();
    if (card === null || card.locked) return;
    void this.tracker.retry(card.connector, 'detail');
  }

  /** The embedded form connected or disconnected something: re-read. */
  protected onFormChanged(): void {
    void this.links.reload();
    this.inventory.notifyContentChanged();
  }

  private async run(
    action: ConnectorCardAction,
    connector: PtahConnector,
  ): Promise<void> {
    const outcome = await this.tracker.run(action, connector, 'detail');
    if (outcome.kind !== 'needs-setup') return;
    // `oauth-app`: the setup form is right here — bring it into view.
    const section = this.setupSection()?.nativeElement;
    section?.scrollIntoView?.({ block: 'start' });
    section?.focus();
  }
}
