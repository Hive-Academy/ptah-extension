import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService, pickerWorkspaceScope } from '@ptah-extension/core';
import { SESSION_HANDOFF_COMMAND } from './session-handoff-prompts';

/**
 * The skill's command name as the command discovery lists it: the
 * `session-handoff` skill's slash command (TASK_2026_655), un-namespaced
 * because the SDK resolves `/session-handoff`, not `/ptah-core:session-handoff`.
 */
export const SESSION_HANDOFF_SKILL = SESSION_HANDOFF_COMMAND.slice(1);

/** What a skill probe found. */
export type HandoffSkillProbe = 'available' | 'missing' | 'transient';

/**
 * SessionHandoffSkillService — asks the host whether this workspace's command
 * discovery lists the `session-handoff` skill (TASK_2026_863).
 *
 * One probe outcome, three meanings, for two different callers:
 * - `available`: the workspace resolves `/session-handoff`.
 * - `missing`: discovery answered and the command is not listed. A CONFIRMED
 *   absence — the automatic hand-off marks the session and never probes it
 *   again; the button falls back to the inline wrap-up prompt.
 * - `transient`: the RPC failed (no answer, transport error). Not an absence:
 *   the automatic hand-off retries later; the button falls back to the inline
 *   prompt, which does the same job without the skill.
 */
@Injectable({ providedIn: 'root' })
export class SessionHandoffSkillService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  async probe(): Promise<HandoffSkillProbe> {
    try {
      const result = await this.rpc.call('autocomplete:commands', {
        query: SESSION_HANDOFF_SKILL,
        maxResults: 10,
        ...pickerWorkspaceScope(this.vscodeService.config().workspaceRoot),
      });
      if (!result.success) return 'transient';
      const listed = (result.data?.commands ?? []).some(
        (command) => command.name === SESSION_HANDOFF_SKILL,
      );
      return listed ? 'available' : 'missing';
    } catch {
      // degradation-audit: optional-capability - a failed probe is a transport
      // failure, not a missing skill: the caller decides whether to retry or to
      // fall back to the inline wrap-up prompt.
      return 'transient';
    }
  }
}