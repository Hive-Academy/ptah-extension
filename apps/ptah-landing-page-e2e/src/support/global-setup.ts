import { psql } from './db';
import { env } from './env';

/**
 * Preflight (handoff §8.1): fail fast with an actionable message if the backend
 * the UI specs depend on isn't up. We assert the two hard dependencies of the
 * P0 flows — the license server (proxied at /api) and Postgres (fixture seeding)
 * — NOT the full Discourse/Google smoke, which only §4 member-content live data
 * needs (and those specs stub the sessions call).
 *
 * Run the backend-contract smoke separately for a full pass:
 *   node scripts/discourse-e2e.mjs && node scripts/google-sessions-smoke.mjs
 */
async function licenseServerReachable(): Promise<boolean> {
  const url =
    (process.env['E2E_LICENSE_URL'] || 'http://localhost:3000') +
    '/api/v1/licenses/me';
  try {
    // Any HTTP response (even 401) proves the server is listening; only a
    // network-level failure means it's down.
    await fetch(url, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}

function postgresReachable(): boolean {
  try {
    return psql('SELECT 1') === '1';
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  if (!env['JWT_SECRET']) {
    throw new Error(
      '[e2e preflight] JWT_SECRET missing from .env — auth injection cannot mint tokens. ' +
        'Ensure you run from the repo root with a populated .env.',
    );
  }

  if (!(await licenseServerReachable())) {
    throw new Error(
      '[e2e preflight] License server not reachable at :3000. Start the stack:\n' +
        '  docker compose up -d\n' +
        '(add --profile webhook-testing for ngrok). See docs/deploy/local-testing-setup.md.',
    );
  }

  if (!postgresReachable()) {
    throw new Error(
      '[e2e preflight] Postgres (ptah_postgres) not reachable for fixture seeding. ' +
        'Start it with `docker compose up -d` and confirm `docker ps` lists ptah_postgres.',
    );
  }

  console.log(
    '\n[e2e preflight] license server + Postgres reachable — proceeding.\n',
  );
}
