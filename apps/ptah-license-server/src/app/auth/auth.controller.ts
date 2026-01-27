import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Body,
  Param,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  AuthService,
  OAuthProvider,
  TicketService,
  MagicLinkService,
} from './services';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/services/email.service';
import {
  LoginDto,
  SignupDto,
  VerifyEmailDto,
  ResendVerificationDto,
  MagicLinkDto,
} from './dto';

/** Cookie name for PKCE state parameter (CSRF protection) */
const WORKOS_STATE_COOKIE = 'workos_state';

/** State cookie TTL in milliseconds (5 minutes) */
const STATE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Authentication Controller
 *
 * Handles multiple authentication flows with JWT session management.
 *
 * ============================================================================
 * UNIFIED COOKIE AUTHENTICATION
 * ============================================================================
 *
 * This application uses a SINGLE authentication cookie for ALL auth flows:
 *
 * **ptah_auth** - Unified JWT Cookie
 *    - Set by: All authentication endpoints (OAuth, email/password, magic link)
 *    - Validated by: JwtAuthGuard
 *    - Used for: All authenticated endpoints
 *
 * Supported authentication methods (all use the same ptah_auth cookie):
 * - OAuth (GitHub, Google) via WorkOS
 * - Email/password login
 * - Magic link passwordless login
 *
 * ============================================================================
 * WORKOS OAUTH FLOW (PKCE - OAuth 2.1 Compliant)
 * ============================================================================
 *
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
 *    → Generate JWT and set in HTTP-only cookie (ptah_auth)
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
  private readonly isProduction: boolean;
  private readonly frontendUrl: string;
  private readonly logoutRedirectUri: string | undefined;

  /** Allowed return URL paths for post-auth redirect (prevents open redirect) */
  private readonly ALLOWED_RETURN_PATHS = [
    '/pricing',
    '/profile',
    '/dashboard',
  ];

  /** Valid plan keys for checkout (TASK_2025_121: includes Basic and Pro) */
  private readonly VALID_PLAN_KEYS = [
    'basic-monthly',
    'basic-yearly',
    'pro-monthly',
    'pro-yearly',
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly ticketService: TicketService,
    private readonly magicLinkService: MagicLinkService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService
  ) {
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    this.logoutRedirectUri = this.configService.get<string>(
      'WORKOS_LOGOUT_REDIRECT_URI'
    );
  }

  /**
   * Validate returnUrl to prevent open redirect attacks.
   * Only allows relative paths from the whitelist.
   *
   * @param returnUrl - URL to validate
   * @returns Validated returnUrl or null if invalid
   */
  private validateReturnUrl(returnUrl: string | undefined): string | null {
    if (!returnUrl) return null;

    // Must start with / and not be protocol-relative (//)
    if (!returnUrl.startsWith('/') || returnUrl.startsWith('//')) {
      this.logger.warn(`Rejected invalid returnUrl: ${returnUrl}`);
      return null;
    }

    // Check against whitelist of allowed paths
    const pathOnly = returnUrl.split('?')[0]; // Remove query params for comparison
    if (!this.ALLOWED_RETURN_PATHS.includes(pathOnly)) {
      this.logger.warn(`Rejected non-whitelisted returnUrl: ${returnUrl}`);
      return null;
    }

    // Final safety check: ensure constructed URL stays on same origin
    try {
      const constructed = new URL(returnUrl, this.frontendUrl);
      const frontendOrigin = new URL(this.frontendUrl).origin;
      if (constructed.origin !== frontendOrigin) {
        this.logger.warn(
          `Rejected returnUrl that escaped origin: ${returnUrl}`
        );
        return null;
      }
    } catch {
      this.logger.warn(`Rejected malformed returnUrl: ${returnUrl}`);
      return null;
    }

    return returnUrl;
  }

  /**
   * Validate plan key against allowed values.
   *
   * @param plan - Plan key to validate
   * @returns Validated plan key or null if invalid
   */
  private validatePlanKey(plan: string | undefined): string | null {
    if (!plan) return null;

    if (!this.VALID_PLAN_KEYS.includes(plan)) {
      this.logger.warn(`Rejected invalid plan key: ${plan}`);
      return null;
    }

    return plan;
  }

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
      secure: this.isProduction, // HTTPS only in production
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
   * → Sets cookie: ptah_auth=<jwt>
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
      secure: this.isProduction,
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
      // Also returns returnUrl and plan if they were stored with the OAuth state
      const { token, returnUrl, plan } =
        await this.authService.authenticateWithCode(code, state);

      // Step 6: Set JWT in HTTP-only cookie for session management
      res.cookie('ptah_auth', token, {
        httpOnly: true, // Prevents JavaScript access (XSS protection)
        secure: this.isProduction, // HTTPS only in production
        sameSite: 'lax', // CSRF protection
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/', // Available to all routes
      });

      // Step 7: Validate returnUrl and plan again (defense in depth)
      const validatedReturnUrl = this.validateReturnUrl(returnUrl ?? undefined);
      const validatedPlan = this.validatePlanKey(plan ?? undefined);

      this.logger.debug(
        `Authentication successful, JWT cookie set${
          validatedReturnUrl ? ` returnUrl=${validatedReturnUrl}` : ''
        }${validatedPlan ? ` plan=${validatedPlan}` : ''}`
      );

      // Step 8: Redirect to frontend application (with validated returnUrl and plan)
      // Always include auth_hint=1 to signal frontend to set localStorage hint
      // This syncs frontend auth state with backend HTTP-only cookie
      if (validatedReturnUrl) {
        // Build redirect URL with returnUrl path and optional autoCheckout param
        const redirectUrl = new URL(validatedReturnUrl, this.frontendUrl);
        redirectUrl.searchParams.set('auth_hint', '1');
        if (validatedPlan) {
          redirectUrl.searchParams.set('autoCheckout', validatedPlan);
        }
        res.redirect(redirectUrl.toString());
      } else {
        // Default: redirect to frontend root with auth hint
        res.redirect(`${this.frontendUrl}?auth_hint=1`);
      }
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
   * Clears the unified ptah_auth JWT cookie.
   *
   * @example
   * POST /auth/logout
   * → Clears cookie: ptah_auth
   * → Returns: { success: true }
   */
  @Post('logout')
  logout(@Res() res: Response): void {
    // Clear unified authentication cookie
    res.clearCookie('ptah_auth', {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/',
    });

    if (this.logoutRedirectUri) {
      res.redirect(this.logoutRedirectUri);
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
   * Cookie: ptah_auth=<jwt>
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
   * - Magic link valid for 2 minutes
   * - Single-use token enforcement
   * - returnUrl and plan are validated before storing
   *
   * **Flow**:
   * 1. User enters email on portal login page
   * 2. Backend checks if user exists (has license)
   * 3. If user exists: Create magic link with optional returnUrl/plan, send email
   * 4. If user doesn't exist: Return success but don't send email (security)
   * 5. User clicks link in email → GET /auth/verify → redirects with autoCheckout
   *
   * @example
   * POST /auth/magic-link
   * Body: { "email": "user@example.com", "returnUrl": "/pricing", "plan": "pro-monthly" }
   * → Returns: { success: true, message: "Check your email for login link" }
   */
  @Post('magic-link')
  async requestMagicLink(
    @Body() body: MagicLinkDto
  ): Promise<{ success: boolean; message: string }> {
    const { email, returnUrl, plan } = body;

    // Validate returnUrl and plan to prevent security issues
    const validatedReturnUrl = this.validateReturnUrl(returnUrl);
    const validatedPlan = this.validatePlanKey(plan);

    // Step 1: Check if user exists in database
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Step 2: Only send email if user exists (but always return success)
    if (user) {
      try {
        // Step 2a: Create magic link token with optional returnUrl/plan
        const magicLink = await this.magicLinkService.createMagicLink(email, {
          returnUrl: validatedReturnUrl ?? undefined,
          plan: validatedPlan ?? undefined,
        });

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
   * and redirects to portal dashboard or returnUrl with autoCheckout.
   *
   * **Security**:
   * - No authentication required (public endpoint)
   * - Token validation includes expiration and single-use checks
   * - JWT stored in HTTP-only cookie (XSS protection)
   * - Secure flag enabled in production (HTTPS only)
   * - SameSite=lax for CSRF protection
   * - returnUrl/plan validated again before redirect (defense in depth)
   *
   * **Flow**:
   * 1. User clicks magic link in email
   * 2. Backend validates token (2-minute TTL, single-use)
   * 3. If valid: Generate JWT, set cookie, redirect with optional autoCheckout
   * 4. If invalid: Redirect to login with error message
   *
   * @example
   * GET /auth/verify?token=abc123...
   * → Success: Sets cookie + redirects to returnUrl?autoCheckout=plan or /profile
   * → Failure: Redirects to /login?error=token_expired
   */
  @Get('verify')
  async verifyMagicLink(
    @Query('token') token: string,
    @Res() res: Response
  ): Promise<void> {
    // Debug: Log the received token
    this.logger.debug(
      `Magic link verification requested. Token received: ${
        token
          ? `${token.substring(0, 8)}...${token.substring(
              token.length - 8
            )} (length: ${token.length})`
          : 'MISSING'
      }`
    );

    if (!token) {
      this.logger.warn(
        'Magic link verification failed: no token in query string'
      );
      res.redirect(`${this.frontendUrl}/login?error=token_missing`);
      return;
    }

    // Step 1: Validate and consume token (now includes returnUrl/plan)
    const result = await this.magicLinkService.validateAndConsume(token);

    if (!result.valid) {
      // Step 1a: Token invalid - redirect to login with error
      res.redirect(`${this.frontendUrl}/login?error=${result.error}`);
      return;
    }

    // Step 2: Token valid - find user in database
    const user = await this.prisma.user.findUnique({
      where: { email: result.email },
    });

    if (!user) {
      // User was deleted between magic link creation and verification
      res.redirect(`${this.frontendUrl}/login?error=user_not_found`);
      return;
    }

    // Step 3: Generate JWT token using public method
    const jwtPayload = {
      sub: user.id,
      email: user.email,
    };
    const jwtToken = this.authService.generateJwtToken(jwtPayload);

    // Step 4: Set HTTP-only cookie with JWT for unified authentication
    // All auth methods use the same 'ptah_auth' cookie
    // This is validated by JwtAuthGuard for all protected endpoints
    res.cookie('ptah_auth', jwtToken, {
      httpOnly: true, // Prevents JavaScript access (XSS protection)
      secure: this.isProduction, // HTTPS only in production
      sameSite: 'lax', // CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/', // Available to all routes
    });

    // Step 5: Validate returnUrl and plan again (defense in depth)
    const validatedReturnUrl = this.validateReturnUrl(
      result.returnUrl ?? undefined
    );
    const validatedPlan = this.validatePlanKey(result.plan ?? undefined);

    // Step 6: Redirect to returnUrl with autoCheckout or default to profile
    // Always include auth_hint=1 to signal frontend to set localStorage hint
    // This syncs frontend auth state with backend HTTP-only cookie
    if (validatedReturnUrl) {
      const redirectUrl = new URL(validatedReturnUrl, this.frontendUrl);
      redirectUrl.searchParams.set('auth_hint', '1');
      if (validatedPlan) {
        redirectUrl.searchParams.set('autoCheckout', validatedPlan);
      }
      this.logger.debug(
        `Magic link auth successful, redirecting to: ${redirectUrl.toString()}`
      );
      res.redirect(redirectUrl.toString());
    } else {
      res.redirect(`${this.frontendUrl}/profile?auth_hint=1`);
    }
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
   * Cookie: ptah_auth=<jwt>
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
      user.tenantId,
      user.email
    );
    return { ticket };
  }

  // ============================================
  // CUSTOM FRONTEND AUTH ENDPOINTS
  // These endpoints support full frontend control
  // without using WorkOS AuthKit hosted UI
  // ============================================

  /**
   * Email/Password Login
   *
   * Authenticates user with email and password directly via WorkOS API.
   * Returns JWT token in HTTP-only cookie and user data in response.
   *
   * @example
   * POST /auth/login/email
   * Body: { "email": "user@example.com", "password": "secret123" }
   * → Sets cookie: ptah_auth=<jwt>
   * → Returns: { success: true, user: { id, email, ... } }
   */
  @Post('login/email')
  async loginWithEmail(
    @Body() body: LoginDto,
    @Res() res: Response
  ): Promise<void> {
    const { email, password } = body;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const { token, user } = await this.authService.authenticateWithPassword(
      email,
      password
    );

    // Set JWT in HTTP-only cookie
    res.cookie('ptah_auth', token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    this.logger.log(`Email login successful for: ${email}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        roles: user.roles,
        tier: user.tier,
      },
    });
  }

  /**
   * User Signup with Email/Password
   *
   * Creates a new user with email and password via WorkOS API.
   * Returns pending_verification status - user must verify email first.
   * WorkOS automatically sends a verification email with a 6-digit code.
   *
   * @example
   * POST /auth/signup
   * Body: { "email": "user@example.com", "password": "secret123", "firstName": "John" }
   * → Returns: { success: true, pendingVerification: true, userId: "...", email: "..." }
   */
  @Post('signup')
  async signup(@Body() body: SignupDto, @Res() res: Response): Promise<void> {
    const { email, password, firstName, lastName } = body;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const result = await this.authService.createUserWithPassword(
      email,
      password,
      firstName,
      lastName
    );

    this.logger.log(
      `User signup initiated for: ${email} (pending verification)`
    );

    // Return pending verification status - no cookie yet
    res.json({
      success: true,
      pendingVerification: result.pendingVerification,
      userId: result.userId,
      email: result.email,
      message: 'Please check your email for a verification code.',
    });
  }

  /**
   * Verify Email with Code
   *
   * Verifies user's email with the 6-digit code sent by WorkOS.
   * On success, issues JWT token in HTTP-only cookie.
   *
   * @example
   * POST /auth/verify-email
   * Body: { "userId": "user_xxx", "code": "123456" }
   * → Sets cookie: ptah_auth=<jwt>
   * → Returns: { success: true, user: { id, email, ... } }
   */
  @Post('verify-email')
  async verifyEmail(
    @Body() body: VerifyEmailDto,
    @Res() res: Response
  ): Promise<void> {
    const { userId, code } = body;

    if (!userId || !code) {
      throw new BadRequestException(
        'User ID and verification code are required'
      );
    }

    const { token, user } = await this.authService.verifyEmailCode(
      userId,
      code
    );

    // Set JWT in HTTP-only cookie
    res.cookie('ptah_auth', token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    this.logger.log(`Email verified for: ${user.email}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        roles: user.roles,
        tier: user.tier,
      },
    });
  }

  /**
   * Resend Verification Code
   *
   * Sends a new verification code to the user's email.
   *
   * @example
   * POST /auth/resend-verification
   * Body: { "userId": "user_xxx" }
   * → Returns: { success: true, message: "..." }
   */
  @Post('resend-verification')
  async resendVerification(
    @Body() body: ResendVerificationDto,
    @Res() res: Response
  ): Promise<void> {
    const { userId } = body;

    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await this.authService.resendVerificationCode(userId);

    this.logger.log(`Verification code resent for user: ${userId}`);

    res.json({
      success: true,
      message: 'A new verification code has been sent to your email.',
    });
  }

  /**
   * Direct OAuth Login (GitHub/Google)
   *
   * Redirects directly to OAuth provider without going through WorkOS AuthKit.
   * After authentication, user is redirected back to /auth/callback.
   *
   * Supported providers:
   * - github: GitHub OAuth
   * - google: Google OAuth
   *
   * Query Parameters:
   * - returnUrl: Optional URL path to redirect to after auth (e.g., '/pricing')
   * - plan: Optional plan key for auto-checkout (e.g., 'pro-monthly', 'pro-yearly')
   *
   * @example
   * GET /auth/oauth/github?returnUrl=/pricing&plan=pro-monthly
   * → Sets cookie: workos_state=<state>
   * → Redirect to: https://github.com/login/oauth/authorize?...
   * → After auth: Redirect to /pricing?autoCheckout=pro-monthly
   *
   * @example
   * GET /auth/oauth/google
   * → Sets cookie: workos_state=<state>
   * → Redirect to: https://accounts.google.com/o/oauth2/auth?...
   */
  @Get('oauth/:provider')
  async oauthLogin(
    @Param('provider') provider: string,
    @Query('returnUrl') returnUrl: string | undefined,
    @Query('plan') plan: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    // Validate provider
    const validProviders: OAuthProvider[] = ['github', 'google'];
    if (!validProviders.includes(provider as OAuthProvider)) {
      throw new BadRequestException(
        `Invalid OAuth provider: ${provider}. Supported: ${validProviders.join(
          ', '
        )}`
      );
    }

    // Validate returnUrl and plan to prevent security issues
    const validatedReturnUrl = this.validateReturnUrl(returnUrl);
    const validatedPlan = this.validatePlanKey(plan);

    // Generate authorization URL for the specific provider (with validated params)
    const { url, state } = await this.authService.getOAuthAuthorizationUrl(
      provider as OAuthProvider,
      validatedReturnUrl ?? undefined,
      validatedPlan ?? undefined
    );

    // Set state in HTTP-only cookie for CSRF validation in callback
    res.cookie(WORKOS_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      maxAge: STATE_COOKIE_MAX_AGE_MS,
      path: '/',
    });

    this.logger.debug(
      `OAuth login initiated for ${provider}, state: ${state.substring(
        0,
        8
      )}...${validatedReturnUrl ? ` returnUrl=${validatedReturnUrl}` : ''}${
        validatedPlan ? ` plan=${validatedPlan}` : ''
      }`
    );

    // Redirect directly to OAuth provider
    res.redirect(url);
  }
}
