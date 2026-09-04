/**
 * LIVE probe for the Ptah connectors catalog (TASK_2026_375 B3.1, grown by
 * TASK_2026_379 C1.5).
 *
 * This suite makes REAL network calls, so it is `describe.skip` unless
 * `PTAH_LIVE_PROBES=1` is set. It exists to answer one question per candidate
 * server: does OAuth discovery succeed through the B1 functions, and does the
 * authorization server publish a `registration_endpoint`?
 *
 * The answer decides two things in
 * `libs/shared/src/lib/connectors/ptah-connectors.catalog.ts`:
 *  - whether the entry is in the committed catalog at all (only passes are),
 *  - the entry's `kind`: `oauth-dcr` when `registration_endpoint` is present,
 *    `oauth-app` when it is absent.
 *
 * Run it, then paste the printed table into the batch report:
 *
 * ```
 * PTAH_LIVE_PROBES=1 npx jest --config libs/backend/cli-agent-runtime/jest.config.ts  *   --rootDir libs/backend/cli-agent-runtime  *   --testPathPatterns "ptah-connectors-catalog.live"
 * ```
 *
 * The flag is `--testPathPatterns`, PLURAL. Jest 30 renamed it, and the
 * singular form is ignored: it runs the whole suite and buries the table
 * (measured in TASK_2026_379 C1).
 *
 * The catalog itself lives in `libs/shared` and CANNOT import this lib
 * (frontend/shared must not depend on a backend lib), which is why the probe
 * lives here next to the discovery functions it exercises.
 */
import {
  discoverAuthorizationServer,
  discoverAuthServerMetadata,
  type FetchLike,
} from './mcp-oauth-metadata';

/** One catalog candidate, as listed in `batches.md` B3.1 and C1. */
interface CandidateServer {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

/** Outcome of one probe, rendered into the batch-report table. */
interface ProbeOutcome {
  readonly id: string;
  readonly url: string;
  readonly passed: boolean;
  readonly authServer?: string;
  readonly dynamicRegistration?: boolean;
  readonly note?: string;
}

const CANDIDATES: readonly CandidateServer[] = [
  // ── Already in the catalog (TASK_2026_375 B3.1) ────────────────────────────
  { id: 'sentry', label: 'Sentry', url: 'https://mcp.sentry.dev/mcp' },
  { id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp' },
  { id: 'linear', label: 'Linear', url: 'https://mcp.linear.app/mcp' },
  { id: 'hubspot', label: 'HubSpot', url: 'https://mcp.hubspot.com' },
  {
    id: 'atlassian',
    label: 'Atlassian',
    url: 'https://mcp.atlassian.com/v1/mcp',
  },
  { id: 'asana', label: 'Asana v1 beta', url: 'https://mcp.asana.com/sse' },
  { id: 'intercom', label: 'Intercom', url: 'https://mcp.intercom.com/mcp' },
  { id: 'stripe', label: 'Stripe', url: 'https://mcp.stripe.com' },
  { id: 'paypal', label: 'PayPal', url: 'https://mcp.paypal.com/mcp' },
  { id: 'square', label: 'Square', url: 'https://mcp.squareup.com/sse' },
  { id: 'canva', label: 'Canva', url: 'https://mcp.canva.com/mcp' },
  { id: 'figma', label: 'Figma', url: 'https://mcp.figma.com/mcp' },
  { id: 'vercel', label: 'Vercel', url: 'https://mcp.vercel.com' },
  { id: 'neon', label: 'Neon', url: 'https://mcp.neon.tech/mcp' },
  { id: 'supabase', label: 'Supabase', url: 'https://mcp.supabase.com/mcp' },
  { id: 'zapier', label: 'Zapier', url: 'https://mcp.zapier.com/api/mcp/mcp' },
  { id: 'monday', label: 'monday.com', url: 'https://mcp.monday.com/mcp' },
  { id: 'webflow', label: 'Webflow', url: 'https://mcp.webflow.com/sse' },
  {
    id: 'cloudflare-docs',
    label: 'Cloudflare Docs',
    url: 'https://docs.mcp.cloudflare.com/mcp',
  },
  { id: 'github', label: 'GitHub', url: 'https://api.githubcopilot.com/mcp/' },

  // ── C1.1 — browser sign-in candidates (research report section 4) ──────────
  { id: 'ahrefs', label: 'Ahrefs', url: 'https://api.ahrefs.com/mcp/mcp' },
  { id: 'airtable', label: 'Airtable', url: 'https://mcp.airtable.com/mcp' },
  {
    id: 'amplitude',
    label: 'Amplitude',
    url: 'https://mcp.amplitude.com/mcp',
  },
  { id: 'apollo', label: 'Apollo.io', url: 'https://mcp.apollo.io/mcp' },
  {
    id: 'atlassian-v2',
    label: 'Atlassian Rovo v2',
    url: 'https://mcp.atlassian.com/v2/mcp',
  },
  { id: 'attio', label: 'Attio', url: 'https://mcp.attio.com/mcp' },
  { id: 'clickup', label: 'ClickUp', url: 'https://mcp.clickup.com/mcp' },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    url: 'https://mcp.cloudflare.com/mcp',
  },
  {
    id: 'cloudflare-bindings',
    label: 'Cloudflare Bindings',
    url: 'https://bindings.mcp.cloudflare.com/mcp',
  },
  { id: 'context7', label: 'Context7', url: 'https://mcp.context7.com/mcp' },
  {
    id: 'datadog',
    label: 'Datadog',
    url: 'https://mcp.datadoghq.com/api/unstable/mcp-server/mcp',
  },
  { id: 'dropbox', label: 'Dropbox', url: 'https://mcp.dropbox.com/mcp' },
  { id: 'exa', label: 'Exa', url: 'https://mcp.exa.ai/mcp' },
  { id: 'gitlab', label: 'GitLab', url: 'https://gitlab.com/api/v4/mcp' },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    url: 'https://huggingface.co/mcp',
  },
  { id: 'klaviyo', label: 'Klaviyo', url: 'https://mcp.klaviyo.com/mcp' },
  { id: 'mixpanel', label: 'Mixpanel', url: 'https://mcp.mixpanel.com/mcp' },
  { id: 'pipedrive', label: 'Pipedrive', url: 'https://mcp.pipedrive.ai/mcp' },
  {
    id: 'planetscale',
    label: 'PlanetScale',
    url: 'https://mcp.pscale.dev/mcp/planetscale',
  },
  { id: 'semrush', label: 'Semrush', url: 'https://mcp.semrush.com/v2/mcp' },
  { id: 'tavily', label: 'Tavily', url: 'https://mcp.tavily.com/mcp' },
  { id: 'todoist', label: 'Todoist', url: 'https://ai.todoist.net/mcp' },
  { id: 'trello', label: 'Trello', url: 'https://mcp.trello.com/v1' },
  { id: 'zernio', label: 'Zernio', url: 'https://mcp.zernio.com/mcp' },

