import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Body,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import { TicketService } from './services/ticket.service';
import { MagicLinkService } from './services/magic-link.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';

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
    private readonly ticketService: TicketService,
    private readonly magicLinkService: MagicLinkService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService
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
   * Request magic link for passwordless portal login
   *
   * Sends a magic link email to the user's email address.
   * Always returns success to prevent email enumeration attacks.
   *
   * **Security**:
   * - No authentication required (public endpoint)
   * - Always returns success (prevents email enumeration)
   * - Only sends email if user exists in database
   * - Magic link valid for 30 seconds
   * - Single-use token enforcement
   *
   * **Flow**:
   * 1. User enters email on portal login page
   * 2. Backend checks if user exists (has license)
   * 3. If user exists: Create magic link, send email
   * 4. If user doesn't exist: Return success but don't send email (security)
   * 5. User clicks link in email → GET /auth/verify
   *
   * @example
   * POST /auth/magic-link
   * Body: { "email": "user@example.com" }
   * → Returns: { success: true, message: "Check your email for login link" }
   */
  @Post('magic-link')
  async requestMagicLink(
    @Body('email') email: string
  ): Promise<{ success: boolean; message: string }> {
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    // Step 1: Check if user exists in database
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Step 2: Only send email if user exists (but always return success)
    if (user) {
      try {
        // Step 2a: Create magic link token
        const magicLink = await this.magicLinkService.createMagicLink(email);

        // Step 2b: Send email with magic link
        await this.emailService.sendMagicLink({ email, magicLink });
      } catch (error) {
        // Log error but still return success (graceful degradation)
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to send magic link to ${email}: ${errorMessage}`);
      }
    }

    // Step 3: Always return success to prevent email enumeration
    return {
      success: true,
      message: 'Check your email for login link',
    };
  }

  /**
   * Verify magic link token and authenticate user
   *
   * Validates magic link token, generates JWT, sets HTTP-only cookie,
   * and redirects to portal dashboard.
   *
   * **Security**:
   * - No authentication required (public endpoint)
   * - Token validation includes expiration and single-use checks
   * - JWT stored in HTTP-only cookie (XSS protection)
   * - Secure flag enabled in production (HTTPS only)
   * - SameSite=lax for CSRF protection
   *
   * **Flow**:
   * 1. User clicks magic link in email
   * 2. Backend validates token (30s TTL, single-use)
   * 3. If valid: Generate JWT, set cookie, redirect to portal
   * 4. If invalid: Redirect to login with error message
   *
   * @example
   * GET /auth/verify?token=abc123...
   * → Success: Sets cookie + redirects to /portal/dashboard
   * → Failure: Redirects to /auth/login?error=token_expired
   */
  @Get('verify')
  async verifyMagicLink(
    @Query('token') token: string,
    @Res() res: Response
  ): Promise<void> {
    if (!token) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      res.redirect(`${frontendUrl}/auth/login?error=token_missing`);
      return;
    }

    // Step 1: Validate and consume token
    const result = await this.magicLinkService.validateAndConsume(token);

    if (!result.valid) {
      // Step 1a: Token invalid - redirect to login with error
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      res.redirect(`${frontendUrl}/auth/login?error=${result.error}`);
      return;
    }

    // Step 2: Token valid - find user in database
    const user = await this.prisma.user.findUnique({
      where: { email: result.email },
    });

    if (!user) {
      // User was deleted between magic link creation and verification
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      res.redirect(`${frontendUrl}/auth/login?error=user_not_found`);
      return;
    }

    // Step 3: Generate JWT token
    const jwtPayload = {
      sub: user.id,
      email: user.email,
    };
    const jwtToken = this.authService['jwtService'].sign(jwtPayload);

    // Step 4: Set HTTP-only cookie with JWT
    res.cookie('ptah_auth', jwtToken, {
      httpOnly: true, // Prevents JavaScript access (XSS protection)
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax', // CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/', // Available to all routes
    });

    // Step 5: Redirect to portal dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    res.redirect(`${frontendUrl}/portal/dashboard`);
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
