/**
 * The Marketplace route tree (implementation-plan.md D1), loaded by the app's
 * `marketplace` route through `loadChildren`.
 *
 * ```
 * '' (MarketplaceShellComponent)
 * ├─ ''                   → restoreMarketplaceRoute
 * ├─ overview             OverviewPageComponent
 * │   └─ :serverRef       ServerDetailComponent
 * ├─ connectors           ConnectorsPageComponent
 * │   └─ :connectorId     ConnectorDetailComponent
 * ├─ servers
 * │   ├─ smithery | registry | custom-url   ServerSourceHostComponent
 * │   └─ ''               InstalledServersPageComponent
 * │       └─ :serverRef   ServerDetailComponent
 * ├─ skills
 * │   ├─ ptah-plugins | community | marketplaces   SkillSourceHostComponent
 * │   └─ ''               InstalledSkillsPageComponent
 * │       └─ :skillRef    SkillDetailComponent
 * └─ '**'                 → overview
 * ```
 *
 * - **Shell-scoped state.** `MarketplaceInventoryStore`, `ConnectorLinksStore`
 *   and `MarketplaceLayout` are provided by the shell COMPONENT, not by this
 *   route. Every page renders inside the shell's outlet, so they already
 *   resolve the shell's instances; a second copy on the route would only
 *   create instances nobody reads.
 * - **Sources are static paths.** Each source has its own route config, bound
 *   to one host through `data.source` → the host's `source` input
 *   (`withComponentInputBinding`, `app.config.ts`). Switching sources
 *   therefore destroys the old surface and mounts exactly one new one, so an
 *   unselected source fires no RPC.
 * - **Details are single segments.** `serverRef` (`<origin>:<key>`) and
 *   `skillRef` (`<kind>:<id>`) always carry a `:`, and no source id does, so
 *   `servers/smithery` can never be read as a ref. An external plugin id with
 *   `/` stays one segment because the router percent-encodes it (R6).
 * - **List pages own their detail placement.** Each list page's empty child is
 *   component-less (`{ path: '', children: [] }`, the `app.routes.ts` `chat`
 *   precedent): the list renders, and the page decides drawer or docked
 *   inspector for the child when one is active.
 */

import { inject } from '@angular/core';
import {
  Router,
  type RedirectFunction,
  type Route,
  type Routes,
} from '@angular/router';
import {
  AppStateManager,
  type MarketplaceServerSource,
  type MarketplaceSkillSource,
} from '@ptah-extension/core';

import { ConnectorDetailComponent } from '../pages/connectors/connector-detail.component';
import { ConnectorsPageComponent } from '../pages/connectors/connectors-page.component';
import { OverviewPageComponent } from '../pages/overview/overview-page.component';
import { InstalledServersPageComponent } from '../pages/servers/installed-servers-page.component';
import { ServerDetailComponent } from '../pages/servers/server-detail.component';
import { ServerSourceHostComponent } from '../pages/servers/server-source-host.component';
import { InstalledSkillsPageComponent } from '../pages/skills/installed-skills-page.component';
import { SkillDetailComponent } from '../pages/skills/skill-detail.component';
import { SkillSourceHostComponent } from '../pages/skills/skill-source-host.component';
import { MarketplaceShellComponent } from '../shell/marketplace-shell.component';
import { marketplaceRouteLink } from '../shell/marketplace-route-url';

/**
 * `/marketplace` with no page: the active workspace's remembered page, else
 * the Overview. The shell records the page on every settled navigation, so a
 * bare Marketplace open (a tab, the TASK_2026_540 menu, a workspace switch)
 * lands where the user left this workspace. Runs in an injection context
 * (probe A2, `surface-router.service.spec.ts`).
 */
const restoreMarketplaceRoute: RedirectFunction = () => {
  const remembered = inject(AppStateManager).marketplaceRoute();
  return inject(Router).createUrlTree(
    marketplaceRouteLink(remembered ?? { page: 'overview' }),
  );
};

/** A list page whose detail opens as its child at `:<param>`. */
function listWithDetail(
  path: string,
  list: NonNullable<Route['component']>,
  param: 'serverRef' | 'connectorId' | 'skillRef',
  detail: NonNullable<Route['component']>,
): Route {
  return {
    path,
    component: list,
    children: [
      { path: '', children: [] },
      { path: `:${param}`, component: detail },
    ],
  };
}

function serverSourceRoute(source: MarketplaceServerSource): Route {
  return {
    path: source,
    component: ServerSourceHostComponent,
    data: { source },
  };
}

function skillSourceRoute(source: MarketplaceSkillSource): Route {
  return {
    path: source,
    component: SkillSourceHostComponent,
    data: { source },
  };
}

export const MARKETPLACE_ROUTES: Routes = [
  {
    path: '',
    component: MarketplaceShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: restoreMarketplaceRoute },
      listWithDetail(
        'overview',
        OverviewPageComponent,
        'serverRef',
        ServerDetailComponent,
      ),
      listWithDetail(
        'connectors',
        ConnectorsPageComponent,
        'connectorId',
        ConnectorDetailComponent,
      ),
      {
        path: 'servers',
        children: [
          serverSourceRoute('smithery'),
          serverSourceRoute('registry'),
          serverSourceRoute('custom-url'),
          listWithDetail(
            '',
            InstalledServersPageComponent,
            'serverRef',
            ServerDetailComponent,
          ),
        ],
      },
      {
        path: 'skills',
        children: [
          skillSourceRoute('ptah-plugins'),
          skillSourceRoute('community'),
          skillSourceRoute('marketplaces'),
          listWithDetail(
            '',
            InstalledSkillsPageComponent,
            'skillRef',
            SkillDetailComponent,
          ),
        ],
      },
      { path: '**', redirectTo: 'overview' },
    ],
  },
];
