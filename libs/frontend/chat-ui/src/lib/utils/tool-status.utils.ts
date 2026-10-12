import type { ExecutionStatus } from '@ptah-extension/shared';

/** How a tool call's state is shown: the rail colour and the spoken words. */
export interface ToolStatusPresentation {
  /** Background class of the item's left rail (existing tokens only). */
  readonly railClass: string;
  /** The state in words, read out by the header (`sr-only`). */
  readonly label: string;
  /** True only for a real failure; drives the visible `failed` chip. */
  readonly failed: boolean;
}

/**
 * The one mapping from a call's state to its rail colour and label, used by
 * both `ptah-tool-call-item` (rail) and `ptah-tool-call-header` (label) so
 * the two cannot drift. A pending permission request outranks the status: the
 * tree builder can deliver it with `status: 'error'`, but it is a decision
 * waiting on the user, not a failure. Command calls say "Command ..." for the
 * terminal states (there is no exit code on `ExecutionNode`).
 * A completed `background` call (`run_in_background: true`) has only started
 * its work: it reads "Command started" / "Started", and the rail stays
 * `bg-success` because the launch itself succeeded.
 */
export function toolStatusPresentation(
  status: ExecutionStatus,
  options: {
    readonly command: boolean;
    readonly awaitingPermission: boolean;
    readonly background?: boolean;
  },
): ToolStatusPresentation {
  const { command, awaitingPermission, background = false } = options;
  if (awaitingPermission) {
    return {
      railClass: 'bg-warning',
      label: 'Awaiting permission',
      failed: false,
    };
  }
  switch (status) {
    case 'complete':
      if (background) {
        return {
          railClass: 'bg-success',
          label: command ? 'Command started' : 'Started',
          failed: false,
        };
      }
      return {
        railClass: 'bg-success',
        label: command ? 'Command succeeded' : 'Completed',
        failed: false,
      };
    case 'error':
      return {
        railClass: 'bg-error',
        label: command ? 'Command failed' : 'Failed',
        failed: true,
      };
    case 'streaming':
      return {
        railClass: 'bg-info animate-pulse motion-reduce:animate-none',
        label: command ? 'Command running' : 'Running',
        failed: false,
      };
    case 'interrupted':
      return { railClass: 'bg-warning', label: 'Interrupted', failed: false };
    case 'resumed':
      return { railClass: 'bg-info', label: 'Resumed', failed: false };
    case 'pending':
      return { railClass: 'bg-base-300', label: 'Pending', failed: false };
  }
}