  // ── C1.2 — app-required candidates (research report section 4b) ────────────
  {
    id: 'google-gmail',
    label: 'Gmail',
    url: 'https://gmailmcp.googleapis.com/mcp/v1',
  },
  {
    id: 'google-calendar',
    label: 'Google Calendar',
    url: 'https://calendarmcp.googleapis.com/mcp/v1',
  },
  {
    id: 'google-drive',
    label: 'Google Drive',
    url: 'https://drivemcp.googleapis.com/mcp/v1',
  },
  {
    id: 'google-docs',
    label: 'Google Docs',
    url: 'https://docsmcp.googleapis.com/mcp/v1',
  },
  {
    id: 'google-bigquery',
    label: 'BigQuery',
    url: 'https://bigquery.googleapis.com/mcp',
  },
  { id: 'slack', label: 'Slack', url: 'https://mcp.slack.com/mcp' },
  { id: 'box', label: 'Box', url: 'https://mcp.box.com' },
  {
    id: 'mongodb-atlas',
    label: 'MongoDB Atlas',
    url: 'https://mcp.mongodb.com',
  },
  { id: 'pagerduty', label: 'PagerDuty', url: 'https://mcp.pagerduty.com/mcp' },
  { id: 'shopify', label: 'Shopify', url: 'https://setup.shopify.com/mcp' },

  // ── C3.1 / C3.2 — the rest of the Google Workspace family, and Asana v2 ───
  {
    id: 'google-sheets',
    label: 'Google Sheets',
    url: 'https://sheetsmcp.googleapis.com/mcp/v1',
  },
  {
    id: 'google-slides',
    label: 'Google Slides',
    url: 'https://slidesmcp.googleapis.com/mcp/v1',
  },
  {
    id: 'google-chat',
    label: 'Google Chat',
    url: 'https://chatmcp.googleapis.com/mcp/v1',
  },
  {
    id: 'google-people',
    label: 'Google People',
    url: 'https://people.googleapis.com/mcp/v1',
  },
  { id: 'asana-v2', label: 'Asana v2', url: 'https://mcp.asana.com/v2/mcp' },

