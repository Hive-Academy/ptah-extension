/**
 * The Ptah connectors catalog — a curated, probe-verified list of remote MCP
 * servers the Marketplace **Connectors** surface offers with one click.
 *
 * Why a static list: MCP has no directory. `mcpDirectory:search` reaches the
 * official registry and Smithery, but neither indexes the vendor-hosted OAuth
 * servers (Sentry, Notion, Linear, Stripe…) that a user actually wants first.
 * Claude's own connectors directory is a curated list for the same reason.
 *
 * Every `oauth-*` entry in this file was probed at authoring time through the
 * real discovery chain (`discoverAuthorizationServer` →
 * `discoverAuthServerMetadata`), and `kind` records what that probe found:
 *
 *  - `oauth-dcr`  — the authorization server publishes a `registration_endpoint`
 *                   (RFC 7591), so Connect is a browser round trip and nothing
 *                   else. This is the common case.
 *  - `oauth-app`  — OAuth works but there is no dynamic registration, so the
 *                   user must create an app with the provider and paste its
 *                   client id / secret. The surface opens Advanced for these.
 *  - `smithery`   — not a direct OAuth server: Smithery hosts it, and the
 *                   Connections API owns the upstream authorization step.
 *
 * The probe is `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/`
 * `ptah-connectors-catalog.live.spec.ts`. It is `describe.skip` unless
 * `PTAH_LIVE_PROBES=1`. It lives in that lib, not next to this file, because
 * `libs/shared` must not import a backend lib. Re-run it before editing this
 * catalog, and only add an entry the probe passes.
 *
 * Candidates that FAILED the probe are deliberately absent. Cloudflare's docs
 * server (`https://docs.mcp.cloudflare.com/mcp`) publishes no authorization
 * server metadata because it needs no authorization at all — it belongs on the
 * MCP Registry surface, not here.
 */

/** How a connector is authorized. See the module comment for the full rule. */
export type PtahConnectorKind = 'oauth-dcr' | 'oauth-app' | 'smithery';

/** Category chips rendered above the Connectors grid. */
export type PtahConnectorCategory =
  | 'code'
  | 'communication'
  | 'data'
  | 'design'
  | 'productivity'
  | 'sales-marketing'
  | 'finance'
  | 'devops';

/** Every category, in the order the surface renders its chips. */
export const PTAH_CONNECTOR_CATEGORIES: readonly PtahConnectorCategory[] = [
  'code',
  'communication',
  'data',
  'design',
  'productivity',
  'sales-marketing',
  'finance',
  'devops',
] as const;

/** One curated connector. */
export interface PtahConnector {
  /** Stable kebab-case id. Never reused for a different product. */
  readonly id: string;
  readonly label: string;
  /** One sentence, rendered under the label on the card. */
  readonly description: string;
  readonly category: PtahConnectorCategory;
  readonly kind: PtahConnectorKind;
  /** The MCP server URL. Required for the two `oauth-*` kinds. */
  readonly url?: string;
  /** Smithery registry qualified name. Required for the `smithery` kind. */
  readonly smitheryQualifiedName?: string;
  readonly docsUrl?: string;
  /**
   * The provider-side steps a user must complete before Connect can work.
   * Required for `oauth-app`, where the user creates an app with the provider
   * and pastes its client id and secret; absent for every other kind, which
   * needs no provider-side setup.
   *
   * The surface renders these in order inside the Advanced disclosure. A step
   * containing the token `{redirectUrl}` has it replaced with the host's real
   * redirect URL, read from `mcpDirectory:getOAuthRedirectUri` — never a
   * hardcoded one, because it differs per host (TASK_2026_373).
   */
  readonly setupSteps?: readonly string[];
  /**
   * Scopes to request when the authorization server does not advertise its
   * own. Passed through to `connectOAuth`'s existing `scope` parameter, joined
   * with spaces. Omit unless the provider documents that a client must ask.
   */
  readonly scopes?: readonly string[];
  /** ISO date (YYYY-MM-DD) the entry's URL was last probed. */
  readonly verifiedAt: string;
}

/** The date every entry below was probed. One run, one date. */
const VERIFIED_AT = '2026-09-03';

