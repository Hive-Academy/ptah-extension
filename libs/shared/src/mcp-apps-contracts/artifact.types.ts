/** Plain artifact wire types. The main shared entry point must remain Zod-free. */
export interface ArtifactRecord {
  id: string;
  title: string;
  revision: number;
  sessionId: string;
  viewerUrl: string;
  createdAt: string;
}

export type ArtifactPublishInput =
  | { title: string; html: string; path?: never }
  | { title: string; path: string; html?: never };

export interface ArtifactPublishResult extends ArtifactRecord {
  savedPath: string;
}

export type ArtifactPublishedNotification = ArtifactRecord;

/** Scope is resolved by the host; an RPC caller supplies no scope identifiers. */
export type ArtifactListRequest = Record<string, never>;

export interface ArtifactListResponse {
  artifacts: ArtifactRecord[];
}

export type ArtifactThemeVarName =
  | '--b1'
  | '--b2'
  | '--b3'
  | '--bc'
  | '--bcm'
  | '--ptah-gold'
  | '--ptah-accent-ink'
  | '--ptah-link'
  | '--state-ink-err'
  | '--state-ink-done'
  | '--surface-highlight';

export interface ArtifactThemeMessage {
  type: 'theme';
  mode: 'light' | 'dark';
  vars: Partial<Record<ArtifactThemeVarName, string>>;
  nonce: string;
}

export interface ArtifactHeightMessage {
  type: 'height';
  px: number;
  nonce: string;
}

export interface ArtifactOpenLinkMessage {
  type: 'open-link';
  url: string;
  nonce: string;
}

export type ArtifactHostToPageMessage = ArtifactThemeMessage;
export type ArtifactPageToHostMessage =
  | ArtifactHeightMessage
  | ArtifactOpenLinkMessage;
