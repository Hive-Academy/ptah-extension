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
} from '../setup-wizard-state.types';

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

const WIZARD_MESSAGE_TYPES: readonly WizardMessageType[] = [
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

/**
 * WizardMessageDispatcher — validates an inbound {@link WizardMessage} and
 * routes it to its handler on {@link WizardMessageHandlers}. Inbound delivery
 * is owned by the canonical `MessageRouterService`, which unwraps the Electron
 * IPC `BATCH` envelope before dispatch.
 */
export class WizardMessageDispatcher {
  public readonly handledMessageTypes: readonly string[] = WIZARD_MESSAGE_TYPES;

  public constructor(
    private readonly handlers: WizardMessageHandlers,
    private readonly errorStateSignal: WritableSignal<ErrorState | null>,
  ) {}

  public dispatch(message: WizardMessage): void {
    try {
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

    return WIZARD_MESSAGE_TYPES.includes(
      (message as { type: string }).type as WizardMessageType,
    );
  }
}
export type { AnalysisResults, CompletionData };
