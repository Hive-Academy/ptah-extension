import {
  ArtifactPublishInputSchema,
  ArtifactPublishedNotificationSchema,
} from '@ptah-extension/shared/mcp-apps-contracts';
import type { ArtifactPublishedNotification } from '@ptah-extension/shared/mcp-apps-contracts';
import {
  ArtifactStoreError,
  type IArtifactStore,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

export interface ArtifactToolReply {
  readonly isError: boolean;
  readonly text: string;
}

export type ArtifactNotification = (
  type: 'artifact:published',
  payload: ArtifactPublishedNotification,
) => Promise<void>;

const storeErrors: Record<ArtifactStoreError['code'], string> = {
  INVALID_INPUT: 'Invalid artifact input.',
  INVALID_PATH: 'Artifact path must name a readable HTML file inside the caller workspace.',
  TOO_LARGE: 'Artifact exceeds the 2 MiB UTF-8 limit.',
  NOT_FOUND: 'Artifact source file was not found.',
  UNSUPPORTED: 'Artifacts are shown only in the Ptah desktop app; nothing was saved.',
  QUOTA: 'Artifact storage limit reached.',
  IO_ERROR: 'Artifact storage is unavailable.',
};

export async function handleArtifactPublish(
  args: unknown,
  scope: { workspaceRoot?: string; sessionId?: string },
  store: IArtifactStore | undefined,
  notify: ArtifactNotification | undefined,
  logger: Pick<Logger, 'warn' | 'error'>,
): Promise<ArtifactToolReply> {
  const parsed = ArtifactPublishInputSchema.safeParse(args);
  if (!parsed.success) return { isError: true, text: 'Invalid artifact input: provide a title and exactly one of html or path (maximum 2 MiB).' };
  if (!scope.workspaceRoot?.trim() || !scope.sessionId?.trim()) {
    return { isError: true, text: 'Artifact publishing requires a trusted workspace and session.' };
  }
  if (!store) return { isError: true, text: storeErrors.UNSUPPORTED };

  try {
    const result = await store.publish(
      { workspaceRoot: scope.workspaceRoot, sessionId: scope.sessionId },
      parsed.data,
    );
    if (notify) {
      try {
        const notification = ArtifactPublishedNotificationSchema.parse({
          id: result.id,
          revision: result.revision,
          title: result.title,
          sessionId: result.sessionId,
          viewerUrl: result.viewerUrl,
          createdAt: result.createdAt,
        });
        await notify('artifact:published', notification);
      } catch {
        // degradation-audit: optional-capability - persisted artifact remains available on refresh.
        logger.warn('Artifact notification failed after publish');
      }
    }
    return {
      isError: false,
      text: JSON.stringify({
        id: result.id,
        revision: result.revision,
        title: result.title,
        viewerUrl: result.viewerUrl,
        note: 'Each publish creates a new artifact.',
        hint: 'The user sees it as a card in chat; describe it in one sentence, do not paste the HTML.',
      }),
    };
  } catch (error: unknown) {
    if (error instanceof ArtifactStoreError) return { isError: true, text: storeErrors[error.code] };
    logger.error('Artifact publish failed');
    return { isError: true, text: 'Artifact publishing failed on the host; nothing was confirmed saved.' };
  }
}
