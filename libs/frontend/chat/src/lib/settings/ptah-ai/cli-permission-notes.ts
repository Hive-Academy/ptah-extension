import type { CliType } from '@ptah-extension/shared';

/** Badge colour slot. Colour goes on the badge only; the copy stays `text-base-content` (deviation 6). */
export type CliPermissionTone = 'warning' | 'info' | 'error' | 'neutral';

/** What the Permissions & Safety cell shows for one CLI: a short badge and the ℹ popover text. */
export interface CliPermissionNote {
  readonly badge: string;
  readonly tone: CliPermissionTone;
  readonly detail: string;
}

/**
 * CLI ids whose copy is new in this task and still needs the user's review (shown with the
 * Orchestration visual review, Batch 36). The other ids reuse the pre-#575 wording (#70).
 */
export const PENDING_USER_REVIEW_IDS: readonly CliType[] = [
  'copilot',
  'ptah-cli',
  'grok',
];

/**
 * Wording from the pre-#575 Orchestration tab (`git show 7ecdefa45^1:…/agent-orchestration-config.component.ts`
 * :350-359, :530-540, :580-590, :631-641, :701-711). Badges follow `prototypes/final/orchestration.html`.
 */
const FIXED_NOTES: Readonly<
  Record<Exclude<CliType, 'copilot'>, CliPermissionNote>
> = {
  codex: {
    badge: 'Full auto',
    tone: 'warning',
    detail: 'Full auto — Codex runs headless with full access.',
  },
  cursor: {
    badge: 'Full auto',
    tone: 'warning',
    detail: 'Full auto — Cursor runs headless with full access.',
  },
  antigravity: {
    badge: 'Full auto',
    tone: 'warning',
    detail: 'Full auto — Antigravity runs headless with full access.',
  },
  opencode: {
    badge: '--auto flag',
    tone: 'info',
    detail: 'Full auto — opencode runs headless with --auto.',
  },
  pi: {
    badge: 'No MCP / gate',
    tone: 'error',
    detail:
      'No approval gate and no MCP support — Pi always runs tools with full process permissions.',
  },
  // NEW copy, pending user review. Ptah CLI agents take the chat's permission level
  // (`ptah-cli-registry.ts` resolvePermissionOptions: yolo → bypassPermissions, auto-edit → acceptEdits,
  // plan → plan, otherwise default with a prompt per tool call).
  'ptah-cli': {
    badge: 'Follows Autopilot',
    tone: 'info',
    detail:
      "Uses the chat's Autopilot setting. With Autopilot off, each tool call waits for your approval; " +
      'Auto-edit approves file edits only; Plan Mode is read-only; Full Auto approves every action.',
  },
  // NEW copy (TASK_2026_617), pending user review. The ACP permission policy (`acp-permission-policy.ts`)
  // approves a `session/request_permission` whenever an allow option is offered: it selects the allow-once
  // option when the request offers one, and otherwise accepts the only allow option offered — a persistent
  // grant, noted with an info line. A request with no allow option gets reject-once (or is cancelled). It is an auto-approve CLI, so it carries the same warning tone as "Full auto".
  grok: {
    badge: 'Auto-approve',
    tone: 'warning',
    detail:
      'Ptah approves Grok tool requests, shell commands and file edits included. ' +
      'It answers allow-once when Grok offers it; if a request offers only a persistent grant, ' +
      'Ptah accepts that grant and shows an info line. A request with no allow option is declined.',
  },
};

/**
 * NEW copy, pending user review. Copilot's auto-approve maps to the permission bridge presets
 * (`copilot-permission-bridge.ts`): on = fullAuto, off = readOnly (read-only tools and `read` requests only).
 */
const COPILOT_NOTES = {
  on: {
    badge: 'Auto-approve: On',
    tone: 'warning',
    detail: 'Copilot runs every tool call without asking for approval.',
  },
  off: {
    badge: 'Auto-approve: Off',
    tone: 'neutral',
    detail:
      'Copilot runs read-only tools without asking. Every other tool call waits for your approval.',
  },
  unknown: {
    badge: 'Auto-approve: unknown',
    tone: 'neutral',
    detail:
      'The saved Copilot auto-approve setting has not loaded, so its permissions are unknown.',
  },
} as const satisfies Record<string, CliPermissionNote>;

/**
 * The permission note for a CLI. Copilot's depends on its saved auto-approve value; `null` means that value
 * is not loaded and the note says so instead of guessing (the host default is on).
 */
export function cliPermissionNote(
  cli: CliType,
  copilotAutoApprove: boolean | null = null,
): CliPermissionNote {
  if (cli !== 'copilot') return FIXED_NOTES[cli];
  if (copilotAutoApprove === null) return COPILOT_NOTES.unknown;
  return copilotAutoApprove ? COPILOT_NOTES.on : COPILOT_NOTES.off;
}
