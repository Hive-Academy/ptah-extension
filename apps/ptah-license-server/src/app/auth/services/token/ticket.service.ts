import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomBytes } from 'crypto';

/**
 * TicketService - Short-lived ticket generation for SSE authentication
 *
 * **Purpose**: Generate cryptographically secure, single-use tickets for SSE connections
 * **Pattern**: Ticket-based auth (EventSource header limitation workaround)
 * **TTL**: 30 seconds (configurable)
 * **Storage**: In-memory Map with automatic cleanup
 *
 * **Security Features**:
 * - Cryptographically secure tokens (crypto.randomBytes)
 * - Single-use enforcement (delete after validation)
 * - Auto-expiration via setTimeout
 * - User context association
 *
 * **Usage Flow**:
 * 1. Client requests ticket via POST /auth/stream/ticket (JWT protected)
 * 2. Server generates ticket and returns to client
 * 3. Client opens SSE connection with ticket in query string
 * 4. Server validates and consumes ticket (single-use)
 * 5. SSE connection established with user context
 *
 * **Note**: Uses in-memory storage suitable for single-instance deployments.
 * For multi-instance deployments, consider Redis or distributed cache.
 *
 * **Evidence**: implementation-plan.md:386-451
 */
/**
 * Ticket data stored for SSE authentication
 */
interface TicketData {
  userId: string;
  tenantId: string;
  email: string;
  createdAt: number;
  timeoutId: NodeJS.Timeout;
}

/**
 * Return type for ticket validation
 */
export interface ValidatedTicket {
  userId: string;
  tenantId: string;
  email: string;
}

@Injectable()
export class TicketService implements OnModuleDestroy {
  private readonly TICKET_TTL_MS = 30000; // 30 seconds
  private readonly tickets = new Map<string, TicketData>();

  /**
   * Generate a short-lived ticket for SSE authentication
   *
   * @param userId - User identifier
   * @param tenantId - Tenant identifier
   * @param email - User email (required for SSE event filtering)
   * @returns Cryptographically secure ticket string
   */
  async create(
    userId: string,
    tenantId: string,
    email: string
  ): Promise<string> {
    // Generate cryptographically secure random ticket
    const ticket = randomBytes(32).toString('hex');

    // Set up automatic cleanup after TTL
    const timeoutId = setTimeout(() => {
      this.tickets.delete(ticket);
    }, this.TICKET_TTL_MS);

    // Store ticket with user context
    this.tickets.set(ticket, {
      userId,
      tenantId,
      email: email.toLowerCase(),
      createdAt: Date.now(),
      timeoutId,
    });

    return ticket;
  }

  /**
   * Validate and consume a ticket (single-use enforcement)
   *
   * @param ticket - Ticket string to validate
   * @returns User context if valid, null if expired/invalid
   */
  async validate(ticket: string): Promise<ValidatedTicket | null> {
    const ticketData = this.tickets.get(ticket);

    if (!ticketData) {
      // Ticket expired or never existed
      return null;
    }

    // Clear the timeout since we're consuming it now
    clearTimeout(ticketData.timeoutId);

    // Consume ticket immediately (single-use enforcement)
    this.tickets.delete(ticket);

    // Return user context
    return {
      userId: ticketData.userId,
      tenantId: ticketData.tenantId,
      email: ticketData.email,
    };
  }

  /**
   * @deprecated Use validate() instead
   */
  async validateAndConsume(ticket: string): Promise<ValidatedTicket | null> {
    return this.validate(ticket);
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy() {
    // Clear all pending timeouts
    for (const ticketData of this.tickets.values()) {
      clearTimeout(ticketData.timeoutId);
    }
    this.tickets.clear();
  }
}
