import type { FileContentChangedPayload } from '@ptah-extension/shared';

/**
 * Narrow an inbound `file:content-changed` payload. Anything that is not the
 * batch shape (a missing payload, a non-array `filePaths`) yields `null`;
 * non-string and empty entries are dropped rather than failing the whole
 * batch.
 *
 * Why a guard when other push handlers trust their producer: this payload
 * changed shape in TASK_2026_437 (`{ filePath }` → `{ filePaths, truncated }`).
 * An old or malformed payload must be dropped here, not crash the message
 * router by iterating `undefined`.
 */
export function toFileContentChange(
  payload: unknown,
): FileContentChangedPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { filePaths, truncated } = payload as Partial<
    Record<keyof FileContentChangedPayload, unknown>
  >;
  if (!Array.isArray(filePaths)) return null;
  return {
    filePaths: filePaths.filter(
      (entry): entry is string => typeof entry === 'string' && entry !== '',
    ),
    truncated: truncated === true,
  };
}
