import {
  checkDraftValue,
  type SurfaceDataValue,
  type SurfaceInput,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { InputNode } from '../view-model/view-model.types';

/**
 * Label, value, error and issue helpers shared by the text, choice and
 * checkbox inputs. Every result is plain text for interpolation, never markup.
 */

export type SurfaceDrafts = Readonly<Record<string, SurfaceDataValue>>;
export type SurfacePendingValues = ReadonlyMap<string, SurfaceDataValue>;
export type SurfaceIssues = ReadonlyMap<string, readonly string[]>;

export const NO_DRAFTS: SurfaceDrafts = {};
export const NO_PENDING_VALUES: SurfacePendingValues = new Map();
export const NO_ISSUES: SurfaceIssues = new Map();

/** The `text` of a rich-text value, or undefined for anything else. */
export function plainText(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' && typeof (value as { readonly text?: unknown }).text === 'string'
    ? (value as { readonly text: string }).text : undefined;
}

/** What a commit is compared against: the pending overlay over the host value. */
export function committedInputValue(node: InputNode, pendingValues: SurfacePendingValues): SurfaceDataValue {
  const pending = pendingValues.get(node.path);
  return pending !== undefined ? pending : node.hostValue;
}

/** Rule 4 order: the draft over the pending overlay over the host value. */
export function displayedInputValue(node: InputNode, drafts: SurfaceDrafts, pendingValues: SurfacePendingValues): SurfaceDataValue {
  const draft = drafts[node.id];
  return draft !== undefined ? draft : committedInputValue(node, pendingValues);
}

/**
 * The host-read error while no draft replaces it, otherwise the displayed
 * value's `checkDraftValue` reason. `checkNode` is the node validation sees
 * (the choice input passes its sanitized options).
 */
export function inputErrorText(
  node: InputNode,
  drafts: SurfaceDrafts,
  displayedValue: SurfaceDataValue,
  checkNode: SurfaceInput = node,
): string | undefined {
  if (drafts[node.id] === undefined && node.draftError !== undefined) return node.draftError;
  const check = checkDraftValue(checkNode, displayedValue);
  return check.ok ? undefined : check.reason;
}

/** Submit issues and host rejections for one component; non-strings are dropped. */
export function issueTextsOf(issues: SurfaceIssues, componentId: string): readonly string[] {
  const texts: unknown = issues.get(componentId);
  if (!Array.isArray(texts)) return [];
  return texts.flatMap((issue: unknown) => typeof issue === 'string' ? [issue] : []);
}

export function issueIdOf(controlId: string, index: number): string {
  return `${controlId}-issue-${index}`;
}

/** `aria-describedby`: hint, then error, then one id per issue; null when empty. */
export function describedByOf(
  controlId: string,
  parts: { readonly hintId?: string; readonly errorId?: string; readonly issueCount: number },
): string | null {
  const ids: string[] = [];
  if (parts.hintId !== undefined) ids.push(parts.hintId);
  if (parts.errorId !== undefined) ids.push(parts.errorId);
  for (let index = 0; index < parts.issueCount; index++) ids.push(issueIdOf(controlId, index));
  return ids.length > 0 ? ids.join(' ') : null;
}
