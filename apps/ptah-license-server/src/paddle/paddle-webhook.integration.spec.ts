/**
 * Integration spec for the Paddle webhook pipeline — money-path batch W1.B1.1.
 *
 * Intent (when enabled): exercise `PaddleWebhookService.processWebhook` end
 * to end against a real `postgres:16-alpine` container from the W0.B4
 * testcontainers wrapper. Validates that:
 *
 *   - `subscription.created` persists User + Subscription + License rows.
 *   - `subscription.updated` mutates only the affected user's licenses.
 *   - `subscription.canceled` freezes `expiresAt` at `current_billing_period.endsAt`.
 *   - `transaction.completed` (renewal) extends `expiresAt` on the real row.
 *   - A transient failure writes a `FailedWebhook` row with the signed body.
 *
 * Status: SKIPPED — the `testcontainers` package is not currently a
 * workspace devDependency (verified by `ls node_modules/testcontainers`
 * on 2026-04-24). The W0.B4 wrapper `startPostgresContainer()` throws a
 * descriptive error in that case, so running this spec as-is would fail
 * with "The 'testcontainers' package is not installed" rather than a
 * useful assertion failure.
 *
 * To enable:
 *   1. `npm i -D testcontainers` at the workspace root.
 *   2. Ensure Docker Desktop / colima is running on the CI node.
 *   3. Remove the `describe.skip` below.
 *   4. Wire an integration NestJS module with the real Prisma client
 *      from `{ prisma } = await startPostgresContainer()` via useValue.
 *
 * TODO(TASK_2025_294, W1.B1.1): track this in the task's
 * `future-enhancements.md` (or `implementation-plan.md` → "deferred")
 * so it is picked up once testcontainers is adopted workspace-wide.
 */

import { startPostgresContainer } from '../testing/testcontainers/postgres';
import {
  loadPaddleFixture,
  TEST_PADDLE_WEBHOOK_SECRET,
} from '../testing/fixtures/paddle';

describe.skip('PaddleWebhookService — integration (Postgres testcontainer)', () => {
  let handle: Awaited<ReturnType<typeof startPostgresContainer>>;

  beforeAll(async () => {
    // Deferred until testcontainers is added. See file header for rationale.
    handle = await startPostgresContainer();
  }, 120_000);

  afterAll(async () => {
    await handle?.stop();
  });

  it('subscription.created persists user + subscription + license', async () => {
    // TODO(TASK_2025_294): When enabling, build a NestJS module with the
    // real Prisma client from `handle.prisma` via useValue, feed a fresh
    // fixture through processWebhook, and assert DB rows exist.
    const fixture = loadPaddleFixture('subscription-created');
    expect(fixture.secret).toBe(TEST_PADDLE_WEBHOOK_SECRET);
    expect(fixture.body.length).toBeGreaterThan(0);
  });

  it('subscription.updated mutates the matching user license only', async () => {
    // TODO(TASK_2025_294): assert scoped updateMany persists via real SQL.
    const fixture = loadPaddleFixture('subscription-updated');
    expect(fixture.body.length).toBeGreaterThan(0);
  });

  it('subscription.canceled freezes expiresAt at current_billing_period.endsAt', async () => {
    // TODO(TASK_2025_294): assert License.expiresAt row matches fixture ts.
    const fixture = loadPaddleFixture('subscription-canceled');
    expect(fixture.body.length).toBeGreaterThan(0);
  });

  it('transaction.completed renewal extends expiresAt', async () => {
    // TODO(TASK_2025_294): assert License.expiresAt extended on DB row.
    const fixture = loadPaddleFixture('transaction-completed');
    expect(fixture.body.length).toBeGreaterThan(0);
  });

  it('FailedWebhook row is persisted on a transient downstream failure', async () => {
    // TODO(TASK_2025_294): inject a failing PaddleService stub + real
    // Prisma, verify `failed_webhooks` row exists with rawPayload set.
    const fixture = loadPaddleFixture('subscription-created');
    expect(fixture.body.length).toBeGreaterThan(0);
  });
});
