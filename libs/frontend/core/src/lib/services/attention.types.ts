export type AttentionKind =
  | 'permission'
  | 'question'
  | 'lane-permission'
  | 'failure'
  | 'warning'
  | 'info'
  | 'success';

export type AttentionSeverity = 'error' | 'warning' | 'info' | 'success';

export interface AttentionAction {
  readonly id: string;
  readonly label: string;
  readonly disabledReason?: string;
}

/** A source-owned snapshot. Keys and generations identify one authoritative lifecycle. */
export interface AttentionItem {
  readonly key: string;
  readonly generation: number;
  readonly kind: AttentionKind;
  readonly source: string;
  readonly workspacePath: string;
  readonly workspaceName: string;
  readonly sessionId?: string;
  readonly tabId?: string;
  readonly ownerSurface?: string;
  readonly severity: AttentionSeverity;
  readonly title: string;
  readonly context?: string;
  readonly actions: readonly AttentionAction[];
  readonly actionable: boolean;
  readonly soundEligible: boolean;
  /** Change only when a dismissed request should be presented again. */
  readonly presentationKey?: string;
}

export interface AttentionSoundCue {
  readonly sequence: number;
  readonly key: string;
}
