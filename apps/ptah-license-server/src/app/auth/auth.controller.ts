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
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './services/auth.service';
import { TicketService } from './services/ticket.service';
import { MagicLinkService } from './services/magic-link.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';

/** Cookie name for PKCE state parameter (CSRF protection) */
const WORKOS_STATE_COOKIE = 'workos_state';

/** State cookie TTL in milliseconds (5 minutes) */
const STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Authentication Controller
 *
 * Handles WorkOS authentication flow with PKCE (OAuth 2.1 compliant)
 * and JWT session management.
 *
 * PKCE Flow (Proof Key for Code Exchange):
 * 1. User visits `/auth/login`
 *    → Generate code_verifier and code_challenge
 *    → Store code_verifier server-side (mapped to state)
 *    → Set state in HTTP-only cookie (CSRF protection)
 *    → Redirect to WorkOS with code_challenge
 *
 * 2. User completes authentication at WorkOS
 *    → WorkOS redirects to `/auth/callback?code=...&state=...`
 *
 * 3. Callback validation:
 *    → Validate state from cookie matches state from query
 *    → Retrieve code_verifier for this state
 *    → Exchange code + code_verifier for tokens
 *    → Generate JWT and set in HTTP-only cookie
 *
 * Security Properties:
 * - PKCE prevents authorization code interception attacks
 * - State cookie prevents CSRF attacks
 * - HTTP-only cookies prevent XSS token theft
 * - Secure flag ensures HTTPS-only in production
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly ticketService: TicketService,
    private readonly magicLinkService: MagicLinkService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService
  ) {}

  /**
   * Initiate WorkOS login flow with PKCE
   *
   * Security Flow:
   * 1. Generate PKCE code_verifier and code_challenge
   * 2. Generate state parameter for CSRF protection
   * 3. Store state in HTTP-only cookie (client-side verification)
   * 4. Store code_verifier server-side (mapped to state)
   * 5. Redirect to WorkOS with code_challenge and state
   *
   * Cookie Security:
   * - httpOnly: true - Prevents JavaScript access (XSS protection)
   * - secure: true in production - HTTPS only
   * - sameSite: 'lax' - CSRF protection while allowing redirect
   * - maxAge: 5 minutes - Short TTL limits attack window
   *
   * @example
   * GET /auth/login
   * → Sets cookie: workos_state=<state>
   * → Redirect to: https://auth.workos.com/login?code_challenge=...&state=...
   */
  @Get('login')
  async login(@Res() res: Response): Promise<void> {
    // Generate authorization URL with PKCE parameters
    const { url, state } = await this.authService.getAuthorizationUrl();

    // Set state in HTTP-only cookie for CSRF validation in callback
    // This cookie will be compared against the state parameter in the callback URL
    res.cookie(WORKOS_STATE_COOKIE, state, {
      httpOnly: true, // Prevents JavaScript access (XSS protection)
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax', // Allows cookie to be sent on redirect from WorkOS
      maxAge: STATE_COOKIE_MAX_AGE_MS, // 5 minutes - matches server-side state TTL
      path: '/', // Available for callback route
    });

    this.logger.debug(
      `Login initiated, state cookie set: ${state.substring(0, 8)}...`
    );

    // Redirect to WorkOS AuthKit with PKCE parameters
    res.redirect(url);
  }

  /**
   * Handle WorkOS callback with PKCE validation
   *
   * Security Validation:
   * 1. Verify code parameter exists (authorization code)
   * 2. Verify state parameter exists (CSRF token)
   * 3. Verify state cookie exists and matches state parameter (CSRF protection)
   * 4. Clear state cookie (single-use)
   * 5. Exchange code with server-side code_verifier for tokens
   *
   * Error Handling:
   * - Missing code: 400 Bad Request
   * - Missing/mismatched state: 401 Unauthorized (possible CSRF attack)
   * - WorkOS error: 401 Unauthorized with error message
   *
   * @example
   * GET /auth/callback?code=abc123&state=xyz789
   * Cookie: workos_state=xyz789
   * → Validates state match
   * → Clears workos_state cookie
   * → Sets cookie: access_token=<jwt>
   * → Redirects to: http://localhost:4200
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    // Step 1: Validate authorization code exists
    if (!code) {
      this.logger.warn('Callback received without authorization code');
      res.status(400).json({ error: 'Authorization code is required' });
      return;
    }

    // Step 2: Validate state parameter exists
    if (!state) {
      this.logger.warn('Callback received without state parameter');
      res.status(401).json({
        error: 'Invalid request',
        message: 'State parameter is required for security validation',
      });
      return;
    }

    // Step 3: Retrieve state from cookie and validate match
    const storedState = req.cookies?.[WORKOS_STATE_COOKIE];

    if (!storedState) {
      this.logger.warn(
        `State cookie missing, received state: ${state.substring(0, 8)}...`
      );
      res.status(401).json({
        error: 'Invalid session',
        message:
          'Authentication session not found. Please try logging in again.',
      });
      return;
    }

    if (storedState !== state) {
      this.logger.warn(
        `State mismatch - Cookie: ${storedState.substring(
          0,
          8
        )}..., Query: ${state.substring(0, 8)}...`
      );
      res.status(401).json({
        error: 'Invalid state',
        message:
          'Security validation failed. This may indicate a CSRF attack. Please try logging in again.',
      });
      return;
    }

    // Step 4: Clear state cookie (single-use, prevents replay)
    res.clearCookie(WORKOS_STATE_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    this.logger.debug(
      `State validated and cookie cleared: ${state.substring(0, 8)}...`
    );

    try {
      // Step 5: Exchange code for tokens with PKCE verification
      // The service will validate state against server-side storage
      // and use the stored code_verifier for the token exchange
      const { token } = await this.authService.authenticateWithCode(
        code,
        state
      );

      // Step 6: Set JWT in HTTP-only cookie for session management
      res.cookie('access_token', token, {
        httpOnly: true, // Prevents JavaScript access (XSS protection)
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'lax', // CSRF protection
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/', // Available to all routes
      });

      this.logger.debug('Authentication successful, JWT cookie set');

      // Step 7: Redirect to frontend application
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      res.redirect(frontendUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Authentication failed: ${message}`);
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

    // Step 3: Generate JWT token using public method
    const jwtPayload = {
      sub: user.id,
      email: user.email,
    };
    const jwtToken = this.authService.generateJwtToken(jwtPayload);

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
