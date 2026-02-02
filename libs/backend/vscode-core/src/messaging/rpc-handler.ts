/**
 * RPC Handler - Routes RPC method calls to registered handlers
 * Phase 2: RPC Migration (TASK_2025_021)
 *
 * This class replaces the old EventBus + MessageHandlerService pattern (deleted in Phase 0).
 * Instead of 94 message types and event subscriptions, we use simple method routing.
 *
 * Features:
 * - Map-based method routing (registerMethod/handleMessage)
 * - Correlation ID support for request/response matching
 * - Graceful error handling with try/catch
 * - Logger integration for debugging
 * - Dependency injection via TSyringe
 *
 * Usage:
 *   rpcHandler.registerMethod('session:list', async (params) => { ... });
 *   const response = await rpcHandler.handleMessage({
 *     method: 'session:list',
 *     params: {},
 *     correlationId: '123'
 *   });
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import type {
  LicenseService,
  LicenseStatus,
} from '../services/license.service';
import type {
  RpcMessage,
  RpcResponse,
  RpcMethodHandler,
  BaseRpcMethodHandler,
} from './rpc-types';

/**
 * Allowed RPC method prefixes for security validation
 * Only methods starting with these prefixes can be registered
 *
 * Security: Prevents unauthorized method registration and injection attacks
 */
const ALLOWED_METHOD_PREFIXES = [
  'session:',
  'chat:',
  'file:',
  'workspace:',
  'analytics:',
  'provider:',
  'config:',
  'context:',
  'autocomplete:',
  'permission:',
  'auth:',
  'setup-status:',
  'setup-wizard:',
  'llm:', // TASK_2025_073: LLM provider management (API keys, provider status)
  'license:', // TASK_2025_079: License status for premium feature gating
  'wizard:', // TASK_2025_124: Setup wizard deep analysis and agent recommendations
  'command:', // TASK_2025_126: Webview command execution (ptah.* commands only)
] as const;

/**
 * RPC methods requiring Pro tier subscription (TASK_2025_124, TASK_2025_129)
 *
 * Prefix matching: 'setup-status:' matches 'setup-status:get-status'
 *
 * Mapping from PRO_ONLY_FEATURES (FeatureGateService) to RPC prefixes:
 * - setup_wizard      -> setup-status:, setup-wizard:, wizard:
 *
 * Community features with RPC endpoints (available to ALL users):
 * - openrouter_proxy  -> openrouter: (un-gated in TASK_2025_129)
 *
 * Other Pro features WITHOUT RPC endpoints (gated via FeatureGateService):
 * - mcp_server            -> Backend-only, no RPC (uses MCP protocol)
 * - workspace_intelligence -> Internal service, no direct RPC
 * - custom_tools          -> Not yet implemented
 * - cost_tracking         -> Backend analytics, no direct RPC
 *
 * IMPORTANT: When adding new Pro features with RPC endpoints, add their
 * prefixes here to enforce Pro tier gating at the RPC layer.
 */
const PRO_ONLY_METHOD_PREFIXES = [
  'setup-status:', // setup_wizard feature
  'setup-wizard:', // setup_wizard feature
  'wizard:', // setup_wizard feature (deep-analyze, recommend-agents)
] as const;

/**
 * RPC methods that bypass license check entirely (TASK_2025_124)
 *
 * Required for license management and authentication flows.
 * These methods must work without a valid license to allow users to:
 * - View their license status
 * - Enter a license key
 * - Authenticate/login
 */
const LICENSE_EXEMPT_PREFIXES = [
  'license:', // Must work to show license status and enter keys
  'auth:', // Must work for login/authentication flow
  'command:', // TASK_2025_126: Must work for unlicensed users (welcome page actions)
] as const;

/**
 * Result of license validation for an RPC method (TASK_2025_124)
 *
 * Used by validateLicense() to indicate whether a method is allowed
 * and provide structured error information for the frontend.
 */
export interface RpcLicenseValidationResult {
  /** Whether the RPC method is allowed to proceed */
  allowed: boolean;
  /** Error details if not allowed */
  error?: {
    /** Error code for programmatic handling */
    code: 'LICENSE_REQUIRED' | 'PRO_TIER_REQUIRED';
    /** Human-readable error message */
    message: string;
  };
}

/**
 * RPC Handler service for routing RPC method calls
 * Manages registration and execution of RPC methods with security validation
 *
 * TASK_2025_124: Added license middleware for centralized license validation
 * - All RPC methods (except license:*, auth:*) require valid license
 * - Pro-only methods (setup-*, wizard:*) require Pro tier
 * - Uses getCachedStatus() only - NO server calls per request
 */
