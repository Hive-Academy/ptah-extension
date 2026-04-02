import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, TicketService } from '../services';

/**
 * QueryTokenAuthGuard - Validates tokens from query string
 *
 * **Purpose**: Authenticate SSE connections using short-lived tickets
 * **Pattern**: Dual-mode guard (JWT tokens + short-lived tickets)
 *
 * **Modes**:
 * 1. **JWT Mode**: Validates standard JWT tokens (backward compatibility)
 * 2. **Ticket Mode**: Validates short-lived SSE tickets (new)
 *
 * **Usage**:
 * ```typescript
 * @Sse('stream')
 * @UseGuards(QueryTokenAuthGuard)
 * stream(@Req() req: Request) {
 *   const userId = req.user.userId; // Populated by guard
 *   // ...
 * }
 * ```
 *
 * **Security**:
 * - Tickets are single-use (consumed on validation)
 * - Tickets expire after 30 seconds
 * - Falls back to JWT validation if ticket validation fails
 *
 * Evidence: implementation-plan.md:498-564
 */
@Injectable()
export class QueryTokenAuthGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(TicketService) private readonly ticketService: TicketService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.query.token as string;

    if (!token) {
      throw new UnauthorizedException('Missing query token');
    }

    try {
      // First, try to validate as a short-lived ticket
      const ticketData = await this.ticketService.validateAndConsume(token);

      if (ticketData) {
        // Ticket is valid - attach minimal user context
        request.user = {
          userId: ticketData.userId,
          tenantId: ticketData.tenantId,
        };
        return true;
      }

      // Fallback: Try to validate as a JWT token (backward compatibility)
      const user = await this.authService.validateToken(token);
      request.user = user;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
