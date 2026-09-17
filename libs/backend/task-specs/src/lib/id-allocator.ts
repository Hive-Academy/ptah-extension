/**
 * Pure task-id allocator (C1 / R4.6 / NFR-8).
 *
 * Scans ALL folder names (valid + legacy + suffixed) for the pattern
 * `TASK_YYYY_NNN...`, takes the max NNN for the requested year, and returns the
 * next id with the sequence zero-padded to at least 3 digits and the supplied
 * four-character lowercase-hex suffix appended. A malformed suffix throws
 * rather than producing an unsafe path segment.
 *
 *  - `TASK_2026_146_ORCHESTRA` counts as 146 (suffix ignored).
 *  - `TASK_2026_HERMES` contributes nothing (non-numeric sequence).
 *  - No folders for the year → allocation starts at 001.
 */
import { TASK_ID_SUFFIX_RE } from './id-suffix';

const TASK_FOLDER_RE = /^TASK_(\d{4})_(\d+)/;

export function allocateTaskId(
  folderNames: readonly string[],
  suffix: string,
  year: number = new Date().getFullYear(),
): string {
  if (!TASK_ID_SUFFIX_RE.test(suffix)) {
    throw new Error(
      'Task id suffix must be four lowercase hexadecimal characters.',
    );
  }

  const yearStr = String(year);
  let max = 0;

  for (const name of folderNames) {
    const match = TASK_FOLDER_RE.exec(name);
    if (!match) continue;
    if (match[1] !== yearStr) continue;
    const seq = Number.parseInt(match[2], 10);
    if (Number.isFinite(seq) && seq > max) {
      max = seq;
    }
  }

  const next = max + 1;
  return `TASK_${yearStr}_${String(next).padStart(3, '0')}_${suffix}`;
}
