/**
 * The vendor-neutral ACP layer: a vendor adapter supplies an
 * `AcpVendorProfile` and calls `createAcpSessionHandle` from `runSdk`.
 *
 * Nothing here re-exports an SDK runtime value: `@agentclientprotocol/sdk` is
 * ESM-only and loads lazily through `loadAcpSdk`/`connectAcp`.
 */
export { createAcpSessionHandle } from './acp-session-handle';
export type { AcpSessionHandleConfig } from './acp-session-handle';

export { readAcpErrorDetail } from './acp-vendor-profile';
export type {
  AcpRequestFailure,
  AcpRequestMethod,
  AcpResumeStrategy,
  AcpSessionConfigEntry,
  AcpVendorProfile,
} from './acp-vendor-profile';

export type {
  AcpProcessExit,
  AcpProcessTransport,
  AcpSpawnOptions,
  AcpTransportFactory,
} from './acp-process-transport';

export {
  ACP_MAX_MESSAGE_BYTES,
  AcpUnavailableError,
  connectAcp,
  loadAcpSdk,
} from './acp-sdk-loader';
export type {
  AcpByteStream,
  AcpClientHandlers,
  AcpConnectionApi,
  AcpSdkModule,
} from './acp-sdk-loader';
