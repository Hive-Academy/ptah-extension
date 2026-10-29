import type { ProvidersSettingsCommit } from '@ptah-extension/core';
import type { SettingsToast } from './settings-save-feedback.service';

/** Page-toast copy for one write's end. */
export interface SettingsCommitToast {
  readonly message: string;
  readonly tone: SettingsToast['tone'];
}

/**
 * A commit the toast can describe: a single write's end (a drawer write's outcome) or a Providers commit that also
 * names the fields it saved, did not save and could not confirm.
 */
export type SettingsCommitResult = Pick<ProvidersSettingsCommit, 'status' | 'message'> &
  Partial<Pick<ProvidersSettingsCommit, 'saved' | 'unsaved' | 'unconfirmed'>>;

/** The field lists as one sentence: "Saved: a. Not saved: b. Not confirmed: c. Check the current values before retrying." */
function fieldSummary(commit: SettingsCommitResult): string {
  const parts: string[] = [];
  if (commit.saved?.length) parts.push(`Saved: ${commit.saved.join(', ')}.`);
  if (commit.unsaved?.length) parts.push(`Not saved: ${commit.unsaved.join(', ')}.`);
  if (commit.unconfirmed?.length) {
    parts.push(`Not confirmed: ${commit.unconfirmed.join(', ')}. Check the current values before retrying.`);
  }
  return parts.join(' ');
}

/**
 * One commit result as page-toast copy, or `null` while nothing has ended (`idle`, `saving`) or there is nothing to say.
 * - `saved`: `savedMessage` when given, else the field summary; tone `status`.
 * - any other end: the field summary when the commit names fields, else "Not saved." / "Save not confirmed."; then the
 *   host's own message; tone `alert`. A failure never reads as saved (D15).
 */
export function commitToast(commit: SettingsCommitResult, savedMessage?: string): SettingsCommitToast | null {
  if (commit.status === 'idle' || commit.status === 'saving') return null;
  const saved = commit.status === 'saved';
  if (saved && savedMessage) return { message: savedMessage, tone: 'status' };
  const lead = fieldSummary(commit) || (saved ? '' : commit.status === 'unconfirmed' ? 'Save not confirmed.' : 'Not saved.');
  const message = [lead, commit.message].filter(Boolean).join(' ');
  return message ? { message, tone: saved ? 'status' : 'alert' } : null;
}
