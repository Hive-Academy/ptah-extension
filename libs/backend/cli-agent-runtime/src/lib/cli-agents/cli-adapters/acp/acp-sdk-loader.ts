/**
 * AcpSdkLoader — the only module that touches runtime values of the ESM-only
 * `@agentclientprotocol/sdk` package.
 *
 * Every other file in the ACP layer imports the SDK with `import type` only
 * (pinned by `acp-sdk-loader.spec.ts`). Two reasons:
 * - A static runtime import of an ESM-only package breaks every CommonJS Jest
 *   suite that loads the adapters barrel. The dynamic import below compiles to
 *   a lazy `require` under ts-jest, so only the specs that run the ACP path
 *   load it.
 * - The rest of the layer depends on {@link AcpConnectionApi}, not on the SDK
 *   classes, so the SDK can be swapped for a thin in-house client if a host
 *   bundle ever cannot load it.
 */
import type * as AcpSdk from '@agentclientprotocol/sdk';
import type {
  CancelNotification,
  Client,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';

/** The SDK runtime values Ptah uses. */
export type AcpSdkModule = Pick<
  typeof AcpSdk,
  'ClientSideConnection' | 'ndJsonStream'
>;

/** Client-side handlers the agent can call (permission requests, session updates, extensions). */
export type AcpClientHandlers = Client;

/**
 * Upper bound for one inbound NDJSON message. The SDK default is 32 MiB; a lane
 * never needs more than a few MiB per message, and a smaller cap bounds the
 * memory a misbehaving agent can pin. An oversized message closes the
 * connection, which the runner reports as a failed turn.
 */
export const ACP_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/** The agent's byte streams, seen from the client: read its stdout, write its stdin. */
export interface AcpByteStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

/**
 * The narrow set of `ClientSideConnection` members Ptah calls. Every other
 * component depends on this interface, never on the SDK class.
 */
export interface AcpConnectionApi {
  initialize(params: InitializeRequest): Promise<InitializeResponse>;
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse>;
  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse>;
  setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse>;
  prompt(params: PromptRequest): Promise<PromptResponse>;
  /** `session/cancel` is a notification: it resolves once written, not when the agent acts. */
  cancel(params: CancelNotification): Promise<void>;
  /** Aborted once the connection closes (stream end, stream error, or oversized message). */
  readonly signal: AbortSignal;
  /** Resolves once the connection closes. Pending requests reject at that point. */
  readonly closed: Promise<void>;
}

/** The ACP client library could not be loaded, so no ACP lane can start. */
export class AcpUnavailableError extends Error {
  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `The ACP client library could not be loaded: ${reason}. ` +
        'Reinstall or update Ptah so that @agentclientprotocol/sdk is present, then start the lane again.',
      { cause },
    );
    this.name = 'AcpUnavailableError';
  }
}

/**
 * Cached successful import of the SDK. Failures are not stored, so a transient
 * failure is retried by the next lane instead of breaking ACP for the session.
 */
let acpSdkModule: AcpSdkModule | null = null;

/**
 * Lazily import the ESM-only SDK.
 *
 * The specifier is a string literal so esbuild can resolve it at build time:
 * the VS Code bundle inlines it, and Electron, CLI and TUI keep it external.
 *
 * @throws AcpUnavailableError when the import fails.
 */
export async function loadAcpSdk(): Promise<AcpSdkModule> {
  if (acpSdkModule) {
    return acpSdkModule;
  }
  let mod: AcpSdkModule;
  try {
    mod = await import('@agentclientprotocol/sdk');
  } catch (error: unknown) {
    throw new AcpUnavailableError(error);
  }
  acpSdkModule = mod;
  return mod;
}

/**
 * Open an ACP client connection over an agent's byte streams.
 *
 * Loads the SDK, frames the streams as NDJSON capped at
 * {@link ACP_MAX_MESSAGE_BYTES}, and binds `handlers` as the client side.
 *
 * @throws AcpUnavailableError when the SDK cannot be loaded.
 */
export async function connectAcp(
  stream: AcpByteStream,
  handlers: AcpClientHandlers,
): Promise<AcpConnectionApi> {
  const sdk = await loadAcpSdk();
  const framed = sdk.ndJsonStream(stream.writable, stream.readable, {
    maxMessageBytes: ACP_MAX_MESSAGE_BYTES,
  });
  return new sdk.ClientSideConnection(() => handlers, framed);
}
