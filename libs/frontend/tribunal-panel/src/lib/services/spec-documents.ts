import { BATCHES_FILE, DOC_FILES, type DocFile } from '@ptah-extension/shared';
import type { RelayRole } from '../types/tribunal-ui.types';

/**
 * Resolve a contract-owned per-task document by stem.
 *
 * Duty 1 of the `.ptah/specs` contract ratchet (`contract.guard.spec.ts`)
 * permits a per-task filename literal in exactly ONE module, and this is not
 * it. Reading the name OUT of {@link DOC_FILES} keeps that rule intact AND
 * turns a contract rename into a loud failure here rather than a silent one:
 * a framing line naming a file no phase will write, or a phase watching for a
 * file nobody writes.
 *
 * Hoisted here in B5 from the two copies that existed in
 * `tribunal-run.service.ts` and `tribunal-progress.service.ts` — B4 could not
 * do it because B3's file was outside its scope.
 */
export function specDoc(stem: string): DocFile {
  const suffix = '.md';
  const found = DOC_FILES.find((name) => name === `${stem}${suffix}`);
  if (!found) {
    throw new Error(`Unknown spec document stem: ${stem}`);
  }
  return found;
}

/**
 * The deliverable each Relay phase writes (`relay.md:45-50`), composed from the
 * shared spec contract.
 *
 * ONE map, deliberately: the run service names these files in the framing the
 * conductor reads, and the progress service watches for the very same names to
 * close a phase. Two copies that drift mean the panel waits forever on a file
 * the lanes were never asked to write — the same failure class R5 describes,
 * arrived at by duplication instead of by a rename.
 *
 * `implement` uses {@link BATCHES_FILE}, the CURRENT name, which is what a new
 * run is asked to write. Accepting the legacy alias is a READ-side concern and
 * lives with the completion check, not here.
 */
export const RELAY_DELIVERABLE: Record<RelayRole, string> = {
  plan: specDoc('task-description'),
  architect: specDoc('implementation-plan'),
  implement: BATCHES_FILE,
  review: specDoc('code-logic-review'),
};
