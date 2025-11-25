/**
 * ChatStateManagerService - PURGED for TASK_2025_023
 *
 * This service is being DELETED. Functionality will merge into ChatStoreService in Batch 5.
 * Keeping minimal shell for build compatibility.
 */

import { Injectable, signal, computed } from '@angular/core';

/**
 * Agent Option - UI model for agent selection dropdown
 * KEEPING for autocomplete feature compatibility
 */
export interface AgentOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

/**
 * TEMPORARY: Minimal ChatStateManagerService shell
 * Will be DELETED and merged into ChatStoreService in Batch 5
 */
@Injectable({ providedIn: 'root' })
export class ChatStateManagerService {
  // Minimal signals for build compatibility
  private readonly _currentMessage = signal('');
  private readonly _showSessionManager = signal(false);

  // Public signals
  readonly currentMessage = this._currentMessage.asReadonly();
  readonly showSessionManager = this._showSessionManager.asReadonly();
  readonly canSendMessage = computed(
    () => this._currentMessage().trim().length > 0
  );

  // Methods
  updateCurrentMessage(message: string): void {
    this._currentMessage.set(message);
  }

  clearCurrentMessage(): void {
    this._currentMessage.set('');
  }

  openSessionManager(): void {
    this._showSessionManager.set(true);
  }

  closeSessionManager(): void {
    this._showSessionManager.set(false);
  }
}
