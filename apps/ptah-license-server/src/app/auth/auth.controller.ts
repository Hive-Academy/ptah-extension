import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import { TicketService } from './services/ticket.service';

/**
 * Authentication Controller
 *
 * Handles WorkOS authentication flow and JWT session management.
 *
 * Flow:
 * 1. User visits `/auth/login` → Redirects to WorkOS AuthKit
 * 2. User completes authentication → WorkOS redirects to `/auth/callback?code=...`
 * 3. Backend exchanges code for user info → Generates JWT → Sets HTTP-only cookie
 * 4. Frontend redirects user to app → JWT cookie automatically sent with requests
 * 5. Protected routes use `@UseGuards(JwtAuthGuard)` to validate JWT
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly ticketService: TicketService
  ) {}

  /**
   * Initiate WorkOS login flow
   *
   * Redirects user to WorkOS AuthKit hosted login page.
   *
   * @example
   * GET /auth/login
   * → Redirect to: https://auth.workos.com/login?...
   */
  @Get('login')
  async login(@Res() res: Response): Promise<void> {
    const authorizationUrl = await this.authService.getAuthorizationUrl();
    res.redirect(authorizationUrl);
  }

  /**
   * Handle WorkOS callback
   *
   * Exchanges authorization code for user information,
   * generates JWT token, and sets HTTP-only cookie.
   *
   * @example
   * GET /auth/callback?code=abc123
   * → Sets cookie: access_token=<jwt>
   * → Redirects to: http://localhost:4200
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Res() res: Response
  ): Promise<void> {
    if (!code) {
      res.status(400).json({ error: 'Authorization code is required' });
      return;
    }

    try {
      const { token } = await this.authService.authenticateWithCode(code);

      // Set JWT in HTTP-only cookie
      res.cookie('access_token', token, {
        httpOnly: true, // Prevents JavaScript access (XSS protection)
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'lax', // CSRF protection
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/', // Available to all routes
      });

      // Redirect to frontend
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      res.redirect(frontendUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(401).json({
        error: 'Authentication failed',
        message,
      });
    }
  }

  /**
   * Logout user
   *
   * Clears JWT cookie and optionally redirects to WorkOS logout.
   *
   * @example
   * POST /auth/logout
   * → Clears cookie: access_token
   * → Returns: { success: true }
   */
  @Post('logout')
  logout(@Res() res: Response): void {
    res.clearCookie('access_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    const logoutRedirectUri = process.env.WORKOS_LOGOUT_REDIRECT_URI;
    if (logoutRedirectUri) {
      res.redirect(logoutRedirectUri);
    } else {
      res.json({ success: true, message: 'Logged out successfully' });
    }
  }

  /**
   * Get current authenticated user
   *
   * Protected route that returns user information from JWT.
   * Useful for frontend to check authentication status.
   *
   * @example
   * GET /auth/me
   * Cookie: access_token=<jwt>
   * → Returns: { id, email, tenantId, roles, permissions, tier }
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req: Request) {
    return req.user;
  }

  /**
   * Generate short-lived ticket for SSE authentication
   *
   * Protected endpoint that generates a 30-second ticket for opening SSE connections.
   * Workaround for EventSource API limitation (cannot set custom headers).
   *
   * **Flow**:
   * 1. Client authenticates with JWT (cookie or header)
   * 2. Client requests ticket via this endpoint
   * 3. Client opens SSE connection with ticket in query string
   * 4. Server validates ticket and establishes SSE connection
   *
   * **Security**:
   * - Requires JWT authentication
   * - Ticket valid for 30 seconds only
   * - Single-use enforcement (consumed on first use)
   * - Cryptographically secure random token
   *
   * @example
   * POST /auth/stream/ticket
   * Cookie: access_token=<jwt>
   * → Returns: { ticket: "abc123..." }
   *
   * Then use:
   * new EventSource('/api/stream?token=abc123...')
   *
   * Evidence: implementation-plan.md:454-495
   */
  @Post('stream/ticket')
  @UseGuards(JwtAuthGuard)
  async generateStreamTicket(@Req() req: Request) {
    const user = req.user as any;
    const ticket = await this.ticketService.create(
      user.userId || user.id,
      user.tenantId
    );
    return { ticket };
  }
}