@injectable()
export class RpcHandler {
  private handlers = new Map<string, BaseRpcMethodHandler>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService
  ) {
    this.logger.debug('RpcHandler: Initialized with license middleware');
  }

  /**
   * Register an RPC method handler with security validation
   * Validates method name against whitelist before registration
   * Overwrites existing handler if method name already registered
   *
   * @param name - Method name (e.g., 'session:list', 'chat:sendMessage')
   * @param handler - Async function to handle the method (type-safe with generics)
   * @throws Error if method name doesn't match allowed prefixes
   *
   * @example
   * // Type-safe handler with explicit types
   * rpcHandler.registerMethod<SessionListParams, SessionListResult>(
   *   'session:list',
   *   async (params) => {
   *     // params is typed as SessionListParams
   *     const sessions = await sessionManager.listSessions(params.workspacePath);
   *     return { sessions }; // must match SessionListResult
   *   }
   * );
   *
   * // Invalid - throws Error
   * rpcHandler.registerMethod('malicious:hack', async () => { ... });
   * // Error: Invalid method name "malicious:hack" - must start with allowed prefix
   */
  registerMethod<TParams = unknown, TResult = unknown>(
    name: string,
    handler: RpcMethodHandler<TParams, TResult>
  ): void {
    // Security validation: Check method name against whitelist
    if (!this.isValidMethodName(name)) {
      const error = `Invalid method name "${name}" - must start with allowed prefix: ${ALLOWED_METHOD_PREFIXES.join(
        ', '
      )}`;
      this.logger.error(`RpcHandler: ${error}`);
      throw new Error(error);
    }

    // Warn if overwriting existing method
    if (this.handlers.has(name)) {
      this.logger.warn(`RpcHandler: Overwriting method "${name}"`);
    }

    // Store as BaseRpcMethodHandler (type erasure at runtime, but compile-time type safety)
    this.handlers.set(name, handler as BaseRpcMethodHandler);
    this.logger.debug(`RpcHandler: Registered method "${name}"`);
  }

  /**
   * Handle an RPC message from the frontend
   * Routes the message to the appropriate handler and returns a response
   *
   * @param message - RPC message with method, params, correlationId
   * @returns RPC response with success/error state
   *
   * @example
   * const response = await rpcHandler.handleMessage({
   *   method: 'session:list',
   *   params: {},
   *   correlationId: 'abc-123'
   * });
   *
   * if (response.success) {
   *   console.log('Sessions:', response.data);
   * } else {
   *   console.error('Error:', response.error);
   * }
   */
  async handleMessage(message: RpcMessage): Promise<RpcResponse> {
    const { method, params, correlationId } = message;

    this.logger.debug(`RpcHandler: Handling method "${method}"`, {
      correlationId,
    });

    // TASK_2025_124: License validation BEFORE handler lookup
    // This ensures unlicensed users cannot execute ANY non-exempt RPC methods
    const validation = this.validateLicense(method);
    if (!validation.allowed) {
      // Return structured error with errorCode for frontend handling
      // Frontend can differentiate LICENSE_REQUIRED vs PRO_TIER_REQUIRED
      return {
        success: false,
        error: validation.error!.message,
        errorCode: validation.error!.code,
        correlationId,
      };
    }

    const handler = this.handlers.get(method);
    if (!handler) {
      this.logger.warn(`RpcHandler: Method not found: "${method}"`);
      return {
        success: false,
        error: `Method not found: ${method}`,
        correlationId,
      };
    }

    try {
      const data = await handler(params);
      this.logger.debug(`RpcHandler: Method "${method}" succeeded`, {
        correlationId,
      });
      return { success: true, data, correlationId };
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`RpcHandler: Method "${method}" failed`, errorObj);
      return {
        success: false,
        error: errorObj.message,
        correlationId,
      };
    }
  }

  /**
   * Unregister an RPC method handler
   * No-op if method was not registered
   *
   * @param name - Method name to unregister
   *
   * @example
   * rpcHandler.unregisterMethod('session:list');
   */
  unregisterMethod(name: string): void {
    if (this.handlers.delete(name)) {
      this.logger.debug(`RpcHandler: Unregistered method "${name}"`);
    }
  }

  /**
   * Get list of registered method names
   * Useful for debugging and introspection
   *
   * @returns Array of method names
   *
   * @example
   * const methods = rpcHandler.getRegisteredMethods();
   * // ['session:list', 'chat:sendMessage', 'provider:getStatus']
   */
  getRegisteredMethods(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Validate method name against whitelist
   * Security check to prevent unauthorized method registration
   *
   * @param name - Method name to validate
   * @returns True if method name starts with allowed prefix
   *
   * @example
   * isValidMethodName('session:list')      // true
   * isValidMethodName('chat:sendMessage')  // true
   * isValidMethodName('malicious:hack')    // false
   * isValidMethodName('invalid')           // false
   */
  private isValidMethodName(name: string): boolean {
    return ALLOWED_METHOD_PREFIXES.some((prefix) => name.startsWith(prefix));
  }

  /**
   * Validate license before allowing RPC method execution (TASK_2025_124)
   *
   * Uses CACHED status only - NO server calls per request.
   * This ensures zero latency impact on RPC method execution.
   *
   * Validation flow:
   * 1. Check if method is exempt (license:*, auth:*) - always allowed
   * 2. Check if cached license status exists
   * 3. Check if license is valid (not expired)
   * 4. Check if Pro tier required and user has Pro tier
   *
   * Edge cases handled:
   * - No cached status: LICENSE_REQUIRED (user must restart extension)
   * - Invalid license: LICENSE_REQUIRED (subscription expired)
   * - Pro-only method with Community tier: PRO_TIER_REQUIRED
   * - Exempt methods: Always allowed (needed for login flow)
   *
   * @param method - RPC method name (e.g., 'session:list', 'setup-wizard:start')
   * @returns Validation result with allowed flag and optional error
   */
  private validateLicense(method: string): RpcLicenseValidationResult {
    // Step 1: Check exempt prefixes (license, auth) - always allowed
    // These must work without license to allow users to enter license key
    if (LICENSE_EXEMPT_PREFIXES.some((prefix) => method.startsWith(prefix))) {
      return { allowed: true };
    }

    // TASK_2025_124: Defensive coding - wrap in try/catch to handle unexpected errors
    // This prevents handleMessage from crashing if getCachedStatus throws
    try {
      // Step 2: Get cached license status (NO server call - O(1) memory read)
      const status: LicenseStatus | null =
        this.licenseService.getCachedStatus();

      // Step 3: Handle edge case - no cached status
      // This can happen if:
      // - Extension just started and verifyLicense() hasn't completed
      // - Cache was cleared unexpectedly
      // Solution: Return LICENSE_REQUIRED, user should restart extension
      if (!status) {
        this.logger.info(
          'RpcHandler: No cached license status, rejecting RPC',
          {
            method,
          }
        );
        return {
          allowed: false,
          error: {
            code: 'LICENSE_REQUIRED',
            message:
              'License verification required. Please restart the extension.',
          },
        };
      }

      // Step 4: Handle edge case - invalid license (expired, revoked, not found)
      // Block all non-exempt methods when license is invalid
      if (!status.valid) {
        this.logger.info('RpcHandler: Invalid license, blocking RPC', {
          method,
          tier: status.tier,
          reason: status.reason,
        });
        return {
          allowed: false,
          error: {
            code: 'LICENSE_REQUIRED',
            message:
              'Valid subscription required. Please subscribe to use this feature.',
          },
        };
      }

      // Step 5: Handle edge case - Pro-only method with Community tier
      // Pro-only methods: setup-status:*, setup-wizard:*, wizard:*
      if (this.isProOnlyMethod(method)) {
        const isPro = status.tier === 'pro' || status.tier === 'trial_pro';
        if (!isPro) {
          this.logger.info('RpcHandler: Pro tier required, blocking RPC', {
            method,
            tier: status.tier,
          });
          return {
            allowed: false,
            error: {
              code: 'PRO_TIER_REQUIRED',
              message:
                'Pro subscription required for this feature. Please upgrade to Pro.',
            },
          };
        }
      }

      // Valid license, allowed to proceed
      return { allowed: true };
    } catch (error) {
      // Defensive: If license check fails unexpectedly, block the request
      // This ensures we fail-closed rather than fail-open
      this.logger.error('RpcHandler: License validation error', {
        method,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        allowed: false,
        error: {
          code: 'LICENSE_REQUIRED',
          message: 'License verification failed. Please restart the extension.',
        },
      };
    }
  }

  /**
   * Check if RPC method requires Pro tier subscription (TASK_2025_124)
   *
   * Pro-only methods are derived from PRO_ONLY_FEATURES in FeatureGateService:
   * - setup_wizard feature: setup-status:*, setup-wizard:*, wizard:*
   *
   * @param method - RPC method name to check
   * @returns True if method requires Pro tier
   */
  private isProOnlyMethod(method: string): boolean {
    return PRO_ONLY_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix));
  }
}
