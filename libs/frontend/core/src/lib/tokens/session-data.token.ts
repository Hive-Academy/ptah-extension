import { InjectionToken, Signal } from '@angular/core';
import { ChatSessionSummary } from '@ptah-extension/shared';

/**
 * Contract for providing session data to the dashboard.
 * Implemented by ChatStore in the chat library.
 * Used by SessionAnalyticsStateService in the dashboard library.
 * This token breaks the circular dependency between chat and dashboard.
 */
export interface ISessionDataProvider {
  /** Signal of all loaded session summaries */
  readonly sessions: Signal<readonly ChatSessionSummary[]>;
  /** Whether more sessions are available for pagination */
  readonly hasMoreSessions: Signal<boolean>;
  /** Whether a load-more operation is in progress */
  readonly isLoadingMoreSessions: Signal<boolean>;
  /** Load the initial batch of sessions */
  loadSessions(): Promise<void>;
  /** Load the next page of sessions */
  loadMoreSessions(): Promise<void>;
}

export const SESSION_DATA_PROVIDER = new InjectionToken<ISessionDataProvider>(
  'SESSION_DATA_PROVIDER'
);
