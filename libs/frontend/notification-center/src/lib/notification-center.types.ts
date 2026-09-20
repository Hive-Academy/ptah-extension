import type { NotificationFocusTarget } from '@ptah-extension/core';
import type {
  SdkTerminalReason,
  PermissionRequest,
  AskUserQuestionRequest,
} from '@ptah-extension/shared';

export type NotificationClassification = 'success' | 'error';

export interface CompletionNotificationEntry {
  readonly kind: 'completion';
  readonly id: string;
  readonly revision: number;
  readonly tabId: string;
  readonly sessionId: string;
  readonly workspacePath: string;
  readonly workspaceLabel: string;
  readonly title: string;
  readonly sessionColor: string;
  readonly phase: 'idle' | 'failed';
  readonly terminalReason: SdkTerminalReason | null;
  readonly classification: NotificationClassification;
  readonly occurredAt: number;
  readonly readAt: number | null;
  readonly dismissed: boolean;
  readonly target: NotificationFocusTarget;
}

export interface PendingNotificationEntry {
  readonly kind: 'question' | 'permission';
  readonly id: string;
  readonly sourceId: string;
  readonly sessionId: string;
  readonly workspacePath: string | null;
  readonly workspaceLabel: string;
  readonly title: string;
  readonly statusText: 'Needs an answer' | 'Needs permission';
  readonly occurredAt: number;
  readonly target: NotificationFocusTarget | null;
  readonly source: PermissionRequest | AskUserQuestionRequest;
}

export interface CompletionNotificationGroup {
  readonly id: string;
  readonly workspacePath: string;
  readonly workspaceLabel: string;
  readonly classification: NotificationClassification;
  readonly occurredAt: number;
  readonly entries: readonly CompletionNotificationEntry[];
}

export type NotificationCenterRow =
  | PendingNotificationEntry
  | CompletionNotificationEntry;
