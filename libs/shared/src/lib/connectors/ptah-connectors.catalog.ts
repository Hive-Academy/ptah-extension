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
 *                   client id / secret. The surface opens Advanced for these
 *                   and renders the entry's `setupSteps`.
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
 *
 * Candidates whose probe PASSED but whose documentation restricts custom OAuth
 * clients are also absent, and are listed in the commented block at the end of
 * `PTAH_CONNECTORS` so nobody re-probes them from scratch (TASK_2026_379 C1.1).
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
const VERIFIED_AT = '2026-09-04';

export const PTAH_CONNECTORS: readonly PtahConnector[] = [
  // ── oauth-dcr: the browser round trip is the whole of the setup ───────────
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
    id: 'atlassian-v2',
    label: 'Atlassian Rovo v2',
    description:
      'The newer Rovo endpoint, with more Confluence, Bitbucket and Compass tools.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.atlassian.com/v2/mcp',
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
    id: 'clickup',
    label: 'ClickUp',
    description: 'Create and update tasks, lists and docs in ClickUp.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.clickup.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'trello',
    label: 'Trello',
    description: 'Work with boards, lists and cards in Trello.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.trello.com/v1',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'todoist',
    label: 'Todoist',
    description: 'Create, complete and query tasks and projects in Todoist.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://ai.todoist.net/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'zapier',
    label: 'Zapier',
    description:
      'Run Zapier actions across thousands of apps, on about 50 free tool calls a month.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'pipedream',
    label: 'Pipedream',
    description:
      'Reach thousands of apps through one endpoint, on an unpublished MCP quota.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://mcp.pipedream.net/v2',
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
    id: 'planetscale',
    label: 'PlanetScale',
    description: 'Manage PlanetScale databases, branches and deploy requests.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.pscale.dev/mcp/planetscale',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'airtable',
    label: 'Airtable',
    description: 'Read and write records, tables and bases in Airtable.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.airtable.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'amplitude',
    label: 'Amplitude',
    description: 'Query product-analytics events, charts and cohorts.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.amplitude.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'mixpanel',
    label: 'Mixpanel',
    description: 'Query events, funnels and retention reports in Mixpanel.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.mixpanel.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    description: 'Search, read and organize the files in your Dropbox account.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.dropbox.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'exa',
    label: 'Exa',
    description: 'Search the web and crawl pages straight from Exa.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.exa.ai/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'tavily',
    label: 'Tavily',
    description: 'Search the web and extract page content for research.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://mcp.tavily.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'gitlab',
    label: 'GitLab',
    description:
      'Work with projects, issues, merge requests and pipelines on GitLab.',
    category: 'code',
    kind: 'oauth-dcr',
    url: 'https://gitlab.com/api/v4/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    description: 'Search models, datasets and Spaces on the Hugging Face Hub.',
    category: 'code',
    kind: 'oauth-dcr',
    url: 'https://huggingface.co/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'context7',
    label: 'Context7',
    description:
      'Pull current documentation and code examples for the libraries you use.',
    category: 'code',
    kind: 'oauth-dcr',
    url: 'https://mcp.context7.com/mcp',
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
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    description:
      'Reach the Cloudflare API for zones, DNS, Workers and account settings.',
    category: 'devops',
    kind: 'oauth-dcr',
    url: 'https://mcp.cloudflare.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'cloudflare-bindings',
    label: 'Cloudflare Bindings',
    description:
      'Manage the Workers resources you bind to a Worker, such as D1, KV and R2.',
    category: 'devops',
    kind: 'oauth-dcr',
    url: 'https://bindings.mcp.cloudflare.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'datadog',
    label: 'Datadog',
    description: 'Query metrics, logs, monitors and incidents in Datadog.',
    category: 'devops',
    kind: 'oauth-dcr',
    url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'apollo',
    label: 'Apollo.io',
    description: 'Search contacts, accounts and sequences in Apollo.io.',
    category: 'sales-marketing',
    kind: 'oauth-dcr',
    url: 'https://mcp.apollo.io/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'attio',
    label: 'Attio',
    description: 'Work with records, lists and notes in your Attio CRM.',
    category: 'sales-marketing',
    kind: 'oauth-dcr',
    url: 'https://mcp.attio.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'pipedrive',
    label: 'Pipedrive',
    description: 'Read and update deals, contacts and activities in Pipedrive.',
    category: 'sales-marketing',
    kind: 'oauth-dcr',
    url: 'https://mcp.pipedrive.ai/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'klaviyo',
    label: 'Klaviyo',
    description: 'Work with lists, segments, campaigns and flows in Klaviyo.',
    category: 'sales-marketing',
    kind: 'oauth-dcr',
    url: 'https://mcp.klaviyo.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'zernio',
    label: 'Zernio',
    description: 'Sign in to Zernio and use the sales tools it exposes.',
    category: 'sales-marketing',
    kind: 'oauth-dcr',
    url: 'https://mcp.zernio.com/mcp',
    verifiedAt: VERIFIED_AT,
  },
  // ── oauth-dcr, Smithery-hosted: a third party sits in the path ────────────
  // These use Smithery's own authorization server, not the Connections API, so
  // they need no Smithery API key. Labelled "via Smithery" to tell them from
  // the Google rows below, which have no third party but need an app you make.
  {
    id: 'gmail-smithery',
    label: 'Gmail via Smithery',
    description:
      'Read and draft mail through a server that Smithery, a third party, hosts.',
    category: 'communication',
    kind: 'oauth-dcr',
    url: 'https://server.smithery.ai/gmail/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'googlecalendar-smithery',
    label: 'Google Calendar via Smithery',
    description:
      'Read and create events through a server that Smithery, a third party, hosts.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://server.smithery.ai/googlecalendar/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'googledrive-smithery',
    label: 'Google Drive via Smithery',
    description:
      'Browse and read files through a server that Smithery, a third party, hosts.',
    category: 'data',
    kind: 'oauth-dcr',
    url: 'https://server.smithery.ai/googledrive/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'googledocs-smithery',
    label: 'Google Docs via Smithery',
    description:
      'Read and edit documents through a server that Smithery, a third party, hosts.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://server.smithery.ai/googledocs/mcp',
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'googlesheets-smithery',
    label: 'Google Sheets via Smithery',
    description:
      'Read and edit spreadsheets through a server that Smithery, a third party, hosts.',
    category: 'productivity',
    kind: 'oauth-dcr',
    url: 'https://server.smithery.ai/googlesheets/mcp',
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
    setupSteps: [
      'Open GitHub settings, then Developer settings, then OAuth Apps, and register a new application.',
      'Set the authorization callback URL to {redirectUrl}.',
      'Generate a client secret on the new application page.',
      'Copy the client ID and client secret into the fields below.',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    description: 'Search contacts, companies, deals and tickets in your CRM.',
    category: 'sales-marketing',
    kind: 'oauth-app',
    url: 'https://mcp.hubspot.com',
    setupSteps: [
      'Open your HubSpot developer account and create a public app.',
      'Add {redirectUrl} to the redirect URLs of the app.',
      'Select the CRM scopes the app needs, then install it on your portal.',
      'Copy the client ID and client secret into the fields below.',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'google-gmail',
    label: 'Gmail',
    description: 'Read and draft mail through the server Google hosts itself.',
    category: 'communication',
    kind: 'oauth-app',
    url: 'https://gmailmcp.googleapis.com/mcp/v1',
    setupSteps: [
      'Open the Google Cloud console and create an OAuth client of type Web application.',
      'Add {redirectUrl} to the authorized redirect URIs.',
      'Enable the Gmail API and the Gmail MCP API for the project.',
      'Add the scopes listed below to the OAuth consent screen.',
      'Copy the client ID and client secret into the fields below.',
    ],
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    description: 'Read calendars, events and free or busy times.',
    category: 'productivity',
    kind: 'oauth-app',
    url: 'https://calendarmcp.googleapis.com/mcp/v1',
    setupSteps: [
      'Open the Google Cloud console and create an OAuth client of type Web application.',
      'Add {redirectUrl} to the authorized redirect URIs.',
      'Enable the Google Calendar API and the Calendar MCP API for the project.',
      'Add the scopes listed below to the OAuth consent screen.',
      'Copy the client ID and client secret into the fields below.',
    ],
    scopes: [
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    description: 'Search and read the files in your Google Drive.',
    category: 'data',
    kind: 'oauth-app',
    url: 'https://drivemcp.googleapis.com/mcp/v1',
    setupSteps: [
      'Open the Google Cloud console and create an OAuth client of type Web application.',
      'Add {redirectUrl} to the authorized redirect URIs.',
      'Enable the Google Drive API and the Drive MCP API for the project.',
      'Add the scopes listed below to the OAuth consent screen.',
      'Copy the client ID and client secret into the fields below.',
    ],
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'google-docs',
    label: 'Google Docs',
    description: 'Read and edit documents through the Google Docs server.',
    category: 'productivity',
    kind: 'oauth-app',
    url: 'https://docsmcp.googleapis.com/mcp/v1',
    setupSteps: [
      'Open the Google Cloud console and create an OAuth client of type Web application.',
      'Add {redirectUrl} to the authorized redirect URIs.',
      'Enable the Google Docs API, the Google Drive API and the Docs MCP API.',
      'Add the scopes listed below to the OAuth consent screen.',
      'Copy the client ID and client secret into the fields below.',
    ],
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/documents',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'google-bigquery',
    label: 'BigQuery',
    description: 'Run queries and inspect datasets and tables in BigQuery.',
    category: 'data',
    kind: 'oauth-app',
    url: 'https://bigquery.googleapis.com/mcp',
    setupSteps: [
      'Open the Google Cloud console and create an OAuth client of type Web application.',
      'Add {redirectUrl} to the authorized redirect URIs.',
      'Enable the BigQuery API and the BigQuery MCP API for the project.',
      'Give the signing-in account the BigQuery roles it needs on the project.',
      'Copy the client ID and client secret into the fields below.',
    ],
    scopes: ['https://www.googleapis.com/auth/bigquery'],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'slack',
    label: 'Slack',
    description:
      'Read and post messages across the channels in your Slack workspace.',
    category: 'communication',
    kind: 'oauth-app',
    url: 'https://mcp.slack.com/mcp',
    setupSteps: [
      'Open the Slack app directory for developers and create a new app from scratch in your workspace.',
      'Add {redirectUrl} to the redirect URLs under OAuth and Permissions.',
      'Add the user token scopes your team needs, then install the app to the workspace.',
      'Turn on Model Context Protocol under Agents and AI Apps.',
      'Copy the client ID and client secret from Basic Information into the fields below.',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'box',
    label: 'Box',
    description: 'Search, read and manage the files in your Box account.',
    category: 'data',
    kind: 'oauth-app',
    url: 'https://mcp.box.com',
    setupSteps: [
      'Open the Box developer console and create a custom app that uses user authentication.',
      'Add {redirectUrl} to the redirect URIs of the app.',
      'Ask your Box administrator to authorize the app if your account requires it.',
      'Copy the client ID and client secret into the fields below.',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'mongodb-atlas',
    label: 'MongoDB Atlas',
    description: 'Inspect clusters, databases and collections in Atlas.',
    category: 'data',
    kind: 'oauth-app',
    url: 'https://mcp.mongodb.com',
    setupSteps: [
      'Open the Atlas organization settings and register a new OAuth application.',
      'Add {redirectUrl} to the allowed redirect URIs.',
      'Give the application access to the projects it must read.',
      'Copy the client ID and client secret into the fields below.',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'pagerduty',
    label: 'PagerDuty',
    description: 'Read incidents, services and on-call schedules.',
    category: 'devops',
    kind: 'oauth-app',
    url: 'https://mcp.pagerduty.com/mcp',
    setupSteps: [
      'Open the PagerDuty developer console and register a new OAuth 2.0 app.',
      'Set the redirect URL of the app to {redirectUrl}.',
      'Give the app the read or write scopes your account needs, then save it.',
      'Copy the client ID and client secret into the fields below.',
    ],
    verifiedAt: VERIFIED_AT,
  },
  {
    id: 'shopify',
    label: 'Shopify',
    description: 'Work with products, orders and customers in your store.',
    category: 'finance',
    kind: 'oauth-app',
    url: 'https://setup.shopify.com/mcp',
    setupSteps: [
      'Open the Shopify developer dashboard and create an app for your store.',
      'Add {redirectUrl} to the allowed redirection URLs.',
      'Select the Admin API access scopes the app needs, then install it on the store.',
      'Copy the client ID and client secret into the fields below.',
    ],
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
  // ── HELD BACK — probe PASSED, documentation restricts custom clients ───────
  //
  // All three answer the RFC 8414 metadata probe and advertise a
  // `registration_endpoint`, so a metadata-only check says "ship it". Their
  // documentation says otherwise (TASK_2026_378 research report, section 4).
  // Do NOT re-probe them: the probe already passes and proves nothing here.
  // [VERIFY: connect once] — connect each one from Ptah by hand, end to end.
  // If authorization completes and a tool call returns, uncomment the row and
  // drop it from the held-back list in `ptah-connectors.catalog.spec.ts`.
  //
  // {
  //   id: 'square',
  //   label: 'Square',
  //   // Square's documentation requires the OAuth client to be on an allowlist,
  //   // so a dynamically registered client is expected to be refused at consent.
  //   // Shipped in TASK_2026_375 on the metadata probe alone; withdrawn here.
  //   description: 'Read payments, orders, catalog and customers from Square.',
  //   category: 'finance',
  //   kind: 'oauth-dcr',
  //   url: 'https://mcp.squareup.com/sse',
  //   verifiedAt: VERIFIED_AT,
  // },
  // {
  //   id: 'ahrefs',
  //   label: 'Ahrefs',
  //   // Ahrefs' documentation forbids custom OAuth clients outright.
  //   description: 'Query backlinks, keywords and site audits in Ahrefs.',
  //   category: 'sales-marketing',
  //   kind: 'oauth-dcr',
  //   url: 'https://api.ahrefs.com/mcp/mcp',
  //   verifiedAt: VERIFIED_AT,
  // },
  // {
  //   id: 'semrush',
  //   label: 'Semrush',
  //   // Semrush advertises an unusual token transport and lists plain PKCE
  //   // first, so the flow Ptah runs may not be the flow Semrush supports.
  //   description: 'Query keyword, domain and backlink reports in Semrush.',
  //   category: 'sales-marketing',
  //   kind: 'oauth-dcr',
  //   url: 'https://mcp.semrush.com/v2/mcp',
  //   verifiedAt: VERIFIED_AT,
  // },
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
