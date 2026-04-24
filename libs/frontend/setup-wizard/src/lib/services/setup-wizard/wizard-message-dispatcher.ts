import type {
  AnalysisCompletePayload,
  AnalysisStreamPayload,
  AvailableAgentsPayload,
  GenerationCompletePayload,
  GenerationProgressPayload,
  GenerationStreamPayload,
  ScanProgressPayload,
  WizardErrorPayload,
  WizardMessage,
  WizardMessageType,
} from '@ptah-extension/shared';
import type { WritableSignal } from '@angular/core';
import type {
  AnalysisResults,
  CompletionData,
  ErrorState,
} from '../setup-wizard-state.service';

/**
 * Callbacks the message dispatcher invokes for specific wizard events.
 * Each handler is responsible for its own signal updates and follow-on
 * state transitions; the dispatcher only routes by message type.
 */
export interface WizardMessageHandlers {
  handleScanProgress(payload: ScanProgressPayload): void;
  handleAnalysisStream(payload: AnalysisStreamPayload): void;
  handleAnalysisComplete(payload: AnalysisCompletePayload): void;
  handleAvailableAgents(payload: AvailableAgentsPayload): void;
  handleGenerationProgress(payload: GenerationProgressPayload): void;
  handleGenerationComplete(payload: GenerationCompletePayload): void;
  handleGenerationStream(payload: GenerationStreamPayload): void;
  handleEnhanceStream(payload: AnalysisStreamPayload): void;
  handleError(payload: WizardErrorPayload): void;
}

/**
 * WizardMessageDispatcher — registers the window 'message' listener,
 * validates incoming data as a {@link WizardMessage}, and routes each
 * message to its handler on {@link WizardMessageHandlers}.
 *
 * Owns the listener lifecycle (register/dispose) and the exhaustive
 * type-safety switch; handlers live on other helpers / the coordinator.
 */
export class WizardMessageDispatcher {
  /** Stored reference for removeEventListener in dispose(). */
  private messageHandler: ((event: MessageEvent) => void) | null = null;

  /** Guard against duplicate registration when the coordinator is reused. */
  private registered = false;

  public constructor(
    private readonly handlers: WizardMessageHandlers,
    private readonly errorStateSignal: WritableSignal<ErrorState | null>,
  ) {}

  /**
   * Ensure message listener is registered exactly once.
   * Safe to call multiple times.
   */
  public ensureRegistered(): void {
    if (this.registered) return;
    this.setupListener();
    this.registered = true;
  }

  /**
   * Remove the message listener (for tests or explicit teardown).
   * Root services (providedIn: 'root') normally never dispose.
   */
  public dispose(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
      this.registered = false;
    }
  }

  private setupListener(): void {
    this.messageHandler = (event: MessageEvent): void => {
      const message = event.data;
      if (!WizardMessageDispatcher.isWizardMessage(message)) {
        return;
      }

      try {
        // Type-safe switch with exhaustive checking via discriminated union
        switch (message.type) {
          case 'setup-wizard:scan-progress':
            this.handlers.handleScanProgress(message.payload);
            break;
          case 'setup-wizard:analysis-complete':
            this.handlers.handleAnalysisComplete(message.payload);
            break;
          case 'setup-wizard:available-agents':
            this.handlers.handleAvailableAgents(message.payload);
            break;
          case 'setup-wizard:generation-progress':
            this.handlers.handleGenerationProgress(message.payload);
            break;
          case 'setup-wizard:generation-complete':
            this.handlers.handleGenerationComplete(message.payload);
            break;
          case 'setup-wizard:analysis-stream':
            this.handlers.handleAnalysisStream(message.payload);
            break;
          case 'setup-wizard:generation-stream':
            this.handlers.handleGenerationStream(message.payload);
            break;
          case 'setup-wizard:enhance-stream':
            this.handlers.handleEnhanceStream(message.payload);
            break;
          case 'setup-wizard:error':
            this.handlers.handleError(message.payload);
            break;
          default: {
            const _exhaustiveCheck: never = message;
            console.warn('Unhandled wizard message type:', _exhaustiveCheck);
          }
        }
      } catch (error) {
        console.error('Error handling setup wizard message:', error);
        this.errorStateSignal.set({
          message: 'Failed to process backend message',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  /** Type guard for {@link WizardMessage} discriminated union. */
  public static isWizardMessage(message: unknown): message is WizardMessage {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      !('payload' in message)
    ) {
      return false;
    }

    const validTypes: WizardMessageType[] = [
      'setup-wizard:scan-progress',
      'setup-wizard:analysis-stream',
      'setup-wizard:analysis-complete',
      'setup-wizard:available-agents',
      'setup-wizard:generation-progress',
      'setup-wizard:generation-complete',
      'setup-wizard:generation-stream',
      'setup-wizard:enhance-stream',
      'setup-wizard:error',
    ];

    return validTypes.includes(
      (message as { type: string }).type as WizardMessageType,
    );
  }
}

// Re-export small helper for coordinator convenience
export type { AnalysisResults, CompletionData };
