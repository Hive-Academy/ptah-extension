/**
 * Messaging Module - RPC Infrastructure
 *
 * NOTE: RpcMethodRegistrationService lives in the app layer to break the
 * circular dependency between vscode-core and agent-sdk.
 */
export { RpcHandler, ALLOWED_METHOD_PREFIXES } from './rpc-handler';
export { RpcUserError } from './rpc-types';
export type { RpcMessage, RpcResponse, RpcMethodHandler } from './rpc-types';
