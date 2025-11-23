/**
 * Claude Message Transformer Service - STUB IMPLEMENTATION
 *
 * This service was deleted in Phase 0 (RPC Migration).
 * This stub maintains compilation for components during the transition.
 *
 * TODO (Phase 4): Migrate components to use StrictChatMessage directly
 * TODO (Phase 4): Remove this stub service once all components updated
 */

import { Injectable } from '@angular/core';
import {
  ClaudeContent,
  ContentProcessingResult,
} from '../types/message-transformer.types';

@Injectable({
  providedIn: 'root',
})
export class ClaudeMessageTransformerService {
  /**
   * Extract content from message - STUB
   *
   * Returns empty result until components are migrated.
   */
  extractContent(_content: string | unknown): ContentProcessingResult {
    return {
      contentBlocks: [] as ClaudeContent[],
      extractedFiles: [],
      toolSummary: [],
    };
  }

  /**
   * Process message content - STUB
   *
   * Returns input as-is until components are migrated.
   */
  processContent(content: string | unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    return JSON.stringify(content);
  }
}
