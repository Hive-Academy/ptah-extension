/**
 * Ambient type declarations for @github/copilot-sdk
 *
 * The Copilot SDK is dynamically imported at runtime (ESM-only).
 * These minimal declarations prevent TypeScript errors when the package
 * is not installed. The actual SDK types will shadow these when installed.
 *
 * See: https://github.com/github/copilot-sdk
 */
declare module '@github/copilot-sdk' {
  export class CopilotClient {
    constructor(options?: {
      binaryPath?: string;
      env?: Record<string, string>;
    });
    createSession(options?: {
      workingDirectory?: string;
      instructions?: string;
    }): Promise<CopilotSession>;
    disconnect(): Promise<void>;
  }

  export interface CopilotSession {
    readonly id: string;
    sendMessage(
      message: string,
      options?: { signal?: AbortSignal }
    ): AsyncIterable<CopilotEvent>;
  }

  export type CopilotEvent = {
    type: string;
    [key: string]: unknown;
  };
}
