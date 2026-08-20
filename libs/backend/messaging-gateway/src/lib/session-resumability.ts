/**
 * Session resumability check for the gateway attach flow.
 *
 * "Resumable" means the SDK session's JSONL file plausibly exists for the
 * given workspace — NOT "is the session currently active". A session opened
 * earlier may be inactive but still resumable from its persisted JSONL, so the
 * attach flow treats only a genuine on-disk miss as `session-not-resumable`.
 *
 * The default implementation reads `~/.claude/projects/<escaped-workspace>/
 * <sessionUuid>.jsonl`, mirroring the escaping used by
 * `JsonlReaderService.findSessionsDirectory` in `agent-sdk` (we do not depend
 * on that lib to keep messaging-gateway decoupled).
 */
import { injectable } from 'tsyringe';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ISessionResumabilityChecker {
  /**
   * Resolve whether `sessionUuid` is resumable for `workspaceRoot`. Returns
   * true on a positive match or when resumability cannot be disproven (we only
   * block on a genuine, unambiguous miss).
   */
  isResumable(sessionUuid: string, workspaceRoot: string): Promise<boolean>;
}

@injectable()
export class JsonlSessionResumabilityChecker implements ISessionResumabilityChecker {
  async isResumable(
    sessionUuid: string,
    workspaceRoot: string,
  ): Promise<boolean> {
    if (!sessionUuid) return false;
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    let dirs: string[];
    try {
      dirs = await fs.readdir(projectsDir);
    } catch {
      // No projects dir at all — cannot disprove resumability; do not block.
      return true;
    }

    const escaped = (workspaceRoot ?? '').replace(/[:\\/]/g, '-');
    const candidates = new Set<string>();
    if (escaped) {
      candidates.add(escaped);
      const lower = escaped.toLowerCase();
      const match = dirs.find((d) => d.toLowerCase() === lower);
      if (match) candidates.add(match);
    }
    // When the workspace dir cannot be resolved, fall back to scanning every
    // project dir — a positive hit anywhere proves the JSONL exists.
    const searchDirs = candidates.size > 0 ? [...candidates] : dirs;

    for (const dir of searchDirs) {
      const sessionPath = path.join(projectsDir, dir, `${sessionUuid}.jsonl`);
      try {
        await fs.access(sessionPath);
        return true;
      } catch {
        // keep scanning
      }
    }

    // If we never resolved a workspace dir AND scanned everything with no hit,
    // the session genuinely does not exist on disk.
    return false;
  }
}