export const PTAH_CONNECTORS: readonly PtahConnector[] = [
  {
    id: 'sentry',
    label: 'Sentry',
    description: 'Read issues, events and releases from your Sentry projects.',
    category: 'devops',
    kind: 'oauth-dcr',
    url: 'https://mcp.sentry.dev/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'notion',
    label: 'Notion',
    description:
      'Search and edit pages and databases in your Notion workspace.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.notion.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'linear',
    label: 'Linear',
    description: 'Create, update and query issues, projects and cycles.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.linear.app/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'atlassian',
    label: 'Atlassian',
    description: 'Work with Jira issues and Confluence pages.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.atlassian.com/v1/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'asana',
    label: 'Asana',
    description: 'Read and update tasks, projects and portfolios in Asana.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.asana.com/sse',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'monday',
    label: 'monday.com',
    description: 'Query and update boards, items and updates on monday.com.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.monday.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'zapier',
    label: 'Zapier',
    description: 'Run your Zapier actions across thousands of connected apps.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'intercom',
    label: 'Intercom',
    description: 'Search conversations, contacts and help-center articles.',
    category: 'communication',
    kind: 'oauth-dcr',
    url: 'https://mcp.intercom.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'figma',
    label: 'Figma',
    description: 'Read files, frames and design metadata from Figma.',
    category: 'design',
    kind: 'oauth-dcr',
    url: 'https://mcp.figma.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'canva',
    label: 'Canva',
    description: 'Browse and create designs in your Canva account.',
    category: 'design',
    kind: 'oauth-dcr',
    url: 'https://mcp.canva.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'webflow',
    label: 'Webflow',
    description: 'Manage sites, collections and CMS items in Webflow.',
    category: 'design',
    kind: 'oauth-dcr',
    url: 'https://mcp.webflow.com/sse',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'stripe',
    label: 'Stripe',
    description: 'Query customers, payments, subscriptions and invoices.',
    category: 'finance',
    kind: 'oauth-dcr',
    url: 'https://mcp.stripe.com',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'paypal',
    label: 'PayPal',
    description: 'Work with orders, invoices and transactions in PayPal.',
    category: 'finance',
    kind: 'oauth-dcr',
    url: 'https://mcp.paypal.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'square',
    label: 'Square',
    description: 'Read payments, orders, catalog and customers from Square.',
    category: 'finance',
    kind: 'oauth-dcr',
    url: 'https://mcp.squareup.com/sse',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'neon',
    label: 'Neon',
    description: 'Manage Postgres projects, branches and queries on Neon.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.neon.tech/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Query your database and manage Supabase project resources.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.supabase.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'vercel',
    label: 'Vercel',
    description: 'Inspect projects, deployments and logs on Vercel.',
    category: 'devops',
    kind: 'oauth-dcr',
    url: 'https://mcp.vercel.com',
    verifiedAt: VERIFIED_AT,
  },
  // ── oauth-app: OAuth works, but the provider registers no apps for you ──────
  {
    id: 'github',
    label: 'GitHub',
    description: 'Work with repositories, issues, pull requests and workflows.',
    category: 'code',
    kind: 'oauth-app',
    url: 'https://api.githubcopilot.com/mcp/',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    description: 'Search contacts, companies, deals and tickets in your CRM.',
    category: 'sales-marketing',
    kind: 'oauth-app',
    url: 'https://mcp.hubspot.com',
    verifiedAt: VERIFIED_AT,
  },
  // ── smithery: Smithery hosts the server and owns the upstream auth step ─────
  {
    id: 'hubspot-smithery',
    label: 'HubSpot via Smithery',
    description:
      'The same CRM tools, hosted by Smithery, with no app to create yourself.',
    category: 'sales-marketing',
    kind: 'smithery',
    smitheryQualifiedName: 'hubspot',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'exa-smithery',
    label: 'Exa Search via Smithery',
    description: 'Fast web search and page crawling for fresh documentation.',
    category: 'data',
    kind: 'smithery',
    smitheryQualifiedName: 'exa',
    verifiedAt: VERIFIED_AT,
  },
];

/** Human label for a category chip. */
export function ptahConnectorCategoryLabel(
  category: PtahConnectorCategory,
): string {
  switch (category) {
    case 'code':
      return 'Code';
    case 'communication':
      return 'Communication';
    case 'data':
      return 'Data';
    case 'design':
      return 'Design';
    case 'productivity':
      return 'Productivity';
    case 'sales-marketing':
      return 'Sales & Marketing';
    case 'finance':
      return 'Finance';
    case 'devops':
      return 'DevOps';
  }
}

/**
 * The one sentence the card shows about how a connector signs in. Kept beside
 * the catalog so the wording cannot drift from the `kind` it describes.
 */
export function ptahConnectorKindHint(kind: PtahConnectorKind): string {
  switch (kind) {
    case 'oauth-dcr':
      return 'Signs in with your browser';
    case 'oauth-app':
      return 'Needs an app you create with the provider';
    case 'smithery':
      return 'Managed by Smithery';
  }
}
