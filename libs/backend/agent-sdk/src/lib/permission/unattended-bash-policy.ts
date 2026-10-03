/**
 * Unattended Bash policy — the pure matcher that decides whether an unattended
 * agent session (a child session nobody is watching) may run a Bash command
 * without a human prompt (TASK_2026_584).
 *
 * Stateless and dependency-free, like `permission-tool-classifier.ts`. The
 * matcher only ever says "allowed" for a single plain command whose leading
 * tokens equal an allowlist entry; anything it cannot prove safe is "not
 * allowed", and the caller falls back to a bounded human prompt.
 */

export interface UnattendedBashDecision {
  readonly allowed: boolean;
  /** Why the command was not allowed. Absent when `allowed` is true. */
  readonly reason?: string;
}

interface RefusedSequence {
  readonly text: string;
  readonly label: string;
}

/**
 * Character sequences that let one command line run more than one command, or
 * redirect its input/output. A command containing any of them is refused
 * outright: a prefix match on `git status; rm -rf ~` would otherwise allow the
 * whole line. `\r` is refused alongside `\n` because both end a line for some
 * shell.
 */
const REFUSED_SEQUENCES: readonly RefusedSequence[] = [
  { text: '\n', label: 'a newline' },
  { text: '\r', label: 'a carriage return' },
  { text: ';', label: '";"' },
  { text: '&', label: '"&"' },
  { text: '|', label: '"|"' },
  { text: '`', label: 'a backtick' },
  { text: '$(', label: '"$("' },
  { text: '<', label: '"<"' },
  { text: '>', label: '">"' },
];

function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Decide one Bash command against an allowlist of command prefixes.
 *
 * - A command containing a newline, `;`, `&`, `|`, a backtick, `$(`, `<` or `>`
 *   is refused.
 * - Otherwise it is allowed when its leading whitespace-separated tokens equal
 *   every token of some allowlist entry: token boundary, case-sensitive.
 *   `git status` allows `git status --short` and refuses `git statusx`.
 * - Any exception while deciding counts as "not allowed", never "allowed".
 */
export function evaluateUnattendedBash(
  command: unknown,
  allowlist: readonly string[],
): UnattendedBashDecision {
  try {
    if (typeof command !== 'string' || command.trim().length === 0) {
      return { allowed: false, reason: 'the command is empty or not text' };
    }

    for (const refused of REFUSED_SEQUENCES) {
      if (command.includes(refused.text)) {
        return {
          allowed: false,
          reason: `the command contains ${refused.label}, which can chain or redirect commands`,
        };
      }
    }

    const commandTokens = tokenize(command);
    for (const entry of allowlist) {
      if (typeof entry !== 'string') {
        continue;
      }
      const entryTokens = tokenize(entry);
      if (
        entryTokens.length === 0 ||
        entryTokens.length > commandTokens.length
      ) {
        continue;
      }
      if (entryTokens.every((token, index) => token === commandTokens[index])) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: 'the command does not start with an allowlisted command',
    };
  } catch (error: unknown) {
    return {
      allowed: false,
      reason: `the command could not be checked (${
        error instanceof Error ? error.message : String(error)
      })`,
    };
  }
}
