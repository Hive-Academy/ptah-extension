/**
 * Messaging Module - RPC Infrastructure
 *
 * NOTE: RpcMethodRegistrationService lives in the app layer to break the
 * circular dependency between vscode-core and agent-sdk.
 */

// RPC Handler
export { RpcHandler, ALLOWED_METHOD_PREFIXES } from './rpc-handler';
export type { RpcLicenseValidationResult } from './rpc-handler';
export { RpcUserError } from './rpc-types';
export type { RpcMessage, RpcResponse, RpcMethodHandler } from './rpc-types';
