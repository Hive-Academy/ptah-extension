/**
 * Pure reply/choice formatting for the gateway command control plane
 * (TASK_2026_156, C11/C12). Platform-neutral text builders reused verbatim by
 * a future Telegram/Slack command parity (AC-8.3), and fixed refusal strings
 * that deliberately carry NO session or workspace data (SEC-6) so unapproved
 * callers learn nothing from any refusal path.
 */
import type { GatewaySessionSummary } from '../session-lister.interface';

/** Discord caps autocomplete `name`/`value` at 100 chars. */
export const CHOICE_TEXT_MAX = 100;

/** Discord picklist/autocomplete cap — also the workspace-list display cap. */
export const PICKLIST_CAP = 25;

export const COMMAND_REPLIES = {
  notPaired: "This channel isn't paired with Ptah.",
  pendingApproval:
    'This channel is awaiting approval in the Ptah desktop app.',
  rateLimited: "You're sending commands too quickly — try again in a minute.",
  turnInProgress:
    'A turn is running in this thread — finish or wait for the current turn first.',
  threadOnly: 'Run this command inside a Ptah thread.',
  conversationRootRevoked:
    "This thread's workspace is no longer available in Ptah. Run /workspace use to pick another.",
  noWorkspaceOpen:
    'No workspace is open in Ptah. Open a project folder in the desktop app, then try again.',
  sessionPickUnresolved:
    'That pick did not match exactly one session. Re-run /sessions and pick from the list.',
  sessionNotResumable:
    "That session can't be resumed in this thread's workspace. Re-run /sessions and pick from the list.",
  sessionInUseElsewhere:
    'That session is in use elsewhere. Free it there first, then try again.',
  sessionCurrentlyRunning:
    'That session is currently running. Wait for it to finish, then try again.',
  alreadyFresh:
    'This thread is already fresh — your next message starts a new session.',
  workspacePickUnresolved:
    "That pick isn't in Ptah's workspace list. Re-run /workspace list and pick from it.",
  workspaceNoLongerAvailable:
    'That workspace is no longer available on disk. Re-run /workspace list and pick another.',
  zeroWorkspaces:
    'Ptah has no registered workspaces yet. Open a project folder in the desktop app first.',
  commandFailed: 'Something went wrong handling that command. Try again.',
  parentChannelAttachNote:
    'Attaching a session requires being inside a Ptah thread — run /session use there.',
} as const;

/** First 8 chars of a session uuid — the short id shown in lists (AC-2.1). */
export function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** Human-readable last-active time: "just now" / "5m ago" / "3h ago" / "2d ago" / ISO date. */
export function humanizeLastActive(
  lastActiveAt: number,
  now: number = Date.now(),
): string {
  const deltaMs = Math.max(0, now - lastActiveAt);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(lastActiveAt).toISOString().slice(0, 10);
}

/** Last path segment of a workspace root (separator-agnostic). */
export function workspaceBasename(root: string): string {
  const segments = root
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .split('/')
    .filter((s) => s.length > 0);
  return segments.at(-1) ?? root;
}

/**
 * Display labels for workspace folders, index-aligned with `folders`.
 * Starts at the basename; same-named folders grow trailing parent segments
 * (`parent/name`) until unique or the full path is used (AC-5.1).
 */
