/**
 * Messaging Module - RPC Infrastructure
 * Phase 2: RPC Migration (TASK_2025_021)
 *
 * This module exports the RPC handler infrastructure that replaces
 * the old event-based messaging system (deleted in Phase 0).
 *
 * NOTE: RpcMethodRegistrationService moved to app layer (TASK_2025_051)
 * to break circular dependency between vscode-core and agent-sdk.
 */

// RPC Handler (Phase 2 - TASK_2025_021)
export { RpcHandler } from './rpc-handler';
export type { RpcMessage, RpcResponse, RpcMethodHandler } from './rpc-types';

// SDK RPC Handlers (TASK_2025_044 Batch 3)
export { SdkRpcHandlers } from './sdk-rpc-handlers';
