/**
 * Messaging Module - RPC Infrastructure
 *
 * NOTE: RPC handler composition lives in `@ptah-extension/rpc-handlers`
 * (`registerRpcSurface`) to break the circular dependency between
 * vscode-core and agent-sdk.
 */
export { RpcHandler, ALLOWED_METHOD_PREFIXES } from './rpc-handler';
export { RpcUserError } from './rpc-types';
export type { RpcMessage, RpcResponse, RpcMethodHandler } from './rpc-types';
