/**
 * LIVE probe for the Ptah connectors catalog (TASK_2026_375 B3.1).
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
 * ```powershell
 * $env:PTAH_LIVE_PROBES='1'
 * npx nx test @ptah-extension/cli-agent-runtime --testPathPattern ptah-connectors-catalog.live
 * ```
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

/** One catalog candidate, as listed in `batches.md` B3.1. */
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
  { id: 'sentry', label: 'Sentry', url: 'https://mcp.sentry.dev/mcp' },
  { id: 'notion', label: 'Notion', url: 'https://mcp.notion.com/mcp' },
  { id: 'linear', label: 'Linear', url: 'https://mcp.linear.app/mcp' },
  { id: 'hubspot', label: 'HubSpot', url: 'https://mcp.hubspot.com' },
  {
    id: 'atlassian',
    label: 'Atlassian',
    url: 'https://mcp.atlassian.com/v1/mcp',
  },
  { id: 'asana', label: 'Asana', url: 'https://mcp.asana.com/sse' },
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
];

/** Per-request ceiling, so one hanging host cannot stall the whole run. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Whole-suite ceiling: 20 candidates x two discovery chains. */
const SUITE_TIMEOUT_MS = 600_000;

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
      for (const candidate of CANDIDATES) {
        outcomes.push(await probe(candidate));
      }
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
});
