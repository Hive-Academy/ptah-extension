export type DisplayFileKind = 'markdown-file' | 'image-file' | 'pdf-file';

/** Address metadata only. File bytes stay in the active viewer. */
export interface DisplayFileItem {
  readonly kind: DisplayFileKind;
  readonly key: string;
  readonly path: string;
  readonly workspaceRoot?: string;
  readonly documentPath?: string;
  readonly title: string;
  readonly readStatus: 'unread';
}
