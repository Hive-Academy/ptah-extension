/**
 * Is a carrier-less task folder only residue of a task that is gone?
 *
 * Git removes a finished task's tracked files, but not the ignored ones beside
 * them — skill-synthesis leaves a `.harvested.json` in every folder it
 * harvests. The folder then stays on disk holding nothing a person wrote, and
 * without this rule the board reports it as a broken task and the doctor
 * offers to adopt it as new `backlog` work.
 *
 * Hidden entries are never task documents, so a folder holding only hidden
 * entries is residue, not a task that lost its carrier. An EMPTY folder is not
 * residue: nothing marks it as left behind, and it may be a task a person is
 * about to write.
 */
export function isResidueFolder(entryNames: readonly string[]): boolean {
  return (
    entryNames.length > 0 && entryNames.every((name) => name.startsWith('.'))
  );
}