  // ── C1.3 — Smithery-hosted Google servers ─────────────────────────────────
  {
    id: 'gmail-smithery',
    label: 'Gmail via Smithery',
    url: 'https://server.smithery.ai/gmail/mcp',
  },
  {
    id: 'googlecalendar-smithery',
    label: 'Google Calendar via Smithery',
    url: 'https://server.smithery.ai/googlecalendar/mcp',
  },
  {
    id: 'googledrive-smithery',
    label: 'Google Drive via Smithery',
    url: 'https://server.smithery.ai/googledrive/mcp',
  },
  {
    id: 'googledocs-smithery',
    label: 'Google Docs via Smithery',
    url: 'https://server.smithery.ai/googledocs/mcp',
  },
  {
    id: 'googlesheets-smithery',
    label: 'Google Sheets via Smithery',
    url: 'https://server.smithery.ai/googlesheets/mcp',
  },

  // ── C1.4 — dynamic-registration aggregators ───────────────────────────────
  { id: 'pipedream', label: 'Pipedream', url: 'https://mcp.pipedream.net/v2' },
];

/** Per-request ceiling, so one hanging host cannot stall the whole run. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Whole-suite ceiling: 65 candidates x two discovery chains, 8 in flight. */
const SUITE_TIMEOUT_MS = 900_000;
/** Probes in flight at once. Keeps the run inside the suite ceiling. */
const PROBE_CONCURRENCY = 8;

const LIVE = process.env['PTAH_LIVE_PROBES'] === '1';

/**
 * Adapt the global `fetch` to {@link FetchLike} with an abort timeout. A
 * rejected fetch is the discovery functions' "try the next candidate" signal,
 * so the timeout needs no special handling here.
 */
const liveFetch: FetchLike = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: controller.signal,
      redirect: 'follow',
    });
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json(),
      text: () => response.text(),
      headers: response.headers,
    };
  } finally {
    clearTimeout(timer);
  }
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function probe(candidate: CandidateServer): Promise<ProbeOutcome> {
  let authServer: string;
  try {
    authServer = await discoverAuthorizationServer(candidate.url, liveFetch);
  } catch (error: unknown) {
    return {
      id: candidate.id,
      url: candidate.url,
      passed: false,
      note: `protected-resource discovery threw: ${messageOf(error)}`,
    };
  }
  try {
    const metadata = await discoverAuthServerMetadata(authServer, liveFetch);
    return {
      id: candidate.id,
      url: candidate.url,
      passed: true,
      authServer: metadata.issuer ?? authServer,
      dynamicRegistration: metadata.registrationEndpoint !== undefined,
    };
  } catch (error: unknown) {
    return {
      id: candidate.id,
      url: candidate.url,
      passed: false,
      authServer,
      note: messageOf(error),
    };
  }
}

/**
 * Probe every candidate with a bounded number of requests in flight, and keep
 * the outcomes in candidate order so the printed table is stable between runs.
 */
async function probeAll(
  candidates: readonly CandidateServer[],
): Promise<readonly ProbeOutcome[]> {
  const outcomes = new Array<ProbeOutcome>(candidates.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < candidates.length; index = next++) {
      outcomes[index] = await probe(candidates[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, candidates.length) }, () =>
      worker(),
    ),
  );
  return outcomes;
}

function renderTable(outcomes: readonly ProbeOutcome[]): string {
  const rows = outcomes.map((o) => {
    const kind = !o.passed
      ? '—'
      : o.dynamicRegistration
        ? 'oauth-dcr'
        : 'oauth-app';
    const detail = o.passed ? (o.authServer ?? '') : (o.note ?? '');
    return `| ${o.id} | ${o.url} | ${o.passed ? 'PASS' : 'FAIL'} | ${kind} | ${detail} |`;
  });
  return [
    '| id | url | result | kind | authorization server / reason |',
    '| -- | --- | ------ | ---- | ----------------------------- |',
    ...rows,
  ].join('\n');
}

const describeLive = LIVE ? describe : describe.skip;

describeLive('ptah connectors catalog — LIVE OAuth discovery probe', () => {
  const outcomes: ProbeOutcome[] = [];

  afterAll(() => {
    // The table the batch report pastes. `console.log` is the only channel a
    // jest run gives back to the operator.

    console.log(`\n${renderTable(outcomes)}\n`);
  });

  it(
    'probes every catalog candidate and records its discovery outcome',
    async () => {
      outcomes.push(...(await probeAll(CANDIDATES)));
      expect(outcomes).toHaveLength(CANDIDATES.length);
    },
    SUITE_TIMEOUT_MS,
  );
});

describe('ptah connectors catalog live probe (offline guard)', () => {
  it('is skipped unless PTAH_LIVE_PROBES=1', () => {
    // Pins the gate itself: an ordinary CI run must make no network call.
    expect(LIVE || process.env['PTAH_LIVE_PROBES'] === undefined).toBe(true);
  });

  it('lists a unique id and url for every candidate', () => {
    const ids = CANDIDATES.map((c) => c.id);
    const urls = CANDIDATES.map((c) => c.url);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
