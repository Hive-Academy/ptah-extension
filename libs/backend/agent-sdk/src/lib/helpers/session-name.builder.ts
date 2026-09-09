/**
 * Deliberate session naming.
 *
 * A Claude session that is not given a `--name` gets a DERIVED one, which is
 * what another agent sees in its session listing. A derived name is unstable
 * and unhelpful there, so every Ptah-started session composes its own.
 *
 * Two rules govern what this produces:
 *
 *  - **Uniqueness is guaranteed, not hoped for.** `uniqueSuffix` is the first
 *    few characters of the session's routing id / agent id — a value that is
 *    already unique per session. The CLI performs no duplicate check for a
 *    `-p` or SDK session, so nothing downstream would catch a collision.
 *  - **The name is agent-facing text and names no vendor.** A Ptah CLI agent's
 *    user-chosen name is user DATA: it is slugified through here like any other
 *    input and is never enumerated in a description string.
 *
 * Failure is total and silent-free: the builder returns `undefined` rather than
 * throwing when the inputs sanitise to nothing, and the caller omits the key
 * and logs at `warn`. A naming problem must never cost a session.
 */

/** Upper bound on the composed name. */
const MAX_NAME_LENGTH = 64;

const NAME_PREFIX = 'ptah';

export interface SessionNameInput {
  /** What the session is FOR — `chat` for the main session, the agent's configured name for a spawn. */
  readonly role: string;
  /** Task this session serves, when it serves one. */
  readonly taskId?: string;
  /** Human-readable workspace label, usually the workspace folder name. */
  readonly workspaceLabel?: string;
  /** First characters of the session routing id / agent id. Carries the uniqueness. */
  readonly uniqueSuffix: string;
}

/**
 * Lower-case, collapse every character outside `[a-z0-9-]` into a single dash,
 * and trim the dashes off both ends.
 */
function slugify(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The last path segment of a workspace folder, which is the label a person
 * recognises the project by. Accepts either separator so a Windows path and a
 * POSIX path reduce the same way, and tolerates a trailing separator.
 */
export function deriveWorkspaceLabel(
  workspacePath: string | undefined,
): string | undefined {
  if (!workspacePath) {
    return undefined;
  }
  const segments = workspacePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  return segments[segments.length - 1];
}

/**
 * Compose `ptah-<workspaceLabel>-<role>[-<taskId>]-<uniqueSuffix>`.
 *
 * Returns `undefined` when the parts that make the name meaningful — the role
 * and the uniqueness suffix — sanitise to nothing. A name that is just the
 * prefix identifies no session and would collide with every other one.
 */
export function buildSessionName(input: SessionNameInput): string | undefined {
  const role = slugify(input.role);
  const suffix = slugify(input.uniqueSuffix);
  if (!role || !suffix) {
    return undefined;
  }

  const head = [
    NAME_PREFIX,
    slugify(input.workspaceLabel),
    role,
    slugify(input.taskId),
  ]
    .filter((part) => part.length > 0)
    .join('-');

  // The cap truncates the HEAD only. The suffix is what makes the name unique,
  // so trimming the tail would trade a long name for a colliding one.
  const headBudget = MAX_NAME_LENGTH - suffix.length - 1;
  const truncatedHead = head
    .slice(0, Math.max(headBudget, 0))
    .replace(/-+$/g, '');

  return truncatedHead ? `${truncatedHead}-${suffix}` : suffix;
}
