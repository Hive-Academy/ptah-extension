import {
  Controller,
  Sse,
  Get,
  Query,
  Logger,
  UnauthorizedException,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, interval, map, merge, finalize } from 'rxjs';
import { EventsService } from './events.service';
import { ConnectionEvent } from './events.types';
import { TicketService } from '../app/auth/services';

/**
 * EventsController - SSE endpoint for real-time updates
 *
 * Endpoint: GET /api/v1/events/subscribe?ticket={ticket}
 * (Note: Global prefix 'api' is applied in main.ts, so controller path is 'v1/events')
 *
 * Security:
 * - Requires valid ticket (obtained from POST /auth/stream/ticket)
 * - Tickets are single-use and expire in 30 seconds
 * - Events are filtered by authenticated user's email
 *
 * Connection:
 * - Client connects using EventSource API
 * - Server sends heartbeat every 30 seconds
 * - Connection auto-reconnects on disconnect (browser handles this)
 *
 * Authentication Flow:
 * 1. Client authenticates with JWT cookie (GET /auth/me)
 * 2. Client requests ticket (POST /auth/stream/ticket)
 * 3. Client opens SSE with ticket (GET /api/v1/events/subscribe?ticket=xxx)
 * 4. Server validates ticket, extracts user email, establishes connection
 *
 * Events sent:
 * - connected: Immediately on connection
 * - heartbeat: Every 30 seconds
 * - license.updated: When license changes
 * - subscription.status_changed: When subscription status changes
 */
@Controller('v1/events')
export class EventsController implements OnModuleDestroy {
  private readonly logger = new Logger(EventsController.name);
  private readonly heartbeatInterval: number;

  constructor(
    @Inject(EventsService) private readonly eventsService: EventsService,
    @Inject(TicketService)
    private readonly ticketService: TicketService,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    // Configure heartbeat interval from env or default to 30 seconds
    this.heartbeatInterval =
      this.configService.get<number>('SSE_HEARTBEAT_INTERVAL') || 30000;
  }

  onModuleDestroy() {
    this.logger.log('EventsController shutting down');
  }

  /**
   * SSE subscription endpoint with ticket-based authentication
   *
   * GET /api/v1/events/subscribe?ticket={ticket}
   *
   * The ticket is obtained from POST /auth/stream/ticket (requires JWT auth).
   * Tickets are single-use and expire in 30 seconds for security.
   *
   * @param ticket - Short-lived authentication ticket
   * @returns Observable stream of SSE events for the authenticated user
   * @throws UnauthorizedException if ticket is missing, invalid, or expired
   */
  @Sse('subscribe')
  async subscribe(
    @Query('ticket') ticket: string,
  ): Promise<Observable<MessageEvent<string>>> {
    if (!ticket) {
      throw new UnauthorizedException(
        'Authentication ticket is required. Obtain one from POST /auth/stream/ticket',
      );
    }

    // Validate and consume the ticket (single-use)
    const ticketData = await this.ticketService.validate(ticket);

    if (!ticketData) {
      throw new UnauthorizedException(
        'Invalid or expired ticket. Please obtain a new one from POST /auth/stream/ticket',
      );
    }

    // Extract user email from ticket data
    const email = ticketData.email?.toLowerCase();

    if (!email) {
      this.logger.error('Ticket validated but missing email');
      throw new UnauthorizedException('Invalid ticket data');
    }

    this.logger.log(`SSE connection established for: ${email}`);

    // Create connection event
    const connectionEvent: ConnectionEvent = {
      type: 'connected',
      timestamp: new Date().toISOString(),
      data: {
        message: 'Connected to Ptah real-time events',
      },
    };

    // Initial connection message
    const connectionMessage: MessageEvent<string> = {
      data: JSON.stringify(connectionEvent),
      type: 'connected',
    } as MessageEvent<string>;

    // Heartbeat stream
    const heartbeat$ = interval(this.heartbeatInterval).pipe(
      map(
        () =>
          ({
            data: JSON.stringify({
              type: 'heartbeat',
              timestamp: new Date().toISOString(),
              data: { serverTime: new Date().toISOString() },
            }),
            type: 'heartbeat',
          }) as MessageEvent<string>,
      ),
    );

    // User-specific event stream
    const userEvents$ = this.eventsService.getEventStream(email);

    // Merge all streams with cleanup on disconnect
    return merge(
      // Send connection event immediately
      new Observable<MessageEvent<string>>((subscriber) => {
        subscriber.next(connectionMessage);
        subscriber.complete();
      }),
      // Heartbeat stream
      heartbeat$,
      // User events
      userEvents$,
    ).pipe(
      finalize(() => {
        this.eventsService.trackClientDisconnection(email);
        this.logger.log(`SSE connection closed for: ${email}`);
      }),
    );
  }

  /**
   * Health check endpoint for SSE service
   *
   * GET /api/v1/events/health
   *
   * Returns current status and connected client count.
   * This is a regular HTTP endpoint, not SSE.
   */
  @Get('health')
  health() {
    return {
      status: 'ok',
      connectedClients: this.eventsService.getConnectedClientCount(),
      timestamp: new Date().toISOString(),
    };
  }
}
