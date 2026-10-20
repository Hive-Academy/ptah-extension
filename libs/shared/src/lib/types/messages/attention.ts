/** Safe host-to-renderer attention projection. Never attach a source request. */
export interface AttentionTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly tabId?: string;
  readonly surfaceMode?: boolean;
  readonly surfaceKind?: 'setup-wizard' | 'harness-builder' | 'mcp-apps';
}

export interface AttentionNotice {
  readonly key: string;
  readonly generation: number;
  readonly kind: 'permission' | 'question' | 'lane-permission';
  readonly title: string;
  readonly occurredAt: number;
  readonly target: AttentionTarget | null;
}

export type AttentionChangedPayload =
  | { readonly change: 'upsert'; readonly notice: AttentionNotice }
  | { readonly change: 'resolve'; readonly key: string; readonly generation: number };

export interface AttentionOpenTargetPayload {
  readonly key: string;
  readonly generation: number;
  readonly target: AttentionTarget;
}
