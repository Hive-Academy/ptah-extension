import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { AuthModule } from '../app/auth/auth.module';

/**
 * EventsModule - Server-Sent Events for real-time updates
 *
 * Provides:
 * - SSE endpoint (GET /api/v1/events/subscribe?ticket=xxx) for client subscriptions
 * - Event broadcasting for license and subscription changes
 * - Heartbeat mechanism to keep connections alive
 *
 * Events Broadcast:
 * - license.updated: When license status, plan, or expiration changes
 * - subscription.status_changed: When subscription status changes
 * - heartbeat: Every 30 seconds to keep connection alive
 * - connected: Immediately on client connection
 *
 * Authentication Flow:
 * 1. Client authenticates with JWT cookie (GET /auth/me)
 * 2. Client requests ticket (POST /auth/stream/ticket)
 * 3. Client opens SSE with ticket (GET /api/v1/events/subscribe?ticket=xxx)
 * 4. Server validates ticket, extracts user email, establishes connection
 *
 * Security:
 * - Requires valid ticket from POST /auth/stream/ticket
 * - Tickets are single-use and expire in 30 seconds
 * - Events only sent to the authenticated user
 *
 * Dependencies:
 * - AuthModule: For TicketService (ticket validation)
 * - ConfigModule: For heartbeat interval configuration
 */
@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
