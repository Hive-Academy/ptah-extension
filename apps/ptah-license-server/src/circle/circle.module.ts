import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { CircleProvider } from './circle.provider';
import { CircleProvisioningService } from './circle-provisioning.service';

/**
 * CircleModule — Circle Admin API v2 integration for the paid Builders
 * members' community (Discord stays free/public).
 *
 * Declared `@Global()` (mirroring `AuditModule`) so `CircleProvisioningService`
 * is injectable into the Paddle webhook fan-out without threading an explicit
 * import through `PaddleModule`. `AuditLogService` is already globally available
 * via `AuditModule`.
 *
 * Provides:
 * - `CircleProvider` — typed, non-throwing Circle Admin API v2 client.
 * - `CircleProvisioningService` — best-effort provision/deprovision orchestration
 *   consumed by `PaddleService` on Builders subscription lifecycle events and
 *   reusable by an admin resync endpoint (owned by the invite-waves agent).
 *
 * Feature-off: when `CIRCLE_API_TOKEN`/`CIRCLE_COMMUNITY_ID` are unset the
 * integration no-ops (logged once) — it never fails a webhook.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [CircleProvider, CircleProvisioningService],
  exports: [CircleProvider, CircleProvisioningService],
})
export class CircleModule {}