export function disambiguateWorkspaceLabels(
  folders: readonly string[],
): string[] {
  const segments = folders.map((f) =>
    f
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .split('/')
      .filter((s) => s.length > 0),
  );
  const labels = segments.map((s, i) => s.at(-1) ?? folders[i]);
  const maxDepth = Math.max(1, ...segments.map((s) => s.length));
  for (let depth = 2; depth <= maxDepth; depth++) {
    const counts = new Map<string, number>();
    for (const label of labels) {
      const key = label.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let changed = false;
    for (let i = 0; i < labels.length; i++) {
      if (
        (counts.get(labels[i].toLowerCase()) ?? 0) > 1 &&
        segments[i].length >= depth
      ) {
        labels[i] = segments[i].slice(-depth).join('/');
        changed = true;
      }
    }
    if (!changed) break;
  }
  return labels;
}

/** Truncate to Discord's 100-char choice limit with an ellipsis. */
export function truncateChoiceText(text: string): string {
  return text.length <= CHOICE_TEXT_MAX
    ? text
    : `${text.slice(0, CHOICE_TEXT_MAX - 1)}…`;
}

/** Autocomplete choice label: `<name> · <uuid8> · <humanized last-active>`. */
export function sessionChoiceName(
  session: GatewaySessionSummary,
  now: number = Date.now(),
): string {
  return truncateChoiceText(
    `${session.name} · ${shortSessionId(session.sessionId)} · ${humanizeLastActive(session.lastActiveAt, now)}`,
  );
}

export function formatSessionsReply(args: {
  sessions: readonly GatewaySessionSummary[];
  truncated: boolean;
  workspaceRoot: string;
  currentSessionId: string | null;
  inThread: boolean;
  now?: number;
}): string {
  const name = workspaceBasename(args.workspaceRoot);
  if (args.sessions.length === 0) {
    const empty = `No resumable sessions for \`${name}\`.`;
    return args.inThread
      ? empty
      : `${empty}\n${COMMAND_REPLIES.parentChannelAttachNote}`;
  }
  const now = args.now ?? Date.now();
  const lines = args.sessions.map((s, i) => {
    const current = args.currentSessionId === s.sessionId ? ' (current)' : '';
    return `${i + 1}. ${s.name} · ${shortSessionId(s.sessionId)} · ${humanizeLastActive(s.lastActiveAt, now)}${current}`;
  });
  const parts = [`Resumable sessions for \`${name}\`:`, ...lines];
  if (args.truncated) {
    parts.push(
      `Showing the ${PICKLIST_CAP} most recently active — the list is truncated.`,
    );
  }
  if (!args.inThread) {
    parts.push(COMMAND_REPLIES.parentChannelAttachNote);
  }
  return parts.join('\n');
}

export function formatWorkspaceListReply(args: {
  folders: readonly string[];
  /** Effective current root, or null when resolution failed / none open. */
  currentRoot: string | null;
  /** Normalizer used for the current-marker comparison. */
  normalize: (p: string) => string;
}): string {
  if (args.folders.length === 0) return COMMAND_REPLIES.zeroWorkspaces;
  const shown = args.folders.slice(0, PICKLIST_CAP);
  const labels = disambiguateWorkspaceLabels(shown);
  const currentNorm =
    args.currentRoot === null ? null : args.normalize(args.currentRoot);
  const lines = shown.map((folder, i) => {
    const current =
      currentNorm !== null && args.normalize(folder) === currentNorm
        ? ' (current)'
        : '';
    return `• ${labels[i]}${current}`;
  });
  const parts = ['Workspaces Ptah can target:', ...lines];
  if (args.folders.length > PICKLIST_CAP) {
    parts.push(
      `Showing ${PICKLIST_CAP} of ${args.folders.length} workspaces — the list is truncated.`,
    );
  }
  return parts.join('\n');
}

export function sessionUseConfirmation(session: GatewaySessionSummary): string {
  return `This thread now drives session "${session.name}" (${shortSessionId(session.sessionId)}). Your next message continues it.`;
}

export function sessionUseAudit(session: GatewaySessionSummary): string {
  return `📌 This thread now drives session "${session.name}" (${shortSessionId(session.sessionId)}).`;
}

export function newSessionConfirmation(): string {
  return 'Session link cleared — your next message starts a fresh session in this thread.';
}

export function newSessionAudit(): string {
  return '🆕 This thread starts a fresh session on the next message.';
}

export function workspaceUseConfirmation(label: string): string {
  return `This thread now targets "${label}". A new session starts on your next message.`;
}

export function workspaceUseAudit(label: string): string {
  return `📂 This thread now targets "${label}" — a new session starts on the next message.`;
}

export function workspaceNoOpReply(label: string): string {
  return `Already targeting "${label}" — nothing changed (session kept).`;
}
