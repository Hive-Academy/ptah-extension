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
import { LOGGER } from '../di/tokens';
import type { Logger } from '../logging/logger';
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
] as const;

/**
 * RPC Handler service for routing RPC method calls
 * Manages registration and execution of RPC methods with security validation
 */
@injectable()
export class RpcHandler {
  private handlers = new Map<string, BaseRpcMethodHandler>();

  constructor(@inject(LOGGER) private readonly logger: Logger) {
    this.logger.debug('RpcHandler: Initialized');
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
}
